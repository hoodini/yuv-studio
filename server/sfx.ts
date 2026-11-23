// A small sound-effect library, synthesised with ffmpeg the first time the server starts.
import fs from 'node:fs';
import path from 'node:path';
import { SFX } from '../shared/presets';
import { FFMPEG, run } from './media';
import { DIRS } from './store';

const TAU = '2*PI';
const RECIPES: Record<string, { src: string; af?: string }> = {
  pop: { src: `aevalsrc='0.8*sin(${TAU}*(520+2600*t)*t)*exp(-34*t)':d=0.16` },
  click: { src: `aevalsrc='0.7*sin(${TAU}*2100*t)*exp(-220*t)':d=0.06` },
  whoosh: { src: 'anoisesrc=d=0.75:c=pink:a=0.9', af: "highpass=f=350,lowpass=f=5200,volume='pow(sin(PI*t/0.75),2)*1.6':eval=frame" },
  swish: { src: 'anoisesrc=d=0.3:c=white:a=0.7', af: "highpass=f=1800,lowpass=f=9000,volume='pow(sin(PI*t/0.3),2)*1.3':eval=frame" },
  riser: { src: `aevalsrc='0.42*sin(${TAU}*(180*t+170*t*t))*pow(t/2,2)+0.2*(random(0)*2-1)*pow(t/2,3)':d=2`, af: 'highpass=f=120,afade=t=out:st=1.94:d=0.06' },
  impact: { src: `aevalsrc='0.95*sin(${TAU}*(95-28*t)*t)*exp(-4.5*t)+0.35*(random(0)*2-1)*exp(-28*t)':d=1.3`, af: 'lowpass=f=3000' },
  chime: { src: `aevalsrc='0.3*(sin(${TAU}*880*t)+0.6*sin(${TAU}*1318.5*t)+0.4*sin(${TAU}*1760*t))*exp(-3*t)':d=1.6` },
  ding: { src: `aevalsrc='0.5*(sin(${TAU}*1568*t)+0.35*sin(${TAU}*3136*t))*exp(-6*t)':d=1` },
  glitch: { src: `aevalsrc='0.45*(random(0)*2-1)*gt(sin(${TAU}*31*t),0.2)+0.3*sin(${TAU}*(700+500*sin(90*t))*t)*gt(sin(${TAU}*17*t),0)':d=0.38`, af: 'highpass=f=300' },
  'deep-whoosh': { src: 'anoisesrc=d=1.1:c=brown:a=1', af: "lowpass=f=900,highpass=f=50,volume='pow(sin(PI*t/1.1),2)*5':eval=frame,alimiter=limit=0.9" },
  'suck-in': { src: `aevalsrc='0.9*sin(${TAU}*(95-28*t)*t)*exp(-4.5*t)+0.5*(random(0)*2-1)*exp(-9*t)':d=1.1`, af: 'lowpass=f=5000,areverse,afade=t=in:d=0.2' },
  'tape-stop': { src: `aevalsrc='0.4*(sin(${TAU}*(440*t-250*t*t))+0.5*sin(${TAU}*(880*t-500*t*t))+0.3*sin(${TAU}*(1320*t-750*t*t)))*(1-t/0.85)':d=0.85` },
  boom: { src: `aevalsrc='0.95*sin(${TAU}*(62-9*t)*t)*exp(-1.9*t)+0.5*(random(0)*2-1)*exp(-16*t)':d=2.4`, af: 'lowpass=f=1400,afade=t=out:st=2.1:d=0.3' },
  'sub-drop': { src: `aevalsrc='0.95*sin(${TAU}*(130*t-42*t*t))*min(1,t*40)*pow(1-t/1.3,0.7)':d=1.3` },
  thud: { src: `aevalsrc='0.95*sin(${TAU}*(110-120*t)*t)*exp(-16*t)+0.25*(random(0)*2-1)*exp(-70*t)':d=0.4`, af: 'lowpass=f=1800' },
  heartbeat: { src: `aevalsrc='0.95*sin(${TAU}*58*t)*exp(-22*t)+0.75*sin(${TAU}*52*(t-0.3))*exp(-22*max(0,t-0.3))*gte(t,0.3)':d=1` },
  zap: { src: `aevalsrc='0.5*sin(${TAU}*(2600*t-4400*t*t))*exp(-9*t)+0.2*(random(0)*2-1)*exp(-40*t)':d=0.28`, af: 'highpass=f=250' },
  bubble: { src: `aevalsrc='0.7*sin(${TAU}*(320*t+2600*t*t))*sin(PI*t/0.14)':d=0.14` },
  typing: { src: `aevalsrc='0.8*(random(0)*2-1)*exp(-110*mod(t+0.031*sin(47*t),0.115))':d=1.15`, af: 'highpass=f=1300,lowpass=f=6500,afade=t=out:st=1.1:d=0.05' },
  shutter: { src: `aevalsrc='0.8*(random(0)*2-1)*(exp(-90*t)+0.9*exp(-70*max(0,t-0.11))*gte(t,0.11))':d=0.32`, af: 'highpass=f=900,lowpass=f=7500' },
  notify: { src: `aevalsrc='0.45*(sin(${TAU}*880*t)*exp(-9*t)+sin(${TAU}*1174.7*(t-0.14))*exp(-7*max(0,t-0.14))*gte(t,0.14))':d=0.9` },
  error: { src: `aevalsrc='0.4*(sin(${TAU}*155*t)+0.5*sin(${TAU}*310*t)+0.33*sin(${TAU}*465*t))*(between(t,0,0.16)+between(t,0.24,0.46))':d=0.5`, af: 'lowpass=f=2500,afade=t=out:st=0.44:d=0.05' },
  success: { src: `aevalsrc='0.4*(sin(${TAU}*523.25*t)*exp(-9*t)+sin(${TAU}*659.25*(t-0.09))*exp(-9*max(0,t-0.09))*gte(t,0.09)+sin(${TAU}*783.99*(t-0.18))*exp(-9*max(0,t-0.18))*gte(t,0.18)+sin(${TAU}*1046.5*(t-0.27))*exp(-4*max(0,t-0.27))*gte(t,0.27))':d=1.4` },
  coin: { src: `aevalsrc='0.4*((sin(${TAU}*1174.7*t)+0.4*sin(${TAU}*2349.3*t))*between(t,0,0.07)+(sin(${TAU}*1568*(t-0.07))+0.4*sin(${TAU}*3136*(t-0.07)))*exp(-5*max(0,t-0.07))*gte(t,0.07))':d=1` },
  sparkle: { src: `aevalsrc='0.22*(sin(${TAU}*2093*t)*exp(-7*t)+sin(${TAU}*2637*(t-0.07))*exp(-7*max(0,t-0.07))*gte(t,0.07)+sin(${TAU}*3136*(t-0.14))*exp(-7*max(0,t-0.14))*gte(t,0.14)+sin(${TAU}*4186*(t-0.21))*exp(-5*max(0,t-0.21))*gte(t,0.21)+sin(${TAU}*3520*(t-0.3))*exp(-5*max(0,t-0.3))*gte(t,0.3))':d=1.3` },
  swell: { src: `aevalsrc='0.3*(sin(${TAU}*110*t)+0.7*sin(${TAU}*165*t)+0.5*sin(${TAU}*220.6*t))*pow(sin(PI*t/3),2)':d=3`, af: 'lowpass=f=2400' },
};

export const sfxPath = (id: string) => path.join(DIRS.sfx, `${id}.wav`);

export async function ensureSfx() {
  for (const { id } of SFX) {
    const out = sfxPath(id);
    const r = RECIPES[id];
    if (!r || fs.existsSync(out)) continue;
    await run(FFMPEG, ['-v', 'error', '-f', 'lavfi', '-i', r.src, '-af', `${r.af ? r.af + ',' : ''}aformat=sample_fmts=s16:sample_rates=48000:channel_layouts=stereo`, '-y', out]).catch((e) => console.error(`[sfx ${id}]`, e.message));
  }
}
