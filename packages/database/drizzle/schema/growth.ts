/**
 * SmartBeak Phase 2D — Growth & Marketing schema extension
 * Adds waitlist_entries and referrals tables.
 * These are ADDITIVE — the locked smartbeak.ts is not modified.
 */

import {
  boolean,
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

// ─── Enums ────────────────────────────────────────────────────────────────────

export const waitlistStatusEnum = pgEnum("waitlist_status", [
  "pending",
  "approved",
  "rejected",
  "converted",
]);

export const referralStatusEnum = pgEnum("referral_status", [
  "pending",
  "completed",
  "rewarded",
  "expired",
]);

// ─── waitlist_entries ─────────────────────────────────────────────────────────

export const waitlistEntries = pgTable(
  "waitlist_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull().unique(),
    referralCode: text("referral_code").notNull().unique(),
    referredBy: text("referred_by"), // referral_code of the referrer
    status: waitlistStatusEnum("status").notNull().default("pending"),
    position: text("position"), // queue position (stored as text to allow "VIP" labels)
    firstName: text("first_name"),
    lastName: text("last_name"),
    company: text("company"),
    useCase: text("use_case"),
    metadata: text("metadata"), // JSON string for extra fields
    joinedAt: timestamp("joined_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    convertedAt: timestamp("converted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("waitlist_entries_email_idx").on(t.email),
    index("waitlist_entries_referral_code_idx").on(t.referralCode),
    index("waitlist_entries_referred_by_idx").on(t.referredBy),
    index("waitlist_entries_status_idx").on(t.status),
    index("waitlist_entries_joined_at_idx").on(t.joinedAt),
  ],
);

// ─── referrals ────────────────────────────────────────────────────────────────

export const referrals = pgTable(
  "referrals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    referrerId: text("referrer_id").notNull(), // waitlist_entries.id or user id
    referredUserId: text("referred_user_id"), // null until the referred user converts
    referredEmail: text("referred_email").notNull(),
    referralCode: text("referral_code").notNull(),
    status: referralStatusEnum("status").notNull().default("pending"),
    rewardGranted: boolean("reward_granted").notNull().default(false),
    rewardType: text("reward_type"), // "credits" | "extra_domain" | "plan_upgrade"
    rewardValue: text("reward_value"), // e.g. "500" credits or "1" domain
    rewardGrantedAt: timestamp("reward_granted_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("referrals_referrer_id_idx").on(t.referrerId),
    index("referrals_referred_user_id_idx").on(t.referredUserId),
    index("referrals_referral_code_idx").on(t.referralCode),
    index("referrals_status_idx").on(t.status),
    index("referrals_reward_granted_idx").on(t.rewardGranted),
  ],
);
