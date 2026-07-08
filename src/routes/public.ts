import { Router } from "express";
import { prisma } from "../lib/prisma.js";

/**
 * Unauthenticated routes — no requireAuth here. Currently just the public
 * task-share lookup (mirrors the frontend's old direct-Prisma share page,
 * now proxied through here since the frontend has no DB access anymore).
 */
export const publicRouter = Router();

publicRouter.get("/tasks/share/:token", async (req, res) => {
  const task = await prisma.task.findUnique({
    where: { shareToken: req.params.token },
    select: {
      title: true,
      description: true,
      status: true,
      priority: true,
      dueDate: true,
      user: { select: { name: true } },
    },
  });
  if (!task) return res.status(404).json({ error: "Not found" });
  res.json({ task });
});
