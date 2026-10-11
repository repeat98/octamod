/* SPDX-License-Identifier: GPL-3.0-or-later
 * Host check of the DSP effect glue (cc -DMODWERK_HOST -DMODWERK_DSP_ALLOWANCE=2808 -DMODWERK_DSP_RESERVE=331):
 * admission against the arena, the instance block, cycles, free ids and
 * effects in use, and the catalog the DSP manager reads. */
#include "dsp.c"
#include "fxmap.c"
#include <stdio.h>
#include <string.h>
const struct fx_legacy modwerk_fx_legacy[] = {{0x873d83ccu, 27, "E-Verb"}};
const uint32_t modwerk_fx_legacy_count = 1;
static char written[256];
static int capture(uint32_t file, const void *data, unsigned length)
{
    (void)file;
    strncat(written, (const char *)data, length);
    return 1;
}

static unsigned failures;
#define CHECK(x) do { if (!(x)) { failures++; fprintf(stderr, "%s:%d: %s\n", __FILE__, __LINE__, #x); } } while (0)
const uint32_t dl_stub_at_boot = 1u << 21 | 1u << 26 | 1u << 27, modwerk_dsp_modules = 1u << 26 | 1u << 27;
/* identity.c's catalog: SPRING REV (21) a stock package loaded on demand, every other id what stock runs. */
#define STOCK4 STOCK, STOCK, STOCK, STOCK
struct dl_package dl_catalog[32] = {STOCK4, STOCK4, STOCK4, STOCK4, STOCK4, STOCK, {1063, 1, 331, 2, 0, 1, 1}, STOCK, STOCK, STOCK4, STOCK4};
struct code dl_codes[2][32];
const uint16_t modwerk_dsp_arena[2] = {2320, 2300};
static int idle = 1;
int dl_publication_idle(void) { return idle; }

