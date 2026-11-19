"""Turn a photo of maths (lines of formulas, with some lines of text) into Markdown.

pix2tex, the model that reads formulas, only understands *one* formula per image. A photo of
maths usually has many lines, so we first cut the photo into lines, then read each line:

1. Clean the photo (see `clean_page`): remove shadows and uneven light, decide which pixels
   are ink with a threshold computed from this photo, and erase the notebook's printed lines.
2. Find the lines: count the ink in every row of pixels. Rows with writing form "hills", the
   white space between lines forms "valleys". Each hill is a line.
3. Glue back pieces that belong together: a fraction has small white gaps between its
   numerator, its bar and its denominator, and an exponent can sit a little above its line.
4. Read each line with the right tool (the "hybrid"):
   - Tesseract reads it first. If it is confident and the line looks like words
     ("Exercise 9. Let"), the line is kept as normal text.
   - Otherwise it is a formula, and pix2tex turns it into LaTeX: a $$ ... $$ block.
5. Safety net: when pix2tex produces something that is clearly garbage (the same symbol
   over and over), or the "line" is really a whole block of the page, we say the line could
   not be read instead of filling the note with nonsense.

The model is big (PyTorch, ~1 GB of RAM), so it is imported and loaded only inside the
dedicated math worker, the first time a math photo arrives (see compose.yaml).
"""
import logging
import os
import re
import statistics
import zlib
from collections import Counter

import pytesseract
from PIL import Image, ImageChops, ImageFilter, ImageOps

from .ocr import LANGUAGES, OcrError, open_image, prepare, tidy

log = logging.getLogger(__name__)

MIN_INK = 24           # a pixel is ink only if it is at least this much darker than the paper around it
MIN_LINE_HEIGHT = 6    # thinner "lines" are specks of dirt or JPEG noise
MAX_LINES = 40         # a photo with more lines than this is cut off (keeps one photo under ~2 min)
MARGIN = 12            # white border kept around each cut-out line, in pixels
RULE_COVERAGE = 0.6    # a pixel row (or column) inked across this much of the page is a printed line
TEXT_CONFIDENCE = 75   # Tesseract's average confidence (0-100) needed to keep a line as text
NO_MATH = '_No formulas were found in this photo._'
UNREADABLE_LINE = '_(This line could not be read.)_'


class MathOcrUnavailable(RuntimeError):
    """pix2tex isn't installed in this container (only the math worker has it)."""


# ---------- 1. Cleaning the photo ----------

