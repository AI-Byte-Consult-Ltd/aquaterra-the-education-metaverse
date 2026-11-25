"""End-to-end test of roads on a scratch Postgres.

  PGHOST=/var/tmp/pg PGPORT=5433 python3 server/roads/test_roads.py

Loads the account fixture, the Tide economy (ECONOMY_SQL, default the project
copy), the Commonwealth, travel, treasury and roads.sql (twice: the migration
must be safe to run again), then buys, drives, wears and repairs roads.
"""
import hashlib, json, os, subprocess

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
GOV = os.path.join(ROOT, "server", "governance")
ECONOMY = os.environ.get("ECONOMY_SQL", "/mnt/project-files/aquaterra-economy/economy.sql")
DB = "aquaterra_roads_test"
BASE = ["psql", "-U", os.environ.get("PGUSER", "postgres"), "-v", "ON_ERROR_STOP=1", "-q", "-tA"]


def psql(sql, db=DB):
    r = subprocess.run(BASE + ["-d", db, "-c", sql], capture_output=True, text=True)
    if r.returncode:
        raise SystemExit(f"SQL failed: {sql[:300]}\n{r.stderr}")
    return r.stdout.strip()


def load(f):
    r = subprocess.run(BASE + ["-d", DB, "-f", f], capture_output=True, text=True)
    if r.returncode:
        raise SystemExit(f"{f}: {r.stderr}")


lit = lambda s: "'" + s.replace("'", "''") + "'"
J = lambda sql: json.loads(psql(sql))
passed = 0


def check(cond, msg):
    global passed
    if not cond:
        raise SystemExit("FAIL: " + msg)
    passed += 1


psql(f"DROP DATABASE IF EXISTS {DB}", db="postgres")
psql(f"CREATE DATABASE {DB}", db="postgres")
load(os.path.join(GOV, "base-tables.sql"))
load(ECONOMY)
for f in ["schema.sql", "functions.sql", "api.sql"]:
    load(os.path.join(GOV, f))
load(os.path.join(ROOT, "server", "travel", "travel.sql"))
load(os.path.join(ROOT, "server", "treasury", "treasury.sql"))

# three districts in a row, joined by road (100 tiles each); 1-3 also by ferry
psql("INSERT INTO aquaterra_districts (id, name, biome, land) VALUES (1, 'Alpha', 'temperate', 'main'), (2, 'Beta', 'temperate', 'main'), (3, 'Gamma', 'temperate', 'main') ON CONFLICT DO NOTHING")
psql("INSERT INTO aquaterra_travel_routes (mode, a, b, dist) VALUES ('car', 1, 2, 100), ('car', 2, 3, 150), ('ferry', 1, 3, 300)")

for _ in range(2):
    load(os.path.join(HERE, "roads.sql"))
load(os.path.join(ROOT, "server", "treasury", "treasury.sql"))  # a rerun of treasury keeps the roads in the tick

S, EMAIL = {}, {}


def player(email, name, tide=0, district=1, role="citizen"):
    psql(f"INSERT INTO aquaterra_players (email, display_name, role) VALUES ({lit(email)}, {lit(name)}, {lit(role)})")
    tok = hashlib.sha256(email.encode()).hexdigest()
    psql(f"INSERT INTO aquaterra_sessions (token_hash, email, expires_at) VALUES (encode(sha256(convert_to({lit(tok)}, 'UTF8')), 'hex'), {lit(email)}, now() + interval '1 day')")
    psql(f"INSERT INTO aquaterra_wallets (account, balance) VALUES ({lit(email)}, {tide}) ON CONFLICT (account) DO UPDATE SET balance = {tide}")
    psql(f"INSERT INTO aquaterra_locations (email, district_id) VALUES ({lit(email)}, {district})")
    S[name], EMAIL[name] = tok, email


def bal(acct):
    return int(psql(f"SELECT COALESCE((SELECT balance FROM aquaterra_wallets WHERE account = {lit(acct)}), 0)"))


def roads(name=None, **kw):
    req = dict(kw, session=S[name]) if name else dict(kw)
    return J(f"SELECT aquaterra_roads({lit(json.dumps(req))}::jsonb)")


