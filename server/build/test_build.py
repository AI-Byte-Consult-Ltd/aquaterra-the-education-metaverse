"""End-to-end test of building on a scratch Postgres.

  npx vite-node scripts/land-registry.ts && npx vite-node scripts/export-build-sites.ts
  PGHOST=/var/tmp/pg PGPORT=5433 python3 server/build/test_build.py

Loads the account fixture, the Commonwealth (server/governance), the Tide
economy (ECONOMY_SQL, default: the project's economy.sql) and build.sql (twice:
the migration must be safe to run again), then builds, raises, sells and
demolishes, and checks that every TIDE is accounted for.
"""
import hashlib, json, os, subprocess

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
GOV = os.path.join(ROOT, "server", "governance")
ECONOMY = os.environ.get("ECONOMY_SQL", "/mnt/project-files/aquaterra-economy/economy.sql")
DB = "aquaterra_build_test"
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
for _ in range(2):
    load(os.path.join(HERE, "build.sql"))

reg = json.load(open(os.path.join(ROOT, "public", "land-registry.json")))["plots"]
sites = json.load(open(os.path.join(ROOT, "public", "world", "build-sites.json")))
psql("INSERT INTO aquaterra_plots (id, address, district, tiles, price) SELECT (e->>0)::int, e->>1, e->>2, (e->>3)::int, (e->>4)::bigint FROM jsonb_array_elements("
     + lit(json.dumps(reg)) + "::jsonb) e")
r = J(f"SELECT aquaterra_build_sync({lit(json.dumps(sites))}::jsonb)")
check(r["ok"] and r["total"] == len(sites["sites"]), "build-sites.json synced")
check(J(f"SELECT aquaterra_build_sync({lit(json.dumps(sites))}::jsonb)")["changed"] == 0, "second sync changes nothing")
check(not J("SELECT aquaterra_build_sync('{\"sites\":[]}'::jsonb)")["ok"], "empty file refused")

flags = {s[0]: s for s in sites["sites"]}
centre_tower = next(s[0] for s in sites["sites"] if s[1] == 7)
plain_tower = next(s[0] for s in sites["sites"] if s[1] == 3 and s[2] == "cottage")
small = next(s[0] for s in sites["sites"] if s[1] & 3 == 1 and s[2] == "none")
water = next(s[0] for s in sites["sites"] if s[1] == 0)

S = {}
def player(email, nm, role="citizen"):
    psql(f"INSERT INTO aquaterra_players (email, display_name, role) VALUES ({lit(email)}, {lit(nm)}, {lit(role)})")
    tok = hashlib.sha256(email.encode()).hexdigest()
    psql(f"INSERT INTO aquaterra_sessions (token_hash, email, expires_at) VALUES (encode(sha256(convert_to({lit(tok)}, 'UTF8')), 'hex'), {lit(email)}, now() + interval '1 day')")
    S[nm] = tok

def build(who, **req):
    if who:
        req["session"] = S[who]
    return J(f"SELECT aquaterra_build({lit(json.dumps(req))}::jsonb)")

def give(email, plot, amount):
    """Hand a plot and free coins to a player directly (the economy has its own tests)."""
    psql(f"INSERT INTO aquaterra_wallets (account, welcomed_at) VALUES ({lit(email)}, now()) ON CONFLICT DO NOTHING")
    if amount:
        psql(f"SELECT aquaterra_move('treasury', {lit(email)}, {amount}, 'grant', NULL, 'test', NULL)")
    if plot is not None:
        psql(f"INSERT INTO aquaterra_plot_owners (plot_id, owner, price_paid) VALUES ({plot}, {lit(email)}, 100)")

bal = lambda acct: int(psql(f"SELECT COALESCE((SELECT balance FROM aquaterra_wallets WHERE account = {lit(acct)}), 0)"))
total = lambda: int(psql("SELECT sum(balance) FROM aquaterra_wallets"))
supply = total()
ready_all = lambda: psql("UPDATE aquaterra_buildings SET ready_at = now() - interval '1 second', income_from = now() - interval '1 second'")

player("founder@x", "Alexander", "founder")
player("ava@x", "Ava")
player("ben@x", "Ben")
give("ava@x", centre_tower, 100000)
for p in (plain_tower, small, water):
    give("ava@x", p, 0)
give("ben@x", None, 5000)

m = build(None, action="map")
check(m["ok"] and m["buildings"] == [] and m["rules"]["centreHeight"] == 60 and m["rules"]["incomeTaxPct"] == 10, "public map with the laws")
check(build(None, action="me")["error"] == "session", "me needs a session")

# --- refusals
check(build("Ben", action="build", plotId=small, kind="cottage")["error"] == "not_owner", "only the owner builds")
check(build("Ava", action="build", plotId=water, kind="cottage")["error"] == "not_buildable", "nothing on water")
check(build("Ava", action="build", plotId=small, kind="tower")["error"] == "tower_site", "small plots take no skyscraper")
check(build("Ava", action="build", plotId=small, kind="castle")["error"] == "kind", "unknown kind refused")
check(build("Ava", action="build", plotId=plain_tower, kind="tower")["error"] == "occupied", "starter house must be replaced on purpose")
check(build("Ava", action="upgrade", plotId=centre_tower)["error"] == "kind", "nothing to raise yet")

