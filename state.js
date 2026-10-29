// ==========================================
// MCE 模組化 - state.js (核心狀態與資料持久化)
// 版本: v14.0 (Modular Build)
// ==========================================

function readStoredJson(key, fallback) {
    try {
        const value = JSON.parse(localStorage.getItem(key));
        return value ?? fallback;
    } catch (error) {
        console.warn(`無法讀取 ${key}，將使用預設值`, error);
        return fallback;
    }
}

// 所有由使用者、CSV 或備份檔帶入的文字，在插入 innerHTML 前都必須先經過跳脫。
function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

const storedStocks = readStoredJson('mce_stocks', []);
const storedWatchStocks = readStoredJson('mce_watch_stocks', []);
const storedCashFlows = readStoredJson('mce_cash_flows', []);
const storedDividends = readStoredJson('mce_dividends', []);


const state = {
    cash: Number.isFinite(parseFloat(localStorage.getItem('mce_cash'))) ? parseFloat(localStorage.getItem('mce_cash')) : 0,
    targetStockRatio: Number.isFinite(parseFloat(localStorage.getItem('mce_target_stock'))) ? parseFloat(localStorage.getItem('mce_target_stock')) : 50,
    deviation: Number.isFinite(parseFloat(localStorage.getItem('mce_deviation'))) ? parseFloat(localStorage.getItem('mce_deviation')) : 5,
    cashFlowFirst: localStorage.getItem('mce_cash_flow_first') !== 'false',
    stocks: Array.isArray(storedStocks) ? storedStocks : [],
    watchStocks: Array.isArray(storedWatchStocks) ? storedWatchStocks : [],
    cashFlows: Array.isArray(storedCashFlows) ? storedCashFlows : [],
    dividends: Array.isArray(storedDividends) ? storedDividends : [],
    gistToken: localStorage.getItem('mce_gist_token') || '',
    gistId: localStorage.getItem('mce_gist_id') || '',
    gistAutoSync: localStorage.getItem('mce_gist_auto_sync') === '1',
    gistLastSyncAt: localStorage.getItem('mce_gist_last_sync_at') || '',
    apiKey: localStorage.getItem('mce_apikey') || '',
    geminiApiKey: localStorage.getItem('mce_gemini_apikey') || '',
    finmindToken: localStorage.getItem('mce_finmind_token') || '',
    rebalanceMode: localStorage.getItem('mce_rebalance_mode') || 'global'
};

let storageSaveWarned = false;
function safeSetItem(key, value) {
    try {
        localStorage.setItem(key, value);
        return true;
    } catch (error) {
        console.warn(`儲存 ${key} 失敗（可能已超過儲存上限）`, error);
        if (!storageSaveWarned) {
            storageSaveWarned = true;
            if (typeof showToast === 'function') showToast('儲存空間不足，部分資料（歷史價格）可能未保存，請先匯出備份');
        }
        return false;
    }
}

// 存檔用的持股副本：歷史價格只保留最近 320 筆，避免 localStorage 無上限膨脹（記憶體中的完整資料不受影響）。
function slimStocksForSave(stocks) {
    if (!Array.isArray(stocks)) return stocks;
    return stocks.map(s => {
        if (!s || !Array.isArray(s.historyData) || s.historyData.length <= 320) return s;
        const sorted = [...s.historyData].sort((a, b) => String((a && a.d) || '').localeCompare(String((b && b.d) || '')));
        return { ...s, historyData: sorted.slice(-320) };
    });
}

function saveState() {
    safeSetItem('mce_cash', state.cash);
    safeSetItem('mce_target_stock', state.targetStockRatio);
    safeSetItem('mce_deviation', state.deviation);
    safeSetItem('mce_cash_flow_first', state.cashFlowFirst);
    safeSetItem('mce_rebalance_mode', state.rebalanceMode);
    safeSetItem('mce_apikey', state.apiKey);
    safeSetItem('mce_gemini_apikey', state.geminiApiKey);
    safeSetItem('mce_finmind_token', state.finmindToken);
    safeSetItem('mce_stocks', JSON.stringify(slimStocksForSave(state.stocks)));
    safeSetItem('mce_watch_stocks', JSON.stringify(slimStocksForSave(state.watchStocks)));
    safeSetItem('mce_cash_flows', JSON.stringify(state.cashFlows || []));
    safeSetItem('mce_dividends', JSON.stringify(state.dividends || []));
    safeSetItem('mce_gist_token', state.gistToken || '');
    safeSetItem('mce_gist_id', state.gistId || '');
    safeSetItem('mce_gist_auto_sync', state.gistAutoSync ? '1' : '0');
    safeSetItem('mce_gist_last_sync_at', state.gistLastSyncAt || '');
    safeSetItem('mce_local_modified_at', String(Date.now()));
}

