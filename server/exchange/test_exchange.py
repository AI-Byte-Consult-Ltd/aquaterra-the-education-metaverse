"""End-to-end test of buying Tide on a scratch Postgres.

  PGHOST=/var/tmp/pg PGPORT=5433 python3 server/exchange/test_exchange.py

Loads the account fixture (server/governance), the Tide economy (ECONOMY_SQL,
default: the project's economy.sql) and exchange.sql (twice: the migration must
be safe to run again), then plays card, crypto, market and token flows.
"""
import hashlib, json, os, subprocess

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
GOV = os.path.join(ROOT, "server", "governance")
ECONOMY = os.environ.get("ECONOMY_SQL", "/mnt/project-files/aquaterra-economy/economy.sql")
DB = "aquaterra_exchange_test"
BASE = ["psql", "-U", os.environ.get("PGUSER", "postgres"), "-v", "ON_ERROR_STOP=1", "-q", "-tA"]

def psql(sql, db=DB):
    r = subprocess.run(BASE + ["-d", db, "-c", sql], capture_output=True, text=True)
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
load(os.path.join(GOV, "base-tables.sql"))
load(ECONOMY)
for _ in range(2):
    load(os.path.join(HERE, "exchange.sql"))
check("market:escrow" in psql("SELECT prosrc FROM pg_proc WHERE proname = 'aquaterra_name'"), "names patched")
check(psql("SELECT aquaterra_name('market:escrow')") == "Tide Market", "escrow has a name")

S = {}
def player(email, nm, role="citizen"):
    psql(f"INSERT INTO aquaterra_players (email, display_name, role) VALUES ({lit(email)}, {lit(nm)}, {lit(role)})")
    tok = hashlib.sha256(email.encode()).hexdigest()
    psql(f"INSERT INTO aquaterra_sessions (token_hash, email, expires_at) VALUES (encode(sha256(convert_to({lit(tok)}, 'UTF8')), 'hex'), {lit(email)}, now() + interval '1 day')")
    S[nm] = tok
    eco(nm, action="wallet")

def eco(who, **req):
    req["session"] = S[who]
    return J(f"SELECT aquaterra_economy({lit(json.dumps(req))}::jsonb)")
def x(who, **req):
    req["session"] = S.get(who, "")
    return J(f"SELECT aquaterra_exchange({lit(json.dumps(req))}::jsonb)")
def internal(**req):
    return J(f"SELECT aquaterra_exchange_internal({lit(json.dumps(req))}::jsonb)")
bal = lambda acct: int(psql(f"SELECT balance FROM aquaterra_wallets WHERE account = {lit(acct)}"))

player("founder@x", "Founder", "founder")
player("ann@x", "Ann")
player("bob@x", "Bob")

r = x(None, action="offers")
check(r["ok"] and not r["card"] and not r["crypto"] and r["market"] and not r["token"], "defaults: card/crypto off until set up, market on, token off")
check([p["tide"] for p in r["packs"]] == [1000, 5000, 25000] and r["packs"][0]["eurCents"] == 499, "three packs")
check(x("Ann", action="buy_card", pack=1)["error"] == "disabled", "card off")
check(x("Ann", action="admin_param", key="card_enabled", value=1)["error"] == "forbidden", "only the founder switches")
check(x("Founder", action="admin_param", key="card_enabled", value=1)["ok"], "founder turns card on")
check(x("Founder", action="admin_param", key="cro_usd_micro", value=1)["error"] == "param", "rate is not set by hand")

