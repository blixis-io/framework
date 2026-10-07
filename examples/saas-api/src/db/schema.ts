import { tenantColumns } from "@blixis-io/tenancy";
import { boolean, integer, jsonb, pgSchema, text, timestamp, uuid } from "drizzle-orm/pg-core";

/** Mirrors `migrations/0001_init.sql`. The migrations are the source of truth; this is how the code queries them. */
export const saas = pgSchema("saas");

export const users = saas.table("users", {
  id: uuid("id").primaryKey(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const organizations = saas.table("organizations", {
  id: uuid("id").primaryKey(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const spaces = saas.table("spaces", {
  id: uuid("id").primaryKey(),
  organizationId: uuid("organization_id").notNull(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const memberships = saas.table("memberships", {
  userId: uuid("user_id").notNull(),
  spaceId: uuid("space_id").notNull(),
  organizationId: uuid("organization_id").notNull(),
  role: text("role").notNull(),
});

export const projects = saas.table("projects", {
  id: uuid("id").primaryKey(),
  title: text("title").notNull(),
  ...tenantColumns(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const tasks = saas.table("tasks", {
  id: uuid("id").primaryKey(),
  projectId: uuid("project_id").notNull(),
  title: text("title").notNull(),
  done: boolean("done").notNull().default(false),
  ...tenantColumns(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const refreshTokens = saas.table("refresh_tokens", {
  tokenHash: text("token_hash").primaryKey(),
  subject: text("subject").notNull(),
  familyId: uuid("family_id").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  rotatedAt: timestamp("rotated_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
});

export const rateLimits = saas.table("rate_limits", {
  key: text("key").primaryKey(),
  count: integer("count").notNull(),
  resetAt: timestamp("reset_at", { withTimezone: true }).notNull(),
});

export const outbox = saas.table("outbox", {
  id: uuid("id").primaryKey(),
  topic: text("topic").notNull(),
  payload: jsonb("payload").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  availableAt: timestamp("available_at", { withTimezone: true }).notNull().defaultNow(),
  attempts: integer("attempts").notNull().default(0),
  lastError: text("last_error"),
  processedAt: timestamp("processed_at", { withTimezone: true }),
  failedAt: timestamp("failed_at", { withTimezone: true }),
});

export const activity = saas.table("activity", {
  id: uuid("id").primaryKey(),
  eventId: uuid("event_id").notNull().unique(),
  organizationId: uuid("organization_id").notNull(),
  spaceId: uuid("space_id").notNull(),
  message: text("message").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const apiKeys = saas.table("api_keys", {
  id: text("id").primaryKey(),
  secretHash: text("secret_hash").notNull(),
  name: text("name").notNull(),
  organizationId: uuid("organization_id").notNull(),
  spaceId: uuid("space_id").notNull(),
  createdBy: uuid("created_by").notNull(),
  scopes: text("scopes").array().notNull().default([]),
  allowedCidrs: text("allowed_cidrs").array().notNull().default([]),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
});

export const schema = { users, organizations, spaces, memberships, projects, tasks, refreshTokens, rateLimits, outbox, activity, apiKeys };
