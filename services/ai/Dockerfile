# The private AI service, with local OCR so scanned CVs never leave it, and the hybrid CV matcher (e5 + cross-encoder).
FROM python:3.12-slim

RUN apt-get update && apt-get install -y --no-install-recommends tesseract-ocr tesseract-ocr-ara tesseract-ocr-eng \
  && rm -rf /var/lib/apt/lists/*
RUN pip install --no-cache-dir uv

WORKDIR /app
COPY pyproject.toml uv.lock ./
# The matching extra: sentence-transformers and PyTorch, the CPU-only build on Linux (pyproject.toml), without CUDA.
RUN uv sync --frozen --no-dev --extra matching

# Both matching models baked into the image at pinned revisions (about 3.2 GB), then loaded offline by name, as the
# service loads them: the build fails if a file is missing. Nothing is downloaded at runtime.
ENV HF_HOME=/models
COPY fetch_models.py ./
RUN uv run --no-sync python fetch_models.py fetch && HF_HUB_OFFLINE=1 uv run --no-sync python fetch_models.py check

# The selected matcher. The API must be given the same EMBEDDING_PROVIDER: it keys its stored CV matches on it.
ENV HF_HUB_OFFLINE=1 \
    EMBEDDING_PROVIDER=e5-rerank
COPY midan_ai ./midan_ai

EXPOSE 8000
CMD ["uv", "run", "--no-sync", "uvicorn", "midan_ai.main:app", "--host", "0.0.0.0", "--port", "8000", "--no-access-log"]
