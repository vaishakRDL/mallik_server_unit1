function getFyMonthRange(fyFrom, fyTo, month) {
    const startFYYear = Number(fyFrom.split("-")[2]);
    const endFYYear = Number(fyTo.split("-")[2]);

    const year = month < 4 ? endFYYear : startFYYear;
    const lastDay = new Date(year, month, 0).getDate();

    const mm = String(month).padStart(2, "0");

    return {
        start: `${year}-${mm}-01`,
        end: `${year}-${mm}-${lastDay}`,
    };
}

module.exports = { getFyMonthRange };
