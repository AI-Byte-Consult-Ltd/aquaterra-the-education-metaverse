"""Test of the NICS AI dialog functions on a scratch Postgres.

  PGHOST=/var/tmp/pg PGPORT=5433 python3 server/nics/test_nics.py
"""
import hashlib, json, os, subprocess

HERE = os.path.dirname(os.path.abspath(__file__))
DB = "aquaterra_nics_test"
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
nics = lambda req: json.loads(psql(f"SELECT aquaterra_nics({lit(json.dumps(req))}::jsonb)"))

passed = 0
def check(cond, msg):
    global passed
    if not cond:
        raise SystemExit(f"FAIL: {msg}")
    passed += 1

psql(f"DROP DATABASE IF EXISTS {DB}", "postgres")
psql(f"CREATE DATABASE {DB}", "postgres")
load(os.path.join(HERE, "..", "governance", "base-tables.sql"))
load(os.path.join(HERE, "nics.sql"))
load(os.path.join(HERE, "nics.sql"))  # runs twice safely

def player(email, token):
    psql(f"INSERT INTO aquaterra_players (email, display_name) VALUES ({lit(email)}, {lit(email.split('@')[0])})")
    h = hashlib.sha256(token.encode()).hexdigest()
    psql(f"INSERT INTO aquaterra_sessions (token_hash, email, expires_at) VALUES ('{h}', {lit(email)}, now() + interval '1 day')")

player("ann@example.com", "aaaa")
player("bob@example.com", "bbbb")

check(nics({"action": "status"}) == {"ok": True, "queue": False, "termsVersion": "2026-11-24"}, "status")
check(nics({"action": "consent", "session": "nope"})["error"] == "session", "bad session")
check(nics({"action": "consent", "session": "aaaa"})["consent"] is None, "no consent yet")

line = {"action": "log", "session": "aaaa", "lang": "en", "qtype": "wallet", "question": "How much Tide do I have? mail me ann@example.com or +359 888 123 456",
        "facts": {"balance": "1,000 TIDE", "plots": 2, "Bad Key": "x", "obj": {"a": 1}}, "answer": "You hold 1,000 TIDE.", "source": "phrase"}
check(nics(line) == {"ok": True, "logged": False}, "nothing stored without consent")
check(psql("SELECT count(*) FROM aquaterra_nics_dialogs") == "0", "table empty without consent")

check(nics({"action": "set_consent", "session": "aaaa", "consent": "yes"})["error"] == "consent", "consent must be boolean")
check(nics({"action": "set_consent", "session": "aaaa", "consent": True})["consent"] is True, "consent given")
r = nics(line)
check(r["logged"] and r["id"] > 0, "logged with consent")
row = json.loads(psql("SELECT row_to_json(d) FROM aquaterra_nics_dialogs d"))
check("ann" not in json.dumps(row), "no email anywhere in the line")
check(row["resident"].startswith("r_") and len(row["resident"]) == 18, "anonymised resident number")
check("[email]" in row["question"] and "[number]" in row["question"], "personal data scrubbed")
check(row["facts"] == {"balance": "1,000 TIDE", "plots": 2}, "only flat, well-named facts kept")
check(nics({**line, "qtype": "hack"})["error"] == "qtype", "unknown question type refused")
check(nics({**line, "source": "gpt"})["error"] == "source", "unknown source refused")
check(nics({**line, "answer": ""})["error"] == "length", "empty answer refused")

check(nics({"action": "rate", "session": "bbbb", "id": r["id"], "rating": 1})["error"] == "not_found", "cannot rate another resident's line")
check(nics({"action": "rate", "session": "aaaa", "id": r["id"], "rating": 2})["error"] == "rating", "rating is +1 or -1")
check(nics({"action": "rate", "session": "aaaa", "id": r["id"], "rating": -1})["ok"], "rated")

check(nics({"action": "export", "key": "wrong"})["error"] == "forbidden", "export needs the key")
key = psql("SELECT value FROM aquaterra_nics_settings WHERE key = 'export_key'")
lines = nics({"action": "export", "key": key, "after": 0})["lines"]
check(len(lines) == 1 and lines[0]["rating"] == -1 and set(lines[0]) == {"id", "ts", "lang", "resident", "qtype", "question", "facts", "answer", "source", "rating"}, "export line format")
check(nics({"action": "export", "key": key, "after": lines[0]["id"]})["lines"] == [], "export after the last id is empty")

same = nics(line)
check(psql(f"SELECT count(DISTINCT resident) FROM aquaterra_nics_dialogs") == "1", "same resident, same number")
check(nics({"action": "forget", "session": "aaaa"})["deleted"] == 2, "forget deletes my lines")
check(nics({"action": "consent", "session": "aaaa"})["consent"] is False, "forget withdraws consent")
check(nics(line)["logged"] is False, "nothing stored after withdrawal")

check(nics({"action": "ask", "session": "aaaa"}) == {"ok": True, "queued": False}, "queue off")
check(nics({"action": "drop", "session": "aaaa"})["error"] == "action", "unknown action")
print(f"ok: {passed} checks")
