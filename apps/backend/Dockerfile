FROM node:24-alpine AS base

RUN apk add --no-cache font-dejavu && npm install -g pnpm@12.18.0

WORKDIR /app

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml turbo.json .npmrc ./
COPY packages/shared/package.json ./packages/shared/
COPY apps/backend/package.json ./apps/backend/
COPY apps/frontend/package.json ./apps/frontend/

RUN pnpm install --frozen-lockfile

COPY packages/shared ./packages/shared
COPY apps/backend ./apps/backend

RUN pnpm --filter shared build
RUN pnpm --filter backend build

EXPOSE 3000

ENV PORT=3000
ENV HOST=0.0.0.0
ENV NODE_ENV=production
ENV NODE_OPTIONS="--no-network-family-autoselection"

CMD ["pnpm", "--filter", "backend", "start"]

