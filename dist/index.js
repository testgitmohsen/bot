import express from "express";
import { bot } from "./bot.js";
import { config } from "./config.js";
import { prisma } from "./db.js";
const app = express();
app.get("/health", (_req, res) => {
    res.json({ ok: true });
});
const server = app.listen(config.port, () => {
    console.log(`Express server is running on port ${config.port}`);
});
await bot.launch();
console.log("Telegram bot is running.");
const shutdown = async (signal) => {
    console.log(`Received ${signal}. Shutting down...`);
    bot.stop(signal);
    server.close();
    await prisma.$disconnect();
    process.exit(0);
};
process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));
