# ===========================================
# Chat2API WebUI - Docker Image (Linux)
# Base: Node.js 20 Alpine (Better compatibility for ESM/CJS mix)
# ===========================================

FROM node:20-alpine AS builder

WORKDIR /app

# Install build dependencies for native modules (Alpine Linux)

RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    bash \
    wget \
    ca-certificates

RUN ln -sf /usr/bin/python3 /usr/bin/python && \
    rm -rf /var/cache/apk/*

# Set Python for npm
ENV PYTHON=/usr/bin/python3
ENV NODE_ENV=development

# Copy package files
COPY package*.json ./

# Configure npm mirror (Aliyun/Taobao) for faster downloads in China
RUN npm config set registry https://registry.npmmirror.com && \
    echo "NPM registry changed to: https://registry.npmmirror.com"

# Install all dependencies (optimized for speed)
RUN npm install

# Copy source code
COPY . .

# Build the frontend (renderer) and main process
RUN npm run build

# ===========================================
# Production Stage
# ===========================================
FROM node:20-alpine

WORKDIR /app

# Install runtime dependencies
RUN apk add --no-cache wget bash && \
    ln -sf /usr/bin/python3 /usr/bin/python

# Copy package files from builder
COPY --from=builder /app/package*.json ./

# Install production dependencies only
RUN npm install --omit=dev && \
    npm cache clean --force

# Copy built artifacts from builder
COPY --from=builder /app/src/renderer/dist ./dist/renderer
COPY --from=builder /app/src ./src
COPY --from=builder /app/sha3_wasm_bg.7b9ca65ddd.wasm ./
COPY --from=builder /app/node_modules ./node_modules

# Create non-root user for security (Alpine syntax)
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

# Create data directory (in a location standard for Linux/Docker)
RUN mkdir -p /app/data && \
    chmod 777 /app/data

# Environment variables (optimized for Linux)
ENV NODE_ENV=production \
    WEB_PORT=3000 \
    PROXY_PORT=8080 \
    WEB_HOST=0.0.0.0 \
    WEB_STATIC_DIR=/app/dist/renderer \
    MANAGEMENT_API_SECRET=chat2api-docker-secret-change-me \
    PATH="/app/node_modules/.bin:$PATH" \
    CHAT2API_DATA_DIR=/app/data

# USER nodejs # Commented out for better volume permission handling in some environments

EXPOSE 3000
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

CMD ["node", "--import", "tsx", "src/server/index.ts"]
