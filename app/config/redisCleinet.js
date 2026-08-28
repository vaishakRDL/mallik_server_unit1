const redis = require("redis");

const redisClient = redis.createClient({
    socket: {
        host: "127.0.0.1", // NEVER remove this
        port: 6379,
        family: 4          // <--- FORCE IPv4
    }
});

redisClient.on('error', err => {
    console.error("Redis connection error:", err);
});

(async () => {
    await redisClient.connect();
    console.log("Connected to Redis!");
})();

module.exports = redisClient;
