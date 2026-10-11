# SPDX-License-Identifier: GPL-3.0-or-later
"""DSP effects loaded on demand (build_core.py --dsp-loader): the DSP side.

Every DSP effect, stock or module, loads into a core when a track picks it.
The base takes each core's whole stock effect block: the three stock routines
other effects call stay resident at its start (where Modwerk's static builder
puts them, src/engine/static-dsp.ts), then the receiver (Octabam's runtime
receiver, answering through the host flags), then the code arena. Each stock
effect becomes a package recovered from the user's own firmware with
Modwerk's relocation recipes (src/engine/assets/stock-dsp-metadata.json,
checked against their hashes), and its dispatch is stock's null stub until it
is bound. Octabam's DSP DYNLOAD STOCK is the reference for the layout. Module
FX join the stock choosers when they register (fxpage.c builds their pages).
"""
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess

HERE = Path(__file__).resolve().parent
APP = HERE.parents[3]
RECEIVER = HERE / 'dsp_receiver.asm'  # Octabam's receiver, answering through the host flags
METADATA = APP / 'src/engine/assets/stock-dsp-metadata.json'
CHOOSERS = APP / 'src/engine/assets/chooser-metadata.json'
FRAME = {'A': 0x8e, 'B': 0x76}  # `move r6,x:>$207` at the head of each core's frame (dsp-dynload's hooks)
FRAME_WORDS = (0x667000, 0x000207)
INIT, PROC = 0x215, 0x235  # the shared dispatch table: init[32], then proc[32]
SAVED = 64                 # the receiver keeps each id's original entries at the head of its table


def payload_words(image, device, dsp, tag):
    """(read(space, address) -> word, main OS address of a word) for payload `tag`."""
    records = dsp.records(image, device, tag)

    def at(space, address):
        for sp, lo, count, first in records:
            if sp == space and lo <= address < lo + count:
                return first + 3 * (address - lo)
        raise ValueError('Payload %s does not load %s:%#x.' % (tag, 'PXY'[space], address))
    return (lambda space, address: dsp.w24(image, at(space, address) - device.main_load)), at, records


# Hardware probes (build_core.py --dsp-probe), to find which step stops core 0: A takes packets
# but never looks at them (delivery only); B checks a packet and answers, and does nothing else.
PROBES = {
    'A': ('        move    r6,x:>$207              ; the instruction the hook displaced\n',
          '        move    r6,x:>$207              ; the instruction the hook displaced\n        rts\n'),
    'B': ('        move    r3,x:(r0+63)\n        move    x:(r0+2),a\n',
          '        move    #>0,x0\n        bra     reply\n        move    x:(r0+2),a\n'),
}


