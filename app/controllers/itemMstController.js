const { connection, handleErrorResponse, handleSuccessResponse, CustomError } = require('../config/dbSql.js');
const { collection, query, value } = require('../utility/itemMaster.js');

exports.store = async (req, res) => {
    try {
        const data = req.body;
        const master = data.masterType;
        const lable = collection[master]?.mstLable;
        const table = collection[master]?.tbName;
        const column = collection[master]?.colName;

        if (!lable || !table || !column) {
            throw new CustomError('Invalid Master type!', 400);
        }

        const fetch = `SELECT * FROM ${table} WHERE ${column} = ? AND dflag = 0`;
        const [results] = await connection.execute(fetch, [data.name]);

        if (results.length > 0) {
            throw new CustomError(`${lable} name already exists!`, 400);
        }

        const sqlQuery = query(master, 'insert');
        const sqlValue = value(master, data);

        if (!sqlQuery || !sqlValue) {
            throw new CustomError('Invalid Master type!', 400);
        }

        await connection.execute(sqlQuery, sqlValue);
        return handleSuccessResponse(res, `${lable} added successfully`);

    } catch (err) {
        return handleErrorResponse(res, err);
    }
};

exports.update = async (req, res) => {
    try {
        const id = req.params.id;
        const data = req.body;
        const master = data.masterType;
        const lable = collection[master]?.mstLable;
        const table = collection[master]?.tbName;

        if (!lable || !table) {
            throw new CustomError('Invalid Master type!', 400);
        }

        const fetch = `SELECT * FROM ${table} WHERE id = ?`;
        const [results] = await connection.execute(fetch, [id]);

        if (results.length <= 0) {
            throw new CustomError(`${lable} not found!`, 404);
        }

        const sqlQuery = query(master, 'update');
        const sqlValue = value(master, data);

        if (!sqlQuery || !sqlValue) {
            throw new CustomError('Invalid Master type!', 400);
        }

        sqlValue.push(id);
        await connection.execute(sqlQuery, sqlValue);
        return handleSuccessResponse(res, `Successfully updated`);

    } catch (err) {
        return handleErrorResponse(res, err);
    }
};

exports.delete = async (req, res) => {
    try {
        const id = req.params.id;
        const master = req.body.masterType;
        const lable = collection[master]?.mstLable;
        const table = collection[master]?.tbName;

        if (!lable || !table) {
            throw new CustomError('Invalid Master type!', 400);
        }

        const fetch = `SELECT * FROM ${table} WHERE id = ?`;
        const [results] = await connection.execute(fetch, [id]);

        if (results.length <= 0) {
            throw new CustomError(`${lable} not found!`, 404);
        }

        const sqlQuery = query(master, 'delete');

        if (!sqlQuery) {
            throw new CustomError('Invalid Master type!', 400);
        }

        await connection.execute(sqlQuery, [id]);
        return handleSuccessResponse(res, `Successfully deleted`);

    } catch (err) {
        return handleErrorResponse(res, err);
    }
};

exports.show = async (req, res) => {
    try {
        const master = req.params.master;
        const lable = collection[master]?.mstLable;
        const table = collection[master]?.tbName;

        if (!lable || !table) {
            throw new CustomError('Invalid Master type!', 400);
        }

        const fetch = 'SELECT *, ? AS masterType FROM ?? WHERE dflag=0';
        const values = [master, table];
        const [results] = await connection.query(fetch, values);

        return handleSuccessResponse(res, `${lable} lists`, results);

    } catch (err) {
        return handleErrorResponse(res, err);
    }
};
