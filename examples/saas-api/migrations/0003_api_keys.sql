-- API keys: machine credentials, each bound to ONE space. Only a SHA-256 of the secret is stored (the secret is 32 random
-- bytes: there is nothing to guess, so a slow hash would only cost every request). Revoking sets `revoked_at`; the row
-- stays for the audit trail.
create table saas.api_keys (
  id text primary key,
  secret_hash text not null,
  name text not null,
  organization_id uuid not null,
  space_id uuid not null references saas.spaces (id),
  created_by uuid not null references saas.users (id),
  scopes text[] not null default '{}',
  allowed_cidrs text[] not null default '{}',
  expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);

create index api_keys_space on saas.api_keys (space_id, created_at);
