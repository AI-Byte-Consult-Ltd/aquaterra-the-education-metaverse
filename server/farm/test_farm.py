"""End-to-end test of farms and the Harvest Market on a scratch Postgres.

  PGHOST=/var/tmp/pg PGPORT=5433 python3 server/farm/test_farm.py

Loads economy, Commonwealth, travel, arcade, treasury, build and farm.sql (twice: the
migration must be safe to run again), then plants, harvests, sells to the Reserve and trades.
"""
import hashlib, json, os, subprocess

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
GOV = os.path.join(ROOT, "server", "governance")
ECONOMY = os.environ.get("ECONOMY_SQL", "/mnt/project-files/aquaterra-economy/economy.sql")
DB = "aquaterra_farm_test"
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
for _ in range(2):
    load(os.path.join(HERE, "farm.sql"))

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


def farm(who=None, **kw):
    req = {k: (str(v) if isinstance(v, (int, float)) else v) for k, v in kw.items()}
    if who:
        req["session"] = S[who]
    return J(f"SELECT aquaterra_farm({lit(json.dumps(req))}::jsonb)")


def plot(pid, owner, tiles=10, buildable=True, starter="none", water=False):
    addr = f"Water Plot {pid}-1" if water else f"{pid} Field Road"
    psql(f"INSERT INTO aquaterra_plots (id, address, district, tiles, price) VALUES ({pid}, '{addr}', 'Greenhaven', {tiles}, {tiles * 60})")
    psql(f"INSERT INTO aquaterra_build_sites (plot_id, buildable, tower_ok, centre, starter) VALUES ({pid}, {buildable}, false, false, '{starter}')")
    if owner:
        psql(f"INSERT INTO aquaterra_plot_owners (plot_id, owner, price_paid) VALUES ({pid}, {lit(owner)}, {tiles * 60})")


player("ann@x", "Ann", free=500)
player("bob@x", "Bob", free=500)
player("cat@x", "Cat", free=0)
plot(1, "ann@x", 10)
plot(2, "ann@x", 10, buildable=False)
plot(3, "ann@x", 10, starter="cottage")
plot(4, "bob@x", 12)
plot(5, "cat@x", 4)
plot(6, "ann@x", 40, buildable=False, water=True)

m = farm(action="market")
check(m["ok"] and len(m["crops"]) == 18 and m["laws"]["marketTaxPct"] == 10, f"market {m.get('laws')}")
check(farm(action="me")["error"] == "session", "me needs a session")
me = farm("ann", action="me")
blocks = {p["plotId"]: p["block"] for p in me["plots"]}
check(blocks == {1: None, 2: "land", 3: None, 6: None}, f"starter house is the farmhouse {blocks}")
psql("INSERT INTO aquaterra_buildings (plot_id, kind, level) VALUES (3, 'cottage', 1)")
check(next(x for x in farm("ann", action="me")["plots"] if x["plotId"] == 3)["block"] == "building", "a resident building blocks")

