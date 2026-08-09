// ==========================================
// 共用交易核心：費用、持股、現金與交易紀錄
// ==========================================

function isETF(symbol = '', name = '') {
    const normalizedSymbol = String(symbol).toUpperCase();
    const normalizedName = String(name);
    return normalizedSymbol.startsWith('00') ||
        normalizedName.includes('ETF') ||
        normalizedSymbol.endsWith('L') ||
        normalizedSymbol.endsWith('D');
}

function calculateTradingCost({ type, price, shares, stock = {}, feeOverride = null }) {
    const amount = Number(price) * Number(shares);
    if (!Number.isFinite(amount) || amount < 0) throw new Error('交易金額無效');

    const automaticFee = amount > 0 ? Math.max(1, Math.round(amount * 0.001425 * 0.28)) : 0;
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
    const buyPrice = Number(stock.costPrice) || Number(stock.price) || 0;
    const buyAmount = shares * buyPrice;
    const fallbackBuyCost = buyAmount > 0
        ? buyAmount + Math.max(1, Math.round(buyAmount * 0.001425 * 0.28))
        : 0;
    const buyCost = Number.isFinite(Number(stock.paidCost))
        ? Number(stock.paidCost)
        : fallbackBuyCost;
    const sellPrice = Number(currentPrice) || Number(stock.price) || buyPrice;
    const sellCost = shares > 0 && sellPrice > 0
        ? calculateTradingCost({ type: 'sell', price: sellPrice, shares, stock })
        : { fee: 0, tax: 0 };
    const totalCost = buyCost + sellCost.fee + sellCost.tax;

    return {
        buyCost,
        sellFee: sellCost.fee,
        sellTax: sellCost.tax,
        totalCost,
        averageCost: shares > 0 ? totalCost / shares : 0
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
        date: date || new Date().toISOString().split('T')[0],
        note,
        isImported
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
