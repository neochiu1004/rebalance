// ==========================================
// MCE 模組化 - trade.js (交易主頁面)
// 版本: v1.0 (獨立頁面與 CSV 匯入整合)
// ==========================================

let tradeConfig = {
    type: 'buy', // 'buy' 或 'sell'
    stockIndex: -2, // -2 = 新增股票（首筆買進），-3 = 自追蹤清單帶入（仍屬新增持股），-1 = 尚未選擇
    watchIndex: -1, // stockIndex === -3 時，對應 state.watchStocks 的索引
    syncCash: true,
    manualFee: false
};

// 追蹤清單中尚未持有的股票（買入清單要列出這些，代號與持股重複的不重複列）
// 回傳 [{ watchIndex, symbol, name, price }]
function listWatchOnlyStocks() {
    if (typeof state === 'undefined' || !Array.isArray(state.watchStocks)) return [];
    const held = new Set((Array.isArray(state.stocks) ? state.stocks : []).map(s => String(s.symbol || '').toUpperCase()));
    const out = [];
    state.watchStocks.forEach((s, idx) => {
        const sym = String(s.symbol || '').toUpperCase();
        if (!sym || held.has(sym)) return;
        out.push({ watchIndex: idx, symbol: s.symbol, name: (s.name && s.name !== s.symbol) ? s.name : s.symbol, price: Number(s.price) || 0 });
    });
    return out;
}

// 渲染整個交易 Tab 頁面
function renderTradeTab() {
    const container = document.getElementById('trade-tab-content'); // 假設 HTML 中有此容器
    if (!container) return;

    let stockOptions = `<option value="-2">＋新增股票（首筆買進）</option>`;
    const heldSymbols = new Set();
    if (state && state.stocks) {
        state.stocks.forEach((s, idx) => {
            heldSymbols.add(String(s.symbol || '').toUpperCase());
            const name = s.name || s.symbol;
            stockOptions += `<option value="${idx}">${escapeHtml(name)} ${escapeHtml(s.symbol || '')} (庫存: ${s.shares || 0})</option>`;
        });
    }
    // 追蹤清單已有、但尚未持有的股票，也要能直接選來買入（去重：已持有的不重複列）
    listWatchOnlyStocks().forEach((w) => {
        const priceText = w.price > 0 ? ` @${w.price}` : '';
        stockOptions += `<option value="watch:${w.watchIndex}">${escapeHtml(w.name)} ${escapeHtml(w.symbol || '')} (追蹤${priceText})</option>`;
    });

    const today = localDateStr();
    const isBuy = tradeConfig.type === 'buy';

    container.innerHTML = `
        <div class="max-w-xl mx-auto space-y-6">
            <!-- 單一主動作：記錄一筆交易 -->
            <div>
                <h2 class="text-2xl font-bold text-slate-800">買賣紀錄</h2>
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
                            <input type="number" id="trade-shares" min="0" step="1" oninput="calcTradePreview()" required class="w-full border-slate-200 rounded-lg shadow-sm focus:border-blue-500 focus:ring-blue-500 text-sm">
                        </div>
                    </div>

                    <!-- 成交價與手續費 -->
                    <div class="grid grid-cols-2 gap-4">
                        <div>
                            <label class="block text-sm font-medium text-slate-700 mb-1">成交價</label>
                            <input type="number" id="trade-price" min="0" step="0.01" oninput="calcTradePreview()" class="w-full border-slate-200 rounded-lg shadow-sm focus:border-blue-500 focus:ring-blue-500 text-sm">
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
                    <h3 class="text-sm font-bold text-slate-800">匯入券商對帳單</h3>
                </div>
                <label class="cursor-pointer bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold py-2 px-4 rounded-lg transition-colors">
                    選擇檔案
                    <input type="file" accept=".csv" class="hidden" onchange="handleCSVUpload(event)">
                </label>
            </div>

            <!-- 底倉匯入區塊（庫存格式，不同於交易明細） -->
            <div class="bg-white rounded-2xl shadow-sm border border-slate-100 p-6 flex justify-between items-center">
                <div>
                    <h3 class="text-sm font-bold text-slate-800">匯入庫存建立底倉</h3>
                    <p class="text-xs text-slate-400 mt-1">券商庫存 CSV（股票名稱、股數、成交均價、市價、付出成本），建立現有持股，不扣現金；已有持股或已建立過底倉的會自動略過</p>
                </div>
                <label class="cursor-pointer bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold py-2 px-4 rounded-lg transition-colors shrink-0 ml-4">
                    選擇檔案
                    <input type="file" accept=".csv" class="hidden" onchange="handleBasePositionUpload(event)">
                </label>
            </div>

        </div>
    `;
    
    if (tradeConfig.stockIndex === -3 && tradeConfig.watchIndex >= 0) {
        const sel = document.getElementById('trade-stock-select');
        if (sel) sel.value = `watch:${tradeConfig.watchIndex}`;
    } else if (tradeConfig.stockIndex !== -1) {
        const sel = document.getElementById('trade-stock-select');
        if (sel) sel.value = tradeConfig.stockIndex;
    }
    onTradeStockChange(true);
    renderGlobalTradeHistory();
}

