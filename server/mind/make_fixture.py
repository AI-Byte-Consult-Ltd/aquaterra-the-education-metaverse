"""Build the test fixture that proves the game's JS engine computes what the lab computes.

  python3 server/mind/make_fixture.py --lab ../nics-ai-lab

Uses the lab's own code (tokenizer, NicsTextModel, release_language-style export_release) at a
tiny size with random weights, packs the lab folder with pack_release.py and stores the lab's
logits and token ids next to it.
"""
import argparse, json, sys
from pathlib import Path

import torch

HERE = Path(__file__).resolve().parent
OUT = HERE.parent.parent / "src" / "game" / "mind" / "__fixtures__"

a = argparse.ArgumentParser()
a.add_argument("--lab", required=True)
args = a.parse_args()
sys.path.insert(0, str(Path(args.lab) / "src"))
sys.path.insert(0, str(HERE))
from nics.text.tokenizer import NicsTokenizer  # noqa: E402
from nics.models.text.model import NicsTextConfig, NicsTextModel  # noqa: E402
from nics.training.checkpoint import export_release  # noqa: E402
from pack_release import pack  # noqa: E402
import shutil, tempfile  # noqa: E402

texts = [
    "Welcome to AquaTerra, citizen. The Council of First Light meets in the tower.",
    "Your balance is 640 TIDE. Plots in your name: 2 plots.",
    "Добро пожаловать в город. Земля приносит доход каждый день.",
    "The State Treasury holds 12 345 TIDE; the sales tax is 10%.",
] * 20
tok = NicsTokenizer.train(texts, vocab_size=700)
OUT.mkdir(parents=True, exist_ok=True)
tok.save(OUT / "tokenizer.src.json")
torch.manual_seed(5)
cfg = NicsTextConfig(vocab_size=tok.vocab_size, d_model=48, n_layers=2, n_heads=4, max_seq_len=64, pos_encoding="rope")
model = NicsTextModel(cfg).eval()
with torch.no_grad():  # make the norms non-trivial so the test checks them too
    for n, p in model.named_parameters():
        if "norm" in n:
            p.add_(torch.randn_like(p) * 0.1)
lab = Path(tempfile.mkdtemp()) / "fixture-step-000000"
lab.mkdir(parents=True)
shutil.copyfile(OUT / "tokenizer.src.json", lab / "tokenizer.json")
(lab / "config.yaml").write_text("model_id: fixture\nmodel:\n  vocab_size: 700\n  d_model: 48\n  n_layers: 2\n  n_heads: 4\n  max_seq_len: 64\n  pos_encoding: rope\n")
export_release(lab, model, {"release": lab.name, "model_id": "fixture", "step": 0})
pack(lab, OUT / "release", 1, f32=True)
(OUT / "tokenizer.src.json").unlink()

samples = texts[:4] + ["Mixed: abc_def 12.5%  tabs\tand\nlines — ёж 中文 <|end|>", "   leading spaces", "x"]
prompt = tok.encode(texts[1])
with torch.no_grad():
    logits, _ = model(torch.tensor([prompt]))
    gen = model.generate(torch.tensor([prompt[:6]]), 10, temperature=0)[0].tolist()[6:]
fixture = {
    "encode": [{"text": s, "ids": tok.encode(s)} for s in samples],
    "encode_special": {"text": "<|in|>Hello<|out|>", "ids": tok.encode("<|in|>Hello<|out|>", allow_special=True)},
    "prompt": prompt,
    "last_logits": logits[0, -1].tolist(),
    "first_logits": logits[0, 0].tolist(),
    "greedy": gen,
}
(OUT / "lab-reference.json").write_text(json.dumps(fixture), encoding="utf-8")
print("ok", tok.vocab_size, len(prompt))
