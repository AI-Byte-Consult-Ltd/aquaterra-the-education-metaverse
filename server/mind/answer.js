// n8n "[75 INTERNAL] AquaTerra City Mind Answer", node "Answer": runs NICS Language on the server.
// The node's code is server-engine.js (npm: node scripts/build-mind-server.mjs) followed by this file.
// Input: the release files from aquaterra_mind_files (file, part, b64) and the question from the trigger.
// Output: only { ok, version, text } (raw text: the site checks it). The weights never leave this node,
// and [75] saves no execution data. [74] calls it only for an `ask` the SQL accepted.
const q = $('Ask').first().json;
try {
  const S = globalThis.NicsServer;
  const rows = $input.all().map((i) => i.json);
  const join = (f) => Buffer.concat(rows.filter((x) => x.file === f).sort((a, b) => a.part - b.part).map((x) => Buffer.from(x.b64, 'base64')));
  const w = join('weights');
  const m = q.manifest;
  if (w.length !== m.tensors.reduce((s, t) => s + t.shape.reduce((a, b) => a * b, 1), 0) * (m.dtype === 'f16' ? 2 : 4)) throw new Error('size');
  const model = new S.NicsModel(m.config, S.readWeights(m, w.buffer.slice(w.byteOffset, w.byteOffset + w.length)));
  const tok = new S.NicsTokenizer(JSON.parse(join('tokenizer').toString('utf8')));
  const out = S.ask(model, tok, q.topic, String(q.question || ''), {}, 64);
  return [{ json: { res: { ok: true, version: q.version, text: out.raw } } }];
} catch (e) {
  return [{ json: { res: { ok: false, error: 'mind_error', detail: String(e && e.message || e).slice(0, 120) } } }];
}
