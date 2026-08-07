// ==========================================
// MCE 模組化 - waterlevel.js (市場水位與斐波那契黃金標尺)
// 版本: v14.3 (FinMind Native Direct Fetch & Stock-3 Alignment)
// ==========================================

let editingHpIndex = -1;

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
    
    saveState();
    if (typeof updateAllData === 'function') updateAllData();
    closeHighPointModal();
    if (typeof showToast === 'function') showToast('高低點區間與黃金標尺已更新');
}

// ==========================================
// [核心修正] 一鍵批次抓取所有持股近 1 年高低點 (與 stock-3 直連邏輯完全一致)
// ==========================================
async function fetchFinmindHighLow() {
    if (!state.finmindToken) {
        if (typeof showToast === 'function') showToast('請先至設定頁輸入 FinMind Token');
        if (typeof switchTab === 'function') switchTab('settings');
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

            // 完全同步 stock-3.html 之直連原生 API
            const url = `https://api.finmindtrade.com/api/v4/data?dataset=TaiwanStockPrice&data_id=${stock.symbol}&start_date=${startDateStr}&token=${state.finmindToken}`;
            
            const response = await fetch(url);
            if (!response.ok) continue;

            const resData = await response.json();
            if (resData.msg === "success" && resData.data && resData.data.length > 0) {
                let maxPrice = -Infinity;
                let minPrice = Infinity;
                let maxDate = '';
                let minDate = '';

                // 逆向遍歷，尋找分割或減資斷層 (Drop >= 50%)
                for (let j = resData.data.length - 1; j >= 0; j--) {
                    const day = resData.data[j];
                    
                    if (day.max > maxPrice) { maxPrice = day.max; maxDate = day.date; }
                    if (day.min < minPrice) { minPrice = day.min; minDate = day.date; }

                    if (j > 0) {
                        const prevDay = resData.data[j - 1];
                        const priceDiffRatio = Math.abs(prevDay.close - day.close) / prevDay.close;
                        
                        // 若單日價格落差超過 50%，判定為分割/減資，停止往回追溯
                        if (priceDiffRatio >= 0.5) {
                            break;
                        }
                    }
                }

                if (maxPrice !== -Infinity && minPrice !== Infinity) {
                    stock.highPrice = maxPrice;
                    stock.highDate = maxDate;
                    stock.lowPrice = minPrice;
                    stock.lowDate = minDate;
                    updatedCount++;
                }
            }
        }

        if (updatedCount > 0) {
            saveState();
            renderWaterLevel(); // 刷新水位畫面
            if (typeof showToast === 'function') showToast(`成功更新 ${updatedCount} 檔股票的高低點`);
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

// 單檔 Modal 內帶入 FinMind 近 1 年高低點 (同樣直連)
async function autoFetchHighLow() {
    if (editingHpIndex === -1) return;
    const stock = state.stocks[editingHpIndex];
    let symbol = stock.symbol || '';

    if (!symbol) {
        if (typeof showToast === 'function') showToast('該股票缺乏有效台股代號 (例: 2330)，無法查詢');
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

        for (let j = dataList.length - 1; j >= 0; j--) {
            const day = dataList[j];
            
            if (day.max > maxPrice) { maxPrice = day.max; maxDate = day.date; }
            if (day.min < minPrice) { minPrice = day.min; minDate = day.date; }

            if (j > 0) {
                const prevDay = dataList[j - 1];
                const priceDiffRatio = Math.abs(prevDay.close - day.close) / prevDay.close;
                if (priceDiffRatio >= 0.5) break;
            }
        }

        if (maxPrice !== -Infinity && minPrice !== Infinity) {
            document.getElementById('hp-price').value = maxPrice;
            document.getElementById('hp-date').value = maxDate;
            document.getElementById('hp-low-price').value = minPrice;
            document.getElementById('hp-low-date').value = minDate;

            state.stocks[editingHpIndex].highPrice = maxPrice;
            state.stocks[editingHpIndex].highDate = maxDate;
            state.stocks[editingHpIndex].lowPrice = minPrice;
            state.stocks[editingHpIndex].lowDate = minDate;
            
            if (typeof showToast === 'function') showToast(`已成功透過 FinMind 帶入 ${symbol} 近 1 年極值！`);
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
        const nameDisplay = typeof formatStockName === 'function' ? formatStockName(s) : (s.name || s.symbol);
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
        points.push({ name: '個人均價', price: costPrice, type: 'cost' });
        
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
                dateStr = `<span class="text-slate-400 text-xs ml-2 hidden sm:inline font-sans">(${p.date}, ${daysAgoStr})</span>`;
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
        <div class="glass-card p-5 mb-5 relative overflow-hidden transition-all hover:border-slate-300 shadow-sm">
            <div class="flex justify-between items-center mb-4 pb-3 border-b border-slate-100">
                <div class="flex flex-col gap-1">
                    <h3 class="text-xl font-black text-slate-900 tracking-wide">${nameDisplay}</h3>
                </div>
                <button onclick="openHighPointModal(${idx})" class="text-[11px] font-bold text-slate-600 bg-slate-50 px-3 py-1.5 rounded-lg border border-slate-200 shadow-sm active:scale-95 transition-colors hover:bg-slate-100 shrink-0">⚡ 更新點位</button>
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

            <div class="grid grid-cols-2 gap-3 mb-4">
                <div class="${zoneBg} p-3 rounded-xl border border-white flex flex-col justify-center items-center text-center shadow-sm">
                    <span class="text-[10px] font-bold text-slate-500 mb-0.5">目前水位狀態</span>
                    <span class="text-sm font-black ${zoneColor}">${zoneText}</span>
                </div>
                <div class="bg-slate-50 p-3 rounded-xl border border-slate-100 flex flex-col justify-center items-center text-center shadow-inner">
                    <span class="text-[10px] font-bold text-slate-500 mb-0.5">距最高點回檔</span>
                    <span class="text-sm font-black ${zoneColor}">${dropSign}${dropPct.toFixed(2)}%</span>
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