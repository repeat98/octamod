/* Copyright (c) 2026 Octamod contributors. MIT. Original implementation.
 * Musical inspiration: Iftah's Sting 2. No Sting source/assets are used. */
#include "engine.h"
const StangParams stang_defaults = {11, 11, 0, 1, 32, 48};
const char *const stang_control_names[6] = {"TYPE", "DENS", "ROOT", "SCALE", "GATE", "ACCNT"};
const uint8_t stang_control_max[6] = {15, 16, 11, 4, 126, 127};
const char *const stang_scale_names[5] = {"CHR", "MIN", "MAJ", "DOR", "PENT"};
static const uint16_t scales[5] = {0x0fff, 0x05ad, 0x0ab5, 0x06ad, 0x04a9};
static unsigned limit(unsigned value, unsigned max) { return value > max ? max : value; }
static uint32_t mix(uint32_t x) {
    x ^= x >> 16; x *= 0x7feb352du; x ^= x >> 15;
    x *= 0x846ca68bu; return x ^ (x >> 16);
}
uint32_t stang_next_seed(uint32_t seed) { return (seed + 1u) & 0x00ffffffu; }
static int semitone(unsigned degree, unsigned root, unsigned scale) {
    unsigned allowed[25], n = 0;
    for (int pitch = -12; pitch <= 12; ++pitch) {
        unsigned pc = (unsigned)(pitch + 24 - (int)root) % 12;
        if ((scales[scale] >> pc) & 1u) allowed[n++] = (unsigned)(pitch + 12);
    }
    return (int)allowed[degree % n] - 12;
}
int stang_generate(StangPhrase *out, const StangParams *params,
                   unsigned length, unsigned base_volume, uint32_t seed) {
    if (!out || !params || !length || length > STANG_STEPS || base_volume > 127) return 0;
    const unsigned type = limit(params->type, 15), density = limit(params->density, 16);
    const unsigned root = limit(params->root, 11), scale = limit(params->scale, 4);
    const unsigned gate = limit(params->gate, 126), accent = limit(params->accent, 127);
    unsigned order[STANG_STEPS]; uint32_t ranks[STANG_STEPS];
    out->length = (uint8_t)length;
    for (unsigned i = 0; i < STANG_STEPS; ++i) {
        out->steps[i].active = 0;
        out->steps[i].pitch = out->steps[i].hold = out->steps[i].volume = STANG_NO_LOCK;
    }
    /* Rank once per request. Keeping the random rank independent of density
     * means increasing DENS adds notes without moving the ones already there.
     * Insertion sort has a hard upper bound of 2016 comparisons at length 64. */
    for (unsigned i = 0; i < length; ++i) {
        uint32_t r = mix(seed ^ (0x9e3779b9u * (i + 1u)));
        ranks[i] = (r & 0xffffu) + ((i % 4u) ? type * 2048u : 0u);
        unsigned j = i;
        while (j && ranks[order[j - 1]] > ranks[i]) { order[j] = order[j - 1]; --j; }
        order[j] = i;
    }
    unsigned count = (length * density + 8u) / 16u;
    for (unsigned i = 0; i < count; ++i) out->steps[order[i]].active = 1;
    for (unsigned i = 0; i < length; ++i) {
        StangStep *s = &out->steps[i];
        if (!s->active) continue;
        uint32_t r = mix(seed ^ (0x85ebca6bu * (i + 1u)) ^ 0xb5297a4du);
        int pitch = semitone(r >> 8, root, scale);
        /* High TYPE prefers tonic and fifth; constrain the fifth to the scale
         * too (chromatic/root transposition must never break scale membership). */
        if ((r & 15u) < type) {
            unsigned pc = ((r >> 4) & 3u) ? root : (root + 7u) % 12u;
            if (!((scales[scale] >> ((pc + 12u - root) % 12u)) & 1u)) pc = root;
            pitch = (int)pc;
            if ((r >> 6) & 1u) pitch -= 12;
        }
        s->pitch = (uint8_t)(64 + 5 * pitch);
        s->hold = (uint8_t)(gate * (2u + ((r >> 24) % 3u)) / 4u);
        unsigned strong = i % 4u == 0u || ((r >> 20) & 3u) == 0u;
        s->volume = (uint8_t)(strong ? base_volume : base_volume * (254u - accent) / 254u);
    }
    return 1;
}
static unsigned bit(const uint8_t *r, unsigned mask, unsigned step) {
    return (r[mask * 8u + 7u - step / 8u] >> (step % 8u)) & 1u;
}
static void setbit(uint8_t *r, unsigned mask, unsigned step, unsigned value) {
    uint8_t *byte = r + mask * 8u + 7u - step / 8u;
    uint8_t b = (uint8_t)(1u << (step % 8u));
    *byte = value ? (uint8_t)(*byte | b) : (uint8_t)(*byte & (uint8_t)~b);
}
int stang_track_empty(const uint8_t *r, size_t size) {
    if (!r || size < STANG_TRACK_BYTES) return 0;
    /* Recorder trigs, trigless edits and slide marks also prevent auto-fill.
     * Swing is a stock default, so mask 8 is deliberately excluded. */
    for (unsigned i = 0; i < 64; ++i) if (r[i]) return 0;
    for (unsigned i = 72; i < 80; ++i) if (r[i]) return 0;
    for (unsigned i = 0; i < STANG_STEPS * 32u; ++i)
        if (r[STANG_LOCKS + i] != STANG_NO_LOCK) return 0;
    return 1;
}
int stang_write_phrase(uint8_t *r, size_t size, const StangPhrase *phrase, int replace) {
    if (!r || size < STANG_TRACK_BYTES || !phrase || !phrase->length || phrase->length > 64) return 0;
    if (!replace && !stang_track_empty(r, size)) return 0;
    /* Validate the entire input before the first store. */
    for (unsigned i = 0; i < STANG_STEPS; ++i) {
        const StangStep *s = &phrase->steps[i];
        if (s->active > 1 || (i >= phrase->length && s->active)) return 0;
        if (s->active && (s->pitch < 4 || s->pitch > 124 || (s->pitch - 4) % 5 || s->hold > 126 || s->volume > 127)) return 0;
    }
    for (unsigned i = 0; i < STANG_STEPS; ++i) {
        uint8_t *locks = r + STANG_LOCKS + 32u * i;
        const StangStep *s = &phrase->steps[i];
        unsigned old = bit(r, 0, i);
        locks[0] = s->active ? s->pitch : STANG_NO_LOCK;
        locks[13] = s->active ? s->hold : STANG_NO_LOCK;
        locks[15] = s->active ? s->volume : STANG_NO_LOCK;
        setbit(r, 0, i, s->active);
        /* Old/new note timing and conditions should not silently suppress the
         * new phrase. Preserve recorder masks, swing, and unrelated locks. */
        if (old || s->active) {
            r[0x89au + 2u * i] = r[0x89bu + 2u * i] = 0;
            setbit(r, 1, i, 0); setbit(r, 3, i, 0); setbit(r, 9, i, 0);
        }
        unsigned has_lock = 0;
        for (unsigned k = 0; k < 32; ++k) has_lock |= locks[k] != STANG_NO_LOCK;
        setbit(r, 2, i, !s->active && has_lock);
    }
    return 1;
}
