-- AquaTerra Commonwealth: public finance. Salaries, income tax, the Citizens'
-- Charter (weekly land tax, debts, land auctions, deal duty, fines, citizen
-- bonus) and the Bank of First Light (deposits, loans against a plot,
-- mortgages for building, the Founder's loan).
--
-- One-off migration (never per request). Safe to run again.
-- Needs: account, economy, governance (and travel/arcade if present).
-- n8n runs this text: no double dollar quotes (use $fn$), no positional parameters.
--
-- Every number below is a law of the Commonwealth (aquaterra_gov_params):
-- shown in /admin and /state/laws, changed only by a passed set_param proposal.
-- Decisions of Alexander (Founder), 2026-11-24: salaries Council 50, Directorate 40,
-- Assembly and Mayors 20 TIDE a day; NICS AI's share to its fund for games and quests;
-- 10% tax on salaries and on any income (key income_tax_pct, shared with server/build); the Founder's 50,000 TIDE loan without
-- interest, repaid by 10% of his income over 12 months; the Charter and the Bank.

-- ---------------------------------------------------------------- laws

INSERT INTO aquaterra_gov_params (key, value, min_value, max_value, label) VALUES
  ('income_tax_pct', 10, 0, 30, 'Income tax on salaries, land income, interest, quests and bonuses, percent'),
  ('salary_council', 50, 0, 1000, 'Daily salary of a Councillor of First Light, TIDE'),
  ('salary_directorate', 40, 0, 1000, 'Daily salary of a Director, TIDE'),
  ('salary_assembly', 20, 0, 1000, 'Daily salary of a deputy of the Citizens'' Assembly, TIDE'),
  ('salary_mayor', 20, 0, 1000, 'Daily salary of a Mayor, TIDE'),
  ('salary_nics_ai', 50, 0, 2000, 'Daily share of NICS AI, paid to its fund for mini-games and quests, TIDE'),
  ('land_tax_week_bp', 20, 0, 200, 'Weekly land tax, basis points of what a plot cost (20 = 0.2% a week)'),
  ('land_tax_free_plots', 1, 0, 5, 'Plots of each citizen free of land tax (the first ones bought)'),
  ('debt_grace_days', 14, 0, 60, 'Days a tax debt waits without a penalty'),
  ('debt_penalty_pct', 5, 0, 25, 'One-time penalty on a tax debt after the grace days, percent'),
  ('debt_auction_days', 30, 7, 120, 'Days of unpaid land tax before a plot goes to auction'),
  ('auction_hours', 72, 12, 336, 'How long a land auction runs, hours'),
  ('deal_duty_pct', 2, 0, 10, 'Duty on every plot deal, paid by the buyer, percent'),
  ('fine_max', 1000, 0, 100000, 'Largest single fine, TIDE'),
  ('civic_bonus', 25, 0, 1000, 'Citizen bonus for voting at least once in 30 days, TIDE'),
  ('deposit_rate_pct', 4, 0, 20, 'Bank of First Light: yearly interest on deposits, percent'),
  ('loan_rate_pct', 8, 0, 40, 'Bank of First Light: yearly interest on loans, percent'),
  ('loan_ltv_pct', 50, 10, 90, 'Bank of First Light: largest loan, percent of what the pledged plot cost'),
  ('loan_repay_pct', 20, 5, 60, 'Bank of First Light: share of each income that repays a loan, percent'),
  ('loan_max_days', 180, 30, 730, 'Bank of First Light: longest loan term, days'),
  ('mortgage_pct', 80, 10, 95, 'Bank of First Light: largest mortgage, percent of the cost of a building level')
ON CONFLICT (key) DO NOTHING;
-- income_tax_pct may already exist (server/build adds it for building payouts): it is one law for all income.
UPDATE aquaterra_gov_params SET label = 'Income tax on salaries, land and building income, interest, quests and bonuses, percent'
WHERE key = 'income_tax_pct' AND label NOT LIKE 'Income tax on salaries%';
-- The weekly land tax replaces the old yearly one (aquaterra_gov_collect_land_tax below).
DELETE FROM aquaterra_gov_params WHERE key = 'land_tax_pct';

-- ---------------------------------------------------------------- tables

-- Runs of daily and weekly duties, so each runs once (kind + day).
CREATE TABLE IF NOT EXISTS aquaterra_fisc_runs (
  kind text NOT NULL,
  day date NOT NULL,
  at timestamptz NOT NULL DEFAULT now(),
  total bigint NOT NULL DEFAULT 0,
  paid int NOT NULL DEFAULT 0,
  unpaid int NOT NULL DEFAULT 0,
  PRIMARY KEY (kind, day)
);

-- What a citizen owes the state: unpaid land tax or a fine.
CREATE TABLE IF NOT EXISTS aquaterra_debts (
  id bigserial PRIMARY KEY,
  email text NOT NULL REFERENCES aquaterra_players(email),
  kind text NOT NULL CHECK (kind IN ('land_tax', 'fine')),
  amount bigint NOT NULL CHECK (amount > 0),
  paid bigint NOT NULL DEFAULT 0,
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  penalized boolean NOT NULL DEFAULT false,
  reminded_day int NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'paid', 'auction', 'settled')),
  closed_at timestamptz,
  actor text
);
CREATE INDEX IF NOT EXISTS aquaterra_debts_email ON aquaterra_debts (email, id DESC);
CREATE INDEX IF NOT EXISTS aquaterra_debts_open ON aquaterra_debts (status) WHERE status IN ('open', 'auction');

-- Messages from the state and the bank to one citizen (reminders, receipts).
CREATE TABLE IF NOT EXISTS aquaterra_notices (
  id bigserial PRIMARY KEY,
  email text NOT NULL REFERENCES aquaterra_players(email),
  at timestamptz NOT NULL DEFAULT now(),
  kind text NOT NULL,
  text text NOT NULL,
  read_at timestamptz
);
CREATE INDEX IF NOT EXISTS aquaterra_notices_email ON aquaterra_notices (email, id DESC);

CREATE TABLE IF NOT EXISTS aquaterra_bank_deposits (
  email text PRIMARY KEY REFERENCES aquaterra_players(email),
  principal bigint NOT NULL DEFAULT 0 CHECK (principal >= 0),
  carry numeric NOT NULL DEFAULT 0,          -- interest earned but under 1 TIDE yet
  interest_paid bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS aquaterra_bank_loans (
  id serial PRIMARY KEY,
  email text NOT NULL REFERENCES aquaterra_players(email),
  kind text NOT NULL CHECK (kind IN ('founder', 'pledge', 'mortgage')),
  principal bigint NOT NULL CHECK (principal > 0),
  outstanding bigint NOT NULL CHECK (outstanding >= 0),
  carry numeric NOT NULL DEFAULT 0,
  rate_pct numeric NOT NULL,
  repay_pct numeric NOT NULL,
  collateral_plot int REFERENCES aquaterra_plots(id),
  opened_at timestamptz NOT NULL DEFAULT now(),
  due_at timestamptz NOT NULL,
  repaid bigint NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'repaid', 'defaulted')),
  closed_at timestamptz,
  note text,
  ref text
);
CREATE INDEX IF NOT EXISTS aquaterra_bank_loans_email ON aquaterra_bank_loans (email, id);
CREATE UNIQUE INDEX IF NOT EXISTS aquaterra_bank_loans_founder ON aquaterra_bank_loans (kind) WHERE kind = 'founder';

CREATE TABLE IF NOT EXISTS aquaterra_land_auctions (
  id serial PRIMARY KEY,
  plot_id int NOT NULL REFERENCES aquaterra_plots(id),
  seller text NOT NULL,                       -- the owner whose plot is sold
  reason text NOT NULL CHECK (reason IN ('land_tax', 'loan')),
  debt_id bigint,
  loan_id int,
  owed bigint NOT NULL,                       -- what the state or the bank takes from the price
  min_bid bigint NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  ends_at timestamptz NOT NULL,
  best_bid bigint,
  best_bidder text,
  best_duty bigint NOT NULL DEFAULT 0,        -- deal duty held with the best bid
  bids int NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'sold', 'reserve')),
  settled_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS aquaterra_land_auctions_open ON aquaterra_land_auctions (plot_id) WHERE status = 'open';

