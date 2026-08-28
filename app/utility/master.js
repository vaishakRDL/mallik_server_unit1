const collection = {
    currency: {
        mstLable: 'Currency',
        tbName: 'mst_currency',
        colName: 'code',
    },
    customerGroup: {
        mstLable: 'Customer group',
        tbName: 'mst_cust_group',
        colName: 'name',
    },
    pm: {
        mstLable: 'PM',
        tbName: 'mst_pm',
        colName: 'name',
    },
    machine: {
        mstLable: 'machine',
        tbName: 'mst_machine',
        colName: 'name',
    },
    role: {
        mstLable: 'Role',
        tbName: 'mst_role',
        colName: 'name',
    },
    department: {
        mstLable: 'Department',
        tbName: 'mst_department',
        colName: 'name',
    },
    sp: {
        mstLable: 'SP',
        tbName: 'mst_sp',
        colName: 'name',
    },
    dtr: {
        mstLable: 'DTR',
        tbName: 'mst_dtr',
        colName: 'name',
    },
    section: {
        mstLable: 'Section',
        tbName: 'mst_section',
        colName: 'name',
    },
    city: {
        mstLable: 'City',
        tbName: 'mst_city',
        colName: 'name',
    },
    state: {
        mstLable: 'State',
        tbName: 'mst_state',
        colName: 'name',
    },
    country: {
        mstLable: 'Country',
        tbName: 'mst_country',
        colName: 'name',
    },
    supplierGroup: {
        mstLable: 'Supplier group',
        tbName: 'mst_sup_group',
        colName: 'name',
    },
    tool: {
        mstLable: 'Tool',
        tbName: 'mst_tool',
        colName: 'name',
    },
    uom: {
        mstLable: 'UOM',
        tbName: 'mst_uom',
        colName: 'name',
    },
    supplyType: {
        mstLable: 'Supply type',
        tbName: 'mst_sup_type',
        colName: 'name',
    },
    gstinOrUin: {
        mstLable: 'GSTIN',
        tbName: 'mst_gstin_uin',
        colName: 'name',
    },
    placeOfSupply: {
        mstLable: 'Place of Supply',
        tbName: 'mst_sup_place',
        colName: 'name',
    },
    designation: {
        mstLable: 'Designation',
        tbName: 'mst_designation',
        colName: 'name',
    },
    itemGroup: {
        mstLable: 'Item group',
        tbName: 'mst_item_group',
        colName: 'name',
    },
    tarrif: {
        mstLable: 'Tarrif',
        tbName: 'mst_tarrif',
        colName: 'name',
    },
    trf: {
        mstLable: 'TRF',
        tbName: 'mst_trf',
        colName: 'name',
    },
    orderType: {
        mstLable: 'Order type',
        tbName: 'orderTypes',
        colName: 'orderType',
    },
    menu: {
        mstLable: 'Menu',
        tbName: 'mst_menu',
        colName: 'name',
    },
    location: {
        mstLable: 'Location',
        tbName: 'mst_location',
        colName: 'name',
    },
    displayName: {
        mstLable: 'Display Name',
        tbName: 'mst_display_name',
        colName: 'name',
    },
    inspectionLevel: {
        mstLable: 'Inspection Level',
        tbName: 'mst_inspection_level',
        colName: 'name',
    },
    problemCategory: {
        mstLable: 'Problem Category',
        tbName: 'problem_category',
        colName: 'name',
    },
    natureOfProblem: {
        mstLable: 'Nature of Problem',
        tbName: 'nature_of_problem',
        colName: 'name',
    }
};


