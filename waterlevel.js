// ==========================================
// MCE 模組化 - waterlevel.js (市場水位與斐波那契黃金標尺)
// 版本: v14.7 (Fix Stock Split Filter for Trend Chart & Fibonacci)
// ==========================================

// 在 waterlevel.js 開頭新增 Y 軸縮放狀態變數
let currentYScale = 1.0;
const baseTrendChartHeight = 256; // 基準像素高度

/**
 * 調整股價走勢圖 Y 軸垂直縮放
 * @param {number} delta - 縮放增量 (+0.2 / -0.2)
 */
function adjustTrendYZoom(delta) {
    currentYScale = Math.max(0.6, Math.min(3.0, currentYScale + delta));
    applyYZoom();
}

/**
 * 重設垂直縮放比例
 */
function resetTrendYZoom() {
    currentYScale = 1.0;
    applyYZoom();
}

/**
 * 套用縮放結果至畫布容器與 Chart.js
 */
function applyYZoom() {
    const container = document.getElementById('trend-chart-canvas-container');
    const zoomText = document.getElementById('trend-zoom-val');
    
    if (container) {
        const newHeight = Math.round(baseTrendChartHeight * currentYScale);
        container.style.height = `${newHeight}px`;
    }
    
    if (zoomText) {
        zoomText.innerText = `${Math.round(currentYScale * 100)}%`;
    }

    // 重繪 Chart.js 以符合新高度
    if (trendChartInstance) {
        trendChartInstance.resize();
    }
}

let editingHpIndex = -1;
let trendChartInstance = null;
let waterLevelTrendChartInstance = null;
let trendRange = '1Y';
let trendChartStock = null;
let trendChartMode = 'line';

// 新增：重設圖表縮放
function resetChartZoom() {
    if (trendChartInstance) {
        delete trendChartInstance.options.scales.x.min;
        delete trendChartInstance.options.scales.x.max;
        trendChartInstance.resetZoom();
    }
    if (waterLevelTrendChartInstance) {
        delete waterLevelTrendChartInstance.options.scales.x.min;
        delete waterLevelTrendChartInstance.options.scales.x.max;
        waterLevelTrendChartInstance.resetZoom();
    }
}

// 新增：圖表縮放同步連動
function syncChartZoom(sourceChart, targetChart) {
    if (!sourceChart || !targetChart || !sourceChart.scales.x || !targetChart.scales.x) return;
    targetChart.options.scales.x.min = sourceChart.scales.x.min;
    targetChart.options.scales.x.max = sourceChart.scales.x.max;
    targetChart.update('none');
}

function setTrendChartMode(mode) {
    trendChartMode = mode === 'candlestick' ? 'candlestick' : 'line';
    document.querySelectorAll('[data-trend-mode]').forEach(button => {
        const active = button.dataset.trendMode === trendChartMode;
        button.classList.toggle('bg-white', active);
        button.classList.toggle('shadow-sm', active);
        button.classList.toggle('text-slate-900', active);
        button.classList.toggle('text-slate-500', !active);
    });
    if (trendChartStock) renderTrendChart(trendChartStock);
}

function setTrendRange(range) {
    trendRange = range;
    updateTrendRangeButtons();
    if (trendChartStock) renderTrendChart(trendChartStock);
}

function updateTrendRangeButtons() {
    document.querySelectorAll('[data-trend-range]').forEach(button => {
        const active = button.dataset.trendRange === trendRange;
        button.classList.toggle('bg-slate-300', active);
        button.classList.toggle('bg-slate-100', !active);
        button.classList.toggle('text-slate-900', active);
        button.classList.toggle('text-slate-700', !active);
    });
}

function getTrendHistory(stock) {
    const history = Array.isArray(stock.historyData) ? stock.historyData : [];
    if (trendRange === '1Y' || history.length === 0) return history;
    const days = { '1M': 31, '3M': 93, '6M': 186 }[trendRange] || 365;
    const lastDate = new Date(history[history.length - 1].d);
    const startDate = new Date(lastDate);
    startDate.setDate(startDate.getDate() - days);
    return history.filter(item => new Date(item.d) >= startDate);
}

function getOhlc(item) {
    const close = Number(item.c);
    const open = Number(item.o);
    const high = Number(item.h);
    const low = Number(item.l);
    return {
        o: Number.isFinite(open) ? open : close,
        h: Number.isFinite(high) ? high : close,
        l: Number.isFinite(low) ? low : close,
        c: close
    };
}

function getTransactionIndex(transaction, labels) {
    if (!transaction || !labels.length) return -1;
    const exact = labels.indexOf(transaction.date);
    if (exact >= 0) return exact;
    const target = new Date(transaction.date).getTime();
    let best = -1;
    labels.forEach((date, index) => {
        const time = new Date(date).getTime();
        if (Number.isFinite(target) && Number.isFinite(time) && time <= target) best = index;
    });
    return best;
}

function makeCrosshairPlugin(selectedIndexRef) {
    return {
        id: `chartCrosshair${Math.random().toString(36).slice(2)}`,
        afterDraw(chart) {
            const index = selectedIndexRef.value;
            if (index === null || index < 0 || !chart.chartArea || !chart.scales.x) return;
            const x = chart.scales.x.getPixelForValue(index);
            const yScale = chart.scales.y;
            const activeValue = chart.data.datasets[0]?.data[index];
            const value = typeof activeValue === 'object' ? activeValue.c : activeValue;
            if (!Number.isFinite(Number(value))) return;
            const y = yScale.getPixelForValue(Number(value));
            const { ctx, chartArea } = chart;
            ctx.save();
            
            // 繪製垂直與水平對齊虛線
            ctx.strokeStyle = '#94A3B8';
            ctx.lineWidth = 1;
            ctx.setLineDash([4, 4]);
            ctx.beginPath();
            ctx.moveTo(x, chartArea.top);
            ctx.lineTo(x, chartArea.bottom);
            ctx.moveTo(chartArea.left, y);
            ctx.lineTo(chartArea.right, y);
            ctx.stroke();

            // 繪製交會處的發光圓點標示
            ctx.setLineDash([]);
            ctx.beginPath();
            ctx.arc(x, y, 4, 0, 2 * Math.PI);
            ctx.fillStyle = '#FFFFFF';
            ctx.fill();
            ctx.lineWidth = 2;
            ctx.strokeStyle = '#3B82F6';
            ctx.shadowColor = 'rgba(59, 130, 246, 0.5)';
            ctx.shadowBlur = 6;
            ctx.stroke();
            
            ctx.restore();
        }
    };
}

