-- Promotions / promo codes.
-- Admins create offers with an explicit maximum discount, so a code can never
-- reduce a fare beyond a configured cap. Customers validate a code against a
-- live quote; the server is the only authority that applies the discount.

create table if not exists public.promotions (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  description text,
  -- The headline discount this offer advertises (percent of the fare).
  discount_percent numeric(5,2) not null default 0
    check (discount_percent >= 0 and discount_percent <= 100),
  -- Hard ceiling for this offer: the actual discount applied can never exceed
  -- max_discount_percent, even when discount_percent is larger.
  max_discount_percent numeric(5,2) not null default 100
    check (max_discount_percent >= 0 and max_discount_percent <= 100),
  -- Optional absolute cap on the discount amount in KES.
  max_discount_amount numeric(10,2)
    check (max_discount_amount is null or max_discount_amount >= 0),
  -- The fare must be at least this much for the code to apply.
  min_fare numeric(10,2)
    check (min_fare is null or min_fare >= 0),
  valid_from timestamptz not null default now(),
  valid_until timestamptz,
  usage_limit integer
    check (usage_limit is null or usage_limit > 0),
  usage_count integer not null default 0
    check (usage_count >= 0),
  -- Optional restriction to specific vehicle classes (boda, economy, comfort, xl).
  applies_to text[] not null default '{}',
  active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Promote immutable-ish updates: keep updated_at fresh.
create or replace function public.touch_promotion()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists promotions_touch_updated_at on public.promotions;
create trigger promotions_touch_updated_at
  before update on public.promotions
  for each row execute function public.touch_promotion();

alter table public.promotions enable row level security;

-- Customers must be able to read active, in-window promotions so they can
-- validate a code before booking. Admin writes go through service-role server
-- functions which bypass RLS.
create policy "read active promotions"
  on public.promotions
  for select
  to authenticated
  using (active = true);
