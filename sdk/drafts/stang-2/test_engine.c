/* Firmware-free behavioral tests. Run only in the isolated native workspace. */
#include "engine.h"
#include <assert.h>
#include <stdio.h>
#include <string.h>

static void blank(uint8_t *r) {
    memset(r,0,STANG_TRACK_BYTES);
    memset(r+STANG_LOCKS,255,64*32);
    memset(r+0x40,0xaa,8); r[0x50]=16; r[0x51]=2; r[0x52]=20;
}
static int on(const uint8_t *r,unsigned i,unsigned m) {
    return (r[m*8+7-i/8]>>(i%8))&1;
}
static void deterministic_and_scale(void) {
    const unsigned allowed[]={0xfff,0x5ad,0xab5,0x6ad,0x4a9};
    StangPhrase a,b;
    unsigned cases=0;
    for(unsigned seed=0;seed<24;++seed) for(unsigned scale=0;scale<5;++scale)
    for(unsigned root=0;root<12;++root) for(unsigned length=1;length<=64;length+=7) {
        StangParams p=stang_defaults; p.root=root;p.scale=scale;p.type=seed%16;
        unsigned previous=0; StangPhrase before={0};
        for(unsigned density=0;density<=16;++density) {
            p.density=density;
            assert(stang_generate(&a,&p,length,100,seed));
            assert(stang_generate(&b,&p,length,100,seed));
            assert(!memcmp(&a,&b,sizeof a));
            unsigned count=0;
            for(unsigned i=0;i<64;++i) {
                assert(a.steps[i].active>=before.steps[i].active);
                if(a.steps[i].active) {
                    ++count;assert(i<length);
                    int pitch=((int)a.steps[i].pitch-64)/5;
                    assert(pitch>=-12 && pitch<=12);
                    unsigned pc=(unsigned)(pitch+24-(int)root)%12;
                    assert(allowed[scale]&(1u<<pc));
                    assert(a.steps[i].hold<=p.gate && a.steps[i].volume<=100);
                }
            }
            assert(count>=previous);
            assert(count==(length*density+8)/16);
            if(density==16) assert(count==length);
            previous=count;before=a;++cases;
        }
    }
    printf("PASS %u deterministic/scale/density cases, including 1..64-step boundaries\n",cases);
}
static void writer(void) {
    uint8_t guarded[STANG_TRACK_BYTES+32],before[STANG_TRACK_BYTES];
    memset(guarded,0x5a,sizeof guarded);uint8_t *r=guarded+16;blank(r);
    StangPhrase p;assert(stang_generate(&p,&stang_defaults,64,100,0));
    assert(stang_track_empty(r,STANG_TRACK_BYTES));
    assert(stang_write_phrase(r,STANG_TRACK_BYTES,&p,0));
    memcpy(before,r,sizeof before);
    assert(!stang_write_phrase(r,STANG_TRACK_BYTES,&p,0));assert(!memcmp(before,r,sizeof before));
    for(unsigned i=0;i<16;++i) assert(guarded[i]==0x5a && guarded[sizeof guarded-1-i]==0x5a);
    for(unsigned i=0;i<64;++i) {
        assert(on(r,i,0)==p.steps[i].active);
        if(on(r,i,0)) assert(r[STANG_LOCKS+32*i]==p.steps[i].pitch);
    }
    blank(r);r[STANG_LOCKS+18]=79; /* existing FX lock refuses first-play auto fill */
    assert(!stang_track_empty(r,STANG_TRACK_BYTES));
    assert(!stang_write_phrase(r,STANG_TRACK_BYTES,&p,0));
    for(unsigned mask=1;mask<10;++mask) {
        if(mask==8) continue; /* swing alone is allowed on an empty track */
        blank(r);r[mask*8+7]=1;
        memcpy(before,r,sizeof before);
        assert(!stang_track_empty(r,STANG_TRACK_BYTES));
        assert(!stang_write_phrase(r,STANG_TRACK_BYTES,&p,0));
        assert(!memcmp(before,r,sizeof before));
    }
    blank(r);
    /* Every step carries unrelated locks; recorder masks and swing must survive. */
    for(unsigned i=0;i<64;++i) {
        r[STANG_LOCKS+32*i+18]=(uint8_t)(i%128);
        r[STANG_LOCKS+32*i+6]=87;
        r[STANG_LOCKS+32*i+31]=3;
    }
    for(unsigned i=32;i<72;++i) r[i]=(uint8_t)(i*3+1);
    memcpy(before,r,sizeof before);
    StangParams params=stang_defaults;params.density=0;
    assert(stang_generate(&p,&params,16,100,9));
    assert(stang_write_phrase(r,STANG_TRACK_BYTES,&p,1));
    assert(!memcmp(r+32,before+32,40)); /* recorders + swing mask */
    assert(r[0x50]==16 && r[0x51]==2 && r[0x52]==20); /* track timing */
    for(unsigned i=0;i<64;++i) {
        assert(!on(r,i,0) && on(r,i,2));
        assert(r[STANG_LOCKS+32*i+18]==i && r[STANG_LOCKS+32*i+6]==87 && r[STANG_LOCKS+32*i+31]==3);
    }
    memcpy(before,r,sizeof before);p.steps[63].active=1;
    assert(!stang_write_phrase(r,STANG_TRACK_BYTES,&p,1));assert(!memcmp(before,r,sizeof before));
    assert(!stang_write_phrase(r,STANG_TRACK_BYTES-1,&p,1));
    assert(!stang_generate(&p,&params,0,100,0));assert(!stang_generate(&p,&params,65,100,0));
    assert(!stang_generate(&p,&params,16,128,0));
    assert(stang_next_seed(0xffffff)==0);
    puts("PASS native-record writer: visible trigs, repeat/edit protection, exact swing/recorder/other-lock preservation, bounds and fail-before-write");
}
int main(void) {deterministic_and_scale();writer();return 0;}
