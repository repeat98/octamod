/* SPDX-License-Identifier: GPL-3.0-or-later
 * The Octatrack's glue for the machine-neutral runtime loader
 * (sdk/runtime/loader), and trampolines from core-ot's hook bus to the
 * live modules' hooks. Development only.
 *
 * Module code and data run from the uncached alias, so no stale or dirty
 * data-cache line reaches them; instruction fetches there are still cached
 * (stock sets no instruction ACR and IDCM is cacheable), so the loader
 * invalidates the instruction and branch caches after writing code.
 *
 * Patches to stock code: only the RAM copy of the stock OS image below the
 * copy of the bootloader inside it that the OS can write to flash. Past that
 * copy come the DSP payloads, whose RAM holds the current bank once the
 * project loads (the bank pointer reads 0x400e21e0 in the emulator). With
 * interrupts masked, the loader checks every other task's live stack and
 * saved registers (the kernel's tasks, Octabam docs/firmware/KERNEL.md) for
 * an address inside a site before it writes. */
#include "runtime.h"

#define STOCK_FROM 0x40000400u      /* the OS image in RAM */
#define BOOTLOADER_FROM 0x400de1e0u /* what the OS re-flashes the bootloader from; bank data follows it */

#ifdef MODWERK_HOST
int modwerk_test_stopped = 1;
int modwerk_machine_stopped(void) { return modwerk_test_stopped; }
void *modwerk_machine_uncached(void *p) { return p; }
void modwerk_machine_invalidate_code(void) {}
uint8_t *modwerk_machine_code(uint32_t address) { (void)address; return 0; }
void modwerk_machine_flush_data(uint32_t address, uint32_t length) { (void)address; (void)length; }
uint32_t modwerk_machine_mask(void) { return 0; }
void modwerk_machine_unmask(uint32_t sr) { (void)sr; }
unsigned modwerk_machine_paused(struct runtime_span *span, unsigned max) { (void)span; return max + 1u; }
#else
#define U8(a) (*(volatile uint8_t *)(a))
#define U32(a) (*(volatile uint32_t *)(a))
/* The logger's flush check (sdk/runtime/logging/stock_140c.c), minus its
 * card and engine-task conditions: no track running, no recorder active. */
int modwerk_machine_stopped(void)
{
    for (unsigned i = 0; i < 16; ++i) if (U8(0x80006500u + i) || U8(0x80004f1eu + i * 84u)) return 0;
    return U32(0x800065b8u) == 0;
}
void *modwerk_machine_uncached(void *p) { return (void *)((uintptr_t)p + 0x08000000u); }
/* Every stock CACR write uses 0xa40ce000 (boot write guarded by usb_base.py),
 * which already sets BCINVA; bit 8 adds ICINVA. The data cache is untouched. */
void modwerk_machine_invalidate_code(void) { __asm__ __volatile__("movec %0,%%cacr\n\tnop" :: "d"(0xa40ce100u) : "memory"); }
uint8_t *modwerk_machine_code(uint32_t address) { return (uint8_t *)(uintptr_t)(address + 0x08000000u); }
/* CPUSHL pushes a dirty 16-byte line and, with CACR's DPI clear as stock
 * leaves it, invalidates it, so no cached copy overwrites the patch later. */
void modwerk_machine_flush_data(uint32_t address, uint32_t length)
{
    for (uint32_t line = address & ~15u; line < address + length; line += 16u)
        __asm__ __volatile__("cpushl %%dc,(%0)" :: "a"(line) : "memory");
}
uint32_t modwerk_machine_mask(void)
{
    uint32_t sr;
    __asm__ __volatile__("move.w %%sr,%0\n\tmove.w #0x2700,%%sr" : "=d"(sr) :: "memory");
    return sr;
}
void modwerk_machine_unmask(uint32_t sr) { __asm__ __volatile__("move.w %0,%%sr" :: "d"(sr) : "memory"); }

/* TCB, lowest stack address, stack size (KERNEL.md). Main's stack is the boot
 * stack below 0x46c7becc; only the space above its TCB is assumed. */