def drive(name, to):
    return J(f"SELECT aquaterra_travel({lit(json.dumps({'action': 'go', 'session': S[name], 'legs': [{'mode': 'car', 'to': to}]}))}::jsonb)")


def road(rid):
    return J(f"SELECT row_to_json(r) FROM aquaterra_roads r WHERE id = {lit(rid)}")


def age(rid, days):
    psql(f"UPDATE aquaterra_roads SET cond_at = cond_at - interval '{days} days' WHERE id = {lit(rid)}")


# --- migration
check(psql("SELECT count(*) FROM aquaterra_roads") == "2", "one road per car link, ferries are not roads")
r12 = road("road:1-2")
check(r12["price"] == 2000 + 40 * 100 and r12["name"] == "Alpha – Beta Road" and r12["owner"] is None, f"price and name: {r12}")
check(float(r12["cond"]) == 100, "new road in full repair")
check(psql("SELECT aquaterra_name('state:transport')") == "First Light Transit", "company has a name")
check(psql("SELECT aquaterra_name('bank:first-light')") == "Bank of First Light", "other names stay")
check(psql("SELECT count(*) FROM aquaterra_gov_log WHERE kind = 'road'") == "1", "founding in the journal once")
check("aquaterra_roads_tick" in psql("SELECT prosrc FROM pg_proc WHERE proname = 'aquaterra_gov_collect_land_tax'"), "tick runs the roads after a treasury rerun")
lst = roads()
check(lst["ok"] and len(lst["roads"]) == 2 and lst["laws"]["road_price_base"] == 2000 and lst["here"] is None, "public list")

player("ben@x", "Ben", tide=10000, district=1)
player("cleo@x", "Cleo", tide=1000, district=1)
player("dan@x", "Dan", tide=9000, district=3)
psql("UPDATE aquaterra_wallets SET balance = 1000 WHERE account = 'state:treasury'")

# --- state road: toll to the company
drive("Cleo", 2)
check(bal("cleo@x") == 990, "car fare 10 paid")
check(bal("state:treasury") == 1001, "treasury keeps only the 1 TIDE travel tax")
check(bal("state:transport") == 9, "the rest to First Light Transit")
check(road("road:1-2")["trips"] == 1 and abs(float(road("road:1-2")["cond"]) - 99.9) < 0.01, "trip counted and wears the road")
drive("Cleo", 1)

# --- buying
check(roads("Dan", action="buy", road="road:1-2")["error"] == "not_here", "buy only standing in one of its districts")
check(roads("Cleo", action="buy", road="road:1-2")["error"] == "insufficient", "welcome-sized wallet cannot buy")
psql("INSERT INTO aquaterra_ledger (from_account, to_account, amount, kind, memo) VALUES ('treasury', 'cleo@x', 1000, 'welcome', 'w')")
r = roads("Ben", action="buy", road="road:1-2")
check(r["ok"] and r["price"] == 6000 and bal("ben@x") == 4000, f"Ben bought the road: {r.get('error')}")
check(bal("state:transport") == 18 + 6000, "price to First Light Transit")
check(roads("Cleo", action="buy", road="road:1-2")["error"] == "taken", "sold road cannot be bought again")
check(next(x for x in roads("Ben")["roads"] if x["id"] == "road:1-2")["mine"], "list shows my road")
psql("UPDATE aquaterra_gov_params SET value = 1 WHERE key = 'road_max_per_citizen'")
psql("UPDATE aquaterra_locations SET district_id = 2 WHERE email = 'ben@x'")
check(roads("Ben", action="buy", road="road:2-3")["error"] == "road_limit", "limit of roads per resident")
psql("UPDATE aquaterra_gov_params SET value = 3 WHERE key = 'road_max_per_citizen'; UPDATE aquaterra_locations SET district_id = 1 WHERE email = 'ben@x'")

