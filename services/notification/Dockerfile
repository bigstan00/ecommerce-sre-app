# ---- Build stage: install dependencies into a venv ----
FROM python:3.12-slim AS build

WORKDIR /app

RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# ---- Final runtime stage ----
FROM python:3.12-slim AS runtime

ENV PATH="/opt/venv/bin:$PATH" \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

WORKDIR /app

# Non-root user to run the service
RUN addgroup --system notification && adduser --system --ingroup notification notification

COPY --from=build /opt/venv /opt/venv
COPY app ./app

USER notification

EXPOSE 4007

CMD ["python", "-m", "app.main"]
