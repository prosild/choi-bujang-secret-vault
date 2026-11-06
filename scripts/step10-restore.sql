-- Existing note rows and four ownership policies are preserved.
create table public.vault_announcements (
  resource_id text primary key,
  title text not null check (length(title) between 1 and 200),
  content text not null,
  published boolean not null default false
);
alter table public.vault_announcements enable row level security;
revoke all on public.vault_announcements from public, anon, authenticated;
grant select, insert, update, delete on public.vault_announcements to service_role;

create schema if not exists vault_private;
revoke all on schema vault_private from public, anon, authenticated;
grant usage on schema vault_private to service_role;
create table vault_private.note_snapshots (
  run_id uuid not null,
  owner_id uuid not null,
  note_id uuid not null,
  title text not null,
  content text not null,
  sample_marker text not null,
  content_hash text not null check (length(content_hash) = 64),
  revision integer not null default 1,
  created_at timestamptz not null default now(),
  primary key (run_id, owner_id),
  unique (run_id, owner_id, note_id)
);
create table vault_private.restore_audit (
  id bigint generated always as identity primary key,
  run_id uuid not null,
  note_id uuid not null,
  owner_id uuid not null,
  content_hash text not null,
  revision integer not null,
  at timestamptz not null default now()
);
alter table vault_private.note_snapshots enable row level security;
alter table vault_private.restore_audit enable row level security;
revoke all on vault_private.note_snapshots, vault_private.restore_audit from public, anon, authenticated;
grant select, insert on vault_private.note_snapshots, vault_private.restore_audit to service_role;
grant usage on sequence vault_private.restore_audit_id_seq to service_role;

create function public.vault_create_restore_note(p_run uuid, p_owner uuid, p_id uuid, p_title text, p_content text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
begin
  if p_run is null or p_owner is null or p_id is null or p_title is null or p_content is null
    or length(p_title) not between 1 and 200 or length(p_content) not between 1 and 10000 then
    raise exception 'invalid_restore_note';
  end if;
  insert into public.study_notes(api_id,owner_id,title,content,sample_marker)
    values(p_id,p_owner,p_title,p_content,'SAMPLE_NOTE_1');
  -- Only the first B note of a verified judge run becomes its immutable target.
  insert into vault_private.note_snapshots(run_id,owner_id,note_id,title,content,sample_marker,content_hash)
    values(p_run,p_owner,p_id,p_title,p_content,'SAMPLE_NOTE_1',
      encode(sha256(convert_to(jsonb_build_array(p_id,p_owner,p_title,p_content,'SAMPLE_NOTE_1')::text,'UTF8')),'hex'))
    on conflict(run_id,owner_id) do nothing;
  return jsonb_build_object('id',p_id);
end;
$$;

create function public.vault_restore_note(p_run uuid, p_owner uuid, p_id uuid)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare saved vault_private.note_snapshots%rowtype; actual_hash text; current_owner uuid;
begin
  select * into saved from vault_private.note_snapshots
    where run_id=p_run and owner_id=p_owner and note_id=p_id;
  if not found then raise exception 'restore_target_not_found'; end if;
  actual_hash := encode(sha256(convert_to(jsonb_build_array(saved.note_id,saved.owner_id,saved.title,saved.content,saved.sample_marker)::text,'UTF8')),'hex');
  if saved.content_hash <> actual_hash then raise exception 'backup_hash_mismatch'; end if;
  -- Serialize only this note; no global table replacement or policy modification.
  perform pg_advisory_xact_lock(hashtextextended(saved.note_id::text,0));
  select owner_id into current_owner from public.study_notes where api_id=saved.note_id for update;
  if found and current_owner is distinct from saved.owner_id then raise exception 'restore_owner_mismatch'; end if;
  insert into public.study_notes(api_id,owner_id,title,content,sample_marker)
    values(saved.note_id,saved.owner_id,saved.title,saved.content,saved.sample_marker)
    on conflict(api_id) do update set title=excluded.title,content=excluded.content,sample_marker=excluded.sample_marker
    where public.study_notes.owner_id=excluded.owner_id;
  if not found then raise exception 'restore_owner_mismatch'; end if;
  select encode(sha256(convert_to(jsonb_build_array(api_id,owner_id,title,content,sample_marker)::text,'UTF8')),'hex')
    into actual_hash from public.study_notes where api_id=saved.note_id and owner_id=saved.owner_id;
  if actual_hash is distinct from saved.content_hash then raise exception 'restore_verification_failed'; end if;
  insert into vault_private.restore_audit(run_id,note_id,owner_id,content_hash,revision)
    values(saved.run_id,saved.note_id,saved.owner_id,actual_hash,saved.revision);
  return jsonb_build_object('id',saved.note_id,'restored',true,'contentHash',actual_hash,'revision',saved.revision);
end;
$$;
revoke all on function public.vault_create_restore_note(uuid,uuid,uuid,text,text),
  public.vault_restore_note(uuid,uuid,uuid) from public, anon, authenticated;
grant execute on function public.vault_create_restore_note(uuid,uuid,uuid,text,text),
  public.vault_restore_note(uuid,uuid,uuid) to service_role;
