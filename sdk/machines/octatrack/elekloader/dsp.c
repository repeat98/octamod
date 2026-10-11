/* SPDX-License-Identifier: GPL-3.0-or-later
 * DSP effects from runtime modules (build_core.py --dsp-loader). Octabam's
 * DSP dynamic loading (sdk/octabam/platform/dsp-dynload-transport, built
 * into this base) loads an effect's code into a DSP when a track picks it,
 * shares it per core and frees it when nothing uses it; its allocator admits
 * each target against both cores' arenas and cycle allowances before
 * anything changes. Here its catalog is filled from module packages instead
 * of the build: a module's effect is registered when the loader publishes
 * the module and unregistered when it goes. Development only. */
#include "runtime.h"
#include "allocator.h"
#include "transfer.h"

/* manager.c's code descriptor, which it reads from dl_codes. */
struct code { const uint32_t *words; const uint16_t *relocations; uint16_t count, init, proc, relocation_count; };
/* Stock first: every slot without a module is charged the dearest stock effect
 * (MODWERK_DSP_RESERVE), and a module at least that, so eight stock slots always
 * fit a core and a stock pick never adds to what was admitted: a module is
 * refused, never a stock effect. */
typedef char stock_always_fits[8u * MODWERK_DSP_RESERVE <= MODWERK_DSP_ALLOWANCE ? 1 : -1];
/* A module id with no module: the null stub runs there, free on both slots. */
#define STOCK {0, 1, MODWERK_DSP_RESERVE, 3, 1, 1, 0}
/* identity.c (dsp_loader.py catalog_c): every stock DSP effect's package per core, loaded on demand;
 * a module registers into its own id. */
extern struct dl_package dl_catalog[32];
extern struct code dl_codes[2][32];
extern const uint32_t dl_stub_at_boot;     /* stock and module effect ids (identity.c): the null stub until bound */
extern const uint32_t modwerk_dsp_modules; /* the module effect ids alone */
extern const uint16_t modwerk_dsp_arena[2]; /* each core's code arena past the saved entries, words (identity.c) */
int dl_publication_idle(void);
void dl_residency_nudge(void);
#define SLOT_WORDS 132u /* an instance's r7 block: $00-$83; $84+ hung the unit (Octabam AGENTS.md) */
/* The Y block stock gives each slot (X:0x255): FX1 3K words, FX2 16K. On T3 and T7 stock keeps its own
 * words at the head of the FX2 block (Octabam dsp_ranges.py); a module there shares them as stock's reverbs do. */
#define FX1_BUFFER 3072u
#define FX2_BUFFER 16384u

#ifdef MODWERK_HOST
uint8_t modwerk_test_live_fx[16], *modwerk_test_bank;
#define LIVE_FX modwerk_test_live_fx
#define BANK ((uintptr_t)modwerk_test_bank)
#else
#define LIVE_FX ((const volatile uint8_t *)0x80000ec4u) /* the FX ids each track runs: FX1 T1-T8, then FX2 */
#define BANK (*(volatile uint32_t *)0x46c82456u)         /* the current bank (selection.c), 0 before a project */
#endif
#define PART(bank, i) ((const volatile uint8_t *)((bank) + ((i) < 4 ? 0x8ed80u : 0x9504au - 4u * 6322u) + (i) * 6322u))
static volatile int nudge;

static int in_use(unsigned id)
{
    for (unsigned i = 0; i < 16; ++i) if (LIVE_FX[i] == id) return 1;
    return 0;
}
/* Handles (owner, 11 October 2026): a module's effect id is a handle, not the module's for good. The
 * project's map (fxmap.c) names the module behind each; `owner` is who holds each this session. A
 * module goes where the map puts it, else to its preferred id (today's catalogue assignment), else to
 * the lowest free one, never to a handle the project names another module at; a replacement keeps its
 * module's. The loader's record of a module's effect id is the one it got at admission, which a project
 * load may move (rebind_tick), so the module id is what finds it. */
