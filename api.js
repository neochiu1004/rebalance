// ==========================================
// MCE 模組化 - api.js (統一 API 層)
// 所有外部 API 呼叫共用：逾時、指數退避重試、localStorage 快取、資料新鮮度標示。
// 新功能一律走這層；既有模組逐步遷移（market.js 已遷移基準與產業兩條）。
// ==========================================

async function apiFetchJson(url, { retries = 2, timeoutMs = 12000 } = {}) {
    let lastError = null;
    for (let attempt = 0; attempt <= retries; attempt++) {
        const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
        const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
        try {
            const res = await fetch(url, controller ? { signal: controller.signal } : undefined);
            if (timer) clearTimeout(timer);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return await res.json();
        } catch (error) {
            if (timer) clearTimeout(timer);
            lastError = error;
            if (attempt < retries) {
                await new Promise(resolve => setTimeout(resolve, 600 * Math.pow(2, attempt)));
            }
        }
    }
    throw lastError || new Error('API 呼叫失敗');
}

function apiCacheGet(key, maxAgeMs) {
    try {
        const raw = JSON.parse(localStorage.getItem(key));
        if (!raw || typeof raw.at !== 'number') return null;
        if (maxAgeMs && Date.now() - raw.at > maxAgeMs) return null;
        return raw;
    } catch { return null; }
}

function apiCacheSet(key, data) {
    try { localStorage.setItem(key, JSON.stringify({ at: Date.now(), data })); return true; }
    catch { return false; }
}

// 資料新鮮度標示：把時間戳轉成「資料時間 10/29 14:03」給 UI 顯示。
function dataFreshnessLabel(ts) {
    if (!ts) return '尚無資料';
    const d = new Date(ts);
    if (!Number.isFinite(d.getTime())) return '尚無資料';
    const pad = (n) => String(n).padStart(2, '0');
    return `資料時間 ${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