INSERT INTO aquaterra_wallets (account, balance, welcomed_at) VALUES
  ('bank:first-light', 0, now()), ('state:escrow', 0, now()), ('nics-ai', 0, now())
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------- helpers

CREATE OR REPLACE FUNCTION aquaterra_fisc(k text) RETURNS numeric
LANGUAGE sql STABLE AS $fn$ SELECT COALESCE((SELECT value FROM aquaterra_gov_params WHERE key = k), 0) $fn$;

-- Names for the bank's system accounts in every history (patches aquaterra_name once,
-- so names added by other workflows stay).
DO $do$
DECLARE src text; anchor text := 'WHEN acct IS NULL THEN NULL';
BEGIN
  src := pg_get_functiondef('aquaterra_name(text)'::regprocedure);
  IF position('bank:first-light' IN src) > 0 THEN RETURN; END IF;
  IF position(anchor IN src) = 0 THEN RAISE EXCEPTION 'name patch: anchor not found'; END IF;
  src := replace(src, anchor, anchor || E'\n    WHEN acct = ''bank:first-light'' THEN ''Bank of First Light'' WHEN acct = ''state:escrow'' THEN ''Land auctions''');
  EXECUTE src;
END $do$;

CREATE OR REPLACE FUNCTION aquaterra_fisc_move(src text, dst text, amt bigint, k text, plot int, note text, who text, r text) RETURNS bigint
LANGUAGE plpgsql AS $fn$
DECLARE lid bigint;
BEGIN
  IF amt IS NULL OR amt <= 0 THEN RETURN NULL; END IF;
  INSERT INTO aquaterra_wallets (account, welcomed_at) VALUES (dst, now()) ON CONFLICT DO NOTHING;
  lid := aquaterra_move(src, dst, amt, k, plot, left(note, 120), who);
  IF r IS NOT NULL THEN UPDATE aquaterra_ledger SET ref = left(r, 120) WHERE id = lid; END IF;
  RETURN lid;
END $fn$;

CREATE OR REPLACE FUNCTION aquaterra_balance(acct text) RETURNS bigint
LANGUAGE sql STABLE AS $fn$ SELECT COALESCE((SELECT balance FROM aquaterra_wallets WHERE account = acct), 0) $fn$;

CREATE OR REPLACE FUNCTION aquaterra_notice(e text, k text, t text) RETURNS void
LANGUAGE sql AS $fn$ INSERT INTO aquaterra_notices (email, kind, text) SELECT e, k, left(t, 400) WHERE e LIKE '%@%' $fn$;

-- The best paid office a citizen holds now, and its daily salary.
CREATE OR REPLACE FUNCTION aquaterra_fisc_office(e text, OUT office text, OUT salary bigint)
LANGUAGE plpgsql STABLE AS $fn$
BEGIN
  SELECT o, s INTO office, salary FROM (
    SELECT 'council' o, aquaterra_fisc('salary_council')::bigint s WHERE EXISTS (SELECT 1 FROM aquaterra_council WHERE email = e AND (term_ends IS NULL OR term_ends > now()))
    UNION ALL SELECT 'directorate', aquaterra_fisc('salary_directorate')::bigint WHERE EXISTS (SELECT 1 FROM aquaterra_gov_directorate WHERE holder_email = e AND term_ends > now())
    UNION ALL SELECT 'assembly', aquaterra_fisc('salary_assembly')::bigint WHERE EXISTS (SELECT 1 FROM aquaterra_gov_seats WHERE holder_email = e AND (term_ends IS NULL OR term_ends > now()))
    UNION ALL SELECT 'mayor', aquaterra_fisc('salary_mayor')::bigint WHERE EXISTS (SELECT 1 FROM aquaterra_districts WHERE mayor_email = e AND mayor_term_ends > now())
  ) x ORDER BY s DESC, o LIMIT 1;
END $fn$;

-- ---------------------------------------------------------------- income: tax and loan repayment

-- Every income to a citizen pays income tax (kinds the Arcade does not tax
-- itself) and repays open bank loans by their share. Runs after the income row
-- is written, inside the same transaction, so nothing is ever half paid.
CREATE OR REPLACE FUNCTION aquaterra_fisc_on_income() RETURNS trigger
LANGUAGE plpgsql AS $fn$
DECLARE tax bigint := 0; l record; part bigint; left_ bigint;
BEGIN
  IF NEW.kind IN ('income', 'salary', 'interest', 'quest', 'civic_bonus') THEN
    tax := round(NEW.amount * aquaterra_fisc('income_tax_pct') / 100.0);
    IF tax > 0 THEN
      PERFORM aquaterra_fisc_move(NEW.to_account, 'state:treasury', tax, 'income_tax', NEW.plot_id,
        'Income tax ' || trim_scale(aquaterra_fisc('income_tax_pct')) || '%', NULL, 'tax:income:' || NEW.id);
    END IF;
  END IF;
  FOR l IN SELECT * FROM aquaterra_bank_loans WHERE email = NEW.to_account AND status = 'open' AND outstanding > 0 AND repay_pct > 0 ORDER BY id FOR UPDATE LOOP
    left_ := aquaterra_balance(NEW.to_account);
    part := least(l.outstanding, round(NEW.amount * l.repay_pct / 100.0)::bigint, left_);
    CONTINUE WHEN part <= 0;
    PERFORM aquaterra_fisc_move(NEW.to_account, 'bank:first-light', part, 'loan_repay', NULL,
      'Loan #' || l.id || ': ' || trim_scale(l.repay_pct) || '% of income', NULL, 'loan:' || l.id || ':' || NEW.id);
    UPDATE aquaterra_bank_loans SET outstanding = outstanding - part, repaid = repaid + part,
      status = CASE WHEN outstanding - part = 0 THEN 'repaid' ELSE status END,
      closed_at = CASE WHEN outstanding - part = 0 THEN now() END WHERE id = l.id;
    IF l.outstanding = part THEN PERFORM aquaterra_notice(l.email, 'loan', format('Loan #%s is fully repaid. Thank you.', l.id)); END IF;
  END LOOP;
  RETURN NULL;
END $fn$;

-- The duty on a plot deal, paid by the buyer on top of the price.
CREATE OR REPLACE FUNCTION aquaterra_fisc_on_deal() RETURNS trigger
LANGUAGE plpgsql AS $fn$
DECLARE duty bigint;
BEGIN
  IF aquaterra_fisc('deal_duty_pct') <= 0 THEN RETURN NULL; END IF;
  duty := greatest(1, round(NEW.amount * aquaterra_fisc('deal_duty_pct') / 100.0))::bigint;
  PERFORM aquaterra_fisc_move(NEW.from_account, 'state:treasury', duty, 'duty', NEW.plot_id,
    'Deal duty ' || trim_scale(aquaterra_fisc('deal_duty_pct')) || '%', NEW.from_account, 'duty:' || NEW.id);
  RETURN NULL;
END $fn$;

DROP TRIGGER IF EXISTS aquaterra_fisc_income ON aquaterra_ledger;
CREATE TRIGGER aquaterra_fisc_income AFTER INSERT ON aquaterra_ledger FOR EACH ROW
  WHEN (NEW.to_account LIKE '%@%' AND NEW.kind IN ('income', 'salary', 'interest', 'quest', 'civic_bonus', 'arcade_prize', 'rent', 'fare', 'auction_proceeds', 'building_income'))
  EXECUTE FUNCTION aquaterra_fisc_on_income();
DROP TRIGGER IF EXISTS aquaterra_fisc_deal ON aquaterra_ledger;
CREATE TRIGGER aquaterra_fisc_deal AFTER INSERT ON aquaterra_ledger FOR EACH ROW
  WHEN (NEW.from_account LIKE '%@%' AND NEW.kind = 'plot_purchase')
  EXECUTE FUNCTION aquaterra_fisc_on_deal();

