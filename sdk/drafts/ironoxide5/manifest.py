"""IRONOXIDE5 -- port of Airwindows IronOxide5 (MIT, Copyright (c) 2016
airwindows / Chris Johnson): tape emulation. A tape-low highpass, an input
sin() saturator, a leaky-integrator tape-speed stage, an output sin()
saturator, output trim and the plugin's inv/dry/wet, every state in the A/B
pair the plugin alternates between samples.

The plugin at Flutter = 0 and Noise = 0; those two knobs are not
implemented. A buffer-free insert (no allocator, no bus role, no absolute
Y), so it runs on FX1 or FX2 of any track. State and coefficients live in
its own r7 block, $00-$1b; r4/r5 point at the A/B copies during proc.

Brought over from octabam (modules/ironoxide5, 13 Sep 2026, built but never
heard) for Octamod on 2 Oct 2026. The first render against the plugin's own
float code measured a peak error of 2.0; the per-sample path was rewritten
(see ironoxide5.asm's header) and now matches within 7.7e-4.

Octamod placement: fx2_id 0x1e (free: not a stock id; TapeHead's draft has
0x1f), priority 18, layout letter "5". octabam had it on stock
COMPRESSOR's id with replaces=; Octamod keeps stock effects and gives
modules their own ids.
"""

from remix.schema import (Category, Proof, BusRole, DspSection, Formatter, Gate, Harness, Kind,
                          MenuEntry, Module, Param, YBase)

MODULE = Module(
    name="ironoxide5",
    key="IRONOXIDE5",
    kind=Kind.DSP_EFFECT,
    doc="Tape emulation: Airwindows IronOxide5's tape-low filter, tape speed and sin() saturation.",
    category=Category.TRACK, author="devilfish707", author_url="https://github.com/devilfish707",
    proof=Proof.RENDER,
    proof_note="verify.py vs the plugin's float code; benchmark.py vs SPRING REV; "
               "2 Oct 2026; not flashed",

    menu=MenuEntry(
        fx2_id=0x1e,
        donor_desc=0x400d5726,        # SPRING REV; all six page-1 slots written below
        abbr=b"IRON",                 # 4 chars + NUL
        fullname=b"IRONOXIDE5",       # 10 of 12
        build_tag=False,
    ),

    params=(
        # ---- page 1: INPUT HIGH LOW / OUT MIX ----------------------------
        Param(b"INPUT", 64, 128, active=True, formatter=Formatter.PLAIN,
              doc="input trim, -18 dB at 0 to +18 dB at 127; 64 = 0 dB (plugin default)"),
        Param(b"HIGH", 72, 128, active=True, formatter=Formatter.PLAIN,
              doc="tape high (ips), 1.65 to 165 ips as knob^4; 72 = the plugin's 15 ips"),
        Param(b"LOW", 72, 128, active=True, formatter=Formatter.PLAIN,
              doc="tape low (lps): more highpass and lean-out as it rises; 72 = plugin default"),
        Param(b"OUT", 64, 128, active=True, formatter=Formatter.PLAIN,
              doc="output trim, -18 dB at 0 to +18 dB at 127; 64 = 0 dB (plugin default)"),
        Param(b"MIX", 127, 128, active=True, formatter=Formatter.PLAIN,
              doc="dry/wet: 0 dry, 127 fully wet (plugin default); the plugin's inverted half is not used"),
        Param(),
        # ---- page 2: none ----------------------------------------------------
        Param(), Param(), Param(), Param(), Param(), Param(),
    ),

    dsp=DspSection(
        asm="modules/ironoxide5/ironoxide5.asm",
        # BYTE-LOAD-BEARING: the donor region is packed in this order.
        # Euclid 16, TapeHead's draft 17.
        priority=18,
        bus_role=BusRole.NONE,
        ybase=YBase.NEVER,
        r7_latch_slot=None,
        gate_label=None,
    ),

    harness=Harness(layout_char="5", is_server=False),

    gates=(Gate("modules/ironoxide5/verify.py", remix_arg=False),),
    # No stage is skipped at any setting; the per-block fits branch on HIGH's
    # segment, so the top segment is priced.
    dear={"INPUT": 127, "HIGH": 127, "LOW": 127, "OUT": 127, "MIX": 127},
)
