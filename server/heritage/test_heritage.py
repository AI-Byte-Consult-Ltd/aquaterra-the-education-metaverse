"""End-to-end test of the Heritage Port on a scratch Postgres.

  PGHOST=/var/tmp/pg PGPORT=5433 python3 server/heritage/test_heritage.py

Loads the account fixture, the Tide economy (ECONOMY_SQL, default the project copy),
the Commonwealth, travel, treasury, exchange and heritage.sql (twice: the migration must
be safe to run again). The chain is played by hand: n8n's part (signature recovery,
ownerOf) is replaced by the verified field and by calling the internal function.
"""
import hashlib, json, os, subprocess

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
GOV = os.path.join(ROOT, "server", "governance")
ECONOMY = os.environ.get("ECONOMY_SQL", "/mnt/project-files/aquaterra-economy/economy.sql")
DB = "aquaterra_heritage_test"
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
load(os.path.join(ROOT, "server", "exchange", "exchange.sql"))
VAULT = "0x" + "5c" * 20
psql(f"INSERT INTO aquaterra_exchange_settings (key, value) VALUES ('deposit_address', {lit(VAULT)}) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value")
# Heritage district with 3 land plots and 1 water plot; one land plot already sold.
psql("""INSERT INTO aquaterra_plots (id, address, district, tiles, price) VALUES
  (1, '1 Drift Way', 'Driftstone Isles', 4, 300), (2, '2 Drift Way', 'Driftstone Isles', 4, 500),
  (3, '3 Drift Way', 'Driftstone Isles', 4, 400), (4, 'Open water 9', 'Driftstone Isles', 4, 100),
  (5, '5 Main St', 'First Light City', 4, 900)""")
psql("INSERT INTO aquaterra_players (email, display_name) VALUES ('early@x', 'Early')")
psql("INSERT INTO aquaterra_wallets (account) VALUES ('early@x')")
psql("INSERT INTO aquaterra_plot_owners (plot_id, owner, price_paid) VALUES (3, 'early@x', 400)")
locked_before = psql("SELECT pg_get_functiondef('aquaterra_locked(text)'::regprocedure)")
for _ in range(2):
    load(os.path.join(HERE, "heritage.sql"))

check(psql("SELECT string_agg(plot_id::text, ',' ORDER BY plot_id) FROM aquaterra_plot_owners WHERE owner = 'heritage:reserve'") == "1,2",
      "free land plots of the Heritage district are reserved, water and sold ones not")
check(psql("SELECT aquaterra_name('heritage:reserve')") == "Heritage Reserve", "reserve name")
check(J("SELECT aquaterra_economy('{\"action\":\"buy\",\"plotId\":1,\"session\":\"x\"}'::jsonb)").get("ok") is not True, "reserved plot not for sale")

S, EMAIL = {}, {}


def player(email, name, welcome=1000, role="citizen"):
    psql(f"INSERT INTO aquaterra_players (email, display_name, role) VALUES ({lit(email)}, {lit(name)}, {lit(role)})")
    tok = hashlib.sha256(email.encode()).hexdigest()
    psql(f"INSERT INTO aquaterra_sessions (token_hash, email, expires_at) VALUES (encode(sha256(convert_to({lit(tok)}, 'UTF8')), 'hex'), {lit(email)}, now() + interval '1 day')")
    psql(f"INSERT INTO aquaterra_wallets (account) VALUES ({lit(email)}) ON CONFLICT DO NOTHING")
    if welcome:
        psql(f"SELECT aquaterra_move('treasury', {lit(email)}, {welcome}, 'welcome', NULL, 'Welcome', NULL)")
    S[email.split('@')[0]], EMAIL[name] = tok, email


def bal(acct):
    return int(psql(f"SELECT COALESCE((SELECT balance FROM aquaterra_wallets WHERE account = {lit(acct)}), 0)"))


