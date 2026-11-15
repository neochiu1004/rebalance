// ==========================================
// 全台股清單（上市＋上櫃，含 ETF）：FinMind TaiwanStockInfo
// - 首次需要時抓取，localStorage 快取 30 天（與產業分類快取一致）
// - 供追蹤頁關鍵字搜尋、匯入時名稱→代號比對共用
// ==========================================

const STOCK_LIST_CACHE_KEY = 'mce_stock_list';
const STOCK_LIST_TTL_MS = 30 * 24 * 3600 * 1000;

// TaiwanStockInfo 原始列 → 清單：同一代號取日期最新的一筆，只留上市（twse）／上櫃（tpex）
function buildStockList(rows) {
    const bySymbol = new Map();
    (Array.isArray(rows) ? rows : []).forEach(row => {
        if (!row || !row.stock_id || !row.stock_name) return;
        const type = String(row.type || '');
        if (type !== 'twse' && type !== 'tpex') return;
        const symbol = String(row.stock_id).toUpperCase();
        const prev = bySymbol.get(symbol);
        if (prev && String(prev.date || '') >= String(row.date || '')) return;
        bySymbol.set(symbol, {
            symbol,
            name: String(row.stock_name),
            market: type,
            industry: String(row.industry_category || ''),
            date: String(row.date || '')
        });
    });
    return [...bySymbol.values()].sort((a, b) => a.symbol.localeCompare(b.symbol));
}

function getStockListCache() {
    try { return JSON.parse(localStorage.getItem(STOCK_LIST_CACHE_KEY)) || null; } catch { return null; }
}

// 只讀本機快取（同步）：匯入比對等不能等網路的場景用
function getStockListSync() {
    const cache = getStockListCache();
    return cache && Array.isArray(cache.list) ? cache.list : [];
}

let stockListPromise = null;

// 取得全清單：快取未過期直接用，否則用 FinMind Token 抓取並寫回快取。
// 沒有 Token 或抓取失敗時，退回舊快取（可能為空陣列）。
async function ensureStockList() {
    const cache = getStockListCache();
    const stale = !cache || !cache.fetchedAt || (Date.now() - cache.fetchedAt > STOCK_LIST_TTL_MS) || !Array.isArray(cache.list);
    if (!stale) return cache.list;
    if (!state.finmindToken) return getStockListSync();
    if (!stockListPromise) {
        stockListPromise = (async () => {
            try {
                const url = 'https://api.finmindtrade.com/api/v4/data?dataset=TaiwanStockInfo&token=' + state.finmindToken;
                const json = typeof apiFetchJson === 'function' ? await apiFetchJson(url) : await (await fetch(url)).json();
                if (!Array.isArray(json.data)) return getStockListSync();
                const list = buildStockList(json.data);
                if (list.length) {
                    try { localStorage.setItem(STOCK_LIST_CACHE_KEY, JSON.stringify({ fetchedAt: Date.now(), list })); } catch {}
                }
                return list.length ? list : getStockListSync();
            } catch { return getStockListSync(); }
            finally { stockListPromise = null; }
        })();
    }
    return stockListPromise;
}

// 名稱正規化：臺→台、全形轉半形、去空白，讓「群益台灣加權正2」也能對到「群益臺灣加權正2」
function normalizeStockText(text) {
    return String(text || '')
        .replace(/臺/g, '台')
        .replace(/[\uFF01-\uFF5E]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0))
        .replace(/\s+/g, '')
        .toUpperCase();
}

// 關鍵字搜尋：代號完全符合 > 代號開頭 > 代號包含 > 名稱包含
function searchStockList(list, keyword, limit = 20) {
    const kw = normalizeStockText(keyword);
    if (!kw || !Array.isArray(list)) return [];
    const scored = [];
    list.forEach(item => {
        const sym = normalizeStockText(item.symbol);
        const name = normalizeStockText(item.name);
        let score = -1;
        if (sym === kw) score = 0;
        else if (sym.startsWith(kw)) score = 1;
        else if (name.includes(kw)) score = 2;
        else if (sym.includes(kw)) score = 3;
        if (score >= 0) scored.push({ item, score });
    });
    scored.sort((a, b) => a.score - b.score || a.item.symbol.localeCompare(b.item.symbol));
    return scored.slice(0, limit).map(x => x.item);
}

// 名稱 → 代號（匯入比對用）：先完全符合，再用正規化後比對；只讀快取，不等網路
function findStockSymbolByName(name) {
    const list = getStockListSync();
    if (!list.length || !name) return '';
    const exact = list.find(x => x.name === name);
    if (exact) return exact.symbol;
    const target = normalizeStockText(name);
    const normalized = list.find(x => normalizeStockText(x.name) === target);
    return normalized ? normalized.symbol : '';
}