uint32_t modwerk_fxmap_module(unsigned id);
int modwerk_fxmap_handle(uint32_t module);
uint32_t modwerk_fxmap_used(void);
uint32_t modwerk_fxmap_generation(void);
void modwerk_fxmap_assign(unsigned id, uint32_t module, unsigned layout, const char *name);
void modwerk_fxmap_name(unsigned id, char *out);
extern volatile uint32_t modwerk_fxmap_read, modwerk_fxmap_written;
int modwerk_fxpage_build(unsigned id, uint8_t *recipe, uint32_t bytes, unsigned slots); /* fxpage.c */
void modwerk_fxpage_drop(unsigned id);
static uint32_t owner[32];
static uint16_t owner_layout[32];
static char owner_name[32][16];
static uint8_t *owner_page[32]; /* its page recipe (the module image's head), and that image's length */
static uint32_t owner_page_bytes[32];
static unsigned rebinding; /* ticks into a rebind, 0 none */
static int handle_of(uint32_t module)
{
    for (unsigned k = 0; module && k < 32u; ++k) if (owner[k] == module) return (int)k;
    return -1;
}
static int free_for(unsigned k, uint32_t module, uint32_t used)
{
    if (k >= 32u || !(modwerk_dsp_modules >> k & 1u) || owner[k]) return 0;
    uint32_t named = modwerk_fxmap_module(k);
    return !named || named == module || !(used >> k & 1u);
}
static int choose(uint32_t module, unsigned preferred)
{
    uint32_t used = modwerk_fxmap_used();
    int mapped = modwerk_fxmap_handle(module);
    if (mapped >= 0 && !owner[mapped]) return mapped;
    if (free_for(preferred, module, used)) return (int)preferred;
    for (unsigned k = 0; k < 32u; ++k) if (free_for(k, module, used)) return (int)k;
    return -1;
}
int modwerk_machine_dsp_admit(const struct runtime_dsp *from, struct runtime_dsp *to)
{
    /* An effect a track runs, or one a transaction may hold between prepare and retirement, stays.
     * A new one may register at any time: no transaction names an effect nobody has picked. */
    int had = from->count ? handle_of(from->module) : -1;
    if (from->count && (!dl_publication_idle() || rebinding || (had >= 0 && in_use((unsigned)had)))) return RUNTIME_BUSY;
    if (!to->count) return RUNTIME_OK;
    if (rebinding) return RUNTIME_BUSY;
    int id = had >= 0 ? had : choose(to->module, to->id);
    if (id < 0) return RUNTIME_FULL; /* every module handle is held or named */
    to->id = (uint8_t)id;
    unsigned arena = modwerk_dsp_arena[0] < modwerk_dsp_arena[1] ? modwerk_dsp_arena[0] : modwerk_dsp_arena[1];
    if (to->count > arena || to->state > SLOT_WORDS || to->buffer > (to->slots & 1u ? FX1_BUFFER : FX2_BUFFER)) return RUNTIME_MEMORY;
    /* shortcut: modeled cycles and executed instructions admit in this development base;
     * a release base admits hardware-timed figures only (owner, 10 October 2026). */
    /* One instance must fit beside seven stock slots on a core. */
    if (!to->kind || to->kind > RUNTIME_HARDWARE || to->cycles > MODWERK_DSP_ALLOWANCE - 7u * MODWERK_DSP_RESERVE)
        return RUNTIME_CYCLES;
    return RUNTIME_OK;
}
/* Masked, by the loader's switch: the manager sees the catalog change between two of its steps. */
static const struct dl_package unheld = STOCK;
static void release(unsigned k)
{
    dl_catalog[k] = unheld;
    dl_codes[0][k] = dl_codes[1][k] = (struct code){0, 0, 0, 0, 0, 0};
    owner[k] = 0, owner_page[k] = 0;
    modwerk_fxpage_drop(k);
}
/* Its page in the choosers at handle k, when it brought one (a module without one still runs where a
 * project names it). */