def paper_background(image):
    """What the empty paper looks like everywhere, shadows included.

    Pen strokes are thin, so taking the *lightest* pixel of every small area wipes the
    writing away and leaves only the paper; blurring then smooths the result into the
    slow light changes of a real photo. Done on a shrunk copy, which is much faster and
    makes the "small area" about 40 pixels wide on the full-size photo.
    """
    scale = max(1, round(max(image.size) / 400))
    small = image.resize((max(1, image.width // scale), max(1, image.height // scale)), Image.Resampling.BOX)
    small = small.filter(ImageFilter.MaxFilter(15)).filter(ImageFilter.GaussianBlur(4))
    return small.resize(image.size, Image.Resampling.BILINEAR)


def otsu_threshold(histogram):
    """The darkness level that best separates "paper" from "ink" (Otsu's method).

    Tries every possible level and keeps the one where the two groups of pixels are each
    as uniform as possible (the largest variance *between* the groups).
    """
    total = sum(histogram)
    weighted_total = sum(level * count for level, count in enumerate(histogram))
    best_level, best_spread = 0, -1.0
    below = below_weighted = 0
    for level, count in enumerate(histogram):
        below += count
        below_weighted += level * count
        above = total - below
        if below == 0 or above == 0:
            continue
        mean_below = below_weighted / below
        mean_above = (weighted_total - below_weighted) / above
        spread = below * above * (mean_below - mean_above) ** 2
        if spread > best_spread:
            best_level, best_spread = level, spread
    return best_level


def profile(mask, axis):
    """How much ink every row (axis 'rows') or column ('columns') has, 0 to 255.

    Shrinking the image to 1 pixel wide (or tall) makes Pillow average each row (or column)
    for us, in C, which is much faster than looping over millions of pixels in Python.
    """
    size = (1, mask.height) if axis == 'rows' else (mask.width, 1)
    return list(mask.resize(size, Image.Resampling.BOX).getdata())


def ink_of(image):
    """(darkness, mask, level) for a grayscale photo: how much darker than the paper around
    it each pixel is, which pixels count as ink (255) or paper (0), and the cut-off used."""
    # Dividing out the light would also work; subtracting is simpler and good enough once
    # the threshold adapts to the photo below.
    darkness = ImageChops.subtract(paper_background(image), image)
    # Ink is whatever Otsu says is "the dark group", but never fainter than MIN_INK, so a
    # page of blank paper with a little JPEG noise doesn't turn all its noise into ink.
    level = max(otsu_threshold(darkness.histogram()), MIN_INK)
    return darkness, darkness.point(lambda value: 255 if value > level else 0), level


def skew_angle(mask):
    """How many degrees the page is tilted (-5 to 5), so it can be turned straight.

    Lines of writing and a notebook's printed lines are horizontal on a straight page. Turn
    a small copy of the ink mask by each candidate angle: at the right one, the ink piles up
    into a few sharp rows (high peaks and empty valleys), which the sum of squares of the
    row profile rewards. Small angles are tried first, so a straight page stays untouched.
    """
    small = mask.copy()
    small.thumbnail((700, 700))
    best_angle, best_score = 0.0, -1
    for tenths in sorted(range(-50, 51), key=abs):
        angle = tenths / 10
        rows = profile(small.rotate(angle, resample=Image.Resampling.NEAREST), 'rows')
        score = sum(value * value for value in rows)
        if score > best_score * 1.005:  # must be clearly better than a smaller angle
            best_angle, best_score = angle, score
    return best_angle


def ruled_rows(mask):
    """Rows of pixels holding a long unbroken stretch of ink: a printed notebook line.

    Shrinking each row in blocks of 1/6 of the page width averages every block; a block
    that comes out (almost) fully inked had ink all along it. A notebook line is found this
    way even when half of it lies in shadow (where it doesn't count as ink at all). A long
    fraction bar can be found too, but that is harmless: only *faint* pixels of these rows
    are erased (see clean_page), and a fraction bar is written in dark pen.
    """
    block = max(1, mask.width // 6)
    blocks = mask.resize((max(1, mask.width // block), mask.height), Image.Resampling.BOX)
    full = blocks.point(lambda value: 255 if value >= 250 else 0)
    return [y for y, value in enumerate(profile(full, 'rows')) if value]


def ruled_columns(mask):
    """The same for columns: a notebook's margin line runs down most of the page."""
    turned = mask.transpose(Image.Transpose.ROTATE_90)  # columns become rows, last column first
    return [mask.width - 1 - y for y in ruled_rows(turned)]


def clean_page(image):
    """Shadow-free, straightened page and ink mask for a prepared (grayscale) photo.

    Returns (clean, mask): `clean` is white paper with dark writing (what the readers get),
    `mask` has ink = 255 and paper = 0 (what the line finder uses).
    """
    darkness, mask, level = ink_of(image)
    angle = skew_angle(mask)
    if angle:
        # Turn the page straight. We turn the *darkness* map, not the photo: the corners
        # that turning uncovers are filled with 0, "no ink". (Filling a photo's corners with
        # white would make the shadowed paper next to them look like ink.)
        darkness = darkness.rotate(angle, resample=Image.Resampling.BICUBIC, fillcolor=0)
        mask = darkness.point(lambda value: 255 if value > level else 0)

    # A notebook's printed lines (and its margin line) run across almost the whole page,
    # which handwriting and formulas never do. Find both kinds first, then erase them, plus
    # a couple of pixels on each side: the blurry edges of a printed line are fainter than
    # its middle and would otherwise stay behind as a thin line in every cut-out. (Erasing
    # the rows first would chop the margin line into pieces too short to be recognised.)
    width, height = mask.size
    rows = {y for y, coverage in enumerate(profile(mask, 'rows')) if coverage > 255 * RULE_COVERAGE}
    rows |= set(ruled_rows(mask))
    columns = {x for x, coverage in enumerate(profile(mask, 'columns')) if coverage > 255 * RULE_COVERAGE}
    columns |= set(ruled_columns(mask))
    printed = Image.new('L', mask.size, 0)  # 255 where a printed line runs
    for y in rows:
        printed.paste(255, (0, max(0, y - 2), width, min(height, y + 3)))
    for x in columns:
        printed.paste(255, (max(0, x - 3), 0, min(width, x + 4), height))

    # Only the *faint* pixels of those rows and columns are removed: pen ink is much darker
    # than the printed ruling, so letters that sit on (or cross) a printed line keep their
    # strokes, and so does a long fraction bar. "Dark enough to be pen" is a second Otsu
    # split, among the pixels that are ink at all.
    ink_histogram = [count if value > level else 0 for value, count in enumerate(darkness.histogram())]
    strong = max(otsu_threshold(ink_histogram), level)
    faint = darkness.point(lambda value: 255 if value <= strong else 0)
    mask = ImageChops.subtract(mask, ImageChops.multiply(printed, faint))

    # The clean page: dark writing where there is ink, pure white everywhere else
    # (no shadows, no paper texture, no printed lines).
    writing = ImageOps.invert(ImageOps.autocontrast(darkness))
    clean = Image.composite(writing, Image.new('L', darkness.size, 255), mask)
    return clean, mask


# ---------- 2-3. Finding the lines ----------

def find_bands(rows):
    """Runs of rows that contain ink, as (top, bottom) pairs (bottom is exclusive)."""
    peak = max(rows, default=0)
    if peak == 0:
        return []
    # A row needs a little ink to count, relative to the busiest row, so a few stray
    # specks on otherwise blank paper don't glue every line together.
    threshold = max(1, peak * 0.02)
    bands, top = [], None
    for y, value in enumerate(rows):
        if value >= threshold and top is None:
            top = y
        elif value < threshold and top is not None:
            bands.append((top, y))
            top = None
    if top is not None:
        bands.append((top, len(rows)))
    return bands


def merge_bands(bands):
    """Glue fraction parts, exponents and other pieces of one line back together."""
    bands = [band for band in bands if band[1] - band[0] >= 2]
    while len(bands) > 1:
        typical = statistics.median(bottom - top for top, bottom in bands)
        gaps = [bands[i + 1][0] - bands[i][1] for i in range(len(bands) - 1)]
        best = None
        for i, gap in enumerate(gaps):
            thin = min(bands[i][1] - bands[i][0], bands[i + 1][1] - bands[i + 1][0]) < typical * 0.5
            close = gap < typical * 0.3
            if (thin and gap < typical * 0.8) or close:
                # Merge the closest qualifying pair first, then look again.
                if best is None or gap < gaps[best]:
                    best = i
        if best is None:
            break
        bands[best:best + 2] = [(bands[best][0], bands[best + 1][1])]
    return [band for band in bands if band[1] - band[0] >= MIN_LINE_HEIGHT]


def drop_ruled_lines(bands, mask):
    """Remove bands that are a slightly tilted printed line rather than writing.

    A tilted notebook line spreads over a few pixel rows, so no single row is inked
    across the page and clean_page() misses it. As a band, though, it is thin and runs
    across most of the page's width, which a line of writing never is.
    """
    if not bands:
        return bands
    typical = statistics.median(bottom - top for top, bottom in bands)
    kept = []
    for top, bottom in bands:
        columns = profile(mask.crop((0, top, mask.width, bottom)), 'columns')
        inked = sum(1 for value in columns if value)
        # Specks (a leftover dot of a printed line, dust): far too little ink to be writing.
        # Dropped now, before merging, or they would act as bridges that glue real lines together.
        if inked < max(12, mask.width * 0.01):
            continue
        if bottom - top < max(typical * 0.5, MIN_LINE_HEIGHT) and inked > RULE_COVERAGE * mask.width:
            continue
        kept.append((top, bottom))
    return kept


def split_lines(image):
    """Cut a prepared (grayscale) photo into one clean image per line, top to bottom."""
    clean, mask = clean_page(image)
    lines = []
    bands = drop_ruled_lines(find_bands(profile(mask, 'rows')), mask)
    for top, bottom in merge_bands(bands)[:MAX_LINES]:
        # Within the line, trim the empty paper left and right of the writing.
        box = mask.crop((0, top, mask.width, bottom)).getbbox()
        if box is None:
            continue
        crop = clean.crop((box[0], top, box[2], bottom))
        lines.append(ImageOps.expand(crop, border=MARGIN, fill=255))
    return lines


# ---------- 4. Reading each line ----------

def read_as_text(line):
    """The line's text if Tesseract reads it confidently as words, otherwise None.

    Tesseract gives every word a confidence from 0 to 100: high when it is sure *and* the
    result looks like a real word from its dictionaries. Formulas score low. On top of
    that, the line must look like prose: mostly letters, a few real words, almost no
    maths symbols (Tesseract can be confidently wrong about "x2+3x").
    """
    try:
        data = pytesseract.image_to_data(line, lang=LANGUAGES, config='--psm 7',
                                         output_type=pytesseract.Output.DICT)
    except Exception:
        log.exception('Tesseract could not read a line; treating it as maths')
        return None
    words = [(text.strip(), float(conf)) for text, conf in zip(data['text'], data['conf'])
             if text.strip() and float(conf) >= 0]
    if not words:
        return None
    text = ' '.join(word for word, _ in words)
    characters = [ch for ch in text if not ch.isspace()]
    letters = sum(ch.isalpha() for ch in characters)
    maths = sum(ch in '=+^_/\\<>{}|~∫∑√≤≥±×÷∞' for ch in characters)
    real_words = sum(1 for word, _ in words if sum(ch.isalpha() for ch in word) >= 3)
    confidence = statistics.mean(conf for _, conf in words)
    if (confidence >= TEXT_CONFIDENCE and letters >= 0.6 * len(characters)
            and maths <= 1 and real_words >= 2):
        return tidy(text)
    return None


def looks_garbled(latex):
    """True for the nonsense pix2tex produces when it doesn't understand an image:
    the same command repeated over and over (\\alpha\\alpha\\beta\\beta...)."""
    tokens = [t for t in re.findall(r'\\[A-Za-z]+|\S', latex) if t not in '{}()[]^_']
    if len(tokens) < 12:
        return False
    most_common = Counter(tokens).most_common(1)[0][1]
    repetitive = len(latex) > 120 and len(zlib.compress(latex.encode())) < 0.3 * len(latex)
    return most_common > 0.35 * len(tokens) or repetitive


def is_block(line):
    """A "line" taller than it is wide, and big, is really several lines glued together
    (for example writing too tightly packed to separate). pix2tex can't read those."""
    return line.height > 400 and line.width < 1.2 * line.height


_model = None


def get_model():
    """Load pix2tex once per worker process (takes a few seconds and ~1 GB of RAM).

    The math worker shuts its process down after a short idle time (compose.yaml), which
    frees that memory again until the next math photo arrives.
    """
    global _model
    if _model is None:
        try:
            import torch
            from pix2tex.cli import LatexOCR
        except ImportError as error:
            raise MathOcrUnavailable('Math recognition is not installed on the server yet.') from error
        torch.set_num_threads(int(os.environ.get('MATH_THREADS', '2')))
        _model = LatexOCR()
    return _model


def read_as_formula(line, name):
    """LaTeX for one line of maths, or None if it can't be read sensibly."""
    if is_block(line):
        return None
    try:
        latex = get_model()(line.convert('RGB')).strip()
    except MathOcrUnavailable:
        raise
    except Exception:
        log.exception('pix2tex could not read a line of %s', name)
        return None
    return None if not latex or looks_garbled(latex) else latex


def image_to_latex(data, name):
    """Read one photo of maths and return Markdown: text lines as text, formulas as $$ blocks."""
    lines = split_lines(prepare(open_image(data, name)))
    blocks = []
    for line in lines:
        text = read_as_text(line)
        if text:
            blocks.append(text)
            continue
        latex = read_as_formula(line, name)
        blocks.append(f'$$\n{latex}\n$$' if latex else UNREADABLE_LINE)
    return '\n\n'.join(blocks)


__all__ = ['MathOcrUnavailable', 'NO_MATH', 'OcrError', 'image_to_latex', 'split_lines']
