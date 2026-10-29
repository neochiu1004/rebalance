// ==========================================
// MCE 模組化 - reports.js (績效／股利／年報／提醒／雲端同步／AI／外觀)
// 功能: F5 績效指標、F6 股利中心、F7 年度報表、F8 偏離提醒、
//       F9 Gist 雲端同步、F10 AI 解讀、F11 深色模式
// ==========================================

// ---------- F5: 績效指標（由每日資產序列計算） ----------
function computePerformanceMetrics(rows) {
    if (!Array.isArray(rows) || rows.length < 2) return null;
    const returns = rows.map(r => (Number(r.dailyReturn) || 0) / 100);
    let acc = 1;
    returns.forEach(r => { acc *= (1 + r); });
    const periodReturn = (acc - 1) * 100;
    const tradingDays = rows.length - 1;
    const annualized = tradingDays > 0 ? (Math.pow(acc, 252 / tradingDays) - 1) * 100 : 0;
    const mean = returns.reduce((s, r) => s + r, 0) / returns.length;
    const variance = returns.reduce((s, r) => s + Math.pow(r - mean, 2), 0) / returns.length;
    const volatility = Math.sqrt(variance) * Math.sqrt(252) * 100;
    const sharpe = variance > 0 ? (mean / Math.sqrt(variance)) * Math.sqrt(252) : 0;
    let peak = -Infinity, maxDrawdown = 0;
    rows.forEach(r => {
        peak = Math.max(peak, r.totalValue);
        if (peak > 0) maxDrawdown = Math.min(maxDrawdown, ((r.totalValue / peak) - 1) * 100);
    });
    return { periodReturn, annualized, volatility, sharpe, maxDrawdown, tradingDays };
}

// ---------- F7: 已實現損益依年重算（與 core 的平均成本法一致） ----------
function computeRealizedByYear(stocks) {
    const byYear = {};
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
                const year = String(t.date || '').slice(0, 4) || '未知';
                byYear[year] = (byYear[year] || 0) + (cost.netAmount - avg * qty);
                shares = Math.max(0, shares - qty);
                paidCost = Math.max(0, paidCost - avg * qty);
            }
        });
    });
    return byYear;
}

function aggregateDividendsByYear(dividends) {
    const byYear = {};
    (dividends || []).forEach(d => {
        const year = String(d.date || '').slice(0, 4) || '未知';
        byYear[year] = (byYear[year] || 0) + (Number(d.amount) || 0);
    });
    return byYear;
}

// ---------- F8: 再平衡偏離提醒 ----------
function computeRebalanceAlerts() {
    if (typeof calculatePortfolioState !== 'function') return [];
    const metrics = calculatePortfolioState();
    if (!metrics.displayTotal || metrics.displayTotal <= 0) return [];
    const totalTargetWeight = metrics.totalTargetWeight || 0;
    const alerts = [];
    (state.stocks || []).forEach(s => {
        const price = Number(s.price) || Number(s.costPrice) || 0;
        if (price <= 0) return;
        const value = (Number(s.shares) || 0) * price;
        const currentWeight = (value / metrics.displayTotal) * 100;
        const targetWeight = totalTargetWeight > 0 ? ((Number(s.targetWeight) || 0) / totalTargetWeight) * (Number(state.targetStockRatio) || 0) : 0;
        const diff = currentWeight - targetWeight;
        if (Math.abs(diff) <= (Number(state.deviation) || 5)) return;
        const targetValue = (targetWeight / 100) * metrics.displayTotal;
        const deltaShares = Math.round((targetValue - value) / price);
        if (!deltaShares) return;
        const type = deltaShares > 0 ? 'buy' : 'sell';
        const est = calculateTradingCost({ type, price, shares: Math.abs(deltaShares), stock: s });
        alerts.push({ symbol: s.symbol, name: s.name || s.symbol, currentWeight, targetWeight, diff, deltaShares, estFee: est.fee, estTax: est.tax });
    });
    return alerts.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));
}