function makeCandlestickPlugin(historyData) {
    return {
        id: `candlesticks${Math.random().toString(36).slice(2)}`,
        beforeDatasetsDraw(chart) {
            if (trendChartMode !== 'candlestick' || !chart.chartArea) return;
            const { ctx, chartArea, scales } = chart;
            const xScale = scales.x;
            const yScale = scales.y;
            const candleWidth = Math.max(3, Math.min(9, (chartArea.right - chartArea.left) / Math.max(historyData.length, 1) * 0.62));
            ctx.save();
            historyData.forEach((item, index) => {
                const candle = getOhlc(item);
                if (![candle.o, candle.h, candle.l, candle.c].every(Number.isFinite)) return;
                const x = xScale.getPixelForValue(index);
                const yOpen = yScale.getPixelForValue(candle.o);
                const yClose = yScale.getPixelForValue(candle.c);
                const yHigh = yScale.getPixelForValue(candle.h);
                const yLow = yScale.getPixelForValue(candle.l);
                const rising = candle.c >= candle.o;
                const color = rising ? '#16A34A' : '#DC2626';
                ctx.strokeStyle = color;
                ctx.fillStyle = color;
                ctx.lineWidth = 1.2;
                ctx.beginPath();
                ctx.moveTo(x, yHigh);
                ctx.lineTo(x, yLow);
                ctx.stroke();
                const top = Math.min(yOpen, yClose);
                const height = Math.max(1, Math.abs(yClose - yOpen));
                ctx.fillRect(x - candleWidth / 2, top, candleWidth, height);
            });
            ctx.restore();
        }
    };
}

// 開啟設定高低點 Modal
function openHighPointModal(index) {
    editingHpIndex = index;
    const stock = state.stocks[index];
    const price = stock.price || stock.costPrice || 0;
    
    const elHpPrice = document.getElementById('hp-price');
    const elHpDate = document.getElementById('hp-date');
    const elLpPrice = document.getElementById('hp-low-price');
    const elLpDate = document.getElementById('hp-low-date');

    if (elHpPrice) elHpPrice.value = stock.highPrice || price;
    if (elHpDate) elHpDate.value = stock.highDate || new Date().toISOString().split('T')[0];
    
    if (elLpPrice) elLpPrice.value = stock.lowPrice || price;
    if (elLpDate) elLpDate.value = stock.lowDate || new Date().toISOString().split('T')[0];
    
    const modal = document.getElementById('highpoint-modal');
    const content = document.getElementById('highpoint-modal-content');
    if (!modal) return;

    modal.classList.remove('hidden');
    void modal.offsetWidth; 
    modal.classList.remove('opacity-0');
    if (content) {
        content.classList.remove('scale-95');
        content.classList.add('scale-100');
    }
}

function closeHighPointModal() {
    const modal = document.getElementById('highpoint-modal');
    const content = document.getElementById('highpoint-modal-content');
    if (!modal) return;

    modal.classList.add('opacity-0');
    if (content) {
        content.classList.remove('scale-100');
        content.classList.add('scale-95');
    }
    setTimeout(() => {
        modal.classList.add('hidden');
        editingHpIndex = -1;
    }, 200);
}

function saveHighPoint(e) {
    e.preventDefault();
    if (editingHpIndex === -1) return;
    
    const hpPrice = parseFloat(document.getElementById('hp-price').value) || 0;
    const hpDate = document.getElementById('hp-date').value;
    const lpPrice = parseFloat(document.getElementById('hp-low-price').value) || 0;
    const lpDate = document.getElementById('hp-low-date').value;
    
    state.stocks[editingHpIndex].highPrice = hpPrice;
    state.stocks[editingHpIndex].highDate = hpDate;
    state.stocks[editingHpIndex].lowPrice = lpPrice;
    state.stocks[editingHpIndex].lowDate = lpDate;
    state.stocks[editingHpIndex].waterLevelSource = 'manual';
    
    saveState();
    if (typeof updateAllData === 'function') updateAllData();
    closeHighPointModal();
    if (typeof showToast === 'function') showToast('高低點區間與黃金標尺已更新');
}

function clearManualHighLow() {
    if (editingHpIndex === -1 || !state.stocks[editingHpIndex]) return;

    const stock = state.stocks[editingHpIndex];
    stock.highPrice = null;
    stock.highDate = null;
    stock.lowPrice = null;
    stock.lowDate = null;
    stock.waterLevelSource = 'finmind';
    saveState();
    if (typeof updateAllData === 'function') updateAllData();
    closeHighPointModal();
    if (typeof showToast === 'function') showToast('已清除自訂最高點與最低點，可重新使用 FinMind 自動抓取');
}

// ==========================================
// 趨勢走勢圖 Modal 渲染邏輯 (Chart.js 平行水位線)
// ==========================================
function openTrendModal(index) {
    const stock = state.stocks[index];
    if (!stock) return;
    trendChartStock = stock;
    trendRange = '1Y';

    // 每次開啟 Modal 時重置 Y 軸垂直高度為 100%
    currentYScale = 1.0;
    applyYZoom();

    const modal = document.getElementById('trend-modal');
    const content = document.getElementById('trend-modal-content');
    const titleEl = document.getElementById('trend-stock-title');
    const subTitleEl = document.getElementById('trend-stock-subtitle');
    const noDataEl = document.getElementById('trend-no-data-msg');

    if (titleEl) titleEl.innerText = `${typeof formatStockName === 'function' ? formatStockName(stock) : stock.symbol} 走勢分析`;
    if (subTitleEl) subTitleEl.innerText = `現價 @${stock.price || stock.costPrice || '--'}`;

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
        destroyTrendCharts();
        return;
    }

    if (noDataEl) noDataEl.classList.add('hidden');
    setTrendChartMode(trendChartMode);
    updateTrendRangeButtons();
    renderTrendChart(stock);
}

