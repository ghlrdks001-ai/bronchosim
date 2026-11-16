// Procedural tracheobronchial tree: definition, signed distance field, mesher.
// Units: mm. Axes: +x = patient LEFT, +y = cranial, +z = anterior. Origin near carina.

function norm(v){const l=Math.hypot(v[0],v[1],v[2]);return [v[0]/l,v[1]/l,v[2]/l];}
const deg=Math.PI/180;

// level: 0 trachea, 1 main, 2 lobar/intermediate, 3 segmental
// at: fraction along parent where branch originates (default 1 = parent end)
const DEF=[
 {id:'TR', name:'Trachea', ko:'기관', start:[0,135,0], dir:[0,-1,0], len:127, r0:9.2, r1:8.4, level:0, ring:4.0},
 {id:'RMB',name:'Right main bronchus', ko:'우주기관지', parent:'TR', origin:[0,0,0], dir:[-Math.sin(25*deg),-Math.cos(25*deg),-0.08], len:27, r0:7.6, r1:7.0, level:1, ring:3.6},
 {id:'LMB',name:'Left main bronchus', ko:'좌주기관지', parent:'TR', origin:[0,0,0], dir:[Math.sin(45*deg),-Math.cos(45*deg),-0.08], len:54, r0:6.3, r1:5.8, level:1, ring:3.6},
 // right
 {id:'RUL',name:'RUL bronchus', ko:'우상엽', parent:'RMB', dir:[-1,0.32,-0.08], len:12, r0:4.8, r1:4.4, level:2, ring:3.2},
 {id:'RB1',name:'RB1 apical', ko:'첨분절', parent:'RUL', dir:[-0.25,1,0.05], len:24, r0:3.2, r1:2.0, level:3},
 {id:'RB2',name:'RB2 posterior', ko:'후분절', parent:'RUL', dir:[-0.55,0.25,-0.85], len:24, r0:3.2, r1:2.0, level:3},
 {id:'RB3',name:'RB3 anterior', ko:'전분절', parent:'RUL', dir:[-0.55,-0.05,0.85], len:24, r0:3.2, r1:2.0, level:3},
 {id:'BI', name:'Bronchus intermedius', ko:'중간기관지', parent:'RMB', dir:[-0.22,-1,-0.06], len:24, r0:5.8, r1:5.4, level:2, ring:3.4},
 {id:'RML',name:'RML bronchus', ko:'우중엽', parent:'BI', dir:[-0.3,-0.5,0.85], len:15, r0:3.9, r1:3.6, level:2, ring:3.2},
 {id:'RB4',name:'RB4 lateral', ko:'외측분절', parent:'RML', dir:[-0.85,-0.4,0.45], len:22, r0:2.8, r1:1.9, level:3},
 {id:'RB5',name:'RB5 medial', ko:'내측분절', parent:'RML', dir:[0.25,-0.55,0.8], len:22, r0:2.8, r1:1.9, level:3},
 {id:'RLL',name:'RLL bronchus', ko:'우하엽', parent:'BI', dir:[-0.18,-1,-0.14], len:20, r0:5.2, r1:4.8, level:2, ring:3.2},
 {id:'RB6',name:'RB6 superior', ko:'상분절', parent:'RLL', at:0.12, dir:[-0.2,-0.05,-1], len:22, r0:3.4, r1:2.1, level:3},
 {id:'RB7',name:'RB7 medial basal', ko:'내측기저', parent:'RLL', dir:[0.3,-1,0.1], len:24, r0:2.9, r1:1.9, level:3},
 {id:'RB8',name:'RB8 anterior basal', ko:'전기저', parent:'RLL', dir:[-0.3,-0.8,0.6], len:24, r0:2.9, r1:1.9, level:3},
 {id:'RB9',name:'RB9 lateral basal', ko:'외측기저', parent:'RLL', dir:[-0.75,-0.8,0], len:24, r0:2.9, r1:1.9, level:3},
 {id:'RB10',name:'RB10 posterior basal', ko:'후기저', parent:'RLL', dir:[-0.2,-0.8,-0.65], len:24, r0:2.9, r1:1.9, level:3},
 // left
 {id:'LUL',name:'LUL bronchus', ko:'좌상엽', parent:'LMB', dir:[0.75,0.25,0.55], len:12, r0:5.0, r1:4.6, level:2, ring:3.2},
 {id:'LUD',name:'LUL upper division', ko:'상엽 상부분지', parent:'LUL', dir:[0.3,1,0.1], len:10, r0:4.0, r1:3.8, level:2},
 {id:'LB12',name:'LB1+2 apicoposterior', ko:'첨후분절', parent:'LUD', dir:[0.3,1,-0.55], len:22, r0:3.0, r1:2.0, level:3},
 {id:'LB3',name:'LB3 anterior', ko:'전분절', parent:'LUD', dir:[0.4,0.3,0.9], len:22, r0:3.0, r1:2.0, level:3},
 {id:'LING',name:'Lingular bronchus', ko:'설상엽', parent:'LUL', dir:[0.5,-0.55,0.7], len:13, r0:3.6, r1:3.4, level:2},
 {id:'LB4',name:'LB4 superior lingular', ko:'상설분절', parent:'LING', dir:[0.85,-0.3,0.45], len:20, r0:2.6, r1:1.9, level:3},
 {id:'LB5',name:'LB5 inferior lingular', ko:'하설분절', parent:'LING', dir:[0.3,-0.65,0.7], len:20, r0:2.6, r1:1.9, level:3},
 {id:'LLL',name:'LLL bronchus', ko:'좌하엽', parent:'LMB', dir:[0.25,-1,-0.15], len:18, r0:5.1, r1:4.8, level:2, ring:3.2},
 {id:'LB6',name:'LB6 superior', ko:'상분절', parent:'LLL', at:0.15, dir:[0.2,-0.05,-1], len:22, r0:3.3, r1:2.1, level:3},
 {id:'LB8',name:'LB7+8 anteromedial basal', ko:'전내측기저', parent:'LLL', dir:[0.1,-0.85,0.6], len:24, r0:3.0, r1:1.9, level:3},
 {id:'LB9',name:'LB9 lateral basal', ko:'외측기저', parent:'LLL', dir:[0.65,-0.8,0], len:24, r0:2.9, r1:1.9, level:3},
 {id:'LB10',name:'LB10 posterior basal', ko:'후기저', parent:'LLL', dir:[0.15,-0.8,-0.65], len:24, r0:2.9, r1:1.9, level:3},
];

