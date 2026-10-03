/* Original Stang 2 phrase generator; no firmware, DSP or MIDI dependencies. */
#ifndef STANG_ENGINE_H
#define STANG_ENGINE_H
#include <stdint.h>
#include <stddef.h>
#define STANG_STEPS 64u
#define STANG_TRACK_BYTES 0x91au
#define STANG_LOCKS 0x59u
#define STANG_NO_LOCK 255u

typedef struct {
    uint8_t type, density, root, scale, gate, accent;
} StangParams;
typedef struct {
    uint8_t active, pitch, hold, volume;
} StangStep;
typedef struct {
    StangStep steps[STANG_STEPS];
    uint8_t length;
} StangPhrase;
/* Main SRC A-F; generation is explicit. GATE is the native AMP HOLD value. */
extern const StangParams stang_defaults;
extern const char *const stang_control_names[6];
extern const uint8_t stang_control_max[6];
extern const char *const stang_scale_names[5];
uint32_t stang_next_seed(uint32_t seed);
int stang_generate(StangPhrase *out, const StangParams *params,
                   unsigned length, unsigned base_volume, uint32_t seed);
/* Read/write a SINGLE native RAM TRAC record. No addressing of other tracks.
 * The caller must hold the editor's write boundary and mirror/publish it.
 * Slots 0/PTCH, 13/HOLD and 15/VOL are the only locks owned by generation.
 * Other locks and recorder/swing masks are preserved. */
int stang_track_empty(const uint8_t *record, size_t size);
int stang_write_phrase(uint8_t *record, size_t size,
                       const StangPhrase *phrase, int replace);
#endif
