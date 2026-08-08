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

const state = {
    cash: Number.isFinite(parseFloat(localStorage.getItem('mce_cash'))) ? parseFloat(localStorage.getItem('mce_cash')) : 0,
    targetStockRatio: Number.isFinite(parseFloat(localStorage.getItem('mce_target_stock'))) ? parseFloat(localStorage.getItem('mce_target_stock')) : 50,
    deviation: Number.isFinite(parseFloat(localStorage.getItem('mce_deviation'))) ? parseFloat(localStorage.getItem('mce_deviation')) : 5,
    cashFlowFirst: localStorage.getItem('mce_cash_flow_first') !== 'false',
    stocks: Array.isArray(storedStocks) ? storedStocks : [],
    apiKey: localStorage.getItem('mce_apikey') || '',
    geminiApiKey: localStorage.getItem('mce_gemini_apikey') || '',
    finmindToken: localStorage.getItem('mce_finmind_token') || '',
    rebalanceMode: localStorage.getItem('mce_rebalance_mode') || 'global'
};

function saveState() {
    localStorage.setItem('mce_cash', state.cash);
    localStorage.setItem('mce_target_stock', state.targetStockRatio);
    localStorage.setItem('mce_deviation', state.deviation);
    localStorage.setItem('mce_cash_flow_first', state.cashFlowFirst);
    localStorage.setItem('mce_rebalance_mode', state.rebalanceMode);
    localStorage.setItem('mce_apikey', state.apiKey);
    localStorage.setItem('mce_gemini_apikey', state.geminiApiKey);
    localStorage.setItem('mce_finmind_token', state.finmindToken);
    localStorage.setItem('mce_stocks', JSON.stringify(state.stocks));
}

// 輔助函式：判斷是否為 ETF 或槓桿型 (預設自動納入均分)
function isETFOrLeveraged(symbol, name) {
    const s = (symbol || '').toUpperCase();
    const n = name || '';
    return s.endsWith('L') || s.endsWith('D') || s.startsWith('00') || n.includes('正2') || n.includes('反1') || n.includes('ETF');
}

function exportBackup() {
    const data = {
        version: "14.0",
        exportAt: new Date().toISOString(),
        cash: state.cash,
        targetStockRatio: state.targetStockRatio,
        deviation: state.deviation,
        cashFlowFirst: state.cashFlowFirst,
        rebalanceMode: state.rebalanceMode,
        stocks: state.stocks
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const dateStr = new Date().toISOString().split('T')[0];
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
    state.cash = data.cash || 0;
    state.targetStockRatio = data.targetStockRatio !== undefined ? data.targetStockRatio : 50;
    state.deviation = data.deviation !== undefined ? data.deviation : 5;
    state.cashFlowFirst = data.cashFlowFirst !== undefined ? data.cashFlowFirst : true;
    state.rebalanceMode = data.rebalanceMode || 'global';
    // API 金鑰不再由備份檔匯入，避免把金鑰散播到下載檔或第三方備份。
    
    state.stocks = data.stocks.map(s => ({
        ...s,
        beta: s.beta !== undefined ? s.beta : 1,
        targetWeight: s.targetWeight !== undefined ? s.targetWeight : (isETFOrLeveraged(s.symbol, s.name) ? 1 : 0),
        isLocked: s.isLocked !== undefined ? s.isLocked : (s.targetWeight === 0),
        highPrice: s.highPrice !== undefined ? s.highPrice : null,
        highDate: s.highDate !== undefined ? s.highDate : null,
        lowPrice: s.lowPrice !== undefined ? s.lowPrice : null,
        lowDate: s.lowDate !== undefined ? s.lowDate : null,
        transactions: s.transactions || [] // 確保新版交易簿相容並保留
    }));
    
    // 依序呼叫其他模組的刷新函式
    if (typeof balanceWeights === 'function') balanceWeights();
    saveState();
    if (typeof initUI === 'function') initUI(); 
    if (typeof updateAllData === 'function') updateAllData();
    if (typeof showToast === 'function') showToast('資料已成功還原');
}
