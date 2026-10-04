# IA Connect worker. Build from the monorepo root:
#   docker build -f apps/worker/Dockerfile -t ia-connect-worker .
# The Playwright image tag must match the `playwright` version in package-lock.json.
FROM mcr.microsoft.com/playwright:v1.63.0-noble

WORKDIR /app
ENV NODE_ENV=production

# Workspace manifests first, so dependencies are cached across code changes.
COPY package.json package-lock.json tsconfig.base.json ./
COPY apps/worker/package.json apps/worker/
COPY packages/core/package.json packages/core/
COPY packages/connectors/package.json packages/connectors/
COPY packages/ai/package.json packages/ai/
RUN npm ci --workspace @ia-connect/worker --include-workspace-root --omit=dev

COPY packages packages
COPY apps/worker apps/worker

# The image's unprivileged user; secrets arrive only through the environment.
USER pwuser
CMD ["npx", "tsx", "apps/worker/src/main.ts"]
