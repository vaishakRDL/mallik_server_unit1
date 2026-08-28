const { secondaryDB, CustomError } = require('../config/dbSql');


exports.Showmachines = async (req, res) => {
    try {
        const fetchQuery = `
            SELECT id,machine_tag as machineName from machines 
        `;
        
      
        const [results] = await secondaryDB.execute(fetchQuery);
        
        if (results.length > 0) {
            return res.status(200).json({
                success: true,
                message: "Machine lists",
                data: results
            });
        } 
    } catch (err) {
        return res.status(err.statusCode || 500).json({ 
            success: false, 
            message: err.message || 'An error occurred' 
        });
    }
};



exports.Showdowntimereasons = async (req, res) => {
    try {
        const fetchQuery = `
            SELECT id,parameterName from oee_parameters `;
        
        
        const [results] = await secondaryDB.execute(fetchQuery);
        
        if (results.length > 0) {
            return res.status(200).json({
                success: true,
                message: "Reasons lists",
                data: results
            });
        } 
    } catch (err) {
        return res.status(err.statusCode || 500).json({ 
            success: false, 
            message: err.message || 'An error occurred' 
        });
    }
};


exports.submit = async (req, res) => {
    try {
        const fetchQuery = `
        SELECT 
        oee.machineId, 
        m.machine_name AS machineName,
        p.parameterName AS downtimeReasons,
  
    FROM 
        oee_shift_data oee
    INNER JOIN 
        machines m ON oee.machineId = m.id
    INNER JOIN 
        downtime d ON oee.machineId = d.machineId
    INNER JOIN 
        oee_parameters p ON d.oeeParaReasonId = p.id
    WHERE 
         oee.machineId = ?
         AND  d.oeeParaReasonId = ?
    GROUP BY 
        oee.machineId, 
        m.machine_name, 
        p.parameterName,
        d.oeeParaReasonId

        `;
        
        
        const [results] = await secondaryDB.execute(fetchQuery);
        
        if (results.length > 0) {
            return res.status(200).json({
                success: true,
                message: "Reasons lists",
                data: results
            });
        } 
    } catch (err) {
        return res.status(err.statusCode || 500).json({ 
            success: false, 
            message: err.message || 'An error occurred' 
        });
    }
};



exports.submit = async (req, res) => {
    const { machineId,oeeParaReasonId} = req.body;
  
    if (!machineId || !oeeParaReasonId) {
      return res.status(400).json({ success: false, message: 'oeeParaReasonId and machineId are required.' });
    }
  
    try {
      const query = `
              SELECT 
                  oee.machineId, 
                  m.machine_name AS machineName,
                  p.parameterName AS downtimeReasons,
                  d.startDateTime, d.endDateTime
              FROM 
                  oee_shift_data oee
              INNER JOIN 
                  machines m ON oee.machineId = m.id
              INNER JOIN 
                  downtime d ON oee.machineId = d.machineId
              INNER JOIN 
                  oee_parameters p ON d.oeeParaReasonId = p.id
              WHERE 
              d.oeeParaReasonId = ?
                  AND oee.machineId = ?
              GROUP BY 
                  oee.machineId, 
                  m.machine_name, 
                  p.parameterName,
                  d.oeeParaReasonId
      
          `;
  
      const [rows] = await connection.execute(query, [ machineId,oeeParaReasonId]);
  
      const results = rows.map(row => {
        const startDateTime = new Date(row.startDateTime);
        const endDateTime = new Date(row.endDateTime);
  
        const differenceInMilliseconds = endDateTime - startDateTime;
        const downTimeDuration = parseFloat((differenceInMilliseconds / 1000 / 60).toFixed(2));
  
        return {
          ...row,
          downTimeDuration
        };
      })
  
     
  
      return res.status(200).json({ success: true, data: downTimeDuration });
    } catch (err) {
      console.error("Error: ", err); 
      return res.status(err.statusCode || 500).json({ success: false, message: err.message || 'An error occurred' });
    }
  };
