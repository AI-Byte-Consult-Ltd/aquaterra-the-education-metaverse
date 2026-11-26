/// <reference lib="webworker" />
/*
 * Runs the live NICS Language release inside the resident's browser, off the main thread.
 * Messages in:  {type:"load", baseUrl} | {type:"ask", id, topic, question, facts}
 * Messages out: {type:"progress", bytes} | {type:"ready", version, params} | {type:"answer", id, raw, text} | {type:"error", error}
 */
import { NicsModel, readWeights, paramCount } from "./engine";
import { NicsTokenizer } from "./tokenizer";
import { loadRelease } from "./loader";
import { ask } from "./prompt";

let model: NicsModel | null = null;
let tok: NicsTokenizer | null = null;

self.onmessage = async (e: MessageEvent) => {
  const m = e.data;
  try {
    if (m.type === "load") {
      const r = await loadRelease(m.baseUrl, (bytes) => self.postMessage({ type: "progress", bytes }));
      tok = new NicsTokenizer(r.tokenizer);
      model = new NicsModel(r.manifest.config, readWeights(r.manifest, r.weights));
      self.postMessage({ type: "ready", version: r.manifest.version, params: paramCount(r.manifest.config) });
    } else if (m.type === "ask") {
      if (!model || !tok) throw new Error("not_loaded");
      const a = ask(model, tok, m.topic, m.question, m.facts);
      self.postMessage({ type: "answer", id: m.id, raw: a.raw, text: a.text });
    }
  } catch (err) {
    self.postMessage({ type: "error", error: err instanceof Error ? err.message : "error" });
  }
};
