/* SPDX-License-Identifier: GPL-3.0-or-later
 * Installed modules survive a power cycle (owner, 11 October 2026). The base keeps the accepted set in RAM,
 * each package exactly as the host staged it, and writes it to the card as /MODWERK0.SET and /MODWERK1.SET in
 * turn, with a generation number, so a power loss mid-write keeps the previous set. After a boot the newest
 * complete set this base wrote is installed through the runtime loader, with the same checks as a USB install.
 * Writing and reading use the logger's stock file calls and gate (engine task, card ready, nothing playing or
 * recording, not in USB disk mode). Holding FUNC at boot skips the restore, so a module that breaks the unit
 * cannot lock it out; so does another base's set (its configuration hash differs) or a damaged file.
 *
 * Set (big-endian): "MWST", version 1, generation, count, bytes used (header included), the base's
 * configuration hash, the SHA-256 of what follows, then per module its id, its length and its package,
 * padded to 4. Design: docs/OCTATRACK_ELEKLOADER_MIGRATION.md, "Keeping the module set across power cycles". */
#include <stdint.h>
#include "upload.h"
#include "loader.h"

#define HEADER 84u
#define SET_BYTES 0x41000u /* the 256 KiB pool's worth of packages, and the header */
extern const uint8_t modwerk_base_digest[32];
extern const struct mu_backend modwerk_runtime_backend;
#ifdef MODWERK_HOST
struct file_object { uint32_t word[6]; };
int modwerk_test_file(int op, const char *path, uint8_t *data, unsigned n);
uint8_t modwerk_test_held;
int modwerk_test_gate = 1;
uint32_t modwerk_test_ticks;
#define HELD_FUNC (modwerk_test_held)
#define GATE() (modwerk_test_gate)
#define TICKS (modwerk_test_ticks)
#define SAY(text) ((void)(text))
#else
struct file_object { uint32_t word[6]; };
extern int olog_stock_open(struct file_object *, const char *, const char *, void *, unsigned);
extern int olog_stock_read(struct file_object *, void *, unsigned);
extern int olog_stock_write(struct file_object *, const void *, unsigned);
extern int olog_stock_close(struct file_object *);
/* The logger's 512-byte I/O buffer, as this base places it (build_core.py): its retained region, uncached. */
extern uint8_t octamod_log_retained[];
#define octamod_log_io ((uint8_t *)((uintptr_t)octamod_log_retained + 6144u + 0x08000000u))
int octamod_log_can_flush(void);
extern volatile uint32_t modwerk_runtime_ticks;
#define HELD_FUNC (*(volatile uint8_t *)(0x46100b18u + (0x2du >> 3)) >> (0x2du & 7u) & 1u) /* the panel's held FUNC */
#define GATE() octamod_log_can_flush()
#define TICKS modwerk_runtime_ticks
#define SAY(text) ((void (*)(const char *, unsigned))0x4005a2b8u)(text, 0xa0)
#endif

static uint8_t set[SET_BYTES] __attribute__((aligned(4)));
static const uint8_t *candidate; /* the package the host staged, until it is accepted or dropped */
static uint32_t candidate_bytes;
static unsigned pending, restored, slot;
static uint32_t retry_at;
volatile uint32_t modwerk_modset_generation, modwerk_modset_count, modwerk_modset_result; /* for the report */
enum { RESTORED = 1, NONE_SAVED, SKIPPED, FOREIGN, DAMAGED, REFUSED, SAVED, SAVE_FAILED, TOO_BIG };

