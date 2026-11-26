// Bundles the game's NICS engine (engine.ts, tokenizer.ts, prompt.ts + answer checks) into one
// plain script for the n8n Code node that answers residents on the server: the weights never
// leave the server. Output: server/mind/server-engine.js (exposes globalThis.NicsServer).
// n8n "[75 INTERNAL] AquaTerra City Mind Answer", node Answer = server-engine.js + server/mind/answer.js.
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("..", import.meta.url));
await build({
  stdin: {
    contents: `import { NicsModel, readWeights } from "./src/game/mind/engine";
import { NicsTokenizer } from "./src/game/mind/tokenizer";
import { promptIds } from "./src/game/mind/prompt";
// the server returns the raw text; the site runs the answer checks (strict or experimental)
const ask = (model, tok, topic, question, _facts, maxNew = 96) => {
  const ids = promptIds(tok, topic, question);
  const room = Math.min(maxNew, model.cfg.max_seq_len - ids.length);
  const out = room > 0 ? model.generate(ids, room, { stop: [tok.id("<|end|>"), tok.id("<eos>")] }) : [];
  return { raw: tok.decode(out), text: null };
};
globalThis.NicsServer = { NicsModel, readWeights, NicsTokenizer, ask };`,
    resolveDir: root,
    loader: "ts",
  },
  bundle: true,
  format: "iife",
  platform: "neutral",
  target: "es2020",
  alias: { "@": root + "src" },
  outfile: root + "server/mind/server-engine.js",
  minify: true,
  legalComments: "none",
});
console.log("server/mind/server-engine.js");
