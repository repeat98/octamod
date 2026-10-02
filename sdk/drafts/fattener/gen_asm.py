#!/usr/bin/env python3
"""Writes fattener.asm: python3 gen_asm.py

Every constant in fattener.asm comes from here (the polynomial fits, the
highpass coefficients, the 17 peak-EQ designs COLOR interpolates between,
the knob-to-constant affine maps), so nothing is hand-typed. The arithmetic
it emits is documented in fattener.asm's header; reference.py has the JSFX
and the module's float model it is checked against (verify.py).
"""
import math
import pathlib
import numpy as np
import sys

SR = 44100.0
Q = 1 << 23
HERE = pathlib.Path(__file__).resolve().parent
import os
# The EQ feeds back first order: second order holds a limit cycle at low COLOR
# (FAT_EQEF=2 measures it), first order decays to exact zero.
EQ_EF2 = os.environ.get("FAT_EQEF", "1") == "2"
sys.path.insert(0, str(HERE))
import reference  # noqa: E402


def qhex(v):
    """Q1.23, rounded, as a 24-bit word. Refuses anything outside [-1, 1)."""
    w = round(v * Q)
    assert -Q <= w < Q, f"{v} out of Q1.23 range"
    return f"${w & 0xFFFFFF:06X}"


def fit(f, lo, hi, deg, n=4000):
    """Least squares on Chebyshev nodes; ascending coefficients and the max error."""
    k = np.arange(n)
    x = (lo + hi) / 2 + (hi - lo) / 2 * np.cos(np.pi * (k + 0.5) / n)
    c = np.polynomial.polynomial.polyfit(x, f(x), deg)
    xs = np.linspace(lo, hi, 20001)
    return [float(v) for v in c], float(np.abs(np.polynomial.polynomial.polyval(xs, c) - f(xs)).max())


# ---- approximations ---------------------------------------------------------
# log2(m), m in [0.5, 1), in z = m - 0.75; stored / 32 (every log value is /32)
LOG2C, LOG2_ERR = fit(lambda z: np.log2(z + 0.75), -0.25, 0.25, 5)
LOG2C = [c / 32 for c in LOG2C]
# exp2 mantissa 2^(2z - 1), z in [0, 0.5]
EXP2C, EXP2_ERR = fit(lambda z: 2.0 ** (2 * z - 1), 0.0, 0.5, 4)
TANH_STEP = 8                    # tanh table: u = i/8, i = 0 .. 89
TANH_N = 90

# ---- the JSFX's fixed constants ---------------------------------------------
L2DB = math.log2(10) / 20        # log2 units per dB
AK1 = 1 - math.exp(-1 / (SR * 2.69e-3))
RK1 = 1 - math.exp(-1 / (SR * 32.9e-3))
FG4 = 10 ** (-0.1 / 20) / 4      # the JSFX's -0.1 dB, and /4 for INPUT_GAIN


def hp(freq, q=math.sqrt(0.5)):
    w = freq / SR * 2 * math.pi
    al = math.sin(w) / (2 * q)
    c = math.cos(w)
    return ((1 + c) / 2 / (1 + al), -(1 + c) / (1 + al), (1 + c) / 2 / (1 + al), 2 * c / (1 + al), -(1 - al) / (1 + al))


def stored(a0, a1, a2, b1, b2):
    """A biquad's table words: p1' = a1+1, p2 = a2, q1' = b1-1, q2 = b2,
    p0' = a0-1 (the 1s are the stage code's add/sub/add)."""
    return [a1 + 1, a2, b1 - 1, b2, a0 - 1]


EPS = 128      # the highpasses store their poles as b1 = 2 - e1, b2 = -1 + e2, with e*128:
               # pole precision 2^-30 instead of 2^-23 (0.75 % of 20 Hz otherwise)


