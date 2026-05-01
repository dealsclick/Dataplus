FROM node:20-bookworm-slim

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=4173

COPY package*.json ./
RUN npm ci --omit=dev

COPY server.js db.js ./
COPY public ./public
COPY scripts ./scripts

RUN mkdir -p /app/data

EXPOSE 4173

CMD ["npm", "start"]
