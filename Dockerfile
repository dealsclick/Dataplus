FROM node:20-bookworm-slim

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=4173

COPY package*.json ./
RUN npm ci --omit=dev

COPY web/package*.json ./web/
RUN cd web && npm ci

COPY server.js db.js ./
COPY lib ./lib
COPY public ./public
COPY scripts ./scripts
COPY web ./web

RUN cd web && npm run build

RUN mkdir -p /app/data /app/logos /app/logs /app/outputs

EXPOSE 4173

CMD ["npm", "start"]
