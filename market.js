// ==========================================
// MCE 模組化 - market.js (大盤指數／基準對照／市場風險／產業)
// 功能: F1 指數條、F2 組合 vs 大盤、F4 風險儀表、F3 產業配置
// ==========================================

const BENCH_SYMBOL = '0050';
let benchChart = null;

// ---------- F2: 0050 基準歷史（FinMind，localStorage 快取，每日更新一次） ----------
function getBenchmarkCache() {
    try { return JSON.parse(localStorage.getItem('mce_benchmark_0050')) || null; } catch { return null; }
}

async function fetchBenchmarkHistory(force = false) {
    const cache = getBenchmarkCache();
    if (!force && cache && cache.fetchedDate === localDateStr() && Array.isArray(cache.data) && cache.data.length > 0) {
        return cache.data;
    }
    if (!state.finmindToken) return cache?.data || [];
    try {
        const start = new Date(); start.setDate(start.getDate() - 400);
        const url = `https://api.finmindtrade.com/api/v4/data?dataset=TaiwanStockPrice&data_id=${BENCH_SYMBOL}&start_date=${localDateStr(start)}&token=${state.finmindToken}`;
        const json = typeof apiFetchJson === 'function' ? await apiFetchJson(url) : await (await fetch(url)).json();
        if (!json.data || !json.data.length) return cache?.data || [];
        const data = json.data.filter(d => Number(d.close) > 0).map(d => ({ d: d.date, c: Number(d.close) }));
        try { localStorage.setItem('mce_benchmark_0050', JSON.stringify({ fetchedDate: localDateStr(), data })); } catch {}
        return data;
    } catch {
        return cache?.data || [];
    }
}

// 依日期對齊基準收盤（forward fill），回傳與 rows 等長的正規化累計報酬 %（起點 0）
function benchmarkCumulativeSeries(rows, benchData) {
    if (!rows.length || !benchData.length) return null;
    const sorted = [...benchData].sort((a, b) => a.d.localeCompare(b.d));
    let idx = 0, current = null;
    const closes = rows.map(row => {
        while (idx < sorted.length && sorted[idx].d <= row.date) { current = sorted[idx].c; idx += 1; }
        return current;
    });
    const base = closes.find(c => c !== null);
    if (!base) return null;
    return closes.map(c => c === null ? null : ((c / base) - 1) * 100);
}

function portfolioCumulativeSeries(rows) {
    let acc = 1;
    return rows.map(row => {
        const r = Number(row.dailyReturn) || 0;
        acc *= (1 + r / 100);
        return (acc - 1) * 100;
    });
}

async function renderBenchmarkCard() {
    const el = document.getElementById('benchmark-card');
    if (!el) return;
    const rows = typeof calculateDailyPortfolioHistory === 'function' ? calculateDailyPortfolioHistory() : [];
    if (rows.length < 2) { el.classList.add('hidden'); return; }
    const benchData = await fetchBenchmarkHistory();
    const displayRows = rows.slice(-60);
    const benchSeries = benchmarkCumulativeSeries(displayRows, benchData);
    if (!benchSeries) { el.classList.add('hidden'); return; }
    el.classList.remove('hidden');

    const portSeries = portfolioCumulativeSeries(displayRows);
    const portFinal = portSeries[portSeries.length - 1];
    const benchFinal = [...benchSeries].reverse().find(v => v !== null) ?? 0;
    const excess = portFinal - benchFinal;
    const statsEl = document.getElementById('benchmark-stats');
    if (statsEl) {
        const cls = v => v >= 0 ? 'text-[#22C55E]' : 'text-[#EF4444]';
        statsEl.innerHTML = `
            <div><div class="text-[10px] font-bold text-slate-400">你的組合</div><div class="text-lg font-black ${cls(portFinal)}">${portFinal >= 0 ? '+' : ''}${portFinal.toFixed(2)}%</div></div>
            <div><div class="text-[10px] font-bold text-slate-400">0050 同期</div><div class="text-lg font-black ${cls(benchFinal)}">${benchFinal >= 0 ? '+' : ''}${benchFinal.toFixed(2)}%</div></div>
            <div class="text-right"><div class="text-[10px] font-bold text-slate-400">超額報酬</div><div class="text-lg font-black ${cls(excess)}">${excess >= 0 ? '+' : ''}${excess.toFixed(2)}%</div></div>`;
    }

    const canvas = document.getElementById('benchmark-chart');
    if (!canvas || typeof Chart === 'undefined') return;
    if (benchChart) { benchChart.destroy(); benchChart = null; }
    benchChart = new Chart(canvas.getContext('2d'), {
        type: 'line',
        data: {
            labels: displayRows.map(r => r.date.slice(5)),
            datasets: [
                { label: '你的組合', data: portSeries, borderColor: '#2563EB', borderWidth: 2, pointRadius: 0, tension: 0.25 },
                { label: '0050', data: benchSeries, borderColor: '#94A3B8', borderWidth: 1.6, borderDash: [5, 4], pointRadius: 0, tension: 0.25 }
            ]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: { legend: { labels: { boxWidth: 10, font: { size: 10 } } }, tooltip: { callbacks: { label: c => `${c.dataset.label}: ${c.parsed.y >= 0 ? '+' : ''}${c.parsed.y.toFixed(2)}%` } } },
            scales: { x: { ticks: { maxTicksLimit: 6, font: { size: 9 } }, grid: { display: false } }, y: { ticks: { callback: v => `${v}%`, font: { size: 9 } } } }
        }
    });
}

