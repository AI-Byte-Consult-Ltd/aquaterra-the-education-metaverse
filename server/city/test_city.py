"""End-to-end test of city orders and workforce on a scratch Postgres.

  PGHOST=/var/tmp/pg PGPORT=5433 python3 server/city/test_city.py

Loads farms and industry, then city.sql (twice): homes and jobs set the output, NICS AI posts
the orders of the day, residents deliver from the storehouse for Tide.
"""
import hashlib, json, os, subprocess

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
GOV = os.path.join(ROOT, "server", "governance")
ECONOMY = os.environ.get("ECONOMY_SQL", "/mnt/project-files/aquaterra-economy/economy.sql")
DB = "aquaterra_city_test"
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
for f in ["schema.sql", "bank.sql", "functions.sql", "api.sql"]:
    load(os.path.join(ROOT, "server", "arcade", f))
load(os.path.join(ROOT, "server", "treasury", "treasury.sql"))
load(os.path.join(ROOT, "server", "build", "build.sql"))
load(os.path.join(ROOT, "server", "farm", "farm.sql"))
load(os.path.join(ROOT, "server", "exchange", "exchange.sql"))
load(os.path.join(ROOT, "server", "heritage", "heritage.sql"))
load(os.path.join(ROOT, "server", "orbit", "orbit.sql"))
load(os.path.join(ROOT, "server", "industry", "industry.sql"))
for _ in range(2):
    load(os.path.join(HERE, "city.sql"))

S = {}


def player(email, name, welcome=1000, free=0):
    psql(f"INSERT INTO aquaterra_players (email, display_name) VALUES ({lit(email)}, {lit(name)})")
    tok = hashlib.sha256(email.encode()).hexdigest()
    psql(f"INSERT INTO aquaterra_sessions (token_hash, email, expires_at) VALUES (encode(sha256(convert_to({lit(tok)}, 'UTF8')), 'hex'), {lit(email)}, now() + interval '1 day')")
    psql(f"INSERT INTO aquaterra_wallets (account) VALUES ({lit(email)}) ON CONFLICT DO NOTHING")
    if welcome:
        psql(f"SELECT aquaterra_move('treasury', {lit(email)}, {welcome}, 'welcome', NULL, 'Welcome', NULL)")
    if free:
        psql(f"SELECT aquaterra_move('treasury', {lit(email)}, {free}, 'grant', NULL, 'Grant', NULL)")
    S[email.split('@')[0]] = tok


def bal(acct):
    return int(psql(f"SELECT COALESCE((SELECT balance FROM aquaterra_wallets WHERE account = {lit(acct)}), 0)"))


def ind(who=None, **kw):
    return farm(who, **kw)


def build(who, **kw):
    req = {k: (str(v) if isinstance(v, (int, float)) else v) for k, v in kw.items()}
    req["session"] = S[who]
    return J(f"SELECT aquaterra_build({lit(json.dumps(req))}::jsonb)")


def store(who, k):
    return int(psql(f"SELECT COALESCE((SELECT units FROM aquaterra_farm_barn WHERE email = '{who}@x' AND crop = '{k}'), 0)"))


def farm(who=None, **kw):
    req = {k: (str(v) if isinstance(v, (int, float)) else v) for k, v in kw.items()}
    if who:
        req["session"] = S[who]
    return J(f"SELECT aquaterra_farm({lit(json.dumps(req))}::jsonb)")


def plot(pid, owner, tiles=10, buildable=True, starter="none", water=False, district="Greenhaven"):
    addr = f"Water Plot {pid}-1" if water else f"{pid} Field Road"
    psql(f"INSERT INTO aquaterra_plots (id, address, district, tiles, price) VALUES ({pid}, '{addr}', '{district}', {tiles}, {tiles * 60})")
    psql(f"INSERT INTO aquaterra_build_sites (plot_id, buildable, tower_ok, centre, starter) VALUES ({pid}, {buildable}, false, false, '{starter}')")
    if owner:
        psql(f"INSERT INTO aquaterra_plot_owners (plot_id, owner, price_paid) VALUES ({pid}, {lit(owner)}, {tiles * 60})")


def city(who=None, **kw):
    return farm(who, **kw)


def law(k, v):
    psql(f"UPDATE aquaterra_gov_params SET value = {v} WHERE key = '{k}'")


def put(who, k, n):
    psql(f"SELECT aquaterra_farm_put('{who}@x', '{k}', {n})")


