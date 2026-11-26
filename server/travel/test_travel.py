"""End-to-end test of travel on a scratch Postgres.

  npx vite-node scripts/export-districts.ts && npx vite-node scripts/export-travel.ts
  PGHOST=/var/tmp/pg PGPORT=5433 python3 server/travel/test_travel.py

Loads the account fixture, the Commonwealth (server/governance), the Tide
economy (ECONOMY_SQL, default: the project's economy.sql) and travel.sql
(twice: the migration must be safe to run again), then plays trips.
"""
import hashlib, json, os, subprocess

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
GOV = os.path.join(ROOT, "server", "governance")
ECONOMY = os.environ.get("ECONOMY_SQL", "/mnt/project-files/aquaterra-economy/economy.sql")
DB = "aquaterra_travel_test"
BASE = ["psql", "-U", os.environ.get("PGUSER", "postgres"), "-v", "ON_ERROR_STOP=1", "-q", "-tA"]

def psql(sql, db=DB):
    # through stdin: travel.json is too long for one command-line argument
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
J(f"SELECT aquaterra_gov_tick({lit(json.dumps(districts))}::jsonb)")
name = {d["id"]: d["name"] for d in districts}
# a small land registry: three plots per district plus one plot of open water
anchors = {a[0]: a for a in travel["anchors"]}
reg = json.load(open(os.path.join(ROOT, "public", "land-registry.json")))["plots"]
by_d = {}
for p in reg:
    by_d.setdefault(p[2], []).append(p)
sample = [p for ps in by_d.values() for p in ps[:3]]
psql("INSERT INTO aquaterra_plots (id, address, district, tiles, price) SELECT (e->>0)::int, e->>1, e->>2, (e->>3)::int, (e->>4)::bigint FROM jsonb_array_elements("
     + lit(json.dumps(sample)) + "::jsonb) e")

# isles: a few plots that stand on other land than their town square (islets), for the boat checks
cisle = {c[0]: c[3] for c in travel["centres"] if len(c) > 3}
did = {v: k for k, v in name.items()}
wet_plots = [p for p in reg if p[2] in did and len(anchors.get(p[0], [])) > 3 and anchors[p[0]][3] != cisle.get(did[p[2]])][:3]
extra = [p for p in wet_plots if p not in sample]
sample += extra
if extra:
    psql("INSERT INTO aquaterra_plots (id, address, district, tiles, price) SELECT (e->>0)::int, e->>1, e->>2, (e->>3)::int, (e->>4)::bigint FROM jsonb_array_elements("
         + lit(json.dumps(extra)) + "::jsonb) e")
for _ in range(2):
    load(os.path.join(HERE, "travel.sql"))
    load(os.path.join(HERE, "boats.sql"))
check("aquaterra_travel_may_buy" in psql("SELECT prosrc FROM pg_proc WHERE proname = 'aquaterra_economy'"), "economy patched once")
check(psql("SELECT count(*) FROM regexp_matches((SELECT prosrc FROM pg_proc WHERE proname = 'aquaterra_economy'), 'aquaterra_travel_may_buy', 'g')") == "1", "patch is not doubled")

r = J(f"SELECT aquaterra_travel_sync({lit(json.dumps(travel))}::jsonb)")
check(r["ok"] and r["totalHubs"] == len(travel["hubs"]) and r["totalRoutes"] == len(travel["routes"]), "travel.json synced")
check(r["anchors"] == len(sample), "plot anchors stored")
r = J(f"SELECT aquaterra_travel_sync({lit(json.dumps(travel))}::jsonb)")
check(r["hubs"] == 0 and r["routes"] == 0, "second sync changes nothing")
check(not J("SELECT aquaterra_travel_sync('{\"hubs\":[]}'::jsonb)")["ok"], "empty file refused")

S = {}
def player(email, nm, role="citizen"):
    psql(f"INSERT INTO aquaterra_players (email, display_name, role) VALUES ({lit(email)}, {lit(nm)}, {lit(role)})")
    tok = hashlib.sha256(email.encode()).hexdigest()
    psql(f"INSERT INTO aquaterra_sessions (token_hash, email, expires_at) VALUES (encode(sha256(convert_to({lit(tok)}, 'UTF8')), 'hex'), {lit(email)}, now() + interval '1 day')")
    S[nm] = tok

def travel_(who, **req):
    if who:
        req["session"] = S[who]
    return J(f"SELECT aquaterra_travel({lit(json.dumps(req))}::jsonb)")

