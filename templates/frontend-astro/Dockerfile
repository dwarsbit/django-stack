# syntax=docker/dockerfile:1

# The frontend image. The `dev` target runs the Astro dev server with the
# source mounted; `prod` builds the site and runs the Node server.
FROM node:22-alpine AS base
WORKDIR /app
ENV ASTRO_TELEMETRY_DISABLED=1

FROM base AS deps
COPY package.json package-lock.json* ./
COPY vendor/ vendor/
RUN --mount=type=cache,target=/root/.npm \
    if [ -f package-lock.json ]; then npm ci; else npm install; fi

FROM deps AS dev
EXPOSE 3000
CMD ["npm", "run", "dev"]

FROM deps AS build
COPY . .
RUN npm run build && npm prune --omit=dev

FROM base AS prod
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/package.json ./package.json
USER node
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=5s --start-period=20s --retries=5 \
    CMD wget -qO- http://127.0.0.1:3000/robots.txt > /dev/null || exit 1
CMD ["node", "./dist/server/entry.mjs"]