# Plant: rose 16 h, seed 0.4 x 10 = 4 TIDE to the Reserve, yield 10.
check(farm("ann", action="plant", plotId=2, crop="rose")["error"] == "land", "no farm on works")
check(farm("ann", action="plant", plotId=6, crop="rose")["error"] == "place", "roses do not grow in the sea")
check(farm("ann", action="plant", plotId=1, crop="fish")["error"] == "place", "fish do not grow on land")
p6 = farm("ann", action="plant", plotId=6, crop="fish")
check(p6["ok"] and p6["seed"] == 10 and next(x for x in p6["plots"] if x["plotId"] == 6)["water"] is True, f"fish farm {p6.get('seed')}")
psql("UPDATE aquaterra_farm_fields SET ready_at = now() - interval '1 minute' WHERE plot_id = 6")
check(farm("ann", action="harvest", plotId=6)["units"] == 40, "40 fish")
psql("DELETE FROM aquaterra_farm_barn WHERE crop = 'fish'")
check(farm("ann", action="plant", plotId=3, crop="rose")["error"] == "building", "no farm under a house")
check(farm("ann", action="plant", plotId=4, crop="rose")["error"] == "not_owner", "only the owner plants")
check(farm("ann", action="plant", plotId=1, crop="cactus")["error"] == "crop", "unknown crop")
check(farm("cat", action="plant", plotId=5, crop="wheat")["error"] == "insufficient", "welcome Tide is for land only")
a0, r0 = bal("ann@x"), bal("treasury")
p = farm("ann", action="plant", plotId=1, crop="rose")
check(p["ok"] and p["seed"] == 4 and bal("ann@x") == a0 - 4 and bal("treasury") == r0 + 4, f"planted {p.get('seed')}")
check(farm("ann", action="plant", plotId=1, crop="rose")["error"] == "planted", "one field per plot")
check(farm("ann", action="harvest", plotId=1)["error"] == "not_ripe", "not ripe yet")
f = next(x for x in farm("ann", action="me")["plots"] if x["plotId"] == 1)["field"]
check(f["crop"] == "rose" and f["units"] == 10, f"field {f}")
fl = farm(action="fields")
check(fl["ok"] and [r[:2] for r in fl["fields"]] == [[1, "rose"]] and fl["fields"][0][3] > fl["fields"][0][2] and fl["wiltHours"] == 48, f"public fields for the map {fl}")

psql("UPDATE aquaterra_farm_fields SET ready_at = now() - interval '1 minute' WHERE plot_id = 1")
h = farm("ann", action="harvest")
check(h["ok"] and h["units"] == 10 and h["barn"] == [{"crop": "rose", "units": 10, "price": 0.8, "value": 8}], f"harvest {h.get('barn')}")
check(next(x for x in h["plots"] if x["plotId"] == 1)["field"] is None, "field free again")

# Wilted: half.
farm("ann", action="plant", plotId=1, crop="rose")
psql("UPDATE aquaterra_farm_fields SET ready_at = now() - interval '49 hours' WHERE plot_id = 1")
check(farm("ann", action="harvest", plotId=1)["units"] == 5, "wilted crop gives half")

# A house built on a field destroys it.
farm("ann", action="plant", plotId=1, crop="wheat")
psql("INSERT INTO aquaterra_buildings (plot_id, kind, level) VALUES (1, 'cottage', 1)")
psql("UPDATE aquaterra_farm_fields SET ready_at = now() - interval '1 minute' WHERE plot_id = 1")
check(farm("ann", action="harvest")["destroyed"] == 1 and psql("SELECT count(*) FROM aquaterra_farm_fields") == "0", "house destroys the field")
psql("UPDATE aquaterra_buildings SET kind = 'empty' WHERE plot_id = 1")

# Clear: seeds lost.
farm("ann", action="plant", plotId=1, crop="coffee")
check(farm("ann", action="clear", plotId=1)["ok"] and farm("bob", action="clear", plotId=1)["error"] == "not_found", "clear own field only")

# Reserve: 15 roses x 0.8 = 12 TIDE as income (10% income tax), within the daily cap.
a0, t0 = bal("ann@x"), bal("state:treasury")
check(farm("ann", action="reserve", crop="rose", units=99)["error"] == "units", "not more than the barn")
s = farm("ann", action="reserve", crop="rose", units=5)
check(s["ok"] and s["sold"] == 5 and s["tide"] == 4, f"reserve {s.get('sold')} {s.get('tide')}")
check(bal("ann@x") == a0 + 4 and bal("state:treasury") == t0, "4 TIDE: tax rounds to 0")
psql("UPDATE aquaterra_gov_params SET value = 6 WHERE key = 'farm_reserve_cap'")
s = farm("ann", action="reserve", crop="rose")
check(s["ok"] and s["tide"] == 0 + 1 and s["sold"] == 2, f"cap left 2 TIDE: {s.get('sold')} {s.get('tide')}")
check(farm("ann", action="reserve", crop="rose")["error"] == "cap", "daily cap reached")
psql("UPDATE aquaterra_gov_params SET value = 300 WHERE key = 'farm_reserve_cap'")
check(farm("ann", action="me")["barn"][0]["units"] == 8, "8 roses left")

