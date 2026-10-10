/* SPDX-License-Identifier: GPL-3.0-or-later
 * Machine-neutral runtime module loader (README.md). Several modules are
 * live at once, each at its own dispatch position with its own pool extent.
 * Prepare admits a package (memory, a position, and sites no other live
 * module patches) and relocates it into free pool memory; a refusal changes
 * nothing. Publish and restore switch one module's hooks and stock-code
 * sites together with interrupts masked, only after checking that no paused
 * task could resume inside a site, and only over the exact bytes expected
 * there. A module that is no longer live keeps its memory until no paused
 * task holds an address inside it. Engine task only.
 *
 * shortcut: a fixed pool in the base's .bss; take arena pages on demand once
 * the OS's page allocator is audited. */
#include "loader.h"

#define OWNERS (2u * RUNTIME_MODULES) /* live, the transaction's two and those waiting to be reclaimed */
static uint8_t pool[RUNTIME_POOL_BYTES] __attribute__((aligned(16)));
struct modwerk_runtime_api modwerk_runtime_api;
volatile uint32_t modwerk_runtime_ticks;
static struct runtime_module *volatile live[RUNTIME_MODULES];
static struct runtime_module *owned[OWNERS]; /* every module holding pool memory */
static unsigned owners, slot;                /* slot: the transaction's position */
static struct runtime_module *candidate, *previous;
static int prepared, held;
static enum runtime_refusal refusal;

const struct runtime_module *modwerk_runtime_module(unsigned i) { return i < RUNTIME_MODULES ? live[i] : 0; }
unsigned modwerk_runtime_active(void)
{
    unsigned n = 0;
    for (unsigned i = 0; i < RUNTIME_MODULES; ++i) n += live[i] != 0;
    return n;
}
enum runtime_refusal modwerk_runtime_refusal(void) { return refusal; }
uint32_t modwerk_runtime_value(void) { return modwerk_runtime_api.value; }
uint32_t modwerk_runtime_calls(void) { return modwerk_runtime_ticks; }

static uint32_t be16(const volatile uint8_t *p) { return (uint32_t)p[0] << 8 | p[1]; }
static uint32_t be32(const volatile uint8_t *p) { return be16(p) << 16 | be16(p + 2); }
static void put32(uint8_t *p, uint32_t v) { p[0] = (uint8_t)(v >> 24); p[1] = (uint8_t)(v >> 16); p[2] = (uint8_t)(v >> 8); p[3] = (uint8_t)v; }
static int refuse(enum runtime_refusal why) { refusal = why; return 0; }

/* The ledger. Extents are whole 16-byte lines, written and read only through
 * the uncached alias, so no cache line outlives the memory it came from. */
static uint8_t *first(void) { return modwerk_machine_uncached(pool); }
static uint8_t *end_of(const struct runtime_module *m) { return (uint8_t *)(uintptr_t)m + m->size; }
/* Free bytes from `from` to the next owned extent or the end of the pool. */
static uint32_t run(const uint8_t *from)
{
    const uint8_t *to = first() + RUNTIME_POOL_BYTES;
    for (unsigned j = 0; j < owners; ++j)
        if ((const uint8_t *)owned[j] >= from && (const uint8_t *)owned[j] < to) to = (const uint8_t *)owned[j];
    return (uint32_t)(to - from);
}
/* The lowest free run that holds n bytes: every run starts at the pool or at an extent's end. */
static struct runtime_module *take(uint32_t n)
{
    uint8_t *best = 0;
    for (unsigned i = 0; owners < OWNERS && i <= owners; ++i) {
        uint8_t *from = i < owners ? end_of(owned[i]) : first();
        if ((!best || from < best) && run(from) >= n) best = from;
    }
    return (struct runtime_module *)(void *)best;
}
uint32_t modwerk_runtime_free(uint32_t *largest)
{
    uint32_t used = 0, big = run(first());
    for (unsigned i = 0; i < owners; ++i) {
        used += owned[i]->size;
        if (run(end_of(owned[i])) > big) big = run(end_of(owned[i]));
    }
    if (largest) *largest = big;
    return RUNTIME_POOL_BYTES - used;
}
static void forget(const struct runtime_module *m)
{
    for (unsigned i = 0; i < owners; ++i) if (owned[i] == m) { owned[i] = owned[--owners]; return; }
}
static int reachable(const struct runtime_module *m)
{
    for (unsigned i = 0; i < RUNTIME_MODULES; ++i) if (live[i] == m) return 1;
    return m == candidate || m == previous;
}
/* Masked: free every extent that no position, the transaction or a paused
 * task's stack or saved registers can reach. Unknown task state frees nothing. */
