(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.GoldInstrument=factory();})(typeof globalThis!=='undefined'?globalThis:this,function(){
 'use strict';
 function scale(price,lower,upper){
  const valid=n=>Number.isFinite(n)&&n>0;
  const band=valid(lower)&&valid(upper)&&upper>lower;
  const values=[price,band?lower:null,band?upper:null].filter(valid);
  if(!values.length)return null;
  const lo=Math.min(...values),hi=Math.max(...values),span=Math.max(hi-lo,lo*.02,.1);
  const raw=span/5,power=10**Math.floor(Math.log10(raw));
  const step=([1,2,5,10].find(n=>n*power>=raw)||10)*power;
  const min=Math.max(0,Math.floor((lo-span*.12)/step)*step),max=Math.ceil((hi+span*.12)/step)*step;
  const ticks=[];for(let n=min;n<=max+step*.001;n+=step)ticks.push(Number(n.toPrecision(12)));
  return {min,max,step,ticks,band,price:valid(price)?price:null,lower:band?lower:null,upper:band?upper:null};
 }
 return {scale};
});
