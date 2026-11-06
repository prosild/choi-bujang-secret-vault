-- Dedicated fictional B fixture only. Existing user notes are never edited.
-- All fixture mutations roll back inside a subtransaction; only aggregate evidence is returned.
create temporary table restore_verification(result jsonb);
do $$
declare
  fixture_id uuid := 'b6000000-0000-4000-8000-000000000010';
  fixture_owner uuid := 'b6000000-0000-4000-8000-000000000001';
  fixture_run uuid := 'b6000000-0000-4000-8000-000000000002';
  before_hash text; after_hash text; restored jsonb; expected_hash text; audit_before bigint;
  audit_hash_before text; audit_hash_after text; report jsonb; actual_id uuid; actual_owner uuid; actual_hash text;
begin
  if exists(select 1 from public.study_notes where api_id=fixture_id)
    or exists(select 1 from vault_private.note_snapshots where run_id=fixture_run and owner_id=fixture_owner) then
    raise exception 'fixture_already_exists';
  end if;
  select md5(coalesce(jsonb_agg(to_jsonb(n) order by id)::text,'')) into before_hash
    from public.study_notes n where api_id <> fixture_id;
  select count(*) into audit_before from vault_private.restore_audit;
  select md5(coalesce(jsonb_agg(to_jsonb(a) order by id)::text,'')) into audit_hash_before from vault_private.restore_audit a;
  begin
  perform public.vault_create_restore_note(fixture_run,fixture_owner,fixture_id,'Restore fixture B','Fictional restore test only.');
  select content_hash into expected_hash from vault_private.note_snapshots where run_id=fixture_run and owner_id=fixture_owner;
  if expected_hash is null then raise exception 'snapshot_missing'; end if;
  update public.study_notes set content='TEST_TAMPERED' where api_id=fixture_id and owner_id=fixture_owner;
  restored := public.vault_restore_note(fixture_run,fixture_owner,fixture_id);
  if restored->>'contentHash' is distinct from expected_hash or restored->>'id' is distinct from fixture_id::text then raise exception 'tamper_restore_failed'; end if;
  delete from public.study_notes where api_id=fixture_id and owner_id=fixture_owner;
  restored := public.vault_restore_note(fixture_run,fixture_owner,fixture_id);
  if restored->>'contentHash' is distinct from expected_hash then raise exception 'delete_restore_failed'; end if;
  select api_id,owner_id,encode(sha256(convert_to(jsonb_build_array(api_id,owner_id,title,content,sample_marker)::text,'UTF8')),'hex')
    into actual_id,actual_owner,actual_hash from public.study_notes where api_id=fixture_id;
  if actual_id is distinct from fixture_id or actual_owner is distinct from fixture_owner or actual_hash is distinct from expected_hash then
    raise exception 'restored_identity_or_hash_mismatch';
  end if;
  begin
    update vault_private.note_snapshots set content_hash=repeat('0',64) where run_id=fixture_run and owner_id=fixture_owner;
    perform public.vault_restore_note(fixture_run,fixture_owner,fixture_id);
    raise exception 'corrupt_backup_was_accepted';
  exception when others then
    if sqlerrm <> 'backup_hash_mismatch' then raise; end if;
  end;
  begin
    update public.study_notes set owner_id='a6000000-0000-4000-8000-000000000001' where api_id=fixture_id;
    perform public.vault_restore_note(fixture_run,fixture_owner,fixture_id);
    raise exception 'wrong_owner_was_accepted';
  exception when others then
    if sqlerrm <> 'restore_owner_mismatch' then raise; end if;
  end;
  begin
    perform public.vault_restore_note(fixture_run,fixture_owner,'b6000000-0000-4000-8000-000000000099');
    raise exception 'wrong_target_was_accepted';
  exception when others then
    if sqlerrm <> 'restore_target_not_found' then raise; end if;
  end;
  select md5(coalesce(jsonb_agg(to_jsonb(n) order by id)::text,'')) into after_hash
    from public.study_notes n where api_id <> fixture_id;
  if before_hash <> after_hash then raise exception 'other_notes_changed'; end if;
  if (select count(*) from vault_private.restore_audit) <> audit_before+2 then raise exception 'audit_not_preserved'; end if;
  report := jsonb_build_object('tamperRestore',true,'deleteRestore',true,'idOwnerContentHashMatch',true,
    'corruptHashRejected',true,'wrongOwnerRejected',true,'wrongTargetRejected',true,
    'otherNotesUnchanged',true,'auditAppended',2,'targetId',fixture_id,'contentHash',expected_hash);
  raise exception using errcode='Z0010', message='rollback_test_fixture';
  exception when sqlstate 'Z0010' then null;
  end;
  if report is null then raise exception 'missing_verification'; end if;
  select md5(coalesce(jsonb_agg(to_jsonb(a) order by id)::text,'')) into audit_hash_after from vault_private.restore_audit a;
  if audit_hash_before is distinct from audit_hash_after then raise exception 'existing_audit_changed'; end if;
  if exists(select 1 from public.study_notes where api_id=fixture_id)
    or exists(select 1 from vault_private.note_snapshots where run_id=fixture_run and owner_id=fixture_owner) then
    raise exception 'fixture_rollback_failed';
  end if;
  insert into restore_verification values(report || jsonb_build_object('fixtureRolledBack',true,'existingAuditUnchanged',true));
end;
$$;
select result from restore_verification;
