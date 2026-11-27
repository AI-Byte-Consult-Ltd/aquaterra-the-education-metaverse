"""End-to-end test of piers on a scratch Postgres.

  npm run build   (or the export scripts: land-registry, export-districts, export-travel, export-build-sites)
  PGHOST=/var/tmp/pg PGPORT=5433 ECONOMY_SQL=<economy.sql + server/limits/limits.sql> python3 server/build/test_piers.py

Loads the Commonwealth, the Tide economy, travel (with boats and water), build.sql and
piers.sql (twice: safe to run again), then builds a jetty on an islet plot, sails there
from the town square with a private and a public pier, and checks every TIDE.
"""
import hashlib, json, math, os, subprocess

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
GOV = os.path.join(ROOT, "server", "governance")
TRAVEL = os.path.join(ROOT, "server", "travel")
ECONOMY = os.environ.get("ECONOMY_SQL", "/mnt/project-files/aquaterra-economy/economy.sql")
DB = "aquaterra_piers_test"
BASE = ["psql", "-U", os.environ.get("PGUSER", "postgres"), "-v", "ON_ERROR_STOP=1", "-q", "-tA"]

def psql(sql, db=DB):
    r = subprocess.run(BASE + ["-d", db], input=sql, capture_output=True, text=True)
    if r.returncode:
        raise SystemExit(f"SQL failed: {sql[:200]}\n{r.stderr}")
    return r.stdout.strip()

def load(path):
    r = subprocess.run(BASE + ["-d", DB, "-f", path], capture_output=True, text=True)
    if r.returncode:
        raise SystemExit(f"{path}: {r.stderr}")

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
for f in ["base-tables.sql", "schema.sql", "functions.sql", "api.sql"]:
    load(os.path.join(GOV, f))
load(ECONOMY)

districts = json.load(open(os.path.join(ROOT, "public", "world", "districts.json")))
travel = json.load(open(os.path.join(ROOT, "public", "world", "travel.json")))
sites = json.load(open(os.path.join(ROOT, "public", "world", "build-sites.json")))
reg = json.load(open(os.path.join(ROOT, "public", "land-registry.json")))["plots"]
J(f"SELECT aquaterra_gov_tick({lit(json.dumps(districts))}::jsonb)")
did = {d["name"]: d["id"] for d in districts}
anchors = {a[0]: a for a in travel["anchors"]}
cisle = {c[0]: c[3] for c in travel["centres"] if len(c) > 3}
flag = {s[0]: s for s in sites["sites"]}
# a plot by the water on an islet of its district (a boat from the town square), with free water around
coast = [p for p in reg if p[2] in did and flag.get(p[0], [0, 0])[1] & 8 and len(anchors.get(p[0], [])) > 3
         and anchors[p[0]][3] not in (None, cisle.get(did[p[2]]))]
check(len(coast) > 0, "the map has islet plots by the water")
plot = coast[0]
inland = next(p for p in reg if p[2] == plot[2] and flag.get(p[0], [0, 0])[1] & 9 == 1)
waters = [p for p in reg if p[0] in set(flag[plot[0]][3])]
sample = [plot, inland] + waters
psql("INSERT INTO aquaterra_plots (id, address, district, tiles, price) SELECT (e->>0)::int, e->>1, e->>2, (e->>3)::int, (e->>4)::bigint FROM jsonb_array_elements("
     + lit(json.dumps(sample)) + "::jsonb) e")
for _ in range(2):
    load(os.path.join(TRAVEL, "travel.sql"))
    load(os.path.join(TRAVEL, "boats.sql"))
    load(os.path.join(TRAVEL, "water.sql"))
    load(os.path.join(HERE, "build.sql"))
    load(os.path.join(HERE, "piers.sql"))
