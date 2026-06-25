# Build stage
FROM oven/bun:1 AS builder
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY tsconfig.json ./
COPY prisma ./prisma
COPY src ./src
RUN bunx prisma generate
RUN bun run build

# Production stage
FROM node:20-slim
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/src/generated ./src/generated
COPY package.json ./
RUN npm install --omit=dev --ignore-scripts

ENV PORT=8080
EXPOSE 8080

CMD ["node", "dist/index.js"]
