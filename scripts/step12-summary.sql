create function public.vault_operation_summary(p_owner uuid)
returns jsonb language sql stable security invoker set search_path='' as $$
  select jsonb_build_object(
    'ownedNotes',(select count(*) from public.study_notes where owner_id=p_owner),
    'snapshots',(select count(*) from vault_private.note_snapshots where owner_id=p_owner),
    'restores',(select count(*) from vault_private.restore_audit where owner_id=p_owner),
    'lastRestoreRevision',(select max(revision) from vault_private.restore_audit where owner_id=p_owner),
    'lastRestoreAt',(select max(at) from vault_private.restore_audit where owner_id=p_owner));
$$;
revoke all on function public.vault_operation_summary(uuid) from public,anon,authenticated;
grant execute on function public.vault_operation_summary(uuid) to service_role;