def her(who=None, **kw):
    req = dict(kw, session=S[who]) if who else dict(kw)
    return J(f"SELECT aquaterra_heritage({lit(json.dumps(req))}::jsonb)")


def internal(**kw):
    return J(f"SELECT aquaterra_heritage_internal({lit(json.dumps(kw))}::jsonb)")


def link(name, addr):
    c = her(name, action="link_challenge", address=addr)
    check(c["ok"] and addr in c["message"], f"challenge for {name}: {c}")
    return her(name, action="link", verified={"address": addr, "message": c["message"]})


player("alex@x", "Alexander", role="founder")
player("bea@x", "Bea")
player("cid@x", "Cid", welcome=0)
A1, B1 = "0x" + "a1" * 20, "0x" + "b1" * 20

info = her(action="info")
check(info["ok"] and info["fee"] == 600 and info["vault"] == VAULT and info["reserve"] == 2, f"info {info}")
check([c["kind"] for c in info["collections"]] == ["tower", "tower"], "only the two towers are on at the start")
check([c["id"] for c in info["chains"]] == ["cronos", "polygon", "ethereum", "bitcoin"], "four chains")
check(her(action="me")["error"] == "session", "me needs a session")

# Link: a signature for another address, a reused message, a message we never issued.
c = her("bea", action="link_challenge", address=B1)
check(her("bea", action="link", verified={"address": A1, "message": c["message"]})["error"] == "signature", "wrong signer")
check(her("bea", action="link", verified={"address": B1, "message": c["message"] + "x"})["error"] == "expired", "unknown message")
check(her("bea", action="link", verified={"address": B1, "message": c["message"]})["ok"], "bea links")
check(her("bea", action="link", verified={"address": B1, "message": c["message"]})["error"] == "expired", "message used once")
check(her("bea", action="link")["error"] == "signature", "no verified field")
check(her("alex", action="link_challenge", address=B1)["error"] == "linked_elsewhere", "one wallet, one resident")
check(her("bea", action="link_challenge", address=B1)["error"] == "already_mine", "already mine")
c = her("alex", action="link_challenge", address=A1)
check(her("bea", action="link", verified={"address": A1, "message": c["message"]})["error"] == "signature", "another residents challenge")
check(her("alex", action="link", verified={"address": A1, "message": c["message"]})["ok"], "alex links")
check(her("cid", action="link_challenge", address="0x12")["error"] == "address", "bad address")

# Wallet login
check(her(action="login_challenge", address="0x" + "99" * 20)["error"] == "not_linked", "login needs a linked wallet")
c = her(action="login_challenge", address=B1)
lg = her(action="wallet_login", verified={"address": B1, "message": c["message"]})
check(lg["ok"] and len(lg["session"]) == 64, f"wallet login {lg}")
check(J(f"SELECT aquaterra_heritage({lit(json.dumps({'action': 'me', 'session': lg['session']}))}::jsonb)")["wallets"][0]["address"] == B1, "session works")
check(her(action="wallet_login", verified={"address": B1, "message": c["message"]})["error"] == "expired", "login message once")

# Founder lists a LAND collection on Cronos and a car collection on Polygon.
LAND = "0x" + "1a" * 20
CAR = "0x" + "ca" * 20
check(her("bea", action="admin_collection", chain="cronos", contract=LAND)["error"] == "forbidden", "only the founder")
r = her("alex", action="admin_collection", chain="cronos", contract=LAND.upper().replace("0X", "0x"), name="AquaTerra LAND", kind="land", swapTide=800, enabled=True)
check(r["ok"] and any(c["contract"] == LAND and c["enabled"] for c in r["collections"]), "land listed, address lower case")
r = her("alex", action="admin_collection", chain="polygon", contract=CAR, name="Cars", kind="car", swapTide=500, allowPlot=False, enabled=True)
land_id = next(c["id"] for c in r["collections"] if c["contract"] == LAND)
car_id = next(c["id"] for c in r["collections"] if c["contract"] == CAR)
tower_id = next(c["id"] for c in r["collections"] if c["kind"] == "tower")
check(her("alex", action="admin_collection", chain="bitcoin", contract="inscriptions-x", name="Ordinals", kind="asset", swapTide=500)["ok"], "bitcoin collection can be listed")
btc_id = next(c["id"] for c in her("alex", action="admin")["collections"] if c["chain"] == "bitcoin")
her("alex", action="admin_collection", chain="bitcoin", contract="inscriptions-x", name="Ordinals", kind="asset", swapTide=500, enabled=True)

