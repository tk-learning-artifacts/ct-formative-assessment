# Stage 1: install the backend's production dependencies only, exactly as locked
FROM node:20-alpine AS deps
WORKDIR /app
RUN npm install -g pnpm@12.4.1
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY backend/package.json ./backend/
COPY web/package.json ./web/
RUN pnpm install --frozen-lockfile --prod --filter ct-ability-backend
# Fail the build if better-sqlite3's native binding was not built
RUN cd backend && node -e "new (require('better-sqlite3'))(':memory:').prepare('select 1').get()"

# Stage 2: lean production image
FROM node:20-alpine AS runtime
WORKDIR /app

RUN addgroup -S app && adduser -S app -G app

# pnpm keeps packages in /app/node_modules/.pnpm; backend/node_modules holds relative symlinks into it
COPY --from=deps /app/node_modules          ./node_modules
COPY --from=deps /app/backend/node_modules  ./backend/node_modules
COPY backend/src                           ./backend/src
COPY backend/content                       ./backend/content
COPY backend/scripts                       ./backend/scripts
COPY backend/package.json                  ./backend/
COPY web                                   ./web

RUN mkdir -p backend/data && chown -R app:app /app

USER app
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -qO- http://localhost:3000/api/health || exit 1

CMD ["node", "backend/src/server.js"]
