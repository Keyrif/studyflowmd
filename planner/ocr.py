"""Turn a photo of handwritten or printed notes into plain text.

The steps, in order:
1. Check the upload really is an image, in a format we accept, and not absurdly large.
2. Prepare it: rotate it upright, make it grayscale, shrink huge phone photos, boost contrast.
   OCR accuracy depends more on this preparation than on Tesseract itself.
3. Ask Tesseract to read it, with the Romanian and English language packs.
4. Tidy the result into clean Markdown-friendly text.
"""
import io
import re

import pytesseract
from PIL import Image, ImageOps, UnidentifiedImageError

ALLOWED_FORMATS = {'JPEG', 'PNG', 'WEBP'}
MAX_FILE_BYTES = 10 * 1024 * 1024   # 10 MB per photo
MAX_PIXELS = 40_000_000             # about 7300 x 5500; refuse "decompression bombs" above this
MAX_LONG_EDGE = 2600                # bigger photos are shrunk: more pixels is slower, not more accurate
LANGUAGES = 'ron+eng'               # Romanian first, so ă, â, î, ș, ț are recognised

# Pillow has its own protection against tiny files that expand into enormous images.
Image.MAX_IMAGE_PIXELS = MAX_PIXELS


class OcrError(ValueError):
    """A problem with one uploaded image, with a message that is safe to show the user."""


def read_upload(upload):
    """The bytes of an uploaded photo (at most 10 MB, also enforced while uploading)."""
    if upload.size > MAX_FILE_BYTES:
        raise OcrError(f'{upload.name} is larger than 10 MB.')
    upload.seek(0)
    return upload.read()


def check_image(data, name):
    """Cheap checks, done while the user waits for the upload to be accepted.

    Only the file header is decoded, so this takes milliseconds even for big photos:
    is it really an image, in a format we accept, with a sane number of pixels?
    """
    try:
        # verify() catches corrupt or fake images (for example a text file renamed to .jpg)
        # without decoding every pixel.
        with Image.open(io.BytesIO(data)) as probe:
            image_format = probe.format
            # The size is in the file header, so this is known before any pixels are decoded.
            if probe.width * probe.height > MAX_PIXELS:
                raise OcrError(f'{name} has too many pixels. Use a smaller photo.')
            probe.verify()
    except (UnidentifiedImageError, Image.DecompressionBombError, OSError, SyntaxError):
        raise OcrError(f'{name} is not a readable image.')
    if image_format not in ALLOWED_FORMATS:
        raise OcrError(f'{name}: use JPG, PNG, or WebP photos.')


def open_image(data, name):
    """The expensive part, done later by the worker: decode every pixel."""
    check_image(data, name)
    try:
        image = Image.open(io.BytesIO(data))
        image.load()
    except (UnidentifiedImageError, Image.DecompressionBombError, OSError, SyntaxError):
        raise OcrError(f'{name} is not a readable image.')
    return image


def prepare(image):
    """Make a photo as easy as possible for Tesseract to read."""
    image = ImageOps.exif_transpose(image)          # phones store rotation separately; apply it
    image = image.convert('L')                       # grayscale: color only adds noise for text
    image.thumbnail((MAX_LONG_EDGE, MAX_LONG_EDGE))  # shrink, keeping proportions; never enlarges
    # Darker ink, whiter paper. No cutoff: on a page with little writing, the text is under
    # 1% of the pixels, and clipping the darkest 1% as "noise" would blow up JPEG speckle
    # around the letters into black blobs that Tesseract can't read.
    return ImageOps.autocontrast(image)


def tidy(text):
    """Clean Tesseract's output: trim spaces, drop stray symbols, collapse empty lines."""
    lines = [line.rstrip() for line in text.replace('\x0c', '').splitlines()]
    lines = ['' if re.fullmatch(r'\W{1,2}', line.strip()) else line for line in lines]
    return re.sub(r'\n{3,}', '\n\n', '\n'.join(lines)).strip()


def image_to_text(data, name):
    """Read one photo and return its text (may be empty if nothing was found)."""
    image = prepare(open_image(data, name))
    # --psm 3: let Tesseract detect the page layout (columns, paragraphs) by itself.
    return tidy(pytesseract.image_to_string(image, lang=LANGUAGES, config='--psm 3'))
