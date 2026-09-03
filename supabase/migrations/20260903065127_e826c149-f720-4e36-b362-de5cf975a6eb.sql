create table if not exists public.push_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  token text not null unique,
  device_label text,
  user_agent text,
  platform text not null default 'web',
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

grant select, insert, update, delete on public.push_tokens to authenticated;
grant all on public.push_tokens to service_role;

alter table public.push_tokens enable row level security;

create policy "Users manage their own push tokens"
  on public.push_tokens for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create index if not exists push_tokens_user_idx on public.push_tokens(user_id);

-- Push channel rows already live in notification_outbox; make dedupe keys unique
-- so the same event can never be pushed twice.
create unique index if not exists notification_outbox_dedupe_uidx
  on public.notification_outbox(dedupe_key) where dedupe_key is not null;