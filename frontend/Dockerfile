# ---- Build Stage ----
FROM node:22-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# Backend API URL
ARG VITE_SERVER_DOMAIN
ENV VITE_SERVER_DOMAIN=$VITE_SERVER_DOMAIN

# Image CDN (Cloudflare in front of S3). Empty = images load straight from S3 (no-op).
# Set once the CDN subdomain is live, e.g. https://cdn.kalamio.com
ARG VITE_CDN_DOMAIN
ENV VITE_CDN_DOMAIN=$VITE_CDN_DOMAIN

# Vite bakes all VITE_* env vars into the bundle at build time
RUN npm run build

# ---- Serve Stage ----
FROM nginx:alpine

RUN rm /etc/nginx/conf.d/default.conf
COPY nginx.conf /etc/nginx/conf.d/
# Dev basic-auth file is not baked in: Cloud Run mounts the "web-dev-htpasswd" secret
# at /etc/nginx/auth/htpasswd (see cloudbuild-web-dev.yaml).
COPY --from=builder /app/dist /usr/share/nginx/html

# Fix permissions for non-root nginx user:
# - PID file moved to /tmp (writable by any user)
# - Cache, log, and config dirs owned by nginx
RUN sed -i 's|pid\s*/run/nginx.pid;|pid /tmp/nginx.pid;|' /etc/nginx/nginx.conf && \
    chown -R nginx:nginx /usr/share/nginx/html \
                         /var/cache/nginx \
                         /var/log/nginx \
                         /etc/nginx/conf.d && \
    chmod -R 755 /var/cache/nginx /var/log/nginx

# Switch to non-root user
USER nginx

EXPOSE 8080

# Health check for container orchestrators
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:8080/ || exit 1

CMD ["nginx", "-g", "daemon off;"]
