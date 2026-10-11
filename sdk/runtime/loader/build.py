#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
"""Build a runtime module package (MWRM, ABI 4, or 5 with DSP code; README.md).

From C sources (handlers found by name, modwerk_module.h):

    python3 -B sdk/runtime/loader/build.py MODULE.c [MORE.c ...] -o MODULE.mwrm

From a catalogue module converted by Elekloader (build_ports.py), with its
patches to stock code; the package then holds stock bytes, so keep it private:

    python3 -B sdk/runtime/loader/build.py --elemod MOD.elemod --stock OS.bin \\
        --upstream ~/.cache/modwerk-upstream/elekloader --base-symbols BASE/symbols.json -o MOD.mwrm

C modules are linked twice, at 0 and at 0x10000; the 32-bit words that differ
by exactly 0x10000 are their references to themselves, any other difference
is refused. Elemods list their relocations. The base adds the module's
address to each self-reference at load. ColdFire, no C library or libgcc.
The module's id is the first four bytes of the SHA-256 of its name (the
elemod's id, a DSP package's catalogue id, or the output file's stem): a
package with a live module's id replaces it, and an empty one removes it.

A DSP effect (the Octatrack's), from a relocatable DSP package Modwerk's
package builder made and proved (its words placed at four origins equal
fresh assembly there; checked again here), with what it needs:

    python3 -B sdk/runtime/loader/build.py --dsp src/engine/assets/dsp-packages.json:everb \\
        --slots fx2 --cycles 382 --cycles-kind executed --state 132 --buffer 16384 -o everb.mwrm
"""
import argparse
import hashlib
import json
from pathlib import Path
import struct
import subprocess
import sys
import tempfile

HERE = Path(__file__).resolve().parent
HANDLERS = ('module_tick', 'module_draw', 'module_key', 'module_enc')  # loader.h's event order
NONE = 0xffffffff
SHIFT = 0x10000
SITE_BYTES, SITE_RELOCATIONS = 32, 8  # loader.h
DSP_WORDS, DSP_RELOCATIONS, STATE_WORDS, BUFFER_WORDS = 4096, 256, 132, 16384
CYCLE_KINDS = {'executed': 1, 'modeled': 2, 'hardware': 3}  # loader.h's runtime_cycles
SLOTS = {'fx1': 1, 'fx2': 2, 'both': 3}
CFLAGS = ['-mcpu=54455', '-Os', '-std=c99', '-ffreestanding', '-fno-builtin', '-fno-common',
          '-fno-tree-loop-distribute-patterns', '-fno-asynchronous-unwind-tables', '-fno-unwind-tables',
          '-Wall', '-Wextra', '-Werror', '-I', str(HERE)]
SCRIPT = '''ENTRY(__image_start)
SECTIONS {
  . = %#x;
  __image_start = .;
  .image : { *(.text .text.*) *(.rodata .rodata.*) *(.data .data.*) . = ALIGN(4); }
  __image_end = .;
  .bss (NOLOAD) : { *(.bss .bss.*) . = ALIGN(4); }
  __bss_end = .;
  /DISCARD/ : { *(.comment) *(.note .note.*) }
}
'''


def relocations(low, high, end):
    """Offsets of the words that move with the link address; refuse anything else."""
    offsets, moved = [], set()
    for at in range(0, len(low) - 3, 2):
        a, b = struct.unpack_from('>I', low, at)[0], struct.unpack_from('>I', high, at)[0]
        if b - a == SHIFT:
            if a >= end:
                raise ValueError('The reference at %#x points outside the module.' % at)
            offsets.append(at)
            moved.update((at, at + 1))  # adding 0x10000 changes only the upper half
    if len(low) != len(high) or any(x != y and i not in moved for i, (x, y) in enumerate(zip(low, high))):
        raise ValueError('The module has a reference the base cannot relocate.')
    return offsets


def module_id(name):
    return int.from_bytes(hashlib.sha256(name.encode()).digest()[:4], 'big')


