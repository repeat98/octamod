| SPDX-License-Identifier: GPL-3.0-or-later
| The project's map of module effect handles in project.work (fxmap.c; build_core.py --dsp-loader):
| stock's loader skips every line that starts with '#', so the map rides as '#MODWERK_FX=' lines.
| The loader, its comment check and the writer are the seams PLAY MODES and SCALE QUANTIZER use
| (sdk/octabam/modules/playmodes/INVESTIGATION.md, "The project file"); the end of the engine's
| project load is the one Octabam's publication hooks use (dl_project_end); fxmap.c owns it.
        .text
        .global mw_project_begin, mw_project_line, mw_project_write, mw_project_end

| 0x400866d4, the loader's head: d0 = storing (0 on the parse-only pass). d1/a0/a1 are reloaded
| before use. Displaced: movel %d0,%sp@(1158) ; seq %d0 (the move sets Z for the seq).
mw_project_begin:
        move.l  %d0,-(%sp)
        jsr     modwerk_fxmap_begin
        move.l  (%sp)+,%d0
        move.l  %d0,1158(%sp)
        seq     %d0
        jmp     0x400866da

| 0x400867aa, the loader's comment check: d0 = the line's first character, d5 = '#', d3 = the
| line (NUL-ended, without CR LF), 58(sp) nonzero on the parse-only pass. d0/d1/a0/a1 are
| reloaded at the next line. Displaced: cmpl %d0,%d5 ; beqw 0x40088224.
mw_project_line:
        cmp.l   %d0,%d5
        beq.s   1f
        jmp     0x400867b0                      | not a comment: stock goes on
1:      move.l  58(%sp),-(%sp)
        move.l  %d3,-(%sp)
        jsr     modwerk_fxmap_line
        addq.l  #8,%sp
        jmp     0x40088224                      | skipped, as stock skips it

| 0x400888b2, the writer, at PATTERN_CHANGE_AUTO_SILENCE_TRACKS's line with its value already
| pushed: d3 = the file, d2 the stock line's buffer (callee-saved). Displaced: pea 0x400b8244.
mw_project_write:
        move.l  %d3,-(%sp)
        jsr     modwerk_fxmap_write
        addq.l  #4,%sp
        pea     0x400b8244
        jmp     0x400888b8

| 0x4008540e, the engine's project load done, d2 its result (negative: failed).
| Displaced: movel %d2,%sp@- ; moveal %fp@(-566),%a0.
mw_project_end:
        lea     -60(%sp),%sp
        movem.l %d0-%d7/%a0-%a6,(%sp)
        move.l  %d2,-(%sp)
        jsr     modwerk_fxmap_loaded            | the base's other project-load work goes in there too
        addq.l  #4,%sp
        movem.l (%sp),%d0-%d7/%a0-%a6
        lea     60(%sp),%sp
        move.l  %d2,-(%sp)
        movea.l -566(%fp),%a0
        jmp     0x40085414
