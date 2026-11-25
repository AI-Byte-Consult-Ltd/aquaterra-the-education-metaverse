-- AquaTerra World: buying Tide. One-off migration (run once, never per request). Safe to run again.
-- Needs the account and economy tables. n8n runs this text: no double dollar quotes, no positional parameters.
--
-- Four ways to get Tide (rules here; n8n only talks to Revolut and to the Cronos chain):
--  1. card:   Revolut Merchant order (card, Apple Pay, Google Pay, Revolut Pay). Tide arrive when
--             Revolut says the order is completed for exactly our amount. Coins come from the Reserve.
--  2. crypto: USDT or CRO on Cronos to the project wallet. Every order has its own exact amount
--             (a few millionths added), so the transfer is matched by amount without asking who sent it.
--  3. market: residents sell Tide to residents for USDT on Cronos, paid straight to the seller's wallet.
--             Sold Tide wait in escrow ('market:escrow'); when the payment is seen on chain the buyer
--             gets them, minus the market fee to the State Treasury. The project never holds the money.
--  4. token:  withdraw Tide to Cronos as the TIDE token. Built, switched off (token_enabled = 0)
--             until the legal review.
-- Public API: aquaterra_exchange(req). Internal API for n8n only: aquaterra_exchange_internal(req).

CREATE TABLE IF NOT EXISTS aquaterra_exchange_params (key text PRIMARY KEY, value bigint NOT NULL, note text);
INSERT INTO aquaterra_exchange_params (key, value, note) VALUES
  ('card_enabled', 0, 'Card payments through Revolut on (1) or off (0)'),
  ('crypto_enabled', 0, 'USDT / CRO payments on Cronos on (1) or off (0); needs the deposit address'),
  ('market_enabled', 1, 'Resident-to-resident Tide market on (1) or off (0)'),
  ('token_enabled', 0, 'Withdraw Tide to Cronos as a token: off until the legal review'),
  ('pack_1_tide', 1000, 'Pack 1: TIDE'), ('pack_1_eur_cents', 499, 'Pack 1: price, euro cents'), ('pack_1_usdt_micro', 5500000, 'Pack 1: price, millionths of USDT'),
  ('pack_2_tide', 5000, 'Pack 2: TIDE'), ('pack_2_eur_cents', 1999, 'Pack 2: price, euro cents'), ('pack_2_usdt_micro', 22000000, 'Pack 2: price, millionths of USDT'),
  ('pack_3_tide', 25000, 'Pack 3: TIDE'), ('pack_3_eur_cents', 7999, 'Pack 3: price, euro cents'), ('pack_3_usdt_micro', 88000000, 'Pack 3: price, millionths of USDT'),
  ('card_daily_limit_cents', 50000, 'Most one resident can pay by card in 24 hours, euro cents'),
  ('crypto_order_minutes', 120, 'How long a crypto order waits for its transfer'),
  ('cro_usd_micro', 0, 'Price of 1 CRO in millionths of a US dollar (updated by the watcher)'),
  ('cro_rate_at', 0, 'When the CRO price was updated, unix seconds'),
  ('market_fee_bp', 200, 'Market fee in basis points of the Tide sold, to the State Treasury'),
  ('market_min_tide', 100, 'Smallest market offer or purchase'),
  ('market_pay_minutes', 60, 'How long a market buyer has to pay the seller'),
  ('token_fee_bp', 100, 'Withdrawal fee to the State Treasury, basis points'),
  ('token_min_tide', 1000, 'Smallest withdrawal')
ON CONFLICT (key) DO NOTHING;

CREATE TABLE IF NOT EXISTS aquaterra_exchange_settings (key text PRIMARY KEY, value text NOT NULL, updated_at timestamptz NOT NULL DEFAULT now());
-- USDT on Cronos (6 decimals). Changing it is a founder action.
INSERT INTO aquaterra_exchange_settings (key, value) VALUES ('usdt_contract', '0x66e428c3f67a68878562e79a0234c1f83c208770')
ON CONFLICT (key) DO NOTHING;

CREATE TABLE IF NOT EXISTS aquaterra_tide_orders (
  id bigserial PRIMARY KEY,
  account text NOT NULL,
  method text NOT NULL CHECK (method IN ('card', 'usdt', 'cro')),
  pack int NOT NULL,
  tide bigint NOT NULL CHECK (tide > 0),
  amount bigint NOT NULL CHECK (amount > 0),   -- card: euro cents; usdt / cro: millionths
  currency text NOT NULL,                      -- EUR | USDT | CRO
  pay_to text,                                 -- crypto: the project wallet (lower case)
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'credited', 'expired', 'cancelled', 'failed')),
  provider_id text UNIQUE,                     -- Revolut order id
  checkout_url text,
  tx_hash text,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  credited_at timestamptz,
  ledger_id bigint
);
CREATE INDEX IF NOT EXISTS aquaterra_tide_orders_account ON aquaterra_tide_orders (account, id DESC);
CREATE UNIQUE INDEX IF NOT EXISTS aquaterra_tide_orders_open_amount ON aquaterra_tide_orders (currency, amount) WHERE status = 'pending' AND method <> 'card';

