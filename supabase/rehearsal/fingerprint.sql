-- The same query was run read-only on hosted, so the rehearsal's starting point can be compared with it.
select 'tables=' || count(distinct table_name) || ' columns=' || count(*) || ' md5=' || md5(string_agg(table_name || '.' || column_name || ':' || udt_name || ':' || is_nullable, ',' order by table_name, column_name))
from information_schema.columns
where table_schema = 'public' and table_name in (select tablename from pg_tables where schemaname = 'public');
select 'policies=' || count(*) || ' md5=' || md5(string_agg(schemaname || '.' || tablename || '.' || policyname || ':' || cmd, ',' order by schemaname, tablename, policyname))
from pg_policies where schemaname in ('public', 'storage');
select 'functions=' || count(*) || ' md5=' || md5(string_agg(n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')', ',' order by n.nspname, p.proname, pg_get_function_identity_arguments(p.oid)))
from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('public', 'private');
