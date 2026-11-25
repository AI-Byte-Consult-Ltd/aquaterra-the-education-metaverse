-- AquaTerra Commonwealth: tables of the state.
-- One-off migration (run once, never per request). Safe to run again.
-- Reads the account tables of "[62 PUBLIC] AquaTerra Account":
-- aquaterra_players, aquaterra_sessions, aquaterra_council.

-- Districts of the world map, synced from the site's /world/districts.json.
-- A merged district keeps its land and plots; merged_into points at the
-- district that now governs it (the world only grows, nothing is deleted).
CREATE TABLE IF NOT EXISTS aquaterra_districts (
  id int PRIMARY KEY,
  name text NOT NULL,
  biome text NOT NULL,
  land text NOT NULL,
  capital boolean NOT NULL DEFAULT false,
  merged_into int REFERENCES aquaterra_districts(id),
  admin_name text,
  mayor_email text REFERENCES aquaterra_players(email),
  mayor_term_ends timestamptz,
  added_at timestamptz NOT NULL DEFAULT now()
);

-- Where each citizen lives. One home district per citizen.
CREATE TABLE IF NOT EXISTS aquaterra_residents (
  email text PRIMARY KEY REFERENCES aquaterra_players(email),
  district_id int NOT NULL REFERENCES aquaterra_districts(id),
  since timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS aquaterra_residents_district ON aquaterra_residents(district_id);
-- false while the home was given by default (First Light City): the first real choice is free of the 30-day wait.
ALTER TABLE aquaterra_residents ADD COLUMN IF NOT EXISTS chosen boolean NOT NULL DEFAULT true;

-- Council seats 4..11 are elected and have a term; permanent seats 1-3 (Founder, NICS AI, founding member) never end.
ALTER TABLE aquaterra_council ADD COLUMN IF NOT EXISTS term_ends timestamptz;

-- Laws that set numbers of the state. Changed only by a passed set_param proposal.
CREATE TABLE IF NOT EXISTS aquaterra_gov_params (
  key text PRIMARY KEY,
  value numeric NOT NULL,
  min_value numeric NOT NULL,
  max_value numeric NOT NULL,
  label text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  proposal_id int
);

-- Citizens' Assembly seats. District seats appear by themselves when a district
-- reaches the resident threshold; lot seats are drawn; guild seats wait for guilds.
CREATE TABLE IF NOT EXISTS aquaterra_gov_seats (
  id serial PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('district', 'lot', 'guild')),
  district_id int REFERENCES aquaterra_districts(id),
  holder_email text REFERENCES aquaterra_players(email),
  term_ends timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS aquaterra_gov_seats_district ON aquaterra_gov_seats(district_id) WHERE kind = 'district';

-- The Directorate (executive). Appointed by the Assembly and the Council.
CREATE TABLE IF NOT EXISTS aquaterra_gov_directorate (
  post text PRIMARY KEY,
  title text NOT NULL,
  holder_email text REFERENCES aquaterra_players(email),
  term_ends timestamptz,
  appointed_at timestamptz
);

CREATE TABLE IF NOT EXISTS aquaterra_gov_proposals (
  id serial PRIMARY KEY,
  kind text NOT NULL,
  title text NOT NULL,
  body text NOT NULL DEFAULT '',
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  author_email text REFERENCES aquaterra_players(email),
  status text NOT NULL,
  stages jsonb NOT NULL,
  stage int NOT NULL DEFAULT 0,
  stage_started timestamptz,
  stage_ends timestamptz,
  results jsonb NOT NULL DEFAULT '[]'::jsonb,
  outcome text,
  created_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz
);
CREATE INDEX IF NOT EXISTS aquaterra_gov_proposals_open ON aquaterra_gov_proposals(status) WHERE status IN ('signatures', 'voting');

CREATE TABLE IF NOT EXISTS aquaterra_gov_signatures (
  proposal_id int NOT NULL REFERENCES aquaterra_gov_proposals(id),
  email text NOT NULL REFERENCES aquaterra_players(email),
  at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (proposal_id, email)
);

-- One vote per voter per stage; a voter may change it until the stage closes.
-- voter is a citizen email or 'nics-ai'. For elections, candidate is the choice.
CREATE TABLE IF NOT EXISTS aquaterra_gov_votes (
  proposal_id int NOT NULL REFERENCES aquaterra_gov_proposals(id),
  stage int NOT NULL,
  voter text NOT NULL,
  choice text NOT NULL,
  reason text,
  at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (proposal_id, stage, voter)
);

CREATE TABLE IF NOT EXISTS aquaterra_gov_candidates (
  proposal_id int NOT NULL REFERENCES aquaterra_gov_proposals(id),
  email text NOT NULL REFERENCES aquaterra_players(email),
  statement text NOT NULL DEFAULT '',
  at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (proposal_id, email)
);

-- The statute book: every passed proposal that is a law, in force or repealed.
CREATE TABLE IF NOT EXISTS aquaterra_gov_laws (
  id serial PRIMARY KEY,
  proposal_id int NOT NULL REFERENCES aquaterra_gov_proposals(id),
  kind text NOT NULL,
  title text NOT NULL,
  body text NOT NULL DEFAULT '',
  in_force boolean NOT NULL DEFAULT true,
  enacted_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz
);

-- Approved works: districts to found, buildings with a permit.
CREATE TABLE IF NOT EXISTS aquaterra_gov_projects (
  id serial PRIMARY KEY,
  proposal_id int NOT NULL REFERENCES aquaterra_gov_proposals(id),
  kind text NOT NULL,
  title text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'approved' CHECK (status IN ('approved', 'built')),
  approved_at timestamptz NOT NULL DEFAULT now(),
  built_at timestamptz
);

-- Budget lines made by passed budget laws; the Treasury pays out of them.
CREATE TABLE IF NOT EXISTS aquaterra_gov_budget (
  id serial PRIMARY KEY,
  proposal_id int NOT NULL REFERENCES aquaterra_gov_proposals(id),
  purpose text NOT NULL,
  district_id int REFERENCES aquaterra_districts(id),
  allocated numeric NOT NULL,
  spent numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Public journal of the state. Names only, never emails.
CREATE TABLE IF NOT EXISTS aquaterra_gov_log (
  id bigserial PRIMARY KEY,
  at timestamptz NOT NULL DEFAULT now(),
  kind text NOT NULL,
  proposal_id int,
  text text NOT NULL
);
CREATE INDEX IF NOT EXISTS aquaterra_gov_log_at ON aquaterra_gov_log(at DESC);

INSERT INTO aquaterra_gov_params (key, value, min_value, max_value, label) VALUES
  ('district_seat_residents', 100, 10, 10000, 'Residents a district needs for its own Assembly seat'),
  ('mayor_residents', 10, 1, 1000, 'Residents a district needs to elect a Mayor'),
  ('council_election_residents', 20, 5, 100000, 'Citizens with a home needed before Council seats 4-11 are elected'),
  ('founding_deputies', 11, 3, 151, 'Deputies needed to end the Founding Assembly, where every resident votes'),
  ('lot_residents_per_seat', 20, 2, 1000, 'Residents per lot seat before seats are drawn by lot'),
  ('voting_days', 7, 2, 21, 'Days each body has to vote'),
  ('nomination_days', 3, 1, 14, 'Days to stand as a candidate in an election'),
  ('ballot_days', 4, 1, 14, 'Days of voting in an election'),
  ('signature_days', 14, 3, 60, 'Days a citizen proposal has to gather signatures'),
  ('signatures_min', 3, 1, 1000, 'Least signatures a citizen proposal needs'),
  ('signatures_pct', 2, 0, 20, 'Signatures a citizen proposal needs, percent of residents'),
  ('quorum_pct', 10, 1, 60, 'Turnout needed in referendums, district votes and the Founding Assembly, percent'),
  ('assembly_quorum_pct', 50, 20, 90, 'Turnout of deputies needed in the elected Assembly, percent'),
  ('deputy_term_days', 90, 30, 730, 'Term of a deputy, days'),
  ('mayor_term_days', 90, 30, 730, 'Term of a Mayor, days'),
  ('council_term_days', 180, 30, 1460, 'Term of an elected Councillor, days'),
  ('director_term_days', 180, 30, 1460, 'Term of a Director, days'),
  ('residence_change_days', 30, 0, 365, 'Days before a citizen may move home again'),
  ('max_open_proposals', 3, 1, 20, 'Open proposals one citizen may have at once'),
  ('permit_free_floors', 10, 1, 39, 'Floors a building may have without any vote'),
  ('skyscraper_floors', 40, 11, 200, 'Floors from which a building is a skyscraper'),
  ('sales_tax_pct', 3, 0, 15, 'Tax on plot and asset sales, percent'),
  ('budget_reserve_pct', 25, 0, 90, 'Share of the treasury one budget law may not exceed, percent')
ON CONFLICT (key) DO NOTHING;
UPDATE aquaterra_gov_params SET label = 'Citizens with a home needed before Council seats 4-11 are elected'
 WHERE key = 'council_election_residents' AND label <> 'Citizens with a home needed before Council seats 4-11 are elected';

INSERT INTO aquaterra_gov_directorate (post, title) VALUES
  ('president', 'President of the Directorate'),
  ('treasury', 'Director of Treasury'),
  ('works', 'Director of Works'),
  ('civic', 'Director of Civic Affairs')
ON CONFLICT (post) DO NOTHING;

-- Runs of tax collection (land tax is collected every 30 days).
CREATE TABLE IF NOT EXISTS aquaterra_gov_tax_runs (
  id serial PRIMARY KEY,
  kind text NOT NULL,
  at timestamptz NOT NULL DEFAULT now(),
  collected bigint NOT NULL DEFAULT 0,
  payers int NOT NULL DEFAULT 0,
  unpaid int NOT NULL DEFAULT 0
);
