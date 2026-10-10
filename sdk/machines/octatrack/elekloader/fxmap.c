/* SPDX-License-Identifier: GPL-3.0-or-later
 * Module effect handles, per project (build_core.py --dsp-loader; owner, 11 October 2026; the design is
 * docs/OCTATRACK_ELEKLOADER_MIGRATION.md, "Projects across module changes"). A module effect's id is a
 * handle its project gives it, not the module's for good. The map names the module behind each handle:
 * its module id, parameter-layout number and display name. It lives in battery RAM, which survives a
 * power cycle as the project itself does, and in project.work as one '#MODWERK_FX=' line per handle the
 * project uses, which stock's loader skips like any '#' line (fxmap.s). A project without such lines
 * reads today's catalogue assignments (identity.c's modwerk_fx_legacy). */
#include <stdint.h>

struct fx_entry { uint32_t module; uint16_t layout, spare; char name[16]; };
struct fx_map { uint32_t magic, generation; struct fx_entry e[32]; uint32_t sum; };
struct fx_legacy { uint32_t module; uint32_t id; char name[16]; };
#define MAGIC 0x4d574658u /* 'MWFX' */
#define LINE "#MODWERK_FX="

extern const uint32_t modwerk_dsp_modules;             /* identity.c: the module effect ids */
extern const struct fx_legacy modwerk_fx_legacy[];     /* identity.c: today's catalogue assignments */
extern const uint32_t modwerk_fx_legacy_count;

#ifdef MODWERK_HOST
struct fx_map modwerk_test_map;
extern uint8_t modwerk_test_live_fx[16]; /* dsp.c's */
uint8_t modwerk_test_banks[16][8][16];
int (*modwerk_test_write)(uint32_t file, const void *data, unsigned length);
#define MAP (&modwerk_test_map)
#define RUNNING(i) modwerk_test_live_fx[i]
#define PART_FX(bank, part, i) modwerk_test_banks[bank][part][i]
#define WRITE modwerk_test_write
#else
/* Battery RAM nothing else uses: stock references nothing in 0x100f859c-0x100fff00 (Octabam's
 * STEP_LOCKS.md), PLAY MODES and PLOCKS P2 hold 0x100f8600-0x100f8f06. */
#define MAP ((volatile struct fx_map *)0x100fe000u)
#define RUNNING(i) (((const volatile uint8_t *)0x80000ec4u)[i]) /* what each track runs: FX1 T1-T8, then FX2 */
/* All 16 banks stay in RAM; each holds four working Parts and four saved ones (dsp.c's PART). */
#define PART_FX(bank, part, i) (((const volatile uint8_t *)(0x400e21e0u + (bank) * 0x9b340u + \
    ((part) < 4 ? 0x8ed80u : 0x9504au - 4u * 6322u) + (part) * 6322u))[i])
#define WRITE ((int (*)(uint32_t, const void *, unsigned))0x400166b8u) /* write(file, data, n), the writer's own */
#endif

static uint32_t checksum(void)
{
    const volatile uint32_t *w = (const volatile uint32_t *)MAP;
    uint32_t sum = 0x5a17u;
    for (unsigned i = 0; i < (sizeof(struct fx_map) - 4u) / 4u; ++i) sum = sum * 31u + w[i];
    return sum;
}
static int valid(void) { return MAP->magic == MAGIC && MAP->sum == checksum(); }
static void seal(void)
{
    MAP->magic = MAGIC;
    MAP->generation = MAP->generation + 1u;
    MAP->sum = checksum();
}
static void put(volatile struct fx_entry *e, uint32_t module, unsigned layout, const char *name)
{
    e->module = module, e->layout = (uint16_t)layout, e->spare = 0;
    unsigned i = 0;
    for (; name && i < 15u && name[i]; ++i) e->name[i] = name[i];
    for (; i < 16u; ++i) e->name[i] = 0;
}

