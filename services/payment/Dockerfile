# --- build stage ---
FROM python:3.13-slim AS builder

WORKDIR /build

RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

COPY requirements.txt .
RUN pip install --no-cache-dir --upgrade pip \
    && pip install --no-cache-dir -r requirements.txt

# --- final stage ---
FROM python:3.13-slim AS final

RUN groupadd --system payment && useradd --system --gid payment --home-dir /app payment

WORKDIR /app

COPY --from=builder /opt/venv /opt/venv
COPY app ./app

ENV PATH="/opt/venv/bin:$PATH" \
    PYTHONUNBUFFERED=1 \
    PORT=4005

USER payment

EXPOSE 4005

CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-4005}"]