static void list(unsigned k, uint8_t *page, uint32_t bytes)
{
    owner_page[k] = page, owner_page_bytes[k] = bytes;
    if (page) modwerk_fxpage_build(k, page, bytes, dl_catalog[k].slots);
}
void modwerk_machine_dsp_switch(const struct runtime_dsp *from, const struct runtime_dsp *to)
{
    int had = from->count ? handle_of(from->module) : -1;
    if (had >= 0) release((unsigned)had);
    if (to->count) {
        uint32_t cycles = to->cycles > MODWERK_DSP_RESERVE ? to->cycles : MODWERK_DSP_RESERVE;
        dl_catalog[to->id] = (struct dl_package){(uint16_t)to->count, 1, cycles, to->slots, 0, 1, to->buffer != 0};
        dl_codes[0][to->id] = dl_codes[1][to->id] =
            (struct code){to->words, to->relocations, (uint16_t)to->count, to->init, to->proc, to->relocation_count};
        owner[to->id] = to->module, owner_layout[to->id] = to->layout;
        for (unsigned i = 0; i < 16u; ++i) owner_name[to->id][i] = to->name[i];
        list(to->id, (uint8_t *)(uintptr_t)to->page, to->page_bytes);
        modwerk_fxmap_assign(to->id, to->module, to->layout, to->name);
        nudge = 1; /* tracks may already name it (a saved project): load it there now */
    }
}
/* A project load can name an installed module at another handle, or another module at the handle one
 * holds. Those modules let go first: the manager retires their code, so no slot runs the wrong module.
 * Once it is idle, each takes the handle the map gives it (choose); one that finds none stays out. */
static struct { struct dl_package package; struct code code[2]; uint32_t module, page_bytes; uint8_t *page; uint16_t layout; char name[16]; } moving[32];
static unsigned moving_count;
static uint32_t mapped; /* the map generation the handles follow */
static void rebind_tick(void)
{
    if (!rebinding) {
        uint32_t generation = modwerk_fxmap_generation();
        if (generation == mapped || !dl_publication_idle()) return;
        mapped = generation;
        uint32_t used = modwerk_fxmap_used();
        moving_count = 0;
        for (unsigned k = 0; k < 32u; ++k) {
            if (!owner[k]) continue;
            int want = modwerk_fxmap_handle(owner[k]);
            uint32_t named = modwerk_fxmap_module(k);
            if (want == (int)k || (want < 0 && (!named || named == owner[k] || !(used >> k & 1u)))) continue;
            moving[moving_count].package = dl_catalog[k];
            moving[moving_count].code[0] = dl_codes[0][k], moving[moving_count].code[1] = dl_codes[1][k];
            moving[moving_count].module = owner[k], moving[moving_count].layout = owner_layout[k];
            moving[moving_count].page = owner_page[k], moving[moving_count].page_bytes = owner_page_bytes[k];
            for (unsigned i = 0; i < 16u; ++i) moving[moving_count].name[i] = owner_name[k][i];
            ++moving_count;
            release(k);
        }
        if (moving_count) rebinding = 1, nudge = 1;
        return;
    }
    if (++rebinding < 4u || !dl_publication_idle()) return; /* the manager has retired what let go */
    for (unsigned i = 0; i < moving_count; ++i) {
        int id = choose(moving[i].module, 32u);
        if (id < 0) continue;
        dl_catalog[id] = moving[i].package;
        dl_codes[0][id] = moving[i].code[0], dl_codes[1][id] = moving[i].code[1];
        owner[id] = moving[i].module, owner_layout[id] = moving[i].layout;
        for (unsigned c = 0; c < 16u; ++c) owner_name[id][c] = moving[i].name[c];
        list((unsigned)id, moving[i].page, moving[i].page_bytes);
        if (modwerk_fxmap_handle(moving[i].module) != id) modwerk_fxmap_assign((unsigned)id, moving[i].module, moving[i].layout, moving[i].name);
    }
    mapped = modwerk_fxmap_generation();
    rebinding = 0, nudge = 1;
}
/* The module effects the current bank names: what each track runs, and its four Parts, working and saved.
 * Other banks stay on the card. A bit per effect id, for an update to warn before removing one. */
uint32_t modwerk_dsp_used(void)
{
    uint32_t used = 0;
    uintptr_t bank = BANK;
    for (unsigned i = 0; i < 16; ++i) used |= 1u << (LIVE_FX[i] & 31u);
    for (unsigned part = 0; bank && part < 8; ++part)
        for (unsigned i = 0; i < 16; ++i) if (PART(bank, part)[i] < 32u) used |= 1u << PART(bank, part)[i];
    return used & modwerk_dsp_modules;
}

