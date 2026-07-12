# Next.js Web应用 Dockerfile
FROM node:20-alpine AS base

# 安装依赖阶段
FROM base AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci \
    && npm install undici@6.21.3 --no-package-lock

# 构建阶段
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# 构建时传入环境变量
ARG NEXT_PUBLIC_API_BASE_URL
ENV NEXT_PUBLIC_API_BASE_URL=${NEXT_PUBLIC_API_BASE_URL}
ARG NEXT_PUBLIC_GOOGLE_CLIENT_ID
ENV NEXT_PUBLIC_GOOGLE_CLIENT_ID=${NEXT_PUBLIC_GOOGLE_CLIENT_ID}
ARG NEXT_PUBLIC_APPLE_SERVICES_ID
ENV NEXT_PUBLIC_APPLE_SERVICES_ID=${NEXT_PUBLIC_APPLE_SERVICES_ID}
ARG NEXT_PUBLIC_APPLE_REDIRECT_URI
ENV NEXT_PUBLIC_APPLE_REDIRECT_URI=${NEXT_PUBLIC_APPLE_REDIRECT_URI}
# Edition（NEXT_PUBLIC_* 是构建期内联，必须以 build arg 传入；默认 cloud，自托管 compose 传 oss）
ARG NEXT_PUBLIC_GEDO_EDITION
ENV NEXT_PUBLIC_GEDO_EDITION=${NEXT_PUBLIC_GEDO_EDITION}
# /api rewrite 的后端源（standalone 运行时读取；构建期也写入 ENV 供 next.config 读取）
ARG BACKEND_ORIGIN
ENV BACKEND_ORIGIN=${BACKEND_ORIGIN}

RUN npm run build

# 运行阶段
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# 创建非特权用户组和用户
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

# 创建必要的目录并设置权限
RUN mkdir -p /app/.next/cache && \
    chown -R nextjs:nodejs /app

# 复制文件并设置所有权
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# 确保缓存目录权限正确
RUN chown -R nextjs:nodejs /app/.next

# 切换到非特权用户
USER nextjs

EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

# 健康检查（修复：Next.js可能没有/api/health路由，检查根路径或任意路径）
HEALTHCHECK --interval=30s --timeout=3s --start-period=40s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/', (r) => {process.exit((r.statusCode === 200 || r.statusCode === 301 || r.statusCode === 302) ? 0 : 1)}).on('error', () => process.exit(1))"

CMD ["node", "server.js"]

