// 單元／整合測試（無外部相依，Node 直接跑）：node tests/run-tests.js
// 以 vm 載入與瀏覽器相同順序的模組，localStorage／DOM 用最小 stub。
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');

function makeLocalStorage() {
    const map = new Map();
    return {
        getItem: (k) => (map.has(k) ? map.get(k) : null),
        setItem: (k, v) => map.set(k, String(v)),
        removeItem: (k) => map.delete(k),
        clear: () => map.clear()
    };
}

const sandbox = {
    console,
    localStorage: makeLocalStorage(),
    document: {
        getElementById: () => null,
        querySelectorAll: () => [],
        documentElement: { classList: { add() {}, toggle() {}, contains: () => false } },
        createElement: () => ({ click() {}, style: {} })
    },
    navigator: {},
    Chart: class { constructor() {} destroy() {} update() {} },
    URL: { createObjectURL: () => 'blob:x', revokeObjectURL: () => {} },
    Blob: class {},
    FileReader: class {},
    fetch: async () => { throw new Error('tests must not hit network'); },
    setTimeout, clearTimeout, setInterval, clearInterval
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

const files = ['state.js', 'core.js', 'api.js', 'assets.js', 'transactions.js', 'trade.js', 'waterlevel.js', 'rebalance.js', 'watch.js', 'market.js', 'reports.js', 'advanced.js'];
for (const f of files) {
    vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), sandbox, { filename: f });
}
const run = (code) => vm.runInContext(code, sandbox);

let passed = 0, failed = 0;
function test(name, fn) {
    try { fn(); passed++; console.log(`  ok - ${name}`); }
    catch (e) { failed++; console.error(`  FAIL - ${name}: ${e.message}`); }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }
function approx(a, b, eps, msg) { if (Math.abs(a - b) > eps) throw new Error(`${msg || ''} expected ${b}, got ${a}`); }

// ---------- core ----------
test('localDateStr 用本地日期', () => {
    assert(run(`localDateStr(new Date(2026, 0, 5, 1, 0))`) === '2026-01-05');
});
test('calculateTradingCost 買費與賣出稅', () => {
    const buy = run(`calculateTradingCost({ type:'buy', price:50, shares:1000, stock:{symbol:'2330'} })`);
    assert(buy.fee === 19 && buy.netAmount === 50019, JSON.stringify(buy));
    const sellEtf = run(`calculateTradingCost({ type:'sell', price:60, shares:1000, stock:{symbol:'0050'} })`);
    assert(sellEtf.tax === 60, 'ETF 稅 0.1%');
});
test('applyTransaction 已實現損益 +9,778', () => {
    run(`state.cash = 1000000; state.stocks = [{ symbol:'2330', name:'台積電', shares:0, transactions:[] }];`);
    run(`applyTransaction({ stock: state.stocks[0], type:'buy', price:50, shares:1000, date:'2026-01-05' })`);
    const r = run(`applyTransaction({ stock: state.stocks[0], type:'sell', price:60, shares:1000, date:'2026-02-02' })`);
    approx(r.transaction.realizedPnl, 9778, 1, 'realized');
    assert(run(`state.stocks[0].shares`) === 0);
});
test('deleteTransactionWithRollback 回滾現金與已實現', () => {
    const cashBefore = run(`state.cash`);
    const txId = run(`state.stocks[0].transactions[0].id`);
    const deleted = run(`deleteTransactionWithRollback(state.stocks[0], '${txId}')`);
    assert(deleted && deleted.type === 'sell');
    assert(run(`state.stocks[0].shares`) === 1000, '股數回滾');
    approx(run(`state.stocks[0].realizedPnl`), 0, 1, '已實現歸零');
    assert(run(`state.cash`) > cashBefore - 60000, '現金已回滾');
    assert(run(`deleteTransactionWithRollback(state.stocks[0], 'nope')`) === null);
});
test('collectAllTransactions 彙整與排序', () => {
    const all = run(`collectAllTransactions([{ symbol:'A', name:'甲', transactions:[{id:'1', date:'2026-01-01'}] }, { symbol:'B', name:'乙', transactions:[{id:'2', date:'2026-03-01'}] }])`);
    assert(all.length === 2 && all[0].id === '2' && all[0].stockName === '乙');
});
test('computeXirr 已知答案 ~10%', () => {
    const x = run(`computeXirr([{ date:'2025-01-01', amount:100000 }], 110000, '2026-01-01')`);
    approx(x, 0.10, 0.005, 'xirr');
    assert(run(`computeXirr([], 110000, '2026-01-01')`) === null);
});
test('recordCashFlow / applyDividend / sumDividends', () => {
    run(`state.cashFlows = []; state.dividends = [];`);
    const before = run(`state.cash`);
    run(`applyDividend({ stock: state.stocks[0], amount: 500, date:'2026-03-01' })`);
    assert(run(`sumDividends()`) === 500);
    assert(run(`state.cash`) === before + 500);
    run(`recordCashFlow(200000, '2026-03-02', '入金')`);
    assert(run(`state.cashFlows.length`) === 1);
});

