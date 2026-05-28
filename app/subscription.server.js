import prisma from "./db.server.js";
import { BILLING_PLAN_PRO, BILLING_PLAN_ENTERPRISE } from "./shopify.server.js";

const SHOPIFY_PLAN_TO_ID = {
  [BILLING_PLAN_PRO]: "pro",
  [BILLING_PLAN_ENTERPRISE]: "enterprise",
};

/** Get existing subscription or auto-provision free tier for new shops. */
export async function getOrCreateSubscription(shop) {
  return prisma.subscription.upsert({
    where: { shop },
    create: { shop, plan: "free", status: "active" },
    update: {},
  });
}

/**
 * Sync local DB from the appSubscriptions returned by billing.check().
 * Call this after a billing confirmation or cancellation.
 */
export async function syncBillingToDb(shop, appSubscriptions) {
  if (!appSubscriptions?.length) {
    await prisma.subscription.upsert({
      where: { shop },
      create: { shop, plan: "free", status: "active", confirmedAt: new Date() },
      update: { plan: "free", status: "cancelled" },
    });
    return;
  }

  const shopifySub = appSubscriptions[0];
  const plan = SHOPIFY_PLAN_TO_ID[shopifySub.name] ?? "free";

  await prisma.subscription.upsert({
    where: { shop },
    create: { shop, plan, status: "active", confirmedAt: new Date() },
    update: { plan, status: "active", confirmedAt: new Date() },
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