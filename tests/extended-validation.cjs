// Frozen production algorithm, expanded chronological replay. No parameter fitting.
// node tests/extended-validation.cjs input.json output.json
const fs=require('node:fs'),crypto=require('node:crypto');
const F=require('../app/src/main/assets/forecast.js');
const bytes=fs.readFileSync(process.argv[2]);
const raw=JSON.parse(bytes).time,byDate=new Map();let rejected=0,duplicates=0;
for(const row of raw){
 const [date,open,close,low,high]=row;
 const item={date,open:Number(open),close:Number(close),low:Number(low),high:Number(high)};
 if(date>='2026-10-07'||!F.validate([item])){rejected++;continue;}
 if(byDate.has(date))duplicates++;
 byDate.set(date,item);
}
const data=[...byDate.values()].sort((a,b)=>a.date.localeCompare(b.date));
if(!F.validate(data))throw Error('Invalid data order');
const records=[];
function evalBand(p,a,center){return {covered:+(a.low>=p.lower&&a.high<=p.upper),closeCovered:+(a.close>=p.lower&&a.close<=p.upper),width:(p.upper-p.lower)/center,loss:((p.upper-p.lower)+20*Math.max(p.lower-a.low,0)+20*Math.max(a.high-p.upper,0))/center};}
for(let i=F.MIN-1;i<data.length-1;i++){
 // Match the phone's maximum 800 bars; never access target when making a band.
 const prefix=data.slice(Math.max(0,i-799),i+1);
 const p=F.forecastAt(prefix,F.prepare(prefix),prefix.length-1);
 if(!p)continue;
 const target=data[i+1];
 records.push({date:target.date,baseDate:p.baseDate,lower:p.lower,upper:p.upper,close:p.center,actualLow:target.low,actualHigh:target.high,
   model:evalBand(p,target,p.center),baseline:evalBand(p.baseline,target,p.center)});
}
function summary(rows){
 const out={n:rows.length,from:rows[0]?.date,to:rows.at(-1)?.date};
 for(const key of ['model','baseline']){
  out[key]={};for(const metric of ['covered','closeCovered','width','loss'])out[key][metric]=rows.reduce((s,r)=>s+r[key][metric],0)/rows.length;
 }
 let streak=0,longest=0;for(const r of rows){streak=r.model.covered?0:streak+1;longest=Math.max(streak,longest);}
 out.longestMissStreak=longest;
 return out;
}
let seed=20261007;
const random=()=>{seed=(1664525*seed+1013904223)>>>0;return seed/4294967296;};
function uncertainty(rows,block=20){
 const differences=[],coverages=[];
 for(let trial=0;trial<2000;trial++){
  let sum=0,cov=0,k=0;
  while(k<rows.length){const start=Math.floor(random()*rows.length);for(let j=0;j<block&&k<rows.length;j++,k++){const r=rows[(start+j)%rows.length];sum+=r.model.loss-r.baseline.loss;cov+=r.model.covered;}}
  differences.push(sum/rows.length);coverages.push(cov/rows.length);
 }
 const bounds=a=>{a.sort((a,b)=>a-b);return [a[49],a[1949]];};
 return {block,repetitions:2000,lossDifference95:bounds(differences),coverage95:bounds(coverages)};
}
const yearly={};for(const year of [...new Set(records.map(r=>r.date.slice(0,4)))])yearly[year]=summary(records.filter(r=>r.date.startsWith(year)));
let min60=null;for(let i=59;i<records.length;i++){const s=summary(records.slice(i-59,i+1));if(!min60||s.model.covered<min60.model.covered)min60=s;}
const report={date:'2026-10-07',inputSha256:crypto.createHash('sha256').update(bytes).digest('hex'),rawRows:raw.length,validRows:data.length,rejected,duplicates,
 all:summary(records),recent252:summary(records.slice(-252)),yearly,worst60:min60,
 uncertaintyAll:uncertainty(records),uncertaintyRecent252:uncertainty(records.slice(-252)),
 worstMisses:records.filter(r=>!r.model.covered).sort((a,b)=>b.model.loss-a.model.loss).slice(0,5),records};
fs.writeFileSync(process.argv[3],JSON.stringify(report,null,2));
console.log(JSON.stringify({...report,records:undefined},null,2));
