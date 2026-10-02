"""gen_ironoxide5_constants.py -- computes every hex constant ironoxide5.asm
needs, same technique as gen_tapehead_constants.py: print the numbers, don't
hand-type them.

Per-block coefficients are pure functions of a SINGLE knob's fraction
t = raw/128 (raw 0..127). This DSP has no runtime divide, sqrt, or pow, so
rather than compute ips/fastTaper/etc. from first principles every knob
change, the ENTIRE knob-to-coefficient mapping is fit as a polynomial and
just evaluated (same idea as TapeHead's DRIVE16/TRIM_K).

FIRST ATTEMPT (not what shipped): a single degree-5 fit over the WHOLE
t in [0,1] range, same as TapeHead's own DRIVE16/TRIM_K. Measured error was
much worse than TapeHead's (1-4% absolute, vs TapeHead's 1e-4 to 1e-6) for
FASTDECAY, OUTSCALE and TRIMGAIN specifically -- these three combine a
quartic (ips ~ t^4) with a reciprocal or a STEEP exponential (TRIMGAIN spans
a 63x range over the knob, vs TRIM_K's gentler ~11x), which a single
degree-5 polynomial cannot track accurately over the full unit interval
(confirmed not a numerical-conditioning artifact -- re-fit with
numpy.polynomial.Polynomial's better-conditioned basis gave the same error).
IIRAMOUNT needed no fix: it is proportional to t^4 exactly, so an ordinary
degree-5 fit represents it to machine precision.

FIX (what shipped): FASTDECAY, OUTSCALE and TRIMGAIN are each fit as FOUR
separate degree-5 polynomials, one per quarter of the knob range
([0,.25),[.25,.5),[.5,.75),[.75,1]), each over a LOCAL coordinate
u=(t-seg_lo)*4 in [0,1] -- picked with quarter-boundaries specifically
because seg_lo is always a multiple of 0.25, which is exactly representable
in Q1.23 (0.25=$200000, 0.5=$400000, 0.75=$600000) and the *4 rescale is a
plain `asl #2` (no extra multiply-by-reciprocal constant needed). This
brings every fit's worst-case error under 1e-4, in the same range as
TapeHead's own numbers. The tradeoff is a 4-way compare (t against
0.25/0.5/0.75) before staging each affected knob's polynomial input --
fine, since this only runs in the once-per-block precompute section, which
already branches freely (see ironoxide5.asm's own header, and TapeHead's
Color select for precedent).

Segment selection is shared between FASTDECAY and OUTSCALE (both are
functions of the SAME knob, B): the B-segment and its local u are computed
ONCE, then both polynomials are evaluated from that one staged u with two
different coefficient loads. TRIMGAIN is evaluated for TWO different knobs
(A and F, same coefficient tables, independent segment decisions since A
and F are unrelated knobs).

Sin approximation: reused AS-IS from the earlier session's already-verified
fit (sin(t) directly, t = the clamped bridgerectifier magnitude, true range
[0, pi/2]) -- NOT refit in terms of u=t/2, because that reparametrization
turned out to push the leading coefficient to ~2 (sin(2u)'s slope at the
origin is 2, not 1), which needs its own headroom and defeats the point.
Keeping the original sin(t) fit means t itself must be carried at half scale
(shift=1, since pi/2 ~= 1.5708 does not fit an ordinary Q1.23 word) and each
Horner step needs one extra `asl #1` after its `mpy` to undo that shift
before adding the next coefficient -- see ironoxide5.asm's poly6sin routine.
"""

import math
import numpy as np

Q123_SCALE = 0x800000


def q123_hex(x):
    """Floor-truncate x (must satisfy |x| < 1) to a Q1.23 hex word, matching
    q123_trunc(x, 0) in sim_ironoxide5_fixed.py."""
    assert -1.0 <= x < 1.0, f"{x} out of Q1.23 range"
    word = math.floor(x * Q123_SCALE)
    word = max(-Q123_SCALE, min(word, Q123_SCALE - 1))
    return word & 0xFFFFFF


def poly_eval(coeffs, t):
    total = 0.0
    tp = 1.0
    for c in coeffs:
        total += c * tp
        tp *= t
    return total


def ips_of_t(t):
    return (((t ** 2) ** 2) * 148.5 + 1.5) * 1.1


def fastdecay_of_t(t):
    ips = ips_of_t(t)
    return 1.0 / (1.0 + ips / 15.0)


def outscale_of_t(t):
    ips = ips_of_t(t)
    fastTaper = 1.0 + ips / 15.0
    lowspeedscale = 5.0 / ips
    return 1.0 / (fastTaper * lowspeedscale)


def iiramount_of_t(t):
    return ips_of_t(t) / 430.0


def trimgain_of_t(t):
    db = (t * 36.0) - 18.0
    return 10.0 ** (db / 20.0)


