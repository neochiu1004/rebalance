// ==========================================
// MCE 模組化 - assets.js (核心渲染與持股邏輯)
// 版本: v14.5 (Full Integrated Fix)
// ==========================================

let assetChart = null;
let dailyPnlChart = null;

// --- 全域格式化常數 ---
const fmt = (num) => new Intl.NumberFormat('en-US').format(Math.round(num));
const fmtCurrency = (num) => `NT$ ${fmt(num)}`;
const fmtPct = (num) => (num % 1 === 0 ? num : num.toFixed(1));
const fmtPrice = (num) => new Intl.NumberFormat('en-US', { maximumFractionDigits: 4 }).format(num);

const symbolMap = {
    '元大台灣50正2': '00631L',
    '群益臺灣加權正2': '00685L',
    '南電': '8046',
    '欣興': '3037'
};

// 將交易簿彙整成總覽可讀的成本明細。
function calculateTransactionBreakdown(stock = {}) {
    const breakdown = {
        buyAmount: 0,
        buyFee: 0,
        buyTax: 0,
        sellAmount: 0,
        sellFee: 0,
        sellTax: 0,
        buyShares: 0,
        sellShares: 0
    };

    (Array.isArray(stock.transactions) ? stock.transactions : []).forEach(transaction => {
        const amount = (Number(transaction.price) || 0) * (Number(transaction.shares) || 0);
        const fee = Number(transaction.fee) || 0;
        const tax = Number(transaction.tax) || 0;
        if (transaction.type === 'buy') {
            breakdown.buyAmount += amount;
            breakdown.buyFee += fee;
            breakdown.buyTax += tax;
            breakdown.buyShares += Number(transaction.shares) || 0;
        } else if (transaction.type === 'sell') {
            breakdown.sellAmount += amount;
            breakdown.sellFee += fee;
            breakdown.sellTax += tax;
            breakdown.sellShares += Number(transaction.shares) || 0;
        }
    });

    breakdown.buyTotal = breakdown.buyAmount + breakdown.buyFee + breakdown.buyTax;
    breakdown.sellNet = breakdown.sellAmount - breakdown.sellFee - breakdown.sellTax;
    return breakdown;
}

function getTransactionType(transaction) {
    return transaction.type === 'buy' || transaction.type === '買進' ? 'buy' : 'sell';
}

// 依日期回推當日持股與現金，讓買賣不被誤算成單日績效。
// 價格、交易皆預先排序，避免每次渲染重複掃描整份資料。
function calculateDailyPortfolioHistory() {
    const stocksWithHistory = (state.stocks || []).filter(stock =>
        Array.isArray(stock.historyData) && stock.historyData.length > 0
    ).map(stock => ({
        stock,
        prices: stock.historyData
            .filter(item => item.d && Number.isFinite(Number(item.c)))
            .map(item => ({ date: String(item.d), close: Number(item.c) }))
            .sort((a, b) => a.date.localeCompare(b.date)),
        transactions: (Array.isArray(stock.transactions) ? stock.transactions : [])
            .filter(transaction => transaction.date)
            .map(transaction => ({ ...transaction, date: String(transaction.date) }))
            .sort((a, b) => a.date.localeCompare(b.date))
    })).filter(series => series.prices.length > 0);
    const dateSet = new Set();
    stocksWithHistory.forEach(series => series.prices.forEach(item => dateSet.add(item.date)));
    const dates = [...dateSet].sort();
    if (dates.length === 0) return [];

    const initialDate = dates[0];
    const cashEventsByDate = new Map();
    const seriesState = stocksWithHistory.map(series => {
        const futureTransactions = series.transactions.filter(transaction => transaction.date > initialDate);
        const startingShares = futureTransactions.reduce((shares, transaction) =>
            shares + (getTransactionType(transaction) === 'buy' ? -(Number(transaction.shares) || 0) : (Number(transaction.shares) || 0)),
            Number(series.stock.shares) || 0
        );
        futureTransactions.forEach(transaction => {
            const type = getTransactionType(transaction);
            const netAmount = Number.isFinite(Number(transaction.netAmount))
                ? Number(transaction.netAmount)
                : calculateTradingCost({
                    type,
                    price: Number(transaction.price) || 0,
                    shares: Number(transaction.shares) || 0,
                    stock: series.stock
                }).netAmount;
            cashEventsByDate.set(transaction.date, (cashEventsByDate.get(transaction.date) || 0) + (type === 'buy' ? -netAmount : netAmount));
        });
        return { ...series, shares: Math.max(0, startingShares), priceIndex: 0, currentPrice: null };
    });

    const startingCash = (Number(state.cash) || 0) - [...cashEventsByDate.values()].reduce((sum, value) => sum + value, 0);
    let cashValue = startingCash;
    const rows = dates.map((date, index) => {
        if (index > 0) {
            cashValue += cashEventsByDate.get(date) || 0;
            seriesState.forEach(series => series.transactions
                .filter(transaction => transaction.date === date)
                .forEach(transaction => {
                    series.shares += getTransactionType(transaction) === 'buy'
                        ? Number(transaction.shares) || 0
                        : -(Number(transaction.shares) || 0);
                }));
        }
        let stockValue = 0;
        seriesState.forEach(series => {
            while (series.priceIndex < series.prices.length && series.prices[series.priceIndex].date <= date) {
                series.currentPrice = series.prices[series.priceIndex].close;
                series.priceIndex += 1;
            }
            if (series.currentPrice !== null && series.shares > 0) stockValue += series.shares * series.currentPrice;
        });
        return { date, stockValue, cashValue, totalValue: stockValue + cashValue };
    });

    let previousTotal = null;
    let cumulativePnl = 0;
    rows.forEach(row => {
        row.dailyPnl = previousTotal === null ? 0 : row.totalValue - previousTotal;
        row.dailyReturn = previousTotal > 0 ? (row.dailyPnl / previousTotal) * 100 : 0;
        cumulativePnl += row.dailyPnl;
        row.cumulativePnl = cumulativePnl;
        previousTotal = row.totalValue;
    });
    return rows;
}