// ---------- F1 + F4: 指數條與市場風險燈 ----------
async function fetchIndexQuote(symbol) {
    try {
        const res = await fetch(`https://api.fugle.tw/marketdata/v1.0/stock/intraday/quote/${symbol}`, { headers: { 'X-API-KEY': state.apiKey } });
        if (!res.ok) return null;
        const q = await res.json();
        const price = Number(q?.closePrice ?? q?.lastPrice ?? q?.previousClose) || 0;
        if (!price) return null;
        return {
            price, changePercent: Number(q?.changePercent) || 0, change: Number(q?.change) || 0,
            open: Number(q?.openPrice) || null, high: Number(q?.highPrice) || null, low: Number(q?.lowPrice) || null
        };
    } catch { return null; }
}

function marketRiskSignal(benchData) {
    if (!benchData || benchData.length < 60) return null;
    const hist = [...benchData].sort((a, b) => a.d.localeCompare(b.d)).map(x => ({ d: x.d, c: x.c, h: x.c, l: x.c }));
    const trend = typeof calculateTrendSignal === 'function' ? calculateTrendSignal(hist) : null;
    const closes = hist.map(x => x.c);
    const high = Math.max(...closes);
    const drawdown = high > 0 ? ((closes[closes.length - 1] / high) - 1) * 100 : 0;
    if (!trend) return null;
    const level = trend.signal === '多頭' ? { label: '多頭格局', color: 'bg-emerald-500', text: 'text-emerald-600' }
        : trend.signal === '空頭' ? { label: '空頭格局', color: 'bg-rose-500', text: 'text-rose-600' }
        : { label: '中性格局', color: 'bg-amber-500', text: 'text-amber-600' };
    return { ...level, signal: trend.signal, drawdown, ma20: trend.ma20, ma60: trend.ma60, current: trend.current };
}

async function renderMarketBar() {
    const el = document.getElementById('market-bar');
    if (!el) return;
    const cells = [];
    if (state.apiKey) {
        const [taiex, otc, etf50] = await Promise.all([fetchIndexQuote('IX0001'), fetchIndexQuote('IX0043'), fetchIndexQuote('0050')]);
        // 大盤高點卡：沿用這次已抓到的 IX0001 今日 OHLC（零額外呼叫），展開前不另抓資料
        if (taiex && Number(taiex.high) > 0) {
            taiexTodayOhlc = { open: taiex.open, high: taiex.high, low: taiex.low, close: taiex.price };
        }
        const add = (label, q) => { if (q) cells.push({ label, ...q }); };
        add('加權指數', taiex); add('櫃買指數', otc); add('元大台灣50', etf50);
    }
    const benchData = await fetchBenchmarkHistory();
    const risk = marketRiskSignal(benchData);

    if (!cells.length && !risk) { el.innerHTML = ''; renderTaiexHighsHeader(); return; }
    const cellHtml = cells.map(c => {
        const cls = c.changePercent > 0 ? 'text-rose-600' : c.changePercent < 0 ? 'text-emerald-600' : 'text-slate-500';
        const arrow = c.changePercent > 0 ? '▲' : c.changePercent < 0 ? '▼' : '—';
        const sign = c.change > 0 ? '+' : c.change < 0 ? '-' : '';
        const points = Math.abs(c.change).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        return `<div class="flex-1 min-w-[86px]"><div class="text-[10px] font-bold text-slate-400">${c.label}</div><div class="text-sm font-black text-slate-900">${fmtPrice(c.price)}</div><div class="text-[10px] font-black ${cls}">${arrow} ${sign}${points}（${sign}${Math.abs(c.changePercent).toFixed(2)}%）</div></div>`;
    }).join('');
    const riskHtml = risk ? `<div class="flex items-center gap-1.5 shrink-0 pl-2 border-l border-slate-100"><span class="w-2.5 h-2.5 rounded-full ${risk.color} animate-pulse"></span><div><div class="text-[10px] font-bold text-slate-400">大盤風險（0050）</div><div class="text-xs font-black ${risk.text}">${risk.label}・距高 ${risk.drawdown.toFixed(1)}%</div></div></div>` : '';
    el.innerHTML = `<div class="glass-card p-3.5 mb-5 flex flex-wrap items-center gap-3">${cellHtml}${riskHtml}</div>`;
    renderTaiexHighsHeader();
}

