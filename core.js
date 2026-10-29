// ==========================================
// 共用交易核心：費用、持股、現金與交易紀錄
// ==========================================

// 本地日期字串（YYYY-MM-DD）。不可用 toISOString()：那是 UTC 日期，
// 台灣時間凌晨 00:00–08:00 會得到昨天的日期，交易與抓取日期都會錯位一天。
function localDateStr(date = new Date()) {
    const d = date instanceof Date ? date : new Date(date);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// 記錄一筆非交易現金進出（入金／出金／手動調整現金）。
// 每日盈虧計算會把這類現金流排除，避免把入金誤算成獲利、出金誤算成虧損。
function recordCashFlow(amount, date = localDateStr(), note = '現金調整') {
    const value = Number(amount) || 0;
    if (!value || typeof state === 'undefined') return null;
    if (!Array.isArray(state.cashFlows)) state.cashFlows = [];
    const flow = {
        id: Date.now().toString() + Math.floor(Math.random() * 1000).toString(),
        amount: value,
        date: date || localDateStr(),
        note
    };
    state.cashFlows.push(flow);
    return flow;
}

// 登錄一筆現金股利：入帳到交割戶現金並留下股利紀錄（不影響持股與成本）。
// 股利屬投資收益，不記錄為外部現金流，每日盈虧會在入帳日認列。
function applyDividend({ stock, amount, date, note = '' }) {
    const value = Math.round(Number(amount) || 0);
    if (!stock || value <= 0) throw new Error('股利金額無效');
    if (typeof state === 'undefined') throw new Error('狀態未初始化');
    if (!Array.isArray(state.dividends)) state.dividends = [];
    const record = {
        id: Date.now().toString() + Math.floor(Math.random() * 1000).toString(),
        symbol: stock.symbol || '',
        name: stock.name || stock.symbol || '',
        amount: value,
        date: date || localDateStr(),
        note
    };
    state.dividends.push(record);
    state.cash = (Number(state.cash) || 0) + value;
    return record;
}

function sumDividends(symbol = null) {
    if (typeof state === 'undefined' || !Array.isArray(state.dividends)) return 0;
    return state.dividends
        .filter(d => symbol === null || (d.symbol || '') === symbol)
        .reduce((sum, d) => sum + (Number(d.amount) || 0), 0);
}

function sumRealizedPnl() {
    if (typeof state === 'undefined' || !Array.isArray(state.stocks)) return 0;
    return state.stocks.reduce((sum, s) => sum + (Number(s.realizedPnl) || 0), 0);
}

function isETF(symbol = '', name = '') {
    const normalizedSymbol = String(symbol).toUpperCase();
    const normalizedName = String(name);
    return normalizedSymbol.startsWith('00') ||
        normalizedName.includes('ETF') ||
        normalizedSymbol.endsWith('L') ||
        normalizedSymbol.endsWith('D');
}

function calculateBrokerageFee(amount) {
    const tradeAmount = Number(amount) || 0;
    if (tradeAmount <= 0) return 0;
    // 0.1425% × 28 折後，最後以元為單位無條件捨去，最低 1 元。
    return Math.max(1, Math.floor(tradeAmount * 0.001425 * 0.28));
}

function calculateTradingCost({ type, price, shares, stock = {}, feeOverride = null }) {
    const amount = Number(price) * Number(shares);
    if (!Number.isFinite(amount) || amount < 0) throw new Error('交易金額無效');

    const automaticFee = calculateBrokerageFee(amount);
    const fee = feeOverride === null || feeOverride === undefined
        ? automaticFee
        : Math.max(0, Math.round(Number(feeOverride) || 0));
    const tax = type === 'sell'
        ? Math.round(amount * (isETF(stock.symbol, stock.name) ? 0.001 : 0.003))
        : 0;
    const netAmount = type === 'buy' ? amount + fee : amount - fee - tax;

    return { amount, fee, tax, netAmount };
}

// 顯示用成本：買入實付成本，加上以現價賣出時預估的手續費與交易稅。
// 不改寫 stock.paidCost，避免每次報價更新都把預估賣出費用重複累加。
function calculateAllInCost(stock = {}, currentPrice = null) {
    const shares = Number(stock.shares) || 0;
    // 邊界防護：庫存為 0 時強制所有成本與均價歸零，避免殘留歷史付費
    if (shares <= 0) {
        return {
            buyCost: 0,
            sellFee: 0,
            sellTax: 0,
            totalCost: 0,
            averageCost: 0
        };
    }

    const buyPrice = Number(stock.costPrice) || Number(stock.price) || 0;
    const buyAmount = shares * buyPrice;
    const fallbackBuyCost = buyAmount > 0
        ? buyAmount + calculateBrokerageFee(buyAmount)
        : 0;
    const buyCost = Number.isFinite(Number(stock.paidCost))
        ? Number(stock.paidCost)
        : fallbackBuyCost;
    const sellPrice = Number(currentPrice) || Number(stock.price) || buyPrice;
    const sellCost = sellPrice > 0
        ? calculateTradingCost({ type: 'sell', price: sellPrice, shares, stock })
        : { fee: 0, tax: 0 };
    const totalCost = buyCost + sellCost.fee + sellCost.tax;

    return {
        buyCost,
        sellFee: sellCost.fee,
        sellTax: sellCost.tax,
        totalCost,
        averageCost: totalCost / shares
    };
}

function applyTransaction({
    stock,
    type,
    price,
    shares,
    feeOverride = null,
    date,
    note = '',
    syncCash = true,
    isImported = false,
    id = Date.now().toString()
}) {
    if (!stock || !['buy', 'sell'].includes(type)) throw new Error('交易資料無效');
    if (!Number.isFinite(Number(price)) || Number(price) <= 0 || !Number.isInteger(Number(shares)) || Number(shares) <= 0) {
        throw new Error('請輸入有效的單價與股數');
    }

    const quantity = Number(shares);
    let realizedPnl = null;
    const cost = calculateTradingCost({ type, price, shares: quantity, stock, feeOverride });
    if (type === 'sell' && quantity > (Number(stock.shares) || 0)) {
        throw new Error('賣出股數不可大於現有持股');
    }
    if (type === 'buy' && syncCash && cost.netAmount > (Number(state.cash) || 0)) {
        throw new Error('現金不足，無法完成買進');
    }

    if (type === 'buy') {
        const previousShares = Number(stock.shares) || 0;
        const previousCost = Number.isFinite(Number(stock.paidCost))
            ? Number(stock.paidCost)
            : (Number(stock.costPrice) || Number(stock.price) || 0) * previousShares;
        stock.shares = previousShares + quantity;
        stock.paidCost = previousCost + cost.netAmount;
        stock.costPrice = stock.shares > 0 ? stock.paidCost / stock.shares : 0;
    } else {
        const previousShares = Number(stock.shares) || 0;
        const previousCost = Number.isFinite(Number(stock.paidCost))
            ? Number(stock.paidCost)
            : (Number(stock.costPrice) || Number(stock.price) || 0) * previousShares;
        const averageBuyCost = previousShares > 0 ? previousCost / previousShares : 0;
        stock.shares = previousShares - quantity;
        // 賣出只移除售出股數對應的歷史買入成本，避免剩餘持股仍帶著已賣出的成本。
        stock.paidCost = Math.max(0, previousCost - averageBuyCost * quantity);
        if (stock.shares === 0) stock.costPrice = 0;
        // 已實現損益：賣出淨收入（扣手續費與交易稅）減去售出股數的平均買入成本。
        realizedPnl = cost.netAmount - averageBuyCost * quantity;
        stock.realizedPnl = (Number(stock.realizedPnl) || 0) + realizedPnl;
    }

    if (syncCash) state.cash = (Number(state.cash) || 0) + (type === 'buy' ? -cost.netAmount : cost.netAmount);
    if (!stock.transactions) stock.transactions = [];
    const transaction = {
        id,
        type,
        price: Number(price),
        shares: quantity,
        fee: cost.fee,
        tax: cost.tax,
        netAmount: cost.netAmount,
        date: date || localDateStr(),
        note,
        isImported,
        realizedPnl
    };
    stock.transactions.unshift(transaction);
    return { ...cost, transaction };
}

function movingAverage(values, period) {
    if (!Array.isArray(values) || values.length < period) return null;
    const window = values.slice(-period).map(Number);
    if (window.some(value => !Number.isFinite(value))) return null;
    return window.reduce((sum, value) => sum + value, 0) / period;
}

function calculateTrendSignal(historyData = []) {
    const prices = historyData.map(item => Number(item.c)).filter(Number.isFinite);
    const current = prices.at(-1) || null;
    const ma20 = movingAverage(prices, 20);
    const ma60 = movingAverage(prices, 60);
    let signal = '資料不足';
    if (current !== null && ma20 !== null && ma60 !== null) {
        signal = current >= ma20 && ma20 >= ma60
            ? '多頭'
            : current < ma20 && ma20 < ma60
                ? '空頭'
                : '中性';
    }
    return { current, ma20, ma60, signal };
}

// 依歷史交易明細重推單檔持股股數、付出成本與均價（含除零防呆與精度防護）
function recalculateStockFromTransactions(stock) {
    if (!stock) return;
    const transactions = Array.isArray(stock.transactions) ? [...stock.transactions] : [];
    // 依日期升冪重演帳本
    transactions.sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));

    let currentShares = 0;
    let currentPaidCost = 0;
    let currentRealizedPnl = 0;

    transactions.forEach(t => {
        const type = (t.type === 'buy' || t.type === '買進') ? 'buy' : 'sell';
        const shares = Math.max(0, parseInt(t.shares, 10) || 0);
        const price = Math.max(0, parseFloat(t.price) || 0);
        const cost = calculateTradingCost({
            type,
            price,
            shares,
            stock,
            feeOverride: Number.isFinite(Number(t.fee)) ? Number(t.fee) : null
        });

        if (type === 'buy') {
            currentShares += shares;
            currentPaidCost += cost.netAmount;
        } else {
            const avgBuyCost = currentShares > 0 ? currentPaidCost / currentShares : 0;
            currentRealizedPnl += cost.netAmount - avgBuyCost * shares;
            currentShares = Math.max(0, currentShares - shares);
            currentPaidCost = Math.max(0, currentPaidCost - (avgBuyCost * shares));
        }
    });

    stock.shares = currentShares;
    stock.paidCost = Math.round(currentPaidCost);
    stock.costPrice = currentShares > 0 ? (currentPaidCost / currentShares) : 0;
    stock.realizedPnl = Math.round(currentRealizedPnl);
}
