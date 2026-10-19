FROM node:22-alpine AS build
RUN corepack enable && corepack prepare pnpm@10.28.0 --activate
WORKDIR /repo
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml .npmrc ./
COPY apps/chat-web/package.json apps/chat-web/
RUN pnpm install --filter @lemone/chat-web --frozen-lockfile
COPY apps/chat-web apps/chat-web
ARG NEXT_PUBLIC_WS_URL
ENV NEXT_PUBLIC_WS_URL=$NEXT_PUBLIC_WS_URL
RUN pnpm --filter @lemone/chat-web build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=3002 HOSTNAME=0.0.0.0
COPY --from=build /repo/apps/chat-web/.next/standalone ./
COPY --from=build /repo/apps/chat-web/.next/static ./apps/chat-web/.next/static
COPY --from=build /repo/apps/chat-web/public ./apps/chat-web/public
USER node
EXPOSE 3002
CMD ["node", "apps/chat-web/server.js"]
