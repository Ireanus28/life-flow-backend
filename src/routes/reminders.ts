import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireAuth } from "../middleware/auth.js";

export const remindersRouter = Router();
remindersRouter.use(requireAuth);

const createReminderSchema = z.object({
  title: z.string().min(1),
  remindAt: z.string().datetime(),
  channel: z.enum(["IN_APP", "EMAIL", "SMS", "PUSH"]).optional(),
  taskId: z.string().optional(),
});

remindersRouter.get("/", async (req, res) => {
  const reminders = await prisma.reminder.findMany({
    where: { userId: req.userId! },
    orderBy: { remindAt: "asc" },
  });
  res.json({ reminders });
});

remindersRouter.post("/", async (req, res) => {
  const parsed = createReminderSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const reminder = await prisma.reminder.create({
    data: {
      userId: req.userId!,
      title: parsed.data.title,
      remindAt: new Date(parsed.data.remindAt),
      channel: parsed.data.channel ?? "IN_APP",
      taskId: parsed.data.taskId,
    },
  });
  res.status(201).json({ reminder });
});

remindersRouter.delete("/:id", async (req, res) => {
  const { id } = req.params;
  const existing = await prisma.reminder.findFirst({ where: { id, userId: req.userId! } });
  if (!existing) return res.status(404).json({ error: "Not found" });

  await prisma.reminder.delete({ where: { id } });
  res.json({ ok: true });
});