// 輔助函式：判斷是否為 ETF 或槓桿型 (預設自動納入均分)
function isETFOrLeveraged(symbol, name) {
    const s = (symbol || '').toUpperCase();
    const n = name || '';
    return s.endsWith('L') || s.endsWith('D') || s.startsWith('00') || n.includes('正2') || n.includes('反1') || n.includes('ETF');
}

function buildBackupData() {
    return {
        version: "14.0",
        exportAt: new Date().toISOString(),
        cash: state.cash,
        targetStockRatio: state.targetStockRatio,
        deviation: state.deviation,
        cashFlowFirst: state.cashFlowFirst,
        rebalanceMode: state.rebalanceMode,
        cashFlows: state.cashFlows || [],
        dividends: state.dividends || [],
        stocks: state.stocks,
        watchStocks: state.watchStocks || []
    };
}


// ---------- 備份驗證（匯入與雲端還原共用，擋下壞檔覆蓋好資料） ----------
function validateBackupData(data) {
    const errors = [];
    if (!data || typeof data !== 'object') errors.push('備份不是物件');
    else {
        if (!Array.isArray(data.stocks)) errors.push('stocks 必須是陣列');
        if (typeof data.cash !== 'number' || !Number.isFinite(data.cash)) errors.push('cash 必須是有限數字');
        if (Array.isArray(data.stocks)) {
            if (data.stocks.length > 500) errors.push('持股筆數異常（>500）');
            data.stocks.forEach((s, i) => {
                if (!s || typeof s !== 'object') { errors.push(`stocks[${i}] 不是物件`); return; }
                if (typeof s.symbol !== 'string' || !s.symbol || s.symbol.length > 16) errors.push(`stocks[${i}] 代號無效`);
                if (s.shares !== undefined && (!Number.isFinite(Number(s.shares)) || Number(s.shares) < 0)) errors.push(`stocks[${i}] 股數無效`);
                if (s.transactions !== undefined && !Array.isArray(s.transactions)) errors.push(`stocks[${i}] 交易紀錄格式錯誤`);
                if (Array.isArray(s.transactions) && s.transactions.length > 5000) errors.push(`stocks[${i}] 交易紀錄筆數異常`);
                if (Array.isArray(s.transactions)) s.transactions.forEach((t, j) => {
                    if (!t || typeof t !== 'object') { errors.push(`stocks[${i}] 交易紀錄[${j}] 不是物件`); return; }
                    // 交易 id 會被插入 inline onclick 字串、date 會被插入 innerHTML：限制格式，擋下引號/標籤注入
                    if (t.id !== undefined && (typeof t.id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(t.id))) errors.push(`stocks[${i}] 交易紀錄[${j}] id 無效`);
                    if (t.date !== undefined && (typeof t.date !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(t.date))) errors.push(`stocks[${i}] 交易紀錄[${j}] 日期無效`);
                    ['price', 'shares', 'fee', 'tax', 'netAmount'].forEach(k => {
                        if (t[k] !== undefined && !Number.isFinite(Number(t[k]))) errors.push(`stocks[${i}] 交易紀錄[${j}] ${k} 無效`);
                    });
                    if (t.shares !== undefined && Number(t.shares) < 0) errors.push(`stocks[${i}] 交易紀錄[${j}] 股數無效`);
                });
            });
        }
        if (data.cashFlows !== undefined && !Array.isArray(data.cashFlows)) errors.push('cashFlows 格式錯誤');
        if (data.dividends !== undefined && !Array.isArray(data.dividends)) errors.push('dividends 格式錯誤');
        if (Array.isArray(data.dividends)) data.dividends.forEach((d, i) => {
            if (!d || typeof d !== 'object') { errors.push(`dividends[${i}] 不是物件`); return; }
            if (d.id !== undefined && (typeof d.id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(d.id))) errors.push(`dividends[${i}] id 無效`);
            if (d.amount !== undefined && !Number.isFinite(Number(d.amount))) errors.push(`dividends[${i}] 金額無效`);
        });
    }
    return { ok: errors.length === 0, errors };
}