-- Prizes and rent are income too: the Arcade's own taxes rise to the income tax (Founder's decision).
UPDATE aquaterra_gov_params SET value = 10, updated_at = now()
WHERE key IN ('arcade_prize_tax_pct', 'rent_tax_pct') AND value < 10
  AND NOT EXISTS (SELECT 1 FROM aquaterra_fisc_runs WHERE kind = 'migration:arcade_income_tax');
INSERT INTO aquaterra_fisc_runs (kind, day) VALUES ('migration:arcade_income_tax', current_date) ON CONFLICT DO NOTHING;
UPDATE aquaterra_gov_params SET max_value = greatest(max_value, 30) WHERE key = 'rent_tax_pct';

-- ---------------------------------------------------------------- debts and auctions

-- Pays what it can of one open debt from the debtor's wallet. Returns what was paid.
CREATE OR REPLACE FUNCTION aquaterra_debt_collect(did bigint) RETURNS bigint
LANGUAGE plpgsql AS $fn$
DECLARE d aquaterra_debts; part bigint;
BEGIN
  SELECT * INTO d FROM aquaterra_debts WHERE id = did AND status = 'open' FOR UPDATE;
  IF d.id IS NULL THEN RETURN 0; END IF;
  part := least(d.amount - d.paid, aquaterra_balance(d.email));
  IF part <= 0 THEN RETURN 0; END IF;
  PERFORM aquaterra_fisc_move(d.email, 'state:treasury', part, CASE d.kind WHEN 'fine' THEN 'fine' ELSE 'land_tax' END, NULL,
    CASE d.kind WHEN 'fine' THEN 'Fine: ' ELSE 'Land tax: ' END || d.reason, NULL, 'debt:' || d.id);
  UPDATE aquaterra_debts SET paid = paid + part,
    status = CASE WHEN paid + part >= amount THEN 'paid' ELSE status END,
    closed_at = CASE WHEN paid + part >= amount THEN now() END WHERE id = did;
  IF d.paid + part >= d.amount AND d.created_at < now() - interval '1 minute' THEN
    PERFORM aquaterra_notice(d.email, 'debt', format('Paid in full: %s (%s TIDE). You owe the state nothing for it now.', d.reason, d.amount));
  END IF;
  RETURN part;
END $fn$;

-- Puts a plot up for auction. owed: what the state or the bank takes from the price.
CREATE OR REPLACE FUNCTION aquaterra_auction_open(plot int, why text, did bigint, lid int, owed bigint) RETURNS int
LANGUAGE plpgsql AS $fn$
DECLARE o aquaterra_plot_owners; aid int; p aquaterra_plots;
BEGIN
  SELECT * INTO o FROM aquaterra_plot_owners WHERE plot_id = plot;
  IF o.plot_id IS NULL OR EXISTS (SELECT 1 FROM aquaterra_land_auctions WHERE plot_id = plot AND status = 'open') THEN RETURN NULL; END IF;
  SELECT * INTO p FROM aquaterra_plots WHERE id = plot;
  INSERT INTO aquaterra_land_auctions (plot_id, seller, reason, debt_id, loan_id, owed, min_bid, ends_at)
  VALUES (plot, o.owner, why, did, lid, owed, CASE why WHEN 'loan' THEN greatest(round(p.price * 0.5)::bigint, 1) ELSE greatest(owed, round(p.price * 0.5)::bigint, 1) END, now() + make_interval(hours => aquaterra_fisc('auction_hours')::int))
  RETURNING id INTO aid;
  PERFORM aquaterra_notice(o.owner, 'auction', format('%s is now at a land auction (%s). The state keeps %s TIDE from the price; the rest is yours.',
    p.address, CASE why WHEN 'loan' THEN 'unpaid bank loan' ELSE 'land tax unpaid for 30 days' END, owed));
  PERFORM aquaterra_gov_log_add('auction', NULL, format('Land auction: %s, %s. Starting bid %s TIDE.', p.address,
    CASE why WHEN 'loan' THEN 'loan not repaid' ELSE 'land tax unpaid for 30 days' END,
    (SELECT min_bid FROM aquaterra_land_auctions WHERE id = aid)));
  RETURN aid;
END $fn$;

-- Settles one ended auction. With no bids the AquaTerra Reserve buys the plot back at its price.
CREATE OR REPLACE FUNCTION aquaterra_auction_settle(aid int) RETURNS void
LANGUAGE plpgsql AS $fn$
DECLARE a aquaterra_land_auctions; p aquaterra_plots; price bigint; src text; take bigint; rest bigint;
BEGIN
  SELECT * INTO a FROM aquaterra_land_auctions WHERE id = aid AND status = 'open' FOR UPDATE;
  IF a.id IS NULL THEN RETURN; END IF;
  SELECT * INTO p FROM aquaterra_plots WHERE id = a.plot_id;
  IF NOT EXISTS (SELECT 1 FROM aquaterra_plot_owners WHERE plot_id = a.plot_id AND owner = a.seller) THEN
    -- the owner no longer holds it: refund the best bid and close
    IF a.best_bidder IS NOT NULL THEN PERFORM aquaterra_fisc_move('state:escrow', a.best_bidder, a.best_bid + a.best_duty, 'auction_refund', a.plot_id, 'Auction cancelled', NULL, 'auction:' || a.id || ':refund'); END IF;
    UPDATE aquaterra_land_auctions SET status = 'reserve', settled_at = now() WHERE id = aid; RETURN;
  END IF;
  IF a.best_bidder IS NOT NULL THEN
    price := a.best_bid; src := 'state:escrow';
    UPDATE aquaterra_plot_owners SET owner = a.best_bidder, price_paid = a.best_bid, bought_at = now(), income_from = now() WHERE plot_id = a.plot_id;
    UPDATE aquaterra_land_auctions SET status = 'sold', settled_at = now() WHERE id = aid;
    PERFORM aquaterra_fisc_move('state:escrow', 'state:treasury', a.best_duty, 'duty', a.plot_id, 'Deal duty: auction of ' || p.address, NULL, 'auction:' || a.id || ':duty');
    PERFORM aquaterra_notice(a.best_bidder, 'auction', format('You won the auction: %s is yours for %s TIDE.', p.address, a.best_bid));
  ELSE
    price := p.price; src := 'treasury';
    DELETE FROM aquaterra_plot_owners WHERE plot_id = a.plot_id;
    UPDATE aquaterra_land_auctions SET status = 'reserve', settled_at = now() WHERE id = aid;
  END IF;
  take := least(price, a.owed); rest := price - take;
  IF a.reason = 'loan' THEN
    PERFORM aquaterra_fisc_move(src, 'bank:first-light', take, 'loan_repay', a.plot_id, 'Pledged plot sold: ' || p.address, NULL, 'auction:' || a.id || ':bank');
    UPDATE aquaterra_bank_loans SET outstanding = 0, repaid = repaid + take, status = 'defaulted', closed_at = now() WHERE id = a.loan_id;
  ELSE
    PERFORM aquaterra_fisc_move(src, 'state:treasury', take, 'land_tax', a.plot_id, 'Land tax debt from auction: ' || p.address, NULL, 'auction:' || a.id || ':tax');
    UPDATE aquaterra_debts SET paid = amount, status = 'settled', closed_at = now() WHERE id = a.debt_id;
  END IF;
  PERFORM aquaterra_fisc_move(src, a.seller, rest, 'auction_proceeds', a.plot_id, 'Auction of ' || p.address || ', after the debt', NULL, 'auction:' || a.id || ':seller');
  PERFORM aquaterra_notice(a.seller, 'auction', format('%s was sold for %s TIDE. %s TIDE paid your debt, %s TIDE came to your wallet.', p.address, price, take, rest));
  PERFORM aquaterra_gov_log_add('auction', NULL, format('Auction closed: %s %s for %s TIDE.', p.address,
    CASE WHEN a.best_bidder IS NOT NULL THEN 'sold to ' || aquaterra_name(a.best_bidder) ELSE 'bought back by the Reserve' END, price));
