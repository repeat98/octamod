#!/usr/bin/env python3
"""FATTENER's render gate: the assembled module, run, against the JSFX.

    python3 verify.py            (from anywhere; needs a built vendor tree)

No firmware is read. The module is assembled with dsp_asm and run by
dsp_host as ONE instance from a synthetic memory image: the module at
P:0x2000, a no-op frame-context routine (-ctx 40,41,42), the control words
the stock setup would leave (16-sample blocks, r7 = 0x6200, r6 = 0x506).
Page-1 knobs arrive as value<<16. What this cannot see: the composed image,
the real dispatcher, the panel, placement beside other modules, two cores.

The module's P table (manifest.py's PTABLE, which build_bus.py places and
points the source's one $fab1e0 at) is put right after the code here.

The module computes reference.render_model(): the JSFX with one highpass
for its two, the EQ interpolated between 17 designs and the compressor's
gain ramped per 16-sample block (reference.py says why and by how much).
The exactness gates compare against that model; gate 9 compares the sound
with the JSFX itself.

Gates:
  1. fattener.asm and manifest.py's PTABLE are what gen_asm.py writes.
  2. `frame`, the per-sample callee, is straight-line with one rts.
  3. No instruction decodes as mpysu.
  4. Zero in -> exactly zero out, at the dearest settings, and from an
     instance block pre-filled with garbage (four fill words, two knob
     settings): init leaves nothing for the module to read that it did not
     write. (The SDK's verify_dirtystate.py needs a SEND module that the
     static-stock test remix does not carry; this is its test, here.)
  5. No whine: after a loud burst the output is exactly zero again within
     one second of silence, at FAT 127 and GAIN 127 (63 dB of gain on the
     filters' rounding), at three COLORs. The filters' rounding error is fed
     back (second order), so the 20 and 30 Hz highpasses decay to zero
     instead of holding a limit cycle.
  6. Peak error against reference.render_model() over ten knob settings x
     nine signals, each at -2 dBFS and at 0.22 FS (a normalized sample at
     the default AMP VOL 64). The tolerance is 2.5e-3 (at COLOR near 10 the
     EQ's poles sit close to z = 1 and its 24-bit words move its response by
     up to 0.13 dB around 40-50 Hz), or 5 LSB of the filter
     chain (which runs at x/8) times the module's total gain where that is
     larger: GAIN and FAT's makeup together reach +63 dB, and the filters'
     last bit is amplified with everything else.
  7. Stereo link: L loud and R quiet follow the model's shared envelope
     within the same tolerance; R silent stays exactly silent beside a
     loud L.
  8. A call boundary inside a block (a trigger: split 7/9) keeps every
     state and starts a new gain ramp there, as the model does: within the
     same tolerance of render_model(split=7).
  9. The sound against the JSFX itself, at the unit's working level (AMP
     VOL 64): THD of a normalized 100 Hz sine within 1 dB of the JSFX's at
     0 dBFS, and the output level of a sine, a kick and noise within 0.5 dB
     of the JSFX's, at five settings.
 10. Cost: every knob moving every block (COLOR's precompute each time)
     stays within 215 executed instructions a sample, block overhead
     included (the first build, OCTABAM10: 352).
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
TOL = 2.5e-3                # the EQ's 24-bit words near its 40 Hz poles: 0.13 dB
FILTER_LSB = 8 / Q          # the chain runs at x/8, in module input units
COST = 215


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


def assemble(work, src):
    blob, sym = work / "fattener.bin", work / "fattener.sym"
    if isinstance(src, str):
        (work / "src.asm").write_text(src)
        src = work / "src.asm"
    r = subprocess.run([str(DSP_ASM), "-in", str(src), "-org", f"{ORG:x}",
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


def ptable():
    """manifest.py's PTABLE, read without importing the SDK's schema."""
    src = (HERE / "manifest.py").read_text()
    i = src.index("PTABLE = (")
    ns = {}
    exec(src[i:src.index(")", i) + 1], ns)
    return list(ns["PTABLE"])


def build(work):
    """Assemble with the P table right after the code, as one image."""
    src = (HERE / "fattener.asm").read_text()
    if src.count("$fab1e0") != 1:
        sys.exit("[FAIL] fattener.asm must carry exactly one $fab1e0 (the P table's address)")
    _, words, _ = assemble(work, src)
    patched = work / "patched.asm"
    patched.write_text(src.replace("$fab1e0", f"${ORG + len(words):06x}"))
    blob, words, syms = assemble(work, patched)
    return blob, words, syms


def write_mem(words, path, fill=None):
    body = rec(0, ORG, words) + rec(0, 0x40, [0, 0, 0, 0])
    if fill is not None:                     # the unit's RAM is not zeroed
        body += rec(1, 0x6200, [fill] * 0x100)
    x = {0x415: 0x700, 0x416: 0x700, 0x419: 0, 0x208: 0x500, 0x20a: 0x6000,
         0x20c: 0, 0x20d: 16, 0x20e: 0, 0x213: 0x256}
    x.update({0x256 + i: 0x4000 for i in range(16)})
    for a, v in x.items():
        body += rec(1, a, [v])
    path.write_bytes(body + struct.pack("<BII", 0xff, 0, 0))


def run(work, mem, syms, knobs, left, right=None, tag="r", extra=()):
    """Stereo render: (left, right) out, as integers; run.meter is the
    worst block's executed instructions per sample."""
    right = left if right is None else right
    samples = [v for pair in zip(left, right) for v in pair]
    inp, out = work / f"{tag}.in", work / f"{tag}.out"
    inp.write_bytes(struct.pack(f"<{len(samples)}i", *samples))
    cmd = [str(DSP_HOST), "-mem", str(mem), "-init", f"{syms['init']:x}",
           "-proc", f"{syms['proc']:x}", "-ctx", "40,41,42", "-frames", "16",
           "-blocks", str((len(left) + 15) // 16), "-stereo",
           "-params", ",".join(map(str, list(knobs) + [0] * (8 - len(knobs)))),
           "-in", str(inp), "-out", str(out)] + list(extra)
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=600)
    if r.returncode:
        sys.exit(f"[FAIL] dsp_host exit {r.returncode}:\n{r.stdout[-2000:]}{r.stderr}")
    data = out.read_bytes()
    o = list(struct.unpack(f"<{len(data) // 4}i", data))
    meter = re.search(r"\(([\d.]+)/sample max", r.stdout)
    run.meter = float(meter.group(1)) if meter else None
    return o[0::2], o[1::2]


