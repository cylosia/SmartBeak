# Phase 3A: Enterprise Readiness & Scaling - Design & File Plan

This document outlines the architecture, database schema extensions, API design, and frontend components required to build the Enterprise Readiness & Scaling module for SmartBeak.

## 1. Guiding Principles

- **Additive Changes**: All new schema and functionality will be created in new files to avoid modifying the locked `v9` core schema (`smartbeak.ts`). This follows the pattern established by `growth.ts`.
- **Leverage Existing Patterns**: The implementation will follow the established conventions for API (`orpc`), database (`drizzle`), and frontend (Next.js App Router, `shadcn/ui`) development found in the existing codebase.
- **Security First**: All new entities and endpoints will be protected by robust, role-based access control (RBAC), leveraging and extending the existing `membership.ts` library.
- **Production Grade**: All features will be built with performance, scalability, and user experience in mind, including proper loading states, error handling, and a polished UI.

## 2. Database Schema (`packages/database/drizzle/schema/enterprise.ts`)

A new file will be created to house all enterprise-related tables. All tables will be prefixed with `enterprise_` to ensure clear namespacing.

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

A new `enterprise` module will be created following the existing structure.

- **`packages/api/modules/enterprise/router.ts`**: The main router for the enterprise module, combining the sub-routers below.
- **`packages/api/modules/enterprise/teams/`**: Procedures for CRUD operations on teams and team members (`createTeam`, `listTeams`, `updateTeam`, `deleteTeam`, `inviteMember`, `removeMember`, `updateMemberRole`).
- **`packages/api/modules/enterprise/sso/`**: Procedures for managing SSO/SCIM (`getSsoProvider`, `upsertSsoProvider`, `deleteSsoProvider`, `createScimToken`, `listScimTokens`, `deleteScimToken`).
- **`packages/api/modules/enterprise/audit/`**: Procedures to enhance audit logs (`searchAuditLogs`, `exportAuditLogs`, `getAuditRetention`, `setAuditRetention`).
- **`packages/api/modules/enterprise/billing/`**: Procedures for advanced billing (`listBillingTiers`, `getOrgTier`, `setOrgTier`, `updateSeats`).

## 4. Frontend UI (`apps/web`)

New pages and components will be added under the organization settings and a new top-level section.

- **`apps/web/app/(saas)/app/(organizations)/[organizationSlug]/settings/teams/page.tsx`**: New page to host the team management dashboard.
- **`apps/web/modules/enterprise/teams/`**: Components for the team dashboard: `TeamList`, `CreateTeamForm`, `TeamMemberTable`, `InviteMemberDialog`.
- **`apps/web/app/(saas)/app/(organizations)/[organizationSlug]/settings/sso/page.tsx`**: New page for SSO/SCIM configuration.
- **`apps/web/modules/enterprise/sso/`**: Components for SSO setup: `SamlConfigForm`, `OidcConfigForm`, `ScimTokenManager`.
- **`apps/web/modules/smartbeak/audit/components/AuditLogView.tsx` (Modified)**: Enhance the existing view with search/filter controls and an export button.
- **`apps/web/app/(saas)/app/(organizations)/[organizationSlug]/settings/audit/page.tsx`**: New page for audit log retention settings.
- **`apps/web/modules/enterprise/audit/`**: Component for `AuditRetentionForm`.
- **`apps/web/modules/smartbeak/billing/components/BillingView.tsx` (Modified)**: Enhance the existing view to show usage against new tiered limits and manage seats.
- **`apps/web/app/(saas)/app/(organizations)/[organizationSlug]/settings/plan/page.tsx`**: New page for viewing and changing billing tiers.
- **`apps/web/modules/enterprise/billing/`**: Components for `BillingTierSelector` and `SeatManager`.

## 5. Infrastructure & Scaling

- **Redis Caching**: A new Redis client will be integrated into `packages/database/drizzle/client.ts`. Caching logic will be added to high-read database queries (e.g., `getOrganizationBySlug`, `getSmartBeakOrgBySlug`, `getSubscriptionForOrg`) to reduce database load.
- **Rate Limiting**: A rate-limiting middleware will be added in `packages/api/orpc/procedures.ts` using a library like `unstorage` with a Redis driver to protect critical API endpoints.

## 6. Documentation

- **`README.md` (Modified)**: A new "Phase 3A: Enterprise Features" section will be added, detailing the new capabilities.