/* Development only: a chooser pick or Part change replayed as the panel makes
 * it, for scripted hardware runs (a USB test command calls modwerk_dsp_pick
 * from the engine task; the sys task's tick runs it, with the selectors'
 * own guards). slot: 0 FX1, 1 FX2 (track 0-7, chooser row), 2 Part (row = Part 0-3).
 * Up to four wait, one a tick, so a run can make picks on consecutive ticks. */
static volatile uint32_t picks[4], picks_in, picks_out;
int modwerk_dsp_pick(unsigned slot, unsigned track, unsigned row)
{
    if (picks_in - picks_out >= 4u || slot > 2 || track > 7 || row > (slot == 2 ? 3u : 31u)) return 0;
    picks[picks_in % 4u] = slot << 16 | track << 8 | row;
    picks_in = picks_in + 1;
    return 1;
}
/* A track naming a module effect that is not installed runs stock's null stub, dry,
 * its stored parameters untouched; the unit says so once per change. */
static uint32_t missing_shown;
volatile uint32_t modwerk_dsp_missing; /* times the unit said so, for diagnostics */
uint32_t modwerk_dsp_dry(void)
{
    uint32_t dry = 0;
    for (unsigned i = 0; i < 16; ++i) {
        unsigned fx = LIVE_FX[i] & 31u;
        if (modwerk_dsp_modules >> fx & 1u && dl_catalog[fx].resident) dry |= 1u << fx;
    }
    return dry;
}
/* MISSING (ep0.c): the modules the project names, in any bank, that no installed module answers for:
 * "MWM" and a count, then per handle 24 bytes: the handle, 0, the layout (big-endian), the module id
 * (big-endian) and the name (16 bytes). 4 + 24 x count bytes, never a whole number of 64-byte packets. */
int modwerk_fxmap_describe(unsigned id, uint32_t *module, uint16_t *layout, char *name);
unsigned modwerk_dsp_missing_list(uint8_t *out)
{
    uint32_t used = modwerk_fxmap_used();
    unsigned n = 0;
    for (unsigned k = 0; k < 32u; ++k) {
        uint32_t module;
        uint16_t layout;
        char name[16];
        if (!(used >> k & 1u) || !modwerk_fxmap_describe(k, &module, &layout, name) || owner[k] == module) continue;
        uint8_t *e = out + 4u + 24u * n++;
        e[0] = (uint8_t)k, e[1] = 0, e[2] = (uint8_t)(layout >> 8), e[3] = (uint8_t)layout;
        for (unsigned i = 0; i < 4u; ++i) e[4 + i] = (uint8_t)(module >> (24 - 8 * i));
        for (unsigned i = 0; i < 16u; ++i) e[8 + i] = (uint8_t)name[i];
    }
    out[0] = 'M', out[1] = 'W', out[2] = 'M', out[3] = (uint8_t)n;
    return 4u + 24u * n;
}
/* The host side of each core's HI08 (sdk/octabam/tools/emu/ot_emu/dsp.h): the
 * window at 0x20000000 shows the core the GPIO byte selects, one byte register
 * per 4-byte stride in the low byte of a 16-bit access. */
#define DSP_SELECT (*(volatile uint8_t *)0xfc0a400cu)
#define HOST_ISR (*(volatile uint16_t *)0x20000008u) /* bit 0 RXDF, 3 HF2, 4 HF3 */
#define HOST_RXL (*(volatile uint16_t *)0x2000001cu) /* a read takes the word */
#define HOST_TXL (*(volatile uint16_t *)0x2000001cu) /* a write gives the core a word */
#define EDMA_ES (*(volatile uint32_t *)0xfc044004u) /* bit 31 VLD, 11-8 the channel in error */
#ifndef MODWERK_HOST
/* The receiver's answer (dsp_receiver.asm): HF2 toggles for each packet handled, HF3 says refused.
 * Called from the frame-transfer interrupt at its end, where core 0 is selected. Never select core 1
 * there (AB2 froze on that alone): its flags are the ones dsp_core1.s read at state 3. */