export function buildTree(){
  const map={}; const B=[];
  for(const d of DEF){
    const b={...d}; b.dir=norm(d.dir);
    if(d.start) b.a=d.start.slice();
    else if(d.origin) b.a=d.origin.slice();
    else{ const p=map[d.parent]; const f=d.at??1; b.a=[p.a[0]+p.dir[0]*p.len*f,p.a[1]+p.dir[1]*p.len*f,p.a[2]+p.dir[2]*p.len*f]; }
    b.b=[b.a[0]+b.dir[0]*b.len,b.a[1]+b.dir[1]*b.len,b.a[2]+b.dir[2]*b.len];
    b.children=[]; b.idx=B.length;
    if(d.parent) map[d.parent].children.push(b);
    // cumulative centerline distance from trachea top to branch start
    if(!d.parent) b.cum=0; else if(d.origin){ const p=map[d.parent]; b.cum=p.cum+Math.hypot(d.origin[0]-p.a[0],d.origin[1]-p.a[1],d.origin[2]-p.a[2]); } else { const p=map[d.parent]; b.cum=p.cum+p.len*(d.at??1); }
    map[b.id]=b; B.push(b);
  }
  const terminal=B.filter(b=>b.children.length===0);
  return {branches:B, map, terminal};
}

// --- SDF ---
const K=1.4; // smooth-union radius (mm)
function smin(a,b,k){const h=Math.max(k-Math.abs(a-b),0)/k;return Math.min(a,b)-h*h*k*0.25;}
export function capsuleInfo(b,x,y,z){
  let px=x-b.a[0],py=y-b.a[1],pz=z-b.a[2];
  const L=b.len;
  let t=(px*b.dir[0]+py*b.dir[1]+pz*b.dir[2])/L; t=t<0?0:t>1?1:t;
  let qx=px-b.dir[0]*L*t,qy=py-b.dir[1]*L*t,qz=pz-b.dir[2]*L*t;
  if(b.id==='TR' && qz<0) qz*=1.22; // D-shaped trachea: flatter posterior membranous wall
  const r=b.r0+(b.r1-b.r0)*t;
  return {d:Math.hypot(qx,qy,qz)-r,t,r};
}
export function makeSDF(tree){
  const B=tree.branches; const n=B.length;
  const A=new Float64Array(n*10);
  B.forEach((b,i)=>{A.set([b.a[0],b.a[1],b.a[2],b.dir[0],b.dir[1],b.dir[2],b.len,b.r0,b.r1,b.id==='TR'?1:0],i*10);});
  function cap(i,x,y,z){
    const o=i*10; const px=x-A[o],py=y-A[o+1],pz=z-A[o+2],L=A[o+6];
    let t=(px*A[o+3]+py*A[o+4]+pz*A[o+5])/L; t=t<0?0:t>1?1:t;
    const qx=px-A[o+3]*L*t,qy=py-A[o+4]*L*t; let qz=pz-A[o+5]*L*t;
    if(A[o+9]&&qz<0) qz*=1.22;
    return Math.sqrt(qx*qx+qy*qy+qz*qz)-(A[o+7]+(A[o+8]-A[o+7])*t);
  }
  function sdf(x,y,z){ let d=1e9; for(let i=0;i<n;i++){ d=smin(d,cap(i,x,y,z),K);} return d; }
  function nearest(x,y,z){ let best=1e9,bi=0; for(let i=0;i<n;i++){const d=cap(i,x,y,z); if(d<best){best=d;bi=i;}} return bi; }
  function grad(x,y,z){const e=0.05;const gx=sdf(x+e,y,z)-sdf(x-e,y,z),gy=sdf(x,y+e,z)-sdf(x,y-e,z),gz=sdf(x,y,z+e)-sdf(x,y,z-e);const l=Math.hypot(gx,gy,gz)||1;return [gx/l,gy/l,gz/l];}
  return {sdf,nearest,grad,cap};
}

