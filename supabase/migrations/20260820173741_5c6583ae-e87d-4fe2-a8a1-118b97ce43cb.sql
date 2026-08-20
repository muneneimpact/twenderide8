-- ============ Twende Ride: core identity, roles, fleets, vehicles, documents, zones, settings ============

create type public.app_role as enum ('customer','driver','fleet_owner','ops_admin','finance_admin','super_admin');
create type public.approval_state as enum ('pending','approved','rejected','restricted');
create type public.vehicle_class as enum ('economy','comfort','xl');

create or replace function public.update_updated_at_column()
returns trigger language plpgsql set search_path = public as $$
begin new.updated_at = now(); return new; end $$;

-- profiles
create table public.profiles (
  id uuid primary key references auth.users on delete cascade,
  phone text unique,
  full_name text,
  email text,
  avatar_url text,
  locale text not null default 'en-KE',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
grant select, insert, update on public.profiles to authenticated;
grant all on public.profiles to service_role;
alter table public.profiles enable row level security;

create table public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  role public.app_role not null,
  granted_by uuid,
  created_at timestamptz not null default now(),
  unique (user_id, role)
);
grant select on public.user_roles to authenticated;
grant all on public.user_roles to service_role;
alter table public.user_roles enable row level security;

create or replace function public.has_role(_user_id uuid, _role public.app_role)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.user_roles where user_id = _user_id and role = _role)
$$;

create or replace function public.is_staff(_user_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.user_roles where user_id = _user_id
    and role in ('ops_admin','finance_admin','super_admin'))
$$;

create policy "profiles_self_select" on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_staff(auth.uid()));
create policy "profiles_self_insert" on public.profiles for insert to authenticated
  with check (id = auth.uid());
create policy "profiles_self_update" on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

create policy "user_roles_self_select" on public.user_roles for select to authenticated
  using (user_id = auth.uid() or public.is_staff(auth.uid()));

-- new users get a profile + customer role
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, phone, full_name, email)
  values (new.id, new.phone, new.raw_user_meta_data->>'full_name', new.email)
  on conflict (id) do nothing;
  insert into public.user_roles (user_id, role) values (new.id, 'customer')
  on conflict do nothing;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- fleets
create table public.fleets (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users on delete restrict,
  business_name text not null,
  registration_number text,
  contact_phone text,
  contact_email text,
  status public.approval_state not null default 'pending',
  settlement_mode text not null default 'fleet_wallet',
  driver_split_percent numeric(6,3) not null default 0,
  cash_commission_liability text not null default 'driver',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fleets_split_range check (driver_split_percent >= 0 and driver_split_percent <= 100),
  constraint fleets_settlement_mode check (settlement_mode in ('driver_wallet','fleet_wallet','split')),
  constraint fleets_cash_liability check (cash_commission_liability in ('driver','fleet'))
);
grant select, insert, update on public.fleets to authenticated;
grant all on public.fleets to service_role;
alter table public.fleets enable row level security;

create table public.fleet_memberships (
  id uuid primary key default gen_random_uuid(),
  fleet_id uuid not null references public.fleets on delete cascade,
  driver_id uuid not null references auth.users on delete cascade,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  unique (fleet_id, driver_id)
);
grant select, insert, update, delete on public.fleet_memberships to authenticated;
grant all on public.fleet_memberships to service_role;
alter table public.fleet_memberships enable row level security;

create or replace function public.owns_fleet(_user_id uuid, _fleet_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.fleets where id = _fleet_id and owner_id = _user_id)
$$;
create or replace function public.in_fleet(_user_id uuid, _fleet_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.fleet_memberships
    where fleet_id = _fleet_id and driver_id = _user_id and status = 'active')
$$;

create policy "fleets_read" on public.fleets for select to authenticated
  using (owner_id = auth.uid() or public.is_staff(auth.uid()) or public.in_fleet(auth.uid(), id));
create policy "fleets_insert_own" on public.fleets for insert to authenticated
  with check (owner_id = auth.uid());
create policy "fleets_update_own" on public.fleets for update to authenticated
  using (owner_id = auth.uid() and status <> 'restricted') with check (owner_id = auth.uid());

create policy "fleet_memberships_read" on public.fleet_memberships for select to authenticated
  using (driver_id = auth.uid() or public.owns_fleet(auth.uid(), fleet_id) or public.is_staff(auth.uid()));
create policy "fleet_memberships_owner_write" on public.fleet_memberships for insert to authenticated
  with check (public.owns_fleet(auth.uid(), fleet_id));
create policy "fleet_memberships_owner_update" on public.fleet_memberships for update to authenticated
  using (public.owns_fleet(auth.uid(), fleet_id)) with check (public.owns_fleet(auth.uid(), fleet_id));
create policy "fleet_memberships_owner_delete" on public.fleet_memberships for delete to authenticated
  using (public.owns_fleet(auth.uid(), fleet_id));

