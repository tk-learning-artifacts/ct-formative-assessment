# Stage 1: install production dependencies only
FROM node:20-alpine AS deps
WORKDIR /app
COPY backend/package.json ./backend/
RUN npm install --prefix backend --omit=dev

# Stage 2: lean production image
FROM node:20-alpine AS runtime
WORKDIR /app

RUN addgroup -S app && adduser -S app -G app

COPY --from=deps /app/backend/node_modules ./backend/node_modules
COPY backend/src                           ./backend/src
COPY backend/content                       ./backend/content
COPY backend/package.json                  ./backend/
COPY web                                   ./web

RUN mkdir -p backend/data && chown -R app:app /app

USER app
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -qO- http://localhost:3000/api/health || exit 1

CMD ["node", "backend/src/server.js"]
