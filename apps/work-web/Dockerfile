FROM node:22-alpine AS build
RUN corepack enable && corepack prepare pnpm@10.28.0 --activate
WORKDIR /repo
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml .npmrc ./
COPY apps/work-web/package.json apps/work-web/
RUN pnpm install --filter @lemone/work-web --frozen-lockfile
COPY apps/work-web apps/work-web
ARG NEXT_PUBLIC_CHAT_URL
ENV NEXT_PUBLIC_CHAT_URL=$NEXT_PUBLIC_CHAT_URL
RUN pnpm --filter @lemone/work-web build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=3001 HOSTNAME=0.0.0.0
COPY --from=build /repo/apps/work-web/.next/standalone ./
COPY --from=build /repo/apps/work-web/.next/static ./apps/work-web/.next/static
COPY --from=build /repo/apps/work-web/public ./apps/work-web/public
USER node
EXPOSE 3001
CMD ["node", "apps/work-web/server.js"]