# --- tolls to the owner
b0, t0, c0 = bal("ben@x"), bal("state:transport"), bal("cleo@x")
drive("Cleo", 2)
check(bal("ben@x") == b0 + 9 and bal("state:transport") == t0 and bal("cleo@x") == c0 - 10, "owner gets fare minus tax")
check(road("road:1-2")["revenue"] == 9, "revenue counted")
b0 = bal("ben@x")
drive("Ben", 2)
check(bal("ben@x") == b0 - 1, "on your own road you pay only the tax")

# --- wear and a worn road
age("road:1-2", 150)  # 0.2%/day x 150 = 30 points
c = roads()["roads"][0]["cond"]
check(65 < c < 70, f"condition falls with time: {c}")
age("road:1-2", 100)  # another 20 points: about 49%
b0, t0 = bal("ben@x"), bal("state:transport")
drive("Cleo", 1)
cond = float(road("road:1-2")["cond"]) + 0.1
pay = int(9 * cond / 50)
check(pay < 9 and bal("ben@x") == b0 + pay and bal("state:transport") == t0 + 9 - pay, f"below 50% the owner gets less: {pay}")

# --- repair by the owner
rc = next(x for x in roads()["roads"] if x["id"] == "road:1-2")["repairCost"]
check(abs(rc - (100 - cond + 0.1) / 100 * 6000 * 0.3) < 2, f"repair cost 30% of price for 0->100, in proportion: {rc}")
check(roads("Cleo", action="repair", road="road:1-2")["error"] == "not_owner", "only the owner repairs")
b0, t0 = bal("ben@x"), bal("state:transport")
r = roads("Ben", action="repair", road="road:1-2", pct=80)
check(r["ok"] and r["cond"] == 80 and bal("ben@x") == b0 - r["cost"] and bal("state:transport") == t0 + r["cost"], f"partial repair: {r}")
check(roads("Ben", action="repair", road="road:1-2", pct=50)["error"] == "repaired", "nothing to repair below the condition")
r = roads("Ben", action="repair", road="road:1-2")
check(r["ok"] and float(road("road:1-2")["cond"]) == 100, "full repair")

# --- automatic repair at the owner's cost
age("road:1-2", 450)  # 90 points: 10%
b0 = bal("ben@x")
psql("SELECT aquaterra_gov_collect_land_tax()")
rr = road("road:1-2")
check(float(rr["cond"]) == 100 and rr["owner"] == "ben@x" and bal("ben@x") < b0, "tick: Transit repairs, owner pays")
check(psql("SELECT count(*) FROM aquaterra_notices WHERE email = 'ben@x' AND kind = 'road'") == "1", "owner told")

# --- owner cannot pay: road returns to the state
psql("UPDATE aquaterra_wallets SET balance = 5 WHERE account = 'ben@x'")
age("road:1-2", 450)
t0 = bal("state:transport")
psql("SELECT aquaterra_gov_collect_land_tax()")
rr = road("road:1-2")
refund = 3000 - (bal("ben@x") - 5)
check(rr["owner"] is None and float(rr["cond"]) == 100, "road back with First Light Transit, repaired")
check(bal("ben@x") > 5 and t0 - bal("state:transport") == bal("ben@x") - 5, "owner paid 50% of the price minus the repair")
check(psql("SELECT count(*) FROM aquaterra_gov_log WHERE kind = 'road'") == "3", "purchase and return in the journal")

# --- state roads are repaired by the company itself
age("road:2-3", 450)
psql("SELECT aquaterra_roads_tick()")
check(float(road("road:2-3")["cond"]) == 100, "state road repaired")

# --- sync keeps owners and prices
psql("UPDATE aquaterra_locations SET district_id = 3 WHERE email = 'dan@x'")
r = roads("Dan", action="buy", road="road:2-3")
check(r["ok"], f"Dan bought: {r}")
psql("UPDATE aquaterra_gov_params SET value = 99 WHERE key = 'road_price_per_tile'")
psql("SELECT aquaterra_roads_sync()")
check(road("road:2-3")["price"] == 8000 and road("road:1-2")["price"] == 2000 + 9900, "owned price kept, unsold follows the law")
check(roads(action="nope")["error"] == "action", "unknown action")
check(roads(action="buy", road="road:1-2")["error"] == "session", "buy needs a session")

print(f"roads: {passed} checks passed")