check(J(f"SELECT aquaterra_travel_sync({lit(json.dumps(travel))}::jsonb)")["ok"], "travel synced")
r = J(f"SELECT aquaterra_build_sync({lit(json.dumps(sites))}::jsonb)")
check(r["ok"], "build sites synced")
check(psql(f"SELECT coastal FROM aquaterra_build_sites WHERE plot_id = {plot[0]}") == "t", "coastal flag stored")
check(psql(f"SELECT coastal FROM aquaterra_build_sites WHERE plot_id = {inland[0]}") == "f", "inland plot is not coastal")
check(psql(f"SELECT array_length(waters, 1) IS NOT DISTINCT FROM {len(flag[plot[0]][3]) or 'NULL'} FROM aquaterra_build_sites WHERE plot_id = {plot[0]}") == "t", "water plots under a harbour stored")
check(J(f"SELECT aquaterra_build_sync({lit(json.dumps(sites))}::jsonb)")["changed"] == 0, "second sync changes nothing")

S = {}
def player(email, nm, role="citizen"):
    psql(f"INSERT INTO aquaterra_players (email, display_name, role) VALUES ({lit(email)}, {lit(nm)}, {lit(role)})")
    tok = hashlib.sha256(email.encode()).hexdigest()
    psql(f"INSERT INTO aquaterra_sessions (token_hash, email, expires_at) VALUES (encode(sha256(convert_to({lit(tok)}, 'UTF8')), 'hex'), {lit(email)}, now() + interval '1 day')")
    psql(f"INSERT INTO aquaterra_wallets (account, balance, welcomed_at) VALUES ({lit(email)}, 0, now()) ON CONFLICT DO NOTHING")
    S[nm] = tok

def pier(who, **req):
    if who:
        req["session"] = S[who]
    return J(f"SELECT aquaterra_pier({lit(json.dumps(req))}::jsonb)")

def travel_(who, **req):
    req["session"] = S[who]
    return J(f"SELECT aquaterra_travel({lit(json.dumps(req))}::jsonb)")

def grant(email, n):
    psql(f"SELECT aquaterra_move('treasury', {lit(email)}, {n}, 'grant', NULL, 'test', 'test')")

bal = lambda acct: int(psql(f"SELECT COALESCE((SELECT balance FROM aquaterra_wallets WHERE account = {lit(acct)}), 0)"))
total = lambda: int(psql("SELECT sum(balance) FROM aquaterra_wallets"))

player("ava@x", "Ava")
player("ben@x", "Ben")
grant("ava@x", 5000)
grant("ben@x", 500)
psql(f"INSERT INTO aquaterra_plot_owners (plot_id, owner, price_paid) VALUES ({plot[0]}, 'ava@x', 0), ({inland[0]}, 'ava@x', 0)")
t0 = total()

# --- rules
check(pier(None, action="piers")["ok"] and pier(None, action="piers")["piers"] == [], "public list, empty")
check(pier(None, action="pier_build", plotId=plot[0])["error"] == "session", "sign in to build")
check(pier("Ben", action="pier_build", plotId=plot[0])["error"] == "not_owner", "only the owner builds")
check(pier("Ava", action="pier_build", plotId=inland[0])["error"] == "not_coastal", "no pier away from the water")
if waters:
    psql(f"INSERT INTO aquaterra_plot_owners (plot_id, owner, price_paid) VALUES ({waters[0][0]}, 'ben@x', 0)")
    check(pier("Ava", action="pier_build", plotId=plot[0])["error"] == "water_owned", "not over water another resident owns")
    psql(f"DELETE FROM aquaterra_plot_owners WHERE plot_id = {waters[0][0]}")

a0, s0, r0 = bal("ava@x"), bal("state:treasury"), bal("treasury")
r = pier("Ava", action="pier_build", plotId=plot[0], access="private", fee=0)
check(r["ok"] and r["cost"] == 300 and r["permit"] == 30 and r["pier"][1] == 1 and r["pier"][2] == "private", "a jetty: 300 TIDE + 30 permit")
check(a0 - bal("ava@x") == 330 and bal("state:treasury") - s0 == 30 and bal("treasury") - r0 == 300, "cost to the Reserve, permit to the treasury")
check(pier("Ava", action="pier_build", plotId=plot[0])["error"] == "occupied", "one pier per plot")
check(pier("Ava", action="pier_upgrade", plotId=plot[0])["error"] == "building", "upgrade waits for the work")
check(pier("Ava", action="pier_set", plotId=plot[0], access="public", fee=99)["error"] == "amount", "fee above the cap refused")
psql(f"UPDATE aquaterra_piers SET ready_at = now() - interval '1 minute' WHERE plot_id = {plot[0]}")

