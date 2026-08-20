-- ============ Twende Ride: pricing, rides, dispatch, payments, wallets, notifications ============

create type public.ride_status as enum (
  'quote_accepted','searching','no_driver_found','driver_assigned','driver_arriving',
  'driver_arrived','trip_started','trip_completed','cancelled_by_customer',
  'cancelled_by_driver','cancelled_by_system','expired');
create type public.payment_method as enum ('stk_push','cash');
create type public.payment_status as enum (
  'not_required','pending','initiating','awaiting_confirmation','processing','paid',
  'failed','cancelled','timed_out','refund_pending','refunded');
create type public.ledger_entry_type as enum (
  'ride_earning','platform_commission','cash_commission_debit','top_up','withdrawal_hold',
  'withdrawal_success','withdrawal_reversal','refund','bonus','penalty','manual_adjustment');
create type public.withdrawal_status as enum (
  'pending','under_review','approved','processing','paid','failed','reversed','rejected');
create type public.policy_state as enum ('draft','scheduled','published','paused','archived');

-- ---------- pricing configuration ----------
create table public.fare_configs (
  id uuid primary key default gen_random_uuid(),
  version int not null,
  vehicle_class public.vehicle_class not null default 'economy',
  zone_id uuid references public.service_zones on delete set null,
  base_fare numeric(12,2) not null default 0,
  per_km numeric(12,2) not null default 0,
  per_minute numeric(12,2) not null default 0,
  minimum_fare numeric(12,2) not null default 0,
  booking_fee numeric(12,2) not null default 0,
  waiting_per_minute numeric(12,2) not null default 0,
  free_waiting_minutes int not null default 3,
  cancellation_fee numeric(12,2) not null default 0,
  cancellation_free_seconds int not null default 120,
  commission_percent numeric(6,3) not null default 15,
  rounding_rule text not null default 'nearest_10',
  modifier_combination text not null default 'additive',
  max_surcharge_percent numeric(6,3) not null default 60,
  state public.policy_state not null default 'published',
  effective_from timestamptz not null default now(),
  effective_to timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  unique (version, vehicle_class),
  constraint fare_configs_rounding check (rounding_rule in ('none','nearest_1','nearest_5','nearest_10')),
  constraint fare_configs_combination check (modifier_combination in ('additive','compounded')),
  constraint fare_configs_commission check (commission_percent >= 0 and commission_percent < 100)
);
grant select on public.fare_configs to authenticated;
grant all on public.fare_configs to service_role;
alter table public.fare_configs enable row level security;
create policy "fare_configs_read" on public.fare_configs for select to authenticated using (true);

create table public.pricing_modifiers (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  customer_label text not null,
  explanation text,
  percent numeric(6,3) not null,
  applies_to_base text not null default 'distance_time',
  window_start time,
  window_end time,
  zone_id uuid references public.service_zones on delete set null,
  vehicle_class public.vehicle_class,
  activation text not null default 'schedule',
  active boolean not null default true,
  state public.policy_state not null default 'published',
  created_at timestamptz not null default now(),
  constraint pricing_modifiers_percent check (percent > -100 and percent < 100),
  constraint pricing_modifiers_activation check (activation in ('schedule','manual','zone','provider')),
  constraint pricing_modifiers_base check (applies_to_base in ('distance_time','distance','subtotal'))
);
grant select on public.pricing_modifiers to authenticated;
grant all on public.pricing_modifiers to service_role;
alter table public.pricing_modifiers enable row level security;
create policy "pricing_modifiers_read" on public.pricing_modifiers for select to authenticated using (true);

create table public.distance_policies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  version int not null,
  state public.policy_state not null default 'draft',
  max_total_reduction_percent numeric(6,3) not null default 45,
  vehicle_class public.vehicle_class,
  zone_id uuid references public.service_zones on delete set null,
  effective_from timestamptz,
  effective_to timestamptz,
  admin_notes text,
  published_at timestamptz,
  published_by uuid,
  created_at timestamptz not null default now(),
  unique (name, version)
);
grant select on public.distance_policies to authenticated;
grant all on public.distance_policies to service_role;
alter table public.distance_policies enable row level security;
create policy "distance_policies_read" on public.distance_policies for select to authenticated
  using (state = 'published' or public.is_staff(auth.uid()));

