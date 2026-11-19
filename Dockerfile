# Two images are built from this file:
#   app   (the default): web server, text OCR worker and clock. Small.
#   math: the same, plus PyTorch and the pix2tex formula reader (~1.5 GB more), used only by
#         the math worker in compose.yaml. Nothing else pays for its size or memory.

FROM python:3.12-slim AS base
WORKDIR /app
ENV PYTHONUNBUFFERED=1

# Ordered from "rarely changes" to "changes all the time", so a rebuild after a code edit
# reuses the cached Tesseract and pip layers and only redoes the final COPY.
RUN apt-get update \
 && apt-get install -y --no-install-recommends tesseract-ocr tesseract-ocr-ron \
 && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt


FROM base AS math-base
# CPU-only PyTorch: the normal download includes GPU libraries we can't use (several GB).
RUN pip install --no-cache-dir torch==2.15.0 torchvision==0.29.2 --index-url https://download.pytorch.org/whl/cpu
COPY requirements-math.txt .
RUN pip install --no-cache-dir -r requirements-math.txt
# Download the model's weights now, while building, instead of on the first photo.
RUN python -c "from pix2tex.cli import LatexOCR; LatexOCR()"


FROM math-base AS math
COPY . .


FROM base AS app
COPY . .
EXPOSE 8000
CMD ["sh", "-c", "python manage.py migrate && python manage.py runserver 0.0.0.0:8000"]
