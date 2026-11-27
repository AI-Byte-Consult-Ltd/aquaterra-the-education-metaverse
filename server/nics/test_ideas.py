"""Test of the ideas board (ideas.sql) on a scratch Postgres.

  PGHOST=/var/tmp/pg PGPORT=5433 python3 server/nics/test_ideas.py
"""
import hashlib, json, os, subprocess

HERE = os.path.dirname(os.path.abspath(__file__))
DB = "aquaterra_ideas_test"
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
psql("ALTER TABLE aquaterra_council ADD COLUMN IF NOT EXISTS term_ends timestamptz")
for _ in range(2):  # runs twice safely
    load(os.path.join(HERE, "nics.sql"))
    load(os.path.join(HERE, "ideas.sql"))

def player(email, token, name):
    psql(f"INSERT INTO aquaterra_players (email, display_name) VALUES ({lit(email)}, {lit(name)})")
    h = hashlib.sha256(token.encode()).hexdigest()
    psql(f"INSERT INTO aquaterra_sessions (token_hash, email, expires_at) VALUES ('{h}', {lit(email)}, now() + interval '1 day')")

player("ann@example.com", "aaaa", "Ann")
player("bob@example.com", "bbbb", "Bob")
player("cat@example.com", "cccc", "Cat")
psql("INSERT INTO aquaterra_council (seat, name, title, kind, email) VALUES (1, 'Founder', 'Founder', 'person', 'cat@example.com'), (2, 'NICS AI', 'AI', 'ai', NULL)")
psql("INSERT INTO aquaterra_council (seat, name, title, kind, email, term_ends) VALUES (4, 'Old', 'Member', 'person', 'bob@example.com', now() - interval '1 day')")

b = nics({"action": "ideas"})
check(b["ok"] and b["ideas"] == [] and b["signedIn"] is False and b["council"] is False, "empty public board")
check(nics({"action": "idea_submit", "session": "nope", "title": "Hello", "body": "x" * 30})["error"] == "session", "submit needs session")
check(nics({"action": "idea_submit", "session": "aaaa", "title": "Hi", "body": "x" * 30})["error"] == "title", "short title")
check(nics({"action": "idea_submit", "session": "aaaa", "title": "Hover cars", "body": "short"})["error"] == "body", "short body")

r = nics({"action": "idea_submit", "session": "aaaa", "title": "Hover cars over the ocean",
          "body": "Flying hover cars between islands, with charging towers on every island. Write me ann@example.com or see https://x.y/z"})
check(r["ok"], "idea saved")
idea = r["idea"]
check(idea["category"] == "tech", f"NICS files hover cars under tech: {idea['category']}")
check("[email]" in idea["body"] and "[link]" in idea["body"] and "ann@" not in idea["body"], "personal data scrubbed")
check("hover" in idea["words"] and "charging" in idea["words"] and "with" not in idea["words"], "key words")
check(idea["status"] == "open" and idea["mine"] and idea["author"] == "Ann" and idea["similar"] == [], "fresh idea")
check(nics({"action": "idea_submit", "session": "aaaa", "title": "hover cars over the ocean", "body": "y" * 30})["error"] == "duplicate", "duplicate title")

r2 = nics({"action": "idea_submit", "session": "bbbb", "title": "Hover taxis", "body": "Hover taxis with charging towers between islands would be great.", "category": "transport"})
check(r2["ok"] and r2["idea"]["category"] == "transport", "chosen category kept")
check(r2["idea"]["similar"] == [idea["id"]], f"NICS remembers the similar idea: {r2['idea']['similar']}")
check(nics({"action": "idea_submit", "session": "bbbb", "title": "Some idea", "body": "z" * 30, "category": "weird"})["error"] == "category", "bad category")

