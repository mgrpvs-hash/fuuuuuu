FROM node:20-bookworm-slim AS builder

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
COPY README.md ./

RUN npm run build && npm prune --omit=dev

FROM node:20-bookworm-slim AS runtime

WORKDIR /app
ENV NODE_ENV=production

RUN groupadd --system app && useradd --system --gid app app

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/.env.example ./.env.example

RUN mkdir -p /app/data /app/media && chown -R app:app /app
USER app

VOLUME ["/app/data", "/app/media"]
EXPOSE 3000

CMD ["node", "dist/index.js"]