// --- Surface nets mesher with cartilage-ring displacement ---
export function meshAirway(tree, S, h=0.6){
  const B=tree.branches; const n=B.length;
  let mn=[1e9,1e9,1e9],mx=[-1e9,-1e9,-1e9];
  for(const b of B){for(const p of [b.a,b.b]){for(let k=0;k<3;k++){mn[k]=Math.min(mn[k],p[k]-b.r0-3);mx[k]=Math.max(mx[k],p[k]+b.r0+3);}}}
  const nx=Math.ceil((mx[0]-mn[0])/h)+1, ny=Math.ceil((mx[1]-mn[1])/h)+1, nz=Math.ceil((mx[2]-mn[2])/h)+1;
  const F=new Float32Array(nx*ny*nz).fill(5);
  const idx=(i,j,k)=>i+nx*(j+ny*k);
  for(let bi=0;bi<n;bi++){
    const b=B[bi]; const r=Math.max(b.r0,b.r1)*1.25+2.5;
    const lo=[0,1,2].map(k=>Math.max(0,Math.floor((Math.min(b.a[k],b.b[k])-r-mn[k])/h)));
    const hi=[0,1,2].map((k,ii)=>Math.min([nx,ny,nz][ii]-1,Math.ceil((Math.max(b.a[k],b.b[k])+r-mn[k])/h)));
    for(let k=lo[2];k<=hi[2];k++){const z=mn[2]+k*h;
      for(let j=lo[1];j<=hi[1];j++){const y=mn[1]+j*h;
        for(let i=lo[0];i<=hi[0];i++){const x=mn[0]+i*h;
          const d=S.cap(bi,x,y,z); if(d>4) continue; const id=idx(i,j,k); F[id]=smin(F[id],d,K);
        }}}
  }
  const cellV=new Map(); const pos=[];
  const E=[[0,1],[2,3],[4,5],[6,7],[0,2],[1,3],[4,6],[5,7],[0,4],[1,5],[2,6],[3,7]];
  const co=[[0,0,0],[1,0,0],[0,1,0],[1,1,0],[0,0,1],[1,0,1],[0,1,1],[1,1,1]];
  const v=new Float32Array(8);
  for(let k=0;k<nz-1;k++)for(let j=0;j<ny-1;j++)for(let i=0;i<nx-1;i++){
    let m=0; for(let c=0;c<8;c++){const val=F[idx(i+co[c][0],j+co[c][1],k+co[c][2])];v[c]=val;if(val<0)m|=1<<c;}
    if(m===0||m===255) continue;
    let sx=0,sy=0,sz=0,cnt=0;
    for(const [a,b2] of E){ if(((m>>a)&1)!==((m>>b2)&1)){const t=v[a]/(v[a]-v[b2]);
      sx+=co[a][0]+(co[b2][0]-co[a][0])*t; sy+=co[a][1]+(co[b2][1]-co[a][1])*t; sz+=co[a][2]+(co[b2][2]-co[a][2])*t; cnt++;}}
    cellV.set(idx(i,j,k),pos.length/3);
    pos.push(mn[0]+(i+sx/cnt)*h, mn[1]+(j+sy/cnt)*h, mn[2]+(k+sz/cnt)*h);
  }
  const ind=[];
  const cid=(i,j,k)=>cellV.get(idx(i,j,k));
  for(let k=1;k<nz-1;k++)for(let j=1;j<ny-1;j++)for(let i=1;i<nx-1;i++){
    const f0=F[idx(i,j,k)]<0;
    // x edge
    if((F[idx(i+1,j,k)]<0)!==f0){const a=cid(i,j-1,k-1),b2=cid(i,j,k-1),c=cid(i,j,k),d=cid(i,j-1,k); if(a!==undefined&&b2!==undefined&&c!==undefined&&d!==undefined){ if(f0) ind.push(a,b2,c,a,c,d); else ind.push(a,c,b2,a,d,c);} }
    if((F[idx(i,j+1,k)]<0)!==f0){const a=cid(i-1,j,k-1),b2=cid(i,j,k-1),c=cid(i,j,k),d=cid(i-1,j,k); if(a!==undefined&&b2!==undefined&&c!==undefined&&d!==undefined){ if(f0) ind.push(a,c,b2,a,d,c); else ind.push(a,b2,c,a,c,d);} }
    if((F[idx(i,j,k+1)]<0)!==f0){const a=cid(i-1,j-1,k),b2=cid(i,j-1,k),c=cid(i,j,k),d=cid(i-1,j,k); if(a!==undefined&&b2!==undefined&&c!==undefined&&d!==undefined){ if(f0) ind.push(a,b2,c,a,c,d); else ind.push(a,c,b2,a,d,c);} }
  }
  // normals (pointing INTO the lumen) + cartilage displacement
  const N=pos.length/3; const P=new Float32Array(pos); const NR=new Float32Array(N*3); const RING=new Float32Array(N);
  for(let q=0;q<N;q++){
    const x=P[q*3],y=P[q*3+1],z=P[q*3+2];
    const g=S.grad(x,y,z); NR[q*3]=-g[0];NR[q*3+1]=-g[1];NR[q*3+2]=-g[2];
    const bi=S.nearest(x,y,z); const b=B[bi];
    const ci=capsuleInfo(b,x,y,z);
    // radial direction (outward) relative to axis
    const ax=b.a[0]+b.dir[0]*b.len*ci.t, ay=b.a[1]+b.dir[1]*b.len*ci.t, az=b.a[2]+b.dir[2]*b.len*ci.t;
    let rx=x-ax,ry=y-ay,rz=z-az; const rl=Math.hypot(rx,ry,rz)||1; rx/=rl;ry/=rl;rz/=rl;
    let w=0, bump=0, disp=0; const s=ci.t*b.len;
    if(b.ring){
      // cartilage absent on posterior membranous wall of trachea & main bronchi
      w = (b.level<=1)? smooth(-0.62,-0.3,rz) : 0.55;
      const ph=s/b.ring + (b.level>=2? 0.25*Math.sin(Math.atan2(rz,rx)*2):0);
      bump=Math.pow(0.5+0.5*Math.cos(2*Math.PI*ph),3);
      disp+= (b.level<=1?0.55:0.3)*bump*w;
      if(b.level<=1 && w<0.5){ // longitudinal folds on membranous wall
        const ang=Math.atan2(rx,rz); disp+=0.12*(1-w)*Math.max(0,Math.sin(ang*24)); }
      // fade rings near branch ends (junctions)
      const fade=smooth(0,5,s)*smooth(0,4,b.len-s); disp*=fade; bump*=fade;
    }
    P[q*3]-=rx*disp; P[q*3+1]-=ry*disp; P[q*3+2]-=rz*disp;
    RING[q]=bump*w;
  }
  return {positions:P, normals:NR, ring:RING, indices:(N>65535?new Uint32Array(ind):new Uint16Array(ind)), bounds:{mn,mx}};
}
function smooth(a,b,x){const t=Math.min(1,Math.max(0,(x-a)/(b-a)));return t*t*(3-2*t);}

// Locate the carina ridge: march down the bisector between main bronchi until the wall.
export function findCarina(tree,S){
  const R=tree.map.RMB.dir, L=tree.map.LMB.dir;
  const bis=norm([R[0]+L[0],R[1]+L[1],R[2]+L[2]]);
  let t=0; while(t<40 && S.sdf(bis[0]*t,bis[1]*t,bis[2]*t)<0) t+=0.05;
  return [bis[0]*t,bis[1]*t,bis[2]*t];
}
export function findSecondaryCarina(tree,S,aId,bId){
  const A=tree.map[aId], Bb=tree.map[bId];
  const bis=norm([A.dir[0]+Bb.dir[0],A.dir[1]+Bb.dir[1],A.dir[2]+Bb.dir[2]]);
  const o=A.a; let t=0; while(t<40 && S.sdf(o[0]+bis[0]*t,o[1]+bis[1]*t,o[2]+bis[2]*t)<0) t+=0.05;
  return [o[0]+bis[0]*t,o[1]+bis[1]*t,o[2]+bis[2]*t];
}
