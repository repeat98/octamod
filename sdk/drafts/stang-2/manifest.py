"""Stang 2 source draft. Prepare only in an isolated local native tree.
Generated runtime.s contains stock replay bytes; never publish that file.
"""
from remix.stock_guard import stock_guard
from remix.schema import Category, Detour, Gate, Kind, Linked, Module, Poke, Proof
H=bytes.fromhex
MODULE=Module(
    name="stang-2", key="STANG 2", kind=Kind.CF_PATCH,
    category=Category.MACHINES, author="repeat98", author_url="https://github.com/repeat98",
    doc="Editable generative sample patterns; SRC generator and stock edit view.",
    proof=Proof.UNTESTED, proof_note="Source draft; native behavior and hardware qualification pending.",
    linked=(Linked("stang", "modules/stang-2/runtime.s", cpu="5475", dram=True),),
    detours=(
        Detour(0x400334d8, stock_guard(0x400334d8, 6, 'd6c9f1f60272197a17511f496fc19dd21ddd7df5f1f1ec0cab7a16cad60b0609'), 'stang', 'st_machine_name', 'Stang 2 native selection/editor access'),
        Detour(0x4003c928, stock_guard(0x4003c928, 6, '237cd1acd4da7acb61dc7fda7c88e648a5186b36732f433b4dd91966c5a669af'), 'stang', 'st_src_names', 'Stang 2 native selection/editor access', kind='lea'),
        Detour(0x4003d718, stock_guard(0x4003d718, 6, '53b8d23acf2c3fe0f794c0a5f37475b17c3433bc6a466e0e1861515989cfecda'), 'stang', 'st_name_a', 'Stang 2 native selection/editor access'),
        Detour(0x4004c36a, stock_guard(0x4004c36a, 6, '53b8d23acf2c3fe0f794c0a5f37475b17c3433bc6a466e0e1861515989cfecda'), 'stang', 'st_name_b', 'Stang 2 native selection/editor access'),
        Detour(0x4003c980, stock_guard(0x4003c980, 6, '237e017ccd95444195ca390a3e6ca6076fbfa1f0931f2e7dfbdbee8c5ec72ca3'), 'stang', 'st_setup_row', 'Stang 2 native selection/editor access'),
        Detour(0x400786c8, stock_guard(0x400786c8, 4, 'f829e3570d9d9e95b7d7b9b0433b1aad2f13c0ac087873dbf981482521301309'), 'stang', 'st_chooser_row', 'Stang 2 native selection/editor access'),
        Detour(0x400585dc, stock_guard(0x400585dc, 10, '22fb6e2bea4520003d2fae7035c0cd57bcd6fe6f2cfdd5b70580a3f6f2a68034'), 'stang', 'st_setup_open', 'Stang 2 native selection/editor access', pad_to=10),
        Detour(0x4005221e, stock_guard(0x4005221e, 10, '8f0fa4f7d6db857f695996b185b38b788fa6af0eacd86d7dd01e2ff61201ffed'), 'stang', 'st_tick_hook', 'Stang 2 native selection/editor access', pad_to=10),
        Detour(0x40078886, stock_guard(0x40078886, 10, 'fe6cb52458c7d968dc467c1cd7721d832baf6bc2fac1826c8c10ed07fee2e7f8'), 'stang', 'st_chooser_open', 'Stang 2 native selection/editor access', pad_to=10),
        Detour(0x4007981c, stock_guard(0x4007981c, 6, '89c50ac3ca041fdf5647ec5ee2c3580f9a67dd79f0b5cc15ceadda4b9e9bede0'), 'stang', 'st_main_commit', 'Stang 2 native selection/editor access'),
        Detour(0x4005a616, stock_guard(0x4005a616, 6, '7a7350a69423ec41ec468a189ba167059626cb7f499d9862394d2388a23c8b59'), 'stang', 'st_src_commit', 'Stang 2 native selection/editor access'),
        Detour(0x4005a850, stock_guard(0x4005a850, 6, '7a7350a69423ec41ec468a189ba167059626cb7f499d9862394d2388a23c8b59'), 'stang', 'st_src_commit2', 'Stang 2 native selection/editor access'),
        Detour(0x4003a52e, stock_guard(0x4003a52e, 8, 'cae34bf50383462ed4f92d8044e3021247edb8bf69c17a9c7ead62f6edf79510'), 'stang', 'st_setup_edit6', 'Stang 2 native selection/editor access', pad_to=8),
        Detour(0x4003cd98, stock_guard(0x4003cd98, 8, 'ed71ef874312890edc87cef7e19cd8c0f8ac4ac9b90182c2364f78d3a4567f45'), 'stang', 'st_setup_draw6', 'Stang 2 native selection/editor access', pad_to=8),
    ),
    pokes=(
        Poke(0x40079248, stock_guard(0x40079248, 4, '8fbd3190028fe564c11b56e3e73e8eaf36925cbabf94164176eeb4c4f57bc6ac'), H('48780006'), 'Stang 2 is machine chooser row six'),
        Poke(0x400585fa, stock_guard(0x400585fa, 4, '8fbd3190028fe564c11b56e3e73e8eaf36925cbabf94164176eeb4c4f57bc6ac'), H('48780006'), 'Stang 2 is machine chooser row six'),
        Poke(0x4003c950, stock_guard(0x4003c950, 2, '74d01dadcbe6a57ef61bc53a5a65404cd8446c6738ff0ac86b1b1a78d8ae7d41'), H('7205'), 'Stang 2 is machine chooser row six'),
        Poke(0x40078678, stock_guard(0x40078678, 2, '04cd1c6d463ba6752ff68f9125991b1c4af983ae355b62366122ba2d47eee3b2'), H('7005'), 'Stang 2 is machine chooser row six'),
        Poke(0x400786ce, stock_guard(0x400786ce, 2, '04cd1c6d463ba6752ff68f9125991b1c4af983ae355b62366122ba2d47eee3b2'), H('7005'), 'Stang 2 is machine chooser row six'),
        Poke(0x40079904, stock_guard(0x40079904, 2, '577d7ba37f9786ab02a7dc9eeb612bb55936018179b550b14f4b9f000a89bf20'), H('7605'), 'Stang 2 is machine chooser row six'),
    ),
    gates=(Gate("modules/stang-2/verify_native.py", remix_arg=False),),
)
