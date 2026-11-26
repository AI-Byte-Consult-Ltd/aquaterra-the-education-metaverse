-- AquaTerra World: public list of the richest residents (/rich).
-- One-off migration, rerun-safe. Read-only function, no DDL in the request path.
-- Net worth = TIDE on the wallet + land at the price paid + money put into buildings
--             + bank deposit - open bank debt. Only real ledger values, nothing estimated.
-- Shown: display name only (never an email). System accounts (treasury, state:*, bank:*, nics-ai) are left out.
CREATE OR REPLACE FUNCTION aquaterra_richlist(lim int DEFAULT 50) RETURNS jsonb
LANGUAGE plpgsql STABLE AS $fn$
DECLARE
  has_build boolean := to_regclass('aquaterra_buildings') IS NOT NULL;
  has_bank boolean := to_regclass('aquaterra_bank_loans') IS NOT NULL AND to_regclass('aquaterra_bank_deposits') IS NOT NULL;
  rows jsonb;
  total int;
BEGIN
  EXECUTE format($q$
    WITH p AS (
      SELECT pl.email, coalesce(nullif(trim(pl.display_name), ''), NULL) AS name, pl.role,
             coalesce(w.balance, 0) AS tide
      FROM aquaterra_players pl LEFT JOIN aquaterra_wallets w ON w.account = pl.email
    ), land AS (
      SELECT owner AS email, sum(price_paid) AS land, count(*) AS plots FROM aquaterra_plot_owners GROUP BY owner
    ), b AS (
      %s
    ), bank AS (
      %s
    ), net AS (
      SELECT p.name, p.role, p.tide, coalesce(land.land, 0) AS land, coalesce(land.plots, 0) AS plots,
             coalesce(b.build, 0) AS build, coalesce(b.buildings, 0) AS buildings,
             coalesce(bank.dep, 0) AS dep, coalesce(bank.debt, 0) AS debt
      FROM p LEFT JOIN land ON land.email = p.email LEFT JOIN b ON b.email = p.email LEFT JOIN bank ON bank.email = p.email
    ), ranked AS (
      SELECT *, tide + land + build + dep - debt AS worth FROM net
      WHERE tide + land + build + dep > 0
    )
    SELECT coalesce(jsonb_agg(jsonb_build_object(
             'rank', rk, 'name', name, 'founder', role = 'founder', 'worth', worth, 'tide', tide, 'land', land,
             'plots', plots, 'build', build, 'buildings', buildings, 'deposit', dep, 'debt', debt) ORDER BY rk), '[]'::jsonb),
           (SELECT count(*) FROM ranked)::int
    FROM (SELECT *, row_number() OVER (ORDER BY worth DESC, land DESC, name) AS rk FROM ranked) r WHERE rk <= $1
  $q$,
    CASE WHEN has_build THEN
      'SELECT o.owner AS email, sum(bu.invested) AS build, count(*) FILTER (WHERE bu.kind <> ''empty'') AS buildings
       FROM aquaterra_buildings bu JOIN aquaterra_plot_owners o ON o.plot_id = bu.plot_id GROUP BY o.owner'
    ELSE 'SELECT NULL::text AS email, 0::bigint AS build, 0::bigint AS buildings WHERE false' END,
    CASE WHEN has_bank THEN
      'SELECT e.email, coalesce(d.principal, 0) AS dep, coalesce(l.debt, 0) AS debt
       FROM (SELECT email FROM aquaterra_bank_deposits UNION SELECT email FROM aquaterra_bank_loans) e
       LEFT JOIN aquaterra_bank_deposits d ON d.email = e.email
       LEFT JOIN (SELECT email, sum(outstanding) AS debt FROM aquaterra_bank_loans WHERE status = ''open'' GROUP BY email) l ON l.email = e.email'
    ELSE 'SELECT NULL::text AS email, 0::bigint AS dep, 0::bigint AS debt WHERE false' END)
  INTO rows, total USING greatest(1, least(coalesce(lim, 50), 100));
  RETURN jsonb_build_object('ok', true, 'status', 200, 'residents', rows, 'total', total, 'at', now());
END
$fn$;
