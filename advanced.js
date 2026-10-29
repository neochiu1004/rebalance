// ==========================================
// MCE 模組化 - advanced.js (進階分析與自動化)
// 功能: N7 除息行事曆、N8 警示中心、N9 情境模擬、N10 集中度健檢、
//       O6 XIRR、N11 報稅 CSV、N12 Gist 自動同步、本機快照 UI
// ==========================================

// ---------- N7: 股利除息行事曆（FinMind TaiwanStockDividend，欄位已實測） ----------
function finmindDividendUrl(symbol, startDate, endDate) {
    const base = 'https://api.finmindtrade.com/api/v4/data?dataset=TaiwanStockDividend&data_id='
        + encodeURIComponent(symbol) + '&start_date=' + startDate + '&end_date=' + endDate;
    return state.finmindToken ? base + '&token=' + state.finmindToken : base;
}

// 把 FinMind 股利列轉成事件：除息日、發放日、每股現金/股票股利、預估入帳。
function parseDividendEvents(rows, stock) {
    const shares = Number(stock.shares) || 0;
    return (rows || []).map(r => {
        const exDate = r.CashExDividendTradingDate || r.StockExDividendTradingDate || '';
        const cashPerShare = Number(r.CashEarningsDistribution) || 0;
        const stockPerShare = Number(r.StockEarningsDistribution) || 0;
        if (!exDate || (cashPerShare <= 0 && stockPerShare <= 0)) return null;
        return {
            symbol: stock.symbol || r.stock_id || '',
            name: stock.name || stock.symbol || '',
            exDate,
            payDate: r.CashDividendPaymentDate || '',
            cashPerShare,
            stockPerShare,
            estCash: Math.round(cashPerShare * shares)
        };
    }).filter(Boolean);
}

async function fetchDividendCalendar(force = false) {
    const cached = typeof apiCacheGet === 'function' ? apiCacheGet('mce_dividend_calendar', 12 * 3600 * 1000) : null;
    if (!force && cached) return cached.data || [];
    const holdings = (state.stocks || []).filter(s => (Number(s.shares) || 0) > 0 && s.symbol);
    if (!holdings.length) return [];
    const start = new Date(); start.setDate(start.getDate() - 200);
    const end = new Date(); end.setDate(end.getDate() + 400);
    const today = localDateStr();
    const events = [];
    for (const stock of holdings) {
        try {
            const url = finmindDividendUrl(stock.symbol, localDateStr(start), localDateStr(end));
            const json = typeof apiFetchJson === 'function' ? await apiFetchJson(url) : await (await fetch(url)).json();
            events.push(...parseDividendEvents(json.data || [], stock));
        } catch (error) {
            console.warn('除息資料抓取失敗', stock.symbol, error);
        }
    }
    const upcoming = events
        .filter(e => e.exDate >= today)
        .sort((a, b) => a.exDate.localeCompare(b.exDate));
    if (typeof apiCacheSet === 'function') apiCacheSet('mce_dividend_calendar', upcoming);
    return upcoming;
}

function cachedDividendEvents() {
    const cached = typeof apiCacheGet === 'function' ? apiCacheGet('mce_dividend_calendar', 7 * 24 * 3600 * 1000) : null;
    return cached && Array.isArray(cached.data) ? cached.data : [];
}

