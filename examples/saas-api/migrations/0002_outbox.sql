-- The transactional outbox: an event is a row, written in the same transaction as the change it describes, so a crash can
-- never keep one and lose the other. A relay (src/outbox/outbox-relay.ts) delivers the rows afterwards, at least once.
create table saas.outbox (
  id uuid primary key,
  topic text not null,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  -- A failed delivery moves this into the future (backoff); the relay only claims rows that are due.
  available_at timestamptz not null default now(),
  attempts integer not null default 0,
  last_error text,
  processed_at timestamptz,
  -- Set after too many attempts: the row stays for a human, and is never retried.
  failed_at timestamptz
);

-- The relay's query: only rows still waiting. Delivered rows are not in the index, so it stays small however big the table grows.
create index outbox_due on saas.outbox (available_at) where processed_at is null and failed_at is null;

-- What the example consumer produces: one activity line per project created. `event_id` is unique, which is what makes
-- the consumer idempotent: delivering the same event twice writes one line.
create table saas.activity (
  id uuid primary key,
  event_id uuid not null unique,
  organization_id uuid not null,
  space_id uuid not null references saas.spaces (id),
  message text not null,
  created_at timestamptz not null default now()
);
create index activity_space on saas.activity (space_id, created_at);
