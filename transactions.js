// ==========================================
// MCE 模組化 - transactions.js (全螢幕個股明細與交易紀錄簿)
// 版本: v14.0 (Modular Build - 仿專業 App 介面)
// ==========================================

let currentTransStockIndex = -1;
let currentStockTab = 'overview'; // 'overview' 或 'history'

// 開啟全螢幕個股資產明細視圖
function openTransactionModal(index) {
    currentTransStockIndex = index;
    currentStockTab = 'overview';
    const stock = state.stocks[index];
    if (!stock.transactions) stock.transactions = [];

    renderStockDetailContent();

    const modal = document.getElementById('transaction-modal');
    const content = document.getElementById('transaction-modal-content');
    if (!modal) return;

    modal.classList.remove('hidden');
    void modal.offsetWidth; 
    modal.classList.remove('opacity-0');
    if (content) {
        content.classList.remove('scale-95');
        content.classList.add('scale-100');
    }
}

function closeTransactionModal() {
    const modal = document.getElementById('transaction-modal');
    const content = document.getElementById('transaction-modal-content');
    if (!modal) return;

    modal.classList.add('opacity-0');
    if (content) {
        content.classList.remove('scale-100');
        content.classList.add('scale-95');
    }
    setTimeout(() => {
        modal.classList.add('hidden');
        currentTransStockIndex = -1;
    }, 200);
}

// 切換個股明細內的頁籤 ('overview' vs 'history')
function switchStockTab(tabName) {
    currentStockTab = tabName;
    renderStockDetailContent();
}

// 渲染個股詳細視圖的完整內容（對應您上傳的專業截圖介面）
function renderStockDetailContent() {
    if (currentTransStockIndex === -1) return;
    const stock = state.stocks[currentTransStockIndex];
    
    const nameEl = document.getElementById('trans-stock-name');
    const symbolEl = document.getElementById('trans-stock-symbol');
    if (nameEl) nameEl.innerText = stock.name || stock.symbol || '';
    if (symbolEl) symbolEl.innerText = stock.symbol ? `${stock.symbol}.TW` : '';

    const currentPrice = stock.price || stock.costPrice || 0;
    const shares = stock.shares || 0;
    const marketVal = Math.round(shares * currentPrice);
    
    const costPrice = stock.costPrice !== undefined ? stock.costPrice : currentPrice;
    const allInCost = calculateAllInCost(stock, currentPrice);
    const paidCost = allInCost.totalCost;
    
    const realized = Number(stock.realizedPnl) || 0;
    const stockDividendsTotal = typeof sumDividends === 'function' ? sumDividends(stock.symbol || '') : 0;
    const pnl = (marketVal - paidCost) + realized + stockDividendsTotal;
    const pnlPercent = paidCost > 0 ? (pnl / paidCost) * 100 : 0;
    const pnlColor = pnl >= 0 ? 'text-[#22C55E]' : 'text-[#EF4444]';
    const pnlSign = pnl >= 0 ? '+' : '';

    // 填入頂部數據看板
    const elVal = document.getElementById('detail-market-val');
    const elPnl = document.getElementById('detail-pnl');
    const elShares = document.getElementById('detail-shares');
    const elCost = document.getElementById('detail-cost-price');
    
    if (elVal) elVal.innerText = `NT$ ${fmt(marketVal)}`;
    if (elPnl) {
        elPnl.innerText = `${pnlSign}NT$ ${fmt(Math.abs(pnl))} (${pnlSign}${Math.abs(pnlPercent).toFixed(2)}%)`;
        elPnl.className = `text-base font-black ${pnlColor}`;
    }
    if (elShares) elShares.innerText = `${fmt(shares)} 股`;
    const breakdownEl = document.getElementById('detail-pnl-breakdown');
    if (breakdownEl) {
        const fmtSigned = (v) => `${v >= 0 ? '+' : '-'}NT$${fmt(Math.abs(v))}`;
        breakdownEl.innerText = `未實現 ${fmtSigned(marketVal - paidCost)}｜已實現 ${fmtSigned(realized)}｜股利 ${fmtSigned(stockDividendsTotal)}`;
    }
    if (elCost) elCost.innerText = `@ ${fmtPrice(allInCost.averageCost || costPrice)}`;

    // 切換頁籤按鈕樣式
    const tabOverviewBtn = document.getElementById('tab-btn-overview');
    const tabHistoryBtn = document.getElementById('tab-btn-history');
    const viewOverview = document.getElementById('stock-detail-overview-view');
    const viewHistory = document.getElementById('stock-detail-history-view');

    if (currentStockTab === 'overview') {
        if (tabOverviewBtn) tabOverviewBtn.className = 'flex-1 py-2 text-xs font-bold text-slate-900 border-b-2 border-slate-900 transition-all';
        if (tabHistoryBtn) tabHistoryBtn.className = 'flex-1 py-2 text-xs font-bold text-slate-400 border-b-2 border-transparent hover:text-slate-600 transition-all';
        if (viewOverview) viewOverview.classList.remove('hidden');
        if (viewHistory) viewHistory.classList.add('hidden');
        renderEntryJudgementCard(stock);
    } else {
        if (tabHistoryBtn) tabHistoryBtn.className = 'flex-1 py-2 text-xs font-bold text-slate-900 border-b-2 border-slate-900 transition-all';
        if (tabOverviewBtn) tabOverviewBtn.className = 'flex-1 py-2 text-xs font-bold text-slate-400 border-b-2 border-transparent hover:text-slate-600 transition-all';
        if (viewHistory) viewHistory.classList.remove('hidden');
        if (viewOverview) viewOverview.classList.add('hidden');
        renderTransactionList(currentTransStockIndex);
    }
}

