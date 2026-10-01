function addWatchStock() {
    const symbolInput = prompt('請輸入欲追蹤的台股代號（例：2330 或 0050）：');
    if (!symbolInput) return;
    const symbol = symbolInput.trim().toUpperCase();
    if (!symbol) return;

    if (!state.watchStocks) state.watchStocks = [];
    if (state.watchStocks.some(s => (s.symbol || '').toUpperCase() === symbol)) {
        if (typeof showToast === 'function') showToast('該股票已在追蹤清單中');
        return;
    }

    const name = prompt('股票名稱（可略，留空將自動帶入）：', '') || symbol;
    const today = new Date().toISOString().split('T')[0];

    const newWatch = {
        symbol,
        name: name.trim() || symbol,
        price: 0,
        change: 0,
        changePercent: 0,
        volume: 0,
        addedAt: today,
        isWatch: true,
        highPrice: null,
        lowPrice: null,
        historyData: []
    };

    state.watchStocks.push(newWatch);
    saveState();
    renderWatchStocks();
    if (typeof showToast === 'function') showToast(`已將 ${newWatch.name} 加入追蹤`);
    if (typeof fetchWatchStockPrices === 'function') fetchWatchStockPrices();
}

function removeWatchStock(index) {
    if (!state.watchStocks || !state.watchStocks[index]) return;
    const name = state.watchStocks[index].name || state.watchStocks[index].symbol;
    if (confirm(`確定不再追蹤 ${name} 嗎？`)) {
        state.watchStocks.splice(index, 1);
        saveState();
        renderWatchStocks();
        if (typeof showToast === 'function') showToast('已從追蹤清單移除');
    }
}

function renderWatchStocks() {
    const el = document.getElementById('watch-stock-list');
    if (!el) return;
    const stocks = state.watchStocks || [];

    if (stocks.length === 0) {
        el.innerHTML = `
            <div class="glass-card p-8 text-center text-slate-400 font-semibold border-dashed">
                尚未加入任何追蹤股票<br>
                <span class="text-xs font-normal mt-1 block">點擊上方「＋ 新增追蹤」關注市場標的</span>
            </div>`;
        return;
    }

    el.innerHTML = stocks.map((s, i) => {
        const name = escapeHtml(s.name || s.symbol);
        const symbol = escapeHtml(s.symbol);
        const price = Number(s.price) || 0;
        const cp = Number(s.changePercent) || 0;
        const chg = Number(s.change) || 0;
        const vol = Number(s.volume) || 0;

        // 漲跌色彩呈現 (台股慣例紅漲綠跌)
        const isUp = cp > 0;
        const isDown = cp < 0;
        const pColor = isUp ? 'text-rose-600' : isDown ? 'text-emerald-600' : 'text-slate-700';
        const sign = isUp ? '▲ +' : isDown ? '▼ ' : '';
        const chgSign = chg > 0 ? '+' : '';

        // 成交量格式化：Fugle total.tradeVolume 單位為「張」
        const volumeText = vol > 0 ? `${fmt(vol)} 張` : '--';

        return `
        <div class="glass-card p-4 transition-all hover:border-slate-300 relative">
            <div class="flex justify-between items-center mb-3 pb-2 border-b border-slate-100">
                <div>
                    <div class="font-bold text-slate-900 text-base flex items-center gap-1.5">
                        ${name}
                        <span class="text-xs font-semibold text-slate-400 font-mono">${symbol}.TW</span>
                    </div>
                </div>
                <div class="flex items-center gap-2">
                    <button onclick="openWatchWaterLevel(${i})" class="text-xs font-bold text-blue-600 bg-blue-50 hover:bg-blue-100 px-2.5 py-1 rounded-lg border border-blue-100 transition-colors">
                        📈 走勢
                    </button>
                    <button onclick="removeWatchStock(${i})" class="text-slate-400 hover:text-red-500 p-1" title="移除追蹤">
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                    </button>
                </div>
            </div>

            <!-- 參考截圖呈現：現價、漲跌、成交量 -->
            <div class="grid grid-cols-3 gap-2 bg-slate-50/70 p-3 rounded-xl border border-slate-100 text-center">
                <div>
                    <div class="text-[10px] font-bold text-slate-400 uppercase">成交價</div>
                    <div class="text-lg font-black ${pColor} tracking-tight">${price > 0 ? fmtPrice(price) : '--'}</div>
                </div>
                <div>
                    <div class="text-[10px] font-bold text-slate-400 uppercase">漲跌幅 (額)</div>
                    <div class="text-sm font-black ${pColor} mt-0.5">
                        ${price > 0 ? `${sign}${Math.abs(cp).toFixed(2)}%` : '--'}
                    </div>
                    <div class="text-[10px] font-bold ${pColor}">${price > 0 ? `(${chgSign}${chg.toFixed(2)})` : ''}</div>
                </div>
                <div>
                    <div class="text-[10px] font-bold text-slate-400 uppercase">成交量</div>
                    <div class="text-sm font-black text-slate-800 mt-1">${volumeText}</div>
                </div>
            </div>
        </div>`;
    }).join('');
}

