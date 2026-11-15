import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const css=readFileSync('src/styles/homepage.css','utf8');
const rgb=hex=>hex.replace('#','').match(/../g).map(x=>parseInt(x,16)/255);
const luminance=values=>values.map(v=>v<=0.04045?v/12.92:((v+0.055)/1.055)**2.4).reduce((s,v,i)=>s+v*[0.2126,0.7152,0.0722][i],0);
const contrast=(a,b)=>{const x=luminance(a),y=luminance(b);return(Math.max(x,y)+.05)/(Math.min(x,y)+.05);};
const token=name=>{const m=css.match(new RegExp(`--${name}:\\s*(#[a-f0-9]{6})`,'i'));assert(m,`Missing ${name}`);return rgb(m[1]);};
const stops=[...css.matchAll(/#([a-f0-9]{6})\s+(\d+)%/gi)].map(m=>({color:rgb(m[1]),at:Number(m[2])/100}));
assert.deepEqual(stops.map(s=>s.at),[0,.35,.72,1]);
for(const name of ['foreground','muted-foreground','ring']){
 let minimum=Infinity;
 for(let i=0;i<stops.length-1;i++)for(let step=0;step<=100;step++){
  const t=step/100;const bg=stops[i].color.map((v,k)=>v*(1-t)+stops[i+1].color[k]*t);
  minimum=Math.min(minimum,contrast(token(name),bg));
 }
 const required=name==='ring'?3:4.5;assert(minimum>=required,`${name} needs ${required}:1, got ${minimum.toFixed(2)}`);
 console.log(`${name}: minimum ${minimum.toFixed(2)}:1 across gradient — PASS`);
}
assert(contrast(token('input'),rgb('#ffffff'))>=3,'Input boundary must meet 3:1 on white');
assert(contrast(rgb('#66543b'),rgb('#ffffff'))>=4.5,'Placeholder must meet 4.5:1 on white');
console.log('Input boundary and placeholder on white — PASS');

assert(contrast(token('muted-foreground'),rgb('#c7c7c7'))>=4.5,'Sticky header must remain readable over dark product images');
console.log('Sticky header worst-case image backdrop — PASS');