CREATE TABLE IF NOT EXISTS aquaterra_market_offers (
  id bigserial PRIMARY KEY,
  seller text NOT NULL,
  tide_total bigint NOT NULL CHECK (tide_total > 0),
  tide_left bigint NOT NULL CHECK (tide_left >= 0),     -- not sold and not waiting for a payment
  price_micro bigint NOT NULL CHECK (price_micro > 0),  -- millionths of USDT per 1 000 TIDE
  pay_address text NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz
);
CREATE INDEX IF NOT EXISTS aquaterra_market_offers_open ON aquaterra_market_offers (price_micro) WHERE status = 'open';

CREATE TABLE IF NOT EXISTS aquaterra_market_trades (
  id bigserial PRIMARY KEY,
  offer_id bigint NOT NULL REFERENCES aquaterra_market_offers (id),
  seller text NOT NULL,
  buyer text NOT NULL,
  tide bigint NOT NULL CHECK (tide > 0),
  amount bigint NOT NULL CHECK (amount > 0),            -- exact USDT to pay, millionths
  pay_to text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'expired', 'cancelled')),
  fee bigint NOT NULL DEFAULT 0,
  tx_hash text,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  paid_at timestamptz
);
CREATE INDEX IF NOT EXISTS aquaterra_market_trades_buyer ON aquaterra_market_trades (buyer, id DESC);
CREATE UNIQUE INDEX IF NOT EXISTS aquaterra_market_trades_open_amount ON aquaterra_market_trades (pay_to, amount) WHERE status = 'pending';

-- Every on-chain transfer the watcher has seen, matched or not (unmatched ones are for the founder to review).
CREATE TABLE IF NOT EXISTS aquaterra_chain_transfers (
  tx_hash text NOT NULL,
  log_index int NOT NULL,               -- -1 for a native CRO transfer
  token text NOT NULL,                  -- USDT | CRO
  from_address text,
  to_address text NOT NULL,
  amount numeric NOT NULL,              -- in the token's smallest unit (USDT 1e-6, CRO wei)
  block bigint,
  seen_at timestamptz NOT NULL DEFAULT now(),
  matched text,                         -- 'order:12' | 'trade:7' | NULL
  PRIMARY KEY (tx_hash, log_index)
);

CREATE TABLE IF NOT EXISTS aquaterra_chain_state (key text PRIMARY KEY, value bigint NOT NULL);

