# ---- Build Stage ----
FROM node:22-alpine AS builder

WORKDIR /app

# Copy dependency files first for layer caching
COPY package.json package-lock.json ./

# Install production dependencies only
RUN npm install --omit=dev

# ---- Runtime Stage ----
FROM node:22-alpine

WORKDIR /app

# Create non-root user for security
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

# Copy only production dependencies from builder
COPY --from=builder /app/node_modules ./node_modules

# Copy application source
COPY . .

# Ensure non-root user owns the app files
RUN chown -R appuser:appgroup /app

# Switch to non-root user
USER appuser

# Cloud Run expects port 8080
EXPOSE 8080

# Health check for container orchestrators
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:8080/health || exit 1

# Use node directly (not nodemon) for production
CMD ["node", "server.js"]
