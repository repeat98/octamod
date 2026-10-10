#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
"""Private Modwerk core source recipe; all linking/packing belongs to Elekloader.

No stock bytes or generated packages are committed. No USB or hardware access.
"""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys

HERE = Path(__file__).resolve().parent
APP = HERE.parents[3]
VERSION = '0.3.1-modwerk-dev.1'
FIELDS = {'build': 17, 'os': 17, 'modules': 4096, 'configuration': 65,
          'source': 65, 'fx1': 1024, 'fx2': 1024, 'hidden': 1024}
# RAM boot (boot.s): the gate replaces the OS entry's `movea.l #0x48000000,%sp`.
BOOT_GATE = (0x40000412, '2e7c48000000')
OS_FIRST, OS_VEROFF, BOOT_IMAGE_BYTES = 0x4fefffe4, 0xde648, 0x140000  # boot.s, boot.h
BOOT_RESERVE = (0x40a955e0, 0x41495de0)  # boot.s RESERVE_LO/HI: the gate scans only there
# REMIX SWITCH's DSP park (dsp_park.asm, assembled by Octabam's dsp_asm), by
# P address, written into both payloads over dead `jmp *` vectors.
DSP_PARK = {
    0x1e: (0x0bf080, 0x000020),  # jsr >$20, host command $0F's vector
    0x20: (0x330000, 0x08d32c, 0x08d328, 0x08d324, 0x08d320, 0x04d3d5, 0x04d3d7, 0x07b495, 0x000000,
           0x07b497, 0x000000, 0x0a8406, 0x0a8407, 0x0a8426, 0x0444bc, 0x44f400, 0x000034, 0x04c4bc,
           0x000000, 0x000004, 0x05f439, 0x000300, 0x0cc300, 0x000000, 0x084e06, 0x0cc300, 0x000000,
           0x085006, 0x221100, 0x218400, 0x0c0006),
    0x06: (0x06c400, 0x00000a, 0x0cc300, 0x000000, 0x085886, 0x0abd4e, 0x0abe4e, 0x0ae180),
}
# --dsp-loader: Octabam's DSP dynamic loading (dsp_loader.py, dsp.c), unchanged
# but for the seams named in DSP_EDITS, and its ColdFire hooks (address, stock
# SHA-256 as Octabam guards them, label in its hooks.s).
DYNLOAD = APP / 'sdk/octabam/platform/dsp-dynload-transport'
DYNLOAD_SOURCES = ('transfer.c', 'transfer.h', 'allocator.c', 'allocator.h', 'manager.c', 'selection.c', 'selection.h',
                   'buffers.c', 'buffers.h', 'publication.h')
DYNLOAD_HOOKS = (
    (0x40004bc0, 8, '560d267844d7aa23140680beb751fac814290c76527d653fc41fbbb43c830cbf', 'dl_state7'),  # frame DMA: packets to both cores
    (0x400526e4, 8, '3e7c95b32f444fd280cb96b2a6ea90525fe223d6e6b9352086d2cf41941ae854', 'dl_fx1_guard'),
    (0x40052474, 8, '3e7c95b32f444fd280cb96b2a6ea90525fe223d6e6b9352086d2cf41941ae854', 'dl_fx2_guard'),
    (0x4004a8a4, 6, '20577862965e35b56da3cc4660ac5df6a325e455467496552d181b68fff15e2d', 'dl_part_guard'),
    # Modwerk's: core 1's packet right after stock's own push to core 1 (dsp_core1.s), at frame-transfer state 3.
    (0x400049ca, 8, '2945c558a5df272b3fb2ef6df3e3ab594b0c2c162f29c38ba624c3ec610c71f5', 'dl_state3'),
    # Modwerk's: the project's map of module effect handles in project.work (fxmap.s, fxmap.c).
    (0x400866d4, 6, '2fd04d71c59a1c9023b7b2b5ad2cf5a7445d464be69c48340b45e33b9ad07056', 'mw_project_begin'),
    (0x400867aa, 6, 'b304cfb26163106388891990b3c67d3fe0b7f927d6a9f973d8d93d26d1171259', 'mw_project_line'),
    (0x400888b2, 6, 'b7d260815d4140a98163e14d6e541df300de70a7bfc32b99792b5e61e46235c3', 'mw_project_write'),
    (0x4008540e, 6, 'c607734f7f97b4a13e2047f38d5e2feace1aa3018ec9f19742f612139e7ac0bd', 'mw_project_end'))