volatile uint32_t modwerk_dsp_last_flags; /* the last read, core 0 in bits 0-1, core 1 in 8-9 */
extern volatile uint16_t dl_c1_isr;
unsigned modwerk_dsp_flags(unsigned core)
{
    unsigned isr = core ? dl_c1_isr : HOST_ISR;
    modwerk_dsp_last_flags = (modwerk_dsp_last_flags & ~(3u << 8 * core)) | (isr >> 3 & 3u) << 8 * core;
    return isr >> 3 & 3u;
}
#endif

/* Frames stop only when a DSP stops, so the sys task watches them, outside the
 * frame path: frames still for half a second while the loader has a transfer
 * in flight is a hang (counted, and the loader shut off until a reboot). */
#define STALL_TICKS 30u
static uint32_t seen_frames, still;
int modwerk_dsp_stalled(uint32_t frames, int busy)
{
    if (frames != seen_frames || !busy) { seen_frames = frames; still = 0; return 0; }
    return ++still == STALL_TICKS;
}
volatile uint32_t modwerk_dsp_stalls, modwerk_dsp_drained; /* hangs seen; words taken back from the DSPs */
volatile uint32_t modwerk_dsp_edma_errors, modwerk_dsp_edma_es; /* our transfers that eDMA refused; its last ES */
#ifndef MODWERK_HOST
extern volatile uint32_t dl_frames, dl_phase, dl_rx_nbytes, dl_residency_enabled;
extern volatile uint32_t dl_c1_phase, dl_c1_sent; /* dsp_core1.s: core 1's packet after stock's state 2 */
int dl_job_status(unsigned core);
void dl_abort(void);
/* Best effort: take whatever a core still offers the host (a DSP waiting to hand
 * over words waits at P:$97 for ever), put the transfer machine's channel 1 back,
 * forget the transfer and let the next frame interrupt in, as stock state 7 does. */
static void recover(void)
{
    uint32_t sr = modwerk_machine_mask();
    if ((dl_phase || dl_c1_phase) && EDMA_ES >> 31) {
        /* eDMA refused our transfer, so the core's DMA still waits for the words its host command
         * promised: give it what is left by hand (all of it after a configuration error, which
         * stops the channel at its start), then clear the error. hooks.s: phase 1 writes core 0;
         * dsp_core1.s writes core 1. */
        uint32_t nbytes = *(volatile uint32_t *)0xfc045008u, left = (*(volatile uint16_t *)0xfc045014u & 0x1ffu) * nbytes / 2u;
        const volatile uint16_t *from = (const volatile uint16_t *)*(volatile uint32_t *)0xfc045000u;
        modwerk_dsp_edma_es = EDMA_ES;
        DSP_SELECT = dl_c1_phase ? 1u : (uint8_t)(dl_phase - 1u);
        for (uint32_t i = 0, spin = 0; i < left && spin < 100000u; ++i) {
            for (spin = 0; !(HOST_ISR & 2u) && spin < 100000u; ++spin) {} /* TXDE */
            HOST_TXL = from[i];
        }
        *(volatile uint8_t *)0xfc04401du = 0; /* CERR: channel 0 */
        modwerk_dsp_edma_errors = modwerk_dsp_edma_errors + 1;
    } else if ((dl_phase || dl_c1_phase) && !(*(volatile uint16_t *)0xfc04501eu & 0x80u)) {
        /* No error, but channel 0 never finished (TCD0 not DONE): the selected DSP never took the
         * words, so the transfer waits on the host handshake for ever. Cancel it to free the channel
         * and the host port; the job is abandoned and the loader shut off below. */
        modwerk_dsp_edma_es = EDMA_ES;
        *(volatile uint32_t *)0xfc044000u |= 1u << 17; /* eDMA CR: cancel the running transfer */
    }
    for (unsigned core = 0; core < 2; ++core) {
        DSP_SELECT = (uint8_t)core;
        for (unsigned n = 0; n < 1024u && HOST_ISR & 1u; ++n) { (void)HOST_RXL; modwerk_dsp_drained = modwerk_dsp_drained + 1; }
    }
    DSP_SELECT = 0;
    if (dl_phase && dl_rx_nbytes) *(volatile uint32_t *)0xfc045028u = dl_rx_nbytes; /* none saved with --dsp-hook usbin */
    /* Abandoned at state 3, stock's chain resumes with the next frame: its interrupt restarts at state 0. */
    dl_phase = dl_c1_phase = 0;
    dl_abort();
    dl_residency_enabled = 0;
    *(volatile uint8_t *)0xfc04801du = 1; /* INTC0 CIMR: the frame interrupt */
    modwerk_machine_unmask(sr);
    modwerk_dsp_stalls = modwerk_dsp_stalls + 1;
    ((void (*)(const char *, unsigned))0x4005a2b8u)("DSP STOPPED", 0x30);
}
#endif
/* Development: one PROBE packet to a core (the dev PROBE request), for finding on
 * the unit which step stops a core: build_core.py --dsp-probe A (delivery only),
 * B (the receiver checks and answers) or neither (the whole receiver). */
