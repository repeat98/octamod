"""Float reference for FATTENER: JClones_Fattener.jsfx (MIT, Copyright (c)
2026 JClones; JSFXClones 88a1503d668c378ced4c166e772378272f3b72ea) line for
line at 44.1 kHz, plus the knob mapping fattener.asm uses.

Ground truth for verify.py. The module renders render(): the JSFX run at
INPUT_GAIN times the input and divided by INPUT_GAIN after it, because the
Octatrack applies AMP VOL as (v/127)^2 before the FX chain, so a normalized
sample at the default VOL 64 reaches the effect at 0.254 FS, 12 dB below
what the JSFX sees in a DAW (TapeHead 0.1.2, IronOxide5, Inflator).
"""
import math
SR=44100.0
db=lambda x:10**(x/20)
def hp(fk,Q):
    w=fk*2*math.pi; a=math.sin(w)/(2*Q); c=math.cos(w)
    return [((1+c)/2)/(1+a), -(1+c)/(1+a), ((1+c)/2)/(1+a), -(-2*c)/(1+a), -(1-a)/(1+a)]
def peak(fk,Q,A):
    A=math.sqrt(A); w=fk*2*math.pi; al=math.sin(w)/(2*Q); c=math.cos(w)
    return [(1+al*A)/(1+al/A), -2*c/(1+al/A), (1-al*A)/(1+al/A), -(-2*c)/(1+al/A), -(1-al/A)/(1+al/A)]
def dq(Q,fk):
    C=math.cos(fk*2*math.pi/2); return 1.5*(C+1)*C/(2*C+1)*Q
class BQ:
    def __init__(s,k): s.k=k; s.x1=s.x2=s.y1=s.y2=0.0
    def __call__(s,x):
        a0,a1,a2,b1,b2=s.k; y=x*a0+s.x1*a1+s.x2*a2+s.y1*b1+s.y2*b2
        s.x2,s.x1,s.y2,s.y1=s.x1,x,s.y1,y; return y
class Fattener:
    def __init__(s,fat=0.0,col=0.0,gain_db=0.0):
        s.th=db(-(fat*34+1)); s.og=db(fat*39+1); s.ir=0.1; s.fg=db(-0.1)
        f=min(col**3.219*6680+40, SR*0.5-100)
        s.sat=0.1*col+0.9; s.ig=db(gain_db)
        s.ak=math.exp(-1/(SR*2.69e-3)); s.rk=math.exp(-1/(SR*32.9e-3))
        s.ch=[[BQ(hp(20/SR,math.sqrt(.5))),BQ(hp(30/SR,math.sqrt(.5))),BQ(peak(f/SR,dq(0.71,f/SR),db(col*8)))] for _ in (0,1)]
        s.ls=[0.0,0.0]   # this.level_s: one per channel object, as in the JSFX
    def pre(s,c,x):
        b=s.ch[c]; return b[2](b[1](b[0](x*s.ig)))
    def post(s,c,xp,lv):
        k=s.ak if lv>s.ls[c] else s.rk; s.ls[c]=(1-k)*lv+k*s.ls[c]
        gr=(s.ls[c]/s.th)**(s.ir-1) if s.ls[c]>s.th else 1.0
        y=xp*gr*s.og; t=s.sat
        if abs(y)>t:
            if t<1: m=math.tanh((abs(y)-t)/(1-t))*(1-t)+t; y=m if y>0 else -m
            else: y=t if y>0 else -t
        return y*s.fg
    def process(s,l,r):
        p0,p1=s.pre(0,l),s.pre(1,r); lv=max(abs(p0),abs(p1))
        return s.post(0,p0,lv),s.post(1,p1,lv)


INPUT_GAIN = 4.0


def from_knobs(fat, color, gain):
    """The panel's mapping: FAT and COLOR value/127 (the JSFX's 0..100 %),
    GAIN (value - 64) * 0.375 dB (-24 .. +23.6 dB; 64 is the JSFX's 0 dB)."""
    return Fattener(fat / 127.0, color / 127.0, (gain - 64) * 0.375)


