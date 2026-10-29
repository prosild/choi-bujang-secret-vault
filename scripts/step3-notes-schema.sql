-- Run once in the Supabase SQL Editor before deploying the step 3 API.
-- Existing bigint IDs, note contents and owner IDs are preserved.
begin;
lock table public.study_notes in access exclusive mode;
alter table public.study_notes add column if not exists api_id uuid;
alter table public.study_notes alter column api_id set default gen_random_uuid();
update public.study_notes set api_id = gen_random_uuid() where api_id is null;
alter table public.study_notes alter column api_id set not null;
create unique index if not exists study_notes_api_id_uidx on public.study_notes (api_id);
commit;