volatile uint32_t modwerk_dsp_watch_ticks, modwerk_dsp_probes, modwerk_dsp_probes_ok, modwerk_dsp_probes_failed;
static int probing = -1;
int modwerk_dsp_probe(unsigned core)
{
#ifndef MODWERK_HOST
    if (core > 1 || probing >= 0 || !dl_publication_idle() || !dl_command_start(core, DL_PROBE, 0, 0, 0)) return 0;
#endif
    probing = (int)core;
    modwerk_dsp_probes = modwerk_dsp_probes + 1;
    return 1;
}
/* The receiver's first P word that read back wrong (dsp_receiver.asm, three P words at
 * MODWERK_DSP_MISS0/1): its table offset, the word the packet wrote, the word P held. After
 * a core refuses a packet, and once the manager is idle, the tick reads them back a bit a
 * packet with PEEK (its answer is HF3): the host never reads a DSP word. It reads from two
 * words earlier: tablebase's operand, the table address, is a known word that checks PEEK. */
#define MISS_WORDS 5u
volatile int32_t modwerk_dsp_miss_core = -1;  /* the core read, -1 none yet */
volatile uint32_t modwerk_dsp_miss_bits, modwerk_dsp_miss[MISS_WORDS]; /* bits read (120: done); table, rts, the record */
/* The load meter's last published window (dsp_receiver.asm, five P words at MODWERK_DSP_METER0/1):
 * its serial, the least, most and summed idle counts of core 0's main loop, and the frames with none.
 * Read the same way, on request (the development METER request). */
