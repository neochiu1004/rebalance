// ==========================================
// MCE 模組化 - trade.js (交易主頁面)
// 版本: v1.0 (獨立頁面與 CSV 匯入整合)
// ==========================================

let tradeConfig = {
    type: 'buy', // 'buy' 或 'sell'
    stockIndex: -2, // -2 = 新增股票（首筆買進），-1 = 尚未選擇
    syncCash: true,
    manualFee: false
};

// 渲染整個交易 Tab 頁面
function renderTradeTab() {
    const container = document.getElementById('trade-tab-content'); // 假設 HTML 中有此容器
    if (!container) return;

    let stockOptions = `<option value="-2">＋新增股票（首筆買進）</option>`;
    if (state && state.stocks) {
        state.stocks.forEach((s, idx) => {
            const name = s.name || s.symbol;
            stockOptions += `<option value="${idx}">${escapeHtml(name)} (庫存: ${s.shares || 0})</option>`;
        });
    }

    const today = new Date().toISOString().split('T')[0];
    const isBuy = tradeConfig.type === 'buy';

    container.innerHTML = `
        <div class="max-w-xl mx-auto space-y-6">
            <!-- 標題與說明 -->
            <div>
                <h2 class="text-2xl font-bold text-slate-800">買賣紀錄</h2>
                <p class="text-xs text-slate-500 mt-1">手續費 0.1425%×28折（低消 1 元）、賣出證交稅 ETF 0.1% / 一般 0.3%，成本採移動加權平均</p>
            </div>

            <!-- 主表單卡片 -->
            <div class="bg-white rounded-2xl shadow-sm border border-slate-100 p-6">
                <!-- 買賣切換 -->
                <div class="flex rounded-lg bg-slate-100 p-1 mb-6">
                    <button onclick="setTradeTabType('buy')" class="flex-1 py-2 text-sm font-medium rounded-md transition-colors ${isBuy ? 'bg-red-600 text-white shadow' : 'text-slate-600 hover:text-slate-900'}">買進</button>
                    <button onclick="setTradeTabType('sell')" class="flex-1 py-2 text-sm font-medium rounded-md transition-colors ${!isBuy ? 'bg-green-600 text-white shadow' : 'text-slate-600 hover:text-slate-900'}">賣出</button>
                </div>

                <form onsubmit="submitTradeForm(event)" class="space-y-4">
                    <!-- 股票選擇 -->
                    <div>
                        <label class="block text-sm font-medium text-slate-700 mb-1">股票</label>
                        <select id="trade-stock-select" onchange="onTradeStockChange()" class="w-full border-slate-200 rounded-lg shadow-sm focus:border-blue-500 focus:ring-blue-500 text-sm">
                            ${stockOptions}
                        </select>
                        <p class="text-xs text-slate-400 mt-1">買進時可選「新增股票（首筆買進）」建立持股。</p>
                    </div>

                    <div id="new-stock-fields" class="grid grid-cols-2 gap-3 bg-lime-50 border border-lime-100 rounded-xl p-3">
                        <div>
                            <label class="block text-[10px] font-bold text-slate-500 mb-1">台股代號</label>
                            <input type="text" id="trade-new-symbol" placeholder="例：0050" class="w-full border-slate-200 rounded-lg text-sm">
                        </div>
                        <div>
                            <label class="block text-[10px] font-bold text-slate-500 mb-1">名稱（選填）</label>
                            <input type="text" id="trade-new-name" placeholder="例：元大台灣50" class="w-full border-slate-200 rounded-lg text-sm">
                        </div>
                        <div>
                            <label class="block text-[10px] font-bold text-slate-500 mb-1">Beta（選填）</label>
                            <input type="number" id="trade-new-beta" min="0" step="0.1" value="1" class="w-full border-slate-200 rounded-lg text-sm">
                        </div>
                    </div>

                    <!-- 日期與股數 -->
                    <div class="grid grid-cols-2 gap-4">
                        <div>
                            <label class="block text-sm font-medium text-slate-700 mb-1">日期</label>
                            <input type="date" id="trade-date" value="${today}" required class="w-full border-slate-200 rounded-lg shadow-sm focus:border-blue-500 focus:ring-blue-500 text-sm">
                        </div>
                        <div>
                            <label class="block text-sm font-medium text-slate-700 mb-1">股數</label>
                            <input type="number" id="trade-shares" min="1" step="1" oninput="calcTradePreview()" required class="w-full border-slate-200 rounded-lg shadow-sm focus:border-blue-500 focus:ring-blue-500 text-sm">
                        </div>
                    </div>

                    <!-- 成交價與手續費 -->
                    <div class="grid grid-cols-2 gap-4">
                        <div>
                            <label class="block text-sm font-medium text-slate-700 mb-1">成交價</label>
                            <input type="number" id="trade-price" min="0.01" step="0.01" oninput="calcTradePreview()" required class="w-full border-slate-200 rounded-lg shadow-sm focus:border-blue-500 focus:ring-blue-500 text-sm">
                        </div>
                        <div>
                            <label class="block text-sm font-medium text-slate-700 mb-1">手續費 (自動)</label>
                            <input type="number" id="trade-fee" value="0" min="0" step="1" oninput="calcTradePreview(true)" ${tradeConfig.manualFee ? '' : 'disabled'} class="w-full border-slate-200 rounded-lg shadow-sm focus:border-blue-500 focus:ring-blue-500 text-sm ${tradeConfig.manualFee ? '' : 'bg-slate-50'}">
                        </div>
                    </div>

                    <!-- 開關選項 -->
                    <div class="space-y-3 pt-2">
                        <div class="flex items-center justify-between bg-slate-50 p-3 rounded-lg">
                            <span class="text-sm font-medium text-slate-700">自行輸入手續費</span>
                            <label class="relative inline-flex items-center cursor-pointer">
                                <input type="checkbox" id="trade-manual-fee-toggle" class="sr-only peer" onchange="toggleManualFee()" ${tradeConfig.manualFee ? 'checked' : ''}>
                                <div class="w-9 h-5 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-blue-600"></div>
                            </label>
                        </div>
                        <div class="flex items-center justify-between bg-slate-50 p-3 rounded-lg">
                            <span class="text-sm font-medium text-slate-700">同步更新現金餘額</span>
                            <label class="relative inline-flex items-center cursor-pointer">
                                <input type="checkbox" id="trade-sync-cash-toggle" class="sr-only peer" onchange="toggleSyncCash()" ${tradeConfig.syncCash ? 'checked' : ''}>
                                <div class="w-9 h-5 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-slate-900"></div>
                            </label>
                        </div>
                    </div>

                    <!-- 試算總結 -->
                    <div class="bg-slate-50 rounded-lg p-4 space-y-2 mt-4">
                        <div class="flex justify-between text-sm text-slate-500">
                            <span>成交金額</span>
                            <span id="trade-preview-amount" class="font-medium text-slate-700">0</span>
                        </div>
                        <div class="flex justify-between text-base font-bold text-slate-800 pt-2 border-t border-slate-200">
                            <span>${isBuy ? '應付總額' : '應收總額'}</span>
                            <span id="trade-preview-total">0</span>
                        </div>
                    </div>

                    <button type="submit" class="w-full py-3 px-4 bg-slate-900 hover:bg-slate-800 text-white text-sm font-semibold rounded-lg shadow transition-colors mt-2">
                        記錄${isBuy ? '買進' : '賣出'}
                    </button>
                </form>
            </div>

            <!-- CSV 匯入區塊 -->
            <div class="bg-white rounded-2xl shadow-sm border border-slate-100 p-6 flex justify-between items-center">
                <div>
                    <h3 class="text-sm font-bold text-slate-800">CSV 批次匯入</h3>
                    <p class="text-xs text-slate-500 mt-1">匯入券商交易紀錄以自動補齊</p>
                </div>
                <label class="cursor-pointer bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold py-2 px-4 rounded-lg transition-colors">
                    選擇檔案
                    <input type="file" accept=".csv" class="hidden" onchange="handleCSVUpload(event)">
                </label>
            </div>

            <!-- 歷史紀錄列表 -->
            <div>
                <h3 class="text-lg font-bold text-slate-800 mb-3">歷史紀錄 <span id="global-history-count" class="text-sm text-slate-500 font-normal">(0)</span></h3>
                <div id="global-trade-history" class="space-y-3">
                    <!-- JS 渲染 -->
                </div>
            </div>
        </div>
    `;
    
    if (tradeConfig.stockIndex !== -1) {
        document.getElementById('trade-stock-select').value = tradeConfig.stockIndex;
    }
    onTradeStockChange();
    renderGlobalTradeHistory();
}

