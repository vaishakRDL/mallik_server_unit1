const { connection, CustomError } = require("../../config/dbSql");
const excel = require("exceljs");
const { currentDateTime } = require("../../utility/utilityFunction");

exports.template = async (req, res) => {
  try {
    const workbook = new excel.Workbook();
    const worksheet = workbook.addWorksheet("Sheet 1");

    // Add headers
    const headerRow = worksheet.addRow([
      "Contract No",
      "Part No",
      "Qty",
      "Desciption",
      "Box No",
    ]);

    // Apply styles to the header row
    headerRow.font = { bold: true }; // Make text bold
    headerRow.alignment = { horizontal: "center" }; // Center align text

    worksheet.columns.forEach((column) => {
      column.width = 20;
    });

    // Set content type and disposition including desired filename
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader("Content-Disposition", "attachment; filename = CSL.xlsx");

    // Write the Excel file to the response
    workbook.xlsx
      .write(res)
      .then(() => {
        // End the response stream
        res.end();
      })
      .catch((err) => {
        console.error("Error writing Excel file:", err);
        res.status(500).send("Error generating Excel file");
      });
  } catch (err) {
    return res
      .status(400)
      .json({ success: false, message: err.message || "An error occurred" });
  }
};

// exports.import = async (req, res) => {
//     try {
//         if (!req.body.file) {
//             return res.status(400).json({ success: false, message: 'No file uploaded' });
//         }

//         const base64URL = 'data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,';
//         const base64Data = req.body.file.replace(base64URL, '');

//         const buffer = Buffer.from(base64Data, 'base64');

//         const workbook = new excel.Workbook();
//         await workbook.xlsx.load(buffer);

//         const worksheet = workbook.getWorksheet(1);
//         const contents = [];

//         const rowFIM = worksheet.getRow(2).getCell(5).text;  // pluck FIM from first cell
//         const FIM = rowFIM.match(/^[^\d]*/)[0];              // Extracting the Int from FIM
//         //console.log("FIM", FIM)

//         worksheet.eachRow((row, rowNumber) => {
//             if (rowNumber !== 1) {                           // Skip header row
//                 const boxNo = row.getCell(5).value;

//                 if (!boxNo.startsWith(FIM)) {                // Check if box number starts with FIM
//                     throw new Error(`Box number does not start with "FIM" at row ${boxNo}`);
//                 }
//                 const csl = {
//                     contractNo: row.getCell(1).value,
//                     partNo: row.getCell(2).value,
//                     Qty: row.getCell(3).value,
//                     desc: row.getCell(4).value,
//                     boxNo: boxNo,
//                 };
//                 contents.push(csl);
//             }
//         });

//         try {
// const contractNo = contents[0].contractNo;
// const cslMstId = await masterCsl(contractNo);

// const insertQuery = 'INSERT INTO csl (cslMstId , contractNo, partNo, Qty, description, boxNo) VALUES ?';
// const values = contents.map(item => [cslMstId , item.contractNo, item.partNo, item.Qty, item.desc, item.boxNo]);

// await connection.query(insertQuery, [values]);

// return res.status(200).json({ success: true, message: 'Successfully imported' });

//         } catch (insertError) {
//             return res.status(500).json({ success: false, message: insertError.message });
//         }
//     } catch (err) {
//         return res.status(500).json({ success: false, message: err.message });
//     }
// };

async function masterCsl(contractNo) {
  try {
    let num = "CSL-0";
    let dateTime = await currentDateTime();

    const [rows] = await connection.query(
      "SELECT * FROM csl_mst ORDER BY id desc",
      []
    );

    if (rows.length > 0) {
      num = rows[0].cslNo;
    }
    const split = num.split("-");
    const intVal = parseInt(split[1]) + 1;
    const cslNo = split[0] + "-" + intVal;

    const insertQuery =
      "INSERT INTO csl_mst (cslNo, contractNo, date, status) VALUES (?, ?, ?, ?)";
    const values = [cslNo, contractNo, dateTime, "Pending"];

    const [aRows] = await connection.query(insertQuery, values);

    if (aRows.affectedRows) {
      const insertId = aRows.insertId;
      return insertId;
    }
    throw new CustomError("Something went wrong!", 400);
  } catch (err) {
    //console.log("Error ", err.message);
    throw err;
  }
}

exports.import = async (req, res) => {
  try {
    if (!req.body.file) {
      return res
        .status(400)
        .json({ success: false, message: "No file uploaded" });
    }

    const base64URL =
      "data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,";
    const base64Data = req.body.file.replace(base64URL, "");

    const buffer = Buffer.from(base64Data, "base64");

    const workbook = new excel.Workbook();
    await workbook.xlsx.load(buffer);

    // Initialize an outer array to store sheet contents
    const allSheetContents = [];

    // Loop through each sheet in the workbook
    workbook.eachSheet((worksheet, sheetId) => {
      const sheetContents = [];
      const hdrContractNo = worksheet.getRow(2).getCell(1).text;
      const rowFIM = worksheet.getRow(2).getCell(5).text;
      const FIM = rowFIM.match(/^[^\d]*/)[0];

      worksheet.eachRow((row, rowNumber) => {
        if (rowNumber !== 1) {
          const contractNo = row.getCell(1).value;
          const boxNo = row.getCell(5).value;

          if (!boxNo.startsWith(FIM)) {
            throw new Error(
              `Box number does not start with ${FIM} at row ${boxNo}`
            );
          } else if (hdrContractNo != contractNo) {
            throw new Error(
              `Mismatched Contract no ${contractNo} in sheet with header ${hdrContractNo}`
            );
          }

          const csl = {
            contractNo: contractNo,
            partNo: row.getCell(2).value,
            Qty: row.getCell(3).value,
            desc: row.getCell(4).value,
            boxNo: boxNo,
          };
          sheetContents.push(csl);
        }
      });

      // Store the sheet contents in the outer array with header contract number as key
      allSheetContents.push({
        [hdrContractNo]: sheetContents,
      });
    });

    const result = await insertCSLData(allSheetContents);

    if (result) {
      return res
        .status(200)
        .json({ success: true, message: "Successfully imported" });
    }
    throw new CustomError("Something went wrong!", 400);
  } catch (err) {
    return res
      .status(err.statusCode || 500)
      .json({ success: false, message: err.message });
  }
};

async function insertCSLData(sheetContents) {
  try {
    for (const sheetContent of sheetContents) {
      const contractNo = Object.keys(sheetContent)[0];
      const cslMstId = await masterCsl(contractNo);

      for (const content of sheetContent[contractNo]) {
        await insertCSLDetail(cslMstId, content);
      }
    }
    return true;
  } catch (err) {
    console.error("Error during CSL data insertion:", err.message);
    throw err;
  }
}

async function insertCSLDetail(cslMstId, content) {
  try {
    const { contractNo, partNo, Qty, desc, boxNo } = content;
    const insertQuery =
      "INSERT INTO csl (cslMstId, contractNo, partNo, Qty, description, boxNo) VALUES (?, ?, ?, ?, ?, ?)";
    const values = [cslMstId, contractNo, partNo, Qty, desc, boxNo];

    const [rows] = await connection.query(insertQuery, values);

    if (rows.affectedRows) {
      return true;
    } else {
      throw new CustomError("Failed to insert CSL Detail.", 400);
    }
  } catch (err) {
    console.error("Error during CSL Detail insertion:", err.message);
    throw err;
  }
}