END $fn$;

-- ---------------------------------------------------------------- daily and weekly duties

CREATE OR REPLACE FUNCTION aquaterra_fisc_run(k text, d date) RETURNS boolean
LANGUAGE plpgsql AS $fn$
BEGIN
  INSERT INTO aquaterra_fisc_runs (kind, day) VALUES (k, d) ON CONFLICT DO NOTHING;
  RETURN FOUND;
END $fn$;

CREATE OR REPLACE FUNCTION aquaterra_fisc_payroll(d date) RETURNS void
LANGUAGE plpgsql AS $fn$
DECLARE r record; v_total bigint := 0; v_paid int := 0; v_unpaid int := 0; ai bigint;
BEGIN
  IF NOT aquaterra_fisc_run('payroll', d) THEN RETURN; END IF;
  FOR r IN SELECT e, (aquaterra_fisc_office(e)).* FROM (
      SELECT email e FROM aquaterra_council WHERE email IS NOT NULL AND (term_ends IS NULL OR term_ends > now())
      UNION SELECT holder_email FROM aquaterra_gov_directorate WHERE holder_email IS NOT NULL AND term_ends > now()
      UNION SELECT holder_email FROM aquaterra_gov_seats WHERE holder_email IS NOT NULL AND (term_ends IS NULL OR term_ends > now())
      UNION SELECT mayor_email FROM aquaterra_districts WHERE mayor_email IS NOT NULL AND mayor_term_ends > now()) x ORDER BY e LOOP
    CONTINUE WHEN r.salary IS NULL OR r.salary <= 0;
    IF aquaterra_balance('state:treasury') >= r.salary THEN
      PERFORM aquaterra_fisc_move('state:treasury', r.e, r.salary, 'salary', NULL,
        'Salary ' || d || ': ' || CASE r.office WHEN 'council' THEN 'Council of First Light' WHEN 'directorate' THEN 'The Directorate'
          WHEN 'assembly' THEN 'Citizens'' Assembly' ELSE 'Mayor' END, NULL, 'salary:' || d || ':' || md5(r.e));
      v_total := v_total + r.salary; v_paid := v_paid + 1;
    ELSE
      v_unpaid := v_unpaid + 1;
      PERFORM aquaterra_notice(r.e, 'salary', format('The State Treasury could not pay your salary for %s: it holds too little TIDE.', d));
    END IF;
  END LOOP;
  -- NICS AI (seat 2) takes no wage: its share goes to its fund for mini-games and quests.
  ai := aquaterra_fisc('salary_nics_ai')::bigint;
  IF ai > 0 AND EXISTS (SELECT 1 FROM aquaterra_council WHERE kind = 'ai') THEN
    IF aquaterra_balance('state:treasury') >= ai THEN
      PERFORM aquaterra_fisc_move('state:treasury', 'nics-ai', ai, 'salary', NULL, 'NICS AI share ' || d || ': fund for mini-games and quests', NULL, 'salary:' || d || ':nics-ai');
      v_total := v_total + ai; v_paid := v_paid + 1;
    ELSE v_unpaid := v_unpaid + 1; END IF;
  END IF;
  UPDATE aquaterra_fisc_runs SET total = v_total, paid = v_paid, unpaid = v_unpaid WHERE kind = 'payroll' AND day = d;
  IF v_paid + v_unpaid > 0 THEN
    PERFORM aquaterra_gov_log_add('salary', NULL, format('Salaries for %s: %s TIDE to %s office holders.%s', d, v_total, v_paid,
      CASE WHEN v_unpaid > 0 THEN format(' %s could not be paid: the treasury is short.', v_unpaid) ELSE '' END));
  END IF;
END $fn$;

-- Weekly land tax (Monday). The first plots of each citizen are free. Who cannot
-- pay gets a debt: 14 days without a penalty, reminders, auction after 30 days.
CREATE OR REPLACE FUNCTION aquaterra_fisc_land_tax(d date) RETURNS void
LANGUAGE plpgsql AS $fn$
DECLARE r record; v_total bigint := 0; v_paid int := 0; v_unpaid int := 0; wk date := date_trunc('week', d)::date; did bigint; got bigint;
BEGIN
  IF aquaterra_fisc('land_tax_week_bp') <= 0 OR NOT aquaterra_fisc_run('land_tax', wk) THEN RETURN; END IF;
  FOR r IN
    SELECT owner, sum(greatest(1, round(price_paid * aquaterra_fisc('land_tax_week_bp') / 10000.0)))::bigint due, count(*) n
    FROM (SELECT owner, price_paid, row_number() OVER (PARTITION BY owner ORDER BY bought_at, plot_id) k
          FROM aquaterra_plot_owners WHERE owner LIKE '%@%' AND bought_at < now() - interval '1 day') o
    WHERE k > aquaterra_fisc('land_tax_free_plots') GROUP BY owner ORDER BY owner LOOP
    INSERT INTO aquaterra_debts (email, kind, amount, reason) VALUES (r.owner, 'land_tax', r.due, format('week of %s, %s %s', wk, r.n, CASE WHEN r.n = 1 THEN 'plot' ELSE 'plots' END)) RETURNING id INTO did;
    got := aquaterra_debt_collect(did);
    v_total := v_total + got;
    IF got >= r.due THEN v_paid := v_paid + 1;
    ELSE
      v_unpaid := v_unpaid + 1;
      UPDATE aquaterra_debts SET reminded_day = 0 WHERE id = did;
      PERFORM aquaterra_notice(r.owner, 'debt', format('Land tax for the week of %s is %s TIDE and your wallet is short by %s. It waits %s days without a penalty; it is taken as soon as TIDE arrives.',
        wk, r.due, r.due - got, aquaterra_fisc('debt_grace_days')));
    END IF;
  END LOOP;
  UPDATE aquaterra_fisc_runs SET total = v_total, paid = v_paid, unpaid = v_unpaid WHERE kind = 'land_tax' AND day = wk;
  IF v_paid + v_unpaid > 0 THEN
    PERFORM aquaterra_gov_log_add('tax', NULL, format('Weekly land tax: %s TIDE from %s owners.%s', v_total, v_paid,
      CASE WHEN v_unpaid > 0 THEN format(' %s owe the rest as a debt.', v_unpaid) ELSE '' END));
  END IF;
END $fn$;

-- Every tick: take what can be taken, remind, penalise after the grace days, auction after 30.
CREATE OR REPLACE FUNCTION aquaterra_fisc_debts() RETURNS void
LANGUAGE plpgsql AS $fn$
DECLARE r aquaterra_debts; age int; plot int; pen bigint;
BEGIN
  FOR r IN SELECT * FROM aquaterra_debts WHERE status = 'open' ORDER BY id LOOP
    PERFORM aquaterra_debt_collect(r.id);
    SELECT * INTO r FROM aquaterra_debts WHERE id = r.id;
    CONTINUE WHEN r.status <> 'open';
    age := floor(extract(epoch FROM now() - r.created_at) / 86400);
    IF NOT r.penalized AND age >= aquaterra_fisc('debt_grace_days') AND aquaterra_fisc('debt_penalty_pct') > 0 THEN
      pen := greatest(1, round((r.amount - r.paid) * aquaterra_fisc('debt_penalty_pct') / 100.0));
      UPDATE aquaterra_debts SET amount = amount + pen, penalized = true WHERE id = r.id;
      PERFORM aquaterra_notice(r.email, 'debt', format('%s: %s days have passed, a penalty of %s TIDE was added. Still owed: %s TIDE.', r.reason, age, pen, r.amount - r.paid + pen));
    ELSIF age IN (7, 13, 21, 28) AND r.reminded_day < age THEN
      UPDATE aquaterra_debts SET reminded_day = age WHERE id = r.id;
      PERFORM aquaterra_notice(r.email, 'debt', format('Reminder: you owe %s TIDE (%s).%s', r.amount - r.paid, r.reason,
        CASE WHEN r.kind = 'land_tax' THEN format(' After %s days a plot goes to auction.', aquaterra_fisc('debt_auction_days')) ELSE '' END));
    END IF;
    IF r.kind = 'land_tax' AND age >= aquaterra_fisc('debt_auction_days') THEN
      SELECT o.plot_id INTO plot FROM aquaterra_plot_owners o
      WHERE o.owner = r.email AND NOT EXISTS (SELECT 1 FROM aquaterra_land_auctions a WHERE a.plot_id = o.plot_id AND a.status = 'open')
        AND NOT EXISTS (SELECT 1 FROM aquaterra_bank_loans l WHERE l.collateral_plot = o.plot_id AND l.status = 'open')
      ORDER BY o.price_paid DESC, o.plot_id LIMIT 1;
      IF plot IS NOT NULL AND aquaterra_auction_open(plot, 'land_tax', r.id, NULL, (SELECT amount - paid FROM aquaterra_debts WHERE id = r.id)) IS NOT NULL THEN
        UPDATE aquaterra_debts SET status = 'auction' WHERE id = r.id;
      END IF;
    END IF;
  END LOOP;