# --- card
r = x("Ann", action="buy_card", pack=2)
check(r["ok"] and r["next"] == "revolut_create" and r["order"]["amount"] == 1999 and r["order"]["currency"] == "EUR", "card order made")
oid = r["order"]["id"]
check(internal(action="card_attach", id=oid, providerId="rev-1", checkoutUrl="https://checkout/1")["ok"], "revolut order attached")
check(not internal(action="card_attach", id=oid, providerId="rev-2", checkoutUrl="x")["ok"], "attached only once")
r = x("Ann", action="order", id=oid)
check(r["next"] == "revolut_check" and r["providerId"] == "rev-1", "status asks n8n to check Revolut")
check(x("Bob", action="order", id=oid)["error"] == "not_found", "others cannot see my order")
before = bal("ann@x")
internal(action="card_settle", providerId="rev-1", state="completed", amount=1, currency="EUR")
check(bal("ann@x") == before, "wrong amount is not credited")
internal(action="card_settle", providerId="rev-1", state="pending", amount=1999, currency="EUR")
check(bal("ann@x") == before, "pending is not credited")
r = internal(action="card_settle", providerId="rev-1", state="COMPLETED", amount=1999, currency="EUR")
check(r["order"]["status"] == "credited" and bal("ann@x") == before + 5000, "completed card order credited")
internal(action="card_settle", providerId="rev-1", state="completed", amount=1999, currency="EUR")
check(bal("ann@x") == before + 5000, "credited only once")
check(psql("SELECT kind FROM aquaterra_ledger ORDER BY id DESC LIMIT 1") == "tide_purchase", "ledger kind")
for _ in range(9):
    o = x("Ann", action="buy_card", pack=3)
    if not o["ok"]:
        break
check(o["error"] == "limit", "daily card limit")

# --- crypto
check(x("Ann", action="buy_crypto", pack=1, coin="usdt")["error"] == "disabled", "crypto needs the wallet")
DEP = "0x" + "ab" * 20
check(x("Founder", action="admin_setting", key="deposit_address", value="nope")["error"] == "address", "address checked")
check(x("Founder", action="admin_setting", key="deposit_address", value=DEP.upper().replace("0X", "0x"))["ok"], "deposit address set")
x("Founder", action="admin_param", key="crypto_enabled", value=1)
r = x("Bob", action="buy_crypto", pack=1, coin="usdt")
o1 = r["order"]
check(r["ok"] and o1["payTo"] == DEP and 5500001 <= o1["amount"] <= 5509999, "usdt order with exact amount")
check(x("Bob", action="buy_crypto", pack=1, coin="cro")["error"] == "no_rate", "no CRO without a fresh rate")
plan = internal(action="scan_plan")
check(DEP in plan["addresses"] and plan["lastBlock"] is None, "watcher plan")
internal(action="scan_result", toBlock=100, croUsdMicro=125000, transfers=[])
r = x("Bob", action="buy_crypto", pack=1, coin="cro")
o2 = r["order"]
check(r["ok"] and o2["currency"] == "CRO" and 44000001 <= o2["amount"] <= 44009999, "cro order: 5.5 USDT / 0.125 = 44 CRO + tail")
b = bal("bob@x")
t = lambda h, tok, amt, to=DEP, li=0: {"hash": h, "logIndex": li, "token": tok, "from": "0x" + "11" * 20, "to": to, "amount": str(amt), "block": 101}
r = internal(action="scan_result", toBlock=101, transfers=[t("0xa1", "USDT", o1["amount"] + 1), t("0xa2", "USDT", o1["amount"], li=3), t("0xa2", "USDT", o1["amount"], li=3)])
check(r["credited"] == 1 and r["seen"] == 2 and bal("bob@x") == b + 1000, "usdt matched by exact amount, once")
r = internal(action="scan_result", toBlock=102, transfers=[t("0xa3", "CRO", o2["amount"] * 10**12, li=-1)])
check(r["credited"] == 1 and bal("bob@x") == b + 2000, "cro matched in wei")
check(int(psql("SELECT value FROM aquaterra_chain_state WHERE key = 'last_block'")) == 102, "last block kept")
r = x("Founder", action="admin")
check(len(r["unmatched"]) == 1 and r["sold"]["usdt"]["tide"] == 1000, "admin sees sales and the unmatched transfer")
o3 = x("Bob", action="buy_crypto", pack=1, coin="usdt")["order"]
check(x("Bob", action="cancel", id=o3["id"])["order"]["status"] == "cancelled", "crypto order cancelled")
# late payment within 24 hours still counts
o4 = x("Bob", action="buy_crypto", pack=1, coin="usdt")["order"]
psql(f"UPDATE aquaterra_tide_orders SET expires_at = now() - interval '1 minute' WHERE id = {o4['id']}")
x(None, action="offers")
check(psql(f"SELECT status FROM aquaterra_tide_orders WHERE id = {o4['id']}") == "expired", "order expires")
internal(action="scan_result", toBlock=103, transfers=[t("0xa4", "USDT", o4["amount"])])
check(psql(f"SELECT status FROM aquaterra_tide_orders WHERE id = {o4['id']}") == "credited", "late payment credited")

