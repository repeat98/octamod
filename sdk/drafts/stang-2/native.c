/* Stang 2 native editor adapter for locally verified Octatrack OS 1.40C.
 * The sample engine, SRC/AMP/FX values and sequencer remain stock.
 * ABI references: octabam PARAM_PAGES, PANEL, MAINMENU; octalab TRIGS.
 * UI layer/window idioms follow Sam Banks' MIT octabam editor tooling.
 * Pending native/hardware qualification: see TESTING.md. */
#include "engine.h"
#define U8(a) (*(volatile uint8_t *)(uintptr_t)(a))
#define U32(a) (*(volatile uint32_t *)(uintptr_t)(a))
#define BANK_PTR 0x46c82456u
#define PART_IDX 0x100b14cfu
#define TRACK_IDX 0x100b14ccu
#define PATTERN_IDX 0x100b14d0u
#define PART_OFF 0x8ed80u
#define PART_STRIDE 0x18b2u
#define PATTERN_STRIDE 0x8ed8u
#define SRAM_PART 0x100a4eceu
#define SRAM_PATTERNS 0x1001614eu
#define TRANSPORT 0x800065b8u
#define KEY_CACHE 0x46c7d8deu
#define LAYERS 0x460d165cu
#define PAGE_KIND 0x46c7d8d8u
#define SCREEN_DIRTY 0x46c7c72cu
#define SIGNATURE 0x3cu
#define SETTINGS2 0x1ecu
extern uint32_t st_layer[], st_edit_layer[];
extern void st_stock_pool_open(void);
static uint32_t window = 0, active = 0, shown_bank = 0, shown_part = 0, shown_track = 0;
static uint32_t edit_view = 0, layer_gen = 0, pending = 0, pending_pattern = 0;
static uint32_t saved[3][3] = {{0}};
static uint32_t mine = 0;
static uint8_t staging[STANG_TRACK_BYTES] = {0};
static StangPhrase phrase = {{{0}}, 0};
static const char *status = "YES:GEN  LEVEL:EDIT";
static unsigned key_held(unsigned key) { return (U8(0x46100b18u + (key >> 3)) >> (key & 7u)) & 1u; }
static int valid_bank(void) { uint32_t b=U32(BANK_PTR); return b>=0x40000000u && b<0x47f00000u; }
static volatile uint8_t *current_part(void) {
    return (volatile uint8_t *)(uintptr_t)(U32(BANK_PTR)+PART_OFF+(U8(PART_IDX)&3u)*PART_STRIDE);
}
static int signed_track(const volatile uint8_t *p, unsigned t) {
    if(t>=8 || p[0x22u+t]>1) return 0;
    const volatile uint8_t *s=p+SIGNATURE+30u*t;
    return s[0]=='S' && s[1]=='2' && s[2]==1;
}
unsigned st_selected(void) {
    return valid_bank() && !U8(0x80000015u) && signed_track(current_part(),U8(TRACK_IDX));
}
static unsigned any_stang(void) {
    if(!valid_bank()) return 0;
    for(unsigned t=0;t<8;++t) if(signed_track(current_part(),t)) return 1;
    return 0;
}
unsigned st_type(unsigned type, const volatile uint8_t *ptr) {
    if(!valid_bank()) return type;
    volatile uint8_t *p=current_part();
    uintptr_t t=(uintptr_t)ptr-(uintptr_t)(p+0x22);
    return t<8 && type<2 && signed_track(p,(unsigned)t) ? 5 : type;
}
static void dirty_part(unsigned part) {
    U8(U32(BANK_PTR)+0x95048u)|=(uint8_t)(1u<<part);
    U8(0x100b145eu)|=(uint8_t)(1u<<part);
    U32(U32(BANK_PTR)+0x9b332u)=1; U32(0x100f8598u)=1;
    ((void (*)(void))0x40027e00u)();
}
/* Only the unused NEIGHBOR slots hold Stang settings. Stock Flex/Static
 * playback values and the chosen sample stay intact, including in EDIT. */
