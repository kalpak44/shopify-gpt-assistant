import { useState } from "react";
import { redirect, useLoaderData, useRouteError, Form, Link } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { getOrCreateSubscription } from "../subscription.server.js";
import { PLAN_DEFS, getPlanModel } from "../plans.js";

// ─── Loader ──────────────────────────────────────────────────────────────────

export const loader = async ({ request }) => {
  try {
    const { session } = await authenticate.admin(request);
    const shop = session.shop;

    const [subscription, sessions] = await Promise.all([
      getOrCreateSubscription(shop),
      prisma.chatSession.findMany({
        where: { shop },
        orderBy: { updatedAt: "desc" },
        take: 50,
        select: { id: true, title: true, updatedAt: true },
      }),
    ]);

    return { apiKey: process.env.SHOPIFY_API_KEY || "", sessions, subscription };
  } catch (error) {
    if (error instanceof Response && error.status === 410) {
      throw redirect("/auth/login");
    }
    throw error;
  }
};

// ─── Action ──────────────────────────────────────────────────────────────────

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "delete_session") {
    const sessionId = formData.get("sessionId")?.toString();
    if (sessionId) {
      await prisma.chatSession.deleteMany({ where: { id: sessionId, shop } });
    }
    throw redirect("/");
  }

  if (intent === "select_plan") {
    const plan = formData.get("plan")?.toString();
    if (["free", "pro", "enterprise"].includes(plan)) {
      await prisma.subscription.upsert({
        where: { shop },
        create: { shop, plan, status: "active" },
        update: { plan, status: "active" },
      });
    }
    throw redirect("/");
  }

  return null;
};

// ─── Plan Card ────────────────────────────────────────────────────────────────

