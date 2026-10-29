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
                        <span class="text-[10px] font-bold text-slate-400">${t.date}</span>
                    </div>
                    <div class="text-[11px] font-medium text-slate-500 mt-0.5">
                        單價 @${fmtPrice(t.price)} | 手續費 ${t.fee}${!isBuy ? ` | 稅 ${t.tax}` : ''}
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
