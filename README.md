# supastarter for Next.js

supastarter is the ultimate starter kit for production-ready, scalable SaaS applications.

## Helpful links

- [📘 Documentation](https://supastarter.dev/docs/nextjs)
- [🚀 Demo](https://demo.supastarter.dev)


## Local Development Environment Setup

### Prerequisites

- [Docker](https://docs.docker.com/get-docker/) and Docker Compose
- [Node.js](https://nodejs.org/) >= 20
- [pnpm](https://pnpm.io/) package manager

### Running third-party services locally with Docker Compose for offline development

Start the local development services (PostgreSQL and MinIO):

```bash
docker compose up -d
```

This will start:
- **PostgreSQL** on port `5432` (database: `supastarter`, user: `postgres`, password: `postgres`)
- **MinIO** S3-compatible storage on port `9000` (API) and `9001` (Console)
  - Access the MinIO Console at http://localhost:9001
  - Credentials: `minioadmin` / `minioadmin`

### Environment Configuration

Copy the example environment file and update it with local development values:

```bash
cp .env.local.example .env.local
```

For local development with Docker Compose, use these values:

```env
# Database
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/supastarter"

# Storage (MinIO)
S3_ACCESS_KEY_ID="minioadmin"
S3_SECRET_ACCESS_KEY="minioadmin"
S3_ENDPOINT="http://localhost:9000"
S3_REGION="us-east-1"
NEXT_PUBLIC_AVATARS_BUCKET_NAME="avatars"
```

### Stopping Services

```bash
docker compose down
```

To also remove the data volumes:

```bash
docker compose down -v
```

### Get mails on local development environment

To not have to set up a mail service to get mails on your local development environment, you can use `console` provider in `packages/mail`. 
This will print the mails to the console. Simply update the `packages/mail/provider/index.ts` like this:

```typescript
export * from "./console";
```

# Development

To start your the development server of your apps, run: 
```bash
pnpm dev
```
