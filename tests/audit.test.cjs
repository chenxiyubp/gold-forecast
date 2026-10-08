const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const base = path.join(__dirname, '../app/src/main/assets');
const C = require(path.join(base, 'core.js'));
const context = {window:{}};
vm.runInNewContext(fs.readFileSync(path.join(base, 'lexicon.js'), 'utf8'), context);
// Authored adversarial regression examples, NOT an independent accuracy benchmark.
for (const title of ['黄金会上涨吗？', '美元上涨压制黄金', '黄金涨幅收窄', '黄金下跌风险缓解', '黄金多头遭重挫', '美联储不会降息', '白银暴跌，黄金稳定', '黄金成交量上涨', '韩元兑美元走强', '美债价格上涨', '日本央行因通胀加息']) {
  test('ambiguous title abstains: ' + title, () => assert.equal(C.sentiment(title, context.window.GOLD_LEXICON).matched, false));
}
test('night quote compares with the already completed same-calendar-day close', () => {
  const at = Date.parse('2026-09-29T21:00:00+08:00');
  const quote = {at, price:910, points:[{price:910}]};
  const history = [{date:'2026-09-28',close:890}, {date:'2026-09-29',close:900}];
  const v = C.quoteView(quote, history, at);
  assert.equal(v.base, 900);
  assert.ok(Math.abs(v.change - (910/900-1)) < 1e-12);
});
test('RSI Wilder published example includes smoothing after initialization', () => {
  const values = [44.34,44.09,44.15,43.61,44.33,44.83,45.10,45.42,45.84,46.08,45.89,46.03,45.61,46.28,46.28,46.00];
  assert.ok(Math.abs(C.rsi(values.slice(0,15)) - 70.4641350211) < 1e-8);
  assert.ok(Math.abs(C.rsi(values) - 66.2496185536) < 1e-8);
});
test('technical averages and five-session return agree with hand calculations', () => {
  const h = Array.from({length:60}, (_,i) => ({date:'2026-09-30',close:i+1,low:i+.5,high:i+1.5}));
  const t=C.technical(h);
  assert.equal(t.m5,58); assert.equal(t.m20,50.5); assert.equal(t.m60,30.5);
  assert.equal(t.return5,60/55-1); assert.equal(t.high20,60.5); assert.equal(t.low20,40.5);
});
test('invalid calendar dates and boolean quotes are not market data', () => {
  assert.equal(C.sourceTime('2026年02月30日 12:00:00'),null);
  assert.equal(C.parseQuote({heyue:'Au99.99',times:['09:00'],data:[true],delaystr:'2026年09月30日 09:01:00'}).price,null);
  assert.throws(() => C.parseHistory({time:[['2026-02-30',900,900,899,901]]}));
});
test('future cached news cannot enter sentiment aggregation', () => {
  const now=Date.parse('2026-10-06T12:00:00+08:00');
  assert.equal(C.aggregate([{title:'黄金上涨',at:now+86400000}],[],now).total,0);
});