unsigned st_assign(volatile uint8_t *part, unsigned t, unsigned enabled) {
    if(!valid_bank() || t>=8) return 1;
    uint32_t offset=(uint32_t)(uintptr_t)part-U32(BANK_PTR)-PART_OFF;
    if(offset%PART_STRIDE || offset/PART_STRIDE>=4) return 1;
    volatile uint8_t *mirror=(volatile uint8_t *)(uintptr_t)(SRAM_PART+offset);
    unsigned pool=part[0x22u+t]<2 ? part[0x22u+t] : 1;
    unsigned sig=SIGNATURE+30u*t, setup=SETTINGS2+30u*t;
    if(enabled && !signed_track(part,t)) {
        const uint8_t *d=(const uint8_t *)&stang_defaults;
        part[sig]='S'; part[sig+1]='2'; part[sig+2]=1;
        for(unsigned k=0;k<3;++k) { part[sig+3+k]=d[k]; part[setup+k]=d[k+3]; }
        part[setup+3]=0; part[setup+4]=0; part[setup+5]=(uint8_t)(t+1);
    } else if(!enabled && signed_track(part,t)) {
        part[sig]=part[sig+1]=part[sig+2]=0;
    }
    for(unsigned k=0;k<6;++k) { mirror[sig+k]=part[sig+k]; mirror[setup+k]=part[setup+k]; }
    return pool;
}
static StangParams settings(unsigned t) {
    const volatile uint8_t *p=current_part(); StangParams result;
    uint8_t *bytes=(uint8_t *)&result;
    for(unsigned k=0;k<6;++k) bytes[k]=p[(k<3?SIGNATURE+3+k:SETTINGS2+k-3)+30u*t];
    return result;
}
static uint32_t get_seed(unsigned t) {
    const volatile uint8_t *p=current_part()+SETTINGS2+30u*t;
    return (uint32_t)p[3]<<16 | (uint32_t)p[4]<<8 | p[5];
}
static void store_setting(unsigned t, unsigned offset, uint8_t value) {
    unsigned at=offset+30u*t, part=U8(PART_IDX)&3u;
    current_part()[at]=value; U8(SRAM_PART+part*PART_STRIDE+at)=value;
}
static void set_seed(unsigned t,uint32_t seed) {
    store_setting(t,SETTINGS2+3,(uint8_t)(seed>>16));
    store_setting(t,SETTINGS2+4,(uint8_t)(seed>>8));
    store_setting(t,SETTINGS2+5,(uint8_t)seed);
}
/* Pattern writes happen only while stopped, on the UI task, before forwarding
 * PLAY. No interrupt/audio-frame callback generates or writes a phrase. */
