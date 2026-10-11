/* SPDX-License-Identifier: GPL-3.0-or-later
 * Development bases only (build_core.py --dev): drive and watch the unit over
 * the vendor interface, so a bug can be reproduced without anyone at it.
 * Never in a base users install.
 *
 *   KEY    0xC1, bRequest 5, wValue = code | pressed << 8, wLength 1:
 *          the key as the panel reports it (boot.c); replies 1.
 *   STATE  0xC1, bRequest 6, wValue 0, wLength 2: {stopped, recording}.
 *   PANEL  0xC1, bRequest 8, wValue = first | second << 8, wLength 1: an
 *          encoder turn {0x30 | encoder 0..6, signed delta} or the fader
 *          {0x40, 0..255} as the panel sends it; replies 1.
 *   LOADER 0xC1, bRequest 9, wValue 0, wLength 60 (bases built with
 *          --dsp-loader): 15 big-endian words of the DSP loader's state.
 *   REPORT 0xC1, bRequest 11, wValue 0, wLength 4 x DSP_REPORT_WORDS (--dsp-loader):
 *          modwerk_dsp_report's big-endian words (dsp.c).
 *   PROBE  0xC1, bRequest 12, wValue = core 0/1, wLength 1 (--dsp-loader):
 *          modwerk_dsp_probe(core), one no-op packet; replies its result.
 *   METER  0xC1, bRequest 13, wValue = core 0/1, wLength 1 (--dsp-loader): read the
 *          load meter's last window back (REPORT shows it); replies 1 when started.
 *   MEM    0xC1, bRequest 15, wValue = an address's high half, wLength 1: kept for MEM;
 *          bRequest 16, wValue = its low half, wLength 1-511 but never a multiple of 64: that
 *          many bytes from there, for the host to decode the UI (device.mjs ui). Read-only, and
 *          only RAM the base knows is RAM: the OS image and base, stock's variables, the
 *          0x80000000 block and battery RAM. Anything else is not answered.
 *   SCREEN 0xC1, bRequest 7, wValue 0, wLength 1028: "MWLC" and the last
 *          composed 128x64 frame (ev_draw: 8 bytes a column, bit 7 = row 0).
 *
 * Replies are never a whole number of 64-byte packets (vendor.h). */
#include "boot.h"
#include "usb_base.h"
#include "loader.h"
#ifdef MODWERK_DSP_LOADER
#include "transfer.h"
#include "selection.h"
#include "runtime.h"
uint32_t modwerk_dsp_used(void);
int modwerk_dsp_probe(unsigned core);
int modwerk_dsp_meter_read(unsigned core);
extern volatile uint32_t modwerk_dsp_missing;
#endif

#define UNCACHED(p) ((uint8_t *)((uintptr_t)(p) + 0x08000000u))

static uint32_t mem_high;
static int ram(uint32_t at, uint32_t n)
{
    static const uint32_t spans[4][2] = {{0x40000400u, 0x40c50000u}, {0x46000000u, 0x47000000u},
                                         {0x80000000u, 0x80010000u}, {0x100f0000u, 0x10100000u}};
    for (unsigned i = 0; i < 4u; ++i) if (at >= spans[i][0] && at + n <= spans[i][1] && at + n > at) return 1;
    return 0;
}
/* One 4 KiB page: usb_ep0_send fills only the first page of its descriptor. */
static uint8_t screen[1028] __attribute__((aligned(2048)));

/* ev_draw, after the modules' own drawing (order 95). */
void modwerk_dev_draw(unsigned char *frame);
void modwerk_dev_draw(unsigned char *frame)
{
    uint8_t *s = UNCACHED(screen);
    for (unsigned i = 0; i < 1024; ++i) s[4 + i] = frame[i];
}

/* From ep0.c's unknown-request tail, for requests the transport stalls: a
 * reply length with *reply set, or 0 when the request is not one of these. */
