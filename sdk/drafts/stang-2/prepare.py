#!/usr/bin/env python3
"""Private native preparation. Run in isolation; never check in runtime.s.
All stock replay bytes come from the developer's verified local 1.40C.
"""
from pathlib import Path
import argparse
import hashlib
import subprocess
import tempfile

BASE_SHA256 = '164f31224bf61181e3f50e7dec40df9afcae5b16dbf6e4c0d0cc5e986af0a84e'
FLAGS = ['-mcpu=5475','-msoft-float','-O2','-ffreestanding','-fno-builtin',
         '-fno-common','-fno-jump-tables','-fno-asynchronous-unwind-tables',
         '-fno-ident','-fomit-frame-pointer','-fno-zero-initialized-in-bss',
         '-Wall','-Wextra','-Werror']
REPLAYS = (
    ('st_name_replay',0x400334d8,6),
    ('st_main_replay',0x4007981c,6),
    ('st_edit_replay',0x4003a52e,8),
    ('st_draw_replay',0x4003cd98,8),
)

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--stock',type=Path,required=True)
    parser.add_argument('--output',type=Path,required=True)
    args=parser.parse_args()
    stock=args.stock.read_bytes()
    if hashlib.sha256(stock).hexdigest()!=BASE_SHA256:
        parser.error('Not the verified original 1.40C MAIN OS. No output written.')
    here=Path(__file__).resolve().parent
    if args.output.exists(): parser.error('Output exists; use a fresh private build directory.')
    with tempfile.TemporaryDirectory(prefix='stang-cf.') as directory:
        work=Path(directory)
        unity=work/'stang.c'
        unity.write_text('#include "engine.c"\n#include "native.c"\n')
        assembly=work/'stang.s'
        subprocess.run(['m68k-elf-gcc',*FLAGS,'-I',str(here),'-S',str(unity),'-o',str(assembly)],check=True)
        text=assembly.read_text()+'\n#APP\n'+(here/'hooks.s').read_text()+'\n.text\n.balign 2\n'
        # These four displaced spans contain no PC-relative instruction.
        # The full-base hash and manifest stock guards bind every input.
        for name,address,length in REPLAYS:
            body=stock[address-0x40000400:address-0x40000400+length]
            text+=name+':\n.byte '+','.join(str(b) for b in body)+'\njmp '+hex(address+length)+'\n'
        args.output.write_text(text)
    print('Prepared private ColdFire source; stock replay bytes must stay temporary.')

if __name__=='__main__': main()