CREATE TABLE IF NOT EXISTS aquaterra_token_withdrawals (
  id bigserial PRIMARY KEY,
  account text NOT NULL,
  tide bigint NOT NULL CHECK (tide > 0),
  fee bigint NOT NULL,
  address text NOT NULL,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sent', 'failed')),
  tx_hash text,
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO aquaterra_wallets (account, welcomed_at) VALUES ('market:escrow', now()), ('bridge:cronos', now()) ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION aquaterra_xp(k text) RETURNS bigint LANGUAGE sql STABLE AS
$fn$ SELECT value FROM aquaterra_exchange_params WHERE key = k $fn$;
CREATE OR REPLACE FUNCTION aquaterra_xs(k text) RETURNS text LANGUAGE sql STABLE AS
$fn$ SELECT value FROM aquaterra_exchange_settings WHERE key = k $fn$;

-- Coins a resident may sell or withdraw: welcome coins are for land only.
CREATE OR REPLACE FUNCTION aquaterra_x_free(acct text) RETURNS bigint LANGUAGE sql STABLE AS $fn$
  SELECT greatest(0, COALESCE((SELECT balance FROM aquaterra_wallets WHERE account = acct), 0) - aquaterra_locked(acct))
$fn$;

CREATE OR REPLACE FUNCTION aquaterra_x_order_json(o aquaterra_tide_orders) RETURNS jsonb LANGUAGE sql STABLE AS $fn$
  SELECT jsonb_build_object('id', o.id, 'method', o.method, 'pack', o.pack, 'tide', o.tide, 'amount', o.amount,
    'currency', o.currency, 'payTo', o.pay_to, 'status', o.status, 'checkoutUrl', o.checkout_url,
    'createdAt', o.created_at, 'expiresAt', o.expires_at, 'txHash', o.tx_hash)
$fn$;

CREATE OR REPLACE FUNCTION aquaterra_x_trade_json(t aquaterra_market_trades, me text) RETURNS jsonb LANGUAGE sql STABLE AS $fn$
  SELECT jsonb_build_object('id', t.id, 'offerId', t.offer_id, 'tide', t.tide, 'amount', t.amount, 'payTo', t.pay_to,
    'status', t.status, 'fee', t.fee, 'mine', t.buyer = me, 'seller', aquaterra_name(t.seller), 'buyer', aquaterra_name(t.buyer),
    'createdAt', t.created_at, 'expiresAt', t.expires_at, 'txHash', t.tx_hash)
$fn$;

-- A free exact amount: base + 1..9999 millionths, not used by any open order or trade to the same address.
CREATE OR REPLACE FUNCTION aquaterra_x_unique_amount(base bigint, cur text, addr text) RETURNS bigint LANGUAGE plpgsql AS $fn$
DECLARE a bigint;
BEGIN
  FOR i IN 1..40 LOOP
    a := base + 1 + floor(random() * 9999)::bigint;
    IF NOT EXISTS (SELECT 1 FROM aquaterra_tide_orders WHERE status = 'pending' AND currency = cur AND amount = a)
       AND NOT EXISTS (SELECT 1 FROM aquaterra_market_trades WHERE status = 'pending' AND pay_to = addr AND amount = a) THEN
      RETURN a;
    END IF;
  END LOOP;
  RAISE EXCEPTION 'busy';
END $fn$;

-- Close what has run out of time. Expired trades give their Tide back to the offer (or the seller).
CREATE OR REPLACE FUNCTION aquaterra_x_expire() RETURNS void LANGUAGE plpgsql AS $fn$
DECLARE t aquaterra_market_trades%ROWTYPE; o aquaterra_market_offers%ROWTYPE;
BEGIN
  UPDATE aquaterra_tide_orders SET status = 'expired' WHERE status = 'pending' AND expires_at < now();
  FOR t IN SELECT * FROM aquaterra_market_trades WHERE status = 'pending' AND expires_at < now() FOR UPDATE LOOP
    UPDATE aquaterra_market_trades SET status = 'expired' WHERE id = t.id;
    SELECT * INTO o FROM aquaterra_market_offers WHERE id = t.offer_id FOR UPDATE;
    IF o.status = 'open' THEN
      UPDATE aquaterra_market_offers SET tide_left = tide_left + t.tide WHERE id = o.id;
    ELSE
      PERFORM aquaterra_move('market:escrow', t.seller, t.tide, 'market_return', NULL, 'Tide Market: unpaid, returned', NULL);
    END IF;
  END LOOP;
END $fn$;

-- Credit one paid order (only once).
CREATE OR REPLACE FUNCTION aquaterra_x_credit(oid bigint, tx text) RETURNS boolean LANGUAGE plpgsql AS $fn$
DECLARE o aquaterra_tide_orders%ROWTYPE; lid bigint;
BEGIN
  SELECT * INTO o FROM aquaterra_tide_orders WHERE id = oid FOR UPDATE;
  IF o.id IS NULL OR o.status = 'credited' THEN RETURN false; END IF;
  INSERT INTO aquaterra_wallets (account) VALUES (o.account) ON CONFLICT DO NOTHING;
  lid := aquaterra_move('treasury', o.account, o.tide, 'tide_purchase', NULL,
    'Bought ' || o.tide || ' TIDE (' || CASE o.method WHEN 'card' THEN 'card' ELSE o.currency END || ')', o.account);
  UPDATE aquaterra_ledger SET ref = 'order:' || o.id WHERE id = lid;
  UPDATE aquaterra_tide_orders SET status = 'credited', credited_at = now(), tx_hash = COALESCE(tx, tx_hash), ledger_id = lid WHERE id = o.id;
  RETURN true;
END $fn$;

-- Settle one paid market trade: escrow -> buyer, fee -> State Treasury.
CREATE OR REPLACE FUNCTION aquaterra_x_settle_trade(tid bigint, tx text) RETURNS boolean LANGUAGE plpgsql AS $fn$
DECLARE t aquaterra_market_trades%ROWTYPE; o aquaterra_market_offers%ROWTYPE; v_fee bigint;
BEGIN
  SELECT * INTO t FROM aquaterra_market_trades WHERE id = tid FOR UPDATE;
  IF t.id IS NULL OR t.status = 'paid' THEN RETURN false; END IF;
  IF t.status <> 'pending' THEN
    -- Paid late: take the Tide back from the offer if they are still there.
    SELECT * INTO o FROM aquaterra_market_offers WHERE id = t.offer_id FOR UPDATE;
    IF o.status <> 'open' OR o.tide_left < t.tide THEN RETURN false; END IF;
    UPDATE aquaterra_market_offers SET tide_left = tide_left - t.tide WHERE id = o.id;
  END IF;
  v_fee := t.tide * aquaterra_xp('market_fee_bp') / 10000;
  INSERT INTO aquaterra_wallets (account) VALUES (t.buyer) ON CONFLICT DO NOTHING;
  PERFORM aquaterra_move('market:escrow', t.buyer, t.tide - v_fee, 'market_buy', NULL, 'Tide Market: from ' || aquaterra_name(t.seller), t.buyer);
  IF v_fee > 0 THEN
    PERFORM aquaterra_move('market:escrow', 'state:treasury', v_fee, 'fee', NULL, 'Tide Market fee', NULL);
  END IF;
  UPDATE aquaterra_market_trades SET status = 'paid', paid_at = now(), fee = v_fee, tx_hash = tx WHERE id = t.id;
  UPDATE aquaterra_market_offers SET status = 'closed', closed_at = now()
  WHERE id = t.offer_id AND status = 'open' AND tide_left = 0
    AND NOT EXISTS (SELECT 1 FROM aquaterra_market_trades WHERE offer_id = t.offer_id AND status = 'pending');
  RETURN true;
END $fn$;

-- Public API. req: {action, session, ...}. Returns {ok, ...} or {ok:false, error, status}.
CREATE OR REPLACE FUNCTION aquaterra_exchange(req jsonb) RETURNS jsonb LANGUAGE plpgsql AS $fn$
DECLARE
  act text := req->>'action';
  me text; my_role text;
  res jsonb := '{}'::jsonb;
  v_pack int; v_tide bigint; v_amt bigint; v_n bigint; v_addr text; v_cur text;
  o aquaterra_tide_orders%ROWTYPE; mo aquaterra_market_offers%ROWTYPE; tr aquaterra_market_trades%ROWTYPE;
  v_rate bigint;
BEGIN
  IF coalesce(req->>'session', '') <> '' THEN
    SELECT p.email, p.role INTO me, my_role
    FROM aquaterra_sessions s JOIN aquaterra_players p ON p.email = s.email
    WHERE s.token_hash = encode(sha256(convert_to(req->>'session', 'UTF8')), 'hex') AND s.expires_at > now();
  END IF;
  IF act <> 'offers' AND me IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'session', 'status', 401);
  END IF;

  BEGIN
    PERFORM aquaterra_x_expire();
    v_pack := (req->>'pack')::int;

    IF act = 'offers' THEN
      v_rate := CASE WHEN aquaterra_xp('cro_rate_at') > extract(epoch FROM now()) - 3600 THEN aquaterra_xp('cro_usd_micro') ELSE 0 END;
      res := jsonb_build_object(
        'card', aquaterra_xp('card_enabled') = 1,
        'crypto', aquaterra_xp('crypto_enabled') = 1 AND aquaterra_xs('deposit_address') IS NOT NULL,
        'cro', v_rate > 0,
        'croUsdMicro', v_rate,
        'market', aquaterra_xp('market_enabled') = 1,
        'token', aquaterra_xp('token_enabled') = 1,
        'marketFeeBp', aquaterra_xp('market_fee_bp'),
        'marketMin', aquaterra_xp('market_min_tide'),
        'marketPayMinutes', aquaterra_xp('market_pay_minutes'),
        'tokenFeeBp', aquaterra_xp('token_fee_bp'),
        'tokenMin', aquaterra_xp('token_min_tide'),
        'packs', (SELECT jsonb_agg(jsonb_build_object('pack', i, 'tide', aquaterra_xp('pack_' || i || '_tide'),
                    'eurCents', aquaterra_xp('pack_' || i || '_eur_cents'), 'usdtMicro', aquaterra_xp('pack_' || i || '_usdt_micro'),
                    'croMicro', CASE WHEN v_rate > 0 THEN ceil(aquaterra_xp('pack_' || i || '_usdt_micro')::numeric * 1000000 / v_rate)::bigint END)
                    ORDER BY i) FROM generate_series(1, 3) i),
        'market_offers', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', m.id, 'seller', aquaterra_name(m.seller), 'mine', m.seller = me,
                    'tide', m.tide_left, 'priceMicro', m.price_micro, 'createdAt', m.created_at) ORDER BY m.price_micro, m.id)
                    FROM (SELECT * FROM aquaterra_market_offers WHERE status = 'open' AND (tide_left > 0 OR seller = me) ORDER BY price_micro, id LIMIT 60) m), '[]'::jsonb));
      IF me IS NOT NULL THEN
        res := res || jsonb_build_object(
          'free', aquaterra_x_free(me),
          'orders', COALESCE((SELECT jsonb_agg(aquaterra_x_order_json(x) ORDER BY x.id DESC)
                     FROM (SELECT * FROM aquaterra_tide_orders WHERE account = me ORDER BY id DESC LIMIT 10) x), '[]'::jsonb),
          'trades', COALESCE((SELECT jsonb_agg(aquaterra_x_trade_json(x, me) ORDER BY x.id DESC)
                     FROM (SELECT * FROM aquaterra_market_trades WHERE buyer = me OR seller = me ORDER BY id DESC LIMIT 20) x), '[]'::jsonb),
          'withdrawals', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', w.id, 'tide', w.tide, 'fee', w.fee, 'address', w.address,
                     'status', w.status, 'txHash', w.tx_hash, 'createdAt', w.created_at) ORDER BY w.id DESC)
                     FROM (SELECT * FROM aquaterra_token_withdrawals WHERE account = me ORDER BY id DESC LIMIT 10) w), '[]'::jsonb));
      END IF;

    ELSIF act = 'buy_card' THEN
      IF aquaterra_xp('card_enabled') <> 1 THEN RAISE EXCEPTION 'disabled'; END IF;
      IF v_pack NOT BETWEEN 1 AND 3 THEN RAISE EXCEPTION 'pack'; END IF;
      PERFORM 1 FROM aquaterra_wallets WHERE account = me FOR UPDATE;
      v_amt := aquaterra_xp('pack_' || v_pack || '_eur_cents');
      IF COALESCE((SELECT sum(amount) FROM aquaterra_tide_orders WHERE account = me AND method = 'card'
                   AND status IN ('pending', 'credited') AND created_at > now() - interval '24 hours'), 0) + v_amt
         > aquaterra_xp('card_daily_limit_cents') THEN
        RAISE EXCEPTION 'limit';
      END IF;
      INSERT INTO aquaterra_tide_orders (account, method, pack, tide, amount, currency, expires_at)
      VALUES (me, 'card', v_pack, aquaterra_xp('pack_' || v_pack || '_tide'), v_amt, 'EUR', now() + interval '24 hours')
      RETURNING * INTO o;
      -- n8n creates the Revolut order next and attaches it (aquaterra_exchange_internal card_attach).
      res := jsonb_build_object('order', aquaterra_x_order_json(o), 'next', 'revolut_create',
        'description', o.tide || ' TIDE for AquaTerra World', 'email', me);

    ELSIF act = 'order' THEN
      SELECT * INTO o FROM aquaterra_tide_orders WHERE id = (req->>'id')::bigint AND account = me;
      IF o.id IS NULL THEN RAISE EXCEPTION 'not_found'; END IF;
      res := jsonb_build_object('order', aquaterra_x_order_json(o));
      IF o.method = 'card' AND o.status = 'pending' AND o.provider_id IS NOT NULL THEN
        res := res || jsonb_build_object('next', 'revolut_check', 'providerId', o.provider_id);
      END IF;

    ELSIF act = 'buy_crypto' THEN
      IF aquaterra_xp('crypto_enabled') <> 1 OR aquaterra_xs('deposit_address') IS NULL THEN RAISE EXCEPTION 'disabled'; END IF;
      IF v_pack NOT BETWEEN 1 AND 3 THEN RAISE EXCEPTION 'pack'; END IF;
      v_cur := upper(req->>'coin');
      IF v_cur NOT IN ('USDT', 'CRO') THEN RAISE EXCEPTION 'coin'; END IF;
      PERFORM 1 FROM aquaterra_wallets WHERE account = me FOR UPDATE;
      IF (SELECT count(*) FROM aquaterra_tide_orders WHERE account = me AND status = 'pending' AND method <> 'card') >= 3 THEN
        RAISE EXCEPTION 'too_many';
      END IF;
      v_amt := aquaterra_xp('pack_' || v_pack || '_usdt_micro');
      IF v_cur = 'CRO' THEN
        v_rate := CASE WHEN aquaterra_xp('cro_rate_at') > extract(epoch FROM now()) - 3600 THEN aquaterra_xp('cro_usd_micro') ELSE 0 END;
        IF v_rate <= 0 THEN RAISE EXCEPTION 'no_rate'; END IF;
        -- whole thousandths of CRO, then the unique tail in millionths
        v_amt := ceil(v_amt::numeric * 1000 / v_rate)::bigint * 1000;
      END IF;
      v_addr := aquaterra_xs('deposit_address');
      INSERT INTO aquaterra_tide_orders (account, method, pack, tide, amount, currency, pay_to, expires_at)
      VALUES (me, lower(v_cur), v_pack, aquaterra_xp('pack_' || v_pack || '_tide'), aquaterra_x_unique_amount(v_amt, v_cur, v_addr), v_cur,
              v_addr, now() + make_interval(mins => aquaterra_xp('crypto_order_minutes')::int))
      RETURNING * INTO o;
      res := jsonb_build_object('order', aquaterra_x_order_json(o));

    ELSIF act = 'cancel' THEN
      UPDATE aquaterra_tide_orders SET status = 'cancelled'
      WHERE id = (req->>'id')::bigint AND account = me AND status = 'pending' AND method <> 'card' RETURNING * INTO o;
      IF o.id IS NULL THEN RAISE EXCEPTION 'not_found'; END IF;
      res := jsonb_build_object('order', aquaterra_x_order_json(o));

    ELSIF act = 'market_sell' THEN
      IF aquaterra_xp('market_enabled') <> 1 THEN RAISE EXCEPTION 'disabled'; END IF;
      v_tide := (req->>'tide')::bigint; v_amt := (req->>'priceMicro')::bigint; v_addr := lower(btrim(req->>'address'));
      IF v_tide IS NULL OR v_tide < aquaterra_xp('market_min_tide') OR v_tide > 100000000 THEN RAISE EXCEPTION 'amount'; END IF;
      IF v_amt IS NULL OR v_amt < 1000 OR v_amt > 1000000000000 THEN RAISE EXCEPTION 'price'; END IF;
      IF v_addr IS NULL OR v_addr !~ '^0x[0-9a-f]{40}$' OR v_addr = '0x' || repeat('0', 40) THEN RAISE EXCEPTION 'address'; END IF;
      IF v_addr = lower(COALESCE(aquaterra_xs('deposit_address'), '')) THEN RAISE EXCEPTION 'address'; END IF;
      PERFORM 1 FROM aquaterra_wallets WHERE account = me FOR UPDATE;
      IF (SELECT count(*) FROM aquaterra_market_offers WHERE seller = me AND status = 'open') >= 5 THEN RAISE EXCEPTION 'too_many'; END IF;
      IF aquaterra_x_free(me) < v_tide THEN RAISE EXCEPTION 'insufficient'; END IF;
      INSERT INTO aquaterra_market_offers (seller, tide_total, tide_left, price_micro, pay_address)
      VALUES (me, v_tide, v_tide, v_amt, v_addr) RETURNING * INTO mo;
      PERFORM aquaterra_move(me, 'market:escrow', v_tide, 'market_escrow', NULL, 'Tide Market: offer #' || mo.id, me);
      res := jsonb_build_object('offerId', mo.id);

    ELSIF act = 'market_cancel' THEN
      SELECT * INTO mo FROM aquaterra_market_offers WHERE id = (req->>'id')::bigint AND seller = me AND status = 'open' FOR UPDATE;
      IF mo.id IS NULL THEN RAISE EXCEPTION 'not_found'; END IF;
      UPDATE aquaterra_market_offers SET status = 'closed', closed_at = now(), tide_left = 0 WHERE id = mo.id;
      IF mo.tide_left > 0 THEN
        PERFORM aquaterra_move('market:escrow', me, mo.tide_left, 'market_return', NULL, 'Tide Market: offer #' || mo.id || ' withdrawn', me);
      END IF;
      res := jsonb_build_object('returned', mo.tide_left);

    ELSIF act = 'market_buy' THEN
      IF aquaterra_xp('market_enabled') <> 1 THEN RAISE EXCEPTION 'disabled'; END IF;
      SELECT * INTO mo FROM aquaterra_market_offers WHERE id = (req->>'id')::bigint AND status = 'open' FOR UPDATE;
      IF mo.id IS NULL THEN RAISE EXCEPTION 'not_found'; END IF;
      IF mo.seller = me THEN RAISE EXCEPTION 'self'; END IF;
      v_tide := (req->>'tide')::bigint;
      IF v_tide IS NULL OR v_tide < 1 OR v_tide > mo.tide_left THEN RAISE EXCEPTION 'amount'; END IF;
      IF v_tide < aquaterra_xp('market_min_tide') AND v_tide <> mo.tide_left THEN RAISE EXCEPTION 'amount'; END IF;
      IF (SELECT count(*) FROM aquaterra_market_trades WHERE buyer = me AND status = 'pending') >= 2 THEN RAISE EXCEPTION 'too_many'; END IF;
      v_amt := ceil(v_tide::numeric * mo.price_micro / 1000 / 10000)::bigint * 10000;  -- whole cents, then the unique tail
      INSERT INTO aquaterra_market_trades (offer_id, seller, buyer, tide, amount, pay_to, expires_at)
      VALUES (mo.id, mo.seller, me, v_tide, aquaterra_x_unique_amount(v_amt, 'USDT', mo.pay_address), mo.pay_address,
              now() + make_interval(mins => aquaterra_xp('market_pay_minutes')::int))
      RETURNING * INTO tr;
      UPDATE aquaterra_market_offers SET tide_left = tide_left - v_tide WHERE id = mo.id;
      res := jsonb_build_object('trade', aquaterra_x_trade_json(tr, me));

    ELSIF act = 'market_drop' THEN
      -- the buyer changed their mind before paying
      SELECT * INTO tr FROM aquaterra_market_trades WHERE id = (req->>'id')::bigint AND buyer = me AND status = 'pending' FOR UPDATE;
      IF tr.id IS NULL THEN RAISE EXCEPTION 'not_found'; END IF;
      UPDATE aquaterra_market_trades SET status = 'cancelled' WHERE id = tr.id;
      SELECT * INTO mo FROM aquaterra_market_offers WHERE id = tr.offer_id FOR UPDATE;
      IF mo.status = 'open' THEN
        UPDATE aquaterra_market_offers SET tide_left = tide_left + tr.tide WHERE id = mo.id;
      ELSE
        PERFORM aquaterra_move('market:escrow', tr.seller, tr.tide, 'market_return', NULL, 'Tide Market: unpaid, returned', NULL);
      END IF;

    ELSIF act = 'withdraw' THEN
      IF aquaterra_xp('token_enabled') <> 1 THEN RAISE EXCEPTION 'disabled'; END IF;
      v_tide := (req->>'tide')::bigint; v_addr := lower(btrim(req->>'address'));
      IF v_tide IS NULL OR v_tide < aquaterra_xp('token_min_tide') OR v_tide > 100000000 THEN RAISE EXCEPTION 'amount'; END IF;
      IF v_addr IS NULL OR v_addr !~ '^0x[0-9a-f]{40}$' THEN RAISE EXCEPTION 'address'; END IF;
      PERFORM 1 FROM aquaterra_wallets WHERE account = me FOR UPDATE;
      v_n := greatest(1, v_tide * aquaterra_xp('token_fee_bp') / 10000);
      IF aquaterra_x_free(me) < v_tide + v_n THEN RAISE EXCEPTION 'insufficient'; END IF;
      PERFORM aquaterra_move(me, 'bridge:cronos', v_tide, 'token_withdraw', NULL, 'To Cronos ' || left(v_addr, 10) || '…', me);
      PERFORM aquaterra_move(me, 'state:treasury', v_n, 'fee', NULL, 'Withdrawal fee', me);
      INSERT INTO aquaterra_token_withdrawals (account, tide, fee, address) VALUES (me, v_tide, v_n, v_addr);
      res := jsonb_build_object('tide', v_tide, 'fee', v_n);

    ELSIF act IN ('admin', 'admin_param', 'admin_setting') THEN
      IF my_role NOT IN ('founder', 'admin') THEN RAISE EXCEPTION 'forbidden'; END IF;
      IF act <> 'admin' AND my_role <> 'founder' THEN RAISE EXCEPTION 'forbidden'; END IF;
      IF act = 'admin_param' THEN
        IF req->>'key' NOT IN (SELECT key FROM aquaterra_exchange_params) OR req->>'key' IN ('cro_usd_micro', 'cro_rate_at') THEN RAISE EXCEPTION 'param'; END IF;
        v_amt := (req->>'value')::bigint;
        IF v_amt IS NULL OR v_amt < 0 OR v_amt > 1000000000000 THEN RAISE EXCEPTION 'amount'; END IF;
        IF req->>'key' LIKE '%_enabled' AND v_amt > 1 THEN RAISE EXCEPTION 'amount'; END IF;
        UPDATE aquaterra_exchange_params SET value = v_amt WHERE key = req->>'key';
      ELSIF act = 'admin_setting' THEN
        v_addr := lower(btrim(req->>'value'));
        IF req->>'key' NOT IN ('deposit_address', 'usdt_contract', 'token_contract') THEN RAISE EXCEPTION 'param'; END IF;
        IF v_addr !~ '^0x[0-9a-f]{40}$' THEN RAISE EXCEPTION 'address'; END IF;
        INSERT INTO aquaterra_exchange_settings (key, value) VALUES (req->>'key', v_addr)
        ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();
      END IF;
      res := jsonb_build_object(
        'params', (SELECT jsonb_object_agg(key, value) FROM aquaterra_exchange_params),
        'settings', COALESCE((SELECT jsonb_object_agg(key, value) FROM aquaterra_exchange_settings), '{}'::jsonb),
        'sold', jsonb_build_object(
          'card', (SELECT jsonb_build_object('orders', count(*), 'tide', COALESCE(sum(tide), 0), 'eurCents', COALESCE(sum(amount), 0)) FROM aquaterra_tide_orders WHERE status = 'credited' AND method = 'card'),
          'usdt', (SELECT jsonb_build_object('orders', count(*), 'tide', COALESCE(sum(tide), 0), 'micro', COALESCE(sum(amount), 0)) FROM aquaterra_tide_orders WHERE status = 'credited' AND method = 'usdt'),
          'cro', (SELECT jsonb_build_object('orders', count(*), 'tide', COALESCE(sum(tide), 0), 'micro', COALESCE(sum(amount), 0)) FROM aquaterra_tide_orders WHERE status = 'credited' AND method = 'cro'),
          'market', (SELECT jsonb_build_object('trades', count(*), 'tide', COALESCE(sum(tide), 0), 'fees', COALESCE(sum(fee), 0)) FROM aquaterra_market_trades WHERE status = 'paid')),
        'escrow', (SELECT balance FROM aquaterra_wallets WHERE account = 'market:escrow'),
        'orders', COALESCE((SELECT jsonb_agg(aquaterra_x_order_json(x) || jsonb_build_object('who', aquaterra_name(x.account)) ORDER BY x.id DESC)
                   FROM (SELECT * FROM aquaterra_tide_orders ORDER BY id DESC LIMIT 40) x), '[]'::jsonb),
        'unmatched', COALESCE((SELECT jsonb_agg(jsonb_build_object('tx', c.tx_hash, 'token', c.token, 'from', c.from_address, 'to', c.to_address,
                   'amount', c.amount::text, 'seenAt', c.seen_at) ORDER BY c.seen_at DESC)
                   FROM (SELECT * FROM aquaterra_chain_transfers WHERE matched IS NULL ORDER BY seen_at DESC LIMIT 30) c), '[]'::jsonb),
        'lastBlock', (SELECT value FROM aquaterra_chain_state WHERE key = 'last_block'));
    ELSE
      RAISE EXCEPTION 'action';
    END IF;
  EXCEPTION
    WHEN raise_exception THEN
      RETURN jsonb_build_object('ok', false, 'error', SQLERRM,
        'status', CASE SQLERRM WHEN 'forbidden' THEN 403 WHEN 'not_found' THEN 404 WHEN 'treasury_empty' THEN 503 ELSE 400 END);
    WHEN invalid_text_representation OR numeric_value_out_of_range THEN
      RETURN jsonb_build_object('ok', false, 'error', 'amount', 'status', 400);
  END;
  RETURN jsonb_build_object('ok', true, 'status', 200) || res;