static const struct { uint32_t tcb, stack, size; } tasks[] = {
    {0x46c7fb0cu, 0x46c7ea20u, 0x1000u}, {0x460bcc2cu, 0x460bc42cu, 0x800u}, {0x460d4f80u, 0x460d4780u, 0x800u},
    {0x460d59d4u, 0x460d51d4u, 0x800u}, {0x460fab80u, 0x460fabd4u, 0x2000u}, {0x460ffd44u, 0x460fdd44u, 0x2000u},
    {0x460e0e38u, 0x460dee38u, 0x2000u}, {0x460ddde4u, 0x460d9de4u, 0x4000u}, {0x46105508u, 0x4610555cu, 0x2000u},
    {0x46c7bed8u, 0x460d6de4u, 0x2000u}, {0x46c7ae84u, 0x46c7aed8u, 0xff4u},
};
#define TASKS (sizeof tasks / sizeof tasks[0])
#define CURRENT_TCB 0x800068fcu
#define READY_LISTS 0x800068dcu /* eight heads; higher index, higher priority */
static int known(uint32_t tcb)
{
    for (unsigned i = 0; i < TASKS; ++i) if (tasks[i].tcb == tcb) return 1;
    return 0;
}
/* A ready task outside the measured table would go unchecked: refuse instead. */
static int ready_tasks_known(void)
{
    for (unsigned prio = 0; prio < 8; ++prio) {
        uint32_t head = U32(READY_LISTS + 4u * prio), t = head;
        for (unsigned n = 0; t; ++n) {
            if (n > TASKS || !known(t)) return 0;
            t = U32(t);
            if (t == head) break;
        }
    }
    return 1;
}
unsigned modwerk_machine_paused(struct runtime_span *span, unsigned max)
{
    uint32_t current = U32(CURRENT_TCB), sp;
    unsigned n = 0;
    __asm__ __volatile__("move.l %%sp,%0" : "=a"(sp));
    if (!known(current) || !ready_tasks_known() || max < 2u * TASKS) return max + 1u;
    for (unsigned i = 0; i < TASKS; ++i) {
        uint32_t top = tasks[i].stack + tasks[i].size, saved = tasks[i].tcb == current ? sp : U32(tasks[i].tcb + 0x48u);
        if (saved < tasks[i].stack || saved > top) return max + 1u;
        span[n++] = (struct runtime_span){(const uint8_t *)(uintptr_t)saved, (const uint8_t *)(uintptr_t)top};
        if (tasks[i].tcb != current) /* saved d0-d7/a0-a7 */
            span[n++] = (struct runtime_span){(const uint8_t *)(uintptr_t)(tasks[i].tcb + 0x0cu), (const uint8_t *)(uintptr_t)(tasks[i].tcb + 0x4cu)};
    }
    return n;
}
#endif

#ifndef MODWERK_DSP_LOADER
/* This base has no DSP loader (dsp.c, build_core.py --dsp-loader): no module brings DSP code. */
int modwerk_machine_dsp_admit(const struct runtime_dsp *from, struct runtime_dsp *to) { (void)from; return to->count ? RUNTIME_MALFORMED : RUNTIME_OK; }
void modwerk_machine_dsp_switch(const struct runtime_dsp *from, const struct runtime_dsp *to) { (void)from; (void)to; }
#endif

int modwerk_machine_patchable(uint32_t address, uint32_t length)
{
    return address >= STOCK_FROM && address < BOOTLOADER_FROM && length <= BOOTLOADER_FROM - address;
}

/* Hooks run in the sys task (core-ot's ev_tick, ev_key, ev_enc and nearly
 * always ev_draw), in position order: the first key or encoder hook that
 * returns nonzero takes the event. The tick also counts, for diagnostics. */
/* Reads the position once: memory a hook still runs in is not reclaimed while
 * this task holds an address inside it. */
static uintptr_t hook(unsigned position, enum runtime_event e)
{
    const struct runtime_module *m = modwerk_runtime_module(position);
    return m ? m->hook[e] : 0;
}
void modwerk_runtime_tick(void)
{
    for (unsigned i = 0; i < RUNTIME_MODULES; ++i) {
        uintptr_t f = hook(i, RUNTIME_TICK);
        if (f) ((void (*)(struct modwerk_runtime_api *))f)(&modwerk_runtime_api);
    }
    modwerk_runtime_ticks = modwerk_runtime_ticks + 1;
}
void modwerk_runtime_draw(unsigned char *frame)
{
    for (unsigned i = 0; i < RUNTIME_MODULES; ++i) {
        uintptr_t f = hook(i, RUNTIME_DRAW);
        if (f) ((void (*)(unsigned char *))f)(frame);
    }
}
int modwerk_runtime_key(int code, int pressed)
{
    for (unsigned i = 0; i < RUNTIME_MODULES; ++i) {
        uintptr_t f = hook(i, RUNTIME_KEY);
        if (f && ((int (*)(int, int))f)(code, pressed)) return 1;
    }
    return 0;
}
int modwerk_runtime_enc(int encoder, int delta)
{
    for (unsigned i = 0; i < RUNTIME_MODULES; ++i) {
        uintptr_t f = hook(i, RUNTIME_ENC);
        if (f && ((int (*)(int, int))f)(encoder, delta)) return 1;
    }
    return 0;
}