function closeTrendModal() {
    const modal = document.getElementById('trend-modal');
    const content = document.getElementById('trend-modal-content');
    if (!modal) return;

    modal.classList.add('opacity-0');
    if (content) {
        content.classList.remove('scale-100');
        content.classList.add('scale-95');
    }
    setTimeout(() => {
        modal.classList.add('hidden');
    }, 200);
}

function destroyTrendCharts() {
    if (trendChartInstance) {
        trendChartInstance.destroy();
        trendChartInstance = null;
    }
    if (waterLevelTrendChartInstance) {
        waterLevelTrendChartInstance.destroy();
        waterLevelTrendChartInstance = null;
    }
}

function renderTrendChart(stock) {
    const canvas = document.getElementById('trendChart');
    const waterCanvas = document.getElementById('waterLevelTrendChart');
    if (!canvas || !waterCanvas) return;
    const ctx = canvas.getContext('2d');
    const waterCtx = waterCanvas.getContext('2d');

    destroyTrendCharts();

    const historyData = getTrendHistory(stock);
    const labels = historyData.map(h => h.d);
    const prices = historyData.map(h => Number(h.c));
    const len = prices.length;

    const hp = parseFloat(stock.highPrice) || 0;
    const lp = parseFloat(stock.lowPrice) || 0;
    const range = hp - lp;
    const trend = calculateTrendSignal(historyData);
    const rangeStart = labels[0] || '';
    const rangeEnd = labels[labels.length - 1] || '';
    const rangeEl = document.getElementById('trend-date-range');
    if (rangeEl) rangeEl.textContent = rangeStart && rangeEnd ? `${rangeStart.slice(5)} - ${rangeEnd.slice(5)}` : '';

    // 動態更新固定資訊面板
    const updateFixedInfoBar = (index) => {
        const dateEl = document.getElementById('fixed-info-date');
        const closeEl = document.getElementById('fixed-info-close');
        const highEl = document.getElementById('fixed-info-high');
        const lowEl = document.getElementById('fixed-info-low');
        const levelEl = document.getElementById('fixed-info-level');
        const transEl = document.getElementById('fixed-info-transaction');
        const barEl = document.getElementById('fixed-chart-info-bar');
        
        if (!barEl || index === null || index < 0) return;
        
        barEl.classList.remove('hidden');
        const currentDate = labels[index] || '';
        dateEl.textContent = currentDate;
        
        const price = prices[index];
        const item = historyData[index];
        const ohlc = item ? getOhlc(item) : { h: null, l: null, c: price };
        
        highEl.textContent = Number.isFinite(ohlc.h) ? fmtPrice(ohlc.h) : '--';
        lowEl.textContent = Number.isFinite(ohlc.l) ? fmtPrice(ohlc.l) : '--';
        closeEl.textContent = Number.isFinite(ohlc.c) ? fmtPrice(ohlc.c) : '--';
        
        if (hp > 0 && price > 0) {
            const dropPct = ((price / hp) - 1) * 100;
            const sign = dropPct > 0 ? '+' : '';
            levelEl.textContent = `${sign}${dropPct.toFixed(2)}%`;
            levelEl.className = dropPct <= -20 ? 'text-sm font-black text-rose-600' :
                                dropPct <= -10 ? 'text-sm font-black text-amber-500' :
                                'text-sm font-black text-emerald-600';
        } else {
            levelEl.textContent = '--';
            levelEl.className = 'text-sm font-black text-blue-900';
        }

        // 處理交易紀錄顯示
        const dayTrans = (Array.isArray(stock.transactions) ? stock.transactions : []).filter(t => t.date === currentDate);
        if (dayTrans.length > 0) {
            transEl.classList.remove('hidden');
            transEl.innerHTML = dayTrans.map(t => {
                const isBuy = t.type === 'buy';
                const actionColor = isBuy ? 'text-emerald-600 bg-emerald-50' : 'text-rose-600 bg-rose-50';
                const actionText = isBuy ? '買進' : '賣出';
                return `<div class="flex justify-between items-center">
                            <div class="flex items-center gap-2">
                                <span class="px-1.5 py-0.5 rounded ${actionColor}">${actionText}</span>
                                <span class="text-slate-800">@${fmtPrice(t.price)}</span>
                            </div>
                            <span class="text-slate-500">${fmt(t.shares)} 股</span>
                        </div>`;
            }).join('');
        } else {
            transEl.classList.add('hidden');
            transEl.innerHTML = '';
        }
    };

    // 建立平行水平線常數陣列
    const makeDataset = (label, val, color, isDashed = true) => ({
        label,
        data: Array(len).fill(val),
        borderColor: color,
        borderWidth: 1.2,
        borderDash: isDashed ? [4, 4] : [],
        pointRadius: 0,
        pointHoverRadius: 0, // 新增：隱藏 hover 圓點
        fill: false
    });

    const makeMovingAverageDataset = (label, period, color) => ({
        label,
        data: prices.map((_, index) => {
            if (index < period - 1) return null;
            const window = prices.slice(index - period + 1, index + 1).map(Number);
            return window.every(Number.isFinite)
                ? window.reduce((sum, value) => sum + value, 0) / period
                : null;
        }),
        borderColor: color,
        borderWidth: 1.8,
        pointRadius: 0,
        pointHoverRadius: 0, // 新增：隱藏 hover 圓點
        spanGaps: false,
        fill: false
    });

    const makeExtremePointDataset = (label, date, value, color) => ({
        label: `${label} @${fmtPrice(value)}`,
        data: labels.map(itemDate => itemDate === date ? value : null),
        borderColor: color,
        backgroundColor: color,
        pointBackgroundColor: color,
        pointBorderColor: '#FFFFFF',
        pointBorderWidth: 2,
        pointRadius: labels.map(itemDate => itemDate === date ? 5 : 0),
        pointHoverRadius: 0, // 修改：隱藏同一垂直線上的 hover 反饋
        showLine: false,
        spanGaps: false,
        fill: false
    });

    const selectedPriceIndex = { value: null };
    const datasets = [{
        label: '收盤價',
        data: prices,
        borderColor: trendChartMode === 'candlestick' ? 'rgba(0,0,0,0)' : '#0F172A',
        borderWidth: 2,
        pointRadius: 0,
        pointHoverRadius: 0, // 新增：原生 Hover 隱藏，交由 crosshairPlugin 畫單一發光點
        fill: false,
        pointHitRadius: 12
    }];

    if (trendChartMode === 'candlestick') {
        datasets.push({
            label: 'K線範圍',
            data: historyData.map(item => getOhlc(item).h),
            borderColor: 'rgba(0,0,0,0)',
            pointRadius: 0,
            pointHoverRadius: 0, // 新增
            showLine: false,
            fill: false
        });
        datasets.push({
            label: 'K線範圍',
            data: historyData.map(item => getOhlc(item).l),
            borderColor: 'rgba(0,0,0,0)',
            pointRadius: 0,
            pointHoverRadius: 0, // 新增
            showLine: false,
            fill: false
        });
    }

    if (len >= 20) datasets.push(makeMovingAverageDataset('20日均線', 20, '#3B82F6'));
    if (len >= 60) datasets.push(makeMovingAverageDataset('60日均線', 60, '#8B5CF6'));

    if (hp > 0) {
        datasets.push(makeDataset(`前高 @${fmtPrice(hp)}`, hp, '#EF4444', false));
        if (stock.highDate) datasets.push(makeExtremePointDataset('最高點', stock.highDate, hp, '#EF4444'));
    }
    if (lp > 0) {
        datasets.push(makeDataset(`前低 @${fmtPrice(lp)}`, lp, '#22C55E', false));
        if (stock.lowDate) datasets.push(makeExtremePointDataset('最低點', stock.lowDate, lp, '#22C55E'));
    }

    if (hp > 0 && lp > 0 && range > 0) {
        datasets.push(makeDataset('0.786', lp + range * 0.786, '#94A3B8'));
        datasets.push(makeDataset('0.66', lp + range * 0.66, '#CBD5E1'));
        datasets.push(makeDataset('0.618', lp + range * 0.618, '#F59E0B'));
        datasets.push(makeDataset('0.5', lp + range * 0.5, '#64748B'));
    }

    const transactions = Array.isArray(stock.transactions) ? stock.transactions : [];
    transactions.forEach(transaction => {
        const index = getTransactionIndex(transaction, labels);
        if (index < 0) return;
        const isBuy = transaction.type === 'buy';
        const price = Number(transaction.price);
        if (!Number.isFinite(price)) return;
        datasets.push({
            label: isBuy ? '買進' : '賣出',
            data: labels.map((_, itemIndex) => itemIndex === index ? price : null),
            borderColor: isBuy ? '#16A34A' : '#DC2626',
            backgroundColor: isBuy ? '#16A34A' : '#DC2626',
            pointBackgroundColor: isBuy ? '#16A34A' : '#DC2626',
            pointBorderColor: '#FFFFFF',
            pointBorderWidth: 2,
            pointRadius: labels.map((_, itemIndex) => itemIndex === index ? 5 : 0),
            pointHoverRadius: 8,
            showLine: false,
            transaction,
            fill: false
        });
    });

    const crosshairPlugin = makeCrosshairPlugin(selectedPriceIndex);
    const candlePlugin = makeCandlestickPlugin(historyData);

    // 預設帶入最後一筆資料到固定面板
    if (len > 0) {
        selectedPriceIndex.value = len - 1;
        updateFixedInfoBar(len - 1);
    }

    trendChartInstance = new Chart(ctx, {
        type: 'line',
        data: { labels, datasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: {
                    display: true,
                    position: 'top',
                    labels: { 
                        boxWidth: 12, 
                        font: { size: 10 }, 
                        // 過濾掉 K線範圍與買賣標記
                        filter: item => !['K線範圍', '買進', '賣出'].includes(item.text) 
                    }
                },
                tooltip: { enabled: false }, // 關閉原生會遮擋的 tooltip
                crosshair: { selectedPriceIndex },
                zoom: {
                    pan: {
                        enabled: true,
                        mode: 'x',
                        onPan: ({chart}) => syncChartZoom(chart, waterLevelTrendChartInstance)
                    },
                    zoom: {
                        wheel: { enabled: true },
                        pinch: { enabled: true },
                        mode: 'x',
                        onZoom: ({chart}) => syncChartZoom(chart, waterLevelTrendChartInstance)
                    }
                }
            },
            onHover: (event, elements, chart) => {
                if (elements && elements.length > 0) {
                    selectedPriceIndex.value = elements[0].index;
                    updateFixedInfoBar(elements[0].index);
                    chart.draw();
                }
            },
            onClick: (event, elements, chart) => {
                if (elements && elements.length > 0) {
                    selectedPriceIndex.value = elements[0].index;
                    updateFixedInfoBar(elements[0].index);
                    chart.draw();
                }
            },
            scales: {
                x: {
                    ticks: { maxTicksLimit: 6, font: { size: 9 } },
                    grid: { display: false }
                },
                y: {
                    grid: { color: '#F1F5F9' },
                    ticks: { font: { size: 10 }, callback: value => `@${value}` }
                }
            }
        },
        plugins: [candlePlugin, crosshairPlugin]
    });

    const drawdowns = prices.map(price => hp > 0 && price > 0 ? ((price / hp) - 1) * 100 : null);
    const latestDrawdown = drawdowns.filter(value => value !== null).at(-1);
    const summaryEl = document.getElementById('trend-water-summary');
    if (summaryEl) {
        const current = Number.isFinite(latestDrawdown) ? latestDrawdown : 0;
        const zone = current <= -20 ? '股災區間' : current <= -10 ? '觀察區間' : '正常區間';
        const color = current <= -20 ? '#E11D48' : current <= -10 ? '#D97706' : '#059669';
        summaryEl.textContent = `${current >= 0 ? '+' : ''}${current.toFixed(2)}% · ${zone} · ${trend.signal}`;
        summaryEl.style.color = color;
    }

    const levelLine = (label, value, color, dashed = true) => ({
        label,
        data: Array(len).fill(value),
        borderColor: color,
        borderWidth: 1,
        borderDash: dashed ? [5, 4] : [],
        pointRadius: 0,
        pointHoverRadius: 0, // 新增：隱藏 hover 圓點
        fill: false
    });

    const waterLevelBackgroundPlugin = {
        id: 'waterLevelBackground',
        beforeDraw(chart) {
            const { ctx: chartCtx, chartArea, scales } = chart;
            if (!chartArea || !scales.y) return;
            const y0 = scales.y.getPixelForValue(0);
            const y10 = scales.y.getPixelForValue(-10);
            const y20 = scales.y.getPixelForValue(-20);
            const y30 = scales.y.getPixelForValue(-30);
            chartCtx.save();
            chartCtx.fillStyle = '#E3EEE5';
            chartCtx.fillRect(chartArea.left, chartArea.top, chartArea.right - chartArea.left, y10 - chartArea.top);
            chartCtx.fillStyle = '#F1E8CB';
            chartCtx.fillRect(chartArea.left, y10, chartArea.right - chartArea.left, y20 - y10);
            chartCtx.fillStyle = '#EFD6D6';
            chartCtx.fillRect(chartArea.left, y20, chartArea.right - chartArea.left, y30 - y20);

            chartCtx.font = '12px sans-serif';
            chartCtx.fillStyle = '#0F172A';
            chartCtx.fillText('0%', chartArea.left + 10, y0 + 4);
            chartCtx.fillText('-10%', chartArea.left + 10, y10 + 4);
            chartCtx.fillText('-20%', chartArea.left + 10, y20 + 4);
            chartCtx.fillStyle = '#64748B';
            chartCtx.fillText('正常', chartArea.left + 10, y0 + 38);
            chartCtx.fillText('觀察', chartArea.left + 10, y10 + 58);
            chartCtx.fillText('股災', chartArea.left + 10, y20 + 58);
            chartCtx.textAlign = 'right';
            chartCtx.fillStyle = '#0F172A';
            chartCtx.fillText(fmtPrice(hp), chartArea.right - 8, y0 + 4);
            chartCtx.fillText(fmtPrice(hp * 0.9), chartArea.right - 8, y10 + 4);
            chartCtx.fillText(fmtPrice(hp * 0.8), chartArea.right - 8, y20 + 4);
            chartCtx.restore();
        }
    };

    const selectedWaterIndex = { value: len > 0 ? len - 1 : null };
    const waterCrosshairPlugin = makeCrosshairPlugin(selectedWaterIndex);
    waterLevelTrendChartInstance = new Chart(waterCtx, {
        type: 'line',
        data: {
            labels,
            datasets: [
                {
                    label: '回檔水位',
                    data: drawdowns,
                    borderColor: '#F97316',
                    backgroundColor: 'rgba(249, 115, 22, 0.12)',
                    borderWidth: 2,
                    pointRadius: 0, 
                    pointHoverRadius: 0, // 新增：隱藏原生圓點
                    fill: true,
                    tension: 0.18,
                    spanGaps: true
                },
                levelLine('前高 0%', 0, '#94A3B8', false),
                levelLine('觀察線 -10%', -10, '#F59E0B'),
                levelLine('股災線 -20%', -20, '#EF4444')
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: { display: false },
                tooltip: { enabled: false },
                zoom: {
                    pan: {
                        enabled: true,
                        mode: 'x',
                        onPan: ({chart}) => syncChartZoom(chart, trendChartInstance)
                    },
                    zoom: {
                        wheel: { enabled: true },
                        pinch: { enabled: true },
                        mode: 'x',
                        onZoom: ({chart}) => syncChartZoom(chart, trendChartInstance)
                    }
                }
            },
            onHover: (event, elements, chart) => {
                if (elements && elements.length > 0) {
                    selectedWaterIndex.value = elements[0].index;
                    chart.draw();
                }
            },
            onClick: (event, elements, chart) => {
                if (elements && elements.length > 0) {
                    selectedWaterIndex.value = elements[0].index;
                    chart.draw();
                }
            },
            scales: {
                x: {
                    ticks: { maxTicksLimit: 6, font: { size: 9 } },
                    grid: { display: false }
                },
                y: {
                    suggestedMin: -30,
                    suggestedMax: 0,
                    grid: { display: false },
                    ticks: { display: false }
                }
            }
        },
        plugins: [waterLevelBackgroundPlugin, waterCrosshairPlugin]
    });
}

