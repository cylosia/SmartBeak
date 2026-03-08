# SmartBeak Repository Notes

## Overview
SmartBeak is a `pnpm`/Turbo monorepo centered on a Next.js web app, shared workspace packages, and oRPC-backed API modules. SmartDeploy is implemented inside that monorepo rather than as a separate Express or Replit app.

## Architecture
- **Frontend**: `apps/web` using Next.js App Router, React, TypeScript, Tailwind CSS, and TanStack Query
- **Backend/API**: `packages/api` with oRPC procedures consumed by the web app
- **Data layer**: `packages/database` with Drizzle and Prisma helpers over PostgreSQL
- **Deployment**: Vercel-oriented web deployment plus SmartDeploy workflows under the SmartBeak domain/deploy modules

## Relevant Areas
- `apps/web/app` - Next.js routes, API routes, and layouts
- `apps/web/modules/smartbeak` - SmartBeak product UI modules such as domains, deploy, publishing, and SEO
- `packages/api/modules/smartbeak` - SmartBeak backend procedures and domain logic
- `packages/database` - shared schema, clients, and query helpers
- `packages/auth`, `packages/payments`, `packages/storage`, `packages/mail` - cross-cutting platform packages

## Environment Notes
- `DATABASE_URL` is required for server/runtime startup
- `BETTER_AUTH_SECRET` is required for auth startup
- `VERCEL_TOKEN` is required for deploy flows that call the Vercel API
- `SMARTBEAK_ENCRYPTION_KEY` is required for encrypted provider credentials and AI/publishing integrations

## Status
This file was normalized to reflect the current SmartBeak monorepo so it no longer points contributors at a different stack or a non-existent standalone Replit service.
