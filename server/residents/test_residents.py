"""Tests for server/residents/residents.sql on a throwaway Postgres.
Run: PGHOST=/var/tmp/pgr PGPORT=5434 python3 server/residents/test_residents.py
Builds minimal stand-ins of the account and travel tables, then the migration (twice)."""
import hashlib, json, os, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
DB = "residents_test"

def psql(sql, db=DB):
    out = subprocess.run(["psql", "-U", "postgres", "-d", db, "-v", "ON_ERROR_STOP=1", "-qAt", "-c", sql], capture_output=True, text=True)
    if out.returncode: raise RuntimeError(out.stderr)
    return out.stdout.strip()

def api(req):
    return json.loads(psql("SELECT aquaterra_residents('%s'::jsonb)" % json.dumps(req).replace("'", "''")))

psql(f"DROP DATABASE IF EXISTS {DB}", "postgres"); psql(f"CREATE DATABASE {DB}", "postgres")
psql("""
CREATE TABLE aquaterra_players (email text PRIMARY KEY, display_name text, role text DEFAULT 'citizen', created_at timestamptz DEFAULT now(), last_login_at timestamptz);
CREATE TABLE aquaterra_sessions (token_hash text PRIMARY KEY, email text REFERENCES aquaterra_players(email), expires_at timestamptz);
CREATE TABLE aquaterra_districts (id int PRIMARY KEY, name text);
CREATE TABLE aquaterra_locations (email text PRIMARY KEY REFERENCES aquaterra_players(email), district_id int, spot text DEFAULT 'centre', plot_id int, x int, y int, trips int DEFAULT 0, updated_at timestamptz DEFAULT now());
CREATE TABLE aquaterra_council (seat int PRIMARY KEY, email text);
INSERT INTO aquaterra_districts VALUES (1, 'First Light City');
""")
sql = open(os.path.join(HERE, "residents.sql")).read()
for _ in range(2): psql(sql)

def player(email, name, seen_days=0, token=None):
    psql(f"INSERT INTO aquaterra_players (email, display_name, last_login_at) VALUES ('{email}', {('%r' % name) if name else 'NULL'}, now() - interval '{seen_days} days')")
    psql(f"INSERT INTO aquaterra_locations (email, district_id, x, y) VALUES ('{email}', 1, 100, 120)")
    if token:
        h = hashlib.sha256(token.encode()).hexdigest()
        psql(f"INSERT INTO aquaterra_sessions VALUES ('{h}', '{email}', now() + interval '1 day')")

A, B = "a" * 64, "b" * 64
player("a@x.io", "Alpha", token=A)
player("b@x.io", "Bravo", token=B)
player("c@x.io", None, seen_days=2)
player("old@x.io", "Old", seen_days=30)
psql("INSERT INTO aquaterra_council VALUES (1, 'b@x.io')")

fails = 0
def check(name, cond):
    global fails
    print(("ok   " if cond else "FAIL ") + name)
    fails += 0 if cond else 1