function setTradeTabType(type) {
    tradeConfig.type = type;
    renderTradeTab();
}

function onTradeStockChange(isRestore = false) {
    const select = document.getElementById('trade-stock-select');
    if (!select) return;
    const raw = String(select.value);
    if (raw === '') { tradeConfig.stockIndex = -2; tradeConfig.watchIndex = -1; select.value = '-2'; }
    else if (raw.startsWith('watch:')) {
        tradeConfig.stockIndex = -3;
        tradeConfig.watchIndex = parseInt(raw.slice(6), 10);
    } else {
        tradeConfig.stockIndex = parseInt(raw, 10);
        if (tradeConfig.stockIndex !== -3) tradeConfig.watchIndex = -1;
    }
    const isNew = tradeConfig.stockIndex === -2 || tradeConfig.stockIndex === -3;
    const fields = document.getElementById('new-stock-fields');
    const buyOnly = tradeConfig.type === 'buy';
    if (fields) fields.classList.toggle('hidden', !isNew || !buyOnly);
    // 選到追蹤股票時，自動帶入代號／名稱，現價帶入成交價（使用者仍可改）
    if (tradeConfig.stockIndex === -3 && !isRestore) {
        const watch = (state.watchStocks || [])[tradeConfig.watchIndex];
        if (watch) {
            const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
            set('trade-new-symbol', watch.symbol || '');
            set('trade-new-name', (watch.name && watch.name !== watch.symbol) ? watch.name : '');
            const priceEl = document.getElementById('trade-price');
            if (priceEl && Number(watch.price) > 0) priceEl.value = watch.price;
        }
    }
    // 還原（render 後）且為追蹤來源時，欄位是重建的，也要把追蹤資料帶回來
    if (tradeConfig.stockIndex === -3 && isRestore) {
        const watch = (state.watchStocks || [])[tradeConfig.watchIndex];
        const symEl = document.getElementById('trade-new-symbol');
        if (watch && symEl && !symEl.value) {
            const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
            set('trade-new-symbol', watch.symbol || '');
            set('trade-new-name', (watch.name && watch.name !== watch.symbol) ? watch.name : '');
            const priceEl = document.getElementById('trade-price');
            if (priceEl && !priceEl.value && Number(watch.price) > 0) priceEl.value = watch.price;
        }
    }
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

// 動態試算（統一由 core.js 之 calculateTradingCost 處理，並增強防呆）
function calcTradePreview(isManualFeeInput = false) {
    if (tradeConfig.stockIndex === -1) return;
    const stocksList = (typeof state !== 'undefined' && Array.isArray(state.stocks)) ? state.stocks : [];
    const stock = (tradeConfig.stockIndex === -2 || tradeConfig.stockIndex === -3) ? {
        symbol: document.getElementById('trade-new-symbol')?.value || '',
        name: document.getElementById('trade-new-name')?.value || ''
    } : stocksList[tradeConfig.stockIndex];
    
    const priceInput = document.getElementById('trade-price');
    const sharesInput = document.getElementById('trade-shares');
    const price = priceInput ? (parseFloat(priceInput.value) || 0) : 0;
    const shares = sharesInput ? (parseInt(sharesInput.value, 10) || 0) : 0;
    const isBuy = tradeConfig.type === 'buy';

    const manualFeeInput = document.getElementById('trade-fee');
    const manualFeeValue = (tradeConfig.manualFee && isManualFeeInput && manualFeeInput)
        ? (parseInt(manualFeeInput.value, 10) || 0)
        : null;

    if (typeof calculateTradingCost !== 'function') return;

    const automaticCost = calculateTradingCost({
        type: tradeConfig.type,
        price,
        shares,
        stock,
        feeOverride: manualFeeValue
    });
    const { tax, amount, fee: autoFee } = automaticCost;

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
async function submitTradeForm(e) {
    e.preventDefault();
    if (tradeConfig.stockIndex === -1) {
        if(typeof showToast === 'function') showToast('請先選擇股票');
        return;
    }

    const isNewStock = tradeConfig.stockIndex === -2 || tradeConfig.stockIndex === -3;
    let price = parseFloat(document.getElementById('trade-price').value) || 0;
    const shares = parseInt(document.getElementById('trade-shares').value) || 0;
    const date = document.getElementById('trade-date').value;
    let fee = parseInt(document.getElementById('trade-fee').value) || 0;
    const isBuy = tradeConfig.type === 'buy';

    if (isNewStock && !isBuy) {
        if(typeof showToast === 'function') showToast('賣出交易請先選擇現有持股');
        return;
    }

    // 新增股票只輸入代號時：存檔前自動補名稱與現價
    // 先查追蹤／持股快取，再查 Fugle；成交價沒填時用現價帶入，名稱沒填時用查到的名稱
    let fetchedInfo = null;
    if (isNewStock) {
        const symbolInput = document.getElementById('trade-new-symbol');
        const nameInput = document.getElementById('trade-new-name');
        const symbolForLookup = symbolInput ? symbolInput.value.trim() : '';
        const nameForLookup = nameInput ? nameInput.value.trim() : '';
        if (symbolForLookup && (typeof fetchStockInfoBySymbol === 'function') &&
            (!nameForLookup || nameForLookup.toUpperCase() === symbolForLookup.toUpperCase() || price <= 0)) {
            try { fetchedInfo = await fetchStockInfoBySymbol(symbolForLookup); } catch (_) { fetchedInfo = null; }
            if (fetchedInfo) {
                if (nameInput && (!nameForLookup || nameForLookup.toUpperCase() === symbolForLookup.toUpperCase()) && fetchedInfo.name) {
                    nameInput.value = fetchedInfo.name;
                }
                if (price <= 0 && fetchedInfo.price > 0) {
                    price = fetchedInfo.price;
                    const priceEl = document.getElementById('trade-price');
                    if (priceEl) priceEl.value = price;
                    // 用新價格重算手續費預覽，避免 fee 停在 0
                    calcTradePreview();
                    fee = parseInt(document.getElementById('trade-fee').value) || fee;
                }
            }
        }
    }

    if (!isNewStock && (price <= 0 || shares <= 0)) return;
    if (isNewStock && (shares < 0 || (shares > 0 && price <= 0))) {
        if (shares > 0 && price <= 0 && typeof showToast === 'function') {
            showToast(fetchedInfo && fetchedInfo.hasApiKey === false ? '找不到現價：請先至設定頁輸入 Fugle API Key，或手動輸入成交價' : '找不到現價，請手動輸入成交價');
        }
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
            const watchStock = (state.watchStocks || []).find(item => String(item.symbol || '').toUpperCase() === symbol.toUpperCase());
            const resolvedName = document.getElementById('trade-new-name').value.trim()
                || (fetchedInfo && fetchedInfo.name)
                || (watchStock && watchStock.name && watchStock.name !== watchStock.symbol ? watchStock.name : '')
                || symbol;
            const marketPrice = (fetchedInfo && fetchedInfo.price > 0) ? fetchedInfo.price
                : (watchStock && Number(watchStock.price) > 0 ? Number(watchStock.price) : price);
            stock = {
                symbol,
                name: resolvedName,
                shares: 0,
                price: marketPrice || price,
                costPrice: 0,
                paidCost: 0,
                beta: Number.isFinite(parseFloat(document.getElementById('trade-new-beta').value)) ? parseFloat(document.getElementById('trade-new-beta').value) : 1,
                transactions: []
            };
        } else if ((!stock.name || stock.name === stock.symbol) && fetchedInfo && fetchedInfo.name) {
            stock.name = fetchedInfo.name;
        }
    } else {
        stock = state.stocks[tradeConfig.stockIndex];
    }

    if (shares > 0) {
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
    }

    if (isNewStock && !state.stocks.includes(stock)) state.stocks.push(stock);

    // 若現價與成交價不同，持股現價以查到的市價為準（applyTransaction 不會改 stock.price）
    if (isNewStock && fetchedInfo && fetchedInfo.price > 0) stock.price = fetchedInfo.price;

    saveState();
    if(typeof updateAllData === 'function') updateAllData();
    if(typeof showToast === 'function') showToast('交易紀錄已成功新增');

    // 重置表單並重新渲染（追蹤來源已轉為持股，清單會去重，先回到新增模式避免還原失效的 watch 選項）
    tradeConfig.stockIndex = -2;
    tradeConfig.watchIndex = -1;
    renderTradeTab();
}

// 渲染全域歷史紀錄
function renderGlobalTradeHistory() {
    const container = document.getElementById('global-trade-history');
    const countEl = document.getElementById('global-history-count');
    if (!container) return;

    let allTrans = [];
    // 與 transactions.js 共用同一份彙整邏輯（core.collectAllTransactions）
    collectAllTransactions(state.stocks).forEach(item => allTrans.push(item));
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
                        <span>成交: ${escapeHtml(String(t.price ?? ''))}</span>
                        <span>股數: ${escapeHtml(String(t.shares ?? ''))}</span>
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
    if (confirm("確定要刪除這筆交易紀錄嗎？\n系統將自動回滾對應的現金餘額與持股成本。")) {
        const stock = state.stocks[stockIdx];
        if (!stock) return;
        // 統一走 core 的共用刪除（與個股明細刪除同一條路徑，避免兩邊行為不一致）
        const deleted = deleteTransactionWithRollback(stock, transId);
        if (!deleted) return;

        saveState();
        renderTradeTab();
        if (typeof updateAllData === 'function') updateAllData();
        if (typeof showToast === 'function') showToast('已刪除該筆紀錄並自動回滾現金與持股');
    }
}
