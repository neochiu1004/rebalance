// ==========================================
// MCE 模組化 - advanced.js (進階分析與自動化)
// 功能: N8 警示中心、N9 情境模擬、N10 集中度健檢、
//       N12 Gist 自動同步、本機快照 UI
// ==========================================

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
function buildAlerts() {
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
    const alerts = buildAlerts();
    const conc = computeConcentration();
    const scenario = computeScenario(scenarioShock);

    const alertsHtml = `<div class="glass-card p-4 mb-6">
        <h2 class="text-xl font-black text-slate-900 mb-2">警示中心</h2>
        ${alerts.length ? alerts.map(a => `<div class="text-xs font-bold py-1.5 border-b border-slate-50 last:border-0 ${a.level === 'danger' ? 'text-rose-600' : a.level === 'warn' ? 'text-amber-600' : 'text-slate-600'}">${a.level === 'info' ? 'ℹ️' : '⚠️'} ${escapeHtml(a.text)}</div>`).join('') : '<div class="text-xs font-semibold text-slate-400">目前沒有需要注意的事項</div>'}
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

    const benchCache = typeof getBenchmarkCache === 'function' ? getBenchmarkCache() : null;
    const freshness = `<div class="text-[10px] font-semibold text-slate-400 mb-4 px-1">資料新鮮度：0050 基準 ${benchCache && benchCache.fetchedDate ? benchCache.fetchedDate : '未抓取'}</div>`;

    el.innerHTML = freshness + alertsHtml + scenarioHtml + concHtml;
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

function initAdvancedFeatures() {
    const autoEl = document.getElementById('gist-auto-sync');
    if (autoEl) autoEl.checked = !!state.gistAutoSync;
    // 每日首次開啟自動留一份快照
    const snapshots = listLocalSnapshots();
    const today = localDateStr();
    if (!snapshots.some(s => String(s.at || '').startsWith(today))) createLocalSnapshot('auto-daily');
    renderAdvancedFeatures(true);
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