// ---------- F5: 大盤高點卡（加權指數前高／昨日高／今日高；預設折疊，展開才抓歷史） ----------
let taiexTodayOhlc = null;   // renderMarketBar 已抓到的 IX0001 今日 OHLC，零額外呼叫
let taiexHighsChart = null;
let taiexHighsExpanded = false;
let taiexHighsResult = null; // 最近一次 computeTaiexHighs 結果，供收合列摘要使用

function getTaiexHistoryCache() {
    try { return JSON.parse(localStorage.getItem('mce_taiex_history')) || null; } catch { return null; }
}

// 指數歷史日 K：以 FinMind TaiwanStockPrice（data_id=TAIEX）為主，比照 watch.js 抓個股歷史的寫法；
// FinMind 無 Token／失敗／無資料時，備援 Fugle 歷史 K 線。localStorage 每日快取一次，比照 mce_benchmark_0050 模式。
// Fugle 歷史 K 線單次查詢區間須小於 1 年，恰好或超過 1 年會回 400，故備援回溯天數必須 < 365。
const TAIEX_FUGLE_LOOKBACK_DAYS = 360;

// 純函數：FinMind 列（open/max/min/close）→ 統一 OHLC 列（max=高、min=低），過濾無效列、日期舊→新
function parseFinMindTaiexRows(data) {
    return (Array.isArray(data) ? data : [])
        .map(d => ({ date: String(d?.date || ''), open: Number(d?.open), high: Number(d?.max), low: Number(d?.min), close: Number(d?.close) }))
        .filter(d => d.date && [d.open, d.high, d.low, d.close].every(v => Number.isFinite(v) && v > 0))
        .sort((a, b) => a.date.localeCompare(b.date));
}

// 純函數：Fugle 列（open/high/low/close）→ 統一 OHLC 列，過濾無效列、日期舊→新
function parseFugleTaiexRows(data) {
    return (Array.isArray(data) ? data : [])
        .map(d => ({ date: String(d?.date || ''), open: Number(d?.open), high: Number(d?.high), low: Number(d?.low), close: Number(d?.close) }))
        .filter(d => d.date && [d.open, d.high, d.low, d.close].every(v => Number.isFinite(v) && v > 0))
        .sort((a, b) => a.date.localeCompare(b.date));
}

// 純函數：主來源有資料優先，否則用備援
function pickTaiexHistoryRows(primaryRows, fallbackRows) {
    if (Array.isArray(primaryRows) && primaryRows.length > 0) return primaryRows;
    return Array.isArray(fallbackRows) ? fallbackRows : [];
}