// 渲染歷史交易明細列表
function renderTransactionList(index) {

    const stock = state.stocks[index];
    renderDailyChangesList(index);
    const container = document.getElementById('transaction-list-container');
    if (!container) return;
    
    const stockDividendsEarly = (Array.isArray(state.dividends) ? state.dividends : []).filter(d => (d.symbol || '') === (stock.symbol || ''));
    if ((!stock.transactions || stock.transactions.length === 0) && stockDividendsEarly.length === 0) {
        container.innerHTML = '<div class="text-center text-xs font-semibold text-slate-400 py-10 bg-slate-50 rounded-2xl border border-dashed border-slate-200">尚無交易紀錄，點下方按鈕新增第一筆買賣</div>';
        return;
    }

    const sortedTrans = [...(stock.transactions || [])].sort((a, b) => new Date(b.date) - new Date(a.date));

    container.innerHTML = sortedTrans.map((t, idx) => {
        const isBuy = t.type === 'buy';
        const iconBg = isBuy ? 'bg-emerald-100 text-emerald-600' : 'bg-rose-100 text-rose-600';
        const typeLabel = isBuy ? '買進' : '賣出';
        const sign = isBuy ? '-' : '+';
        const amountColor = isBuy ? 'text-slate-900' : 'text-blue-600';
        const legacyNetAmount = (Number(t.price) || 0) * (Number(t.shares) || 0) + (isBuy ? (Number(t.fee) || 0) : -(Number(t.fee) || 0) - (Number(t.tax) || 0));
        const displayAmount = Number.isFinite(Number(t.netAmount)) ? Number(t.netAmount) : legacyNetAmount;
        
        return `
        <div class="p-3.5 bg-white rounded-2xl border border-slate-100 shadow-sm flex justify-between items-center">
            <div class="flex items-center gap-3">
                <div class="w-9 h-9 rounded-xl ${iconBg} flex items-center justify-center font-black text-xs shrink-0 shadow-inner">
                    ${isBuy ? '買' : '賣'}
                </div>
                <div>
                    <div class="flex items-center gap-2">
                        <span class="text-xs font-black text-slate-800">${typeLabel} ${fmt(t.shares)} 股</span>
                        <span class="text-[10px] font-bold text-slate-400">${escapeHtml(t.date || '')}</span>
                    </div>
                    <div class="text-[11px] font-medium text-slate-500 mt-0.5">
                        單價 @${fmtPrice(t.price)} | 手續費 ${escapeHtml(String(t.fee ?? ''))}${!isBuy ? ` | 稅 ${escapeHtml(String(t.tax ?? ''))}` : ''}
                    </div>
                </div>
            </div>
            <div class="text-right shrink-0">
                <div class="text-sm font-black ${amountColor}">${sign}NT$${fmt(displayAmount)}</div>
                <button onclick="deleteTransaction(${index}, '${t.id}')" class="text-[10px] font-bold text-red-400 hover:text-red-600 mt-1 inline-block">刪除</button>
            </div>
        </div>`;
    }).join('');

    const stockDividends = (Array.isArray(state.dividends) ? state.dividends : []).filter(d => (d.symbol || '') === (stock.symbol || ''));
    if (stockDividends.length > 0) {
        container.innerHTML += stockDividends.map(d => `
        <div class="p-3.5 bg-amber-50 rounded-2xl border border-amber-100 shadow-sm flex justify-between items-center">
            <div class="flex items-center gap-3">
                <div class="w-9 h-9 rounded-xl bg-amber-100 text-amber-600 flex items-center justify-center font-black text-xs shrink-0 shadow-inner">利</div>
                <div>
                    <div class="flex items-center gap-2">
                        <span class="text-xs font-black text-slate-800">現金股利</span>
                        <span class="text-[10px] font-bold text-slate-400">${escapeHtml(d.date || '')}</span>
                    </div>
                    <div class="text-[11px] font-medium text-slate-500 mt-0.5">已入帳交割戶現金</div>
                </div>
            </div>
            <div class="text-right shrink-0">
                <div class="text-sm font-black text-amber-600">+NT$${fmt(Number(d.amount) || 0)}</div>
                <button onclick="deleteDividend('${d.id}')" class="text-[10px] font-bold text-red-400 hover:text-red-600 mt-1 inline-block">刪除</button>
            </div>
        </div>`).join('');
    }
}