function setTradeTabType(type) {
    tradeConfig.type = type;
    renderTradeTab();
}

function onTradeStockChange() {
    tradeConfig.stockIndex = parseInt(document.getElementById('trade-stock-select').value);
    const isNew = tradeConfig.stockIndex === -2;
    const fields = document.getElementById('new-stock-fields');
    if (fields) fields.classList.toggle('hidden', !isNew);
    const buyOnly = tradeConfig.type === 'buy';
    if (fields) fields.classList.toggle('hidden', !isNew || !buyOnly);
    calcTradePreview();
}

function toggleManualFee() {
    tradeConfig.manualFee = document.getElementById('trade-manual-fee-toggle').checked;
    const feeInput = document.getElementById('trade-fee');
    feeInput.disabled = !tradeConfig.manualFee;
    if (tradeConfig.manualFee) {
        feeInput.classList.remove('bg-slate-50');
    } else {
        feeInput.classList.add('bg-slate-50');
        calcTradePreview(); // 重新自動計算
    }
}

function toggleSyncCash() {
    tradeConfig.syncCash = document.getElementById('trade-sync-cash-toggle').checked;
}

// 動態試算（使用共用交易核心）
function calcTradePreview(isManualFeeInput = false) {
    if (tradeConfig.stockIndex === -1) return;
    const stock = tradeConfig.stockIndex === -2 ? {
        symbol: document.getElementById('trade-new-symbol')?.value || '',
        name: document.getElementById('trade-new-name')?.value || ''
    } : state.stocks[tradeConfig.stockIndex];
    
    const price = parseFloat(document.getElementById('trade-price').value) || 0;
    const shares = parseInt(document.getElementById('trade-shares').value) || 0;
    const isBuy = tradeConfig.type === 'buy';

    const automaticCost = calculateTradingCost({ type: tradeConfig.type, price, shares, stock });
    const { tax, amount } = automaticCost;
    const autoFee = automaticCost.fee;

    let currentFee = autoFee;
    const feeInput = document.getElementById('trade-fee');
    
    if (tradeConfig.manualFee && isManualFeeInput) {
        currentFee = parseInt(feeInput.value) || 0;
    } else if (!tradeConfig.manualFee) {
        feeInput.value = currentFee;
    }

    const total = isBuy ? (amount + currentFee) : (amount - currentFee - tax);

    document.getElementById('trade-preview-amount').textContent = amount.toLocaleString();
    document.getElementById('trade-preview-total').textContent = total.toLocaleString();
}

