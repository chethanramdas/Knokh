FROM node:24-bookworm-slim AS build
WORKDIR /app/apps/api
COPY apps/api/package*.json ./
RUN npm ci
COPY apps/api/tsconfig.json ./
COPY apps/api/src ./src
RUN npm run build
RUN npm prune --omit=dev
FROM node:24-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /app/apps/api/node_modules ./node_modules
COPY --from=build --chown=node:node /app/apps/api/package.json ./package.json
COPY --from=build --chown=node:node /app/apps/api/dist ./dist
USER node
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:3001/health/live').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node","dist/apps/api/src/server.js"]
