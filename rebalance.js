// ==========================================
// MCE 模組化 - rebalance.js (再平衡策略與極簡試算頁面)
// 版本: v14.5 (UI Redesign - 精準對齊設計圖)
// ==========================================

function balanceWeights() {
    if (!state || !state.stocks) return;
    let lockedSum = state.stocks.filter(s => s.isLocked).reduce((sum, s) => sum + parseFloat(s.targetWeight || 0), 0);
    let remainder = Math.max(0, 100 - lockedSum);
    let unlocked = state.stocks.filter(s => !s.isLocked);
    
    if (unlocked.length > 0) {
        let autoVal = remainder / unlocked.length;
        unlocked.forEach(s => { s.targetWeight = autoVal; });
    }
}

function loadCurrentStockRatios() {
    if (state.stocks.length === 0) {
        if (typeof showToast === 'function') showToast('目前沒有任何持股可以計算比例');
        return;
    }

    let totalStockVal = state.stocks.reduce((sum, s) => {
        const price = s.price || s.costPrice || 0;
        return sum + Math.round(s.shares * price);
    }, 0);

    if (totalStockVal <= 0) {
        if (typeof showToast === 'function') showToast('股票總市值為 0，無法計算現有比例');
        return;
    }

    state.stocks.forEach(s => {
        const price = s.price || s.costPrice || 0;
        const currentVal = Math.round(s.shares * price);
        s.targetWeight = parseFloat(((currentVal / totalStockVal) * 100).toFixed(1));
        s.isLocked = true; 
    });

    saveState();
    renderTargetStockWeights();
    if (typeof updateAllData === 'function') updateAllData();
    if (typeof showToast === 'function') showToast('已成功載入現有股票市值分配比例！');
}

function resetAllAutoBalance() {
    if (state.stocks.length === 0) {
        if (typeof showToast === 'function') showToast('目前沒有任何持股可以均分');
        return;
    }
    state.stocks.forEach(s => { s.isLocked = false; });
    balanceWeights();
    saveState();
    renderTargetStockWeights();
    if (typeof updateAllData === 'function') updateAllData();
    if (typeof showToast === 'function') showToast('已重置為全部自動均分');
}

function handleSliderDrag(index, val) {
    let stock = state.stocks[index];
    stock.isLocked = true; 

    let numVal = parseFloat(val) || 0;
    let otherLockedSum = state.stocks.reduce((sum, s, i) => (s.isLocked && i !== index) ? sum + parseFloat(s.targetWeight || 0) : sum, 0);

    let allowedVal = Math.min(numVal, 100 - otherLockedSum);
    allowedVal = Math.max(0, allowedVal); 
    stock.targetWeight = allowedVal;

    balanceWeights();
    syncWeightUI(); 
}

function handleSliderRelease() {
    saveState();
    renderTargetStockWeights();
    if (typeof updateAllData === 'function') updateAllData();
}

function syncWeightUI() {
    let lockedSum = 0;
    const metrics = calculatePortfolioState();
    const targetStockPoolValue = metrics.activeTotal * (state.targetStockRatio / 100);

    state.stocks.forEach((s, i) => {
        const slider = document.getElementById(`weight-slider-${i}`);
        const txt = document.getElementById(`weight-text-${i}`);
        if (slider && txt) {
            slider.value = s.targetWeight;
            txt.innerText = fmtPct(s.targetWeight) + '%';
        }
        if (s.isLocked) lockedSum += parseFloat(s.targetWeight || 0);

        const price = s.price || s.costPrice || 0;
        const targetValue = targetStockPoolValue * ((parseFloat(s.targetWeight) || 0) / 100);
        const currentValue = s.shares * price;
        const diffValue = targetValue - currentValue;

        const tSharesEl = document.getElementById(`target-shares-${i}`);
        const tValEl = document.getElementById(`target-val-${i}`);
        const dContainerEl = document.getElementById(`diff-container-${i}`);
        const dActionEl = document.getElementById(`diff-action-${i}`);
        const dSharesEl = document.getElementById(`diff-shares-${i}`);
        const dValEl = document.getElementById(`diff-val-${i}`);

        if (tSharesEl && tValEl && dContainerEl) {
            if (price <= 0) {
                tSharesEl.innerText = "--";
                tValEl.innerText = "無報價";
                if (dActionEl) dActionEl.innerText = "無法試算";
                if (dSharesEl) dSharesEl.innerText = "--";
                if (dValEl) dValEl.innerText = "--";
                dContainerEl.className = "text-[11px] font-medium text-slate-400 flex justify-between";
            } else {
                const targetShares = targetValue / price;
                const diffShares = diffValue / price;

                tSharesEl.innerText = fmt(targetShares);
                tValEl.innerText = "$" + fmt(targetValue);

                const isBuy = diffValue >= 0;
                if (dActionEl) dActionEl.innerText = isBuy ? "還需買進" : "還需賣出";
                
                const diffShareStr = (isBuy ? "+" : "-") + fmt(Math.abs(diffShares));
                const diffValStr = (isBuy ? "+$" : "-$") + fmt(Math.abs(diffValue));

                if (dSharesEl) dSharesEl.innerText = diffShareStr;
                if (dValEl) dValEl.innerText = diffValStr;

                dContainerEl.className = isBuy 
                    ? "text-[11px] font-medium text-[#22C55E] flex justify-between" 
                    : "text-[11px] font-medium text-[#EF4444] flex justify-between";
            }
        }
    });

    const sumTxt = document.getElementById('locked-sum-text');
    if (sumTxt) sumTxt.innerText = fmtPct(lockedSum);

    const remainTxt = document.getElementById('auto-remain-text');
    if (remainTxt) remainTxt.innerText = fmtPct(Math.max(0, 100 - lockedSum));
}

