"""FATTENER -- port of JClones_Fattener.jsfx (MIT, Copyright (c) JClones),
a loudness "fattener": a highpass, a peak EQ that COLOR moves up from 40 Hz
while raising it to +8 dB, a stereo-linked 10:1 compressor whose threshold
and makeup FAT sets, and a tanh soft clip whose knee COLOR raises from 0.9
to a hard clip at 1.0. GAIN is the JSFX's input gain.

A buffer-free insert (no allocator, no bus role, no absolute Y), so it runs
on FX1 or FX2 of any track. State, tables and staging live in its own r7
block, $00-$9f; r1-r5 walk tables and states during proc. Its P table (the
words init copies into that block, and the EQ's 17 designs) is PTABLE
below, written by gen_asm.py.

New for Octamod on 2 Oct 2026, from the JSFX source rather than octabam's
earlier attempts (the first was dropped for a whine and its cost; the
second was written without the JSFX text and never assembled). The first
build here followed the JSFX exactly and overran the unit under p-locks
and scene moves; this one takes about half the DSP time with one highpass
for the JSFX's two, the EQ interpolated between designs and the gain ramped
per block (reference.render_model(), which verify.py renders the assembled
code against; it also compares the sound with the JSFX itself).

Octamod placement: fx2_id 0x0e (free: not a stock id; the Inflator draft
has 0x1b, IronOxide5's 0x1e, TapeHead's 0x1f), priority 20, layout
letter "9".
"""

from remix.schema import (Category, Proof, BusRole, DspSection, Formatter, Gate, Harness, Kind,
                          MenuEntry, Module, Param, YBase)

# init's image of its r7 block from $14 (constants, polynomials, the highpass,
# the tanh table), then the peak EQ's 17 designs: fattener.asm's one $fab1e0.
# ---- PTABLE: written by gen_asm.py ----
PTABLE = (
    0x000000, 0x7fffff, 0x000013, 0x000000, 0x000000, 0x000000, 0x000000, 0x7e88e8,
    0x000000, 0x000000, 0x011310, 0x001694, 0x000000, 0x000000, 0x600000, 0x733333,
    0x000000, 0x000000, 0xfe56fd, 0x07b1cf, 0xfae24f, 0x0488f5, 0xfae11a, 0x059f74,
    0x40000f, 0x58b33a, 0x3ddae5, 0x1a7abf, 0x0e032d, 0x000000, 0x000000, 0x000000,
    0x000000, 0x000000, 0x000000, 0x000000, 0x000000, 0x000000, 0x000000, 0x000000,
    0x80da30, 0x7f92e8, 0x92aff9, 0x6cdef9, 0xff92e8, 0x000000, 0x000000, 0x000000,
    0x000000, 0x000000, 0x000000, 0x0feacd, 0x1f597f, 0x2ddea8, 0x3b26a8, 0x46fd20,
    0x514c90, 0x5a1994, 0x617beb, 0x67972d, 0x6c948f, 0x709e29, 0x73dbe6, 0x7671bf,
    0x787efe, 0x7a1e28, 0x7b6541, 0x7c6653, 0x7d2ff6, 0x7dcdde, 0x7e4961, 0x7ea9e5,
    0x7ef542, 0x7f3013, 0x7f5df4, 0x7f81bb, 0x7f9d9e, 0x7fb35b, 0x7fc44b, 0x7fd17e,
    0x7fdbc6, 0x7fe3c8, 0x7fea06, 0x7feee2, 0x7ff2ab, 0x7ff59e, 0x7ff7ea, 0x7ff9b4,
    0x7ffb18, 0x7ffc2e, 0x7ffd06, 0x7ffdaf, 0x7ffe32, 0x7ffe98, 0x7ffee8, 0x7fff26,
    0x7fff56, 0x7fff7c, 0x7fff99, 0x7fffb0, 0x7fffc1, 0x7fffcf, 0x7fffda, 0x7fffe2,
    0x7fffe9, 0x7fffee, 0x7ffff2, 0x7ffff5, 0x7ffff8, 0x7ffff9, 0x7ffffb, 0x7ffffc,
    0x7ffffd, 0x7ffffe, 0x7ffffe, 0x7fffff, 0x7fffff, 0x7fffff, 0x7fffff, 0x7fffff,
    0x7fffff, 0x7fffff, 0x7fffff, 0x7fffff, 0x7fffff, 0x7fffff, 0x7fffff, 0x7fffff,
    0x7fffff, 0x7fffff, 0x7fffff, 0x7fffff, 0x7fffff, 0x7fffff, 0x7fffff, 0x7fffff,
    0x7fffff, 0x7fffff, 0x7fffff, 0x7fffff, 0x810708, 0x7efa08, 0x7ef8f8, 0x8105f8,
    0x000000, 0x81054f, 0x7ef417, 0x7efab1, 0x810433, 0x0007b5, 0x812bda, 0x7ec37e,
    0x7ed426, 0x812a4f, 0x001233, 0x81a9e2, 0x7e3193, 0x7e561e, 0x81a699, 0x0027d5,
    0x82afd7, 0x7d014b, 0x7d5029, 0x82a6d3, 0x0057e2, 0x846e0d, 0x7af2bf, 0x7b91f3,
    0x84546a, 0x00b8d7, 0x87158f, 0x77c66b, 0x78ea71, 0x86d188, 0x01680d, 0x8ada85,
    0x7340ae, 0x75257b, 0x8a3698, 0x0288ba, 0x8ff7c4, 0x6d2d71, 0x70083c, 0x8e903f,
    0x044250, 0x96b317, 0x6563b5, 0x694ce9, 0x93de12, 0x06be39, 0x9f616f, 0x5bc8c8,
    0x609e91, 0x9a1212, 0x0a2525, 0xaa69f9, 0x5052de, 0x559607, 0xa11110, 0x0e9c12,
    0xb846da, 0x430b05, 0x47b926, 0xa8b3c6, 0x144134, 0xc98210, 0x340e83, 0x367df0,
    0xb0c88e, 0x1b28ef, 0xdeacfe, 0x238fd8, 0x215302, 0xb91545, 0x235ae2, 0xf850d8,
    0x11d7f2, 0x07af28, 0xc1591e, 0x2ccef0, 0x16d645, 0xff4857, 0xe929bb, 0xc94dca,
    0x3769df,
)
# ---- end of PTABLE ----