// 提交表單
function submitTradeForm(e) {
    e.preventDefault();
    if (tradeConfig.stockIndex === -1) {
        if(typeof showToast === 'function') showToast('請先選擇股票');
        return;
    }

    const isNewStock = tradeConfig.stockIndex === -2;
    const price = parseFloat(document.getElementById('trade-price').value) || 0;
    const shares = parseInt(document.getElementById('trade-shares').value) || 0;
    const date = document.getElementById('trade-date').value;
    const fee = parseInt(document.getElementById('trade-fee').value) || 0;
    const isBuy = tradeConfig.type === 'buy';

    if (price <= 0 || shares <= 0) return;

    if (isNewStock && !isBuy) {
        if(typeof showToast === 'function') showToast('賣出交易請先選擇現有持股');
        return;
    }

    let stock;
    if (isNewStock) {
        const symbol = document.getElementById('trade-new-symbol').value.trim();
        if (!symbol) {
            if(typeof showToast === 'function') showToast('請輸入股票代號');
            return;
        }
        stock = state.stocks.find(item => String(item.symbol).toUpperCase() === symbol.toUpperCase());
        if (!stock) {
            stock = {
                symbol,
                name: document.getElementById('trade-new-name').value.trim() || symbol,
                shares: 0,
                price,
                costPrice: 0,
                paidCost: 0,
                beta: parseFloat(document.getElementById('trade-new-beta').value) || 1,
                transactions: []
            };
        }
    } else {
        stock = state.stocks[tradeConfig.stockIndex];
    }

    try {
        applyTransaction({
            stock,
            type: tradeConfig.type,
            price,
            shares,
            feeOverride: fee,
            date,
            note: '交易頁面新增',
            syncCash: tradeConfig.syncCash
        });
    } catch (error) {
        if(typeof showToast === 'function') showToast(error.message);
        return;
    }

    if (isNewStock && !state.stocks.includes(stock)) state.stocks.push(stock);

    saveState();
    if(typeof updateAllData === 'function') updateAllData();
    if(typeof showToast === 'function') showToast('交易紀錄已成功新增');
    
    // 重置表單並重新渲染
    document.getElementById('trade-shares').value = '';
    document.getElementById('trade-price').value = '';
    renderTradeTab();
}