DSP_ALLOWANCE = 2808  # per core and sample: 3,120 cycles our code may spend (hardware) less a 10% margin (owner default)
# The dearest stock effect per slot: DJ EQ, 330.75 executed instructions per sample at its worst split
# (stock_dsp_worst.py, emulator; not hardware timing). Every slot without a module is charged it (dsp.c).
DSP_RESERVE = 331
DSP_EDITS = {
    # The FX selectors read their chooser list through these LEA operands, which the chooser composer repoints.
    'selection.c': (('descriptor=((volatile uint32_t *)(slot ? 0x400d6090u : 0x400d6060u))[s->row];',
                     'descriptor=((volatile uint32_t *)*(volatile uint32_t *)(slot ? 0x40052496u : 0x40052706u))[s->row];'),
                    # An FX pick that meets another slot's transaction waits, the latest per slot, and is replayed
                    # through the stock setter once the manager is idle. A waiting pick names its own track and
                    # chooser row (row bit 15): the panel may have moved on, which used to cancel it.
                    ('static unsigned pending=0, replay=0;',
                     'static unsigned pending=0, replay=0;\n'
                     'static uint8_t later_row[16]; /* per slot: FX1 T1-T8, then FX2 */\n'
                     'static uint32_t later=0, later_bank=0, later_part=0;\n'
                     'volatile uint32_t dl_selection_queued=0;\n'
                     'int dl_publication_idle(void);'),
                    ('    s->track=*(volatile uint8_t *)0x80000000u;\n'
                     '    s->slot=slot; s->source=source;\n'
                     '    s->row=slot>=2 ? row : *(volatile uint32_t *)(slot ? 0x460d5ca8u : 0x460d5c94u);',
                     '    s->track=slot<2 && row ? (row>>8)&7u : *(volatile uint8_t *)0x80000000u;\n'
                     '    s->slot=slot; s->source=source;\n'
                     '    s->row=slot>=2 ? row : row ? row&0xffu : *(volatile uint32_t *)(slot ? 0x460d5ca8u : 0x460d5c94u);'),
                    ('    ((void (*)(void))(slot ? 0x40052474u : 0x400526e4u))();\n}\n#endif',
                     '    /* The setter reads the current track and the chooser\'s cursor: a waiting pick\'s, for the call. */\n'
                     '    volatile uint8_t *track=(volatile uint8_t *)0x80000000u;\n'
                     '    volatile uint32_t *cursor=(volatile uint32_t *)(slot ? 0x460d5ca8u : 0x460d5c94u);\n'
                     '    uint8_t was_track=*track; uint32_t was_row=*cursor;\n'
                     '    if(row) { *track=(uint8_t)((row>>8)&7u); *cursor=row&0xffu; }\n'
                     '    ((void (*)(void))(slot ? 0x40052474u : 0x400526e4u))();\n'
                     '    if(row) { *track=was_track; *cursor=was_row; }\n}\n#endif'),
                    ('    if(pending) {\n        /* A paste',
                     '    if(slot<2) {\n'
                     '        unsigned i=slot*8+request.track;\n'
                     '        later&=~(1u<<i);\n'
                     '        if(pending && (queued.slot!=slot || queued.track!=request.track)) {\n'
                     '            if(request.before[i]==request.target[i]) return 1;\n'
                     '            if(later && (later_bank!=request.bank || later_part!=request.part)) { later=0; ++dl_selection_cancelled; }\n'
                     '            later_bank=request.bank; later_part=request.part;\n'
                     '            later_row[i]=(uint8_t)request.row; later|=1u<<i; ++dl_selection_queued;\n'
                     '            return 2;\n'
                     '        }\n'
                     '    }\n'
                     '    if(pending) {\n        /* A paste'),
                    ('void dl_selection_tick(void) {\n    struct dl_selection current;\n    if(!pending) return;\n'
                     '    if(!dl_selection_capture(queued.slot,queued.row,queued.source,&current)',
                     '/* The next waiting FX pick, through its stock setter and guard as the panel made it; a bank or\n'
                     ' * Part change drops them (they edited the Part that was active). */\n'
                     'static void next(void) {\n'
                     '    if(!later) return;\n'
                     '    if(*(volatile uint32_t *)0x46c82456u!=later_bank || *(volatile uint8_t *)0x80000003u!=later_part) {\n'
                     '        later=0; ++dl_selection_cancelled; return;\n'
                     '    }\n'
                     '    if(!dl_publication_idle()) return;\n'
                     '    unsigned i=0;\n'
                     '    while(!(later>>i&1u)) ++i;\n'
                     '    later&=~(1u<<i);\n'
                     '    dl_selection_apply(i/8,0x8000u|(i&7u)<<8|later_row[i],0);\n'
                     '}\n'
                     'void dl_selection_tick(void) {\n    struct dl_selection current;\n    if(!pending) { next(); return; }\n'
                     '    unsigned given=queued.slot<2 ? 0x8000u|queued.track<<8|queued.row : queued.row;\n'
                     '    if(!dl_selection_capture(queued.slot,given,queued.source,&current)'),
                    ('    replay=1; dl_selection_apply(queued.slot,queued.row,queued.source); replay=0;',
                     '    replay=1; dl_selection_apply(queued.slot,given,queued.source); replay=0;')),
    # Modules register effects at run time (dsp.c), and admission charges their cycles.
    'manager.c': (('extern const struct dl_package dl_catalog[32];', 'extern struct dl_package dl_catalog[32];'),
                  ('extern const struct code dl_codes[2][32];', 'extern struct code dl_codes[2][32];'),
                  ('dl_allocator_init(&allocator,dl_catalog,0,0,0,0);',
                   'dl_allocator_init(&allocator,dl_catalog,0,0,MODWERK_DSP_ALLOWANCE,MODWERK_DSP_ALLOWANCE);'),
                  # A module installed while tracks name its effect: observe afresh and park those slots until bound.
                  ('int dl_publication_idle(void) { return phase==0; }',
                   'int dl_publication_idle(void) { return phase==0; }\n'
                   'void dl_residency_nudge(void) { observed_valid=0; for(unsigned i=0;i<16;++i) last[i]=255; }\n'
                   '/* Modwerk diagnostics (dsp.c\'s report): phase | cursor << 8 | waiting << 16 | result << 24 */\n'
                   'uint32_t dl_manager_state(void) { return phase|cursor<<8|waiting<<16|(uint32_t)(result&0xff)<<24; }'),
                  # A pick made while the manager runs its own transaction waits its turn instead of being refused.
                  ('static void advance(void) {\n    if(!phase) return;',
                   'static uint8_t queued_ids[16]={0};\nstatic uint32_t queued_token=0;\n'
                   'static void advance(void) {\n'
                   '    if(!phase && queued_token) { uint32_t t=queued_token; queued_token=0; begin(queued_ids,t,0); }\n'
                   '    if(!phase) return;'),
                  # What needs no DSP job (a Part change within the preloaded set) is ready at once, so the
                  # stock Part change runs in the same tick, as on stock.
                  ('    if(phase) return DL_SELECT_UNAVAILABLE;\n'
                   '    for(unsigned i=0;i<8;++i) if(s->target_source[i]>4) return DL_SELECT_UNAVAILABLE;\n'
                   '    begin(s->target,token,0); advance(); return result;',
                   '    for(unsigned i=0;i<8;++i) if(s->target_source[i]>4) return DL_SELECT_UNAVAILABLE;\n'
                   '    if(phase) { bytes(queued_ids,s->target,16); queued_token=token; return DL_SELECT_WAIT; }\n'
                   '    begin(s->target,token,0);\n'
                   '    for(unsigned n=0;n<4 && phase && phase!=5 && !waiting;++n) advance();\n'
                   '    return result;'),
                  # Preload the union of the bank's Parts: every transaction also holds the modules the four Parts
                  # name (allocator.c's keep; stock effects load as the target selects them), and the observer
                  # reloads when that changes (a project or bank load, a Part edit). Memory is admitted over the
                  # union, cycles over the target, which is one Part.
                  ('static unsigned observed_valid=0;',
                   'static unsigned observed_valid=0;\nstatic uint32_t observed_held[2]={0,0}; /* parts() when last observed */'),
                  ('static unsigned needed(unsigned index,unsigned mode) {',
                   '/* The module effects the current bank\'s four Parts name, per core (keep), and those ids names (named). */\n'
                   'extern const uint32_t modwerk_dsp_modules;\n'
                   'static void parts(const uint8_t ids[16],uint32_t keep[2],uint32_t named[2]) {\n'
                   '    uint32_t bank=*(volatile uint32_t *)0x46c82456u;\n'
                   '    keep[0]=keep[1]=named[0]=named[1]=0;\n'
                   '    for(unsigned n=0;n<5;++n) for(unsigned i=0;i<16;++i) {\n'
                   '        unsigned p=n==4 ? ids[i] : bank ? *(volatile uint8_t *)(uintptr_t)(bank+0x8ed80u+n*6322u+i) : 255u;\n'
                   '        if(p>=32 || !(modwerk_dsp_modules>>p&1u) || dl_catalog[p].resident || !(dl_catalog[p].slots&(i<8 ? 1u:2u))) continue;\n'
                   '        (n==4 ? named : keep)[(i&7)<4 ? 1:0]|=1u<<p;\n'
                   '    }\n'
                   '}\n'
                   'static unsigned needed(unsigned index,unsigned mode) {'),
                  # A target naming a module no Part holds yet must fit beside all of them; anything else that does
                  # not (a bank that never fitted) falls back to loading what it runs.
                  ('        int r=dl_allocator_prepare(&allocator,desired,current);\n',
                   '        uint32_t named[2];\n'
                   '        parts(desired,allocator.keep,named);\n'
                   '        int r=dl_allocator_prepare(&allocator,desired,current);\n'
                   '        if((r==DL_ALLOC_MEMORY || r==DL_ALLOC_TRANSITION) && (allocator.keep[0]|allocator.keep[1]) &&\n'
                   '           (automatic || !((named[0]&~allocator.keep[0])|(named[1]&~allocator.keep[1])))) {\n'
                   '            allocator.keep[0]=allocator.keep[1]=0;\n'
                   '            r=dl_allocator_prepare(&allocator,desired,current);\n'
                   '        }\n'),
                  ('    for(unsigned i=0;i<16;++i) if(ids[i]!=observed[i]) changed=1;\n    if(!changed) return;',
                   '    for(unsigned i=0;i<16;++i) if(ids[i]!=observed[i]) changed=1;\n'
                   '    uint32_t held[2],named[2];\n'
                   '    parts(ids,held,named);\n'
                   '    if(held[0]!=observed_held[0] || held[1]!=observed_held[1]) changed=1;\n'
                   '    observed_held[0]=held[0]; observed_held[1]=held[1];\n'
                   '    if(!changed) return;'),
                  ('    if(token!=current) return DL_SELECT_UNAVAILABLE;\n    advance(); return result;',
                   '    if(token!=current && token!=queued_token) return DL_SELECT_UNAVAILABLE;\n'
                   '    advance(); return token==current ? result : DL_SELECT_WAIT;'),
                  ('void dl_selection_cancel(uint32_t token) { if(token==current && phase && phase!=6) rollback(); }',
                   'void dl_selection_cancel(uint32_t token) {\n'
                   '    if(token==queued_token) queued_token=0;\n'
                   '    else if(token==current && phase && phase!=6) rollback();\n}')),
    # The switch frame runs the outgoing effect's first sub-block, then the incoming one's init and its
    # second: no instance runs twice, so no overlap charge (it would refuse stock picks beside modules).
    'allocator.c': (('    uint32_t steady[2]={0,0},overlap[2]={0,0};', '    uint32_t steady[2]={0,0};'),
                    ('    overlap[0]=steady[0]; overlap[1]=steady[1];\n'
                     '    for(unsigned i=0;i<16;++i) {\n'
                     '        unsigned p=a->active[i],c=core_of(i);\n'
                     '        if(p==DL_NONE || p==ids[i]) continue;\n'
                     '        uint32_t cost=a->catalog[p].cycles;\n'
                     '        if(cost>a->allowance[c]-overlap[c]) return DL_ALLOC_CYCLES;\n'
                     '        overlap[c]+=cost;\n'
                     '    }\n', ''),
                    # Place what keep holds on a core after the target's own ids (manager.c's union of Parts).
                    ('    for(unsigned i=0;i<16;++i) {\n'
                     '        unsigned p=ids[i];\n'
                     '        if(core_of(i)!=c || p==DL_NONE || a->catalog[p].resident || a->target[c][p].present) continue;',
                     '    for(unsigned i=0;i<16+DL_PACKAGES;++i) {\n'
                     '        unsigned p=i<16 ? (core_of(i)==c ? ids[i] : DL_NONE) : (a->keep[c]>>(i-16)&1u ? i-16 : DL_NONE);\n'
                     '        if(p==DL_NONE || a->catalog[p].resident || a->target[c][p].present) continue;')),
    'allocator.h': (('    uint8_t phase, required, ready;\n};',
                     '    uint8_t phase, required, ready;\n'
                     '    uint32_t keep[2]; /* Modwerk: more ids to place per core, beside the target\'s own */\n};'),),
    # No reads from a DSP (dsp_receiver.asm says why): the receiver answers in the host flags, an upload
    # carries its sum for the receiver to check, and each core's table is the build's (dsp_loader.py).
    # eDMA channel 0 keeps stock's ATTR, which reads its source in 16-byte bursts: an unaligned source
    # stops the channel at its start with a source address error (the probe-A freeze, 10 October 2026).
    # PEEK (8, dsp_receiver.asm): one bit of a DSP P word per packet, its answer HF3; dsp.c reads the
    # receiver's mismatch record with it. Its refusals are bits, so they count neither as rejects nor errors.
    'transfer.h': (('DL_BYPASS=6, DL_BASE=7 };', 'DL_BYPASS=6, DL_BASE=7, DL_PEEK=8 };'),),
    'transfer.c': (('op!=DL_BYPASS && op!=DL_BASE)) return 0;', 'op!=DL_BYPASS && op!=DL_BASE && op!=DL_PEEK)) return 0;'),
                   ('opcode==DL_BYPASS || opcode==DL_BASE) {', 'opcode==DL_BYPASS || opcode==DL_BASE || opcode==DL_PEEK) {'),
                   ('volatile uint16_t dl_tx[2][DL_WORDS]={{0}}, dl_rx[2][32]={{0}};',
                    'volatile uint16_t dl_tx[2][DL_WORDS] __attribute__((aligned(16)))={{0}}, '
                    'dl_rx[2][32] __attribute__((aligned(16)))={{0}};'),
                   ('static uint32_t requests=0, stages=0;',
                    'static uint32_t requests=0, stages=0;\n'
                    'unsigned modwerk_dsp_flags(unsigned core); /* dsp.c: HF2 (handled, toggles) | HF3 (refused) << 1 */\n'
                    'static unsigned flags_sent[2]={0,0};'),
                   ('volatile uint32_t dl_pool_base[2]={0,0}, dl_pool_words[2]={0,0};',
                    'volatile uint32_t dl_pool_base[2]={MODWERK_DSP_TABLE0,MODWERK_DSP_TABLE1}, '
                    'dl_pool_words[2]={MODWERK_DSP_WORDS0,MODWERK_DSP_WORDS1};'),
                   ('                j->expected=(j->expected+value)&0xffffffu;\n            }\n',
                    '                j->expected=(j->expected+value)&0xffffffu;\n            }\n'
                    '            t[7]=(uint16_t)j->expected; t[56]=(uint16_t)(j->expected>>16);\n'),
                   ('    pending[c]=sequence[c]; age[c]=0;',
                    '    pending[c]=sequence[c]; age[c]=0; flags_sent[c]=modwerk_dsp_flags(c);'),
                   ('        volatile uint16_t *r=UNCACHED(dl_rx[c]);\n', ''),
                   ('            if(r[0]==DL_ACK && r[1]==pending[c]) {\n'
                    '                unsigned valid=r[2]==0 && r[3]==c;\n'
                    '                if(jobs[c].state==2 && jobs[c].opcode==DL_WRITE)\n'
                    '                    valid=valid && (((uint32_t)r[5]<<16)|r[4])==jobs[c].expected;\n'
                    '                if(valid) {\n'
                    '                    ++dl_accepted[c];\n'
                    '                    if(r[6] && r[7]>DL_CODE_START && r[6]+r[7]<=DL_POOL_LIMIT) {\n'
                    '                        dl_pool_words[c]=r[7]; dl_pool_base[c]=r[6];\n'
                    '                    }\n'
                    '                } else',
                    '            unsigned flags=modwerk_dsp_flags(c);\n'
                    '            if((flags^flags_sent[c])&1u) {\n'
                    '                unsigned valid=!(flags&2u);\n'
                    '                if(jobs[c].state==2 && jobs[c].opcode==DL_PEEK) {}\n'
                    '                else if(valid) ++dl_accepted[c];\n'
                    '                else'),
                   ('        dl_show_message(text,0x30);\n    }\n}\n',
                    '        dl_show_message(text,0x30);\n    }\n}\n'
                    '/* Modwerk: the watchdog (dsp.c) gives up what is in flight, as a timeout would. */\n'
                    'void dl_abort(void) {\n'
                    '    for(unsigned c=0;c<2;++c) if(pending[c] || jobs[c].state==2) {\n'
                    '        ++dl_errors; pending[c]=0; UNCACHED(dl_tx[c])[0]=0;\n'
                    '        if(jobs[c].state==2) jobs[c].state=4;\n'
                    '    }\n'
                    '}\n')),
    # Writes only: no read phases, no write to a core with no packet waiting, and at state 7 core 0's
    # packet only: core 1's goes right after stock's own push to core 1 (dsp_core1.s, hardware 10 Oct 2026).
    # Measured: EPORT pin 1 is core 0's host request, which its next frame's bank word raises. dl_pin7 counts
    # frames whose state 7 saw it high; dl_straddle counts packets during which it changed (the frame began
    # while the packet was written, so the receiver may read a torn one).
    'hooks.s': (('        .global dl_state7, dl_tick', '        .global dl_state7, dl_tick, dl_phase, dl_rx_nbytes, dl_early, dl_pin7, dl_straddle'),
                ('dl_rx_nbytes: .long 0\n', 'dl_rx_nbytes: .long 0\ndl_early: .long 0     | state-7 visits with channel 0 still running\n'
                 'dl_pin7: .long 0\ndl_straddle: .long 0\ndl_pin_sent: .long 0  | 4 | pin 1 when a packet started, 0 none\n'),
                ('        jsr dl_frame\n', '        move.b 0xfc094005,%d0\n        btst #1,%d0\n        beq 1f\n        addq.l #1,dl_pin7\n'
                 '1:\n        jsr dl_frame\n'),
                ('dl_complete:\n', 'dl_complete:\n        move.l dl_pin_sent,%d0\n        beq 1f\n        clr.l dl_pin_sent\n'
                 '        move.b 0xfc094005,%d1\n        andi.l #2,%d1\n        addq.l #4,%d1\n        cmp.l %d0,%d1\n        beq 1f\n'
                 '        addq.l #1,dl_straddle\n1:\n'),
                ('        cmpi.l #3,%d2\n        bcs dl_write\n        cmpi.l #5,%d2\n        bcs dl_read\n',
                 '        cmpi.l #2,%d2           | phase 1, core 0, only\n        bcs dl_write\n'),
                ('dl_write:\n        subq.l #1,%d2\n',
                 'dl_write:\n        subq.l #1,%d2\n'
                 '        move.l %d2,%d0\n'
                 '        lsl.l #7,%d0\n'
                 '        lea dl_tx,%a0\n'
                 '        adda.l #UNCACHED,%a0\n'
                 '        tst.w (%a0,%d0.l)\n'
                 '        bne dl_send\n'
                 '        move.l dl_phase,%d2\n'
                 '        bra dl_next\n'
                 'dl_send:\n'
                 '        move.b 0xfc094005,%d0\n'
                 '        andi.l #2,%d0\n'
                 '        addq.l #4,%d0\n'
                 '        move.l %d0,dl_pin_sent\n')),
}
# The state-7 entry (build_core.py --dsp-hook). Stock can visit state 7 while its last
# transfer still runs on eDMA channel 0: in state 5 it starts state 6's transfer inline,
# and the stale completion of state 5 then dispatches state 7 early. Stock's state 7 only
# unmasks, so that is harmless to stock, but a packet started then rewrites channel 0 and
# the host port under stock's transfer (the probe-A freeze, 10 October 2026, inferred).
# A start not yet taken up (START) or a minor loop running (ACTIVE) counts as running too.
# Both count those visits (dl_early). guard: such a visit only unmasks, as stock's does,
# and the packet goes at the next visit. usbin: Octabam's USB AUDIO IN entry (no channel-1
# acknowledge, no channel-1 NBYTES save), unguarded, for comparison on the unit.
STATE7_ENTRY = ('        moveq #1,%d0\n'
                '        move.b %d0,0xfc04401c   | acknowledge our channel-1 completion too\n'
                '        move.l dl_phase,%d2\n'
                '        bne dl_next\n')
