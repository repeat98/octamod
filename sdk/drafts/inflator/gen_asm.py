"""Writes inflator.asm from gen_constants.py: python3 gen_asm.py"""
import gen_constants as G
segs_in, _ = G.segfit(G.input_gain_q)
segs_out, _ = G.segfit(G.output_gain)
K = G.band_constants()
h = lambda v: f"${G.qhex(v):06X}"

def fit(name, segs):
    out = [f"{name}:",
           "        move    #>$200000,x0",
           "        cmp     x0,a",
           f"        blt     {name[4:]}g0",
           "        move    #>$400000,x0",
           "        cmp     x0,a",
           f"        blt     {name[4:]}g1",
           "        move    #>$600000,x0",
           "        cmp     x0,a",
           f"        blt     {name[4:]}g2"]
    def body(lbl, lo, c):
        b = [] if lbl is None else [f"{lbl}:"]
        if lo:
            b += [f"        move    #>${lo:06X},x0", "        sub     x0,a"]
        b += ["        asl     #$2,a,a                  ; u = (t - segment start)*4", "        bsr     upowers"]
        for i, v in enumerate(c):
            b += [f"        move    #>{h(v)},a", f"        move    a,x:(r7+${0x1d + i:02x})"]
        b += ["        bsr     poly5", "        rts"]
        return b
    out += body(None, 0x600000, segs[3])
    out += body(f"{name[4:]}g0", 0, segs[0])
    out += body(f"{name[4:]}g1", 0x200000, segs[1])
    out += body(f"{name[4:]}g2", 0x400000, segs[2])
    return "\n".join(out) + "\n"

def shaper():
    return """        move    r5,r1                    ; the shaper's table
        abs     a           a,x0         ; x0 = X, a = |X|
        move    a,y1
        move    x:(r1)+,y0               ; K2 = 2c
        mpy     y1,y0,a     x:(r1)+,x1   ; |X| 2c ; K1 = 1 - c
        asl     a                        ; |x| 2c
        add     x1,a        x:(r1)+,x1   ; gr ; 0.99999
        cmp     x1,a
        tgt     x1,a                     ; gr <= 1 (gr >= 0.5 always)
        move    a,y1
        mpy     x0,y1,a                  ; G = gr X = g/2
        abs     a           a,x1         ; x1 = G, a = |G|
        neg     a           x:(r1)+,y0   ; 0.5
        add     y0,a                     ; T = (1 - |g|)/2
        move    a,y1
        mpy     y1,x1,a     x:(r1)+,y0   ; G T = g(1 - |g|)/4 ; E
        move    a,y1
        mpy     y1,y0,a     x:(r1)+,y1   ; x E ; DRYH = (1 - e)/2
        asl     a                        ; 2e g(1 - |g|)/4
        mac     x0,y1,a                  ; + (1 - e) x/4 = y/4
"""