def package(image, bss, hooks, offsets, sites=(), name='', dsp=None, flags=0):
    """sites: (address, stock bytes, new bytes, offsets of self-references in them); dsp: dsp_section()'s."""
    records = b''
    for address, stock, code, local in sites:
        if len(stock) != len(code) or not 0 < len(code) <= SITE_BYTES or len(local) > SITE_RELOCATIONS:
            raise ValueError('Site at %#x exceeds the loader\'s bounds.' % address)
        records += struct.pack('>IHH', address, len(code), len(local)) + stock + code + struct.pack('>%dH' % len(local), *local)
    head = struct.pack('>IIIIII', len(image), bss, len(offsets), len(hooks), len(sites), module_id(name))
    if dsp:
        head += struct.pack('>IHBBHHHBBH', len(dsp['words']), len(dsp['relocations']), dsp['effect'], dsp['slots'],
                            dsp['init'], dsp['proc'], dsp['cycles'], dsp['kind'], dsp['state'], dsp['buffer'])
        head += dsp['name'].encode().ljust(16, b'\0') + struct.pack('>H', dsp['layout'])
        records += struct.pack('>%dI' % len(dsp['words']), *dsp['words']) + struct.pack('>%dH' % len(dsp['relocations']), *dsp['relocations'])
    return (b'MWRM' + struct.pack('>HH', 6 if dsp else 4, flags) + head + struct.pack('>%dI' % len(hooks), *hooks) + image
            + struct.pack('>%dI' % len(offsets), *offsets) + records)


PAGE_MAGIC = b'MWPG'


