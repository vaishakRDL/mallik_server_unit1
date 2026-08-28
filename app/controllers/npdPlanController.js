const { handleErrorResponse, connection, handleSuccessResponse } = require("../config/dbSql");
const { storeOrder } = require("./orderPlanningController");


exports.npdPlan = async (conn, req, products) => {
    try {
        const sobMstId = products[0].sobMstId;
        const { orderPlnId, orderNo } = await storeOrder(req, sobMstId, 1, req.headers.username || '');

        // Prepare the insert query with placeholders
        const placeholders = products.map(() => '(?, ?, ?, ?, ?, ?, ?)').join(',');
        const insertQuery = `INSERT INTO orderList (sobMstId, orderPlnId, orderNo, contractNo, itemCode, Qty, fimNo) VALUES ${placeholders}`;

        // Flatten the values array for insertion
        const values = products.flatMap(item => [
            sobMstId, orderPlnId, orderNo, item.contractNo, item.itemCode, item.Qty, item.fim
        ]);

        // Execute the insert query
        await conn.execute(insertQuery, values);

       return true;
    } catch (err) {
        throw err;
    }
}