# Swap 1: Bea swaps LAND #42 for a plot. Fee 600 out of her 1,000 welcome coins.
check(her("cid", action="swap", collectionId=land_id, tokenId="42", choice="plot")["error"] == "no_wallet", "needs a wallet")
check(her("bea", action="swap", collectionId=tower_id, tokenId="1", choice="tide")["error"] == "token", "a tower token needs its apartment loaded")
check(her("bea", action="swap", collectionId=btc_id, tokenId="1", choice="tide")["error"] == "chain_soon", "bitcoin later")
check(her("bea", action="swap", collectionId=land_id, tokenId="4x", choice="plot")["error"] == "token", "token id digits")
r = her("bea", action="swap", collectionId=land_id, tokenId="0042", choice="plot")
chk = r["check"]
check(r["ok"] and chk["rpc"] == "https://evm.cronos.org" and chk["contract"] == LAND and chk["tokenId"] == "42" and chk["step"] == "open", f"check {r}")
check(internal(action="owner", swapId=chk["swapId"], step="open", owner="0x" + "77" * 20)["error"] == "not_owner", "someone elses token")
check(psql(f"SELECT status FROM aquaterra_nft_swaps WHERE id = {chk['swapId']}") == "rejected", "rejected kept")
r = her("bea", action="swap", collectionId=land_id, tokenId="42", choice="plot")
treas = bal("state:treasury")
o = internal(action="owner", swapId=r["check"]["swapId"], step="open", owner=B1.upper().replace("0X", "0x"))
sid = r["check"]["swapId"]
check(o["ok"] and o["swap"]["status"] == "open" and o["swap"]["fee"] == 600, f"open {o}")
check(bal("bea@x") == 400 and bal("state:treasury") == treas + 600, "fee to the State Treasury")
check(her("bea", action="swap", collectionId=land_id, tokenId="42", choice="plot")["error"] == "swap_open", "one open swap per token")
c2 = her("bea", action="confirm", swapId=sid)["check"]
check(internal(action="owner", swapId=sid, step="confirm", owner=B1)["error"] == "not_received", "not in the vault yet")
check(internal(action="owner", swapId=sid, step="confirm", owner=None)["error"] == "chain", "chain silent")
d = internal(action="owner", swapId=c2["swapId"], step="confirm", owner=VAULT)
check(d["ok"] and d["swap"]["status"] == "done" and d["swap"]["plotId"] == 2 and d["swap"]["plotAddress"] == "2 Drift Way", f"plot given, most valuable first {d}")
check(psql("SELECT owner || ':' || price_paid FROM aquaterra_plot_owners WHERE plot_id = 2") == "bea@x:500", "plot owned, earns like a bought one")
check(internal(action="owner", swapId=sid, step="confirm", owner=VAULT)["swap"]["status"] == "done", "confirm twice is harmless")
check(bal("bea@x") == 400, "nothing paid twice")
check(her("alex", action="swap", collectionId=land_id, tokenId="42", choice="tide")["error"] == "swapped", "a token swaps once")

