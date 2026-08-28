const collection = {
    underLedger: {
        mstLable: 'Under ledger',
        tbName: 'item_under_ledger',
        colName: 'name',
    },
    reorder : {
        mstLable: 'Reorder',
        tbName: 'item_reorder',
        colName: 'name',
    },
    mainLocation : {
        mstLable: 'Main location',
        tbName: 'item_main_loc',
        colName: 'name',
    },
    hsnCode : {
        mstLable: 'HSN code',
        tbName: 'item_hsn_code',
        colName: 'name',
    },
    category : {
        mstLable: 'Category',
        tbName: 'item_category',
        colName: 'name',
    },
    fim : {
        mstLable: 'FIM',
        tbName: 'item_fim_id',
        colName: 'name',
    },
    rmItemcode : {
        mstLable: 'RM code',
        tbName: 'item_rm_code',
        colName: 'name',
    },
    subLocation : {
        mstLable: 'Sub Location',
        tbName: 'item_sub_loc',
        colName: 'name',
    },
    productFinish : {
        mstLable: 'Product Finish',
        tbName: 'item_product_finish',
        colName: 'name',
    },
    productFamily : {
        mstLable: 'Product Family',
        tbName: 'item_product_family',
        colName: 'name',
    },
    product: {
        mstLable: 'Product',
        tbName: 'mst_products',
        colName: 'name',
    },
}



function query(itemMst, queryTye) {
    const array = {
        underLedger: {
            insert: 'INSERT INTO item_under_ledger (code, name, description) VALUES (?, ?, ?)',
            update: 'UPDATE item_under_ledger SET code =?, name=?, description=? WHERE id=?',
            delete: 'DELETE FROM item_under_ledger  WHERE id = ?'
        },
        reorder: {
            insert: 'INSERT INTO item_reorder (name, description) VALUES (?, ?)',
            update: 'UPDATE item_reorder SET name=?, description=? WHERE id=?',
            delete: 'UPDATE item_reorder SET dflag=1 WHERE id = ?'
        },
        mainLocation: {
            insert: 'INSERT INTO item_main_loc (name, description) VALUES (?, ?)',
            update: 'UPDATE item_main_loc SET name=?, description=? WHERE id=?',
            delete: 'UPDATE item_main_loc SET dflag=1 WHERE id = ?'
        },
        hsnCode: {
            insert: 'INSERT INTO item_hsn_code (name, description) VALUES (?, ?)',
            update: 'UPDATE item_hsn_code SET name=?, description=? WHERE id=?',
            delete: 'UPDATE item_hsn_code SET dflag=1 WHERE id = ?'
        },
        subLocation: {
            insert: 'INSERT INTO item_sub_loc (name, description) VALUES (?, ?)',
            update: 'UPDATE item_sub_loc SET name=?, description=? WHERE id=?',
            delete: 'UPDATE item_sub_loc SET dflag=1 WHERE id = ?'
        },
        productFinish: {
            insert: 'INSERT INTO item_product_finish (name, description) VALUES (?, ?)',
            update: 'UPDATE item_product_finish SET name=?, description=? WHERE id=?',
            delete: 'UPDATE item_product_finish SET dflag=1 WHERE id = ?'
        },
        productFamily: {
            insert: 'INSERT INTO item_product_family (name, description) VALUES (?, ?)',
            update: 'UPDATE item_product_family SET name=?, description=? WHERE id=?',
            delete: 'UPDATE item_product_family SET dflag=1 WHERE id = ?'
        },
        category: {
            insert: 'INSERT INTO item_category (name, description) VALUES (?, ?)',
            update: 'UPDATE item_category SET name=?, description=? WHERE id=?',
            delete: 'UPDATE item_category SET dflag=1 WHERE id = ?'
        },
        fim: {
            insert: 'INSERT INTO item_fim_id (name, description, packingCharge) VALUES (?, ?, ?)',
            update: 'UPDATE item_fim_id SET name=?, description=?, packingCharge=? WHERE id=?',
            delete: 'UPDATE item_fim_id SET dflag=1 WHERE id = ?'
        },
        rmItemcode: {
            insert: 'INSERT INTO item_rm_code (name, description) VALUES (?, ?)',
            update: 'UPDATE item_rm_code SET name=?, description=? WHERE id=?',
            delete: 'UPDATE item_rm_code SET dflag=1 WHERE id = ?'
        },
        product: {
            insert: 'INSERT INTO mst_products (name, description) VALUES (?, ?)',
            update: 'UPDATE mst_products SET name=?, description=? WHERE id=?',
            delete: 'UPDATE mst_products SET dflag=1 WHERE id = ?'
        }
    }

    const query = array[itemMst][queryTye];
    if (!query) return null;
    return query;
}



function value(itemMst, data) {
    const array = {
        underLedger: [data.code, data.name, data.description],
        reorder : [data.name, data.description],
        mainLocation : [data.name, data.description],
        hsnCode : [data.name, data.description],
        subLocation : [data.name, data.description],
        productFinish : [data.name, data.description],
        productFamily : [data.name, data.description],
        category : [data.name, data.description],
        fim : [data.name, data.description, data.packingCharge ?? 0],
        rmItemcode : [data.name, data.description],
        product: [data.name, data.description]
    }

    const value = array[itemMst];
    if (!value) return null;
    return value;
}


module.exports = { collection, query, value };