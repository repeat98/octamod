#!/usr/bin/env python3
"""INFLATOR's render gate: the assembled module, run, against the JSFX.

    python3 verify.py            (from anywhere; needs a built vendor tree)

No firmware is read. The module is assembled with dsp_asm and run by
dsp_host as ONE instance from a synthetic memory image: the module at
P:0x2000, a no-op frame-context routine (-ctx 40,41,42), the control words
the stock setup would leave (16-sample blocks, r7 = 0x6200, r6 = 0x506).
Page-1 knobs arrive as value<<16. What this cannot see: the composed image,
the real dispatcher, the panel, placement beside other modules, two cores.

Gates:
  1. ch_one / ch_split are straight-line (no control transfer).
  2. No instruction decodes as mpysu.
  3. Zero in -> exactly zero out, at the dearest settings, both modes.
  4. Peak error against reference.py (JClones_OInflator.jsfx line for line)
     <= 1e-3 over eleven knob settings (defaults, extremes, clip on/off,
     single band and band split) x eight signals, each at -2 dBFS and at
     0.22 FS (a normalized sample at the default AMP VOL 64). The error is
     the module's output's.
  5. EFFECT 0 at 0 dB in and out is a passthrough within 32 LSB (-108
     dBFS) of a 0.22 FS sine. (With INPUT_GAIN the JSFX's 0 dBFS clip sits
     at 1/4 FS here, so a hotter passthrough is clipped, as the JSFX is.)
  6. CLIP ON holds the output at the JSFX's full scale / INPUT_GAIN with
     +12 dB in.
  7. L and R are independent in band split: a stereo render equals two
     mono renders, bit for bit.
  8. The band-split states survive a call boundary: split 7/9 blocks match
     an unsplit render bit for bit.
  9. The level fix: at the unit's working level, EFFECT 127 gives the
     JSFX's THD on a normalized 100 Hz sine within 1 dB (it was 24 dB
     short), single band and band split.
"""
import math
import os
import pathlib
import re
import shutil
import struct
import subprocess
import sys
import tempfile

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import reference  # noqa: E402

Q = 1 << 23
ORG = 0x2000
TOL = 1e-3


def _tool(name, sub):
    env = os.environ.get(name.upper())
    if env:
        return pathlib.Path(env)
    for base in [HERE, *HERE.parents]:
        for root in (base, base / "sdk" / "octabam"):
            p = root / "vendor/dsp56300/build/source" / sub
            if p.exists():
                return p
    sys.exit(f"[FAIL] {sub} not found: build the vendor tree (sdk/octabam: "
             f"scripts/vendor.sh dsp56300, then cmake) or set {name.upper()}")


DSP_ASM = _tool("dsp_asm", "dsp_host/dsp_asm")
DSP_HOST = _tool("dsp_host", "dsp_host/dsp_host")
DISASM = _tool("dsp_disasm", "disassemble/dsp56kDisassemble")

failures = []


def gate(name, ok, detail=""):
    print(f"[{'PASS' if ok else 'FAIL'}] {name} {detail}".rstrip(), flush=True)
    if not ok:
        failures.append(name)


def assemble(work):
    blob, sym = work / "inflator.bin", work / "inflator.sym"
    r = subprocess.run([str(DSP_ASM), "-in", str(HERE / "inflator.asm"), "-org", f"{ORG:x}",
                        "-out", str(blob), "-sym", str(sym)], capture_output=True, text=True)
    if r.returncode:
        sys.exit(f"[FAIL] dsp_asm: {r.stdout}{r.stderr}")
    syms = {}
    for line in sym.read_text().splitlines():
        if line.strip():
            k, v = line.split()
            syms[k] = int(v, 16)
    code = blob.read_bytes()
    words = [int.from_bytes(code[i:i + 3], "little") for i in range(0, len(code), 3)]
    return blob, words, syms


def disassemble(blob):
    r = subprocess.run([str(DISASM), "-in", str(blob), "-pc", f"{ORG:x}", "-le"],
                       capture_output=True, text=True)
    out = []
    for line in r.stdout.splitlines():
        m = re.match(r"^([0-9a-f]{6}):\s+(\S+)\s*([^;]*)", line)
        if m:
            out.append((int(m.group(1), 16), m.group(2), m.group(3).strip()))
    return out


def rec(sp, addr, words):
    return struct.pack("<BII", sp, addr, len(words)) + struct.pack(f"<{len(words)}I", *words)