function renderDailyPnlChart(rows) {
    const section = document.getElementById('daily-pnl-section');
    const summary = document.getElementById('daily-pnl-summary');
    const canvas = document.getElementById('daily-pnl-chart');
    if (!section || !summary || !canvas) return;
    if (dailyPnlChart) {
        dailyPnlChart.destroy();
        dailyPnlChart = null;
    }
    if (rows.length === 0) {
        section.classList.add('hidden');
        return;
    }

    section.classList.remove('hidden');
    const displayRows = rows.slice(-60);
    const latest = displayRows[displayRows.length - 1];
    const pnlClass = latest.dailyPnl >= 0 ? 'text-[#22C55E]' : 'text-[#EF4444]';
    const cumulativeClass = latest.cumulativePnl >= 0 ? 'text-[#22C55E]' : 'text-[#EF4444]';
    summary.innerHTML = `
        <div><div class="text-[10px] font-bold text-slate-400">最新每日盈虧</div><div class="text-lg font-black ${pnlClass}">${latest.dailyPnl >= 0 ? '+' : '-'}NT$${fmt(Math.abs(latest.dailyPnl))}</div></div>
        <div class="text-right"><div class="text-[10px] font-bold text-slate-400">累計盈虧</div><div class="text-lg font-black ${cumulativeClass}">${latest.cumulativePnl >= 0 ? '+' : '-'}NT$${fmt(Math.abs(latest.cumulativePnl))}</div></div>`;

    dailyPnlChart = new Chart(canvas.getContext('2d'), {
        type: 'line',
        data: {
            labels: displayRows.map(row => row.date.slice(5)),
            datasets: [
                {
                    label: '每日盈虧',
                    data: displayRows.map(row => row.dailyPnl),
                    borderColor: '#0F172A',
                    backgroundColor: 'rgba(15, 23, 42, 0.08)',
                    borderWidth: 1.8,
                    pointRadius: 0,
                    tension: 0.25,
                    fill: true
                },
                {
                    label: '累計盈虧',
                    data: displayRows.map(row => row.cumulativePnl),
                    borderColor: '#2563EB',
                    borderWidth: 2,
                    pointRadius: 0,
                    tension: 0.25,
                    yAxisID: 'cumulative'
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: { labels: { boxWidth: 10, font: { size: 10 } } },
                tooltip: { callbacks: { label: context => `${context.dataset.label}: NT$${fmt(context.parsed.y)}` } }
            },
            scales: {
                x: { ticks: { maxTicksLimit: 6, font: { size: 9 } }, grid: { display: false } },
                y: { ticks: { callback: value => `NT$${fmt(value)}`, font: { size: 9 } } },
                cumulative: { position: 'right', grid: { drawOnChartArea: false }, ticks: { callback: value => `NT$${fmt(value)}`, font: { size: 9 } } }
            }
        }
    });
    const source = document.getElementById('daily-pnl-source');
    if (source) source.textContent = `資料截至 ${latest.date}（每日手動更新資料最後一筆）`;
}

function renderDailyPerformanceTable() {
    const container = document.getElementById('daily-performance-container');
    if (!container) return;
    const rows = calculateDailyPortfolioHistory();
    renderDailyPnlChart(rows);
    if (rows.length === 0) {
        container.innerHTML = '<div class="glass-card p-6 text-center text-xs font-semibold text-slate-400 border-dashed">尚無歷史價格資料，請先至市場水位抓取歷史高低點。</div>';
        return;
    }

    const displayRows = rows.slice(-60).reverse();
    const color = value => value >= 0 ? 'text-[#22C55E]' : 'text-[#EF4444]';
    container.innerHTML = `
        <div class="glass-card overflow-hidden">
            <div class="overflow-x-auto max-h-[480px] overflow-y-auto">
                <table class="w-full min-w-[680px] text-[11px]">
                    <thead class="sticky top-0 bg-slate-100/95 text-slate-500 font-black z-10">
                        <tr>
                            <th class="px-3 py-2.5 text-left">日期</th>
                            <th class="px-3 py-2.5 text-right">總資產</th>
                            <th class="px-3 py-2.5 text-right">股票市值</th>
                            <th class="px-3 py-2.5 text-right">現金</th>
                            <th class="px-3 py-2.5 text-right">每日盈虧</th>
                            <th class="px-3 py-2.5 text-right">報酬率</th>
                            <th class="px-3 py-2.5 text-right">累計盈虧</th>
                        </tr>
                    </thead>
                    <tbody class="divide-y divide-slate-100">
                        ${displayRows.map(row => `
                            <tr class="bg-white hover:bg-slate-50">
                                <td class="px-3 py-2.5 font-bold text-slate-700">${escapeHtml(row.date)}</td>
                                <td class="px-3 py-2.5 text-right font-black text-slate-800">NT$${fmt(row.totalValue)}</td>
                                <td class="px-3 py-2.5 text-right text-slate-600">NT$${fmt(row.stockValue)}</td>
                                <td class="px-3 py-2.5 text-right text-slate-600">NT$${fmt(row.cashValue)}</td>
                                <td class="px-3 py-2.5 text-right font-bold ${color(row.dailyPnl)}">${row.dailyPnl >= 0 ? '+' : '-'}NT$${fmt(Math.abs(row.dailyPnl))}</td>
                                <td class="px-3 py-2.5 text-right font-bold ${color(row.dailyReturn)}">${row.dailyReturn >= 0 ? '+' : ''}${row.dailyReturn.toFixed(2)}%</td>
                                <td class="px-3 py-2.5 text-right font-bold ${color(row.cumulativePnl)}">${row.cumulativePnl >= 0 ? '+' : '-'}NT$${fmt(Math.abs(row.cumulativePnl))}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        </div>`;
}

// ==========================================
// 核心數據引擎 (修復 NaN 錯誤的關鍵)
// ==========================================
function calculatePortfolioState() {
    let totalDisplayStockValue = 0; 
    let activeStockValue = 0;       
    let weightedBetaSum = 0;
    let totalTargetWeight = 0;
    let totalGrossPnL = 0;
    let totalPaidCostSum = 0;

    if (state && state.stocks) {
        state.stocks.forEach(s => {
            const currentPrice = s.price || s.costPrice || 0;
            const val = Math.round(s.shares * currentPrice); 
            totalDisplayStockValue += val; 

            const allInCost = calculateAllInCost(s, currentPrice);
            totalPaidCostSum += allInCost.totalCost;
            totalGrossPnL += (val - allInCost.totalCost);

            const weight = parseFloat(s.targetWeight) || 0;
            if (weight > 0) {
                totalTargetWeight += weight;
                activeStockValue += val;
                weightedBetaSum += val * (s.beta || 1);
            }
        });
    }
    
    const displayTotal = totalDisplayStockValue + state.cash;
    const displayCashRatio = displayTotal > 0 ? (state.cash / displayTotal) * 100 : 0;
    
    const activeTotal = activeStockValue + state.cash;
    const portfolioBeta = activeTotal > 0 ? (weightedBetaSum / activeTotal) : 0;

    let targetWeightedBetaSum = 0;
    if (totalTargetWeight > 0) {
        state.stocks.forEach(s => {
            const weight = parseFloat(s.targetWeight) || 0;
            if (weight > 0) {
                const normalizedRatio = weight / totalTargetWeight;
                targetWeightedBetaSum += normalizedRatio * (s.beta || 1);
            }
        });
    }
    const targetBeta = (state.targetStockRatio / 100) * targetWeightedBetaSum;

    return {
        totalDisplayStockValue,
        activeStockValue,
        totalTargetWeight,
        totalGrossPnL,
        totalPaidCostSum,
        displayTotal,
        displayCashRatio,
        activeTotal,
        portfolioBeta,
        targetBeta
    };
}

// ==========================================
// 全域 UI 數據整合更新 (觸發各模組重新渲染)
// ==========================================
function updateAllData() {
    const metrics = calculatePortfolioState();
    
    // 1. 總覽面板數值更新
    const elTotalAsset = document.getElementById('total-asset-value');
    const elTotalStock = document.getElementById('total-stock-value');
    const elCashVal = document.getElementById('cash-value-display');
    const elChartCenter = document.getElementById('chart-center-text');
    const elCashRatio = document.getElementById('cash-ratio-badge');

    if (elTotalAsset) elTotalAsset.innerText = fmt(metrics.displayTotal);
    if (elTotalStock) elTotalStock.innerText = fmt(metrics.totalDisplayStockValue);
    if (elCashVal) elCashVal.innerText = fmt(state.cash);
    if (elChartCenter) elChartCenter.innerText = `現金 ${Math.round(metrics.displayCashRatio)}%`;
    if (elCashRatio) elCashRatio.innerText = `${Math.round(metrics.displayCashRatio)}%`;

    const pBeta = document.getElementById('portfolio-beta');
    const tBeta = document.getElementById('target-portfolio-beta');
    const rBetaFlow = document.getElementById('rebalance-beta-flow');
    if (pBeta) pBeta.innerText = metrics.portfolioBeta.toFixed(2);
    if (tBeta) tBeta.innerText = metrics.targetBeta.toFixed(2);
    if (rBetaFlow) rBetaFlow.innerText = `${metrics.portfolioBeta.toFixed(2)} ➔ ${metrics.targetBeta.toFixed(2)}`;

    // 2. 總盈虧更新
    const summaryEl = document.getElementById('total-pnl-summary');
    if (metrics.totalPaidCostSum > 0 && summaryEl) {
        summaryEl.classList.remove('hidden');
        const pnlPercent = (metrics.totalGrossPnL / metrics.totalPaidCostSum) * 100;
        const pnlAmountEl = document.getElementById('total-pnl-amount');
        const pnlPercentEl = document.getElementById('total-pnl-percent');
        
        if (pnlAmountEl) pnlAmountEl.innerText = `${metrics.totalGrossPnL >= 0 ? '' : '-'}NT$ ${fmt(Math.abs(metrics.totalGrossPnL))}`;
        if (pnlPercentEl) pnlPercentEl.innerText = `${metrics.totalGrossPnL >= 0 ? '' : '-'}${Math.abs(pnlPercent).toFixed(2)}%`;
        
        if (metrics.totalGrossPnL >= 0) {
            if (pnlAmountEl) pnlAmountEl.className = 'text-3xl font-black text-[#22C55E] tracking-tight';
            if (pnlPercentEl) pnlPercentEl.className = 'text-sm font-bold text-[#22C55E]';
        } else {
            if (pnlAmountEl) pnlAmountEl.className = 'text-3xl font-black text-slate-800 tracking-tight';
            if (pnlPercentEl) pnlPercentEl.className = 'text-sm font-bold text-slate-500';
        }
    } else if (summaryEl) {
        summaryEl.classList.add('hidden');
    }

    // 3. 股票清單卡片渲染 (依附 index.html 的 stock-cards-container)
    const stockListEl = document.getElementById('stock-cards-container') || document.getElementById('stock-list');
    if (stockListEl) {
        stockListEl.innerHTML = state.stocks.length === 0 ? 
            '<div class="glass-card p-8 text-center text-slate-400 font-semibold border-dashed">尚無股票資料<br><span class="text-xs font-normal mt-1 block">請至設定頁手動新增或匯入CSV</span></div>' : 
            state.stocks.map((s, index) => {
            
            const currentPrice = s.price || s.costPrice || 0;
            const currentValue = Math.round(s.shares * currentPrice); 
            const ratio = metrics.displayTotal > 0 ? (currentValue / metrics.displayTotal) * 100 : 0;
            
            const nameDisplay = escapeHtml(typeof formatStockName === 'function' ? formatStockName(s) : (s.name || s.symbol || 'Unknown'));
            const symbolDisplay = escapeHtml(s.symbol ? `${s.symbol}.TW` : '');
            
            const isExcluded = (parseFloat(s.targetWeight) || 0) <= 0;

            const costPrice = s.costPrice !== undefined ? s.costPrice : currentPrice;
            const allInCost = calculateAllInCost(s, currentPrice);
            const paidCost = allInCost.totalCost;
            const displayAverageCost = allInCost.averageCost || costPrice;
            const transactionBreakdown = calculateTransactionBreakdown(s);
            
            const grossPnL = currentValue - paidCost;
            const grossPnLPercent = paidCost > 0 ? (grossPnL / paidCost) * 100 : 0;
            const pnlColorClass = grossPnL >= 0 ? 'text-[#22C55E]' : 'text-[#EF4444]';
            const pnlSign = grossPnL >= 0 ? '+' : '';

            let dailyChangeHTML = '';
            if (s.changePercent !== undefined) {
                const cp = parseFloat(s.changePercent) || 0;
                if (cp > 0) {
                    dailyChangeHTML = `<span class="text-[14px] sm:text-[15px] font-black text-[#22C55E] tracking-tight">▲${cp.toFixed(2)}%</span>`;
                } else if (cp < 0) {
                    dailyChangeHTML = `<span class="text-[14px] sm:text-[15px] font-black text-[#EF4444] tracking-tight">▼${Math.abs(cp).toFixed(2)}%</span>`;
                } else {
                    dailyChangeHTML = `<span class="text-[14px] sm:text-[15px] font-black text-slate-400 tracking-tight">0.00%</span>`;
                }
            } else {
                dailyChangeHTML = `<span class="text-[14px] sm:text-[15px] font-black text-slate-300 tracking-tight">--</span>`;
            }
            
            return `
            <div class="glass-card p-4 transition-all hover:border-slate-300 relative overflow-hidden">
                
                <!-- 卡片頂部標題與操作按鈕 -->
                <div class="flex justify-between items-center mb-3 pb-3 border-b border-slate-100">
                    <div class="flex items-center gap-2 max-w-[60%]">
                        <span class="bg-slate-200 text-slate-900 text-sm px-2.5 py-1 rounded-md font-black shrink-0 shadow-inner">${Math.round(ratio)}%</span>
                        <div class="font-bold text-slate-900 text-base sm:text-lg tracking-wide truncate">
                            ${nameDisplay} 
                            <span class="text-slate-600 text-xs sm:text-sm font-semibold ml-1">${symbolDisplay} β=${s.beta || 1}</span>
                            ${isExcluded ? '<span class="text-xs font-bold text-slate-600 bg-slate-200 px-2 py-0.5 rounded ml-1">不參與平衡</span>' : ''}
                        </div>
                    </div>
                    
                    <!-- 右側操作按鈕區：水位、編輯、刪除 -->
                    <div class="flex items-center gap-1.5 shrink-0 relative z-20">
                        <button onclick="openWaterLevelDetail(${index})" class="flex items-center gap-1 px-3 py-1.5 text-xs sm:text-sm font-bold text-blue-700 bg-blue-100 border border-blue-200 hover:bg-blue-200 rounded-lg transition-colors" title="查看市場水位與歷史走勢">
                            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6"></path></svg>
                            <span>水位</span>
                        </button>
                        <button onclick="openEditModal(${index})" class="text-blue-600 hover:text-blue-800 hover:bg-slate-100 p-1.5 rounded-full transition-colors" title="編輯參數">
                            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"></path></svg>
                        </button>
                        <button onclick="promptRemoveStock(${index})" class="text-red-500 hover:text-red-700 hover:bg-slate-100 p-1.5 rounded-full transition-colors" title="刪除持股">
                            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                        </button>
                    </div>
                </div>

                <!-- 價格資訊三欄（直接顯示，不折疊） -->
                <div class="grid grid-cols-3 gap-2 mb-4">
                    <div class="bg-slate-100 border border-slate-200 p-2.5 rounded-xl flex flex-col justify-center items-center text-center">
                        <span class="text-xs font-bold text-slate-700 mb-0.5">當前現價</span>
                        <span class="text-base sm:text-xl font-black text-slate-900 tracking-tight">@${fmtPrice(currentPrice)}</span>
                    </div>
                    <div class="bg-slate-100 border border-slate-200 p-2.5 rounded-xl flex flex-col justify-center items-center text-center">
                        <span class="text-xs font-bold text-slate-700 mb-0.5">本日漲跌</span>
                        ${dailyChangeHTML}
                    </div>
                    <div class="bg-blue-50 border border-blue-200 p-2.5 rounded-xl flex flex-col justify-center items-center text-center">
                        <span class="text-xs font-bold text-blue-800 mb-0.5">含交易成本均價</span>
                        <span class="text-base sm:text-xl font-black text-blue-900 tracking-tight">@${fmtPrice(displayAverageCost)}</span>
                    </div>
                </div>

                <!-- 基礎持股數據雙欄（直接顯示，高對比度加深字體） -->
                <div class="grid grid-cols-2 text-sm text-slate-700 gap-y-2.5 mb-3 font-semibold">
                    <div class="flex items-center gap-1">持有股數: <span class="font-black text-slate-900">${fmt(s.shares)} 股</span></div>
                    <div class="flex items-center gap-1">目前盈虧: <span class="font-black ${pnlColorClass}">${pnlSign}NT$${fmt(Math.abs(grossPnL))} (${pnlSign}${Math.abs(grossPnLPercent).toFixed(2)}%)</span></div>
                    <div class="flex items-center gap-1">目前市值: <span class="font-black text-slate-900">NT$${fmt(currentValue)}</span></div>
                    <div class="flex items-center gap-1">付出成本: <span class="font-black text-slate-900">NT$${fmt(paidCost)}</span></div>
                </div>

                <!-- 唯獨「成本明細」保留折疊功能 -->
                <details class="pt-2 border-t border-slate-200 group/sub">
                    <summary class="text-xs font-bold text-slate-700 cursor-pointer flex items-center justify-between select-none list-none py-1.5 hover:text-slate-900">
                        <span>成本明細</span>
                        <svg class="w-4 h-4 text-slate-600 transition-transform group-open/sub:rotate-180" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path></svg>
                    </summary>
                    <div class="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs text-slate-600 pt-2 border-t border-slate-200 mt-1 font-medium">
                        <div>買進成交金額 <span class="font-bold text-slate-900">NT$${fmt(transactionBreakdown.buyAmount)}</span></div>
                        <div>買進手續費 <span class="font-bold text-slate-900">NT$${fmt(transactionBreakdown.buyFee)}</span></div>
                        <div>若以現價賣出手續費 <span class="font-bold text-slate-900">NT$${fmt(allInCost.sellFee)}</span></div>
                        <div>若以現價賣出交易稅 <span class="font-bold text-slate-900">NT$${fmt(allInCost.sellTax)}</span></div>
                    </div>
                    <div class="mt-2 text-xs font-semibold text-slate-600">目前持有買入成本 <span class="font-black text-slate-900">NT$${fmt(allInCost.buyCost)}</span>。</div>
                </details>

            </div>`;
        }).join('');
    }

    // 4. 更新圓環圖
    renderChart(metrics.totalDisplayStockValue, state.cash);

    // 5. 觸發其他模組連動
    if (typeof populateQuickSelect === 'function') populateQuickSelect();
    if (typeof renderRebalanceResult === 'function') renderRebalanceResult(metrics);
    if (typeof syncWeightUI === 'function') syncWeightUI();
    if (typeof renderWaterLevel === 'function') renderWaterLevel();
    renderDailyPerformanceTable();
}

// ==========================================
// 圓環圖表渲染邏輯
// ==========================================
function renderChart(stockVal, cashVal) {
    const canvasEl = document.getElementById('assetChart');
    if (!canvasEl) return;
    const ctx = canvasEl.getContext('2d');
    
    const dStock = (stockVal === 0 && cashVal === 0) ? 0 : stockVal;
    const dCash = (stockVal === 0 && cashVal === 0) ? 1 : cashVal;
    const colors = (stockVal === 0 && cashVal === 0) ? ['#F1F5F9', '#F1F5F9'] : ['#0F172A', '#84CC16']; 

    if (assetChart) {
        assetChart.data.datasets[0].data = [dCash, dStock];
        assetChart.data.datasets[0].backgroundColor = colors;
        assetChart.update('none');
        return;
    }
    assetChart = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: ['現金', '股票'],
            datasets: [{
                data: [dCash, dStock],
                backgroundColor: colors,
                borderWidth: 0,
                hoverOffset: 0
            }]
        },
        options: {
            cutout: '72%',
            responsive: true,
            maintainAspectRatio: false,
            animation: { animateScale: true, animateRotate: true },
            plugins: { legend: { display: false }, tooltip: { enabled: false } }
        }
    });
}

// ==========================================
// 現金編輯彈窗邏輯
// ==========================================
function openCashEditModal() {
    const toggleEl = document.getElementById('modal-cash-mode-toggle');
    if (toggleEl) toggleEl.checked = false;
    toggleCashMode('modal'); 
    
    const cashValEl = document.getElementById('edit-cash-val');
    const originalCashEl = document.getElementById('modal-original-cash');
    if (cashValEl) cashValEl.value = state.cash;
    if (originalCashEl) originalCashEl.innerText = fmt(state.cash);
    
    const modal = document.getElementById('cash-edit-modal');
    const content = document.getElementById('cash-edit-modal-content');
    if (!modal) return;
    modal.classList.remove('hidden');
    void modal.offsetWidth; 
    modal.classList.remove('opacity-0');
    if (content) {
        content.classList.remove('scale-95');
        content.classList.add('scale-100');
    }
}

function closeCashEditModal() {
    const modal = document.getElementById('cash-edit-modal');
    const content = document.getElementById('cash-edit-modal-content');
    if (!modal) return;
    modal.classList.add('opacity-0');
    if (content) {
        content.classList.remove('scale-100');
        content.classList.add('scale-95');
    }
    setTimeout(() => modal.classList.add('hidden'), 200);
}

function toggleCashMode(context) {
    const toggleEl = document.getElementById(`${context}-cash-mode-toggle`);
    const textEl = document.getElementById(`${context}-cash-mode-text`);
    const inputEl = document.getElementById(context === 'modal' ? 'edit-cash-val' : 'cash-input');
    if (!toggleEl || !textEl || !inputEl) return;

    if (toggleEl.checked) {
        textEl.innerText = "模式：累加至原餘額";
        textEl.classList.replace('text-slate-700', 'text-green-600');
        inputEl.value = '';
        inputEl.placeholder = "輸入要增減的金額";
    } else {
        textEl.innerText = "模式：直接覆蓋";
        textEl.classList.replace('text-green-600', 'text-slate-700');
        inputEl.value = state.cash;
        inputEl.placeholder = "0";
    }
}

function appendCashInput(char) {
    const inputEl = document.getElementById('edit-cash-val');
    if (inputEl) {
        inputEl.value += char;
        inputEl.focus();
    }
}

function calculateExpression(valStr) {
    valStr = valStr.replace(/×/g, '*').replace(/÷/g, '/');
    const sanitized = valStr.replace(/[^0-9+\-*/().]/g, '');
    if (!sanitized) return 0;
    if (sanitized !== valStr.replace(/\s/g, '')) throw new Error("無效算式");

    const normalizedTokens = sanitized.match(/(?:\d+(?:\.\d*)?|\.\d+)|[+\-*/()]/g);
    if (!normalizedTokens || normalizedTokens.join('') !== sanitized) throw new Error("無效算式");
    let position = 0;
    const parseExpression = () => {
        let value = parseTerm();
        while (normalizedTokens[position] === '+' || normalizedTokens[position] === '-') {
            const operator = normalizedTokens[position++];
            const rhs = parseTerm();
            value = operator === '+' ? value + rhs : value - rhs;
        }
        return value;
    };
    const parseTerm = () => {
        let value = parseFactor();
        while (normalizedTokens[position] === '*' || normalizedTokens[position] === '/') {
            const operator = normalizedTokens[position++];
            const rhs = parseFactor();
            if (operator === '/' && rhs === 0) throw new Error("不可除以零");
            value = operator === '*' ? value * rhs : value / rhs;
        }
        return value;
    };
    const parseFactor = () => {
        const token = normalizedTokens[position++];
        if (token === '+' || token === '-') {
            const value = parseFactor();
            return token === '-' ? -value : value;
        }
        if (token === '(') {
            const value = parseExpression();
            if (normalizedTokens[position++] !== ')') throw new Error("括號不完整");
            return value;
        }
        if (!token || !/^\d+(?:\.\d*)?$|^\.\d+$/.test(token)) throw new Error("無效算式");
        return Number(token);
    };
    const result = parseExpression();
    if (position !== normalizedTokens.length) throw new Error("無效算式");
    if (isNaN(result) || !isFinite(result)) throw new Error("無效算式");
    return result;
}

function calculatePreview(context) {
    const inputId = context === 'modal' ? 'edit-cash-val' : 'cash-input';
    const inputEl = document.getElementById(inputId);
    if (!inputEl) return;
    try {
        if (inputEl.value.trim() === '') return;
        inputEl.value = calculateExpression(inputEl.value);
    } catch (err) {
        if (typeof showToast === 'function') showToast('計算式錯誤');
    }
}

function saveEditCash(e) {
    e.preventDefault();
    const inputVal = document.getElementById('edit-cash-val').value;
    const toggleEl = document.getElementById('modal-cash-mode-toggle');

    try {
        let calcResult = calculateExpression(inputVal);
        if (toggleEl && toggleEl.checked) calcResult = state.cash + calcResult;
        
        state.cash = calcResult; 
        saveState();
        updateAllData();
        closeCashEditModal();
        if (typeof showToast === 'function') showToast('現金餘額已更新');
    } catch (err) {
        if (typeof showToast === 'function') showToast('計算式錯誤，請檢查輸入內容');
    }
}

// ==========================================
// 總覽卡片快捷前往市場水位
// ==========================================
function openWaterLevelDetail(index) {
    if (!state.stocks || !state.stocks[index]) return;
    
    // 直接呼叫 waterlevel.js 的走勢圖 Modal
    if (typeof openTrendModal === 'function') {
        openTrendModal(index);
    } else if (typeof switchTab === 'function') {
        switchTab('waterlevel');
    }
}

// ==========================================
// 持股編輯與刪除邏輯
// ==========================================
let editingIndex = -1;

function openEditModal(index) {
    editingIndex = index;
    const stock = state.stocks[index];
    
    document.getElementById('edit-symbol').value = stock.symbol || '';
    document.getElementById('edit-name').value = stock.name || '';
    document.getElementById('edit-shares').value = stock.shares;
    
    const cp = stock.costPrice !== undefined ? stock.costPrice : (stock.price || 0);
    document.getElementById('edit-cost-price').value = cp;
    
    const buyValue = Math.round(stock.shares * cp);
    const defaultPc = buyValue + calculateBrokerageFee(buyValue);
    document.getElementById('edit-paid-cost').value = stock.paidCost !== undefined ? stock.paidCost : defaultPc;
    document.getElementById('edit-beta').value = stock.beta !== undefined ? stock.beta : 1;
    
    const modal = document.getElementById('edit-modal');
    const content = document.getElementById('edit-modal-content');
    if (!modal) return;
    modal.classList.remove('hidden');
    void modal.offsetWidth; 
    modal.classList.remove('opacity-0');
    if (content) {
        content.classList.remove('scale-95');
        content.classList.add('scale-100');
    }
}

function closeEditModal() {
    const modal = document.getElementById('edit-modal');
    const content = document.getElementById('edit-modal-content');
    if (!modal) return;
    modal.classList.add('opacity-0');
    if (content) {
        content.classList.remove('scale-100');
        content.classList.add('scale-95');
    }
    setTimeout(() => {
        modal.classList.add('hidden');
        editingIndex = -1;
    }, 200);
}

function saveEditStock(e) {
    e.preventDefault();
    if (editingIndex === -1) return;

    state.stocks[editingIndex].shares = parseFloat(document.getElementById('edit-shares').value);
    state.stocks[editingIndex].costPrice = parseFloat(document.getElementById('edit-cost-price').value);
    state.stocks[editingIndex].paidCost = parseFloat(document.getElementById('edit-paid-cost').value);
    const beta = parseFloat(document.getElementById('edit-beta').value);
    state.stocks[editingIndex].beta = Number.isFinite(beta) ? beta : 1;

    saveState();
    updateAllData();
    closeEditModal();
    if (typeof showToast === 'function') showToast('持股參數已更新');
}

function promptRemoveStock(index) {
    const stockName = typeof formatStockName === 'function' ? formatStockName(state.stocks[index]) : (state.stocks[index].name || state.stocks[index].symbol);
    if (typeof showConfirm === 'function') {
        showConfirm(`<span class="font-bold text-slate-900">${stockName}</span><br>確定要從清單中移除此檔股票嗎？`, () => {
            state.stocks.splice(index, 1);
            if (typeof balanceWeights === 'function') balanceWeights(); 
            saveState();
            if (typeof renderTargetStockWeights === 'function') renderTargetStockWeights();
            updateAllData();
            if (typeof showToast === 'function') showToast('已刪除股票');
        });
    }
}

// ==========================================
// 手動單筆新增與 Fugle 報價整合
// ==========================================
function populateQuickSelect() {
    const select = document.getElementById('quick-select-stock');
    if (!select) return;
    let html = '<option value="">-- 自現有持股帶入 --</option>';
    if (state && state.stocks) {
        state.stocks.forEach((s, idx) => {
            html += `<option value="${idx}">${typeof formatStockName === 'function' ? formatStockName(s) : s.symbol}</option>`;
        });
    }
    select.innerHTML = html;
}

function quickSelectStock(indexStr) {
    if (indexStr === '') return;
    const stock = state.stocks[parseInt(indexStr)];
    if (stock) {
        document.getElementById('add-symbol').value = stock.symbol || '';
        document.getElementById('add-name').value = stock.name || '';
        document.getElementById('add-beta').value = stock.beta || '';
    }
}

function executeMergeOrAdd(newStock) {
    let existing = state.stocks.find(s => s.symbol && s.symbol === newStock.symbol);
    if (existing) {
        const oldShares = Number(existing.shares) || 0;
        const newShares = Number(newStock.shares) || 0;
        const totalShares = oldShares + newShares;

        let oldPaidCost = existing.paidCost;
        if (oldPaidCost === undefined) {
            const oldBuyVal = Math.round(oldShares * (Number(existing.costPrice) || Number(existing.price) || 0));
            oldPaidCost = oldBuyVal + calculateBrokerageFee(oldBuyVal);
        }

        const addedPaidCost = Number(newStock.paidCost) || 0;
        existing.paidCost = Number(oldPaidCost) + addedPaidCost;
        if (totalShares > 0) {
            existing.costPrice = existing.paidCost / totalShares;
        }
        existing.shares = totalShares;
        if (!existing.name && newStock.name) existing.name = newStock.name;
    } else {
        if (newStock.targetWeight === undefined) {
            let isEtf = typeof isETFOrLeveraged === 'function' ? isETFOrLeveraged(newStock.symbol, newStock.name) : false;
            newStock.targetWeight = isEtf ? 1 : 0;
            newStock.isLocked = !isEtf; 
        }
        state.stocks.push(newStock);
    }

    if (typeof balanceWeights === 'function') balanceWeights(); 
    saveState();
    if (typeof renderTargetStockWeights === 'function') renderTargetStockWeights();
    updateAllData();
    if (typeof renderTradeTab === 'function' && document.getElementById('trade-tab-content')) renderTradeTab();
    const form = document.getElementById('add-stock-form');
    if (form) form.reset();
}

async function addStockSubmit(e) {
    e.preventDefault();
    const btn = document.getElementById('add-submit-btn');
    if (!btn) return;
    const originalBtnHTML = btn.innerHTML;
    btn.classList.add('opacity-70', 'pointer-events-none');
    btn.innerHTML = `處理中...`;

    const symbol = document.getElementById('add-symbol').value.trim();
    const shares = parseFloat(document.getElementById('add-shares').value);
    let name = document.getElementById('add-name').value.trim();
    let priceInput = document.getElementById('add-price').value; 
    let beta = document.getElementById('add-beta').value;

    let costPrice = parseFloat(priceInput) || 0;
    let currentPrice = costPrice;

    if ((!name || !priceInput) && state.apiKey) {
        try {
            const [tickerRes, quoteRes] = await Promise.all([
                fetch(`https://api.fugle.tw/marketdata/v1.0/stock/intraday/ticker/${symbol}`, { headers: { 'X-API-KEY': state.apiKey } }),
                fetch(`https://api.fugle.tw/marketdata/v1.0/stock/intraday/quote/${symbol}`, { headers: { 'X-API-KEY': state.apiKey } })
            ]);
            if (tickerRes.ok && quoteRes.ok) {
                const ticker = await tickerRes.json();
                const quote = await quoteRes.json();
                if (!name) name = ticker.name || symbol;
                if (!priceInput) {
                    currentPrice = quote.closePrice || quote.lastPrice || 0;
                    costPrice = currentPrice; 
                }
            }
        } catch (err) {
            console.log("Fugle API Fetch Error:", err);
        }
    }

    costPrice = parseFloat(costPrice) || 0;
    currentPrice = parseFloat(currentPrice) || costPrice;
    
    const isETFOrLevFunc = typeof isETFOrLeveraged === 'function' ? isETFOrLeveraged : () => false;
    beta = parseFloat(beta) || (isETFOrLevFunc(symbol, name) && name.includes('正2') ? 2 : 1);
    if (!name) name = symbol;

    if (!costPrice && !state.apiKey) {
        if (typeof showToast === 'function') showToast('無 API Key 或無網路連線，請手動輸入成本價');
        resetBtn();
        return;
    }

    const buyValue = Math.round(shares * costPrice);
    const buyFee = calculateBrokerageFee(buyValue);
    const paidCost = buyValue + buyFee;

    const newStock = { 
        name, 
        symbol, 
        shares, 
        price: currentPrice, 
        costPrice, 
        paidCost, 
        beta,
        transactions: [] 
    };

    newStock.transactions.push({
        id: "init_" + Date.now().toString(),
        date: new Date().toISOString().split('T')[0], 
        type: 'buy',
        price: costPrice,
        shares: shares,
        fee: buyFee,
        tax: 0,
        netAmount: paidCost
    });

    const commitAddition = () => {
        let existing = state.stocks.find(s => s.symbol === newStock.symbol);
        if (existing) {
            if (!existing.transactions) existing.transactions = [];
            existing.transactions.push(...newStock.transactions);
        }
        executeMergeOrAdd(newStock);
    };

    const isExist = state.stocks.some(s => s.symbol === symbol);
    if (isExist && typeof showConfirm === 'function') {
        showConfirm(`發現相同代號 <span class="font-bold">${symbol}</span>\n是否與現有持股合併加權計算？`, () => {
            commitAddition();
            if (typeof showToast === 'function') showToast(`已成功合併 ${name}`);
            resetBtn();
        });
        const confirmModal = document.getElementById('confirm-modal');
        if (confirmModal) {
            const cancelBtn = confirmModal.querySelector('button.bg-slate-100');
            if (cancelBtn) {
                const newCancel = cancelBtn.cloneNode(true);
                cancelBtn.parentNode.replaceChild(newCancel, cancelBtn);
                newCancel.addEventListener('click', () => {
                    if (typeof closeConfirm === 'function') closeConfirm();
                    if (typeof showToast === 'function') showToast('已取消新增動作');
                    resetBtn();
                });
            }
        }
    } else {
        commitAddition();
        if (typeof showToast === 'function') showToast(`已成功新增 ${name}`);
        resetBtn();
    }

    function resetBtn() {
        btn.classList.remove('opacity-70', 'pointer-events-none');
        btn.innerHTML = originalBtnHTML;
    }
}

