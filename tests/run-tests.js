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
test('賣出不改均價、買入才移動均價', () => {
    run(`state.cash = 1000000; state.stocks = [{ symbol:'2330', name:'台積電', shares:0, transactions:[] }];`);
    run(`applyTransaction({ stock: state.stocks[0], type:'buy', price:50, shares:100, date:'2026-01-01' })`);
    const before = run(`state.stocks[0].costPrice`);
    run(`applyTransaction({ stock: state.stocks[0], type:'sell', price:60, shares:40, date:'2026-01-02' })`);
    approx(run(`state.stocks[0].costPrice`), before, 0.0001, '賣出後均價');
    run(`applyTransaction({ stock: state.stocks[0], type:'buy', price:70, shares:60, date:'2026-01-03' })`);
    assert(run(`state.stocks[0].costPrice`) > before, '買入後均價應上升');
});
test('匯入交易含現成費用稅額，刪除不錯動現金', () => {
    run(`state.cash = 100000; state.stocks = [{ symbol:'00631L', name:'元大台灣50正2', shares:0, transactions:[] }];`);
    run(`applyTransaction({ stock: state.stocks[0], type:'buy', price:26.79, shares:250, feeOverride:2, date:'2026/11/06', syncCash:false, id:'import-buy' })`);
    run(`state.stocks[0].transactions[0].netAmount = 6699; state.stocks[0].transactions[0].tax = 0; recalculateStockFromTransactions(state.stocks[0]);`);
    const cashBefore = run(`state.cash`);
    run(`deleteTransactionWithRollback(state.stocks[0], 'import-buy')`);
    assert(run(`state.cash`) === cashBefore, '刪除匯入交易不應回滾現金');
    run(`state.stocks[0].transactions = [{ id:'csv_legacy_1', type:'buy', price:10, shares:10, fee:1, tax:0, netAmount:101, date:'2026-01-01' }]; recalculateStockFromTransactions(state.stocks[0]);`);
    const legacyCash = run(`state.cash`);
    run(`deleteTransactionWithRollback(state.stocks[0], 'csv_legacy_1')`);
    assert(run(`state.cash`) === legacyCash, '舊版 CSV 交易也不應回滾現金');
});
test('deleteTransactionWithRollback 回滾現金與已實現', () => {
    run(`state.cash = 1000000; state.stocks = [{ symbol:'2330', name:'台積電', shares:0, transactions:[] }];`);
    run(`applyTransaction({ stock: state.stocks[0], type:'buy', price:50, shares:1000, date:'2026-01-05' })`);
    run(`applyTransaction({ stock: state.stocks[0], type:'sell', price:60, shares:1000, date:'2026-02-02' })`);
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
test('券商 CSV 解析逗號與內建代號', () => {
    const row = run(`parseBrokerCsvLine('元大台灣50正2,2026/11/06,250,"-6,699",26.79,"6,697",2,0,0,k0ANR,台幣,')`);
    assert(row.length === 12 && row[3] === '-6,699', 'CSV quoted amount');
    assert(run(`resolveImportedSymbol('元大台灣50正2')`) === '00631L', '內建代號');
});
test('sliceDailyRows 依區間切片', () => {
    run(`dailyPnlRangeDays = 2;`);
    assert(run(`sliceDailyRows([1,2,3,4]).join(',')`) === '3,4');
    run(`dailyPnlRangeDays = 0;`);
    assert(run(`sliceDailyRows([1,2,3]).length`) === 3);
    run(`dailyPnlRangeDays = 60;`);
});

test('annualPnl 年度損益跨年歸零重算', () => {
    run(`state.cash = 0; state.cashFlows = []; state.stocks = [{ symbol:'2330', name:'台積電', shares:1000, price:92, costPrice:90, paidCost:90000, realizedPnl:0, historyData:[{d:'2025-12-30',c:90},{d:'2025-12-31',c:95},{d:'2026-01-02',c:92}], transactions:[] }];`);
    const rows = run(`calculateDailyPortfolioHistory()`);
    const byDate = Object.fromEntries(rows.map(r => [r.date, r]));
    approx(byDate['2025-12-31'].annualPnl, 5000, 1, '2025 年度累計');
    approx(byDate['2026-01-02'].dailyPnl, -3000, 1, '2026 首日每日盈虧');
    approx(byDate['2026-01-02'].annualPnl, -3000, 1, '跨年後年度損益應歸零重算，不是 2000');
});

// ---------- 新增股票自動連結 / 追蹤帶入買入清單 ----------
test('getCachedStockInfoBySymbol 自追蹤清單帶入名稱與現價', () => {
    run(`state.apiKey = ''; state.stocks = []; state.watchStocks = [{ symbol:'2330', name:'台積電', price: 1000, changePercent: 1.5, volume: 123 }];`);
    const info = run(`getCachedStockInfoBySymbol('2330')`);
    assert(info.name === '台積電' && info.price === 1000, JSON.stringify(info));
    const lower = run(`getCachedStockInfoBySymbol(' 2330 ')`);
    assert(lower.name === '台積電', '代號應 trim');
});
test('getCachedStockInfoBySymbol 名稱等於代號時不當真名、無資料回空', () => {
    run(`state.stocks = [{ symbol:'9999', name:'9999', price: 0 }]; state.watchStocks = [];`);
    const info = run(`getCachedStockInfoBySymbol('9999')`);
    assert(info.name === '' && info.price === 0, JSON.stringify(info));
    assert(run(`getCachedStockInfoBySymbol('0000').name`) === '');
});
test('listWatchOnlyStocks 只列未持有的追蹤股票並去重', () => {
    run(`state.stocks = [{ symbol:'2330', name:'台積電', shares:100, price:1000 }]; state.watchStocks = [{ symbol:'2330', name:'台積電', price:1000 }, { symbol:'0050', name:'元大台灣50', price:180 }, { symbol:'2317', name:'鴻海', price:200 }];`);
    const list = run(`listWatchOnlyStocks()`);
    assert(list.length === 2 && list[0].symbol === '0050' && list[0].name === '元大台灣50' && list[0].price === 180, JSON.stringify(list));
    assert(list[1].watchIndex === 2, 'watchIndex 要對應原追蹤清單位置');
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

// ---------- 庫存 CSV 建立底倉 ----------
test('parseBasePositionCsv 解析庫存檔案並略過總計列', () => {
    const csv = '股票名稱,股數,總損益,交易別,成交均價,市價,現值,付出成本,預估損益,報酬率,幣別\n元大台灣50正2,"1,550","-3,937",現股,34.41,31.92,"49,414","53,351","-3,937",-7.38%,台幣\n群益臺灣加權正2,"3,100","-3,079",現股,11.38,10.4,"32,197","35,276","-3,079",-8.73%,台幣\n總預估損益,"-7,016",總報酬率,-7.92%\n總預估現值,"81,611",總成本,"88,627"\n總融資金額,0,總利息,0';
    const parsed = run('parseBasePositionCsv(' + JSON.stringify(csv) + ')');
    assert(parsed.rows.length === 2, '應解析出 2 檔持股');
    assert(parsed.rows[0].shares === 1550 && parsed.rows[0].paidCost === 53351, '股數與付出成本');
    approx(parsed.rows[0].avgPrice, 34.41, 0.001, '成交均價');
    approx(parsed.rows[1].marketPrice, 10.4, 0.001, '市價');
    assert(parsed.skipped === 3, '總計列應略過 3 列');
});
test('applyBasePositions 建立底倉、成本以付出成本為準、重複匯入略過', () => {
    run(`state.cash = 777; state.stocks = []; state.watchStocks = [];`);
    const rowsJson = JSON.stringify([{ name: '元大台灣50正2', shares: 1550, avgPrice: 34.41, paidCost: 53351, marketPrice: 31.92 }]);
    const r1 = run('applyBasePositions(' + rowsJson + ')');
    assert(r1.created === 1, '應建立 1 檔');
    const st = run(`state.stocks[0]`);
    assert(st.symbol === '00631L' && st.shares === 1550 && st.paidCost === 53351, JSON.stringify(st));
    approx(st.price, 31.92, 0.001, '現價應為市價');
    approx(st.costPrice, 53351 / 1550, 0.01, '均價應由付出成本推得');
    assert(run(`state.cash`) === 777, '建立底倉不扣現金');
    const r2 = run('applyBasePositions(' + rowsJson + ')');
    assert(r2.created === 0 && r2.skipped === 1, '重複匯入應略過');
    assert(run(`state.stocks[0].shares`) === 1550, '重複匯入不重複加股');
});
test('applyBasePositions 已有其他來源持股時不覆蓋', () => {
    run(`state.stocks = [{ symbol:'2330', name:'台積電', shares:100, price:1000, costPrice:900, paidCost:90000, transactions:[{id:'t1',type:'buy',price:900,shares:100,fee:128,tax:0,netAmount:90128,date:'2026-01-01'}] }]; state.watchStocks = [];`);
    const r = run('applyBasePositions(' + JSON.stringify([{ name: '台積電', shares: 500, avgPrice: 900, paidCost: 450000, marketPrice: 1000 }]) + ')');
    assert(r.created === 0 && r.skipped === 1, '已有持股應略過');
    assert(run(`state.stocks[0].shares`) === 100, '股數不變');
});
test('交易頁有獨立的底倉匯入按鍵', () => {
    const tradeJs = fs.readFileSync(path.join(root, 'trade.js'), 'utf8');
    assert(tradeJs.includes('匯入庫存建立底倉'), '缺少底倉匯入區塊');
    assert(tradeJs.includes('handleBasePositionUpload(event)'), '底倉按鍵應呼叫 handleBasePositionUpload');
    assert(tradeJs.includes('handleCSVUpload(event)'), '原券商對帳單匯入應保留');
});

// ---------- 頁面重組（index.html 結構） ----------
const indexHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
test('底部標籤只留四個（同頁功能共用）且不再使用更多選單', () => {
    for (const id of ['tab-assets', 'tab-rebalance', 'tab-waterlevel', 'tab-settings']) {
        assert(indexHtml.includes(`id="${id}"`), `缺少 ${id}`);
    }
    for (const id of ['tab-trade', 'tab-target', 'tab-watch']) {
        assert(!indexHtml.includes(`id="${id}"`), `同頁功能不應再有底部標籤 ${id}`);
    }
    assert(!indexHtml.includes('more-menu'), '不應再有 more-menu');
    assert(!indexHtml.includes('tab-more'), '不應再有 tab-more');
    assert(!indexHtml.includes('toggleMoreMenu'), '不應再有 toggleMoreMenu');
});
test('資產/交易與市場水位/追蹤有共用切換頁首', () => {
    assert(indexHtml.includes('id="view-assets-head"'), '缺少 view-assets-head');
    assert(indexHtml.includes('id="view-market-head"'), '缺少 view-market-head');
    for (const t of ['assets', 'trade', 'waterlevel', 'watch']) {
        assert(indexHtml.includes(`data-toggle-tab="${t}"`), `缺少切換按鈕 ${t}`);
    }
});
test('switchTab 合併頁面對照正確', () => {
    assert(indexHtml.includes("['view-rebalance', 'view-target']"), '再平衡應與目標配置同頁');
    assert(indexHtml.includes("['view-assets-head', 'view-assets']"), '資產應含共用頁首');
    assert(indexHtml.includes("['view-assets-head', 'view-trade']"), '交易應含共用頁首');
    assert(indexHtml.includes("['view-market-head', 'view-waterlevel']"), '市場水位應含共用頁首');
    assert(indexHtml.includes("['view-market-head', 'view-watch']"), '追蹤應含共用頁首');
    assert(indexHtml.includes("trade: 'tab-assets'"), '交易模式應亮資產總覽標籤');
    assert(indexHtml.includes("target: 'tab-rebalance'"), '目標配置應亮再平衡標籤');
    assert(indexHtml.includes("watch: 'tab-waterlevel'"), '追蹤模式應亮市場水位標籤');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
