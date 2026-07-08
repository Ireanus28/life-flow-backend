import "dotenv/config";
import express from "express";
import cors from "cors";
import { authRouter } from "./routes/auth.js";
import { tasksRouter } from "./routes/tasks.js";
import { remindersRouter } from "./routes/reminders.js";
import { memoriesRouter } from "./routes/memories.js";
import { searchRouter } from "./routes/search.js";
import { settingsRouter } from "./routes/settings.js";
import { pushRouter } from "./routes/push.js";
import { calendlyRouter } from "./routes/calendly.js";
import { chatRouter } from "./routes/chat.js";
import { cronRouter } from "./routes/cron.js";
import { publicRouter } from "./routes/public.js";
import { dispatchDueReminders } from "./lib/reminder-dispatch.js";

const app = express();

app.use(cors({ origin: process.env.FRONTEND_URL, credentials: true }));
app.use(express.json());

app.get("/health", (_req, res) => res.json({ ok: true }));

app.use("/api/auth", authRouter);
app.use("/api/tasks", tasksRouter);
app.use("/api/reminders", remindersRouter);
app.use("/api/memories", memoriesRouter);
app.use("/api/search", searchRouter);
app.use("/api/settings", settingsRouter);
app.use("/api/push", pushRouter);
app.use("/api/calendly", calendlyRouter);
app.use("/api/chat", chatRouter);
app.use("/api/cron", cronRouter);
app.use("/api/public", publicRouter);

const PORT = Number(process.env.PORT) || 4000;
app.listen(PORT, () => {
  console.log(`LifeFlow backend listening on :${PORT}`);
});

// Persistent-server deploy target (ECS/Container Service) means the
// reminder dispatch can just live in-process — no external scheduler needed.
const RECURRING_DISPATCH_INTERVAL_MS = 5 * 60 * 1000;
setInterval(() => {
  dispatchDueReminders()
    .then((count) => {
      if (count > 0) console.log(`Dispatched ${count} due reminder(s)`);
    })
    .catch((err) => console.error("Reminder dispatch failed:", err));
}, RECURRING_DISPATCH_INTERVAL_MS);