static void reclaim(void)
{
    struct runtime_span span[RUNTIME_PAUSED];
    uint32_t mask = modwerk_machine_mask();
    unsigned n = modwerk_machine_paused(span, RUNTIME_PAUSED);
    for (unsigned i = owners; n <= RUNTIME_PAUSED && i--;) {
        uint32_t lo = (uint32_t)(uintptr_t)owned[i], hi = lo + owned[i]->size;
        int reached = reachable(owned[i]);
        for (unsigned k = 0; k < n && !reached; ++k)
            for (const uint8_t *p = span[k].from; p + 4 <= span[k].to && !reached; p += 2)
                reached = be32(p) >= lo && be32(p) < hi;
        if (!reached) owned[i] = owned[--owners];
    }
    modwerk_machine_unmask(mask);
}
/* A word holding an offset into the module becomes an address. */
static int relocate(uint8_t *word, uint32_t end, uint32_t base)
{
    uint32_t v = be32(word);
    if (v >= end) return 0;
    put32(word, v + base);
    return 1;
}

static int inside(const struct runtime_module *m, uint32_t v)
{
    for (uint32_t i = 0; m && i < m->sites; ++i)
        if (v > m->site[i].address && v < m->site[i].address + m->site[i].length) return 1;
    return 0;
}
/* Masked: could a paused task resume inside a site of a or b? Starting at a
 * site's first byte runs its whole new instruction; anywhere after it would
 * run the middle of one. Unknown counts as yes. */
static int in_flight(const struct runtime_module *a, const struct runtime_module *b)
{
    uint32_t lo = RUNTIME_NONE, hi = 0;
    for (int k = 0; k < 2; ++k)
        for (uint32_t i = 0; (k ? b : a) && i < (k ? b : a)->sites; ++i) {
            const struct runtime_site *s = &(k ? b : a)->site[i];
            if (s->address < lo) lo = s->address;
            if (s->address + s->length > hi) hi = s->address + s->length;
        }
    if (lo >= hi) return 0;
    struct runtime_span span[RUNTIME_PAUSED];
    unsigned n = modwerk_machine_paused(span, RUNTIME_PAUSED);
    if (n > RUNTIME_PAUSED) return 1;
    for (unsigned i = 0; i < n; ++i)
        for (const uint8_t *p = span[i].from; p + 4 <= span[i].to; p += 2) {
            uint32_t v = be32(p);
            if (v > lo && v < hi && (inside(a, v) || inside(b, v))) return 1;
        }
    return 0;
}
static int holds(const struct runtime_module *m, int patched)
{
    for (uint32_t i = 0; m && i < m->sites; ++i) {
        const struct runtime_site *s = &m->site[i];
        const volatile uint8_t *now = modwerk_machine_code(s->address);
        for (uint32_t j = 0; j < s->length; ++j) if (now[j] != (patched ? s->code : s->stock)[j]) return 0;
    }
    return 1;
}
static void put(const struct runtime_module *m, int patched)
{
    for (uint32_t i = 0; m && i < m->sites; ++i) {
        const struct runtime_site *s = &m->site[i];
        volatile uint8_t *to = modwerk_machine_code(s->address);
        modwerk_machine_flush_data(s->address, s->length);
        for (uint32_t j = 0; j < s->length; ++j) to[j] = (patched ? s->code : s->stock)[j];
    }
}
static const struct runtime_dsp no_dsp;
static const struct runtime_dsp *dsp_of(const struct runtime_module *m) { return m ? &m->dsp : &no_dsp; }
/* One position's hooks, sites and DSP effect change together, with nothing
 * else running. On any mismatch its module's sites are put back and nothing changes. */
