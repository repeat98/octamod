#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
"""Prove a runtime package holds what Elekloader's own static link of the module would.

    python3 -B sdk/runtime/loader/verify_static.py --stock OS.bin --upstream ~/.cache/modwerk-upstream/elekloader \\
        --core BASE/package/core.elemod --elemod MOD.elemod --package MOD.mwrm

Links the base's core and the module with Elekloader, finds where the module's
code landed, and places the package there the way the base's loader would.
The relocated code and every patched site must match the static image byte
for byte, and each site's stock bytes must match stock. Local files only.
"""
import argparse
import json
from pathlib import Path
import struct
import sys
import tempfile


def unpack(data):
    """(image, self-reference offsets, sites) of an ABI 3 to 6 package (its DSP code is not linked statically)."""
    abi = struct.unpack_from('>H', data, 4)[0] if data[:4] == b'MWRM' else 0
    if abi not in (3, 4, 5, 6):
        raise ValueError('Not an ABI 3 to 6 runtime package.')
    image, _, count, hooks, sites = struct.unpack_from('>IIIII', data, 8)
    dsp_words, dsp_relocations = struct.unpack_from('>IH', data, 32) if abi >= 5 else (0, 0)
    at = {3: 28, 4: 32, 5: 50, 6: 68}[abi] + 4 * hooks
    code, at = data[at:at + image], at + image
    offsets = struct.unpack_from('>%dI' % count, data, at)
    at += 4 * count
    records = []
    for _ in range(sites):
        address, n, r = struct.unpack_from('>IHH', data, at)
        records.append((address, data[at + 8:at + 8 + n], data[at + 8 + n:at + 8 + 2 * n],
                        struct.unpack_from('>%dH' % r, data, at + 8 + 2 * n)))
        at += 8 + 2 * n + 2 * r
    if at + 4 * dsp_words + 2 * dsp_relocations != len(data):
        raise ValueError('Trailing bytes in the package.')
    return code, offsets, records


def placed(data, offsets, base):
    data = bytearray(data)
    for at in offsets:
        struct.pack_into('>I', data, at, struct.unpack_from('>I', data, at)[0] + base)
    return bytes(data)


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    for name in ('stock', 'upstream', 'core', 'elemod', 'package'):
        parser.add_argument('--' + name, type=Path, required=True)
    args = parser.parse_args()
    sys.path.insert(0, str(args.upstream.expanduser().resolve()))
    from elekloader import formats, patch
    parsed, device, _ = formats.load(str(args.stock))
    stock = formats.main_image(parsed, device)
    outputs, manifest = patch.build(str(args.stock), [str(args.core), str(args.elemod)], version='ELEKLOADER',
                                    log=lambda *a, **k: None)
    with tempfile.TemporaryDirectory() as tmp:
        (Path(tmp) / 'linked.bin').write_bytes(outputs['bin'])
        linked = formats.main_image(formats.parse(str(Path(tmp) / 'linked.bin'), device), device)
    symbols, doc = manifest['_map'], json.loads(args.elemod.read_text())
    bases = {symbols[key] - offset for name, (where, offset) in doc['symbols'].items() if where == '.run'
             for key in (name, doc['id'] + ':' + name) if key in symbols}
    if len(bases) != 1:
        raise ValueError('Cannot tell where Elekloader placed the module: %s' % sorted(map(hex, bases)))
    base = bases.pop()
    image, offsets, sites = unpack(args.package.read_bytes())
    at = symbols['__run_load'] + (base - symbols['__run_start']) - device.main_load
    checks = {'module code at %#x' % base: placed(image, offsets, base) == linked[at:at + len(image)]}
    for address, old, new, local in sites:
        here = address - device.main_load
        checks['site %#x' % address] = (old == stock[here:here + len(old)] and
                                        placed(new, local, base) == linked[here:here + len(new)])
    for name, ok in checks.items():
        print('%-28s %s' % (name, 'matches the static link' if ok else 'DIFFERS'))
    if not all(checks.values()):
        sys.exit(1)
    print('The package places the same bytes as Elekloader\'s static link of this module.')


if __name__ == '__main__':
    main()
