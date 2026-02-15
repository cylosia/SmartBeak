# Code Review: Non-TypeScript Files

**Date:** 2026-02-15
**Scope:** All non-TypeScript files — configuration, infrastructure, CI/CD, Kubernetes, Terraform, SQL migrations, CSS, JavaScript, shell scripts, and environment files.

---

## Critical (Must Fix)

| # | File | Issue | Impact |
|---|------|-------|--------|
| C1 | `vercel.json:49` | CSP set to `default-src 'none'; frame-ancestors 'none'` — blocks ALL resource loading | **App will not render** in Vercel deployment |
| C2 | `apps/web/next.config.js:69` | CSP comment says "set in middleware with nonce" but `vercel.json` overrides with restrictive CSP | CSP conflict breaks the app |
| C3 | `migrations/sql/20260610000000_pkg_keywords.up.sql:19` | `content_id uuid NOT NULL REFERENCES keywords(id)` — FK references wrong table; should be `content_items(id)` | **Data integrity corruption** |
| C4 | `infra/terraform/modules/eks/main.tf:26` | `cluster_endpoint_public_access = true` with no CIDR restriction | EKS API exposed to the internet |
| C5 | `infra/terraform/modules/iam/main.tf:136` | GitHub OIDC thumbprint hardcoded — GitHub rotates these | CI/CD breaks silently on rotation |
| C6 | `infra/terraform/modules/iam/main.tf:68-71` | SES policy allows `ses:SendEmail` on `*` resources | Any assumed role can send email as any address |
| C7 | `k8s/base/ingress.yaml:24,34` | Production hostnames `app.smartbeak.com` / `api.smartbeak.com` hardcoded in base | Staging uses production hostnames unless overlays patch |
| C8 | `k8s/base/external-secrets.yaml:35+` | Secret paths assume specific AWS SM structure with no validation | Pods fail silently if secrets don't exist |
| C9 | `infra/config/r2-bucket-policy.json:7` | Public read access on `/*/static/*` prefix | Sensitive files in static paths are world-readable |
| C10 | `.github/workflows/docker-build.yml:78,85` | Trivy scan runs only *after* image push to ECR | Vulnerable images reach the registry before scan |
| C11 | `.github/workflows/deploy.yml:74-80` | DB migrations run without rollback step on failure | Failed partial migration leaves DB in broken state |
| C12 | `infra/terraform/modules/elasticache/main.tf:44` | No explicit KMS key for Redis; no `maxmemory-policy` set | Default `noeviction` causes OOM |

**Fixed in this review:** C1, C2, C3

---

## High (Should Fix Soon)

| # | File | Issue |
|---|------|-------|
| H1 | `.env.example` | No distinction between REQUIRED and OPTIONAL variables — deployments fail silently |
| H2 | `.eslintrc.security.cjs` | Missing `parserOptions.project` — security linting loses type-awareness |
| H3 | `package.json:38` | Logger check script logic is inverted — reports success when logs are found |
| H4 | `infra/terraform/modules/iam/main.tf:165` | GitHub OIDC `sub` condition uses `repo:*` wildcard — any branch/PR can assume the role |
| H5 | `infra/terraform/modules/rds/main.tf:116` | Performance Insights uses same KMS key as storage encryption |
| H6 | `k8s/base/worker-deployment.yaml` | Worker pods have **no liveness/readiness/startup probes** |
| H7 | `k8s/base/network-policies.yaml:39-52` | Egress allows all `10.0.0.0/8` — too broad |
| H8 | `k8s/base/network-policies.yaml:106` | Web pod egress to `0.0.0.0/0:443` — unrestricted HTTPS egress |
| H9 | All baseline `.down.sql` files (18 files) | Down migrations raise exception instead of reversing |
| H10 | Multiple early `.up.sql` files | Use `TIMESTAMP` without timezone (fixed later by `004100_cp_fix_timestamptz` but requires exclusive lock) |
| H11 | `infra/terraform/modules/ecr/main.tf:13` | Image tag mutability enabled — production tags can be overwritten |
| H12 | `.github/workflows/deploy.yml:54-67` | Image tag fallback logic across multiple sources — could deploy wrong image |

**Fixed in this review:** H2, H3

---

## Medium

