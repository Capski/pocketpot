-- PostgREST enables safeupdate; only update rooms that need retained-detail pruning.
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
    '{receipts}',coalesce((select jsonb_object_agg(key,case when value like 'sha256:%' then value else 'sha256:'||encode(sha256(convert_to(value,'UTF8')),'hex') end) from jsonb_each_text(r.state->'receipts')),'{}'::jsonb))
  where exists (
    select 1 from jsonb_array_elements(r.state->'audit') e
    where (e->>'at')::timestamptz < now()-interval '90 days'
  ) or exists (
    select 1 from jsonb_array_elements(r.state->'undo') e
    where coalesce(e->>'at',r.state->>'createdAt')::timestamptz < now()-interval '90 days'
  ) or exists (
    select 1 from jsonb_array_elements(r.state->'requests') e
    where coalesce(e->>'at',r.state->>'createdAt')::timestamptz < now()-interval '90 days'
  ) or exists (
    select 1 from jsonb_each_text(r.state->'receipts') receipt
    where receipt.value not like 'sha256:%'
  );
  delete from pocketpot_limits where expires_at<now();
  -- Remove orphaned anonymous identities after their temporary room access ends.
  delete from auth.users u where u.is_anonymous=true and u.created_at<now()-interval '90 days'
    and not exists(select 1 from pocketpot_members m where m.user_id=u.id);
  return removed;
end $$;