function openWatchWaterLevel(index) {
    const stock = state.watchStocks[index];
    if (!stock) return;
    trendChartStock = stock;
    trendRange = '1Y';
    currentYScale = 1.0;
    if (typeof applyYZoom === 'function') applyYZoom();

    const modal = document.getElementById('trend-modal');
    const content = document.getElementById('trend-modal-content');
    const titleEl = document.getElementById('trend-stock-title');
    const subTitleEl = document.getElementById('trend-stock-subtitle');
    const noDataEl = document.getElementById('trend-no-data-msg');

    if (titleEl) titleEl.innerText = `${stock.name || stock.symbol} 走勢分析 (追蹤)`;
    if (subTitleEl) subTitleEl.innerText = `現價 @${stock.price || '--'}`;

    if (!modal) return;
    modal.classList.remove('hidden');
    void modal.offsetWidth;
    modal.classList.remove('opacity-0');
    if (content) {
        content.classList.remove('scale-95');
        content.classList.add('scale-100');
    }

    if (!stock.historyData || stock.historyData.length === 0) {
        if (noDataEl) noDataEl.classList.remove('hidden');
        if (typeof destroyTrendCharts === 'function') destroyTrendCharts();
        return;
    }

    if (noDataEl) noDataEl.classList.add('hidden');
    if (typeof setTrendChartMode === 'function') setTrendChartMode(trendChartMode || 'line');
    if (typeof updateTrendRangeButtons === 'function') updateTrendRangeButtons();
    if (typeof renderTrendChart === 'function') renderTrendChart(stock);
}

// 供 Modal 內一鍵載入當前開啟股票（含追蹤標的）之 FinMind 歷史資料
// 修正後的 fetchActiveTrendStockHistory 函式 (已移除會引發 CORS 阻擋的 Headers)
async function fetchActiveTrendStockHistory() {
    if (!trendChartStock || !state.finmindToken) {
        if (typeof showToast === 'function') showToast('請先至設定頁確認已輸入 FinMind Token');
        return;
    }

    // 計算近 1 年 (365 天) 日期
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(endDate.getDate() - 365);

    const formatDate = (date) => date.toISOString().split('T')[0];
    const startDateStr = formatDate(startDate);

    const url = `https://api.finmindtrade.com/api/v4/data?dataset=TaiwanStockPrice&data_id=${trendChartStock.symbol}&start_date=${startDateStr}&token=${state.finmindToken}`;

    try {
        // 移除選項物件，使用原生極簡 GET 請求以避開 CORS Preflight 限制
        const response = await fetch(url);

        if (!response.ok) {
            let errorMsg = `HTTP 錯誤碼: ${response.status}`;
            try {
                const errJson = await response.json();
                if (errJson && errJson.msg) {
                    errorMsg += ` (${errJson.msg})`;
                }
            } catch (e) {}
            throw new Error(errorMsg);
        }

        const result = await response.json();

        if (result.status !== 200 && result.msg) {
            throw new Error(`FinMind API 訊息: ${result.msg}`);
        }

        if (result.data && result.data.length > 0) {
            // 轉化 API 歷史數據格式
            const historyData = result.data
                .filter(day => Number(day.close) > 0)
                .map(day => ({
                    d: day.date,
                    o: Number(day.open) || Number(day.close),
                    h: Number(day.max) || Number(day.close),
                    l: Number(day.min) || Number(day.close),
                    c: Number(day.close),
                    v: Number(day.Trading_Volume || day.Trading_volume || day.volume || day.v || 0)
                }));

            // 寫回當前開啟的股票物件並刷新走勢圖
            trendChartStock.historyData = historyData;

            // 自動計算最高/最低點以解鎖水位
            let maxItem = historyData[0];
            let minItem = historyData[0];
            historyData.forEach(item => {
                if (item.h >= maxItem.h) maxItem = item;
                if (item.l <= minItem.l) minItem = item;
            });

            trendChartStock.highPrice = maxItem.h;
            trendChartStock.highDate = maxItem.d;
            trendChartStock.lowPrice = minItem.l;
            trendChartStock.lowDate = minItem.d;

            saveState();
            
            // 隱藏「無資料」提示，繪製圖表
            const noDataEl = document.getElementById('trend-no-data-msg');
            if (noDataEl) noDataEl.classList.add('hidden');

            if (typeof renderTrendChart === 'function') renderTrendChart(trendChartStock);
            if (typeof renderWaterLevel === 'function') renderWaterLevel();
            if (typeof showToast === 'function') showToast(`成功載入 ${trendChartStock.symbol} 歷史走勢與最新 09-30 報價！`);
        } else {
            if (typeof showToast === 'function') showToast('未取得歷史股價資料');
        }
    } catch (error) {
        console.error('FinMind API 讀取失敗:', error);
        if (typeof showToast === 'function') {
            showToast(`FinMind API 連線失敗：${error.message}`);
        }
    }
}

// 手動觸發追蹤標的報價與成交量更新
async function manualRefreshWatchStocks() {
    const btn = document.getElementById('btn-refresh-watch');
    if (btn) btn.classList.add('animate-spin', 'pointer-events-none');
    try {
        if (typeof fetchWatchStockPrices === 'function') {
            await fetchWatchStockPrices();
            if (typeof showToast === 'function') showToast('追蹤標的報價已更新');
        }
    } catch (e) {
        if (typeof showToast === 'function') showToast('更新失敗，請檢查 API Key 或網路');
    } finally {
        if (btn) btn.classList.remove('animate-spin', 'pointer-events-none');
    }
}
