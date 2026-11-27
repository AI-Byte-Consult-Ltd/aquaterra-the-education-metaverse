"""End-to-end test of First Light Realty, sales to the state and harvest barter on a scratch Postgres.

  PGHOST=/var/tmp/pg PGPORT=5433 python3 server/agency/test_agency.py
"""
import hashlib, json, os, subprocess

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
SRV = os.path.join(ROOT, "server")
ECONOMY = os.environ.get("ECONOMY_SQL", "/mnt/project-files/aquaterra-economy/economy.sql")
DB = "aquaterra_agency_test"
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
load(os.path.join(SRV, "governance", "base-tables.sql"))
load(ECONOMY)
for f in ["schema.sql", "functions.sql", "api.sql"]:
    load(os.path.join(SRV, "governance", f))
load(os.path.join(SRV, "travel", "travel.sql"))
for f in ["schema.sql", "bank.sql", "functions.sql", "api.sql"]:
    load(os.path.join(SRV, "arcade", f))
load(os.path.join(SRV, "treasury", "treasury.sql"))
load(os.path.join(SRV, "exchange", "exchange.sql"))
psql("INSERT INTO aquaterra_exchange_settings (key, value) VALUES ('deposit_address', '0x" + "5c" * 20 + "') ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value")
load(os.path.join(SRV, "build", "build.sql"))
load(os.path.join(SRV, "roads", "roads.sql"))
load(os.path.join(SRV, "heritage", "heritage.sql"))
load(os.path.join(SRV, "orbit", "orbit.sql"))
load(os.path.join(SRV, "farm", "farm.sql"))
for _ in range(2):
    load(os.path.join(HERE, "agency.sql"))

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


def ag(who=None, **kw):
    req = {k: (str(v) if isinstance(v, (int, float)) else v) for k, v in kw.items()}
    if who:
        req["session"] = S[who]
    return J(f"SELECT aquaterra_agency({lit(json.dumps(req))}::jsonb)")


def plot(pid, owner, price=1000, paid=None, days=30, buildable=True):
    psql(f"INSERT INTO aquaterra_plots (id, address, district, tiles, price) VALUES ({pid}, '{pid} Realty Lane', 'Greenhaven', 10, {price})")
    psql(f"INSERT INTO aquaterra_build_sites (plot_id, buildable, tower_ok, centre, starter) VALUES ({pid}, {buildable}, false, false, 'none')")
    if owner:
        psql(f"INSERT INTO aquaterra_plot_owners (plot_id, owner, price_paid, bought_at, income_from) VALUES ({pid}, {lit(owner)}, {paid or price}, now() - interval '{days} days', now())")


player("ann@x", "Ann", free=5000)
player("bob@x", "Bob", free=20000)
player("cat@x", "Cat", welcome=1000, free=0)
plot(1, "ann@x", 1000)
plot(2, "ann@x", 1000, days=1)
plot(3, "ann@x", 1000, paid=400)
plot(4, "bob@x", 2000)
plot(5, "ann@x", 1000)
plot(6, "ann@x", 1000)

# ---- laws and public list
r = ag(action="list")
check(r["ok"] and r["laws"]["feePct"] == 3.6 and r["laws"]["statePct"] == 70 and r["listings"] == [], f"list {r}")
check(ag(action="mine")["error"] == "session", "mine needs a session")

# ---- sale to the state
a = ag("ann", action="appraise", plotId=1)["appraisal"]
check(a["land"] == 700 and a["tax"] == 21 and a["net"] == 679 and a["block"] is None, f"appraise {a}")
check(ag("ann", action="appraise", plotId=2)["appraisal"]["block"] == "too_soon", "hold days")
check(ag("ann", action="appraise", plotId=3)["appraisal"]["land"] == 280, "cheap land is valued at what was paid")
check(ag("bob", action="sell_state", plotId=1)["error"] == "not_owner", "only the owner sells")
check(ag("ann", action="sell_state", plotId=2)["error"] == "too_soon", "too soon")
psql("INSERT INTO aquaterra_buildings (plot_id, kind, level, invested) VALUES (1, 'cottage', 1, 600)")
a = ag("ann", action="appraise", plotId=1)["appraisal"]
check(a["house"] == 300 and a["gross"] == 1000 and a["net"] == 970, f"house in the valuation {a}")
ann0, st0, res0 = bal("ann@x"), bal("state:treasury"), bal("treasury")
r = ag("ann", action="sell_state", plotId=1)
check(r["ok"], f"sell_state {r}")
check(bal("ann@x") >= ann0 + 970, "paid the valuation")
check(bal("state:treasury") >= st0 + 30, "sales tax to the State Treasury")
check(psql("SELECT count(*) FROM aquaterra_plot_owners WHERE plot_id = 1") == "0", "plot back in the registry")
check(psql("SELECT kind FROM aquaterra_buildings WHERE plot_id = 1") == "empty", "house taken down")
psql("INSERT INTO aquaterra_farm_fields (plot_id, owner, crop, units, seed_paid, ready_at) VALUES (5, 'ann@x', 'rose', 10, 4, now())")
check(ag("ann", action="sell_state", plotId=5)["error"] == "field", "farmed plot")
check(ag("ann", action="list_add", kind="plot", ref="5", price=10)["error"] == "field", "farmed plot cannot be listed")

