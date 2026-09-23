FROM node:22-bookworm-slim
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.8.0 --activate
COPY . .
RUN pnpm install --frozen-lockfile && pnpm build
ENV NODE_ENV=production
EXPOSE 3000
CMD ["pnpm", "--filter", "@voice/web", "start"]