volatile int32_t modwerk_dsp_meter_core = -1;
volatile uint32_t modwerk_dsp_meter_bits, modwerk_dsp_meter[MISS_WORDS];
#ifndef MODWERK_HOST
extern volatile uint32_t dl_rejected[2];
static volatile int meter_wanted = -1;
int modwerk_dsp_meter_read(unsigned core)
{
    if (core > 1 || meter_wanted >= 0) return 0;
    meter_wanted = (int)core;
    return 1;
}
static int peeking = -1;
static unsigned peek_from;
static volatile uint32_t *peek_into, *peek_bits;
static uint32_t peek_seen[2];
static void peek_tick(void)
{
    static const uint16_t record[2] = {MODWERK_DSP_MISS0, MODWERK_DSP_MISS1}, meter[2] = {MODWERK_DSP_METER0, MODWERK_DSP_METER1};
    if (peeking < 0) {
        for (unsigned c = 0; c < 2 && peeking < 0; ++c)
            if (dl_rejected[c] != peek_seen[c] && probing < 0 && dl_publication_idle() && dl_job_status(c) == -2) {
                peek_seen[c] = dl_rejected[c];
                peeking = (int)c;
                modwerk_dsp_miss_core = (int32_t)c;
                modwerk_dsp_miss_bits = 0;
                for (unsigned i = 0; i < MISS_WORDS; ++i) modwerk_dsp_miss[i] = 0;
                peek_from = record[c] - 2u, peek_into = modwerk_dsp_miss, peek_bits = &modwerk_dsp_miss_bits;
            }
        if (peeking < 0 && meter_wanted >= 0 && probing < 0 && dl_publication_idle() && dl_job_status((unsigned)meter_wanted) == -2) {
            peeking = meter_wanted;
            meter_wanted = -1;
            modwerk_dsp_meter_core = peeking;
            modwerk_dsp_meter_bits = 0;
            for (unsigned i = 0; i < MISS_WORDS; ++i) modwerk_dsp_meter[i] = 0;
            peek_from = meter[peeking], peek_into = modwerk_dsp_meter, peek_bits = &modwerk_dsp_meter_bits;
        }
        if (peeking < 0) return;
    }
    unsigned c = (unsigned)peeking, bit = *peek_bits;
    int status = dl_job_status(c);
    if (!status) return; /* in flight */
    if (status != -2) {  /* answered: refused (HF3) is a 1 */
        if (status < 0) peek_into[bit / 24u] |= 1u << bit % 24u;
        dl_job_release(c);
        *peek_bits = ++bit;
        if (bit == 24u * MISS_WORDS) { peeking = -1; return; }
    }
    /* Bits 16-23 come from the word shifted right by 8 (the packet's mask is 16 bits). */
    unsigned b = bit % 24u;
    if (!dl_command_start(c, DL_PEEK, b >= 16u, peek_from + bit / 24u, b >= 16u ? 1u << (b - 8u) : 1u << b))
        peeking = -1; /* the manager or a probe took the core: keep what was read */
}
#endif
void modwerk_dsp_unpack(void); /* identity.c: the stock effects' code into RAM, before the manager needs it */
void modwerk_dsp_tick(void)
{
    modwerk_dsp_watch_ticks = modwerk_dsp_watch_ticks + 1; /* the watchdog's heartbeat */
#ifndef MODWERK_HOST
    static int unpacked;
    if (!unpacked) unpacked = 1, modwerk_dsp_unpack();
    peek_tick();
    if (probing >= 0 && dl_job_status((unsigned)probing) != 0) {
        if (dl_job_status((unsigned)probing) > 0) modwerk_dsp_probes_ok = modwerk_dsp_probes_ok + 1;
        else modwerk_dsp_probes_failed = modwerk_dsp_probes_failed + 1;
        dl_job_release((unsigned)probing);
        probing = -1;
    }
    if ((dl_phase || dl_c1_phase) && EDMA_ES >> 31 && !(EDMA_ES >> 8 & 0xfu)) recover(); /* eDMA refused our transfer: at once */
    else if (modwerk_dsp_stalled(dl_frames, dl_phase || !dl_job_status(0) || !dl_job_status(1))) recover();
    rebind_tick();
    uint32_t dry = rebinding ? missing_shown : modwerk_dsp_dry(), say = dry & ~missing_shown;
    missing_shown = dry;
    /* Said when it goes missing, and again whenever a track running it is selected: at boot the
     * first can land behind stock's LOADING FILES bar (stock's popup slot stays "open" after it). */
    static unsigned last_track = 0xffu;
    unsigned track = *(volatile uint8_t *)0x80000000u; /* the current track; 8 and up on the MIDI side */
    if (track != last_track) {
        last_track = track;
        if (track < 8u) say |= dry & (1u << (LIVE_FX[track] & 31u) | 1u << (LIVE_FX[8u + track] & 31u));
    }
    if (say) { /* the project's map names what is missing */
        static char text[24] = "MISSING ";
        unsigned k = 0;
        while (!(say >> k & 1u)) ++k;
        modwerk_fxmap_name(k, text + 8);
        for (char *c = text + 8; *c; ++c) if (*c >= 'a' && *c <= 'z') *c = (char)(*c - 32); /* the popup sizes capitals only */
        ((void (*)(const char *, unsigned))0x4005a2b8u)(text[8] ? text : "MODULE MISSING", 0xa0);
        modwerk_dsp_missing = modwerk_dsp_missing + 1;
    }
    if (nudge) { nudge = 0; dl_residency_nudge(); }
    if (picks_in == picks_out) return;
    uint32_t p = picks[picks_out % 4u];
    picks_out = picks_out + 1;
    unsigned slot = p >> 16 & 0xffu, row = p & 0xffu;
    if (slot == 2) { ((void (*)(unsigned))0x4004a8a4u)(row); return; } /* the manual Part change */
    *(volatile uint8_t *)0x80000000u = (uint8_t)(p >> 8);              /* the current track, as the selectors read it */
    *(volatile uint32_t *)(slot ? 0x460d5ca8u : 0x460d5c94u) = row;   /* the chooser's cursor */
    ((void (*)(void))(slot ? 0x40052474u : 0x400526e4u))();
#endif
}

