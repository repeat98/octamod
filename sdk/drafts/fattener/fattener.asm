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

init:
        clr     a
        move    r7,r2
        rep     #$100
        move    a,x:(r2)+                ; the whole block to zero
        move    #>$14,n2
        move    r7,r2
        move    (r2)+n2
        move    #>$fab1e0,r3             ; the P table: build_bus.py rewrites this
        move    r3,b
        do      #$8c,>icopy
        move    p:(r3)+,x0
        move    x0,x:(r2)+
icopy:
        move    b,x:(r7+$3b)             ; after the copy, which clears it
        move    #>$ffffff,a
        move    a,x:(r7+$24)             ; forces the COLOR precompute
        rts

proc:
; ---- FAT and GAIN -> K1/32 and E0 = (K2' + 20)/32, every block (affine) ----
        move    x:(r6+$0),x0             ; FAT t
        move    #>$010204,y0
        mpy     y0,x0,a
        add     x0,a                     ; f = t 128/127
        move    a,y1
        move    x:(r6+$2),x1             ; GAIN t
        move    #>$1FE3F8,y0
        mpy     x1,y0,a
        move    #>$1696D0,x0
        mac     x0,y1,a
        add     #>$04B819,a
        move    a,x:(r7+$20)
        move    #>$1FE3F8,y0
        mpy     x1,y0,a
        move    #>$19E93A,x0
        mac     x0,y1,a
        add     #>$44B819,a
        move    a,x:(r7+$21)
; ---- COLOR -> the soft clip's constants and the EQ, only when it changed ----
        move    x:(r6+$1),a
        move    x:(r7+$24),x0
        cmp     x0,a
        beq     cdone
        move    a,x:(r7+$24)
        bsr     color
cdone:
; ---- the gain for this block, from the envelope now: G = P 2^(k - 19) ----
        move    x:(r7+$3a),a
        or      #$1,a                    ; ls >= 1 LSB: log2 >= -23
        clb     a,b
        move    b1,x0
        normf   x0,a                     ; m in [0.5, 1)
        move    x0,b
        asl     #$12,b,b                 ; exponent/32
        move    b,y1
        move    x:(r7+$22),x1
        sub     x1,a
        move    a,x1                     ; z = m - 0.75
        lua     (r7+$2b),r2
        move    x:(r2)-,y0
        move    x:(r2)-,a
        mac     x1,y0,a   x:(r2)-,b
        move    a,y0
        mac     x1,y0,b   x:(r2)-,a
        move    b,y0
        mac     x1,y0,a   x:(r2)-,b
        move    a,y0
        mac     x1,y0,b   x:(r2)-,a
        move    b,y0
        mac     x1,y0,a   x:(r2)-,b
        add     y1,a                     ; log2(ls)/32
        move    x:(r7+$20),x0
        add     x0,a                     ; L/32
        move    #0,x1
        tlt     x1,a                     ; max(L, 0)
        move    a,x1
        move    x:(r7+$23),y1
        mpy     y1,x1,a
        neg     a
        move    x:(r7+$21),x0
        add     x0,a                     ; V/32 in (0, 1)
        asr     #$12,a,b                 ; floor(V)
        move    b1,y1
        and     #>$03ffff,a              ; frac/32
        asl     #$4,a,a
        move    a,x1                     ; z = frac/2
        lua     (r7+$30),r2
        move    x:(r2)-,y0
        move    x:(r2)-,a
        mac     x1,y0,a   x:(r2)-,b
        move    a,y0
        mac     x1,y0,b   x:(r2)-,a
        move    b,y0
        mac     x1,y0,a   x:(r2)-,b
        move    a,y0
        mac     x1,y0,b   x:(r2)-,a
        move    b,x:(r7+$33)             ; P, the target's mantissa
        move    #>$13,a
        move    y1,x0
        sub     x0,a                     ; SNt = 19 - k
        move    a1,x:(r7+$34)
; one shift for the block, SN = min(SNt, SNc): the ramp's ends share it
        move    x:(r7+$16),x0            ; SNc, the shift PGC is in
        cmp     x0,a
        tgt     x0,a
        move    a1,y0                    ; SN
; LIM = 1 >> max(-SN - 8, 0): |h PGC| above it would leave the guard bits
        neg     a
        move    #>$8,x0
        sub     x0,a
        move    #0,x0
        tlt     x0,a
        move    a1,x0
        move    #>$7fffff,a
        normf   x0,a
        move    a,x:(r7+$15)
        move    x:(r7+$16),a
        sub     y0,a                     ; SNc - SN >= 0
        move    a1,x0
        move    x:(r7+$14),a
        normf   x0,a                     ; S: where the gain is, in SN
        move    a,x1
        move    x:(r7+$34),a
        sub     y0,a                     ; SNt - SN >= 0
        move    a1,x0
        move    x:(r7+$33),a
        normf   x0,a
        move    a,b                      ; E
        sub     x1,b
        asr     #$4,b,b                  ; (E - S)/16
        move    b,x:(r7+$1d)
        move    x1,x:(r7+$14)
        move    y0,x:(r7+$16)
; ---- sample loop: r4 -> the newer state copy, r5 -> the older; modulo 12 ----
        move    #>$ffffff,m0
        move    #>$ffffff,m1
        move    #>$ffffff,m2
        move    #>$ffffff,m3
        move    x:(r7+$25),n4
        move    r7,r4
        move    (r4)+n4                  ; +0 or +6
        move    #>$6,a
        move    x:(r7+$25),x0
        sub     x0,a
        move    a,n5
        move    r7,r5
        move    (r5)+n5                  ; the other one
        move    #>$b,m4
        move    #>$b,m5
        move    #>$1,n0
        move    #>$1,n5
        move    #>$2,n3
        do      n7,>sloop
        bsr     frame
        move    (r0)+
        move    (r0)+
sloop:
        move    r4,a                     ; flip = r4 - r7, for the next call
        move    r7,x0
        sub     x0,a
        move    a,x:(r7+$25)
        move    #>$ffffff,m4
        move    #>$ffffff,m5
        rts

; frame: one stereo sample, straight-line (no branch, no call)
frame:
        lua     (r7+$0c),r3
; ---- L: HP 36.5 Hz, then the peak EQ; at x/8 ----
        move    x:(r0),a
        asr     #$3,a,a
        move    a,x0                     ; v0 = x/8
        lua     (r7+$3c),r1
        clr     a         x:(r1)+,y0     ; p1'
        clr     b         x:(r3)+,a0     ; e(n-1)
        move    x:(r3),b0                ; e(n-2)
        asl     a         a0,x:(r3)-     ; 2 e(n-1) ; e(n-1) -> the e(n-2) slot
        sub     b,a       x:(r4)+,x1     ; second-order error feedback ; in(n-1)
        mac     x1,y0,a   x:(r1)+,y0     ; p1' in(n-1) ; p2
        sub     x1,a      x:(r5),x1      ; - in(n-1) ; in(n-2)
        mac     x1,y0,a   x:(r1)+,y0     ; p2 in(n-2) ; -e1*128
        move    x:(r4),x1                ; out(n-1)
        mpy     x1,y0,b   x:(r1)+,y0     ; -e1 out(n-1) *128 ; e2*128
        add     x1,a
        add     x1,a      x:(r5+n5),x1   ; + 2 out(n-1) ; out(n-2)
        mac     x1,y0,b   x:(r1)+,y0     ; + e2 out(n-2) *128 ; p0'
        sub     x1,a                     ; - out(n-2)
        asr     #$7,b,b
        add     b,a                      ; poles: (2 - e1), (-1 + e2)
        mac     y0,x0,a   x0,x:(r5)+     ; p0' in ; in -> the older slot
        add     x0,a                     ; + in
        move    a0,x:(r3)+n3             ; residual e(n)
        move    a,x0                     ; the highpass's output
        clr     a         x:(r1)+,y0     ; p1'
        move    x:(r3),a0                ; e(n-1)
        move    x:(r4)+,x1               ; in(n-1)
        mac     x1,y0,a   x:(r1)+,y0     ; p1' in(n-1) ; p2
        sub     x1,a      x:(r5),x1      ; - in(n-1) ; in(n-2)
        mac     x1,y0,a   x:(r1)+,y0     ; p2 in(n-2) ; q1'
        move    x:(r4)+,x1               ; out(n-1)
        mac     x1,y0,a   x:(r1)+,y0     ; q1' out(n-1) ; q2
        add     x1,a      x:(r5+n5),x1   ; + out(n-1) ; out(n-2)
        mac     x1,y0,a   x:(r1)+,y0     ; q2 out(n-2) ; p0'
        mac     y0,x0,a   x0,x:(r5)+     ; p0' in ; in -> the older slot
        add     x0,a                     ; + in
        move    a0,x:(r3)+               ; residual
        move    a,x:(r5)+                ; v2 -> the older slot
        move    a,x:(r7+$31)               ; h_s = h/8
; ---- R: HP 36.5 Hz, then the peak EQ; at x/8 ----
        move    x:(r0+n0),a
        asr     #$3,a,a
        move    a,x0                     ; v0 = x/8
        lua     (r7+$3c),r1
        clr     a         x:(r1)+,y0     ; p1'
        clr     b         x:(r3)+,a0     ; e(n-1)
        move    x:(r3),b0                ; e(n-2)
        asl     a         a0,x:(r3)-     ; 2 e(n-1) ; e(n-1) -> the e(n-2) slot
        sub     b,a       x:(r4)+,x1     ; second-order error feedback ; in(n-1)
        mac     x1,y0,a   x:(r1)+,y0     ; p1' in(n-1) ; p2
        sub     x1,a      x:(r5),x1      ; - in(n-1) ; in(n-2)
        mac     x1,y0,a   x:(r1)+,y0     ; p2 in(n-2) ; -e1*128
        move    x:(r4),x1                ; out(n-1)
        mpy     x1,y0,b   x:(r1)+,y0     ; -e1 out(n-1) *128 ; e2*128
        add     x1,a
        add     x1,a      x:(r5+n5),x1   ; + 2 out(n-1) ; out(n-2)
        mac     x1,y0,b   x:(r1)+,y0     ; + e2 out(n-2) *128 ; p0'
        sub     x1,a                     ; - out(n-2)
        asr     #$7,b,b
        add     b,a                      ; poles: (2 - e1), (-1 + e2)
        mac     y0,x0,a   x0,x:(r5)+     ; p0' in ; in -> the older slot
        add     x0,a                     ; + in
        move    a0,x:(r3)+n3             ; residual e(n)
        move    a,x0                     ; the highpass's output
        clr     a         x:(r1)+,y0     ; p1'
        move    x:(r3),a0                ; e(n-1)
        move    x:(r4)+,x1               ; in(n-1)
        mac     x1,y0,a   x:(r1)+,y0     ; p1' in(n-1) ; p2
        sub     x1,a      x:(r5),x1      ; - in(n-1) ; in(n-2)
        mac     x1,y0,a   x:(r1)+,y0     ; p2 in(n-2) ; q1'
        move    x:(r4)+,x1               ; out(n-1)
        mac     x1,y0,a   x:(r1)+,y0     ; q1' out(n-1) ; q2
        add     x1,a      x:(r5+n5),x1   ; + out(n-1) ; out(n-2)
        mac     x1,y0,a   x:(r1)+,y0     ; q2 out(n-2) ; p0'
        mac     y0,x0,a   x0,x:(r5)+     ; p0' in ; in -> the older slot
        add     x0,a                     ; + in
        move    a0,x:(r3)+               ; residual
        move    a,x:(r5)+                ; v2 -> the older slot
        move    a,x:(r7+$32)               ; h_s = h/8
; ---- envelope of max(|L|, |R|), every sample, with its error word ----
        abs     a
        move    x:(r7+$31),b
        abs     b
        cmp     b,a
        tlt     b,a                      ; lv
        move    x:(r7+$3a),x1
        sub     x1,a                     ; d = lv - ls
        move    x:(r7+$1f),b
        move    x:(r7+$1e),y1
        tgt     y1,b                     ; rising: attack, else release
        move    a,x0
        move    b,y1
        clr     a
        move    x:(r7+$39),a0
        mac     x0,y1,a
        add     x1,a                     ; ls + k d
        move    a0,x:(r7+$39)
        move    a,x:(r7+$3a)
; ---- the gain ramps across the block ----
        move    x:(r7+$14),a
        move    x:(r7+$1d),x0
        add     x0,a
        move    a,x:(r7+$14)
; ---- L: gain, then the soft clip, select-free: ----
;      out = 4 (min(|y|, t) fg + (1-t) fg/16 tanh(max(|y| - t, 0)/(1-t))), signed
        lua     (r7+$14),r2      ; the constants, in order
        move    x:(r7+$31),x0
        move    x:(r2)+,y1               ; PGC
        mpy     x0,y1,a   x:(r2)+,x1     ; h PGC ; LIM
        abs     a
        cmp     x1,a      x:(r2)+,y0     ; SN
        tgt     x1,a                     ; under LIM: the shift stays in the guard
        normf   y0,a                     ; |y_s| = |y|/16
        tfr     a,b       x:(r2)+,x1     ; TS = t/16
        cmp     x1,b      x:(r2)+,y1     ; DMAX
        tgt     x1,b                     ; m = min(|y_s|, t/16)
        sub     b,a       x:(r2)+,y0     ; d = |y_s| - m ; PM
        cmp     y1,a
        tgt     y1,a                     ; d in [0, Dmax]
        move    a,x1
        mpy     x1,y0,a   x:(r2)+,x1     ; d PM ; NPE
        normf   x1,a                     ; u/16 = d/(1 - t)
        move    b,y1                     ; m
        asr     #$10,a,b                 ; i = floor(8u)
        move    b1,n1
        and     #>$00ffff,a
        asl     #$6,a,a                  ; frac/2
        move    a,y0
        lua     (r1)+n1,r3               ; r1 sits on the tanh table
        move    x:(r3)+,x0               ; T(i)
        move    x:(r3),a                 ; T(i+1)
        sub     x0,a
        move    a,x1
        mpy     x1,y0,a   x:(r2)+,y0     ; ; LIN = fg
        asl     a
        add     x0,a                     ; tanh(u)
        move    a,x1
        mpy     y1,y0,b   x:(r2)+,y0     ; m fg ; D4 = (1 - t) fg/16
        mac     x1,y0,b                  ; + (1 - t) fg/16 tanh
        asl     #$2,b,b
        move    b,x0
        neg     b
        move    x:(r7+$31),a
        tst     a
        tge     x0,b                     ; the sign of h, which is y's
        move    b,x:(r0)
; ---- R: gain, then the soft clip, select-free: ----
;      out = 4 (min(|y|, t) fg + (1-t) fg/16 tanh(max(|y| - t, 0)/(1-t))), signed
        lua     (r7+$14),r2      ; the constants, in order
        move    x:(r7+$32),x0
        move    x:(r2)+,y1               ; PGC
        mpy     x0,y1,a   x:(r2)+,x1     ; h PGC ; LIM
        abs     a
        cmp     x1,a      x:(r2)+,y0     ; SN
        tgt     x1,a                     ; under LIM: the shift stays in the guard
        normf   y0,a                     ; |y_s| = |y|/16
        tfr     a,b       x:(r2)+,x1     ; TS = t/16
        cmp     x1,b      x:(r2)+,y1     ; DMAX
        tgt     x1,b                     ; m = min(|y_s|, t/16)
        sub     b,a       x:(r2)+,y0     ; d = |y_s| - m ; PM
        cmp     y1,a
        tgt     y1,a                     ; d in [0, Dmax]
        move    a,x1
        mpy     x1,y0,a   x:(r2)+,x1     ; d PM ; NPE
        normf   x1,a                     ; u/16 = d/(1 - t)
        move    b,y1                     ; m
        asr     #$10,a,b                 ; i = floor(8u)
        move    b1,n1
        and     #>$00ffff,a
        asl     #$6,a,a                  ; frac/2
        move    a,y0
        lua     (r1)+n1,r3               ; r1 sits on the tanh table
        move    x:(r3)+,x0               ; T(i)
        move    x:(r3),a                 ; T(i+1)
        sub     x0,a
        move    a,x1
        mpy     x1,y0,a   x:(r2)+,y0     ; ; LIN = fg
        asl     a
        add     x0,a                     ; tanh(u)
        move    a,x1
        mpy     y1,y0,b   x:(r2)+,y0     ; m fg ; D4 = (1 - t) fg/16
        mac     x1,y0,b                  ; + (1 - t) fg/16 tanh
        asl     #$2,b,b
        move    b,x0
        neg     b
        move    x:(r7+$32),a
        tst     a
        tge     x0,b                     ; the sign of h, which is y's
        move    b,x:(r0+n0)
        rts

; color: COLOR -> TS, DMAX, PM, NPE, D4 and the EQ's five words (17 designs,
; linear between them). Per block, only when COLOR changed.
color:
        move    x:(r6+$1),x0             ; t = v/128
        move    #>$010204,y0
        mpy     y0,x0,a
        add     x0,a                     ; c = v/127
        move    a,x:(r7+$35)
        move    a,x0
        move    #>$00CCCD,y0
        mpy     y0,x0,a
        add     #>$073333,a
        move    a,x:(r7+$17)               ; t/16
