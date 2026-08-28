const EVENTS = require("./socket.events");

module.exports = (io) => {
    const erp = io.of("/erp");

    erp.on("connection", (socket) => {
        // console.log("ERP user connected:", socket.id);

        socket.on("disconnect", () => {
            // console.log("ERP user disconnected:", socket.id);
        });
    });

    // expose emit helpers
    erp.emitModuleLockUpdate = (payload) => {
        erp.emit(EVENTS.MODULE_LOCK_UPDATED, payload);
    };
};