async function fetchTaiexHistoryFromFinMind() {
    if (!state.finmindToken) return [];
    const startDate = new Date(); startDate.setDate(startDate.getDate() - 365);
    const url = `https://api.finmindtrade.com/api/v4/data?dataset=TaiwanStockPrice&data_id=TAIEX&start_date=${localDateStr(startDate)}&token=${state.finmindToken}`;
    try {
        const res = await fetch(url);
        if (!res.ok) { console.warn(`[大盤高點] FinMind TAIEX 歷史請求失敗：HTTP ${res.status}`); return []; }
        const json = await res.json();
        if (json && json.status !== undefined && Number(json.status) !== 200) {
            console.warn(`[大盤高點] FinMind TAIEX 歷史回傳錯誤：${json.msg || json.status}`);
            return [];
        }
        const rows = parseFinMindTaiexRows(json?.data);
        if (!rows.length) console.warn('[大盤高點] FinMind TAIEX 歷史回傳無有效資料');
        return rows;
    } catch (e) {
        console.warn('[大盤高點] FinMind TAIEX 歷史請求例外', e);
        return [];
    }
}

// 純函數：Fugle 備援的查詢區間（to=今天，from=今天-備援回溯天數）
function getTaiexFugleDateRange(today = new Date()) {
    const to = new Date(today);
    const from = new Date(today); from.setDate(from.getDate() - TAIEX_FUGLE_LOOKBACK_DAYS);
    return { from: localDateStr(from), to: localDateStr(to) };
}

function buildTaiexFugleHistoryUrl(fromStr, toStr) {
    return `https://api.fugle.tw/marketdata/v1.0/stock/historical/candles/IX0001?from=${fromStr}&to=${toStr}&fields=open,high,low,close`;
}

async function fetchTaiexHistoryFromFugle() {
    if (!state.apiKey) return [];
    try {
        const { from, to } = getTaiexFugleDateRange();
        const res = await fetch(buildTaiexFugleHistoryUrl(from, to), { headers: { 'X-API-KEY': state.apiKey } });
        if (!res.ok) { console.warn(`[大盤高點] Fugle 歷史 K 線請求失敗：HTTP ${res.status}`); return []; }
        const json = await res.json();
        const rows = parseFugleTaiexRows(json?.data);
        if (!rows.length) console.warn('[大盤高點] Fugle 歷史 K 線回傳無有效資料');
        return rows;
    } catch (e) {
        console.warn('[大盤高點] Fugle 歷史 K 線請求例外', e);
        return [];
    }
}

async function fetchTaiexHistory(force = false) {
    const cache = getTaiexHistoryCache();
    if (!force && cache && cache.fetchedDate === localDateStr() && Array.isArray(cache.data) && cache.data.length > 0) {
        return cache.data;
    }
    const finmindRows = await fetchTaiexHistoryFromFinMind();
    // FinMind 有資料就不打 Fugle；為空才走備援（短路求值）
    const rows = pickTaiexHistoryRows(finmindRows, finmindRows.length ? [] : await fetchTaiexHistoryFromFugle());
    if (!rows.length) return cache?.data || [];
    try { localStorage.setItem('mce_taiex_history', JSON.stringify({ fetchedDate: localDateStr(), data: rows })); } catch {}
    return rows;
}

// 純函數：歷史日 K 正規化＋日期舊→新排序，並疊上今日盤中 OHLC（同日以盤中為準）。
// computeTaiexHighs 與 buildTaiexRecentCandles 共用同一份合併邏輯，避免兩邊分歧。
// 無今日報價（週末／假日／未開盤）時不補列，最後一根歷史 K 即「今日」。
function mergeTaiexCandles(history, todayOhlc, todayStr) {
    const rows = (Array.isArray(history) ? history : [])
        .map(d => ({
            date: String(d?.date || d?.d || ''),
            open: Number(d?.open ?? d?.o), high: Number(d?.high ?? d?.h),
            low: Number(d?.low ?? d?.l), close: Number(d?.close ?? d?.c)
        }))
        .filter(d => d.date && [d.open, d.high, d.low, d.close].every(v => Number.isFinite(v) && v > 0))
        .sort((a, b) => a.date.localeCompare(b.date));

    const tStr = todayStr || (typeof localDateStr === 'function' ? localDateStr() : '');
    const todayHighIn = Number(todayOhlc?.high);
    const hasToday = !!todayOhlc && Number.isFinite(todayHighIn) && todayHighIn > 0 && !!tStr;
    if (hasToday) {
        const close = Number(todayOhlc.close ?? todayOhlc.price) || todayHighIn;
        const row = {
            date: tStr,
            open: Number(todayOhlc.open) || close,
            high: todayHighIn,
            low: Number(todayOhlc.low) || Math.min(close, todayHighIn),
            close
        };
        const idx = rows.findIndex(r => r.date === tStr);
        if (idx >= 0) rows[idx] = row; else rows.push(row);
        rows.sort((a, b) => a.date.localeCompare(b.date));
    }
    return { rows, hasToday, tStr };
}

