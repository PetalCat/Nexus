# Dockerfile
FROM node:22-alpine AS deps
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@latest --activate
# pnpm-workspace.yaml is REQUIRED — it carries the onlyBuiltDependencies
# allowlist for better-sqlite3. Without it, pnpm 10 blocks the install
# script and the native .node binding never builds, leading to a runtime
# "Could not locate the bindings file" crash. See gotcha_pnpm_better_sqlite3.md
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

FROM node:22-alpine AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@latest --activate
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm build

FROM node:22-alpine AS runtime
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@latest --activate

# Same as deps stage — pnpm-workspace.yaml must be present BEFORE pnpm install
# so the better-sqlite3 build allowlist is honored. Forgetting it produces a
# silently-broken image that crashes on first DB query.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile --prod

COPY --from=build /app/build ./build
COPY --from=build /app/package.json ./
# Drizzle migrations must ship in the runtime image — bootstrapSchema() runs
# them on first boot. Without this folder, fresh installs skip bootstrap and
# crash on the first query against any newly added column.
COPY --from=build /app/drizzle ./drizzle

ENV NODE_ENV=production
ENV PORT=8585
ENV DATABASE_URL=./data/nexus.db

RUN mkdir -p /app/data

EXPOSE 8585

CMD ["node", "build/index.js"]
