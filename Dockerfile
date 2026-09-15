ARG NODE_IMAGE=node:22-bookworm-slim
FROM ${NODE_IMAGE} AS base
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
ENV NEXT_TELEMETRY_DISABLED=1

FROM base AS dependencies
ARG NPM_REGISTRY=https://registry.npmjs.org
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci --registry=${NPM_REGISTRY} && npx prisma generate

FROM dependencies AS migrate
USER node
ENTRYPOINT ["node", "node_modules/prisma/build/index.js"]
CMD ["migrate", "deploy"]

FROM dependencies AS build
COPY . .
RUN npm run build && npm prune --omit=dev

FROM base AS app
ENV NODE_ENV=production HOSTNAME=0.0.0.0 PORT=3000
COPY --from=build --chown=node:node /app/package.json ./package.json
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/.next ./.next
USER node
EXPOSE 3000
CMD ["node", "node_modules/next/dist/bin/next", "start", "--hostname", "0.0.0.0"]
