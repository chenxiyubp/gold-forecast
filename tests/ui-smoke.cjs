const { chromium } = require('playwright');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const assets = path.join(root, 'app/src/main/assets');
const fixtureDir = process.argv[2] && process.argv[2] !== '--synthetic' ? path.resolve(process.argv[2]) : null;
const screenshotDir = path.resolve(process.argv[3] || path.join(root, 'build/ui-test'));
fs.mkdirSync(screenshotDir, {recursive:true});
// Reproducible synthetic inputs are test-only and never packaged into the APK.
const today=new Date(Date.now()+8*3600000).toISOString().slice(0,10);
const synthetic={
  'sge_quote.txt':{heyue:'Au99.99',times:['09:00'],data:[''],delaystr:'2026年09月30日 15:45:00'},
  'sge_daily.txt':{time:Array.from({length:60},(_,i)=>{const date=new Date(Date.UTC(2026,8,30)-(59-i)*86400000).toISOString().slice(0,10);const price=i===59?907.32:850+i;return [date,price-1,price,price-2,price+2];})},
  'news-parsed.json':{items:['美元回落，黄金价格上涨','黄金价格下跌，多头减持','美联储加息预期降温','黄金突破前期区间','黄金下跌，市场看空','黄金震荡，方向尚待观察'].map((title,i)=>({title,url:'https://finance.sina.com.cn/test-'+i,date:today,precision:'day',source:'测试数据'}))}
};
const read = name => fixtureDir ? JSON.parse(fs.readFileSync(path.join(fixtureDir, name), 'utf8')) : synthetic[name];
const server = http.createServer((req, res) => {
  const name = new URL(req.url, 'http://localhost').pathname.slice(1) || 'index.html';
  if (!/^[a-zA-Z0-9_.-]+$/.test(name)) { res.writeHead(404).end(); return; }
  const file = path.join(assets, name);
  if (!fs.existsSync(file)) { res.writeHead(404).end(); return; }
  res.setHeader('Content-Type', name.endsWith('.js') ? 'application/javascript; charset=utf-8' : name.endsWith('.css') ? 'text/css; charset=utf-8' : 'text/html; charset=utf-8');
  res.end(fs.readFileSync(file));
});
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_BIN });
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    await context.addInitScript(() => {
      window.calls = [];
      window.GoldNative = { refresh() { calls.push(['refresh']); }, setInterval(n) { calls.push(['interval', n]); }, openArticle(url) { calls.push(['article', url]); }, exportCsv(csv) { calls.push(['export', csv]); } };
    });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto('http://127.0.0.1:' + server.address().port);
    await page.waitForFunction(() => window.App);
    assert.equal(await page.locator('#price').textContent(), '—');
    assert.equal(await page.locator('#sentiment-label').textContent(), '信息不足');
    assert.equal(await page.locator('#ruler-range').textContent(),'—');
    assert.ok(await page.locator('#ruler-empty').isVisible());
    assert.ok((await page.locator('#market-timeline').textContent()).includes('暂无已记录事件'));
    const fixtures = { quote: read('sge_quote.txt'), history: read('sge_daily.txt'), news: read('news-parsed.json') };
    for (const [kind, data] of Object.entries(fixtures)) await page.evaluate(({ kind, data }) => App.receive({ kind, data, fetchedAt: Date.now() }), { kind, data });
    await page.waitForTimeout(150);
    assert.equal(await page.locator('#quote-status').textContent(), '日线收盘');
    assert.equal(await page.locator('#price').textContent(), '907.32');
    assert.ok((await page.locator('#quote-time').textContent()).includes('2026-09-30'));
    assert.ok((await page.locator('#market-warning').textContent()).includes('日线收盘'));
    assert.ok((await page.locator('#price-ruler').getAttribute('aria-label')).includes('907.32'));
    if(fixtureDir)assert.match(await page.locator('#ruler-range').textContent(),/\d+\.\d{2} — \d+\.\d{2}/);
    else assert.equal(await page.locator('#ruler-range').textContent(),'—');
    await page.screenshot({ path: path.join(screenshotDir, 'GoldSense-preview.png'), fullPage: true });
    await page.screenshot({ path: path.join(screenshotDir, 'GoldSense-phone.png') });
    for (const width of [320, 390, 540]) {
      await page.setViewportSize({ width, height: 844 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'Horizontal overflow at ' + width);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('button', { name: '资讯', exact: true }).click();
    assert.ok(await page.locator('.news-item').count() >= 5);
    await page.locator('.news-title').first().click();
    assert.ok((await page.evaluate(() => calls)).some(x => x[0] === 'article'));
    await page.locator('[data-filter="up"]').click();
    assert.ok((await page.locator('.sent-tag').allTextContents()).every(x => x === '偏多措辞'));
    await page.locator('[data-filter="all"]').click();
    for (const width of [320,390,540]) {
      await page.setViewportSize({width,height:844});
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'news overflow at '+width);
    }
    await page.setViewportSize({width:390,height:844});
    await page.screenshot({ path: path.join(screenshotDir, 'GoldSense-news.png'), fullPage: true });
    await page.getByRole('button', { name: '分析', exact: true }).click();
    assert.ok((await page.locator('#quality-summary').textContent()).includes('结构初筛'));
    assert.ok((await page.locator('#capture-summary').textContent()).includes('保存资讯'));
    await page.locator('#export-journal').click();
    assert.ok((await page.evaluate(()=>calls)).some(x=>x[0]==='export'&&x[1].includes('firstSeenAt')));
    const savedJournal=await page.evaluate(()=>JSON.parse(localStorage.getItem('goldsense-v1')).journal);
    assert.ok(savedJournal.events.length>=5);
    if(fixtureDir){assert.equal(savedJournal.predictions.length,1);assert.equal(savedJournal.predictions[0].eligible,false);}
    assert.ok((await page.locator('#forecast-target').textContent()).includes('2026-09-30'));
    if (fixtureDir) {
      assert.match(await page.locator('#forecast-range').textContent(), /\d+\.\d{2} — \d+\.\d{2}/);
      assert.ok((await page.locator('#forecast-validation').textContent()).includes('全日覆盖'));
      assert.ok((await page.locator('#forecast-baseline').textContent()).includes('基准'));
    } else assert.equal(await page.locator('#forecast-range').textContent(),'—');
    for (const width of [320,390,540]) {
      await page.setViewportSize({width,height:844});
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'Forecast overflow at '+width);
    }
    await page.setViewportSize({width:390,height:844});
    await page.screenshot({path:path.join(screenshotDir,'GoldSense-short-term.png'),fullPage:true});
    await page.evaluate(() => App.receive({kind:'history',error:'连接超时',fetchedAt:Date.now()}));
    assert.ok((await page.locator('#forecast-warning').textContent()).includes('缓存'));
    await page.locator('#manual-title').fill('美元回落，黄金价格上涨');
    await page.locator('#analyze-title').click();
    assert.ok((await page.locator('#manual-result').textContent()).includes('偏多措辞'));
    await page.locator('#manual-title').fill('<img src=x onerror=alert(1)> 黄金上涨');
    await page.locator('#analyze-title').click();
    assert.equal(await page.locator('#manual-result img').count(), 0);
    await page.getByRole('button', { name: '设置', exact: true }).click();
    for (const width of [320,390,540]) {
      await page.setViewportSize({width,height:844});
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'settings overflow at '+width);
    }
    await page.setViewportSize({width:390,height:844});
    await page.screenshot({path:path.join(screenshotDir,'GoldSense-settings.png'),fullPage:true});
    await page.locator('#interval').selectOption('120');
    assert.ok((await page.evaluate(() => calls)).some(x => x[0] === 'interval' && x[1] === 120));
    await page.locator('#export').click();
    assert.ok((await page.evaluate(() => calls)).some(x => x[0] === 'export' && x[1].includes('2026-09-30')));
    await page.reload(); await page.waitForFunction(() => window.App);
    const restoredJournal=await page.evaluate(()=>JSON.parse(localStorage.getItem('goldsense-v1')).journal);
    assert.deepEqual(restoredJournal,savedJournal);
    assert.equal(await page.locator('#price').textContent(), '907.32', 'Cache survives restart');
    await page.evaluate(() => App.receive({kind:'quote',error:'连接超时',fetchedAt:Date.now()}));
    assert.equal(await page.locator('#price').textContent(), '907.32');
    assert.ok((await page.locator('#market-warning').textContent()).includes('刷新失败'));
    await page.getByRole('button', { name: '设置', exact: true }).click();
    await page.locator('#clear').click(); await page.locator('#cancel-clear').click();
    assert.ok((await page.locator('#record-count').textContent()).includes('1'));
    await page.locator('#clear').click(); await page.locator('#confirm-clear').click();
    assert.equal(await page.locator('#record-count').textContent(), '0 条');
    assert.equal(await page.evaluate(() => App.back()), true);
    assert.equal(await page.locator('#price').textContent(), '—');
    assert.equal(await page.locator('#ruler-range').textContent(),'—');
    await page.getByRole('button', {name:'分析',exact:true}).click();
    assert.equal(await page.locator('#forecast-range').textContent(),'—');
    assert.ok((await page.locator('#journal-summary').textContent()).includes('留档 0 份'));
    assert.deepEqual(errors, []);
    console.log('PASS UI ('+(fixtureDir?'captured real-data fixtures':'synthetic fixtures')+'): data display, 3 responsive widths, navigation, news filters, local sentiment, safe text, settings bridge, CSV export, restart cache, network failure, clear confirmation, and back navigation.');
  } finally { await browser.close(); server.close(); }
})().catch(e => { console.error(e); server.close(); process.exitCode = 1; });
