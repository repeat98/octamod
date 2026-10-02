"""IronOxide5 in SPRING REV's chooser row, every other stock effect kept.

The remix the hardware test image OCTABAM4 was built from (2 Oct 2026).
Copy to sdk/octabam/remixes/ironoxide5-spring/remix.py, with this draft
copied to sdk/octabam/modules/ironoxide5/, then:

    make image REMIX=ironoxide5-spring BUILD=4

SPRING REV is left off both choosers, so its 1,063 words go back to the
donor region and IRONOXIDE5 takes its row. Its id then dispatches to the
null stub: a saved Part that selected SPRING REV on FX2 is silent there
until you pick another effect. FX1 stays stock. static_stock keeps the
stock DSP code built in: the dynamic stock loader is not hardware-qualified.
"""
from remix.schema import Remix, NO_FALLBACK

REMIX = Remix(
    name="ironoxide5-spring",
    doc="Stock chooser with IRONOXIDE5 in SPRING REV's row",
    modules=("FILTER", "EQUALIZER", "DJ EQ", "PHASER", "FLANGER", "CHORUS",
             "SPATIALIZER", "COMB FILTER", "COMPRESSOR", "LO-FI", "DELAY",
             "PLATE REV", "IRONOXIDE5", "DARK REV"),
    fallback=NO_FALLBACK,
    static_stock=True,
)