# ---- agency: plot
check(ag("ann", action="list_add", kind="plot", ref="4", price=10)["error"] == "not_owner", "list only what you own")
check(ag("ann", action="list_add", kind="plot", ref="6", price="abc")["error"] == "price", "price")
r = ag("ann", action="list_add", kind="plot", ref="6", price=5000)
check(r["ok"], f"list_add {r}")
lid = r["listingId"]
check(ag("ann", action="list_add", kind="plot", ref="6", price=10)["error"] == "listed", "listed once")
check(ag("ann", action="buy", id=lid)["error"] == "self", "no self buy")
check(ag("cat", action="buy", id=lid)["error"] == "insufficient", "welcome Tide does not buy from residents")
pub = ag(action="list", kind="plot")["listings"]
check(len(pub) == 1 and pub[0]["duty"] == 100 and pub[0]["seller"] == "Ann", f"public {pub}")
ann0, bob0, st0, agc0 = bal("ann@x"), bal("bob@x"), bal("state:treasury"), bal("state:agency")
r = ag("bob", action="buy", id=lid)
check(r["ok"] and r["duty"] == 100, f"buy {r}")
check(bal("bob@x") == bob0 - 5100, f"buyer pays price and duty {bob0} {bal('bob@x')}")
check(bal("ann@x") == ann0 + 5000 - 180 - 150, f"seller gets price less 3.6% and 3% {bal('ann@x') - ann0}")
check(bal("state:agency") == agc0 + 180, "commission to First Light Realty")
check(bal("state:treasury") == st0 + 150 + 100, "sales tax and duty to the State Treasury")
check(psql("SELECT owner || ' ' || price_paid FROM aquaterra_plot_owners WHERE plot_id = 6") == "bob@x 1000", "new owner, income on registry price")
check(ag("cat", action="buy", id=lid)["error"] == "not_found", "sold once")
check(psql("SELECT kind FROM aquaterra_ledger WHERE ref = 'agency:%s:price'" % lid) == "agency_sale", "ledger kind")

# plot limit
psql("UPDATE aquaterra_economy_params SET value = 2 WHERE key = 'max_plots_per_citizen'")
l2 = ag("ann", action="list_add", kind="plot", ref="3", price=10)["listingId"]
check(ag("bob", action="buy", id=l2)["error"] == "plot_limit", "plot limit")
psql("UPDATE aquaterra_economy_params SET value = 100 WHERE key = 'max_plots_per_citizen'")
check(ag("ann", action="list_cancel", id=l2)["ok"], "cancel")
check(ag("bob", action="buy", id=l2)["error"] == "not_found", "cancelled")

# seller lost the asset after listing
l3 = ag("ann", action="list_add", kind="plot", ref="2", price=10)["listingId"]
psql("UPDATE aquaterra_plot_owners SET owner = 'cat@x' WHERE plot_id = 2")
check(ag("bob", action="buy", id=l3)["error"] == "gone", "gone")
psql("UPDATE aquaterra_plot_owners SET owner = 'ann@x' WHERE plot_id = 2")

# ---- agency: road, apartment, planet, companion
rid = psql("SELECT id FROM aquaterra_roads ORDER BY id LIMIT 1")
if rid:
    psql(f"UPDATE aquaterra_roads SET owner = 'ann@x' WHERE id = {lit(rid)}")
    lr = ag("ann", action="list_add", kind="road", ref=rid, price=300)["listingId"]
    check(ag("bob", action="buy", id=lr)["ok"], "road sold")
    check(psql(f"SELECT owner FROM aquaterra_roads WHERE id = {lit(rid)}") == "bob@x", "road owner")
