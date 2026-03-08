# Phase 3A: Enterprise Readiness & Scaling - Design & File Plan

This document outlines the architecture, database schema extensions, API design, and frontend components required to build the Enterprise Readiness & Scaling module for SmartBeak.

## 1. Guiding Principles

- **Additive Changes**: Enterprise schema and functionality live in additive files so the locked `v9` core schema (`smartbeak.ts`) remains unchanged. This follows the pattern established by `growth.ts`.
- **Leverage Existing Patterns**: The implementation will follow the established conventions for API (`orpc`), database (`drizzle`), and frontend (Next.js App Router, `shadcn/ui`) development found in the existing codebase.
- **Security First**: All new entities and endpoints will be protected by robust, role-based access control (RBAC), leveraging and extending the existing `membership.ts` library.
- **Operationally Focused**: Enterprise surfaces should prefer accurate status reporting, clear configuration boundaries, and dependable loading and error states.

## 2. Database Schema (`packages/database/drizzle/schema/enterprise.ts`)

Enterprise-related tables live in `packages/database/drizzle/schema/enterprise.ts`. All tables are prefixed with `enterprise_` for clear namespacing.

| Table Name                  | Columns                                                                                                                              | Description                                                                                                                                 |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `enterprise_teams`          | `id` (uuid), `orgId` (uuid, FK to `organizations`), `name` (text), `slug` (text), `description` (text)                                  | Represents a workspace or team within an organization.                                                                                      |
| `enterprise_team_members`   | `id` (uuid), `teamId` (uuid, FK to `teams`), `userId` (text), `role` (enum: `admin`, `member`)                                          | Junction table linking users to teams with a team-specific role.                                                                            |
| `enterprise_sso_providers`  | `id` (uuid), `orgId` (uuid, FK to `organizations`), `type` (enum: `saml`, `oidc`), `domain` (text), `encryptedConfig` (bytea)            | Stores SSO configuration for an organization (e.g., IdP metadata, client secrets). Config is encrypted at rest.                           |
| `enterprise_scim_tokens`    | `id` (uuid), `orgId` (uuid, FK to `organizations`), `token` (text, hashed), `description` (text), `expiresAt` (timestamp)               | Stores hashed SCIM provisioning tokens for an organization.                                                                                 |
| `enterprise_audit_retention`| `id` (uuid), `orgId` (uuid, FK to `organizations`), `retentionDays` (integer), `exportSchedule` (text, cron format)                     | Configures audit log retention policies and scheduled exports.                                                                              |
| `enterprise_billing_tiers`  | `id` (uuid), `name` (text), `price` (integer), `features` (jsonb), `limits` (jsonb: seats, domains, etc.)                               | Defines available usage-based pricing plans.                                                                                                |
| `enterprise_org_tier`       | `id` (uuid), `orgId` (uuid, FK to `organizations`), `tierId` (uuid, FK to `billing_tiers`), `seats` (integer)                          | Links an organization to a specific billing tier and seat count.                                                                            |

## 3. Backend API (`packages/api`)

The `enterprise` module follows the existing structure.

- **`packages/api/modules/enterprise/router.ts`**: The main router for the enterprise module, combining the sub-routers below.
- **`packages/api/modules/enterprise/teams/`**: Procedures for CRUD operations on teams and team members (`createTeam`, `listTeams`, `updateTeam`, `deleteTeam`, `addTeamMember`, `removeTeamMember`, `updateTeamMemberRole`).
- **`packages/api/modules/enterprise/sso/`**: Procedures for managing saved SSO provider settings and SCIM tokens (`listSsoProviders`, `upsertSsoProvider`, `deleteSsoProvider`, `createScimToken`, `listScimTokens`, `deleteScimToken`).
- **`packages/api/modules/enterprise/audit/`**: Procedures to enhance audit logs (`searchAuditLogs`, `exportAuditLogs`, `getAuditRetention`, `setAuditRetention`).
- **`packages/api/modules/enterprise/billing/`**: Procedures for advanced billing (`listBillingTiers`, `getOrgTier`, `setOrgTier`, `updateSeats`).

## 4. Frontend UI (`apps/web`)

Enterprise pages and components live under the organization enterprise section.

- **`apps/web/app/(saas)/app/(organizations)/[organizationSlug]/enterprise/teams/page.tsx`**: Page hosting the team management dashboard.
- **`apps/web/modules/smartbeak/enterprise/teams/`**: Team management dashboard components.
- **`apps/web/app/(saas)/app/(organizations)/[organizationSlug]/enterprise/sso/page.tsx`**: Page for saved SSO/SCIM configuration.
- **`apps/web/modules/smartbeak/enterprise/sso/`**: Components for SSO settings and SCIM token management.
- **`apps/web/app/(saas)/app/(organizations)/[organizationSlug]/enterprise/audit/page.tsx`**: Page for enterprise audit search, retention, and export settings.
- **`apps/web/modules/smartbeak/enterprise/audit/`**: Enterprise audit log components.
- **`apps/web/app/(saas)/app/(organizations)/[organizationSlug]/enterprise/billing/page.tsx`**: Page for configured billing tiers, seat settings, and usage tracking.
- **`apps/web/modules/smartbeak/enterprise/billing/`**: Enterprise billing dashboard components.

## 5. Infrastructure & Scaling

- **Redis Caching**: Redis-backed caching is used by selected enterprise queries to reduce repeated database work.
- **Rate Limiting**: Rate limiting is applied to selected enterprise endpoints such as SCIM token creation.

## 6. Documentation

- **`README.phase-3a.md`**: Describes the current enterprise feature set and implementation notes.
