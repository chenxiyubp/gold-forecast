(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.GoldForecast = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const PERIOD = 14, WINDOW = 120, LEVEL = .9, MIN = 135;
  const day = t => new Date(t + 8 * 3600000).toISOString().slice(0, 10);
  function validDate(value) {
    const t = Date.parse(value + 'T00:00:00+08:00');
    return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(t) && day(t) === value;
  }
  function validate(rows) {
    if (!Array.isArray(rows)) return false;
    return rows.every((r, i) => r && validDate(r.date) && (!i || r.date > rows[i-1].date) &&
      ['open','close','high','low'].every(k => Number.isFinite(r[k]) && r[k] > 0) &&
      r.high >= Math.max(r.open,r.close,r.low) && r.low <= Math.min(r.open,r.close));
  }
  function quantile(values) {
    const sorted = [...values].sort((a,b) => a-b);
    return sorted[Math.ceil(LEVEL * sorted.length)-1];
  }
  function prepare(rows) {
    const atr = Array(rows.length).fill(null), scores = Array(rows.length).fill(null), basic = Array(rows.length).fill(null);
    let initial = 0;
    for (let i=1;i<rows.length;i++) {
      const r=rows[i], prev=rows[i-1].close;
      const tr=Math.max(r.high-r.low,Math.abs(r.high-prev),Math.abs(r.low-prev));
      if (i<=PERIOD) initial += tr;
      if (i===PERIOD) atr[i]=initial/PERIOD;
      else if(i>PERIOD) atr[i]=(atr[i-1]*(PERIOD-1)+tr)/PERIOD;
      const excursion=Math.max(Math.abs(r.high-prev),Math.abs(r.low-prev));
      basic[i]=excursion/prev;
      if(atr[i-1]>0) scores[i]=excursion/atr[i-1];
    }
    return {atr,scores,basic};
  }
  function bounds(center, half) {
    return {lower:Math.max(.01,Math.floor((center-half)*100)/100),upper:Math.ceil((center+half)*100)/100};
  }
  function at(rows, series, i) {
    if(i<MIN-1 || !(series.atr[i]>0)) return null;
    const sample=series.scores.slice(i-WINDOW+1,i+1);
    if(sample.length!==WINDOW || sample.some(x=>!Number.isFinite(x))) return null;
    const half=quantile(sample)*series.atr[i], center=rows[i].close;
    if(!(half>0) || !Number.isFinite(half)) return null;
    return {baseDate:rows[i].date,center,atr:series.atr[i],calibration:WINDOW,
      ...bounds(center,half),baseline:bounds(center,quantile(series.basic.slice(i-WINDOW+1,i+1))*center)};
  }
  function evaluate(prediction, actual, center) {
    const {lower,upper}=prediction;
    return {covered:actual.low>=lower && actual.high<=upper,closeCovered:actual.close>=lower && actual.close<=upper,
      width:(upper-lower)/center,
      loss:((upper-lower)+20*Math.max(lower-actual.low,0)+20*Math.max(actual.high-upper,0))/center};
  }
  function summarize(records, key) {
    const n=records.length;
    if(!n) return {n:0,coverage:null,closeCoverage:null,width:null,loss:null};
    const average = field => records.reduce((s,r)=>s+Number(r[key][field]),0)/n;
    return {n,from:records[0].targetDate,to:records[n-1].targetDate,coverage:average('covered'),closeCoverage:average('closeCovered'),width:average('width'),loss:average('loss')};
  }
  function backtest(rows, series=prepare(rows)) {
    const records=[];
    for(let i=Math.max(MIN-1,rows.length-253);i<rows.length-1;i++) {
      const p=at(rows,series,i);
      if(!p) continue;
      const actual=rows[i+1];
      records.push({baseDate:p.baseDate,targetDate:actual.date,lower:p.lower,upper:p.upper,
        actualLow:actual.low,actualHigh:actual.high,
        model:evaluate(p,actual,p.center),baseline:evaluate(p.baseline,actual,p.center)});
    }
    return {model:summarize(records,'model'),baseline:summarize(records,'baseline'),
      recent:summarize(records.slice(-60),'model'),final100:summarize(records.slice(-100),'model'),records};
  }
  function alignment(rows) {
    // Adapted from online0001's MIT short-term-stock-picker MA screen.
    // Only moving-average logic is reused; stock-specific scoring is excluded.
    const mean=n=>rows.length>=n?rows.slice(-n).reduce((s,r)=>s+r.close,0)/n:null;
    const ma5=mean(5),ma10=mean(10),ma20=mean(20),close=rows.length?rows[rows.length-1].close:null;
    const bull=ma20!==null && close>=ma5 && close>=ma10 && close>=ma20 && ma5>ma10 && ma10>ma20;
    const bear=ma20!==null && close<=ma5 && close<=ma10 && close<=ma20 && ma5<ma10 && ma10<ma20;
    return {ma5,ma10,ma20,label:ma20===null?'数据不足':bull?'均线多头排列':bear?'均线空头排列':'均线交错'};
  }
  function run(history, now=Date.now(), historyFetchedAt=null) {
    if(!Number.isFinite(now) || !validate(history)) return {available:false,reason:'历史数据不完整或日期顺序异常，暂不估计区间。'};
    // Today's bar is eligible only when freshly fetched after the day session.
    // Old intraday cache must not become a completed bar merely as time passes.
    const today=day(now), closeCutoff=Date.parse(today+'T16:00:00+08:00');
    const todayConfirmed=Number.isFinite(historyFetchedAt) && historyFetchedAt>=closeCutoff && historyFetchedAt<=now;
    const rows=history.filter(r=>r.date<today || todayConfirmed && r.date===today).slice(-800);
    const base=rows[rows.length-1], common={samples:rows.length,baseDate:base?.date,alignment:alignment(rows),excluded:history.length-rows.length};
    if(rows.length<MIN) return {...common,available:false,reason:`至少需要${MIN}个已完成交易日，当前${rows.length}个。`};
    const series=prepare(rows), validation=backtest(rows,series);
    const ageDays=Math.round((Date.parse(today+'T00:00:00+08:00')-Date.parse(base.date+'T00:00:00+08:00'))/86400000);
    if(ageDays>10) return {...common,validation,ageDays,available:false,reason:'基准日距今超过10天，暂不生成新范围；请核对休市安排和数据源。'};
    const prediction=at(rows,series,rows.length-1);
    if(!prediction) return {...common,validation,available:false,reason:'波动或校准样本不足，暂不估计区间。'};
    const quality=validation.recent.n<30?'评估样本不足':validation.recent.coverage<.8?'近期覆盖偏低':'实验性区间';
    return {...common,available:true,ageDays,quality,prediction,validation};
  }
  return {run,alignment,validate,prepare,backtest,forecastAt:at,MIN,WINDOW};
});
