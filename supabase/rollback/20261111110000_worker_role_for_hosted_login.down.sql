-- Reverses 20261111110000_worker_role_for_hosted_login.
do $$
begin
  if exists (select 1 from pg_auth_members m join pg_roles r on r.oid = m.roleid join pg_roles u on u.oid = m.member
             where r.rolname = 'midan_worker' and u.rolname = 'postgres' and m.set_option) then
    revoke midan_worker from postgres;
  end if;
end $$;