def receiver_source(text, null, table_words, probe=None, burn=0):
    """The receiver with its table's size and stock's null stub (dry ids) filled in; `burn` (calibration
    builds) spends that many more cycles every frame, so the load meter's idle count falls by a known amount."""
    if probe:
        old, new = PROBES[probe]
        if text.count(old) != 1:
            raise ValueError('The DSP receiver changed; review probe %s.' % probe)
        text = text.replace(old, new)
    if burn:
        old = 'tallied:\n'
        if text.count(old) != 1 or not 0 < burn < 4096 or burn % 2:
            raise ValueError('The DSP receiver changed, or a burn not even and within 2-4094 cycles.')
        # A DO loop, not rep: rep holds off interrupts while it repeats.
        text = text.replace(old, old + '        do      #%d,burnt\n        nop\n        nop\nburnt:\n' % (burn // 2))
    for old, new, count in (('@NULL_INIT@', '$%x' % null[0], 1), ('@NULL_PROC@', '$%x' % null[1], 1),
                            ('@DLWORDS@', str(table_words), 3)):
        if text.count(old) != count:
            raise ValueError('The DSP receiver changed (%s); review the port.' % old)
        text = text.replace(old, new)
    return text


def words_sha(words):
    """stock-dsp.ts dspWordsHash: big-endian 24-bit words."""
    return hashlib.sha256(b''.join(w.to_bytes(3, 'big') for w in words)).hexdigest()


def recovered(read, recipe):
    """A stock span with its recipe's address adjustments, checked before and after (stock-dsp.ts recoverStockDsp)."""
    words = [read(0, recipe['sourceAddress'] + i) for i in range(recipe['words'])]
    if words_sha(words) != recipe['sourceSha256']:
        raise ValueError('The stock DSP span at P:%#x differs from its recipe.' % recipe['sourceAddress'])
    for adjustment in recipe['adjustments']:
        words[adjustment['offset']] = (words[adjustment['offset']] + adjustment['delta']) & 0xffffff
    if words_sha(words) != recipe['sha256']:
        raise ValueError('The adjusted stock DSP span at P:%#x differs from its recipe.' % recipe['sourceAddress'])
    return words


def relocated(words, relocations, base):
    """As the loader places a package (transfer.c): absolute words gain the base, PC-relative ones (bit 15) lose it."""
    out = list(words)
    for r in relocations:
        out[r & 0x7fff] = (out[r & 0x7fff] + (-base if r & 0x8000 else base)) & 0xffffff
    return out


def disassembler():
    """dsp56kDisassemble, built beside ELEKLOADER_DSP_ASM in the same dsp56300 tree."""
    path = Path(os.environ.get('ELEKLOADER_DSP_ASM', '')).resolve().parents[1] / 'disassemble' / 'dsp56kDisassemble'
    if not path.is_file():
        raise ValueError('Build dsp56kDisassemble beside ELEKLOADER_DSP_ASM (the dsp56300 tree\'s disassemble target).')
    return path


def reads_buffer(words, base, init, work):
    """1 when the init at `init` (words placed at `base`) reads X:$213, its Y buffer base, before its
    first rts (buffers.h). Read from the code, as Octabam does, so no effect is missed by a list."""
    path = Path(work) / 'init.bin'
    path.write_bytes(b''.join(w.to_bytes(3, 'little') for w in words))
    out = subprocess.check_output([str(disassembler()), '-in', str(path), '-pc', '%x' % base, '-le'], text=True)
    for line in out.splitlines():
        m = re.match(r'([0-9a-f]{6}):\s*(.*?)\s*;', line)
        if not m or int(m[1], 16) < init:
            continue
        if 'x:>$213' in m[2]:
            return 1
        if m[2].split()[:1] == ['rts']:
            return 0
    return 1  # no rts reached: assume it reads, the side that reserves a block


def recipe(image, device, dsp, assemble, work, probe=None, burn=0):
    """-> (sites, layout) for both payloads. `assemble(path)` is Elekloader's
    sdk.build.dsp_assemble (octabam's dsp_asm at two origins)."""
    metadata = json.loads(METADATA.read_text())
    if metadata['sourceSha256'] != hashlib.sha256(image).hexdigest():
        raise ValueError('The stock DSP metadata is for another OS image.')
    sites, layout, custom = [], {}, set(json.loads(CHOOSERS.read_text())['customIds'])
    for payload in metadata['payloads']:
        tag = payload['tag']
        read, at, records = payload_words(image, device, dsp, tag)
        taken = sorted(payload['packages'], key=lambda p: p['sourceAddress'])  # every stock DSP effect
        lo, hi, origin = payload['effectStart'], payload['effectEnd'], payload['sharedEnd']  # the receiver's
        # The block is exactly the effects and the routines outside them (FILTER's library), in one run.
        spans = sorted([(p['sourceAddress'], p['words']) for p in taken] + [(r['sourceAddress'], r['words']) for r in payload['shared']
                        if not any(p['sourceAddress'] <= r['sourceAddress'] < p['sourceAddress'] + p['words'] for p in taken)])
        if [s for s, _ in spans] != [lo] + [s + n for s, n in spans[:-1]] or spans[-1][0] + spans[-1][1] != hi:
            raise ValueError('Payload %s: the stock effect block is not one run.' % tag)
        shared, at_copy = [], lo
        for routine in sorted(payload['shared'], key=lambda r: r['destination']):
            if routine['destination'] != at_copy:
                raise ValueError('Payload %s: the shared stock routines do not pack from the block start.' % tag)
            shared += recovered(read, routine)
            at_copy += routine['words']
        if at_copy != origin or origin > 0x1000:  # their one-word calls reach only below P:$1000
            raise ValueError('Payload %s: the shared stock routines do not end at %#x below P:$1000.' % (tag, origin))
        stock = {}
        for p in taken:
            words = recovered(read, p)
            proof = p['proofs'][0]
            if words_sha(relocated(words, p['relocations'], proof['base'])) != proof['sha256']:
                raise ValueError('Payload %s: %s does not relocate as its recipe proves.' % (tag, p['key']))
            stock[p['fxId']] = dict(key=p['key'], words=words, count=len(words), relocations=p['relocations'], init=p['init'], proc=p['proc'],
                                    slots=(1 if 'fx1' in p['slots'] else 0) | (2 if 'fx2' in p['slots'] else 0),
                                    buffer=reads_buffer(words, 0, p['init'], work))
        null = (read(1, INIT), read(1, PROC))  # effect 0, NONE, runs stock's null stub
        free, reads = 0, [0] * 32
        for fx in range(32):
            entry = (read(1, INIT + fx), read(1, PROC + fx))
            packaged = fx in stock
            if packaged != all(lo <= e < hi for e in entry) or (not packaged and any(lo <= e < hi for e in entry)):
                raise ValueError('Payload %s: effect %d dispatches across the stock effect block.' % (tag, fx))
            if fx in custom and entry == null:  # the ids Modwerk's modules take (chooser metadata)
                free |= 1 << fx
            if packaged:
                reads[fx] = stock[fx]['buffer']
            elif entry != null:  # what stays resident (DELAY's DSP side) keeps stock's Y block, as stock's own code reads it
                code = []
                for k in range(96):
                    try:
                        code.append(read(0, entry[0] + k))
                    except ValueError:
                        break
                reads[fx] = reads_buffer(code, entry[0], entry[0], work)
        hook = [read(0, FRAME[tag] + k) for k in range(2)]
        if hook != list(FRAME_WORDS):
            raise ValueError('Payload %s: the frame head is not the stock instruction the receiver replays.' % tag)
        # The receiver's size does not depend on its table's: every operand it moves is a long one.
        path = Path(work) / ('receiver-%s.asm' % tag)
        # Core 0 only: with 2,000 more cycles a frame on both cores the unit hung at its logo (10 October 2026).
        burned = burn if tag == 'A' else 0
        path.write_text(receiver_source(RECEIVER.read_text(), null, 0, probe, burned))
        size = len(assemble(str(path))[0])
        table = hi - origin - size
        path.write_text(receiver_source(RECEIVER.read_text(), null, table, probe, burned))
        code, labels, relocations = assemble(str(path))
        # The least arena that still runs every stock effect on its own: the largest, DARK REV.
        if len(code) != size or labels['dltable'] != size or table < SAVED + max(len(s['words']) for s in stock.values()):
            raise ValueError('Payload %s: the receiver and the largest stock effect do not fit the block.' % tag)
        # dsp.c reads the first wrong word back from three consecutive receiver words, after
        # tablebase's operand (the table address, a known word) and its rts.
        if [labels[k] - labels['missoffset'] for k in ('tablebase', 'missexpected', 'missactual')] != [-3, 1, 2]:
            raise ValueError('Payload %s: the receiver\'s mismatch record is not three consecutive words.' % tag)
        for index, offset in relocations:
            code[index] = origin + offset
        words, covered = shared + code + [0] * table, 0  # the saved entries must start empty
        for space, start, count, first in records:  # one site per payload record
            a, b = max(lo, start), min(hi, start + count)
            if space or a >= b:
                continue
            offset, covered = first + 3 * (a - start) - device.main_load, covered + b - a
            sites.append(dict(addr=hex(offset + device.main_load), stock=image[offset:offset + 3 * (b - a)].hex(), op='bytes',
                              kind='data', new=b''.join(w.to_bytes(3, 'little') for w in words[a - lo:b - lo]).hex()))
        if covered != hi - lo:
            raise ValueError('Payload %s does not load the stock effect block exactly once.' % tag)
        frame = origin + labels['frame']
        first = at(0, FRAME[tag]) - device.main_load
        sites.append(dict(addr=hex(at(0, FRAME[tag])), stock=image[first:first + 6].hex(), op='bytes', kind='data',
                          new=b''.join(w.to_bytes(3, 'little') for w in (0x0bf080, frame)).hex()))
        for fx in sorted(stock):
            for table_at, value in ((INIT, null[0]), (PROC, null[1])):
                first = at(1, table_at + fx) - device.main_load
                sites.append(dict(addr=hex(at(1, table_at + fx)), stock=image[first:first + 3].hex(), op='bytes',
                                  kind='data', new=value.to_bytes(3, 'little').hex()))
        layout[tag] = dict(core=payload['core'], receiver=origin, frame=frame, table=origin + size, tableWords=table,
                           miss=origin + labels['missoffset'], meter=origin + labels['idlepub'], null=null, free=free,
                           stock={fx: {k: v for k, v in s.items() if k != 'words'} for fx, s in stock.items()},
                           reads=reads, words={fx: s['words'] for fx, s in stock.items()})
    if layout['A']['free'] != layout['B']['free']:
        raise ValueError('The two payloads leave different effect ids free.')
    return sites, layout



def catalog_c(layout, reserve):
    """dl_catalog and dl_codes (manager.c) as C: each stock DSP effect's package per core, and every
    other id what stock runs there (resident; a module's id until the module registers). Each id is
    charged `reserve` cycles, the dearest stock effect, as stock-first admission does (dsp.c)."""
    a, b = layout['A'], layout['B']
    if {fx: (len(w), a['stock'][fx]['slots']) for fx, w in a['words'].items()} != \
            {fx: (len(w), b['stock'][fx]['slots']) for fx, w in b['words'].items()} or a['reads'] != b['reads']:
        raise ValueError('The two payloads package the stock effects differently.')
    lines = ['struct code { const uint32_t *words; const uint16_t *relocations; uint16_t count, init, proc, relocation_count; };']
    unpack = []
    for n, tag in enumerate('AB'):
        for fx, words in sorted(layout[tag]['words'].items()):
            # Three bytes a word in the image (a RAM-booted base has 1.25 MiB), unpacked into RAM at the first tick.
            lines.append('static const uint8_t stock%d_%d_packed[] = {%s};' % (
                n, fx, ','.join('%#x' % (w >> s & 255) for w in words for s in (16, 8, 0))))
            lines.append('static uint32_t stock%d_%d[%d];' % (n, fx, len(words)))
            lines.append('static const uint16_t stock%d_%d_relocations[] = {%s};' % (
                n, fx, ','.join(str(r) for r in layout[tag]['stock'][fx]['relocations']) or '0'))
            unpack.append('{stock%d_%d_packed, stock%d_%d, %d}' % (n, fx, n, fx, len(words)))
    lines.append('void modwerk_dsp_unpack(void) {')
    lines.append('    static const struct { const uint8_t *from; uint32_t *to; uint32_t count; } all[] = {%s};' % ', '.join(unpack))
    lines.append('    for (unsigned i = 0; i < sizeof all / sizeof *all; ++i) for (uint32_t w = 0; w < all[i].count; ++w)')
    lines.append('        all[i].to[w] = (uint32_t)all[i].from[3 * w] << 16 | (uint32_t)all[i].from[3 * w + 1] << 8 | all[i].from[3 * w + 2];')
    lines.append('}')
    lines.append('struct dl_package dl_catalog[32] = {%s};' % ', '.join(
        '{%d, 1, %d, %d, %d, 1, %d}' % ((len(a['words'][fx]), reserve, a['stock'][fx]['slots'], 0, a['reads'][fx]) if fx in a['stock']
                                        else (0, reserve, 3, 1, a['reads'][fx])) for fx in range(32)))
    rows = []
    for n, tag in enumerate('AB'):
        s, w = layout[tag]['stock'], layout[tag]['words']
        rows.append('{%s}' % ', '.join('{stock%d_%d, stock%d_%d_relocations, %d, %d, %d, %d}' % (
            n, fx, n, fx, len(w[fx]), s[fx]['init'], s[fx]['proc'], len(s[fx]['relocations'])) if fx in s else '{0, 0, 0, 0, 0, 0}'
            for fx in range(32)))
    lines.append('struct code dl_codes[2][32] = {%s};' % ', '.join(rows))
    return '\n'.join(lines) + '\n'


def choosers(image):
    """The stock FX choosers, read from the base's own lists, which fxpage.c extends with each module that
    registers: -> (sites pointing stock's references at them and giving the module ids no descriptor and no
    row yet, the lists' C definitions with stock's rows). Read from the user's firmware."""
    meta = json.loads(CHOOSERS.read_text())
    layout = meta['layout']
    read = lambda at: int.from_bytes(image[at - 0x40000400:at - 0x40000400 + 4], 'big')
    lists = {}
    for slot, at in (('fx1', layout['FX1_LIST']), ('fx2', layout['FX2_LIST'])):
        rows = []
        while read(at + 4 * len(rows)) and len(rows) < 32:
            rows.append(read(at + 4 * len(rows)))
        lists[slot] = rows
    none = read(layout['FX1_IDS'])
    if none != layout['FX1_NONE'] or any(rows[0] != none or len(rows) > 31 - 13 for rows in lists.values()):
        raise ValueError('The stock FX choosers are not the lists the base extends.')
    sites = []
    for slot, at, symbol in (('fx1', layout['FX1_LIST'], 'modwerk_fx1_list'), ('fx2', layout['FX2_LIST'], 'modwerk_fx2_list')):
        for ref in meta[slot + 'References']:
            if read(ref) != at:
                raise ValueError('A stock chooser reference at %#x does not name its list.' % ref)
            sites.append(dict(addr=hex(ref), stock=image[ref - 0x40000400:ref - 0x40000400 + 4].hex(), op='ptr', target=symbol))
    for fx in meta['customIds']:
        for table, value in ((layout['FX1_IDS'], none), (layout['FX2_IDS'], none), (layout['FX1_ID2POS'], 0), (layout['ID2POS'], 0)):
            at = table + 4 * fx
            sites.append(dict(addr=hex(at), stock=image[at - 0x40000400:at - 0x40000400 + 4].hex(), op='bytes', kind='data',
                              new=value.to_bytes(4, 'big').hex()))
    c = ''.join('uint32_t modwerk_%s_list[32] = {%s};\n' % (slot, ', '.join('%#xu' % row for row in rows)) for slot, rows in lists.items())
    c += 'const uint32_t modwerk_fx_rows[2] = {%d, %d};\n' % (len(lists['fx1']), len(lists['fx2']))
    return sites, c