function query(master, queryTye) {
    const array = {
        currency: {
            insert: 'INSERT INTO mst_currency (code, name, inactiveStatus, inactiveRemarks, description) VALUES (?, ?, ?, ?, ?)',
            update: 'UPDATE mst_currency SET code=?, name=?, inactiveStatus=?, inactiveRemarks=?, description=? WHERE id=?',
            delete: 'UPDATE mst_currency SET dflag=1 WHERE id = ?'
        },
        customerGroup: {
            insert: 'INSERT INTO mst_cust_group (code, name, inactiveStatus, inactiveRemarks, description) VALUES (?, ?, ?, ?, ?)',
            update: 'UPDATE mst_cust_group SET code=?, name=?, inactiveStatus=?, inactiveRemarks=?, description=? WHERE id=?',
            delete: 'UPDATE mst_cust_group SET dflag=1 WHERE id = ?'
        },
        pm: {
            insert: 'INSERT INTO mst_pm (code, name, vendorProcess, inactiveStatus, inactiveRemarks, description) VALUES (?, ?, ?, ?, ?, ?)',
            update: 'UPDATE mst_pm SET code=?, name=?, vendorProcess=?, inactiveStatus=?, inactiveRemarks=?, description=? WHERE id=?',
            delete: 'UPDATE mst_pm SET dflag=1 WHERE id = ?'
        },
        machine: {
            insert: 'INSERT INTO mst_machine (code, name, inactiveStatus, inactiveRemarks, description) VALUES (?, ?, ?, ?, ?)',
            update: 'UPDATE mst_machine SET code=?, name=?, inactiveStatus=?, inactiveRemarks=?, description=? WHERE id=?',
            delete: 'UPDATE mst_machine SET dflag=1 WHERE id = ?'
        },
        role: {
            insert: 'INSERT INTO mst_role (code, name, inactiveStatus, inactiveRemarks, description) VALUES (?, ?, ?, ?, ?)',
            update: 'UPDATE mst_role SET code=?, name=?, inactiveStatus=?, inactiveRemarks=?, description=? WHERE id=?',
            delete: 'UPDATE mst_role SET dflag=1 WHERE id = ?'
        },
        department: {
            insert: 'INSERT INTO mst_department (code, name, inactiveStatus, inactiveRemarks, description) VALUES (?, ?, ?, ?, ?)',
            update: 'UPDATE mst_department SET code=?, name=?, inactiveStatus=?, inactiveRemarks=?, description=? WHERE id=?',
            delete: 'UPDATE mst_department SET dflag=1 WHERE id = ?'
        },
        sp: {
            insert: 'INSERT INTO mst_sp (code, name, inactiveStatus, inactiveRemarks, description) VALUES (?, ?, ?, ?, ?)',
            update: 'UPDATE mst_sp SET code=?, name=?, inactiveStatus=?, inactiveRemarks=?, description=? WHERE id=?',
            delete: 'UPDATE mst_sp SET dflag=1 WHERE id = ?'
        },
        dtr: {
            insert: 'INSERT INTO mst_dtr (code, name, inactiveStatus, inactiveRemarks, description) VALUES (?, ?, ?, ?, ?)',
            update: 'UPDATE mst_dtr SET code=?, name=?, inactiveStatus=?, inactiveRemarks=?, description=? WHERE id=?',
            delete: 'UPDATE mst_dtr SET dflag=1 WHERE id = ?'
        },
        section: {
            insert: 'INSERT INTO mst_section ( name, inactiveStatus, inactiveRemarks,description) VALUES ( ?, ?,?,?)',
            update: 'UPDATE mst_section SET  name=?,inactiveStatus = ?, inactiveRemarks = ?, description=? WHERE id=?',
            delete: 'UPDATE mst_section SET dflag=1 WHERE id = ?'
        },
        city: {
            insert: 'INSERT INTO mst_city (code, countryId,  stateId, name, inactiveStatus, inactiveRemarks, description) VALUES ( ?, ?, ?, ?, ?, ?, ?)',
            update: 'UPDATE mst_city SET code=?, countryId=?, stateId=?, name=?, inactiveStatus=?, inactiveRemarks=?, description=? WHERE id=?',
            delete: 'UPDATE mst_city SET dflag=1 WHERE id = ?'
        },
        state: {
            insert: 'INSERT INTO mst_state (code, countryId, name, inactiveStatus, inactiveRemarks, description) VALUES (?, ?, ?, ?, ?, ?)',
            update: 'UPDATE mst_state SET code=?, countryId=?, name=?, inactiveStatus=?, inactiveRemarks=?, description=? WHERE id=?',
            delete: 'UPDATE mst_state SET dflag=1 WHERE id = ?'
        },
        country: {
            insert: 'INSERT INTO mst_country (code, name, inactiveStatus, inactiveRemarks, description) VALUES (?, ?, ?, ?, ?)',
            update: 'UPDATE mst_country SET code=?, name=?, inactiveStatus=?, inactiveRemarks=?, description=? WHERE id=?',
            delete: 'UPDATE mst_country SET dflag=1 WHERE id = ?'
        },
        supplierGroup: {
            insert: 'INSERT INTO mst_sup_group (code, name, inactiveStatus, inactiveRemarks, description) VALUES (?, ?, ?, ?, ?)',
            update: 'UPDATE mst_sup_group SET code=?, name=?, inactiveStatus=?, inactiveRemarks=?, description=? WHERE id=?',
            delete: 'UPDATE mst_sup_group SET dflag=1 WHERE id = ?'
        },
        tool: {
            insert: 'INSERT INTO mst_tool (code, name, inactiveStatus, inactiveRemarks, description) VALUES (?, ?, ?, ?, ?)',
            update: 'UPDATE mst_tool SET code=?, name=?, inactiveStatus=?, inactiveRemarks=?, description=? WHERE id=?',
            delete: 'UPDATE mst_tool SET dflag=1 WHERE id = ?'
        },
        uom: {
            insert: 'INSERT INTO mst_uom (code, name, inactiveStatus, inactiveRemarks, description) VALUES (?, ?, ?, ?, ?)',
            update: 'UPDATE mst_uom SET code=?, name=?, inactiveStatus=?, inactiveRemarks=?, description=? WHERE id=?',
            delete: 'UPDATE mst_uom SET dflag=1 WHERE id = ?'
        },
        supplyType: {
            insert: 'INSERT INTO mst_sup_type (name, description) VALUES (?, ?)',
            update: 'UPDATE mst_sup_type SET name=?, description=? WHERE id=?',
            delete: 'UPDATE mst_sup_type SET dflag=1 WHERE id = ?'
        },
        gstinOrUin: {
            insert: 'INSERT INTO mst_gstin_uin (name, description) VALUES (?, ?)',
            update: 'UPDATE mst_gstin_uin SET name=?, description=? WHERE id=?',
            delete: 'UPDATE mst_gstin_uin SET dflag=1 WHERE id = ?'
        },
        placeOfSupply: {
            insert: 'INSERT INTO mst_sup_place (name, description, stateCode) VALUES (?, ?, ?)',
            update: 'UPDATE mst_sup_place SET name=?, description=?, stateCode=? WHERE id=?',
            delete: 'UPDATE mst_sup_place SET dflag=1 WHERE id = ?'
        },
        designation: {
            insert: 'INSERT INTO mst_designation (code, name, inactiveStatus, inactiveRemarks, description) VALUES (?, ?, ?, ?, ?)',
            update: 'UPDATE mst_designation SET code=?, name=?, inactiveStatus=?, inactiveRemarks=?, description=? WHERE id=?',
            delete: 'UPDATE mst_designation SET dflag=1 WHERE id = ?'
        },
        itemGroup: {
            insert: 'INSERT INTO mst_item_group (code, name, inactiveStatus, inactiveRemarks, description, chapterHdr, isstoreGroup) VALUES (?, ?, ?, ?, ?, ?, ?)',
            update: 'UPDATE mst_item_group SET code=?, name=?, inactiveStatus=?, inactiveRemarks=?, description=?, chapterHdr=?, isstoreGroup=? WHERE id=?',
            delete: 'UPDATE mst_item_group SET dflag=1 WHERE id = ?'
        },
        tarrif: {
            insert: 'INSERT INTO mst_tarrif (code, name, inactiveStatus, inactiveRemarks, description) VALUES (?, ?, ?, ?, ?)',
            update: 'UPDATE mst_tarrif SET code=?, name=?, inactiveStatus=?, inactiveRemarks=?, description=? WHERE id=?',
            delete: 'UPDATE mst_tarrif SET dflag=1 WHERE id = ?'
        },
        trf: {
            insert: 'INSERT INTO mst_trf (code, name, inactiveStatus, inactiveRemarks, description) VALUES (?, ?, ?, ?, ?)',
            update: 'UPDATE mst_trf SET code=?, name=?, inactiveStatus=?, inactiveRemarks=?, description=? WHERE id=?',
            delete: 'UPDATE mst_trf SET dflag=1 WHERE id = ?'
        },
        orderType: {
            insert: 'INSERT INTO orderTypes (orderType, description) VALUES (?, ?)',
            update: 'UPDATE orderTypes SET orderType=?, description=? WHERE id = ?',
            delete: 'UPDATE orderTypes SET dflag=1 WHERE id = ?'
        },
        menu: {
            insert: 'INSERT INTO mst_menu (type, code, name, inactiveStatus, inactiveRemarks, description) VALUES (?, ?, ?, ?, ?, ?)',
            update: 'UPDATE mst_menu SET  type=?, code=?, name=?, inactiveStatus=?, inactiveRemarks=?, description=? WHERE id=?',
            delete: 'UPDATE mst_menu SET dflag=1 WHERE id = ?'
        },
        location: {
            insert: 'INSERT INTO mst_location (country, state, city, description) VALUES (?, ?, ?, ?)',
            update: 'UPDATE mst_location SET country=?, state=?, city=?, description=? WHERE id=?',
            delete: 'UPDATE mst_location SET dflag=1 WHERE id = ?'
        },
        displayName: {
            insert: 'INSERT INTO mst_display_name (code, name, inactiveStatus, inactiveRemarks, description) VALUES (?, ?, ?, ?, ?)',
            update: 'UPDATE mst_display_name SET code=?, name=?, inactiveStatus=?, inactiveRemarks=?, description=? WHERE id=?',
            delete: 'UPDATE mst_display_name SET dflag=1 WHERE id = ?'
        },
        inspectionLevel: {
            insert: 'INSERT INTO mst_inspection_level (code, name, inactiveStatus, inactiveRemarks, description) VALUES (?, ?, ?, ?, ?)',
            update: 'UPDATE mst_inspection_level SET code=?, name=?, inactiveStatus=?, inactiveRemarks=?, description=? WHERE id=?',
            delete: 'UPDATE mst_inspection_level SET dflag=1 WHERE id = ?'
        },
        problemCategory: {
            insert: 'INSERT INTO problem_category (name, description) VALUES (?, ?)',
            update: 'UPDATE problem_category SET name=?, description=? WHERE id = ?',
            delete: 'UPDATE problem_category SET dflag=1 WHERE id = ?'
        },
        natureOfProblem: {
            insert: 'INSERT INTO nature_of_problem (name, description) VALUES (?, ?)',
            update: 'UPDATE nature_of_problem SET name=?, description=? WHERE id = ?',
            delete: 'UPDATE nature_of_problem SET dflag=1 WHERE id = ?'
        },
    };

    const query = array[master]?.[queryTye];
    if (!query) return null;
    return query;
}


