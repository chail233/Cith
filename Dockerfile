ARG NODE_IMAGE=node:24-bookworm-slim
FROM ${NODE_IMAGE} AS manifests
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/core/package.json ./packages/core/

FROM manifests AS build
RUN npm ci --workspace @cith/core --include-workspace-root --include=dev --no-audit --no-fund
COPY tsconfig.json tsconfig.build.json ./
COPY scripts/copy-assets.js ./scripts/
COPY packages/core/ ./packages/core/
RUN npm run build

FROM manifests AS dependencies
RUN npm ci --workspace @cith/core --omit=dev --no-audit --no-fund

FROM ${NODE_IMAGE}
WORKDIR /app
ENV NODE_ENV=production \
    CITH_DATA=/app/profile \
    CITH_CONFIG=/app/profile/config.json \
    HOME=/app/profile
COPY package.json LICENSE ./
COPY --from=build /app/dist ./dist
COPY --from=dependencies /app/node_modules ./node_modules
COPY --from=dependencies /app/packages/core ./packages/core
COPY scripts/setup.ts ./scripts/
COPY docker/setup.ts ./docker/
COPY docker/entrypoint.sh ./docker/
RUN install -d -o node -g node -m 0750 /app/profile \
    && ln -s /app/profile/wechatbot /app/.wechatbot
USER node
ENTRYPOINT ["/bin/sh", "/app/docker/entrypoint.sh"]
CMD ["start"]
