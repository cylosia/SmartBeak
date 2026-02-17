# Dependency Audit Report

**Date:** 2026-02-17
**Scope:** Root `package.json` + workspace packages, `package-lock.json` transitive dependencies

---

## Executive Summary

`npm audit` reports **0 known CVEs** against the lockfile. However, there are significant risks hiding below the surface: a cryptographic dependency (`fernet`) that relies on the **discontinued** `crypto-js` library, an OpenTelemetry version mismatch causing duplicate module instances, and ESLint 8 which has been **end-of-life since October 2024**. Two dependencies (`node-fetch`, `form-data`) are unnecessary given the Node.js >=20 engine requirement.

**Priority order:** Security > Deprecated/Unmaintained > Outdated > Duplicates/Cleanup

---

## 1. Security Vulnerabilities

### 1.1 CRITICAL: `fernet@0.3.3` depends on discontinued `crypto-js`

| | |
|---|---|
| **Severity** | Critical |
| **Direct dep** | `fernet@0.3.3` |
| **Transitive dep** | `crypto-js@4.2.0` |
| **Issue** | `crypto-js` is **officially discontinued and unmaintained**. The maintainer stated: "Active development of CryptoJS has been discontinued. This library is no longer maintained." |
| **CVE history** | CVE-2023-46233 (CVSS 7.2) -- PBKDF2 implementation 1,000x weaker than the 1993 standard. Patched in 4.2.0 (the version in the lockfile), but **no future vulnerabilities will be patched**. |
| **Lockfile version** | `crypto-js@4.2.0` -- patched for known CVEs, but dead upstream. |

**Recommendation:** Replace `fernet` with Node.js built-in `crypto` module (AES-256-GCM via `crypto.createCipheriv`). If Fernet protocol interoperability with Python is required, use `fernet-web` (uses Web Crypto API) or implement the simple Fernet spec (AES-128-CBC + HMAC-SHA256) on top of native `crypto`. This eliminates all third-party cryptographic dependencies.

### 1.2 HIGH: OpenTelemetry version mismatch causes duplicate module instances

| | |
|---|---|
| **Severity** | High |
| **Issue** | Experimental packages (`0.49.1`) were released alongside SDK `1.22.0`, but the project uses SDK `1.30.1`. |

The `0.49.1` instrumentation packages internally depend on `@opentelemetry/core@1.22.0`, while the project installs `@opentelemetry/core@1.30.1` at the top level. This results in **two different instances** of core OTel modules in `node_modules`, which can cause:
- Broken span context propagation (spans may not link correctly)
- Silent data loss in traces
- Subtle, hard-to-debug observability gaps

The correct experimental version matching SDK `1.30.1` is **`0.57.2`**.

**Recommendation (immediate):** Align to the last 1.x-compatible set:

```
@opentelemetry/core: 1.30.1
@opentelemetry/exporter-trace-otlp-http: 0.57.2
@opentelemetry/instrumentation: 0.57.2
@opentelemetry/instrumentation-http: 0.57.2
@opentelemetry/instrumentation-fastify: 0.44.2
@opentelemetry/instrumentation-ioredis: 0.47.1
@opentelemetry/instrumentation-pg: 0.51.1
@opentelemetry/resources: 1.30.1
@opentelemetry/sdk-trace-base: 1.30.1
@opentelemetry/sdk-trace-node: 1.30.1
```

**Recommendation (follow-up):** Plan upgrade to SDK 2.x before March 2026 when 1.x reaches end of support. Note: `@opentelemetry/instrumentation-fastify` is deprecated -- replace with `@fastify/otel` during the 2.x upgrade.

### 1.3 MODERATE: Deprecated transitive dependencies with known issues

The lockfile contains these deprecated transitive packages:

| Package | Locked version | Issue | Pulled in by |
|---|---|---|---|
| `glob` | 7.2.3 | Deprecated; old versions have publicized security vulnerabilities | jest, rimraf, rollup-plugin-commonjs, test-exclude |
| `inflight` | (transitive) | Memory leak; unmaintained | glob 7.x |
| `rimraf` | (old) | Versions < 4 unsupported | jest toolchain |
| `node-domexception` | (transitive) | Deprecated; use native DOMException | node-fetch |

These are all transitive (not direct) and are mostly pulled in by the Jest toolchain. They don't represent exploitable attack surface but add dependency hygiene risk.

---

## 2. Deprecated and Unmaintained Packages