function toggleLock(index) {
    let stock = state.stocks[index];
    stock.isLocked = !stock.isLocked;
    saveState();
    renderTargetStockWeights();
    if (typeof updateAllData === 'function') updateAllData();
}

function updateTargetUI() {
    const elStockText = document.getElementById('target-stock-text');
    const elCashText = document.getElementById('target-cash-text');
    const elCashSlider = document.getElementById('target-cash-slider');
    const elStockSlider = document.getElementById('target-stock-slider');

    if (elStockText) elStockText.innerText = state.targetStockRatio;
    if (elCashText) elCashText.innerText = 100 - state.targetStockRatio;
    if (elCashSlider) elCashSlider.value = 100 - state.targetStockRatio;
    if (elStockSlider) elStockSlider.value = state.targetStockRatio;
}

// 選擇再平衡計算模式 (整體等比例 vs 精準對齊權重)
function setRebalanceMode(mode) {
    state.rebalanceMode = mode;
    saveState();
    if (typeof updateAllData === 'function') updateAllData();
    renderRebalanceResult();
    if (typeof showToast === 'function') {
        showToast(mode === 'global' ? '已切換模式：整體等比例' : '已切換模式：精準對齊權重');
    }
}

// ==========================================
// 核心渲染：精準對齊 UI 截圖之「再平衡試算」畫面
// ==========================================
function renderRebalanceResult(metrics) {
    if (!metrics) metrics = calculatePortfolioState();
    const actionList = document.getElementById('action-list');
    if (!actionList) return;

    // 1. 計算基本水位數值
    const activeStockRatio = metrics.activeTotal > 0 ? (metrics.activeStockValue / metrics.activeTotal) * 100 : 0;
    const targetStockPoolValue = metrics.activeTotal * (state.targetStockRatio / 100);
    const targetCashValue = metrics.activeTotal * ((100 - state.targetStockRatio) / 100);

    // 2. 更新頂部水位看板與數值
    const elCurrentWater = document.getElementById('current-stock-waterlevel-text');
    const elTargetWater = document.getElementById('target-stock-waterlevel-text');
    const elDevDisp = document.getElementById('deviation-display-text');
    const elDevSliderVal = document.getElementById('deviation-slider-val-text');
    const elDevSlider = document.getElementById('deviation-slider');

    if (elCurrentWater) elCurrentWater.innerText = `${activeStockRatio.toFixed(1)}%`;
    if (elTargetWater) elTargetWater.innerText = state.targetStockRatio;
    if (elDevDisp) elDevDisp.innerText = state.deviation || 5;
    if (elDevSliderVal) elDevSliderVal.innerText = state.deviation || 5;
    if (elDevSlider) elDevSlider.value = state.deviation || 5;

    // 3. 更新目標數值雙欄卡片
    const elTargetStockMarket = document.getElementById('target-stock-market-val');
    const elTargetCashMarket = document.getElementById('target-cash-market-val');

    if (elTargetStockMarket) elTargetStockMarket.innerText = fmt(targetStockPoolValue);
    if (elTargetCashMarket) elTargetCashMarket.innerText = fmt(targetCashValue);

    // 4. 更新調整方式按鈕選取狀態 (膠囊選單)
    const btnGlobal = document.getElementById('btn-mode-global');
    const btnIndividual = document.getElementById('btn-mode-individual');
    
    if (state.rebalanceMode === 'global') {
        if (btnGlobal) btnGlobal.className = "py-2.5 px-3 rounded-lg text-xs sm:text-sm font-black transition-all bg-slate-900 text-white shadow-sm";
        if (btnIndividual) btnIndividual.className = "py-2.5 px-3 rounded-lg text-xs sm:text-sm font-bold transition-all text-slate-600 hover:text-slate-900";
    } else {
        if (btnIndividual) btnIndividual.className = "py-2.5 px-3 rounded-lg text-xs sm:text-sm font-black transition-all bg-slate-900 text-white shadow-sm";
        if (btnGlobal) btnGlobal.className = "py-2.5 px-3 rounded-lg text-xs sm:text-sm font-bold transition-all text-slate-600 hover:text-slate-900";
    }

    // 5. 判斷偏離度觸發狀態
    let isDeviated = Math.abs(activeStockRatio - state.targetStockRatio) > state.deviation;

    if (!isDeviated && state.rebalanceMode === 'individual' && metrics.activeTotal > 0) {
        for (let s of state.stocks) {
            const weight = parseFloat(s.targetWeight) || 0;
            if (weight > 0) {
                const currentPrice = s.price || s.costPrice || 0;
                const currentValue = Math.round(s.shares * currentPrice);
                const normalizedRatio = weight / metrics.totalTargetWeight;
                const individualTargetValue = targetStockPoolValue * normalizedRatio;
                
                const currentProportion = (currentValue / metrics.activeTotal) * 100;
                const targetProportion = (individualTargetValue / metrics.activeTotal) * 100;
                
                if (Math.abs(currentProportion - targetProportion) > state.deviation) {
                    isDeviated = true;
                    break;
                }
            }
        }
    }

    // 更新狀態膠囊徽章
    const statusBadge = document.getElementById('rebalance-status-badge');
    if (statusBadge) {
        if (isDeviated) {
            statusBadge.className = "w-full py-2.5 px-4 rounded-xl font-bold text-xs sm:text-sm text-center transition-all flex items-center justify-center gap-2 bg-amber-50 text-amber-700 border border-amber-200 shadow-sm";
            statusBadge.innerHTML = `⚠️ 已超出容許偏離區間 (±${state.deviation}%)，建議執行再平衡`;
        } else {
            statusBadge.className = "w-full py-2.5 px-4 rounded-xl font-bold text-xs sm:text-sm text-center transition-all flex items-center justify-center gap-2 bg-emerald-50 text-emerald-700 border border-emerald-100 shadow-sm";
            statusBadge.innerHTML = `仍在容許區間內，可暫不調整`;
        }
    }

    // 6. 建議動作內容渲染
    const validTargetStocks = state.stocks.filter(s => (parseFloat(s.targetWeight) || 0) > 0);

    // 💡 空狀態防呆：若無設定任何目標權重 > 0 的股票 (對齊圖片中央虛線卡片)
    if (validTargetStocks.length === 0 || metrics.totalTargetWeight <= 0) {
        actionList.innerHTML = `
        <div class="glass-card p-12 text-center text-slate-400 font-bold text-sm border-2 border-dashed border-slate-200/80 rounded-2xl flex items-center justify-center min-h-[140px] tracking-wide">
            尚未設定任何目標權重
        </div>`;
        return;
    }

    // 有設定目標權重時，渲染詳細調倉試算清單
    let actionsHTML = '';
    const useGlobalEqually = (state.rebalanceMode === 'global' && metrics.activeStockValue > 0);
    const globalDiffStock = targetStockPoolValue - metrics.activeStockValue;

    let subItemsHTML = '';
    let totalStockDiff = 0;
    let totalBuyNeed = 0;
    let totalSellValue = 0;
    validTargetStocks.forEach((s) => {
        const weight = parseFloat(s.targetWeight) || 0;
        const currentPrice = s.price || s.costPrice || 0;
        const currentValue = Math.round(s.shares * currentPrice); 
        
        let diffStock = 0;
        if (useGlobalEqually) {
            const currentProportion = currentValue / metrics.activeStockValue;
            diffStock = globalDiffStock * currentProportion;
        } else {
            const normalizedRatio = weight / metrics.totalTargetWeight;
            const individualTargetValue = targetStockPoolValue * normalizedRatio;
            diffStock = individualTargetValue - currentValue;
        }
        
        totalStockDiff += diffStock;
        const isBuy = diffStock >= 0;
        // 再平衡建議以整股計算，並用同一套交易成本規則估算實際金額。
        const suggestShares = currentPrice > 0 ? Math.round(Math.abs(diffStock) / currentPrice) : 0;
        const suggestedTrade = currentPrice > 0 && suggestShares > 0
            ? calculateTradingCost({ type: isBuy ? 'buy' : 'sell', price: currentPrice, shares: suggestShares, stock: s })
            : { amount: 0, fee: 0, tax: 0, netAmount: 0 };
        const currentAverageCost = currentPrice > 0
            ? (calculateAllInCost(s, currentPrice).averageCost || Number(s.costPrice) || 0)
            : 0;
        const postAverageCost = currentPrice > 0
            ? calculatePostRebalanceAverageCost(s, currentPrice, isBuy ? 'buy' : 'sell', suggestShares)
            : 0;
        const averageCostChange = formatAverageCostChange(currentAverageCost, postAverageCost);
        const averageCostChangeClass = averageCostChange.startsWith('-')
            ? 'text-[#22C55E]'
            : averageCostChange.startsWith('+')
                ? 'text-[#EF4444]'
                : 'text-slate-500';
        if (isBuy) totalBuyNeed += suggestedTrade.netAmount;
        else totalSellValue += suggestedTrade.netAmount;
        const actionType = isBuy ? '買入' : '賣出';
        const actionColorClass = isBuy ? 'text-slate-900 font-black' : 'text-[#EF4444] font-black';
        const nameDisplay = escapeHtml(formatStockName(s));
        const actionDetail = `<div class="text-sm ${actionColorClass}">${actionType} ${fmt(suggestShares)} 股</div>
               <div class="text-[11px] text-slate-500 font-medium">計算股價 NT$${fmtPrice(currentPrice)}</div>
               <div class="text-[11px] text-slate-500 font-medium">${isBuy ? '買進總成本' : '賣出實收'} NT$${fmt(suggestedTrade.netAmount)}</div>
               <div class="text-[10px] text-slate-400">成交 NT$${fmt(suggestedTrade.amount)} · 手續費 NT$${fmt(suggestedTrade.fee)}${suggestedTrade.tax > 0 ? ` · 稅 NT$${fmt(suggestedTrade.tax)}` : ''}</div>`;
        const averageCostDetail = currentPrice > 0 && postAverageCost > 0
            ? `<div class="mt-1 text-[10px] font-bold ${averageCostChangeClass}">再平衡後均價 @${fmtPrice(postAverageCost)} · 與現有均價 ${averageCostChange}</div>`
            : currentPrice > 0
                ? '<div class="mt-1 text-[10px] text-slate-400">再平衡後均價 --（本次將清空持股）</div>'
                : '<div class="mt-1 text-[10px] text-slate-400">無法試算再平衡後均價</div>';

        subItemsHTML += `
        <div class="flex justify-between items-center py-3 border-b border-slate-100 last:border-0 px-1">
            <div class="font-bold text-slate-800 text-sm truncate max-w-[55%]">${nameDisplay}</div>
            <div class="text-right shrink-0">
                ${actionDetail}
                ${averageCostDetail}
            </div>
        </div>`;
    });

    const rebalanceModeStr = state.rebalanceMode === 'global' ? '整體等比例' : '精準對齊權重';
    const isAggregateBuy = totalStockDiff >= 0;
    const aggregateType = isAggregateBuy ? '組合加碼' : '組合減碼';
    const aggregateColorClass = isAggregateBuy ? 'bg-slate-900 text-white' : 'bg-[#EF4444] text-white';

    const availableForBuys = Math.max(0, Number(state.cash) || 0) + (state.cashFlowFirst ? totalSellValue : 0);
    const cashWarning = totalBuyNeed > availableForBuys
        ? `<div class="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-700">⚠️ 買進需求超過可用現金，建議先完成賣出，或降低股票目標比例。</div>`
        : `<div class="mb-4 rounded-xl border border-emerald-100 bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-700">✓ ${state.cashFlowFirst ? '已將預計賣出所得納入買進資金估算。' : '目前以現金餘額估算買進能力。'}</div>`;

    actionsHTML += `
    <div class="glass-card p-5 relative overflow-hidden shadow-sm">
        <div class="flex justify-between items-center mb-4 pb-3 border-b border-slate-100">
            <div class="flex items-center gap-2">
                <span class="text-base">⚖️</span>
                <span class="font-black text-slate-900">調倉試算建議</span>
                <span class="text-xs text-slate-400 font-semibold">(${rebalanceModeStr})</span>
            </div>
        </div>
        
        <div class="flex items-center justify-between mb-4 bg-slate-50 p-3 rounded-xl border border-slate-100">
            <span class="text-xs font-semibold text-slate-500">股票現值: <span class="text-slate-900 font-black">NT$${fmt(metrics.activeStockValue)}</span></span>
            <span class="text-slate-300 font-black">➔</span>
            <span class="text-xs font-semibold text-slate-500">目標總額: <span class="text-blue-600 font-black">NT$${fmt(targetStockPoolValue)}</span></span>
        </div>

        ${cashWarning}
        <div class="flex justify-between items-center mb-4 px-1">
            <div class="font-black text-base text-slate-900">總計畫差額</div>
            <div class="${aggregateColorClass} px-3 py-1.5 rounded-xl text-right shrink-0 shadow-sm flex items-center gap-2">
                <span class="text-xs font-bold opacity-90">${aggregateType}</span>
                <span class="text-base font-black">NT$${fmt(Math.abs(totalStockDiff))}</span>
            </div>
        </div>
        
        <div class="bg-white rounded-xl p-3 border border-slate-100 shadow-inner">
            <div class="text-[11px] font-bold text-slate-400 mb-1 px-1">個股調整細節：</div>
            ${subItemsHTML}
        </div>
    </div>`;

    actionList.innerHTML = actionsHTML;
}

