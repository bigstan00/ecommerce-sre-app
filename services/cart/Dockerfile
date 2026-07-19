# ---- Build stage ----
FROM node:20-alpine AS build

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install

COPY tsconfig.json ./
COPY src ./src

RUN npm run build

# ---- Production dependencies stage ----
FROM node:20-alpine AS prod-deps

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --omit=dev

# ---- Final runtime stage ----
FROM node:20-alpine AS runtime

ENV NODE_ENV=production

WORKDIR /app

# Non-root user to run the service
RUN addgroup -S cart && adduser -S cart -G cart

COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./

USER cart

EXPOSE 4003

CMD ["node", "dist/index.js"]
