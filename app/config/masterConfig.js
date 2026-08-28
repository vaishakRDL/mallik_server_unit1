// Configuration for different master types used in Bulk Update and Excel Loading
const MASTER_CONFIG = {
    itemMaster: {
        tableName: 'items',
        primaryKey: 'id',
        fields: [
            'itemCode', 'itemName', 'itemGroup', 'inActive', 'uom', 'stdRate', 'gstCategory',
            'minStockLvl', 'maxLvl', 'underLedger', 'reorder', 'rol', 'roq', 'shelfLifeItem',
            'hsnCode', 'critical', 'mainLocation', 'productFinish', 'productFamily',
            'category', 'fimId', 'grossWeight', 'netWeight', 'scrapWeight',
            'rmItemCode', 'rmThickness', 'rmWidth', 'rmLength',
            'stockControl', 'material', 'materialThickness', 'jcPart', 'nonStockable'
        ],
        booleanFields: ['inActive', 'nonStockable'],
        fkMappings: {
            itemGroup: { table: 'mst_item_group', label: 'Item Group' },
            uom: { table: 'mst_uom', label: 'UOM' },
            hsnCode: { table: 'item_hsn_code', label: 'HSN' },
            mainLocation: { table: 'item_main_loc', label: 'Location' },
            productFinish: { table: 'item_product_finish', label: 'Finish' },
            productFamily: { table: 'item_product_family', label: 'Product Family' },
            fimId: { table: 'item_fim_id', label: 'FIM' },
            underLedger: { table: 'item_under_ledger', label: 'Ledger' }
        },
        postUpdate: async (conn) => {
            const { incCacheVersion } = require('../controllers/itemController');
            await incCacheVersion();
        }
    },
    bom: {
        tableName: 'bom',
        primaryKey: 'id',
        trackUpdates: false,
        fields: ['Qty', 'jcPart'],
        excelAliases: {
            'bomitemcode': 'mainItemCode',
            'itemcode': 'childItemCode'
        },
        validateRow: (rowData) => {
            if (!rowData.mainItemCode || !rowData.childItemCode) {
                if (!rowData.id) {
                    rowData.status = 'ERROR';
                    rowData.errors.push("BOM Item Code and Item Code are required");
                }
            }
        },
        resolveId: async (conn, data) => {
            const pairs = data.filter(r => r.mainItemCode && r.childItemCode && !r.id);
            if (pairs.length === 0) return;

            const chunkArray = (arr, size) => Array.from({ length: Math.ceil(arr.length / size) }, (v, i) => arr.slice(i * size, i * size + size));

            // Fetch main item IDs
            const mainCodes = [...new Set(pairs.map(r => r.mainItemCode))];
            const mainMap = new Map();
            if (mainCodes.length > 0) {
                for (const chunk of chunkArray(mainCodes, 5000)) {
                    const [rows] = await conn.query('SELECT id, itemCode FROM bom_mst WHERE itemCode IN (?)', [chunk]);
                    rows.forEach(r => mainMap.set(r.itemCode, r.id));
                }
            }

            // Fetch child item IDs
            const childCodes = [...new Set(pairs.map(r => r.childItemCode))];
            const childMap = new Map();
            if (childCodes.length > 0) {
                for (const chunk of chunkArray(childCodes, 5000)) {
                    const [rows] = await conn.query('SELECT id, itemCode FROM items WHERE itemCode IN (?)', [chunk]);
                    rows.forEach(r => childMap.set(r.itemCode, r.id));
                }
            }

            const bomLookups = [];
            for (const row of pairs) {
                const mstId = mainMap.get(row.mainItemCode);
                const itemId = childMap.get(row.childItemCode);
                if (mstId && itemId) {
                    bomLookups.push({ row, mstId, itemId });
                } else {
                    row.status = 'ERROR';
                    row.errors.push(`Main or Child item not found in master.`);
                }
            }

            if (bomLookups.length === 0) return;

            // Highly Optimized ID resolution:
            // Instead of tuple IN clauses which are slow in MySQL, fetch all BOMs for the involved main items.
            const uniqueMstIds = [...new Set(bomLookups.map(l => l.mstId))];
            const bomMap = new Map();
            
            for (const chunk of chunkArray(uniqueMstIds, 2000)) {
                const [bomRows] = await conn.query(`SELECT id, bomMstId, itemId FROM bom WHERE bomMstId IN (?)`, [chunk]);
                bomRows.forEach(r => bomMap.set(`${r.bomMstId}-${r.itemId}`, r.id));
            }

            for (const lookup of bomLookups) {
                const key = `${lookup.mstId}-${lookup.itemId}`;
                const bomId = bomMap.get(key);
                if (bomId) {
                    lookup.row.id = bomId;
                } else {
                    lookup.row.status = 'ERROR';
                    lookup.row.errors.push(`BOM record not found for this main-child combination.`);
                }
            }
        }
    }
};

