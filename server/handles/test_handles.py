"""Tests for server/handles/handles.sql on a throwaway Postgres.
Run: PGHOST=/var/tmp/pgh PGPORT=5434 python3 server/handles/test_handles.py [path/to/economy.sql]
Loads minimal account tables, the economy, residents and rich-list functions, then the migration (twice)."""
import hashlib, json, os, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
ECON = sys.argv[1] if len(sys.argv) > 1 else "/mnt/project-files/aquaterra-economy/economy.sql"
DB = "handles_test"

def psql(sql, db=DB):
    out = subprocess.run(["psql", "-U", "postgres", "-d", db, "-v", "ON_ERROR_STOP=1", "-qAt", "-c", sql], capture_output=True, text=True)
    if out.returncode: raise RuntimeError(out.stderr)
    return out.stdout.strip()

def call(fn, req):
    return json.loads(psql("SELECT %s('%s'::jsonb)" % (fn, json.dumps(req).replace("'", "''"))))

psql(f"DROP DATABASE IF EXISTS {DB}", "postgres"); psql(f"CREATE DATABASE {DB}", "postgres")
psql("""
CREATE TABLE aquaterra_players (email text PRIMARY KEY, display_name text, role text DEFAULT 'citizen', created_at timestamptz DEFAULT now(), last_login_at timestamptz DEFAULT now());
CREATE TABLE aquaterra_sessions (token_hash text PRIMARY KEY, email text REFERENCES aquaterra_players(email), expires_at timestamptz);
CREATE TABLE aquaterra_districts (id int PRIMARY KEY, name text);
CREATE TABLE aquaterra_locations (email text PRIMARY KEY, district_id int, spot text DEFAULT 'centre', plot_id int, x int, y int, trips int DEFAULT 0, updated_at timestamptz DEFAULT now());
CREATE TABLE aquaterra_council (seat int PRIMARY KEY, email text);
INSERT INTO aquaterra_districts VALUES (1, 'First Light City');
""")
for f in [ECON, os.path.join(ROOT, "server/residents/residents.sql"), os.path.join(ROOT, "server/richlist/richlist.sql")]:
    psql(open(f).read())

def player(i, email, name):
    psql(f"INSERT INTO aquaterra_players (email, display_name, created_at) VALUES ('{email}', {('%r' % name) if name else 'NULL'}, now() - interval '{10 - i} days')")
    psql(f"INSERT INTO aquaterra_locations (email, district_id, x, y) VALUES ('{email}', 1, 10, 10)")
    tok = (chr(97 + i)) * 64
    psql(f"INSERT INTO aquaterra_sessions VALUES ('{hashlib.sha256(tok.encode()).hexdigest()}', '{email}', now() + interval '1 day')")
    return tok

A = player(0, "a@x.io", "Alexander")
B = player(1, "b@x.io", "alexander")       # same name, later account
C = player(2, "c@x.io", "Mary Ann.Lee")
D = player(3, "d@x.io", None)
N = player(4, "n@x.io", "NICS")

sql = open(os.path.join(HERE, "handles.sql")).read()
for _ in range(2): psql(sql)

h = lambda e: psql(f"SELECT handle FROM aquaterra_players WHERE email = '{e}'")
assert h("a@x.io") == "alexander", h("a@x.io")
assert h("b@x.io") == "alexander2"
assert h("c@x.io") == "mary_ann_lee"
assert h("d@x.io") == "resident2" or h("d@x.io").startswith("resident"), h("d@x.io")
assert h("n@x.io") == "nics2" or not h("n@x.io").startswith("nics") or h("n@x.io") != "nics", h("n@x.io")
assert h("n@x.io") != "nics"

# new resident: temporary handle, then follows the first name
psql("INSERT INTO aquaterra_players (email) VALUES ('e@x.io')")
assert h("e@x.io").startswith("resident_")
psql("UPDATE aquaterra_players SET display_name = 'Eve' WHERE email = 'e@x.io'")
assert h("e@x.io") == "eve"

# API
assert call("aquaterra_handles", {"action": "me", "session": "z" * 64})["error"] == "session"
me = call("aquaterra_handles", {"action": "me", "session": A})
assert me["handle"] == "alexander" and me["auto"] is True
assert call("aquaterra_handles", {"action": "check", "session": B, "handle": "@Alexander"})["error"] == "taken"
assert call("aquaterra_handles", {"action": "check", "session": B, "handle": "nics_ai"})["error"] == "reserved"
assert call("aquaterra_handles", {"action": "check", "session": B, "handle": "a b"})["error"] == "format"
assert call("aquaterra_handles", {"action": "check", "session": B, "handle": "x__y"})["error"] == "format"
r = call("aquaterra_handles", {"action": "set", "session": B, "handle": "Sasha_77"})
assert r["ok"] and r["handle"] == "sasha_77" and r["auto"] is False and r["next"], r
assert call("aquaterra_handles", {"action": "set", "session": B, "handle": "sasha_78"})["error"] == "too_soon"
# name change no longer touches a chosen handle
psql("UPDATE aquaterra_players SET display_name = 'Sasha' WHERE email = 'b@x.io'")
assert h("b@x.io") == "sasha_77"
s = call("aquaterra_handles", {"action": "search", "session": A, "q": "@sa"})["results"]
assert s == [{"handle": "sasha_77", "name": "Sasha"}], s
s = call("aquaterra_handles", {"action": "search", "session": A, "q": "lee"})["results"]
assert s and s[0]["handle"] == "mary_ann_lee", s
assert call("aquaterra_handles", {"action": "search", "session": A, "q": "alex"})["results"] == []  # self hidden
assert call("aquaterra_handles", {"action": "search", "session": A, "q": "%"})["results"] == []

# names everywhere
assert psql("SELECT aquaterra_name('c@x.io')") == "Mary Ann.Lee @mary_ann_lee"
assert psql("SELECT aquaterra_name('treasury')") == "AquaTerra Reserve"

# transfers by @handle
psql("INSERT INTO aquaterra_wallets (account, balance, welcomed_at) VALUES ('a@x.io', 5000, now()) ON CONFLICT (account) DO UPDATE SET balance = 5000, welcomed_at = now()")
psql("INSERT INTO aquaterra_wallets (account, welcomed_at) VALUES ('state:treasury', now()) ON CONFLICT DO NOTHING")
psql("UPDATE aquaterra_economy_params SET value = 0 WHERE key = 'welcome_grant'")
t = call("aquaterra_economy", {"action": "transfer", "session": A, "to": "@sasha_77", "amount": 100, "memo": "hi"})
assert t.get("ok", True) is not False and t.get("to") == "Sasha @sasha_77", t
t = call("aquaterra_economy", {"action": "transfer", "session": A, "to": "mary_ann_lee", "amount": 100})
assert t.get("to") == "Mary Ann.Lee @mary_ann_lee", t
t = call("aquaterra_economy", {"action": "transfer", "session": A, "to": "@nobody", "amount": 100})
assert t.get("error") == "no_citizen", t
t = call("aquaterra_economy", {"action": "transfer", "session": A, "to": "Eve", "amount": 10})   # name still works
assert t.get("to") == "Eve @eve", t
t = call("aquaterra_economy", {"action": "transfer", "session": A, "to": "@alexander", "amount": 10})
assert t.get("error") == "self", t

# map and rich list
m = call("aquaterra_residents", {"action": "map", "session": A})
assert {x["handle"] for x in m["residents"]} >= {"sasha_77", "mary_ann_lee"}, m
rl = psql("SELECT aquaterra_richlist(10)")
assert '"handle": "alexander"' in rl, rl
print("handles: all tests passed")
