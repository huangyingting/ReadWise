# syntax=docker/dockerfile:1
# =============================================================================
# ReadWise — multi-stage production Dockerfile
#
# Required runtime environment variables (set via docker run -e or compose):
#   DATABASE_URL        - Prisma datasource URL. Use PostgreSQL for production
#                         parity, e.g. postgresql://<user>:<password>@<host>:5432/<database>?schema=public
#   PRISMA_SCHEMA_PATH  - Optional schema path; set to
#                         prisma/postgresql/schema.prisma for PostgreSQL images.
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
FROM node:22-alpine AS deps
WORKDIR /app

COPY package*.json ./
COPY prisma.config.ts ./
COPY prisma/schema.prisma prisma/

RUN npm ci

# ---- Stage 2: build the Next.js application -----------------------------
FROM node:22-alpine AS build
WORKDIR /app
ARG PRISMA_SCHEMA_PATH=prisma/schema.prisma

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Generate Prisma client for the current platform
RUN npx prisma generate --schema "$PRISMA_SCHEMA_PATH"

# Build produces .next/standalone (output:"standalone" in next.config.ts)
RUN npm run build

# ---- Stage 3: lean production runner ------------------------------------
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"
ARG PRISMA_SCHEMA_PATH=prisma/schema.prisma
ENV PRISMA_SCHEMA_PATH=$PRISMA_SCHEMA_PATH

# Non-root user for security
RUN addgroup --system --gid 1001 nodejs \
 && adduser  --system --uid 1001 nextjs

# Next.js standalone bundle (server.js + traced node_modules subset)
COPY --from=build --chown=nextjs:nodejs /app/.next/standalone ./
# Static assets served by Next.js
COPY --from=build --chown=nextjs:nodejs /app/.next/static ./.next/static
# Bundled local dictionary files used by LocalDictionaryProvider.
COPY --from=build --chown=nextjs:nodejs /app/dict ./dict

# Prisma generated client + native query engine binary.
# The standalone tracer does not follow dynamic requires used by @prisma/client,
# so we copy both packages explicitly from the full deps stage.
COPY --from=build --chown=nextjs:nodejs /app/node_modules/.prisma        ./node_modules/.prisma
COPY --from=build --chown=nextjs:nodejs /app/node_modules/@prisma/client  ./node_modules/@prisma/client

# Prisma CLI (needed for `prisma migrate deploy` in the entrypoint) and
# migration files (the schema + SQL migration history).
COPY --from=deps  --chown=nextjs:nodejs /app/node_modules/prisma         ./node_modules/prisma
COPY --from=deps  --chown=nextjs:nodejs /app/node_modules/.bin/prisma    ./node_modules/.bin/prisma
COPY --from=build --chown=nextjs:nodejs /app/prisma                      ./prisma
COPY --from=build --chown=nextjs:nodejs /app/prisma.config.ts             ./prisma.config.ts

# Startup script: runs `prisma migrate deploy` then `node server.js`
COPY --chown=nextjs:nodejs docker-entrypoint.sh ./
RUN chmod +x ./docker-entrypoint.sh

USER nextjs
EXPOSE 3000

ENTRYPOINT ["./docker-entrypoint.sh"]
