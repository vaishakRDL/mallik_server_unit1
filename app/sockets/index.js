const { Server } = require("socket.io");
const registerErpNamespace = require("./erp.namespace");

let io;

const initSocket = (httpServer) => {
    io = new Server(httpServer, {
        cors: {
            origin: "*", // restrict in prod
            methods: ["GET", "POST"]
        }
    });

    registerErpNamespace(io);
    return io;
};

const getIO = () => {
    if (!io) throw new Error("Socket.io not initialized");
    return io;
};

const logActiveConnections = () => {
    const io = getIO();
    const nsp = io.of("/erp");

    return nsp.sockets.size;
};

module.exports = { initSocket, getIO, logActiveConnections };