# Swap 2: Bea has 400 left: not enough for a second fee. She must buy Tide.
check(her("bea", action="swap", collectionId=land_id, tokenId="43", choice="plot")["error"] == "insufficient", "second swap needs more Tide")
check(int(psql("SELECT aquaterra_locked('bea@x')")) == 400, "the rest of the welcome coins stays locked")
psql("SELECT aquaterra_move('treasury', 'bea@x', 1000, 'tide_purchase', NULL, 'bought', NULL)")
r = her("bea", action="swap", collectionId=car_id, tokenId="7", choice="plot")
check(r["ok"] and r["check"]["rpc"].startswith("https://polygon"), "car on polygon")
o = internal(action="owner", swapId=r["check"]["swapId"], step="open", owner=B1)
check(o["swap"]["choice"] == "tide" and bal("bea@x") == 800, "cars give Tide only; second fee paid with bought Tide")
d = internal(action="owner", swapId=o["swap"]["id"], step="confirm", owner=VAULT)
check(d["swap"]["status"] == "done" and d["swap"]["tide"] == 500 and bal("bea@x") == 1300, f"500 TIDE paid {d}")
check(int(psql("SELECT aquaterra_swap_locked('bea@x')")) == 500, "swap Tide locked")
check(J("SELECT aquaterra_heritage('{\"action\":\"me\",\"session\":\"%s\"}'::jsonb)" % S["bea"])["feeFree"] == 800, "swap Tide does not pay swap fees")
check(int(psql("SELECT aquaterra_locked('bea@x')")) == 500, "fees used up the welcome coins; swap Tide cannot be sent")

# Cid: no welcome coins, buys 700, opens a swap, the token moves to Alexander who swaps it.
psql("SELECT aquaterra_move('treasury', 'cid@x', 700, 'tide_purchase', NULL, 'bought', NULL)")
C1 = "0x" + "c1" * 20
link("cid", C1)
r = her("cid", action="swap", collectionId=land_id, tokenId="100", choice="tide")
internal(action="owner", swapId=r["check"]["swapId"], step="open", owner=C1)
cid_swap = r["check"]["swapId"]
check(bal("cid@x") == 100, "cid paid")
r = her("alex", action="swap", collectionId=land_id, tokenId="100", choice="plot")
psql("SELECT aquaterra_move('treasury', 'alex@x', 1000, 'grant', NULL, 'g', NULL)")
o = internal(action="owner", swapId=r["check"]["swapId"], step="open", owner=A1)
check(o["swap"]["status"] == "open", "alex opens")
check(psql(f"SELECT status FROM aquaterra_nft_swaps WHERE id = {cid_swap}") == "cancelled" and bal("cid@x") == 700, "old swap cancelled, fee back")
check(int(psql("SELECT aquaterra_locked('cid@x')")) == 0, "refund is free Tide for a resident without welcome coins")
d = internal(action="owner", swapId=o["swap"]["id"], step="confirm", owner=VAULT)
check(d["swap"]["plotId"] == 1, "last reserved plot")
check(her("bea", action="swap", collectionId=land_id, tokenId="44", choice="plot")["error"] == "reserve_empty", "reserve empty")

# Cancel gives the fee back.
r = her("bea", action="swap", collectionId=land_id, tokenId="45", choice="tide")
internal(action="owner", swapId=r["check"]["swapId"], step="open", owner=B1)
before = bal("bea@x")
c = her("bea", action="cancel", swapId=r["check"]["swapId"])
check(c["ok"] and c["swap"]["status"] == "cancelled" and bal("bea@x") == before + 600, "cancel refunds")
check(her("bea", action="unlink", address=B1)["ok"], "unlink")
check(her("bea", action="me")["wallets"] == [], "no wallets")

# Admin: vault and district, reserve again.
check(her("alex", action="admin_setting", key="vault_address", address="0x" + "de" * 20)["vault"] == "0x" + "de" * 20, "vault set")
check(her("alex", action="admin_setting", key="heritage_district", value="Nowhere")["error"] == "district", "district must exist")
a = her("alex", action="admin")
check(a["ok"] and len(a["swaps"]) >= 4 and a["wallets"] == 2, f"admin view {a.get('wallets')}")
check(her("bea", action="admin")["error"] == "forbidden", "admin view needs a role")

