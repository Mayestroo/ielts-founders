FROM node:22-bookworm-slim AS deps

WORKDIR /app
COPY package*.json ./
COPY prisma ./prisma
RUN npm ci

FROM deps AS build

WORKDIR /app
COPY . .
RUN npm run prisma:generate
RUN npm run build
RUN npm prune --omit=dev

FROM node:22-bookworm-slim AS runner

WORKDIR /app
ENV NODE_ENV=production

COPY --from=build /app/package*.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/prisma.config.ts ./prisma.config.ts

RUN mkdir -p /app/uploads

EXPOSE 3000

CMD ["node", "dist/src/main.js"]
