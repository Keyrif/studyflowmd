"""Turn a photo of maths (several lines of formulas) into LaTeX.

pix2tex, the model that reads formulas, only understands *one* formula per image. A photo of
maths usually has many lines, so we first cut the photo into lines, then read each line:

1. Prepare the photo exactly like for text OCR (upright, grayscale, contrast).
2. Find the lines: count the dark ("ink") pixels in every row of pixels. Rows with writing
   form "hills", the white space between lines forms "valleys". Each hill is a line.
3. Glue back pieces that belong together: a fraction has a small white gap between its
   numerator, its bar and its denominator, and an exponent can sit a little above its line.
   Pieces that are much thinner than a normal line, or very close to a neighbour, are merged.
4. Cut each line out (with a little white margin) and let pix2tex read it.
5. Write every line as a $$ ... $$ block, which the note preview shows as a real formula.

The model is big (PyTorch, ~1 GB of RAM), so it is imported and loaded only inside the
dedicated math worker, the first time a math photo arrives (see compose.yaml).
"""
import logging
import os
import statistics

from PIL import Image, ImageOps

from .ocr import OcrError, open_image, prepare

log = logging.getLogger(__name__)

INK_LEVEL = 140        # after autocontrast, pixels darker than this count as ink
MIN_LINE_HEIGHT = 6    # thinner "lines" are specks of dirt or JPEG noise
MAX_LINES = 40         # a photo with more lines than this is cut off (keeps one photo under ~2 min)
MARGIN = 12            # white border kept around each cut-out line, in pixels
NO_MATH = '_No formulas were found in this photo._'
UNREADABLE_LINE = '_(This line could not be read.)_'


class MathOcrUnavailable(RuntimeError):
    """pix2tex isn't installed in this container (only the math worker has it)."""


def ink_mask(image):
    """Black-and-white copy of a prepared (grayscale) photo: ink = 255, paper = 0."""
    return image.point(lambda value: 255 if value < INK_LEVEL else 0)


def row_profile(mask):
    """How much ink every row of pixels has (0 = none, 255 = solid ink).

    Shrinking the image to 1 pixel wide makes Pillow average each row for us, in C,
    which is much faster than looping over millions of pixels in Python.
    """
    return list(mask.resize((1, mask.height), Image.Resampling.BOX).getdata())


def find_bands(profile):
    """Runs of rows that contain ink, as (top, bottom) pairs (bottom is exclusive)."""
    peak = max(profile, default=0)
    if peak == 0:
        return []
    # A row needs a little ink to count, relative to the busiest row, so faint JPEG
    # speckle on otherwise blank paper doesn't glue every line together.
    threshold = max(1, peak * 0.02)
    bands, top = [], None
    for y, value in enumerate(profile):
        if value >= threshold and top is None:
            top = y
        elif value < threshold and top is not None:
            bands.append((top, y))
            top = None
    if top is not None:
        bands.append((top, len(profile)))
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


def split_lines(image):
    """Cut a prepared (grayscale) photo into one image per line of maths, top to bottom."""
    mask = ink_mask(image)
    lines = []
    for top, bottom in merge_bands(find_bands(row_profile(mask)))[:MAX_LINES]:
        # Within the line, trim the empty paper left and right of the writing.
        box = mask.crop((0, top, mask.width, bottom)).getbbox()
        if box is None:
            continue
        left, right = box[0], box[2]
        crop = image.crop((left, top, right, bottom))
        lines.append(ImageOps.expand(crop, border=MARGIN, fill=255))
    return lines


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


def image_to_latex(data, name):
    """Read one photo of maths and return Markdown with one $$ formula $$ block per line."""
    lines = split_lines(prepare(open_image(data, name)))
    if not lines:
        return ''
    model = get_model()
    blocks = []
    for line in lines:
        try:
            latex = model(line.convert('RGB')).strip()
        except Exception:
            log.exception('pix2tex could not read a line of %s', name)
            latex = ''
        blocks.append(f'$$\n{latex}\n$$' if latex else UNREADABLE_LINE)
    return '\n\n'.join(blocks)


__all__ = ['MathOcrUnavailable', 'NO_MATH', 'OcrError', 'image_to_latex', 'split_lines']
