"""Constants for inflator.asm: the INPUT/OUTPUT knob fits (four degree-5
segments each) and the band-split coefficients of JClones_OInflator.jsfx
(MIT), rescaled for the x/2 state scale. gen_asm.py writes the source."""
import math
import numpy as np
SR = 44100.0
Q = 1 << 23

def qhex(v):
    w = round(v * Q)
    assert -Q <= w < Q, v
    return w & 0xFFFFFF

def input_gain_q(t):   # INPUT knob t = raw/128 -> input_gain/8, dB = -6 + raw/7
    raw = t * 128      # (0 dB at 42, +12.14 dB at 127)
    return 10 ** ((-6.0 + raw / 7.0) / 20) / 8

def output_gain(t):    # OUTPUT knob -> output_gain, dB = -12 + 12*raw/127
    raw = t * 128
    return 10 ** ((-12.0 + 12.0 * raw / 127.0) / 20)

def segfit(f, deg=5):
    segs = []
    worst = 0
    for s in range(4):
        u = np.linspace(0, 1, 400)
        t = s / 4 + u / 4
        y = np.array([f(v) for v in t])
        c = np.polyfit(u, y, deg)[::-1]
        err = np.abs(np.polyval(c[::-1], u) - y).max()
        worst = max(worst, err)
        segs.append([float(v) for v in c])
    return segs, worst

def lpf(f):
    t = math.tan(f * math.pi); a = 0.5 / (t + 1.0); return a * t, a * t, (1.0 - t) * a
def hpf(f):
    t = math.tan(f * math.pi); a = 0.125 / (t + 1.0); return a, -a, (1.0 - t) * 0.5 / (t + 1.0)

def band_constants():
    k0h, k1h, k2h = hpf(2400 / SR)
    k0m, k1m, k2m = lpf(2400 / SR)
    k0mh, k1mh, k2mh = hpf(240 / SR)
    k0l, k1l, k2l = lpf(240 / SR)
    mid_gain = 1.0 - math.tan(240 * math.pi / SR) / math.tan(2400 * math.pi / SR)
    return dict(K0H=k0h, K1H=k1h, K2H2=2 * k2h,
                K0M=k0m, K1M=k1m, K2M2=2 * k2m,
                K0MH4=4 * k0mh, K1MH4=4 * k1mh, K2MH2=2 * k2mh,
                K0L2=k0l / 2, K1L2=k1l / 2, K2L2=2 * k2l,
                MIDG=mid_gain)

if __name__ == "__main__":
    for name, f in (("INPUT_GAIN/8", input_gain_q), ("OUTPUT_GAIN", output_gain)):
        segs, err = segfit(f)
        print(f"{name}: max fit error {err:.2e}")
        for s, c in enumerate(segs):
            print("  seg", s, " ".join(f"{qhex(v):06X}" for v in c), " ", " ".join(f"{v:+.5f}" for v in c))
    for k, v in band_constants().items():
        print(f"  {k:6s} {v:+.8f}  ${qhex(v):06X}")