// ---------- N10: 集中度健檢 ----------
function computeConcentration() {
    if (typeof calculatePortfolioState !== 'function') return null;
    const metrics = calculatePortfolioState();
    const total = Number(metrics.displayTotal) || 0;
    if (total <= 0) return null;
    const holdings = (state.stocks || [])
        .map(s => ({ symbol: s.symbol, name: s.name || s.symbol, value: (Number(s.shares) || 0) * (Number(s.price) || Number(s.costPrice) || 0) }))
        .filter(h => h.value > 0)
        .sort((a, b) => b.value - a.value);
    if (!holdings.length) return null;
    const weights = holdings.map(h => ({ ...h, weight: (h.value / total) * 100 }));
    const top3Weight = weights.slice(0, 3).reduce((sum, h) => sum + h.weight, 0);
    let industryMax = null;
    if (typeof aggregateByIndustry === 'function') {
        const groups = aggregateByIndustry();
        if (groups.length) industryMax = groups.reduce((max, g) => (g.weight > (max?.weight || 0) ? g : max), null);
    }
    const warnings = [];
    if (weights[0] && weights[0].weight > 30) warnings.push(`單一持股「${weights[0].name}」占比 ${weights[0].weight.toFixed(1)}%，超過 30%`);
    if (top3Weight > 60) warnings.push(`前三大持股合計 ${top3Weight.toFixed(1)}%，超過 60%`);
    if (industryMax && industryMax.weight > 50) warnings.push(`單一產業「${industryMax.name}」占比 ${industryMax.weight.toFixed(1)}%，超過 50%`);
    return { weights, top3Weight, industryMax, warnings, count: weights.length };
}

// ---------- N9: 情境模擬（以個股 Beta 推估大盤衝擊） ----------
let scenarioShock = -10;
function computeScenario(shockPct) {
    if (typeof calculatePortfolioState !== 'function') return null;
    const metrics = calculatePortfolioState();
    const total = Number(metrics.displayTotal) || 0;
    if (total <= 0) return null;
    let stockImpact = 0;
    (state.stocks || []).forEach(s => {
        const value = (Number(s.shares) || 0) * (Number(s.price) || Number(s.costPrice) || 0);
        if (value <= 0) return;
        const beta = Number.isFinite(Number(s.beta)) ? Number(s.beta) : 1;
        stockImpact += value * (shockPct / 100) * beta;
    });
    const newTotal = total + stockImpact;
    const cash = Number(state.cash) || 0;
    return {
        shockPct,
        impact: stockImpact,
        newTotal,
        changePct: total > 0 ? (stockImpact / total) * 100 : 0,
        cashRatioAfter: newTotal > 0 ? (cash / newTotal) * 100 : 0
    };
}
function setScenarioShock(value) {
    scenarioShock = Number(value) || 0;
    lastAdvancedRenderAt = 0;
    renderAdvancedCards();
}

// ---------- N8: 警示中心 ----------
function buildAlerts(dividendEvents) {
    const alerts = [];
    if (typeof computeRebalanceAlerts === 'function') {
        computeRebalanceAlerts().forEach(a => alerts.push({ level: 'warn', text: `再平衡偏離：${a.name} 現 ${a.currentWeight.toFixed(1)}% → 目標 ${a.targetWeight.toFixed(1)}%` }));
    }
    const conc = computeConcentration();
    if (conc) conc.warnings.forEach(w => alerts.push({ level: 'warn', text: `集中度：${w}` }));
    (state.stocks || []).forEach(s => {
        const cost = typeof calculateAllInCost === 'function' ? calculateAllInCost(s, Number(s.price) || 0) : null;
        const price = Number(s.price) || 0;
        if (cost && cost.totalCost > 0 && price > 0 && (Number(s.shares) || 0) > 0) {
            const pnlPct = (((Number(s.shares) * price) - cost.totalCost) / cost.totalCost) * 100;
            if (pnlPct <= -15) alerts.push({ level: 'danger', text: `未實現虧損：${s.name || s.symbol} ${pnlPct.toFixed(1)}%` });
        }
    });
    const today = localDateStr();
    const in14 = new Date(); in14.setDate(in14.getDate() + 14);
    (dividendEvents || []).forEach(e => {
        if (e.exDate >= today && e.exDate <= localDateStr(in14)) {
            alerts.push({ level: 'info', text: `即將除息：${e.name} ${e.exDate.slice(5)} 除息，預估配息 NT$${fmt(e.estCash)}` });
        }
    });
    return alerts;
}