// ==========================================
// 每日持股變化 + 追高/逢低判斷卡（方案 B）
// ==========================================

// 單筆交易的費用/淨額：與 core.js recalculateStockFromTransactions 相同口徑
// （有 netAmount 用 netAmount，費用缺值時用 calculateTradingCost 推算）。
function dailyTxCost(t, stock, type, price, shares) {
    const feeOverride = (t.fee === undefined || t.fee === null || t.fee === '')
        ? null
        : (Number.isFinite(Number(t.fee)) ? Number(t.fee) : null);
    let calc = { fee: 0, tax: 0, netAmount: price * shares };
    if (typeof calculateTradingCost === 'function') {
        try { calc = calculateTradingCost({ type, price, shares, stock, feeOverride }); } catch (e) { /* 用預設值 */ }
    }
    return {
        fee: feeOverride !== null ? feeOverride : (Number(calc.fee) || 0),
        tax: Number.isFinite(Number(t.tax)) ? Number(t.tax) : (Number(calc.tax) || 0),
        netAmount: Number.isFinite(Number(t.netAmount)) ? Number(t.netAmount) : calc.netAmount
    };
}

// 純函數：把交易按日分組，由舊到新累計持股/均價/FIFO 批次，回傳由新到舊的每日列。
// 每列：{ date, isOpening, buyShares, sellShares, netChange, buyAvgPrice, sellAvgPrice,
//         realizedPnl, cumShares, cumAvgCost, remainingLots: [{ date, buyPrice, remainingShares,
//         spreadPerShare, spreadTotal, spreadPct }] }
function buildDailyChanges(stock) {
    if (!stock) return [];
    const currentPrice = Number(stock.price) || Number(stock.costPrice) || 0;
    const txs = (Array.isArray(stock.transactions) ? stock.transactions : [])
        .filter(t => t && ['buy', 'sell', '買進', '賣出'].includes(t.type))
        .map(t => ({
            raw: t,
            type: (t.type === 'buy' || t.type === '買進') ? 'buy' : 'sell',
            date: String(t.date || ''),
            price: Math.max(0, parseFloat(t.price) || 0),
            shares: Math.max(0, parseInt(t.shares, 10) || 0)
        }))
        .filter(t => t.shares > 0 && t.price > 0);

    const byDate = new Map();
    txs.forEach(t => {
        if (!byDate.has(t.date)) byDate.set(t.date, []);
        byDate.get(t.date).push(t);
    });
    const dates = [...byDate.keys()].sort((a, b) => a.localeCompare(b));

    const netFromTx = txs.reduce((sum, t) => sum + (t.type === 'buy' ? t.shares : -t.shares), 0);
    const diff = (Number(stock.shares) || 0) - netFromTx;

    let cumShares = 0;
    let cumCost = 0;
    const lotQueue = []; // FIFO：{ date, price, shares }，與各列 _created 共用物件
    const consumeLots = (shares) => {
        let left = shares;
        while (left > 0 && lotQueue.length > 0) {
            const lot = lotQueue[0];
            const take = Math.min(lot.shares, left);
            lot.shares -= take;
            left -= take;
            if (lot.shares <= 0) lotQueue.shift();
        }
    };

    const rows = [];

    // 期初持股：交易加總與實際持股對不起來時，先補一列讓總數永遠對得上。
    if (diff !== 0) {
        const openPrice = Number(stock.costPrice) || Number(stock.price) || 0;
        const row = {
            date: '', isOpening: true,
            buyShares: diff > 0 ? diff : 0, sellShares: diff < 0 ? -diff : 0, netChange: diff,
            buyAvgPrice: diff > 0 ? openPrice : null, sellAvgPrice: null,
            realizedPnl: 0, cumShares: 0, cumAvgCost: 0, _created: []
        };
        if (diff > 0) {
            cumShares += diff;
            cumCost += diff * openPrice;
            const lot = { date: '', price: openPrice, shares: diff };
            lotQueue.push(lot);
            row._created.push(lot);
        } else {
            cumShares += diff;
        }
        row.cumShares = cumShares;
        row.cumAvgCost = cumShares > 0 ? cumCost / cumShares : 0;
        rows.push(row);
    }

    for (const date of dates) {
        const dayTxs = byDate.get(date);
        const buys = dayTxs.filter(t => t.type === 'buy');
        const sells = dayTxs.filter(t => t.type === 'sell');
        let buyShares = 0, sellShares = 0, buyAmount = 0, sellAmount = 0, realizedPnl = 0;
        const created = [];

        for (const t of buys) {
            const cost = dailyTxCost(t.raw, stock, 'buy', t.price, t.shares);
            cumShares += t.shares;
            cumCost += cost.netAmount;
            buyShares += t.shares;
            buyAmount += t.price * t.shares;
            const lot = { date, price: t.price, shares: t.shares };
            lotQueue.push(lot);
            created.push(lot);
        }
        for (const t of sells) {
            const cost = dailyTxCost(t.raw, stock, 'sell', t.price, t.shares);
            const avgBefore = cumShares > 0 ? cumCost / cumShares : 0;
            realizedPnl += cost.netAmount - avgBefore * t.shares;
            cumCost = Math.max(0, cumCost - avgBefore * t.shares);
            cumShares = Math.max(0, cumShares - t.shares);
            sellShares += t.shares;
            sellAmount += t.price * t.shares;
            consumeLots(t.shares);
        }

        rows.push({
            date, isOpening: false,
            buyShares, sellShares, netChange: buyShares - sellShares,
            buyAvgPrice: buyShares > 0 ? buyAmount / buyShares : null,
            sellAvgPrice: sellShares > 0 ? sellAmount / sellShares : null,
            realizedPnl,
            cumShares,
            cumAvgCost: cumShares > 0 ? cumCost / cumShares : 0,
            _created: created
        });
    }

    rows.forEach(row => {
        row.remainingLots = row._created
            .filter(lot => lot.shares > 0)
            .map(lot => ({
                date: lot.date,
                buyPrice: lot.price,
                remainingShares: lot.shares,
                spreadPerShare: currentPrice - lot.price,
                spreadTotal: (currentPrice - lot.price) * lot.shares,
                spreadPct: lot.price > 0 ? (currentPrice - lot.price) / lot.price * 100 : null
            }));
        delete row._created;
    });

    return rows.reverse();
}

