-- Applied to the learning table after reviewing existing grants.
begin;
revoke all privileges on table public.study_notes
from public, anon, authenticated;
revoke all privileges (id, api_id, owner_id, sample_marker, title, content)
on table public.study_notes
from public, anon, authenticated;
commit;