# support
check(nics({"action": "idea_support", "session": "aaaa", "id": str(idea["id"])})["error"] == "own", "no support for own idea")
s = nics({"action": "idea_support", "session": "bbbb", "id": str(idea["id"])})
check(s["idea"]["supports"] == 1 and s["idea"]["supported"], "supported")
s = nics({"action": "idea_support", "session": "bbbb", "id": str(idea["id"])})
check(s["idea"]["supports"] == 0 and not s["idea"]["supported"], "support taken back")
nics({"action": "idea_support", "session": "cccc", "id": str(idea["id"])})
b = nics({"action": "ideas", "session": "bbbb"})
check([x["id"] for x in b["ideas"]] == [idea["id"], r2["idea"]["id"]], "most supported first")
check(b["counts"]["open"] == 2 and b["counts"]["residents"] == 2, "counts")
check({t["topic"] for t in b["topics"]} == {"tech", "transport"}, "topics learned")
check(any(w["word"] == "hover" and w["ideas"] == 2 for w in b["words"]), "shared words learned")
check(b["leftToday"] == 2 and b["perDay"] == 3, "left today")
check(nics({"action": "ideas", "status": "mine"})["error"] == "session", "mine needs session")
check(len(nics({"action": "ideas", "session": "bbbb", "status": "mine"})["ideas"]) == 1, "my ideas")

# council
check(nics({"action": "idea_decide", "session": "aaaa", "id": str(idea["id"]), "status": "accepted"})["error"] == "council", "not council")
check(nics({"action": "idea_decide", "session": "bbbb", "id": str(idea["id"]), "status": "accepted"})["error"] == "council", "term ended")
check(nics({"action": "ideas", "session": "cccc"})["council"] is True, "council flag")
check(nics({"action": "idea_decide", "session": "cccc", "id": str(idea["id"]), "status": "rejected"})["error"] == "note", "reject needs a note")
d = nics({"action": "idea_decide", "session": "cccc", "id": str(idea["id"]), "status": "in_dev", "note": "Taking it into the next build."})
check(d["idea"]["status"] == "in_dev" and d["idea"]["decidedBy"] == "Cat" and d["idea"]["councilNote"], "in development")
check(nics({"action": "idea_withdraw", "session": "aaaa", "id": str(idea["id"])})["error"] == "closed", "no withdraw after decision")
check(nics({"action": "idea_withdraw", "session": "aaaa", "id": str(r2["idea"]["id"])})["error"] == "not_found", "only own withdraw")
check(len(nics({"action": "ideas", "status": "in_dev"})["ideas"]) == 1, "filter by status")
d = nics({"action": "idea_decide", "session": "cccc", "id": str(r2["idea"]["id"]), "status": "rejected", "note": "Same as an idea in development."})
check(nics({"action": "idea_support", "session": "aaaa", "id": str(r2["idea"]["id"])})["error"] == "closed", "no support for declined")

# limit
for k in range(2):
    check(nics({"action": "idea_submit", "session": "aaaa", "title": f"Idea number {k}", "body": "A garden on every roof of the towers."})["ok"], "more ideas")
check(nics({"action": "idea_submit", "session": "aaaa", "title": "One more idea", "body": "A garden on every roof again."})["error"] == "limit", "3 a day")
last = [x for x in nics({"action": "ideas", "session": "aaaa", "status": "mine"})["ideas"] if x["status"] == "open"][0]
check(nics({"action": "idea_withdraw", "session": "aaaa", "id": str(last["id"])})["ok"], "withdraw open idea")

# export for the lab
check(nics({"action": "ideas_export", "key": "wrong"})["error"] == "forbidden", "export needs key")
key = psql("SELECT value FROM aquaterra_nics_settings WHERE key = 'export_key'")
e = nics({"action": "ideas_export", "key": key})
check(len(e["ideas"]) == 3 and e["ideas"][0]["status"] == "in_dev" and e["ideas"][1]["status"] == "rejected", "export with labels")
check("example.com" not in json.dumps(e) and "Ann" not in json.dumps(e) and e["ideas"][0]["resident"].startswith("r_"), "export is anonymous")
check(len(nics({"action": "ideas_export", "key": key, "after": str(e["ideas"][1]["id"])})["ideas"]) == 1, "export after")
check(nics({"action": "status"})["ok"], "dialog actions still work")

print(f"ok: {passed} checks")