// 純函數：現在買入是追高還是逢低。history 為 historyData 格式 [{ d, o, h, l, c, v }]。
function computeEntryJudgement(stock, history) {
    // 門檻常數（要調判斷鬆緊改這裡）
    const LOW_PERCENTILE = 30;
    const HIGH_PERCENTILE = 80;
    const RANGE_DAYS = 60;

    const items = (Array.isArray(history) ? history : [])
        .map(item => ({
            d: String((item && (item.d || item.date)) || ''),
            c: Number(item && (item.c !== undefined ? item.c : item.close)),
            h: Number(item && (item.h !== undefined ? item.h : (item.max !== undefined ? item.max : item.c))),
            l: Number(item && (item.l !== undefined ? item.l : (item.min !== undefined ? item.min : item.c)))
        }))
        .filter(item => Number.isFinite(item.c) && item.c > 0)
        .sort((a, b) => a.d.localeCompare(b.d));
    const closes = items.map(item => item.c);

    const currentPrice = (Number(stock && stock.price) > 0)
        ? Number(stock.price)
        : (closes.length > 0 ? closes[closes.length - 1] : (Number(stock && stock.costPrice) || 0));

    let avgCost = Number(stock && stock.costPrice) || 0;
    if (stock && Number(stock.shares) > 0 && typeof calculateAllInCost === 'function') {
        const allIn = calculateAllInCost(stock, currentPrice);
        if (allIn && allIn.averageCost > 0) avgCost = allIn.averageCost;
    }

    // 上一次買入價：最近一個有買入的日期，當日買入加權均價
    let lastBuyPrice = null;
    const buyTxs = (Array.isArray(stock && stock.transactions) ? stock.transactions : [])
        .filter(t => t && (t.type === 'buy' || t.type === '買進') && Number(t.shares) > 0 && Number(t.price) > 0);
    if (buyTxs.length > 0) {
        const latestDate = buyTxs.map(t => String(t.date || '')).sort().pop();
        const sameDay = buyTxs.filter(t => String(t.date || '') === latestDate);
        const shares = sameDay.reduce((s, t) => s + Number(t.shares), 0);
        lastBuyPrice = shares > 0 ? sameDay.reduce((s, t) => s + Number(t.price) * Number(t.shares), 0) / shares : null;
    }

    const ma = (period) => {
        if (typeof movingAverage === 'function') return movingAverage(closes, period);
        if (closes.length < period) return null;
        const w = closes.slice(-period);
        return w.reduce((s, v) => s + v, 0) / period;
    };
    const ma20 = ma(20);
    const ma60 = ma(60);

    let percentile = null, high60 = null, low60 = null;
    if (items.length >= RANGE_DAYS) {
        const range = items.slice(-RANGE_DAYS);
        high60 = Math.max(...range.map(item => Number.isFinite(item.h) ? item.h : item.c));
        low60 = Math.min(...range.map(item => Number.isFinite(item.l) ? item.l : item.c));
        if (high60 > low60) percentile = (currentPrice - low60) / (high60 - low60) * 100;
    }

    // 還在手上的批次（FIFO 後）：最便宜/最貴一批與價差試算
    const heldLots = buildDailyChanges(stock || {}).flatMap(row => row.remainingLots || []);
    const cheapestLotPrice = heldLots.length > 0 ? Math.min(...heldLots.map(l => l.buyPrice)) : null;
    const mostExpensiveLotPrice = heldLots.length > 0 ? Math.max(...heldLots.map(l => l.buyPrice)) : null;
    const pctVs = (base) => (base && base > 0 && currentPrice > 0) ? (currentPrice - base) / base * 100 : null;

    const basedOnCostOnly = !(items.length >= RANGE_DAYS && ma60 !== null && percentile !== null);
    let label;
    if (basedOnCostOnly) {
        const belowCost = avgCost > 0 && currentPrice < avgCost;
        const aboveCost = avgCost > 0 && currentPrice > avgCost;
        const belowLast = lastBuyPrice !== null && currentPrice < lastBuyPrice;
        const aboveLast = lastBuyPrice !== null && currentPrice > lastBuyPrice;
        if (belowCost && (lastBuyPrice === null || belowLast)) label = '逢低買進';
        else if (aboveCost && (lastBuyPrice === null || aboveLast)) label = '追高';
        else label = '區間中段';
    } else {
        const lowSignals = [percentile <= LOW_PERCENTILE, currentPrice < ma20, avgCost > 0 && currentPrice < avgCost];
        const highSignals = [percentile >= HIGH_PERCENTILE, currentPrice > ma20, avgCost > 0 && currentPrice > avgCost];
        const count = (arr) => arr.filter(Boolean).length;
        if (lowSignals[0] && count(lowSignals) >= 2) label = '逢低買進';
        else if (highSignals[0] && count(highSignals) >= 2) label = '追高';
        else label = '區間中段';
    }

    return {
        label,
        basedOnCostOnly,
        currentPrice,
        avgCost: avgCost > 0 ? avgCost : null,
        lastBuyPrice,
        ma20, ma60,
        percentile, high60, low60,
        cheapestLotPrice, mostExpensiveLotPrice,
        vsCheapestPct: pctVs(cheapestLotPrice),
        vsMostExpensivePct: pctVs(mostExpensiveLotPrice),
        vsAvgCostPerShare: (avgCost > 0 && currentPrice > 0) ? currentPrice - avgCost : null
    };
}