function renderRebalanceAlerts() {
    const el = document.getElementById('rebalance-alerts');
    if (!el) return;
    const alerts = computeRebalanceAlerts();
    if (!alerts.length) { el.innerHTML = ''; return; }
    el.innerHTML = `<div class="glass-card p-4 mb-4 border-l-4 border-l-amber-500">
        <div class="text-sm font-black text-slate-900 mb-2">偏離提醒（超過 ±${Number(state.deviation) || 5}%）</div>
        ${alerts.map(a => `<div class="flex justify-between items-center py-1.5 border-b border-slate-50 last:border-0 text-xs">
            <span class="font-black text-slate-800">${escapeHtml(a.name)} <span class="text-slate-400 font-bold">${escapeHtml(a.symbol || '')}</span></span>
            <span class="font-bold text-slate-500">現 ${a.currentWeight.toFixed(1)}% → 目標 ${a.targetWeight.toFixed(1)}%</span>
            <span class="font-black ${a.deltaShares > 0 ? 'text-rose-600' : 'text-emerald-600'}">${a.deltaShares > 0 ? '買' : '賣'} ${fmt(Math.abs(a.deltaShares))} 股<span class="text-slate-400 font-bold">（費稅約 ${fmt(a.estFee + a.estTax)}）</span></span>
        </div>`).join('')}
    </div>`;
}

