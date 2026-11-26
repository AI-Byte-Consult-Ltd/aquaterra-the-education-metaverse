"""End-to-end test of Orbit on a scratch Postgres.

  PGHOST=/var/tmp/pg PGPORT=5433 python3 server/orbit/test_orbit.py

Loads economy, Commonwealth, travel, treasury, exchange, arcade functions, heritage.sql and
orbit.sql (twice: the migration must be safe to run again), loads a few planet claims, swaps
one home through the Heritage Port (n8n's part played by hand), mines and sells.
"""
import hashlib, json, os, subprocess

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
GOV = os.path.join(ROOT, "server", "governance")
ECONOMY = os.environ.get("ECONOMY_SQL", "/mnt/project-files/aquaterra-economy/economy.sql")
DB = "aquaterra_orbit_test"
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
load(os.path.join(ROOT, "server", "exchange", "exchange.sql"))
VAULT = "0x" + "5c" * 20
psql(f"INSERT INTO aquaterra_exchange_settings (key, value) VALUES ('deposit_address', {lit(VAULT)}) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value")
load(os.path.join(ROOT, "server", "heritage", "heritage.sql"))
for _ in range(2):
    load(os.path.join(HERE, "orbit.sql"))

S = {}


def player(email, name, welcome=1000):
    psql(f"INSERT INTO aquaterra_players (email, display_name) VALUES ({lit(email)}, {lit(name)})")
    tok = hashlib.sha256(email.encode()).hexdigest()
    psql(f"INSERT INTO aquaterra_sessions (token_hash, email, expires_at) VALUES (encode(sha256(convert_to({lit(tok)}, 'UTF8')), 'hex'), {lit(email)}, now() + interval '1 day')")
    psql(f"INSERT INTO aquaterra_wallets (account) VALUES ({lit(email)}) ON CONFLICT DO NOTHING")
    if welcome:
        psql(f"SELECT aquaterra_move('treasury', {lit(email)}, {welcome}, 'welcome', NULL, 'Welcome', NULL)")
    S[email.split('@')[0]] = tok


def bal(acct):
    return int(psql(f"SELECT COALESCE((SELECT balance FROM aquaterra_wallets WHERE account = {lit(acct)}), 0)"))


def orb(who=None, **kw):
    req = dict(kw, session=S[who]) if who else dict(kw)
    return J(f"SELECT aquaterra_orbit({lit(json.dumps(req))}::jsonb)")


def her(who, **kw):
    return J(f"SELECT aquaterra_heritage({lit(json.dumps(dict(kw, session=S[who])))}::jsonb)")


def internal(**kw):
    return J(f"SELECT aquaterra_heritage_internal({lit(json.dumps(kw))}::jsonb)")


player("bea@x", "Bea")
col = int(psql("SELECT id FROM aquaterra_nft_collections WHERE contract = '0xf37a3686800a9fb19625c05e1a7acf2d232e8aa4'"))
check(psql(f"SELECT kind || enabled FROM aquaterra_nft_collections WHERE id = {col}") == "planettrue", "planets collection listed once, on")
check(orb(action="sky")["total"] == 0, "empty sky before loading")
rows = [
    {"tokenId": "0", "name": "Aegaeon", "type": "Satellite", "orbits": "Saturn", "resource": "Bronze", "rarity": "Common", "image": "ipfs://x/Aegaeon.jpeg"},
    {"tokenId": "1", "name": "Charon", "type": "Moon", "orbits": "Pluto", "resource": "Magnesium", "rarity": "Common"},
    {"tokenId": "500", "name": "Vesta", "type": "Asteroid", "orbits": "Asteroid Belt", "resource": "Rhenium", "rarity": "Legendary"},
    {"tokenId": "501", "name": "Vesta", "type": "Asteroid", "orbits": "Asteroid Belt", "resource": "Gold", "rarity": "Uncommon"},
    {"tokenId": "x9", "name": "Bad"}, {"tokenId": "7", "name": ""},
]
r = J(f"SELECT aquaterra_planet_load({lit(json.dumps(rows))}::jsonb)")
check(r["loaded"] == 4 and r["total"] == 4, f"loader skips bad rows {r}")
J(f"SELECT aquaterra_planet_load({lit(json.dumps(rows[:1]))}::jsonb)")
check(psql("SELECT count(*) FROM aquaterra_planets") == "4", "loading again is harmless")
sky = orb(action="sky")
vesta = next(b for b in sky["bodies"] if b[0] == "Vesta")
check(sky["total"] == 4 and vesta[3] == 2 and sorted(vesta[5]) == ["Gold", "Rhenium"] and vesta[6] == 5 and sky["collectionId"] == col, f"sky {sky}")
b = orb(action="body", name="Vesta")
check(b["ok"] and [c[0] for c in b["claims"]] == [500, 501] and b["claims"][0][3] is None, f"body {b}")
check(orb(action="body", name="Nope")["error"] == "not_found", "unknown body")
check(orb(action="me")["error"] == "session", "me needs a session")
check(orb("bea", action="mine")["error"] == "no_claims", "nothing to mine yet")

