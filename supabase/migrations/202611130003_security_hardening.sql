-- Apply after the shared-admin, age-confirmation and stage-1 income migrations.
-- This migration does not replace the separately staged stage-2 income policy.
begin;

-- Reassert the database boundary even if default privileges have changed.
alter table public.levelup_admins enable row level security;
alter table public.levelup_applications enable row level security;
alter table public.levelup_sponsors enable row level security;
alter table public.levelup_team enable row level security;
revoke all on public.levelup_admins, public.levelup_applications,
  public.levelup_sponsors, public.levelup_team from public;
revoke all on public.levelup_admins from anon, authenticated;
revoke select, delete on public.levelup_applications from anon;
revoke select (id, created_at, name, email, exam_provider, certification,
  certification_url, essay, amount, agreement, status, practice_score, notes,
  age_confirmed, household_income) on public.levelup_applications from anon;
revoke insert, update, delete on public.levelup_sponsors, public.levelup_team from anon;

-- Public callers can submit only the fields shown in the application form.
-- Remove both table- and column-level grants before restoring the allowlist.
revoke insert on public.levelup_applications from anon, authenticated;
revoke insert (id, created_at, name, email, exam_provider, certification,
  certification_url, essay, amount, agreement, status, practice_score, notes,
  age_confirmed, household_income) on public.levelup_applications from anon, authenticated;
grant insert (name, email, exam_provider, certification, certification_url,
  essay, amount, agreement, age_confirmed, household_income)
  on public.levelup_applications to anon, authenticated;

-- Admins can review applications but cannot rewrite the applicant's answers,
-- timestamps, ID, or reported household income through the public API.
revoke update on public.levelup_applications from anon, authenticated;
revoke update (id, created_at, name, email, exam_provider, certification,
  certification_url, essay, amount, agreement, status, practice_score, notes,
  age_confirmed, household_income) on public.levelup_applications from anon, authenticated;
grant update (status, practice_score, notes) on public.levelup_applications to authenticated;

-- Validate public submissions at the database boundary, even when a caller
-- bypasses the browser. Existing records remain reviewable.
create or replace function public.levelup_validate_submission()
returns trigger language plpgsql set search_path = '' as $$
declare
  essay_text text;
begin
  if new.name !~ '[^[:space:]]' or new.exam_provider !~ '[^[:space:]]'
     or new.certification !~ '[^[:space:]]' then
    raise exception 'Application text fields must not be empty.';
  end if;
  if new.email !~ '^[^[:space:]@]+@[^[:space:]@]+$' then
    raise exception 'Enter a valid email address.';
  end if;
  if new.certification_url !~* '^https?://(\[[0-9a-f:.]+\]|[^:/?#@[:space:]]+)(:[0-9]{1,5})?([/?#][^[:space:]]*)?$' then
    raise exception 'Enter a valid HTTP or HTTPS certification URL without credentials.';
  end if;
  essay_text := regexp_replace(new.essay, '^[[:space:]]+|[[:space:]]+$', '', 'g');
  if essay_text = '' or array_length(regexp_split_to_array(essay_text, '[[:space:]]+'), 1) >= 500 then
    raise exception 'The essay must contain fewer than 500 words.';
  end if;
  return new;
end;
$$;
revoke all on function public.levelup_validate_submission() from public;
drop trigger if exists levelup_validate_submission on public.levelup_applications;
create trigger levelup_validate_submission before insert on public.levelup_applications
  for each row execute function public.levelup_validate_submission();

-- Only admins can write these public profiles. Limit new or changed images to
-- small JPEG, PNG, or WebP data URLs whose bytes match the declared type.
-- Unchanged legacy images do not prevent an admin from editing an older record.
create or replace function public.levelup_validate_profile_image()
returns trigger language plpgsql set search_path = '' as $$
declare
  image_bytes bytea;
  image_type text;
begin
  if tg_op = 'UPDATE' and new.image is not distinct from old.image then
    return new;
  end if;
  if tg_table_name = 'levelup_team' and new.image = '' then
    return new;
  end if;
  if new.image is null or length(new.image) > 700000
     or new.image !~ '^data:image/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$' then
    raise exception 'Use a PNG, JPEG, or WebP image no larger than 500 KB.';
  end if;
  image_type := split_part(split_part(new.image, ';', 1), '/', 2);
  begin
    image_bytes := decode(split_part(new.image, ',', 2), 'base64');
  exception when others then
    raise exception 'The image data is invalid.';
  end;
  if octet_length(image_bytes) > 512000
     or (image_type = 'png' and substring(image_bytes from 1 for 8) <> decode('89504e470d0a1a0a', 'hex'))
     or (image_type = 'jpeg' and substring(image_bytes from 1 for 3) <> decode('ffd8ff', 'hex'))
     or (image_type = 'webp' and (substring(image_bytes from 1 for 4) <> decode('52494646', 'hex')
                              or substring(image_bytes from 9 for 4) <> decode('57454250', 'hex'))) then
    raise exception 'The image does not match its declared format or is larger than 500 KB.';
  end if;
  return new;
end;
$$;
revoke all on function public.levelup_validate_profile_image() from public;
drop trigger if exists levelup_validate_sponsor_image on public.levelup_sponsors;
create trigger levelup_validate_sponsor_image before insert or update of image on public.levelup_sponsors
  for each row execute function public.levelup_validate_profile_image();
drop trigger if exists levelup_validate_team_image on public.levelup_team;
create trigger levelup_validate_team_image before insert or update of image on public.levelup_team
  for each row execute function public.levelup_validate_profile_image();

commit;
