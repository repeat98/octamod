"""Float reference for IRONOXIDE5: Airwindows IronOxide5Proc.cpp (MIT,
Copyright (c) 2016 airwindows) line for line at Flutter D = 0 and Noise
E = 0, 44.1 kHz, plus the knob mapping ironoxide5.asm uses.

Omitted because they change nothing at D = E = 0 or below a 24-bit LSB:
the flutter stage (at D = 0 it returns the input), the noise stage (at
E = 0 randy is 0), the 32-tap slow filter (dead in the shipped source:
gcount is never decremented, so every tap reads an unwritten slot and the
slow state stays 0), the denormal fix and the floating-point dither.
"""
import math

HALF_PI = 1.57079633

# The unit applies AMP VOL as (v/127)^2 before the FX chain: at the default
# VOL 64 a 0 dBFS sample arrives at 0.254 FS. The module runs the plugin at
# x * INPUT_GAIN and divides its output by INPUT_GAIN, so a sample at the
# default VOL saturates as the same sample does in the plugin in a DAW.
INPUT_GAIN = 4.0


def _sat(x):
    b = math.sin(min(abs(x), HALF_PI))
    return b if x > 0.0 else -b


class IronOxide5:
    def __init__(self, A, B, C, F, G, sr=44100.0):
        o = sr / 44100.0
        self.inputgain = 10 ** (((A * 36.0) - 18.0) / 20.0)
        self.outputgain = 10 ** (((F * 36.0) - 18.0) / 20.0)
        ips = (((B * B) * (B * B) * 148.5) + 1.5) * 1.1
        if ips < 1 or ips > 200:
            ips = 33.0
        lps = (((C * C) * (C * C) * 148.5) + 1.5) * 1.1
        if lps < 1 or lps > 200:
            lps = 33.0
        self.iir = lps / 430.0 / o
        self.fast_taper = 1.0 + (ips / 15.0) / o
        self.lowspeedscale = (5.0 / ips) * o
        self.invdrywet = G * 2.0 - 1.0
        self.dry = 1.0 - self.invdrywet if self.invdrywet > 0 else 1.0
        self.iir_a = [0.0, 0.0]
        self.iir_b = [0.0, 0.0]
        self.fast_a = [0.0, 0.0]
        self.fast_b = [0.0, 0.0]
        self.flip = False

    def _channel(self, c, x):
        dry = x
        if self.flip:
            self.iir_a[c] = self.iir_a[c] * (1 - self.iir) + x * self.iir
            x -= self.iir_a[c]
        else:
            self.iir_b[c] = self.iir_b[c] * (1 - self.iir) + x * self.iir
            x -= self.iir_b[c]
        x = _sat(x * self.inputgain)
        if self.flip:
            self.fast_a[c] = self.fast_a[c] / self.fast_taper + x
            y = self.fast_a[c]
        else:
            self.fast_b[c] = self.fast_b[c] / self.fast_taper + x
            y = self.fast_b[c]
        y = _sat(y / self.fast_taper / self.lowspeedscale)
        return y * self.outputgain * self.invdrywet + dry * self.dry

    def process(self, left, right):
        out = (self._channel(0, left), self._channel(1, right))
        self.flip = not self.flip
        return out


def from_knobs(inp, high, low, out, mix):
    """The panel's mapping: A, B, C, F = knob/128. MIX is a plain dry/wet over
    the upper half of the plugin's inv/dry/wet knob: G = 0.5 + MIX/254, so
    MIX 0 is dry (G = 0.5) and MIX 127 fully wet (G = 1)."""
    return IronOxide5(inp / 128.0, high / 128.0, low / 128.0, out / 128.0, 0.5 + mix / 254.0)


def render_plugin(knobs, xs):
    """The plugin alone at the panel's knob mapping (no INPUT_GAIN), mono in,
    left out, unlimited."""
    io = from_knobs(*knobs)
    return [io.process(v, v)[0] for v in xs]


def render(knobs, xs):
    """What the module renders: plugin(INPUT_GAIN * x) / INPUT_GAIN, mono in,
    left out, limited to +-1 as the DSP's output store is."""
    io = from_knobs(*knobs)
    g = INPUT_GAIN
    return [max(-1.0, min(1.0, io.process(v * g, v * g)[0] / g)) for v in xs]
