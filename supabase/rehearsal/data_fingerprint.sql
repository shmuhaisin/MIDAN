-- One line per table: its row count and a hash of its rows. Compares data before a migration and after its rollback.
do $$
declare t record; c bigint; h text;
begin
  create temp table data_fingerprint (name text, rows bigint, hash text) on commit preserve rows;
  for t in select schemaname s, tablename n from pg_tables where schemaname in ('public', 'private', 'storage', 'auth') order by 1, 2 loop
    execute format('select count(*), coalesce(md5(string_agg(x::text, %L order by x::text)), %L) from %I.%I x', E'\n', '', t.s, t.n) into c, h;
    insert into data_fingerprint values (t.s || '.' || t.n, c, h);
  end loop;
end $$;
select name || ' ' || rows || ' ' || hash from data_fingerprint order by name;