static int switch_to(unsigned position, struct runtime_module *to)
{
    const struct runtime_module *from = live[position];
    uint32_t mask = modwerk_machine_mask();
    struct runtime_dsp want = *dsp_of(to); /* the machine keeps the effect id it gave at admission */
    int ok = !in_flight(from, to) && holds(from, 1) && !modwerk_machine_dsp_admit(dsp_of(from), &want) && want.id == dsp_of(to)->id;
    if (ok) {
        put(from, 0);
        ok = holds(to, 0);
        if (ok) {
            put(to, 1);
            ok = holds(to, 1);
            if (!ok) put(to, 0);
        }
        if (!ok) put(from, 1);
        modwerk_machine_invalidate_code();
        if (ok) { live[position] = to; modwerk_machine_dsp_switch(dsp_of(from), dsp_of(to)); }
    }
    modwerk_machine_unmask(mask);
    return ok;
}
/* The position of the live module `id`, else the first free one. */
static unsigned position_of(uint32_t id)
{
    unsigned free = RUNTIME_MODULES;
    for (unsigned i = 0; i < RUNTIME_MODULES; ++i) {
        if (live[i] && live[i]->id == id) return i;
        if (!live[i] && free == RUNTIME_MODULES) free = i;
    }
    return free;
}
/* Does a site of another live module share a byte with [address, address + n)? */
static int claimed(unsigned position, uint32_t address, uint32_t n)
{
    for (unsigned k = 0; k < RUNTIME_MODULES; ++k)
        for (uint32_t i = 0; k != position && live[k] && i < live[k]->sites; ++i)
            if (address < live[k]->site[i].address + live[k]->site[i].length && live[k]->site[i].address < address + n) return 1;
    return 0;
}

