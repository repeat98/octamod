# SPDX-License-Identifier: GPL-3.0-or-later
"""The machine-neutral runtime module loader (sdk/runtime/loader): its C host
test, the builder's relocation finder and, with a ColdFire cross compiler, a
real module build. No firmware or device."""
import hashlib
import importlib.util
from pathlib import Path
import shutil
import struct
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
LOADER = ROOT / 'sdk/runtime/loader'
spec = importlib.util.spec_from_file_location('runtime_loader_build', LOADER / 'build.py')
build = importlib.util.module_from_spec(spec)
spec.loader.exec_module(build)
spec = importlib.util.spec_from_file_location('runtime_loader_verify', LOADER / 'verify_static.py')
verify_static = importlib.util.module_from_spec(spec)
spec.loader.exec_module(verify_static)


class LoaderTests(unittest.TestCase):
    def test_loader_on_the_host(self):
        cc = shutil.which('cc')
        if not cc:
            self.skipTest('no host C compiler')
        with tempfile.TemporaryDirectory() as temp:
            subprocess.run([cc, '-std=c99', '-Wall', '-Wextra', '-Werror', '-pedantic', '-I', LOADER,
                            '-I', ROOT / 'sdk/runtime/upload', LOADER / 'tests/host_test.c', '-o', temp + '/t'],
                           check=True, capture_output=True)
            result = subprocess.run([temp + '/t'], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_relocations_are_the_words_that_move_with_the_link_address(self):
        low = struct.pack('>HIHI', 0x4e71, 0x10, 0x4e75, 0x40001e50)  # a self-reference, then a stock address
        high = struct.pack('>HIHI', 0x4e71, 0x10010, 0x4e75, 0x40001e50)
        self.assertEqual(build.relocations(low, high, 0x20), [2])
        with self.assertRaisesRegex(ValueError, 'outside'):
            build.relocations(low, high, 0x10)
        with self.assertRaisesRegex(ValueError, 'cannot relocate'):  # e.g. a 16-bit reference
            build.relocations(low, struct.pack('>HIHI', 0x4e71, 0x10, 0x4e75, 0x40001e51), 0x20)

    def test_package_layout(self):
        site = (0x40094296, b'\x70\x20\x11\x40\x00\x0e', b'\x4e\xf9\0\0\0\0', [2])
        data = build.package(b'\x4e\x75\0\0', 8, [0, build.NONE, build.NONE, build.NONE], [0], [site], name='octabam-previewvol')
        ident = int.from_bytes(hashlib.sha256(b'octabam-previewvol').digest()[:4], 'big')
        self.assertEqual(data[:32], b'MWRM' + struct.pack('>HHIIIIII', 4, 0, 4, 8, 1, 4, 1, ident))
        self.assertEqual(data[32 + 16 + 4 + 4:], struct.pack('>IHH', 0x40094296, 6, 1) + site[1] + site[2] + b'\0\2')
        self.assertEqual(verify_static.unpack(data), (b'\x4e\x75\0\0', (0,), [(0x40094296, site[1], site[2], (2,))]))
        with self.assertRaisesRegex(ValueError, 'bounds'):
            build.package(b'', 0, [], [], [(0x40000400, b'\0' * 34, b'\0' * 34, [])])

    def test_dsp_effect_package(self):
        import json
        pkg = next(p for p in json.loads((ROOT / 'src/engine/assets/dsp-packages.json').read_text())['packages'] if p['id'] == 'everb')
        dsp = build.dsp_section(pkg, 'fx2', 382, 'executed', 132, 16384, 'E-Verb', 2)
        self.assertEqual((len(dsp['words']), dsp['relocations'], dsp['effect'], dsp['slots'], dsp['kind']), (1588, [5, 66, 683], 27, 2, 1))
        data = build.package(b'', 0, [], [], name='everb', dsp=dsp)
        self.assertEqual(data[:8], b'MWRM\0\6\0\0')
        self.assertEqual(struct.unpack_from('>IHBBHHHBBH', data, 32), (1588, 3, 27, 2, 0, 51, 382, 1, 132, 16384))
        self.assertEqual((data[50:66], struct.unpack_from('>H', data, 66)[0]), (b'E-Verb' + b'\0' * 10, 2)) # ABI 6: name, layout
        self.assertEqual(len(data), 68 + 4 * 1588 + 2 * 3)
        self.assertEqual(struct.unpack_from('>I', data, 68)[0], dsp['words'][0])
        self.assertEqual(verify_static.unpack(data), (b'', (), []))
        for broken in ({'proofs': [{'base': 4096, 'sha256': '0' * 64}] * 2}, {'proofs': []}, {'sha256': '0' * 64}):
            with self.subTest(broken=list(broken)), self.assertRaises(ValueError):
                build.dsp_section({**pkg, **broken}, 'fx2', 382, 'executed', 132, 16384, 'E-Verb')
        with self.assertRaisesRegex(ValueError, 'state words'):
            build.dsp_section(pkg, 'fx2', 382, 'executed', 133, 16384, 'E-Verb')
        with self.assertRaisesRegex(ValueError, 'display name'):
            build.dsp_section(pkg, 'fx2', 382, 'executed', 132, 16384, 'A' * 16)

    def test_converted_module_becomes_image_relocations_and_sites(self):
        stock = {0x40001000: bytes.fromhex('70201140000e'), 0x40002000: bytes.fromhex('4e714e71')}
        doc = {'sections': {'.run': {'align': 4, 'len': 18, 'parts': [['hex', '114000000000'], ['stock', '0x40002000', 4],
                                                                       ['hex', '0000000040003000']]}},
               'symbols': {'entry': ['.run', 6], 'VOL': ['abs', 64]},
               'relocs': [['.run', 10, 'abs32', 'sec:.run', 4], ['.run', 2, 'abs32', 'sym:VOL', 0]],
               'sites': [{'addr': '0x40001000', 'len': 6, 'kind': 'code', 'new': '4ef900000000',
                          'stock_sha256': hashlib.sha256(stock[0x40001000]).hexdigest(),
                          'relocs': [[2, 'abs32', 'sym:entry', 0]]}]}
        image, offsets, sites = build.link_elemod(doc, lambda a, n: stock[a][:n], {})
        self.assertEqual(image, bytes.fromhex('114000000040') + stock[0x40002000] + bytes.fromhex('0000000440003000'))
        self.assertEqual(offsets, [10])  # the section reference; the constant VOL is written as it is
        self.assertEqual(sites, [(0x40001000, stock[0x40001000], bytes.fromhex('4ef900000006'), [2])])
        doc['sites'][0]['stock_sha256'] = '0' * 64
        with self.assertRaisesRegex(ValueError, 'Stock bytes'):
            build.link_elemod(doc, lambda a, n: stock[a][:n], {})
        for key, value in (('contribute', [{'to': 'ev_midi'}]), ('sites', [{'addr': '0x40001000', 'len': 6, 'kind': 'data'}])):
            with self.subTest(key), self.assertRaises(ValueError):
                build.link_elemod({**doc, key: value}, lambda a, n: stock[a][:n], {})
        with self.assertRaisesRegex(ValueError, 'Unresolved'):
            build.link_elemod({**doc, 'relocs': [['.run', 10, 'abs32', 'sym:arena_base', 0]]}, lambda a, n: stock[a][:n], {})

    def test_builds_the_octatrack_example(self):
        if not shutil.which('m68k-elf-gcc'):
            self.skipTest('no ColdFire cross compiler')
        with tempfile.TemporaryDirectory() as temp:
            out = Path(temp) / 'hello.mwrm'
            subprocess.run(['python3', '-B', LOADER / 'build.py', ROOT / 'sdk/machines/octatrack/elekloader/examples/hello.c',
                            '-o', out], check=True, capture_output=True)
            data = out.read_bytes()
        abi, image, bss, count, hooks, sites, ident = struct.unpack_from('>4xH2xIIIIII', data)
        self.assertEqual((abi, hooks, sites, ident), (4, 4, 0, build.module_id('hello')))
        self.assertGreater(count, 0)  # its counters are reached through absolute addresses
        self.assertNotIn(build.NONE, struct.unpack_from('>4I', data, 32))
        self.assertEqual(len(data), 32 + 16 + image + 4 * count)


if __name__ == '__main__':
    unittest.main()
