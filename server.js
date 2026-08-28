const express = require("express");
require("dotenv").config();
const cors = require("cors");
const path = require("path");
const compression = require("compression");
const http = require("http");

const { initSocket } = require("./app/sockets");
const { loadModuleLocksFromDB } = require("./app/utility/moduleLockCache");

require("./app/config/redisCleinet");

async function createApp() {
    const app = express();

    app.use(cors());
    app.use(compression());
    app.use(express.json({ limit: "500mb" }));
    app.use(express.urlencoded({ extended: true, limit: "500mb" }));
    app.use(express.static(path.join(process.cwd(), "public")));

    require("./app/service/mainRoutes")(app);

    return app;
}

async function start() {
    try {
        await loadModuleLocksFromDB();

        const app = await createApp();

        // 👇 CREATE HTTP SERVER (CRITICAL)
        const server = http.createServer(app);

        // 👇 INITIALIZE SOCKET.IO
        initSocket(server);

        server.listen(process.env.APP_PORT, process.env.APP_HOST, () => {
            console.log(
                `Server running at http://${process.env.APP_HOST}:${process.env.APP_PORT}`
            );
        });
    } catch (err) {
        console.error("Server failed to start:", err);
        process.exit(1);
    }
}

start();