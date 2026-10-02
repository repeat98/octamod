"""Inflator in SPRING REV's chooser row, every other stock effect kept.

The remix the hardware test image OCTABAM5 was built from (2 Oct 2026).
Copy to sdk/octabam/remixes/inflator-spring/remix.py, with this draft
copied to sdk/octabam/modules/inflator/, then:

    make image REMIX=inflator-spring BUILD=5

SPRING REV is left off both choosers, so its 1,063 words go back to the
donor region and INFLATOR takes its row. Its id then dispatches to the
null stub: a saved Part that selected SPRING REV on FX2 is silent there
until you pick another effect. FX1 stays stock. static_stock keeps the
stock DSP code built in: the dynamic stock loader is not hardware-qualified.
"""
from remix.schema import Remix, NO_FALLBACK

REMIX = Remix(
    name="inflator-spring",
    doc="Stock chooser with INFLATOR in SPRING REV's row",
    modules=("FILTER", "EQUALIZER", "DJ EQ", "PHASER", "FLANGER", "CHORUS",
             "SPATIALIZER", "COMB FILTER", "COMPRESSOR", "LO-FI", "DELAY",
             "PLATE REV", "INFLATOR", "DARK REV"),
    fallback=NO_FALLBACK,
    static_stock=True,
)
