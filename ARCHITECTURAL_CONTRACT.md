# Architectural Contract

These rules govern how SmartBeak is structured. Every new feature, domain, and integration must respect them. If a change would violate a rule, the rule must be amended first through an ADR (see `docs/adr/`).

## Rules at a Glance

- Control plane orchestrates; domains own data.
- One database per domain.
- Domain = unit of deletion/export.
- Plugins are internal, capability-limited.
- Events are versioned contracts.
- Plugins isolated; failures do not block domains.

---

## 1. Control Plane Orchestrates; Domains Own Data

The control plane (`control-plane/`) handles cross-cutting concerns: authentication, billing, domain registry, queue orchestration, and API routing. It does not own domain-specific entities like content items or publishing jobs.

Domains (`domains/`) own their entities, repositories, business rules, and events. Each domain has its own `application/`, `domain/`, and `infra/` layers.

**How this is enforced:**

- The Fastify API server (`control-plane/api/http.ts`) registers all HTTP routes and runs auth middleware, but delegates domain operations to domain services and handlers.
- The `AuthContext` type (`control-plane/services/auth.ts`) carries `userId`, `orgId`, and `roles`. The control plane validates the JWT and constructs this context; domain code receives it as an already-validated parameter and never validates tokens directly.
- Domain code has no dependency on Fastify, HTTP, or auth libraries. It depends only on its own port interfaces and shared `packages/` types.

## 2. One Database Per Domain

Each domain has its own set of database tables, managed through domain-scoped migrations. This achieves data isolation per bounded context and supports future per-domain database routing.

**How this is enforced:**

- All SQL migrations live in `migrations/sql/` with prefixed naming: `cp_` for control-plane tables, `dom_` for domain tables, `infra_` for infrastructure, `pkg_` for package-level. This makes ownership clear at the file system level.
- Per-domain database connection strings are supported via `.env` configuration (see `.env.example`):
  ```
  DOMAIN_CONTENT_DB=postgresql://...
  DOMAIN_MEDIA_DB=postgresql://...
  DOMAIN_SEARCH_DB=postgresql://...
  ```
- Domain repository implementations accept an optional `PoolClient` parameter on every method, enabling caller-managed transactions and per-domain database routing. See `domains/content/application/ports/ContentRepository.ts` for the canonical example.

## 3. Domain = Unit of Deletion/Export

When a domain (tenant site) is deleted or exported, the operation boundary is the domain itself. All content, media, notifications, and other data scoped to that domain can be cleanly removed or exported without affecting other domains.

**How this is enforced:**

- Every domain entity is scoped by `domainId`. Repository interfaces require `domainId` for list and count operations (e.g., `listByDomain(domainId)`, `countByDomain(domainId)` in `ContentRepository`).
- The `DomainEventEnvelope` (`packages/types/domain-event.ts`) carries `meta.domainId`, ensuring events propagate their domain scope to all consumers.
- Domain archive and transfer operations exist at the API level (`apps/web/pages/api/domains/archive.ts`, `apps/web/pages/api/domains/transfer.ts`).

## 4. Plugins Are Internal, Capability-Limited

Plugins are not arbitrary third-party extensions. They are internal modules that declare a manifest of capabilities they require. The set of capability types is a closed union.

**How this is enforced:**

- The `PluginCapability` type (`packages/types/plugin-capabilities.ts`) is a discriminated union with exactly five variants: `analytics`, `publishing`, `notification`, `storage`, and `custom`.
- The `PluginManifest` interface (same file) requires `id`, `name`, `version`, declared `capabilities`, and an `enabled` flag.
- Capability interfaces expose narrow APIs. For example, `AnalyticsCapability` exposes only `recordMetric(name, value)` and `PublishingCapability` exposes only `enqueuePublishJob(contentId)`. Plugins cannot access the database pool, raw HTTP requests, or other system internals.

## 5. Events Are Versioned Contracts

Domain events are the communication mechanism between bounded contexts. Each event has a name and an explicit integer version, making them a stable, evolvable contract between producer and consumer.

**How this is enforced:**

- The `DomainEventEnvelope<TPayload>` type (`packages/types/domain-event.ts`) defines the envelope shape:
  ```typescript
  interface DomainEventEnvelope<TPayload> {
    name: string;        // e.g. "content.published"
    version: number;     // integer, e.g. 1
    occurredAt: string;  // ISO 8601 timestamp
    payload: TPayload;   // typed event-specific data
    meta: {
      correlationId: string;   // ties related events together
      domainId: string;        // owning domain
      source: 'control-plane' | 'domain';
    };
  }
  ```