def econ(who, **req):
    req["session"] = S[who]
    return J(f"SELECT aquaterra_economy({lit(json.dumps(req))}::jsonb)")

bal = lambda acct: int(psql(f"SELECT COALESCE((SELECT balance FROM aquaterra_wallets WHERE account = {lit(acct)}), 0)"))

player("founder@x", "Alexander", "founder")
player("ava@x", "Ava")
player("ben@x", "Ben")
psql("INSERT INTO aquaterra_residents (email, district_id) VALUES ('ben@x', 16)")

net = travel_(None, action="network")
check(net["ok"] and len(net["routes"]) == len(travel["routes"]) and net["taxPct"] == 10, "public network with the travel tax")
check("me" not in net, "no location without a session")
check(travel_(None, action="where", session="0" * 64)["error"] == "session", "bad session refused")

# --- spawn
w = travel_("Ava", action="where")["me"]
c0 = [c for c in travel["centres"] if c[0] == 0][0]
check(w["districtId"] == 0 and w["spot"] == "centre" and (w["x"], w["y"]) == (c0[1], c0[2]), "newcomer appears in First Light City")
check(travel_("Ben", action="where")["me"]["districtId"] == 16, "a resident appears in the home district")
check(J("SELECT aquaterra_player_where('ben@x')")["district"] == name[16], "aquaterra_player_where for other workflows")

econ("Ava", action="wallet")  # welcome grant
start = bal("ava@x")
check(start == 1000, "welcome 1000 TIDE")

# --- land only where you stand
far = by_d[name[16]][0]
here = by_d[name[0]][0]
check(econ("Ava", action="buy", plotId=far[0])["error"] == "not_here", "cannot buy land in another district")
r = econ("Ava", action="buy", plotId=here[0])
check(r["ok"], "buys land in First Light City")
spent = here[4]

# --- walk: free, inside the district only
r = travel_("Ava", action="go", legs=[{"mode": "walk", "plot": here[0]}])
check(r["ok"] and r["fare"] == 0 and r["me"]["spot"] == "plot" and r["me"]["x"] == anchors[here[0]][1], "walks to her plot for free")
check(travel_("Ava", action="go", legs=[{"mode": "walk", "plot": far[0]}])["error"] == "not_here", "cannot walk to another district")
check(psql("SELECT count(*) FROM aquaterra_trips") == "0", "walks are not trips")

# --- car to a neighbour
car = [x for x in travel["routes"] if x[0] == "car" and 0 in (x[1], x[2])][0]
nb = car[2] if car[1] == 0 else car[1]
fare = 2 + int(car[3] * 8 / 100 + 0.5)
tax = max(1, round(fare * 0.10))
st0 = bal("state:treasury")
r = travel_("Ava", action="go", legs=[{"mode": "car", "to": nb}])
check(r["ok"] and r["fare"] == fare and r["tax"] == tax and r["me"]["districtId"] == nb and r["me"]["spot"] == "centre", f"car to {name[nb]} for {fare} TIDE")
check(bal("ava@x") == start - spent - fare, "fare taken from the wallet")
check(bal("state:treasury") - st0 == fare, "roads are the state's: the whole fare goes to the treasury")
check(psql("SELECT count(*) FROM aquaterra_ledger WHERE ref = 'tax:travel'") == "1", "travel tax booked separately")
check(travel_("Ava", action="go", legs=[{"mode": "car", "to": 40}])["error"] == "route", "no road to the Northern Archipelago")
check(bal("ava@x") == start - spent - fare, "a refused trip costs nothing")

# --- back by car, then the train; then the whole trip refused when money runs short
travel_("Ava", action="go", legs=[{"mode": "car", "to": 0}])
r = travel_("Ava", action="go", legs=[{"mode": "train", "to": 16}, {"mode": "ferry", "to": 39}, {"mode": "car", "to": 40}])
check(r["ok"] and r["me"]["districtId"] == 40 and len(r["legs"]) == 3, "train, ferry and car to Driftstone Isles in one trip")
check(r["legs"][0]["operator"] == "State Treasury", "unowned station: fare to the state")
check(travel_("Ava", action="go", legs=[{"mode": "train", "to": 0}])["error"] == "route", "no station in Driftstone Isles")
before = bal("ava@x")
psql("UPDATE aquaterra_wallets SET balance = 3 WHERE account = 'ava@x'")
check(travel_("Ava", action="go", legs=[{"mode": "car", "to": 39}, {"mode": "ferry", "to": 16}])["error"] == "insufficient", "not enough TIDE")
check(bal("ava@x") == 3 and travel_("Ava", action="where")["me"]["districtId"] == 40, "nothing charged, still on the island")
psql(f"UPDATE aquaterra_wallets SET balance = {before} WHERE account = 'ava@x'")

