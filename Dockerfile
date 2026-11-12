FROM node:20-bookworm-slim

ENV HOST=0.0.0.0 \
    SOFFICE_BIN=/usr/bin/soffice

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        libreoffice-writer \
        libreoffice-calc \
        libreoffice-impress \
        ghostscript \
        fonts-liberation \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY . .

EXPOSE 3000
CMD ["node", "server.js"]