### 2.1 HIGH: ESLint 8.57.1 -- End of Life

| | |
|---|---|
| **EOL date** | October 5, 2024 (16+ months ago) |
| **Latest stable** | ESLint 9.39.2 |
| **Lockfile status** | Marked as deprecated |
| **Blocker** | `@typescript-eslint/*@7.18.0` does not support ESLint 9; must upgrade to `@typescript-eslint@8.x` simultaneously |

ESLint 8 receives **no bug fixes, security updates, or new features**. The lockfile explicitly marks it deprecated.

**Recommendation:** Upgrade to ESLint 9.x + `@typescript-eslint@8.x`. Migrate `.eslintrc.cjs` / `.eslintrc.security.cjs` to flat config (`eslint.config.js`). Use `npx @eslint/migrate-config .eslintrc.cjs` as a starting point. Verify that `eslint-plugin-jsx-a11y` and `eslint-plugin-security` support flat config in their installed versions.

### 2.2 HIGH: `@opentelemetry/instrumentation-fastify@0.33.0` -- Deprecated

Publishing stopped June 30, 2025. Ownership transferred to the Fastify team as `@fastify/otel`. Must migrate during the OpenTelemetry 2.x upgrade (see section 1.2).

### 2.3 MODERATE: `node-fetch@3.3.2` -- Effectively Abandoned

| | |
|---|---|
| **Last published** | July 2023 (2.5+ years ago) |
| **Needed?** | **No** -- Node.js 20+ has native `fetch()` |
| **Usage** | 32 source files across the codebase |
| **Pulls in deprecated transitive** | `node-domexception` |

**Recommendation:** Remove `node-fetch`. Replace all `import fetch from 'node-fetch'` with the global `fetch()` (no import needed). Two files import the `Response` type -- switch to the native `Response` type. Test HTTP behavior after migration (minor stream handling differences possible).

### 2.4 LOW: `form-data@4.0.5` -- Unnecessary on Node.js 20+

| | |
|---|---|
| **Needed?** | **No** -- Node.js 20+ has native `FormData` |
| **Usage** | 3 source files (OpenAI image adapter, Stability image adapter, SoundCloud adapter) |
| **Maintenance** | 113 open issues, community calls for deprecation, had a critical vulnerability patched in 4.0.4 |

**Recommendation:** Remove `form-data`. Replace with the native `FormData` global. Use `fs.openAsBlob()` for file uploads.

### 2.5 INFO: Other deprecated transitives in lockfile

| Package | Note |
|---|---|
| `@humanwhocodes/config-array` | Use `@eslint/config-array` -- resolved by ESLint 9 upgrade |
| `@humanwhocodes/object-schema` | Use `@eslint/object-schema` -- resolved by ESLint 9 upgrade |
| `acorn-import-assertions` | Renamed to `acorn-import-attributes` |
| `sourcemap-codec` | Use `@jridgewell/sourcemap-codec` |
| `whatwg-encoding` | Use `@exodus/bytes` |

These are all transitive and will resolve when their parent packages are updated.

---

## 3. Significantly Outdated Dependencies (2+ Major Versions Behind)

| Package | Current | Latest | Gap | Notes |
|---|---|---|---|---|
| **`stripe`** | 14.25.0 | 20.3.1 | **6 major** | No CVEs, but v14 receives no patches. Each major pins a Stripe API version. v18 restructures billing/checkout. |
| **`googleapis`** | 133.0.0 | 171.4.0 | **38 major** | Auto-generated; ~1.6 majors/month. Only matters for the specific Google APIs you use. Not a real "38 versions behind" in practice. |
| **`p-limit`** | 5.0.0 | 7.3.0 | 2 major | Pure ESM. Check for breaking API changes before upgrading. |
| `@tiptap/react` | 2.27.2 | 3.19.0 | 1 major | Tiptap 3 is a significant rewrite. |
| `@tiptap/starter-kit` | 2.27.2 | 3.19.0 | 1 major | Upgrade together with `@tiptap/react`. |
| `@google-analytics/data` | 4.12.1 | 5.2.1 | 1 major | Google-maintained; likely auto-generated API changes. |
| `lru-cache` | 10.4.3 | 11.2.6 | 1 major | |
| `next` | 15.5.10 | 16.1.6 | 1 major | Next.js 16 just released. No urgency. |
| `react` / `react-dom` | 18.3.1 | 19.2.4 | 1 major | React 19 requires ecosystem-wide migration. |
| `nodemailer` | 7.0.13 | 8.0.1 | 1 major | Minor breaking change (`'NoAuth'` to `'ENOAUTH'` error code). |