src = f"""; ---------------------------------------------------------------------------
; INFLATOR -- Octamod DSP insert, port of JClones_OInflator.jsfx (MIT,
; Copyright (c) 2026 JClones), a clone of the Oxford Inflator: an odd
; waveshaper g(1 - |g|) blended with the dry signal, optionally in three
; bands split at 240 Hz and 2.4 kHz. No oversampling, as in the JSFX.
;
; Written for Octamod on 2 Oct 2026. octabam's own inflator ported
; RCInflator 2 (Oxford Edition), which carries no licence; this is a new
; port from the MIT-licensed JClones source, checked against it by
; verify.py (reference.py is the JSFX line for line).
;
; Scaling. The JSFX itself runs at half scale (input * 0.5, clip at 0.5,
; output * 2). Here every band value X is the JSFX's x / 2 (so clip off,
; where x reaches 1 and a band 1.7, still fits), each shaped band is
; carried as y / 4 (the three-band sum reaches 3.2), and the output is
; (y/4) * OUTPUT * 8. Filter states are kept in the same x / 2 scale; the
; coefficients absorb the JSFX's fixed x2/x4 gains (see gen_constants.py).
;
; INPUT_GAIN = 4 (+12.04 dB), added 2 Oct 2026 after a hardware listen
; (TapeHead and IronOxide5 "saturate less than the plugin"): the unit
; applies AMP VOL as (v/127)^2 BEFORE the FX chain, so at the default VOL 64
; a 0 dBFS sample arrives at 0.254 FS, 12 dB below what the JSFX sees in a
; DAW, and the shaper, defined relative to the JSFX's 0 dBFS, barely bends.
; The module computes JSFX(4x)/4: the input's `asl` becomes `asl #3` (the
; accumulator's extension carries 4x into the existing clip, the JSFX's own),
; and the output's `asl #3` becomes `asl #1`. No word or cycle is added.
;
; Cost. The per-sample code walks two constant tables with post-increment
; pointers and parallel moves, so almost every instruction is one word:
; r5 -> the shaper's table, reset before each band; r3 -> the band-split
; table (r2 walks it); r4 walks the eight filter states, L then R.
;
; Every mpy/mac uses a pair dsp_asm encodes as a SIGNED multiply (y1,y0 /
; y0,x0 / x0,y1 / y1,x1 / x0,x0); clamps are cmp + Tcc. verify.py checks
; no mpysu.
;
; r7 memory map:
;   $00-$03   L band-split states: high, mid LPF, mid HPF, low
;   $04-$07   R band-split states
;   $08 IG8 = input gain / 8      $09 OG = output gain (0 dB -> 0.99999)
;   $0e TH = clip level / 2       $0f -TH       $10 X (this sample)
;   $18-$22   per-block fit staging
;   $28-$2d   shaper table: K2 = 2c, K1 = 1 - c, 0.99999, 0.5, E, (1 - E)/2
;   $30-$3c   band-split table (gen_constants.py), written by init
;
; Knobs (page 1, value<<16 = t = value/128):
;   0 INPUT  dB = -6 + value/7 (0 dB at 42, +12.1 dB at 127)
;   1 EFFECT value/127 (0 dry ... 127 = 100%)
;   2 CURVE  JSFX curve = (value - 64) * 50/64, so c = (128 - value)/256
;   3 CLIP   0 off (+6 dB headroom), 1 on (0 dBFS)
;   4 SPLIT  0 single band, 1 three bands
;   5 OUTPUT dB = -12 + 12*value/127 (0 dB at 127)
; ---------------------------------------------------------------------------

init:
        clr     a
        move    a,x:(r7+$0)
        move    a,x:(r7+$1)
        move    a,x:(r7+$2)
        move    a,x:(r7+$3)
        move    a,x:(r7+$4)
        move    a,x:(r7+$5)
        move    a,x:(r7+$6)
        move    a,x:(r7+$7)
; the band-split table: constants, written once per selection
        move    #>{h(K['K0H'])},a
        move    a,x:(r7+$30)             ; K0H
        move    #>{h(K['K1H'])},a
        move    a,x:(r7+$31)             ; K1H
        move    #>{h(K['K2H2'])},a
        move    a,x:(r7+$32)             ; K2H2
        move    #>{h(K['K0M'])},a
        move    a,x:(r7+$33)             ; K0M
        move    #>{h(K['K1M'])},a
        move    a,x:(r7+$34)             ; K1M
        move    #>{h(K['K2M2'])},a
        move    a,x:(r7+$35)             ; K2M2
        move    #>{h(K['K0MH4'])},a
        move    a,x:(r7+$36)             ; K0MH4
        move    #>{h(K['K1MH4'])},a
        move    a,x:(r7+$37)             ; K1MH4
        move    #>{h(K['K2MH2'])},a
        move    a,x:(r7+$38)             ; K2MH2
        move    #>{h(K['MIDG'])},a
        move    a,x:(r7+$39)             ; MIDG
        move    #>{h(K['K0L2'])},a
        move    a,x:(r7+$3a)             ; K0L2
        move    #>{h(K['K1L2'])},a
        move    a,x:(r7+$3b)             ; K1L2
        move    #>{h(K['K2L2'])},a
        move    a,x:(r7+$3c)             ; K2L2
        rts

; ---------------------------------------------------------------------------
proc:
        move    x:(r6+$0),a              ; INPUT
        bsr     fit_in
        move    a,x:(r7+$08)             ; IG8
        move    x:(r6+$5),a              ; OUTPUT
        bsr     fit_out
        move    a,x:(r7+$09)             ; OG

        move    x:(r6+$2),a              ; CURVE t
        move    a,b
        neg     a
        add     #>$7FFFFF,a              ; K2 = 2c = 1 - t
        move    a,x:(r7+$28)
        asr     #$1,b,b
        add     #>$400000,b              ; K1 = 1 - c = 0.5 + t/2
        move    b,x:(r7+$29)
        move    #>$7FFFFF,a
        move    a,x:(r7+$2a)             ; 0.99999, gr's ceiling
        move    #>$400000,a
        move    a,x:(r7+$2b)             ; 0.5

        move    x:(r6+$1),x0             ; EFFECT, value/128
        move    #>$010204,y0             ; 1/127
        mpy     y0,x0,a
        add     x0,a                     ; e = value/127, held in a
        move    a,b
        move    a,x:(r7+$2c)             ; E (1.0 -> 0.99999)
        asr     #$1,b,b
        neg     b
        add     #>$400000,b              ; (1 - e)/2
        move    b,x:(r7+$2d)             ; DRYH

        move    #>$3FFFFF,a              ; clip off: 1/2 (just under)
        move    x:(r6+$3),b
        tst     b
        move    #>$200000,x1             ; clip on: 0.5/2
        tne     x1,a
        move    a,x:(r7+$0e)             ; TH
        neg     a
        move    a,x:(r7+$0f)             ; -TH


        move    #>$ffffff,m0
        move    #>$ffffff,m1
        move    #>$ffffff,m2
        move    #>$ffffff,m4
        move    #>$ffffff,m5
        lua     (r7+$28),r5              ; the shaper's table
        lua     (r7+$30),r3              ; the band-split table
        move    #>$1,n0
        move    x:(r6+$4),b              ; SPLIT
        tst     b
        bne     split_setup

; ---- single band: stateless, one routine for both channels -----------------
        do      n7,>oneloop_done
        move    x:(r0),a
        bsr     ch_one
        move    a,x:(r0)
        move    x:(r0+n0),a
        bsr     ch_one
        move    a,x:(r0+n0)
        move    #>$2,n0
        move    (r0)+n0
        move    #>$1,n0
oneloop_done:
        rts

; ---- three bands: r4 walks the filter states, L ($00-$03) then R ----------
split_setup:
        do      n7,>splitloop_done
        move    r7,r4
        move    x:(r0),a
        bsr     ch_split
        move    a,x:(r0)
        move    x:(r0+n0),a
        bsr     ch_split
        move    a,x:(r0+n0)
        move    #>$2,n0
        move    (r0)+n0
        move    #>$1,n0
splitloop_done:
        rts

; ---------------------------------------------------------------------------
; ch_one / ch_split: a = the sample in, a = the sample out (the caller's
; store limits it). Straight-line: no branch, no call.
; ---------------------------------------------------------------------------
ch_one:
        move    a,y1
        move    x:(r7+$08),y0            ; IG8
        mpy     y1,y0,a
        asl     #$3,a,a                  ; X = 4x * input gain / 4 (INPUT_GAIN; the extension holds it to the clip)
        move    x:(r7+$0e),x1
        cmp     x1,a
        tgt     x1,a                     ; clip
        move    x:(r7+$0f),x1
        cmp     x1,a
        tlt     x1,a
{shaper()}        move    a,y1                     ; y/4
        move    x:(r7+$09),y0            ; OG
        mpy     y1,y0,a
        asl     #$1,a,a                  ; y * output gain * 2 / 4 (INPUT_GAIN undone)
        rts

ch_split:
        move    a,y1
        move    x:(r7+$08),y0            ; IG8
        mpy     y1,y0,a
        asl     #$3,a,a                  ; X, with INPUT_GAIN
        move    x:(r7+$0e),x1
        cmp     x1,a
        tgt     x1,a
        move    x:(r7+$0f),x1
        cmp     x1,a
        tlt     x1,a
        move    a,x:(r7+$10)             ; X, reloaded per band
        move    a,x0
        move    r3,r2
; HIGH: u = k0 X + s; HIGH = 8u; s = k1 X + 2 k2 u
        move    x:(r2)+,y1               ; K0H
        mpy     x0,y1,a     x:(r4),y0    ; ; s
        add     y0,a        x:(r2)+,y0   ; u ; K1H
        move    a,y1                     ; u
        mpy     y0,x0,a     x:(r2)+,x1   ; K1H X ; K2H2
        mac     y1,x1,a
        move    a,x:(r4)+                ; new s
        move    y1,a
        asl     #$3,a,a                  ; HIGH (x/2 scale)
{shaper()}        move    a,b                      ; the band sum, y/4
        move    x:(r7+$10),x0
; MID: v = k0 X + s1; s1 = k1 X + 2 k2 v; w = 4 k0' v + s2; MID = 4w;
;      s2 = 4 k1' v + 2 k2' w
        move    x:(r2)+,y1               ; K0M
        mpy     x0,y1,a     x:(r4),y0    ; ; s1
        add     y0,a        x:(r2)+,y0   ; v ; K1M
        move    a,y1                     ; v
        mpy     y0,x0,a     x:(r2)+,x1   ; K1M X ; K2M2
        mac     y1,x1,a     x:(r2)+,x1   ; ; K0MH4
        move    a,x:(r4)+                ; new s1
        mpy     y1,x1,a     x:(r4),y0    ; K0MH4 v ; s2
        add     y0,a        x:(r2)+,y0   ; w ; K1MH4
        move    a,x1                     ; w
        mpy     y1,y0,a     x:(r2)+,y1   ; K1MH4 v ; K2MH2
        mac     y1,x1,a
        move    a,x:(r4)+                ; new s2
        move    x1,a
        asl     #$2,a,a                  ; MID (x/2 scale)
{shaper()}        move    a,y1
        move    x:(r2)+,y0               ; mid gain
        mpy     y1,y0,a
        add     a,b
        move    x:(r7+$10),x0
; LOW: z = k0/2 X + s; LOW = 4z; s = k1/2 X + 2 k2 z
        move    x:(r2)+,y1               ; K0L2
        mpy     x0,y1,a     x:(r4),y0    ; ; s
        add     y0,a        x:(r2)+,y0   ; z ; K1L2
        move    a,y1                     ; z
        mpy     y0,x0,a     x:(r2)+,x1   ; K1L2 X ; K2L2
        mac     y1,x1,a
        move    a,x:(r4)+                ; new s
        move    y1,a
        asl     #$2,a,a                  ; LOW (x/2 scale)
{shaper()}        add     b,a                      ; y/4
        move    a,y1
        move    x:(r7+$09),y0            ; OG
        mpy     y1,y0,a
        asl     #$1,a,a                  ; / 4: INPUT_GAIN undone
        rts

; ---------------------------------------------------------------------------
; Per-block knob fits: four degree-5 segments over t (gen_constants.py).
; In: a = t. Out: a = the fitted value. Not reached from the sample loop.
; ---------------------------------------------------------------------------
{fit('fit_in', segs_in)}
{fit('fit_out', segs_out)}
upowers:
        move    a,x:(r7+$18)             ; u
        move    a,x0
        mpy     x0,x0,a
        move    a,x:(r7+$19)             ; u^2
        move    a,y1
        mpy     x0,y1,a
        move    a,x:(r7+$1a)             ; u^3
        move    a,y1
        mpy     x0,y1,a
        move    a,x:(r7+$1b)             ; u^4
        move    a,y1
        mpy     x0,y1,a
        move    a,x:(r7+$1c)             ; u^5
        rts

poly5:
        move    x:(r7+$1d),a             ; c0
        move    x:(r7+$18),y1
        move    x:(r7+$1e),y0
        mpy     y1,y0,b
        add     b,a
        move    x:(r7+$19),y1
        move    x:(r7+$1f),y0
        mpy     y1,y0,b
        add     b,a
        move    x:(r7+$1a),y1
        move    x:(r7+$20),y0
        mpy     y1,y0,b
        add     b,a
        move    x:(r7+$1b),y1
        move    x:(r7+$21),y0
        mpy     y1,y0,b
        add     b,a
        move    x:(r7+$1c),y1
        move    x:(r7+$22),y0
        mpy     y1,y0,b
        add     b,a
        rts
"""
open('inflator.asm', 'w').write(src)