// ---------- state ----------
test('validateBackupData 擋壞檔、放行好檔', () => {
    assert(run(`validateBackupData({ cash: 100, stocks: [{ symbol:'2330', shares: 100 }] }).ok`));
    assert(!run(`validateBackupData({ cash: 'x', stocks: [] }).ok`));
    assert(!run(`validateBackupData({ cash: 100, stocks: [{ symbol:'', shares: 1 }] }).ok`));
    assert(!run(`validateBackupData(null).ok`));
});
test('validateBackupData 擋交易欄位注入與壞值（健檢 2026-10-29）', () => {
    assert(run(`validateBackupData({ cash: 100, stocks: [{ symbol:'2330', shares: 100, transactions: [{ id:'csv_1_2', date:'2026-01-05', price:50, shares:100, fee:19, tax:0 }] }] }).ok`), '正常交易應放行');
    assert(!run(`validateBackupData({ cash: 100, stocks: [{ symbol:'2330', transactions: [{ id:"1');alert(1);//" }] }] }).ok`), 'id 含引號應擋下');
    assert(!run(`validateBackupData({ cash: 100, stocks: [{ symbol:'2330', transactions: [{ id:'1', date:'<script>x</script>' }] }] }).ok`), 'date 非日期格式應擋下');
    assert(!run(`validateBackupData({ cash: 100, stocks: [{ symbol:'2330', transactions: [{ id:'1', fee:'abc' }] }] }).ok`), 'fee 非數字應擋下');
    assert(!run(`validateBackupData({ cash: 100, stocks: [], dividends: [{ id:'x y', amount: 100 }] }).ok`), '股利 id 含空白應擋下');
});
test('slimStocksForSave 歷史上限 320', () => {
    const out = run(`slimStocksForSave([{ symbol:'2330', historyData: Array.from({length: 400}, (_, i) => ({ d: '2026-01-' + String(1 + (i % 28)).padStart(2, '0'), c: i })) }])`);
    assert(out[0].historyData.length === 320);
});
test('escapeHtml 跳脫', () => {
    assert(run(`escapeHtml('<a href="x">&')`) === '&lt;a href=&quot;x&quot;&gt;&amp;');
});
test('本機快照建立與列出', () => {
    run(`localStorage.removeItem('mce_snapshots')`);
    assert(run(`createLocalSnapshot('test')`) === true);
    assert(run(`listLocalSnapshots().length`) === 1);
    assert(run(`listLocalSnapshots()[0].reason`) === 'test');
});

// ---------- assets 效能快取 / 區間 ----------
test('calculateDailyPortfolioHistory 快取同簽名回傳同一份', () => {
    run(`state.cash = 50000; state.cashFlows = []; state.stocks = [{ symbol:'2330', name:'台積電', shares:1000, price:100, costPrice:90, paidCost:90000, realizedPnl:0, historyData:[{d:'2026-10-26',c:95},{d:'2026-10-27',c:98},{d:'2026-10-28',c:100}], transactions:[] }];`);
    const a = run(`calculateDailyPortfolioHistory()`);
    const b = run(`calculateDailyPortfolioHistory()`);
    assert(a === b, '第二次應命中快取');
    assert(a.length >= 3);
    run(`state.stocks[0].price = 101;`);
    const c = run(`calculateDailyPortfolioHistory()`);
    assert(c !== a, '狀態變動後應重算');
});
test('sliceDailyRows 依區間切片', () => {
    run(`dailyPnlRangeDays = 2;`);
    assert(run(`sliceDailyRows([1,2,3,4]).join(',')`) === '3,4');
    run(`dailyPnlRangeDays = 0;`);
    assert(run(`sliceDailyRows([1,2,3]).length`) === 3);
    run(`dailyPnlRangeDays = 60;`);
});

