import { Router } from "express";
import { dispatchDueReminders } from "../lib/reminder-dispatch.js";

/**
 * Manual/ops-trigger endpoint — the primary dispatch path is the in-process
 * setInterval in src/index.ts. This exists for ad-hoc triggering/health
 * checks, guarded by a shared secret (same convention the old Vercel-Cron
 * setup used).
 */
export const cronRouter = Router();

cronRouter.get("/reminders", async (req, res) => {
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  const dispatched = await dispatchDueReminders();
  res.json({ dispatched });
});
