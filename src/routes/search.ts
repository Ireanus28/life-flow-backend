import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { requireAuth } from "../middleware/auth.js";

export const searchRouter = Router();
searchRouter.use(requireAuth);

searchRouter.get("/", async (req, res) => {
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  if (!q) return res.json({ tasks: [], memories: [], messages: [] });

  const userId = req.userId!;
  const [tasks, memories, messages] = await Promise.all([
    prisma.task.findMany({
      where: {
        userId,
        OR: [
          { title: { contains: q, mode: "insensitive" } },
          { description: { contains: q, mode: "insensitive" } },
        ],
      },
      select: { id: true, title: true, status: true },
      take: 5,
    }),
    prisma.memory.findMany({
      where: { userId, content: { contains: q, mode: "insensitive" } },
      select: { id: true, content: true, category: true },
      take: 5,
    }),
    prisma.message.findMany({
      where: { conversation: { userId }, content: { contains: q, mode: "insensitive" } },
      select: { id: true, content: true, conversationId: true, role: true },
      take: 5,
    }),
  ]);

  res.json({ tasks, memories, messages });
});
