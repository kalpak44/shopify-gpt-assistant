import { useState } from "react";
import { useLoaderData, useActionData, useNavigation, useRouteError, Form, Link } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";
import { authenticate } from "../shopify.server";
import { getOrCreateSubscription, getMonthlyTokenUsage } from "../subscription.server.js";
import { PLAN_DEFS, getPlanModel } from "../plans.js";

// ─── Loader ──────────────────────────────────────────────────────────────────

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const [subscription, usage] = await Promise.all([
    getOrCreateSubscription(shop),
    getMonthlyTokenUsage(shop),
  ]);

  return {
    apiKey: process.env.SHOPIFY_API_KEY || "",
    subscription,
    usage,
  };
};

// ─── Action ──────────────────────────────────────────────────────────────────

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "switch_plan") {
    const plan = formData.get("plan")?.toString();
    if (!["free", "pro", "enterprise"].includes(plan)) {
      return { error: "Invalid plan." };
    }
    const { default: prisma } = await import("../db.server.js");
    await prisma.subscription.upsert({
      where: { shop },
      create: { shop, plan, status: "active", confirmedAt: new Date() },
      update: { plan, status: "active", confirmedAt: new Date() },
    });
    return { success: true, plan };
  }

  return null;
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatTokens(n) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

function UsageBar({ used, limit }) {
  const pct = limit ? Math.min((used / limit) * 100, 100) : 0;
  const isUnlimited = limit === null;
  const isNearLimit = !isUnlimited && pct >= 80;

  return (
    <div>
      <div
        style={{
          height: "8px",
          borderRadius: "4px",
          background: "#e1e3e5",
          overflow: "hidden",
          marginBottom: "6px",
        }}
      >
        {!isUnlimited && (
          <div
            style={{
              height: "100%",
              width: `${pct}%`,
              borderRadius: "4px",
              background: isNearLimit ? "#d72c0d" : "#008060",
              transition: "width 0.3s ease",
            }}
          />
        )}
        {isUnlimited && (
          <div style={{ height: "100%", width: "100%", background: "#008060", borderRadius: "4px" }} />
        )}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px", color: "#6d7175" }}>
        <span>{formatTokens(used)} used</span>
        <span>{isUnlimited ? "Unlimited" : `${formatTokens(limit)} / month`}</span>
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function AssistantSettings() {
  const { apiKey, subscription, usage } = useLoaderData();
  const actionData = useActionData();
  const navigation = useNavigation();
  const isSaving = navigation.state !== "idle";

  const [switchingTo, setSwitchingTo] = useState(null);

  const currentPlan = PLAN_DEFS[subscription.plan] ?? PLAN_DEFS.free;
  const tokenLimit = currentPlan.tokenLimitMonthly;
  const modelName = getPlanModel(subscription.plan);

  // Next billing date placeholder — first of next month
  const nextBilling = new Date();
  nextBilling.setMonth(nextBilling.getMonth() + 1);
  nextBilling.setDate(1);
  const nextBillingStr = nextBilling.toLocaleDateString(undefined, { dateStyle: "medium" });

  return (
    <AppProvider embedded apiKey={apiKey}>
      <div
        style={{
          padding: "32px 40px",
          fontFamily: "Inter, -apple-system, sans-serif",
          color: "#202223",
          maxWidth: "680px",
        }}
      >
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "32px" }}>
          <Link to="/" style={{ fontSize: "13px", color: "#6d7175", textDecoration: "none" }}>
            ← Assistant GPT
          </Link>
          <span style={{ color: "#e1e3e5" }}>|</span>
          <h1 style={{ fontSize: "22px", fontWeight: 600, margin: 0 }}>Settings</h1>
        </div>

        {/* Success / error banners */}
        {actionData?.success && (
          <div style={{ marginBottom: "24px", padding: "12px 16px", background: "#d4edda", border: "1px solid #b8ddc8", borderRadius: "8px", color: "#155724", fontSize: "14px" }}>
            Plan updated to <strong>{PLAN_DEFS[actionData.plan]?.name}</strong>.
          </div>
        )}
        {actionData?.error && (
          <div style={{ marginBottom: "24px", padding: "12px 16px", background: "#ffeef0", border: "1px solid #ffc1cc", borderRadius: "8px", color: "#d72c0d", fontSize: "14px" }}>
            {actionData.error}
          </div>
        )}

        {/* ── Current Plan ── */}
        <section style={{ marginBottom: "32px" }}>
          <h2 style={{ fontSize: "16px", fontWeight: 600, margin: "0 0 16px" }}>Current plan</h2>

          <div
            style={{
              border: "1px solid #e1e3e5",
              borderRadius: "10px",
              padding: "20px",
              background: "#fff",
            }}
          >
            {/* Plan name + badge */}
            <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "4px" }}>
              <span style={{ fontSize: "18px", fontWeight: 700, color: "#202223" }}>
                {currentPlan.name}
              </span>
              <span
                style={{
                  padding: "2px 10px",
                  borderRadius: "12px",
                  fontSize: "11px",
                  fontWeight: 600,
                  background: subscription.status === "active" ? "#e8f5f0" : "#fdf3cd",
                  color: subscription.status === "active" ? "#008060" : "#856404",
                  border: `1px solid ${subscription.status === "active" ? "#95c4b8" : "#f0c040"}`,
                }}
              >
                {subscription.status}
              </span>
            </div>
            <p style={{ margin: "0 0 16px", fontSize: "13px", color: "#6d7175" }}>
              Model: <code style={{ fontFamily: "monospace", fontSize: "12px", color: "#202223" }}>{modelName}</code>
            </p>

            {/* Token usage */}
            <div style={{ marginBottom: "16px" }}>
              <p style={{ margin: "0 0 8px", fontSize: "13px", fontWeight: 500, color: "#202223" }}>
                Token usage this month
              </p>
              <UsageBar used={usage.totalTokens} limit={tokenLimit} />
            </div>

            {/* Billing placeholder */}
            {subscription.plan !== "free" && (
              <div
                style={{
                  padding: "12px 14px",
                  background: "#f6f6f7",
                  borderRadius: "6px",
                  fontSize: "13px",
                  color: "#6d7175",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                }}
              >
                <span>
                  Next billing: <strong style={{ color: "#202223" }}>{nextBillingStr}</strong>
                  &ensp;·&ensp;{currentPlan.price}
                  <span style={{ fontSize: "12px" }}>{currentPlan.priceLabel}</span>
                </span>
                <button
                  disabled
                  title="Payment integration coming soon"
                  style={{
                    padding: "5px 12px",
                    fontSize: "12px",
                    color: "#8c9196",
                    background: "#fff",
                    border: "1px solid #e1e3e5",
                    borderRadius: "6px",
                    cursor: "not-allowed",
                    fontFamily: "inherit",
                  }}
                >
                  Manage billing
                </button>
              </div>
            )}
          </div>
        </section>

        {/* ── Switch Plan ── */}
        <section>
          <h2 style={{ fontSize: "16px", fontWeight: 600, margin: "0 0 16px" }}>Switch plan</h2>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "12px" }}>
            {["free", "pro", "enterprise"].map((planId) => {
              const plan = PLAN_DEFS[planId];
              const isCurrent = planId === subscription.plan;

              return (
                <div
                  key={planId}
                  style={{
                    border: `1px solid ${isCurrent ? "#008060" : "#e1e3e5"}`,
                    borderRadius: "10px",
                    padding: "16px",
                    background: isCurrent ? "#f0faf7" : "#fff",
                    position: "relative",
                  }}
                >
                  {plan.highlight && !isCurrent && (
                    <div
                      style={{
                        position: "absolute",
                        top: "-10px",
                        left: "50%",
                        transform: "translateX(-50%)",
                        padding: "2px 10px",
                        background: "#303030",
                        color: "#fff",
                        borderRadius: "10px",
                        fontSize: "10px",
                        fontWeight: 700,
                        letterSpacing: "0.05em",
                        whiteSpace: "nowrap",
                      }}
                    >
                      RECOMMENDED
                    </div>
                  )}

                  <div style={{ fontSize: "15px", fontWeight: 700, marginBottom: "2px" }}>
                    {plan.name}
                  </div>
                  <div style={{ marginBottom: "12px" }}>
                    <span style={{ fontSize: "20px", fontWeight: 700 }}>{plan.price}</span>
                    <span style={{ fontSize: "12px", color: "#6d7175", marginLeft: "3px" }}>
                      {plan.priceLabel}
                    </span>
                  </div>

                  <ul
                    style={{
                      margin: "0 0 14px",
                      padding: "0 0 0 16px",
                      fontSize: "12px",
                      color: "#6d7175",
                      lineHeight: "1.7",
                    }}
                  >
                    {plan.features.map((f) => (
                      <li key={f}>{f}</li>
                    ))}
                  </ul>

                  {isCurrent ? (
                    <div
                      style={{
                        textAlign: "center",
                        padding: "6px",
                        fontSize: "12px",
                        fontWeight: 600,
                        color: "#008060",
                      }}
                    >
                      ✓ Current plan
                    </div>
                  ) : (
                    <Form method="post" onSubmit={() => setSwitchingTo(planId)}>
                      <input type="hidden" name="intent" value="switch_plan" />
                      <input type="hidden" name="plan" value={planId} />
                      <button
                        type="submit"
                        disabled={isSaving && switchingTo === planId}
                        style={{
                          width: "100%",
                          padding: "7px",
                          fontSize: "12px",
                          fontWeight: 600,
                          color: plan.highlight ? "#fff" : "#202223",
                          background: plan.highlight ? "#303030" : "#f6f6f7",
                          border: `1px solid ${plan.highlight ? "#303030" : "#e1e3e5"}`,
                          borderRadius: "6px",
                          cursor: isSaving && switchingTo === planId ? "not-allowed" : "pointer",
                          fontFamily: "inherit",
                        }}
                      >
                        {isSaving && switchingTo === planId ? "Switching…" : `Select ${plan.name}`}
                      </button>
                    </Form>
                  )}
                </div>
              );
            })}
          </div>

          <p style={{ marginTop: "12px", fontSize: "12px", color: "#8c9196" }}>
            Payment processing coming soon. Plan switches take effect immediately.
          </p>
        </section>
      </div>
    </AppProvider>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};