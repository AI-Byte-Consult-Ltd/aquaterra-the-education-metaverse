"""Pack a NICS lab release folder for browsers (format "nics-release-v1").

The lab stays the only home of the model. Its release folder (scripts/release_language.py in
nics-ai-lab: model.safetensors, tokenizer.json, config.yaml, training-manifest.json,
sha256sums.txt) is read as it is; this script only checks its checksums and re-writes the same
numbers smaller for download (float16, the tied output head stored once). No training, no change
to any weight beyond float16 rounding. Needs numpy only (no torch).

  python3 server/mind/pack_release.py <lab release folder> --version 1 --out <folder for the web>
"""
from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import struct
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

DTYPES = {"F32": np.float32, "F16": np.float16, "BF16": None}


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def read_safetensors(path: Path) -> dict[str, np.ndarray]:
    raw = path.read_bytes()
    (n,) = struct.unpack("<Q", raw[:8])
    header = json.loads(raw[8:8 + n])
    base = 8 + n
    out = {}
    for name, info in header.items():
        if name == "__metadata__":
            continue
        a, b = info["data_offsets"]
        buf = raw[base + a: base + b]
        if info["dtype"] == "BF16":
            arr = (np.frombuffer(buf, dtype="<u2").astype(np.uint32) << 16).view(np.float32)
        elif info["dtype"] in DTYPES:
            arr = np.frombuffer(buf, dtype=np.dtype(DTYPES[info["dtype"]]).newbyteorder("<")).astype(np.float32)
        else:
            raise SystemExit(f"{name}: dtype {info['dtype']} not supported")
        out[name] = arr.reshape(info["shape"])
    return out


def model_config(path: Path) -> dict:
    """The `model:` block of the lab's config.yaml (flat key: value lines)."""
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


def tensor_names(cfg: dict) -> list[str]:
    names = ["tok_emb.weight"] + (["pos_emb.weight"] if cfg["pos_encoding"] == "learned" else [])
    for i in range(cfg["n_layers"]):
        names += [f"blocks.{i}.{n}.weight" for n in ("norm1", "attn.qkv", "attn.proj", "norm2", "ffn.w1", "ffn.w2", "ffn.w3")]
    return names + ["norm_f.weight"]


def pack(src: Path, out: Path, version: int, f32: bool = False) -> dict:
    sums = {}
    for line in (src / "sha256sums.txt").read_text(encoding="utf-8").splitlines():
        if line.strip():
            h, name = line.split(None, 1)
            sums[name.strip()] = h
    for name in ("model.safetensors", "tokenizer.json", "config.yaml"):
        if sums.get(name) != sha256(src / name):
            raise SystemExit(f"{name}: checksum does not match sha256sums.txt, the folder is damaged")
    lab = json.loads((src / "training-manifest.json").read_text(encoding="utf-8"))
    tok = json.loads((src / "tokenizer.json").read_text(encoding="utf-8"))
    cfg = model_config(src / "config.yaml")
    cfg["vocab_size"] = 512 + len(tok["merges"])
    cfg.setdefault("pos_encoding", "learned")
    w = read_safetensors(src / "model.safetensors")
    if "lm_head.weight" in w and not np.array_equal(w["lm_head.weight"], w["tok_emb.weight"]):
        raise SystemExit("lm_head is not tied to tok_emb: not the architecture the game runs")
    out.mkdir(parents=True, exist_ok=True)
    tensors, offset = [], 0
    with open(out / "weights.bin", "wb") as f:
        for name in tensor_names(cfg):
            t = w[name]
            f.write(t.astype("<f4" if f32 else "<f2").tobytes())
            tensors.append({"name": name, "shape": list(t.shape), "offset": offset})
            offset += t.size
    shutil.copyfile(src / "tokenizer.json", out / "tokenizer.json")
    manifest = {
        "format": "nics-release-v1",
        "model_id": lab.get("model_id", "nics-text"),
        "version": version,
        "step": int(lab.get("step", 0)),
        "created_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
        "config": {k: cfg[k] for k in ("vocab_size", "d_model", "n_layers", "n_heads", "max_seq_len", "pos_encoding")},
        "dtype": "f32" if f32 else "f16",
        "tensors": tensors,
        "weights_file": "weights.bin",
        "weights_sha256": sha256(out / "weights.bin"),
        "tokenizer_file": "tokenizer.json",
        "tokenizer_sha256": sha256(out / "tokenizer.json"),
        "lab_release": lab.get("release"),
        "lab_sha256": sums["model.safetensors"],
        "eval": {k: lab[k] for k in ("validation_loss", "lab_version", "max_steps") if lab.get(k) is not None},
    }
    (out / "manifest.json").write_text(json.dumps(manifest, indent=1), encoding="utf-8")
    return manifest


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("src")
    p.add_argument("--version", type=int, required=True)
    p.add_argument("--out", required=True)
    p.add_argument("--f32", action="store_true")
    a = p.parse_args()
    m = pack(Path(a.src), Path(a.out), a.version, a.f32)
    size = (Path(a.out) / "weights.bin").stat().st_size / 1e6
    print(json.dumps({"version": m["version"], "lab_release": m["lab_release"], "step": m["step"], "weights_mb": round(size, 1)}))


if __name__ == "__main__":
    main()