// ---------- 本機自動備份快照（覆蓋匯入前、每日首次、或手動建立；保留最近 5 份） ----------
function listLocalSnapshots() {
    return readStoredJson('mce_snapshots', []);
}
function createLocalSnapshot(reason = 'manual') {
    try {
        const snapshots = listLocalSnapshots();
        snapshots.unshift({ at: new Date().toISOString(), reason, data: buildBackupData() });
        safeSetItem('mce_snapshots', JSON.stringify(snapshots.slice(0, 5)));
        return true;
    } catch (error) {
        console.warn('建立本機快照失敗', error);
        return false;
    }
}
function restoreLocalSnapshot(index) {
    const snapshots = listLocalSnapshots();
    const snap = snapshots[index];
    if (!snap || !snap.data) return false;
    const check = validateBackupData(snap.data);
    if (!check.ok) return false;
    processImport(snap.data);
    return true;
}

function exportBackup() {
    const data = buildBackupData();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const dateStr = localDateStr();
    a.download = `rebalance_backup_${dateStr}.json`;
    a.click();
    URL.revokeObjectURL(url);
    if (typeof showToast === 'function') showToast('備份檔已開始下載');
}

function importBackup(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    
    reader.onload = (event) => {
        try {
            const data = JSON.parse(event.target.result);
            if (!Array.isArray(data.stocks) || typeof data.cash !== 'number' || !Number.isFinite(data.cash)) {
                throw new Error("格式不符");
            }
            
            // 安全防護：確認 UI 模組已載入
            if (typeof showConfirm === 'function') {
                showConfirm("確定要完全覆蓋當前所有資料嗎？\n此操作無法復原。", () => processImport(data));
            } else {
                if (confirm("確定要完全覆蓋當前所有資料嗎？\n此操作無法復原。")) processImport(data);
            }
            
        } catch (err) {
            if (typeof showToast === 'function') showToast('備份檔格式不符，請確認檔案內容');
        }
        e.target.value = ''; 
    };
    reader.readAsText(file);
}

function processImport(data) {
    const validation = validateBackupData(data);
    if (!validation.ok) {
        console.warn('匯入驗證失敗', validation.errors);
        if (typeof showToast === 'function') showToast('資料格式不符，已取消還原：' + validation.errors[0]);
        return;
    }
    createLocalSnapshot('before-import');
    state.cash = data.cash || 0;
    state.targetStockRatio = data.targetStockRatio !== undefined ? data.targetStockRatio : 50;
    state.deviation = data.deviation !== undefined ? data.deviation : 5;
    state.cashFlowFirst = data.cashFlowFirst !== undefined ? data.cashFlowFirst : true;
    state.rebalanceMode = data.rebalanceMode || 'global';
    state.watchStocks = Array.isArray(data.watchStocks) ? data.watchStocks : [];
    state.cashFlows = Array.isArray(data.cashFlows) ? data.cashFlows : [];
    state.dividends = Array.isArray(data.dividends) ? data.dividends : [];
    // API 金鑰不再由備份檔匯入，避免把金鑰散播到下載檔或第三方備份。
    
    state.stocks = data.stocks.map(s => {
        const item = {
            ...s,
            beta: s.beta !== undefined ? s.beta : 1,
            targetWeight: s.targetWeight !== undefined ? s.targetWeight : (isETFOrLeveraged(s.symbol, s.name) ? 1 : 0),
            isLocked: s.isLocked !== undefined ? s.isLocked : (s.targetWeight === 0),
            highPrice: s.highPrice !== undefined ? s.highPrice : null,
            highDate: s.highDate !== undefined ? s.highDate : null,
            lowPrice: s.lowPrice !== undefined ? s.lowPrice : null,
            lowDate: s.lowDate !== undefined ? s.lowDate : null,
            waterLevelSource: s.waterLevelSource || 'finmind',
            lastFetchedAt: Number.isFinite(s.lastFetchedAt) ? s.lastFetchedAt : null,
            historyFetchedDate: s.historyFetchedDate || null,
            realizedPnl: Number.isFinite(Number(s.realizedPnl)) ? Number(s.realizedPnl) : 0,
            transactions: s.transactions || [] // 確保新版交易簿相容並保留
        };

        // 資料驅動重算：若有交易紀錄，以交易明細推導真實持股與成本
        if (Array.isArray(item.transactions) && item.transactions.length > 0 && typeof recalculateStockFromTransactions === 'function') {
            recalculateStockFromTransactions(item);
        }
        return item;
    });
    
    // 依序呼叫其他模組的刷新函式
    if (typeof balanceWeights === 'function') balanceWeights();
    saveState();
    if (typeof initUI === 'function') initUI(); 
    if (typeof updateAllData === 'function') updateAllData();
    if (typeof showToast === 'function') showToast('資料已成功還原');
}