-- vehicles
create table public.vehicles (
  id uuid primary key default gen_random_uuid(),
  fleet_id uuid references public.fleets on delete set null,
  owner_driver_id uuid references auth.users on delete set null,
  plate_number text not null unique,
  make text,
  model text,
  colour text,
  year int,
  vehicle_class public.vehicle_class not null default 'economy',
  status public.approval_state not null default 'pending',
  active_driver_id uuid references auth.users on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint vehicles_ownership check (fleet_id is not null or owner_driver_id is not null)
);
create unique index vehicles_one_active_driver on public.vehicles (active_driver_id)
  where active_driver_id is not null;
grant select, insert, update on public.vehicles to authenticated;
grant all on public.vehicles to service_role;
alter table public.vehicles enable row level security;

create table public.driver_vehicle_authorisations (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references public.vehicles on delete cascade,
  driver_id uuid not null references auth.users on delete cascade,
  granted_by uuid,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  unique (vehicle_id, driver_id)
);
grant select, insert, update, delete on public.driver_vehicle_authorisations to authenticated;
grant all on public.driver_vehicle_authorisations to service_role;
alter table public.driver_vehicle_authorisations enable row level security;

create or replace function public.owns_vehicle(_user_id uuid, _vehicle_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.vehicles v
    left join public.fleets f on f.id = v.fleet_id
    where v.id = _vehicle_id and (v.owner_driver_id = _user_id or f.owner_id = _user_id))
$$;
create or replace function public.may_drive_vehicle(_user_id uuid, _vehicle_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.driver_vehicle_authorisations a
    join public.vehicles v on v.id = a.vehicle_id
    where a.vehicle_id = _vehicle_id and a.driver_id = _user_id
      and a.revoked_at is null and v.status = 'approved')
$$;

create policy "vehicles_read" on public.vehicles for select to authenticated
  using (owner_driver_id = auth.uid() or public.is_staff(auth.uid())
    or (fleet_id is not null and (public.owns_fleet(auth.uid(), fleet_id) or public.in_fleet(auth.uid(), fleet_id))));
create policy "vehicles_insert" on public.vehicles for insert to authenticated
  with check (owner_driver_id = auth.uid() or (fleet_id is not null and public.owns_fleet(auth.uid(), fleet_id)));
create policy "vehicles_update_owner" on public.vehicles for update to authenticated
  using (owner_driver_id = auth.uid() or (fleet_id is not null and public.owns_fleet(auth.uid(), fleet_id)))
  with check (owner_driver_id = auth.uid() or (fleet_id is not null and public.owns_fleet(auth.uid(), fleet_id)));

create policy "dva_read" on public.driver_vehicle_authorisations for select to authenticated
  using (driver_id = auth.uid() or public.owns_vehicle(auth.uid(), vehicle_id) or public.is_staff(auth.uid()));
create policy "dva_insert" on public.driver_vehicle_authorisations for insert to authenticated
  with check (public.owns_vehicle(auth.uid(), vehicle_id));
create policy "dva_update" on public.driver_vehicle_authorisations for update to authenticated
  using (public.owns_vehicle(auth.uid(), vehicle_id)) with check (public.owns_vehicle(auth.uid(), vehicle_id));
create policy "dva_delete" on public.driver_vehicle_authorisations for delete to authenticated
  using (public.owns_vehicle(auth.uid(), vehicle_id));