**Recommendations:**
- **`stripe`**: Plan incremental upgrade through each major version. Follow Stripe's migration guides (v15 through v20). No security urgency but v14 is unsupported.
- **`googleapis`**: Consider migrating to individual `@googleapis/*` sub-packages (e.g., `@googleapis/sheets`) for stable versioning. Or bump to latest and test your specific API surfaces.
- **`p-limit`**: Straightforward upgrade; test imports.
- **`react`/`next`**: No urgency on React 19 or Next.js 16. These are large ecosystem shifts -- upgrade when the ecosystem is ready.

---

## 4. Duplicate/Overlapping Dependencies

### 4.1 Email sending: `nodemailer` + `@aws-sdk/client-ses`

**Not actually redundant.** The codebase uses a multi-provider email adapter pattern:
- `nodemailer` is used only for the SMTP provider path
- `@aws-sdk/client-ses` is used only for the SES provider path (direct API, not through nodemailer's SES transport)

Both are dynamically imported. No action needed, but consider migrating to `@aws-sdk/client-sesv2` (SES v2 API) for newer features.

### 4.2 HTTP fetching: `node-fetch` + native `fetch()`

**Redundant.** `node-fetch` is unnecessary given `"node": ">=20.0.0"`. See section 2.3.

### 4.3 Form data: `form-data` + native `FormData`

**Redundant.** See section 2.4.

### 4.4 No other duplicates found

No duplicate HTTP clients (axios, got, superagent), date libraries, or validation libraries detected. `zod` is the sole validation library. `ioredis` is the sole Redis client. `pg` is the sole PostgreSQL driver. Clean.

---

## 5. Vendored and Pinned Dependencies

### 5.1 All 70 direct dependencies are exact-pinned

Every dependency in `package.json` uses exact versions (no `^` or `~` prefixes). This is **intentional and good practice** for reproducible builds, but requires active maintenance to receive security patches.

**Risk:** If a CVE is published against a transitive dependency, `npm audit fix` may not resolve it if the direct dependency's exact pin prevents the transitive from floating to a patched version. The lockfile must be actively regenerated.

**Recommendation:** Set up automated dependency update tooling (Dependabot, Renovate, or Socket) to get PRs for security patches. Exact pinning is fine, but requires proactive monitoring.

### 5.2 `crypto-js@4.2.0` locked in lockfile

As noted in section 1.1, `crypto-js` is discontinued. The lockfile pins 4.2.0 (patched for CVE-2023-46233) but no future patches are possible. This is the strongest argument for replacing `fernet`.

### 5.3 `jsdom@28.1.0` -- Healthy

The lockfile resolves `jsdom` at 28.1.0, which is current and does not have the XSS bypass vulnerabilities present in jsdom < 20.0.0. `isomorphic-dompurify` is safe with this version.

---

## Prioritized Action Items

| # | Priority | Action | Effort |
|---|---|---|---|
| 1 | **Critical** | Replace `fernet` -- eliminate `crypto-js` dependency. Use Node.js built-in `crypto` module. | Small |
| 2 | **High** | Fix OpenTelemetry version mismatch -- align experimental packages to `0.57.2` matching SDK `1.30.1`. | Small |
| 3 | **High** | Upgrade ESLint 8 to 9 + `@typescript-eslint` 7 to 8. Migrate to flat config. | Medium |
| 4 | **High** | Plan OpenTelemetry 2.x upgrade (1.x EOL ~March 2026). Replace `instrumentation-fastify` with `@fastify/otel`. | Medium |
| 5 | **Medium** | Remove `node-fetch` -- use native `fetch()`. 32 files to update. | Small-Medium |
| 6 | **Medium** | Remove `form-data` -- use native `FormData`. 3 files to update. | Small |
| 7 | **Medium** | Upgrade `stripe` 14 to 20 incrementally. | Medium-Large |
| 8 | **Low** | Upgrade `googleapis` or migrate to individual `@googleapis/*` sub-packages. | Medium |
| 9 | **Low** | Upgrade `p-limit` 5 to 7, `nodemailer` 7 to 8. | Small |
| 10 | **Low** | Set up automated dependency monitoring (Dependabot/Renovate). | Small |
