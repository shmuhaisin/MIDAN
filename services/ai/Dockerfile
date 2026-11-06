# The private AI service, with local OCR so scanned CVs never leave it.
FROM python:3.12-slim

RUN apt-get update && apt-get install -y --no-install-recommends tesseract-ocr tesseract-ocr-ara tesseract-ocr-eng \
  && rm -rf /var/lib/apt/lists/*
RUN pip install --no-cache-dir uv

WORKDIR /app
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev
COPY midan_ai ./midan_ai

EXPOSE 8000
CMD ["uv", "run", "--no-sync", "uvicorn", "midan_ai.main:app", "--host", "0.0.0.0", "--port", "8000", "--no-access-log"]
