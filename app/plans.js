// Plan definitions — single source of truth for models, limits, and pricing.
// Models are attached to plans; actual routing happens in ai.server.js via OPENAI_* env vars.

export const PLAN_DEFS = {
  free: {
    id: "free",
    name: "Free",
    price: "$0",
    priceLabel: "forever",
    model: "gpt-4o",            // will become gpt-4.1-mini once available
    tokenLimitMonthly: 50_000,
    highlight: false,
    features: [
      "GPT-4o model",
      "50,000 tokens / month",
      "Theme management",
      "Product & order tools",
      "Community support",
    ],
  },
  pro: {
    id: "pro",
    name: "Pro",
    price: "$29",
    priceLabel: "/ month",
    model: "gpt-4.1",
    tokenLimitMonthly: 1_000_000,
    highlight: true,            // recommended badge
    features: [
      "GPT-4.1 model",
      "1,000,000 tokens / month",
      "Everything in Free",
      "Advanced analytics tools",
      "Priority support",
    ],
  },
  enterprise: {
    id: "enterprise",
    name: "Enterprise",
    price: "$299",
    priceLabel: "/ month",
    primaryModel: "gpt-4.1",
    models: ["o3", "gpt-4.1"],
    tokenLimitMonthly: null,    // unlimited
    highlight: false,
    features: [
      "o3 + GPT-4.1 models",
      "Unlimited tokens",
      "Everything in Pro",
      "Custom integrations",
      "Dedicated support",
      "SLA guarantee",
    ],
  },
};

export const PLAN_IDS = ["free", "pro", "enterprise"];

/** Returns the primary model ID for a given plan. */
export function getPlanModel(planId) {
  const plan = PLAN_DEFS[planId] ?? PLAN_DEFS.free;
  return plan.model ?? plan.primaryModel ?? "gpt-4o";
}