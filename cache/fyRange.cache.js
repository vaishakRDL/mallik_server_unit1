const { getFyMonthRange } = require("../app/utility/date.util");

const cache = new Map();
const fyCache = new Map();

function getFyMonthRangeCached(fyFrom, fyTo, month) {
    const key = `${fyFrom}-${fyTo}-${month}`;

    if (cache.has(key)) return cache.get(key);

    const value = getFyMonthRange(fyFrom, fyTo, month);
    cache.set(key, value);
    return value;
}

function formatDate(dateStr, end = false) {
    const [dd, mm, yyyy] = dateStr.split('-');
    return `${yyyy}-${mm}-${dd} ${end ? '23:59:59' : '00:00:00'}`;
}

function getFYRange(req) {
    const { fyfrom, fyto } = req.headers;
    const key = `${fyfrom}|${fyto}`;

    if (fyCache.has(key)) return fyCache.get(key);

    const result = {
        from: formatDate(fyfrom),
        to: formatDate(fyto, true)
    };

    fyCache.set(key, result);
    return result;
}

module.exports = { getFyMonthRangeCached, getFYRange };
