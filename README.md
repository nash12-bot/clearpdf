# ClearPDF

ClearPDF is a Next.js 16 App Router application for uploading, viewing, annotating, editing, printing, and OCR-processing PDF documents. It stores documents on local disk and uses Adobe PDF Services for scanned PDF OCR when server credentials are configured.

## Requirements

- Node.js 24.x
- pnpm 11.25.0 (available through Corepack)
- A writable persistent disk for `.data/uploads`
- Adobe PDF Services credentials for scanned-document OCR

## Local development

From this directory:

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm dev
```

Open <http://localhost:3000>. Production-only Basic Auth is disabled in development.

## Configuration

Copy `.env.example` to `.env.local` for local settings. Do not commit `.env.local` or production environment files.

| Variable | Required | Purpose |
| --- | --- | --- |
| `APP_BASIC_AUTH_USER` | Production | Username for the production Basic Auth access gate. It cannot contain `:`. |
| `APP_BASIC_AUTH_PASSWORD` | Production | Strong password for the production Basic Auth access gate. |
| `PDF_SERVICES_CLIENT_ID` | For Adobe OCR | Adobe PDF Services API client ID (server only). |
| `PDF_SERVICES_CLIENT_SECRET` | For Adobe OCR | Adobe PDF Services API client secret (server only). |
| `PDF_SERVICES_OCR_LOCALE` | No | Adobe OCR language locale; defaults to `en-US`. |
| `CLEARPDF_DATA_DIR` | No | Persistent data root; defaults to `.data` in the application root. |

Set production values in the hosting platform's secret/environment-variable settings. Never use a `NEXT_PUBLIC_` prefix for secrets. Scanned PDFs are sent to Adobe Document Cloud for processing. OCR can misread poor scans; users should verify extracted financial and shipping values against the original.

The production Basic Auth gate is intended for a private, single-operator deployment. It is not per-user authentication or a multi-tenant authorization system. Keep the service behind HTTPS and an access-controlled reverse proxy until proper user accounts and per-document authorization are implemented. The reverse proxy must preserve the `Authorization` header and set trusted `X-Forwarded-Host` and `X-Forwarded-Proto` headers for origin checks.

## Checks and production build

```bash
pnpm check
pnpm build
pnpm start
```

`pnpm check` runs ESLint and TypeScript checks. The repository does not currently include an automated unit or end-to-end test runner. `pnpm build` produces a standalone Next.js server. `pnpm start` starts the production server on port 3000 and keeps the data directory outside build output.

## Storage and deployment architecture

This application currently uses a local filesystem store under `.data/uploads` for original PDFs, OCR results, metadata, and processing status; it has no database or migrations. Run one long-lived Node.js application instance with a writable persistent volume mounted at `.data`. Back up that volume. Do not use a static export, ephemeral serverless filesystem, or Cloudflare Workers for this build: those environments do not provide the durable local storage and long-running processing this implementation requires. Multi-instance deployment also requires shared object storage and a durable shared job/status backend, which are not implemented.

Uploads are limited to 100 MB. Configure any reverse proxy/load balancer request-body limit to at least 101 MB to accommodate multipart form data. The upload and OCR request limits currently live in process memory, so they reset on restart and are not a substitute for edge-level abuse protection.

### Docker

Build from this directory:

```bash
docker build -t clearpdf .
```

Copy `.env.example` to `.env.production`, fill in the production secrets, then create a persistent volume and pass those values through the protected environment file or your container platform's secret manager (never bake them into the image):

```bash
docker volume create clearpdf-data
docker run --name clearpdf --restart unless-stopped -p 3000:3000 --mount source=clearpdf-data,target=/app/.data --env-file .env.production clearpdf
```

Place the app behind an HTTPS reverse proxy and preserve `Authorization` for the Basic Auth gate. Keep `.env.production` out of Git. The container runs as a non-root user, stores data under `/app/.data/uploads`, and listens on port 3000.

## GitHub

Before pushing, review `git status`, confirm `.env*` files other than `.env.example` and `.data` remain ignored, and verify the configured remote and repository access. Never commit uploaded documents, production secrets, or generated build output.