// ==========================================
// 一鍵批次抓取所有持股近 1 年高低點與歷史走勢
// ==========================================
async function fetchFinmindHighLow() {
    if (!state.finmindToken) {
        if (typeof showToast === 'function') showToast('請先至設定頁輸入 FinMind Token');
        return;
    }
    if (state.stocks.length === 0) {
        if (typeof showToast === 'function') showToast('目前無持股資料');
        return;
    }

    const btn = document.getElementById('btn-fetch-finmind');
    let originalHTML = '';
    if (btn) {
        originalHTML = btn.innerHTML;
        btn.innerHTML = `<svg class="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg> 依序抓取中...`;
        btn.classList.add('opacity-70', 'pointer-events-none');
    }

    let updatedCount = 0;
    const today = new Date();
    const lastYear = new Date(today);
    lastYear.setDate(today.getDate() - 365);
    const startDateStr = lastYear.toISOString().split('T')[0];

    try {
        for (let i = 0; i < state.stocks.length; i++) {
            const stock = state.stocks[i];
            if (!stock.symbol) continue;

            const url = `https://api.finmindtrade.com/api/v4/data?dataset=TaiwanStockPrice&data_id=${stock.symbol}&start_date=${startDateStr}&token=${state.finmindToken}`;
            
            const response = await fetch(url);
            if (!response.ok) continue;

            const resData = await response.json();
            if (resData.msg === "success" && resData.data && resData.data.length > 0) {
                let validStartIndex = 0;

                for (let j = resData.data.length - 1; j >= 0; j--) {
                    const day = resData.data[j];
                    
                    if (j > 0) {
                        const prevDay = resData.data[j - 1];
                        const priceDiffRatio = prevDay.close > 0 ? Math.abs(prevDay.close - day.close) / prevDay.close : 0;
                        if (priceDiffRatio >= 0.5) {
                            validStartIndex = j;
                            break;
                        }
                    }
                }

                // 高低點、趨勢圖與水位都使用同一個有效區間，避免除權息前後資料混在一起。
                const validData = resData.data.slice(validStartIndex).filter(day => Number(day.close) > 0);
                const historyData = validData.map(day => ({
                    d: day.date,
                    o: Number(day.open),
                    h: Number(day.max),
                    l: Number(day.min),
                    c: Number(day.close)
                }));
                const highPoint = validData.reduce((best, day) => Number(day.max) > best.price ? { price: Number(day.max), date: day.date } : best, { price: -Infinity, date: '' });
                const lowPoint = validData.reduce((best, day) => Number(day.min) < best.price ? { price: Number(day.min), date: day.date } : best, { price: Infinity, date: '' });

                if (highPoint.price !== -Infinity && lowPoint.price !== Infinity && historyData.length > 0) {
                    stock.highPrice = highPoint.price;
                    stock.highDate = highPoint.date;
                    stock.lowPrice = lowPoint.price;
                    stock.lowDate = lowPoint.date;
                    stock.historyData = historyData;
                    stock.waterLevelSource = 'finmind';
                    updatedCount++;
                }
            }
        }

        if (updatedCount > 0) {
            saveState();
            renderWaterLevel();
            if (typeof showToast === 'function') showToast(`成功更新 ${updatedCount} 檔股票的高低點與走勢圖`);
        } else {
            if (typeof showToast === 'function') showToast('未取得任何新資料');
        }
    } catch (err) {
        console.error("FinMind Fetch Error:", err);
        if (typeof showToast === 'function') showToast('API 呼叫失敗，請檢查網路或 Token 額度');
    } finally {
        if (btn) {
            btn.innerHTML = originalHTML;
            btn.classList.remove('opacity-70', 'pointer-events-none');
        }
    }
}

