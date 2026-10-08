const test=require('node:test'),assert=require('node:assert/strict');
const F=require('../app/src/main/assets/forecast.js');
const start=Date.parse('2025-01-01T00:00:00+08:00');
const rows=(n=400)=>Array.from({length:n},(_,i)=>({date:new Date(start+i*86400000+8*3600000).toISOString().slice(0,10),open:100,close:100,high:101,low:99}));
const now=n=>start+n*86400000;
test('constant-range series gives analytically known ATR, band and coverage',()=>{
 const r=F.run(rows(),now(400));
 assert.equal(r.available,true);assert.equal(r.prediction.atr,2);
 assert.equal(r.prediction.lower,99);assert.equal(r.prediction.upper,101);
 assert.equal(r.validation.model.n,252);assert.equal(r.validation.model.coverage,1);
 assert.ok(Math.abs(r.validation.model.width-.02)<1e-12);assert.ok(Math.abs(r.validation.model.loss-.02)<1e-12);
});
test('135 completed bars required, without fabricated forecasts',()=>{
 assert.equal(F.run(rows(134),now(134)).available,false);
 assert.equal(F.run(rows(135),now(135)).available,true);
 assert.equal(F.run(rows(135),now(135)).quality,'评估样本不足');
});
test('current-day partial bar and future bars never enter the forecast',()=>{
 const original=rows(300),extended=rows(302);
 extended[300]={...extended[300],high:900,close:800};
 assert.deepEqual(F.run(original,now(300)).prediction,F.run(extended,now(300)).prediction);
});
test('no future leakage: extreme future bars do not change earlier forecasts',()=>{
 const original=rows(),changed=rows();
 changed[350]={...changed[350],high:300,close:290};
 const a=F.forecastAt(original,F.prepare(original),349);
 const b=F.forecastAt(changed,F.prepare(changed),349);
 assert.deepEqual(a,b);
 const r=F.backtest(changed).records.find(x=>x.targetDate===changed[350].date);
 assert.equal(r.upper,101);assert.equal(r.model.covered,false);assert.ok(r.model.loss>1);
});
test('same-day bar requires a successful fetch after 16:00, not an aging intraday cache',()=>{
 const data=rows(301),afternoon=now(300)+17*3600000,morning=now(300)+10*3600000;
 assert.equal(F.run(data,afternoon,morning).baseDate,data[299].date);
 assert.equal(F.run(data,afternoon,afternoon).baseDate,data[300].date);
 assert.equal(F.run(data,afternoon,afternoon+3600000).baseDate,data[299].date);
});
test('historical prefixes reproduce retrospective forecasts exactly',()=>{
 const data=rows();
 for(let i=0;i<data.length;i++){const c=100+Math.sin(i/7)*3+i/100;Object.assign(data[i],{open:c,close:c,high:c+1,low:c-1});}
 for(const r of F.backtest(data).records.filter((_,i)=>i%31===0)){
  const i=data.findIndex(x=>x.date===r.baseDate),slice=data.slice(0,i+1);
  const p=F.forecastAt(slice,F.prepare(slice),i);
  assert.equal(p.lower,r.lower);assert.equal(p.upper,r.upper);
 }
});
test('stale data, zero volatility and malformed rows refuse a forecast',()=>{
 assert.equal(F.run(rows(),now(411)).available,false);
 assert.equal(F.run(rows().map(r=>({...r,low:100,high:100})),now(400)).available,false);
 for(const change of [r=>r.reverse(),r=>{r[2].date=r[1].date;return r;},r=>{r[2].low=200;return r;},r=>{r[2].close=NaN;return r;}])
  assert.equal(F.run(change(rows()),now(400)).available,false);
});
test('MA screen follows source logic without transferring stock scores',()=>{
 const bull=rows(25).map((r,i)=>({...r,close:100+i}));
 assert.equal(F.alignment(bull).label,'均线多头排列');assert.equal(F.alignment(bull).ma10,119.5);
 assert.equal(F.alignment(bull.map(r=>({...r,close:300-r.close}))).label,'均线空头排列');
 assert.equal(F.alignment(rows(25)).label,'均线交错');
});
test('exchange holidays are not invented as target dates',()=>{
 const data=rows(135);data[134].date='2026-09-30';
 const r=F.run(data,Date.parse('2026-10-06T12:00:00+08:00'));
 assert.equal(r.available,true);assert.equal(r.baseDate,'2026-09-30');assert.equal(r.ageDays,6);
 assert.equal(r.prediction.targetDate,undefined);
});
