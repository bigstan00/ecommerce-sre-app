# --- deps: install all dependencies (incl. dev) for the build stage ---
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --no-audit --no-fund

# --- build: compile TypeScript to JS ---
FROM node:20-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json* ./
COPY tsconfig.json ./
COPY src ./src
RUN npm run build \
    && npm prune --omit=dev --no-audit --no-fund

# --- runtime: minimal final image, non-root user ---
FROM node:20-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app

RUN addgroup -S app && adduser -S app -G app

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
COPY migrations ./migrations

USER app

EXPOSE 4001

# No dependency on curl/wget being present in the image — use Node itself
# for the container healthcheck.
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:'+(process.env.PORT||4001)+'/healthz', res => process.exit(res.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"

CMD ["node", "dist/index.js"]
