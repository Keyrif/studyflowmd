FROM python:3.12-slim
WORKDIR /app
ENV PYTHONUNBUFFERED=1

# Ordered from "rarely changes" to "changes all the time", so a rebuild after a code edit
# reuses the cached Tesseract and pip layers and only redoes the final COPY.
RUN apt-get update \
 && apt-get install -y --no-install-recommends tesseract-ocr tesseract-ocr-ron \
 && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 8000
CMD ["sh", "-c", "python manage.py migrate && python manage.py runserver 0.0.0.0:8000"]
