"""Float reference for INFLATOR: JClones_OInflator.jsfx (MIT, Copyright (c)
2026 JClones) line for line at 44.1 kHz, plus the knob mapping inflator.asm
uses. (The `peak` bookkeeping records internal ranges; it does not change
the arithmetic.)"""
import math
SR = 44100.0
# The unit applies AMP VOL as (v/127)^2 before the FX chain: at the default
# VOL 64 a 0 dBFS sample arrives at 0.254 FS. The module runs the JSFX at
# x * INPUT_GAIN and divides its output by INPUT_GAIN, so a sample at the
# default VOL is inflated as the same sample is by the JSFX in a DAW.
INPUT_GAIN = 4.0
def _lpf(f):
    t = math.tan(f * math.pi); a = 0.5 / (t + 1.0); return (a * t, a * t, (1.0 - t) * a)
def _hpf(f):
    t = math.tan(f * math.pi); a = 0.125 / (t + 1.0); return (a, -a, (1.0 - t) * 0.5 / (t + 1.0))
class OInflator:
    def __init__(self, input_db=0.0, effect_pct=0.0, curve=0.0, clip=1, split=0, output_db=0.0, sr=SR):
        self.ig = 10 ** (input_db / 20) * 0.5; self.og = 10 ** (output_db / 20) * 2.0
        self.th = 0.5 if clip else 0.9999999; self.split = split; self.e = effect_pct / 100.0
        cn = curve / 100.0 + 0.5; self.c = 0.5 - cn * 0.5
        self.hh = _hpf(2400 / sr); self.ml = _lpf(2400 / sr); self.mh = _hpf(240 / sr); self.ll = _lpf(240 / sr)
        self.mid_gain = 1.0 - math.tan(240 * math.pi / sr) / math.tan(2400 * math.pi / sr)
        self.s = [0.0, 0.0, 0.0, 0.0]; self.peak = {}
    def shape(self, x):
        gr = abs(x) * 2.0 * self.c + (1.0 - self.c); gr = max(-1.0, min(1.0, gr))
        return (1.0 - abs(gr * x)) * (gr * x) * (self.e * 2.0) + (1.0 - self.e) * x
    def _pk(self, k, v): self.peak[k] = max(self.peak.get(k, 0), abs(v))
    def process(self, x):
        x *= self.ig; x = max(-self.th, min(self.th, x))
        if not self.split:
            y = self.shape(x)
        else:
            k0, k1, k2 = self.hh; high = (k0 * x + self.s[0]) * 2.0; self.s[0] = k1 * x + k2 * high; self._pk('hs', self.s[0]); self._pk('h2', high); high *= 4.0
            k0, k1, k2 = self.ml; hm = (k0 * x + self.s[1]) * 2.0; self.s[1] = k1 * x + k2 * hm; self._pk('ms1', self.s[1]); self._pk('hm', hm); hm *= 2.0
            k0, k1, k2 = self.mh; mid = (k0 * hm + self.s[2]) * 2.0; self.s[2] = hm * k1 + k2 * mid; self._pk('ms2', self.s[2]); self._pk('mid2', mid); mid *= 2.0
            lx = x * 0.5; k0, k1, k2 = self.ll; low = (k0 * lx + self.s[3]) * 2.0; self.s[3] = lx * k1 + k2 * low; self._pk('ls', self.s[3]); self._pk('low2', low); low *= 2.0
            self._pk('high', high); self._pk('mid', mid); self._pk('low', low)
            y = self.shape(low) + self.shape(mid) * self.mid_gain + self.shape(high)
        self._pk('y', y)
        return y * self.og


def from_knobs(inp, effect, curve, clip, split, out):
    """The panel's mapping: INPUT dB = -6 + value/7; EFFECT value/127;
    JSFX curve = (value - 64) * 50/64; OUTPUT dB = -12 + 12*value/127."""
    return OInflator(-6.0 + inp / 7.0, effect / 127.0 * 100.0, (curve - 64) * 50.0 / 64.0,
                     clip, split, -12.0 + 12.0 * out / 127.0)


def render_jsfx(knobs, xs):
    """The JSFX alone at the panel's knob mapping (no INPUT_GAIN), unlimited."""
    io = from_knobs(*knobs)
    return [io.process(v) for v in xs]


def render(knobs, xs):
    """What the module renders: JSFX(INPUT_GAIN * x) / INPUT_GAIN, limited to
    +-1 as the DSP's output store is."""
    io = from_knobs(*knobs)
    g = INPUT_GAIN
    return [max(-1.0, min(1.0, io.process(v * g) / g)) for v in xs]