// ---------- reports ----------
test('computePerformanceMetrics 合成序列', () => {
    const m = run(`computePerformanceMetrics([{totalValue:100, dailyReturn:0},{totalValue:110, dailyReturn:10},{totalValue:99, dailyReturn:-10}])`);
    assert(m && m.tradingDays === 2 && m.maxDrawdown <= -9.9);
});
test('computeRealizedByYear 與逐筆明細一致', () => {
    const stock = { symbol: '2330', name: '台積電', transactions: [
        { id: 'b1', type: 'buy', price: 50, shares: 1000, fee: 19, date: '2026-01-05' },
        { id: 's1', type: 'sell', price: 60, shares: 1000, fee: 23, date: '2026-02-02' }
    ]};
    run(`window.__testStock = ${JSON.stringify(stock)}`);
    const byYear = run(`computeRealizedByYear([window.__testStock])`);
    const detail = run(`computeRealizedDetail([window.__testStock])`);
    approx(byYear['2026'], 9778, 1, 'byYear');
    approx(detail[0].amount, byYear['2026'], 1, 'detail vs byYear');
});

// ---------- advanced ----------
test('parseDividendEvents 對應 FinMind 實測欄位', () => {
    const rows = [{ stock_id: '2330', CashExDividendTradingDate: '2026-03-17', CashDividendPaymentDate: '2026-04-09', CashEarningsDistribution: 6.000035, StockEarningsDistribution: 0 }];
    const ev = run(`parseDividendEvents(${JSON.stringify(rows)}, { symbol:'2330', name:'台積電', shares:1000 })`);
    assert(ev.length === 1 && ev[0].exDate === '2026-03-17' && ev[0].payDate === '2026-04-09');
    approx(ev[0].estCash, 6000, 1, 'estCash');
});
test('computeScenario Beta 推估', () => {
    run(`state.cash = 100000; state.stocks = [{ symbol:'2330', name:'台積電', shares:1000, price:100, costPrice:90, beta:1, transactions:[] }];`);
    const s = run(`computeScenario(-10)`);
    approx(s.impact, -10000, 1, 'impact');
    approx(s.newTotal, 190000, 1, 'newTotal');
    approx(s.cashRatioAfter, 52.63, 0.1, 'cashRatio');
});
test('computeConcentration 集中警示', () => {
    const c = run(`computeConcentration()`);
    assert(c && c.weights[0].weight === 50, '單一 50%');
    assert(c.warnings.some(w => w.includes('30%')), '應有單一持股警示');
});
test('buildAlerts 空組合不報錯', () => {
    const alerts = run(`buildAlerts([])`);
    assert(Array.isArray(alerts));
});

// ---------- api ----------
test('apiCacheSet/Get + dataFreshnessLabel', () => {
    run(`apiCacheSet('test_key', { a: 1 })`);
    assert(run(`apiCacheGet('test_key', 60000).data.a`) === 1);
    run(`localStorage.setItem('test_key_old', JSON.stringify({ at: Date.now() - 100000, data: { a: 2 } }))`);
    assert(run(`apiCacheGet('test_key_old', 60000)`) === null, '超過 maxAge 應回 null');
    assert(run(`apiCacheGet('test_key_old', 200000).data.a`) === 2, '未過期應回資料');
    assert(run(`dataFreshnessLabel(Date.now())`).includes('資料時間'));
});

// ---------- 整合 ----------
test('updateAllData 呼叫鏈不 throw（三層 wrapper）', () => {
    run(`updateAllData()`);
    assert(run(`window.__marketWrapped && window.__reportsWrapped && window.__advancedWrapped`));
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