def stored_hp(freq, q=math.sqrt(0.5)):
    """A highpass's words with its double zero at DC kept EXACT: a0 = a2 = k,
    a1 = -2k in integer units. Rounding the three independently leaves their
    sum a few 1e-8 off zero, and with poles this close to z = 1 that leaks DC
    at a gain of ~0.01 (measured: a 7.7e-3 step error at 20 Hz)."""
    a0, a1, a2, b1, b2 = hp(freq, q)
    assert 0 < (2 - b1) * EPS < 1 and 0 < (1 + b2) * EPS < 1
    k = round(a2 * Q)
    return [(Q - 2 * k) / Q, k / Q, -(2 - b1) * EPS, (1 + b2) * EPS, (k - Q) / Q]


# One highpass for the JSFX's 20 Hz + 30 Hz pair (reference.HP_F, HP_Q).
HPC = stored_hp(reference.HP_F, reference.HP_Q)
# The peak EQ at c = k/16: COLOR interpolates linearly between these.
EQN = [stored(*n) for n in reference.eq_nodes()]
assert max(abs(b - a) for i in range(len(EQN) - 1) for a, b in zip(EQN[i], EQN[i + 1])) < 0.5

# ---- knob maps (t = raw/128 from r6) ----------------------------------------
# FAT f = v/127; GAIN dB = (v - 64) * 0.375 = 48 t - 24.
# L = log2(g ls_true / th), ls_true = 8 ls_s, g = 4 10^(dB/20), th = 10^(-(34f+1)/20):
#   K1 = 5 + L2DB (dB + 34 f + 1)
# y_s = |y_true|/16 = h_s 2^E', E' = log2(g og) - 1 - 0.9 max(L, 0), og = 10^((39f+1)/20):
#   K2' = 1 + L2DB (dB + 39 f + 1); V = E' + 20 keeps exp2's input in (0, 32)
K1_C = (5 + L2DB * (-24 + 1)) / 32
K1_G = L2DB * 48 / 32
K1_F = L2DB * 34 / 32
E0_C = (1 + L2DB * (-24 + 1) + 20) / 32
E0_G = L2DB * 48 / 32
E0_F = L2DB * 39 / 32


# ---- r7 map ------------------------------------------------------------------
TANH_BASE = 0x46
M = dict(
    ST=0x00,                         # filter states, two copies of (v0 v1 v2) L R, modulo 12
    EF=0x0c,                         # error words: L HP e1 e2, L EQ e1 e2, R the same ($0c-$13)
    LS=0x3a, LSE=0x39,               # envelope and its error word
    # the per-sample constants, read in this order through r2:
    PGC=0x14, LIM=0x15, SN=0x16, TS=0x17, DMAX=0x18, PM=0x19, NPE=0x1a, LIN=0x1b, D4=0x1c,
    DG=0x1d, AK=0x1e, RK=0x1f, K1=0x20, E0=0x21, C075=0x22, C09=0x23,
    LASTC=0x24, FLIP=0x25,
    LOG2T=0x26,                      # 6 words
    EXP2T=0x2c,                      # 5 words
    HL=0x31, HR=0x32, SC=0x33,       # scratch $33-$38
    PTB=0x3b,                        # the P table's address
    COEF=0x3c,                       # HP 5, EQ 5: r1 walks them, then sits on the tanh table
    EQC=0x41,
    TANH=TANH_BASE,                  # 90 words, $46-$9f
)
assert M["COEF"] + 10 == M["TANH"] and M["TANH"] + TANH_N <= 0x100

# The words init copies from P to X:$14 onwards (states and errors are cleared).
INIT_FROM = M["PGC"]
INIT = {M["SN"]: 19 / Q, M["LIM"]: (Q - 1) / Q, M["LIN"]: 4 * FG4, M["AK"]: AK1, M["RK"]: RK1,
        M["C075"]: 0.75, M["C09"]: 0.9}
for k, v in enumerate(LOG2C):
    INIT[M["LOG2T"] + k] = v
for k, v in enumerate(EXP2C):
    INIT[M["EXP2T"] + k] = v
for k, v in enumerate(HPC):
    INIT[M["COEF"] + k] = v
TANH_T = [min(math.tanh(i / TANH_STEP), (Q - 1) / Q) for i in range(TANH_N)]
for i, v in enumerate(TANH_T):
    INIT[M["TANH"] + i] = v
INIT_N = M["TANH"] + TANH_N - INIT_FROM


