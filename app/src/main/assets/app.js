'use strict';
(() => {
  const C = window.GoldCore, lexicon = window.GOLD_LEXICON, $ = id => document.getElementById(id);
  const storageKey = 'goldsense-v1', native = window.GoldNative;
  const state = { quote: null, history: [], news: [], records: [], status: {}, page: 'market', filter: 'all', chart: '30', interval: 60 };
  let toastTimer, busyTimer;
  let forecastRows, forecastDay, forecastFetchedAt, forecastResult;
  const J = window.GoldJournal;
  let journal = J.empty(), dataQuality = {flags:[],blocked:false,rejected:0};
  const money = n => n !== null && Number.isFinite(n) ? n.toFixed(2) : '—';
  const signed = n => n === null ? '—' : (n > 0 ? '+' : '') + (n * 100).toFixed(2) + '%';
  const color = n => n > 0 ? 'up' : n < 0 ? 'down' : 'muted';
  function node(tag, className, text) { const el = document.createElement(tag); if (className) el.className = className; if (text !== undefined) el.textContent = text; return el; }
  function set(id, text) { $(id).textContent = text; }
  function toast(message) { set('toast', message); $('toast').classList.remove('hidden'); clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').classList.add('hidden'), 3800); }
  function save() { try { localStorage.setItem(storageKey, JSON.stringify({ quote: state.quote, history: state.history, news: state.news, records: state.records, status: state.status, journal, dataQuality })); } catch (_) { toast('手机存储空间不足，最新数据暂未保存'); } }
  function restore() {
    try {
      const value = JSON.parse(localStorage.getItem(storageKey) || '{}');
      if (value.quote && Number.isFinite(value.quote.at) && Array.isArray(value.quote.points)) state.quote = value.quote;
      if (Array.isArray(value.history)) state.history = value.history.filter(r => Number.isFinite(r.close) && r.close > 0 && /^\d{4}-\d{2}-\d{2}$/.test(r.date)).slice(-800);
      if (Array.isArray(value.news)) state.news = value.news.filter(r => typeof r.title === 'string' && Number.isFinite(r.at) && /^https:\/\/finance\.sina\.com\.cn\//.test(r.url)).slice(0, 100);
      if (Array.isArray(value.records)) state.records = value.records.filter(r => Number.isFinite(r.price) && Number.isFinite(r.at)).slice(-2000);
      if (value.status && typeof value.status === 'object') state.status = value.status;
      journal = J.restore(value.journal);
      dataQuality = J.quality(state.history);
      if (value.dataQuality?.rejected) dataQuality.rejected = value.dataQuality.rejected;
      if (value.dataQuality?.blocked) dataQuality.blocked = true;
    } catch (_) { /* Empty or corrupted cache is not presented as valid data. */ }
  }
  function record(fetchedAt) {
    const v = C.quoteView(state.quote, state.history);
    if (!v) return;
    const last = state.records.at(-1);
    if (last && last.at === v.at && last.price === v.price && last.mode === v.mode) return;
    state.records.push({ at: v.at, price: v.price, mode: v.mode, fetchedAt });
    state.records = state.records.slice(-2000);
  }
  function receive(event) {
    if (!event || typeof event.kind !== 'string') return;
    if (event.kind === 'notice') { toast(String(event.data)); return; }
    if (event.kind === 'settings') { state.interval = event.interval; $('interval').value = String(event.interval); render(); return; }
    if (!['quote', 'history', 'news'].includes(event.kind)) return;
    const previous = state.status[event.kind] || {};
    if (event.error) state.status[event.kind] = { ...previous, checkedAt: event.fetchedAt, error: String(event.error).slice(0, 200) };
    else {
      try {
        if (event.kind === 'quote') state.quote = C.parseQuote(event.data);
        if (event.kind === 'history') {
          const next = C.parseHistory(event.data);
          dataQuality = J.quality(next,state.history);
          const rejected = event.data.time.filter(row=>{try {C.parseHistory({time:[row]});return false;}catch(_){return true;}});
          dataQuality.rejected = rejected.length;
          if (rejected.some(row=>Array.isArray(row)&&row[0]>=next.slice(-135)[0]?.date&&row[0]<=C.shanghaiDay())) dataQuality.blocked=true;
          journal.revisions.push(...dataQuality.revisions.map(r=>({...r,seenAt:Date.now()})));
          journal.revisions=journal.revisions.slice(-200);
          for(const p of journal.predictions) if(dataQuality.revisions.some(r=>r.date<=p.baseDate)) p.inputRevised=true;
          state.history=next;
        }
        if (event.kind === 'news') {state.news = C.normalizeNews(event.data);J.observeNews(journal,state.news,Date.now());}
        state.status[event.kind] = { checkedAt: event.fetchedAt, successAt: event.fetchedAt, error: null, fallback: Boolean(event.data.fallback), source: event.data.source || '上海黄金交易所' };
        if (event.kind !== 'news') record(event.fetchedAt);
        if (event.kind === 'history') {
          J.settle(journal,state.history,Date.now(),event.fetchedAt);
          const result=window.GoldForecast.run(state.history,Date.now(),event.fetchedAt);
          J.archive(journal,result,state.history,Date.now(),event.fetchedAt,dataQuality.blocked);
        }
      } catch (e) { state.status[event.kind] = { ...previous, checkedAt: event.fetchedAt, error: e.message }; }
    }
    save(); render(); $('refresh').classList.remove('loading');
  }
  function showPage(page) {
    if (!['market', 'news', 'analysis', 'settings'].includes(page)) return;
    state.page = page;
    document.querySelectorAll('.page').forEach(el => el.classList.toggle('active', el.id === 'page-' + page));
    document.querySelectorAll('[data-page]').forEach(el => { el.classList.toggle('selected', el.dataset.page === page); el.setAttribute('aria-current', el.dataset.page === page ? 'page' : 'false'); });
    window.scrollTo(0, 0); render();
  }
  function warning(id, message) { set(id, message || ''); $(id).classList.toggle('hidden', !message); }
  function renderMarket() {
    const v = C.quoteView(state.quote, state.history), tech = C.technical(state.history), agg = C.aggregate(state.news, lexicon);
    set('price', v ? money(v.price) : '—'); set('quote-status', v ? v.label : '等待数据');
    set('change', v ? signed(v.change) : '尚无行情'); $('change').className = v ? color(v.change) : 'muted';
    set('high', v ? money(v.high) : '—'); set('low', v ? money(v.low) : '—'); set('previous', v ? money(v.base) : '—');
    set('high-label', v?.mode === 'quote' ? '分时采样最高' : '日线最高');
    set('low-label', v?.mode === 'quote' ? '分时采样最低' : '日线最低');
    set('quote-time', v ? '数据 ' + (v.mode === 'daily' ? v.date + ' 收盘' : C.formatTime(v.at)) : '数据时间 —');
    const quoteError = state.status.quote?.error, historyError = state.status.history?.error;
    let message = '';
    if (v && v.mode === 'daily') message = '分时暂无有效报价，显示 ' + v.date + ' 日线收盘。休市期间不会产生新成交。';
    else if (v && Date.now() - v.at > 1800000) message = '当前展示历史数据，请留意数据时间；自动刷新不等于上游行情已更新。';
    if (quoteError) message = '行情刷新失败，' + (v ? '保留已有数据。' : '暂时没有报价。') + '原因：' + quoteError;
    if (!v && historyError && quoteError) message = '暂时无法取得行情。请检查网络后点击右上角刷新；手动标题分析仍可使用。';
    warning('market-warning', message);
    set('sentiment-label', !agg.matched ? '信息不足' : !agg.sufficient ? '样本较少' : agg.score > 15 ? '措辞整体偏多' : agg.score < -15 ? '措辞整体偏空' : '多空措辞交错');
    set('sentiment-sub', `近72小时 ${agg.total}条 · 命中规则 ${agg.matched}条`);
    set('sentiment-score', agg.score === null ? '—' : (agg.score > 0 ? '+' : '') + agg.score);
    $('sentiment-score').className = agg.score === null ? 'muted' : color(agg.score);
    $('sentiment-marker').style.left = ((agg.score ?? 0) + 100) / 2 + '%';
    set('news-up', agg.up); set('news-down', agg.down); set('news-neutral', agg.neutral);
    set('trend-title', tech.trend); set('trend-detail', tech.date ? '日线截至 ' + tech.date : '等待历史价格'); set('return5', signed(tech.return5)); $('return5').className = color(tech.return5);
    set('refresh-desc', state.interval === 0 ? '仅手动' : '每' + state.interval + '秒');
    const checked = Math.max(...Object.values(state.status).map(s => s.checkedAt || 0), 0);
    set('last-check', checked ? '最近获取 ' + C.formatTime(checked) : '尚未获取');
    if (state.page === 'market') { renderInstrument(v); requestAnimationFrame(drawChart); }
  }
  function drawChart() {
    const canvas = $('price-chart'), wrap = canvas.parentElement, width = wrap.clientWidth, height = wrap.clientHeight;
    if (!width) return;
    const ratio = Math.min(window.devicePixelRatio || 1, 3); canvas.width = width * ratio; canvas.height = height * ratio;
    const ctx = canvas.getContext('2d'); ctx.scale(ratio, ratio); ctx.clearRect(0, 0, width, height);
    const intraday = state.chart === 'day';
    const points = intraday ? (state.quote?.points || []).map(p => ({ label: p.time, value: p.price })) : state.history.slice(-Number(state.chart)).map(r => ({ label: r.date.slice(5), value: r.close }));
    set('chart-note', intraday ? '上游分时 · 可能延时' : '日线收盘 · 元/克');
    set('chart-start', points.length ? points[0].label : '—'); set('chart-end', points.length ? points.at(-1).label : '—');
    $('chart-empty').classList.toggle('hidden', points.length > 0); set('chart-empty', intraday ? '本次分时暂无有效报价，可切换日线' : '联网后显示真实行情');
    if (!points.length) return;
    const prices = points.map(p => p.value), low = Math.min(...prices), high = Math.max(...prices), margin = Math.max((high - low) * .15, .5);
    const min = low - margin, max = high + margin, left = 3, right = width - 48, top = 10, bottom = height - 12;
    const x = i => left + (right - left) * (points.length === 1 ? .5 : i / (points.length - 1));
    const y = v => bottom - (bottom - top) * (v - min) / (max - min);
    ctx.font = '9px system-ui'; ctx.lineWidth = 1;
    for (let i = 0; i < 4; i++) { const val = min + (max - min) * i / 3, yy = y(val); ctx.strokeStyle = '#304035'; ctx.setLineDash([3, 5]); ctx.beginPath(); ctx.moveTo(left, yy); ctx.lineTo(right, yy); ctx.stroke(); ctx.fillStyle = '#8d9f92'; ctx.fillText(val.toFixed(1), right + 8, yy + 3); }
    ctx.setLineDash([]);
    const gradient = ctx.createLinearGradient(0, top, 0, bottom); gradient.addColorStop(0, '#d9b87830'); gradient.addColorStop(1, '#d9b87800');
    ctx.beginPath(); ctx.moveTo(x(0), bottom); points.forEach((p, i) => ctx.lineTo(x(i), y(p.value))); ctx.lineTo(x(points.length - 1), bottom); ctx.closePath(); ctx.fillStyle = gradient; ctx.fill();
    ctx.beginPath(); points.forEach((p, i) => i ? ctx.lineTo(x(i), y(p.value)) : ctx.moveTo(x(i), y(p.value))); ctx.strokeStyle = '#d9b878'; ctx.lineWidth = 2; ctx.lineJoin = 'round'; ctx.stroke();
    ctx.beginPath(); ctx.arc(x(points.length - 1), y(points.at(-1).value), 3, 0, Math.PI * 2); ctx.fillStyle = '#e6cc94'; ctx.fill();
  }
  function hitChips(hits) { const list = node('div', 'hit-list'); hits.slice(0, 8).forEach(hit => list.append(node('span', 'hit ' + color(hit.weight), hit.word))); return list; }
  function renderNews() {
    const all = state.news.filter(n => Date.now() - n.at <= 7 * 86400000).map(n => ({ ...n, analysis: C.sentiment(n.title, lexicon) }));
    const filtered = all.filter(n => state.filter === 'all' || (state.filter === 'up' ? n.analysis.score > 0 : state.filter === 'down' ? n.analysis.score < 0 : n.analysis.score === 0));
    set('news-count', `${filtered.length} 条资讯`); const s = state.status.news;
    set('news-fetch', s?.successAt ? '获取于 ' + C.formatTime(s.successAt).slice(5) : '等待更新');
    warning('news-warning', s?.error ? '新闻刷新失败，显示本地已有资讯。' + s.error : s?.fallback ? '贵金属页面暂不可用，当前使用新浪宏观资讯备用来源。' : '');
    const root = $('news-list'); root.replaceChildren();
    if (!filtered.length) { root.append(node('div', 'empty-state', state.news.length ? '这个分类下暂时没有资讯。' : '等待获取黄金相关新闻。联网后点击右上角刷新。')); return; }
    filtered.forEach(item => {
      const article = node('article', 'news-item'), title = node('button', 'news-title', item.title);
      title.addEventListener('click', () => native ? native.openArticle(item.url) : window.open(item.url, '_blank', 'noopener,noreferrer'));
      article.append(title); const meta = node('div', 'news-meta');
      meta.append(node('span', 'sent-tag ' + color(item.analysis.score), item.analysis.label));
      meta.append(node('span', '', item.precision === 'day' ? C.shanghaiDay(item.at) + ' · 日期精度' : C.formatTime(item.at)));
      meta.append(node('span', '', item.source)); article.append(meta, hitChips(item.analysis.hits)); root.append(article);
    });
  }
  function getForecast() {
    const day = C.shanghaiDay();
    const fetchedAt = state.status.history?.successAt;
    if (forecastRows !== state.history || forecastDay !== day || forecastFetchedAt !== fetchedAt) {
      forecastRows = state.history; forecastDay = day;
      forecastFetchedAt = fetchedAt;
      forecastResult = window.GoldForecast.run(state.history, Date.now(), fetchedAt);
    }
    return forecastResult;
  }
  function renderInstrument(v) {
    const result=getForecast(),p=result.available&&!dataQuality.blocked?result.prediction:null;
    set('ruler-anchor',p?`基准 ${p.baseDate} · 该日后下一交易日`:'仅定位当前可用报价 · 区间暂无有效估计');
    set('ruler-range',p?`${money(p.lower)} — ${money(p.upper)}`:'—');
    set('ruler-status',p?'元/克 · 实验性估计':'等待有效区间');
    set('ruler-atr',p?money(p.atr):'—');
    set('ruler-coverage',p&&result.validation?.model.n?(result.validation.model.coverage*100).toFixed(1)+'%':'—');
    set('ruler-note',dataQuality.blocked?'日线存在待核验异常，暂停显示区间。':p?`指针为当前展示报价；历史覆盖不代表未来概率。${result.ageDays>3?'基准日期较早，请核对休市或数据滞后。':''}`:'标尺随价格自动缩放，暂无估计时不绘制区间。');
    requestAnimationFrame(()=>drawRuler(v?.price,p));
    const entries=J.eventRisk(journal,Date.now()).slice(-2).map(e=>({at:e.firstSeenAt,title:e.title,status:e.category+' · 待核实',timeLabel:'首次看到'}));
    const last=journal.predictions.at(-1);
    if(last)entries.push({at:last.createdAt,title:`基准 ${last.baseDate} 的预测已留档`,status:last.eligible?'等待或查看后续验证':'补记 · 不纳入前瞻统计',timeLabel:'留档时间'});
    entries.sort((a,b)=>b.at-a.at);
    const root=$('market-timeline');root.replaceChildren();
    if(!entries.length){root.append(node('p','timeline-empty','暂无已记录事件。联网获取资讯和历史行情后，在这里查看事件时间与留档状态。'));return;}
    const list=node('div','timeline');
    entries.slice(0,3).forEach(e=>{const row=node('div','timeline-entry');row.append(node('time','',C.formatTime(e.at)+' / '+e.timeLabel),node('p','',e.title),node('small','',e.status));list.append(row);});root.append(list);
  }
  function drawRuler(price,p) {
    const canvas=$('price-ruler'),width=canvas.parentElement.clientWidth,height=canvas.parentElement.clientHeight;
    if(!width)return;
    const ratio=Math.min(devicePixelRatio||1,3);canvas.width=width*ratio;canvas.height=height*ratio;
    const ctx=canvas.getContext('2d');ctx.scale(ratio,ratio);ctx.clearRect(0,0,width,height);
    const s=window.GoldInstrument.scale(price,p?.lower,p?.upper);
    $('ruler-empty').classList.toggle('hidden',!!s);
    if(!s){canvas.setAttribute('aria-label','等待有效价格，价格标尺暂不可用');return;}
    canvas.setAttribute('aria-label',`当前展示报价${money(s.price)}元每克。${s.band?`实验性估计区间${money(s.lower)}至${money(s.upper)}元每克。`:'暂无有效估计区间。'}`);
    const left=19,right=width-19,x=value=>left+(value-s.min)/(s.max-s.min)*(right-left),top=26,bottom=height-40;
    if(s.band){ctx.fillStyle='#ddbc7d0c';ctx.strokeStyle='#b79e6c';ctx.lineWidth=1;ctx.fillRect(x(s.lower),top,x(s.upper)-x(s.lower),bottom-top);ctx.strokeRect(x(s.lower),top,x(s.upper)-x(s.lower),bottom-top);}
    const minor=s.step/10;
    for(let i=0;i<=Math.round((s.max-s.min)/minor);i++){const value=s.min+i*minor,major=i%10===0,medium=i%5===0;ctx.strokeStyle=major?'#a6ae98':'#60694f';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(x(value),major?top+4:medium?top+17:top+24);ctx.lineTo(x(value),bottom+5);ctx.stroke();}
    ctx.fillStyle='#b6bea9';ctx.font='10px monospace';ctx.textAlign='center';
    const stride=s.ticks.length>7?2:1;
    s.ticks.forEach((t,i)=>{if(i%stride===0)ctx.fillText(s.step<1?t.toFixed(Math.min(3,Math.max(1,-Math.floor(Math.log10(s.step))))):String(t),x(t),bottom+24);});
    if(s.price!==null){const px=x(s.price);ctx.strokeStyle='#e5c384';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(px,top-9);ctx.lineTo(px,bottom+10);ctx.stroke();ctx.fillStyle='#e5c384';ctx.beginPath();ctx.moveTo(px-5,top-13);ctx.lineTo(px+5,top-13);ctx.lineTo(px,top-5);ctx.closePath();ctx.fill();}
  }
  function renderForecast() {
    getForecast();
    const r = forecastResult, p = r.prediction, v = r.validation;
    const percent = n => n === null || n === undefined ? '—' : (n * 100).toFixed(1) + '%';
    set('forecast-target', r.baseDate ? `基准 ${r.baseDate} · 估计该日之后的下一交易日` : '等待已完成日线');
    set('forecast-range', r.available && !dataQuality.blocked ? `${money(p.lower)} — ${money(p.upper)}` : '—');
    const messages = [];
    if (!r.available) messages.push(r.reason);
    else {
      messages.push(r.quality + '，不是保证成交范围或买卖点。');
      if (r.ageDays > 3) messages.push('基准距今' + r.ageDays + '天，可能休市或数据滞后，请核对日期。');
    }
    if (state.status.history?.error) messages.push('日线刷新失败，当前依据缓存。');
    if (dataQuality.blocked) messages.push('近期日线存在待核验异常，暂停显示新估计和预测留档。');
    set('forecast-warning', messages.join(' '));
    const a = r.alignment;
    set('forecast-alignment', a ? `${a.label} · MA5 ${money(a.ma5)} / MA10 ${money(a.ma10)} / MA20 ${money(a.ma20)}` : '');
    const metrics = r.available ? [
      ['基准收盘', money(p.center), '区间中心，不预测涨跌方向'],
      ['近期波动 ATR14', money(p.atr), '元/克 · 用于调整范围宽度'],
      ['历史全日覆盖率', v.model.n ? percent(v.model.coverage) : '—', `最近${v.model.n}次逐日验证`],
      ['平均区间全宽', v.model.n ? percent(v.model.width) : '—', '宽度 ÷ 基准收盘']
    ] : [];
    $('forecast-metrics').replaceChildren(...metrics.map(([label,value,desc]) => { const el=node('div','metric'); el.append(node('span','',label),node('strong','',value),node('small','',desc)); return el; }));
    set('forecast-validation', v?.model.n ? `验证期 ${v.model.from} 至 ${v.model.to}。全日覆盖指实际最高和最低都在区间内；最近${v.recent.n}次覆盖 ${percent(v.recent.coverage)}。` : '评估需要额外的后续交易日，暂不能报告覆盖率。');
    set('forecast-baseline', v?.baseline.n ? `简单历史幅度基准：覆盖 ${percent(v.baseline.coverage)}，平均全宽 ${percent(v.baseline.width)}。宽度与超界综合损失（越低越好）：本方法 ${percent(v.model.loss)}，基准 ${percent(v.baseline.loss)}。以上为历史回放，不是实盘收益或预测胜率。` : '');
    renderJournal();
  }
  function renderJournal() {
    const s=J.summary(journal),risk=J.eventRisk(journal,Date.now());
    set('quality-summary',`无效原始行 ${dataQuality.rejected||0} 条；缓存日线异常 ${dataQuality.flags.length} 条；已记录修订 ${journal.revisions.length} 条。`+(dataQuality.blocked?'近期数据待核验，区间暂停。':'通过结构初筛；尚未逐笔跨来源核实。'));
    set('quality-detail',dataQuality.flags.slice(-5).map(f=>f.date+' '+f.reason).join('；'));
    set('journal-summary',`留档 ${s.total} 份，其中 ${s.n} 份满足提前留档且已有结果。`+(s.n?`全日覆盖 ${s.covered}/${s.n}；简单基准 ${s.baselineCovered}/${s.n}。`:'正在积累前瞻样本。'));
    set('capture-summary',`保存资讯 ${journal.events.length} 条；观测到采集空档 ${journal.gaps.length} 段。应用关闭期间可能漏采，未记录不代表没有事件。`);
    set('event-risk',risk.length?'出现重要事件候选，原区间可能失效；标题尚未核实，未据此调整价格范围。':'暂无近期重要事件候选；不代表市场没有风险。');
    const list=$('event-list');list.replaceChildren();
    risk.forEach(e=>{const el=node('div','evidence-row');el.append(node('span','',`${e.category} · ${e.interpretation}：${e.title}（首次看到 ${C.formatTime(e.firstSeenAt)}）`));list.append(el);});
    const predictions=$('prediction-list');predictions.replaceChildren();
    journal.predictions.slice(-5).reverse().forEach(p=>{const el=node('p','footnote');el.textContent=`基准 ${p.baseDate}：${money(p.lower)}—${money(p.upper)}；${p.dataIssue?'结果数据待核验，不纳入统计':p.inputRevised||p.revised?'来源已修订，不纳入统计':!p.eligible?'补记，不纳入前瞻统计':p.outcome?(p.outcome.covered?'已覆盖':'未覆盖'):'等待下一条完成日线'}。留档 ${C.formatTime(p.createdAt)}`;predictions.append(el);});
  }
  function renderAnalysis() {
    renderForecast();
    const t = C.technical(state.history); set('analysis-date', t.date ? '截至 ' + t.date : '等待历史行情');
    const metrics = [['5日均线', money(t.m5), '最近5个收盘价均值'], ['20日均线', money(t.m20), '最近20个收盘价均值'], ['60日均线', money(t.m60), '最近60个收盘价均值'], ['RSI · 14', t.rsi === null ? '—' : t.rsi.toFixed(1), '历史相对强弱指标'], ['20日最高', money(t.high20), '历史区间上沿 · 非预测'], ['20日最低', money(t.low20), '历史区间下沿 · 非预测']];
    $('technical-grid').replaceChildren(...metrics.map(([label, value, desc]) => { const div = node('div', 'metric'); div.append(node('span', '', label), node('strong', '', value), node('small', '', desc)); return div; }));
    set('technical-summary', t.m20 === null ? '需要至少20个有效交易日数据才能判断历史动量。' : `${t.trend}。${t.m5 >= t.m20 ? '5日均线位于20日均线上方。' : '5日均线位于20日均线下方。'}${t.rsi >= 70 ? 'RSI处于较高区间，历史上涨动量较强，也可能出现波动。' : t.rsi <= 30 ? 'RSI处于较低区间，历史下跌动量较强。' : 'RSI未处于常用的极端区间。'}`);
    const agg = C.aggregate(state.news, lexicon), evidence = $('evidence'); evidence.replaceChildren();
    const lines = [
      [`近72小时获取到 ${agg.total} 条相关标题，其中 ${agg.matched} 条命中可判定规则。`, 'neutral-bg'],
      [`偏多措辞 ${agg.up} 条，偏空措辞 ${agg.down} 条；其余 ${agg.neutral} 条为交错或未判定。`, 'neutral-bg'],
      [agg.sufficient ? '这是标题措辞的统计结果，不代表交易胜率；不同新闻可能来自同一事件。' : '有效样本不足5条，暂不形成整体方向结论。', 'up-bg']
    ];
    lines.forEach(([text, klass]) => { const row = node('div', 'evidence-row'); row.append(node('i', 'dot ' + klass), node('span', '', text)); evidence.append(row); });
  }
  function renderSettings() {
    const root = $('source-status'); root.replaceChildren();
    [['quote', '上金所 · 分时行情'], ['history', '上金所 · 历史日线'], ['news', '新浪财经 · 贵金属资讯']].forEach(([key, label]) => {
      const s = state.status[key], row = node('div', 'source-row'), line = node('div');
      line.append(node('span', '', label), node('span', s?.error ? 'up small' : 'down small', s?.error ? '刷新失败' : s?.successAt ? '最近获取成功' : '等待连接'));
      row.append(line, node('p', '', s?.error || (s?.successAt ? '获取于 ' + C.formatTime(s.successAt) + (s.fallback ? ' · 已启用备用资讯' : '') : '免账号 · 手机直接访问'))); root.append(row);
    });
    set('record-count', state.records.length + ' 条');
  }
  function render() { renderMarket(); if (state.page === 'news') renderNews(); if (state.page === 'analysis') renderAnalysis(); if (state.page === 'settings') renderSettings(); }
  document.querySelectorAll('[data-page]').forEach(button => button.addEventListener('click', () => showPage(button.dataset.page)));
  document.querySelectorAll('[data-go]').forEach(button => button.addEventListener('click', () => showPage(button.dataset.go)));
  document.querySelectorAll('[data-chart]').forEach(button => button.addEventListener('click', () => { state.chart = button.dataset.chart; document.querySelectorAll('[data-chart]').forEach(b => b.classList.toggle('selected', b === button)); drawChart(); }));
  document.querySelectorAll('[data-filter]').forEach(button => button.addEventListener('click', () => { state.filter = button.dataset.filter; document.querySelectorAll('[data-filter]').forEach(b => b.classList.toggle('selected', b === button)); renderNews(); }));
  $('refresh').addEventListener('click', () => { if (!native) { toast('浏览器为界面预览，请安装安卓版本连接数据'); return; } $('refresh').classList.add('loading'); clearTimeout(busyTimer); busyTimer = setTimeout(() => $('refresh').classList.remove('loading'), 30000); native.refresh(); });
  $('interval').addEventListener('change', () => { state.interval = Number($('interval').value); if (native) native.setInterval(state.interval); renderMarket(); toast(state.interval ? '已调整行情检查频率' : '已切换为手动刷新'); });
  $('analyze-title').addEventListener('click', () => {
    const title = $('manual-title').value.trim(); if (!title) { toast('请先输入一条新闻标题'); $('manual-title').focus(); return; }
    const result = C.sentiment(title, lexicon), box = $('manual-result'); box.replaceChildren(); box.classList.remove('hidden');
    box.append(node('strong', color(result.score), result.label + ' · 措辞分数 ' + (result.normalized > 0 ? '+' : '') + result.normalized));
    box.append(hitChips(result.hits), node('p', 'footnote', result.matched ? '以上是命中的关键词和语境规则，不是价格预测。' : '未找到足够明确的黄金方向措辞，保留为未判定。'));
  });
  $('export').addEventListener('click', () => { if (!state.records.length) { toast('还没有可导出的行情记录'); return; } if (native) native.exportCsv(C.csv(state.records)); else { const a = node('a'); a.href = URL.createObjectURL(new Blob(['\ufeff' + C.csv(state.records)], { type: 'text/csv;charset=utf-8' })); a.download = '金绪-行情记录.csv'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); } });
  $('export-journal').addEventListener('click',()=>{const csv=J.csv(journal);if(csv.length>1800000){toast('记录过大，暂不能一次导出');return;}if(native)native.exportCsv(csv);else{const a=node('a');a.href=URL.createObjectURL(new Blob(['\ufeff'+csv],{type:'text/csv;charset=utf-8'}));a.download='金绪-验证档案.csv';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);}});
  $('clear').addEventListener('click', () => $('clear-dialog').showModal()); $('cancel-clear').addEventListener('click', () => $('clear-dialog').close());
  $('confirm-clear').addEventListener('click', () => { state.quote = null; state.history = []; state.news = []; state.records = []; state.status = {}; journal=J.empty();dataQuality={flags:[],blocked:false,rejected:0};localStorage.removeItem(storageKey); $('clear-dialog').close(); render(); toast('本地数据已清除；后续刷新会重新获取'); });
  window.addEventListener('resize', () => { if (state.page === 'market') {drawChart();renderInstrument(C.quoteView(state.quote,state.history));} });
  window.App = { receive, back() { if ($('clear-dialog').open) { $('clear-dialog').close(); return true; } if (state.page !== 'market') { showPage('market'); return true; } return false; } };
  restore(); render();
  // This timer only refreshes displayed age/analysis; network scheduling belongs to Android lifecycle.
  setInterval(render, 60000);
})();
