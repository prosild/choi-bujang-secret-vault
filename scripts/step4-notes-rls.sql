-- Applied to a table with RLS enabled and no existing policies.
-- Inspect current policies and grants before applying; do not rerun blindly.
begin;
alter table public.study_notes enable row level security;
revoke all privileges on table public.study_notes from public, anon, authenticated;
grant select, delete on table public.study_notes to authenticated;
grant insert (api_id, owner_id, sample_marker, title, content)
on table public.study_notes to authenticated;
grant update (title, content) on table public.study_notes to authenticated;
create policy study_notes_select_own on public.study_notes
for select to authenticated using ((select auth.uid()) = owner_id);
create policy study_notes_insert_own on public.study_notes
for insert to authenticated with check ((select auth.uid()) = owner_id);
create policy study_notes_update_own on public.study_notes
for update to authenticated using ((select auth.uid()) = owner_id)
with check ((select auth.uid()) = owner_id);
create policy study_notes_delete_own on public.study_notes
for delete to authenticated using ((select auth.uid()) = owner_id);
commit;
