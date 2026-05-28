import prisma from "./db.server.js";

/** Get existing subscription or auto-provision free tier for new shops. */
export async function getOrCreateSubscription(shop) {
  return prisma.subscription.upsert({
    where: { shop },
    create: { shop, plan: "free", status: "active" },
    update: {},
  });
}

/** Sum tokens consumed by this shop in the current calendar month. */
export async function getMonthlyTokenUsage(shop) {
  const start = new Date();
  start.setDate(1);
  start.setHours(0, 0, 0, 0);

  const result = await prisma.tokenUsage.aggregate({
    where: { shop, createdAt: { gte: start } },
    _sum: { totalTokens: true, promptTokens: true, completionTokens: true },
  });

  return {
    totalTokens: result._sum.totalTokens ?? 0,
    promptTokens: result._sum.promptTokens ?? 0,
    completionTokens: result._sum.completionTokens ?? 0,
  };
}