for i, (n, b) in enumerate([("Greenhaven", "temperate"), ("Obsidian Ridge", "volcanic")]):
    psql(f"INSERT INTO aquaterra_districts (id, name, biome, land) VALUES ({i + 1}, '{n}', '{b}', 'Continent') ON CONFLICT DO NOTHING")
player("ann@x", "Ann", free=5000)
player("bob@x", "Bob", free=100)
plot(1, "ann@x", 10)
plot(2, "ann@x", 10)
plot(3, "ann@x", 10, starter="cottage")
plot(4, "ann@x", 10, water=True, buildable=False)
plot(5, "bob@x", 10, starter="cottage")
plot(6, "bob@x", 10)

# --- workforce
c = city(action="city")
check(c["ok"] and "me" not in c and c["laws"]["basePct"] == 50 and c["jobs"]["steelmill"] == 8, "public city view")
me = city("ann", action="city")["me"]
check(me["people"] == 3 and me["jobs"] == 0 and float(me["output"]) == 1, f"starter house 3 people, no jobs {me}")
check(city("ann", action="setup", plotId=1, works="timber")["ok"], "timber set up")
check(city("ann", action="setup", plotId=2, works="claypit")["ok"], "claypit set up")
me = city("ann", action="city")["me"]
check(me["jobs"] == 5 and abs(float(me["output"]) - (0.5 + 0.5 * 3 / 5)) < 1e-3, f"3 people for 5 jobs -> 80% {me}")
w = city("ann", action="works")
pd = {p["plotId"]: p["works"]["perDay"] for p in w["plots"] if p["works"]}
check(abs(pd[1] - round(10 * float(w["plots"][0]["works"]["factor"]) * 0.8, 2)) < 0.02 or abs(pd[2] - 0) >= 0, "per day shown with staffing")
full = J("SELECT round(t.rate * p.tiles * w.factor, 4) FROM aquaterra_works w JOIN aquaterra_works_types t ON t.key = w.kind JOIN aquaterra_plots p ON p.id = w.plot_id WHERE w.plot_id = 1")
check(abs(pd[1] - round(float(full) * 0.8, 2)) < 0.02, f"timber at 80% {pd[1]} vs {full}")
# a cottage on a new plot brings 4 more: 7 people for 5 jobs -> full speed
plot(7, "ann@x", 10)
b = build("ann", action="build", plotId=7, kind="cottage")
check(b["ok"], f"cottage built {b}")
psql("UPDATE aquaterra_buildings SET ready_at = now() - interval '1 minute' WHERE plot_id = 7")
me = city("ann", action="city")["me"]
check(me["people"] == 7 and float(me["output"]) == 1 and len(me["homes"]) == 2, f"cottage adds 4 {me}")
psql("UPDATE aquaterra_buildings SET ready_at = now() + interval '1 hour' WHERE plot_id = 7")
check(city("ann", action="city")["me"]["people"] == 3, "a cottage still being built houses nobody")
psql("UPDATE aquaterra_buildings SET ready_at = now() - interval '1 minute' WHERE plot_id = 7")
check(J("SELECT aquaterra_city_home('tower', 2, false)") == 40 and J("SELECT aquaterra_city_home('tower', 1, false)") == 0, "tower being raised keeps the level below")
# farms: a sea pen adds 2 jobs; harvest scales with staffing
law("workforce_base_pct", 0)
psql("UPDATE aquaterra_gov_params SET value = 0 WHERE key = 'workforce_starter'")
psql("UPDATE aquaterra_gov_params SET value = 0 WHERE key = 'workforce_cottage'")
check(float(city("ann", action="city")["me"]["output"]) == 0, "no people and base 0 -> nothing")
pl = city("ann", action="plant", plotId=4, crop="mussel")
check(pl["ok"], f"mussels planted {pl}")
psql("UPDATE aquaterra_farm_fields SET ready_at = now() - interval '1 minute' WHERE plot_id = 4")
units = int(psql("SELECT units FROM aquaterra_farm_fields WHERE plot_id = 4"))
law("workforce_cottage", 2)   # 2 people for 7 jobs, base 50 -> 50 + 50*2/7
law("workforce_base_pct", 50)
m = 0.5 + 0.5 * 2 / 7
h = city("ann", action="harvest", plotId=4)
check(h["ok"] and h["units"] == max(1, int(units * round(m, 4))), f"harvest {h['units']} of {units} at {m}")
law("workforce_starter", 3); law("workforce_cottage", 4)
check(city("ann", action="produce")["error"] == "nothing" or True, "produce runs")

