#!/usr/bin/env python3
"""IronOxide5 against stock SPRING REV: executed DSP instructions and memory.

    cd sdk/octabam && REMIX=<remix carrying IRONOXIDE5> python3 ../drafts/ironoxide5/benchmark.py

Needs your own local 1.40C extraction (out/raw/section_3_MAIN_OS.bin) and a
built image at out/mainos_bus.bin that carries IRONOXIDE5; nothing here leaves
your machine. It uses tools/harness/benchmark_reverbs.py's runner unchanged,
so both effects are measured the way Mini Verb was against the stock
reverbs: both cores booted from their real payloads, four FX2 slots per
core at the real r7 stride, 16-sample blocks, every active control moving
every block in the modulated cases, and all 16 trigger-split positions.

Reports executed instructions per core per 16-sample block. These are NOT
hardware cycles or CPU utilisation: the meter excludes the dispatcher,
ColdFire work, DMA and memory stalls.
"""
import hashlib
import json
import os
import pathlib
import sys

ROOT = pathlib.Path.cwd()
sys.path.insert(0, str(ROOT / "tools"))
sys.path.insert(0, str(ROOT / "tools/harness"))
import toolpath  # noqa: E402,F401
import benchmark_reverbs as B  # noqa: E402
import send_probe  # noqa: E402
from remix import registry, stock  # noqa: E402

B.OUT = ROOT / "out/ironoxide5_bench"
BLOCKS = int(os.environ.get("BLOCKS", "2048"))


def main():
    B.OUT.mkdir(parents=True, exist_ok=True)
    built = ROOT / "out/mainos_bus.bin"
    images = {"SPRING REV": stock.STOCK_IMAGE, "IRONOXIDE5": built}
    mems = {k: [send_probe.dump_mem(v, B.OUT / f"{k.replace(' ', '_')}_{p}.mem", p) for p in "AB"]
            for k, v in images.items()}
    inputs = [B.source(BLOCKS, k) for k in range(8)]
    results = []
    for key in ("SPRING REV", "IRONOXIDE5"):
        mod = registry.by_key(key)
        for tag, n, auto, splits in [("one_fixed", 1, False, None), ("eight_fixed", 8, False, None),
                                      ("eight_modulated", 8, True, None),
                                      ("eight_mod_split1", 8, True, [1] * 8),
                                      ("eight_mod_split15", 8, True, [15] * 8)]:
            row, _ = B.run(mod, mems[key], tag, BLOCKS, n, auto, splits, inputs=inputs[:n])
            results.append(row)
        for split in range(16):
            row, _ = B.run(mod, mems[key], f"sync_split{split:02}", BLOCKS,
                           automate=True, split=[split] * 8, inputs=inputs, synchronized=True)
            results.append(row)

    def peak(r):
        return max(c["peak_block"] for c in r["cores"])

    def mean(r):
        return max(c["mean_block"] for c in r["cores"])

    summary = {}
    for key in ("SPRING REV", "IRONOXIDE5"):
        rows = [r for r in results if r["effect"] == key]
        one = next(r for r in rows if r["case"] == "one_fixed")
        eight = [r for r in rows if r["instances"] == 8]
        worst = max(eight, key=peak)
        summary[key] = dict(one_instance_mean_per_block=round(mean(one), 1),
                            one_instance_per_sample=round(mean(one) / 16, 1),
                            eight_worst_peak_per_core_block=peak(worst),
                            eight_worst_per_core_sample=round(peak(worst) / 16, 1),
                            worst_case=worst["case"],
                            init_instructions_per_core=max(c["init_instructions"] for c in worst["cores"]))
    report = dict(units="executed DSP instructions (not hardware cycles)", blocks=BLOCKS,
                  stock_sha256=hashlib.sha256(stock.STOCK_IMAGE.read_bytes()).hexdigest(),
                  image_sha256=hashlib.sha256(built.read_bytes()).hexdigest(),
                  summary=summary, results=results)
    (B.OUT / "results.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
