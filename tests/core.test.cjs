const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
const C = require(path.join(root, 'app/src/main/assets/core.js'));
const sandbox = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(root, 'app/src/main/assets/lexicon.js'), 'utf8'), sandbox);
const lex = sandbox.window.GOLD_LEXICON;
const now = Date.parse('2026-10-05T12:00:00+08:00');
test('repairs opposite duplicate 上涨 labels from the original dictionary', () => {
  assert.equal(lex.filter(x => x.word === '上涨').length, 2);
  assert.ok(C.sentiment('黄金价格上涨', lex).score > 0);
});
test('negation does not become a positive gold signal', () => {
  assert.equal(C.sentiment('黄金并未上涨', lex).score, 0);
  assert.equal(C.sentiment('黄金没有下跌', lex).score, 0);
});
test('dollar direction is interpreted relative to gold', () => {
  assert.ok(C.sentiment('美元上涨，黄金下跌', lex).score < 0);
  assert.ok(C.sentiment('美元走弱，黄金上涨', lex).score > 0);
});
test('weaker rate-hike expectation is not read as a rate hike', () => {
  assert.ok(C.sentiment('投资者下调美联储加息预期', lex).score > 0);
  assert.ok(C.sentiment('美联储降息预期降温', lex).score < 0);
});
test('unrelated macroeconomic news has no forced gold direction', () => {
  assert.equal(C.sentiment('某公司获得三亿美元融资', lex).matched, false);
  assert.equal(C.sentiment('非农数据即将公布', lex).matched, false);
});
test('longest matching phrase is counted once', () => {
  const result = C.sentiment('黄金再创新高', lex);
  assert.equal(result.hits.filter(x => x.weight).length, 1);
});
test('blank and zero quotation slots never become a price', () => {
  const q = C.parseQuote({ heyue: 'Au99.99', times: ['20:00', '20:01', '20:02'], data: ['', 0, null], delaystr: '2026年09月30日 15:45:00' });
  assert.equal(q.price, null); assert.equal(q.points.length, 0);
});
test('quotation session order crosses midnight without sorting errors', () => {
  const q = C.parseQuote({ heyue: 'Au99.99', times: ['20:00', '00:01', '09:00'], data: [900, 901, 902], delaystr: '2026年09月30日 09:01:00' });
  assert.equal(q.price, 902); assert.equal(q.points[0].time, '20:00');
});
test('source timestamp uses China time and missing timestamp is rejected', () => {
  assert.equal(C.sourceTime('2026年09月30日 15:45:00'), Date.parse('2026-09-30T15:45:00+08:00'));
  assert.throws(() => C.parseQuote({ heyue: 'Au99.99', times: [], data: [] }));
});
test('future session slots cannot overwrite the last known price', () => {
  const q = C.parseQuote({heyue:'Au99.99',times:['20:00','23:00','09:00','15:30'],data:[900,901,902,999],delaystr:'2026年09月30日 09:01:00'});
  assert.equal(q.price,902); assert.equal(q.points.length,3);
  const night=C.parseQuote({heyue:'Au99.99',times:['20:00','23:00','00:01','09:00'],data:[900,901,902,903],delaystr:'2026年09月30日 23:01:00'});
  assert.equal(night.price,901); assert.equal(night.points.length,2);
});
test('bad OHLC rows and future days are rejected; duplicates replaced', () => {
  const h = C.parseHistory({ time: [['2026-09-30',900,907,899,909], ['2026-09-30',900,908,899,909], ['2026-09-29',900,999,890,901], ['2099-01-01',1,2,1,2]] }, now);
  assert.equal(h.length, 1); assert.equal(h[0].close, 908);
});
test('holiday fallback is labeled daily close and not refreshed live price', () => {
  const h = C.parseHistory({time:[['2026-09-29',900,900,899,901],['2026-09-30',900,910,899,911]]}, now);
  const v = C.quoteView(null, h, now);
  assert.equal(v.label, '日线收盘'); assert.equal(v.date, '2026-09-30'); assert.ok(Math.abs(v.change - 1/90) < 1e-10);
});
test('old quote never overrides more recent daily history', () => {
  const q={at:Date.parse('2026-09-29T15:30:00+08:00'),price:800,points:[{price:800}]};
  const h=[{date:'2026-09-30',open:900,close:907,high:909,low:899}];
  assert.equal(C.quoteView(q,h,now).price,907);
});
test('RSI handles flat, rising, falling series without division by zero', () => {
  assert.equal(C.rsi(Array(30).fill(900)),50);
  assert.equal(C.rsi(Array.from({length:30},(_,i)=>900+i)),100);
  assert.equal(C.rsi(Array.from({length:30},(_,i)=>900-i)),0);
  assert.equal(C.rsi([1,2]),null);
});
test('insufficient historical samples do not manufacture trend', () => {
  assert.equal(C.technical([]).trend,'数据不足');
  assert.equal(C.technical([{date:'2026-09-30',close:900}]).m20,null);
});
test('news URLs, ages, dates and duplicate titles are validated', () => {
  const good={title:'黄金价格上涨',url:'https://finance.sina.com.cn/test',date:'2026-10-05',precision:'day'};
  const n=C.normalizeNews({items:[good,good,{...good,title:'bad',url:'javascript:alert(1)'},{...good,title:'old',date:'2020-01-01'}]},now);
  assert.equal(n.length,1); assert.equal(n[0].precision,'day');
});
test('sentiment aggregate excludes old news and reports sparse samples', () => {
  const n=[{title:'黄金上涨',at:now-3600000},{title:'黄金下跌',at:now-4*86400000}];
  const a=C.aggregate(n,lex,now);
  assert.equal(a.total,1); assert.equal(a.up,1); assert.equal(a.sufficient,false);
});
test('CSV preserves data time and collection time separately', () => {
  const out=C.csv([{at:now-86400000,price:900,mode:'daily',fetchedAt:now}]);
  assert.ok(out.includes('2026-10-04 12:00')); assert.ok(out.includes('2026-10-05 12:00')); assert.ok(out.includes('日线收盘'));
});
