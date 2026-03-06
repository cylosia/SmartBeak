// Supastarter Pro base schema (auth, org, billing primitives)

// Phase 3B — Advanced AI Agents additive schema extension
export * from "./ai-agents";
// Phase 3A — Enterprise Readiness & Scaling additive schema extension
export * from "./enterprise";

// Phase 2D — Growth & Marketing additive schema extension
export * from "./growth";
export * from "./postgres";
// SmartBeak v9 — LOCKED FINAL SCHEMA (single source of truth)
// Do NOT modify any table, column, type, relationship, index, trigger,
// materialized view, or RLS policy defined in this file.
export * from "./smartbeak";
