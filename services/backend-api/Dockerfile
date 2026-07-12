# Backend API Dockerfile
# Build context must be the repo root (see docker-compose.yml).
FROM node:20-alpine

WORKDIR /services/backend-api

COPY services/backend-api/package*.json ./
RUN npm ci --only=production \
    && npm install undici@6.21.3 --omit=dev --no-package-lock

COPY services/backend-api/ .
COPY services/agent/package*.json /services/agent/
RUN cd /services/agent && npm ci --only=production
COPY services/agent /services/agent
COPY specs/gmp /specs/gmp

EXPOSE 8787

ENV NODE_ENV=production
ENV PORT=8787

CMD ["node", "src/server.mjs"]