// ---------- F5+F6+F7: 資產頁報表卡 ----------
function renderReportCards() {
    const el = document.getElementById('feature-cards');
    if (!el) return;
    const rows = typeof calculateDailyPortfolioHistory === 'function' ? calculateDailyPortfolioHistory() : [];
    const metrics = typeof calculatePortfolioState === 'function' ? calculatePortfolioState() : null;
    const perf = computePerformanceMetrics(rows);

    const perfHtml = perf ? `<div class="glass-card p-4 mb-6">
        <h2 class="text-xl font-black text-slate-900 mb-3">績效指標 <span class="text-[10px] font-bold text-slate-400">近 ${perf.tradingDays} 個交易日</span></h2>
        <div class="grid grid-cols-4 gap-2 text-center">
            <div><div class="text-[10px] font-bold text-slate-400">期間報酬</div><div class="text-base font-black ${perf.periodReturn >= 0 ? 'text-[#22C55E]' : 'text-[#EF4444]'}">${perf.periodReturn >= 0 ? '+' : ''}${perf.periodReturn.toFixed(2)}%</div></div>
            <div><div class="text-[10px] font-bold text-slate-400">年化報酬</div><div class="text-base font-black text-slate-900">${perf.annualized >= 0 ? '+' : ''}${perf.annualized.toFixed(2)}%</div></div>
            <div><div class="text-[10px] font-bold text-slate-400">年化波動</div><div class="text-base font-black text-slate-900">${perf.volatility.toFixed(2)}%</div></div>
            <div><div class="text-[10px] font-bold text-slate-400">最大回撤</div><div class="text-base font-black text-rose-600">${perf.maxDrawdown.toFixed(2)}%</div></div>
        </div>
        <div class="text-[10px] font-semibold text-slate-400 mt-2">Sharpe（無風險利率以 0 計）：${perf.sharpe.toFixed(2)}</div>
    </div>` : '';

    // 股利中心
    const dividends = Array.isArray(state.dividends) ? state.dividends : [];
    const thisYear = localDateStr().slice(0, 4);
    const divThisYear = dividends.filter(d => String(d.date || '').startsWith(thisYear)).reduce((s, d) => s + (Number(d.amount) || 0), 0);
    const divTotal = dividends.reduce((s, d) => s + (Number(d.amount) || 0), 0);
    const yieldOnCost = metrics && metrics.totalPaidCostSum > 0 ? (divTotal / metrics.totalPaidCostSum) * 100 : 0;
    const monthly = Array.from({ length: 12 }, (_, m) => dividends.filter(d => String(d.date || '').startsWith(`${thisYear}-${String(m + 1).padStart(2, '0')}`)).reduce((s, d) => s + (Number(d.amount) || 0), 0));
    const maxMonthly = Math.max(1, ...monthly);
    const monthlyHtml = monthly.map((v, m) => `<div class="flex-1 flex flex-col items-center gap-1"><div class="text-[8px] font-black ${v > 0 ? 'text-amber-600' : 'text-slate-300'}">${v > 0 ? fmt(v) : ''}</div><div class="w-full bg-amber-400/80 rounded-t" style="height:${Math.max(2, (v / maxMonthly) * 44)}px"></div><div class="text-[8px] font-bold text-slate-400">${m + 1}月</div></div>`).join('');
    const perStock = {};
    dividends.forEach(d => { perStock[d.symbol || ''] = (perStock[d.symbol || ''] || 0) + (Number(d.amount) || 0); });
    const topDiv = Object.entries(perStock).sort((a, b) => b[1] - a[1]).slice(0, 5);
    const divHtml = `<div class="glass-card p-4 mb-6">
        <h2 class="text-xl font-black text-slate-900 mb-3">股利中心</h2>
        <div class="grid grid-cols-3 gap-2 text-center mb-3">
            <div><div class="text-[10px] font-bold text-slate-400">${thisYear} 年股利</div><div class="text-base font-black text-amber-600">NT$${fmt(divThisYear)}</div></div>
            <div><div class="text-[10px] font-bold text-slate-400">累計股利</div><div class="text-base font-black text-slate-900">NT$${fmt(divTotal)}</div></div>
            <div><div class="text-[10px] font-bold text-slate-400">對成本殖利率</div><div class="text-base font-black text-slate-900">${yieldOnCost.toFixed(2)}%</div></div>
        </div>
        <div class="flex items-end gap-1 h-[76px]">${monthlyHtml}</div>
        ${topDiv.length ? `<div class="mt-3 pt-2 border-t border-slate-100">${topDiv.map(([sym, amt]) => {
            const st = (state.stocks || []).find(s => s.symbol === sym);
            return `<div class="flex justify-between text-xs py-1"><span class="font-black text-slate-800">${escapeHtml(st?.name || sym)} <span class="text-slate-400 font-bold">${escapeHtml(sym)}</span></span><span class="font-black text-amber-600">NT$${fmt(amt)}</span></div>`;
        }).join('')}</div>` : '<div class="text-[11px] font-semibold text-slate-400 mt-2">尚無股利紀錄，到個股明細用「股利」模式登錄第一筆。</div>'}
    </div>`;

    // 年度報表
    const realizedByYear = computeRealizedByYear(state.stocks || []);
    const divByYear = aggregateDividendsByYear(dividends);
    const years = [...new Set([...Object.keys(realizedByYear), ...Object.keys(divByYear)])].sort().reverse();
    const reportHtml = years.length ? `<div class="glass-card p-4 mb-6">
        <div class="flex justify-between items-center mb-3"><h2 class="text-xl font-black text-slate-900">年度損益報表</h2><button onclick="exportAnnualCsv()" class="text-xs font-black text-blue-600 bg-blue-50 px-3 py-1.5 rounded-xl border border-blue-100">匯出 CSV</button></div>
        ${years.map(y => {
            const r = realizedByYear[y] || 0, d = divByYear[y] || 0, t = r + d;
            const cls = v => v >= 0 ? 'text-[#22C55E]' : 'text-[#EF4444]';
            return `<div class="flex justify-between items-center text-xs py-1.5 border-b border-slate-50 last:border-0"><span class="font-black text-slate-800">${escapeHtml(y)} 年</span><span class="font-bold text-slate-500">已實現 <span class="${cls(r)} font-black">${r >= 0 ? '+' : '-'}${fmt(Math.abs(r))}</span></span><span class="font-bold text-slate-500">股利 <span class="text-amber-600 font-black">+${fmt(d)}</span></span><span class="font-black ${cls(t)}">合計 ${t >= 0 ? '+' : '-'}${fmt(Math.abs(t))}</span></div>`;
        }).join('')}
    </div>` : '';

    el.innerHTML = perfHtml + divHtml + reportHtml;
}

