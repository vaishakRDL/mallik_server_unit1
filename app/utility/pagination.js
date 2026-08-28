const { connection } = require("../config/dbSql");

async function paginateQuery(sqlQuery, query) {
    const page = Number(query.page || 0);
    const limit = Number(query.limit || 100);
    const offset = page * limit;

    // Simply append pagination without touching existing parameters
    return `${sqlQuery} LIMIT ${limit} OFFSET ${offset}`;
}


async function totRowCount(tableName) {
    const [rows] = await connection.execute(`SELECT COUNT(*) as totalRow FROM ${tableName}`, []);
    return rows[0].totalRow;
}

module.exports = { paginateQuery, totRowCount }