# Towers: each NFT of a tower collection becomes the same apartment, 1:1.
check(psql("SELECT string_agg(id, ',' ORDER BY sort) FROM aquaterra_towers") == "first-light,second-light", "two towers")
TW1 = int(psql("SELECT collection_id FROM aquaterra_towers WHERE id = 'first-light'"))
ld = J("""SELECT aquaterra_apt_load('[{"tower":"first-light","tokenId":"2","floor":"36","number":"3608","type":"Residential","view":"City","area":"150","bedrooms":"1","rooms":"2","image":"ipfs://a"},
 {"tower":"first-light","tokenId":"7","floor":"108","number":"10801","type":"Penthouse","view":"Sea","area":"400"},
 {"tower":"nowhere","tokenId":"8","floor":"1","number":"1"},{"tower":"first-light","tokenId":"9","floor":"x","number":"1"}]'::jsonb)""")
check(ld["loaded"] == 2 and ld["total"] == 2, f"load skips bad rows {ld}")
t = her(action="tower", tower="first-light")
check(t["ok"] and t["tower"]["floors"] == 108 and len(t["apartments"]) == 2 and t["apartments"][0][7] is None, f"tower view {t}")
check(her(action="tower", tower="x")["error"] == "not_found", "unknown tower")
link("bea", B1)
check(her("bea", action="swap", collectionId=TW1, tokenId="3")["error"] == "token", "no such apartment")
r = her("bea", action="swap", collectionId=TW1, tokenId="7", choice="tide")
check(r["ok"] and r["check"]["tokenId"] == "7", f"tower swap opens {r}")
o = internal(action="owner", swapId=r["check"]["swapId"], step="open", owner=B1)
check(o["ok"] and o["swap"]["choice"] == "apartment" and o["swap"]["status"] == "open", f"apartment chosen {o}")
d = internal(action="owner", swapId=o["swap"]["id"], step="confirm", owner=her(action="info")["vault"])
check(d["ok"] and d["swap"]["status"] == "done" and d["swap"]["apartment"]["number"] == "10801", f"apartment given {d}")
check(her("alex", action="swap", collectionId=TW1, tokenId="7")["error"] == "swapped", "apartment swaps once")
t = her("bea", action="tower", tower="first-light")
check(t["apartments"][1][7] == "Bea" and t["apartments"][1][8] is True and t["tower"]["owned"] == 1, "owner shown")
check(J("SELECT aquaterra_apt_load('[{\"tower\":\"first-light\",\"tokenId\":\"7\",\"floor\":\"108\",\"number\":\"10801\",\"type\":\"Penthouse\"}]'::jsonb)")["ok"]
      and psql("SELECT owner FROM aquaterra_apartments WHERE token_id = 7") == "bea@x", "reload keeps the owner")
m = her("bea", action="me")
check(len(m["apartments"]) == 1 and m["apartments"][0]["rate"] == 15, f"my apartments {m['apartments']}")
check(her("bea", action="apt_collect")["error"] == "nothing", "nothing yet")
psql("UPDATE aquaterra_apartments SET income_from = now() - interval '2 days' WHERE token_id = 7")
before = bal("bea@x")
c = her("bea", action="apt_collect")
check(c["ok"] and c["gross"] == 30 and c["net"] + c["tax"] == 30 and bal("bea@x") == before + c["net"], f"collect {c}")
psql("UPDATE aquaterra_apartments SET income_from = now() - interval '90 days' WHERE token_id = 7")
check(her("bea", action="apt_collect")["gross"] == 450, "income caps at 30 days")
check(her("bea", action="unlink", address=B1)["ok"], "unlink again")

# Ledger adds up: no Tide created or lost.
check(int(psql("SELECT sum(balance) FROM aquaterra_wallets")) == int(psql("SELECT value FROM aquaterra_economy_params WHERE key = 'genesis_supply'")), "supply unchanged")
print(f"heritage: {passed} checks passed")