// 純函數：近 N 個交易日的 K 棒（日期舊→新），最後一根恆為「今日」（盤中報價優先；無報價時為最後一根歷史 K）
function buildTaiexRecentCandles(history, todayOhlc, todayStr, count = 30) {
    const { rows } = mergeTaiexCandles(history, todayOhlc, todayStr);
    const n = Number.isFinite(count) && count > 0 ? Math.floor(count) : 30;
    return rows.slice(-n);
}

// 純函數：由歷史日 K + 今日盤中 OHLC 算前高／昨日高／今日高與今日位置
// 今日盤中報價優先於同日歷史列；無今日報價（週末／假日／未開盤）時，最後一根歷史 K 即「今日」
function computeTaiexHighs(history, todayOhlc, todayStr) {
    const { rows, hasToday, tStr } = mergeTaiexCandles(history, todayOhlc, todayStr);
    if (!rows.length) return null;

    const todayIdx = hasToday ? rows.findIndex(r => r.date === tStr) : rows.length - 1;
    const today = rows[todayIdx];
    const yesterday = todayIdx >= 1 ? rows[todayIdx - 1] : null;
    let prevHigh = null, prevHighDate = null;
    for (let i = 0; i < todayIdx - 1; i++) {
        if (prevHigh === null || rows[i].high > prevHigh) { prevHigh = rows[i].high; prevHighDate = rows[i].date; }
    }
    const range = today.high - today.low;
    return {
        todayDate: today.date,
        todayOpen: today.open, todayHigh: today.high, todayLow: today.low, todayClose: today.close,
        yesterdayDate: yesterday ? yesterday.date : null,
        yesterdayHigh: yesterday ? yesterday.high : null,
        prevHigh, prevHighDate,
        distToPrevHighPoints: prevHigh !== null ? today.high - prevHigh : null,
        distToPrevHighPct: prevHigh !== null ? (today.high / prevHigh - 1) * 100 : null,
        breakthrough: prevHigh !== null ? today.high >= prevHigh : null,
        positionPct: range > 0 ? (today.close - today.low) / range * 100 : 50
    };
}

// 收合列：只顯示今日高（沿用指數條已抓的報價）與距前高 %（歷史已載入或有本機快取時）
function renderTaiexHighsHeader() {
    const card = document.getElementById('taiex-highs-card');
    if (!card) return;
    if (!state.apiKey) { card.classList.add('hidden'); return; }
    card.classList.remove('hidden');
    if (!taiexHighsResult) {
        const cache = getTaiexHistoryCache();
        if (cache && Array.isArray(cache.data) && cache.data.length) {
            taiexHighsResult = computeTaiexHighs(cache.data, taiexTodayOhlc, localDateStr());
        }
    }
    const summary = document.getElementById('taiex-highs-summary');
    if (!summary) return;
    const parts = [];
    if (taiexTodayOhlc && Number(taiexTodayOhlc.high) > 0) parts.push(`今日高 ${fmtPrice(taiexTodayOhlc.high)}`);
    if (taiexHighsResult && taiexHighsResult.distToPrevHighPct !== null && taiexHighsResult.distToPrevHighPct !== undefined) {
        const pct = taiexHighsResult.distToPrevHighPct;
        parts.push(`距前高 ${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`);
    }
    summary.textContent = parts.join('・');
}

async function toggleTaiexHighs() {
    const body = document.getElementById('taiex-highs-body');
    const chevron = document.getElementById('taiex-highs-chevron');
    if (!body) return;
    taiexHighsExpanded = !taiexHighsExpanded;
    body.classList.toggle('hidden', !taiexHighsExpanded);
    if (chevron) chevron.textContent = taiexHighsExpanded ? '▾' : '▸';
    if (taiexHighsExpanded) {
        try { await loadAndRenderTaiexHighs(); } catch (e) { console.warn('大盤高點載入失敗', e); }
    }
}

