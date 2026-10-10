/* SPDX-License-Identifier: GPL-3.0-or-later
 * Host check of the loader with stub machine glue: a fake stock-code region
 * at 0x1000, fake paused-task memory, and a mask the code accesses must hold.
 * Module code never runs. */
#include "../loader.c"
#include <stdio.h>
#include <string.h>

#define STOCK 0x1000u
static unsigned failures;
#define CHECK(x) do { if (!(x)) { failures++; fprintf(stderr, "%s:%d: %s\n", __FILE__, __LINE__, #x); } } while (0)
static uint8_t stock[256], original[256], paused[64];
static int stopped = 1, masked, flushed, unknown;
int modwerk_machine_stopped(void) { return stopped; }
void *modwerk_machine_uncached(void *p) { return p; }
void modwerk_machine_invalidate_code(void) {}
int modwerk_machine_patchable(uint32_t a, uint32_t n) { return a >= STOCK + 16u && n <= STOCK + sizeof stock - a; }
uint8_t *modwerk_machine_code(uint32_t a) { CHECK(masked); return stock + (a - STOCK); }
void modwerk_machine_flush_data(uint32_t a, uint32_t n) { (void)a; (void)n; flushed++; }
uint32_t modwerk_machine_mask(void) { CHECK(!masked); masked = 1; return 7; }
void modwerk_machine_unmask(uint32_t sr) { CHECK(masked && sr == 7); masked = 0; }
unsigned modwerk_machine_paused(struct runtime_span *span, unsigned max)
{
    if (unknown) return max + 1u;
    span[0] = (struct runtime_span){paused, paused + sizeof paused};
    return 1;
}

/* DSP glue: refuses with `dsp_why` (masked or not) and records the last switch. */
static int dsp_why, dsp_switches;
static struct runtime_dsp dsp_from, dsp_to;
static int dsp_handle = -1; /* the effect id the machine gives, -1: the preferred one */
int modwerk_machine_dsp_admit(const struct runtime_dsp *from, struct runtime_dsp *to)
{
    (void)from;
    if (dsp_handle >= 0 && to->count) to->id = (uint8_t)dsp_handle;
    return dsp_why;
}
void modwerk_machine_dsp_switch(const struct runtime_dsp *from, const struct runtime_dsp *to)
{
    CHECK(masked); dsp_from = *from; dsp_to = *to; ++dsp_switches;
}

static const struct mu_backend *b = &modwerk_runtime_backend;
static uint8_t p[RUNTIME_PACKAGE_BYTES + 64];
static uint32_t n;
static void emit(uint32_t v) { put32(p + n, v); n += 4; }
static void emit16(uint32_t v) { p[n++] = (uint8_t)(v >> 8); p[n++] = (uint8_t)v; }
/* ABI 4 header of module `id` for `image` bytes of `fill`, a tick hook at
 * `tick` (or none) and relocations at `relocation[0..count)`, each word holding 6. */
static uint32_t id = 7;
static void begin(uint32_t image, uint32_t bss, uint32_t tick, const uint32_t *relocation, uint32_t count, uint32_t sites, uint8_t fill)
{
    n = 0; memcpy(p, "MWRM\0\4\0\0", 8); n = 8;
    emit(image); emit(bss); emit(count); emit(RUNTIME_EVENTS); emit(sites); emit(id);
    emit(tick); emit(RUNTIME_NONE); emit(RUNTIME_NONE); emit(RUNTIME_NONE);
    memset(p + n, fill, image);
    for (uint32_t i = 0; i < count; ++i) if (relocation[i] + 4 <= image) put32(p + n + relocation[i], 6);
    n += image;
    for (uint32_t i = 0; i < count; ++i) emit(relocation[i]);
}
/* A site at `address` expecting stock's original bytes, becoming jmp module+2. */
static void site(uint32_t address, uint32_t length)
{
    emit(address); emit16(length); emit16(1);
    memcpy(p + n, original + (address - STOCK), length); n += length;
    uint8_t code[RUNTIME_SITE_BYTES] = {0x4e, 0xf9, 0, 0, 0, 2};
    memcpy(p + n, code, length); n += length;
    emit16(2);
}
/* ABI 5: the same header with a DSP descriptor, then after the sites its
 * words (a relocation word holds 1) and relocations. */
