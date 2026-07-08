import { Router } from "express";
import { randomUUID } from "crypto";
import { addDays, addWeeks, addMonths, addYears } from "date-fns";
import { z } from "zod";
import type { RecurrenceInterval } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { requireAuth } from "../middleware/auth.js";

export const tasksRouter = Router();
tasksRouter.use(requireAuth);

const createTaskSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).optional(),
  dueDate: z.string().datetime().optional(),
  parentId: z.string().optional(),
  recurrenceInterval: z.enum(["DAILY", "WEEKLY", "MONTHLY", "YEARLY"]).optional(),
});

tasksRouter.get("/", async (req, res) => {
  const tasks = await prisma.task.findMany({
    where: { userId: req.userId! },
    orderBy: [{ status: "asc" }, { dueDate: "asc" }, { createdAt: "desc" }],
  });
  res.json({ tasks });
});

tasksRouter.post("/", async (req, res) => {
  const parsed = createTaskSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  if (parsed.data.parentId) {
    const parent = await prisma.task.findFirst({
      where: { id: parsed.data.parentId, userId: req.userId! },
    });
    if (!parent) return res.status(404).json({ error: "Parent task not found" });
    if (parent.parentId) {
      return res.status(400).json({ error: "Subtasks can only be one level deep" });
    }
  }

  const task = await prisma.task.create({
    data: {
      userId: req.userId!,
      title: parsed.data.title,
      description: parsed.data.description,
      priority: parsed.data.priority ?? "MEDIUM",
      dueDate: parsed.data.dueDate ? new Date(parsed.data.dueDate) : undefined,
      parentId: parsed.data.parentId,
      recurrenceInterval: parsed.data.recurrenceInterval,
    },
  });
  res.status(201).json({ task });
});

const updateTaskSchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().optional(),
  status: z.enum(["PENDING", "IN_PROGRESS", "DONE", "CANCELLED"]).optional(),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).optional(),
  dueDate: z.string().datetime().nullable().optional(),
  recurrenceInterval: z.enum(["DAILY", "WEEKLY", "MONTHLY", "YEARLY"]).nullable().optional(),
});

function nextDueDate(from: Date, interval: RecurrenceInterval): Date {
  switch (interval) {
    case "DAILY":
      return addDays(from, 1);
    case "WEEKLY":
      return addWeeks(from, 1);
    case "MONTHLY":
      return addMonths(from, 1);
    case "YEARLY":
      return addYears(from, 1);
  }
}

// Spawns the next occurrence the moment a recurring task is marked DONE —
// anchored off the task's own dueDate (not now()) to avoid schedule drift,
// and guarded against duplicate spawning under a rapid double-PATCH.
async function maybeSpawnNextOccurrence(task: {
  id: string;
  userId: string;
  title: string;
  description: string | null;
  priority: "LOW" | "MEDIUM" | "HIGH" | "URGENT";
  dueDate: Date | null;
  recurrenceInterval: RecurrenceInterval | null;
  recurrenceParentId: string | null;
}) {
  if (!task.recurrenceInterval || !task.dueDate) return;

  const seriesRootId = task.recurrenceParentId ?? task.id;
  const due = nextDueDate(task.dueDate, task.recurrenceInterval);

  const alreadyExists = await prisma.task.findFirst({
    where: {
      OR: [{ id: seriesRootId }, { recurrenceParentId: seriesRootId }],
      dueDate: due,
    },
  });
  if (alreadyExists) return;

  await prisma.task.create({
    data: {
      userId: task.userId,
      title: task.title,
      description: task.description,
      priority: task.priority,
      status: "PENDING",
      dueDate: due,
      recurrenceInterval: task.recurrenceInterval,
      recurrenceParentId: seriesRootId,
    },
  });
}

tasksRouter.patch("/:id", async (req, res) => {
  const { id } = req.params;
  const existing = await prisma.task.findFirst({ where: { id, userId: req.userId! } });
  if (!existing) return res.status(404).json({ error: "Not found" });

  const parsed = updateTaskSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const task = await prisma.task.update({
    where: { id },
    data: {
      ...parsed.data,
      dueDate: parsed.data.dueDate === undefined ? undefined : parsed.data.dueDate ? new Date(parsed.data.dueDate) : null,
    },
  });

  if (parsed.data.status === "DONE" && existing.status !== "DONE") {
    await maybeSpawnNextOccurrence(task);
  }

  res.json({ task });
});

tasksRouter.delete("/:id", async (req, res) => {
  const { id } = req.params;
  const existing = await prisma.task.findFirst({ where: { id, userId: req.userId! } });
  if (!existing) return res.status(404).json({ error: "Not found" });

  await prisma.task.delete({ where: { id } });
  res.json({ ok: true });
});

tasksRouter.post("/:id/share", async (req, res) => {
  const { id } = req.params;
  const existing = await prisma.task.findFirst({ where: { id, userId: req.userId! } });
  if (!existing) return res.status(404).json({ error: "Not found" });

  const task = await prisma.task.update({
    where: { id },
    data: { shareToken: existing.shareToken ?? randomUUID(), sharedAt: new Date() },
  });
  res.json({ shareToken: task.shareToken });
});

tasksRouter.delete("/:id/share", async (req, res) => {
  const { id } = req.params;
  const existing = await prisma.task.findFirst({ where: { id, userId: req.userId! } });
  if (!existing) return res.status(404).json({ error: "Not found" });

  await prisma.task.update({ where: { id }, data: { shareToken: null, sharedAt: null } });
  res.json({ ok: true });
});