// 渲染全域歷史紀錄
function renderGlobalTradeHistory() {
    const container = document.getElementById('global-trade-history');
    const countEl = document.getElementById('global-history-count');
    if (!container) return;

    let allTrans = [];
    state.stocks.forEach((s, sIdx) => {
        if (s.transactions) {
            s.transactions.forEach(t => {
                allTrans.push({ ...t, stockName: s.name || s.symbol, sIdx });
            });
        }
    });

    allTrans.sort((a, b) => new Date(b.date) - new Date(a.date));
    if(countEl) countEl.textContent = `(${allTrans.length})`;

    if (allTrans.length === 0) {
        container.innerHTML = `<div class="bg-slate-50 border border-slate-100 border-dashed rounded-xl p-8 text-center text-sm text-slate-500">尚無交易紀錄</div>`;
        return;
    }

    container.innerHTML = allTrans.map(t => {
        const isBuy = t.type === 'buy' || t.type === '買進';
        const typeColor = isBuy ? 'text-red-600 bg-red-50' : 'text-green-600 bg-green-50';
        return `
            <div class="bg-white p-4 rounded-xl shadow-sm border border-slate-100 flex justify-between items-center">
                <div>
                    <div class="flex items-center space-x-2 mb-1">
                        <span class="px-2 py-0.5 rounded text-xs font-bold ${typeColor}">${isBuy ? '買進' : '賣出'}</span>
                        <span class="text-sm font-bold text-slate-800">${escapeHtml(t.stockName)}</span>
                    </div>
                    <div class="text-xs text-slate-500 space-x-2">
                        <span>${escapeHtml(t.date)}</span>
                        <span>成交: ${t.price}</span>
                        <span>股數: ${t.shares}</span>
                    </div>
                </div>
                <div class="text-right">
                    <button onclick="deleteGlobalTransaction(${t.sIdx}, '${t.id}')" class="text-slate-400 hover:text-red-500 transition-colors p-1">
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                    </button>
                </div>
            </div>
        `;
    }).join('');
}

function deleteGlobalTransaction(stockIdx, transId) {
    if (confirm("確定要刪除這筆交易紀錄嗎？\n(注意：刪除不會自動回滾現金與持股，需手動校正)")) {
        const stock = state.stocks[stockIdx];
        if (!stock || !stock.transactions) return;
        stock.transactions = stock.transactions.filter(t => t.id !== transId);
        saveState();
        renderTradeTab();
        if(typeof showToast === 'function') showToast('已刪除該筆紀錄');
    }
}