MODULE = Module(
    name="fattener",
    key="FATTENER",
    kind=Kind.DSP_EFFECT,
    doc="Loudness fattener (JClones Fattener): tuned EQ, linked 10:1 compressor, soft clip.",
    category=Category.TRACK, author="devilfish707", author_url="https://github.com/devilfish707",
    proof=Proof.RENDER,
    proof_note="verify.py vs its model and the JSFX; benchmark.py vs SPRING REV; 2 Oct 2026; not flashed",

    menu=MenuEntry(
        fx2_id=0x0e,
        donor_desc=0x400d5726,        # SPRING REV; all six page-1 slots written below
        abbr=b"FATN",                 # 4 chars + NUL
        fullname=b"FATTENER",         # 8 of 12
        build_tag=False,
    ),

    params=(
        # ---- page 1: FAT COLOR GAIN (the JSFX's order) -----------------------
        Param(b"FAT", 0, 128, active=True, formatter=Formatter.PLAIN,
              doc="fattness, 0 (JSFX default) to 127 = 100%: compressor threshold -1 to -35 dB, makeup +1 to +40 dB"),
        Param(b"COLOR", 0, 128, active=True, formatter=Formatter.PLAIN,
              doc="color, 0 (JSFX default) to 127 = 100%: EQ 40 Hz/0 dB to 6.7 kHz/+8 dB, clip knee 0.9 to 1.0"),
        Param(b"GAIN", 64, 128, active=True, formatter=Formatter.BIPOLAR,
              doc="input gain, drawn -64..+63 = -24 .. +23.6 dB, 3/8 dB a step; 0 = 0 dB (JSFX default)"),
        Param(), Param(), Param(),
        # ---- page 2: none ----------------------------------------------------
        Param(), Param(), Param(), Param(), Param(), Param(),
    ),

    dsp=DspSection(
        asm="modules/fattener/fattener.asm",
        ptable=PTABLE,
        # BYTE-LOAD-BEARING: the donor region is packed in this order.
        # Euclid 16, the TapeHead draft 17, IronOxide5 18, Inflator 19.
        priority=20,
        bus_role=BusRole.NONE,
        ybase=YBase.NEVER,
        r7_latch_slot=None,
        gate_label=None,
    ),

    harness=Harness(layout_char="9", is_server=False),

    gates=(Gate("modules/fattener/verify.py", remix_arg=False),),
    # Every setting costs the same per sample; COLOR's precompute runs in
    # the block where COLOR changes, so the dear case is COLOR moving.
    dear={"FAT": 127, "COLOR": 127, "GAIN": 127},
)