# --- a cottage on open land: cost to the Reserve, permit to the State Treasury
st0, a0 = bal("state:treasury"), bal("ava@x")
r = build("Ava", action="build", plotId=small, kind="cottage", design=4)
check(r["ok"] and r["cost"] == 400 and r["permit"] == 40 and r["building"][1:4] == ["cottage", 0, 4], "cottage built")
check(bal("ava@x") == a0 - 440 and bal("state:treasury") == st0 + 40, "cottage paid: cost and permit")
check(build("Ava", action="collect")["error"] == "nothing_to_claim", "no income while it is being built")

# --- a skyscraper in the centre grows by levels
r = build("Ava", action="build", plotId=centre_tower, kind="tower", design=17)
check(r["ok"] and r["cost"] == 1500 and r["permit"] == 150 and r["floors"] == 0, "foundation laid")
check(build("Ava", action="upgrade", plotId=centre_tower)["error"] == "building", "next level waits for the last one")
ready_all()
r = build("Ava", action="upgrade", plotId=centre_tower)
check(r["ok"] and r["floors"] == 10 and r["cost"] == 3000 and r["building"][3] == 17, "raised to 10 floors, design kept")
ready_all()
# the Council caps the centre at 10 floors
psql("UPDATE aquaterra_gov_params SET value = 10 WHERE key = 'centre_height_floors'")
check(build("Ava", action="upgrade", plotId=centre_tower)["error"] == "height_limit", "centre height law holds")
psql("UPDATE aquaterra_gov_params SET value = 60 WHERE key = 'centre_height_floors'")
check(build("Ava", action="upgrade", plotId=centre_tower)["floors"] == 30, "raised to 30 floors once the law allows")
ready_all()
check(build("Ava", action="upgrade", plotId=centre_tower)["floors"] == 60, "raised to 60 floors")
ready_all()
check(build("Ava", action="upgrade", plotId=centre_tower)["error"] == "max_level", "60 floors is the top")
inv = int(psql(f"SELECT invested FROM aquaterra_buildings WHERE plot_id = {centre_tower}"))
check(inv == 1500 + 3000 + 8000 + 20000, "investment adds up")

# --- income: two days of a 60-floor tower and a cottage; taller pays more tax
psql("UPDATE aquaterra_buildings SET income_from = now() - interval '2 days', ready_at = now() - interval '2 days'")
me = build("Ava", action="me")
tw = next(x for x in me["mine"] if x["plotId"] == centre_tower)
check(tw["pending"] == 520 and tw["rate"] == 260 and float(tw["taxPct"]) == 14, "60 floors: 260 a day, 10% + 2 x 2% tax")
a0, st0 = bal("ava@x"), bal("state:treasury")
r = build("Ava", action="collect")
check(r["ok"] and r["tax"] == round(520 * 0.14) + round(8 * 0.10) and r["amount"] == 520 + 8 - r["tax"], "income paid net of tax")
check(bal("ava@x") == a0 + r["amount"] and bal("state:treasury") == st0 + r["tax"], "tax went to the State Treasury")
psql("UPDATE aquaterra_buildings SET income_from = now() - interval '30 days', ready_at = now() - interval '30 days'")
check(next(x for x in build("Ava", action="me")["mine"] if x["plotId"] == centre_tower)["pending"] == 260 * 7, "income stops at the cap")

# --- sell back, demolish, replace
a0 = bal("ava@x")
r = build("Ava", action="sell", plotId=centre_tower)
check(r["ok"] and r["refund"] == inv // 2 and r["building"][1] == "empty", "Reserve bought the tower back at half")
check(bal("ava@x") == a0 + inv // 2 + 260 * 7 - round(260 * 7 * 0.14), "refund plus the income collected first")
check(build("Ava", action="sell", plotId=centre_tower)["error"] == "nothing_here", "nothing left to sell")
r = build("Ava", action="demolish", plotId=plain_tower)
check(r["ok"] and r["fee"] == 20, "starter house demolished for the fee")
r = build("Ava", action="build", plotId=small, kind="tower", replace=True)
check(r["error"] == "tower_site", "still no skyscraper on small land")
r = build("Ava", action="build", plotId=small, kind="cottage", design=1, replace=True)
check(r["ok"] and r["fee"] == 20 and r["building"][3] == 1, "cottage replaced by another design")

# --- poor residents and welcome coins
psql("INSERT INTO aquaterra_ledger (kind, to_account, amount) VALUES ('welcome', 'ben@x', 5000)")
give("ben@x", flags and next(s[0] for s in sites["sites"] if s[1] == 3 and s[2] == "none" and s[0] != centre_tower), 0)
benplot = int(psql("SELECT plot_id FROM aquaterra_plot_owners WHERE owner = 'ben@x'"))
check(build("Ben", action="build", plotId=benplot, kind="tower")["error"] == "insufficient", "welcome coins are for land only")

# --- map and admin
m = build(None, action="map")
check(sorted(b[0] for b in m["buildings"]) == sorted([small, centre_tower, plain_tower]), "map lists every changed plot")
check(build("Ava", action="admin")["error"] == "forbidden", "admin is for the founder")
check(build("Alexander", action="admin_param", key="cottage_cost", value=500)["rules"]["params"]["cottage_cost"] == 500, "founder sets a rate")
check(build("Alexander", action="admin_param", key="permit_pct", value=500)["error"] == "amount", "percent capped at 100")
check(build("Alexander", action="admin_param", key="nope", value=1)["error"] == "param", "unknown rate refused")
a = build("Alexander", action="admin")
check(a["counts"]["towers"] == 0 and a["counts"]["cottages"] == 1 and a["permits"] > 0, "admin overview")

check(total() == supply, "every TIDE is accounted for")
print(f"build: {passed} checks passed")
