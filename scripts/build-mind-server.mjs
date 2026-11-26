// Bundles the game's NICS engine (engine.ts, tokenizer.ts, prompt.ts + answer checks) into one
// plain script for the n8n Code node that answers residents on the server: the weights never
// leave the server. Output: server/mind/server-engine.js (exposes globalThis.NicsServer).
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("..", import.meta.url));
await build({
  stdin: {
    contents: `import { NicsModel, readWeights } from "./src/game/mind/engine";
import { NicsTokenizer } from "./src/game/mind/tokenizer";
import { ask } from "./src/game/mind/prompt";
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