GUARD_ENTRY = ((STATE7_ENTRY,
               '        moveq #1,%d0\n'
               '        move.b %d0,0xfc04401c   | acknowledge our channel-1 completion too\n'
               '        move.w 0xfc04501e,%d0   | TCD0 CSR: idle is DONE (bit 7), not ACTIVE (6), no START (0)\n'
               '        andi.l #0xc1,%d0\n'
               '        cmpi.l #0x80,%d0\n'
               '        beq dl_idle\n'
               '        addq.l #1,dl_early\n'
               '        move.l dl_phase,%d2\n'
               '        bne dl_return           | our own transfer still runs: its completion comes\n'
               '        movem.l (%sp),%d2-%d7/%a2-%a6\n'
               '        lea 44(%sp),%sp\n'
               '        moveq #1,%d1\n'
               '        move.b %d1,0xfc04801d   | what stock\'s early visit does\n'
               '        jmp DONE\n'
               'dl_idle:\n'
               '        move.l dl_phase,%d2\n'
               '        bne dl_next\n'),)
# Hardware bisect of the probe-A freeze (10 October 2026), each guard plus one change:
# pretend: the packet is built and its job runs, but nothing touches eDMA or the host port;
# noflags: real delivery, the host flags never read; long: 96 halfwords, USB AUDIO IN AB's length.
DSP_HOOK_EDITS = {
    'guard': {'hooks.s': GUARD_ENTRY},
    'pretend': {'hooks.s': GUARD_ENTRY + (('        moveq #1,%d2\n        move.l %d2,dl_phase\n        bra dl_write\n',
                                           '        bra dl_complete           | pretend: no transfer\n'),)},
    'noflags': {'hooks.s': GUARD_ENTRY,
                'transfer.c': (('flags_sent[c]=modwerk_dsp_flags(c);', 'flags_sent[c]=0;'),
                               ('            unsigned flags=modwerk_dsp_flags(c);\n', '            unsigned flags=0;\n'))},
    'long': {'hooks.s': GUARD_ENTRY + (('        move.w #63,%d0\n        move.w %d0,0x2000001c\n',
                                        '        move.w #95,%d0\n        move.w %d0,0x2000001c\n'),
                                       ('        move.w #0x8002,%d0\n        move.w %d0,0xfc045014\n'
                                        '        move.w #0x8002,%d0\n        move.w %d0,0xfc04501c\n',
                                        '        move.w #0x8003,%d0\n        move.w %d0,0xfc045014\n'
                                        '        move.w #0x8003,%d0\n        move.w %d0,0xfc04501c\n'))},
    'usbin': {'hooks.s': ((STATE7_ENTRY,
               '        move.w 0xfc04501e,%d0\n'
               '        andi.l #0xc1,%d0\n'
               '        cmpi.l #0x80,%d0\n'
               '        beq 1f\n'
               '        addq.l #1,dl_early\n'
               '1:\n'
               '        move.l dl_phase,%d2\n'
               '        bne dl_next\n'),
              ('        move.l 0xfc045028,%d0\n        move.l %d0,dl_rx_nbytes\n', ''),
              ('        move.l dl_rx_nbytes,%d0\n        move.l %d0,0xfc045028\n', ''))},
}