uint32_t modwerk_dev_request(const uint8_t *s, const uint8_t **reply, uint8_t *out);
uint32_t modwerk_dev_request(const uint8_t *s, const uint8_t **reply, uint8_t *out)
{
    uint32_t want = s[6] | (uint32_t)s[7] << 8;
    if (s[0] != 0xc1 || s[4] != MODWERK_VENDOR_INTERFACE || s[5]) return 0;
    if (s[1] == 5 && want == 1 && s[2] < 64u && s[3] <= 1u) {
        modwerk_post_key(s[2], s[3]);
        out[0] = 1;
        *reply = out;
        return 1;
    }
    if (s[1] == 15 && want == 1) {
        mem_high = s[2] | (uint32_t)s[3] << 8;
        out[0] = 1;
        *reply = out;
        return 1;
    }
    if (s[1] == 16 && want && want < 512u && want % 64u) {
        uint32_t at = mem_high << 16 | s[2] | (uint32_t)s[3] << 8;
        if (!ram(at, want)) return 0;
        for (uint32_t i = 0; i < want; ++i) out[i] = ((const volatile uint8_t *)(uintptr_t)at)[i];
        *reply = out;
        return want;
    }
    if (s[1] == 6 && want == 2 && !s[2] && !s[3]) {
        out[0] = (uint8_t)modwerk_machine_stopped();
        out[1] = (uint8_t)modwerk_boot_recording();
        *reply = out;
        return 2;
    }
    if (s[1] == 8 && want == 1 && ((s[2] >= 0x30u && s[2] <= 0x36u && s[3]) || s[2] == 0x40u)) {
        modwerk_panel_bytes(s[2], s[3]);
        out[0] = 1;
        *reply = out;
        return 1;
    }
#ifdef MODWERK_DSP_LOADER
    /* LOADER: frames, accepted/rejected per core, errors, requests, the cores' job
     * status (0 pending, 1 complete, -1 failure, -2 idle), pools, refusals, missing. */
    if (s[1] == 9 && want == 60 && !s[2] && !s[3]) {
        uint32_t w[15] = {dl_frames, dl_accepted[0], dl_accepted[1], dl_rejected[0], dl_rejected[1], dl_errors,
                          dl_request_probe, dl_request_stage, (uint32_t)dl_job_status(0), (uint32_t)dl_job_status(1),
                          dl_pool_words[0], dl_pool_words[1], dl_selection_refused, modwerk_dsp_missing, modwerk_dsp_used()};
        for (unsigned i = 0; i < 60; ++i) out[i] = (uint8_t)(w[i / 4] >> (24 - 8 * (i % 4)));
        *reply = out;
        return 60;
    }
    if (s[1] == 12 && want == 1 && s[2] <= 1u && !s[3]) {
        out[0] = (uint8_t)modwerk_dsp_probe(s[2]);
        *reply = out;
        return 1;
    }
    if (s[1] == 13 && want == 1 && s[2] <= 1u && !s[3]) {
        out[0] = (uint8_t)modwerk_dsp_meter_read(s[2]);
        *reply = out;
        return 1;
    }
    if (s[1] == 11 && want == 4u * DSP_REPORT_WORDS && !s[2] && !s[3]) {
        uint32_t w[DSP_REPORT_WORDS];
        modwerk_dsp_report(w);
        for (unsigned i = 0; i < 4u * DSP_REPORT_WORDS; ++i) out[i] = (uint8_t)(w[i / 4] >> (24 - 8 * (i % 4)));
        *reply = out;
        return 4u * DSP_REPORT_WORDS;
    }
#endif
    if (s[1] == 7 && want == sizeof screen && !s[2] && !s[3]) {
        uint8_t *u = UNCACHED(screen);
        u[0] = 'M'; u[1] = 'W'; u[2] = 'L'; u[3] = 'C';
        *reply = u;
        return sizeof screen;
    }
    return 0;
}