function value(master, data) {
    const array = {
        currency: [data.code, data.name, data.inactiveStatus, data.inactiveRemarks, data.description],
        customerGroup: [data.code, data.name, data.inactiveStatus, data.inactiveRemarks, data.description],
        pm: [data.code, data.name, data.vendorProcess, data.inactiveStatus, data.inactiveRemarks, data.description],
        machine: [data.code, data.name, data.inactiveStatus, data.inactiveRemarks, data.description],
        role: [data.code, data.name, data.inactiveStatus, data.inactiveRemarks, data.description],
        department: [data.code, data.name, data.inactiveStatus, data.inactiveRemarks, data.description],
        sp: [data.code, data.name, data.inactiveStatus, data.inactiveRemarks, data.description],
        dtr: [data.code, data.name, data.inactiveStatus, data.inactiveRemarks, data.description],
        section: [data.name, data.inactiveStatus, data.inactiveRemarks, data.description],
        city: [data.code, data.countryId, data.stateId, data.name, data.inactiveStatus, data.inactiveRemarks, data.description],
        state: [data.code, data.countryId, data.name, data.inactiveStatus, data.inactiveRemarks, data.description],
        country: [data.code, data.name, data.inactiveStatus, data.inactiveRemarks, data.description],
        supplierGroup: [data.code, data.name, data.inactiveStatus, data.inactiveRemarks, data.description],
        tool: [data.code, data.name, data.inactiveStatus, data.inactiveRemarks, data.description],
        uom: [data.code, data.name, data.inactiveStatus, data.inactiveRemarks, data.description],
        supplyType: [data.name, data.description],
        gstinOrUin: [data.name, data.description],
        placeOfSupply: [data.name, data.description, data.stateCode ?? null],
        designation: [data.code, data.name, data.inactiveStatus, data.inactiveRemarks, data.description],
        itemGroup: [data.code, data.name, data.inactiveStatus, data.inactiveRemarks, data.description, data.chapterHdr, data.isstoreGroup],
        tarrif: [data.code, data.name, data.inactiveStatus, data.inactiveRemarks, data.description],
        trf: [data.code, data.name, data.inactiveStatus, data.inactiveRemarks, data.description],
        orderType: [data.orderType, data.description],
        menu: [data.type, data.code, data.name, data.inactiveStatus, data.inactiveRemarks, data.description],
        location: [data.country, data.state, data.city, data.description ?? null],
        displayName: [data.code, data.name, data.inactiveStatus, data.inactiveRemarks, data.description],
        inspectionLevel: [data.code, data.name, data.inactiveStatus, data.inactiveRemarks, data.description],
        problemCategory: [data.name, data.description],
        natureOfProblem: [data.name, data.description],
    };

    const value = array[master];
    if (!value) return null;
    return value;
}

module.exports = { collection, query, value };