static uint32_t be32(const uint8_t *p) { return (uint32_t)p[0] << 24 | (uint32_t)p[1] << 16 | (uint32_t)p[2] << 8 | p[3]; }
static void put32(uint8_t *p, uint32_t v) { p[0] = (uint8_t)(v >> 24), p[1] = (uint8_t)(v >> 16), p[2] = (uint8_t)(v >> 8), p[3] = (uint8_t)v; }
static uint32_t used(void) { return be32(set) == 0x4d575354u ? be32(set + 16) : HEADER; }
static uint32_t module_of(const uint8_t *p, uint32_t n) { return n >= 32u && ((uint32_t)p[4] << 8 | p[5]) >= 4u ? be32(p + 28) : 0; }
/* A package that changes nothing removes its module: no image, hooks, sites or DSP code (loader.c). */
static int removes(const uint8_t *p, uint32_t n)
{
    return n >= 28u && !be32(p + 8) && !be32(p + 12) && !be32(p + 20) && !be32(p + 24) && (n < 36u || ((uint32_t)p[4] << 8 | p[5]) < 5u || !be32(p + 32));
}
static void seal(uint32_t count, uint32_t bytes)
{
    set[0] = 'M', set[1] = 'W', set[2] = 'S', set[3] = 'T';
    put32(set + 4, 1), put32(set + 8, be32(set + 8) + 1u), put32(set + 12, count), put32(set + 16, bytes);
    for (unsigned i = 0; i < 32u; ++i) set[20 + i] = modwerk_base_digest[i];
    mu_sha256(set + HEADER, bytes - HEADER, set + 52);
    modwerk_modset_generation = be32(set + 8), modwerk_modset_count = count;
}

/* boot.c, at prepare and accept: what the host staged, and that it stays. */
void modwerk_modset_candidate(const uint8_t *package, uint32_t bytes) { candidate = package, candidate_bytes = bytes; }
void modwerk_modset_accepted(void)
{
    if (!candidate) return;
    uint32_t id = module_of(candidate, candidate_bytes), n = used(), count = be32(set) == 0x4d575354u ? be32(set + 12) : 0;
    /* Drop the module's earlier package, then append the new one unless it removes the module. */
    for (uint32_t at = HEADER; at < n;) {
        uint32_t length = be32(set + at + 4), step = 8u + ((length + 3u) & ~3u);
        if (be32(set + at) != id) { at += step; continue; }
        for (uint32_t i = at; i + step < n; ++i) set[i] = set[i + step];
        n -= step, --count;
    }
    if (!removes(candidate, candidate_bytes)) {
        uint32_t step = 8u + ((candidate_bytes + 3u) & ~3u);
        if (n + step > SET_BYTES) { modwerk_modset_result = TOO_BIG; candidate = 0; return; }
        put32(set + n, id), put32(set + n + 4, candidate_bytes);
        for (uint32_t i = 0; i < candidate_bytes; ++i) set[n + 8 + i] = candidate[i];
        for (uint32_t i = candidate_bytes; i < ((candidate_bytes + 3u) & ~3u); ++i) set[n + 8 + i] = 0;
        n += step, ++count;
    }
    seal(count, n);
    candidate = 0, pending = 1, retry_at = 0;
}

#ifdef MODWERK_HOST
static int load(unsigned which) { return modwerk_test_file(0, which ? "/MODWERK1.SET" : "/MODWERK0.SET", set, SET_BYTES); }
static int store(unsigned which) { return modwerk_test_file(1, which ? "/MODWERK1.SET" : "/MODWERK0.SET", set, used()); }
#else
/* One slot into `set`: its bytes, or 0 when it is absent or unreadable. */
static int load(unsigned which)
{
    struct file_object f;
    if (olog_stock_open(&f, which ? "/MODWERK1.SET" : "/MODWERK0.SET", "r", octamod_log_io, 512) < 0) return 0;
    int ok = olog_stock_read(&f, set, 512) == 1;
    uint32_t n = ok && be32(set) == 0x4d575354u ? be32(set + 16) : 0;
    ok = ok && n >= HEADER && n <= SET_BYTES;
    for (uint32_t at = 512; ok && at < n; at += 512) ok = olog_stock_read(&f, set + at, 512) == 1;
    (void)olog_stock_close(&f);
    return ok ? (int)n : 0;
}
/* The set into one slot, sector by sector while the gate holds, then read back whole. */
static int store(unsigned which)
{
    static uint8_t verify[512];
    const char *path = which ? "/MODWERK1.SET" : "/MODWERK0.SET";
    struct file_object f;
    uint32_t n = (used() + 511u) & ~511u;
    if (olog_stock_open(&f, path, "w", octamod_log_io, 512) < 0) return 0;
    int ok = 1;
    for (uint32_t at = 0; ok && at < n; at += 512) ok = GATE() && olog_stock_write(&f, set + at, 512) == 1;
    ok = olog_stock_close(&f) >= 0 && ok;
    if (!ok || olog_stock_open(&f, path, "r", octamod_log_io, 512) < 0) return 0;
    for (uint32_t at = 0; ok && at < n; at += 512) {
        ok = olog_stock_read(&f, verify, 512) == 1;
        for (unsigned i = 0; ok && i < 512u; ++i) ok = verify[i] == set[at + i];
    }
    return olog_stock_close(&f) >= 0 && ok;
}
#endif

