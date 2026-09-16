# Build from the backend directory:
#   docker build -f server/Dockerfile -t scrapyard-server .
# or use docker compose in this directory.

FROM python:3.12-slim

RUN useradd --uid 1000 --create-home scrapyard \
    && mkdir /data && chown scrapyard:scrapyard /data

WORKDIR /app

COPY pyproject.toml ./
COPY scrapyard ./scrapyard

RUN pip install --no-cache-dir ".[server]"

USER scrapyard

ENV SCHEME=http \
    HTTP_HOST=0.0.0.0 \
    HTTP_PORT=20202 \
    DATA_PATH=/data \
    PYTHONUNBUFFERED=1

EXPOSE 20202
VOLUME /data

CMD ["scrapyard_server"]
