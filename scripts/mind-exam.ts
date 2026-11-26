/*
 * Exam of a NICS Language release, run by the lab before promoting it:
 *   npx vite-node scripts/mind-exam.ts <release folder>
 * Checks both sha256, runs the game's exam with the game's own engine and checks, prints JSON.
 * The release goes live only through aquaterra_mind 'promote' with these numbers.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NicsModel, readWeights, type ReleaseManifest } from "../src/game/mind/engine";
import { NicsTokenizer } from "../src/game/mind/tokenizer";
import { runExam } from "../src/game/mind/prompt";

const dir = process.argv[2];
if (!dir) throw new Error("usage: mind-exam.ts <release folder>");
const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8")) as ReleaseManifest;
const w = readFileSync(join(dir, manifest.weights_file));
const t = readFileSync(join(dir, manifest.tokenizer_file));
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
if (sha(w) !== manifest.weights_sha256 || sha(t) !== manifest.tokenizer_sha256) throw new Error("checksum mismatch");
const model = new NicsModel(manifest.config, readWeights(manifest, w.buffer.slice(w.byteOffset, w.byteOffset + w.byteLength)));
const tok = new NicsTokenizer(JSON.parse(t.toString("utf8")));
const r = runExam(model, tok, (i, ok) => process.stderr.write(ok ? "+" : "."));
process.stderr.write("\n");
console.log(JSON.stringify({ version: manifest.version, exam: { total: r.total, passed: r.passed }, answers: r.answers }, null, 1));
