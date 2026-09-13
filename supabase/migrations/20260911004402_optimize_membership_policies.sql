-- Keep the same ownership rules while evaluating the identity once per query.
create index pocketpot_members_user_id_idx on public.pocketpot_members(user_id);

alter policy "own memberships" on public.pocketpot_members
  using (user_id = (select auth.uid()));
alter policy "approved room signals" on public.pocketpot_signals
  using (exists (
    select 1 from public.pocketpot_members m
    where m.room_id = pocketpot_signals.room_id and m.user_id = (select auth.uid())
  ));
alter policy "own summaries" on public.pocketpot_summaries
  using (user_id = (select auth.uid()));
alter policy "delete own summaries" on public.pocketpot_summaries
  using (user_id = (select auth.uid()));