END $fn$;

-- Internal API, called only by n8n after it has talked to Revolut or the chain. Never exposed to the browser.
CREATE OR REPLACE FUNCTION aquaterra_exchange_internal(req jsonb) RETURNS jsonb LANGUAGE plpgsql AS $fn$
DECLARE
  act text := req->>'action';
  o aquaterra_tide_orders%ROWTYPE; tr aquaterra_market_trades%ROWTYPE;
  e jsonb; v_amt numeric; v_to text; v_tok text; v_match text; credited int := 0; seen int := 0;
BEGIN
  IF act = 'card_attach' THEN
    UPDATE aquaterra_tide_orders SET provider_id = req->>'providerId', checkout_url = req->>'checkoutUrl'
    WHERE id = (req->>'id')::bigint AND method = 'card' AND status = 'pending' AND provider_id IS NULL RETURNING * INTO o;
    IF o.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'not_found', 'status', 404); END IF;
    RETURN jsonb_build_object('ok', true, 'status', 200, 'order', aquaterra_x_order_json(o));

  ELSIF act = 'card_failed' THEN
    UPDATE aquaterra_tide_orders SET status = 'failed' WHERE id = (req->>'id')::bigint AND method = 'card' AND status = 'pending';
    RETURN jsonb_build_object('ok', false, 'error', 'provider', 'status', 502);

  ELSIF act = 'card_settle' THEN
    -- Revolut's own answer about its order: credit only a completed order for exactly our amount and currency.
    SELECT * INTO o FROM aquaterra_tide_orders WHERE provider_id = req->>'providerId' AND method = 'card' FOR UPDATE;
    IF o.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'not_found', 'status', 404); END IF;
    IF o.status IN ('pending', 'expired') AND lower(req->>'state') = 'completed'
       AND (req->>'amount')::bigint = o.amount AND upper(req->>'currency') = o.currency THEN
      PERFORM aquaterra_x_credit(o.id, NULL);
    ELSIF o.status = 'pending' AND lower(req->>'state') IN ('cancelled', 'failed') THEN
      UPDATE aquaterra_tide_orders SET status = 'failed' WHERE id = o.id;
    END IF;
    SELECT * INTO o FROM aquaterra_tide_orders WHERE id = o.id;
    RETURN jsonb_build_object('ok', true, 'status', 200, 'order', aquaterra_x_order_json(o));

  ELSIF act = 'scan_plan' THEN
    PERFORM aquaterra_x_expire();
    RETURN jsonb_build_object('ok', true,
      'lastBlock', (SELECT value FROM aquaterra_chain_state WHERE key = 'last_block'),
      'usdtContract', aquaterra_xs('usdt_contract'),
      'deposit', aquaterra_xs('deposit_address'),
      -- every address a payment may arrive at: the project wallet (orders) and sellers with a trade waiting
      'addresses', COALESCE((SELECT jsonb_agg(DISTINCT a) FROM (
          SELECT aquaterra_xs('deposit_address') AS a WHERE aquaterra_xp('crypto_enabled') = 1
          UNION SELECT pay_to FROM aquaterra_market_trades WHERE status = 'pending' OR (status = 'expired' AND expires_at > now() - interval '24 hours')) s
          WHERE a IS NOT NULL), '[]'::jsonb),
      'cro', aquaterra_xp('crypto_enabled') = 1 AND aquaterra_xs('deposit_address') IS NOT NULL,
      'pendingCard', COALESCE((SELECT jsonb_agg(provider_id) FROM aquaterra_tide_orders
          WHERE method = 'card' AND status = 'pending' AND provider_id IS NOT NULL AND created_at < now() - interval '2 minutes'), '[]'::jsonb));

  ELSIF act = 'scan_result' THEN
    IF (req->>'croUsdMicro')::bigint > 0 THEN
      UPDATE aquaterra_exchange_params SET value = (req->>'croUsdMicro')::bigint WHERE key = 'cro_usd_micro';
      UPDATE aquaterra_exchange_params SET value = extract(epoch FROM now())::bigint WHERE key = 'cro_rate_at';
    END IF;
    FOR e IN SELECT * FROM jsonb_array_elements(COALESCE(req->'transfers', '[]'::jsonb)) LOOP
      v_tok := upper(e->>'token'); v_to := lower(e->>'to'); v_amt := (e->>'amount')::numeric;
      IF v_tok NOT IN ('USDT', 'CRO') OR v_amt IS NULL OR v_amt <= 0 THEN CONTINUE; END IF;
      INSERT INTO aquaterra_chain_transfers (tx_hash, log_index, token, from_address, to_address, amount, block)
      VALUES (lower(e->>'hash'), (e->>'logIndex')::int, v_tok, lower(e->>'from'), v_to, v_amt, (e->>'block')::bigint)
      ON CONFLICT DO NOTHING;
      IF NOT FOUND THEN CONTINUE; END IF;
      seen := seen + 1; v_match := NULL;
      -- orders: amounts are kept in millionths; CRO arrives in wei (1e18), USDT in 1e-6
      IF v_tok = 'CRO' THEN v_amt := v_amt / 1000000000000; END IF;
      IF v_amt = trunc(v_amt) THEN
        SELECT * INTO o FROM aquaterra_tide_orders
        WHERE method <> 'card' AND currency = v_tok AND pay_to = v_to AND amount = v_amt::bigint
          AND (status = 'pending' OR (status = 'expired' AND expires_at > now() - interval '24 hours'))
        ORDER BY (status = 'pending') DESC, id LIMIT 1;
        IF o.id IS NOT NULL AND aquaterra_x_credit(o.id, lower(e->>'hash')) THEN
          v_match := 'order:' || o.id; credited := credited + 1;
        END IF;
        IF v_match IS NULL AND v_tok = 'USDT' THEN
          SELECT * INTO tr FROM aquaterra_market_trades
          WHERE pay_to = v_to AND amount = v_amt::bigint
            AND (status = 'pending' OR (status = 'expired' AND expires_at > now() - interval '24 hours'))
          ORDER BY (status = 'pending') DESC, id LIMIT 1;
          IF tr.id IS NOT NULL AND aquaterra_x_settle_trade(tr.id, lower(e->>'hash')) THEN
            v_match := 'trade:' || tr.id; credited := credited + 1;
          END IF;
        END IF;
      END IF;
      UPDATE aquaterra_chain_transfers SET matched = v_match WHERE tx_hash = lower(e->>'hash') AND log_index = (e->>'logIndex')::int;
    END LOOP;
    IF (req->>'toBlock')::bigint > 0 THEN
      INSERT INTO aquaterra_chain_state (key, value) VALUES ('last_block', (req->>'toBlock')::bigint)
      ON CONFLICT (key) DO UPDATE SET value = greatest(aquaterra_chain_state.value, EXCLUDED.value);
    END IF;
    PERFORM aquaterra_x_expire();
    RETURN jsonb_build_object('ok', true, 'seen', seen, 'credited', credited);
  END IF;
  RETURN jsonb_build_object('ok', false, 'error', 'action', 'status', 400);
END $fn$;

-- Names for the new system accounts in every history (patches aquaterra_name once).
DO $do$
DECLARE src text; anchor text := 'WHEN acct IS NULL THEN NULL';
BEGIN
  src := pg_get_functiondef('aquaterra_name(text)'::regprocedure);
  IF position('market:escrow' IN src) > 0 THEN RETURN; END IF;
  IF position(anchor IN src) = 0 THEN RAISE EXCEPTION 'name patch: anchor not found'; END IF;
  src := replace(src, anchor, anchor || E'\n    WHEN acct = ''market:escrow'' THEN ''Tide Market'' WHEN acct = ''bridge:cronos'' THEN ''Cronos Bridge''');
  EXECUTE src;
END $do$;
