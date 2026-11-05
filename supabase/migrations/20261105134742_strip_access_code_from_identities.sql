-- Supabase Auth also copies sign-up metadata into the identity record.
create function private.strip_access_code_identity() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  new.identity_data := new.identity_data - 'midan_test_access';
  return new;
end $$;

create trigger strip_access_code before insert or update of identity_data on auth.identities
  for each row execute function private.strip_access_code_identity();

update auth.identities set identity_data = identity_data - 'midan_test_access' where identity_data ? 'midan_test_access';
