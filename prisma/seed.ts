import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const passwordHash = await bcrypt.hash("demo1234", 10);

  const user = await prisma.user.upsert({
    where: { email: "demo@lifeflow.app" },
    update: {},
    create: {
      email: "demo@lifeflow.app",
      name: "Demo User",
      passwordHash,
      primaryMode: "PROFESSIONAL",
    },
  });

  await prisma.task.createMany({
    data: [
      { userId: user.id, title: "Review Q3 roadmap", priority: "HIGH" },
      { userId: user.id, title: "Book dentist appointment", priority: "MEDIUM" },
      { userId: user.id, title: "Send investor update", priority: "URGENT" },
    ],
    skipDuplicates: true,
  });

  await prisma.memory.createMany({
    data: [
      { userId: user.id, content: "Prefers afternoon meetings", category: "PREFERENCE" },
      { userId: user.id, content: "Works as a Senior Product Manager", category: "FACT" },
    ],
  });

  console.log(`Seeded demo user: ${user.email} / demo1234`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
