-- AquaTerra Arcade: mini-games on plots. One-off migration, safe to run again.
-- Needs the economy (aquaterra_wallets, aquaterra_ledger, aquaterra_plots,
-- aquaterra_plot_owners) and the Commonwealth (aquaterra_gov_params,
-- aquaterra_districts) to exist already. Never runs on a request.

-- One attraction per plot at a time. The operator is the plot owner, the
-- tenant who rents the plot, or 'nics-ai' for the City Mind's own pop-ups.
CREATE TABLE IF NOT EXISTS aquaterra_arcade (
  id serial PRIMARY KEY,
  plot_id int NOT NULL REFERENCES aquaterra_plots(id),
  operator text NOT NULL,
  template text NOT NULL CHECK (template IN ('quiz', 'crystals', 'maze', 'range', 'race')),
  title text NOT NULL,
  difficulty text NOT NULL CHECK (difficulty IN ('easy', 'normal', 'hard')),
  entry_fee bigint NOT NULL DEFAULT 0 CHECK (entry_fee >= 0),
  prize bigint NOT NULL DEFAULT 0 CHECK (prize >= 0),
  pool bigint NOT NULL DEFAULT 0 CHECK (pool >= 0),
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  ai_day date,
  plays int NOT NULL DEFAULT 0,
  wins int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS aquaterra_arcade_one_per_plot ON aquaterra_arcade (plot_id) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS aquaterra_arcade_operator ON aquaterra_arcade (operator) WHERE status = 'open';

-- One play. secret holds what the player must not see (answers, crystal spots).
CREATE TABLE IF NOT EXISTS aquaterra_arcade_runs (
  id bigserial PRIMARY KEY,
  arcade_id int NOT NULL REFERENCES aquaterra_arcade(id),
  player text NOT NULL,
  district text,
  land text,
  started_at timestamptz NOT NULL DEFAULT now(),
  deadline timestamptz NOT NULL,
  finished_at timestamptz,
  secret jsonb NOT NULL DEFAULT '{}'::jsonb,
  public jsonb NOT NULL DEFAULT '{}'::jsonb,
  moves jsonb NOT NULL DEFAULT '[]'::jsonb,
  score int,
  max_score int,
  won boolean,
  fee bigint NOT NULL DEFAULT 0,
  prize bigint NOT NULL DEFAULT 0,
  practice boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'live' CHECK (status IN ('live', 'done'))
);
CREATE INDEX IF NOT EXISTS aquaterra_arcade_runs_player ON aquaterra_arcade_runs (player, started_at DESC);
CREATE INDEX IF NOT EXISTS aquaterra_arcade_runs_arcade ON aquaterra_arcade_runs (arcade_id, started_at DESC);

-- Plots offered for rent by their owners, and rentals.
CREATE TABLE IF NOT EXISTS aquaterra_arcade_rent_offers (
  plot_id int PRIMARY KEY REFERENCES aquaterra_plots(id),
  owner text NOT NULL,
  price_per_day bigint NOT NULL CHECK (price_per_day > 0),
  max_days int NOT NULL CHECK (max_days BETWEEN 1 AND 30),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS aquaterra_arcade_rentals (
  id serial PRIMARY KEY,
  plot_id int NOT NULL REFERENCES aquaterra_plots(id),
  owner text NOT NULL,
  tenant text NOT NULL,
  price_per_day bigint NOT NULL,
  days int NOT NULL,
  paid bigint NOT NULL,
  starts_at timestamptz NOT NULL DEFAULT now(),
  ends_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS aquaterra_arcade_rentals_plot ON aquaterra_arcade_rentals (plot_id, ends_at DESC);
CREATE INDEX IF NOT EXISTS aquaterra_arcade_rentals_tenant ON aquaterra_arcade_rentals (tenant, ends_at DESC);

-- Daily quests a player has collected.
CREATE TABLE IF NOT EXISTS aquaterra_arcade_quests_done (
  player text NOT NULL,
  day date NOT NULL,
  quest text NOT NULL,
  reward bigint NOT NULL,
  at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (player, day, quest)
);

-- NICS AI's book of experience for the arcade: what it set up and why.
CREATE TABLE IF NOT EXISTS aquaterra_arcade_ai_log (
  id serial PRIMARY KEY,
  day date NOT NULL,
  at timestamptz NOT NULL DEFAULT now(),
  text text NOT NULL
);

-- Question bank for quizzes. Static facts (elements, science) plus facts
-- NICS AI writes from the live world each day (topic 'world').
CREATE TABLE IF NOT EXISTS aquaterra_arcade_questions (
  id serial PRIMARY KEY,
  topic text NOT NULL,
  q text NOT NULL,
  answer text NOT NULL,
  wrong text[] NOT NULL,
  level int NOT NULL DEFAULT 1,
  source text NOT NULL DEFAULT 'bank',
  UNIQUE (topic, q)
);

-- The escrow wallet that holds every prize pool. Its balance always equals
-- the sum of open pools.
INSERT INTO aquaterra_wallets (account, balance, welcomed_at) VALUES ('arcade:escrow', 0, now()) ON CONFLICT DO NOTHING;
INSERT INTO aquaterra_wallets (account, balance, welcomed_at) VALUES ('nics-ai', 0, now()) ON CONFLICT DO NOTHING;

-- Numbers of the arcade are laws of the Commonwealth: changed by a set_param vote.
INSERT INTO aquaterra_gov_params (key, value, min_value, max_value, label) VALUES
  ('arcade_entry_tax_pct', 5, 0, 30, 'Tax on attraction tickets, percent'),
  ('arcade_prize_tax_pct', 5, 0, 30, 'Tax on attraction prizes, percent'),
  ('rent_tax_pct', 3, 0, 15, 'Tax on plot rent, percent'),
  ('arcade_daily_prize_cap', 500, 0, 100000, 'Most TIDE one citizen can win in attractions a day'),
  ('arcade_ai_daily_budget', 2000, 0, 100000, 'Prize TIDE the Reserve gives NICS AI attractions each day'),
  ('arcade_ai_attractions', 6, 0, 30, 'Pop-up attractions NICS AI opens each day')
ON CONFLICT (key) DO NOTHING;