END $fn$;

CREATE OR REPLACE FUNCTION aquaterra_fisc_bank(d date) RETURNS void
LANGUAGE plpgsql AS $fn$
DECLARE r record; due numeric; whole bigint; v_total bigint := 0; v_n int := 0;
BEGIN
  IF NOT aquaterra_fisc_run('bank', d) THEN RETURN; END IF;
  -- deposits: one day of interest, paid by the bank when it reaches 1 TIDE (income, taxed)
  FOR r IN SELECT * FROM aquaterra_bank_deposits WHERE principal > 0 ORDER BY email FOR UPDATE LOOP
    due := r.carry + r.principal * aquaterra_fisc('deposit_rate_pct') / 100.0 / 365;
    whole := floor(due);
    IF whole >= 1 AND aquaterra_balance('bank:first-light') - (SELECT COALESCE(sum(principal), 0) FROM aquaterra_bank_deposits) >= whole THEN
      PERFORM aquaterra_fisc_move('bank:first-light', r.email, whole, 'interest', NULL, 'Deposit interest ' || d, NULL, 'interest:' || d || ':' || md5(r.email));
      UPDATE aquaterra_bank_deposits SET carry = due - whole, interest_paid = interest_paid + whole, updated_at = now() WHERE email = r.email;
      v_total := v_total + whole; v_n := v_n + 1;
    ELSE
      UPDATE aquaterra_bank_deposits SET carry = due WHERE email = r.email;
    END IF;
  END LOOP;
  -- loans: one day of interest added to what is owed
  FOR r IN SELECT * FROM aquaterra_bank_loans WHERE status = 'open' AND rate_pct > 0 ORDER BY id FOR UPDATE LOOP
    due := r.carry + r.outstanding * r.rate_pct / 100.0 / 365;
    UPDATE aquaterra_bank_loans SET outstanding = outstanding + floor(due)::bigint, carry = due - floor(due) WHERE id = r.id;
  END LOOP;
  -- loans past their term: the pledged plot goes to auction for the bank
  FOR r IN SELECT * FROM aquaterra_bank_loans WHERE status = 'open' AND due_at < now() AND outstanding > 0 ORDER BY id LOOP
    IF r.collateral_plot IS NOT NULL AND EXISTS (SELECT 1 FROM aquaterra_plot_owners WHERE plot_id = r.collateral_plot AND owner = r.email) THEN
      PERFORM aquaterra_auction_open(r.collateral_plot, 'loan', NULL, r.id, r.outstanding);
    END IF;
  END LOOP;
  UPDATE aquaterra_fisc_runs SET total = v_total, paid = v_n WHERE kind = 'bank' AND day = d;
END $fn$;

-- Citizen bonus: whoever voted at least once in the last 30 days gets it once in 30 days.
CREATE OR REPLACE FUNCTION aquaterra_fisc_civic(d date) RETURNS void
LANGUAGE plpgsql AS $fn$
DECLARE r record; b bigint := aquaterra_fisc('civic_bonus')::bigint; v_total bigint := 0; v_n int := 0;
BEGIN
  IF b <= 0 OR NOT aquaterra_fisc_run('civic', d) THEN RETURN; END IF;
  FOR r IN SELECT DISTINCT v.voter FROM aquaterra_gov_votes v JOIN aquaterra_players p ON p.email = v.voter
    WHERE v.at > now() - interval '30 days'
      AND NOT EXISTS (SELECT 1 FROM aquaterra_ledger l WHERE l.kind = 'civic_bonus' AND l.to_account = v.voter AND l.at > now() - interval '30 days')
    ORDER BY v.voter LOOP
    EXIT WHEN aquaterra_balance('state:treasury') < b;
    PERFORM aquaterra_fisc_move('state:treasury', r.voter, b, 'civic_bonus', NULL, 'Citizen bonus: you voted this month', NULL, 'civic:' || d || ':' || md5(r.voter));
    v_total := v_total + b; v_n := v_n + 1;
  END LOOP;
  UPDATE aquaterra_fisc_runs SET total = v_total, paid = v_n WHERE kind = 'civic' AND day = d;
END $fn$;

-- Called by the Commonwealth tick every few minutes. Cheap when there is nothing to do.
CREATE OR REPLACE FUNCTION aquaterra_fisc_tick() RETURNS void
LANGUAGE plpgsql AS $fn$
DECLARE d date := (now() AT TIME ZONE 'UTC')::date; a int;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('aquaterra_fisc_tick'));
  PERFORM aquaterra_fisc_payroll(d);
  PERFORM aquaterra_fisc_bank(d);
  PERFORM aquaterra_fisc_land_tax(d);
  PERFORM aquaterra_fisc_civic(d);
  PERFORM aquaterra_fisc_debts();
  FOR a IN SELECT id FROM aquaterra_land_auctions WHERE status = 'open' AND ends_at < now() ORDER BY id LOOP
    PERFORM aquaterra_auction_settle(a);
  END LOOP;
END $fn$;

-- The Commonwealth tick calls this; it used to collect a yearly land tax every 30 days.
CREATE OR REPLACE FUNCTION aquaterra_gov_collect_land_tax() RETURNS void
LANGUAGE plpgsql AS $fn$
BEGIN
  IF to_regprocedure('aquaterra_fisc_tick()') IS NOT NULL THEN PERFORM aquaterra_fisc_tick(); END IF;
END $fn$;

-- ---------------------------------------------------------------- the bank

-- A loan against a plot (also used for mortgages). Pays the borrower from the bank.
CREATE OR REPLACE FUNCTION aquaterra_bank_lend(who text, k text, amount bigint, plot int, days int, rate numeric, repay numeric, note text, r text) RETURNS int
LANGUAGE plpgsql AS $fn$
DECLARE lid int;
BEGIN
  IF amount IS NULL OR amount < 1 THEN RAISE EXCEPTION 'amount'; END IF;
  IF aquaterra_balance('bank:first-light') - (SELECT COALESCE(sum(principal), 0) FROM aquaterra_bank_deposits) < amount THEN RAISE EXCEPTION 'bank_short'; END IF;
  INSERT INTO aquaterra_bank_loans (email, kind, principal, outstanding, rate_pct, repay_pct, collateral_plot, due_at, note, ref)
  VALUES (who, k, amount, amount, rate, repay, plot, now() + make_interval(days => days), note, r) RETURNING id INTO lid;
  PERFORM aquaterra_fisc_move('bank:first-light', who, amount, 'loan', plot, 'Loan #' || lid || ': ' || note, NULL, 'loan:' || lid);
  RETURN lid;
END $fn$;

