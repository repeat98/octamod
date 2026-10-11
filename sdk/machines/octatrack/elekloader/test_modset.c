/* SPDX-License-Identifier: GPL-3.0-or-later
 * Host check of modset.c with a pretend card: accepted packages are saved to the two files in turn, a
 * removal drops its module, the newest whole set is installed after a boot, a damaged newer file leaves the
 * older one, and another base's set or a held FUNC installs nothing. */
#include "sha256.c"
#include "modset.c"
#include <stdio.h>
#include <string.h>

static unsigned failures;
#define CHECK(x) do { if (!(x)) { failures++; fprintf(stderr, "%s:%d: %s\n", __FILE__, __LINE__, #x); } } while (0)
const uint8_t modwerk_base_digest[32] = {1, 2, 3};
static uint8_t card[2][SET_BYTES];
static int card_bytes[2];
int modwerk_test_file(int op, const char *path, uint8_t *data, unsigned n)
{
    int which = path[8] == '1';
    if (op == 1) { memcpy(card[which], data, n); card_bytes[which] = (int)n; return 1; }
    if (!card_bytes[which]) return 0;
    memcpy(data, card[which], (size_t)card_bytes[which]);
    return card_bytes[which];
}
static unsigned prepared, installed, entered;
static uint32_t ids[8];
static int enter(void *u) { (void)u; ++entered; return 1; }
static int safe(void *u) { (void)u; return 1; }
static int leave(void *u) { (void)u; return 1; }
static int prepare(void *u, const uint8_t *d, uint32_t n) { (void)u; ids[prepared++ % 8] = be32(d + 28); return n > 32u; }
static int discard(void *u) { (void)u; return 1; }
static enum mu_publication publish(void *u) { (void)u; return MU_APPLIED; }
static int restore_backend(void *u) { (void)u; return 1; }
static int retire(void *u) { (void)u; ++installed; return 1; }
const struct mu_backend modwerk_runtime_backend = {0, enter, safe, leave, prepare, discard, publish, restore_backend, retire};

static uint8_t package[3][48];
static void make(unsigned k, uint32_t id, int removal)
{
    memset(package[k], 0, 48);
    memcpy(package[k], "MWRM", 4); package[k][5] = 4;
    put32(package[k] + 8, removal ? 0 : 4); put32(package[k] + 28, id);
}
static void accept(unsigned k, uint32_t n) { modwerk_modset_candidate(package[k], n); modwerk_modset_accepted(); }
static void boot(void) /* RAM gone, the card kept */
{
    memset(set, 0, sizeof set); restored = 0; pending = 0; slot = 0; prepared = installed = entered = 0;
    modwerk_modset_result = 0; modwerk_test_ticks = 200;
}

int main(void)
{
    make(0, 0x873d83ccu, 0); make(1, 0x3cbedc9cu, 0); make(2, 0x873d83ccu, 1);
    modwerk_test_ticks = 200; restored = 1; /* a running unit */
    accept(0, 48); accept(1, 40);
    CHECK(modwerk_modset_count == 2 && pending);
    modwerk_modset_service();
    CHECK(!pending && card_bytes[1] && !card_bytes[0] && modwerk_modset_result == SAVED);   /* slot 1 first */
    accept(0, 48);                                                                           /* a replacement */
    CHECK(modwerk_modset_count == 2);
    accept(2, 36);                                                                           /* E-Verb removed */
    CHECK(modwerk_modset_count == 1);
    modwerk_modset_service();
    CHECK(card_bytes[0] && be32(card[0] + 8) > be32(card[1] + 8));                          /* slot 0, newer */
    /* After a boot: the newest set, installed through the loader. */
    boot(); modwerk_modset_service();
    CHECK(modwerk_modset_result == RESTORED && installed == 1 && ids[0] == 0x3cbedc9cu && entered == 1);
    /* The newer file damaged: the older one, with both modules. */
    card[0][HEADER + 9] ^= 1; boot(); modwerk_modset_service();
    CHECK(modwerk_modset_result == RESTORED && installed == 2);
    /* Nothing installed: FUNC held, or a set another base wrote. */
    card[0][HEADER + 9] ^= 1; modwerk_test_held = 1; boot(); modwerk_modset_service();
    CHECK(modwerk_modset_result == SKIPPED && !installed);
    modwerk_test_held = 0; card[0][20] ^= 1; card[1][20] ^= 1; boot(); modwerk_modset_service();
    CHECK(modwerk_modset_result == FOREIGN && !installed);
    /* A closed gate waits: no restore, no save. */
    card[0][20] ^= 1; card[1][20] ^= 1; boot(); modwerk_test_gate = 0; modwerk_modset_service();
    CHECK(!restored && !installed);
    modwerk_test_gate = 1; modwerk_modset_service();
    CHECK(restored && installed == 1);
    if (failures) { fprintf(stderr, "%u module set checks failed\n", failures); return 1; }
    puts("Octatrack module set: saved in turn, removals dropped, the newest whole set restored, damaged and foreign sets and a held FUNC refused.");
    return 0;
}