// 歷史不足時照 waterlevel.js fetchFinmindHighLow 的方式抓 FinMind 近 1 年並回存 historyData。
// 失敗一律回既有資料，不丟例外、不阻塞 Modal。
async function ensureStockHistoryForJudgement(stock) {
    const existing = (stock && Array.isArray(stock.historyData)) ? stock.historyData : [];
    try {
        if (!stock || !stock.symbol) return existing;
        if (existing.length >= 60) return existing;
        const token = (typeof state !== 'undefined' && state.finmindToken) || '';
        if (!token) return existing;
        const todayStr = localDateStr();
        if (stock.historyFetchedDate === todayStr && existing.length > 0) return existing;

        const oneYearAgo = new Date();
        oneYearAgo.setDate(oneYearAgo.getDate() - 365);
        const url = `https://api.finmindtrade.com/api/v4/data?dataset=TaiwanStockPrice&data_id=${stock.symbol}&start_date=${localDateStr(oneYearAgo)}&token=${token}`;
        const response = await fetch(url);
        if (!response.ok) return existing;
        const result = await response.json();
        if (result.msg !== 'success' && result.status !== 200) return existing;
        const dataList = result.data || [];
        if (dataList.length === 0) return existing;

        const fetched = dataList
            .filter(day => Number(day.close) > 0)
            .map(day => ({
                d: day.date,
                o: Number(day.open) || Number(day.close),
                h: Number(day.max) || Number(day.close),
                l: Number(day.min) || Number(day.close),
                c: Number(day.close),
                v: Number(day.Trading_Volume || day.Trading_volume || day.volume || day.v || 0)
            }));
        if (fetched.length === 0) return existing;

        const historyMap = new Map();
        existing.forEach(item => { if (item && item.d) historyMap.set(item.d, item); });
        fetched.forEach(item => { if (item && item.d) historyMap.set(item.d, item); });
        let merged = [...historyMap.values()].sort((a, b) => String(a.d).localeCompare(String(b.d)));
        if (typeof adjustForStockSplits === 'function') merged = adjustForStockSplits(merged);
        stock.historyData = merged;
        stock.historyFetchedDate = todayStr;
        if (typeof saveState === 'function') saveState();
        return merged;
    } catch (e) {
        return existing;
    }
}