async function fetchLatestPrices() {
    if (!state.apiKey || state.stocks.length === 0) return;
    
    const lastUpdateEl = document.getElementById('last-update');
    if (!lastUpdateEl) return;
    lastUpdateEl.innerText = "連線取得報價中...";
    if (lastUpdateEl.previousElementSibling) {
        lastUpdateEl.previousElementSibling.classList.remove('bg-green-500');
        lastUpdateEl.previousElementSibling.classList.add('bg-amber-500');
    }

    let updated = false;
    for (let stock of state.stocks) {
        if (!stock.symbol) continue;
        try {
            const fetches = [
                fetch(`https://api.fugle.tw/marketdata/v1.0/stock/intraday/quote/${stock.symbol}`, { headers: { 'X-API-KEY': state.apiKey } })
            ];
            const needsName = (!stock.name || stock.name === stock.symbol);
            if (needsName) {
                fetches.push(fetch(`https://api.fugle.tw/marketdata/v1.0/stock/intraday/ticker/${stock.symbol}`, { headers: { 'X-API-KEY': state.apiKey } }));
            }

            const responses = await Promise.all(fetches);
            if (responses[0].ok) {
                const quote = await responses[0].json();
                const latestPrice = quote.closePrice || quote.lastPrice || stock.price;
                stock.price = latestPrice;
                if ((Number(stock.shares) || 0) === 0 && !stock.firstPriceDate && latestPrice > 0) {
                    stock.costPrice = latestPrice;
                    stock.firstPriceDate = new Date().toISOString().split('T')[0];
                }
                stock.changePercent = quote.changePercent || 0; 
                updated = true;
            }
            if (needsName && responses[1] && responses[1].ok) {
                const ticker = await responses[1].json();
                if (ticker.name) {
                    stock.name = ticker.name;
                    updated = true;
                }
            }
        } catch (err) {
            console.log(`Failed to fetch ${stock.symbol}`, err);
        }
    }

    if (updated) {
        saveState();
        const now = new Date();
        lastUpdateEl.innerText = `最新報價 ${now.getHours().toString().padStart(2,'0')}:${now.getMinutes().toString().padStart(2,'0')}`;
        if (lastUpdateEl.previousElementSibling) {
            lastUpdateEl.previousElementSibling.classList.remove('bg-amber-500');
            lastUpdateEl.previousElementSibling.classList.add('bg-green-500');
        }
    } else {
        lastUpdateEl.innerText = "(目前無連線或使用歷史價格)";
        if (lastUpdateEl.previousElementSibling) {
            lastUpdateEl.previousElementSibling.classList.remove('bg-amber-500');
            lastUpdateEl.previousElementSibling.classList.add('bg-slate-400');
        }
    }
}