int main(void)
{
    static const uint32_t words[3] = {1, 2, 3};
    static const uint16_t relocations[1] = {0};
    struct runtime_dsp none = {0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, ""};
    struct runtime_dsp fx = {words, relocations, 3, 1, 1, 2, 244, 0, 26, 1, RUNTIME_MODELED, 70, 70, 1, "Test FX"};
    CHECK(modwerk_machine_dsp_admit(&none, &none) == RUNTIME_OK && modwerk_machine_dsp_admit(&none, &fx) == RUNTIME_OK);
    /* The effect id is a handle: the preferred one when it is a free module id, else the lowest free module id. */
    fx.id = 27; CHECK(modwerk_machine_dsp_admit(&none, &fx) == RUNTIME_OK && fx.id == 27);
    fx.id = 21; CHECK(modwerk_machine_dsp_admit(&none, &fx) == RUNTIME_OK && fx.id == 26); /* a stock effect's id */
    fx.id = 40; CHECK(modwerk_machine_dsp_admit(&none, &fx) == RUNTIME_OK && fx.id == 26);
    fx.id = 26;
    /* The smaller core's arena, the instance block, a known cycle figure within the allowance. */
    fx.count = 2301; CHECK(modwerk_machine_dsp_admit(&none, &fx) == RUNTIME_MEMORY);
    fx.count = 2300; CHECK(modwerk_machine_dsp_admit(&none, &fx) == RUNTIME_OK);
    fx.count = 3; fx.state = 133; CHECK(modwerk_machine_dsp_admit(&none, &fx) == RUNTIME_MEMORY);
    fx.state = 70; fx.buffer = 3073; CHECK(modwerk_machine_dsp_admit(&none, &fx) == RUNTIME_MEMORY); /* FX1's 3K block */
    fx.slots = 2; CHECK(modwerk_machine_dsp_admit(&none, &fx) == RUNTIME_OK);                          /* FX2's 16K block */
    fx.buffer = 16385; CHECK(modwerk_machine_dsp_admit(&none, &fx) == RUNTIME_MEMORY);
    fx.slots = 1; fx.buffer = 0; fx.kind = 0; CHECK(modwerk_machine_dsp_admit(&none, &fx) == RUNTIME_CYCLES);
    fx.kind = RUNTIME_HARDWARE; fx.cycles = 2808 - 7 * 331 + 1; CHECK(modwerk_machine_dsp_admit(&none, &fx) == RUNTIME_CYCLES);
    fx.cycles = 2808 - 7 * 331; CHECK(modwerk_machine_dsp_admit(&none, &fx) == RUNTIME_OK); /* beside seven stock slots */
    fx.kind = RUNTIME_MODELED; fx.cycles = 244;
    /* Published: the manager's catalog names the code for both cores. */
    modwerk_machine_dsp_switch(&none, &fx);
    CHECK(dl_catalog[26].words == 3 && !dl_catalog[26].resident && dl_catalog[26].qualified && dl_catalog[26].slots == 1 &&
          dl_catalog[26].cycles == 331 && dl_catalog[26].alignment == 1 && !dl_catalog[26].buffer); /* charged the reserve at least */
    CHECK(dl_catalog[0].cycles == 331 && dl_catalog[0].resident && dl_catalog[21].cycles == 331 && !dl_catalog[21].resident); /* NONE; a stock package */
    CHECK(dl_codes[0][26].words == words && dl_codes[1][26].words == words && dl_codes[1][26].count == 3 && dl_codes[1][26].init == 1 &&
          dl_codes[1][26].proc == 2 && dl_codes[0][26].relocations == relocations && dl_codes[0][26].relocation_count == 1);
    /* Another module preferring 26 gets 27; with both held there is none left; a replacement keeps its own. */
    struct runtime_dsp other = fx;
    other.module = 71; CHECK(modwerk_machine_dsp_admit(&none, &other) == RUNTIME_OK && other.id == 27);
    modwerk_machine_dsp_switch(&none, &other);
    struct runtime_dsp third = fx;
    third.module = 72; CHECK(modwerk_machine_dsp_admit(&none, &third) == RUNTIME_FULL);
    third = other; third.id = 26; CHECK(modwerk_machine_dsp_admit(&other, &third) == RUNTIME_OK && third.id == 27);
    modwerk_machine_dsp_switch(&other, &none);
    /* A track running it, or the manager mid-transaction, keeps it: removal and replacement wait. */
    modwerk_test_live_fx[13] = 26;
    CHECK(modwerk_machine_dsp_admit(&fx, &none) == RUNTIME_BUSY && modwerk_machine_dsp_admit(&fx, &fx) == RUNTIME_BUSY);
    modwerk_test_live_fx[13] = 4; idle = 0;
    CHECK(modwerk_machine_dsp_admit(&fx, &none) == RUNTIME_BUSY && modwerk_machine_dsp_admit(&fx, &fx) == RUNTIME_BUSY);
    third = fx; third.module = 73;
    CHECK(modwerk_machine_dsp_admit(&none, &third) == RUNTIME_OK && third.id == 27); /* a new effect may register mid-transaction */
    idle = 1;
    CHECK(modwerk_machine_dsp_admit(&fx, &none) == RUNTIME_OK);
    modwerk_machine_dsp_switch(&fx, &none);
    CHECK(dl_catalog[26].resident && !dl_catalog[26].words && dl_catalog[26].qualified && dl_catalog[26].cycles == 331 &&
          !dl_codes[0][26].words && !dl_codes[1][26].count);
    /* What the current bank names: the live effects and every Part, working and saved; module ids only. */
    static uint8_t bank[0x9504a + 4 * 6322];
    for (unsigned i = 0; i < 16; ++i) modwerk_test_live_fx[i] = i < 8 ? 4 : 8;
    modwerk_test_live_fx[2] = 26;
    CHECK(modwerk_dsp_used() == 1u << 26);              /* no project yet: the live effects only */
    modwerk_test_bank = bank;
    bank[0x8ed80 + 3 * 6322 + 9] = 27;                  /* Part 4's FX2 on T2 */
    bank[0x9504a + 1 * 6322 + 0] = 27;                  /* Part 2's saved copy, FX1 on T1 */
    bank[0x8ed80 + 5] = 21;                             /* SPRING REV: stock, not a module */
    CHECK(modwerk_dsp_used() == (1u << 26 | 1u << 27));
    modwerk_test_live_fx[2] = 4; bank[0x8ed80 + 3 * 6322 + 9] = 0;
    CHECK(modwerk_dsp_used() == 1u << 27);
    /* What runs dry: an uninstalled module's effect only; a stock effect loads its package. */
    modwerk_test_live_fx[3] = 27; modwerk_test_live_fx[9] = 21;
    CHECK(modwerk_dsp_dry() == 1u << 27);
    modwerk_machine_dsp_switch(&none, &fx); fx.id = 27; modwerk_machine_dsp_switch(&none, &fx);
    CHECK(!modwerk_dsp_dry());
    /* The watchdog: frames still for 30 ticks while a transfer is in flight, reported once; frames moving or no transfer, never. */
    unsigned fired = 0;
    for (unsigned t = 0; t < 100; ++t) fired += modwerk_dsp_stalled(500u + t, 1);   /* frames advance */
    for (unsigned t = 0; t < 100; ++t) fired += modwerk_dsp_stalled(42857u, 0);     /* nothing in flight */
    CHECK(!fired);
    for (unsigned t = 1; t <= 29; ++t) CHECK(!modwerk_dsp_stalled(42857u, 1));
    CHECK(modwerk_dsp_stalled(42857u, 1));                                            /* the 30th still tick */
    for (unsigned t = 0; t < 100; ++t) CHECK(!modwerk_dsp_stalled(42857u, 1));       /* once */
    CHECK(!modwerk_dsp_stalled(42858u, 1));
    /* The project's map (fxmap.c): '#MODWERK_FX=' lines in, only module handles, a failed load changes nothing. */
    for (unsigned k = 0; k < 32u; ++k) release(k);
    for (unsigned i = 0; i < 16u; ++i) modwerk_test_live_fx[i] = 0;
    modwerk_fxmap_begin(0); modwerk_fxmap_line("#MODWERK_FX=26:00000099:1:Parse only", 1); /* the parse-only pass */
    modwerk_fxmap_begin(1);
    modwerk_fxmap_line("#MODWERK_FX=26:00000047:2:Mod G", 0);
    modwerk_fxmap_line("#MODWERK_FX=27:00000046:1:Mod F", 0);
    modwerk_fxmap_line("#MODWERK_FX=21:00000048:1:Stock", 0);   /* a stock effect's id: not a module handle */
    modwerk_fxmap_line("#PLAY_MODES=01", 0);
    modwerk_fxmap_loaded(0);
    char name[16];
    modwerk_fxmap_name(26, name);
    CHECK(modwerk_fxmap_handle(0x46) == 27 && modwerk_fxmap_handle(0x47) == 26 && !modwerk_fxmap_module(21) &&
          modwerk_fxmap_handle(0x99) < 0 && !strcmp(name, "Mod G") && modwerk_test_map.e[26].layout == 2);
    uint32_t generation = modwerk_fxmap_generation();
    modwerk_fxmap_begin(1); modwerk_fxmap_line("#MODWERK_FX=26:00000050:1:Other", 0); modwerk_fxmap_loaded(-1);
    CHECK(modwerk_fxmap_handle(0x47) == 26 && modwerk_fxmap_generation() == generation);
    /* Handles follow the map: 0x46 goes to 27 whatever it prefers; with 26 and 27 named and used, a third finds none. */
    modwerk_test_live_fx[0] = 26; modwerk_test_live_fx[8] = 27;
    third = fx; third.module = 0x46; third.id = 26;
    CHECK(modwerk_machine_dsp_admit(&none, &third) == RUNTIME_OK && third.id == 27);
    third.module = 0x48; third.id = 27;
    CHECK(modwerk_machine_dsp_admit(&none, &third) == RUNTIME_FULL);
    /* A module holding the handle the map gives another lets go, then takes its own once the manager is idle. */
    third.module = 0x46; third.id = 26; modwerk_machine_dsp_switch(&none, &third); /* installed under the last project */
    modwerk_fxmap_begin(1);                                                      /* then this project loads */
    modwerk_fxmap_line("#MODWERK_FX=26:00000047:2:Mod G", 0); modwerk_fxmap_line("#MODWERK_FX=27:00000046:1:Mod F", 0);
    modwerk_fxmap_loaded(0);
    rebind_tick();
    CHECK(!owner[26] && !owner[27] && rebinding && dl_catalog[26].resident);   /* let go: those slots run dry */
    for (unsigned i = 0; i < 4u; ++i) rebind_tick();
    CHECK(owner[27] == 0x46 && !owner[26] && !rebinding && dl_catalog[27].words == 3 && dl_codes[1][27].words == words &&
          modwerk_fxmap_handle(0x46) == 27);
    /* Saving: one line per handle the project uses. */
    modwerk_test_write = capture;
    modwerk_fxmap_write(7);
    CHECK(!strcmp(written, "#MODWERK_FX=26:00000047:2:Mod G\r\n#MODWERK_FX=27:00000046:1:Mod F\r\n"));
    /* MISSING: what the project names that no installed module answers for (0x47 at 26 is not installed). */
    uint8_t list[316];
    CHECK(modwerk_dsp_missing_list(list) == 28 && !memcmp(list, "MWM\1", 4) && list[4] == 26 && list[7] == 2 &&
          list[11] == 0x47 && !strcmp((const char *)list + 12, "Mod G"));
    /* A project without lines names today's assignments. */
    modwerk_fxmap_begin(1); modwerk_fxmap_loaded(0);
    CHECK(modwerk_fxmap_handle(0x873d83ccu) == 27 && !modwerk_fxmap_module(26));
    written[0] = 0; modwerk_fxmap_write(7);
    CHECK(!strcmp(written, "#MODWERK_FX=27:873d83cc:0:E-Verb\r\n"));
    if (failures) { fprintf(stderr, "%u DSP glue checks failed\n", failures); return 1; }
    puts("Octatrack DSP glue: admission (ids, arena, instance block, cycles, effects in use), the catalog, the effects a bank names, the stall watchdog, the project handle map and rebinding passed.");
    return 0;
}