-- For the building workflow: a mortgage for one level of a building on a plot the citizen owns.
-- cost: what the level costs; the bank lends up to mortgage_pct of it. Raises on refusal.
CREATE OR REPLACE FUNCTION aquaterra_bank_mortgage(who text, plot int, cost bigint, amount bigint, level_name text, r text) RETURNS int
LANGUAGE plpgsql AS $fn$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM aquaterra_plot_owners WHERE plot_id = plot AND owner = who) THEN RAISE EXCEPTION 'not_owner'; END IF;
  IF amount > floor(cost * aquaterra_fisc('mortgage_pct') / 100) THEN RAISE EXCEPTION 'too_much'; END IF;
  RETURN aquaterra_bank_lend(who, 'mortgage', amount, plot, 365, aquaterra_fisc('loan_rate_pct'), aquaterra_fisc('loan_repay_pct'),
    'Mortgage, ' || left(COALESCE(level_name, 'building'), 60), r);
END $fn$;

-- Founding of the bank: capital from the AquaTerra Reserve, then the Founder's loan (once).
DO $fn$
DECLARE f text; plot int; lid int;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM aquaterra_ledger WHERE kind = 'bank_capital') THEN
    PERFORM aquaterra_fisc_move('treasury', 'bank:first-light', 1000000, 'bank_capital', NULL, 'Capital of the Bank of First Light', NULL, 'bank:capital');
    PERFORM aquaterra_gov_log_add('bank', NULL, 'The Bank of First Light opened next to the Directorate with 1,000,000 TIDE of capital from the AquaTerra Reserve.');
  END IF;
  SELECT email INTO f FROM aquaterra_players WHERE role = 'founder' ORDER BY created_at LIMIT 1;
  IF f IS NOT NULL AND NOT EXISTS (SELECT 1 FROM aquaterra_bank_loans WHERE kind = 'founder') THEN
    SELECT plot_id INTO plot FROM aquaterra_plot_owners WHERE owner = f ORDER BY price_paid DESC, plot_id LIMIT 1;
    lid := aquaterra_bank_lend(f, 'founder', 50000, plot, 365, 0, 10, 'the Founder''s loan, no interest, 10% of income, 12 months', 'loan:founder');
    PERFORM aquaterra_gov_log_add('loan', NULL, format('Loan #%s: the Bank of First Light lent the Founder 50,000 TIDE for 12 months, without interest. 10%% of each of his incomes repays it.%s',
      lid, CASE WHEN plot IS NOT NULL THEN ' Pledge: ' || (SELECT address FROM aquaterra_plots WHERE id = plot) || '.' ELSE '' END));
    PERFORM aquaterra_notice(f, 'loan', 'The Bank of First Light paid you 50,000 TIDE: loan #' || lid || ', no interest, 12 months. 10% of each income repays it; you can also repay any time in the Bank.');
  END IF;
END $fn$;

-- ---------------------------------------------------------------- web API

CREATE OR REPLACE FUNCTION aquaterra_bank_laws() RETURNS jsonb
LANGUAGE sql STABLE AS $fn$
  SELECT jsonb_object_agg(key, value) FROM aquaterra_gov_params WHERE key IN ('income_tax_pct', 'salary_council', 'salary_directorate', 'salary_assembly',
    'salary_mayor', 'salary_nics_ai', 'land_tax_week_bp', 'land_tax_free_plots', 'debt_grace_days', 'debt_penalty_pct', 'debt_auction_days', 'auction_hours',
    'deal_duty_pct', 'fine_max', 'civic_bonus', 'deposit_rate_pct', 'loan_rate_pct', 'loan_ltv_pct', 'loan_repay_pct', 'loan_max_days', 'mortgage_pct',
    'sales_tax_pct', 'travel_tax_pct', 'arcade_prize_tax_pct', 'rent_tax_pct', 'arcade_entry_tax_pct')
$fn$;

CREATE OR REPLACE FUNCTION aquaterra_loan_json(l aquaterra_bank_loans) RETURNS jsonb
LANGUAGE sql STABLE AS $fn$
  SELECT jsonb_build_object('id', l.id, 'kind', l.kind, 'principal', l.principal, 'outstanding', l.outstanding, 'repaid', l.repaid,
    'ratePct', l.rate_pct, 'repayPct', l.repay_pct, 'openedAt', l.opened_at, 'dueAt', l.due_at, 'status', l.status, 'note', l.note,
    'plotId', l.collateral_plot, 'plot', (SELECT address FROM aquaterra_plots WHERE id = l.collateral_plot), 'borrower', aquaterra_name(l.email))
$fn$;

CREATE OR REPLACE FUNCTION aquaterra_auction_json(a aquaterra_land_auctions) RETURNS jsonb
LANGUAGE sql STABLE AS $fn$
  SELECT jsonb_build_object('id', a.id, 'plotId', a.plot_id, 'address', p.address, 'district', p.district, 'price', p.price,
    'reason', a.reason, 'minBid', a.min_bid, 'bestBid', a.best_bid, 'bestBidder', aquaterra_name(a.best_bidder), 'bids', a.bids,
    'endsAt', a.ends_at, 'status', a.status, 'seller', aquaterra_name(a.seller))
  FROM aquaterra_plots p WHERE p.id = a.plot_id
$fn$;

CREATE OR REPLACE FUNCTION aquaterra_bank_overview() RETURNS jsonb
LANGUAGE sql STABLE AS $fn$
  SELECT jsonb_build_object('ok', true, 'laws', aquaterra_bank_laws(),
    'bank', jsonb_build_object('reserves', aquaterra_balance('bank:first-light'),
      'deposits', (SELECT COALESCE(sum(principal), 0) FROM aquaterra_bank_deposits),
      'lent', (SELECT COALESCE(sum(outstanding), 0) FROM aquaterra_bank_loans WHERE status = 'open'),
      'loans', (SELECT count(*) FROM aquaterra_bank_loans WHERE status = 'open'),
      'savers', (SELECT count(*) FROM aquaterra_bank_deposits WHERE principal > 0)),
    'treasury', aquaterra_balance('state:treasury'),
    'nicsFund', aquaterra_balance('nics-ai'),
    'founderLoan', (SELECT aquaterra_loan_json(l) FROM aquaterra_bank_loans l WHERE kind = 'founder'),
    'payroll', COALESCE((SELECT jsonb_agg(jsonb_build_object('day', day, 'total', total, 'paid', paid, 'unpaid', unpaid) ORDER BY day DESC)
      FROM (SELECT * FROM aquaterra_fisc_runs WHERE kind = 'payroll' ORDER BY day DESC LIMIT 7) r), '[]'::jsonb),
    'landTax', (SELECT jsonb_build_object('week', day, 'total', total, 'paid', paid, 'unpaid', unpaid) FROM aquaterra_fisc_runs WHERE kind = 'land_tax' ORDER BY day DESC LIMIT 1),
    'auctions', COALESCE((SELECT jsonb_agg(aquaterra_auction_json(a) ORDER BY a.ends_at) FROM aquaterra_land_auctions a WHERE a.status = 'open'), '[]'::jsonb),
    'income30', jsonb_build_object(
      'incomeTax', (SELECT COALESCE(sum(amount), 0) FROM aquaterra_ledger WHERE kind = 'income_tax' AND at > now() - interval '30 days'),
      'landTax', (SELECT COALESCE(sum(amount), 0) FROM aquaterra_ledger WHERE kind = 'land_tax' AND to_account = 'state:treasury' AND at > now() - interval '30 days'),
      'duty', (SELECT COALESCE(sum(amount), 0) FROM aquaterra_ledger WHERE kind = 'duty' AND at > now() - interval '30 days'),
      'fines', (SELECT COALESCE(sum(amount), 0) FROM aquaterra_ledger WHERE kind = 'fine' AND at > now() - interval '30 days'),
      'otherTax', (SELECT COALESCE(sum(amount), 0) FROM aquaterra_ledger WHERE kind IN ('tax', 'fee') AND to_account = 'state:treasury' AND at > now() - interval '30 days'),
      'salaries', (SELECT COALESCE(sum(amount), 0) FROM aquaterra_ledger WHERE kind = 'salary' AND from_account = 'state:treasury' AND at > now() - interval '30 days'),
      'bonuses', (SELECT COALESCE(sum(amount), 0) FROM aquaterra_ledger WHERE kind = 'civic_bonus' AND at > now() - interval '30 days')))