| # | File | Issue |
|---|------|-------|
| M1 | `themes/shared/next.config.js:26` | CSP uses `'unsafe-inline'` for styles — weakens XSS protection |
| M2 | `.eslintrc.cjs:61-62` | `jsx-a11y` rules are `warn` not `error` |
| M3 | `install.sh:28` | Installer file not cleaned up on error; no verification of kimi-cli install |
| M4 | `docker-compose.yml:8-9` | Hardcoded `smartbeak:smartbeak` database credentials |
| M5 | `apps/web/next.config.js:103-106` | Empty webpack function — dead code |
| M6 | `apps/web/styles/tokens.css:60-63` | `::selection` color contrast not verified for WCAG 4.5:1 |
| M7 | `apps/web/styles/tokens.css` | No `forced-colors` media query for Windows High Contrast mode |
| M8 | `k8s/base/api-hpa.yaml` vs `web-hpa.yaml` | Web HPA missing memory metric |
| M9 | `k8s/base/*-pdb.yaml` | PDBs use hard `minAvailable: 1` instead of percentages |
| M10 | `k8s/base/configmap.yaml:10` | OTEL endpoint assumes `monitoring` namespace exists |
| M11 | `infra/terraform/modules/networking/main.tf:198-208` | Flow log IAM role allows `logs:*` on all resources |
| M12 | `infra/terraform/modules/rds/main.tf:28-32` | RDS security group allows all egress `0.0.0.0/0` |
| M13 | `infra/observability/docker-compose.yml:30` | OTEL Jaeger exporter uses `insecure: true` |
| M14 | `.spectral.yaml` | Missing OpenAPI security rules |
| M15 | `migrations/sql/...cp_autovacuum_configuration.up.sql:18-25` | Aggressive autovacuum (`cost_delay=2ms`, `cost_limit=2000`) may cause CPU saturation |
| M16 | `migrations/sql/...cp_naming_consistency.up.sql:65` | Dynamic constraint rename can exceed 63-char PG limit |
| M17 | `migrations/sql/...cp_domains_org.up.sql` | FK column `org_id` added without index |
| M18 | `k8s/overlays/*/kustomization.yaml` | Image tags default to `latest` |
| M19 | `.eslintrc.security.cjs:27` | `detect-object-injection` is `warn` — prototype pollution risk should be `error` |
| M20 | `infra/terraform/modules/eks/main.tf:7` | KMS key deletion window is 7 days — too short for DR |
| M21 | `infra/terraform/environments/staging` vs production | Staging uses `t3.medium` (burstable), production `m5.large` — may hide perf issues |

**Fixed in this review:** M5

---

## Low

| # | File | Issue |
|---|------|-------|
| L1 | `tsconfig.json:4-6` | Redundant options already in `tsconfig.base.json` |
| L2 | `tsconfig.strict.json:13-19` | Redundant strict options implied by `"strict": true` |
| L3 | `.npmrc` | Missing `audit-level=moderate` |
| L4 | `themes/*/styles.css` | Minimal stylesheets with no theme differentiation |
| L5 | `apps/web/next.config.js:91-94` | Empty `rewrites()` function — dead code |
| L6 | `apps/web/styles/tokens.css:66-82` | Scrollbar styling only for WebKit |
| L7 | `migrations/sql/...cp_bigint_sequence_monitoring.up.sql` | `sequence_monitoring_alerts` table has no retention policy |
| L8 | `Dockerfile:21` | Alpine image not pinned to digest |

**Fixed in this review:** L5

---

## Detailed Infrastructure Notes

### Kubernetes
- Worker deployment has no probes — K8s cannot determine health or route traffic away from unhealthy pods
- Network policies allow overly broad `10.0.0.0/8` egress and unrestricted `0.0.0.0/0:443` from web pods
- PDBs use absolute `minAvailable: 1` which doesn't scale with replica count — use percentages
- Ingress has production hostnames hardcoded in base; verify overlays properly patch these

### Terraform
- EKS public endpoint has no CIDR restriction — must add `cluster_endpoint_public_access_cidrs`
- IAM SES policy is overly permissive — restrict `Source` to known sender addresses
- GitHub OIDC thumbprint is hardcoded and will break when GitHub rotates certs
- ECR allows mutable image tags — set `IMMUTABLE` for production repos
- Redis has no explicit eviction policy — will OOM under pressure

### CI/CD
- Docker images are pushed to ECR before Trivy scan — scan locally first on PRs
- Deploy workflow has no migration rollback step — a partial migration corrupts the database
- Image tag resolution uses multiple fallback sources which could select the wrong image

### SQL Migrations
- Critical FK bug: `content_keywords.content_id` references `keywords(id)` instead of `content_items(id)`
- 18 baseline down migrations are irreversible (raise exception) — prevents disaster recovery
- Early migrations use `TIMESTAMP` without timezone, later fixed by exclusive-lock migration
- Aggressive autovacuum tuning may cause CPU saturation on production
