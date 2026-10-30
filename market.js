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
        return { price, changePercent: Number(q?.changePercent) || 0, change: Number(q?.change) || 0 };
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
        const add = (label, q) => { if (q) cells.push({ label, ...q }); };
        add('加權指數', taiex); add('櫃買指數', otc); add('元大台灣50', etf50);
    }
    const benchData = await fetchBenchmarkHistory();
    const risk = marketRiskSignal(benchData);

    if (!cells.length && !risk) { el.innerHTML = ''; return; }
    const cellHtml = cells.map(c => {
        const cls = c.changePercent > 0 ? 'text-rose-600' : c.changePercent < 0 ? 'text-emerald-600' : 'text-slate-500';
        const arrow = c.changePercent > 0 ? '▲' : c.changePercent < 0 ? '▼' : '—';
        const sign = c.change > 0 ? '+' : c.change < 0 ? '-' : '';
        const points = Math.abs(c.change).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        return `<div class="flex-1 min-w-[86px]"><div class="text-[10px] font-bold text-slate-400">${c.label}</div><div class="text-sm font-black text-slate-900">${fmtPrice(c.price)}</div><div class="text-[10px] font-black ${cls}">${arrow} ${sign}${points}（${sign}${Math.abs(c.changePercent).toFixed(2)}%）</div></div>`;
    }).join('');
    const riskHtml = risk ? `<div class="flex items-center gap-1.5 shrink-0 pl-2 border-l border-slate-100"><span class="w-2.5 h-2.5 rounded-full ${risk.color} animate-pulse"></span><div><div class="text-[10px] font-bold text-slate-400">大盤風險（0050）</div><div class="text-xs font-black ${risk.text}">${risk.label}・距高 ${risk.drawdown.toFixed(1)}%</div></div></div>` : '';
    el.innerHTML = `<div class="glass-card p-3.5 mb-5 flex flex-wrap items-center gap-3">${cellHtml}${riskHtml}</div>`;
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