function renderTargetStockWeights() {
    const container = document.getElementById('target-stock-weights-container');
    if (!container) return;

    if (state.stocks.length === 0) {
        container.innerHTML = '<div class="text-sm text-slate-400 text-center py-6 font-semibold bg-slate-50 border border-dashed border-slate-200">無持股資料，請先至設定頁新增</div>';
        return;
    }

    const lockedStocks = [];
    const autoStocks = [];

    state.stocks.forEach((s, idx) => {
        const isExcluded = (s.targetWeight === 0 && s.isLocked);
        const html = `
        <div class="flex flex-col p-3 hover:bg-slate-50 transition-colors border-b border-slate-100 last:border-0 ${isExcluded ? 'opacity-50' : ''}">
            <div class="flex justify-between items-center mb-2">
                <span class="font-bold text-sm truncate pr-3 text-slate-800">${escapeHtml(formatStockName ? formatStockName(s) : (s.name || s.symbol))}</span>
                <button onclick="toggleLock(${idx})" class="text-[10px] font-bold px-2.5 py-1 rounded-md transition-all active:scale-95 border ${s.isLocked ? 'bg-slate-800 text-white border-slate-800 shadow-sm' : 'bg-slate-50 text-slate-500 hover:bg-slate-100 border-slate-200'}">
                    ${s.isLocked ? '📌 已指定' : '🔓 自動分配'}
                </button>
            </div>
            <div class="flex items-center gap-3">
                <input type="range" id="weight-slider-${idx}" min="0" max="100" step="0.1" value="${s.targetWeight}"
                       oninput="handleSliderDrag(${idx}, this.value)"
                       onchange="handleSliderRelease()"
                       class="flex-1 h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-slate-900">
                <span id="weight-text-${idx}" class="text-sm font-black ${s.isLocked ? 'text-blue-600' : 'text-slate-600'} w-12 text-right">${fmtPct(s.targetWeight)}%</span>
            </div>
            <div class="mt-2 pt-2 border-t border-slate-100/60 flex flex-col gap-1">
                <div class="text-[11px] text-slate-500 font-medium flex justify-between">
                    <span>📊 調整後: <span id="target-shares-${idx}" class="font-bold text-slate-700">--</span> 股</span>
                    <span id="target-val-${idx}" class="font-bold text-slate-700">--</span>
                </div>
                <div class="text-[11px] font-medium text-slate-400 flex justify-between" id="diff-container-${idx}">
                    <span>💡 <span id="diff-action-${idx}">異動</span>: <span id="diff-shares-${idx}" class="font-bold">--</span> 股</span>
                    <span id="diff-val-${idx}" class="font-bold">--</span>
                </div>
            </div>
        </div>`;

        if (s.isLocked) lockedStocks.push(html);
        else autoStocks.push(html);
    });

    let lockedSum = state.stocks.filter(s => s.isLocked).reduce((sum, s) => sum + parseFloat(s.targetWeight||0), 0);
    let remain = Math.max(0, 100 - lockedSum);

    container.innerHTML = `
        <div class="bg-white">
            <div class="flex justify-between items-end px-3 py-2.5 bg-slate-100/80 border-b border-slate-200/60">
                <span class="text-[11px] font-bold text-slate-600 tracking-wide flex items-center gap-1.5"><span class="text-sm">📌</span> 已指定比例</span>
                <span class="text-[10px] font-bold text-slate-500 bg-white px-2 py-0.5 rounded shadow-sm border border-slate-200">總和: <span id="locked-sum-text" class="text-slate-800">${fmtPct(lockedSum)}</span>%</span>
            </div>
            <div class="pb-1">${lockedStocks.length > 0 ? lockedStocks.join('') : '<div class="text-[11px] text-slate-400 font-semibold text-center py-4 bg-slate-50/50">尚無鎖定項目</div>'}</div>
        </div>
        <div class="border-t-2 border-slate-100/80">
            <div class="flex justify-between items-end px-3 py-2.5 bg-blue-50/50 border-b border-slate-100/80">
                <span class="text-[11px] font-bold text-blue-700 tracking-wide flex items-center gap-1.5"><span class="text-sm">🔓</span> 自動均分部位</span>
                <span class="text-[10px] font-bold text-blue-600 bg-white px-2 py-0.5 rounded shadow-sm border border-blue-100">剩餘: <span id="auto-remain-text" class="text-blue-800">${fmtPct(remain)}</span>%</span>
            </div>
            <div>${autoStocks.length > 0 ? autoStocks.join('') : '<div class="text-[11px] text-slate-400 font-semibold text-center py-4 bg-slate-50/50">項目已全部鎖定指定</div>'}</div>
        </div>
    `;
    
    syncWeightUI();
}

