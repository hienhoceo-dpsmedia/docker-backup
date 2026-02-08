FROM node:20-alpine AS base

# Phase 1: Deps
FROM base AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install

# Phase 2: Builder
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED 1
RUN npm run build

# Phase 3: Runner
FROM base AS runner
WORKDIR /app
ENV NODE_ENV production

# Install Rclone, DB Clients, and Curl
RUN apk add --no-cache rclone curl

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# Setup dirs
RUN mkdir .next
RUN mkdir backups
RUN chown nextjs:nodejs .next
RUN chown nextjs:nodejs backups

COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

# USER nextjs

EXPOSE 3000
ENV PORT 3000
ENV HOSTNAME "0.0.0.0"

CMD ["node", "server.js"]