-- driver profiles / availability
create table public.drivers (
  id uuid primary key references auth.users on delete cascade,
  status public.approval_state not null default 'pending',
  is_online boolean not null default false,
  active_vehicle_id uuid references public.vehicles on delete set null,
  rating numeric(3,2) not null default 5.00,
  completed_rides int not null default 0,
  last_lat numeric(9,6),
  last_lng numeric(9,6),
  last_accuracy_m numeric(8,2),
  last_location_at timestamptz,
  cash_jobs_blocked boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
grant select, insert, update on public.drivers to authenticated;
grant all on public.drivers to service_role;
alter table public.drivers enable row level security;

create policy "drivers_self_read" on public.drivers for select to authenticated
  using (id = auth.uid() or public.is_staff(auth.uid())
    or exists (select 1 from public.fleet_memberships m where m.driver_id = drivers.id
               and public.owns_fleet(auth.uid(), m.fleet_id)));
create policy "drivers_self_insert" on public.drivers for insert to authenticated
  with check (id = auth.uid());
create policy "drivers_self_update" on public.drivers for update to authenticated
  using (id = auth.uid() and status = 'approved') with check (id = auth.uid());

-- configurable documents
create table public.document_types (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  label text not null,
  applies_to text not null,
  required boolean not null default true,
  expires boolean not null default true,
  reminder_days int not null default 14,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint document_types_applies_to check (applies_to in ('driver','fleet','vehicle','customer'))
);
grant select on public.document_types to authenticated;
grant all on public.document_types to service_role;
alter table public.document_types enable row level security;
create policy "document_types_read" on public.document_types for select to authenticated using (active or public.is_staff(auth.uid()));

create table public.documents (
  id uuid primary key default gen_random_uuid(),
  document_type_id uuid not null references public.document_types on delete restrict,
  subject_user_id uuid references auth.users on delete cascade,
  subject_fleet_id uuid references public.fleets on delete cascade,
  subject_vehicle_id uuid references public.vehicles on delete cascade,
  file_path text,
  reference text,
  issued_on date,
  expires_on date,
  status public.approval_state not null default 'pending',
  rejection_reason text,
  reviewed_by uuid,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
grant select, insert, update on public.documents to authenticated;
grant all on public.documents to service_role;
alter table public.documents enable row level security;
create policy "documents_read" on public.documents for select to authenticated
  using (subject_user_id = auth.uid() or public.is_staff(auth.uid())
    or (subject_fleet_id is not null and public.owns_fleet(auth.uid(), subject_fleet_id))
    or (subject_vehicle_id is not null and public.owns_vehicle(auth.uid(), subject_vehicle_id)));
create policy "documents_insert" on public.documents for insert to authenticated
  with check (subject_user_id = auth.uid()
    or (subject_fleet_id is not null and public.owns_fleet(auth.uid(), subject_fleet_id))
    or (subject_vehicle_id is not null and public.owns_vehicle(auth.uid(), subject_vehicle_id)));

-- service zones
create table public.service_zones (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  centre_lat numeric(9,6) not null,
  centre_lng numeric(9,6) not null,
  radius_km numeric(8,3) not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
grant select on public.service_zones to authenticated;
grant all on public.service_zones to service_role;
alter table public.service_zones enable row level security;
create policy "service_zones_read" on public.service_zones for select to authenticated using (true);

-- saved places
create table public.saved_places (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  label text not null,
  address text,
  lat numeric(9,6) not null,
  lng numeric(9,6) not null,
  notes text,
  created_at timestamptz not null default now()
);
grant select, insert, update, delete on public.saved_places to authenticated;
grant all on public.saved_places to service_role;
alter table public.saved_places enable row level security;
create policy "saved_places_own" on public.saved_places for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- system settings + feature flags + audit log
create table public.system_settings (
  key text primary key,
  value jsonb not null,
  description text,
  updated_by uuid,
  updated_at timestamptz not null default now()
);
grant select on public.system_settings to authenticated;
grant all on public.system_settings to service_role;
alter table public.system_settings enable row level security;
create policy "system_settings_read" on public.system_settings for select to authenticated using (true);

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid,
  actor_role text,
  action text not null,
  entity_type text,
  entity_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
grant select on public.audit_logs to authenticated;
grant all on public.audit_logs to service_role;
alter table public.audit_logs enable row level security;
create policy "audit_logs_staff_read" on public.audit_logs for select to authenticated
  using (public.is_staff(auth.uid()));

create trigger t_profiles_updated before update on public.profiles for each row execute function public.update_updated_at_column();
create trigger t_fleets_updated before update on public.fleets for each row execute function public.update_updated_at_column();
create trigger t_vehicles_updated before update on public.vehicles for each row execute function public.update_updated_at_column();
create trigger t_drivers_updated before update on public.drivers for each row execute function public.update_updated_at_column();
create trigger t_documents_updated before update on public.documents for each row execute function public.update_updated_at_column();

-- seed reference data
insert into public.service_zones (name, centre_lat, centre_lng, radius_km) values
  ('Meru Town', 0.047000, 37.650000, 15),
  ('Makutano / Meru Greater', 0.075000, 37.630000, 25);

insert into public.document_types (code, label, applies_to, required, expires) values
  ('national_id','National ID','driver',true,false),
  ('driving_licence','Driving Licence','driver',true,true),
  ('psv_badge','PSV Badge','driver',true,true),
  ('vehicle_inspection','Vehicle Inspection Certificate','vehicle',true,true),
  ('vehicle_insurance','Vehicle Insurance','vehicle',true,true),
  ('business_permit','Business Permit','fleet',true,true);

insert into public.system_settings (key, value, description) values
  ('payment_grace_seconds','120','Seconds an assignment is held awaiting digital payment'),
  ('quote_validity_seconds','300','Seconds an accepted quote stays valid'),
  ('offer_timeout_seconds','25','Seconds a driver offer stays live'),
  ('dispatch_radius_km','8','Maximum driver search radius'),
  ('wallet_overdraft_limit','-2000','Driver wallet overdraft floor in KES'),
  ('wallet_overdraft_warning','-500','Driver wallet warning threshold in KES'),
  ('allowed_settlement_modes','["driver_wallet","fleet_wallet","split"]','Settlement modes the super admin permits'),
  ('withdrawal_min','500','Minimum withdrawal in KES'),
  ('withdrawal_max','100000','Maximum withdrawal in KES'),
  ('withdrawal_fee','25','Flat withdrawal fee in KES'),
  ('location_retention_days','30','Days precise trip breadcrumbs are retained'),
  ('providers_ready','{"payment":false,"sms":false,"email":false,"weather":false}','Production provider readiness gates'),
  ('rain_modifier_active','false','Manual rain modifier switch');