; 1 - c = om 128/127, om = (127 - v)/128 exactly
        move    #>$7f0000,a
        move    x:(r6+$1),x0
        sub     x0,a
        move    a,x:(r7+$36)             ; om
        move    a,x0
        move    #>$08DE8A,y0
        mpy     y0,x0,a
        move    a,x:(r7+$18)              ; 11 (1 - t)/16
        move    #>$00CC0D,y0
        mpy     y0,x0,a
        move    a,x:(r7+$1c)               ; (1 - t) fg/16
        move    x:(r7+$36),a
        tst     a
        bne     csoft
        clr     a                        ; COLOR 127: the JSFX's hard clip
        move    a,x:(r7+$19)
        move    a,x:(r7+$1a)
        bra     ceq
csoft:
; 1/(1 - t) = 10/(1 - c) = 9.921875/om = PM 2^-NPE
        clb     a,b
        move    b1,x0
        normf   x0,a                     ; mo in [0.5, 1)
        move    x0,b
        move    b1,x:(r7+$37)             ; q = log2(om/mo) <= 0
        move    a,x1
        move    #>$200000,a              ; 0.25
        andi    #$fe,ccr
        rep     #$18
        div     x1,a
        move    a0,x0                    ; 0.25/mo in (0.25, 0.5]
        move    #>$4F6000,y0
        mpy     y0,x0,a
        move    a,x:(r7+$19)
        move    x:(r7+$37),a
        move    #>$6,x0
        sub     x0,a                     ; q - 6: left shift by 6 - q
        move    a1,x:(r7+$1a)
ceq:
; the EQ: x = 16 c, i = floor(x) (15 at c = 1), f = x - i
        move    x:(r7+$35),a
        tfr     a,b
        asr     #$13,b,b                 ; i
        and     #>$07ffff,a
        asl     #$4,a,a                  ; f
        move    #>$10,x0
        cmp     x0,b
        blt     cseg
        move    #>$f,b                   ; c = 1: the last segment at f = 1
        move    #>$7fffff,a
cseg:
        move    a,y1                     ; f
        move    b1,x0
        move    #>$5,y0
        mpy     y0,x0,b
        asr     b
        move    b0,b
        add     #>$8c,b              ; the designs follow init's words
        move    x:(r7+$3b),x0
        add     x0,b
        move    b1,r2                    ; design i
        move    #>$5,n3
        move    r2,r3
        move    (r3)+n3                  ; the next design
        move    #>$41,n4
        move    r7,r4
        move    (r4)+n4
        do      #$5,>cint
        move    p:(r2)+,x0
        move    p:(r3)+,a
        sub     x0,a
        move    a,x1
        mpy     y1,x1,a
        add     x0,a
        move    a,x:(r4)+
cint:
        rts

