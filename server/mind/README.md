# City Mind: AquaTerra ↔ NICS lab

There is **one** model, NICS Language, and it lives and trains in the NICS lab
(`AI-Byte-Consult-Ltd/nics-ai-lab`). AquaTerra never trains a model of its own: it receives
numbered releases, examines them with its own checks, runs the live one in residents' browsers,
and hands consented game data back to the lab.

## 1. Making a release (in the lab)

```
python server/mind/export_release.py --checkpoint <step-dir>/trainer-state.pt \
  --tokenizer data/processed/language/tokenizer-24k.json --config configs/text/micro.yaml \
  --version 1 --out releases/nics-text-micro-v1
```

The folder (`nics-release-v1`) holds `manifest.json`, `weights.bin` (float16, ~47 MB for micro)
and `tokenizer.json`. Put it at any public https address that sends CORS headers for
`https://aquaterra.aibyteconsult.com` (for example Cloudflare R2), then register it:

```
POST https://n8n.aibyteconsult.com/webhook/aquaterra-mind
{"action": "release", "key": "<release_key>", "baseUrl": "https://…/nics-text-micro-v1", "manifest": { …manifest.json… }}
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

## 3. Data back to the lab

```
POST … {"action": "corpus", "key": "<export_key>", "after": 0, "limit": 500}
→ {"lines": [...], "next": <cursor>, "dropped": n, "civic": {"laws": [...], "quest_notes": [...]}}
```

Same line format as the dialog export (`aquaterra_nics_line`), after the anti-poisoning rules:
consent still given, resident not in `aquaterra_mind_muted`, not rated 👎, one copy of a repeated
question, at most `lines_per_resident_day` (40) lines per resident a day. Civic texts (laws in force,
NICS AI quest notes) come with the first fetch or with `"civic": true`.

## 4. Next: Mind mining

Residents' browsers compute gradients for the lab's current release on lab-chosen batches; the
server re-computes a share of them to catch cheaters; the lab merges the sum into its own training,
so the model stays one. Verified work earns Tide. Needs the backward pass in `engine.ts`.

## Tests

- `npx vitest run src/game/mind`: the JS engine and tokenizer give the lab's exact token ids and
  the lab's PyTorch logits (fixture from `server/mind/make_fixture.py --lab <nics-ai-lab>`).
- `PGHOST=/var/tmp/pg PGPORT=5433 python3 server/mind/test_mind.py`: the SQL side.

n8n: `[74 PUBLIC] AquaTerra City Mind` (webhook `aquaterra-mind`) → `aquaterra_mind(req)`.