def write_mem(words, path):
    body = rec(0, ORG, words) + rec(0, 0x40, [0, 0, 0, 0])
    x = {0x415: 0x700, 0x416: 0x700, 0x419: 0, 0x208: 0x500, 0x20a: 0x6000,
         0x20c: 0, 0x20d: 16, 0x20e: 0, 0x213: 0x256}
    x.update({0x256 + i: 0x4000 for i in range(16)})
    for a, v in x.items():
        body += rec(1, a, [v])
    path.write_bytes(body + struct.pack("<BII", 0xff, 0, 0))


def run(work, mem, syms, knobs, samples, stereo=False, tag="r", extra=()):
    inp, out = work / f"{tag}.in", work / f"{tag}.out"
    inp.write_bytes(struct.pack(f"<{len(samples)}i", *samples))
    frames = len(samples) // (2 if stereo else 1)
    cmd = [str(DSP_HOST), "-mem", str(mem), "-init", f"{syms['init']:x}",
           "-proc", f"{syms['proc']:x}", "-ctx", "40,41,42", "-frames", "16",
           "-blocks", str((frames + 15) // 16),
           "-params", ",".join(map(str, list(knobs) + [0] * (8 - len(knobs)))),
           "-in", str(inp), "-out", str(out)] + (["-stereo"] if stereo else []) + list(extra)
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=600)
    if r.returncode:
        sys.exit(f"[FAIL] dsp_host exit {r.returncode}:\n{r.stdout[-2000:]}{r.stderr}")
    data = out.read_bytes()
    o = list(struct.unpack(f"<{len(data) // 4}i", data))
    meter = re.search(r"\(([\d.]+)/sample max", r.stdout)
    return o, float(meter.group(1)) if meter else None


def signal(kind, n=4800, amp=None):
    if kind == "noise":
        import random
        rnd = random.Random(3)
        return [round((amp or 0.8) * (Q - 1) * rnd.uniform(-1, 1)) for _ in range(n)]
    if kind == "impulse":
        return [round((amp or 0.9) * Q) if i == 0 else 0 for i in range(n)]
    if kind == "step":
        return [round((amp or 0.5) * Q)] * n
    return [round((amp or 0.8) * (Q - 1) * math.sin(2 * math.pi * kind * i / 44100))
            for i in range(n)]