def signal(kind, n=4800, amp=0.8):
    if kind == "noise":
        import random
        rnd = random.Random(3)
        return [round(amp * (Q - 1) * rnd.uniform(-1, 1)) for _ in range(n)]
    if kind == "impulse":
        return [round(amp * Q) if i == 0 else 0 for i in range(n)]
    if kind == "step":
        return [round(amp * Q)] * n
    if kind == "burst":
        return [round(amp * (Q - 1) * math.sin(2 * math.pi * 1000 * i / 44100)
                      * (1 if (i // 1200) % 2 == 0 else 0.02)) for i in range(n)]
    return [round(amp * (Q - 1) * math.sin(2 * math.pi * kind * i / 44100)) for i in range(n)]


def tolerance(knobs):
    fat, _, gain = knobs
    g = 10 ** (((gain - 64) * 0.375 + 39 * fat / 127 + 1) / 20)
    return max(TOL, 5 * FILTER_LSB * g)


def thd_db(y, f, sr=44100):
    import numpy as np
    y = np.asarray(y[len(y) // 2:])
    Y = np.abs(np.fft.rfft(y * np.hanning(len(y))))

    def b(k):
        c = int(round(k * f * len(y) / sr))
        return Y[c - 2:c + 3].max()
    return 20 * math.log10(math.sqrt(sum(b(k) ** 2 for k in range(2, 10))) / b(1))


def main():
    work = pathlib.Path(tempfile.mkdtemp(prefix="fattener-verify-"))
    try:
        # 1. the generated source is current
        gen, man = work / "gen.asm", work / "manifest.py"
        shutil.copy(HERE / "manifest.py", man)
        env = dict(os.environ, FAT_OUT=str(gen), FAT_MANIFEST=str(man))
        for k in ("FAT_EQEF",):
            env.pop(k, None)
        r = subprocess.run([sys.executable, str(HERE / "gen_asm.py")], env=env,
                           capture_output=True, text=True)
        gate("fattener.asm and the manifest's PTABLE are gen_asm.py's output", r.returncode == 0
             and gen.read_text() == (HERE / "fattener.asm").read_text()
             and man.read_text() == (HERE / "manifest.py").read_text(), r.stderr.strip()[-300:])

        blob, words, syms = build(work)
        table = ptable()
        mem = work / "fattener.mem"
        write_mem(words + table, mem)
        dis = disassemble(blob)
        print(f"assembled {len(words)} words of code + {len(table)} of P table; init P:{syms['init']:04x}"
              f" proc P:{syms['proc']:04x}, frame {syms['color'] - syms['frame']} words")

        # 2. straight-line per-sample callee
        transfer = re.compile(r"^(b|j)(sr|ra|mp|cc|cs|ne|eq|lt|le|gt|ge|pl|mi|clr|set|sclr|sset)?|^do|^rep|^brk")
        body = [d for d in dis if syms["frame"] <= d[0] < syms["color"]]
        bad = [f"{a:04x} {m}" for a, m, _ in body[:-1] if transfer.match(m) or m == "rts"]
        gate("frame is straight-line, one rts", not bad and body and body[-1][1] == "rts",
             ", ".join(bad))

        # 3. mpysu census
        su = [(hex(a), ops) for a, m, ops in dis if m == "mpysu"]
        gate("no mpysu anywhere", not su, str(su))

        # 4. silence
        for knobs in ((127, 0, 127), (127, 127, 127)):
            o = run(work, mem, syms, knobs, [0] * 1600, tag="silence")
            gate(f"FAT/COLOR/GAIN {knobs}: zero in, zero out", not any(o[0]) and not any(o[1]))

        dirty = work / "dirty.mem"
        for fill in (0x7fffff, 0x800000, 0x400000, 0x5a5a5a):
            write_mem(words + table, dirty, fill)
            for knobs in ((0, 0, 64), (127, 90, 127)):
                o = run(work, dirty, syms, knobs, [0] * 1500, tag="dirty")
                gate(f"garbage block ${fill:06x}, FAT/COLOR/GAIN {knobs}: zero in, zero out",
                     not any(o[0]) and not any(o[1]))

        # 5. no whine after a burst
        n_b = 4410
        burst = signal(60, n_b, 0.9) + [0] * 44100
        for color in (0, 64, 127):
            knobs = (127, color, 127)
            o = run(work, mem, syms, knobs, burst, tag="decay")
            tail = o[0][n_b + 39690:] + o[1][n_b + 39690:]
            last = max((i for i, v in enumerate(o[0]) if v), default=0)
            gate(f"FAT/COLOR/GAIN {knobs}: exactly zero 0.9 s into silence after a 60 Hz burst",
                 not any(tail), f"(last non-zero output {(last - n_b) / 44.1:.0f} ms after the burst)")

        # 6. against the JSFX
        grid = [(0, 0, 64), (127, 0, 64), (64, 64, 64), (127, 127, 64), (127, 126, 64),
                (0, 64, 0), (64, 100, 127), (127, 30, 127), (20, 10, 32), (100, 127, 96)]
        worst, where, plain = 0.0, None, 0.0
        for knobs in grid:
            tol = tolerance(knobs)
            for kind in ("impulse", "step", 50, 220, 1000, 4000, 12000, "noise", "burst"):
                for amp in (0.8, 0.22):
                    x = signal(kind, amp=amp)
                    o = run(work, mem, syms, knobs, x, tag="grid")
                    ref, _ = reference.render_model(knobs, [v / Q for v in x])
                    e = max(abs(a / Q - b) for a, b in zip(o[0], ref))
                    if tol == TOL:
                        plain = max(plain, e)
                    if e / tol > worst:
                        worst, where = e / tol, (knobs, kind, amp, e, tol)
        gate("peak error vs the model within tolerance", worst <= 1.0,
             f"worst {where[3]:.2e} (tolerance {where[4]:.2e}) at FAT/COLOR/GAIN {where[0]},"
             f" signal {where[1]}, level {where[2]}; {plain:.2e} where the tolerance is {TOL}")

        # 7. stereo link
        knobs = (100, 60, 80)
        left, right = signal(220, amp=0.8), signal(3000, amp=0.05)
        o = run(work, mem, syms, knobs, left, right, tag="link")
        rl, rr = reference.render_model(knobs, [v / Q for v in left], [v / Q for v in right])
        e = max(max(abs(a / Q - b) for a, b in zip(o[0], rl)),
                max(abs(a / Q - b) for a, b in zip(o[1], rr)))
        gate("stereo link: L loud, R quiet, both follow the model's shared envelope",
             e <= tolerance(knobs), f"max error {e:.2e}")
        o = run(work, mem, syms, knobs, left, [0] * len(left), tag="link0")
        gate("stereo link: R silent stays exactly silent beside a loud L", not any(o[1]))

        # 8. states across a call boundary
        x = signal("noise", 1600)
        split = run(work, mem, syms, (100, 60, 80), x, tag="split", extra=["-split", "7"])
        ref, _ = reference.render_model((100, 60, 80), [v / Q for v in x], split=7)
        e = max(abs(a / Q - b) for a, b in zip(split[0], ref))
        gate("split 7/9 blocks follow the model's per-call ramp", e <= tolerance((100, 60, 80)),
             f"max error {e:.2e}")

        # 9. the sound against the JSFX itself, at the unit's level
        daw = [0.89 * math.sin(2 * math.pi * 100 * i / 44100) for i in range(22050)]
        unit = [round(v * 0.254 * (Q - 1)) for v in daw]
        for knobs in ((64, 0, 64), (127, 64, 64)):
            o = run(work, mem, syms, knobs, unit, tag="thd")
            t_mod = thd_db([v / Q for v in o[0]], 100)
            t_jsfx = thd_db(reference.render_jsfx(knobs, daw)[0], 100)
            gate(f"FAT/COLOR/GAIN {knobs} at AMP VOL 64: the JSFX's THD at 0 dBFS",
                 abs(t_mod - t_jsfx) <= 1.0, f"module {t_mod:.1f} dB, JSFX {t_jsfx:.1f} dB")
        import random
        rnd = random.Random(5)
        sigs = {"sine 100 Hz": [0.89 * 0.254 * math.sin(2 * math.pi * 100 * i / 44100) for i in range(22050)],
                "kick": [0.254 * math.exp(-(i % 11025) / 2500) * math.sin(
                    2 * math.pi * 60 * (i % 11025) / 44100 * (1 + 2 * math.exp(-(i % 11025) / 300)))
                    for i in range(22050)],
                "noise": [0.2 * rnd.gauss(0, 1) for _ in range(22050)]}
        worst_db, where = 0.0, None
        for knobs in ((0, 0, 64), (64, 0, 64), (127, 64, 64), (100, 30, 100), (30, 90, 40)):
            for name, x in sigs.items():
                o = run(work, mem, syms, knobs, [round(max(-1, min(1, v)) * (Q - 1)) for v in x], tag="lvl")
                j = reference.render(knobs, x)[0]
                rm = math.sqrt(sum((v / Q) ** 2 for v in o[0][4410:]) / (len(x) - 4410))
                rj = math.sqrt(sum(v ** 2 for v in j[4410:]) / (len(x) - 4410))
                d = 20 * math.log10(rm / rj)
                if abs(d) > abs(worst_db):
                    worst_db, where = d, (knobs, name)
        gate("output level within 0.5 dB of the JSFX's (sine, kick, noise; five settings)",
             abs(worst_db) <= 0.5, f"worst {worst_db:+.2f} dB at FAT/COLOR/GAIN {where[0]}, {where[1]}")

        # 10. cost with every knob moving every block
        pf = work / "params.txt"
        pf.write_text("\n".join(f"{b},{(b * 37) % 128},{(b * 53) % 128},{(b * 11) % 128},0,0,0,0,0"
                                for b in range(256)))
        run(work, mem, syms, (64, 64, 64), signal("noise", 4096, 0.9), tag="cost",
            extra=["-paramfile", str(pf)])
        gate(f"every knob moving every block: <= {COST} instructions/sample",
             run.meter is not None and run.meter <= COST, f"{run.meter:.1f} in the worst block")
    finally:
        shutil.rmtree(work, ignore_errors=True)

    if failures:
        sys.exit(f"[FAIL] {len(failures)} FATTENER gate(s): {', '.join(failures)}")
    print("all FATTENER gates passed")


if __name__ == "__main__":
    main()
