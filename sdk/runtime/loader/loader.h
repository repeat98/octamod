/* SPDX-License-Identifier: GPL-3.0-or-later
 * Machine-neutral runtime module loader: the upload controller's backend
 * (README.md). A machine adds the glue declared at the end and trampolines
 * from its hook bus that call the active module's hooks. */
#ifndef MODWERK_LOADER_H
#define MODWERK_LOADER_H
#include <stdint.h>
#include "upload.h"
#include "modwerk_module.h"
#define RUNTIME_HEADER_BYTES 68u        /* ABI 6 (DSP code, its name and layout); ABI 5 50, ABI 4 32, ABI 3 28 (module 0) */
#define RUNTIME_IMAGE_BYTES 32768u       /* one module's image and bss */
#define RUNTIME_RELOCATIONS 2048u
#define RUNTIME_SITES 64u
#define RUNTIME_SITE_BYTES 32u
#define RUNTIME_SITE_RELOCATIONS 8u
#define RUNTIME_DSP_WORDS 4096u          /* one module's DSP code and tables, 24-bit words */
#define RUNTIME_DSP_RELOCATIONS 256u
#define RUNTIME_POOL_BYTES 262144u       /* every module's memory, reclaimed once nothing can reach it */
#define RUNTIME_MODULES 32u              /* live at once: bounds the cost of each event, not memory */
#define RUNTIME_PAUSED 32u               /* memory spans the glue may report */
#define RUNTIME_NONE 0xffffffffu
/* Hook order in packages: the events every Elekloader core has. Later events
 * append; a base refuses a package with hooks it does not dispatch. */
enum runtime_event { RUNTIME_TICK, RUNTIME_DRAW, RUNTIME_KEY, RUNTIME_ENC, RUNTIME_EVENTS };
struct runtime_site { uint32_t address, length; uint8_t stock[RUNTIME_SITE_BYTES], code[RUNTIME_SITE_BYTES]; };
/* A module's DSP effect (README.md, "DSP code"): relocatable code the machine
 * loads into a DSP when a track picks the effect, and what it needs there. */
struct runtime_dsp {
    const uint32_t *words;         /* 24-bit words; relocation words hold offsets into them */
    const uint16_t *relocations;
    uint32_t count;                /* 0: no DSP code */
    uint16_t relocation_count, init, proc, cycles; /* cycles: worst case per sample and instance */
    uint16_t buffer;               /* Y words of the slot's delay buffer it reads from its base; 0 none */
    uint8_t id, slots, kind, state;  /* effect id; 1 FX1, 2 FX2; cycles' evidence; state words per instance */
    uint32_t module;                 /* the module's id: its identity. The package's effect id is only its
                                      * preferred one; the machine's admission gives the one it gets. */
    uint16_t layout;                 /* what its stored parameter values mean; a change that reads them
                                      * differently raises it (ABI 6; 0 from ABI 5) */
    char name[16];                   /* its display name, NUL-ended (ABI 6; empty from ABI 5) */
    const uint8_t *page;             /* the module image's head, when the package's flag 1 says it
                                      * starts with the effect's page recipe for the machine (ABI 6) */
    uint32_t page_bytes;             /* the image's length, all the recipe may reach */
};
enum runtime_cycles { RUNTIME_EXECUTED = 1, RUNTIME_MODELED, RUNTIME_HARDWARE };
/* At the start of the module's pool extent, followed by its sites, code, data, bss and DSP code. */
struct runtime_module { uint32_t id, size; uintptr_t hook[RUNTIME_EVENTS]; const struct runtime_site *site; uint32_t sites; struct runtime_dsp dsp; }; /* hook 0: none */
/* Why the last package was refused, for diagnostics and the unit's own message. */
enum runtime_refusal { RUNTIME_OK, RUNTIME_MALFORMED, RUNTIME_MEMORY, RUNTIME_CONFLICT, RUNTIME_FULL, RUNTIME_BUSY, RUNTIME_CYCLES };
#define RUNTIME_PACKAGE_BYTES (RUNTIME_HEADER_BYTES + 4u * RUNTIME_EVENTS + RUNTIME_IMAGE_BYTES + 4u * RUNTIME_RELOCATIONS + \
                               RUNTIME_SITES * (8u + 2u * RUNTIME_SITE_BYTES + 2u * RUNTIME_SITE_RELOCATIONS) + \
                               4u * RUNTIME_DSP_WORDS + 2u * RUNTIME_DSP_RELOCATIONS)

/* The controller's staging buffer is the machine's; it must hold RUNTIME_PACKAGE_BYTES. */
extern const struct mu_backend modwerk_runtime_backend;
extern struct modwerk_runtime_api modwerk_runtime_api;
/* A trampoline reads each position once, then calls its hook. Memory is
 * reclaimed only when no paused task holds an address inside it, so a hook
 * still running old code stays valid. */
const struct runtime_module *modwerk_runtime_module(unsigned position);
unsigned modwerk_runtime_active(void);               /* modules live */
uint32_t modwerk_runtime_free(uint32_t *largest);    /* pool bytes free, and the largest free run */
enum runtime_refusal modwerk_runtime_refusal(void);
extern volatile uint32_t modwerk_runtime_ticks; /* advanced by the glue's tick, for diagnostics */
uint32_t modwerk_runtime_value(void);
uint32_t modwerk_runtime_calls(void);

/* Machine glue. */
struct runtime_span { const uint8_t *from, *to; };
int modwerk_machine_stopped(void);                 /* nothing plays or records */
void *modwerk_machine_uncached(void *);            /* the alias module code and data run from */
void modwerk_machine_invalidate_code(void);        /* instruction and branch caches */
/* Stock code: whether [address, address + length) may be patched at all (RAM
 * only, never what the OS may write to flash), and an uncached view of it. */
int modwerk_machine_patchable(uint32_t address, uint32_t length);
uint8_t *modwerk_machine_code(uint32_t address);
void modwerk_machine_flush_data(uint32_t address, uint32_t length); /* push and invalidate data-cache lines */
uint32_t modwerk_machine_mask(void);               /* no other code runs until unmask */
void modwerk_machine_unmask(uint32_t);
/* With interrupts masked: the memory every other task would resume from or
 * return into (live stacks, saved registers). More than `max` means unknown. */
unsigned modwerk_machine_paused(struct runtime_span *, unsigned max);
/* DSP effects: may `to` take `from`'s place (either may be absent: count 0)?
 * A runtime_refusal; checked at admission and again, masked, at the switch,
 * which then calls dsp_switch. A machine without a DSP loader refuses any. */
int modwerk_machine_dsp_admit(const struct runtime_dsp *from, struct runtime_dsp *to); /* may set to->id */
void modwerk_machine_dsp_switch(const struct runtime_dsp *from, const struct runtime_dsp *to);
#endif