# --- market
SELLER = "0x" + "cd" * 20
check(x("Ann", action="market_sell", tide=99, priceMicro=5000000, address=SELLER)["error"] == "amount", "min offer")
check(x("Ann", action="market_sell", tide=1000, priceMicro=5000000, address=DEP)["error"] == "address", "not the project wallet")
fresh_free = x("Bob", action="offers")["free"]
check(fresh_free == bal("bob@x") - 1000, "welcome coins cannot be sold")
a0 = bal("ann@x")
r = x("Ann", action="market_sell", tide=2000, priceMicro=5000000, address=SELLER)
off = r["offerId"]
check(r["ok"] and bal("ann@x") == a0 - 2000 and bal("market:escrow") == 2000, "offer escrowed")
check(x("Ann", action="market_buy", id=off, tide=500)["error"] == "self", "cannot buy own offer")
r = x("Bob", action="market_buy", id=off, tide=500)
tr = r["trade"]
check(r["ok"] and tr["payTo"] == SELLER and 2500001 <= tr["amount"] <= 2509999, "trade: 500 TIDE at 5 USDT per 1000")
offers = x("Bob", action="offers")["market_offers"]
check(offers[0]["tide"] == 1500, "reserved Tide leave the offer")
check(SELLER in internal(action="scan_plan")["addresses"], "watcher looks at the seller's wallet")
b = bal("bob@x"); st = bal("state:treasury")
r = internal(action="scan_result", toBlock=104, transfers=[t("0xb1", "USDT", tr["amount"], to=SELLER)])
check(r["credited"] == 1 and bal("bob@x") == b + 490 and bal("state:treasury") == st + 10, "buyer gets Tide minus 2% fee to the State Treasury")
# unpaid trade comes back
tr2 = x("Bob", action="market_buy", id=off, tide=1000)["trade"]
psql(f"UPDATE aquaterra_market_trades SET expires_at = now() - interval '1 minute' WHERE id = {tr2['id']}")
x(None, action="offers")
check(x("Bob", action="offers")["market_offers"][0]["tide"] == 1500, "expired trade returns Tide to the offer")
tr3 = x("Bob", action="market_buy", id=off, tide=100)["trade"]
check(x("Bob", action="market_drop", id=tr3["id"])["ok"], "buyer drops the trade")
a1 = bal("ann@x")
r = x("Ann", action="market_cancel", id=off)
check(r["returned"] == 1500 and bal("ann@x") == a1 + 1500 and bal("market:escrow") == 0, "offer withdrawn, escrow empty")

# --- token (off)
check(x("Ann", action="withdraw", tide=1000, address=SELLER)["error"] == "disabled", "token withdraw is off")
x("Founder", action="admin_param", key="token_enabled", value=1)
a2 = bal("ann@x")
r = x("Ann", action="withdraw", tide=1000, address=SELLER)
check(r["ok"] and r["fee"] == 10 and bal("ann@x") == a2 - 1010 and bal("bridge:cronos") == 1000, "withdraw works when switched on")
check(x("Founder", action="admin_param", key="token_enabled", value=2)["error"] == "amount", "switches are 0 or 1")

total = int(psql("SELECT sum(balance) FROM aquaterra_wallets"))
check(total == 50000000, "no Tide created or lost")
print(f"OK: {passed} checks passed")