static void begin5(uint32_t image, uint32_t effect, uint32_t words, uint32_t relocs)
{
    begin(image, 0, image ? 0 : RUNTIME_NONE, 0, 0, 0, 0xe1);
    memmove(p + 50, p + 32, n - 32); n += 18; p[5] = 5; p[48] = 0x40; p[49] = 0;
    put32(p + 32, words); p[36] = (uint8_t)(relocs >> 8); p[37] = (uint8_t)relocs; p[38] = (uint8_t)effect; p[39] = 1;
    p[40] = 0; p[41] = 1; p[42] = 0; p[43] = 2; p[44] = 0; p[45] = 244; p[46] = RUNTIME_MODELED; p[47] = 70;
}
static void dsp_words(uint32_t words, const uint16_t *reloc, uint32_t relocs)
{
    for (uint32_t i = 0; i < words; ++i) emit(0x0c0000u + i);
    for (uint32_t i = 0; i < relocs; ++i) put32(p + n - 4u * words + 4u * reloc[i], 1);
    for (uint32_t i = 0; i < relocs; ++i) emit16(reloc[i]);
}
static int bytes_at(uint32_t address, const uint8_t *bytes, uint32_t length) { return !memcmp(stock + (address - STOCK), bytes, length); }
static uint32_t word(uint32_t address) { return be32(stock + (address - STOCK)); }