function PlanCard({ plan, isCurrent, isSubmitting, submittingPlan }) {
  return (
    <div
      style={{
        border: `2px solid ${isCurrent ? "#008060" : plan.highlight ? "#303030" : "#e1e3e5"}`,
        borderRadius: "12px",
        padding: "24px",
        background: isCurrent ? "#f0faf7" : "#fff",
        position: "relative",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {plan.highlight && !isCurrent && (
        <div
          style={{
            position: "absolute",
            top: "-12px",
            left: "50%",
            transform: "translateX(-50%)",
            padding: "3px 14px",
            background: "#303030",
            color: "#fff",
            borderRadius: "12px",
            fontSize: "11px",
            fontWeight: 700,
            letterSpacing: "0.06em",
            whiteSpace: "nowrap",
          }}
        >
          RECOMMENDED
        </div>
      )}
      {isCurrent && (
        <div
          style={{
            position: "absolute",
            top: "-12px",
            left: "50%",
            transform: "translateX(-50%)",
            padding: "3px 14px",
            background: "#008060",
            color: "#fff",
            borderRadius: "12px",
            fontSize: "11px",
            fontWeight: 700,
            whiteSpace: "nowrap",
          }}
        >
          YOUR PLAN
        </div>
      )}

      <div style={{ fontSize: "18px", fontWeight: 700, marginBottom: "4px" }}>{plan.name}</div>

      <div style={{ marginBottom: "16px" }}>
        <span style={{ fontSize: "28px", fontWeight: 800 }}>{plan.price}</span>
        <span style={{ fontSize: "13px", color: "#6d7175", marginLeft: "4px" }}>{plan.priceLabel}</span>
      </div>

      <div
        style={{
          fontSize: "11px",
          fontFamily: "monospace",
          color: "#6d7175",
          background: "#f6f6f7",
          padding: "3px 8px",
          borderRadius: "4px",
          display: "inline-block",
          marginBottom: "16px",
          alignSelf: "flex-start",
        }}
      >
        {getPlanModel(plan.id)}
      </div>

      <ul
        style={{
          flex: 1,
          margin: "0 0 20px",
          padding: "0 0 0 18px",
          fontSize: "13px",
          color: "#6d7175",
          lineHeight: "1.8",
        }}
      >
        {plan.features.map((f) => <li key={f}>{f}</li>)}
      </ul>

      {isCurrent ? (
        <div
          style={{
            textAlign: "center",
            padding: "9px",
            fontSize: "13px",
            fontWeight: 600,
            color: "#008060",
            borderRadius: "8px",
            border: "1px solid #95c4b8",
            background: "#e8f5f0",
          }}
        >
          ✓ Active
        </div>
      ) : (
        <Form method="post">
          <input type="hidden" name="intent" value="select_plan" />
          <input type="hidden" name="plan" value={plan.id} />
          <button
            type="submit"
            disabled={isSubmitting}
            style={{
              width: "100%",
              padding: "9px",
              fontSize: "13px",
              fontWeight: 600,
              color: plan.highlight ? "#fff" : "#202223",
              background: plan.highlight ? "#303030" : "#f6f6f7",
              border: `1px solid ${plan.highlight ? "#303030" : "#e1e3e5"}`,
              borderRadius: "8px",
              cursor: isSubmitting ? "not-allowed" : "pointer",
              fontFamily: "inherit",
              transition: "opacity 0.15s",
            }}
          >
            {isSubmitting && submittingPlan === plan.id ? "Selecting…" : `Get started — ${plan.price}`}
          </button>
        </Form>
      )}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function Index() {
  const { apiKey, sessions, subscription } = useLoaderData();
  const [confirmId, setConfirmId] = useState(null);
  const [submittingPlan, setSubmittingPlan] = useState(null);

  const currentPlan = PLAN_DEFS[subscription?.plan] ?? PLAN_DEFS.free;
  const isFirstVisit = !subscription || sessions.length === 0;

  return (
    <AppProvider embedded apiKey={apiKey}>
      <div style={{ padding: "32px 40px", fontFamily: "Inter, -apple-system, sans-serif", color: "#202223" }}>

        {/* ── Header ── */}
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: "32px" }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "4px" }}>
              <h1 style={{ margin: 0, fontSize: "20px", fontWeight: 650 }}>Assistant GPT</h1>
              {subscription && (
                <span
                  style={{
                    padding: "2px 10px",
                    borderRadius: "12px",
                    fontSize: "11px",
                    fontWeight: 700,
                    background: "#f6f6f7",
                    color: "#6d7175",
                    border: "1px solid #e1e3e5",
                  }}
                >
                  {currentPlan.name}
                </span>
              )}
            </div>
            <p style={{ margin: 0, fontSize: "14px", color: "#6d7175" }}>
              Manage your Shopify store with AI — themes, orders, products, customers, and more.
            </p>
          </div>
          <div style={{ display: "flex", gap: "8px", flexShrink: 0 }}>
            <Link
              to="/assistant/debug"
              style={linkBtnStyle}
            >
              🐛 Debug
            </Link>
            <Link to="/assistant/settings" style={linkBtnStyle}>
              Settings
            </Link>
            <Link to="/assistant/new" style={{ ...linkBtnStyle, background: "#303030", color: "#fff", border: "1px solid #303030", fontWeight: 600 }}>
              New session
            </Link>
          </div>
        </div>

        {/* ── Plan selection (shown when no sessions or first visit) ── */}
        {isFirstVisit && (
          <div style={{ marginBottom: "40px" }}>
            <h2 style={{ fontSize: "18px", fontWeight: 600, margin: "0 0 6px" }}>
              Choose your plan
            </h2>
            <p style={{ margin: "0 0 24px", fontSize: "14px", color: "#6d7175" }}>
              Select a plan to get started. You can switch at any time from Settings.
            </p>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "16px", maxWidth: "820px" }}>
              {["free", "pro", "enterprise"].map((planId) => (
                <PlanCard
                  key={planId}
                  plan={PLAN_DEFS[planId]}
                  isCurrent={subscription?.plan === planId}
                  isSubmitting={false}
                  submittingPlan={submittingPlan}
                />
              ))}
            </div>
          </div>
        )}

        {/* ── Session list ── */}
        <div>
          {!isFirstVisit && (
            <h2 style={{ fontSize: "16px", fontWeight: 600, margin: "0 0 16px" }}>Sessions</h2>
          )}

          {sessions.length === 0 ? (
            <div
              style={{
                padding: "40px 24px",
                textAlign: "center",
                border: "1px dashed #c9cccf",
                borderRadius: "8px",
                color: "#6d7175",
                fontSize: "14px",
              }}
            >
              No sessions yet — click <strong>New session</strong> to start chatting.
            </div>
          ) : (
            <div style={{ border: "1px solid #e1e3e5", borderRadius: "8px", overflow: "hidden" }}>
              {sessions.map((s, i) => (
                <div
                  key={s.id}
                  style={{ background: "#fff", borderTop: i > 0 ? "1px solid #e1e3e5" : "none" }}
                >
                  {confirmId === s.id ? (
                    <div style={{ display: "flex", alignItems: "center", gap: "12px", padding: "12px 16px", background: "#fff4f4" }}>
                      <span style={{ flex: 1, fontSize: "14px", color: "#202223" }}>
                        Delete <strong>{s.title || "Untitled session"}</strong>? This cannot be undone.
                      </span>
                      <Form method="post">
                        <input type="hidden" name="intent" value="delete_session" />
                        <input type="hidden" name="sessionId" value={s.id} />
                        <button type="submit" style={deleteBtnStyle}>Delete</button>
                      </Form>
                      <button type="button" onClick={() => setConfirmId(null)} style={cancelBtnStyle}>
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <div style={{ display: "flex", alignItems: "center" }}>
                      <Link
                        to={`/assistant/${s.id}`}
                        style={{ flex: 1, display: "flex", alignItems: "center", gap: "12px", padding: "14px 16px", textDecoration: "none", color: "inherit", minWidth: 0 }}
                      >
                        <span style={{ flex: 1, fontSize: "14px", fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {s.title || "Untitled session"}
                        </span>
                        <span style={{ fontSize: "13px", color: "#8c9196", whiteSpace: "nowrap" }}>
                          {new Date(s.updatedAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
                        </span>
                      </Link>
                      <button type="button" onClick={() => setConfirmId(s.id)} style={ghostBtnStyle}>
                        Delete
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </AppProvider>
  );
}

// ─── Shared button styles ─────────────────────────────────────────────────────

const linkBtnStyle = {
  padding: "8px 14px",
  fontSize: "14px",
  fontWeight: 500,
  color: "#303030",
  background: "#f6f6f7",
  border: "1px solid #e1e3e5",
  borderRadius: "8px",
  textDecoration: "none",
  lineHeight: "20px",
  display: "inline-block",
};

const deleteBtnStyle = {
  padding: "6px 14px",
  fontSize: "13px",
  fontWeight: 600,
  color: "#fff",
  background: "#d72c0d",
  border: "1px solid #b3200a",
  borderRadius: "6px",
  cursor: "pointer",
  fontFamily: "inherit",
};

const cancelBtnStyle = {
  padding: "6px 14px",
  fontSize: "13px",
  fontWeight: 500,
  color: "#202223",
  background: "#fff",
  border: "1px solid #c9cccf",
  borderRadius: "6px",
  cursor: "pointer",
  fontFamily: "inherit",
};

const ghostBtnStyle = {
  margin: "0 12px",
  padding: "6px 12px",
  fontSize: "13px",
  fontWeight: 500,
  color: "#6d7175",
  background: "transparent",
  border: "1px solid transparent",
  borderRadius: "6px",
  cursor: "pointer",
  fontFamily: "inherit",
};

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};