def fit_piecewise(name, func, headroom_shift, npieces=4, degree=5):
    """Fit func(t) for t in [0,1] as `npieces` equal-width degree-5
    polynomials in the LOCAL coordinate u=(t-seg_lo)*npieces. Returns a list
    of (seg_lo, coeffs) tuples, seg_lo ascending."""
    print(f"  {name} -- {npieces}-piece degree-{degree} fit, headroom_shift={headroom_shift}")
    results = []
    worst_overall = 0.0
    for seg in range(npieces):
        lo = seg / npieces
        hi = (seg + 1) / npieces
        us = np.linspace(0, 1, 200)
        ts = lo + us * (hi - lo)
        ys = np.array([func(t) for t in ts])
        coeffs_hi = np.polyfit(us, ys, degree)
        coeffs = tuple(float(c) for c in coeffs_hi[::-1])
        dense_u = np.linspace(0, 1, 2000)
        dense_t = lo + dense_u * (hi - lo)
        fitted = np.array([poly_eval(coeffs, u) for u in dense_u])
        exact = np.array([func(t) for t in dense_t])
        err = np.abs(fitted - exact).max()
        worst_overall = max(worst_overall, err)
        scaled = tuple(c / (2 ** headroom_shift) for c in coeffs)
        print(f"    seg{seg} t in [{lo:.2f},{hi:.2f})  max_err={err:.3e}")
        for i, (c, cs) in enumerate(zip(coeffs, scaled)):
            status = "OK" if abs(cs) < 1.0 else "STILL NEEDS MORE HEADROOM"
            hexs = f"  hex={q123_hex(cs):06X}" if abs(cs) < 1.0 else ""
            print(f"      p{i} = {c:+.8f}  (stored {cs:+.8f})  ({status}){hexs}")
        results.append((lo, coeffs))
    print(f"    ==> worst error across all {npieces} segments: {worst_overall:.3e}")
    return results


print("=" * 78)
print("FASTDECAY(t) = 1/(1+ips(t)/15)   -- from B (tape-high/ips knob)")
print("=" * 78)
FASTDECAY_SEGS = fit_piecewise("FASTDECAY", fastdecay_of_t, headroom_shift=0)

print()
print("=" * 78)
print("OUTSCALE(t) = 1/(fastTaper(t)*lowspeedscale(t))   -- from B (SAME")
print("segment/u as FASTDECAY -- both are functions of B)")
print("=" * 78)
OUTSCALE_SEGS = fit_piecewise("OUTSCALE", outscale_of_t, headroom_shift=2)

print()
print("=" * 78)
print("IIRAMOUNT(t) = ips(t)/430   -- from C (tape-low/lps knob). Exactly")
print("degree-4 in t, so a SINGLE degree-5 fit represents it to machine")
print("precision -- no piecewise split needed.")
print("=" * 78)
ts = np.array([r / 128.0 for r in range(128)])
ys = np.array([iiramount_of_t(t) for t in ts])
coeffs_hi = np.polyfit(ts, ys, 5)
IIRAMOUNT_FIT = tuple(float(c) for c in coeffs_hi[::-1])
err = max(abs(poly_eval(IIRAMOUNT_FIT, t) - iiramount_of_t(t)) for t in np.linspace(0, 1, 1024))
print(f"  IIRAMOUNT max_err={err:.3e}  range=[{ys.min():.4f},{ys.max():.4f}]  headroom_shift=0")
for i, c in enumerate(IIRAMOUNT_FIT):
    print(f"    p{i} = {c:+.8f}  hex={q123_hex(c):06X}")

print()
print("=" * 78)
print("TRIMGAIN(t) = 10**(((t*36)-18)/20)   -- from A (input trim) and F")
print("(output trim); SAME coefficient tables used for both knobs)")
print("=" * 78)
TRIMGAIN_SEGS = fit_piecewise("TRIMGAIN", trimgain_of_t, headroom_shift=3)

print()
print("=" * 78)
print("SINPOLY(t) = sin(t), t in [-pi/2, pi/2] -- ODD-ONLY degree-7 fit")
print("(q1*t + q3*t^3 + q5*t^5 + q7*t^7), evaluated Horner-style in t^2.")
print("SUPERSEDES an earlier even+odd degree-5 fit over [0,pi/2] that needed")
print("a separate abs()+resign step (no cheap branchless way to do that on")
print("this chip -- tlt is rejected by the assembler, a real branch inside")
print("a sample-loop bsr callee is what tapehead's own two real `make")
print("check` runs proved unsafe). An ODD polynomial needs no sign step at")
print("all: clamp the SIGNED value symmetrically (tapehead's own y3-clamp")
print("idiom, just with +-pi/2 bounds instead of +-1) and evaluate directly.")
print("Bonus: one degree higher recovers MORE accuracy than the even terms")
print("it replaces (1.57e-6 vs the old fit's 1.9e-5) -- not a tradeoff.")
print("=" * 78)
Q1, Q3, Q5, Q7 = 9.99997482e-01, -1.66651659e-01, 8.30949370e-03, -1.84465479e-04
ts = np.linspace(-math.pi / 2, math.pi / 2, 4000)
def _sinpoly_odd7(t):
    t2 = t * t
    h = Q7
    h = h * t2 + Q5
    h = h * t2 + Q3
    h = h * t2 + Q1
    return h * t