check("no session", api({"action": "map"})["error"] == "session")
r = api({"action": "me", "session": A})
check("me: no avatar yet", r["ok"] and r["avatar"]["style"] is None and r["avatar"]["visible"] is True)
check("bad style", api({"action": "set_avatar", "session": A, "style": "dragon", "hue": 10})["error"] == "style")
check("bad hue", api({"action": "set_avatar", "session": A, "style": "robot", "hue": 400})["error"] == "hue")
check("bad hue text", api({"action": "set_avatar", "session": A, "style": "robot", "hue": "x"})["error"] == "hue")
r = api({"action": "set_avatar", "session": A, "style": "robot", "hue": 205})
check("set avatar", r["ok"] and r["avatar"] == {"style": "robot", "hue": 205, "visible": True})
r = api({"action": "map", "session": B})
names = {x["name"]: x for x in r["residents"]}
check("map: others, not me, not old", set(names) == {"Alpha", "Citizen"})
check("map: avatar shown", names["Alpha"]["style"] == "robot" and names["Alpha"]["hue"] == 205)
check("map: default drop", names["Citizen"]["style"] == "drop")
check("map: no emails", "@" not in json.dumps(r["residents"]))
check("map: online flags", names["Alpha"]["online"] and not names["Citizen"]["online"] and r["online"] == 1 and r["recent"] == 2)
r = api({"action": "map", "session": A})
check("map: council flag", [x for x in r["residents"] if x["name"] == "Bravo"][0]["council"] is True)
api({"action": "set_avatar", "session": A, "style": "robot", "hue": 205, "visible": False})
r = api({"action": "map", "session": B})
check("hidden resident not on map", "Alpha" not in {x["name"] for x in r["residents"]})
check("presence written", psql("SELECT count(*) FROM aquaterra_presence") == "2")
check("unknown action", api({"action": "drop_table", "session": A})["error"] == "action")
# --- where a newcomer appears (spawn.sql) ---
psql("""
ALTER TABLE aquaterra_districts ADD COLUMN capital boolean DEFAULT false, ADD COLUMN cx int, ADD COLUMN cy int, ADD COLUMN isle int;
UPDATE aquaterra_districts SET capital = true, cx = 50, cy = 50, isle = 7 WHERE id = 1;
INSERT INTO aquaterra_districts VALUES (2, 'Oceania', false, 200, 200, 9);
CREATE TABLE aquaterra_residents (email text PRIMARY KEY, district_id int);
CREATE TABLE aquaterra_plots (id int PRIMARY KEY, address text, district text, tiles int, price bigint, ax int, ay int, isle int);
CREATE FUNCTION aquaterra_travel_location_json(l aquaterra_locations) RETURNS jsonb LANGUAGE sql AS
$fn$ SELECT jsonb_build_object('districtId', l.district_id, 'spot', l.spot, 'plotId', l.plot_id, 'x', l.x, 'y', l.y) $fn$;
INSERT INTO aquaterra_plots SELECT g, 'Lot ' || g, 'First Light City', 4, 100, 40 + g, 60 + g, 7 FROM generate_series(1, 40) g;
INSERT INTO aquaterra_plots VALUES (100, 'Islet lot', 'First Light City', 4, 100, 5, 5, 3);
INSERT INTO aquaterra_plots VALUES (101, 'Lagoon', 'First Light City', 4, 100, 6, 6, -1);
INSERT INTO aquaterra_plots VALUES (102, 'Unsynced', 'First Light City', 4, 100, NULL, NULL, 7);
INSERT INTO aquaterra_plots SELECT 200 + g, 'Reef ' || g, 'Oceania', 4, 100, 190 + g, 210, 9 FROM generate_series(1, 10) g;
""")
for _ in range(2): psql(open(os.path.join(HERE, "spawn.sql")).read())
spots = []
for i in range(30):
    e = f"new{i}@x.io"
    psql(f"INSERT INTO aquaterra_players (email, display_name) VALUES ('{e}', 'N{i}')")
    if i < 5: psql(f"INSERT INTO aquaterra_residents VALUES ('{e}', 2)")
    spots.append(json.loads(psql(f"SELECT aquaterra_player_where('{e}')")))
capital = [s for s in spots[5:]]
check("newcomers stand on plots", all(s["spot"] == "plot" for s in spots))
check("no home district: capital, mainland land only", all(s["districtId"] == 1 and 1 <= s["plotId"] <= 40 for s in capital))
check("no home district: spread, not one tile", len({(s["x"], s["y"]) for s in capital}) >= 10)
check("home district respected", all(s["districtId"] == 2 and 201 <= s["plotId"] <= 210 for s in spots[:5]))
check("second call keeps the place", json.loads(psql("SELECT aquaterra_player_where('new7@x.io')")) == spots[7])
check("already placed residents stay", psql("SELECT spot FROM aquaterra_locations WHERE email = 'a@x.io'") == "centre")
psql("INSERT INTO aquaterra_districts VALUES (3, 'Empty', false, 300, 300, 4)")
psql("INSERT INTO aquaterra_players (email) VALUES ('e@x.io'); INSERT INTO aquaterra_residents VALUES ('e@x.io', 3)")
r = json.loads(psql("SELECT aquaterra_player_where('e@x.io')"))
check("no plots synced: town centre", r["spot"] == "centre" and (r["x"], r["y"]) == (300, 300))

psql(f"DROP DATABASE {DB}", "postgres")
sys.exit(1 if fails else 0)
