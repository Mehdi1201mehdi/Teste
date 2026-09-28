// Simulation de « Ma position » sur les 1 347 tracés de rues d'Amiens :
// points tirés sur les trottoirs + erreur GPS réaliste, décision hors ligne.
// Mesure le taux de rues retenues d'office à tort (objectif : ~0 %).
// Lancer : node tools/gps-simulation.mjs
import fs from "fs";
const base=new URL("../brigade-verte-v3/", import.meta.url).pathname;
const { createStreetIndex, decideStreet } = await import(base+"js/streetgeo.js");
const streets=JSON.parse(fs.readFileSync(base+"data/streets.json"));
const geo=JSON.parse(fs.readFileSync(base+"data/streets-geo.json"));
const idx=createStreetIndex(streets,geo);
const LAT0=49.894, KY=111320, KX=111320*Math.cos(LAT0*Math.PI/180);
let seed=42; const rnd=()=>{seed=(seed*1103515245+12345)%2147483648; return seed/2147483648;};
const gauss=()=>Math.sqrt(-2*Math.log(rnd()+1e-12))*Math.cos(2*Math.PI*rnd());
const withG=streets.filter(r=>geo.s[r.rue]);
console.log("rues:",streets.length,"avec tracé:",withG.length);
function decode(enc){const o=[];let lon=0,lat=0;for(let i=0;i<enc.length;i+=2){lon+=enc[i];lat+=enc[i+1];o.push([lon/1e5,lat/1e5]);}return o;}
const res={};
for(const acc of [5,10,15,25,40]){
  const r={n:0,confOK:0,confKO:0,amb:0,ambIn:0,impr:0}; const bad={};
  for(let k=0;k<4000;k++){
    const st=withG[Math.floor(rnd()*withG.length)];
    const lines=geo.s[st.rue].map(decode); const L=lines[Math.floor(rnd()*lines.length)]; if(L.length<2) continue;
    const i=Math.floor(rnd()*(L.length-1)); const t=rnd();
    const a=L[i],b=L[i+1]; const x=(a[0]+(b[0]-a[0])*t)*KX, y=(a[1]+(b[1]-a[1])*t)*KY;
    let dx=(b[0]-a[0])*KX, dy=(b[1]-a[1])*KY; const len=Math.hypot(dx,dy)||1; const nx=-dy/len, ny=dx/len;
    const side=(rnd()<0.5?-1:1)*(4+rnd()*8); // trottoir 4-12 m de l'axe
    // erreur GPS réelle ~ précision annoncée (rayon 68%)
    const ex=gauss()*acc*0.7, ey=gauss()*acc*0.7;
    const px=x+nx*side+ex, py=y+ny*side+ey;
    const fix={lat:py/KY, lon:px/KX, accuracy:acc};
    const near=idx.nearest(fix.lat,fix.lon,6); const d=decideStreet(fix,near,null);
    r.n++;
    if(d.status==="confident"){ if(d.street.rue===st.rue) r.confOK++; else {r.confKO++; const key=st.rue+" → "+d.street.rue; bad[key]=(bad[key]||0)+1;} }
    else if(d.status==="ambiguous"){ r.amb++; if(d.candidates.slice(0,3).some(c=>c.r.rue===st.rue)) r.ambIn++; }
    else r.impr++;
  }
  const p=v=>(100*v/r.n).toFixed(1)+"%";
  console.log(`±${acc} m : sûr-juste ${p(r.confOK)} · SÛR-FAUX ${p(r.confKO)} · à confirmer ${p(r.amb)} (bonne rue dans les 3 proposées : ${(100*r.ambIn/Math.max(1,r.amb)).toFixed(0)}%) · imprécis ${p(r.impr)}`);
  if(acc<=15) console.log("   erreurs types:",Object.entries(bad).sort((a,b)=>b[1]-a[1]).slice(0,6));
}