$fn$;

CREATE OR REPLACE FUNCTION aquaterra_bank_me(me text) RETURNS jsonb
LANGUAGE sql STABLE AS $fn$
  SELECT jsonb_build_object('ok', true,
    'balance', aquaterra_balance(me), 'free', greatest(0, aquaterra_balance(me) - aquaterra_locked(me)),
    'deposit', COALESCE((SELECT jsonb_build_object('principal', principal, 'interestPaid', interest_paid) FROM aquaterra_bank_deposits WHERE email = me),
      jsonb_build_object('principal', 0, 'interestPaid', 0)),
    'loans', COALESCE((SELECT jsonb_agg(aquaterra_loan_json(l) ORDER BY l.id DESC) FROM aquaterra_bank_loans l WHERE l.email = me), '[]'::jsonb),
    'debts', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', id, 'kind', kind, 'amount', amount, 'paid', paid, 'reason', reason, 'createdAt', created_at,
      'status', status, 'penalized', penalized) ORDER BY id DESC) FROM aquaterra_debts WHERE email = me AND status IN ('open', 'auction')), '[]'::jsonb),
    'notices', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', id, 'at', at, 'kind', kind, 'text', text, 'read', read_at IS NOT NULL) ORDER BY id DESC)
      FROM (SELECT * FROM aquaterra_notices WHERE email = me ORDER BY id DESC LIMIT 20) n), '[]'::jsonb),
    'office', (SELECT CASE WHEN o.office IS NULL THEN NULL ELSE jsonb_build_object('office', o.office, 'salary', o.salary) END FROM aquaterra_fisc_office(me) o),
    'plots', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', o.plot_id, 'address', p.address, 'pricePaid', o.price_paid,
        'taxFree', o.k <= aquaterra_fisc('land_tax_free_plots'),
        'weeklyTax', CASE WHEN o.k <= aquaterra_fisc('land_tax_free_plots') THEN 0 ELSE greatest(1, round(o.price_paid * aquaterra_fisc('land_tax_week_bp') / 10000.0)) END,
        'pledged', EXISTS (SELECT 1 FROM aquaterra_bank_loans l WHERE l.collateral_plot = o.plot_id AND l.status = 'open'),
        'auction', EXISTS (SELECT 1 FROM aquaterra_land_auctions a WHERE a.plot_id = o.plot_id AND a.status = 'open'),
        'maxLoan', floor(o.price_paid * aquaterra_fisc('loan_ltv_pct') / 100)) ORDER BY o.k)
      FROM (SELECT *, row_number() OVER (ORDER BY bought_at, plot_id) k FROM aquaterra_plot_owners WHERE owner = me) o JOIN aquaterra_plots p ON p.id = o.plot_id), '[]'::jsonb),
    'votedThisMonth', EXISTS (SELECT 1 FROM aquaterra_gov_votes WHERE voter = me AND at > now() - interval '30 days'),
    'lastBonus', (SELECT max(at) FROM aquaterra_ledger WHERE kind = 'civic_bonus' AND to_account = me),
    'myBids', COALESCE((SELECT jsonb_agg(a.id) FROM aquaterra_land_auctions a WHERE a.status = 'open' AND a.best_bidder = me), '[]'::jsonb))
$fn$;

CREATE OR REPLACE FUNCTION aquaterra_bank(req jsonb) RETURNS jsonb
LANGUAGE plpgsql AS $fn$
DECLARE
  act text := req->>'action';
  me text; my_role text; amt bigint; v_free bigint; l aquaterra_bank_loans; a aquaterra_land_auctions; o aquaterra_plot_owners;
  who text; did bigint; days int; lid int; got bigint; res jsonb := '{}'::jsonb;
