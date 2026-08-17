FROM node:20-bookworm-slim

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=4173

RUN apt-get update \
  && apt-get install -y --no-install-recommends git \
  && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci --omit=dev

COPY web/package*.json ./web/
RUN cd web && npm ci --include=dev

COPY server.js db.js ./
COPY lib ./lib
COPY public ./public
COPY scripts ./scripts
COPY web ./web

RUN cd web && npm run build

COPY generated ./generated

RUN mkdir -p /app/data /app/logos /app/logs /app/outputs

EXPOSE 4173

CMD ["npm", "start"]