int main(void)
{
    const uint32_t four = 4, twice[2] = {4, 4};
    for (unsigned i = 0; i < sizeof stock; ++i) stock[i] = (uint8_t)(0x40 + i);
    memcpy(original, stock, sizeof stock);

    /* Refusals before any memory is taken. */
    for (uint32_t bad = 0; bad < 14; ++bad) {
        begin(8, 4, 2, &four, 1, 1, 0xa1); site(STOCK + 32, 6);
        if (bad == 0) p[0] = 'X';
        if (bad == 1) p[5] = 2;                                        /* ABI 2 */
        if (bad == 2) n -= 1;                                          /* length mismatch */
        if (bad == 3) { begin(8, 4, 8, 0, 0, 0, 0); }                  /* hook outside the image */
        if (bad == 4) { begin(RUNTIME_IMAGE_BYTES + 2, 0, 0, 0, 0, 0, 0); }
        if (bad == 5) { begin(8, 4, 2, 0, 0, 1, 0); site(STOCK + 8, 6); }     /* outside patchable code */
        if (bad == 6) { begin(8, 4, 2, 0, 0, 1, 0); site(STOCK + 33, 6); }    /* odd address */
        if (bad == 7) { begin(8, 4, 2, 0, 0, 1, 0); site(STOCK + 32, 5); }    /* odd length */
        if (bad == 8) { begin(8, 4, 2, 0, 0, 2, 0); site(STOCK + 32, 6); site(STOCK + 36, 6); } /* overlap */
        if (bad == 9) { begin(8, 4, 2, 0, 0, 1, 0); site(STOCK + 32, 6); put32(p + n - 2 - 6 + 2, 12); } /* jmp past the bss */
        if (bad == 10) { begin(8, 4, 2, 0, 0, 1, 0); site(STOCK + 32, 6); p[n - 1] = 4; }  /* site relocation past its bytes */
        if (bad == 11) { begin(8, 4, 2, twice, 2, 0, 0); }              /* the same word twice */
        if (bad == 12) { begin(8, 4, 2, 0, 0, 1, 0); site(STOCK + 32, 6); emit(0); } /* trailing bytes */
        if (bad == 13) n = RUNTIME_HEADER_BYTES - 1;
        CHECK(!b->prepare(0, p, n) && modwerk_runtime_free(0) == RUNTIME_POOL_BYTES && modwerk_runtime_refusal() == RUNTIME_MALFORMED);
    }
    CHECK(!masked && memcmp(stock, original, sizeof stock) == 0);

    /* A: hooks, a relocated word, bss and one site, published while nothing is in flight. */
    begin(8, 4, 2, &four, 1, 1, 0xa1); site(STOCK + 32, 6);
    CHECK(b->prepare(0, p, n) && b->publish(0) == MU_APPLIED);
    const struct runtime_module *a = modwerk_runtime_module(0);
    uint8_t *code = (uint8_t *)(uintptr_t)(a->hook[RUNTIME_TICK] - 2);
    CHECK(a && a->sites == 1 && code[0] == 0xa1 && be32(code + 4) == (uint32_t)(uintptr_t)code + 6 && be32(code + 8) == 0);
    CHECK(stock[32] == 0x4e && stock[33] == 0xf9 && word(STOCK + 34) == (uint32_t)(uintptr_t)code + 2 && flushed > 0);
    CHECK(bytes_at(STOCK + 38, original + 38, sizeof stock - 38) && bytes_at(STOCK, original, 32));
    CHECK(b->retire(0));

    /* B patches the same place: A's bytes go back first. A paused task inside
     * a site, or unknown task state, refuses and changes nothing. */
    begin(4, 0, 0, 0, 0, 1, 0xb2); emit(STOCK + 30); emit16(8); emit16(0);
    memcpy(p + n, original + 30, 8); n += 8; memset(p + n, 0x71, 8); n += 8; /* eight nops */
    uint32_t b_size = n;
    put32(paused + 20, STOCK + 34);                              /* inside A's site */
    CHECK(b->prepare(0, p, b_size) && b->publish(0) == MU_UNCHANGED && b->discard(0) && modwerk_runtime_module(0) == a);
    put32(paused + 20, STOCK + 30);                              /* at B's first byte: fine */
    unknown = 1;
    CHECK(b->prepare(0, p, b_size) && b->publish(0) == MU_UNCHANGED && b->discard(0) && modwerk_runtime_module(0) == a);
    unknown = 0;
    CHECK(stock[32] == 0x4e);
    uint32_t before = modwerk_runtime_free(0);
    CHECK(b->prepare(0, p, b_size) && modwerk_runtime_free(0) < before && b->discard(0) && modwerk_runtime_free(0) == before); /* discard frees */
    CHECK(b->prepare(0, p, b_size) && b->publish(0) == MU_APPLIED);
    CHECK(bytes_at(STOCK + 30, (const uint8_t *)"\x71\x71\x71\x71\x71\x71\x71\x71", 8) && bytes_at(STOCK + 38, original + 38, 2));
    /* Rollback puts A back exactly. */
    CHECK(b->restore(0) && modwerk_runtime_module(0) == a && stock[32] == 0x4e && bytes_at(STOCK + 30, original + 30, 2));

    /* Code changed under a module: switching away is refused and nothing moves. */
    stock[33] ^= 1;
    begin(0, 0, RUNTIME_NONE, 0, 0, 0, 0);
    CHECK(b->prepare(0, p, n) && b->publish(0) == MU_UNCHANGED && b->discard(0) && modwerk_runtime_module(0) == a);
    stock[33] ^= 1;
    /* A site whose stock bytes are not there is refused, and A stays applied. */
    begin(4, 0, 0, 0, 0, 1, 0); site(STOCK + 64, 6); stock[64] ^= 1;
    CHECK(b->prepare(0, p, n) && b->publish(0) == MU_UNCHANGED && b->discard(0) && stock[32] == 0x4e);
    stock[64] ^= 1;
    /* Removal restores stock everywhere. */
    begin(0, 0, RUNTIME_NONE, 0, 0, 0, 0);
    CHECK(b->prepare(0, p, n) && b->publish(0) == MU_APPLIED && !modwerk_runtime_module(0));
    CHECK(memcmp(stock, original, sizeof stock) == 0);

    /* Reclaimed: a module no position reaches is freed once no paused task
     * holds an address inside it, so loads never run out by repetition. */
    CHECK(b->retire(0) && modwerk_runtime_free(0) == RUNTIME_POOL_BYTES);
    unsigned loads = 0;
    for (; loads < 64; ++loads) {
        begin(RUNTIME_IMAGE_BYTES - 16, 0, 0, 0, 0, 0, 0xc3);
        if (!b->prepare(0, p, n)) break;
        CHECK(b->publish(0) == MU_APPLIED && b->retire(0));
    }
    CHECK(loads == 64 && modwerk_runtime_active() == 1);
    const struct runtime_module *old = modwerk_runtime_module(0);
    put32(paused + 40, (uint32_t)(uintptr_t)old + 40u);          /* a paused task inside it */
    begin(16, 0, 0, 0, 0, 0, 0xc4);
    CHECK(b->prepare(0, p, n) && b->publish(0) == MU_APPLIED && b->retire(0));
    uint32_t small = modwerk_runtime_module(0)->size, free = modwerk_runtime_free(0);
    CHECK(free == RUNTIME_POOL_BYTES - old->size - small);         /* kept */
    unknown = 1;
    CHECK(b->retire(0) && modwerk_runtime_free(0) == free);        /* unknown task state frees nothing */
    unknown = 0;
    put32(paused + 40, 0);
    CHECK(b->retire(0) && modwerk_runtime_free(0) == RUNTIME_POOL_BYTES - small);

    /* Several modules at once, each at its own position with its own memory. */
    begin(0, 0, RUNTIME_NONE, 0, 0, 0, 0);
    CHECK(b->prepare(0, p, n) && b->publish(0) == MU_APPLIED && b->retire(0) && !modwerk_runtime_active());
    id = 1; begin(8, 4, 2, &four, 1, 1, 0xd1); site(STOCK + 32, 6);
    CHECK(b->prepare(0, p, n) && b->publish(0) == MU_APPLIED && b->retire(0));
    id = 2; begin(8, 0, 2, 0, 0, 1, 0xd2); site(STOCK + 64, 6);
    CHECK(b->prepare(0, p, n) && b->publish(0) == MU_APPLIED && b->retire(0));
    const struct runtime_module *one = modwerk_runtime_module(0), *two = modwerk_runtime_module(1);
    const uint32_t one_size = one->size;
    CHECK(modwerk_runtime_active() == 2 && one->id == 1 && two->id == 2 && stock[32] == 0x4e && stock[64] == 0x4e);
    CHECK(word(STOCK + 34) == (uint32_t)(uintptr_t)one->hook[RUNTIME_TICK] && word(STOCK + 66) == (uint32_t)(uintptr_t)two->hook[RUNTIME_TICK]);
    /* A third patching bytes module 1 patches is refused before anything changes. */
    id = 3; begin(8, 0, 0, 0, 0, 1, 0xd3); site(STOCK + 34, 6);
    free = modwerk_runtime_free(0);
    CHECK(!b->prepare(0, p, n) && modwerk_runtime_refusal() == RUNTIME_CONFLICT && modwerk_runtime_free(0) == free);
    CHECK(modwerk_runtime_module(0) == one && modwerk_runtime_module(1) == two && !modwerk_runtime_module(2) && stock[32] == 0x4e);
    /* Module 1 may move its own site; module 2 is untouched. */
    id = 1; begin(8, 0, 0, 0, 0, 1, 0xd4); site(STOCK + 34, 6);
    CHECK(b->prepare(0, p, n) && b->publish(0) == MU_APPLIED);
    CHECK(bytes_at(STOCK + 32, original + 32, 2) && stock[34] == 0x4e && modwerk_runtime_module(1) == two && stock[64] == 0x4e);
    CHECK(b->restore(0) && modwerk_runtime_module(0) == one && stock[32] == 0x4e && bytes_at(STOCK + 38, original + 38, 2));
    /* Removing module 1 leaves module 2 live; a new module takes the free position. */
    begin(0, 0, RUNTIME_NONE, 0, 0, 0, 0);
    CHECK(b->prepare(0, p, n) && b->publish(0) == MU_APPLIED && b->retire(0));
    CHECK(!modwerk_runtime_module(0) && modwerk_runtime_module(1) == two && bytes_at(STOCK + 30, original + 30, 10) && stock[64] == 0x4e);
    uint32_t largest;
    CHECK(modwerk_runtime_free(&largest) == RUNTIME_POOL_BYTES - two->size && largest == RUNTIME_POOL_BYTES - two->size - one_size); /* module 1 left a hole below 2 */
    id = 4; begin(8, 0, 0, 0, 0, 0, 0xd5);
    CHECK(b->prepare(0, p, n) && b->publish(0) == MU_APPLIED && b->retire(0) && modwerk_runtime_module(0)->id == 4);
    /* Genuine exhaustion refuses before activation and keeps the live set. */
    unsigned fitted = 0;
    for (id = 100; id < 100 + RUNTIME_MODULES; ++id) {
        begin(RUNTIME_IMAGE_BYTES - 16, 0, 0, 0, 0, 0, 0xd6);
        if (!b->prepare(0, p, n)) break;
        CHECK(b->publish(0) == MU_APPLIED && b->retire(0));
        ++fitted;
    }
    CHECK(fitted > 0 && modwerk_runtime_refusal() == RUNTIME_MEMORY && modwerk_runtime_active() == 2 + fitted);
    CHECK(modwerk_runtime_module(1) == two && stock[64] == 0x4e);
    /* Small modules fill every position; one more is refused. */
    for (; id < 1000 && modwerk_runtime_active() < RUNTIME_MODULES; ++id) {
        begin(4, 0, 0, 0, 0, 0, 0xd7);
        CHECK(b->prepare(0, p, n) && b->publish(0) == MU_APPLIED && b->retire(0));
    }
    begin(4, 0, 0, 0, 0, 0, 0xd8);
    CHECK(!b->prepare(0, p, n) && modwerk_runtime_refusal() == RUNTIME_FULL && modwerk_runtime_active() == RUNTIME_MODULES);
    /* An ABI 3 package is module 0: it replaces module 0, not another. */
    for (id = 100; id < 100 + fitted; ++id) {
        begin(0, 0, RUNTIME_NONE, 0, 0, 0, 0);
        CHECK(b->prepare(0, p, n) && b->publish(0) == MU_APPLIED && b->retire(0));
    }
    begin(4, 0, 0, 0, 0, 0, 0xd9);
    memmove(p + 28, p + 32, n - 32); n -= 4; p[5] = 3;
    CHECK(b->prepare(0, p, n) && b->publish(0) == MU_APPLIED && b->retire(0) && modwerk_runtime_module(1) == two);
    unsigned zero = 0;
    for (unsigned i = 0; i < RUNTIME_MODULES; ++i) zero += modwerk_runtime_module(i) && modwerk_runtime_module(i)->id == 0;
    CHECK(zero == 1);

    /* Every module removed: the table is empty again. */
    for (unsigned i = 0; i < RUNTIME_MODULES; ++i) {
        if (!modwerk_runtime_module(i)) continue;
        id = modwerk_runtime_module(i)->id; begin(0, 0, RUNTIME_NONE, 0, 0, 0, 0);
        if (!id) { memmove(p + 28, p + 32, n - 32); n -= 4; p[5] = 3; }
        CHECK(b->prepare(0, p, n) && b->publish(0) == MU_APPLIED && b->retire(0));
    }
    CHECK(!modwerk_runtime_active() && modwerk_runtime_free(0) == RUNTIME_POOL_BYTES);
    dsp_switches = 0; /* every switch tells the machine, with or without DSP code */

    /* DSP effects (ABI 5): the code and its needs are kept in the module's extent and handed to the machine at the switch. */
    const uint16_t reloc[2] = {1, 3}, unordered[2] = {3, 1};
    id = 40; begin5(0, 26, 5, 2); dsp_words(5, reloc, 2);
    CHECK(b->prepare(0, p, n) && b->publish(0) == MU_APPLIED && b->retire(0) && dsp_switches == 1);
    const struct runtime_module *fx = modwerk_runtime_module(0);
    CHECK(fx && fx->id == 40 && !fx->hook[RUNTIME_TICK] && dsp_to.count == 5 && dsp_to.id == 26 && dsp_to.module == 40 && dsp_to.slots == 1 && dsp_to.init == 1 &&
          dsp_to.proc == 2 && dsp_to.cycles == 244 && dsp_to.kind == RUNTIME_MODELED && dsp_to.state == 70 && dsp_to.buffer == 0x4000 && !dsp_from.count);
    CHECK(dsp_to.words == fx->dsp.words && dsp_to.words[0] == 0x0c0000u && dsp_to.words[1] == 1 && dsp_to.words[4] == 0x0c0004u &&
          dsp_to.relocation_count == 2 && dsp_to.relocations[0] == 1 && dsp_to.relocations[1] == 3);
    CHECK(!fx->dsp.name[0] && !fx->dsp.layout); /* ABI 5: no name, layout 0 */
    /* ABI 6: the DSP descriptor adds the display name (16 bytes, NUL-ended) and the parameter-layout number. */
    id = 40; begin5(0, 26, 5, 2);
    memmove(p + 68, p + 50, n - 50); n += 18; p[5] = 6;
    memcpy(p + 50, "E-Verb\0\0\0\0\0\0\0\0\0X", 16); p[66] = 0; p[67] = 3; /* an unterminated name is cut at 15 */
    dsp_words(5, reloc, 2);
    CHECK(b->prepare(0, p, n) && b->publish(0) == MU_APPLIED && b->retire(0) && dsp_switches == 2);
    fx = modwerk_runtime_module(0);
    CHECK(!strcmp(fx->dsp.name, "E-Verb") && fx->dsp.layout == 3 && dsp_to.layout == 3 && !strcmp(dsp_to.name, "E-Verb"));
    dsp_switches = 1;
    /* Malformed DSP sections change nothing. */
    for (unsigned bad = 0; bad < 6; ++bad) {
        id = 41; begin5(0, 27, 5, 2); dsp_words(5, bad == 2 ? unordered : reloc, 2);
        if (bad == 0) put32(p + n - 4 - 4 * 5, 0x1000000u);             /* a word wider than 24 bits */
        if (bad == 1) put32(p + n - 4 - 4 * 4, 5);                      /* a relocated word pointing past the code */
        if (bad == 3) p[41] = 5;                                         /* init past the code */
        if (bad == 4) p[39] = 0;                                         /* no slot */
        if (bad == 5) emit16(0);                                         /* trailing bytes */
        free = modwerk_runtime_free(0);
        CHECK(!b->prepare(0, p, n) && modwerk_runtime_refusal() == RUNTIME_MALFORMED && modwerk_runtime_free(0) == free && dsp_switches == 1);
    }
    /* Another module preferring effect 26 loads beside it with the effect id the machine gives (a handle), and keeps it. */
    id = 41; begin5(0, 26, 5, 2); dsp_words(5, reloc, 2); dsp_handle = 30;
    CHECK(b->prepare(0, p, n) && b->publish(0) == MU_APPLIED && b->retire(0) && dsp_switches == 2 && dsp_to.id == 30 && dsp_to.module == 41);
    CHECK(modwerk_runtime_module(1)->dsp.id == 30 && modwerk_runtime_module(0)->dsp.id == 26);
    dsp_handle = -1; begin(0, 0, RUNTIME_NONE, 0, 0, 0, 0);
    CHECK(b->prepare(0, p, n) && b->publish(0) == MU_APPLIED && b->retire(0) && dsp_switches == 3 && dsp_from.id == 30);
    dsp_switches = 1;
    /* What the machine refuses (the DSP's memory, cycles, an effect in use) is the refusal, before or at the switch. */
    id = 41; begin5(0, 27, 5, 2); dsp_words(5, reloc, 2);
    dsp_why = RUNTIME_CYCLES;
    CHECK(!b->prepare(0, p, n) && modwerk_runtime_refusal() == RUNTIME_CYCLES && dsp_switches == 1);
    dsp_why = 0; id = 40; begin(0, 0, RUNTIME_NONE, 0, 0, 0, 0);
    CHECK(b->prepare(0, p, n));
    dsp_why = RUNTIME_BUSY;
    CHECK(b->publish(0) == MU_UNCHANGED && b->discard(0) && modwerk_runtime_module(0) == fx && dsp_switches == 1);
    dsp_why = 0;
    CHECK(b->prepare(0, p, n) && b->publish(0) == MU_APPLIED && b->retire(0) && !modwerk_runtime_module(0));
    CHECK(dsp_switches == 2 && dsp_from.id == 26 && !dsp_to.count);

    /* Activation only while nothing plays or records. */
    stopped = 0;
    CHECK(!b->enter(0) && !b->safe(0));
    stopped = 1;
    CHECK(b->enter(0) && b->safe(0) && b->leave(0) && !b->safe(0) && !masked);
    if (failures) { fprintf(stderr, "%u loader checks failed\n", failures); return 1; }
    puts("Loader: refusals, relocation, bss, hooks, stock-code sites (in-flight, stock and changed-code refusals, "
         "replace, rollback, removal), reclamation, several modules (conflicts, positions), exhaustion and DSP sections passed.");
    return 0;
}