err = max(abs(_sinpoly_odd7(t) - math.sin(t)) for t in ts)
print(f"  max_err={err:.3e} over t in [-pi/2,pi/2]")
for name, c in (("Q1", Q1), ("Q3", Q3), ("Q5", Q5), ("Q7", Q7)):
    print(f"    {name} = {c:+.8f}  hex={q123_hex(c):06X}")
worst_h = 0.0
t2max = max(t * t for t in ts)
for t in ts:
    t2 = t * t
    h = Q7
    h = h * t2 + Q5
    worst_h = max(worst_h, abs(h))
    h = h * t2 + Q3
    worst_h = max(worst_h, abs(h))
    h = h * t2 + Q1
    worst_h = max(worst_h, abs(h))
print(f"  worst |h| over the 3 Horner-in-t^2 steps: {worst_h:.6f} (<1.0, OK "
      f"for shift=0 storage each step)")
print(f"  worst t^2: {t2max:.6f} (>1.0, <4.0 -- t2 stored at shift=2, which "
      f"is exactly the natural output shift of mpy(t@shift1,t@shift1), no "
      f"extra asl needed to produce it)")

print()
print("=" * 78)
print("Exact edge-case constants (the -1.0 trick)")
print("=" * 78)
print("$800000 is the ONLY exact representation of a magnitude-1.0 value in")
print("Q1.23 (two's complement min == -1.0 exactly; +1.0 is NOT")
print("representable, max is 0x7FFFFF = 0.99999988). Used to compute")
print("invdrywet = 2*t_G - 1 EXACTLY (ADD the -1.0 word instead of")
print("subtracting a nonexistent +1.0 word), and dry = 1-invdrywet EXACTLY")
print("via negate-after-add-(-1.0) when invdrywet>0.")
print(f"  NEG_ONE  = -1.0 exact,  hex=800000")
print(f"  HALF     = 0.5 exact,   hex={q123_hex(0.5):06X}")
print(f"  QUARTER  = 0.25 exact,  hex={q123_hex(0.25):06X}")
print(f"  THREEQ   = 0.75 exact,  hex={q123_hex(0.75):06X}")
print(f"  Q123_MAX (dry~=1.0 stand-in when invdrywet<=0), hex=7FFFFF")
print(f"  PI_2     = 1.57079633 true, stored at shift=1 (true/2), "
      f"hex={q123_hex(1.57079633/2):06X}")
print()
print("=" * 78)
print("PI_2 at the two OTHER shifts the per-sample chain's bridgerectifier")
print("clamp needs (chosen to match the NATURAL shift of each mpy product,")
print("per ironoxide5.asm's 'stay at shift4/shift6 for the clamp, only drop")
print("to shift1 right before the sin poly' plan -- see its own header):")
print("=" * 78)
PI_2 = 1.57079633
print(f"  PI_2_AT_SHIFT4 (x1(shift1)*inputgain(shift3) -> natural shift4) "
      f"= {PI_2/16:.8f}  hex={q123_hex(PI_2/16):06X}")
print(f"  PI_2_AT_SHIFT6 (fastnew(shift4)*outscale(shift2) -> natural shift6) "
      f"= {PI_2/64:.8f}  hex={q123_hex(PI_2/64):06X}")


# ---------------------------------------------------------------------------
# Octamod (2 Oct 2026): the saturators' sine. A degree-5 odd minimax fit of
# sin(t) on [0, pi/2] (Lawson iteration) replaces the degree-7 series above:
# one multiply fewer per saturator, max error 6.8e-5. ironoxide5.asm uses
# c1, c3, c5 as printed here.
def sine_minimax_deg5():
    t = np.linspace(0, math.pi / 2, 4001)
    basis = np.stack([t, t ** 3, t ** 5], 1)
    y = np.sin(t)
    w = np.ones_like(t)
    for _ in range(200):
        c, *_ = np.linalg.lstsq(basis * w[:, None], y * w, rcond=None)
        w = w * np.abs(basis @ c - y) ** 0.5 + 1e-12
        w /= w.max()
    return c, float(np.abs(basis @ c - y).max())


c_sin, err_sin = sine_minimax_deg5()
print()
print("sine, degree-5 minimax on [0, pi/2]: max error %.2e" % err_sin)
for name, v in zip(("c1", "c3", "c5"), c_sin):
    print(f"  {name} = {v:+.8f}  hex={round(v * 2 ** 23) & 0xFFFFFF:06X}")
