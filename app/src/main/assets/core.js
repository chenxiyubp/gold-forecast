(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.GoldCore = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const finite = x => (typeof x === 'number' || typeof x === 'string' && x.trim() !== '') && Number.isFinite(Number(x));
  const number = x => finite(x) ? Number(x) : null;
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  function shanghaiDay(t = Date.now()) {
    return new Date(t + 8 * 3600000).toISOString().slice(0, 10);
  }
  function validDay(day) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
    const at = Date.parse(day + 'T00:00:00+08:00');
    return Number.isFinite(at) && shanghaiDay(at) === day;
  }
  function sourceTime(text) {
    const m = String(text || '').match(/(\d{4})[年\-/](\d{1,2})[月\-/](\d{1,2})日?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?/);
    if (!m) return null;
    const pad = s => String(s).padStart(2, '0');
    const t = Date.parse(`${m[1]}-${pad(m[2])}-${pad(m[3])}T${pad(m[4])}:${m[5]}:${m[6] || '00'}+08:00`);
    const day = `${m[1]}-${pad(m[2])}-${pad(m[3])}`;
    return validDay(day) && Number(m[4]) < 24 && Number(m[5]) < 60 && Number(m[6] || 0) < 60 && Number.isFinite(t) ? t : null;
  }
  function parseQuote(raw) {
    if (!raw || raw.heyue !== 'Au99.99' || !Array.isArray(raw.times) || !Array.isArray(raw.data)) throw Error('行情格式不受支持');
    const at = sourceTime(raw.delaystr);
    if (!at) throw Error('行情缺少有效数据时间');
    const clock = new Date(at + 8 * 3600000);
    const sessionMinute = minute => minute >= 20 * 60 ? minute - 20 * 60 : minute + 4 * 60;
    const cutoff = sessionMinute(clock.getUTCHours() * 60 + clock.getUTCMinutes());
    const points = [];
    raw.times.forEach((time, i) => {
      const p = number(raw.data[i]);
      if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)) return;
      const parts = time.split(':').map(Number);
      if (sessionMinute(parts[0] * 60 + parts[1]) <= cutoff && p !== null && p > 0) points.push({ time, price: p });
    });
    // Preserve the exchange's trading-session order (night session precedes day).
    return { symbol: 'Au99.99', at, timeText: raw.delaystr, points, price: points.length ? points[points.length - 1].price : null };
  }
  function parseHistory(raw, now = Date.now()) {
    if (!raw || !Array.isArray(raw.time)) throw Error('历史行情格式不受支持');
    const byDay = new Map();
    raw.time.forEach(row => {
      if (!Array.isArray(row) || row.length < 5 || !validDay(String(row[0])) || row[0] > shanghaiDay(now)) return;
      const [open, close, low, high] = row.slice(1, 5).map(number);
      if ([open, close, low, high].some(p => p === null || p <= 0) || high < low || high < Math.max(open, close) || low > Math.min(open, close)) return;
      byDay.set(row[0], { date: row[0], open, close, low, high });
    });
    const rows = [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date));
    if (!rows.length) throw Error('历史行情没有有效数据');
    return rows.slice(-800);
  }
  function quoteView(quote, history, now = Date.now()) {
    const last = history.length ? history[history.length - 1] : null;
    if (quote && quote.price !== null && (!last || shanghaiDay(quote.at) >= last.date)) {
      // Night trading starts a new session after the calendar day's completed close.
      const night = new Date(quote.at + 8 * 3600000).getUTCHours() >= 20;
      const prev = history.filter(h => h.date < shanghaiDay(quote.at) || night && h.date === shanghaiDay(quote.at)).at(-1);
      return { price: quote.price, at: quote.at, date: shanghaiDay(quote.at), mode: 'quote', label: now - quote.at > 1800000 ? '历史行情' : '延时行情', change: prev ? quote.price / prev.close - 1 : null, high: Math.max(...quote.points.map(p => p.price)), low: Math.min(...quote.points.map(p => p.price)), base: prev ? prev.close : null };
    }
    if (last) {
      const prev = history.length > 1 ? history[history.length - 2] : null;
      return { price: last.close, at: Date.parse(last.date + 'T15:30:00+08:00'), date: last.date, mode: 'daily', label: '日线收盘', change: prev ? last.close / prev.close - 1 : null, high: last.high, low: last.low, base: prev ? prev.close : null };
    }
    return null;
  }
  const sma = (values, length) => values.length >= length ? values.slice(-length).reduce((a, b) => a + b, 0) / length : null;
  function rsi(values, period = 14) {
    if (values.length < period + 1) return null;
    let gain = 0, loss = 0;
    for (let i = 1; i <= period; i++) { const d = values[i] - values[i - 1]; gain += Math.max(d, 0); loss += Math.max(-d, 0); }
    gain /= period; loss /= period;
    for (let i = period + 1; i < values.length; i++) { const d = values[i] - values[i - 1]; gain = (gain * (period - 1) + Math.max(d, 0)) / period; loss = (loss * (period - 1) + Math.max(-d, 0)) / period; }
    return gain === 0 && loss === 0 ? 50 : loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  }
  function technical(history) {
    const values = history.map(r => r.close), last = values.at(-1);
    const m5 = sma(values, 5), m20 = sma(values, 20), m60 = sma(values, 60);
    const trend = m20 === null ? '数据不足' : last > m20 && m5 > m20 ? '历史动量偏强' : last < m20 && m5 < m20 ? '历史动量偏弱' : '历史动量交错';
    return { m5, m20, m60, rsi: rsi(values), trend, return5: values.length > 5 ? last / values.at(-6) - 1 : null, date: history.length ? history.at(-1).date : null, high20: history.length >= 20 ? Math.max(...history.slice(-20).map(r => r.high)) : null, low20: history.length >= 20 ? Math.min(...history.slice(-20).map(r => r.low)) : null };
  }
  function dictionary(original) {
    const words = new Map();
    for (const item of original || []) if (item.word && finite(item.weight)) words.set(item.word, Number(item.weight));
    // Original CSV contains opposite duplicate labels for 上涨 and 风险.
    // Remove unspecific sentiment words: emotions about an event are not a gold signal.
    for (const word of ['风险', '面临', '迅速', '展望', '担忧', '忧虑', '忧心', '遭遇', '爆发', '散户', '有限', '假涨', '高位', '底部', '强劲', '下滑', '减少', '恶化', '稳定', '震荡', '调整']) words.delete(word);
    Object.entries({ 上涨: 1, 下跌: -1, 降息: 1, 避险: 1, 承压: -1, 走强: 1, 增持: 1, 净流出: -1, 多头: 1, 空头: -1, 收涨: 1, 跌幅: -1 }).forEach(([k, v]) => words.set(k, v));
    return [...words].sort((a, b) => b[0].length - a[0].length);
  }
  function sentiment(title, original) {
    const dict = dictionary(original), hits = [], text = String(title || '').slice(0, 500);
    const unknown = reason => ({score: 0, normalized: 0, label: '未判定', hits: [{word: reason, weight: 0}], matched: false});
    // These rules describe wording, not a model of causal economic effects.
    // Abstain on questions and semantic reversals the dictionary cannot resolve.
    if (/[？?]|是否|会不会|能否|假如|如果/.test(text)) return unknown('疑问或假设，未判定');
    if (/收窄|缓解|遭重挫|成交量|交易量|成交额|不会|否认|不再/.test(text)) return unknown('复杂语境，未判定');
    const clauses = text.split(/[，,。；;！!？?：:]/).filter(Boolean);
    let score = 0;
    for (const clause of clauses) {
      const gold = /黄金|金价|沪金|上海金|伦敦金|贵金属/.test(clause);
      const macro = /美元|美债|美联储|利率|非农|通胀/.test(clause);
      // Do not transfer another asset's direction or resolve mixed subjects by keyword.
      if (gold && (macro || /白银|银价|原油|股市|股票|比特币/.test(clause))) return unknown('多个分析对象，未判定');
      const macroOnly = !gold && macro;
      if (!gold && !macroOnly) continue;
      if (macroOnly) {
        if (/兑美元|美元兑|日本央行|欧洲央行|英国央行/.test(clause)) continue;
        const patterns = [
          [/美元(?:指数)?[^，。]{0,8}(?:走强|上涨|反弹|攀升|上行)/, -1, '美元走强（黄金压力）'],
          [/美元(?:指数)?[^，。]{0,8}(?:走弱|下跌|回落|下行)/, 1, '美元走弱（黄金支持）'],
          [/美债收益率[^，。]{0,8}(?:上涨|上升|攀升|走高)/, -1, '美债收益率上行'],
          [/美债收益率[^，。]{0,8}(?:下降|回落|走低|下行)/, 1, '美债收益率下行'],
          [/(?:降息|宽松)(?:预期)?[^，。]{0,6}(?:降温|减弱|落空|推迟|下调)/, -1, '降息预期减弱'],
          [/(?:加息|紧缩)(?:预期)?[^，。]{0,6}(?:降温|减弱|落空|下调)/, 1, '加息预期减弱'],
          [/(?:下调|减弱|降低)[^，。]{0,10}加息预期/, 1, '加息预期减弱'],
          [/(?:降息|宽松)/, 1, '宽松相关措辞'], [/(?:加息|紧缩)/, -1, '紧缩相关措辞']
        ];
        for (const [rule, weight, word] of patterns) {
          const match = clause.match(rule);
          if (match) { const before = clause.slice(Math.max(0, match.index - 4), match.index); if (/(?:不|未|没有|并非|否认)$/.test(before)) continue;
            hits.push({ word, weight, context: true }); score += weight; break; }
        }
        // Other macroeconomic headlines require interpretation, do not assign a gold direction.
        continue;
      }
      const occupied = new Array(clause.length).fill(false);
      for (const [word, weight] of dict) {
        let at = clause.indexOf(word);
        while (at !== -1) {
          if (!occupied.slice(at, at + word.length).some(Boolean)) {
            for (let i = at; i < at + word.length; i++) occupied[i] = true;
            const before = clause.slice(Math.max(0, at - 4), at);
            const negated = /(?:并未|没有|未能|并非|不会|不再|不|未)$/.test(before);
            const value = negated ? 0 : weight;
            hits.push({ word: (negated ? '否定：' : '') + word, weight: value }); score += value;
          }
          at = clause.indexOf(word, at + word.length);
        }
      }
    }
    const meaningful = hits.filter(h => h.weight !== 0);
    return { score, normalized: meaningful.length ? Math.round(clamp(score / meaningful.length, -1, 1) * 100) : 0, label: score > 0 ? '偏多措辞' : score < 0 ? '偏空措辞' : meaningful.length ? '多空交错' : '未判定', hits, matched: meaningful.length > 0 };
  }
  function normalizeNews(raw, now = Date.now()) {
    if (!raw || !Array.isArray(raw.items)) throw Error('新闻格式不受支持');
    const seen = new Set(), items = [];
    raw.items.forEach(item => {
      if (!item || typeof item.title !== 'string' || !/^https:\/\/finance\.sina\.com\.cn\//.test(item.url || '')) return;
      const title = item.title.trim().slice(0, 500), key = title.replace(/\s/g, '');
      const dayOnly = item.precision === 'day';
      const at = dayOnly ? (validDay(item.date || '') ? Date.parse(item.date + 'T00:00:00+08:00') : null) : number(item.publishedAt);
      if (!title || seen.has(key) || !at || at > now + 300000 || now - at > 7 * 86400000) return;
      seen.add(key); items.push({ title, url: item.url, at, precision: dayOnly ? 'day' : 'minute', source: String(item.source || '新浪财经').slice(0, 80) });
    });
    return items.sort((a, b) => b.at - a.at).slice(0, 100);
  }
  function aggregate(news, original, now = Date.now()) {
    const analyzed = news.filter(n => Number.isFinite(n.at) && n.at <= now && now - n.at <= 72 * 3600000).map(n => ({ ...n, analysis: sentiment(n.title, original) }));
    const matched = analyzed.filter(n => n.analysis.matched), up = matched.filter(n => n.analysis.score > 0).length, down = matched.filter(n => n.analysis.score < 0).length;
    return { items: analyzed, total: analyzed.length, matched: matched.length, up, down, neutral: analyzed.length - up - down, score: matched.length ? Math.round(matched.reduce((sum, n) => sum + n.analysis.normalized, 0) / matched.length) : null, sufficient: matched.length >= 5 };
  }
  function csv(records) {
    const escape = value => '"' + String(value ?? '').replace(/^[=+@\-]/, "'$&").replace(/"/g, '""') + '"';
    return [['数据时间（北京时间）', '品种', '价格（元/克）', '数据类型', '获取时间（北京时间）'], ...records.map(r => [formatTime(r.at), 'Au99.99', r.price, r.mode === 'daily' ? '日线收盘' : '公开行情（可能延时）', formatTime(r.fetchedAt)])].map(row => row.map(escape).join(',')).join('\r\n');
  }
  function formatTime(t) { return Number.isFinite(t) ? new Date(t + 8 * 3600000).toISOString().slice(0, 16).replace('T', ' ') : '—'; }
  return { parseQuote, parseHistory, quoteView, technical, rsi, sentiment, dictionary, normalizeNews, aggregate, csv, sourceTime, shanghaiDay, formatTime };
});
