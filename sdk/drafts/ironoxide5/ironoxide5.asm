; ---------------------------------------------------------------------------
; IRONOXIDE5 -- Octamod DSP insert, port of Airwindows IronOxide5 (MIT,
; Copyright (c) 2016 airwindows): tape emulation. Per channel: a one-pole
; "tape low" highpass, an input-gain sin() saturator, a leaky-integrator
; "tape speed" stage, an output sin() saturator, then output trim and the
; plugin's inv/dry/wet. Like the plugin, every state alternates between two
; independent copies (A and B) on alternate samples.
;
; Not implemented (knobs D and E of the plugin): flutter and noise. With
; D = 0 the plugin's flutter stage passes the input unchanged and with E = 0
; its noise stage does nothing, so this is the plugin at D = E = 0. The
; plugin's 32-tap slow filter is dead code in the shipped source (gcount is
; never decremented, every tap reads an unwritten slot), so it is absent.
;
; History: written in octabam (13 Sep 2026; passed make check, never heard).
; Ported to Octamod 2 Oct 2026. The first render against the plugin's own
; float code (reference.py) measured a peak error of 0.64 at the defaults.
; The per-sample path was rewritten; the per-block coefficient fits were
; measured correct and are kept. What was wrong in the octabam path:
;   1. The squaring of the saturator's argument was `mpy y0,y1`, which
;      dsp_asm encodes as mpysu: for a negative argument t it computed
;      t*(t+2) instead of t^2, so the negative half of both saturators was
;      wrong.
;   2. Every branchless min stage returned 2*min (no final /2), so both
;      saturators ran at twice their input.
;   3. The A/B selection put a data value in n7, the dispatcher's frame
;      count. It now uses r4/r5 (linear, set here), swapped every sample.
;
; Scaling (true value = stored word * 2^shift):
;   iir state shift0, x - iir and x1 shift1, inputgain shift3, x2 shift6
;   (it carries INPUT_GAIN: the same word read as 4*inputgain at shift5),
;   fast state shift4 (its gain 1/(1-decay) reaches 10.1), outscale shift2,
;   x6 shift6, sin argument T = t/2 (shift1), T^2 shift2, wetgain shift3.
;   Clamps to +-pi/2 are cmp + Tcc on the accumulator.
;
; The saturators use a degree-5 minimax sine (error 6.8e-5 on [0, pi/2]).
;
; INPUT_GAIN = 4 (+12.04 dB), added 2 Oct 2026 after a hardware listen
; ("saturates less than the plugin"). The unit applies AMP VOL as (v/127)^2
; BEFORE the FX chain, so at the default VOL 64 a 0 dBFS sample arrives at
; 0.254 FS, 12 dB below what the plugin sees in a DAW; at INPUT 64 that was
; 24 dB less THD. The module now computes plugin(4x)/4. The highpass and the
; dry path are linear, so that is exactly inputgain*4 and outputgain/4: the
; INPUTGAIN word is read at shift5 instead of shift3 (x2 at shift6, the
; first clamp and T's shift move with it) and the wet sum shifts left 2
; instead of 4. No word or cycle is added. TapeHead 0.1.2 made the same fix.
;
; Every mpy uses a pair dsp_asm encodes as a SIGNED mpy (y1,y0 / y0,y0 /
; y1,x1 / y0,x0 / x0,x0); verify.py checks that no mpysu remains.
;
; r7 memory map:
;   $00/$01   iir L, copy 0/1         $02/$03   fast L, copy 0/1
;   $04/$05   iir R, copy 0/1         $06/$07   fast R, copy 0/1
;   $08       flip (0/1): which copy the next sample uses
;   $09 INPUTGAIN (shift3)  $0a OUTPUTGAIN (shift3)  $0b FASTDECAY
;   $0c OUTSCALE (shift2)   $0d IIRAMOUNT            $0e DRY
;   $0f WETGAIN (shift3)    $10-$1a poly6 staging (per block)
;   $1b KEEP = 1 - IIRAMOUNT
;
; Knobs (page 1, value<<16 = value/128): 0 INPUT, 1 HIGH (ips), 2 LOW (lps),
; 3 OUT, 4 MIX. MIX is a plain dry/wet, scaled by 128/127 so 127 is fully
; wet and 0 is dry (the upper half of the plugin's inv/dry/wet knob).
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
        move    a,x:(r7+$8)
        rts

; ---------------------------------------------------------------------------
proc:
; ---- precompute (once per call): all branches here are outside the
; sample loop, so ordinary conditional branches are fine (same reasoning as
; tapehead.asm's own Color select). WORD-COUNT OPTIMIZATION PASS (see file
; header "SIZE OPTIMIZATION" note): the u-power-staging math (u^1..u^5,
; degree-5 Horner prep) used to be inlined three separate times (once each
; for FASTDECAY/OUTSCALE's shared t_B, INPUTGAIN's t_A, OUTPUTGAIN's t_F)
; plus a fourth time for IIRAMOUNT's t_C -- now ONE shared `stage_upowers`
; subroutine (defined near poly6, below), called via `bsr` from each site.
; Safe here (unlike inside channel_l/channel_r) because precompute is never
; reached from the sample loop -- ordinary nested bsr is fine, same as the
; existing `bsr poly6` calls this section already made before this pass.
; TRIMGAIN(t) (the fit shared by INPUTGAIN and OUTPUTGAIN) is now its own
; `trimgain_fit` subroutine for the same reason -- it used to be two
; byte-identical ~110-line blocks differing only in which r6 slot fed them.
; Each piecewise fit below also used to re-derive its own segment a SECOND
; time (once to stage u-powers, again just to pick which coefficient table
; to load) -- removed: coefficients are now loaded in the SAME branch
; target where the segment was first (and only) determined. -------------

; ---- FASTDECAY & OUTSCALE: both are functions of knob B (t_B), same
; segment/u -- one 4-way select; each segment loads its own u then both
; coefficient sets directly, no re-detection. ----------------------------
        move    x:(r6+$1),a              ; t_B
        move    #>$200000,x0             ; QUARTER
        cmp     x0,a
        blt     b_seg0
        move    #>$400000,x0             ; HALF
        cmp     x0,a
        blt     b_seg1
        move    #>$600000,x0             ; THREEQ
        cmp     x0,a
        blt     b_seg2
; seg3: t_B >= THREEQ
        move    #>$600000,x0
        sub     x0,a
        asl     #$2,a,a                  ; u = (t_B-seg_lo)*4
        bsr     stage_upowers
        move    #>$1C18DC,a
        move    a,x:(r7+$15)             ; FASTDECAY p0
        move    #>$E3A7B8,a
        move    a,x:(r7+$16)             ; p1
        move    #>$0E842C,a
        move    a,x:(r7+$17)             ; p2
        move    #>$FC220C,a
        move    a,x:(r7+$18)             ; p3
        move    #>$0015F4,a
        move    a,x:(r7+$19)             ; p4
        move    #>$002DF4,a
        move    a,x:(r7+$1a)             ; p5
        bsr     poly6
        move    a,x:(r7+$0b)             ; FASTDECAY (shift0, no undo needed)
        move    #>$4AED5A,a
        move    a,x:(r7+$15)             ; OUTSCALE p0 (already /4, shift2)
        move    #>$154235,a
        move    a,x:(r7+$16)
        move    #>$F51CDE,a
        move    a,x:(r7+$17)
        move    #>$02E676,a
        move    a,x:(r7+$18)
        move    #>$FFEF88,a
        move    a,x:(r7+$19)
        move    #>$FFDD88,a
        move    a,x:(r7+$1a)
        bsr     poly6
        move    a,x:(r7+$0c)             ; OUTSCALE (already shift2, no asl)
        bra     b_done
b_seg0:
        asl     #$2,a,a                  ; seg_lo=0: u = t_B*4
        bsr     stage_upowers
        move    #>$735079,a
        move    a,x:(r7+$15)
        move    #>$000A66,a
        move    a,x:(r7+$16)
        move    #>$FF9CBF,a
        move    a,x:(r7+$17)
        move    #>$016ADA,a
        move    a,x:(r7+$18)
        move    #>$F9557E,a
        move    a,x:(r7+$19)
        move    #>$0156DC,a
        move    a,x:(r7+$1a)
        bsr     poly6
        move    a,x:(r7+$0b)
        move    #>$0983A4,a
        move    a,x:(r7+$15)
        move    #>$FFF833,a
        move    a,x:(r7+$16)
        move    #>$004A70,a
        move    a,x:(r7+$17)
        move    #>$FEEFDB,a
        move    a,x:(r7+$18)
        move    #>$04FFE0,a
        move    a,x:(r7+$19)
        move    #>$FEFEDA,a
        move    a,x:(r7+$1a)
        bsr     poly6
        move    a,x:(r7+$0c)
        bra     b_done
b_seg1:
        move    #>$200000,x0
        sub     x0,a
        asl     #$2,a,a
        bsr     stage_upowers
        move    #>$6F1023,a
        move    a,x:(r7+$15)
        move    #>$EF6E6D,a
        move    a,x:(r7+$16)
        move    #>$EB8F7F,a
        move    a,x:(r7+$17)
        move    #>$EFB5CB,a
        move    a,x:(r7+$18)
        move    #>$107C69,a
        move    a,x:(r7+$19)
        move    #>$FD3C60,a
        move    a,x:(r7+$1a)
        bsr     poly6
        move    a,x:(r7+$0b)
        move    #>$0CB3E5,a
        move    a,x:(r7+$15)
        move    #>$0C6D2D,a
        move    a,x:(r7+$16)
        move    #>$0F5460,a
        move    a,x:(r7+$17)
        move    #>$0C37A7,a
        move    a,x:(r7+$18)
        move    #>$F3A2B0,a
        move    a,x:(r7+$19)
        move    #>$0212B7,a
        move    a,x:(r7+$1a)
        bsr     poly6
        move    a,x:(r7+$0c)
        bra     b_done
b_seg2:
        move    #>$400000,x0
        sub     x0,a
        asl     #$2,a,a
        bsr     stage_upowers
        move    #>$477B7F,a
        move    a,x:(r7+$15)
        move    #>$C9B4D4,a
        move    a,x:(r7+$16)
        move    #>$000022,a
        move    a,x:(r7+$17)
        move    #>$13902F,a
        move    a,x:(r7+$18)
        move    #>$F5788D,a
        move    a,x:(r7+$19)
        move    #>$01DF78,a
        move    a,x:(r7+$1a)
        bsr     poly6
        move    a,x:(r7+$0b)
        move    #>$2A6360,a
        move    a,x:(r7+$15)
        move    #>$28B860,a
        move    a,x:(r7+$16)
        move    #>$FFFFE6,a
        move    a,x:(r7+$17)
        move    #>$F153DC,a
        move    a,x:(r7+$18)
        move    #>$07E596,a
        move    a,x:(r7+$19)
        move    #>$FE9865,a
        move    a,x:(r7+$1a)
        bsr     poly6
        move    a,x:(r7+$0c)
b_done:

; ---- IIRAMOUNT: single degree-5 fit from t_C, no segmentation needed
; (exactly proportional to t^4 -- see gen_ironoxide5_constants.py); u = t_C
; directly, no offset/asl -- reuses the same shared stage_upowers. --------
        move    x:(r6+$2),a              ; t_C = u directly
        bsr     stage_upowers
        move    #>$007DBC,a
        move    a,x:(r7+$15)
        move    #>$FFFFFF,a
        move    a,x:(r7+$16)
        move    #>$000000,a
        move    a,x:(r7+$17)
        move    #>$FFFFFF,a
        move    a,x:(r7+$18)
        move    #>$30A007,a
        move    a,x:(r7+$19)
        move    #>$FFFFFF,a
        move    a,x:(r7+$1a)
        bsr     poly6
        move    a,x:(r7+$0d)             ; IIRAMOUNT (shift0)
        move    a,x0
        move    #>$800000,b
        neg     b                        ; 1.0, held in b
        sub     x0,b
        move    b,x:(r7+$1b)             ; KEEP = 1 - IIRAMOUNT

; ---- INPUTGAIN / OUTPUTGAIN: the shared -18..+18 dB fit ------------------
        move    x:(r6+$0),a              ; INPUT
        bsr     trimgain_fit
        move    a,x:(r7+$09)             ; INPUTGAIN (shift3)
        move    x:(r6+$3),a              ; OUTPUT
        bsr     trimgain_fit
        move    a,x:(r7+$0a)             ; OUTPUTGAIN (shift3)

; ---- MIX: a plain dry/wet. wet = raw/127 (127 -> 1.0), dry = 1 - wet. --
; The plugin's knob is inv/dry/wet (0 = dry plus INVERTED wet, 0.5 = dry);
; MIX covers its upper half, so MIX = 0 is dry and the tape path is silent.
        move    x:(r6+$4),x0             ; raw/128
        move    #>$010204,y0             ; 1/127
        mpy     y0,x0,a                  ; raw/128/127
        add     x0,a                     ; wet = raw/127, held in a
        move    a,b                      ; keep the unsaturated value
        move    a,x:(r7+$10)             ; wet, limited to 0.99999
        tst     b
        ble     g_dry_max
        move    #>$800000,x0
        add     x0,b                     ; wet - 1
        neg     b                        ; dry = 1 - wet (0 at 127)
        bra     g_dry_done
g_dry_max:
        move    #>$7FFFFF,b              ; dry = 1.0
g_dry_done:
        move    b,x:(r7+$0e)             ; DRY

        move    x:(r7+$0a),y1            ; OUTPUTGAIN (shift3)
        move    x:(r7+$10),y0            ; wet
        mpy     y1,y0,a
        move    a,x:(r7+$0f)             ; WETGAIN (shift3)

; ---- A/B pointers: r4 = r7 + flip (this sample), r5 = the other copy -----
        move    #>$ffffff,m4
        move    #>$ffffff,m5
        move    r7,b
        move    x:(r7+$08),x0
        add     x0,b
        move    b,r4
        move    r7,b
        move    #>$1,a
        sub     x0,a
        move    a,x0
        add     x0,b
        move    b,r5

; ---- sample loop -----------------------------------------------------------
        move    #>$ffffff,m0
        move    #>$1,n0
        do      n7,>oxend
        move    x:(r0),a
        bsr     channel_l
        move    a,x:(r0)
        move    x:(r0+n0),a
        bsr     channel_r
        move    a,x:(r0+n0)
        move    r4,x1                    ; swap the copies for the next sample
        move    r5,r4
        move    x1,r5
        move    #>$2,n0
        move    (r0)+n0
        move    #>$1,n0
oxend:
        move    r4,a                     ; flip = r4 - r7, kept for the next call
        move    r7,x0
        sub     x0,a
        move    a,x:(r7+$08)
        rts

; ---------------------------------------------------------------------------
channel_l:
        move    a,x0                     ; x, kept for the dry path
        move    x:(r4+$0),b          ; iir (this sample's copy)
        sub     b,a                      ; x - iir, up to 2
        asr     #$1,a,a
        move    a,y1
        move    x:(r7+$1b),y0            ; KEEP = 1 - IIRAMOUNT
        mpy     y1,y0,a                  ; x1 = (x - iir)*KEEP (shift1)
        move    a,y1
        asl     #$1,a,a
        move    x0,b
        sub     a,b                      ; new iir = x - x1
        move    b,x:(r4+$0)
        move    x:(r7+$09),y0            ; INPUTGAIN (shift3)
        mpy     y1,y0,a                  ; x2 = t = 4*x1*inputgain (shift6)
        move    #>$03243F,x1               ; +pi/2 at this shift
        cmp     x1,a
        tgt     x1,a
        move    #>$FCDBC1,x1               ; -pi/2
        cmp     x1,a
        tlt     x1,a
        asl     #$5,a,a                  ; T = t/2
        move    a,y0                     ; T
        mpy     y0,y0,a                  ; T^2 (shift2)
        move    a,y1
        move    #>$00F63B,x1             ; c5
        mpy     y1,x1,a
        asl     #$2,a,a
        move    #>$EACB3A,x1             ; c3
        add     x1,a
        move    a,x1
        mpy     y1,x1,a
        asl     #$2,a,a
        move    #>$7FF610,x1             ; c1
        add     x1,a                     ; h = sin(t)/t
        move    a,y1
        mpy     y1,y0,a                  ; sin(t) at shift1
        move    a,b
        asr     #$3,b,b                  ; x3 (shift4)
        move    x:(r4+$2),y1        ; fast (shift4)
        move    x:(r7+$0b),y0            ; FASTDECAY
        mpy     y1,y0,a
        add     b,a                      ; fast*decay + x3
        move    a,x:(r4+$2)
        move    a,y1
        move    x:(r7+$0c),y0            ; OUTSCALE (shift2)
        mpy     y1,y0,a                  ; x6 (shift6)
        move    #>$03243F,x1               ; +pi/2 at this shift
        cmp     x1,a
        tgt     x1,a
        move    #>$FCDBC1,x1               ; -pi/2
        cmp     x1,a
        tlt     x1,a
        asl     #$5,a,a                  ; T = t/2
        move    a,y0                     ; T
        mpy     y0,y0,a                  ; T^2 (shift2)
        move    a,y1
        move    #>$00F63B,x1             ; c5
        mpy     y1,x1,a
        asl     #$2,a,a
        move    #>$EACB3A,x1             ; c3
        add     x1,a
        move    a,x1
        mpy     y1,x1,a
        asl     #$2,a,a
        move    #>$7FF610,x1             ; c1
        add     x1,a                     ; h = sin(t)/t
        move    a,y1
        mpy     y1,y0,a                  ; sin(t) at shift1
        move    a,y1                     ; wet (shift1)
        move    x:(r7+$0f),y0            ; WETGAIN (shift3)
        mpy     y1,y0,a
        asl     #$2,a,a                  ; wet/4: INPUT_GAIN undone (was #$4)
        move    x0,y1
        move    x:(r7+$0e),y0            ; DRY
        mac     y1,y0,a                  ; + x*dry
        rts

channel_r:
        move    a,x0                     ; x, kept for the dry path
        move    x:(r4+$4),b          ; iir (this sample's copy)
        sub     b,a                      ; x - iir, up to 2
        asr     #$1,a,a
        move    a,y1
        move    x:(r7+$1b),y0            ; KEEP = 1 - IIRAMOUNT
        mpy     y1,y0,a                  ; x1 = (x - iir)*KEEP (shift1)
        move    a,y1
        asl     #$1,a,a
        move    x0,b
        sub     a,b                      ; new iir = x - x1
        move    b,x:(r4+$4)
        move    x:(r7+$09),y0            ; INPUTGAIN (shift3)
        mpy     y1,y0,a                  ; x2 = t = 4*x1*inputgain (shift6)
        move    #>$03243F,x1               ; +pi/2 at this shift
        cmp     x1,a
        tgt     x1,a
        move    #>$FCDBC1,x1               ; -pi/2
        cmp     x1,a
        tlt     x1,a
        asl     #$5,a,a                  ; T = t/2
        move    a,y0                     ; T
        mpy     y0,y0,a                  ; T^2 (shift2)
        move    a,y1
        move    #>$00F63B,x1             ; c5
        mpy     y1,x1,a
        asl     #$2,a,a
        move    #>$EACB3A,x1             ; c3
        add     x1,a
        move    a,x1
        mpy     y1,x1,a
        asl     #$2,a,a
        move    #>$7FF610,x1             ; c1
        add     x1,a                     ; h = sin(t)/t
        move    a,y1
        mpy     y1,y0,a                  ; sin(t) at shift1
        move    a,b
        asr     #$3,b,b                  ; x3 (shift4)
        move    x:(r4+$6),y1        ; fast (shift4)
        move    x:(r7+$0b),y0            ; FASTDECAY
        mpy     y1,y0,a
        add     b,a                      ; fast*decay + x3
        move    a,x:(r4+$6)
        move    a,y1
        move    x:(r7+$0c),y0            ; OUTSCALE (shift2)
        mpy     y1,y0,a                  ; x6 (shift6)
        move    #>$03243F,x1               ; +pi/2 at this shift
        cmp     x1,a
        tgt     x1,a
        move    #>$FCDBC1,x1               ; -pi/2
        cmp     x1,a
        tlt     x1,a
        asl     #$5,a,a                  ; T = t/2
        move    a,y0                     ; T
        mpy     y0,y0,a                  ; T^2 (shift2)
        move    a,y1
        move    #>$00F63B,x1             ; c5
        mpy     y1,x1,a
        asl     #$2,a,a
        move    #>$EACB3A,x1             ; c3
        add     x1,a
        move    a,x1
        mpy     y1,x1,a
        asl     #$2,a,a
        move    #>$7FF610,x1             ; c1
        add     x1,a                     ; h = sin(t)/t
        move    a,y1
        mpy     y1,y0,a                  ; sin(t) at shift1
        move    a,y1                     ; wet (shift1)
        move    x:(r7+$0f),y0            ; WETGAIN (shift3)
        mpy     y1,y0,a
        asl     #$2,a,a                  ; wet/4: INPUT_GAIN undone (was #$4)
        move    x0,y1
        move    x:(r7+$0e),y0            ; DRY
        mac     y1,y0,a                  ; + x*dry
        rts

; ---------------------------------------------------------------------------
trimgain_fit:
        move    #>$200000,x0             ; QUARTER
        cmp     x0,a
        blt     tg_seg0
        move    #>$400000,x0             ; HALF
        cmp     x0,a
        blt     tg_seg1
        move    #>$600000,x0             ; THREEQ
        cmp     x0,a
        blt     tg_seg2
; seg3: t >= THREEQ
        move    #>$600000,x0
        sub     x0,a
        asl     #$2,a,a                  ; u = (t-seg_lo)*4
        bsr     stage_upowers
        move    #>$2D1810,a
        move    a,x:(r7+$15)
        move    #>$2EBAFC,a
        move    a,x:(r7+$16)
        move    #>$1826F5,a
        move    a,x:(r7+$17)
        move    #>$0893AC,a
        move    a,x:(r7+$18)
        move    #>$01C70D,a
        move    a,x:(r7+$19)
        move    #>$00C2EA,a
        move    a,x:(r7+$1a)
        bsr     poly6
        rts
tg_seg0:
        asl     #$2,a,a                  ; seg_lo=0: u = t*4
        bsr     stage_upowers
        move    #>$0203A7,a
        move    a,x:(r7+$15)
        move    #>$02165D,a
        move    a,x:(r7+$16)
        move    #>$01142E,a
        move    a,x:(r7+$17)
        move    #>$006213,a
        move    a,x:(r7+$18)
        move    #>$001453,a
        move    a,x:(r7+$19)
        move    #>$0008B4,a
        move    a,x:(r7+$1a)
        bsr     poly6
        rts
tg_seg1:
        move    #>$200000,x0
        sub     x0,a
        asl     #$2,a,a
        bsr     stage_upowers
        move    #>$05AD4F,a
        move    a,x:(r7+$15)
        move    #>$05E20C,a
        move    a,x:(r7+$16)
        move    #>$030A63,a
        move    a,x:(r7+$17)
        move    #>$01146B,a
        move    a,x:(r7+$18)
        move    #>$003949,a
        move    a,x:(r7+$19)
        move    #>$001889,a
        move    a,x:(r7+$1a)
        bsr     poly6
        rts
tg_seg2:
        move    #>$400000,x0
        sub     x0,a
        asl     #$2,a,a
        bsr     stage_upowers
        move    #>$0FFFFD,a
        move    a,x:(r7+$15)
        move    #>$1094A0,a
        move    a,x:(r7+$16)
        move    #>$0891CB,a
        move    a,x:(r7+$17)
        move    #>$030B0E,a
        move    a,x:(r7+$18)
        move    #>$00A175,a
        move    a,x:(r7+$19)
        move    #>$004528,a
        move    a,x:(r7+$1a)
        bsr     poly6
        rts

; ---------------------------------------------------------------------------
; stage_upowers -- shared u-power staging for every piecewise/single poly6
; fit in this file (FASTDECAY, OUTSCALE, IIRAMOUNT, TRIMGAIN). Used to be
; inlined separately at each call site (four near-identical ~17-line
; copies); now one shared subroutine, bsr-called. Precompute-only, never
; reached from the sample loop, so ordinary nested bsr (this calls nothing
; itself, but is itself reached via bsr from other precompute subroutines
; like trimgain_fit) is fine -- see file header "SIZE OPTIMIZATION" note.
; In: a = u (already segment-offset-adjusted where applicable, Q1.23).
; Out: r7+$10..$14 staged with u^1..u^5. Clobbers: a,x0,x1,y1.
; ---------------------------------------------------------------------------
stage_upowers:
        move    a,x:(r7+$10)             ; u^1
        move    a,x0
        move    a,x1
        mpy     x0,x0,a                  ; u^2 (u always >=0 -- safe as
                                          ; x0,x1 here since BOTH operands
                                          ; are the SAME known-nonneg value;
                                          ; no sign risk regardless of
                                          ; pairing)
        move    a,x:(r7+$11)
        move    a,y1
        mpy     x0,y1,a                  ; u^3
        move    a,x:(r7+$12)
        move    a,y1
        mpy     x0,y1,a                  ; u^4
        move    a,x:(r7+$13)
        move    a,y1
        mpy     x0,y1,a                  ; u^5
        move    a,x:(r7+$14)
        rts

; ---------------------------------------------------------------------------
; poly6 -- shared degree-5 polynomial evaluator: p0 + p1*x + p2*x^2 + ... +
; p5*x^5. Caller stages x^1..x^5 at r7+$10..$14 and p0..p5 at r7+$15..$1a
; before calling. Returns the RAW (un-shifted) accumulator sum in `a` --
; every caller here needs no undo-shift (FASTDECAY/IIRAMOUNT: headroom
; shift0; OUTSCALE/TRIMGAIN: their coefficients are ALREADY pre-divided by
; the target headroom by gen_ironoxide5_constants.py, so the raw poly6 sum
; IS the correctly-shifted stored value, same idea as storing already-
; scaled coefficients rather than shifting the sum afterward -- a small
; deviation from tapehead.asm's own poly6 caller convention, which shifts
; the SUM afterward instead; both are equivalent, this one was simpler
; given every TRIMGAIN/OUTSCALE caller site already needed the coefficients
; pre-scaled for gen_ironoxide5_constants.py's own reporting). Copied from
; tapehead.asm's own poly6 (same staging shape, same y1=variable-first/
; y0=coefficient-second mpy order -- same open, accepted risk, see file
; header risk #2). -----------------------------------------------------
poly6:
        move    x:(r7+$15),a             ; c0 (seed -- p0*x^0)

        move    x:(r7+$10),y1            ; x^1 (variable, first)
        move    x:(r7+$16),y0            ; c1 (coefficient, second)
        mpy     y1,y0,b
        add     b,a

        move    x:(r7+$11),y1            ; x^2
        move    x:(r7+$17),y0            ; c2
        mpy     y1,y0,b
        add     b,a

        move    x:(r7+$12),y1            ; x^3
        move    x:(r7+$18),y0            ; c3
        mpy     y1,y0,b
        add     b,a

        move    x:(r7+$13),y1            ; x^4
        move    x:(r7+$19),y0            ; c4
        mpy     y1,y0,b
        add     b,a

        move    x:(r7+$14),y1            ; x^5
        move    x:(r7+$1a),y0            ; c5
        mpy     y1,y0,b
        add     b,a
        rts
