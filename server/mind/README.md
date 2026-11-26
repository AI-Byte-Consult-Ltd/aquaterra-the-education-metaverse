# City Mind: AquaTerra ↔ NICS lab

There is **one** model, NICS Language, and it lives and trains in the NICS lab
(`AI-Byte-Consult-Ltd/nics-ai-lab`). AquaTerra never trains a model of its own: it receives
numbered releases, examines them with its own checks, runs the live one in residents' browsers,
answers residents with the live one **on the server** (the weights never reach a browser),
and hands consented game data back to the lab.

## 1. Making a release

In the lab: `scripts/release_language.py` (nics-ai-lab 0.22.0) makes
`releases/language/<model_id>-step-XXXXXX/` with model.safetensors, tokenizer.json, config.yaml,
training-manifest.json, sha256sums.txt. The game takes that folder as it is and packs it for
browsers (checks the lab's checksums, writes the same weights as float16, the tied head once):

```
python3 server/mind/pack_release.py <lab release folder> --version 1 --out web/nics-text-micro-v1
```

The packed folder (`nics-release-v1`: manifest.json with `lab_release` and `lab_sha256`,
weights.bin ~47 MB for micro, tokenizer.json) is uploaded to the **private** Cloudflare R2 bucket
`nics-releases` (Alexander 2026-11-26: the weights are NICS's own technology, no public access,
no CORS). Then register it by its key prefix inside the bucket:

```
POST https://n8n.aibyteconsult.com/webhook/aquaterra-mind
{"action": "release", "key": "<release_key>", "prefix": "language/nics-text-micro-v1", "manifest": { …manifest.json… }}
```

`release_key` is in the game database, table `aquaterra_mind_settings`. Never put it in code or chat.
A new release starts **in shadow**: nobody sees its words.

## 2. Exam and promotion

```
npx vite-node scripts/mind-exam.ts releases/nics-text-micro-v1     # in this repo
POST … {"action": "promote", "key": "<release_key>", "version": 1, "exam": {"total": 30, "passed": 28}}
```

The exam asks 30 resident questions over every topic and accepts an answer only if
`checkModelAnswer` (src/game/nics/answer.ts) does: only the topic's `{fact}` labels, no digits of its
own, no links. A release goes live at `exam_min_pass` (0.9) or more; the previous live one retires.
`{"action": "retire", "version": N}` takes a release out.

Prompt format (src/game/mind/prompt.ts), the lab trains on the same shape:

```
<|task:chat|><|lang:en|><|in|>{topic}<|sep|>{resident question}<|sep|>{fact labels}<|out|>{answer with labels}<|end|>
```

The resident's question is always encoded without special tokens, so it cannot inject control tokens.

## 2b. Answers on the server

`{"action": "ask", "session": "…", "topic": "wallet", "question": "…"}` → `aquaterra_mind` checks the
session, the topic and the rate limit (`asks_per_hour`, 20) and tells n8n where the live release is.
n8n reads weights.bin and tokenizer.json from the private bucket, checks both sha256, runs
`server/mind/server-engine.js` (built by `node scripts/build-mind-server.mjs` from the same engine
the tests check against the lab) and returns only `{ok, version, text}`, the text already passed
`checkModelAnswer`. The browser fills the labels with the resident's live facts and checks again.

## 3. Data back to the lab

```
POST … {"action": "corpus", "key": "<export_key>", "after": 0, "limit": 500}
→ {"lines": [...], "next": <cursor>, "dropped": n, "civic": {"laws": [...], "quest_notes": [...]}}
```

Same line format as the dialog export (`aquaterra_nics_line`), after the anti-poisoning rules:
consent still given, resident not in `aquaterra_mind_muted`, not rated 👎, one copy of a repeated
question, at most `lines_per_resident_day` (40) lines per resident a day. Civic texts (laws in force,
NICS AI quest notes) come with the first fetch or with `"civic": true`.

## 4. Later: Mind mining

Would need residents' devices to hold the weights, which the private-bucket rule forbids for now.
If it comes back, it must share only gradients for lab-chosen batches, with server spot checks.

## Tests

- `npx vitest run src/game/mind`: the JS engine and tokenizer give the lab's exact token ids and
  the lab's PyTorch logits (fixture from `server/mind/make_fixture.py --lab <nics-ai-lab>`).
- `PGHOST=/var/tmp/pg PGPORT=5433 python3 server/mind/test_mind.py`: the SQL side.

n8n: `[74 PUBLIC] AquaTerra City Mind` (webhook `aquaterra-mind`) → `aquaterra_mind(req)`.

## Experimental release and where the files live (2026-11-26)

- `promote` with `"experimental": true` (release key) puts a release live below the exam bar.
  Alexander chose this for version 1 (step 12021, exam 1/30): "пусть выходит, в этом и эксперимент".
  /mind labels it "Experimental version, still learning" and shows only sentences without numbers
  of their own, links or markup (`checkExperimentalAnswer`).
- Until the private R2 bucket is connected, release files live in `aquaterra_mind_files`
  (weights in 6 MB parts + tokenizer), read only by n8n `[75 INTERNAL] AquaTerra City Mind Answer`
  (saves no execution data). `[74]` calls it for an accepted `ask`; at most `asks_per_minute_all`
  answers a minute for the whole city, `asks_per_hour` per resident.
