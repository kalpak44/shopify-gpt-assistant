import { useLoaderData, useRouteError, useFetcher, Link } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
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
    debugEnabled: subscription.debugEnabled,
  };
};

// ─── Action ──────────────────────────────────────────────────────────────────

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "toggle_debug") {
    const enabled = formData.get("debugEnabled") === "true";
    await prisma.subscription.update({
      where: { shop },
      data: { debugEnabled: enabled },
    });
    return { ok: true };
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
  const isUnlimited = limit === null;
  const pct = isUnlimited ? 100 : Math.min((used / limit) * 100, 100);
  const isNearLimit = !isUnlimited && pct >= 80;

  return (
    <div>
      <div style={{ height: "8px", borderRadius: "4px", background: "#e1e3e5", overflow: "hidden", marginBottom: "6px" }}>
        <div
          style={{
            height: "100%",
            width: `${pct}%`,
            borderRadius: "4px",
            background: isNearLimit ? "#d72c0d" : "#008060",
            transition: "width 0.3s ease",
          }}
        />
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
  const { apiKey, subscription, usage, debugEnabled } = useLoaderData();
  const debugFetcher = useFetcher();

  const currentPlan = PLAN_DEFS[subscription.plan] ?? PLAN_DEFS.free;
  const tokenLimit = currentPlan.tokenLimitMonthly;
  const modelName = getPlanModel(subscription.plan);

  const nextBilling = new Date();
  nextBilling.setMonth(nextBilling.getMonth() + 1);
  nextBilling.setDate(1);
  const nextBillingStr = nextBilling.toLocaleDateString(undefined, { dateStyle: "medium" });

  return (
    <AppProvider embedded apiKey={apiKey}>
      <div style={{ padding: "32px 40px", fontFamily: "Inter, -apple-system, sans-serif", color: "#202223", maxWidth: "600px" }}>

        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "32px" }}>
          <Link to="/" style={{ fontSize: "13px", color: "#6d7175", textDecoration: "none" }}>
            ← Assistant GPT
          </Link>
          <span style={{ color: "#e1e3e5" }}>|</span>
          <h1 style={{ fontSize: "22px", fontWeight: 600, margin: 0 }}>Settings</h1>
        </div>

        {/* ── AI Permissions link ── */}
        <section style={{ marginBottom: "28px" }}>
          <h2 style={{ fontSize: "11px", fontWeight: 600, margin: "0 0 14px", color: "#6d7175", textTransform: "uppercase", letterSpacing: "0.04em" }}>
            AI Access
          </h2>
          <div style={{ border: "1px solid #e1e3e5", borderRadius: "10px", background: "#fff", overflow: "hidden" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 20px" }}>
              <div>
                <div style={{ fontSize: "14px", fontWeight: 500, marginBottom: "2px" }}>Shopify permissions</div>
                <div style={{ fontSize: "12px", color: "#6d7175" }}>
                  Choose which Shopify resources the AI assistant is allowed to manage
                </div>
              </div>
              <Link
                to="/assistant/permissions"
                style={{
                  padding: "6px 14px",
                  fontSize: "13px",
                  fontWeight: 500,
                  color: "#303030",
                  background: "#f6f6f7",
                  border: "1px solid #e1e3e5",
                  borderRadius: "6px",
                  textDecoration: "none",
                }}
              >
                Manage →
              </Link>
            </div>
          </div>
        </section>

        {/* ── Debug ── */}
        <section style={{ marginBottom: "28px" }}>
          <h2 style={{ fontSize: "11px", fontWeight: 600, margin: "0 0 14px", color: "#6d7175", textTransform: "uppercase", letterSpacing: "0.04em" }}>
            Developer
          </h2>
          <div style={{ border: "1px solid #e1e3e5", borderRadius: "10px", background: "#fff", overflow: "hidden" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 20px" }}>
              <div>
                <div style={{ fontSize: "14px", fontWeight: 500, marginBottom: "2px" }}>Debug mode</div>
                <div style={{ fontSize: "12px", color: "#6d7175" }}>
                  Stream tool calls and GraphQL events to the in-app debug panel and server console
                </div>
              </div>
              <debugFetcher.Form method="post">
                <input type="hidden" name="intent" value="toggle_debug" />
                <input type="hidden" name="debugEnabled" value={String(!(debugFetcher.formData ? debugFetcher.formData.get("debugEnabled") === "true" : debugEnabled))} />
                <button
                  type="submit"
                  style={{
                    position: "relative",
                    display: "inline-flex",
                    width: "44px",
                    height: "24px",
                    borderRadius: "12px",
                    border: "none",
                    cursor: "pointer",
                    background: (debugFetcher.formData ? debugFetcher.formData.get("debugEnabled") === "true" : debugEnabled) ? "#008060" : "#c9cccf",
                    transition: "background 0.2s",
                    padding: 0,
                    flexShrink: 0,
                  }}
                  aria-label="Toggle debug mode"
                >
                  <span
                    style={{
                      position: "absolute",
                      top: "3px",
                      left: (debugFetcher.formData ? debugFetcher.formData.get("debugEnabled") === "true" : debugEnabled) ? "23px" : "3px",
                      width: "18px",
                      height: "18px",
                      borderRadius: "50%",
                      background: "#fff",
                      transition: "left 0.2s",
                    }}
                  />
                </button>
              </debugFetcher.Form>
            </div>
          </div>
        </section>

        {/* ── Subscription ── */}
        <section style={{ marginBottom: "28px" }}>
          <h2 style={{ fontSize: "15px", fontWeight: 600, margin: "0 0 14px", color: "#6d7175", textTransform: "uppercase", letterSpacing: "0.04em", fontSize: "11px" }}>
            Subscription
          </h2>

          <div style={{ border: "1px solid #e1e3e5", borderRadius: "10px", background: "#fff", overflow: "hidden" }}>
            {/* Plan row */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 20px", borderBottom: "1px solid #f1f1f1" }}>
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "2px" }}>
                  <span style={{ fontSize: "16px", fontWeight: 700 }}>{currentPlan.name}</span>
                  <span
                    style={{
                      padding: "1px 8px",
                      borderRadius: "10px",
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
                <span style={{ fontSize: "12px", color: "#6d7175" }}>
                  Model: <code style={{ fontFamily: "monospace", color: "#202223" }}>{modelName}</code>
                  &ensp;·&ensp;{currentPlan.price}<span style={{ fontSize: "11px" }}>{currentPlan.priceLabel}</span>
                </span>
              </div>
              <Link
                to="/assistant/plans"
                style={{
                  padding: "6px 14px",
                  fontSize: "13px",
                  fontWeight: 500,
                  color: "#303030",
                  background: "#f6f6f7",
                  border: "1px solid #e1e3e5",
                  borderRadius: "6px",
                  textDecoration: "none",
                }}
              >
                Change plan
              </Link>
            </div>

            {/* Token usage row */}
            <div style={{ padding: "16px 20px", borderBottom: subscription.plan !== "free" ? "1px solid #f1f1f1" : "none" }}>
              <p style={{ margin: "0 0 10px", fontSize: "13px", fontWeight: 500 }}>Token usage this month</p>
              <UsageBar used={usage.totalTokens} limit={tokenLimit} />
            </div>

            {/* Billing row - paid plans only */}
            {subscription.plan !== "free" && (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 20px", background: "#fafbfc" }}>
                <span style={{ fontSize: "13px", color: "#6d7175" }}>
                  Next billing: <strong style={{ color: "#202223" }}>{nextBillingStr}</strong>
                </span>
                <Link
                  to="/assistant/plans"
                  style={{
                    padding: "5px 12px",
                    fontSize: "12px",
                    fontWeight: 500,
                    color: "#303030",
                    background: "#fff",
                    border: "1px solid #e1e3e5",
                    borderRadius: "6px",
                    textDecoration: "none",
                  }}
                >
                  Manage billing
                </Link>
              </div>
            )}
          </div>
        </section>

      </div>
    </AppProvider>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers = (headersArgs) => boundary.headers(headersArgs);