// ==========================================
// 手動更新按鈕：同時更新股票價格與市場水位資料
// ==========================================
async function manualRefreshFromChart() {
    const chartCenter = document.getElementById('chart-center-text');
    if (chartCenter) {
        chartCenter.classList.replace('bg-slate-900', 'bg-blue-500');
        chartCenter.classList.add('animate-pulse');
    }

    if (typeof showToast === 'function') {
        showToast('開始更新股票價格與市場水位資料...');
    }

    try {
        const tasks = [];

        // 1. 更新最新股票價格 (Fugle)
        if (typeof fetchLatestPrices === 'function') {
            tasks.push(fetchLatestPrices());
        }

        // 2. 更新市場水位歷史高低點與走勢資料 (FinMind)
        if (typeof fetchFinmindHighLow === 'function') {
            tasks.push(fetchFinmindHighLow());
        }

        await Promise.allSettled(tasks);

        saveState();
        updateAllData();
        if (typeof renderWaterLevel === 'function') {
            renderWaterLevel();
        }

        if (typeof showToast === 'function') {
            showToast('股票價格與市場水位已順利更新完成！');
        }
    } catch (error) {
        console.error('更新資料時發生錯誤:', error);
        if (typeof showToast === 'function') {
            showToast('資料更新過程發生異常');
        }
    } finally {
        if (chartCenter) {
            chartCenter.classList.replace('bg-blue-500', 'bg-slate-900');
            chartCenter.classList.remove('animate-pulse');
        }
    }
}

