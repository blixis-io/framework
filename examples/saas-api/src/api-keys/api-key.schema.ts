import { parseCidr } from "@blixis-io/security";
import { z } from "zod";
import { API_KEY_SCOPES } from "../auth/auth.js";

/** A network the key may be used from; a typo is a 400 now, not a key that silently matches nothing. */
const Network = z.string().refine(
  (value) => {
    try {
      parseCidr(value);
      return true;
    } catch {
      return false;
    }
  },
  { message: "not a valid network, such as 203.0.113.0/24 or 2001:db8::/32" },
);

export const CreateApiKeySchema = z.object({
  name: z.string().min(1).max(100),
  scopes: z.array(z.enum(API_KEY_SCOPES)).min(1).max(API_KEY_SCOPES.length),
  /** Empty means from anywhere. Only as trustworthy as `TRUSTED_PROXY_HOPS`. */
  allowedCidrs: z.array(Network).max(20).default([]),
  expiresInDays: z.number().int().min(1).max(365).optional(),
});
export type CreateApiKeyInput = z.infer<typeof CreateApiKeySchema>;

export const ApiKeySummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  scopes: z.array(z.string()),
  allowedCidrs: z.array(z.string()),
  expiresAt: z.date().nullable(),
  revokedAt: z.date().nullable(),
  lastUsedAt: z.date().nullable(),
  createdAt: z.date(),
});
export const ApiKeyListSchema = z.array(ApiKeySummarySchema);

/** The only response that ever contains the key. */
export const CreatedApiKeySchema = z.object({
  id: z.string(),
  key: z.string(),
  name: z.string(),
  scopes: z.array(z.string()),
  allowedCidrs: z.array(z.string()),
  expiresAt: z.date().nullable(),
});
