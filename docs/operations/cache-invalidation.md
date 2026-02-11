
# Cache Invalidation Strategy

Caches are intentionally short-lived (seconds).
Invalidation rules:

- Analytics cache invalidated on content.published
- Publishing status cache invalidated on job state change
- Domain allowance cache invalidated on domain create/delete

No cache is relied on for correctness.