# --- owning a station: the operator share goes to its owner
check(travel_("Ben", action="buy_hub", hub="station:16")["error"] == "insufficient", "welcome coins cannot buy a station")
J(f"SELECT aquaterra_economy({lit(json.dumps({'action': 'admin_grant', 'session': S['Alexander'], 'to': 'ben@x', 'amount': 30000}))}::jsonb)")
check(travel_("Ben", action="buy_hub", hub="station:0")["error"] == "not_here", "buy a station only where you stand")
st0 = bal("state:treasury")
r = travel_("Ben", action="buy_hub", hub="station:16")
check(r["ok"] and r["price"] == 25000 and bal("state:treasury") - st0 == 25000, "Ben buys Snowcrest Station from the state")
check(travel_("Alexander", action="buy_hub", hub="station:16")["error"] == "taken", "a station has one owner")
travel_("Ava", action="go", legs=[{"mode": "car", "to": 39}, {"mode": "ferry", "to": 16}])
b0, s0, a0 = bal("ben@x"), bal("state:treasury"), bal("ava@x")
r = travel_("Ava", action="go", legs=[{"mode": "train", "to": 0}])
f, t = r["fare"], r["tax"]
check(r["legs"][0]["operator"] == "Ben" and bal("ben@x") - b0 == f - t and bal("state:treasury") - s0 == t and a0 - bal("ava@x") == f,
      "Ben earns the fare less the travel tax; the tax goes to the treasury")
hub = [h for h in travel_(None, action="network")["hubs"] if h["id"] == "station:16"][0]
check(hub["owner"] == "Ben" and hub["trips"] == 1 and hub["revenue"] == f - t, "station books its trips and revenue")
b0, s0 = bal("ben@x"), bal("state:treasury")
r = travel_("Ben", action="go", legs=[{"mode": "train", "to": 0}])
check(r["fare"] == r["tax"] and bal("ben@x") == b0 - r["tax"] and bal("state:treasury") - s0 == r["tax"], "the owner pays only the tax on his own line")

# --- the tax is a law: the Commonwealth can change it
psql("UPDATE aquaterra_gov_params SET value = 0 WHERE key = 'travel_tax_pct'")
n_tax = psql("SELECT count(*) FROM aquaterra_ledger WHERE ref = 'tax:travel'")
r = travel_("Ava", action="go", legs=[{"mode": "car", "to": nb}])
check(r["tax"] == 0 and psql("SELECT count(*) FROM aquaterra_ledger WHERE ref = 'tax:travel'") == n_tax, "tax 0: no tax entry")
psql("UPDATE aquaterra_gov_params SET value = 50 WHERE key = 'travel_tax_pct'")
r = travel_("Ava", action="go", legs=[{"mode": "car", "to": 0}])
check(r["tax"] == int(r["fare"] / 2 + 0.5), "tax 50%")
psql("UPDATE aquaterra_gov_params SET value = 10 WHERE key = 'travel_tax_pct'")

# --- open water: bought from a district with a harbour
water = by_d.get("Open water", [None])[0]
if water:
    port_d = int([h for h in travel["hubs"] if h[1] == "port"][0][2])
    no_port = [d["id"] for d in districts if not any(h[1] == "port" and h[2] == d["id"] for h in travel["hubs"])][0]
    psql(f"UPDATE aquaterra_locations SET district_id = {no_port} WHERE email = 'ava@x'")
    check(econ("Ava", action="buy", plotId=water[0])["error"] == "not_here", "open water not from an inland town")
    psql(f"UPDATE aquaterra_locations SET district_id = {port_d} WHERE email = 'ava@x'")
    J(f"SELECT aquaterra_economy({lit(json.dumps({'action': 'admin_grant', 'session': S['Alexander'], 'to': 'ava@x', 'amount': 5000}))}::jsonb)")
    check(econ("Ava", action="buy", plotId=water[0])["ok"], "open water bought from a harbour town")

