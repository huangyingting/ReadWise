# syntax=docker/dockerfile:1
# =============================================================================
# ReadWise — multi-stage production Dockerfile
#
# Required runtime environment variables (set via docker run -e or compose):
#   DATABASE_URL        - Prisma datasource URL. Use PostgreSQL for production
#                         parity, e.g. postgresql://<user>:<password>@<host>:5432/<database>?schema=public
#   PRISMA_SCHEMA_PATH  - Optional schema path; defaults to
#                         prisma/postgresql/schema.prisma for production images.
#   NEXTAUTH_SECRET     - Random secret for NextAuth session signing (required)
#   NEXTAUTH_URL        - Public URL of the app, e.g. https://readwise.example.com
#
# Optional (features degrade gracefully when absent):
#   GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET    - Google OAuth sign-in
#   AZURE_AD_CLIENT_ID / _SECRET / _TENANT_ID  - Azure Entra ID OAuth sign-in
#   AZURE_OPENAI_API_KEY / _ENDPOINT / _DEPLOYMENT / _API_VERSION
#                                               - AI features (translation, vocab, quiz, tags)
#   AZURE_SPEECH_KEY / _REGION / _VOICE / _OUTPUT_FORMAT
#                                               - Text-to-speech narration
#   LOG_LEVEL           - Logging verbosity (default: info)
# =============================================================================

# ---- Stage 1: install ALL dependencies (needed for prisma generate + build) -
FROM node:24-alpine AS deps
WORKDIR /app

COPY package*.json ./
COPY prisma.config.ts ./
COPY prisma/schema.prisma prisma/
COPY src/lib/database-provider-policy.mjs ./src/lib/database-provider-policy.mjs

RUN npm ci

# ---- Stage 2: build the Next.js application -----------------------------
FROM node:24-alpine AS build
WORKDIR /app
ARG PRISMA_SCHEMA_PATH=prisma/postgresql/schema.prisma

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Generate Prisma client for the current platform
RUN npx prisma generate --schema "$PRISMA_SCHEMA_PATH"

# Build produces .next/standalone (output:"standalone" in next.config.ts).
# Next imports the Prisma singleton while collecting route metadata, so the
# build-only URL must select the same adapter as the generated client. This is a
# fixed, unreachable placeholder — never pass production credentials at build
# time or bake them into an image layer.
RUN case "$PRISMA_SCHEMA_PATH" in \
      prisma/postgresql/schema.prisma) BUILD_DATABASE_URL="postgresql://build:build@127.0.0.1:5432/readwise_build?schema=public" ;; \
      prisma/schema.prisma) BUILD_DATABASE_URL="file:./dev.db" ;; \
      *) echo "Unsupported PRISMA_SCHEMA_PATH for image build" >&2; exit 1 ;; \
    esac \
 && DATABASE_URL="$BUILD_DATABASE_URL" npm run build

# ---- Stage 2b: production-only dependencies for CLI/worker runtime --------
FROM deps AS production-deps
RUN npm prune --omit=dev --ignore-scripts

# ---- Stage 3: background worker / maintenance CLI runtime -----------------
# Build explicitly with `--target worker`. The default final target remains the
# web runner below, preserving existing `docker build .` behavior.
FROM node:24-alpine AS worker
WORKDIR /app

ENV NODE_ENV=production
ARG PRISMA_SCHEMA_PATH=prisma/postgresql/schema.prisma
ENV PRISMA_SCHEMA_PATH=$PRISMA_SCHEMA_PATH

RUN addgroup --system --gid 1001 nodejs \
 && adduser --system --uid 1001 nextjs \
 && mkdir -p /app/.media \
 && chown nextjs:nodejs /app/.media

COPY --from=production-deps --chown=nextjs:nodejs /app/node_modules ./node_modules
# Use the schema-selected client generated in the build stage, not the default
# client generated during the dependency install.
COPY --from=build --chown=nextjs:nodejs /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build --chown=nextjs:nodejs /app/node_modules/@prisma/client ./node_modules/@prisma/client
COPY --from=build --chown=nextjs:nodejs /app/package.json /app/package-lock.json /app/tsconfig.json ./
COPY --from=build --chown=nextjs:nodejs /app/src ./src
COPY --from=build --chown=nextjs:nodejs /app/scripts ./scripts
COPY --from=build --chown=nextjs:nodejs /app/prisma ./prisma
COPY --from=build --chown=nextjs:nodejs /app/prisma.config.ts ./prisma.config.ts
COPY --from=build --chown=nextjs:nodejs /app/dict ./dict
COPY --chown=nextjs:nodejs scripts/validate-database-schema-config.mjs ./scripts/validate-database-schema-config.mjs
COPY --chown=nextjs:nodejs docker-worker-entrypoint.sh ./docker-worker-entrypoint.sh
RUN chmod +x ./docker-worker-entrypoint.sh

USER nextjs
ENTRYPOINT ["./docker-worker-entrypoint.sh"]
CMD ["npm", "run", "worker"]

# ---- Stage 3: lean production runner ------------------------------------
FROM node:24-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"
ARG PRISMA_SCHEMA_PATH=prisma/postgresql/schema.prisma
ENV PRISMA_SCHEMA_PATH=$PRISMA_SCHEMA_PATH

# Non-root user for security
RUN addgroup --system --gid 1001 nodejs \
 && adduser  --system --uid 1001 nextjs \
 && mkdir -p /app/.media \
 && chown nextjs:nodejs /app/.media

# Next.js standalone bundle (server.js + traced node_modules subset)
COPY --from=build --chown=nextjs:nodejs /app/.next/standalone ./
# Static assets served by Next.js
COPY --from=build --chown=nextjs:nodejs /app/.next/static ./.next/static
# Bundled local dictionary files used by LocalDictionaryProvider.
COPY --from=build --chown=nextjs:nodejs /app/dict ./dict

# Include production dependencies because the Prisma migration CLI loads modules
# dynamically that the Next.js standalone tracer cannot discover.
COPY --from=production-deps --chown=nextjs:nodejs /app/node_modules ./node_modules

# Use the schema-selected generated client and native query engine from build,
# overriding the default client generated during dependency installation.
COPY --from=build --chown=nextjs:nodejs /app/node_modules/.prisma        ./node_modules/.prisma
COPY --from=build --chown=nextjs:nodejs /app/node_modules/@prisma/client  ./node_modules/@prisma/client

# Migration files (the schema + SQL migration history).
COPY --from=build --chown=nextjs:nodejs /app/prisma                      ./prisma
COPY --from=build --chown=nextjs:nodejs /app/prisma.config.ts             ./prisma.config.ts
COPY --from=build --chown=nextjs:nodejs /app/src/lib/database-provider-policy.mjs ./src/lib/database-provider-policy.mjs

# Startup script: runs `prisma migrate deploy` then `node server.js`
COPY --chown=nextjs:nodejs scripts/validate-database-schema-config.mjs ./scripts/validate-database-schema-config.mjs
COPY --chown=nextjs:nodejs docker-entrypoint.sh ./
RUN chmod +x ./docker-entrypoint.sh

USER nextjs
EXPOSE 3000

ENTRYPOINT ["./docker-entrypoint.sh"]