# --- boats: the town square of the district to the islet plot
d = did[plot[2]]
cx = [c for c in travel["centres"] if c[0] == d][0]
dist = max(1, round(math.hypot(cx[1] - anchors[plot[0]][1], cx[2] - anchors[plot[0]][2])))
base = 3 + int(dist * 15 / 100 + 0.5)
def at_centre(email):
    psql(f"UPDATE aquaterra_locations SET district_id = {d}, spot = 'centre', plot_id = NULL, x = {cx[1]}, y = {cx[2]} WHERE email = {lit(email)}")
travel_("Ava", action="where"); travel_("Ben", action="where")

at_centre("ava@x")
a0 = bal("ava@x")
r = travel_("Ava", action="go", legs=[{"mode": "boat", "plot": plot[0]}])
own = math.ceil(base * 50 / 100)
check(r["ok"] and a0 - bal("ava@x") == own and r["fare"] == own, f"own pier: your boat costs half ({own} of {base})")
check(psql(f"SELECT trips FROM aquaterra_piers WHERE plot_id = {plot[0]}") == "1", "the pier counts the trip")

at_centre("ben@x")
b0, a0 = bal("ben@x"), bal("ava@x")
r = travel_("Ben", action="go", legs=[{"mode": "boat", "plot": plot[0]}])
check(r["ok"] and b0 - bal("ben@x") == base and bal("ava@x") == a0, "a private pier: visitors land on the beach at the usual fare")

check(pier("Ava", action="pier_set", plotId=plot[0], access="public", fee=2)["ok"], "made public, fee 2")
at_centre("ben@x")
b0, a0, s0 = bal("ben@x"), bal("ava@x"), bal("state:treasury")
r = travel_("Ben", action="go", legs=[{"mode": "boat", "plot": plot[0]}])
check(r["ok"] and b0 - bal("ben@x") == base + 2 and r["fare"] == base + 2, "a public pier: the boat plus the mooring fee")
check(bal("ava@x") - a0 == 1 and bal("state:treasury") - s0 == base + 1, "the owner gets the fee less the travel tax")
check(psql("SELECT count(*) FROM aquaterra_ledger WHERE ref = 'travel:pier'") == "1", "mooring booked")
check(psql(f"SELECT revenue FROM aquaterra_piers WHERE plot_id = {plot[0]}") == "1", "pier revenue counted")

# --- upgrade and remove
a0 = bal("ava@x")
r = pier("Ava", action="pier_upgrade", plotId=plot[0])
check(r["ok"] and r["pier"][1] == 2 and r["pier"][2] == "public" and a0 - bal("ava@x") == 880, "jetty to pier: 800 + 80")
psql(f"UPDATE aquaterra_piers SET ready_at = now() - interval '1 minute' WHERE plot_id = {plot[0]}")
check(pier("Ava", action="pier_set", plotId=plot[0], access="public", fee=5)["ok"], "pier fee cap 5")
mine = pier("Ava", action="pier_me")["mine"]
check(len(mine) == 1 and mine[0]["level"] == 2 and mine[0]["invested"] == 1100, "my piers")
check(len(pier(None, action="piers")["piers"]) == 1, "public list shows it")
a0 = bal("ava@x")
r = pier("Ava", action="pier_remove", plotId=plot[0])
check(r["ok"] and r["pier"] is None and a0 - bal("ava@x") == 20, "removed for 20 TIDE")
check(pier("Ava", action="pier_remove", plotId=plot[0])["error"] == "nothing_here", "nothing left to remove")
check(total() == t0, "no TIDE created or lost")
print(f"piers: {passed} checks passed")
