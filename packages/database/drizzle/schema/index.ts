// Supastarter Pro base schema (auth, org, billing primitives)
export * from "./postgres";

// SmartBeak v9 — LOCKED FINAL SCHEMA (single source of truth)
// Do NOT modify any table, column, type, relationship, index, trigger,
// materialized view, or RLS policy defined in this file.
export * from "./smartbeak";

// Phase 2D — Growth & Marketing additive schema extension
export * from "./growth";
