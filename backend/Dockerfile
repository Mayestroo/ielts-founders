# Production Dockerfile
  FROM node:22-alpine AS builder
  WORKDIR /app
  COPY package*.json ./
  COPY prisma ./prisma
  RUN npm ci
  COPY . .
  RUN npm run prisma:generate
  RUN npm run build
  
  FROM node:22-alpine AS runner
  WORKDIR /app
  ENV NODE_ENV=production
  ENV UV_THREADPOOL_SIZE=6
  
  # Install PM2 globally
  RUN npm install -g pm2
  
  COPY --from=builder /app/package*.json ./
  COPY --from=builder /app/node_modules ./node_modules
  COPY --from=builder /app/dist ./dist
  COPY --from=builder /app/prisma ./prisma
  COPY --from=builder /app/prisma.config.ts ./prisma.config.ts
  COPY ecosystem.config.js ./
  
  RUN mkdir -p /app/uploads
  
  EXPOSE 3000
  CMD ["pm2-runtime", "ecosystem.config.js", "--env", "production"]
