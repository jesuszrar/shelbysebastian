FROM node:20-alpine AS builder
WORKDIR /app

# Install dependencies
COPY package.json package-lock.json* ./
RUN npm ci --silent

# Copy source and Prisma schema
COPY prisma ./prisma
COPY tsconfig.json .
COPY . .

# Generate Prisma client and build
RUN npx prisma generate && npm run build

FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

# Copy runtime artifacts
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma

EXPOSE 3000
CMD ["node", "dist/server.js"]
