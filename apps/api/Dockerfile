FROM node:22-alpine AS build
RUN corepack enable && corepack prepare pnpm@10.28.0 --activate
WORKDIR /repo
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml .npmrc ./
COPY apps/api/package.json apps/api/
RUN pnpm install --filter @lemone/api --frozen-lockfile
COPY apps/api apps/api
RUN pnpm --filter @lemone/api build

FROM node:22-alpine
RUN corepack enable && corepack prepare pnpm@10.28.0 --activate
WORKDIR /repo
COPY --from=build /repo/package.json /repo/pnpm-workspace.yaml /repo/pnpm-lock.yaml /repo/.npmrc ./
COPY --from=build /repo/apps/api/package.json apps/api/
RUN pnpm install --filter @lemone/api --frozen-lockfile --prod
COPY --from=build /repo/apps/api/dist apps/api/dist
COPY --from=build /repo/apps/api/migrations apps/api/migrations
WORKDIR /repo/apps/api
USER node
EXPOSE 4000
CMD ["node", "dist/main.js"]