// ==========================================
// CSV 批次解析與補登交易簿功能
// ==========================================
function handleCSVUpload(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    
    const btn = e.target.previousElementSibling;
    let oriBtnHTML = btn ? btn.innerHTML : '';
    if (btn) {
        btn.innerHTML = `<span>解析匯入中...</span>`;
    }
    
    reader.onload = async (event) => {
        const text = event.target.result.replace(/^\uFEFF/, '');
        const lines = text.trim().split('\n');
        let processCount = 0;
        
        if (lines.length < 2) {
            resetUpload();
            return;
        }

        const headers = lines[0].trim().split(',').map(h => h.replace(/^"|"$/g, '').trim());
        const idxName = headers.indexOf('股票名稱');
        const idxShares = headers.indexOf('股數');
        const idxAvgPrice = headers.indexOf('成交均價');
        const idxPrice = headers.indexOf('市價');
        const idxPaidCost = headers.indexOf('付出成本');

        const nameIdx = idxName !== -1 ? idxName : 0;
        const sharesIdx = idxShares !== -1 ? idxShares : 1;
        const avgPriceIdx = idxAvgPrice !== -1 ? idxAvgPrice : 4;
        const priceIdx = idxPrice !== -1 ? idxPrice : 5;
        const paidCostIdx = idxPaidCost !== -1 ? idxPaidCost : 7;

        const requiredLength = Math.max(nameIdx, sharesIdx, avgPriceIdx);
        const csvImportDate = new Date().toISOString().split('T')[0];

        for (let i = 1; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line || line.includes('總預估') || line.includes('總融資')) continue;
            
            const row = line.match(/(".*?"|[^",\s]+)(?=\s*,|\s*$)/g);
            if (!row || row.length <= requiredLength) continue;
            
            const clean = row.map(v => v.replace(/^"|"$/g, '').replace(/,/g, ''));
            const name = clean[nameIdx];
            const shares = parseFloat(clean[sharesIdx]);
            const costPrice = parseFloat(clean[avgPriceIdx]);
            const currentPrice = parseFloat(clean[priceIdx]) || costPrice;
            let paidCost = parseFloat(clean[paidCostIdx]);
            
            if (isNaN(paidCost)) {
                const buyValue = Math.round(shares * costPrice);
                const buyFee = calculateBrokerageFee(buyValue);
                paidCost = buyValue + buyFee;
            }

            const symbol = symbolMap[name] || '';
            const beta = name.includes('正2') ? 2 : 1; 
            
            if (name && !isNaN(shares) && !isNaN(costPrice)) {
                const importCost = calculateTradingCost({
                    type: 'buy',
                    price: costPrice,
                    shares,
                    stock: { symbol, name }
                });

                const csvTransaction = {
                    id: "csv_" + Date.now().toString() + "_" + i,
                    date: csvImportDate,
                    type: 'buy',
                    price: costPrice,
                    shares: shares,
                    fee: importCost.fee,
                    tax: 0,
                    netAmount: paidCost
                };

                let existing = state.stocks.find(s => s.name === name);
                if (existing) {
                    const oldShares = existing.shares;
                    const totalShares = oldShares + shares;
                    let oldPaidCost = existing.paidCost;
                    if (oldPaidCost === undefined) {
                        const oldBuyVal = Math.round(oldShares * (existing.costPrice || existing.price));
                        oldPaidCost = oldBuyVal + calculateBrokerageFee(oldBuyVal);
                    }
                    existing.paidCost = oldPaidCost + paidCost;
                    
                    if (totalShares > 0) {
                        const oldCostPrice = existing.costPrice || existing.price || 0;
                        existing.costPrice = ((oldShares * oldCostPrice) + (shares * costPrice)) / totalShares;
                    }
                    existing.shares = totalShares;
                    if (!existing.transactions) existing.transactions = [];
                    existing.transactions.push(csvTransaction);
                } else {
                    let isEtf = isETF(symbol, name);
                    const newStock = { 
                        name, 
                        shares, 
                        price: currentPrice, 
                        costPrice, 
                        paidCost, 
                        symbol, 
                        beta,
                        targetWeight: isEtf ? 1 : 0,
                        isLocked: !isEtf,
                        transactions: [csvTransaction]
                    };
                    state.stocks.push(newStock);
                }
                processCount++;
            }
        }
        
        if (typeof balanceWeights === 'function') balanceWeights(); 
        saveState();
        if (typeof renderTargetStockWeights === 'function') renderTargetStockWeights();
        if (typeof showToast === 'function') showToast(`成功處理匯入 ${processCount} 檔股票並補登交易簿`);
        try {
            await fetchLatestPrices();
        } catch (e) {}
        updateAllData();
        resetUpload();
    };
    
    function resetUpload() {
        if (btn) btn.innerHTML = oriBtnHTML;
        e.target.value = '';
    }
    reader.readAsText(file);
}

// ==========================================
// MCE SMART PATCH - assets.js (CSV 寫入引擎升級)
// ==========================================

function processCSVRow(row) {
    const { symbol, name, shares, costPrice, date, type } = row;
    
    let existing = state.stocks.find(s => s.symbol === symbol);
    if (!existing) {
        existing = { symbol, name, shares: 0, costPrice: 0, transactions: [] };
        state.stocks.push(existing);
    }
    
    if (!existing.transactions) existing.transactions = [];

    const txShares = parseInt(shares) || 0;
    const txPrice = parseFloat(costPrice) || 0;
    const txType = (type === 'buy' || type === '買進') ? 'buy' : 'sell';
    
    const cost = calculateTradingCost({ type: txType, price: txPrice, shares: txShares, stock: { symbol, name } });

    existing.transactions.push({
        id: 'csv_' + Date.now() + Math.random().toString(36).substr(2, 9),
        type: txType,
        price: txPrice,
        shares: txShares,
        fee: cost.fee,
        tax: cost.tax,
        netAmount: cost.netAmount,
        date: date || new Date().toISOString().split('T')[0],
        note: 'CSV 批次匯入',
        isImported: true
    });

    if (txType === 'buy') {
        const totalCost = cost.netAmount;
        const prevPaidSum = (existing.costPrice || 0) * (existing.shares || 0);
        existing.shares += txShares;
        existing.costPrice = existing.shares > 0 ? (prevPaidSum + totalCost) / existing.shares : 0;
    } else {
        existing.shares -= txShares;
    }
    
    saveState();
}

// ==========================================
// 計算持股預估賣出成本（手續費與證交稅）
// ==========================================
function calculateEstimatedSellCost(stock, currentPrice) {
  const shares = stock.shares || 0;
  const price = currentPrice || stock.price || stock.costPrice || 0;
  if (shares <= 0 || !price) return { fee: 0, tax: 0, netValue: 0 };
  
  const { fee, tax, netAmount } = calculateTradingCost({ type: 'sell', price, shares, stock });
  return { fee, tax, netValue: netAmount };
}

// ==========================================
// 動態保本成本與動態保本均價（隨現價即時試算賣出稅費）
// ==========================================
function getBreakEvenCost(stock, currentPrice) {
  const shares = stock.shares || 0;
  const buyCost = (stock.costPrice || 0) * shares;
  if (shares <= 0) return { totalCost: 0, breakEvenPrice: 0, sellFee: 0, sellTax: 0 };

  const price = currentPrice || stock.price || stock.costPrice || 0;
  const sellCost = calculateEstimatedSellCost(stock, price);
  
  const totalCost = buyCost + sellCost.fee + sellCost.tax;
  const breakEvenPrice = totalCost / shares;

  return {
    totalCost,
    breakEvenPrice,
    sellFee: sellCost.fee,
    sellTax: sellCost.tax
  };
}