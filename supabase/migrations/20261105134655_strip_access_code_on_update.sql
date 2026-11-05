-- Supabase Auth writes user metadata again after creating a user, which restored the access code
-- that guard_signup had removed. Strip it on every write, and clean any account that kept it.
create function private.strip_access_code() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  new.raw_user_meta_data := new.raw_user_meta_data - 'midan_test_access';
  return new;
end $$;

create trigger strip_access_code before update of raw_user_meta_data on auth.users
  for each row execute function private.strip_access_code();

update auth.users set raw_user_meta_data = raw_user_meta_data - 'midan_test_access' where raw_user_meta_data ? 'midan_test_access';
