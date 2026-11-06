# syntax=docker/dockerfile:1

# The frontend image. The `dev` target runs the Vite dev server with the
# source mounted; `prod` builds the site and runs the Node server.
FROM node:22-alpine AS base
WORKDIR /app

FROM base AS deps
COPY package.json package-lock.json* ./
COPY vendor/ vendor/
# No BuildKit cache mounts: Railway rejects them, and the layer is cached anyway.
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi

FROM deps AS dev
EXPOSE 3000
CMD ["npm", "run", "dev"]

FROM deps AS build
COPY . .
RUN npm run build && npm prune --omit=dev

FROM base AS prod
# The proxy in front sets X-Forwarded-Proto, so links and cookies use https.
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 PROTOCOL_HEADER=x-forwarded-proto
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/build ./build
COPY --from=build --chown=node:node /app/package.json ./package.json
USER node
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=5s --start-period=20s --retries=5 \
    CMD wget -qO- http://127.0.0.1:3000/robots.txt > /dev/null || exit 1
CMD ["node", "build"]
