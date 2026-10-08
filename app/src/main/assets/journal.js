(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.GoldJournal=factory();})(typeof globalThis!=='undefined'?globalThis:this,function(){
 'use strict';
 const day=t=>new Date(t+28800000).toISOString().slice(0,10);
 const clock=(d,time)=>Date.parse(d+'T'+time+'+08:00');
 function empty(){return {version:1,predictions:[],events:[],gaps:[],revisions:[],lastNewsAt:null};}
 function restore(value){const j=empty();if(value?.version!==1)return j;const checks={predictions:x=>typeof x.id==='string'&&Number.isFinite(x.createdAt)&&Number.isFinite(x.lower)&&Number.isFinite(x.upper)&&x.baseline&&Number.isFinite(x.baseline.lower)&&Number.isFinite(x.baseline.upper),events:x=>typeof x.key==='string'&&typeof x.title==='string'&&Number.isFinite(x.firstSeenAt)&&Number.isFinite(x.publishedAt),gaps:x=>Number.isFinite(x.from)&&Number.isFinite(x.to),revisions:x=>Number.isFinite(x.seenAt)};for(const key of Object.keys(checks))if(Array.isArray(value[key]))j[key]=value[key].filter(x=>x&&checks[key](x)).slice(key==='events'?-500:-200);if(Number.isFinite(value.lastNewsAt))j.lastNewsAt=value.lastNewsAt;return j;}
 function quality(rows,previous=[]){
  const flags=[]; const old=new Map(previous.map(r=>[r.date,r])); const revisions=[];
  rows.forEach((r,i)=>{
   if(i && Math.max(Math.abs(r.high/rows[i-1].close-1),Math.abs(r.low/rows[i-1].close-1))>.2)flags.push({date:r.date,reason:'高低价偏离前收超过20%，需核验'});
   const p=old.get(r.date);if(p&&['open','close','low','high'].some(k=>p[k]!==r[k]))revisions.push({date:r.date,before:p,after:r});
  });
  return {flags,revisions,blocked:flags.some(f=>f.date>=rows.slice(-135)[0]?.date)};
 }
 function fingerprint(rows){let h=2166136261;for(const c of JSON.stringify(rows)){h^=c.charCodeAt(0);h=Math.imul(h,16777619);}return (h>>>0).toString(16);}
 function category(title){
  if(/美联储|议息|降息|加息/.test(title))return '货币政策';
  if(/非农|CPI|通胀|就业报告/i.test(title))return '经济数据';
  if(/战争|冲突|袭击|停火|制裁/.test(title))return '地缘事件';
  if(/央行.*(?:购金|增持|减持)|黄金储备/.test(title))return '央行黄金';
  if(/交易所.*(?:公告|保证金|休市|涨跌停)/.test(title))return '交易所公告';
  return '一般资讯';
 }
 function observeNews(j,news,now){
  if(j.lastNewsAt&&now-j.lastNewsAt>15*60000)j.gaps.push({from:j.lastNewsAt,to:now,reason:'两次成功采集间隔超过15分钟，期间可能漏采'});
  j.lastNewsAt=now;
  for(const n of news){
   const key=day(n.at)+':'+n.title.replace(/[\s，。！？、,.!?：:]/g,'');
   if(j.events.some(e=>e.key===key))continue;
   j.events.push({key,title:n.title,url:n.url,publishedAt:n.at,precision:n.precision,source:n.source,firstSeenAt:now,category:category(n.title),interpretation:/预期|预计|或将|可能|料将|预测|有望/.test(n.title)?'预期或观点':'标题待核实'});
  }
  j.events=j.events.slice(-500);j.gaps=j.gaps.slice(-200);
 }
 function archive(j,result,rows,now,fetchedAt,blocked){
  if(!result?.available||blocked)return;
  const p=result.prediction,id='atr14-q120-v1:'+p.baseDate;
  if(j.predictions.some(r=>r.id===id))return;
  // Without an exchange calendar, only same-day pre-night creation is eligible.
  const eligible=day(now)===p.baseDate&&now>=clock(p.baseDate,'16:00:00')&&now<clock(p.baseDate,'19:45:00')&&fetchedAt>=clock(p.baseDate,'16:00:00')&&fetchedAt<=now;
  j.predictions.push({id,model:'atr14-q120-v1',baseDate:p.baseDate,createdAt:now,sourceFetchedAt:fetchedAt,inputFingerprint:fingerprint(rows),lower:p.lower,upper:p.upper,center:p.center,atr:p.atr,baseline:{...p.baseline},eligible,eligibility:eligible?'日盘后、夜盘前留档':'补记或无法确认早于目标时段，不纳入前瞻统计',eventKeys:j.events.filter(e=>e.firstSeenAt<=now&&now-e.firstSeenAt<86400000).map(e=>e.key).slice(-30),outcome:null});
  j.predictions=j.predictions.slice(-200);
 }
 function settle(j,rows,now,fetchedAt){
  for(const r of j.predictions){
   const index=rows.findIndex(h=>h.date===r.baseDate);if(index<0)continue;
   const target=rows[index+1];if(!target||!Number.isFinite(fetchedAt)||fetchedAt>now||fetchedAt<clock(target.date,'16:00:00'))continue;
   if(Math.max(Math.abs(target.high/rows[index].close-1),Math.abs(target.low/rows[index].close-1))>.2){r.dataIssue=true;continue;}
   if(r.outcome){if(JSON.stringify(r.outcome.actual)!==JSON.stringify(target))r.revised=true;continue;}
   r.outcome={targetDate:target.date,evaluatedAt:now,actual:{...target},covered:target.low>=r.lower&&target.high<=r.upper,baselineCovered:target.low>=r.baseline.lower&&target.high<=r.baseline.upper};
  }
 }
 function summary(j){const scored=j.predictions.filter(r=>r.eligible&&r.outcome&&!r.revised&&!r.inputRevised&&!r.dataIssue);return {total:j.predictions.length,n:scored.length,covered:scored.filter(r=>r.outcome.covered).length,baselineCovered:scored.filter(r=>r.outcome.baselineCovered).length};}
 function eventRisk(j,now){return j.events.filter(e=>e.category!=='一般资讯'&&e.firstSeenAt<=now&&e.publishedAt<=now&&now-e.firstSeenAt<=86400000&&now-e.publishedAt<=3*86400000).slice(-5);}
 function csv(j){const esc=x=>'"'+String(x??'').replace(/^[=+@\-]/,"'$&").replace(/"/g,'""')+'"';const rows=[['类型','记录时间ISO','内容JSON'],...j.predictions.map(r=>['预测',new Date(r.createdAt).toISOString(),JSON.stringify(r)]),...j.events.map(r=>['资讯',new Date(r.firstSeenAt).toISOString(),JSON.stringify(r)]),...j.gaps.map(r=>['采集空档',new Date(r.to).toISOString(),JSON.stringify(r)]),...j.revisions.map(r=>['数据修订',new Date(r.seenAt).toISOString(),JSON.stringify(r)])];return rows.map(r=>r.map(esc).join(',')).join('\r\n');}
 return {empty,restore,quality,observeNews,archive,settle,summary,eventRisk,csv};
});
