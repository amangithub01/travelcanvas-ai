begin;

create table public.travel_trips (
  owner_id uuid not null references auth.users(id) on delete cascade,
  plan_id text not null check (length(plan_id) between 1 and 100),
  plan jsonb not null,
  title text generated always as (plan->>'title') stored,
  revision integer not null default 1,
  updated_at timestamptz not null default now(),
  primary key (owner_id, plan_id),
  check ((jsonb_typeof(plan) = 'object' and plan->>'id' = plan_id
    and plan->>'version' = '2' and length(plan->>'title') between 1 and 200
    and octet_length(plan::text) <= 2000000) is true)
);

create function public.stamp_travel_trip() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.revision := 1;
  else
    new.revision := old.revision + 1;
  end if;
  new.updated_at := now();
  return new;
end;
$$;
create trigger travel_trip_revision before insert or update on public.travel_trips
for each row execute function public.stamp_travel_trip();

alter table public.travel_trips enable row level security;
revoke all on public.travel_trips from public, anon, authenticated;
grant select, delete on public.travel_trips to authenticated;
grant insert (owner_id, plan_id, plan) on public.travel_trips to authenticated;
grant update (plan) on public.travel_trips to authenticated;
create policy trip_read on public.travel_trips for select to authenticated
using ((select auth.uid()) = owner_id);
create policy trip_insert on public.travel_trips for insert to authenticated
with check ((select auth.uid()) = owner_id);
create policy trip_update on public.travel_trips for update to authenticated
using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id);
create policy trip_delete on public.travel_trips for delete to authenticated
using ((select auth.uid()) = owner_id);

create table public.travel_shares (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  plan_id text not null check (length(plan_id) between 1 and 100),
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  plan jsonb not null,
  title text generated always as (plan->>'title') stored,
  created_at timestamptz not null default now(),
  check ((jsonb_typeof(plan) = 'object' and plan->>'id' = plan_id
    and plan->>'version' = '2' and length(plan->>'title') between 1 and 200
    and octet_length(plan::text) <= 2000000) is true)
);
create index travel_shares_owner on public.travel_shares(owner_id, created_at desc);
alter table public.travel_shares enable row level security;
revoke all on public.travel_shares from public, anon, authenticated;
grant select, delete on public.travel_shares to authenticated;
grant insert (owner_id, plan_id, token_hash, plan) on public.travel_shares to authenticated;
create policy share_read on public.travel_shares for select to authenticated
using ((select auth.uid()) = owner_id);
create policy share_insert on public.travel_shares for insert to authenticated
with check ((select auth.uid()) = owner_id);
create policy share_delete on public.travel_shares for delete to authenticated
using ((select auth.uid()) = owner_id);

-- Only an unguessable bearer token can resolve a published snapshot.
create function public.read_travel_share(p_token text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select plan from public.travel_shares
  where p_token ~ '^[0-9a-f]{64}$'
    and token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex')
  limit 1;
$$;
revoke all on function public.read_travel_share(text) from public;
grant execute on function public.read_travel_share(text) to anon, authenticated;
revoke all on function public.stamp_travel_trip() from public, anon, authenticated;

commit;