# Market: Ann sells 8 roses at 2.00, Bob buys 5 at 2.50 -> fills at 2.00 (resting price).
check(farm("ann", action="order", side="sell", crop="rose", price="2", qty=9)["error"] == "nothing", "cannot sell what you lack")
check(farm("ann", action="order", side="sell", crop="rose", price="2..1", qty=1)["error"] == "price", "bad price")
o = farm("ann", action="order", side="sell", crop="rose", price="2", qty=8)
check(o["ok"] and o["fills"] == 0 and o["book"]["asks"] == [[2.0, 8]] and o["barn"] == [], f"ask rests {o.get('book')}")
check(farm("ann", action="order", side="buy", crop="rose", price="3", qty=1)["fills"] == 0, "no trade with yourself")
farm("ann", action="cancel", orderId=farm("ann", action="me")["orders"][0]["id"])
a0, b0, t0, e0 = bal("ann@x"), bal("bob@x"), bal("state:treasury"), bal("farm:escrow")
o = farm("bob", action="order", side="buy", crop="rose", price="2.5", qty=5)
check(o["ok"] and o["fills"] == 1 and o["status"] == "done", f"bob fills {o.get('status')}")
check(bal("bob@x") == b0 - 10 and bal("ann@x") == a0 + 9 and bal("state:treasury") == t0 + 1 and bal("farm:escrow") == e0, "10 TIDE: 9 to Ann, 1 tax, escrow refunded")
check(farm("bob", action="me")["barn"] == [{"crop": "rose", "units": 5, "price": 0.8, "value": 4}], "Bob has 5 roses")
check(farm(action="book", crop="rose")["book"]["asks"] == [[2.0, 3]], "3 left on the book")

# Bob bids for 10 tulips at 0.5 (escrow 5), Ann has none; cancel returns the escrow.
b0 = bal("bob@x")
o = farm("bob", action="order", side="buy", crop="tulip", price="0.5", qty=10)
check(o["status"] == "open" and bal("bob@x") == b0 - 5 and bal("farm:escrow") == 5, "bid escrowed")
check(farm("cat", action="order", side="buy", crop="tulip", price="1", qty=1)["error"] == "insufficient", "welcome Tide cannot bid")
c = farm("bob", action="cancel", orderId=o["orderId"])
check(c["ok"] and bal("bob@x") == b0 and bal("farm:escrow") == 0 and c["orders"] == [], "cancel refunds")
check(farm("ann", action="cancel", orderId=o["orderId"])["error"] == "not_found", "cancel once")

# A sell order hitting a resting bid fills at the bid; partial fill keeps the rest open.
farm("bob", action="order", side="buy", crop="rose", price="1.5", qty=10)
o = farm("ann", action="order", side="sell", crop="rose", price="1", qty=3)  # Ann sells her book roses? she has 0 in barn
check(o["error"] == "nothing", "ann barn empty, roses are on her ask")
mine = [x for x in farm("ann", action="me")["orders"] if x["side"] == "sell"]
check(mine[0]["left"] == 3, f"ann ask left {mine}")
# Bob's bid at 1.5 does not cross Ann's ask at 2.0; Ann lowers by cancel and re-post at 1.
farm("ann", action="cancel", orderId=mine[0]["id"])
a0 = bal("ann@x")
o = farm("ann", action="order", side="sell", crop="rose", price="1", qty=3)
check(o["fills"] == 1 and o["status"] == "done" and bal("ann@x") == a0 + 4, f"sold 3 at 1.5 = 4.5 -> 5, tax 1 -> {bal('ann@x') - a0}")
check(farm(action="book", crop="rose")["book"]["bids"] == [[1.5, 7]], "bid partly filled")
check(farm(action="market")["crops"][0]["last"] == 1.5, "last price")
check(int(psql("SELECT sum(balance) FROM aquaterra_wallets")) == int(psql("SELECT value FROM aquaterra_economy_params WHERE key = 'genesis_supply'")), "no Tide created or lost")
print(f"farm: {passed} checks passed")