async function loadAndRenderTaiexHighs() {
    const history = await fetchTaiexHistory();
    const result = computeTaiexHighs(history, taiexTodayOhlc, localDateStr());
    taiexHighsResult = result;
    const candles = buildTaiexRecentCandles(history, taiexTodayOhlc, localDateStr());
    renderTaiexHighsBody(result, history.length > 0, candles);
    renderTaiexHighsHeader();
}

function makeTaiexHighsPlugin(result, candles) {
    const list = Array.isArray(candles) ? candles : [];
    return {
        id: 'taiexHighsCandle',
        beforeDatasetsDraw(chart) {
            if (!chart.chartArea) return;
            const { ctx, chartArea, scales } = chart;
            const yScale = scales.y;
            ctx.save();
            const drawLine = (value, color, label) => {
                if (!Number.isFinite(value)) return;
                const py = yScale.getPixelForValue(value);
                ctx.strokeStyle = color;
                ctx.fillStyle = color;
                ctx.lineWidth = 1.4;
                ctx.setLineDash([6, 4]);
                ctx.beginPath();
                ctx.moveTo(chartArea.left, py);
                ctx.lineTo(chartArea.right, py);
                ctx.stroke();
                ctx.setLineDash([]);
                ctx.font = 'bold 10px sans-serif';
                ctx.textAlign = 'right';
                ctx.fillText(`${label} ${fmtPrice(value)}`, chartArea.right - 2, py - 4);
            };
            drawLine(result.prevHigh, '#EF4444', '前高');
            drawLine(result.yesterdayHigh, '#2563EB', '昨日高');

            if (list.length) {
                // 近 30 個交易日逐根 K 棒（台股慣例：漲紅、跌綠，比照指數條）；棒寬依根數自動調整
                const slot = (chartArea.right - chartArea.left) / list.length;
                const candleWidth = Math.max(4, Math.min(14, slot * 0.62));
                list.forEach((c, i) => {
                    const x = scales.x.getPixelForValue(i);
                    const color = c.close >= c.open ? '#F43F5E' : '#10B981';
                    ctx.strokeStyle = color;
                    ctx.fillStyle = color;
                    ctx.lineWidth = 1.4;
                    ctx.beginPath();
                    ctx.moveTo(x, yScale.getPixelForValue(c.high));
                    ctx.lineTo(x, yScale.getPixelForValue(c.low));
                    ctx.stroke();
                    const top = Math.min(yScale.getPixelForValue(c.open), yScale.getPixelForValue(c.close));
                    const height = Math.max(1, Math.abs(yScale.getPixelForValue(c.close) - yScale.getPixelForValue(c.open)));
                    ctx.fillRect(x - candleWidth / 2, top, candleWidth, height);
                });

                // 現價標記（最後一根 K 的收盤，恆為最新一根）
                const lastX = scales.x.getPixelForValue(list.length - 1);
                const cy = yScale.getPixelForValue(list[list.length - 1].close);
                ctx.beginPath();
                ctx.arc(lastX + candleWidth / 2 + 6, cy, 3.5, 0, Math.PI * 2);
                ctx.fillStyle = '#0F172A';
                ctx.fill();
                ctx.lineWidth = 1.6;
                ctx.strokeStyle = '#FFFFFF';
                ctx.stroke();
            }
            ctx.restore();
        }
    };
}

