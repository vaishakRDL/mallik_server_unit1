const pino = require("pino");

const isProd = process.env.NODE_ENV === "production";

function createLogger() {
  // COMMON Pino base settings
  const baseLoggerConfig = {
    level: isProd ? "info" : "debug",
    base: null,               // removes pid & hostname (clean logs)
    timestamp: pino.stdTimeFunctions.isoTime, // ISO timestamps
  };

  // ------------------ DEVELOPMENT ------------------
  if (!isProd) {
    return pino(
      baseLoggerConfig,
      pino.transport({
        targets: [
          {
            target: "pino-pretty",
            level: "debug",
            options: {
              colorize: true,
              translateTime: "yyyy-mm-dd HH:MM:ss",
              ignore: "pid,hostname",
            },
          },
        ],
      })
    );
  }

  // ------------------ PRODUCTION -------------------
  return pino(
    baseLoggerConfig,
    pino.transport({
      targets: [
        // Error logs
        {
          target: "pino/file",
          level: "error",
          options: {
            destination: "error.log",
            mkdir: true,
          },
        },
      ],
    })
  );
}

module.exports = createLogger();