def r7(name, k=0):
    return f"x:(r7+${M[name] + k:02x})"


def word(v):
    """A table word: a fraction, or an integer passed as v/Q."""
    w = round(v * Q)
    assert -Q <= w < Q, v
    return f"${w & 0xFFFFFF:06X}"


def ptable():
    """The words the manifest declares as its P table (DspSection.ptable):
    init's image of X:$14-$9f, then the 17 EQ designs, five words each."""
    vals = [INIT.get(INIT_FROM + i, 0.0) for i in range(INIT_N)]
    vals += [v for n in EQN for v in n]
    return tuple(round(v * Q) & 0xFFFFFF for v in vals)


def emit():
    o = []
    A = o.append

    def cmt(s):
        A("; " + s)

    def horner2(table, deg):
        """Horner, two instructions a degree: z in x1, the running value
        through y0, a and b alternating. Returns the result's accumulator."""
        top = M[table] + deg
        assert top < 0x40
        A(f"        lua     (r7+${top:02x}),r2")
        A("        move    x:(r2)-,y0")
        A("        move    x:(r2)-,a")
        acc, other = "a", "b"
        for k in range(deg):
            A(f"        mac     x1,y0,{acc}   x:(r2)-,{other}")
            if k < deg - 1:
                A(f"        move    {acc},y0")
                acc, other = other, acc
        return acc

    # --------------------------------------------------------------------- init
    A("init:")
    A("        clr     a")
    A("        move    r7,r2")
    A("        rep     #$100")
    A("        move    a,x:(r2)+                ; the whole block to zero")
    A(f"        move    #>${INIT_FROM:02x},n2")
    A("        move    r7,r2")
    A("        move    (r2)+n2")
    A("        move    #>$fab1e0,r3             ; the P table: build_bus.py rewrites this")
    A("        move    r3,b")
    A(f"        do      #${INIT_N:x},>icopy")
    A("        move    p:(r3)+,x0")
    A("        move    x0,x:(r2)+")
    A("icopy:")
    A(f"        move    b,{r7('PTB')}             ; after the copy, which clears it")
    A("        move    #>$ffffff,a")
    A(f"        move    a,{r7('LASTC')}             ; forces the COLOR precompute")
    A("        rts")
    A("")

    # --------------------------------------------------------------------- proc
    A("proc:")
    cmt("---- FAT and GAIN -> K1/32 and E0 = (K2' + 20)/32, every block (affine) ----")
    A("        move    x:(r6+$0),x0             ; FAT t")
    A(f"        move    #>{qhex(1 / 127)},y0")
    A("        mpy     y0,x0,a")
    A("        add     x0,a                     ; f = t 128/127")
    A("        move    a,y1")
    A("        move    x:(r6+$2),x1             ; GAIN t")
    for dst, cc, cg, cf in (("K1", K1_C, K1_G, K1_F), ("E0", E0_C, E0_G, E0_F)):
        A(f"        move    #>{qhex(cg)},y0")
        A("        mpy     x1,y0,a")
        A(f"        move    #>{qhex(cf)},x0")
        A("        mac     x0,y1,a")
        A(f"        add     #>{qhex(cc)},a")
        A(f"        move    a,{r7(dst)}")
    cmt("---- COLOR -> the soft clip's constants and the EQ, only when it changed ----")
    A("        move    x:(r6+$1),a")
    A(f"        move    {r7('LASTC')},x0")
    A("        cmp     x0,a")
    A("        beq     cdone")
    A(f"        move    a,{r7('LASTC')}")
    A("        bsr     color")
    A("cdone:")
    cmt("---- the gain for this block, from the envelope now: G = P 2^(k - 19) ----")
    A(f"        move    {r7('LS')},a")
    A("        or      #$1,a                    ; ls >= 1 LSB: log2 >= -23")
    A("        clb     a,b")
    A("        move    b1,x0")
    A("        normf   x0,a                     ; m in [0.5, 1)")
    A("        move    x0,b")
    A("        asl     #$12,b,b                 ; exponent/32")
    A("        move    b,y1")
    A(f"        move    {r7('C075')},x1")
    A("        sub     x1,a")
    A("        move    a,x1                     ; z = m - 0.75")
    assert horner2("LOG2T", 5) == "a"
    A("        add     y1,a                     ; log2(ls)/32")
    A(f"        move    {r7('K1')},x0")
    A("        add     x0,a                     ; L/32")
    A("        move    #0,x1")
    A("        tlt     x1,a                     ; max(L, 0)")
    A("        move    a,x1")
    A(f"        move    {r7('C09')},y1")
    A("        mpy     y1,x1,a")
    A("        neg     a")
    A(f"        move    {r7('E0')},x0")
    A("        add     x0,a                     ; V/32 in (0, 1)")
    A("        asr     #$12,a,b                 ; floor(V)")
    A("        move    b1,y1")
    A("        and     #>$03ffff,a              ; frac/32")
    A("        asl     #$4,a,a")
    A("        move    a,x1                     ; z = frac/2")
    assert horner2("EXP2T", 4) == "b"
    A(f"        move    b,{r7('SC', 0)}             ; P, the target's mantissa")
    A("        move    #>$13,a")
    A("        move    y1,x0")
    A("        sub     x0,a                     ; SNt = 19 - k")
    A(f"        move    a1,{r7('SC', 1)}")
    cmt("one shift for the block, SN = min(SNt, SNc): the ramp's ends share it")
    A(f"        move    {r7('SN')},x0            ; SNc, the shift PGC is in")
    A("        cmp     x0,a")
    A("        tgt     x0,a")
    A("        move    a1,y0                    ; SN")
    cmt("LIM = 1 >> max(-SN - 8, 0): |h PGC| above it would leave the guard bits")
    A("        neg     a")
    A("        move    #>$8,x0")
    A("        sub     x0,a")
    A("        move    #0,x0")
    A("        tlt     x0,a")
    A("        move    a1,x0")
    A("        move    #>$7fffff,a")
    A("        normf   x0,a")
    A(f"        move    a,{r7('LIM')}")
    A(f"        move    {r7('SN')},a")
    A("        sub     y0,a                     ; SNc - SN >= 0")
    A("        move    a1,x0")
    A(f"        move    {r7('PGC')},a")
    A("        normf   x0,a                     ; S: where the gain is, in SN")
    A("        move    a,x1")
    A(f"        move    {r7('SC', 1)},a")
    A("        sub     y0,a                     ; SNt - SN >= 0")
    A("        move    a1,x0")
    A(f"        move    {r7('SC', 0)},a")
    A("        normf   x0,a")
    A("        move    a,b                      ; E")
    A("        sub     x1,b")
    A("        asr     #$4,b,b                  ; (E - S)/16")
    A(f"        move    b,{r7('DG')}")
    A(f"        move    x1,{r7('PGC')}")
    A(f"        move    y0,{r7('SN')}")
    cmt("---- sample loop: r4 -> the newer state copy, r5 -> the older; modulo 12 ----")
    for m in (0, 1, 2, 3):
        A(f"        move    #>$ffffff,m{m}")
    A(f"        move    {r7('FLIP')},n4")
    A("        move    r7,r4")
    A("        move    (r4)+n4                  ; +0 or +6")
    A("        move    #>$6,a")
    A(f"        move    {r7('FLIP')},x0")
    A("        sub     x0,a")
    A("        move    a,n5")
    A("        move    r7,r5")
    A("        move    (r5)+n5                  ; the other one")
    A("        move    #>$b,m4")
    A("        move    #>$b,m5")
    A("        move    #>$1,n0")
    A("        move    #>$1,n5")
    A("        move    #>$2,n3")
    A("        do      n7,>sloop")
    A("        bsr     frame")
    A("        move    (r0)+")
    A("        move    (r0)+")
    A("sloop:")
    A("        move    r4,a                     ; flip = r4 - r7, for the next call")
    A("        move    r7,x0")
    A("        sub     x0,a")
    A(f"        move    a,{r7('FLIP')}")
    A("        move    #>$ffffff,m4")
    A("        move    #>$ffffff,m5")
    A("        rts")
    A("")

    # -------------------------------------------------------------------- frame
    cmt("frame: one stereo sample, straight-line (no branch, no call)")
    A("frame:")
    A(f"        lua     (r7+${M['EF']:02x}),r3")
    for ch, src in ((0, "x:(r0)"), (1, "x:(r0+n0)")):
        cmt(f"---- {'L' if ch == 0 else 'R'}: HP 36.5 Hz, then the peak EQ; at x/8 ----")
        A(f"        move    {src},a")
        A("        asr     #$3,a,a")
        A("        move    a,x0                     ; v0 = x/8")
        A(f"        lua     (r7+${M['COEF']:02x}),r1")
        # highpass: second-order error feedback, poles as 2 - e1, -1 + e2
        A("        clr     a         x:(r1)+,y0     ; p1'")
        A("        clr     b         x:(r3)+,a0     ; e(n-1)")
        A("        move    x:(r3),b0                ; e(n-2)")
        A("        asl     a         a0,x:(r3)-     ; 2 e(n-1) ; e(n-1) -> the e(n-2) slot")
        A("        sub     b,a       x:(r4)+,x1     ; second-order error feedback ; in(n-1)")
        A("        mac     x1,y0,a   x:(r1)+,y0     ; p1' in(n-1) ; p2")
        A("        sub     x1,a      x:(r5),x1      ; - in(n-1) ; in(n-2)")
        A("        mac     x1,y0,a   x:(r1)+,y0     ; p2 in(n-2) ; -e1*128")
        A("        move    x:(r4),x1                ; out(n-1)")
        A("        mpy     x1,y0,b   x:(r1)+,y0     ; -e1 out(n-1) *128 ; e2*128")
        A("        add     x1,a")
        A("        add     x1,a      x:(r5+n5),x1   ; + 2 out(n-1) ; out(n-2)")
        A("        mac     x1,y0,b   x:(r1)+,y0     ; + e2 out(n-2) *128 ; p0'")
        A("        sub     x1,a                     ; - out(n-2)")
        A("        asr     #$7,b,b")
        A("        add     b,a                      ; poles: (2 - e1), (-1 + e2)")
        A("        mac     y0,x0,a   x0,x:(r5)+     ; p0' in ; in -> the older slot")
        A("        add     x0,a                     ; + in")
        A("        move    a0,x:(r3)+n3             ; residual e(n)")
        A("        move    a,x0                     ; the highpass's output")
        # peak EQ: first-order error feedback
        A("        clr     a         x:(r1)+,y0     ; p1'")
        if EQ_EF2:
            A("        clr     b         x:(r3)+,a0     ; e(n-1)")
            A("        move    x:(r3),b0                ; e(n-2)")
            A("        asl     a         a0,x:(r3)-     ; 2 e(n-1) ; e(n-1) -> the e(n-2) slot")
            A("        sub     b,a       x:(r4)+,x1     ; second-order error feedback ; in(n-1)")
        else:
            A("        move    x:(r3),a0                ; e(n-1)")
            A("        move    x:(r4)+,x1               ; in(n-1)")
        A("        mac     x1,y0,a   x:(r1)+,y0     ; p1' in(n-1) ; p2")
        A("        sub     x1,a      x:(r5),x1      ; - in(n-1) ; in(n-2)")
        A("        mac     x1,y0,a   x:(r1)+,y0     ; p2 in(n-2) ; q1'")
        A("        move    x:(r4)+,x1               ; out(n-1)")
        A("        mac     x1,y0,a   x:(r1)+,y0     ; q1' out(n-1) ; q2")
        A("        add     x1,a      x:(r5+n5),x1   ; + out(n-1) ; out(n-2)")
        A("        mac     x1,y0,a   x:(r1)+,y0     ; q2 out(n-2) ; p0'")
        A("        mac     y0,x0,a   x0,x:(r5)+     ; p0' in ; in -> the older slot")
        A("        add     x0,a                     ; + in")
        A("        move    a0,x:(r3)+n3             ; residual" if EQ_EF2 else "        move    a0,x:(r3)+               ; residual")
        A("        move    a,x:(r5)+                ; v2 -> the older slot")
        A(f"        move    a,{r7('HL' if ch == 0 else 'HR')}               ; h_s = h/8")
    cmt("---- envelope of max(|L|, |R|), every sample, with its error word ----")
    A("        abs     a")
    A(f"        move    {r7('HL')},b")
    A("        abs     b")
    A("        cmp     b,a")
    A("        tlt     b,a                      ; lv")
    A(f"        move    {r7('LS')},x1")
    A("        sub     x1,a                     ; d = lv - ls")
    A(f"        move    {r7('RK')},b")
    A(f"        move    {r7('AK')},y1")
    A("        tgt     y1,b                     ; rising: attack, else release")
    A("        move    a,x0")
    A("        move    b,y1")
    A("        clr     a")
    A(f"        move    {r7('LSE')},a0")
    A("        mac     x0,y1,a")
    A("        add     x1,a                     ; ls + k d")
    A(f"        move    a0,{r7('LSE')}")
    A(f"        move    a,{r7('LS')}")
    cmt("---- the gain ramps across the block ----")
    A(f"        move    {r7('PGC')},a")
    A(f"        move    {r7('DG')},x0")
    A("        add     x0,a")
    A(f"        move    a,{r7('PGC')}")
    for ch, dst, hname in ((0, "x:(r0)", "HL"), (1, "x:(r0+n0)", "HR")):
        cmt(f"---- {'L' if ch == 0 else 'R'}: gain, then the soft clip, select-free: ----")
        cmt("     out = 4 (min(|y|, t) fg + (1-t) fg/16 tanh(max(|y| - t, 0)/(1-t))), signed")
        A(f"        lua     (r7+${M['PGC']:02x}),r2      ; the constants, in order")
        A(f"        move    {r7(hname)},x0")
        A("        move    x:(r2)+,y1               ; PGC")
        A("        mpy     x0,y1,a   x:(r2)+,x1     ; h PGC ; LIM")
        A("        abs     a")
        A("        cmp     x1,a      x:(r2)+,y0     ; SN")
        A("        tgt     x1,a                     ; under LIM: the shift stays in the guard")
        A("        normf   y0,a                     ; |y_s| = |y|/16")
        A("        tfr     a,b       x:(r2)+,x1     ; TS = t/16")
        A("        cmp     x1,b      x:(r2)+,y1     ; DMAX")
        A("        tgt     x1,b                     ; m = min(|y_s|, t/16)")
        A("        sub     b,a       x:(r2)+,y0     ; d = |y_s| - m ; PM")
        A("        cmp     y1,a")
        A("        tgt     y1,a                     ; d in [0, Dmax]")
        A("        move    a,x1")
        A("        mpy     x1,y0,a   x:(r2)+,x1     ; d PM ; NPE")
        A("        normf   x1,a                     ; u/16 = d/(1 - t)")
        A("        move    b,y1                     ; m")
        A("        asr     #$10,a,b                 ; i = floor(8u)")
        A("        move    b1,n1")
        A("        and     #>$00ffff,a")
        A("        asl     #$6,a,a                  ; frac/2")
        A("        move    a,y0")
        A("        lua     (r1)+n1,r3               ; r1 sits on the tanh table")
        A("        move    x:(r3)+,x0               ; T(i)")
        A("        move    x:(r3),a                 ; T(i+1)")
        A("        sub     x0,a")
        A("        move    a,x1")
        A("        mpy     x1,y0,a   x:(r2)+,y0     ; ; LIN = fg")
        A("        asl     a")
        A("        add     x0,a                     ; tanh(u)")
        A("        move    a,x1")
        A("        mpy     y1,y0,b   x:(r2)+,y0     ; m fg ; D4 = (1 - t) fg/16")
        A("        mac     x1,y0,b                  ; + (1 - t) fg/16 tanh")
        A("        asl     #$2,b,b")
        A("        move    b,x0")
        A("        neg     b")
        A(f"        move    {r7(hname)},a")
        A("        tst     a")
        A("        tge     x0,b                     ; the sign of h, which is y's")
        A(f"        move    b,{dst}")
    A("        rts")
    A("")

    # ------------------------------------------------------------ precompute
    cmt("color: COLOR -> TS, DMAX, PM, NPE, D4 and the EQ's five words (17 designs,")
    cmt("linear between them). Per block, only when COLOR changed.")
    A("color:")
    A("        move    x:(r6+$1),x0             ; t = v/128")
    A(f"        move    #>{qhex(1 / 127)},y0")
    A("        mpy     y0,x0,a")
    A("        add     x0,a                     ; c = v/127")
    A(f"        move    a,{r7('SC', 2)}")
    A("        move    a,x0")
    A(f"        move    #>{qhex(0.1 / 16)},y0")
    A("        mpy     y0,x0,a")
    A(f"        add     #>{qhex(0.9 / 16)},a")
    A(f"        move    a,{r7('TS')}               ; t/16")
    cmt("1 - c = om 128/127, om = (127 - v)/128 exactly")
    A("        move    #>$7f0000,a")
    A("        move    x:(r6+$1),x0")
    A("        sub     x0,a")
    A(f"        move    a,{r7('SC', 3)}             ; om")
    A("        move    a,x0")
    A(f"        move    #>{qhex(0.06875 * 128 / 127)},y0")
    A("        mpy     y0,x0,a")
    A(f"        move    a,{r7('DMAX')}              ; 11 (1 - t)/16")
    A(f"        move    #>{qhex(4 * FG4 * 0.1 / 16 * 128 / 127)},y0")
    A("        mpy     y0,x0,a")
    A(f"        move    a,{r7('D4')}               ; (1 - t) fg/16")
    A(f"        move    {r7('SC', 3)},a")
    A("        tst     a")
    A("        bne     csoft")
    A("        clr     a                        ; COLOR 127: the JSFX's hard clip")
    A(f"        move    a,{r7('PM')}")
    A(f"        move    a,{r7('NPE')}")
    A("        bra     ceq")
    A("csoft:")
    cmt("1/(1 - t) = 10/(1 - c) = 9.921875/om = PM 2^-NPE")
    A("        clb     a,b")
    A("        move    b1,x0")
    A("        normf   x0,a                     ; mo in [0.5, 1)")
    A("        move    x0,b")
    A(f"        move    b1,{r7('SC', 4)}             ; q = log2(om/mo) <= 0")
    A("        move    a,x1")
    A("        move    #>$200000,a              ; 0.25")
    A("        andi    #$fe,ccr")
    A("        rep     #$18")
    A("        div     x1,a")
    A("        move    a0,x0                    ; 0.25/mo in (0.25, 0.5]")
    A(f"        move    #>{qhex(9.921875 * 4 / 64)},y0")
    A("        mpy     y0,x0,a")
    A(f"        move    a,{r7('PM')}")
    A(f"        move    {r7('SC', 4)},a")
    A("        move    #>$6,x0")
    A("        sub     x0,a                     ; q - 6: left shift by 6 - q")
    A(f"        move    a1,{r7('NPE')}")
    A("ceq:")
    cmt("the EQ: x = 16 c, i = floor(x) (15 at c = 1), f = x - i")
    A(f"        move    {r7('SC', 2)},a")
    A("        tfr     a,b")
    A("        asr     #$13,b,b                 ; i")
    A("        and     #>$07ffff,a")
    A("        asl     #$4,a,a                  ; f")
    A("        move    #>$10,x0")
    A("        cmp     x0,b")
    A("        blt     cseg")
    A("        move    #>$f,b                   ; c = 1: the last segment at f = 1")
    A("        move    #>$7fffff,a")
    A("cseg:")
    A("        move    a,y1                     ; f")
    A("        move    b1,x0")
    A("        move    #>$5,y0")
    A("        mpy     y0,x0,b")
    A("        asr     b")
    A("        move    b0,b")
    A(f"        add     #>${INIT_N:x},b              ; the designs follow init's words")
    A(f"        move    {r7('PTB')},x0")
    A("        add     x0,b")
    A("        move    b1,r2                    ; design i")
    A("        move    #>$5,n3")
    A("        move    r2,r3")
    A("        move    (r3)+n3                  ; the next design")
    A(f"        move    #>${M['EQC']:02x},n4")
    A("        move    r7,r4")
    A("        move    (r4)+n4")
    A("        do      #$5,>cint")
    A("        move    p:(r2)+,x0")
    A("        move    p:(r3)+,a")
    A("        sub     x0,a")
    A("        move    a,x1")
    A("        mpy     y1,x1,a")
    A("        add     x0,a")
    A("        move    a,x:(r4)+")
    A("cint:")
    A("        rts")
    A("")
    return o