static int generate_track(unsigned t, int replace) {
    if(!valid_bank() || U32(TRANSPORT)==1 || !signed_track(current_part(),t)) return 0;
    unsigned p=U8(PATTERN_IDX);
    if(p>=16) return 0;
    uint32_t bank=U32(BANK_PTR), off=p*PATTERN_STRIDE+t*STANG_TRACK_BYTES;
    volatile uint8_t *src=(volatile uint8_t *)(uintptr_t)(bank+off);
    for(unsigned k=0;k<STANG_TRACK_BYTES;++k) staging[k]=src[k];
    if(!replace && !stang_track_empty(staging,sizeof staging)) return 0;
    const volatile uint8_t *pat=(const volatile uint8_t *)(uintptr_t)(bank+p*PATTERN_STRIDE);
    unsigned length=pat[0x8e55u] ? staging[0x50u] : pat[0x8e53u];
    if(!length || length>64) return 0;
    StangParams params=settings(t);
    uint32_t seed=get_seed(t); if(replace) seed=stang_next_seed(seed);
    unsigned volume=current_part()[0x123u+24u*t];
    if(volume>127 || !stang_generate(&phrase,&params,length,volume,seed) ||
       !stang_write_phrase(staging,sizeof staging,&phrase,replace)) return 0;
    /* Recheck context before publishing. The selected track is never inferred
     * from queued UI work; bank/Part/pattern changes cancel pending requests. */
    if(bank!=U32(BANK_PTR) || p!=U8(PATTERN_IDX) || U32(TRANSPORT)==1) return 0;
    volatile uint8_t *mirror=(volatile uint8_t *)(uintptr_t)(SRAM_PATTERNS+off);
    for(unsigned k=0;k<STANG_TRACK_BYTES;++k)
        if(src[k]!=staging[k]) { src[k]=staging[k]; mirror[k]=staging[k]; }
    set_seed(t,seed); dirty_part(U8(PART_IDX)&3u);
    /* Stock lock-index rebuilding and track publication. ABI still requires
     * native qualification; never promote a screenshot to behavioral proof. */
    ((void (*)(void))0x400339d8u)();
    ((void (*)(unsigned))0x4009da20u)(t);
    U32(SCREEN_DIRTY)=1;
    return 1;
}
static void text(uint32_t surf,int x,int y,const char *s) {
    ((void (*)(uint32_t,uint32_t,int,int,int,const char *))0x40012bd8u)
        (0x400ba876u,surf,x,y,-1,s);
}
static void number(char *out,unsigned n) {
    unsigned at=0; if(n>=100) out[at++]=(char)('0'+n/100);
    if(n>=10) out[at++]=(char)('0'+n/10%10);
    out[at++]=(char)('0'+n%10); out[at]=0;
}
static void draw(void) {
    if(!window || !st_selected()) return;
    static const char *const roots[]={"C","C#","D","D#","E","F","F#","G","G#","A","A#","B"};
    uint32_t surf=window+36; int h=(int)U32(surf+4);
    ((void (*)(uint32_t))0x40035624u)(surf);
    text(surf,3,h-8,"STANG 2");
    text(surf,82,h-8,current_part()[0x22+U8(TRACK_IDX)] ? "FLEX" : "STATIC");
    StangParams p=settings(U8(TRACK_IDX)); const uint8_t *v=(const uint8_t *)&p;
    for(unsigned k=0;k<6;++k) {
        int x=5+39*(int)(k%3), y=h-20-19*(int)(k/3); char value[5];
        text(surf,x,y,stang_control_names[k]);
        number(value,v[k]);
        text(surf,x,y-8,k==2 ? roots[v[k]%12] : k==3 ? stang_scale_names[v[k]%5] : value);
    }
    text(surf,3,5,status); U32(SCREEN_DIRTY)=1;
}
void st_close_window(void) {
    if(window) ((void (*)(uint32_t *))0x40055db4u)(&window);
    U32(SCREEN_DIRTY)=1;
}
static void open_window(void) {
    if(window) return;
    window=((uint32_t (*)(int,int,int,int,int,void (*)(void)))0x4005829cu)
        (128,64,0,0,3,st_close_window);
    if(window) { ((void (*)(uint32_t))0x40056f4cu)(window); draw(); }
}
void st_knob(unsigned index,int delta) {
    if(index>=6 || !st_selected() || edit_view || U8(PAGE_KIND)!=0 || st_layer[0]) return;
    StangParams p=settings(U8(TRACK_IDX));
    int value=(int)((uint8_t *)&p)[index]+delta;
    if(value<0) value=0;
    if(value>stang_control_max[index]) value=stang_control_max[index];
    store_setting(U8(TRACK_IDX),index<3?SIGNATURE+3+index:SETTINGS2+index-3,(uint8_t)value);
    dirty_part(U8(PART_IDX)&3u); draw();
}
static void forward(unsigned which,unsigned code,unsigned edge) {
    uint32_t h=saved[which][edge==1?0:edge==0?1:2];
    if(h && h!=0xffffffffu) ((void (*)(unsigned,unsigned))h)(code,edge);
}
void st_key(unsigned code,unsigned edge) {
    unsigned which=code==0x31 ? 0 : code==0x3e ? 1 : 2, mask=1u<<which;
    if(edge!=1 && (mine&mask)) { if(!edge) mine&=~mask; return; }
    if(edge==1 && code==0x28 && any_stang() && !key_held(0x2d) &&
       !(layer_gen ? st_layer[0] : st_edit_layer[0]) && U32(TRANSPORT)!=1) {
        for(unsigned t=0;t<8;++t) (void)generate_track(t,0);
    }
    if(edge==1 && st_selected() && !key_held(0x2d) &&
       !(layer_gen ? st_layer[0] : st_edit_layer[0])) {
        if(code==0x3e && U8(PAGE_KIND)==0) {
            mine|=mask; edit_view=!edit_view; return;
        }
        if(code==0x31 && U8(PAGE_KIND)==0 && !edit_view) {
            mine|=mask;
            if(U32(TRANSPORT)==1) {
                pending=1; pending_pattern=U8(PATTERN_IDX); status="STOP:APPLY NEW PHRASE";
            } else {
                status=generate_track(U8(TRACK_IDX),1) ? "GENERATED  LEVEL:EDIT" : "NO CHANGE";
            }
            draw(); return;
        }
    }
    forward(which,code,edge);
}
void st_ui_tick(void) {
    /* Row five aliases the current backing pool for native SRC SETUP. */
    if(valid_bank()) {
        unsigned t=U8(TRACK_IDX), pool=t<8?current_part()[0x22+t]:1;
        U32(0x400d5f4cu)=pool==0?0x400d301cu:0x400d31aeu;
    }
    unsigned want=any_stang();
    uint32_t bank=U32(BANK_PTR), part=U8(PART_IDX), track=U8(TRACK_IDX);
    unsigned changed=bank!=shown_bank || part!=shown_part || track!=shown_track;
    uint32_t *layer=layer_gen?st_layer:st_edit_layer;
    if(active && (!want || layer[0] || changed || layer_gen!=(unsigned)(st_selected() && !edit_view && U8(PAGE_KIND)==0))) {
        if(mine) return; /* A release always reaches the handler that took its press. */
        st_close_window(); ((void (*)(uint32_t *))0x4003146cu)(layer); active=0;
    }
    if(changed) { pending=0; edit_view=0; status="YES:GEN  LEVEL:EDIT"; }
    shown_bank=bank; shown_part=part; shown_track=track;
    if(pending && pending_pattern!=U8(PATTERN_IDX)) { pending=0; status="REQUEST CANCELLED"; }
    if(pending && st_selected() && U32(TRANSPORT)!=1) {
        pending=0; status=generate_track(track,1)?"GENERATED  LEVEL:EDIT":"NO CHANGE";
        draw();
    }
    if(!active) {
        volatile uint32_t *base=(volatile uint32_t *)(uintptr_t)U32(LAYERS);
        if(!want || !base || base[0]) return;
        static const unsigned keys[]={0x31,0x3e,0x28};
        for(unsigned k=0;k<3;++k) for(unsigned e=0;e<3;++e) saved[k][e]=U32(KEY_CACHE+24*keys[k]+4*e);
        layer_gen=st_selected() && !edit_view && U8(PAGE_KIND)==0;
        layer=layer_gen?st_layer:st_edit_layer; layer[0]=0;
        ((void (*)(uint32_t *))0x40031494u)(layer); active=1;
        if(layer_gen) open_window();
    }
}
