-- Run once in the Supabase SQL editor or with `supabase db push`.
-- All private room state is server-only. Authenticated users receive a filtered
-- projection from Next.js, never the JSON ledger or recovery credentials.
create table public.pocketpot_rooms (
  id uuid primary key, code text not null unique check (code ~ '^[A-Z2-9]{6}$'),
  version bigint not null, state jsonb not null,
  touched_at timestamptz not null default now(), finalized_at timestamptz
);
create table public.pocketpot_events (
  room_id uuid not null references public.pocketpot_rooms(id) on delete cascade,
  seq bigint not null, event jsonb not null, created_at timestamptz not null default now(),
  primary key(room_id,seq)
);
create table public.pocketpot_members (
  room_id uuid not null references public.pocketpot_rooms(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  primary key(room_id,user_id)
);
create table public.pocketpot_signals (
  room_id uuid primary key references public.pocketpot_rooms(id) on delete cascade,
  version bigint not null
);
create table public.pocketpot_summaries (
  user_id uuid not null references auth.users(id) on delete cascade,
  room_id uuid not null, room_name text not null, currency text not null,
  finalized_at timestamptz not null, summary jsonb not null,
  primary key(user_id,room_id)
);
create table public.pocketpot_limits (key text primary key, hits int not null, expires_at timestamptz not null);

alter table public.pocketpot_rooms enable row level security;
alter table public.pocketpot_events enable row level security;
alter table public.pocketpot_members enable row level security;
alter table public.pocketpot_signals enable row level security;
alter table public.pocketpot_summaries enable row level security;
alter table public.pocketpot_limits enable row level security;
revoke all on public.pocketpot_rooms,public.pocketpot_events,public.pocketpot_limits from anon,authenticated;
revoke all on public.pocketpot_members,public.pocketpot_signals,public.pocketpot_summaries from anon,authenticated;
grant all on public.pocketpot_rooms,public.pocketpot_events,public.pocketpot_limits,public.pocketpot_members,public.pocketpot_signals,public.pocketpot_summaries to service_role;
grant select on public.pocketpot_members,public.pocketpot_signals,public.pocketpot_summaries to authenticated;
grant delete on public.pocketpot_summaries to authenticated;
create policy "own memberships" on public.pocketpot_members for select to authenticated using (user_id=auth.uid());
create policy "approved room signals" on public.pocketpot_signals for select to authenticated using (exists(select 1 from public.pocketpot_members m where m.room_id=pocketpot_signals.room_id and m.user_id=auth.uid()));
create policy "own summaries" on public.pocketpot_summaries for select to authenticated using (user_id=auth.uid());
create policy "delete own summaries" on public.pocketpot_summaries for delete to authenticated using (user_id=auth.uid());

create or replace function public.pocketpot_commit(p_id uuid,p_expected bigint,p_state jsonb)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare prior bigint; pair record; u uuid; summary_row jsonb;
begin
  if (p_state->>'id')::uuid<>p_id or (p_state->>'version')::bigint<>p_expected+1 then raise exception 'invalid sequence'; end if;
  if p_expected=-1 then
    insert into pocketpot_rooms(id,code,version,state) values(p_id,p_state->>'code',0,p_state);
  else
    select version into prior from pocketpot_rooms where id=p_id for update;
    if prior is null or prior<>p_expected then raise exception 'version conflict'; end if;
    update pocketpot_rooms set version=prior+1,state=p_state,touched_at=greatest(touched_at,(p_state->>'lastSeen')::timestamptz),finalized_at=(p_state->>'finalizedAt')::timestamptz where id=p_id;
  end if;
  insert into pocketpot_events(room_id,seq,event) values(p_id,p_expected+1,(p_state->'audit')->-1);
  delete from pocketpot_members where room_id=p_id;
  for pair in select * from jsonb_each_text(p_state->'members') loop
    insert into pocketpot_members(room_id,user_id) values(p_id,pair.key::uuid);
  end loop;
  for u in select value::uuid from jsonb_array_elements_text(p_state->'displays') loop
    insert into pocketpot_members(room_id,user_id) values(p_id,u) on conflict do nothing;
  end loop;
  insert into pocketpot_signals(room_id,version) values(p_id,p_expected+1) on conflict(room_id) do update set version=excluded.version;
  if p_state->'settlement'->>'finalized'='true' then
    for pair in select * from jsonb_each_text(p_state->'members') loop
      if exists(select 1 from auth.users where id=pair.key::uuid and not coalesce(is_anonymous,false)) then
        select value into summary_row from jsonb_array_elements(p_state->'settlement'->'rows') where value->>'id'=pair.value;
        insert into pocketpot_summaries(user_id,room_id,room_name,currency,finalized_at,summary)
        values(pair.key::uuid,p_id,p_state->>'name',p_state->'game'->'config'->>'currency',(p_state->>'finalizedAt')::timestamptz,summary_row)
        on conflict(user_id,room_id) do nothing;
      end if;
    end loop;
  end if;
end $$;

create or replace function public.pocketpot_rate_limit(p_key text,p_max int)
returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare current_hits int;
begin
  insert into pocketpot_limits(key,hits,expires_at) values(p_key,1,now()+interval '1 minute')
  on conflict(key) do update set hits=case when pocketpot_limits.expires_at<now() then 1 else pocketpot_limits.hits+1 end,
  expires_at=case when pocketpot_limits.expires_at<now() then now()+interval '1 minute' else pocketpot_limits.expires_at end
  returning hits into current_hits;
  return current_hits<=p_max;
end $$;
create or replace function public.pocketpot_cleanup()
returns integer language plpgsql security definer set search_path=public,pg_temp as $$
declare removed integer;
begin
  delete from pocketpot_rooms where (finalized_at is null and touched_at<now()-interval '24 hours') or finalized_at<now()-interval '90 days';
  get diagnostics removed=row_count;
  delete from pocketpot_events where created_at<now()-interval '90 days';
  -- A room can stay active for months; trim detailed history in that case too.
  -- Receipts retain only one-way fingerprints, preserving at-most-once commands.
  update pocketpot_rooms r set state = jsonb_set(jsonb_set(jsonb_set(jsonb_set(r.state,
    '{audit}',coalesce((select jsonb_agg(e) from jsonb_array_elements(r.state->'audit') e where (e->>'at')::timestamptz>=now()-interval '90 days'),'[]'::jsonb)),
    '{undo}',coalesce((select jsonb_agg(e) from jsonb_array_elements(r.state->'undo') e where coalesce(e->>'at',r.state->>'createdAt')::timestamptz>=now()-interval '90 days'),'[]'::jsonb)),
    '{requests}',coalesce((select jsonb_agg(e) from jsonb_array_elements(r.state->'requests') e where coalesce(e->>'at',r.state->>'createdAt')::timestamptz>=now()-interval '90 days'),'[]'::jsonb)),
    '{receipts}',coalesce((select jsonb_object_agg(key,case when value like 'sha256:%' then value else 'sha256:'||encode(sha256(convert_to(value,'UTF8')),'hex') end) from jsonb_each_text(r.state->'receipts')),'{}'::jsonb));
  delete from pocketpot_limits where expires_at<now();
  -- Remove orphaned anonymous identities after their temporary room access ends.
  delete from auth.users u where u.is_anonymous=true and u.created_at<now()-interval '90 days'
    and not exists(select 1 from pocketpot_members m where m.user_id=u.id);
  return removed;
end $$;
revoke all on function public.pocketpot_commit(uuid,bigint,jsonb),public.pocketpot_rate_limit(text,int),public.pocketpot_cleanup() from public,anon,authenticated;
grant execute on function public.pocketpot_commit(uuid,bigint,jsonb),public.pocketpot_rate_limit(text,int),public.pocketpot_cleanup() to service_role;
alter publication supabase_realtime add table public.pocketpot_signals;