/* What a hardware run reads (a development LOADER request): DSP_REPORT_WORDS
 * words, version first. Engine task; it reads counters only, never the host port. */
#ifndef MODWERK_HOST
extern volatile uint32_t dl_accepted[2], dl_rejected[2], dl_errors, dl_pool_base[2], dl_pool_words[2];
extern volatile uint32_t dl_selection_requested, dl_selection_completed, dl_selection_refused, dl_selection_cancelled;
extern volatile uint32_t dl_residency_commits, dl_residency_failures, dl_residency_rollbacks, dl_residency_words[2];
extern volatile uint32_t dl_early, dl_parked, dl_reinit, dl_pin7, dl_straddle;
uint32_t dl_manager_state(void);
#define R8(a) (*(volatile uint8_t *)(a))
#define R16(a) (*(volatile uint16_t *)(a))
#define R32(a) (*(volatile uint32_t *)(a))
unsigned modwerk_dsp_report(uint32_t *out)
{
    const uint32_t words[DSP_REPORT_WORDS] = {
        9, dl_frames, dl_phase, (uint32_t)dl_job_status(0), (uint32_t)dl_job_status(1), modwerk_dsp_last_flags,
        dl_accepted[0], dl_accepted[1], dl_rejected[0], dl_rejected[1], dl_errors, modwerk_dsp_stalls, modwerk_dsp_drained,
        dl_residency_enabled, dl_manager_state(), modwerk_dsp_watch_ticks, modwerk_dsp_probes, modwerk_dsp_probes_ok,
        modwerk_dsp_probes_failed,
        dl_selection_requested, dl_selection_completed, dl_selection_refused, dl_selection_cancelled,
        dl_residency_commits, dl_residency_failures, dl_residency_rollbacks, dl_residency_words[0], dl_residency_words[1],
        dl_early, dl_parked, dl_reinit, modwerk_dsp_missing, modwerk_dsp_used(), modwerk_dsp_dry(),
        /* Where stock's frame chain stands (reads without side effects): the transfer machine's state and the
         * frame interrupt's busy flag (stock RAM), INTC0 IPRL and IMRL, EPORT pin levels | edge flags | the
         * DSP select, eDMA INT | ERR, TCD0 CSR | TCD1 CSR, eDMA ES. */
        R32(0x46104d3eu), R32(0x46104d4eu), R32(0xfc048004u), R32(0xfc04800cu),
        (uint32_t)R8(0xfc094005u) << 16 | (uint32_t)R8(0xfc094006u) << 8 | R8(0xfc0a400cu),
        (uint32_t)R16(0xfc044026u) << 16 | R16(0xfc04402eu), (uint32_t)R16(0xfc04501eu) << 16 | R16(0xfc04503eu),
        R32(0xfc044004u), modwerk_dsp_edma_errors, modwerk_dsp_edma_es,
        (uint32_t)modwerk_dsp_miss_core, modwerk_dsp_miss_bits, modwerk_dsp_miss[0], modwerk_dsp_miss[2], modwerk_dsp_miss[3],
        modwerk_dsp_miss[4], dl_pin7, dl_straddle, dl_c1_sent,
        (uint32_t)modwerk_dsp_meter_core, modwerk_dsp_meter_bits, modwerk_dsp_meter[0], modwerk_dsp_meter[1], modwerk_dsp_meter[2],
        modwerk_dsp_meter[3], modwerk_dsp_meter[4], modwerk_fxmap_generation(), modwerk_fxmap_read, modwerk_fxmap_written};
    for (unsigned i = 0; i < DSP_REPORT_WORDS; ++i) out[i] = words[i];
    return DSP_REPORT_WORDS;
}
#endif

/* shortcut: no publication guards yet (queued patterns, project loads, Part
 * edits); the manager's observer loads what those routes publish and parks
 * the slot dry until then. Port publication.c with the Part routes. */
void dl_publication_finish(void) {}
void dl_publication_tick(void) {}