/* The module effect ids the project names anywhere: what runs, and every bank's Parts, working and saved. */
uint32_t modwerk_fxmap_used(void)
{
    uint32_t used = 0;
    for (unsigned i = 0; i < 16u; ++i) used |= 1u << (RUNNING(i) & 31u);
    for (unsigned bank = 0; bank < 16u; ++bank)
        for (unsigned part = 0; part < 8u; ++part)
            for (unsigned i = 0; i < 16u; ++i) {
                unsigned fx = PART_FX(bank, part, i);
                if (fx < 32u) used |= 1u << fx;
            }
    return used & modwerk_dsp_modules;
}
uint32_t modwerk_fxmap_generation(void) { return valid() ? MAP->generation : 0; }
/* The module the map names at handle `id`, 0 none. */
uint32_t modwerk_fxmap_module(unsigned id) { return id < 32u && valid() ? MAP->e[id].module : 0; }
/* The handle the map gives `module`, -1 none. */
int modwerk_fxmap_handle(uint32_t module)
{
    if (!module || !valid()) return -1;
    for (unsigned k = 0; k < 32u; ++k) if (modwerk_dsp_modules >> k & 1u && MAP->e[k].module == module) return (int)k;
    return -1;
}
/* The name the map records at `id`, NUL-ended in `out` (16 bytes); "" none. */
void modwerk_fxmap_name(unsigned id, char *out)
{
    out[0] = 0;
    if (id >= 32u || !valid()) return;
    for (unsigned i = 0; i < 16u; ++i) out[i] = MAP->e[id].name[i];
    out[15] = 0;
}
/* A module took handle `id` (dsp.c, at its switch): the map names it there. */
void modwerk_fxmap_assign(unsigned id, uint32_t module, unsigned layout, const char *name)
{
    if (id >= 32u || !(modwerk_dsp_modules >> id & 1u)) return;
    if (!valid()) { MAP->generation = 0; for (unsigned k = 0; k < 32u; ++k) put(&MAP->e[k], 0, 0, 0); }
    put(&MAP->e[id], module, layout, name);
    seal();
}

/* The project file (fxmap.s). The loader parses project.work twice; the storing pass fills `staged`,
 * and the map takes it once the engine says the load succeeded. */
static struct fx_entry staged[32];
static int staging;
static unsigned lines;
void modwerk_fxmap_begin(uint32_t storing)
{
    if (!storing) return;
    for (unsigned k = 0; k < 32u; ++k) put(&staged[k], 0, 0, 0);
    staging = 1, lines = 0;
}
static const char *number(const char *s, unsigned base, uint32_t *out)
{
    uint32_t v = 0;
    unsigned digits = 0;
    for (;; ++s, ++digits) {
        unsigned c = (unsigned char)*s, d = c - '0' < 10u ? c - '0' : (c | 0x20u) - 'a' < 6u && base == 16u ? (c | 0x20u) - 'a' + 10u : 99u;
        if (d >= base) break;
        v = v * base + d;
    }
    *out = v;
    return digits && digits <= 8u && *s == ':' ? s + 1 : 0;
}
void modwerk_fxmap_line(const char *line, uint32_t parse_only)
{
    if (parse_only || !staging) return;
    for (unsigned i = 0; LINE[i]; ++i) if (line[i] != LINE[i]) return;
    uint32_t id, module, layout;
    const char *s = line + sizeof LINE - 1u;
    if (!(s = number(s, 10, &id)) || !(s = number(s, 16, &module)) || !(s = number(s, 10, &layout))) return;
    if (id >= 32u || !(modwerk_dsp_modules >> id & 1u) || !module || layout > 0xffffu) return; /* only module handles */
    put(&staged[id], module, layout, s);
    ++lines;
}
void modwerk_fxmap_loaded(int32_t result)
{
    if (!staging) return;
    staging = 0;
    if (result < 0) return; /* a failed load keeps the project that is still there */
    if (lines) for (unsigned k = 0; k < 32u; ++k) put(&MAP->e[k], staged[k].module, staged[k].layout, staged[k].name);
    else {
        for (unsigned k = 0; k < 32u; ++k) put(&MAP->e[k], 0, 0, 0);
        for (unsigned i = 0; i < modwerk_fx_legacy_count; ++i)
            put(&MAP->e[modwerk_fx_legacy[i].id & 31u], modwerk_fx_legacy[i].module, 0, modwerk_fx_legacy[i].name);
    }
    seal();
}
/* One line per handle the project uses: "#MODWERK_FX=27:873d83cc:1:E-Verb\r\n". */
void modwerk_fxmap_write(uint32_t file)
{
    if (!valid()) return;
    uint32_t used = modwerk_fxmap_used();
    for (unsigned k = 0; k < 32u; ++k) {
        if (!(used >> k & 1u) || !MAP->e[k].module) continue;
        char line[64];
        unsigned n = 0;
        for (const char *p = LINE; *p; ++p) line[n++] = *p;
        if (k >= 10u) line[n++] = (char)('0' + k / 10u);
        line[n++] = (char)('0' + k % 10u);
        line[n++] = ':';
        for (int shift = 28; shift >= 0; shift -= 4) line[n++] = "0123456789abcdef"[MAP->e[k].module >> shift & 15u];
        line[n++] = ':';
        char digits[5];
        unsigned layout = MAP->e[k].layout, d = 0;
        do { digits[d++] = (char)('0' + layout % 10u); layout /= 10u; } while (layout);
        while (d) line[n++] = digits[--d];
        line[n++] = ':';
        for (unsigned i = 0; i < 15u && MAP->e[k].name[i]; ++i) line[n++] = MAP->e[k].name[i];
        line[n++] = '\r', line[n++] = '\n';
        WRITE(file, line, n);
    }
}