/* A loaded slot that this base wrote whole: 1, else 0 (another base's set is FOREIGN). */
static int whole(int n)
{
    uint8_t digest[MU_DIGEST_BYTES];
    if (n < (int)HEADER || be32(set + 4) != 1u || be32(set + 16) != (uint32_t)n) return 0;
    for (unsigned i = 0; i < 32u; ++i) if (set[20 + i] != modwerk_base_digest[i]) { modwerk_modset_result = FOREIGN; return 0; }
    mu_sha256(set + HEADER, (uint32_t)n - HEADER, digest);
    for (unsigned i = 0; i < MU_DIGEST_BYTES; ++i) if (digest[i] != set[52 + i]) return 0;
    return 1;
}
/* After a boot: the newest whole set, each package installed as a USB install would be. */
static void restore(void)
{
    restored = 1;
    if (HELD_FUNC) { modwerk_modset_result = SKIPPED; SAY("MODULES SKIPPED"); return; }
    int a = load(0), wa = whole(a);
    uint32_t ga = wa ? be32(set + 8) : 0;
    int b = load(1), wb = whole(b);
    uint32_t gb = wb ? be32(set + 8) : 0;
    if (!wa && !wb) {
        if (modwerk_modset_result != FOREIGN) modwerk_modset_result = a || b ? DAMAGED : NONE_SAVED;
        for (unsigned i = 0; i < HEADER; ++i) set[i] = 0;
        return;
    }
    slot = wb && (!wa || gb > ga) ? 1u : 0u; /* the newer one; the next save goes to the other */
    if (!slot && (int)load(0) != a) { modwerk_modset_result = DAMAGED; return; }
    const struct mu_backend *b6 = &modwerk_runtime_backend;
    uint32_t n = used(), count = 0, installed = 0;
    if (!b6->enter(b6->user)) { modwerk_modset_result = REFUSED; return; }
    for (uint32_t at = HEADER; at < n; ++count) {
        uint32_t length = be32(set + at + 4);
        if (b6->prepare(b6->user, set + at + 8, length) && b6->publish(b6->user) == MU_APPLIED && b6->retire(b6->user)) ++installed;
        else (void)b6->discard(b6->user);
        at += 8u + ((length + 3u) & ~3u);
    }
    (void)b6->leave(b6->user);
    modwerk_modset_generation = be32(set + 8), modwerk_modset_count = installed;
    modwerk_modset_result = installed == count ? RESTORED : REFUSED;
    if (installed) SAY(installed == count ? "MODULES LOADED" : "SOME MODULES FAILED");
    else SAY("MODULES NOT LOADED");
}
/* Engine task, on every return to its receive: the restore once after boot, then any pending save. */
void modwerk_modset_service(void)
{
    if (!GATE()) return;
    if (!restored) { if (TICKS > 180u) restore(); return; } /* three seconds in: the project and the card are up */
    if (!pending || TICKS < retry_at) return;
    slot ^= 1u;
    if (store(slot)) pending = 0, modwerk_modset_result = SAVED;
    else slot ^= 1u, retry_at = TICKS + 600u, modwerk_modset_result = SAVE_FAILED; /* ten seconds, then again */
}
