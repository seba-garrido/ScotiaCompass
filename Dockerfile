FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY web ./web
COPY scripts ./scripts
RUN npm run build && npm prune --omit=dev

FROM node:22-bookworm-slim
ENV NODE_ENV=production HOST=0.0.0.0 PORT=4317
WORKDIR /app
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node package.json ./
COPY --chown=node:node server ./server
RUN mkdir -p /app/data && chown node:node /app/data
ENV SCOTIA_DATA_DIR=/app/data
USER node
EXPOSE 4317
CMD ["node", "server/index.mjs"]
