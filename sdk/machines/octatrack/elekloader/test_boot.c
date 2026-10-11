/* SPDX-License-Identifier: GPL-3.0-or-later
 * Host check of the RAM boot's backend (cc -DMODWERK_HOST): what it accepts,
 * the mailbox it arms, the delayed reset and the disarm. boot.s (the gate,
 * the park, the reset) is checked in the emulator and on the unit.
 * Built with loader.c and runtime.c as separate units, as in the base. */
#include "boot.c"
#include <stdio.h>
#include <string.h>

static unsigned failures;
#define CHECK(x) do { if (!(x)) { failures++; fprintf(stderr, "%s:%d: %s\n", __FILE__, __LINE__, #x); } } while (0)
static const struct mu_backend *b = &modwerk_boot_backend;

static uint32_t image(uint32_t n, uint32_t version)
{
    uint8_t *p = modwerk_boot_staging();
    for (uint32_t i = 0; i < n; ++i) p[i] = (uint8_t)(i * 7u);
    p[0] = 0x4f; p[1] = 0xef; p[2] = 0xff; p[3] = 0xe4;
    p[OS_VEROFF] = (uint8_t)(version >> 8); p[OS_VEROFF + 1] = (uint8_t)version;
    return n;
}

void modwerk_modset_candidate(const uint8_t *package, uint32_t bytes) { (void)package; (void)bytes; }
void modwerk_modset_accepted(void) {}
int main(void)
{
    uint8_t *stage_image = modwerk_boot_staging();
    volatile uint32_t *mb = modwerk_boot_stage.mailbox;
    const uint32_t n = OS_VEROFF + 2u + 101u;
    /* Refused: another buffer, NOR's version differs (the image would reflash the bootstrap), bounds. */
    static uint8_t elsewhere[OS_VEROFF + 103u];
    memcpy(elsewhere, stage_image, image(n, 0x0408u));
    CHECK(!b->prepare(0, elsewhere, n));
    CHECK(!b->prepare(0, stage_image, image(n, 0x0409u)));
    CHECK(!b->prepare(0, stage_image, image(OS_VEROFF + 1u, 0x0408u)));
    CHECK(!b->prepare(0, stage_image, BOOT_IMAGE_BYTES + 1u));
    /* Not an OS entry: a module package, for the runtime loader (an empty one removes). */
    memcpy(stage_image, "MWRM\0\3\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0", 28);
    modwerk_runtime_ticks = 2;
    CHECK(b->prepare(0, stage_image, 28) && b->publish(0) == MU_APPLIED && mb[0] == 0 && !modwerk_runtime_active());
    /* Accepted and armed: MAGIC last, the x33 hash of the exact image, the check word. */
    CHECK(b->prepare(0, stage_image, image(n, 0x0408u)));
    CHECK(mb[0] == 0);
    CHECK(b->publish(0) == MU_APPLIED);
    uint32_t hash = 0;
    for (uint32_t i = 0; i < n; ++i) hash = hash * 33u + stage_image[i];
    CHECK(mb[0] == BOOT_MAGIC && mb[1] == n && mb[2] == hash && mb[3] == (BOOT_MAGIC ^ n ^ hash));
    /* The reset waits half a second for the host to read the acknowledgement. */
    for (unsigned i = 1; i < BOOT_DELAY_TICKS; ++i) CHECK(!modwerk_boot_tick());
    modwerk_boot_service(); CHECK(modwerk_test_resets == 0);
    CHECK(modwerk_boot_tick());
    modwerk_boot_service(); CHECK(modwerk_test_resets == 1);
    /* A rollback (host or disconnect) before it fires disarms it. */
    CHECK(b->prepare(0, stage_image, image(n, 0x0408u)) && b->publish(0) == MU_APPLIED && mb[0] == BOOT_MAGIC);
    CHECK(b->restore(0) && mb[0] == 0);
    for (unsigned i = 0; i < BOOT_DELAY_TICKS + 2u; ++i) CHECK(!modwerk_boot_tick());
    modwerk_boot_service(); CHECK(modwerk_test_resets == 1);
    /* Auto-stop: playing presses STOP once a second at most, never while
     * recording; enter itself still refuses until the unit has stopped. */
    extern int modwerk_test_stopped;
    modwerk_test_stopped = 0; modwerk_runtime_ticks = 1000;
    CHECK(b->enter(0) == 0 && modwerk_test_stops == 1);
    modwerk_runtime_ticks += 59; CHECK(b->enter(0) == 0 && modwerk_test_stops == 1);
    modwerk_runtime_ticks += 1; CHECK(b->enter(0) == 0 && modwerk_test_stops == 2);
    modwerk_test_recording = 1; modwerk_runtime_ticks += 120; CHECK(b->enter(0) == 0 && modwerk_test_stops == 2);
    modwerk_test_recording = 0; mu_disconnecting = 1; modwerk_runtime_ticks += 120; CHECK(b->enter(0) == 0 && modwerk_test_stops == 2);
    mu_disconnecting = 0; modwerk_test_stopped = 1; CHECK(b->enter(0) == 1 && modwerk_test_stops == 2);
    CHECK(b->leave(0) == 1);
    if (failures) { fprintf(stderr, "%u boot checks failed\n", failures); return 1; }
    puts("RAM boot backend: refusals, module pass-through, mailbox, delayed reset, disarm and auto-stop passed.");
    return 0;
}