def render_jsfx(knobs, left, right=None):
    """The JSFX alone (no INPUT_GAIN), stereo in, (left, right) out, unlimited."""
    fx = from_knobs(*knobs); right = left if right is None else right
    out = [fx.process(l, r) for l, r in zip(left, right)]
    return [o[0] for o in out], [o[1] for o in out]


def render(knobs, left, right=None):
    """What the module renders: JSFX(INPUT_GAIN * x) / INPUT_GAIN, limited to
    +-1 as the DSP's output store is."""
    fx = from_knobs(*knobs); right = left if right is None else right; g = INPUT_GAIN
    out = [fx.process(l * g, r * g) for l, r in zip(left, right)]
    lim = lambda v: max(-1.0, min(1.0, v / g))
    return [lim(o[0]) for o in out], [lim(o[1]) for o in out]


# ---- the module's own model ---------------------------------------------------
# Since OCTABAM11 the module trades exactness for about half the DSP time:
# the first build (OCTABAM10) overran the unit under p-locks and scene moves.
# Three simplifications, each measured against the JSFX in TESTING.md:
#   * one highpass, 36.5 Hz Q 0.78, for the JSFX's 20 Hz and 30 Hz pair
#     (within 0.5 dB of the pair from 20 Hz up);
#   * the peak EQ's coefficients interpolated linearly in COLOR between 17
#     designs (c = 0, 1/16 .. 1), within 0.17 dB of the exact EQ;
#   * the compressor's gain computed once per 16-sample block from the
#     envelope at the block's start and ramped linearly across the block
#     (the envelope itself still runs every sample).
HP_F, HP_Q = 36.5, 0.78
EQ_SEGMENTS = 16
BLOCK = 16


def eq_design(c):
    f = min(c ** 3.219 * 6680 + 40, SR * 0.5 - 100)
    return peak(f / SR, dq(0.71, f / SR), db(c * 8))


def eq_nodes():
    return [eq_design(k / EQ_SEGMENTS) for k in range(EQ_SEGMENTS + 1)]


def eq_interp(c, nodes=None):
    nodes = nodes or eq_nodes()
    x = c * EQ_SEGMENTS; i = min(int(x), EQ_SEGMENTS - 1); f = x - i
    return tuple(a * (1 - f) + b * f for a, b in zip(nodes[i], nodes[i + 1]))


def render_model(knobs, left, right=None, split=0):
    """What fattener.asm computes, in floating point: JSFX(INPUT_GAIN x) /
    INPUT_GAIN with the three simplifications above, limited to +-1. Blocks
    start at sample 0, every BLOCK samples; the gain starts at 0. With
    split = k each block is processed as two calls, k samples then the
    rest (a trigger inside the block): every call starts a new ramp of
    1/BLOCK steps towards the gain the envelope asks for then."""
    fat, col, gain = knobs
    f, c = fat / 127.0, col / 127.0
    ig = db((gain - 64) * 0.375) * INPUT_GAIN
    right = left if right is None else right
    th, og, t, fg = db(-(f * 34 + 1)), db(f * 39 + 1), 0.1 * c + 0.9, db(-0.1)
    ak, rk = math.exp(-1 / (SR * 2.69e-3)), math.exp(-1 / (SR * 32.9e-3))
    ch = [[BQ(hp(HP_F / SR, HP_Q)), BQ(eq_interp(c))] for _ in (0, 1)]
    ls, g, d, out = 0.0, 0.0, 0.0, ([], [])
    for n, xs in enumerate(zip(left, right)):
        if n % BLOCK == 0 or (split and n % BLOCK == split):
            gr = (ls / th) ** (0.1 - 1) if ls > th else 1.0
            d = (gr * og - g) / BLOCK
        g += d
        p = [ch[i][1](ch[i][0](xs[i] * ig)) for i in (0, 1)]
        lv = max(abs(p[0]), abs(p[1])); k = ak if lv > ls else rk; ls = (1 - k) * lv + k * ls
        for i in (0, 1):
            y = p[i] * g
            if abs(y) > t:
                m = math.tanh((abs(y) - t) / (1 - t)) * (1 - t) + t if t < 1 else t
                y = math.copysign(m, y)
            out[i].append(max(-1.0, min(1.0, y * fg / INPUT_GAIN)))
    return out