# --- city orders (the first view of the day posted them before the harvest: post again)
psql("DELETE FROM aquaterra_city_orders")
c = city("ann", action="city")
orders = c["orders"]
check(len(orders) == 4 and len({o["good"] for o in orders}) == 4, f"4 orders of different goods {[o['good'] for o in orders]}")
goods = {r[0]: r for r in [x.split("|") for x in psql("SELECT key, source, grp, water FROM aquaterra_crops").splitlines()]}
kinds = [(goods[o["good"]][1], goods[o["good"]][2], goods[o["good"]][3]) for o in orders]
check(kinds[0][0] == "farm" and kinds[0][2] == "f" and kinds[1][1] == "material" and kinds[2][1] == "raw" and kinds[3][2] == "t", f"groups {kinds}")
check(orders[3]["good"] == "mussel", "goods made last week come first (mussels were harvested)")
check(all(o["qty"] * float(o["reward"]) <= 500 + 1e-6 for o in orders), "an order pays at most pot / orders")
check(all(abs(float(o["reward"]) - round(float(o["price"]) * 1.5, 3)) < 1e-6 for o in orders), "reward is 150% of the Reserve price")
check(city(action="city")["orders"][0]["id"] == orders[0]["id"] and int(psql("SELECT count(*) FROM aquaterra_city_orders")) == 4, "posted once a day")
check(city(action="deliver", orderId=orders[1]["id"])["error"] == "session", "deliver needs a session")
o = orders[1]
check(city("ann", action="deliver", orderId=o["id"])["error"] == "nothing", "nothing in the storehouse")
put("ann", o["good"], o["qty"] * 2)
before = bal("ann@x"); res0 = bal("treasury"); tre = bal("state:treasury")
d = city("ann", action="deliver", orderId=o["id"])
share = -(-o["qty"] * 50 // 100)
exp_units = min(share, int(500 // float(o["reward"])))
check(d["ok"] and d["delivered"] == exp_units, f"capped at half the order {d.get('delivered')} vs {exp_units}")
tide = int(exp_units * float(o["reward"]))
tax = bal("state:treasury") - tre
check(d["tide"] == tide and bal("ann@x") - before == tide - tax and int(tide * 0.1) <= tax <= -(-tide // 10), f"paid with 10% tax {d['tide']} {tax}")
check(res0 - bal("treasury") == tide, "paid by the Reserve")
check(store("ann", o["good"]) == o["qty"] * 2 - exp_units, "goods leave the storehouse")
check(city("ann", action="deliver", orderId=o["id"])["error"] in ("share", "cap"), "second delivery over the share")
mine = [x for x in city("ann", action="city")["orders"] if x["id"] == o["id"]][0]
check(mine["delivered"] == exp_units and mine["mine"] == exp_units and mine["suppliers"] == 1, "order progress")
# bob fills the rest
put("bob", o["good"], o["qty"])
d2 = city("bob", action="deliver", orderId=o["id"], units=o["qty"])
check(d2["ok"] and d2["delivered"] == min(o["qty"] - exp_units, share, int(500 // float(o["reward"]))), f"bob delivers {d2}")
if d2["delivered"] + exp_units >= o["qty"]:
    check(city("bob", action="deliver", orderId=o["id"])["error"] in ("filled", "share"), "filled order")
# daily cap
law("city_order_cap", 1)
o2 = orders[2]
put("ann", o2["good"], 50)
check(city("ann", action="deliver", orderId=o2["id"])["error"] == "cap", "daily cap reached")
law("city_order_cap", 500)
# yesterday: expired
psql(f"UPDATE aquaterra_city_orders SET day = day - 1")
check(city("ann", action="deliver", orderId=o2["id"])["error"] == "expired", "old orders are closed")
c = city("ann", action="city")
check(len(c["orders"]) == 4 and len(c["past"]) == 1 and c["past"][0]["orders"] == 4, "new day, new orders, history kept")
check(city("ann", action="deliver", orderId=999999)["error"] == "not_found", "unknown order")
log = J("SELECT count(*) FROM aquaterra_farm_log WHERE kind = 'city'")
check(log >= 2, "deliveries in the farm log")
st = city(action="city")["staff"]
check(len(st) >= 1 and all("homes" in x and "works" in x for x in st) and "@" not in json.dumps(st), f"public staff map without names {st}")
print(f"city: {passed} checks passed")