create table public.distance_bands (
  id uuid primary key default gen_random_uuid(),
  policy_id uuid not null references public.distance_policies on delete cascade,
  sort_order int not null,
  admin_label text not null,
  customer_explanation text,
  lower_km numeric(8,3) not null,
  upper_km numeric(8,3),
  start_reduction_percent numeric(6,3) not null default 0,
  end_reduction_percent numeric(6,3) not null default 0,
  mode text not null default 'linear',
  created_at timestamptz not null default now(),
  unique (policy_id, sort_order),
  constraint distance_bands_mode check (mode in ('linear','fixed')),
  constraint distance_bands_order check (upper_km is null or upper_km > lower_km),
  constraint distance_bands_lower check (lower_km >= 0),
  constraint distance_bands_reduction_range check (
    start_reduction_percent >= 0 and start_reduction_percent < 100
    and end_reduction_percent >= 0 and end_reduction_percent < 100),
  constraint distance_bands_open_ended_fixed check (upper_km is not null or mode = 'fixed')
);
grant select on public.distance_bands to authenticated;
grant all on public.distance_bands to service_role;
alter table public.distance_bands enable row level security;
create policy "distance_bands_read" on public.distance_bands for select to authenticated
  using (exists (select 1 from public.distance_policies p where p.id = policy_id
    and (p.state = 'published' or public.is_staff(auth.uid()))));

-- ---------- quotes ----------
create table public.route_quotes (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references auth.users on delete cascade,
  vehicle_class public.vehicle_class not null default 'economy',
  pickup_lat numeric(9,6) not null,
  pickup_lng numeric(9,6) not null,
  pickup_address text,
  pickup_notes text,
  dropoff_lat numeric(9,6) not null,
  dropoff_lng numeric(9,6) not null,
  dropoff_address text,
  distance_km numeric(8,3) not null,
  duration_minutes numeric(8,2) not null,
  route_provider text not null default 'osrm',
  route_response jsonb not null default '{}'::jsonb,
  polyline text,
  breakdown jsonb not null,
  unrounded_total numeric(14,4) not null,
  total_fare numeric(12,2) not null,
  currency text not null default 'KES',
  fare_config_id uuid references public.fare_configs on delete set null,
  distance_policy_id uuid references public.distance_policies on delete set null,
  pricing_snapshot jsonb not null,
  expires_at timestamptz not null,
  accepted_at timestamptz,
  created_at timestamptz not null default now()
);
grant select on public.route_quotes to authenticated;
grant all on public.route_quotes to service_role;
alter table public.route_quotes enable row level security;
create policy "route_quotes_owner_read" on public.route_quotes for select to authenticated
  using (customer_id = auth.uid() or public.is_staff(auth.uid()));