// 判斷卡（四簡風）：一個結論 + 現價，比較值一行小字，價差試算一行。
function renderEntryJudgementCard(stock) {
    const el = document.getElementById('entry-judgement-card');
    if (!el || !stock) return;
    const j = computeEntryJudgement(stock, Array.isArray(stock.historyData) ? stock.historyData : []);
    if (!(j.currentPrice > 0)) {
        el.classList.add('hidden');
        el.innerHTML = '';
        return;
    }
    el.classList.remove('hidden');
    const color = j.label === '逢低買進' ? 'text-emerald-600' : (j.label === '追高' ? 'text-rose-500' : 'text-slate-700');
    const fmtVal = (v) => (v === null || v === undefined || !Number.isFinite(v) || v === 0) ? '—' : fmtPrice(v);
    const fmtPct = (v) => (v === null || v === undefined || !Number.isFinite(v)) ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`;
    const parts = [`均價 ${fmtVal(j.avgCost)}`, `上次買 ${fmtVal(j.lastBuyPrice)}`];
    if (!j.basedOnCostOnly) {
        parts.push(`MA20 ${fmtVal(j.ma20)}`, `MA60 ${fmtVal(j.ma60)}`, `區間分位 ${j.percentile === null ? '—' : j.percentile.toFixed(0) + '%'}`);
    }
    const hasTrial = j.cheapestLotPrice !== null || j.mostExpensiveLotPrice !== null || j.vsAvgCostPerShare !== null;
    el.innerHTML = `
        <div class="flex items-center justify-between gap-3">
            <div class="text-2xl font-black ${color}">${j.label}${j.basedOnCostOnly ? '<span class="ml-2 text-[10px] font-bold text-slate-400 align-middle">僅依你的成本判斷</span>' : ''}</div>
            <div class="text-xl font-black text-slate-900">${fmtPrice(j.currentPrice)}</div>
        </div>
        <div class="mt-2 text-[11px] font-semibold text-slate-500 flex flex-wrap gap-x-3 gap-y-1">${parts.map(p => `<span>${p}</span>`).join('')}</div>
        ${hasTrial ? `<div class="mt-1 text-[11px] font-semibold text-slate-500">現在買｜最便宜一批 ${fmtPct(j.vsCheapestPct)}｜最貴一批 ${fmtPct(j.vsMostExpensivePct)}｜均價 ${j.vsAvgCostPerShare === null ? '—' : (j.vsAvgCostPerShare >= 0 ? '+' : '') + fmtPrice(j.vsAvgCostPerShare) + '/股'}</div>` : ''}`;

    // 歷史不足且有 Token 才背景補抓，抓到再重畫一次；不阻塞開啟。
    const history = Array.isArray(stock.historyData) ? stock.historyData : [];
    if (history.length < 60 && typeof state !== 'undefined' && state.finmindToken) {
        const idx = currentTransStockIndex;
        ensureStockHistoryForJudgement(stock).then(h => {
            if (h && h.length >= 60 && currentTransStockIndex === idx && currentStockTab === 'overview') {
                renderEntryJudgementCard(stock);
            }
        }).catch(() => {});
    }
}

// 每日持股變化列表（渲染）
function renderDailyChangesList(index) {
    const container = document.getElementById('daily-changes-container');
    if (!container) return;
    const stock = state.stocks[index];
    if (!stock) { container.innerHTML = ''; return; }
    const rows = buildDailyChanges(stock);
    if (rows.length === 0) { container.innerHTML = ''; return; }
    const fmtSignedMoney = (v) => `${v >= 0 ? '+' : '-'}NT$${fmt(Math.abs(Math.round(v)))}`;
    container.innerHTML = rows.map(row => {
        const title = row.isOpening ? '期初持股' : escapeHtml(row.date || '');
        const changeText = row.isOpening
            ? `${row.netChange >= 0 ? '+' : ''}${fmt(row.netChange)} 股`
            : [
                row.buyShares > 0 ? `買 +${fmt(row.buyShares)} @${fmtPrice(row.buyAvgPrice)}` : '',
                row.sellShares > 0 ? `賣 -${fmt(row.sellShares)} @${fmtPrice(row.sellAvgPrice)}` : ''
            ].filter(Boolean).join('｜');
        const realizedText = row.sellShares > 0 ? `｜已實現 ${fmtSignedMoney(row.realizedPnl)}` : '';
        const lotHtml = (row.remainingLots || []).map(lot => `
            <div class="text-[11px] font-semibold ${lot.spreadTotal >= 0 ? 'text-emerald-600' : 'text-rose-500'} mt-0.5">持有 ${fmt(lot.remainingShares)} 股 @${fmtPrice(lot.buyPrice)}｜價差 ${fmtSignedMoney(lot.spreadTotal)} (${lot.spreadPct === null ? '—' : (lot.spreadPct >= 0 ? '+' : '') + lot.spreadPct.toFixed(2) + '%'})</div>`).join('');
        return `
        <div class="p-3 bg-white rounded-2xl border border-slate-100 shadow-sm">
            <div class="flex justify-between items-center gap-2">
                <span class="text-xs font-black text-slate-800">${title}</span>
                <span class="text-xs font-bold text-slate-600">${changeText}</span>
            </div>
            <div class="text-[11px] font-medium text-slate-500 mt-1">累計 ${fmt(row.cumShares)} 股｜均價 @${fmtPrice(row.cumAvgCost)}${realizedText}</div>
            ${lotHtml}
        </div>`;
    }).join('');
}

// 切換新增交易表單的買/賣模式
function setTransType(type) {
    document.getElementById('trans-type').value = type;
    const btnBuy = document.getElementById('btn-type-buy');
    const btnSell = document.getElementById('btn-type-sell');
    const btnDiv = document.getElementById('btn-type-dividend');
    const idle = 'flex-1 py-2 text-xs font-bold rounded-xl text-slate-400 hover:text-slate-600 transition-all';
    const activeBase = 'flex-1 py-2 text-xs font-black rounded-xl bg-white shadow-sm transition-all ';
    if (btnBuy) btnBuy.className = type === 'buy' ? activeBase + 'text-emerald-600' : idle;
    if (btnSell) btnSell.className = type === 'sell' ? activeBase + 'text-rose-500' : idle;
    if (btnDiv) btnDiv.className = type === 'dividend' ? activeBase + 'text-amber-600' : idle;

    // 股利模式：單價欄改填股利總額、隱藏股數欄
    const priceLabel = document.getElementById('trans-price-label');
    const sharesInput = document.getElementById('trans-shares');
    const sharesRow = sharesInput ? sharesInput.closest('div') : null;
    if (type === 'dividend') {
        if (priceLabel) priceLabel.innerText = '股利總額 (TWD)';
        if (sharesRow) sharesRow.style.display = 'none';
        if (sharesInput) sharesInput.removeAttribute('required');
    } else {
        if (priceLabel) priceLabel.innerText = '成交單價';
        if (sharesRow) sharesRow.style.display = '';
        if (sharesInput) sharesInput.setAttribute('required', '');
    }
}

// 點擊叫出新增交易表單的 Modal
function openAddTransactionForm() {
    const stock = state.stocks[currentTransStockIndex];
    const formModal = document.getElementById('add-transaction-modal');
    if (!formModal) return;

    document.getElementById('trans-date').value = localDateStr();
    document.getElementById('trans-price').value = stock.price || stock.costPrice || '';
    document.getElementById('trans-shares').value = '';
    setTransType('buy');

    formModal.classList.remove('hidden');
    void formModal.offsetWidth;
    formModal.classList.remove('opacity-0');
}

function closeAddTransactionForm() {
    const formModal = document.getElementById('add-transaction-modal');
    if (!formModal) return;
    formModal.classList.add('opacity-0');
    setTimeout(() => formModal.classList.add('hidden'), 200);
}

// 手動新增交易：資料變更統一交給 core.js。
function submitTransaction(e) {
  e.preventDefault();
  if (currentTransStockIndex === -1) return;

  const stock = state.stocks[currentTransStockIndex];
  const type = document.getElementById('trans-type').value; // 'buy' or 'sell'
  const price = parseFloat(document.getElementById('trans-price').value) || 0;
  const shares = parseInt(document.getElementById('trans-shares').value) || 0;
  const date = document.getElementById('trans-date').value || localDateStr();
  const noteEl = document.getElementById('trans-note');
  const note = noteEl ? noteEl.value || '' : '';

  if (type === 'dividend') {
    const amount = parseFloat(document.getElementById('trans-price').value) || 0;
    if (amount <= 0) {
      if (typeof showToast === 'function') showToast('請輸入有效的股利總額');
      return;
    }
    try {
      applyDividend({ stock, amount, date, note });
    } catch (error) {
      if (typeof showToast === 'function') showToast(error.message);
      return;
    }
    saveState();
    closeAddTransactionForm();
    renderTransactionList(currentTransStockIndex);
    renderStockDetailContent();
    if (typeof updateAllData === 'function') updateAllData();
    if (typeof showToast === 'function') showToast('股利已登錄並入帳現金');
    return;
  }

  if (price <= 0 || shares <= 0) {
    if (typeof showToast === 'function') showToast('請輸入有效的單價與股數');
    return;
  }

  try {
    applyTransaction({ stock, type, price, shares, date, note, syncCash: true });
  } catch (error) {
    if (typeof showToast === 'function') showToast(error.message);
    return;
  }

  saveState();
  closeAddTransactionForm();
  renderTransactionList(currentTransStockIndex);
  renderStockDetailContent();
  if (typeof updateAllData === 'function') updateAllData();
  if (typeof showToast === 'function') showToast('交易紀錄已成功新增');
}

// 刪除單筆交易明細

function deleteTransaction(stockIndex, transId) {
    if (typeof showConfirm === 'function') {
        showConfirm("確定要刪除這筆交易紀錄嗎？\n系統將自動回滾對應的現金餘額與持股成本。", () => executeDeleteTrans(stockIndex, transId));
    } else {
        if (confirm("確定要刪除這筆交易紀錄嗎？")) executeDeleteTrans(stockIndex, transId);
    }
}

function executeDeleteTrans(stockIndex, transId) {
    const stock = state.stocks[stockIndex];
    if (!stock) return;
    // 統一走 core 的共用刪除：回滾現金 + 重算持股（trade.js 全域刪除共用同一條路徑）
    const deleted = deleteTransactionWithRollback(stock, transId);
    if (!deleted) return;

    saveState();
    renderTransactionList(stockIndex);
    renderStockDetailContent();
    if (typeof updateAllData === 'function') updateAllData();
    if (typeof renderGlobalTradeHistory === 'function') renderGlobalTradeHistory();
    if (typeof showToast === 'function') showToast('已刪除交易紀錄並完成現金與持股回滾');
}

// 刪除股利紀錄：同步扣回當初入帳的現金
function deleteDividend(dividendId) {
    if (!Array.isArray(state.dividends)) return;
    const idx = state.dividends.findIndex(d => d.id === dividendId);
    if (idx === -1) return;
    const doDelete = () => {
        const target = state.dividends[idx];
        state.cash = Math.max(0, (Number(state.cash) || 0) - (Number(target.amount) || 0));
        state.dividends.splice(idx, 1);
        saveState();
        if (currentTransStockIndex >= 0) {
            renderTransactionList(currentTransStockIndex);
            renderStockDetailContent();
        }
        if (typeof updateAllData === 'function') updateAllData();
        if (typeof showToast === 'function') showToast('已刪除股利紀錄並扣回現金');
    };
    if (typeof showConfirm === 'function') {
        showConfirm('確定要刪除這筆股利紀錄嗎？\n現金將同步扣回。', doDelete);
    } else if (confirm('確定要刪除這筆股利紀錄嗎？現金將同步扣回。')) {
        doDelete();
    }
}