- Event definitions live in `packages/types/events/` with versioned constants (e.g., `CONTENT_PUBLISHED_V1 = { name: 'content.published', version: 1 }`). Adding a new version means creating a new constant and payload type, not modifying the existing one.
- Domain event classes (e.g., `domains/content/domain/events/ContentPublished.ts`) produce envelopes using these versioned constants.

## 6. Plugin Isolation; Failures Do Not Block Domains

When the EventBus publishes an event, all subscribed handlers run concurrently. A failing handler does not prevent other handlers from executing. The circuit breaker protects against cascading failures but only trips when all handlers fail.

**How this is enforced:**

- `EventBus.publish` (`packages/kernel/event-bus.ts`) uses `Promise.allSettled` to run all handlers concurrently. Individual rejections are logged but do not propagate to other handlers.
- Each handler is wrapped in `runSafely` (`packages/kernel/safe-handler.ts`), which provides per-handler retry (3 attempts), timeout (60s), and error categorization.
- The circuit breaker (failure threshold: 10, reset timeout: 30s, half-open max calls: 5) trips only when ALL handlers for an event fail. Partial failures keep the circuit closed.
- Maximum 50 handlers per event to prevent memory leaks. Exceeding this throws an error at subscription time, not at publish time.
- Duplicate subscription prevention: the same plugin cannot subscribe to the same event twice (second attempt is a no-op with a warning).

---

## Appendix A: Domain Internal Structure

Every domain follows a consistent layered layout:

```
domains/{name}/
  application/           # Use cases and orchestration
    handlers/            # Command/query handlers (e.g., CreateDraft)
    ports/               # Repository and adapter interfaces
    {Name}Service.ts     # Application service
  domain/                # Core business logic (no infrastructure deps)
    entities/            # Domain entities (e.g., ContentItem)
    events/              # Domain event classes
    *.test.ts            # Domain unit tests
  infra/                 # Infrastructure implementations
    persistence/         # PostgreSQL repository implementations
  db/migrations/         # Domain-specific SQL migrations
```

Current domains: activity, authors, content, customers, diligence, domains, media, notifications, planning, publishing, search, seo, shared.

The `domain/` layer has no imports from `infra/` or any infrastructure library. It depends only on language primitives and shared `packages/types`. The `application/` layer depends on port interfaces, never on concrete infrastructure. The `infra/` layer implements the port interfaces using PostgreSQL, Redis, or external APIs.

## Appendix B: Event Envelope Format

| Field | Type | Description |
|-------|------|-------------|
| `name` | `string` | Dot-separated event identifier (e.g., `content.published`) |
| `version` | `number` | Integer schema version for backward compatibility |
| `occurredAt` | `string` | ISO 8601 timestamp of when the event occurred |
| `payload` | `TPayload` | Generic typed payload specific to the event |
| `meta.correlationId` | `string` | Ties related events together across domains |
| `meta.domainId` | `string` | The domain that emitted the event |
| `meta.source` | `'control-plane' \| 'domain'` | Which layer emitted the event |

Consumers should always check `version` before processing an event payload to handle schema evolution gracefully.

## Appendix C: Repository/Port Pattern

Domain logic depends on port interfaces, not on database implementations. This enables testing with fakes and swapping infrastructure.

- **Ports** live in `domains/{name}/application/ports/`. They are pure TypeScript interfaces with no infrastructure imports.
- **Implementations** live in `domains/{name}/infra/persistence/`. They use PostgreSQL via `pg` and Knex.
- All repository methods accept an optional `PoolClient` parameter. When provided, the operation participates in the caller's transaction. When omitted, the implementation uses the shared connection pool.

Example from `ContentRepository` (`domains/content/application/ports/ContentRepository.ts`):

```typescript
interface ContentRepository {
  getById(id: string, client?: PoolClient): Promise<ContentItem | null>;
  save(item: ContentItem, client?: PoolClient): Promise<void>;
  listByStatus(status: ContentStatus, limit: number, offset: number,
               domainId?: string, orgId?: string, client?: PoolClient): Promise<(ContentItem | null)[]>;
  listByDomain(domainId: string, limit?: number, offset?: number, client?: PoolClient): Promise<(ContentItem | null)[]>;
  delete(id: string, client?: PoolClient): Promise<number>;
  countByDomain(domainId: string, client?: PoolClient): Promise<number>;
}
```

---

## Related Documentation

- [System Architecture](docs/architecture/system-architecture.md) - high-level diagrams and component details
- [Data Flow](docs/architecture/data-flow.md) - how data moves between components
- [Integration Points](docs/architecture/integration-points.md) - external and internal integrations
- [ADRs](docs/adr/) - architecture decision records