# Swap token 500 home through the Heritage Port.
B1 = "0x" + "b1" * 20
c = her("bea", action="link_challenge", address=B1)
check(her("bea", action="link", verified={"address": B1, "message": c["message"]})["ok"], "wallet linked")
check(her("bea", action="swap", collectionId=col, tokenId="9999")["error"] == "token", "unloaded token")
r = her("bea", action="swap", collectionId=col, tokenId="500", choice="tide")
sid = r["check"]["swapId"]
o = internal(action="owner", swapId=sid, step="open", owner=B1)
check(o["ok"] and o["swap"]["choice"] == "planet" and o["swap"]["fee"] == 600, f"planet swap opens {o}")
her("bea", action="confirm", swapId=sid)
d = internal(action="owner", swapId=sid, step="confirm", owner=VAULT)
check(d["ok"] and d["swap"]["status"] == "done", f"done {d}")
check(psql("SELECT owner FROM aquaterra_planets WHERE token_id = 500") == "bea@x", "claim owned")
check(her("bea", action="swap", collectionId=col, tokenId="500")["error"] == "swapped", "a claim comes home once")

# Mine: Legendary x7 of 10 = 70 Rhenium. Once a day.
m = orb("bea", action="mine")
check(m["ok"] and m["mined"] == 1 and m["hold"] == [{"resource": "Rhenium", "units": 70, "price": 0.5, "value": 35}], f"mined {m}")
check(m["claims"][0]["minedToday"] is True, "claim marked")
check(orb("bea", action="mine")["error"] == "mined_today", "once a day")
psql("UPDATE aquaterra_planets SET mined_on = current_date - 1 WHERE token_id = 500")
check(orb("bea", action="mine")["hold"][0]["units"] == 140, "next day mines again")

# Sell: 140 x 0.5 = 70 TIDE, kind income: 10% income tax to the State Treasury.
before, treas = bal("bea@x"), bal("state:treasury")
check(orb("bea", action="sell", resource="Rhenium", units="999")["error"] == "units", "cannot sell more than the hold")
check(orb("bea", action="sell", resource="Rhenium", units="1")["error"] == "too_little", "half a TIDE is not paid")
s = orb("bea", action="sell", resource="Rhenium", units="3")
check(s["ok"] and s["sold"] == 2 and s["tide"] == 1 and s["hold"][0]["units"] == 138, f"only whole Tide, rest stays {s}")
s = orb("bea", action="sell", resource="Rhenium")
check(s["sold"] == 138 and s["tide"] == 69 and s["hold"] == [], f"sell all {s}")
tax = round(70 * 10 / 100)
check(bal("bea@x") == before + 70 - tax and bal("state:treasury") == treas + tax, f"paid with income tax {bal('bea@x')} {before}")
check(orb("bea", action="sell", resource="Rhenium")["error"] == "nothing", "empty hold")
check([l["kind"] for l in orb("bea", action="me")["log"]] == ["sell", "sell", "mine", "mine"], "log")
check(orb(action="sky")["owned"] == 1 and orb(action="body", name="Vesta")["claims"][0][3] == "Bea", "owner shown by name")
print(f"orbit: {passed} checks passed")