psql("INSERT INTO aquaterra_apartments (tower, token_id, floor, number, apt_type, owner, owned_at, income_from) VALUES ('first-light', 7, 3, '301', 'Residential', 'ann@x', now(), now())")
la = ag("ann", action="list_add", kind="apartment", ref="first-light:7", price=200)
check(la["ok"], f"apartment listed {la}")
check(ag("bob", action="buy", id=la["listingId"])["ok"], "apartment sold")
check(psql("SELECT owner FROM aquaterra_apartments WHERE token_id = 7") == "bob@x", "apartment owner")
psql("INSERT INTO aquaterra_planets (token_id, name, body_type, main_planet, resource, rarity, owner, owned_at) VALUES (42, 'Charon', 'Moon', 'Pluto', 'Ice', 'Rare', 'ann@x', now())")
lp = ag("ann", action="list_add", kind="planet", ref="42", price=150)["listingId"]
check(ag("bob", action="buy", id=lp)["ok"], "planet sold")
check(psql("SELECT owner FROM aquaterra_planets WHERE token_id = 42") == "bob@x", "planet owner")
psql("INSERT INTO aquaterra_companions (collection_id, token_id, email, name, pantheon) VALUES (9, '77', 'ann@x', 'Athena', 'Greek')")
lc = ag("ann", action="list_add", kind="companion", ref="9:77", price=120)["listingId"]
check(ag("bob", action="buy", id=lc)["ok"], "companion sold")
check(psql("SELECT email FROM aquaterra_companions WHERE token_id = '77'") == "bob@x", "companion owner")
mine = ag("bob", action="mine")
kinds = sorted({x["kind"] for x in mine["assets"]})
check("planet" in kinds and "companion" in kinds and "apartment" in kinds and "plot" in kinds, f"assets {kinds}")
check(len(mine["history"]) >= 4 and all(h["side"] == "bought" for h in mine["history"]), "history")

# ---- harvest barter
psql("INSERT INTO aquaterra_farm_barn (email, crop, units) VALUES ('ann@x', 'rose', 100), ('bob@x', 'wheat', 50)")
check(ag("ann", action="barter_offer", give="rose", giveUnits=10, want="rose", wantUnits=5)["error"] == "crop", "same crop")
check(ag("ann", action="barter_offer", give="rose", giveUnits=1000, want="wheat", wantUnits=5)["error"] == "nothing", "not in barn")
st0 = bal("state:treasury")
o = ag("ann", action="barter_offer", give="rose", giveUnits=40, want="wheat", wantUnits=20)
check(o["ok"], f"offer {o}")
oid = o["offerId"]
check(psql("SELECT units FROM aquaterra_farm_barn WHERE email = 'ann@x' AND crop = 'rose'") == "60", "units held in the offer")
check(len(ag(action="barter")["offers"]) == 1, "public offers")
check(ag("ann", action="barter_take", id=oid)["error"] == "self", "no self barter")
check(ag("cat", action="barter_take", id=oid)["error"] in ("nothing", "insufficient"), "taker needs the crop")
r = ag("bob", action="barter_take", id=oid)
check(r["ok"], f"take {r}")
check(psql("SELECT units FROM aquaterra_farm_barn WHERE email = 'bob@x' AND crop = 'rose'") == "40", "taker got the roses")
check(psql("SELECT units FROM aquaterra_farm_barn WHERE email = 'ann@x' AND crop = 'wheat'") == "20", "maker got the wheat")
check(bal("state:treasury") > st0, "barter tax to the State Treasury")
o2 = ag("ann", action="barter_offer", give="rose", giveUnits=5, want="wheat", wantUnits=5)["offerId"]
f0 = bal("ann@x")
check(ag("ann", action="barter_cancel", id=o2)["ok"], "cancel offer")
check(bal("ann@x") > f0 and psql("SELECT units FROM aquaterra_farm_barn WHERE email = 'ann@x' AND crop = 'rose'") == "60", "cancel returns units and tax")
check(bal("farm:escrow") == 0, "escrow empty")

print(f"agency: {passed} checks passed")