def thd_db(y, f, sr=44100):
    import numpy as np
    y = np.asarray(y[len(y) // 2:])
    Y = np.abs(np.fft.rfft(y * np.hanning(len(y))))
    def b(k):
        c = int(round(k * f * len(y) / sr))
        return Y[c - 2:c + 3].max()
    return 20 * math.log10(math.sqrt(sum(b(k) ** 2 for k in range(2, 10))) / b(1))


def main():
    work = pathlib.Path(tempfile.mkdtemp(prefix="inflator-verify-"))
    try:
        blob, words, syms = assemble(work)
        mem = work / "inflator.mem"
        write_mem(words, mem)
        dis = disassemble(blob)
        print(f"assembled {len(words)} words; init P:{syms['init']:04x} proc P:{syms['proc']:04x}")

        # 1. straight-line sample-loop callees
        transfer = re.compile(r"^(b|j)(sr|ra|mp|cc|cs|ne|eq|lt|le|gt|ge|pl|mi|clr|set|sclr|sset)?|^do|^rep|^brk")
        for fn, end in (("ch_one", "ch_split"), ("ch_split", "fit_in")):
            body = [d for d in dis if syms[fn] <= d[0] < syms[end]]
            bad = [f"{a:04x} {m}" for a, m, _ in body[:-1] if transfer.match(m) or m == "rts"]
            gate(f"{fn} is straight-line, one rts", not bad and body and body[-1][1] == "rts",
                 ", ".join(bad))

        # 2. mpysu census
        su = [(hex(a), ops) for a, m, ops in dis if m == "mpysu"]
        gate("no mpysu anywhere", not su, str(su))

        # 3. silence
        for split in (0, 1):
            o, _ = run(work, mem, syms, [127, 127, 0, 0, split, 127], [0] * 1600, tag="silence")
            gate(f"SPLIT {split}, dearest settings: zero in, zero out", not any(o))

        # 4. against the JSFX
        grid = [(42, 0, 64, 1, 0, 127), (42, 127, 64, 1, 0, 127), (127, 127, 0, 1, 0, 127),
                (127, 127, 127, 0, 0, 127), (0, 64, 64, 1, 0, 0), (90, 100, 30, 0, 0, 60),
                (42, 127, 64, 1, 1, 127), (127, 127, 0, 0, 1, 127), (127, 127, 127, 0, 1, 0),
                (60, 80, 100, 1, 1, 100), (0, 0, 64, 1, 1, 127)]
        worst, where, ipc = 0.0, None, {0: 0.0, 1: 0.0}
        for knobs in grid:
            for kind in ("impulse", "step", 50, 240, 1000, 2400, 8000, "noise"):
                for amp in (None, 0.22):
                    x = signal(kind, amp=amp)
                    o, m = run(work, mem, syms, list(knobs), x, tag="grid")
                    ipc[knobs[4]] = max(ipc[knobs[4]], m or 0)
                    ref = reference.render(knobs, [v / Q for v in x])
                    e = max(abs(a / Q - b) for a, b in zip(o[0::2], ref))
                    if e > worst:
                        worst, where = e, (knobs, kind, amp or "hot")
        gate(f"peak error vs the JSFX <= {TOL}", worst <= TOL,
             f"worst {worst:.2e} at INPUT/EFFCT/CURVE/CLIP/SPLIT/OUT, signal, level {where}")
        print(f"       meter: {ipc[0]:.1f} (single band) / {ipc[1]:.1f} (band split) instructions/sample")

        # 5. EFFECT 0 passthrough
        x = signal(1000, 1600, amp=0.22)
        o, _ = run(work, mem, syms, [42, 0, 64, 1, 0, 127], x, tag="dry")
        e = max(abs(a - b) for a, b in zip(o[0::2], x))
        gate("EFFECT 0, 0 dB in and out, 0.22 FS: passthrough within 32 LSB (-108 dBFS)", e <= 32,
             f"max deviation {e} LSB ({20 * math.log10(max(e, 1) / Q):.0f} dBFS)")

        # 6. CLIP ON at +12 dB
        o, _ = run(work, mem, syms, [127, 127, 64, 1, 0, 127], signal(220, 1600), tag="clip")
        peak = max(abs(v) for v in o) / Q
        gate("CLIP ON, +12 dB in: output within the JSFX's full scale / INPUT_GAIN",
             peak <= 1 / reference.INPUT_GAIN + 1e-3, f"peak {peak:.4f}")

        # 7. stereo independence (band split)
        left, right = signal(220, 1600), signal(4000, 1600)
        st, _ = run(work, mem, syms, [60, 100, 40, 1, 1, 110],
                    [v for pair in zip(left, right) for v in pair], stereo=True, tag="st")
        ml, _ = run(work, mem, syms, [60, 100, 40, 1, 1, 110], left, tag="ml")
        mr, _ = run(work, mem, syms, [60, 100, 40, 1, 1, 110], right, tag="mr")
        gate("band split: stereo render == two mono renders, bit for bit",
             st[0::2] == ml[0::2] and st[1::2] == mr[1::2])

        # 8. states across a call boundary
        x = signal("noise", 1600)
        whole, _ = run(work, mem, syms, [60, 100, 40, 1, 1, 110], x, tag="whole")
        split, _ = run(work, mem, syms, [60, 100, 40, 1, 1, 110], x, tag="split", extra=["-split", "7"])
        gate("band split: split 7/9 blocks == unsplit render, bit for bit", whole == split)

        # 9. the level fix: unit level vs the JSFX at DAW level
        daw = [0.89 * math.sin(2 * math.pi * 100 * i / 44100) for i in range(22050)]
        unit = [round(v * 0.254 * (Q - 1)) for v in daw]
        for split in (0, 1):
            knobs = (42, 127, 64, 1, split, 127)
            o, _ = run(work, mem, syms, list(knobs), unit, tag="thd")
            t_mod = thd_db([v / Q for v in o[0::2]], 100)
            t_jsfx = thd_db(reference.render_jsfx(knobs, daw), 100)
            gate(f"EFFECT 127, SPLIT {split}, at AMP VOL 64: the JSFX's THD at 0 dBFS",
                 abs(t_mod - t_jsfx) <= 1.0, f"module {t_mod:.1f} dB, JSFX {t_jsfx:.1f} dB")
    finally:
        shutil.rmtree(work, ignore_errors=True)

    if failures:
        sys.exit(f"[FAIL] {len(failures)} INFLATOR gate(s): {', '.join(failures)}")
    print("all INFLATOR gates passed")


if __name__ == "__main__":
    main()