def page_section(module_id):
    """(image, relocations): the Octatrack effect page recipe scripts/octatrack-module-page.mjs makes, laid out
    for the base's fxpage.c (big-endian): 'MWPG', the donor descriptor's address and SHA-256, the slots whose
    enable bits it inherits, the counts, a word the base keeps (where the fixups point), the integer patches
    (offset, width, value), the text patches (offset, width, length, text), the formatters (slot, fixups,
    clear-widget, code pointer, code length, fixup offsets), then each formatter's code. No stock bytes."""
    out = subprocess.run(['node', str(Path(__file__).resolve().parents[3] / 'scripts/octatrack-module-page.mjs'), module_id],
                         capture_output=True, text=True)
    if out.returncode:
        raise ValueError('No FX page for %s: %s' % (module_id, out.stderr.strip().splitlines()[-1] if out.stderr.strip() else '?'))
    page = json.loads(out.stdout)
    inherited = sum(1 << slot for slot in page['inheritedEnable'])
    head = PAGE_MAGIC + struct.pack('>I', page['donor']) + bytes.fromhex(page['donorSha256']) + struct.pack(
        '>HBBBBHI', inherited, len(page['integers']), len(page['strings']), len(page['formatters']), 0, 0, 0)
    body = b''.join(struct.pack('>HBBI', f['offset'], f['width'], 0, f['value']) for f in page['integers'])
    for f in page['strings']:
        text = f['value'].encode('latin-1')
        entry = struct.pack('>HBB', f['offset'], f['width'], len(text)) + text
        body += entry + b'\0' * (-len(entry) % 4)
    entries, at = [], len(head) + len(body)
    for f in page['formatters']:
        entries.append(struct.pack('>BBBBIHH', f['slot'], len(f['fixups']), int(f['clearWidget']), 0, 0, len(f['code']) // 2, 0) +
                       struct.pack('>%dH' % len(f['fixups']), *f['fixups']))
        entries[-1] += b'\0' * (-len(entries[-1]) % 4)
    image, relocations = bytearray(head + body + b''.join(entries)), []
    for f, entry_at in zip(page['formatters'], [at + sum(len(e) for e in entries[:i]) for i in range(len(entries))]):
        code = bytes.fromhex(f['code'])
        struct.pack_into('>I', image, entry_at + 4, len(image))       # the loader adds the module's address
        relocations.append(entry_at + 4)
        relocations += [len(image) + r for r in f['relocations']]
        image += code + b'\0' * (-len(code) % 4)
    return bytes(image), sorted(relocations)


def dsp_section(pkg, slots, cycles, kind, state, buffer=0, name='', layout=1):
    """A relocatable DSP package (Modwerk's package builder: 24-bit words as hex,
    relocations, init, proc, its effect id and placement proofs) and its needs."""
    code = pkg['code']
    words = [int(code[i:i + 6], 16) for i in range(0, len(code), 6)]
    relocations = sorted(pkg['relocations'])

    def digest(base):
        placed = [(w + base) & 0xffffff if i in relocations else w for i, w in enumerate(words)]
        return hashlib.sha256(b''.join(w.to_bytes(3, 'big') for w in placed)).hexdigest()
    if (len(words) != pkg['words'] or not 0 < len(words) <= DSP_WORDS or len(relocations) > DSP_RELOCATIONS or
            len(set(relocations)) != len(relocations) or any(not 0 <= r < len(words) or words[r] >= len(words) for r in relocations) or
            not (0 <= pkg['init'] < len(words) and 0 <= pkg['proc'] < len(words)) or digest(0) != pkg['sha256']):
        raise ValueError('The DSP package is malformed or does not match its checksum.')
    if len(pkg.get('proofs', [])) < 2 or any(digest(proof['base']) != proof['sha256'] for proof in pkg['proofs']):
        raise ValueError('The DSP package has no placement proofs, or its relocation does not reproduce them.')
    if not (0 < pkg['fxId'] < 32 and slots in SLOTS and kind in CYCLE_KINDS and 0 < cycles < 65536 and 0 < state <= STATE_WORDS
            and 0 <= buffer <= BUFFER_WORDS):
        raise ValueError('Give the effect its slots, a cycle figure and its kind, its state words (at most %d) and the '
                         'delay-buffer words it reads (at most %d).' % (STATE_WORDS, BUFFER_WORDS))
    if not (0 < len(name) <= 15 and name.isascii() and name.isprintable() and 0 < layout < 65536):
        raise ValueError('Give the effect a display name of 1-15 printable ASCII characters and a layout number of 1-65535.')
    return dict(words=words, relocations=relocations, effect=pkg['fxId'], slots=SLOTS[slots], init=pkg['init'], proc=pkg['proc'],
                cycles=cycles, kind=CYCLE_KINDS[kind], state=state, buffer=buffer, name=name, layout=layout)


def link_elemod(doc, stock_at, base_symbols):
    """A converted module laid out from 0: (image, self-reference offsets, sites)."""
    unsupported = [k for k in ('contribute', 'subscribe', 'copied') if doc.get(k)]
    if unsupported or set(doc['sections']) != {'.run'}:
        raise ValueError('Runtime loading supports one .run section and stock-code sites only, not '
                         + ', '.join(unsupported or sorted(doc['sections'])) + '.')
    run, symbols = doc['sections']['.run'], doc['symbols']
    image = bytearray()
    for part in run['parts']:
        if part[0] == 'hex':
            image += bytes.fromhex(part[1])
        elif part[0] == 'stock':
            image += stock_at(int(part[1], 16), part[2])
        else:
            raise ValueError('Unsupported section part: ' + part[0])
    if len(image) != run['len']:
        raise ValueError('The .run section does not have its declared length.')

    def resolve(target, addend):
        """(value, whether it is an offset into the module)"""
        kind, _, name = target.partition(':')
        if kind == 'sec' and name == '.run':
            return addend, True
        if kind == 'sym' and name in symbols:
            where, value = symbols[name]
            if where not in ('.run', 'abs'):
                raise ValueError('Unsupported symbol section: ' + where)
            return value + addend, where == '.run'
        if kind == 'sym' and name in base_symbols:
            return base_symbols[name] + addend, False
        raise ValueError('Unresolved relocation target: ' + target)

    def apply(data, entries):
        local = []
        for at, kind, target, addend in entries:
            if kind != 'abs32':
                raise ValueError('Unsupported relocation: ' + kind)
            value, inside = resolve(target, addend)
            struct.pack_into('>I', data, at, value & 0xffffffff)
            if inside:
                local.append(at)
        return local

    offsets = apply(image, [r[1:] for r in doc.get('relocs', []) if r[0] == '.run'] + run.get('relocs', []))
    if any(r[0] != '.run' for r in doc.get('relocs', [])):
        raise ValueError('Relocations outside .run.')
    sites = []
    for site in doc.get('sites', []):
        if site.get('kind', 'code') != 'code' or 'new' not in site:
            raise ValueError('Runtime loading patches code sites with given bytes only (site %s).' % site.get('addr'))
        address, length = int(site['addr'], 16), site['len']
        stock = stock_at(address, length)
        if hashlib.sha256(stock).hexdigest() != site['stock_sha256']:
            raise ValueError('Stock bytes at %#x are not the ones the module expects.' % address)
        code = bytearray.fromhex(site['new'])
        local = apply(code, site.get('relocs', []))
        sites.append((address, stock, bytes(code), local))
    return bytes(image), offsets, sites


def build_c(sources, cross, module, dsp=None):
    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        objects = [tmp / ('%d.o' % i) for i in range(len(sources))]
        for source, obj in zip(sources, objects):
            subprocess.run([cross + 'gcc', *CFLAGS, '-c', str(source), '-o', str(obj)], check=True)
        images, symbols = [], {}
        for base in (0, SHIFT):
            (tmp / 'link.ld').write_text(SCRIPT % base)
            elf = tmp / ('%x.elf' % base)
            subprocess.run([cross + 'ld', '--orphan-handling=error', '--no-warn-rwx-segments', '-T', str(tmp / 'link.ld'),
                            '-o', str(elf), *map(str, objects)], check=True)
            subprocess.run([cross + 'objcopy', '-O', 'binary', '-j', '.image', str(elf), str(tmp / 'image')], check=True)
            images.append((tmp / 'image').read_bytes())
            if base == 0:
                for line in subprocess.check_output([cross + 'nm', str(elf)], text=True).splitlines():
                    value, _, name = line.split()
                    symbols[name] = int(value, 16)
    image, length, end = images[0], symbols['__image_end'], symbols['__bss_end']
    if len(image) != length:
        raise ValueError('The module image is not contiguous.')
    hooks = [symbols.get(name, NONE) for name in HANDLERS]
    if all(h == NONE for h in hooks):
        raise ValueError('Define at least one of ' + ', '.join(HANDLERS) + '.')
    return package(image, end - length, hooks, relocations(image, images[1], end), name=module, dsp=dsp)


def build_elemod(args):
    if not (args.stock and args.upstream):
        sys.exit('--elemod needs --stock and --upstream.')
    sys.path.insert(0, str(args.upstream.expanduser().resolve()))
    from elekloader import formats
    parsed, device, _ = formats.load(str(args.stock))
    main = formats.main_image(parsed, device)
    doc = json.loads(args.elemod.read_text())
    if doc.get('target', {}).get('section3_sha256') != hashlib.sha256(main).hexdigest():
        sys.exit('The module was converted for a different stock OS.')
    base = json.loads(args.base_symbols.read_text()) if args.base_symbols else {}

    def stock_at(address, length):
        at = address - device.main_load
        if at < 0 or at + length > len(main):
            raise ValueError('Stock bytes outside the OS image: %#x' % address)
        return main[at:at + length]

    image, offsets, sites = link_elemod(doc, stock_at, base)
    return package(image, 0, [], offsets, sites, name=doc['id'])


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('sources', type=Path, nargs='*')
    parser.add_argument('-o', '--output', type=Path, required=True)
    parser.add_argument('--cross', default='m68k-elf-')
    parser.add_argument('--elemod', type=Path)
    parser.add_argument('--stock', type=Path)
    parser.add_argument('--upstream', type=Path)
    parser.add_argument('--base-symbols', type=Path)
    parser.add_argument('--dsp', help='JSON:KEY, a relocatable DSP package; alone, or beside C sources')
    parser.add_argument('--slots', choices=sorted(SLOTS))
    parser.add_argument('--cycles', type=int, help='worst case per sample and instance')
    parser.add_argument('--cycles-kind', choices=sorted(CYCLE_KINDS))
    parser.add_argument('--state', type=int, help='r7 state words per instance')
    parser.add_argument('--buffer', type=int, default=0, help='Y words of the slot buffer the effect reads from its base')
    parser.add_argument('--name', help='the display name projects record it by (default: its catalogue name)')
    parser.add_argument('--layout', type=int, default=1, help='parameter-layout number: raise it when stored values change meaning')
    parser.add_argument('--no-page', action='store_true', help='leave out the effect page recipe (no chooser row on the unit)')
    args = parser.parse_args()
    if (bool(args.sources) and bool(args.elemod)) or not (args.sources or args.elemod or args.dsp) or (args.elemod and args.dsp):
        parser.error('Give C sources, --elemod or --dsp.')
    dsp = None
    if args.dsp:
        path, _, key = args.dsp.partition(':')
        doc = json.loads(Path(path).read_text())
        pkg = next((p for p in doc['packages'] if p['id'] == key), None) if 'packages' in doc else doc[key] if key else doc
        if not pkg:
            parser.error('No DSP package %s in %s.' % (key, path))
        documents = json.loads((Path(__file__).resolve().parents[3] / 'src/catalog/module-documents.json').read_text())
        named = next((m.get('name') for m in documents.get('modules', []) if m.get('id') == pkg['id']), None) if 'id' in pkg else None
        dsp = dsp_section(pkg, args.slots, args.cycles or 0, args.cycles_kind, args.state or 0, args.buffer,
                          args.name or named or pkg.get('key', ''), args.layout)
    if args.elemod:
        data = build_elemod(args)
    elif args.sources:
        data = build_c(args.sources, args.cross, args.output.stem, dsp)
    else:
        image, relocations = page_section(pkg['id']) if 'id' in pkg and not args.no_page else (b'', [])
        data = package(image, 0, [], relocations, name=pkg.get('id', args.output.stem), dsp=dsp, flags=1 if image else 0)
    args.output.write_bytes(data)
    image, bss, count, hooks, sites, ident = struct.unpack_from('>IIIIII', data, 8)
    header = 68 if dsp else 32
    print('%s: module %08x, %d bytes of code and data, %d of bss, %d relocations, %d hooks, %d stock-code sites%s' % (
        args.output, ident, image, bss, count, sum(h != NONE for h in struct.unpack_from('>%dI' % hooks, data, header)), sites,
        ', DSP effect %d: %d words, %d relocations' % (dsp['effect'], len(dsp['words']), len(dsp['relocations'])) if dsp else ''))


if __name__ == '__main__':
    main()