// 單檔 Modal 內帶入 FinMind 近 1 年高低點
async function autoFetchHighLow() {
    if (editingHpIndex === -1) return;
    const stock = state.stocks[editingHpIndex];
    let symbol = stock.symbol || '';

    if (!symbol) {
        if (typeof showToast === 'function') showToast('該股票缺乏有效台股代號，無法查詢');
        return;
    }

    const btn = document.getElementById('auto-fetch-hp-btn');
    if (!btn) return;
    const originalHTML = btn.innerHTML;
    btn.classList.add('opacity-70', 'pointer-events-none');
    btn.innerHTML = `<svg class="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg> <span>讀取 FinMind 歷史資料中...</span>`;

    try {
        const oneYearAgo = new Date();
        oneYearAgo.setDate(oneYearAgo.getDate() - 365);
        const startDateStr = oneYearAgo.toISOString().split('T')[0];

        const token = state.finmindToken || "";
        if (!token) {
            if (typeof showToast === 'function') showToast('請先至設定頁輸入 FinMind Token');
            return;
        }

        const url = `https://api.finmindtrade.com/api/v4/data?dataset=TaiwanStockPrice&data_id=${symbol}&start_date=${startDateStr}&token=${token}`;
        
        const response = await fetch(url);
        if (!response.ok) throw new Error('API 請求失敗');

        const result = await response.json();
        if (result.msg !== "success" && result.status !== 200) {
            throw new Error(result.msg || 'FinMind 回傳錯誤狀態');
        }

        const dataList = result.data || [];
        if (dataList.length === 0) {
            if (typeof showToast === 'function') showToast(`FinMind 找不到代號 ${symbol} 之歷史報價`);
            return;
        }

        let maxPrice = -Infinity;
        let minPrice = Infinity;
        let maxDate = '';
        let minDate = '';
        let validStartIndex = 0;

        for (let j = dataList.length - 1; j >= 0; j--) {
            const day = dataList[j];
            
            if (day.max > maxPrice) { maxPrice = day.max; maxDate = day.date; }
            if (day.min < minPrice) { minPrice = day.min; minDate = day.date; }

            if (j > 0) {
                const prevDay = dataList[j - 1];
                const priceDiffRatio = Math.abs(prevDay.close - day.close) / prevDay.close;
                if (priceDiffRatio >= 0.5) {
                    validStartIndex = j;
                    break;
                }
            }
        }

        const historyData = dataList.slice(validStartIndex).map(day => ({
            d: day.date,
            o: Number(day.open),
            h: Number(day.max),
            l: Number(day.min),
            c: Number(day.close)
        }));

        if (maxPrice !== -Infinity && minPrice !== Infinity) {
            document.getElementById('hp-price').value = maxPrice;
            document.getElementById('hp-date').value = maxDate;
            document.getElementById('hp-low-price').value = minPrice;
            document.getElementById('hp-low-date').value = minDate;

            state.stocks[editingHpIndex].highPrice = maxPrice;
            state.stocks[editingHpIndex].highDate = maxDate;
            state.stocks[editingHpIndex].lowPrice = minPrice;
            state.stocks[editingHpIndex].lowDate = minDate;
            state.stocks[editingHpIndex].historyData = historyData;
            state.stocks[editingHpIndex].waterLevelSource = 'finmind';
            saveState();
            
            if (typeof showToast === 'function') showToast(`已成功帶入 ${symbol} 近 1 年極值與歷史走勢！`);
        }

    } catch (err) {
        console.error("FinMind Fetch Error:", err);
        if (typeof showToast === 'function') showToast('歷史報價連線失敗，請檢查網路或 Token 額度');
    } finally {
        btn.classList.remove('opacity-70', 'pointer-events-none');
        btn.innerHTML = originalHTML;
    }
}

