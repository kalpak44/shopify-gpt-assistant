import { useState } from "react";
import { redirect, useLoaderData, useActionData, useNavigation, useRouteError, Form, Link } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";
import { authenticate, BILLING_PLAN_PRO, BILLING_PLAN_ENTERPRISE } from "../shopify.server";
import prisma from "../db.server";
import { getOrCreateSubscription } from "../subscription.server.js";
import { PLAN_DEFS, getPlanModel } from "../plans.js";

const IS_TEST = process.env.NODE_ENV !== "production";

// ─── Loader ──────────────────────────────────────────────────────────────────

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const subscription = await getOrCreateSubscription(session.shop);
  return {
    apiKey: process.env.SHOPIFY_API_KEY || "",
    currentPlan: subscription.plan ?? "free",
    isOnboarding: !subscription.confirmedAt,
  };
};

// ─── Action ──────────────────────────────────────────────────────────────────

export const action = async ({ request }) => {
  const { session, billing } = await authenticate.admin(request);
  const shop = session.shop;
  const formData = await request.formData();
  const plan = formData.get("plan")?.toString();

  if (!["free", "pro", "enterprise"].includes(plan)) {
    return { error: "Invalid plan." };
  }

  if (plan === "free") {
    // Cancel any active Shopify paid subscription
    const { appSubscriptions } = await billing.check({
      plans: [BILLING_PLAN_PRO, BILLING_PLAN_ENTERPRISE],
      isTest: IS_TEST,
    });
    for (const sub of appSubscriptions) {
      await billing.cancel({ subscriptionId: sub.id, prorate: true, isTest: IS_TEST });
    }
    await prisma.subscription.upsert({
      where: { shop },
      create: { shop, plan: "free", status: "active", confirmedAt: new Date() },
      update: { plan: "free", status: "active", confirmedAt: new Date() },
    });
    throw redirect("/");
  }

  // Paid plans — redirect to Shopify billing confirmation page
  const billingPlan = plan === "pro" ? BILLING_PLAN_PRO : BILLING_PLAN_ENTERPRISE;
  const appUrl = (process.env.SHOPIFY_APP_URL || "").replace(/\/$/, "");
  const returnUrl = `${appUrl}/assistant/billing/confirm`;
  try {
    await billing.request({ plan: billingPlan, isTest: IS_TEST, returnUrl });
  } catch (err) {
    if (err instanceof Response) throw err; // billing.request redirects via thrown Response
    const detail = err?.errorData ? JSON.stringify(err.errorData) : err?.message;
    console.error("[billing] request failed:", detail);
    return { error: `Billing error: ${detail ?? "unknown"}` };
  }
};

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function AssistantPlans() {
  const { apiKey, currentPlan, isOnboarding } = useLoaderData();
  const actionData = useActionData();
  const navigation = useNavigation();
  const error = actionData?.error;
  const [selected, setSelected] = useState(currentPlan);
  const submitting = navigation.state === "submitting";

  const plan = PLAN_DEFS[selected];

  return (
    <AppProvider embedded apiKey={apiKey}>
      <div
        style={{
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: "40px 24px",
          fontFamily: "Inter, -apple-system, sans-serif",
          background: "#f6f6f7",
          color: "#202223",
        }}
      >
        {/* Back link — only shown when already onboarded (editing plan) */}
        {!isOnboarding && (
          <div style={{ position: "absolute", top: "24px", left: "32px" }}>
            <Link to="/" style={{ fontSize: "13px", color: "#6d7175", textDecoration: "none" }}>
              ← Back
            </Link>
          </div>
        )}

        <h1 style={{ margin: "0 0 6px", fontSize: "24px", fontWeight: 700 }}>
          {isOnboarding ? "Choose your plan" : "Change plan"}
        </h1>
        <p style={{ margin: "0 0 36px", fontSize: "14px", color: "#6d7175", textAlign: "center" }}>
          {isOnboarding
            ? "Select a plan below, then confirm to get started. You can switch at any time."
            : "Select a new plan. Changes take effect immediately."}
        </p>

        {/* ── Plan cards ── */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, 280px)",
            gap: "16px",
            marginBottom: "32px",
          }}
        >
          {["free", "pro", "enterprise"].map((planId) => {
            const p = PLAN_DEFS[planId];
            const isSelected = selected === planId;

            return (
              <button
                key={planId}
                type="button"
                onClick={() => setSelected(planId)}
                style={{
                  textAlign: "left",
                  padding: "24px",
                  border: `2px solid ${isSelected ? "#008060" : "#e1e3e5"}`,
                  borderRadius: "12px",
                  background: isSelected ? "#f0faf7" : "#fff",
                  cursor: "pointer",
                  fontFamily: "inherit",
                  position: "relative",
                  transition: "border-color 0.15s, background 0.15s",
                  boxShadow: isSelected ? "0 0 0 3px rgba(0,128,96,0.12)" : "none",
                }}
              >
                {p.highlight && (
                  <div
                    style={{
                      position: "absolute",
                      top: "-11px",
                      left: "50%",
                      transform: "translateX(-50%)",
                      padding: "2px 12px",
                      background: "#303030",
                      color: "#fff",
                      borderRadius: "10px",
                      fontSize: "10px",
                      fontWeight: 700,
                      letterSpacing: "0.06em",
                      whiteSpace: "nowrap",
                    }}
                  >
                    RECOMMENDED
                  </div>
                )}

                {/* Radio indicator */}
                <div
                  style={{
                    position: "absolute",
                    top: "16px",
                    right: "16px",
                    width: "18px",
                    height: "18px",
                    borderRadius: "50%",
                    border: `2px solid ${isSelected ? "#008060" : "#c9cccf"}`,
                    background: isSelected ? "#008060" : "#fff",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                    transition: "all 0.15s",
                  }}
                >
                  {isSelected && (
                    <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
                      <path d="M1 4L3.5 6.5L9 1" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </div>

                <div style={{ fontSize: "17px", fontWeight: 700, marginBottom: "4px" }}>
                  {p.name}
                </div>
                <div style={{ marginBottom: "12px" }}>
                  <span style={{ fontSize: "26px", fontWeight: 800 }}>{p.price}</span>
                  <span style={{ fontSize: "12px", color: "#6d7175", marginLeft: "4px" }}>{p.priceLabel}</span>
                </div>

                <div
                  style={{
                    fontSize: "11px",
                    fontFamily: "monospace",
                    color: "#6d7175",
                    background: "#f6f6f7",
                    padding: "2px 7px",
                    borderRadius: "4px",
                    display: "inline-block",
                    marginBottom: "14px",
                  }}
                >
                  {getPlanModel(planId)}
                </div>

                <ul
                  style={{
                    margin: 0,
                    padding: "0 0 0 16px",
                    fontSize: "13px",
                    color: "#6d7175",
                    lineHeight: "1.8",
                  }}
                >
                  {p.features.map((f) => <li key={f}>{f}</li>)}
                </ul>
              </button>
            );
          })}
        </div>

        {/* ── Error message ── */}
        {error && (
          <p style={{ marginBottom: "12px", fontSize: "13px", color: "#d72c0d", maxWidth: "600px", textAlign: "center" }}>
            {error}
          </p>
        )}

        {/* ── Confirm button ── */}
        <Form method="post">
          <input type="hidden" name="plan" value={selected} />
          <button
            type="submit"
            disabled={submitting}
            style={{
              padding: "11px 40px",
              fontSize: "15px",
              fontWeight: 600,
              color: "#fff",
              background: submitting ? "#6b6b6b" : "#303030",
              border: "none",
              borderRadius: "8px",
              cursor: submitting ? "not-allowed" : "pointer",
              fontFamily: "inherit",
              transition: "background 0.15s",
            }}
          >
            {submitting
              ? "Saving…"
              : isOnboarding
                ? `Get started with ${plan.name}`
                : `Switch to ${plan.name}`}
          </button>
        </Form>

        <p style={{ marginTop: "14px", fontSize: "12px", color: "#8c9196" }}>
          Billed through Shopify. Cancel anytime.
        </p>
      </div>
    </AppProvider>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers = (headersArgs) => boundary.headers(headersArgs);