-- ---------- rides ----------
create table public.rides (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique default ('TR-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,8))),
  customer_id uuid not null references auth.users on delete restrict,
  quote_id uuid not null references public.route_quotes on delete restrict,
  driver_id uuid references auth.users on delete set null,
  vehicle_id uuid references public.vehicles on delete set null,
  fleet_id uuid references public.fleets on delete set null,
  status public.ride_status not null default 'searching',
  payment_method public.payment_method not null,
  payment_status public.payment_status not null default 'pending',
  idempotency_key text not null unique,
  fare_snapshot jsonb not null,
  total_fare numeric(12,2) not null,
  commission_percent numeric(6,3) not null,
  commission_amount numeric(12,2) not null,
  settlement_snapshot jsonb not null default '{}'::jsonb,
  cancellation_policy_snapshot jsonb not null default '{}'::jsonb,
  cancellation_reason text,
  cancellation_fee numeric(12,2) not null default 0,
  cancelled_by text,
  assignment_expires_at timestamptz,
  ledger_posted_at timestamptz,
  requested_at timestamptz not null default now(),
  assigned_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz not null default now()
);
create index rides_customer_idx on public.rides (customer_id, requested_at desc);
create index rides_driver_idx on public.rides (driver_id, requested_at desc);
create index rides_status_idx on public.rides (status);
create unique index rides_one_active_per_driver on public.rides (driver_id)
  where driver_id is not null and status in ('driver_assigned','driver_arriving','driver_arrived','trip_started');
grant select on public.rides to authenticated;
grant all on public.rides to service_role;
alter table public.rides enable row level security;

create or replace function public.can_view_ride(_user_id uuid, _ride_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.rides r
    left join public.fleets f on f.id = r.fleet_id
    where r.id = _ride_id
      and (r.customer_id = _user_id or r.driver_id = _user_id or f.owner_id = _user_id))
$$;
revoke execute on function public.can_view_ride(uuid, uuid) from anon, public;
grant execute on function public.can_view_ride(uuid, uuid) to authenticated;

create policy "rides_participants_read" on public.rides for select to authenticated
  using (customer_id = auth.uid() or driver_id = auth.uid() or public.is_staff(auth.uid())
    or (fleet_id is not null and public.owns_fleet(auth.uid(), fleet_id)));

create table public.driver_offers (
  id uuid primary key default gen_random_uuid(),
  ride_id uuid not null references public.rides on delete cascade,
  driver_id uuid not null references auth.users on delete cascade,
  vehicle_id uuid references public.vehicles on delete set null,
  status text not null default 'offered',
  distance_km numeric(8,3),
  eta_minutes numeric(8,2),
  expires_at timestamptz not null,
  responded_at timestamptz,
  created_at timestamptz not null default now(),
  unique (ride_id, driver_id),
  constraint driver_offers_status check (status in ('offered','accepted','declined','expired','superseded'))
);
create index driver_offers_driver_idx on public.driver_offers (driver_id, status);
grant select on public.driver_offers to authenticated;
grant all on public.driver_offers to service_role;
alter table public.driver_offers enable row level security;
create policy "driver_offers_read" on public.driver_offers for select to authenticated
  using (driver_id = auth.uid() or public.is_staff(auth.uid()) or public.can_view_ride(auth.uid(), ride_id));

create table public.ride_status_events (
  id uuid primary key default gen_random_uuid(),
  ride_id uuid not null references public.rides on delete cascade,
  status public.ride_status not null,
  actor_id uuid,
  actor_role text,
  note text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index ride_status_events_ride_idx on public.ride_status_events (ride_id, created_at);
grant select on public.ride_status_events to authenticated;
grant all on public.ride_status_events to service_role;
alter table public.ride_status_events enable row level security;
create policy "ride_status_events_read" on public.ride_status_events for select to authenticated
  using (public.can_view_ride(auth.uid(), ride_id) or public.is_staff(auth.uid()));

create table public.ride_locations (
  id bigserial primary key,
  ride_id uuid not null references public.rides on delete cascade,
  driver_id uuid not null references auth.users on delete cascade,
  lat numeric(9,6) not null,
  lng numeric(9,6) not null,
  accuracy_m numeric(8,2),
  heading numeric(6,2),
  speed_kph numeric(6,2),
  eta_minutes numeric(8,2),
  recorded_at timestamptz not null default now(),
  purge_after timestamptz
);
create index ride_locations_ride_idx on public.ride_locations (ride_id, recorded_at desc);
grant select on public.ride_locations to authenticated;
grant all on public.ride_locations to service_role;
alter table public.ride_locations enable row level security;
create policy "ride_locations_participants_read" on public.ride_locations for select to authenticated
  using (public.can_view_ride(auth.uid(), ride_id) or public.is_staff(auth.uid()));

-- ---------- payments ----------
create table public.payment_intents (
  id uuid primary key default gen_random_uuid(),
  ride_id uuid not null references public.rides on delete cascade,
  customer_id uuid not null references auth.users on delete restrict,
  provider text not null default 'unconfigured',
  method public.payment_method not null,
  amount numeric(12,2) not null,
  currency text not null default 'KES',
  msisdn text,
  status public.payment_status not null default 'pending',
  idempotency_key text not null unique,
  provider_reference text,
  provider_request jsonb not null default '{}'::jsonb,
  provider_response jsonb not null default '{}'::jsonb,
  failure_reason text,
  mode text not null default 'test',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payment_intents_mode check (mode in ('test','live')),
  constraint payment_intents_amount check (amount >= 0)
);
create index payment_intents_ride_idx on public.payment_intents (ride_id);
grant select on public.payment_intents to authenticated;
grant all on public.payment_intents to service_role;
alter table public.payment_intents enable row level security;
create policy "payment_intents_read" on public.payment_intents for select to authenticated
  using (customer_id = auth.uid() or public.is_staff(auth.uid()));

create table public.payment_events (
  id uuid primary key default gen_random_uuid(),
  payment_intent_id uuid references public.payment_intents on delete cascade,
  provider text not null,
  event_type text not null,
  provider_reference text,
  dedupe_key text not null unique,
  verified boolean not null default false,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
grant all on public.payment_events to service_role;
alter table public.payment_events enable row level security;

create table public.refunds (
  id uuid primary key default gen_random_uuid(),
  ride_id uuid not null references public.rides on delete cascade,
  payment_intent_id uuid references public.payment_intents on delete set null,
  amount numeric(12,2) not null,
  reason text,
  status text not null default 'pending',
  idempotency_key text not null unique,
  approved_by uuid,
  provider_reference text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint refunds_status check (status in ('pending','approved','processing','completed','failed','rejected'))
);
grant select on public.refunds to authenticated;
grant all on public.refunds to service_role;
alter table public.refunds enable row level security;
create policy "refunds_read" on public.refunds for select to authenticated
  using (public.can_view_ride(auth.uid(), ride_id) or public.is_staff(auth.uid()));

-- ---------- wallets ----------
create table public.wallets (
  id uuid primary key default gen_random_uuid(),
  owner_kind text not null,
  driver_id uuid references auth.users on delete cascade,
  fleet_id uuid references public.fleets on delete cascade,
  currency text not null default 'KES',
  cached_balance numeric(14,2) not null default 0,
  held_amount numeric(14,2) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint wallets_owner_kind check (owner_kind in ('driver','fleet','platform')),
  constraint wallets_owner_ref check (
    (owner_kind = 'driver' and driver_id is not null and fleet_id is null)
    or (owner_kind = 'fleet' and fleet_id is not null and driver_id is null)
    or (owner_kind = 'platform' and driver_id is null and fleet_id is null))
);
create unique index wallets_driver_unique on public.wallets (driver_id) where driver_id is not null;
create unique index wallets_fleet_unique on public.wallets (fleet_id) where fleet_id is not null;
create unique index wallets_platform_unique on public.wallets ((owner_kind)) where owner_kind = 'platform';
grant select on public.wallets to authenticated;
grant all on public.wallets to service_role;
alter table public.wallets enable row level security;
create policy "wallets_read" on public.wallets for select to authenticated
  using (driver_id = auth.uid() or (fleet_id is not null and public.owns_fleet(auth.uid(), fleet_id))
    or public.is_staff(auth.uid()));

create table public.wallet_ledger (
  id uuid primary key default gen_random_uuid(),
  wallet_id uuid not null references public.wallets on delete restrict,
  entry_type public.ledger_entry_type not null,
  amount numeric(14,2) not null,
  currency text not null default 'KES',
  ride_id uuid references public.rides on delete set null,
  payment_intent_id uuid references public.payment_intents on delete set null,
  withdrawal_id uuid,
  idempotency_key text not null unique,
  actor_id uuid,
  source text not null default 'system',
  reason text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index wallet_ledger_wallet_idx on public.wallet_ledger (wallet_id, created_at desc);
grant select on public.wallet_ledger to authenticated;
grant all on public.wallet_ledger to service_role;
alter table public.wallet_ledger enable row level security;
create policy "wallet_ledger_read" on public.wallet_ledger for select to authenticated
  using (exists (select 1 from public.wallets w where w.id = wallet_id
    and (w.driver_id = auth.uid() or (w.fleet_id is not null and public.owns_fleet(auth.uid(), w.fleet_id))
      or public.is_staff(auth.uid()))));

-- ledger is immutable
create or replace function public.block_ledger_mutation()
returns trigger language plpgsql set search_path = public as $$
begin
  raise exception 'wallet_ledger entries are immutable; post a reversing entry instead';
end $$;
revoke execute on function public.block_ledger_mutation() from anon, authenticated, public;
create trigger wallet_ledger_no_update before update on public.wallet_ledger
  for each row execute function public.block_ledger_mutation();
create trigger wallet_ledger_no_delete before delete on public.wallet_ledger
  for each row execute function public.block_ledger_mutation();

-- transactional cached balance derived from ledger
create or replace function public.sync_wallet_balance()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.wallets w
    set cached_balance = (select coalesce(sum(amount),0) from public.wallet_ledger l where l.wallet_id = w.id),
        held_amount = (select coalesce(-sum(amount),0) from public.wallet_ledger l
                        where l.wallet_id = w.id and l.entry_type = 'withdrawal_hold'
                        and not exists (select 1 from public.wallet_ledger s
                          where s.wallet_id = l.wallet_id and s.withdrawal_id = l.withdrawal_id
                          and s.entry_type in ('withdrawal_success','withdrawal_reversal'))),
        updated_at = now()
  where w.id = new.wallet_id;
  return new;
end $$;
revoke execute on function public.sync_wallet_balance() from anon, authenticated, public;
create trigger wallet_ledger_sync after insert on public.wallet_ledger
  for each row execute function public.sync_wallet_balance();

create table public.withdrawals (
  id uuid primary key default gen_random_uuid(),
  wallet_id uuid not null references public.wallets on delete restrict,
  requested_by uuid not null references auth.users on delete restrict,
  amount numeric(12,2) not null,
  fee numeric(12,2) not null default 0,
  destination text,
  status public.withdrawal_status not null default 'pending',
  idempotency_key text not null unique,
  reviewed_by uuid,
  review_note text,
  provider_reference text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint withdrawals_amount check (amount > 0)
);
grant select on public.withdrawals to authenticated;
grant all on public.withdrawals to service_role;
alter table public.withdrawals enable row level security;
create policy "withdrawals_read" on public.withdrawals for select to authenticated
  using (requested_by = auth.uid() or public.is_staff(auth.uid())
    or exists (select 1 from public.wallets w where w.id = wallet_id
      and w.fleet_id is not null and public.owns_fleet(auth.uid(), w.fleet_id)));

create table public.withdrawal_events (
  id uuid primary key default gen_random_uuid(),
  withdrawal_id uuid not null references public.withdrawals on delete cascade,
  status public.withdrawal_status not null,
  actor_id uuid,
  note text,
  created_at timestamptz not null default now()
);
grant select on public.withdrawal_events to authenticated;
grant all on public.withdrawal_events to service_role;
alter table public.withdrawal_events enable row level security;
create policy "withdrawal_events_read" on public.withdrawal_events for select to authenticated
  using (exists (select 1 from public.withdrawals w where w.id = withdrawal_id
    and (w.requested_by = auth.uid() or public.is_staff(auth.uid()))));

-- ---------- notifications, ratings, incidents ----------
create table public.notification_preferences (
  user_id uuid primary key references auth.users on delete cascade,
  push_enabled boolean not null default false,
  sms_enabled boolean not null default true,
  email_enabled boolean not null default true,
  push_permission text not null default 'default',
  updated_at timestamptz not null default now()
);
grant select, insert, update on public.notification_preferences to authenticated;
grant all on public.notification_preferences to service_role;
alter table public.notification_preferences enable row level security;
create policy "notification_preferences_own" on public.notification_preferences for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create table public.push_devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  endpoint text not null unique,
  keys jsonb not null default '{}'::jsonb,
  user_agent text,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
grant select, insert, update, delete on public.push_devices to authenticated;
grant all on public.push_devices to service_role;
alter table public.push_devices enable row level security;
create policy "push_devices_own" on public.push_devices for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create table public.notification_outbox (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users on delete cascade,
  channel text not null,
  template_code text not null,
  title text,
  body text not null,
  payload jsonb not null default '{}'::jsonb,
  ride_id uuid references public.rides on delete set null,
  status text not null default 'queued',
  provider_ready boolean not null default false,
  attempts int not null default 0,
  last_error text,
  dedupe_key text unique,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  read_at timestamptz,
  constraint notification_outbox_channel check (channel in ('in_app','push','sms','email')),
  constraint notification_outbox_status check (status in ('queued','sent','failed','blocked_provider_gate','read'))
);
create index notification_outbox_user_idx on public.notification_outbox (user_id, created_at desc);
grant select, update on public.notification_outbox to authenticated;
grant all on public.notification_outbox to service_role;
alter table public.notification_outbox enable row level security;
create policy "notification_outbox_own_read" on public.notification_outbox for select to authenticated
  using (user_id = auth.uid() or public.is_staff(auth.uid()));
create policy "notification_outbox_own_update" on public.notification_outbox for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create table public.ratings (
  id uuid primary key default gen_random_uuid(),
  ride_id uuid not null references public.rides on delete cascade,
  rater_id uuid not null references auth.users on delete cascade,
  ratee_id uuid not null references auth.users on delete cascade,
  score int not null,
  comment text,
  created_at timestamptz not null default now(),
  unique (ride_id, rater_id),
  constraint ratings_score check (score between 1 and 5)
);
grant select, insert on public.ratings to authenticated;
grant all on public.ratings to service_role;
alter table public.ratings enable row level security;
create policy "ratings_read" on public.ratings for select to authenticated
  using (rater_id = auth.uid() or ratee_id = auth.uid() or public.is_staff(auth.uid()));
create policy "ratings_insert_own" on public.ratings for insert to authenticated
  with check (rater_id = auth.uid() and public.can_view_ride(auth.uid(), ride_id));

create table public.incidents (
  id uuid primary key default gen_random_uuid(),
  ride_id uuid references public.rides on delete set null,
  reporter_id uuid not null references auth.users on delete cascade,
  category text not null,
  description text not null,
  status text not null default 'open',
  assigned_to uuid,
  resolution text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint incidents_status check (status in ('open','in_progress','resolved','closed'))
);
grant select, insert on public.incidents to authenticated;
grant all on public.incidents to service_role;
alter table public.incidents enable row level security;
create policy "incidents_read" on public.incidents for select to authenticated
  using (reporter_id = auth.uid() or public.is_staff(auth.uid()));
create policy "incidents_insert_own" on public.incidents for insert to authenticated
  with check (reporter_id = auth.uid());

-- ---------- atomic dispatch acceptance ----------
create or replace function public.accept_ride_offer(_ride_id uuid, _driver_id uuid, _vehicle_id uuid, _grace_seconds int)
returns public.rides language plpgsql security definer set search_path = public as $$
declare r public.rides; v public.vehicles;
begin
  if not public.may_drive_vehicle(_driver_id, _vehicle_id) then
    raise exception 'driver is not authorised to operate this vehicle';
  end if;

  select * into v from public.vehicles where id = _vehicle_id for update;
  if v.active_driver_id is not null and v.active_driver_id <> _driver_id then
    raise exception 'vehicle is already active for another driver';
  end if;

  select * into r from public.rides where id = _ride_id for update;
  if r.id is null then raise exception 'ride not found'; end if;
  if r.status <> 'searching' then raise exception 'ride is no longer available'; end if;

  if not exists (select 1 from public.driver_offers o where o.ride_id = _ride_id
                 and o.driver_id = _driver_id and o.status = 'offered' and o.expires_at > now()) then
    raise exception 'no live offer for this driver';
  end if;

  update public.vehicles set active_driver_id = _driver_id where id = _vehicle_id;

  update public.rides set
    driver_id = _driver_id,
    vehicle_id = _vehicle_id,
    fleet_id = v.fleet_id,
    status = 'driver_assigned',
    assigned_at = now(),
    assignment_expires_at = case when payment_method = 'stk_push'
      then now() + make_interval(secs => _grace_seconds) else null end,
    updated_at = now()
  where id = _ride_id returning * into r;

  update public.driver_offers set status = 'accepted', responded_at = now()
    where ride_id = _ride_id and driver_id = _driver_id;
  update public.driver_offers set status = 'superseded', responded_at = now()
    where ride_id = _ride_id and driver_id <> _driver_id and status = 'offered';

  insert into public.ride_status_events (ride_id, status, actor_id, actor_role)
    values (_ride_id, 'driver_assigned', _driver_id, 'driver');
  return r;
end $$;
revoke execute on function public.accept_ride_offer(uuid, uuid, uuid, int) from anon, authenticated, public;

-- ---------- wallet helpers ----------
create or replace function public.ensure_driver_wallet(_driver_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare wid uuid;
begin
  select id into wid from public.wallets where driver_id = _driver_id;
  if wid is null then
    insert into public.wallets (owner_kind, driver_id) values ('driver', _driver_id) returning id into wid;
  end if;
  return wid;
end $$;
revoke execute on function public.ensure_driver_wallet(uuid) from anon, authenticated, public;

create or replace function public.ensure_fleet_wallet(_fleet_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare wid uuid;
begin
  select id into wid from public.wallets where fleet_id = _fleet_id;
  if wid is null then
    insert into public.wallets (owner_kind, fleet_id) values ('fleet', _fleet_id) returning id into wid;
  end if;
  return wid;
end $$;
revoke execute on function public.ensure_fleet_wallet(uuid) from anon, authenticated, public;

create or replace function public.available_balance(_wallet_id uuid)
returns numeric language sql stable security definer set search_path = public as $$
  select coalesce(cached_balance,0) from public.wallets where id = _wallet_id
$$;
revoke execute on function public.available_balance(uuid) from anon, public;
grant execute on function public.available_balance(uuid) to authenticated;

create trigger t_rides_updated before update on public.rides for each row execute function public.update_updated_at_column();
create trigger t_payment_intents_updated before update on public.payment_intents for each row execute function public.update_updated_at_column();
create trigger t_withdrawals_updated before update on public.withdrawals for each row execute function public.update_updated_at_column();
create trigger t_refunds_updated before update on public.refunds for each row execute function public.update_updated_at_column();
create trigger t_wallets_updated before update on public.wallets for each row execute function public.update_updated_at_column();

-- realtime
alter table public.rides replica identity full;
alter table public.driver_offers replica identity full;
alter table public.ride_locations replica identity full;
alter table public.ride_status_events replica identity full;
alter publication supabase_realtime add table public.rides;
alter publication supabase_realtime add table public.driver_offers;
alter publication supabase_realtime add table public.ride_locations;
alter publication supabase_realtime add table public.ride_status_events;
alter publication supabase_realtime add table public.notification_outbox;

-- ---------- seed pricing ----------
insert into public.fare_configs (version, vehicle_class, base_fare, per_km, per_minute, minimum_fare, booking_fee,
  waiting_per_minute, cancellation_fee, cancellation_free_seconds, commission_percent, rounding_rule, modifier_combination)
values (1,'economy',0,78,0,150,0,8,100,120,15,'nearest_10','additive'),
       (1,'comfort',50,95,2,250,0,10,150,120,17,'nearest_10','additive'),
       (1,'xl',80,120,3,350,0,12,200,120,18,'nearest_10','additive');

insert into public.pricing_modifiers (code, customer_label, explanation, percent, window_start, window_end, activation)
values ('night','Night rate','Applies between 22:00 and 05:00 Africa/Nairobi',10.5,'22:00','05:00','schedule'),
       ('rain','Rain rate','Enabled manually by operations during heavy rain',5.2,null,null,'manual');

with p as (
  insert into public.distance_policies (name, version, state, max_total_reduction_percent, published_at, admin_notes)
  values ('Meru progressive distance reduction', 1, 'published', 45, now(),
          'Progressive marginal bands: only kilometres inside a band receive that band reduction.')
  returning id)
insert into public.distance_bands (policy_id, sort_order, admin_label, customer_explanation, lower_km, upper_km,
  start_reduction_percent, end_reduction_percent, mode)
select p.id, b.sort_order, b.admin_label, b.customer_explanation, b.lower_km, b.upper_km, b.s, b.e, b.mode
from p, (values
  (1,'0-7 km standard','Standard rate for the first 7 km',0::numeric,7::numeric,0::numeric,0::numeric,'linear'),
  (2,'7-10 km reduction','Kilometres above 7 km start at 20% off and reach 30% off at 10 km',7,10,20,30,'linear'),
  (3,'10-20 km reduction','Kilometres above 10 km continue from 30% off up to 40% off at 20 km',10,20,30,40,'linear'),
  (4,'Above 20 km','Every kilometre beyond 20 km is 45% off',20,null,45,45,'fixed')
) as b(sort_order, admin_label, customer_explanation, lower_km, upper_km, s, e, mode);