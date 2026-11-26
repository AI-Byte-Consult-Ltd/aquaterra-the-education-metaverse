"""Make a NICS Language release folder that AquaTerra can read.

Runs in the NICS lab (needs torch), next to the checkpoint. The lab stays the only
home of the model: this script copies one checkpoint's weights out, it never trains.

  python export_release.py --checkpoint <step-dir>/trainer-state.pt \
      --tokenizer data/processed/language/tokenizer-24k.json \
      --config configs/text/micro.yaml --version 1 --out releases/nics-text-micro-v1

Folder (format "nics-release-v1"):
  manifest.json   config, tensor table, sha256 of both files, step, eval numbers
  weights.bin     every tensor, little-endian float16 (or float32 with --f32), in the
                  order of src/game/mind/engine.ts tensorShapes(); lm_head is tied to
                  tok_emb and is not written twice
  tokenizer.json  the lab's nics-bpe-v1 file, copied byte for byte
"""
from __future__ import annotations

import argparse
import hashlib
import json
import shutil
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import torch


def tensor_names(cfg: dict) -> list[str]:
    names = ["tok_emb.weight"]
    if cfg["pos_encoding"] == "learned":
        names.append("pos_emb.weight")
    for i in range(cfg["n_layers"]):
        names += [f"blocks.{i}.{n}.weight" for n in ("norm1", "attn.qkv", "attn.proj", "norm2", "ffn.w1", "ffn.w2", "ffn.w3")]
    return names + ["norm_f.weight"]


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def read_yaml_model(path: Path) -> dict:
    """The `model:` block of the lab config (flat key: value lines), without a yaml library."""
    out, inside = {}, False
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        if not line.startswith(" "):
            inside = line.split(":")[0].strip() == "model"
            continue
        if inside and ":" in line:
            k, v = (s.strip() for s in line.split("#")[0].split(":", 1))
            out[k] = int(v) if v.lstrip("-").isdigit() else v
    return out


def export(state_dict: dict, cfg: dict, tokenizer: Path, out: Path, version: int, step: int, model_id: str,
           f32: bool = False, eval_numbers: dict | None = None) -> dict:
    out.mkdir(parents=True, exist_ok=True)
    tensors, offset = [], 0
    with open(out / "weights.bin", "wb") as f:
        for name in tensor_names(cfg):
            t = state_dict[name].detach().to(torch.float32).cpu().numpy()
            f.write(t.astype("<f4" if f32 else "<f2").tobytes())
            tensors.append({"name": name, "shape": list(t.shape), "offset": offset})
            offset += t.size
    shutil.copyfile(tokenizer, out / "tokenizer.json")
    manifest = {
        "format": "nics-release-v1",
        "model_id": model_id,
        "version": version,
        "step": step,
        "created_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
        "config": {k: cfg[k] for k in ("vocab_size", "d_model", "n_layers", "n_heads", "max_seq_len", "pos_encoding")},
        "dtype": "f32" if f32 else "f16",
        "tensors": tensors,
        "weights_file": "weights.bin",
        "weights_sha256": sha256(out / "weights.bin"),
        "tokenizer_file": "tokenizer.json",
        "tokenizer_sha256": sha256(out / "tokenizer.json"),
        "eval": eval_numbers or {},
    }
    (out / "manifest.json").write_text(json.dumps(manifest, indent=1), encoding="utf-8")
    return manifest


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--checkpoint", required=True)
    p.add_argument("--tokenizer", required=True)
    p.add_argument("--config", required=True)
    p.add_argument("--version", type=int, required=True)
    p.add_argument("--out", required=True)
    p.add_argument("--f32", action="store_true")
    a = p.parse_args()
    state = torch.load(a.checkpoint, map_location="cpu", weights_only=False)
    tok = json.loads(Path(a.tokenizer).read_text(encoding="utf-8"))
    cfg = read_yaml_model(Path(a.config))
    cfg["vocab_size"] = 512 + len(tok["merges"])  # the lab builds the model with tok.vocab_size
    cfg.setdefault("pos_encoding", "learned")
    m = export(state["model_state"], cfg, Path(a.tokenizer), Path(a.out), a.version, int(state.get("step", 0)),
               "nics-text-micro", a.f32, {"best_val_loss": float(state.get("best_val_loss", 0) or 0)})
    print(json.dumps({k: m[k] for k in ("model_id", "version", "step", "weights_sha256")}))


if __name__ == "__main__":
    main()
