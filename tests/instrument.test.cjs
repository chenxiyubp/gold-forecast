const test=require('node:test'),assert=require('node:assert/strict'),I=require('../app/src/main/assets/instrument.js');
test('ruler never fabricates data for an empty screen',()=>assert.equal(I.scale(null,null,null),null));
test('scale contains actual quote even when outside predicted band',()=>{for(const price of [700,907.32,1100]){const s=I.scale(price,882.75,931.89);assert.ok(s.min<Math.min(price,882.75));assert.ok(s.max>Math.max(price,931.89));assert.equal(s.band,true);assert.ok(s.ticks.length<12);}});
test('quote-only and inverted band states have no forecast band',()=>{assert.equal(I.scale(907.32,null,null).band,false);assert.equal(I.scale(907.32,940,880).band,false);assert.equal(I.scale(NaN,0,0),null);});
test('small and large positive prices keep finite nonzero scale',()=>{for(const p of [.01,1,100,10000]){const s=I.scale(p);assert.ok(Number.isFinite(s.step)&&s.step>0&&s.max>s.min);assert.ok(s.min<=p&&s.max>=p);}});