// ---------- N11: 報稅彙總（已實現逐筆 + 股利逐筆） ----------
function computeRealizedDetail(stocks) {
    const detail = [];
    (stocks || []).forEach(stock => {
        const txs = [...(stock.transactions || [])].sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));
        let shares = 0, paidCost = 0;
        txs.forEach(t => {
            const type = (t.type === 'buy' || t.type === '買進') ? 'buy' : 'sell';
            const qty = Math.max(0, parseInt(t.shares, 10) || 0);
            const price = Math.max(0, parseFloat(t.price) || 0);
            if (!qty || !price) return;
            const cost = calculateTradingCost({ type, price, shares: qty, stock, feeOverride: Number.isFinite(Number(t.fee)) ? Number(t.fee) : null });
            if (type === 'buy') { shares += qty; paidCost += cost.netAmount; }
            else {
                const avg = shares > 0 ? paidCost / shares : 0;
                detail.push({ date: t.date || '', symbol: stock.symbol || '', name: stock.name || stock.symbol || '', amount: Math.round(cost.netAmount - avg * qty) });
                shares = Math.max(0, shares - qty);
                paidCost = Math.max(0, paidCost - avg * qty);
            }
        });
    });
    return detail;
}

function exportTaxCsv(year) {
    const y = String(year);
    const realized = computeRealizedDetail(state.stocks).filter(r => r.date.startsWith(y));
    const dividends = (state.dividends || []).filter(d => String(d.date || '').startsWith(y));
    const lines = ['日期,類型,代號,名稱,金額'];
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    realized.forEach(r => lines.push([r.date, '已實現損益', r.symbol, esc(r.name), r.amount].join(',')));
    dividends.forEach(d => lines.push([d.date || '', '現金股利', d.symbol || '', esc(d.name || ''), Math.round(Number(d.amount) || 0)].join(',')));
    const realizedSum = realized.reduce((s, r) => s + r.amount, 0);
    const divSum = dividends.reduce((s, d) => s + (Number(d.amount) || 0), 0);
    lines.push(['', '合計（已實現）', '', '', realizedSum].join(','));
    lines.push(['', '合計（股利）', '', '', divSum].join(','));
    lines.push(['', '總合計', '', '', realizedSum + divSum].join(','));
    const blob = new Blob(['\ufeff' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `tax_summary_${y}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    if (typeof showToast === 'function') showToast(`${y} 年報稅彙總已匯出`);
}

// ---------- N12: Gist 自動同步（opt-in，預設關閉） ----------
function toggleGistAutoSync(checked) {
    state.gistAutoSync = !!checked;
    saveState();
    if (typeof showToast === 'function') showToast(state.gistAutoSync ? '已開啟 Gist 自動同步檢查' : '已關閉 Gist 自動同步檢查');
}

async function maybeAutoGistSync() {
    if (!state.gistAutoSync || !state.gistToken || !state.gistId) return;
    try {
        const gist = await gistApi(`/${state.gistId}`);
        const remoteUpdated = new Date(gist.updated_at || 0).getTime();
        const lastSync = state.gistLastSyncAt ? new Date(state.gistLastSyncAt).getTime() : 0;
        const localModified = Number(localStorage.getItem('mce_local_modified_at') || 0);
        // 雲端比上次同步新、且本機在同步後沒有再改動，才提示還原（避免覆蓋本機新資料）。
        if (remoteUpdated > lastSync && localModified <= lastSync) {
            const doRestore = () => gistSyncDownload();
            if (typeof showConfirm === 'function') showConfirm('雲端備份比本機新，要從雲端還原嗎？', doRestore);
            else if (confirm('雲端備份比本機新，要從雲端還原嗎？')) doRestore();
        }
    } catch (error) {
        console.warn('Gist 自動同步檢查失敗', error);
    }
}

// ---------- 本機快照 UI ----------
function createManualSnapshot() {
    if (createLocalSnapshot('manual')) {
        if (typeof showToast === 'function') showToast('已建立本機快照');
        renderSnapshotCard();
    } else if (typeof showToast === 'function') showToast('建立快照失敗（儲存空間不足）');
}

function restoreSnapshotAt(index) {
    const snapshots = listLocalSnapshots();
    const snap = snapshots[index];
    if (!snap) return;
    const doRestore = () => {
        if (restoreLocalSnapshot(index)) {
            if (typeof showToast === 'function') showToast('已還原快照（還原前狀態已自動另存一份）');
            renderSnapshotCard();
        }
    };
    const label = `${String(snap.at || '').slice(0, 16).replace('T', ' ')}（${snap.reason || ''}）`;
    if (typeof showConfirm === 'function') showConfirm(`確定要還原 ${label} 的快照嗎？\n目前狀態會先自動存成一份新快照。`, doRestore);
    else if (confirm('確定要還原這份快照嗎？')) doRestore();
}

function renderSnapshotCard() {
    const el = document.getElementById('snapshot-card');
    if (!el) return;
    const snapshots = listLocalSnapshots();
    const rows = snapshots.length
        ? snapshots.map((s, i) => `<div class="flex justify-between items-center py-1.5 border-b border-slate-50 last:border-0">
            <span class="font-bold text-slate-600">${escapeHtml(String(s.at || '').slice(0, 16).replace('T', ' '))} <span class="text-slate-400">${escapeHtml(s.reason || '')}</span></span>
            <button onclick="restoreSnapshotAt(${i})" class="text-blue-600 font-black">還原</button>
        </div>`).join('')
        : '<div class="text-slate-400 font-semibold py-1">尚無快照</div>';
    el.innerHTML = `<h2 class="font-bold text-slate-800 mb-2">本機自動備份快照</h2>
        <p class="text-xs font-semibold text-slate-400 mb-3">覆蓋匯入前、每日首次開啟會自動留一份，最多保留 5 份；只存這台裝置的瀏覽器。</p>
        <div class="text-xs mb-3">${rows}</div>
        <button onclick="createManualSnapshot()" class="w-full bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold py-3 rounded-xl text-sm">立即建立快照</button>`;
}

// ---------- 進階卡片渲染 ----------
function renderAdvancedCards() {
    const el = document.getElementById('advanced-cards');
    if (!el) return;
    const metrics = typeof calculatePortfolioState === 'function' ? calculatePortfolioState() : null;
    const divEvents = cachedDividendEvents();
    const alerts = buildAlerts(divEvents);
    const conc = computeConcentration();
    const scenario = computeScenario(scenarioShock);

    const alertsHtml = `<div class="glass-card p-4 mb-6">
        <h2 class="text-xl font-black text-slate-900 mb-2">警示中心</h2>
        ${alerts.length ? alerts.map(a => `<div class="text-xs font-bold py-1.5 border-b border-slate-50 last:border-0 ${a.level === 'danger' ? 'text-rose-600' : a.level === 'warn' ? 'text-amber-600' : 'text-slate-600'}">${a.level === 'info' ? 'ℹ️' : '⚠️'} ${escapeHtml(a.text)}</div>`).join('') : '<div class="text-xs font-semibold text-slate-400">目前沒有需要注意的事項</div>'}
    </div>`;

    const upcomingTotal = divEvents.reduce((s, e) => s + e.estCash, 0);
    const divHtml = `<div class="glass-card p-4 mb-6">
        <h2 class="text-xl font-black text-slate-900 mb-2">除息行事曆 <span class="text-[10px] font-bold text-slate-400">未來已公告除息（FinMind）</span></h2>
        <div id="dividend-calendar-body">${divEvents.length ? divEvents.slice(0, 10).map(e => `<div class="flex justify-between items-center py-1.5 border-b border-slate-50 last:border-0 text-xs">
            <span class="font-black text-slate-800">${escapeHtml(e.name)} <span class="text-slate-400 font-bold">${escapeHtml(e.symbol)}</span></span>
            <span class="font-bold text-slate-500">除息 ${escapeHtml(e.exDate)}${e.payDate ? `｜發放 ${escapeHtml(e.payDate)}` : ''}</span>
            <span class="font-black text-amber-600">預估 NT$${fmt(e.estCash)}</span>
        </div>`).join('') + `<div class="text-[10px] font-semibold text-slate-400 mt-2">預估待領合計 NT$${fmt(upcomingTotal)}（以目前股數 × 每股現金股利估算）</div>` : '<div class="text-xs font-semibold text-slate-400">載入中或近期無已公告除息…</div>'}</div>
    </div>`;

    const scenarioHtml = scenario ? `<div class="glass-card p-4 mb-6">
        <h2 class="text-xl font-black text-slate-900 mb-2">情境模擬 <span class="text-[10px] font-bold text-slate-400">以個股 Beta 推估</span></h2>
        <div class="flex gap-2 mb-3">${[-5, -10, -20].map(v => `<button onclick="setScenarioShock(${v})" class="px-3 py-1.5 rounded-lg text-xs font-black border ${scenarioShock === v ? 'bg-slate-900 text-white' : 'bg-white text-slate-700 border-slate-200'}">大盤 ${v}%</button>`).join('')}</div>
        <div class="grid grid-cols-3 gap-2 text-center">
            <div><div class="text-[10px] font-bold text-slate-400">預估影響</div><div class="text-base font-black ${scenario.impact >= 0 ? 'text-[#22C55E]' : 'text-[#EF4444]'}">${scenario.impact >= 0 ? '+' : '-'}NT$${fmt(Math.abs(scenario.impact))}</div></div>
            <div><div class="text-[10px] font-bold text-slate-400">組合變化</div><div class="text-base font-black text-slate-900">${scenario.changePct.toFixed(2)}%</div></div>
            <div><div class="text-[10px] font-bold text-slate-400">模擬後總資產</div><div class="text-base font-black text-slate-900">NT$${fmt(scenario.newTotal)}</div></div>
        </div>
        <div class="text-[10px] font-semibold text-slate-400 mt-2">模擬後現金比例約 ${scenario.cashRatioAfter.toFixed(1)}%（現金不隨大盤變動）</div>
    </div>` : '';

    const concHtml = conc ? `<div class="glass-card p-4 mb-6">
        <h2 class="text-xl font-black text-slate-900 mb-2">集中度健檢</h2>
        <div class="grid grid-cols-3 gap-2 text-center mb-2">
            <div><div class="text-[10px] font-bold text-slate-400">持股檔數</div><div class="text-base font-black text-slate-900">${conc.count}</div></div>
            <div><div class="text-[10px] font-bold text-slate-400">最大單一持股</div><div class="text-base font-black ${conc.weights[0] && conc.weights[0].weight > 30 ? 'text-rose-600' : 'text-slate-900'}">${conc.weights[0] ? conc.weights[0].weight.toFixed(1) + '%' : '—'}</div></div>
            <div><div class="text-[10px] font-bold text-slate-400">前三大合計</div><div class="text-base font-black ${conc.top3Weight > 60 ? 'text-rose-600' : 'text-slate-900'}">${conc.top3Weight.toFixed(1)}%</div></div>
        </div>
        ${conc.weights.slice(0, 5).map(h => `<div class="flex justify-between text-xs py-1 border-b border-slate-50 last:border-0"><span class="font-black text-slate-800">${escapeHtml(h.name)}</span><span class="font-bold text-slate-500">${h.weight.toFixed(1)}%</span></div>`).join('')}
        ${conc.warnings.length ? `<div class="text-[10px] font-bold text-amber-600 mt-2">${conc.warnings.map(w => escapeHtml(w)).join('；')}</div>` : '<div class="text-[10px] font-semibold text-slate-400 mt-2">集中度在一般範圍內（單一 ≤30%、前三大 ≤60%、單一產業 ≤50%）</div>'}
    </div>` : '';

    // XIRR + 報稅
    let xirrHtml = '';
    if (metrics && Array.isArray(state.cashFlows) && state.cashFlows.length) {
        const xirr = computeXirr(state.cashFlows, metrics.displayTotal, localDateStr());
        xirrHtml = `<div><div class="text-[10px] font-bold text-slate-400">XIRR 資金加權年化</div><div class="text-base font-black ${xirr !== null && xirr >= 0 ? 'text-[#22C55E]' : 'text-slate-900'}">${xirr === null ? '資料不足' : (xirr * 100).toFixed(2) + '%'}</div></div>`;
    }
    const taxYears = [...new Set([
        ...Object.keys(typeof computeRealizedByYear === 'function' ? computeRealizedByYear(state.stocks) : {}),
        ...Object.keys(aggregateDividendsByYear(state.dividends || []))
    ])].filter(y => /^\d{4}$/.test(y)).sort().reverse();
    const taxHtml = `<div class="glass-card p-4 mb-6">
        <h2 class="text-xl font-black text-slate-900 mb-2">報酬與報稅</h2>
        <div class="grid grid-cols-2 gap-2 mb-3">${xirrHtml || '<div class="text-xs font-semibold text-slate-400">XIRR 需要現金流紀錄（入金／出金）才有意義，累積幾筆後會自動出現。</div>'}
        <div><div class="text-[10px] font-bold text-slate-400">現金流筆數</div><div class="text-base font-black text-slate-900">${(state.cashFlows || []).length}</div></div></div>
        ${taxYears.length ? `<div class="flex flex-wrap gap-2">${taxYears.map(y => `<button onclick="exportTaxCsv('${y}')" class="px-3 py-1.5 rounded-lg text-xs font-black bg-white border border-slate-200 text-slate-700">匯出 ${y} 年報稅 CSV</button>`).join('')}</div>
        <div class="text-[10px] font-semibold text-slate-400 mt-2">逐筆列出該年度已實現損益與現金股利，附年度合計（申報仍以券商／國稅局資料為準）。</div>` : '<div class="text-xs font-semibold text-slate-400">尚無可匯出的年度損益資料。</div>'}
    </div>`;

    const benchCache = typeof getBenchmarkCache === 'function' ? getBenchmarkCache() : null;
    const freshness = `<div class="text-[10px] font-semibold text-slate-400 mb-4 px-1">資料新鮮度：0050 基準 ${benchCache && benchCache.fetchedDate ? benchCache.fetchedDate : '未抓取'}｜除息行事曆 ${(() => { const c = typeof apiCacheGet === 'function' ? apiCacheGet('mce_dividend_calendar') : null; return c ? dataFreshnessLabel(c.at) : '未抓取'; })()}</div>`;

    el.innerHTML = freshness + alertsHtml + divHtml + scenarioHtml + concHtml + taxHtml;
}

// ---------- 整合 ----------
let lastAdvancedRenderAt = 0;
function renderAdvancedFeatures(force = false) {
    const now = Date.now();
    if (!force && now - lastAdvancedRenderAt < 5000) return;
    lastAdvancedRenderAt = now;
    try { renderAdvancedCards(); } catch (e) { console.warn('進階卡片渲染失敗', e); }
    try { renderSnapshotCard(); } catch (e) { console.warn('快照卡渲染失敗', e); }
}

let dividendCalendarLoaded = false;
async function loadDividendCalendarOnce() {
    if (dividendCalendarLoaded) return;
    dividendCalendarLoaded = true;
    try {
        await fetchDividendCalendar();
        lastAdvancedRenderAt = 0;
        renderAdvancedCards();
    } catch (e) { console.warn('除息行事曆載入失敗', e); }
}

function initAdvancedFeatures() {
    const autoEl = document.getElementById('gist-auto-sync');
    if (autoEl) autoEl.checked = !!state.gistAutoSync;
    // 每日首次開啟自動留一份快照
    const snapshots = listLocalSnapshots();
    const today = localDateStr();
    if (!snapshots.some(s => String(s.at || '').startsWith(today))) createLocalSnapshot('auto-daily');
    renderAdvancedFeatures(true);
    loadDividendCalendarOnce();
    setTimeout(() => { maybeAutoGistSync(); }, 3000);
}

if (typeof updateAllData === 'function' && !window.__advancedWrapped) {
    window.__advancedWrapped = true;
    const originalUpdateAllDataAdv = updateAllData;
    updateAllData = function (...args) {
        const result = originalUpdateAllDataAdv.apply(this, args);
        renderAdvancedFeatures();
        return result;
    };
}
