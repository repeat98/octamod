"""INFLATOR -- port of JClones_OInflator.jsfx (MIT, Copyright (c) 2026
JClones), a clone of the Oxford Inflator: the odd waveshaper g(1 - |g|)
blended with the dry signal by EFFECT, its shape set by CURVE, optionally
in three bands split at 240 Hz and 2.4 kHz. No oversampling, as in the JSFX.

A buffer-free insert (no allocator, no bus role, no absolute Y), so it runs
on FX1 or FX2 of any track. State, tables and staging live in its own r7
block, $00-$3c; r1-r5 walk tables and states during proc.

New for Octamod on 2 Oct 2026. octabam's own inflator ported RCInflator 2
(Oxford Edition), which carries no licence; this is a fresh port from the
MIT-licensed JClones source. reference.py is the JSFX line for line and
verify.py renders the assembled code against it.

Octamod placement: fx2_id 0x1b (free: not a stock id; IronOxide5's draft
has 0x1e, TapeHead's 0x1f), priority 19, layout letter "8".
"""

from remix.schema import (Category, Proof, BusRole, DspSection, Formatter, Gate, Harness, Kind,
                          MenuEntry, Module, Param, YBase)

MODULE = Module(
    name="inflator",
    key="INFLATOR",
    kind=Kind.DSP_EFFECT,
    doc="Oxford-style inflator (JClones OInflator): curve-shaped saturation, optional 3-band split.",
    category=Category.TRACK, author="devilfish707", author_url="https://github.com/devilfish707",
    proof=Proof.RENDER,
    proof_note="verify.py vs the JSFX; benchmark.py vs SPRING REV; 2 Oct 2026; not flashed",

    menu=MenuEntry(
        fx2_id=0x1b,
        donor_desc=0x400d5726,        # SPRING REV; all six page-1 slots written below
        abbr=b"INFL",                 # 4 chars + NUL
        fullname=b"INFLATOR",         # 8 of 12
        build_tag=False,
    ),

    params=(
        # ---- page 1: INPUT EFFCT CURVE / CLIP SPLIT OUT (the JSFX's order) ---
        Param(b"INPUT", 42, 128, active=True, formatter=Formatter.PLAIN,
              doc="input, -6 dB at 0 to +12 dB, 1/7 dB a step; 42 = 0 dB (JSFX default)"),
        Param(b"EFFCT", 0, 128, active=True, formatter=Formatter.PLAIN,
              doc="effect amount, 0 = dry (JSFX default) to 127 = 100%"),
        Param(b"CURVE", 64, 128, active=True, formatter=Formatter.BIPOLAR,
              doc="curve, drawn -64..+63 = JSFX -50..+49; 0 = default, - softer, + harder"),
        Param(b"CLIP", 1, 2, active=True, formatter=Formatter.STEPPED,
              labels=("OFF", "ON"),
              doc="clip the input at 0 dBFS (ON, default) or +6 dBFS (OFF)"),
        Param(b"SPLIT", 0, 2, active=True, formatter=Formatter.STEPPED,
              labels=("OFF", "ON"),
              doc="band split: shape low/mid/high (240 Hz, 2.4 kHz) separately"),
        Param(b"OUT", 127, 128, active=True, formatter=Formatter.PLAIN,
              doc="output, -12 dB at 0 to 0 dB at 127 (JSFX default)"),
        # ---- page 2: none ----------------------------------------------------
        Param(), Param(), Param(), Param(), Param(), Param(),
    ),

    dsp=DspSection(
        asm="modules/inflator/inflator.asm",
        # BYTE-LOAD-BEARING: the donor region is packed in this order.
        # Euclid 16, the TapeHead draft 17, the IronOxide5 draft 18.
        priority=19,
        bus_role=BusRole.NONE,
        ybase=YBase.NEVER,
        r7_latch_slot=None,
        gate_label=None,
    ),

    harness=Harness(layout_char="8", is_server=False),

    gates=(Gate("modules/inflator/verify.py", remix_arg=False),),
    # SPLIT on is the dear mode (three shapers per channel); the rest costs
    # the same at every value.
    dear={"INPUT": 127, "EFFCT": 127, "CURVE": 0, "CLIP": 0, "SPLIT": 1, "OUT": 127},
)