PT_BEGIN = "# ---- PTABLE: written by gen_asm.py ----"
PT_END = "# ---- end of PTABLE ----"

HEADER = """\
; FATTENER -- JClones_Fattener.jsfx (MIT, Copyright (c) 2026 JClones) on the
; DSP56300. WRITTEN BY gen_asm.py: edit that, not this file.
;
; Entry points: init (once, clears the r7 block and copies its tables from
; P), proc (per block: r0 interleaved audio, n0 = 1 for R, r6 the knobs as
; value<<16, r7 the 256-word instance block, n7 frames, not modified).
;
; About half the DSP time of the first build (OCTABAM10), which overran the
; unit under p-locks and scene moves. What it computes is
; reference.render_model():
;   * x/8 through one highpass (36.5 Hz Q 0.78, for the JSFX's 20 + 30 Hz
;     pair; zeros exactly at DC, poles as 2 - e1 and -1 + e2 with e1, e2
;     x128, second-order error feedback so it decays to exactly zero) and
;     the peak EQ (first-order error feedback), whose five words COLOR
;     interpolates between 17 designs in P (`ctab`).
;   * Every sample: the envelope of max(|L|, |R|), attack 2.69 ms, release
;     32.9 ms, with its own error word (stereo link, as in the JSFX).
;   * Every block: from the envelope, log2 (clb, normf, degree-5 poly) +
;     K1, floored at 0; the gain 2^(E0 - 0.9 L) (degree-4 poly, integer
;     part as a shift): the JSFX's 10:1, makeup and GAIN folded into K1, E0.
;     It ramps linearly from where it is to there across the block.
;   * Per channel: y = h gain, then above the knee t = 0.9 + 0.1 COLOR
;     out = t + (1 - t) tanh((|y| - t)/(1 - t)), tanh from a 90-entry table
;     (u = i/8) linearly interpolated; COLOR 127 is the JSFX's hard clip.
;     Then -0.1 dB.
; The JSFX runs at 4x the input and the output is divided by 4 (INPUT_GAIN
; in reference.py): AMP VOL's (v/127)^2 puts a normalized sample at VOL 64
; 12 dB below where the JSFX would see it in a DAW.
;
; r7 map: $00-$0b the filter states (two copies, modulo 12: each frame's +6
; swaps newer and older), $0c-$11 filter errors, $12-$13 envelope, $14-$1b
; the per-sample constants (read in order through r2), $1c-$32 per-block
; constants and staging, $33-$3b scratch, $3c-$45 the filter coefficients,
; $46-$9f the tanh table.

"""

if __name__ == "__main__":
    out = pathlib.Path(os.environ.get("FAT_OUT", HERE / "fattener.asm"))
    out.write_text(HEADER + "\n".join(emit()) + "\n")
    # the manifest's P table, between its markers
    man = pathlib.Path(os.environ.get("FAT_MANIFEST", HERE / "manifest.py"))
    text = man.read_text()
    a, b = text.index(PT_BEGIN), text.index(PT_END)
    words = ptable()
    lines = ["PTABLE = ("] + ["    " + ", ".join(f"0x{w:06x}" for w in words[i:i + 8]) + ","
                             for i in range(0, len(words), 8)] + [")"]
    man.write_text(text[:a + len(PT_BEGIN)] + "\n" + "\n".join(lines) + "\n" + text[b:])
    print(f"log2 fit err {LOG2_ERR * 32:.1e}, exp2 fit err {EXP2_ERR:.1e}; wrote {out.name}")