// 渲染市場水位畫面
function renderWaterLevel() {
    const container = document.getElementById('waterlevel-list');
    if (!container) return;

    if (state.stocks.length === 0) {
        container.innerHTML = '<div class="glass-card p-8 text-center text-slate-400 font-semibold border-dashed">尚無持股資料</div>';
        return;
    }

    container.innerHTML = state.stocks.map((s, idx) => {
        const nameDisplay = escapeHtml(typeof formatStockName === 'function' ? formatStockName(s) : (s.name || s.symbol));
        const currentPrice = s.price || s.costPrice || 0;
        const costPrice = s.costPrice !== undefined ? s.costPrice : currentPrice;

        if (!s.highPrice || s.highPrice <= 0) {
            return `
            <div class="glass-card p-5 transition-all hover:border-slate-300 relative mb-4 shadow-sm">
                <div class="flex justify-between items-center mb-2">
                    <div class="font-bold text-slate-800 text-lg">${nameDisplay}</div>
                    <button onclick="openHighPointModal(${idx})" class="text-[11px] font-bold text-blue-600 bg-blue-50 px-3 py-1.5 rounded-lg border border-blue-100 shadow-sm active:scale-95">設定高點</button>
                </div>
                <div class="text-xs font-semibold text-slate-400">請設定或自動帶入「歷史高點」，即可解鎖市場水位分析。</div>
            </div>`;
        }

        const hp = parseFloat(s.highPrice);
        const lp = s.lowPrice ? parseFloat(s.lowPrice) : 0;
        const trend = calculateTrendSignal(s.historyData || []);
        
        let dropPct = hp > 0 ? ((currentPrice - hp) / hp) * 100 : 0;
        let zoneText = '正常區間';
        let zoneColor = 'text-emerald-600';
        let zoneBg = 'bg-emerald-50/80';

        let clampedDrop = Math.max(-30, Math.min(0, dropPct));
        let gaugeMarkerPos = (Math.abs(clampedDrop) / 30) * 100;

        if (dropPct <= -20) {
            zoneText = '股災區間';
            zoneColor = 'text-rose-500';
            zoneBg = 'bg-rose-50/80';
        } else if (dropPct <= -10) {
            zoneText = '觀察區間';
            zoneColor = 'text-amber-500';
            zoneBg = 'bg-amber-50/80';
        } else {
            if (dropPct > 0) gaugeMarkerPos = 0; 
        }

        let points = [];
        points.push({ name: '前高', price: hp, type: 'high', date: s.highDate });
        if (lp > 0) points.push({ name: '前低', price: lp, type: 'low', date: s.lowDate });
        points.push({ name: '現價', price: currentPrice, type: 'current' });
        const averageDate = (Number(s.shares) || 0) === 0
            ? s.firstPriceDate
            : (s.transactions || []).filter(t => t.type === 'buy').map(t => t.date).sort()[0];
        points.push({ name: '個人均價', price: costPrice, type: 'cost', date: averageDate });
        
        const range = hp - lp;
        if (lp > 0 && range > 0) {
            points.push({ name: '0.786', price: lp + range * 0.786, type: 'fib' });
            points.push({ name: '0.66', price: lp + range * 0.66, type: 'fib' });
            points.push({ name: '0.618', price: lp + range * 0.618, type: 'fib' });
            points.push({ name: '0.5', price: lp + range * 0.5, type: 'fib' });
        }

        points.sort((a, b) => b.price - a.price);

        const rulerHTML = points.map(p => {
            let distStr = "";
            if (currentPrice > 0 && p.type !== 'current') {
                const dist = ((p.price / currentPrice) - 1) * 100;
                const sign = dist > 0 ? '+' : '';
                distStr = `(${sign}${dist.toFixed(2)}%)`;
            }

            let dateStr = "";
            if (p.date) {
                const pDate = new Date(p.date);
                const now = new Date();
                const diffTime = Math.max(0, now - pDate);
                const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
                const daysAgoStr = diffDays === 0 ? "今天" : `${diffDays} 天前`;
                dateStr = `<span class="text-slate-400 text-xs ml-2 font-sans">(${p.date}, ${daysAgoStr})</span>`;
            }

            if (p.type === 'current') {
                return `
                <div class="flex items-center justify-between py-1.5 bg-slate-100 rounded-lg px-2 -mx-2 my-0.5">
                    <div class="flex items-center gap-2">
                        <svg class="w-4 h-4 text-orange-500 shrink-0" fill="currentColor" viewBox="0 0 24 24"><path d="M17.5 11.2c-.3-.3-.9-.2-1 .2-.3 1.1-1.3 2-2.5 2-1.4 0-2.5-1.1-2.5-2.5 0-1 .5-1.9 1.4-2.3.4-.2.6-.7.4-1.1l-.1-.2c-.2-.4-.8-.5-1.2-.2C10.6 8.3 10 10.1 10 12c0 2.8 2.2 5 5 5s5-2.2 5-5c0-1.8-.7-3.4-1.9-4.5-.3-.3-.8-.3-1.1 0l-.1.1c-.3.4-.3.9 0 1.2 1 1 1.6 2.3 1.6 3.7 0 .5-.1 1-.3 1.5-.1.4-.6.6-1 .4-.2-.1-.5-.2-.7-.2z"/></svg>
                        <span class="text-slate-900 font-bold text-base w-[72px] text-right tabular-nums">${fmtPrice(p.price)}</span>
                        <span class="text-slate-400 text-[10px]">←</span>
                        <span class="text-slate-900 font-bold text-sm">現價</span>
                    </div>
                    <span></span>
                </div>`;
            }

            let priceColor = "text-slate-600";
            let nameColor = "text-slate-600";
            let extraClasses = "opacity-70 py-1";

            if (p.type === 'cost') {
                priceColor = "text-blue-600";
                nameColor = "text-blue-600";
                extraClasses = "mt-3 border-t border-slate-200/80 pt-3 py-1";
            } else if (p.type === 'high') {
                priceColor = "text-red-500";
                nameColor = "text-red-500";
                extraClasses = "py-1";
            } else if (p.type === 'low') {
                priceColor = "text-green-600";
                nameColor = "text-green-600";
                extraClasses = "mt-3 py-1";
            }

            return `
            <div class="flex items-center justify-between ${extraClasses}">
                <div class="flex items-center gap-2">
                    <span class="${priceColor} font-medium w-[72px] text-right tabular-nums">${fmtPrice(p.price)}</span>
                    <span class="text-slate-400 text-[10px]">←</span>
                    <span class="${nameColor} font-medium text-sm">${p.name}</span>
                    ${dateStr}
                </div>
                <span class="${p.type === 'cost' ? 'text-blue-500' : 'text-slate-400'} text-xs font-sans tracking-wide tabular-nums">${distStr}</span>
            </div>`;
        }).join('');

        const dropSign = dropPct > 0 ? '+' : '';

        return `
        <div class="glass-card p-5 mb-5 relative overflow-hidden transition-all hover:border-slate-300 shadow-sm cursor-pointer" onclick="openTrendModal(${idx})" title="點擊檢視 K 線與黃金尺標走勢圖">
            <div class="flex justify-between items-center mb-4 pb-3 border-b border-slate-100">
                <div class="flex flex-col gap-1">
                    <h3 class="text-xl font-black text-slate-900 tracking-wide flex items-center gap-2">
                        ${nameDisplay}
                        <span class="text-xs font-normal text-blue-500 bg-blue-50 px-2 py-0.5 rounded-full">📈 走勢圖</span>
                    </h3>
                </div>
                <button onclick="event.stopPropagation(); openHighPointModal(${idx})" class="text-[11px] font-bold text-slate-600 bg-slate-50 px-3 py-1.5 rounded-lg border border-slate-200 shadow-sm active:scale-95 transition-colors hover:bg-slate-100 shrink-0">⚡ 更新點位</button>
            </div>

            <div class="px-1 mb-5 relative">
                <div class="flex text-[9px] font-black text-slate-400 mb-1 px-1">
                    <div class="w-1/3 text-left">0% (高點)</div>
                    <div class="w-1/3 text-center">-10%</div>
                    <div class="w-1/3 text-right">-20%↓</div>
                </div>
                <div class="relative h-5 rounded-full overflow-hidden flex shadow-inner border border-slate-100">
                    <div class="w-1/3 bg-emerald-100/70 border-r border-white/50"></div>
                    <div class="w-1/3 bg-amber-100/70 border-r border-white/50"></div>
                    <div class="w-1/3 bg-rose-100/70"></div>
                    <div class="absolute top-0 bottom-0 w-[3px] bg-slate-800 shadow-[0_0_4px_rgba(0,0,0,0.4)] z-10 transition-all duration-700 ease-out rounded-full" style="left: calc(${gaugeMarkerPos}% - 1.5px);"></div>
                </div>
                <div class="relative w-full h-4 mt-0.5">
                    <div class="absolute text-[14px] transform -translate-x-1/2 -top-1.5 transition-all duration-700 ease-out drop-shadow-sm" style="left: ${gaugeMarkerPos}%;">🔼</div>
                </div>
            </div>

            <div class="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-4">
                <div class="${zoneBg} p-3 rounded-xl border border-white flex flex-col justify-center items-center text-center shadow-sm">
                    <span class="text-[10px] font-bold text-slate-500 mb-0.5">目前水位狀態</span>
                    <span class="text-sm font-black ${zoneColor}">${zoneText}</span>
                </div>
                <div class="bg-slate-50 p-3 rounded-xl border border-slate-100 flex flex-col justify-center items-center text-center shadow-inner">
                    <span class="text-[10px] font-bold text-slate-500 mb-0.5">距最高點回檔</span>
                    <span class="text-sm font-black ${zoneColor}">${dropSign}${dropPct.toFixed(2)}%</span>
                </div>
                <div class="bg-indigo-50/60 p-3 rounded-xl border border-indigo-100 flex flex-col justify-center items-center text-center shadow-inner col-span-2 sm:col-span-1">
                    <span class="text-[10px] font-bold text-slate-500 mb-0.5">均線趨勢</span>
                    <span class="text-sm font-black ${trend.signal === '多頭' ? 'text-emerald-600' : trend.signal === '空頭' ? 'text-rose-600' : 'text-indigo-600'}">${trend.signal}</span>
                    <span class="text-[9px] text-slate-400 mt-0.5">${trend.ma60 === null ? '需至少 60 日資料' : `MA20 ${fmtPrice(trend.ma20)} · MA60 ${fmtPrice(trend.ma60)}`}</span>
                </div>
            </div>

            <div class="bg-slate-50 border border-slate-200/60 rounded-xl p-5 flex flex-col gap-3 shadow-[0_2px_8px_-2px_rgba(0,0,0,0.05)]">
                <h2 class="text-xs font-medium text-slate-500 border-b border-slate-200/80 pb-3 flex items-center gap-2">
                    <svg class="w-4 h-4 shrink-0" fill="currentColor" viewBox="0 0 24 24"><path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zM9 17H7v-7h2v7zm4 0h-2V7h2v10zm4 0h-2v-4h2v4z"/></svg>
                    斐波那契點位與相對距離
                </h2>
                <div class="flex flex-col gap-2 font-mono text-[13.5px]">
                    ${rulerHTML}
                </div>
            </div>
        </div>`;
    }).join('');
}