def sha(data):
    return hashlib.sha256(data).hexdigest()


def git(root, *args):
    return subprocess.check_output(['git', '-C', str(root), *args], text=True, stderr=subprocess.PIPE).strip()


def private_output(path):
    path = path.resolve()
    if path.exists():
        raise ValueError('Choose a new private output directory.')
    try:
        git(path.parent, 'rev-parse', '--show-toplevel')
    except subprocess.CalledProcessError:
        pass
    else:
        raise ValueError('All generated source, stock and packages must stay outside Git.')
    path.mkdir()
    return path


def ctext(value):
    if not isinstance(value, str) or any(ord(c) < 32 or ord(c) > 126 for c in value):
        raise ValueError('Logger identity must contain bounded printable ASCII.')
    return json.dumps(value, ensure_ascii=True)


def stock_reference(parts, offset, length, address):
    """Replace a zero source placeholder with an Elekloader stock-copy recipe.

    This changes data parts only, never layout, relocations or instructions.
    The linker recovers the guarded bytes from the owner's verified stock.
    """
    if not isinstance(offset, int) or not isinstance(length, int) or offset < 0 or length <= 0:
        raise ValueError('Stock replay requires a positive bounded source span.')
    before, after, at, found = [], [], 0, 0
    end = offset + length
    for part in parts:
        size = len(part[1]) // 2 if part[0] == 'hex' else part[2]
        lo, hi = max(at, offset), min(at + size, end)
        if lo >= hi:
            (before if at < offset else after).append(part)
        else:
            if part[0] != 'hex' or any(bytes.fromhex(part[1])[lo-at:hi-at]):
                raise ValueError('Stock replay is not a zero source placeholder.')
            if lo > at:
                before.append(['hex', part[1][:(lo-at)*2]])
            if hi < at + size:
                after.append(['hex', part[1][(hi-at)*2:]])
            found += hi-lo
        at += size
    if offset < 0 or found != length:
        raise ValueError('Stock replay is outside the source section.')
    return before + [['stock', hex(address), length]] + after


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--stock', type=Path, required=True)
    parser.add_argument('--upstream', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--cross', default='m68k-elf-', help='Use Modwerk\'s reviewed GNU toolchain.')
    parser.add_argument('--dev', action='store_true',
                        help='Development base: drive and watch the unit over USB (dev.c) and stream MAIN/CUE as USB audio. Never for users.')
    parser.add_argument('--dsp-hook', choices=tuple(DSP_HOOK_EDITS), default='guard',
                        help="with --dsp-loader: the state-7 entry, guard (default); usbin, pretend, noflags, long: hardware bisect variants")
    parser.add_argument('--dsp-probe', choices=('A', 'B', 'S', 'W', 'M'),
                        help='Hardware probe of the DSP loader (dsp_loader.PROBES): A delivery only, B answer only, '
                             'S stock DSP payloads (the ColdFire transport alone; nothing answers); '
                             'W full loader, but one word per upload packet to pinpoint a rejected word; '
                             'M (emulator check) a wrong sum on the upload chunk at word 48, so the receiver keeps a record and the tick reads it.')
    parser.add_argument('--dsp-loader', action='store_true',
                        help='Load every DSP effect, stock and module, on demand (needs ELEKLOADER_DSP_ASM, Node 24).')
    parser.add_argument('--dsp-burn', type=int, default=0,
                        help='with --dsp-loader, calibration only: core 0\'s receiver spends this many more cycles (1-4095) every frame.')
    args = parser.parse_args()
    os.environ['ELEKLOADER_CROSS'] = args.cross
    upstream = args.upstream.resolve()
    pin = json.loads((APP / 'vendor/elekloader/kit/kit.json').read_text())['commit']
    if git(upstream, 'rev-parse', 'HEAD') != pin or git(upstream, 'status', '--porcelain', '--untracked-files=no'):
        parser.error('Use the exact clean tracked Elekloader checkout pinned by Modwerk.')
    sys.path.insert(0, str(upstream))
    from elekloader import dsp, formats, elemod, patch
    from elekloader.sdk import build as sdk
    stock, device, release = formats.load(str(args.stock))
    if device.key != 'octatrack' or release.version != '1.40C':
        parser.error('Original Octatrack 1.40C required.')
    image = formats.main_image(stock, device)
    if sha(image) != release.main_sha256:
        parser.error('Original, unmodified MAIN image required.')
    stock_sha = sha(args.stock.read_bytes())
    out = private_output(args.output)
    source = out / 'source'; source.mkdir()
    logger = APP / 'sdk/runtime/logging'
    guards = json.loads((logger / 'stock-guards.json').read_text())
    for key, guard in guards.items():
        at = guard['address'] - device.main_load
        if at < 0 or sha(image[at:at+guard['length']]) != guard['sha256']:
            raise ValueError('Logger stock ABI guard failed: ' + key)
    original_core = upstream / 'mods/core-ot'
    recipe = json.loads((original_core / 'mod.json').read_text())
    for name in ('core-ot.s', 'bus.s', 'gate.s'):
        shutil.copyfile(original_core / name, source / name)
    bootstrap = (source / 'core-ot.s').read_text()
    marker = '3:      clr.l   (%a1)+'
    if bootstrap.count(marker) != 1:
        raise ValueError('Pinned boot clear seam changed; review before porting.')
    bootstrap = bootstrap.replace(marker, '''3:      cmpa.l  #modwerk_retained_start + UNCACHED, %a1
        bne.s   5f
        lea     8192(%a1), %a1
        sub.l   #2048, %d0
        beq.s   4f
5:      clr.l   (%a1)+''')
    (source / 'core-ot.s').write_text(bootstrap)
    for p in logger.iterdir():
        if p.suffix in ('.c', '.h') and p.name != 'identity.c':
            shutil.copyfile(p, source / p.name)
    adapter = (source/'stock_140c.c').read_text()
    io_macro = '#define io octamod_log_io'
    if adapter.count(io_macro) != 1:
        raise ValueError('Logger I/O alias seam changed; review the port.')
    # Keep io an array lvalue: stock calls use sizeof io for its capacity.
    adapter = adapter.replace(io_macro,
        '#define io (*(uint8_t (*)[512])((uintptr_t)&octamod_log_retained + 6144u + 0x08000000u))\n'
        'typedef char modwerk_io_capacity[(sizeof io == 512)?1:-1];')
    (source/'stock_140c.c').write_text(adapter)
    upload = APP / 'sdk/runtime/upload'
    for name in ('upload.c', 'upload.h', 'sha256.c', 'wire.c', 'wire.h', 'vendor.c', 'vendor.h'):
        shutil.copyfile(upload / name, source / name)
    loader = APP / 'sdk/runtime/loader'
    for name in ('loader.c', 'loader.h', 'modwerk_module.h'):
        shutil.copyfile(loader / name, source / name)
    # The base owns the USB configuration and the EP0 unknown-request tail.
    spec = importlib.util.spec_from_file_location('modwerk_usb_base', HERE/'usb_base.py')
    usb = importlib.util.module_from_spec(spec); spec.loader.exec_module(usb)
    for name in ('ep0.c', 'runtime.c', 'runtime.h', 'boot.c', 'boot.h', 'boot.s') + (('dev.c',) if args.dev else ()):
        shutil.copyfile(HERE / name, source / name)
    dsp_sites, dsp_layout, rows = [], None, None
    if args.dsp_loader:
        spec = importlib.util.spec_from_file_location('modwerk_dsp_loader', HERE/'dsp_loader.py')
        loader_dsp = importlib.util.module_from_spec(spec); spec.loader.exec_module(loader_dsp)
        for name in DYNLOAD_SOURCES + ('hooks.s',):
            text = (DYNLOAD / name).read_text()
            edits = DSP_EDITS.get(name, ()) + DSP_HOOK_EDITS[args.dsp_hook].get(name, ())
            if name == 'transfer.c' and args.dsp_probe == 'W':
                # One word per upload packet: the count of accepted packets before a reject is the exact
                # index of the first word the DSP read back wrong (device report rejected0/accepted0).
                edits += (('unsigned n=j->upload.count-j->position;\n            if(n>DL_DATA) n=DL_DATA;',
                           'unsigned n=j->upload.count-j->position;\n            if(n>1) n=1;'),
                          ('unsigned n=jobs[c].upload.count-jobs[c].position;\n                        if(n>DL_DATA) n=DL_DATA;',
                           'unsigned n=jobs[c].upload.count-jobs[c].position;\n                        if(n>1) n=1;'))
            if name == 'transfer.c' and args.dsp_probe == 'M':
                edits += (('            t[7]=(uint16_t)j->expected;', '            t[7]=(uint16_t)(j->expected^(j->position==48));'),)
            for old, new in edits:
                if text.count(old) != 1:
                    raise ValueError('Octabam DSP loader seam changed in %s; review the port.' % name)
                text = text.replace(old, new)
            (source / ('dsp_hooks.s' if name == 'hooks.s' else name)).write_text(text)
        shutil.copyfile(HERE / 'dsp.c', source / 'dsp.c')
        shutil.copyfile(HERE / 'dsp_core1.s', source / 'dsp_core1.s')
        for name in ('fxmap.c', 'fxmap.s'):
            shutil.copyfile(HERE / name, source / name)
        for lea, stock_list in ((0x40052496, 0x400d6090), (0x40052706, 0x400d6060)):
            if int.from_bytes(image[lea - device.main_load:lea - device.main_load + 4], 'big') != stock_list:
                raise ValueError('An FX selector no longer reads its chooser list at %#x.' % lea)
        dsp_sites, dsp_layout = loader_dsp.recipe(image, device, dsp, lambda path: sdk.dsp_assemble(path, str(source)), str(source),
                                                  args.dsp_probe if args.dsp_probe in ('A', 'B') else None, args.dsp_burn)
        chooser_sites, rows = loader_dsp.choosers(image)
        dsp_sites += chooser_sites
    (source/'usb_base.h').write_text(usb.header())
    (source/'usb_base.s').write_text(usb.assembly(args.dev))
    if args.dev:  # USB AUDIO OUT MAIN CUE (usb_base.py): Octabam's source with our interface numbers
        (source/'usbaudio.s').write_text(usb.audio_assembly())
        (source/'remix.inc').write_text(usb.AUDIO_INC)
    # Identity describes this core-only private base. Later selections need
    # their complete module/version/chooser identities regenerated explicitly.
    inputs = {str(p.relative_to(APP)): sha(p.read_bytes()) for folder in (logger, upload, loader, HERE) + ((DYNLOAD,) if args.dsp_loader else ())
              for p in sorted(folder.iterdir()) if p.is_file() and p.suffix in ('.c', '.h', '.s', '.asm', '.py', '.json')}
    if args.dev:
        for path in (usb.AUDIO_SOURCE, usb.AUDIO_DESCRIPTORS):
            inputs[str(path.relative_to(APP))] = sha(path.read_bytes())
    if args.dsp_loader:
        for name in ('src/engine/assets/stock-dsp-metadata.json', 'src/engine/assets/chooser-metadata.json',
                     'src/engine/choosers.ts', 'src/engine/module-menus.ts', 'scripts/octatrack-base-choosers.mjs'):
            inputs[name] = sha((APP / name).read_bytes())
    inputs.update({'elekloader/' + p.name: sha(p.read_bytes()) for p in original_core.iterdir() if p.is_file()})
    artwork = APP / 'sdk/runtime/startup/artwork.json'
    inputs['sdk/runtime/startup/artwork.json'] = sha(artwork.read_bytes())
    inputs['sdk/runtime/startup/build.py'] = sha((artwork.parent/'build.py').read_bytes())
    source_hash = sha(json.dumps(inputs, sort_keys=True, separators=(',', ':')).encode())
    chooser = json.loads((APP/'src/engine/assets/chooser-metadata.json').read_text())
    configuration = dict(fx1=['NONE', *chooser['stockFx1']], fx2=['NONE', *chooser['stockFx2']],
                         hidden=[], logger='0.2.0', modules=[], os='1.40C', source=source_hash, stockfx2=True,
                         usb=dict(interfaces=['msc', 'modwerk-vendor'], vendor=1, submit=True, backend='runtime-loader-3'),
                         boot='ram-1', **({'dev': ['key', 'panel', 'state', 'screen', 'usb-audio-main-cue']} if args.dev else {}))
    if args.dsp_loader:
        configuration.update(fx1=['NONE', *rows['fx1']], fx2=['NONE', *rows['fx2']],
                             dsp=dict(loader='dsp-dynload-2', stock='on-demand', rows=list(loader_dsp.MODULES),
                                      allowance=DSP_ALLOWANCE, reserve=DSP_RESERVE, probe=args.dsp_probe, burn=args.dsp_burn, hook=args.dsp_hook, arena=[dsp_layout[t]['tableWords'] - loader_dsp.SAVED for t in 'AB']))
    identity = sha(json.dumps(configuration, separators=(',', ':')).encode())
    values = dict(build=identity[:16], os='1.40C', modules='', configuration=identity,
                  source=source_hash, fx1=';'.join(configuration['fx1']),
                  fx2=';'.join(configuration['fx2']), hidden='')
    definitions = '#include <stdint.h>\n#include "octamod_log_port.h"\n'
    # IDENTIFY reports this configuration identity as the installed base.
    definitions += 'const uint8_t modwerk_base_digest[32] = {%s};\n' % ','.join(
        '0x' + identity[i:i+2] for i in range(0, 64, 2))
    for key, size in FIELDS.items():
        if len(values[key]) >= size:
            raise ValueError('Logger identity field exceeds capacity: ' + key)
        definitions += f'char olog_{key}[{size}] = {ctext(values[key])};\n'
    definitions += 'const struct octamod_log_identity octamod_log_identity = {\n' + ','.join(
        'olog_' + key for key in FIELDS) + ',1};\n'
    definitions += 'typedef char retained_fits[(sizeof(struct octamod_log_retained_state)<=6144)?1:-1];\n'
    if args.dsp_loader:  # dsp.c and manager.c: stock and module effect ids (the null stub until bound), the catalog, each core's arena
        stock = sum(1 << fx for fx in dsp_layout['A']['stock'])
        definitions += '#include "allocator.h"\nconst uint32_t dl_stub_at_boot = %#xu;\nconst uint32_t dl_pmap16 = 0;\n' % (
            dsp_layout['A']['free'] | stock)
        definitions += 'const uint32_t modwerk_dsp_modules = %#xu;\n' % dsp_layout['A']['free']
        # fxmap.c: today's catalogue assignments, what a project without '#MODWERK_FX=' lines names.
        names = {m['id']: m['name'] for m in json.loads((APP / 'src/catalog/module-documents.json').read_text())['modules']}
        legacy = [(m['fxId'], m['id']) for m in chooser['modules'] if dsp_layout['A']['free'] >> (m.get('fxId') or 0) & 1]
        definitions += 'struct fx_legacy { uint32_t module; uint32_t id; char name[16]; };\n'
        definitions += 'const struct fx_legacy modwerk_fx_legacy[] = {%s};\nconst uint32_t modwerk_fx_legacy_count = %d;\n' % (
            ', '.join('{%#xu, %d, %s}' % (int.from_bytes(hashlib.sha256(key.encode()).digest()[:4], 'big'), fx,
                                           ctext(names.get(key, key)[:15])) for fx, key in legacy), len(legacy))
        definitions += loader_dsp.catalog_c(dsp_layout, DSP_RESERVE)
        definitions += 'const uint16_t modwerk_dsp_arena[2] = {%d, %d};\n' % tuple(
            dsp_layout[t]['tableWords'] - loader_dsp.SAVED for t in ('A', 'B'))
    (source/'identity.c').write_text(definitions)
    # Only authored zero placeholders: stock is recovered by format-2 parts.
    spec = importlib.util.spec_from_file_location('modwerk_logger_package', logger/'package.py')
    package = importlib.util.module_from_spec(spec); spec.loader.exec_module(package)
    (source/'hooks.s').write_text(package.hooks(guards))
    (source/'retained.s').write_text('''.section .bss
.balign 512
.globl modwerk_retained_start, modwerk_retained_end, octamod_log_retained
modwerk_retained_start:
octamod_log_retained:
.skip 8192
modwerk_retained_end:
''')
    recipe.update(version=VERSION, title='Modwerk base prototype', author='irpina; Modwerk contributors',
                  license='GPL-3.0-or-later',
                  description='Private core-only Elekloader base with logger/startup, a USB vendor interface and a runtime module loader (hooks and stock-code sites); NOT a flash candidate.')
    recipe['sources'] += [p.name for p in sorted(source.glob('*.c'))] + ['hooks.s', 'retained.s', 'usb_base.s', 'boot.s'] + (
        ['dsp_hooks.s', 'dsp_core1.s', 'fxmap.s'] if args.dsp_loader else []) + (['usbaudio.s'] if args.dev else [])
    recipe['cflags'] = ['-std=c99', '-ffreestanding', '-fno-builtin', '-fno-common',
                        '-fno-zero-initialized-in-bss', '-fno-tree-loop-distribute-patterns',
                        '-fno-merge-constants', '-fno-asynchronous-unwind-tables', '-fno-unwind-tables',
                        '-Wall', '-Wextra', '-Werror'] + (['-DMODWERK_DEV'] if args.dev else []) + (
        ['-DMODWERK_DSP_LOADER', '-DMODWERK_DSP_ALLOWANCE=%d' % DSP_ALLOWANCE, '-DMODWERK_DSP_RESERVE=%d' % DSP_RESERVE] +
        ['-DMODWERK_DSP_%s%d=%d' % (key, n, dsp_layout[t][field]) for n, t in enumerate('AB')
         for key, field in (('TABLE', 'table'), ('WORDS', 'tableWords'), ('MISS', 'miss'), ('METER', 'meter'))] if args.dsp_loader else [])
    for key in ('idle', 'job', 'transport', 'open', 'read', 'write', 'close'):
        guard = guards[key]; n = guard.get('patchLength', guard['length'])
        at = guard['address'] - device.main_load
        # The USB transport is serviced on the engine before the logger's idle hook.
        target = usb.IDLE_HOOK if key == 'idle' else 'olog_' + key + '_hook'
        recipe['sites'].append(dict(addr=hex(guard['address']), stock=image[at:at+n].hex(),
                                    op='jmp', target=target))
    recipe['sites'] += usb.sites(lambda addr, n: image[addr-device.main_load:addr-device.main_load+n], args.dev)
    # RAM boot: the gate at the OS entry, and the DSP park in both payloads.
    at = BOOT_GATE[0] - device.main_load
    if image[at:at+6].hex() != BOOT_GATE[1]:
        raise ValueError('The OS entry changed; review the RAM boot gate.')
    recipe['sites'].append(dict(addr=hex(BOOT_GATE[0]), stock=BOOT_GATE[1], op='jmp', target='modwerk_boot_gate'))
    for tag in ('A', 'B'):
        for lo, words in DSP_PARK.items():
            addr = dsp.p_span(image, device, tag, lo, lo + len(words)); at = addr - device.main_load
            if [dsp.w24(image, at + 3*k) for k in range(len(words))] != [0 if k % 2 else 0x0c0000 | (lo + k)
                                                                        for k in range(len(words))]:
                raise ValueError('Payload %s P:%#x is not the dead vectors the park replaces.' % (tag, lo))
            recipe['sites'].append(dict(addr=hex(addr), stock=image[at:at+3*len(words)].hex(), op='bytes',
                                        new=b''.join(w.to_bytes(3, 'little') for w in words).hex(), kind='data'))
    # The machine-neutral loader's events (sdk/runtime/loader/loader.h), from core-ot's bus.
    recipe.setdefault('subscribe', []).extend(dict(event='ev_' + e, fn='modwerk_runtime_' + e, order=90)
                                              for e in ('tick', 'draw', 'key', 'enc'))
    # The host time limit counts on the same tick (ep0.c).
    recipe['subscribe'].append(dict(event='ev_tick', fn='modwerk_ep0_tick', order=91))
    if args.dev:  # the screen as composed, modules' drawing included
        recipe['subscribe'].append(dict(event='ev_draw', fn='modwerk_dev_draw', order=95))
    if args.dsp_loader:  # the DSP manager's UI work (its own hook was the UI tick, 0x4005221e) and its ColdFire hooks
        recipe['subscribe'].append(dict(event='ev_tick', fn='modwerk_dsp_tick', order=92))  # dsp.c's test picks
        recipe['subscribe'].append(dict(event='ev_tick', fn='dl_ui', order=93))
        for addr, n, guard, label in DYNLOAD_HOOKS:
            stock = image[addr - device.main_load:addr - device.main_load + n]
            if sha(stock) != guard:
                raise ValueError('Stock bytes at %#x are not the ones the DSP loader hooks.' % addr)
            recipe['sites'].append(dict(addr=hex(addr), stock=stock.hex(), op='jmp', target=label))
        recipe['sites'] += [] if args.dsp_probe == 'S' else dsp_sites
    spec = importlib.util.spec_from_file_location('modwerk_startup', artwork.parent/'build.py')
    startup = importlib.util.module_from_spec(spec); spec.loader.exec_module(startup)
    for guard, authored in startup.writes():
        at = guard['address'] - device.main_load
        if sha(image[at:at+len(authored)]) != guard['sha256']:
            raise ValueError('Startup stock table guard failed.')
        recipe['sites'].append(dict(addr=hex(guard['address']), stock=image[at:at+len(authored)].hex(),
                                    op='bytes', new=authored.hex(), kind='data'))
    (source/'mod.json').write_text(json.dumps(recipe, indent=2)+'\n')
    path, _ = sdk.build(str(source), str(args.stock), str(out/'package'))
    document = json.loads(Path(path).read_text())
    for key in ('idle', 'job', 'transport', 'open', 'read', 'write', 'close'):
        section, offset = document['symbols']['olog_replay_' + key]
        guard = guards[key]; n = guard.get('patchLength', guard['length'])
        document['sections'][section]['parts'] = stock_reference(
            document['sections'][section]['parts'], offset, n, guard['address'])
    Path(path).write_text(json.dumps(document, indent=1)+'\n')
    mod = elemod.load_any(path)
    if set(mod.imports) - {'__run_load','__run_start','__run_words','__bss_start','__bss_words',
                      'arena_base','__arena_pages','__arena_fill','__arena_clear',
                      'ev_tick','ev_draw','ev_key','ev_enc','ev_midi','ev_frame'}:
        raise ValueError('Core has unexpected unresolved imports: ' + str(mod.imports))
    outputs, manifest = patch.build(str(args.stock), [path], version='ELEKLOADER')
    mapping = manifest.pop('_map')
    for ext, data in outputs.items():
        target = out / ('NOT_FLASH_CANDIDATE.' + ext); target.write_bytes(data)
        if sha(target.read_bytes()) != sha(data):
            raise ValueError('Saved file hash differs.')
    if args.dsp_loader and any(mapping[name] % 16 for name in ('dl_tx', 'dl_rx')):
        raise ValueError('The DSP loader packet buffers must be 16-byte aligned for eDMA channel 0.')
    (out/'symbols.json').write_text(json.dumps(mapping, indent=2)+'\n')
    stage = mapping['modwerk_boot_stage']
    if stage % 16 or not BOOT_RESERVE[0] <= stage <= BOOT_RESERVE[1] - 320 - BOOT_IMAGE_BYTES:
        raise ValueError('The RAM boot stage at %#x is outside the reserve the gate scans.' % stage)
    # The unpacked image a RAM boot sends (`npm run device -- boot`); private like the rest.
    main_out = formats.main_image(formats.parse(str(out/'NOT_FLASH_CANDIDATE.bin'), device), device)
    if (int.from_bytes(main_out[:4], 'big') != OS_FIRST or len(main_out) > BOOT_IMAGE_BYTES or
            main_out[OS_VEROFF:OS_VEROFF+2] != image[OS_VEROFF:OS_VEROFF+2]):
        raise ValueError('The built MAIN image cannot be booted from RAM.')
    (out/'MAIN.raw').write_bytes(main_out)
    report = dict(schema=1, kind='modwerk-elekloader-base-prototype', coreVersion=VERSION,
                  upstream=pin, sources=inputs, configuration=configuration, configurationHash=identity,
                  dspLoader={t: {k: (hex(v) if isinstance(v, int) else v) for k, v in dsp_layout[t].items() if k != 'words'} for t in dsp_layout} if dsp_layout else None,  # no stock words in proofs
                  packageSha256=sha(Path(path).read_bytes()), manifest=manifest,
                  savedHashes={ext:sha(data) for ext,data in outputs.items()},
                  productionReady=False, hardware='not tested', emulator='not tested',
                  limitations=['Up to 32 ColdFire runtime modules at once (hooks on ev_tick, ev_draw, ev_key and ev_enc, stock-code sites that no two modules share) in a 256 KiB pool reclaimed once no task can reach a module; no data-table sites, MIDI or frame hooks, or DSP modules and DSP resource ledger yet.',
                               'The base owns the USB configuration: USB MIDI/Audio cannot be combined with it yet.',
                               'RAM boot (boot.s): any host on the vendor interface can boot a whole OS image without a confirmation on the unit; development only. Nothing it does writes flash; the image must carry NOR\'s bootstrap version.',
                               'Logger retention/ABI and modified bootstrap require emulator/hardware qualification.',
                               'Core-only identity; catalogue selections need exact configuration integration.'])
    (out/'proofs.json').write_text(json.dumps(report, indent=2)+'\n')
    if sha(args.stock.read_bytes()) != stock_sha:
        raise ValueError('Input stock file changed.')
    print('Private source-linked core prototype saved. Do not flash; qualification is pending.')


if __name__ == '__main__':
    main()
