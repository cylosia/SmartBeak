# SmartBeak - SmartDeploy Module

## Overview
SmartDeploy is a module within the SmartBeak Supastarter Pro codebase that enables one-click deployment of themed static sites to Vercel. Users manage domains, select from 5 theme templates, and deploy production-ready static HTML sites via the Vercel API.

## Architecture
- **Frontend**: React + TypeScript with wouter routing, shadcn/ui components, TanStack Query v5
- **Backend**: Express.js API with PostgreSQL (Drizzle ORM)
- **Deployment**: Vercel API integration using VERCEL_TOKEN

## Key Files
- `shared/schema.ts` - Database schema (domains, site_shards, deployment_versions, audit_logs)
- `server/storage.ts` - DatabaseStorage implementing IStorage interface
- `server/themes.ts` - 5 theme template generators (HTML)
- `server/deploy.ts` - Vercel deployment service with async progress tracking
- `server/routes.ts` - Express API routes (/api/domains, /api/shards, /api/themes, /api/audit-logs)
- `server/seed.ts` - Database seeding with example domains
- `client/src/pages/domains.tsx` - Domains list page with add/deploy/delete functionality
- `client/src/pages/domain-detail.tsx` - Domain detail with preview iframe, deploy history, audit logs

## Themes
1. affiliate-comparison - Product comparison site
2. authority-site - Content & knowledge hub
3. landing-leadgen - Lead generation landing page
4. local-business - Local business website
5. media-newsletter - Media publication & newsletter

## Database Tables
- `users` - Basic user table
- `domains` - Domain records with name, theme, description
- `site_shards` - Deployment records with version, URL, status, progress
- `deployment_versions` - Version history for each shard
- `audit_logs` - Action tracking with JSONB details

## Environment Variables
- `DATABASE_URL` - PostgreSQL connection string (auto-provisioned)
- `VERCEL_TOKEN` - Vercel API token for deployments
- `SESSION_SECRET` - Session encryption key
