FROM python:3.10-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    QT_QPA_PLATFORM=offscreen \
    DISPLAY= \
    PORT=7860 \
    PYTHONPATH=/app/packages/scoring-core:/app/services/scoring-api \
    SLU_ENABLE_HOLISTIC_WORKER=true \
    SLU_SCORING_OUTPUT_ROOT=/tmp/sign-language-universe/scoring-api

RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates \
      curl \
      libgl1 \
      libglib2.0-0 \
      libgomp1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY packages/scoring-core /app/packages/scoring-core
COPY packages/shared-contracts /app/packages/shared-contracts
COPY services/scoring-api /app/services/scoring-api
COPY README.md LICENSE NOTICE /app/

RUN python -m pip install --no-cache-dir --upgrade pip setuptools wheel \
    && python -m pip install --no-cache-dir \
      fastapi \
      "uvicorn[standard]" \
      pydantic \
      numpy \
      Pillow \
      opencv-python-headless \
      mediapipe==0.10.18 \
    && python -m pip install --no-cache-dir -e /app/packages/scoring-core \
    && mkdir -p /tmp/sign-language-universe/scoring-api /tmp/sign-language-universe/logs

EXPOSE 7860

HEALTHCHECK --interval=30s --timeout=5s --start-period=45s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:7860/api/scoring/health', timeout=3).read()" || exit 1

CMD ["sh", "-c", "exec uvicorn app.main:app --app-dir services/scoring-api --host 0.0.0.0 --port ${PORT:-7860}"]