// --- DYNAMIC REGISTRATION FOR SIMPLE MASTERS ---
const generalMasters = require('../utility/master').collection;
const itemMasters = require('../utility/itemMaster').collection;

const generalFieldsMap = {
    currency: ['code', 'name', 'inactiveStatus', 'inactiveRemarks', 'description'],
    customerGroup: ['code', 'name', 'inactiveStatus', 'inactiveRemarks', 'description'],
    pm: ['code', 'name', 'vendorProcess', 'inactiveStatus', 'inactiveRemarks', 'description'],
    machine: ['code', 'name', 'inactiveStatus', 'inactiveRemarks', 'description'],
    role: ['code', 'name', 'inactiveStatus', 'inactiveRemarks', 'description'],
    department: ['code', 'name', 'inactiveStatus', 'inactiveRemarks', 'description'],
    sp: ['code', 'name', 'inactiveStatus', 'inactiveRemarks', 'description'],
    dtr: ['code', 'name', 'inactiveStatus', 'inactiveRemarks', 'description'],
    section: ['name', 'inactiveStatus', 'inactiveRemarks', 'description'],
    city: ['code', 'countryId', 'stateId', 'name', 'inactiveStatus', 'inactiveRemarks', 'description'],
    state: ['code', 'countryId', 'name', 'inactiveStatus', 'inactiveRemarks', 'description'],
    country: ['code', 'name', 'inactiveStatus', 'inactiveRemarks', 'description'],
    supplierGroup: ['code', 'name', 'inactiveStatus', 'inactiveRemarks', 'description'],
    tool: ['code', 'name', 'inactiveStatus', 'inactiveRemarks', 'description'],
    uom: ['code', 'name', 'inactiveStatus', 'inactiveRemarks', 'description'],
    supplyType: ['name', 'description'],
    gstinOrUin: ['name', 'description'],
    placeOfSupply: ['name', 'description', 'stateCode'],
    designation: ['code', 'name', 'inactiveStatus', 'inactiveRemarks', 'description'],
    itemGroup: ['code', 'name', 'inactiveStatus', 'inactiveRemarks', 'description', 'chapterHdr', 'isstoreGroup'],
    tarrif: ['code', 'name', 'inactiveStatus', 'inactiveRemarks', 'description'],
    trf: ['code', 'name', 'inactiveStatus', 'inactiveRemarks', 'description'],
    orderType: ['orderType', 'description'],
    menu: ['type', 'code', 'name', 'inactiveStatus', 'inactiveRemarks', 'description'],
    location: ['country', 'state', 'city', 'description'],
    displayName: ['code', 'name', 'inactiveStatus', 'inactiveRemarks', 'description'],
    inspectionLevel: ['code', 'name', 'inactiveStatus', 'inactiveRemarks', 'description'],
    problemCategory: ['name', 'description'],
    natureOfProblem: ['name', 'description'],
};

const itemMastersFieldsMap = {
    underLedger: ['code', 'name', 'description'],
    reorder : ['name', 'description'],
    mainLocation : ['name', 'description'],
    hsnCode : ['name', 'description'],
    subLocation : ['name', 'description'],
    productFinish : ['name', 'description'],
    productFamily : ['name', 'description'],
    category : ['name', 'description'],
    fim : ['name', 'description', 'packingCharge'],
    rmItemcode : ['name', 'description'],
    product: ['name', 'description']
};

Object.keys(generalFieldsMap).forEach(key => {
    if (generalMasters[key]) {
        MASTER_CONFIG[key] = {
            tableName: generalMasters[key].tbName,
            primaryKey: 'id',
            trackUpdates: false,
            fields: generalFieldsMap[key]
        };
    }
});

Object.keys(itemMastersFieldsMap).forEach(key => {
    if (itemMasters[key]) {
        MASTER_CONFIG[key] = {
            tableName: itemMasters[key].tbName,
            primaryKey: 'id',
            trackUpdates: false,
            fields: itemMastersFieldsMap[key]
        };
    }
});

module.exports = MASTER_CONFIG;