// 以總覽相同的「含交易成本均價」口徑，試算建議交易完成後的均價。
function calculatePostRebalanceAverageCost(stock, currentPrice, type, shares) {
    const currentShares = Number(stock.shares) || 0;
    const tradeShares = Number(shares) || 0;
    const price = Number(currentPrice) || 0;
    if (currentShares <= 0 || tradeShares <= 0 || price <= 0) {
        return calculateAllInCost(stock, price).averageCost || Number(stock.costPrice) || 0;
    }

    const currentCost = calculateAllInCost(stock, price);
    const buyCostPerShare = currentShares > 0 ? currentCost.buyCost / currentShares : 0;
    const resultShares = type === 'buy'
        ? currentShares + tradeShares
        : Math.max(0, currentShares - tradeShares);
    if (resultShares <= 0) return 0;

    const tradeCost = calculateTradingCost({ type, price, shares: tradeShares, stock });
    const resultBuyCost = type === 'buy'
        ? currentCost.buyCost + tradeCost.netAmount
        : Math.max(0, currentCost.buyCost - buyCostPerShare * tradeShares);
    const resultStock = {
        ...stock,
        shares: resultShares,
        paidCost: resultBuyCost,
        costPrice: resultBuyCost / resultShares
    };
    return calculateAllInCost(resultStock, price).averageCost || 0;
}

function formatAverageCostChange(currentAverageCost, postAverageCost) {
    if (!Number.isFinite(currentAverageCost) || currentAverageCost <= 0 || !Number.isFinite(postAverageCost) || postAverageCost <= 0) {
        return '--';
    }
    const changePercent = ((postAverageCost - currentAverageCost) / currentAverageCost) * 100;
    const sign = changePercent > 0 ? '+' : '';
    return `${sign}${changePercent.toFixed(2)}%`;
}