# --- bad input and admin
check(travel_("Ava", action="go", legs=[{"mode": "walk"}, {"mode": "car", "to": 0}])["error"] == "route", "walk must end the trip")
check(travel_("Ava", action="go", legs=[{"mode": "teleport", "to": 5}])["error"] == "route", "no teleport")
check(travel_("Ava", action="go", legs=[{"mode": "car", "to": "x"}])["error"] == "route", "garbage refused")
check(travel_("Ava", action="admin")["error"] == "forbidden", "admin is for the founder")
r = travel_("Alexander", action="admin_param", key="price_port", value=9000)
check(r["ok"] and r["params"]["price_port"] == 9000 and r["trips"] >= 5, "founder changes a price and sees stats")
check(psql("SELECT DISTINCT price FROM aquaterra_travel_hubs WHERE kind = 'port' AND owner IS NULL") == "9000", "unsold harbours follow")
check(travel_("Alexander", action="admin_param", key="nope", value=1)["error"] == "param", "unknown param refused")
check(psql("SELECT count(*) FROM aquaterra_wallets WHERE balance < 0") == "0", "no negative balances")
total = int(psql("SELECT sum(balance) FROM aquaterra_wallets"))
check(total == 50_000_000, "no TIDE created or lost")


# --- nobody walks on water: boats
check(psql("SELECT count(*) FROM regexp_matches((SELECT prosrc FROM pg_proc WHERE proname = 'aquaterra_travel'), 'aquaterra_travel_boat\\(me, ''auto''', 'g')") == "1", "boats patch is not doubled")
check(psql("SELECT count(*) FROM aquaterra_plots WHERE isle IS NOT NULL") == str(len(sample)), "sync stores the isle of each plot")
check(psql("SELECT count(*) FROM aquaterra_travel_hubs WHERE isle IS NOT NULL") != "0", "and of hubs")
check(len(wet_plots) > 0, "the map has islets in a district")
import math
wp = wet_plots[0]
wd = did[wp[2]]
cx = [c for c in travel["centres"] if c[0] == wd][0]
psql(f"UPDATE aquaterra_locations SET district_id = {wd}, spot = 'centre', plot_id = NULL, x = {cx[1]}, y = {cx[2]} WHERE email = 'ava@x'")
J(f"SELECT aquaterra_economy({lit(json.dumps({'action': 'admin_grant', 'session': S['Alexander'], 'to': 'ava@x', 'amount': 500}))}::jsonb)")
a0, s0 = bal("ava@x"), bal("state:treasury")
r = travel_("Ava", action="go", legs=[{"mode": "walk", "plot": wp[0]}])
check(r.get("error") == "boat" and bal("ava@x") == a0, f"cannot walk across water to an islet of {wp[2]}")
dist = max(1, round(math.hypot(cx[1] - anchors[wp[0]][1], cx[2] - anchors[wp[0]][2])))
bfare = 3 + int(dist * 15 / 100 + 0.5)
btax = max(1, round(bfare * 0.10))
r = travel_("Ava", action="go", legs=[{"mode": "boat", "plot": wp[0]}])
check(r["ok"] and r["fare"] == bfare and r["tax"] == btax and r["me"]["plotId"] == wp[0] and r["legs"][0]["mode"] == "boat", f"boat to the islet for {bfare} TIDE")
check(a0 - bal("ava@x") == bfare and bal("state:treasury") - s0 == bfare, "boats are the state's: fare and tax to the treasury")
check(psql("SELECT count(*) FROM aquaterra_ledger WHERE ref = 'travel:boat'") == "1", "boat fare booked")
check(psql(f"SELECT count(*) FROM aquaterra_trips WHERE fare = {bfare}") != "0", "a paid boat is a trip")
check(travel_("Ava", action="go", legs=[{"mode": "walk"}])["error"] == "boat", "no walk back over the water")
out = [x for x in travel["routes"] if x[0] == "car" and wd in (x[1], x[2])]
if out:
    to = out[0][2] if out[0][1] == wd else out[0][1]
    a0 = bal("ava@x")
    r = travel_("Ava", action="go", legs=[{"mode": "car", "to": to}])
    check(r["ok"] and r["legs"][0]["mode"] == "boat" and r["legs"][1]["mode"] == "car" and a0 - bal("ava@x") == r["fare"], "from the islet: a boat to the town square, then the car")
    r = travel_("Ava", action="go", legs=[{"mode": "car", "to": wd}])
    check(r["ok"] and len(r["legs"]) == 1, "from town square to town square: no boat")
if water:
    psql(f"UPDATE aquaterra_locations SET district_id = {port_d}, spot = 'centre', plot_id = NULL WHERE email = 'ava@x'")
    check(travel_("Ava", action="go", legs=[{"mode": "walk", "plot": water[0]}])["error"] == "boat", "no walking onto a water plot")
    check(travel_("Ava", action="go", legs=[{"mode": "boat", "plot": water[0]}])["ok"], "a boat to the water plot")
print(f"OK: {passed} checks passed")
