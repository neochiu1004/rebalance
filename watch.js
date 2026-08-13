function watchDaysAgo(date) {
    if (!date) return '';
    const days = Math.max(0, Math.floor((Date.now() - new Date(date + 'T00:00:00')) / 86400000));
    return `${date}（${days === 0 ? '今天' : days + ' 天前'}）`;
}

function addWatchStock() {
    const symbol = prompt('股票代號');
    if (!symbol) return;
    const name = prompt('股票名稱（可略）', symbol) || symbol;
    const price = Number(prompt('開始追蹤價位', '0')) || 0;
    if (price <= 0) return showToast('請輸入有效價位');
    const today = new Date().toISOString().split('T')[0];
    state.watchStocks.push({ symbol: symbol.trim(), name, price, costPrice: price, watchStartedAt: today, isWatch: true, highPrice: 0, lowPrice: 0, transactions: [] });
    saveState();
    renderWatchStocks();
    showToast('已加入觀察股票');
}

function removeWatchStock(index) {
    state.watchStocks.splice(index, 1);
    saveState();
    renderWatchStocks();
}

function renderWatchStocks() {
    const el = document.getElementById('watch-stock-list');
    if (!el) return;
    const stocks = state.watchStocks || [];
    el.innerHTML = stocks.length ? stocks.map((s, i) => `<div class="glass-card p-4"><div class="flex justify-between items-center mb-3"><div class="font-bold text-slate-900">${escapeHtml(s.name)} <span class="text-xs text-slate-400">${escapeHtml(s.symbol)}</span></div><button onclick="removeWatchStock(${i})" class="text-xs text-red-500">移除</button></div><div class="grid grid-cols-2 gap-2 text-center"><div class="price-badge-gray p-3 rounded-xl"><div class="text-[10px] text-slate-500">目前價位</div><b>${fmtPrice(s.price || s.costPrice)}</b></div><div class="price-badge-blue p-3 rounded-xl"><div class="text-[10px] text-blue-600">開始追蹤價</div><b>${fmtPrice(s.costPrice)}</b><div class="text-[10px] text-slate-400">${watchDaysAgo(s.watchStartedAt)}</div></div></div><button onclick="openWatchWaterLevel(${i})" class="mt-3 w-full text-xs text-blue-600">查看市場水位</button></div>`).join('') : '<div class="glass-card p-8 text-center text-slate-400">尚未加入觀察股票</div>';
}

function openWatchWaterLevel(index) {
    const stock = state.watchStocks[index];
    if (!stock) return;
    const old = state.stocks;
    state.stocks = [stock];
    openTrendModal(0);
    state.stocks = old;
}
