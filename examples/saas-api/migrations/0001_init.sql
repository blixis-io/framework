-- Everything lives in its own schema, so this example can share a database with other things.
create schema if not exists saas;

create table saas.users (
  id uuid primary key,
  email text not null unique,
  password_hash text not null,
  created_at timestamptz not null default now()
);

create table saas.organizations (
  id uuid primary key,
  name text not null,
  created_at timestamptz not null default now()
);

create table saas.spaces (
  id uuid primary key,
  organization_id uuid not null references saas.organizations (id),
  name text not null,
  created_at timestamptz not null default now()
);

-- Who may act in which space. A user can belong to several; the role is per space.
create table saas.memberships (
  user_id uuid not null references saas.users (id),
  space_id uuid not null references saas.spaces (id),
  organization_id uuid not null references saas.organizations (id),
  role text not null check (role in ('owner', 'member')),
  primary key (user_id, space_id)
);

-- A tenant-scoped table: every row says which space and organization it belongs to. The unique key on
-- (id, space_id) is what lets a child table point at a project *and* prove it is in the same space.
create table saas.projects (
  id uuid primary key,
  title text not null,
  organization_id uuid not null,
  space_id uuid not null references saas.spaces (id),
  created_at timestamptz not null default now(),
  unique (id, space_id)
);

-- A child of a tenant-scoped table. The composite foreign key means the database itself refuses a task whose
-- project is in another space, even if application code forgot to check.
create table saas.tasks (
  id uuid primary key,
  project_id uuid not null,
  title text not null,
  done boolean not null default false,
  organization_id uuid not null,
  space_id uuid not null,
  created_at timestamptz not null default now(),
  foreign key (project_id, space_id) references saas.projects (id, space_id) on delete cascade
);

create table saas.refresh_tokens (
  token_hash text primary key,
  subject text not null,
  family_id uuid not null,
  expires_at timestamptz not null,
  rotated_at timestamptz,
  revoked_at timestamptz
);
create index refresh_tokens_subject on saas.refresh_tokens (subject);
create index refresh_tokens_family on saas.refresh_tokens (family_id);

-- Shared by every replica, so one rate limit holds across them.
create table saas.rate_limits (
  key text primary key,
  count integer not null,
  reset_at timestamptz not null
);
