-- Test fixture only: the tables made by "[62 PUBLIC] AquaTerra Account" that
-- governance reads. Production already has them; never run this there.
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE TABLE aquaterra_players (email text PRIMARY KEY, display_name text, created_at timestamptz NOT NULL DEFAULT now(), last_login_at timestamptz, role text NOT NULL DEFAULT 'citizen');
CREATE TABLE aquaterra_sessions (token_hash text PRIMARY KEY, email text NOT NULL REFERENCES aquaterra_players(email), expires_at timestamptz NOT NULL, created_at timestamptz DEFAULT now(), last_seen timestamptz);
CREATE TABLE aquaterra_council (seat int PRIMARY KEY, name text NOT NULL, title text NOT NULL, kind text NOT NULL, email text, joined_at timestamptz NOT NULL DEFAULT now());
