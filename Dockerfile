# syntax=docker/dockerfile:1

FROM node:22-slim AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=builder /app/dist ./dist

# db.json lives here. On Cloud Run this is per-instance and ephemeral: it resets on every
# cold start and does not survive a new revision. Deploy with --max-instances=1, or two
# instances will keep divergent trade state.
RUN mkdir -p /app/data && chown -R node:node /app

USER node

# Documentation only. Cloud Run injects $PORT and server.ts reads it; it does not read EXPOSE.
EXPOSE 8080

CMD ["node", "dist/server.cjs"]