function renderTaiexHighsBody(result, hasHistory, candles) {
    const valuesEl = document.getElementById('taiex-highs-values');
    const readoutEl = document.getElementById('taiex-highs-readout');
    const noteEl = document.getElementById('taiex-highs-note');
    const chartWrap = document.getElementById('taiex-highs-chart-wrap');
    const canvas = document.getElementById('taiex-highs-chart');
    if (taiexHighsChart) { taiexHighsChart.destroy(); taiexHighsChart = null; }

    if (!result) {
        if (valuesEl) valuesEl.textContent = '';
        if (readoutEl) readoutEl.textContent = '';
        if (chartWrap) chartWrap.classList.add('hidden');
        if (noteEl) { noteEl.textContent = '歷史高點資料暫時無法取得'; noteEl.classList.remove('hidden'); }
        return;
    }
    if (valuesEl) {
        const seg = [];
        seg.push(result.prevHigh !== null ? `前高 ${fmtPrice(result.prevHigh)}（${String(result.prevHighDate).slice(5)}）` : '前高 —');
        seg.push(result.yesterdayHigh !== null ? `昨日高 ${fmtPrice(result.yesterdayHigh)}（${String(result.yesterdayDate).slice(5)}）` : '昨日高 —');
        seg.push(`今日高 ${fmtPrice(result.todayHigh)}`);
        valuesEl.textContent = seg.join('・');
    }
    const noHistory = !hasHistory || result.prevHigh === null;
    if (noHistory) {
        if (readoutEl) readoutEl.textContent = '';
        if (chartWrap) chartWrap.classList.add('hidden');
        if (noteEl) { noteEl.textContent = '歷史高點資料暫時無法取得，僅顯示今日高'; noteEl.classList.remove('hidden'); }
        return;
    }
    if (noteEl) { noteEl.textContent = ''; noteEl.classList.add('hidden'); }
    if (readoutEl) {
        const dist = result.distToPrevHighPoints;
        const pct = result.distToPrevHighPct;
        readoutEl.textContent = `今日高距前高 ${dist >= 0 ? '+' : '-'}${fmtPrice(Math.abs(dist))} 點（${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%）・${result.breakthrough ? '已突破前高' : '未突破'}・現價位於今日區間 ${result.positionPct !== null ? result.positionPct.toFixed(0) + '%' : '—'}`;
    }
    if (chartWrap) chartWrap.classList.remove('hidden');
    if (!canvas || typeof Chart === 'undefined') return;
    const list = Array.isArray(candles) ? candles : [];
    if (!list.length) return;
    // Y 軸涵蓋近 30 根 K 的高低與前高／昨日高兩條線（前高遠高於近月區間時 K 棒偏低屬預期，不裁切線）
    const vals = [...list.flatMap(c => [c.low, c.high]), result.yesterdayHigh, result.prevHigh].filter(Number.isFinite);
    const min = Math.min(...vals), max = Math.max(...vals);
    const pad = Math.max((max - min) * 0.08, 1);
    taiexHighsChart = new Chart(canvas.getContext('2d'), {
        type: 'line',
        data: {
            labels: list.map(c => String(c.date).slice(5)),
            datasets: [{ data: list.map(c => c.close), borderColor: 'rgba(0,0,0,0)', backgroundColor: 'rgba(0,0,0,0)', pointRadius: 0 }]
        },
        options: {
            responsive: true, maintainAspectRatio: false, animation: false,
            plugins: { legend: { display: false }, tooltip: { enabled: false } },
            scales: {
                x: { grid: { display: false }, ticks: { font: { size: 9 }, maxTicksLimit: 6 } },
                y: { min: min - pad, max: max + pad, ticks: { font: { size: 9 }, maxTicksLimit: 6, callback: v => fmtPrice(v) } }
            }
        },
        plugins: [makeTaiexHighsPlugin(result, list)]
    });
}

// ---------- F3: 產業分類與配置 ----------
function getIndustryCache() {
    try { return JSON.parse(localStorage.getItem('mce_industry_map')) || null; } catch { return null; }
}

async function ensureIndustryMap() {
    const cache = getIndustryCache();
    const stale = !cache || !cache.fetchedAt || (Date.now() - cache.fetchedAt > 30 * 24 * 3600 * 1000);
    if (!stale) return cache.map || {};
    if (!state.finmindToken) return cache?.map || {};
    try {
        const infoUrl = 'https://api.finmindtrade.com/api/v4/data?dataset=TaiwanStockInfo&token=' + state.finmindToken;
        const json = typeof apiFetchJson === 'function' ? await apiFetchJson(infoUrl) : await (await fetch(infoUrl)).json();
        if (!Array.isArray(json.data)) return cache?.map || {};
        const map = {};
        json.data.forEach(row => { if (row.stock_id && row.industry_category) map[String(row.stock_id)] = row.industry_category; });
        if (Object.keys(map).length) {
            try { localStorage.setItem('mce_industry_map', JSON.stringify({ fetchedAt: Date.now(), map })); } catch {}
        }
        return map;
    } catch { return cache?.map || {}; }
}

