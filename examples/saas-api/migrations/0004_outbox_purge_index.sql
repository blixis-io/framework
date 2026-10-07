-- Lets the relay delete delivered rows past their retention without scanning the table: only rows that were delivered are
-- in the index, so it is small while most of the table is still waiting, and it is what `order by processed_at` walks.
create index outbox_processed on saas.outbox (processed_at) where processed_at is not null;