static int enter(void *u) { (void)u; if (!modwerk_machine_stopped()) return 0; held = 1; return 1; }
static int safe(void *u) { (void)u; return held && modwerk_machine_stopped(); }
static int leave(void *u) { (void)u; held = 0; return 1; }
/* Admission and relocation, off-line: nothing live changes, refused or not. */
static int prepare(void *u, const uint8_t *data, uint32_t length)
{
    (void)u;
    candidate = 0; prepared = 0; refusal = RUNTIME_OK;
    if (length < 28u || data[0] != 'M' || data[1] != 'W' || data[2] != 'R' || data[3] != 'M' || be16(data + 4) < 3u ||
        be16(data + 4) > 6u || be16(data + 6)) return refuse(RUNTIME_MALFORMED);
    uint32_t abi = be16(data + 4), header = abi == 6 ? RUNTIME_HEADER_BYTES : abi == 5 ? 50u : abi == 4 ? 32u : 28u;
    if (length < header) return refuse(RUNTIME_MALFORMED);
    uint32_t image = be32(data + 8), bss = be32(data + 12), count = be32(data + 16), hooks = be32(data + 20),
             sites = be32(data + 24), id = abi > 3 ? be32(data + 28) : 0, end = image + bss, at = header + 4u * hooks;
    struct runtime_dsp dsp = no_dsp;
    if (abi >= 5) {
        dsp.count = be32(data + 32); dsp.relocation_count = (uint16_t)be16(data + 36); dsp.id = data[38]; dsp.slots = data[39];
        dsp.init = (uint16_t)be16(data + 40); dsp.proc = (uint16_t)be16(data + 42); dsp.cycles = (uint16_t)be16(data + 44);
        dsp.kind = data[46]; dsp.state = data[47]; dsp.buffer = (uint16_t)be16(data + 48); dsp.module = id;
        if (abi == 6) {
            for (unsigned i = 0; i < 15u; ++i) dsp.name[i] = (char)data[50 + i];
            dsp.layout = (uint16_t)be16(data + 66);
        }
    }
    if (image > RUNTIME_IMAGE_BYTES || bss > RUNTIME_IMAGE_BYTES - image || hooks > RUNTIME_EVENTS ||
        count > RUNTIME_RELOCATIONS || sites > RUNTIME_SITES || length < at + image + 4u * count) return refuse(RUNTIME_MALFORMED);
    const uint8_t *from = data + at, *relocation = from + image, *record = relocation + 4u * count, *p = record;
    uint32_t hook[RUNTIME_EVENTS], left = length - (at + image + 4u * count), address[RUNTIME_SITES], size[RUNTIME_SITES];
    for (uint32_t i = 0; i < RUNTIME_EVENTS; ++i) {
        hook[i] = i < hooks ? be32(data + header + 4u * i) : RUNTIME_NONE;
        if (hook[i] != RUNTIME_NONE && (hook[i] >= image || hook[i] & 1u)) return refuse(RUNTIME_MALFORMED);
    }
    /* Sites: whole bounded records, patchable stock code, no overlaps. */
    for (uint32_t i = 0; i < sites; ++i) {
        if (left < 8u) return refuse(RUNTIME_MALFORMED);
        uint32_t n = be16(p + 4), r = be16(p + 6);
        address[i] = be32(p); size[i] = n;
        if (!n || n > RUNTIME_SITE_BYTES || (address[i] | n) & 1u || r > RUNTIME_SITE_RELOCATIONS ||
            left - 8u < 2u * n + 2u * r || !modwerk_machine_patchable(address[i], n)) return refuse(RUNTIME_MALFORMED);
        for (uint32_t j = 0; j < i; ++j)
            if (address[i] < address[j] + size[j] && address[j] < address[i] + n) return refuse(RUNTIME_MALFORMED);
        p += 8u + 2u * n + 2u * r; left -= 8u + 2u * n + 2u * r;
    }
    /* DSP code: 24-bit words; each relocation names a word holding an offset into them, in rising order. */
    const uint8_t *words = p, *dsp_relocation = p + 4u * dsp.count;
    if (dsp.count > RUNTIME_DSP_WORDS || dsp.relocation_count > RUNTIME_DSP_RELOCATIONS ||
        left != 4u * dsp.count + 2u * dsp.relocation_count || (!dsp.count && dsp.relocation_count) ||
        (dsp.count && (dsp.init >= dsp.count || dsp.proc >= dsp.count || !dsp.slots || dsp.slots > 3u)))
        return refuse(RUNTIME_MALFORMED);
    for (uint32_t i = 0; i < dsp.count; ++i) if (be32(words + 4u * i) > 0xffffffu) return refuse(RUNTIME_MALFORMED);
    for (uint32_t i = 0; i < dsp.relocation_count; ++i) {
        uint32_t r = be16(dsp_relocation + 2u * i);
        if (r >= dsp.count || be32(words + 4u * r) >= dsp.count || (i && r <= be16(dsp_relocation + 2u * i - 2u)))
            return refuse(RUNTIME_MALFORMED);
    }
    /* Admission: a position, bytes no other live module owns, an effect id and what the machine's DSPs take, memory. */
    slot = position_of(id);
    if (slot == RUNTIME_MODULES) return refuse(RUNTIME_FULL);
    for (uint32_t i = 0; i < sites; ++i) if (claimed(slot, address[i], size[i])) return refuse(RUNTIME_CONFLICT);
    int why = modwerk_machine_dsp_admit(dsp_of(live[slot]), &dsp);
    if (why) return refuse((enum runtime_refusal)why);
    if (image || sites || dsp.count) {
        reclaim();
        uint32_t head = ((uint32_t)sizeof(struct runtime_module) + sites * (uint32_t)sizeof(struct runtime_site) + 15u) & ~15u,
                 code = (end + 15u) & ~15u, tail = (4u * dsp.count + 2u * dsp.relocation_count + 15u) & ~15u;
        struct runtime_module *m = take(head + code + tail);
        if (!m) return refuse(RUNTIME_MEMORY);
        struct runtime_site *site = (struct runtime_site *)(void *)(m + 1);
        uint8_t *to = (uint8_t *)m + head;
        uint32_t base = (uint32_t)(uintptr_t)to;
        for (uint32_t i = 0; i < image; ++i) to[i] = from[i];
        for (uint32_t i = 0; i < bss; ++i) to[image + i] = 0;
        /* Each word must point into the module; one listed twice no longer does. */
        for (uint32_t i = 0; i < count; ++i) {
            uint32_t r = be32(relocation + 4u * i);
            if (r & 1u || image < 4u || r > image - 4u || !relocate(to + r, end, base)) return refuse(RUNTIME_MALFORMED);
        }
        p = record;
        for (uint32_t i = 0; i < sites; ++i) {
            uint32_t n = size[i], r = be16(p + 6);
            site[i].address = address[i]; site[i].length = n;
            for (uint32_t j = 0; j < n; ++j) { site[i].stock[j] = p[8 + j]; site[i].code[j] = p[8 + n + j]; }
            for (uint32_t j = 0; j < r; ++j) {
                uint32_t o = be16(p + 8 + 2u * n + 2u * j);
                if (o & 1u || n < 4u || o > n - 4u || !relocate(site[i].code + o, end, base)) return refuse(RUNTIME_MALFORMED);
            }
            p += 8u + 2u * n + 2u * r;
        }
        modwerk_machine_invalidate_code();
        uint32_t *dsp_words = (uint32_t *)(void *)((uint8_t *)m + head + code);
        uint16_t *dsp_relocations = (uint16_t *)(void *)(dsp_words + dsp.count);
        for (uint32_t i = 0; i < dsp.count; ++i) dsp_words[i] = be32(words + 4u * i);
        for (uint32_t i = 0; i < dsp.relocation_count; ++i) dsp_relocations[i] = (uint16_t)be16(dsp_relocation + 2u * i);
        dsp.words = dsp_words; dsp.relocations = dsp_relocations;
        m->id = id; m->size = head + code + tail; m->dsp = dsp;
        for (uint32_t i = 0; i < RUNTIME_EVENTS; ++i) m->hook[i] = hook[i] == RUNTIME_NONE ? 0 : (uintptr_t)to + hook[i];
        m->site = site; m->sites = sites;
        owned[owners++] = candidate = m;
    }
    prepared = 1;
    return 1;
}
/* Never dispatched, so nothing can be running it. */
static int discard(void *u) { (void)u; if (prepared && candidate) forget(candidate); prepared = 0; candidate = 0; return 1; }
static enum mu_publication publish(void *u)
{
    (void)u;
    if (!prepared) return MU_UNCERTAIN;
    struct runtime_module *was = live[slot];
    if (!switch_to(slot, candidate)) { refusal = RUNTIME_BUSY; return MU_UNCHANGED; } /* the controller discards the candidate */
    previous = was; candidate = 0; prepared = 0;
    return MU_APPLIED;
}
/* The trial module is no longer reachable from a position; reclaim frees it once no task holds it. */
static int restore(void *u) { (void)u; if (!switch_to(slot, previous)) return 0; previous = 0; return 1; }
static int retire(void *u) { (void)u; previous = 0; reclaim(); return 1; }
const struct mu_backend modwerk_runtime_backend = {0, enter, safe, leave, prepare, discard, publish, restore, retire};
