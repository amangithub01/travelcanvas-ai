-- Run only against a disposable migrated database. All fixtures roll back.
begin;
insert into auth.users(id) values
  ('00000000-0000-0000-0000-000000000001'),
  ('00000000-0000-0000-0000-000000000002');

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true);
insert into public.travel_trips(owner_id, plan_id, plan)
values (auth.uid(), 'trip', '{"version":2,"id":"trip","title":"Private trip"}');
insert into public.travel_shares(owner_id, plan_id, token_hash, plan)
values (auth.uid(), 'trip', encode(sha256(convert_to(repeat('a',64),'UTF8')),'hex'),
  '{"version":2,"id":"trip","title":"Frozen snapshot"}');
do $$
begin
  if (select count(*) from public.travel_trips) <> 1 then raise exception 'Owner cannot read own trip'; end if;
  update public.travel_trips set plan = '{"version":2,"id":"trip","title":"Updated private trip"}'
    where plan_id = 'trip' and revision = 1;
  if (select revision from public.travel_trips where plan_id = 'trip') is distinct from 2 then raise exception 'Revision not advanced'; end if;
  update public.travel_trips set plan = '{"version":2,"id":"trip","title":"Stale overwrite"}'
    where plan_id = 'trip' and revision = 1;
  if found then raise exception 'Stale update matched'; end if;
  if public.read_travel_share(repeat('a',64))->>'title' is distinct from 'Frozen snapshot' then raise exception 'Private edit changed snapshot'; end if;
  begin
    update public.travel_shares set plan = '{"version":2,"id":"trip","title":"Changed snapshot"}';
    raise exception 'Snapshots were writable';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.travel_trips set revision = 1;
    raise exception 'Clients can forge revisions';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.travel_trips(owner_id, plan_id, plan)
    values (auth.uid(), 'bad', '{}');
    raise exception 'Missing identity accepted';
  exception when check_violation then null;
  end;
end;
$$;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', true);
do $$
begin
  if exists(select from public.travel_trips) then raise exception 'Another user can read private trips'; end if;
  if exists(select from public.travel_shares) then raise exception 'Another user can list shares'; end if;
  update public.travel_trips set plan = '{"version":2,"id":"trip","title":"Attacker"}' where plan_id = 'trip';
  if found then raise exception 'Another user changed trip'; end if;
  delete from public.travel_trips where plan_id = 'trip';
  if found then raise exception 'Another user deleted trip'; end if;
  delete from public.travel_shares;
  if found then raise exception 'Another user revoked share'; end if;
  begin
    insert into public.travel_trips(owner_id, plan_id, plan)
    values ('00000000-0000-0000-0000-000000000001', 'stolen', '{"version":2,"id":"stolen","title":"No"}');
    raise exception 'Another user can insert as owner';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.travel_shares(owner_id, plan_id, token_hash, plan)
    values ('00000000-0000-0000-0000-000000000001', 'trip', repeat('b',64), '{"version":2,"id":"trip","title":"No"}');
    raise exception 'Another user can publish as owner';
  exception when insufficient_privilege then null;
  end;
  insert into public.travel_trips(owner_id, plan_id, plan)
  values (auth.uid(), 'trip', '{"version":2,"id":"trip","title":"Separate owner copy"}');
  if (select count(*) from public.travel_trips) <> 1 then raise exception 'Separate owner copy failed'; end if;
end;
$$;

set local role anon;
select set_config('request.jwt.claim.sub', '', true);
do $$
begin
  if public.read_travel_share(repeat('a',64))->>'title' is distinct from 'Frozen snapshot' then raise exception 'Bearer lookup failed'; end if;
  if public.read_travel_share(repeat('b',64)) is not null then raise exception 'Wrong token exposed data'; end if;
  if public.read_travel_share('invalid') is not null then raise exception 'Invalid token exposed data'; end if;
  begin
    perform * from public.travel_trips;
    raise exception 'Anonymous private reads allowed';
  exception when insufficient_privilege then null;
  end;
  begin
    perform * from public.travel_shares;
    raise exception 'Anonymous enumeration allowed';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.travel_trips(owner_id, plan_id, plan)
    values ('00000000-0000-0000-0000-000000000001', 'trip', '{"version":2,"id":"trip","title":"No"}');
    raise exception 'Anonymous insert allowed';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.travel_trips set plan = '{"version":2,"id":"trip","title":"No"}';
    raise exception 'Anonymous update allowed';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.travel_trips;
    raise exception 'Anonymous delete allowed';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.travel_shares(owner_id, plan_id, token_hash, plan)
    values ('00000000-0000-0000-0000-000000000001', 'trip', repeat('b',64), '{"version":2,"id":"trip","title":"No"}');
    raise exception 'Anonymous publish allowed';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.travel_shares set plan = '{}';
    raise exception 'Anonymous snapshot edit allowed';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.travel_shares;
    raise exception 'Anonymous revocation allowed';
  exception when insufficient_privilege then null;
  end;
end;
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true);
delete from public.travel_trips where plan_id = 'trip' and revision = 2;
do $$
begin
  if exists(select from public.travel_trips) then raise exception 'Owner delete failed'; end if;
  if public.read_travel_share(repeat('a',64)) is null then raise exception 'Independent snapshot disappeared'; end if;
end;
$$;
delete from public.travel_shares;
set local role anon;
select set_config('request.jwt.claim.sub', '', true);
do $$
begin
  if public.read_travel_share(repeat('a',64)) is not null then raise exception 'Revoked token still resolves'; end if;
end;
$$;
reset role;
rollback;