function aggregateByIndustry() {
    const groups = new Map();
    let totalValue = 0;
    (state.stocks || []).forEach(s => {
        const price = Number(s.price) || Number(s.costPrice) || 0;
        const value = (Number(s.shares) || 0) * price;
        if (value <= 0) return;
        totalValue += value;
        const name = s.industry || '未分類';
        if (!groups.has(name)) groups.set(name, { name, value: 0, pnl: 0, momentumWeighted: 0, momentumBase: 0 });
        const g = groups.get(name);
        g.value += value;
        const allIn = typeof calculateAllInCost === 'function' ? calculateAllInCost(s, price) : { totalCost: value };
        g.pnl += value - allIn.totalCost;
        // 近 20 個交易日動能：以歷史收盤計算單檔報酬，依市值加權
        const hist = (Array.isArray(s.historyData) ? s.historyData : []).filter(x => Number(x.c) > 0);
        if (hist.length > 20) {
            const last = Number(hist[hist.length - 1].c);
            const prev = Number(hist[hist.length - 21].c);
            if (prev > 0) { g.momentumWeighted += (last / prev - 1) * value; g.momentumBase += value; }
        }
    });
    return [...groups.values()].map(g => ({
        ...g,
        weight: totalValue > 0 ? (g.value / totalValue) * 100 : 0,
        momentum: g.momentumBase > 0 ? (g.momentumWeighted / g.momentumBase) * 100 : null
    })).sort((a, b) => b.value - a.value);
}

async function renderIndustryCard() {
    const el = document.getElementById('industry-card');
    if (!el) return;
    const map = await ensureIndustryMap();
    let changed = false;
    (state.stocks || []).forEach(s => {
        const ind = map[String(s.symbol || '')];
        if (ind && s.industry !== ind) { s.industry = ind; changed = true; }
    });
    if (changed) saveState();
    const groups = aggregateByIndustry();
    if (!groups.length) { el.classList.add('hidden'); return; }
    el.classList.remove('hidden');
    const body = document.getElementById('industry-body');
    if (!body) return;
    body.innerHTML = groups.map(g => {
        const pnlCls = g.pnl >= 0 ? 'text-[#22C55E]' : 'text-[#EF4444]';
        const mom = g.momentum === null ? '<span class="text-slate-400">—</span>'
            : `<span class="${g.momentum >= 0 ? 'text-rose-600' : 'text-emerald-600'} font-black">${g.momentum >= 0 ? '▲' : '▼'} ${Math.abs(g.momentum).toFixed(1)}%</span>`;
        return `<div class="flex items-center gap-3 py-2 border-b border-slate-50 last:border-0">
            <div class="flex-1 min-w-0"><div class="text-xs font-black text-slate-800 truncate">${escapeHtml(g.name)}</div>
            <div class="h-1.5 bg-slate-100 rounded-full mt-1 overflow-hidden"><div class="h-full bg-blue-500 rounded-full" style="width:${Math.min(100, g.weight).toFixed(1)}%"></div></div></div>
            <div class="text-right shrink-0 w-[64px]"><div class="text-xs font-black text-slate-900">${g.weight.toFixed(1)}%</div><div class="text-[10px] font-bold text-slate-400">NT$${fmt(g.value)}</div></div>
            <div class="text-right shrink-0 w-[76px]"><div class="text-[10px] font-bold text-slate-400">未實現</div><div class="text-xs font-black ${pnlCls}">${g.pnl >= 0 ? '+' : '-'}${fmt(Math.abs(g.pnl))}</div></div>
            <div class="text-right shrink-0 w-[58px]"><div class="text-[10px] font-bold text-slate-400">20日動能</div><div class="text-xs">${mom}</div></div>
        </div>`;
    }).join('');
}

// ---------- 整合：包裝 updateAllData，頁面開啟時啟動 ----------
let lastMarketRenderAt = 0;
async function renderMarketFeatures() {
    const now = Date.now();
    if (now - lastMarketRenderAt < 20000) return; // 節流：updateAllData 觸發頻繁，指數/產業不必每次重抓
    lastMarketRenderAt = now;
    try { await renderMarketBar(); } catch (e) { console.warn('指數條渲染失敗', e); }
    try { await renderBenchmarkCard(); } catch (e) { console.warn('基準對照渲染失敗', e); }
    try { await renderIndustryCard(); } catch (e) { console.warn('產業卡渲染失敗', e); }
}

if (typeof updateAllData === 'function' && !window.__marketWrapped) {
    window.__marketWrapped = true;
    const originalUpdateAllData = updateAllData;
    updateAllData = function (...args) {
        const result = originalUpdateAllData.apply(this, args);
        renderMarketFeatures();
        return result;
    };
}
