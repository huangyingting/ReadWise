---
type: "runbook"
status: "current"
last_updated: "2026-10-11"
description: "Deploys ReadWise to the WebStack VM through the pinned reusable GitHub Actions workflow, a minimal Alpine web image, a separate migration image, shared PostgreSQL, authenticated account email, and scheduled retention maintenance."
---

# WebStack VM deployment

ReadWise deploys to the Azure VM managed by
[`huangyingting/webstack`](https://github.com/huangyingting/webstack). The local
workflow is a thin caller of WebStack's reusable workflow; it does not store SSH
credentials or duplicate VM orchestration.

## Architecture

```text
successful ReadWise CI on main
  -> WebStack reusable workflow v1.0.0
  -> build ghcr.io/OWNER/readwise:{commit}
  -> build ghcr.io/OWNER/readwise-ops:{commit}
  -> Azure OIDC + VM Run Command
  -> transient operations container on webstack-apps
       -> validate PostgreSQL/schema pairing
       -> deploy prisma/postgresql migrations
  -> webstack-deploy readwise APP_IMAGE
  -> Docker health check + old-image rollback

Internet -> Caddy HTTPS -> 127.0.0.1:10005 -> ReadWise container:3000
ReadWise -> 172.30.0.1:5432 -> shared native PostgreSQL
```

`Dockerfile` produces the non-root standalone web image and retains the explicit
`worker` target for background jobs. `Dockerfile.ops` contains only the Prisma
CLI and PostgreSQL migration history. Keeping migrations outside the web image
removes the full production dependency tree from the serving container.

## One-time WebStack authorization

The lowercase repository `huangyingting/readwise` must be authorized by
WebStack with its canonical GitHub names and immutable numeric IDs. The Azure
federated credential subject must be:

```text
repo:huangyingting@24954047/ReadWise@1273352524:environment:production
```

The repository OIDC customization must report `use_immutable_subject: true`.
The WebStack deployment identity needs its VM deployment role on the WebStack
VM. The reusable workflow provisions the app database/role, root-only
`app.env`, Caddy route, and Compose service on the first deployment.

The DNS A record for `readwise.genisisiq.com` must point at the WebStack VM.
Port `10005` is reserved as the loopback host port for ReadWise.

## GitHub configuration

Create a protected `production` environment and configure the values emitted by
WebStack:

| Environment variable | Value |
| --- | --- |
| `AZURE_CLIENT_ID` | ReadWise-specific WebStack deployment identity client ID |
| `AZURE_TENANT_ID` | WebStack Azure tenant ID |
| `AZURE_SUBSCRIPTION_ID` | WebStack Azure subscription ID |
| `AZURE_RESOURCE_GROUP` | WebStack resource group |
| `AZURE_VM_NAME` | WebStack VM name |
| `VM_APP_NAME` | `readwise` |

Store application settings in the `VM_APP_ENV` environment secret. A minimal
production configuration is:

```dotenv
NEXTAUTH_SECRET=<generated-high-entropy-secret>
NEXTAUTH_URL=https://readwise.genisisiq.com
NEXT_PUBLIC_SITE_URL=https://readwise.genisisiq.com
APP_URL=https://readwise.genisisiq.com
NEXT_PUBLIC_APP_URL=https://readwise.genisisiq.com
TRUSTED_PROXY_HOPS=1
ACCOUNT_ADMISSION_MODE=invitation-only
ACCOUNT_ADMISSION_RETENTION_DAYS=90
```

Do not include `DATABASE_URL`, PostgreSQL credentials, or `APP_VERSION`.
WebStack owns those values and rejects attempts to override them. The image
sets `PRISMA_SCHEMA_PATH=prisma/postgresql/schema.prisma`; the workflow appends
bounded PostgreSQL pool, timeout, schema, and TLS parameters. It also enables
node-postgres libpq compatibility with `uselibpqcompat=true` so
`sslmode=require` accepts WebStack's self-signed certificate while keeping the
connection encrypted, matching the Prisma CLI migration behavior.

Optional AI, Speech, Push, OAuth, tracing, and Azure Storage settings may be
added to `VM_APP_ENV`. Without Azure Storage configuration, local speech media
is container-local cache and is not durable across deployments.

Use authenticated SMTP as the primary production account-email path. When
`SMTP_URL`/`EMAIL_FROM` and direct DKIM settings are both complete, ReadWise
selects SMTP and does not retry through direct delivery after an SMTP attempt.
Direct delivery from a cloud VM can still be rejected by recipient policy or
sender-IP blocklists even when SPF, DKIM, DMARC, and STARTTLS are correct.

Email/password is the primary account-creation path. In `invitation-only` mode,
an administrator creates a time-bounded email invitation at
`/admin/invitations`; in `public` mode, email verification is mandatory.
Password recovery also requires email delivery.

Google/Azure OAuth never creates a User or auto-links by matching email. An
existing authenticated User links a provider from Settings, and the provider
must return the same verified normalized email. After linking, that provider
may be used to sign in.

After the first deployment/migration, explicitly create the first administrator
from a trusted operations context that has the production `DATABASE_URL`:

```bash
printf '%s\n' "$READWISE_ADMIN_PASSWORD" |
  npm run bootstrap:admin -- \
  --email admin@example.com \
  --password-stdin
```

The command refuses to modify access once an Admin exists. Do not place the
password in `VM_APP_ENV`, shell history, process arguments, logs, or GitHub
workflow output.

Set repository variables:

```text
VM_APP_NAME=readwise
VM_DEPLOY_ENABLED=true
ACCOUNT_MAIL_FROM=noreply@readwise.genisisiq.com
ACCOUNT_MAIL_DKIM_SELECTOR=<readwise-specific-selector>
EMAIL_FROM=noreply@readwise.genisisiq.com
RETENTION_MAINTENANCE_URL=https://readwise.genisisiq.com/api/maintenance/retention
RETENTION_MAINTENANCE_ENABLED=true
```

For authenticated relay delivery, store the complete credential-bearing
connection URL as the repository secret `SMTP_URL`; for example, an SMTPS URL
on port 465. Keep the sender identity in the repository variable `EMAIL_FROM`.
The deployment workflow injects both values without writing them to source or
workflow output.

For direct account email, add the base64-encoded PEM private key as the
`ACCOUNT_MAIL_DKIM_PRIVATE_KEY_BASE64` repository environment secret. The
caller workflow appends that secret and the two variables to `APPLICATION_ENV`;
they do not need to be duplicated in `VM_APP_ENV`.

Generate a separate retention bearer secret with `openssl rand -base64 48` and
store the same value as the repository secret `RETENTION_WORKER_SECRET`. The
deployment workflow injects it into the web container, while
`.github/workflows/retention-maintenance.yml` uses it for the authenticated
daily request. `/api/ready` reports this optional worker configuration
independently.

Publish these DNS records for the `ACCOUNT_MAIL_FROM` domain before enabling
direct delivery:

- `<selector>._domainkey.readwise.genisisiq.com` TXT containing the matching
  DKIM public key;
- `readwise.genisisiq.com` TXT with SPF authorizing the WebStack VM public IP;
- `_dmarc.readwise.genisisiq.com` TXT with the chosen DMARC policy.

The VM must allow outbound TCP 25, and its public sending IP should have aligned
reverse DNS and acceptable mail reputation. Direct delivery requires verified
STARTTLS from the recipient's preferred MX server. If these requirements cannot
be met, use an authenticated SMTP relay instead; copying the one-time invitation
link remains the safe administrator fallback.

The production Azure public IP uses forward-confirmed reverse DNS:
`20.205.158.10` resolves back to `readwise.genisisiq.com`, whose A record
resolves to the same IP. Azure requires a public-IP DNS label before accepting
the custom PTR value:

```bash
az network public-ip update \
  --resource-group WebStack \
  --name webstack-ip \
  --dns-name webstack-readwise-mail \
  --reverse-fqdn readwise.genisisiq.com.
```

PTR, SPF, DKIM, and DMARC establish sender identity but do not override an IP
blocklist. Follow the listing-specific process in the Spamhaus IP and Domain
Reputation Checker or use an authenticated relay with provider-managed sender
reputation.

Enable `VM_DEPLOY_ENABLED` only after the production environment, Azure OIDC
identity, DNS, and `VM_APP_ENV` secret are ready.

## Deployment behavior

`.github/workflows/deploy-vm.yml` runs after a successful `CI` push to `main`
and supports manual deployment of an explicit ref. It delegates to the immutable
WebStack release `v1.0.0` with:

- `deploy-webapp` mode;
- first-run provisioning for `readwise.genisisiq.com:10005`;
- the exact CI commit as the image tag;
- `Dockerfile.ops` as the transient migration image;
- PostgreSQL schema validation and `prisma migrate deploy` before activation;
- `APP_VERSION` synchronized to the immutable image tag;
- `schema=public`, required TLS, bounded pool size, and bounded timeouts.

The deployed container runs as `nextjs`, listens on `0.0.0.0:3000`, and uses
`/api/ready` for Docker health. WebStack keeps the prior image available and
rolls back when the new container does not become healthy. Database migrations
are not reversed by image rollback, so production migrations must remain
backward-compatible.

## Verification

After deployment:

```bash
curl --fail https://readwise.genisisiq.com/api/health
curl --fail https://readwise.genisisiq.com/api/ready
```

Then verify password sign-in, `/dashboard`, one reader article, `/settings`,
`/admin/invitations`, and `/admin/jobs` with the appropriate accounts. Optional providers may report
`degraded`; required configuration, PostgreSQL connectivity, and migration
status must report healthy.

## Rollback

For a code-only failure, redeploy a prior commit through manual workflow
dispatch. For a schema-related failure, prefer a forward-compatible repair.
WebStack image rollback cannot undo PostgreSQL migrations. Follow
[`release-management.md`](./release-management.md) and
[`../platform/database-runbooks.md`](../platform/database-runbooks.md) for
backup, migration, and incident procedures.
