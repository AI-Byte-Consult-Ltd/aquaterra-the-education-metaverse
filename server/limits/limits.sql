-- AquaTerra World: residents exempt from the "one resident may own at most N" limits.
-- One-off migration, rerun-safe. No DDL in the request path.
-- Limits covered: plots (max_plots_per_citizen), roads (road_max_per_citizen),
-- stations/harbours/airports (max_hubs_per_citizen), skyscrapers (max_towers_per_citizen).
-- Every limit check reads aquaterra_limit_for(me, key, <normal limit>): the normal limit
-- for everyone, no limit for an exempt resident. Exemptions are set by the Founder.
CREATE TABLE IF NOT EXISTS aquaterra_limit_exempt (
  email text PRIMARY KEY REFERENCES aquaterra_players(email),
  note text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION aquaterra_limit_for(who text, key text, normal bigint) RETURNS bigint
LANGUAGE sql STABLE AS $fn$
  SELECT CASE WHEN EXISTS (SELECT 1 FROM aquaterra_limit_exempt WHERE email = who) THEN 1000000000 ELSE normal END
$fn$;

-- Route every deployed limit check through aquaterra_limit_for (idempotent: a patched check no longer matches).
DO $do$
DECLARE f record;
BEGIN
  FOR f IN SELECT oid FROM pg_proc WHERE prosrc ~ '>= aquaterra_[a-z_]+\(''[a-z_]*per_citizen''\)' LOOP
    EXECUTE regexp_replace(pg_get_functiondef(f.oid),
      '>= (aquaterra_[a-z_]+)\(''([a-z_]*per_citizen)''\)', '>= aquaterra_limit_for(me, ''\2'', \1(''\2''))', 'g');
  END LOOP;
END
$do$;