function exportAnnualCsv() {
    const realizedByYear = computeRealizedByYear(state.stocks || []);
    const divByYear = aggregateDividendsByYear(state.dividends || []);
    const years = [...new Set([...Object.keys(realizedByYear), ...Object.keys(divByYear)])].sort();
    const lines = ['年,已實現損益,股利,合計'];
    years.forEach(y => {
        const r = Math.round(realizedByYear[y] || 0), d = Math.round(divByYear[y] || 0);
        lines.push(`${y},${r},${d},${r + d}`);
    });
    lines.push('', '股利明細,日期,代號,名稱,金額');
    (state.dividends || []).forEach(d => lines.push(`股利,${d.date || ''},${d.symbol || ''},"${String(d.name || '').replace(/"/g, '""')}",${Math.round(Number(d.amount) || 0)}`));
    const blob = new Blob(['\ufeff' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `annual_pnl_${localDateStr()}.csv`; a.click();
    URL.revokeObjectURL(url);
    if (typeof showToast === 'function') showToast('年度報表 CSV 已下載');
}

// ---------- F9: GitHub Gist 雲端同步 ----------
function saveGistSettings() {
    const tokenEl = document.getElementById('gist-token-input');
    const idEl = document.getElementById('gist-id-input');
    if (tokenEl) state.gistToken = tokenEl.value.trim();
    if (idEl) state.gistId = idEl.value.trim();
    saveState();
    if (typeof showToast === 'function') showToast('雲端同步設定已儲存');
}

async function gistApi(path, options = {}) {
    const res = await fetch(`https://api.github.com/gists${path}`, {
        ...options,
        headers: { 'Authorization': `Bearer ${state.gistToken}`, 'Accept': 'application/vnd.github+json', 'Content-Type': 'application/json', ...(options.headers || {}) }
    });
    if (!res.ok) throw new Error(`GitHub API ${res.status}`);
    return res.json();
}

async function gistSyncUpload() {
    if (!state.gistToken) { if (typeof showToast === 'function') showToast('請先貼上 GitHub Token（需 gist 權限）'); return; }
    const status = document.getElementById('gist-status');
    try {
        if (status) status.innerText = '上傳中...';
        const payload = { description: 'rebalance backup', public: false, files: { 'rebalance-backup.json': { content: JSON.stringify(buildBackupData(), null, 2) } } };
        const result = state.gistId
            ? await gistApi(`/${state.gistId}`, { method: 'PATCH', body: JSON.stringify(payload) })
            : await gistApi('', { method: 'POST', body: JSON.stringify(payload) });
        state.gistId = result.id;
        saveState();
        const idEl = document.getElementById('gist-id-input');
        if (idEl) idEl.value = result.id;
        if (status) status.innerText = `已上傳：${localDateStr()}（Gist ID: ${result.id}）`;
        if (typeof showToast === 'function') showToast('備份已上傳到雲端');
    } catch (e) {
        if (status) status.innerText = `上傳失敗：${e.message}`;
        if (typeof showToast === 'function') showToast('雲端上傳失敗，請檢查 Token 權限');
    }
}

async function gistSyncDownload() {
    if (!state.gistToken || !state.gistId) { if (typeof showToast === 'function') showToast('請先填 Token 與 Gist ID'); return; }
    const status = document.getElementById('gist-status');
    try {
        if (status) status.innerText = '下載中...';
        const gist = await gistApi(`/${state.gistId}`);
        const file = gist.files && gist.files['rebalance-backup.json'];
        if (!file) throw new Error('Gist 內沒有備份檔');
        let content = file.content;
        if (file.truncated && file.raw_url) content = await (await fetch(file.raw_url)).text();
        const data = JSON.parse(content);
        if (!Array.isArray(data.stocks)) throw new Error('備份格式不符');
        if (status) status.innerText = '已下載，等待確認還原...';
        if (typeof showConfirm === 'function') showConfirm('確定要用雲端備份覆蓋目前資料嗎？', () => processImport(data));
        else if (confirm('確定要用雲端備份覆蓋目前資料嗎？')) processImport(data);
    } catch (e) {
        if (status) status.innerText = `下載失敗：${e.message}`;
        if (typeof showToast === 'function') showToast('雲端下載失敗');
    }
}

// ---------- F10: AI 組合解讀（使用既有 Gemini API Key） ----------
function saveGeminiKey() {
    const el = document.getElementById('gemini-key-input');
    if (el) { state.geminiApiKey = el.value.trim(); saveState(); }
    if (typeof showToast === 'function') showToast('Gemini API Key 已儲存');
}

async function generateAiSummary() {
    const out = document.getElementById('ai-result');
    if (!state.geminiApiKey) { if (typeof showToast === 'function') showToast('請先在設定頁輸入 Gemini API Key'); return; }
    if (out) out.innerText = 'AI 解讀產生中...';
    try {
        const metrics = typeof calculatePortfolioState === 'function' ? calculatePortfolioState() : {};
        const industries = typeof aggregateByIndustry === 'function' ? aggregateByIndustry().map(g => ({ 產業: g.name, 占比: +g.weight.toFixed(1) })) : [];
        const holdings = (state.stocks || []).filter(s => (Number(s.shares) || 0) > 0).map(s => ({ 代號: s.symbol, 名稱: s.name, 股數: s.shares, 現價: s.price }));
        const snapshot = { 總資產: Math.round(metrics.displayTotal || 0), 現金: Math.round(state.cash || 0), 未實現損益: Math.round(metrics.totalGrossPnL || 0), 已實現損益: Math.round(metrics.totalRealizedPnl || 0), 累計股利: Math.round(metrics.totalDividends || 0), 組合Beta: +(metrics.portfolioBeta || 0).toFixed(2), 產業分佈: industries, 持股: holdings };
        const prompt = `你是一位台灣股市投資組合分析助理。以下是我的資產再平衡工具數據（JSON）。請用繁體中文、條列式、300 字以內，指出：1) 本組合目前最大的 2 個風險或集中點 2) 再平衡或股利角度的 1-2 個具體建議 3) 一句總結。不要給買賣特定個股的指令，不要保證報酬。\n\n${JSON.stringify(snapshot)}`;
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${encodeURIComponent(state.geminiApiKey)}`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json?.error?.message || `API ${res.status}`);
        const text = (json.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('');
        if (out) out.innerText = text || 'AI 未回傳內容';
    } catch (e) {
        if (out) out.innerText = `AI 解讀失敗：${e.message}`;
    }
}

// ---------- F11: 深色模式 ----------
function applyDarkMode(on) {
    document.documentElement.classList.toggle('dark', !!on);
    try { localStorage.setItem('mce_dark_mode', on ? '1' : '0'); } catch {}
}
function toggleDarkMode() {
    const on = !document.documentElement.classList.contains('dark');
    applyDarkMode(on);
    if (typeof showToast === 'function') showToast(on ? '已切換深色模式' : '已切換淺色模式');
}
try { if (localStorage.getItem('mce_dark_mode') === '1') document.documentElement.classList.add('dark'); } catch {}

// ---------- 整合 ----------
let lastReportRenderAt = 0;
function renderReportFeatures() {
    const now = Date.now();
    if (now - lastReportRenderAt < 5000) return;
    lastReportRenderAt = now;
    try { renderReportCards(); } catch (e) { console.warn('報表卡渲染失敗', e); }
    try { renderRebalanceAlerts(); } catch (e) { console.warn('偏離提醒渲染失敗', e); }
}

function initReportFeatures() {
    const tokenEl = document.getElementById('gist-token-input');
    const idEl = document.getElementById('gist-id-input');
    if (tokenEl) tokenEl.value = state.gistToken || '';
    if (idEl) idEl.value = state.gistId || '';
    const gemEl = document.getElementById('gemini-key-input');
    if (gemEl) gemEl.value = state.geminiApiKey || '';
    lastReportRenderAt = 0;
    renderReportFeatures();
}

if (typeof updateAllData === 'function' && !window.__reportsWrapped) {
    window.__reportsWrapped = true;
    const originalUpdateAllData2 = updateAllData;
    updateAllData = function (...args) {
        const result = originalUpdateAllData2.apply(this, args);
        renderReportFeatures();
        return result;
    };
}