BEGIN
  IF act = 'overview' THEN RETURN aquaterra_bank_overview(); END IF;
  me := aquaterra_gov_session(req->>'session');
  IF me IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'session', 'status', 401); END IF;
  SELECT role INTO my_role FROM aquaterra_players WHERE email = me;

  BEGIN
    amt := (req->>'amount')::bigint;
    IF act = 'me' THEN RETURN aquaterra_bank_me(me);

    ELSIF act = 'deposit' THEN
      IF amt IS NULL OR amt < 1 THEN RAISE EXCEPTION 'amount'; END IF;
      IF greatest(0, aquaterra_balance(me) - aquaterra_locked(me)) < amt THEN RAISE EXCEPTION 'insufficient'; END IF;
      PERFORM aquaterra_fisc_move(me, 'bank:first-light', amt, 'deposit', NULL, 'Deposit', me, NULL);
      INSERT INTO aquaterra_bank_deposits (email, principal) VALUES (me, amt)
      ON CONFLICT (email) DO UPDATE SET principal = aquaterra_bank_deposits.principal + amt, updated_at = now();

    ELSIF act = 'withdraw' THEN
      IF amt IS NULL OR amt < 1 THEN RAISE EXCEPTION 'amount'; END IF;
      IF COALESCE((SELECT principal FROM aquaterra_bank_deposits WHERE email = me FOR UPDATE), 0) < amt THEN RAISE EXCEPTION 'insufficient'; END IF;
      UPDATE aquaterra_bank_deposits SET principal = principal - amt, updated_at = now() WHERE email = me;
      PERFORM aquaterra_fisc_move('bank:first-light', me, amt, 'withdraw', NULL, 'Withdrawal', me, NULL);

    ELSIF act = 'borrow' THEN
      SELECT * INTO o FROM aquaterra_plot_owners WHERE plot_id = (req->>'plotId')::int AND owner = me;
      IF o.plot_id IS NULL THEN RAISE EXCEPTION 'not_owner'; END IF;
      IF EXISTS (SELECT 1 FROM aquaterra_bank_loans WHERE collateral_plot = o.plot_id AND status = 'open') THEN RAISE EXCEPTION 'pledged'; END IF;
      IF EXISTS (SELECT 1 FROM aquaterra_land_auctions WHERE plot_id = o.plot_id AND status = 'open') THEN RAISE EXCEPTION 'auction'; END IF;
      IF EXISTS (SELECT 1 FROM aquaterra_debts WHERE email = me AND status IN ('open', 'auction')) THEN RAISE EXCEPTION 'debt'; END IF;
      IF amt IS NULL OR amt < 1 OR amt > floor(o.price_paid * aquaterra_fisc('loan_ltv_pct') / 100) THEN RAISE EXCEPTION 'too_much'; END IF;
      days := COALESCE((req->>'days')::int, 90);
      IF days < 7 OR days > aquaterra_fisc('loan_max_days') THEN RAISE EXCEPTION 'days'; END IF;
      lid := aquaterra_bank_lend(me, 'pledge', amt, o.plot_id, days, aquaterra_fisc('loan_rate_pct'), aquaterra_fisc('loan_repay_pct'),
        'pledge ' || (SELECT address FROM aquaterra_plots WHERE id = o.plot_id), NULL);
      res := jsonb_build_object('loanId', lid);

    ELSIF act = 'repay' THEN
      SELECT * INTO l FROM aquaterra_bank_loans WHERE id = (req->>'loanId')::int AND email = me AND status = 'open' FOR UPDATE;
      IF l.id IS NULL THEN RAISE EXCEPTION 'not_found'; END IF;
      amt := least(COALESCE(amt, l.outstanding), l.outstanding);
      IF amt < 1 THEN RAISE EXCEPTION 'amount'; END IF;
      IF greatest(0, aquaterra_balance(me) - aquaterra_locked(me)) < amt THEN RAISE EXCEPTION 'insufficient'; END IF;
      PERFORM aquaterra_fisc_move(me, 'bank:first-light', amt, 'loan_repay', NULL, 'Loan #' || l.id || ': repayment', me, 'loan:' || l.id || ':manual');
      UPDATE aquaterra_bank_loans SET outstanding = outstanding - amt, repaid = repaid + amt,
        status = CASE WHEN outstanding - amt = 0 THEN 'repaid' ELSE status END, closed_at = CASE WHEN outstanding - amt = 0 THEN now() END WHERE id = l.id;
      IF l.kind = 'founder' AND l.outstanding = amt THEN PERFORM aquaterra_gov_log_add('loan', NULL, format('Loan #%s: the Founder repaid the bank in full.', l.id)); END IF;

    ELSIF act = 'pay_debts' THEN
      got := 0;
      FOR did IN SELECT id FROM aquaterra_debts WHERE email = me AND status = 'open' ORDER BY id LOOP
        got := got + aquaterra_debt_collect(did);
      END LOOP;
      IF got = 0 THEN RAISE EXCEPTION 'insufficient'; END IF;
      res := jsonb_build_object('paid', got);

    ELSIF act = 'bid' THEN
      SELECT * INTO a FROM aquaterra_land_auctions WHERE id = (req->>'auctionId')::int AND status = 'open' FOR UPDATE;
      IF a.id IS NULL OR a.ends_at < now() THEN RAISE EXCEPTION 'closed'; END IF;
      IF a.seller = me THEN RAISE EXCEPTION 'self'; END IF;
      IF amt IS NULL OR amt < greatest(a.min_bid, COALESCE(a.best_bid + greatest(1, ceil(a.best_bid * 0.01)::bigint), 0)) THEN RAISE EXCEPTION 'low_bid'; END IF;
      IF (SELECT count(*) FROM aquaterra_plot_owners WHERE owner = me) >= aquaterra_param('max_plots_per_citizen') THEN RAISE EXCEPTION 'plot_limit'; END IF;
      -- the bid and its duty are held by the state; an outbid citizen gets both back at once
      got := CASE WHEN aquaterra_fisc('deal_duty_pct') > 0 THEN greatest(1, round(amt * aquaterra_fisc('deal_duty_pct') / 100.0))::bigint ELSE 0 END;
      IF greatest(0, aquaterra_balance(me) - aquaterra_locked(me)) < amt + got THEN RAISE EXCEPTION 'insufficient'; END IF;
      PERFORM aquaterra_fisc_move(me, 'state:escrow', amt + got, 'auction_bid', a.plot_id, 'Bid at the auction of plot #' || a.plot_id || ' (with duty)', me, 'auction:' || a.id || ':bid');
      IF a.best_bidder IS NOT NULL THEN
        PERFORM aquaterra_fisc_move('state:escrow', a.best_bidder, a.best_bid + a.best_duty, 'auction_refund', a.plot_id, 'Outbid at the auction of plot #' || a.plot_id, NULL, 'auction:' || a.id || ':refund');
        PERFORM aquaterra_notice(a.best_bidder, 'auction', format('You were outbid at the auction of plot #%s. Your %s TIDE are back in your wallet.', a.plot_id, a.best_bid + a.best_duty));
      END IF;
      UPDATE aquaterra_land_auctions SET best_bid = amt, best_duty = got, best_bidder = me, bids = bids + 1,
        ends_at = greatest(ends_at, now() + interval '10 minutes') WHERE id = a.id;

    ELSIF act = 'read_notices' THEN
      UPDATE aquaterra_notices SET read_at = now() WHERE email = me AND read_at IS NULL;

    ELSIF act = 'fine' THEN
      IF NOT (my_role IN ('founder', 'admin') OR aquaterra_gov_can_act(me, 'civic')) THEN RAISE EXCEPTION 'forbidden'; END IF;
      who := aquaterra_gov_find(req->>'to');
      IF who IS NULL THEN RAISE EXCEPTION 'no_citizen'; END IF;
      IF who = me THEN RAISE EXCEPTION 'self'; END IF;
      IF amt IS NULL OR amt < 1 OR amt > aquaterra_fisc('fine_max') THEN RAISE EXCEPTION 'amount'; END IF;
      IF length(btrim(COALESCE(req->>'reason', ''))) < 5 THEN RAISE EXCEPTION 'reason'; END IF;
      INSERT INTO aquaterra_debts (email, kind, amount, reason, actor) VALUES (who, 'fine', amt, left(btrim(req->>'reason'), 120), me) RETURNING id INTO did;
      PERFORM aquaterra_notice(who, 'fine', format('Fine of %s TIDE: %s. It is taken from your wallet as soon as you have the TIDE.', amt, left(btrim(req->>'reason'), 120)));
      got := aquaterra_debt_collect(did);
      PERFORM aquaterra_gov_log_add('fine', NULL, format('Fine of %s TIDE for %s: %s.', amt, aquaterra_name(who), left(btrim(req->>'reason'), 120)));
      res := jsonb_build_object('paid', got);

    ELSIF act = 'admin' THEN
      IF my_role NOT IN ('founder', 'admin') THEN RAISE EXCEPTION 'forbidden'; END IF;
      res := jsonb_build_object(
        'debts', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', id, 'citizen', aquaterra_name(email), 'kind', kind, 'amount', amount, 'paid', paid,
          'reason', reason, 'createdAt', created_at, 'status', status) ORDER BY id DESC) FROM aquaterra_debts WHERE status IN ('open', 'auction')), '[]'::jsonb),
        'loans', COALESCE((SELECT jsonb_agg(aquaterra_loan_json(x) ORDER BY x.id DESC) FROM aquaterra_bank_loans x WHERE x.status = 'open'), '[]'::jsonb),
        'officials', COALESCE((SELECT jsonb_agg(jsonb_build_object('citizen', aquaterra_name(e), 'office', (aquaterra_fisc_office(e)).office,
          'salary', (aquaterra_fisc_office(e)).salary) ORDER BY e) FROM (
            SELECT email e FROM aquaterra_council WHERE email IS NOT NULL UNION SELECT holder_email FROM aquaterra_gov_directorate WHERE holder_email IS NOT NULL
            UNION SELECT holder_email FROM aquaterra_gov_seats WHERE holder_email IS NOT NULL UNION SELECT mayor_email FROM aquaterra_districts WHERE mayor_email IS NOT NULL) x
          WHERE (aquaterra_fisc_office(e)).office IS NOT NULL), '[]'::jsonb));
    ELSE
      RAISE EXCEPTION 'action';
    END IF;
    RETURN jsonb_build_object('ok', true) || res || jsonb_build_object('me', aquaterra_bank_me(me) - 'ok');
  EXCEPTION
    WHEN invalid_text_representation OR numeric_value_out_of_range THEN
      RETURN jsonb_build_object('ok', false, 'error', 'amount', 'status', 400);
    WHEN raise_exception THEN
      RETURN jsonb_build_object('ok', false, 'error', SQLERRM,
        'status', CASE SQLERRM WHEN 'forbidden' THEN 403 WHEN 'not_found' THEN 404 ELSE 400 END);
  END;
END $fn$;

-- NICS AI rule E1 (taxes move at most 2 points at a time) now covers the new taxes.
DO $fn$
DECLARE src text;
BEGIN
  SELECT prosrc INTO src FROM pg_proc WHERE proname = 'aquaterra_gov_nics_ai';
  IF src IS NOT NULL AND position('IN (''land_tax_pct'', ''sales_tax_pct'')' IN src) > 0 THEN
    EXECUTE 'CREATE OR REPLACE FUNCTION aquaterra_gov_nics_ai(pid int) RETURNS TABLE (choice text, reason text) LANGUAGE plpgsql STABLE AS '
      || quote_literal(replace(src, 'IN (''land_tax_pct'', ''sales_tax_pct'')', 'IN (''sales_tax_pct'', ''income_tax_pct'', ''deal_duty_pct'', ''travel_tax_pct'')'));
  END IF;
END $fn$;
