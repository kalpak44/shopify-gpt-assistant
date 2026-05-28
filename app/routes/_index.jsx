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

    const url = new URL(request.url);
    const ready = url.searchParams.get("ready") === "1";

    const [subscription, sessions] = await Promise.all([
      getOrCreateSubscription(shop),
      prisma.chatSession.findMany({
        where: { shop },
        orderBy: { updatedAt: "desc" },
        take: 50,
        select: { id: true, title: true, updatedAt: true },
      }),
    ]);

    return { apiKey: process.env.SHOPIFY_API_KEY || "", sessions, subscription, ready };
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
    // ?ready=1 tells the loader the user has explicitly picked a plan
    throw redirect("/?ready=1");
  }

  return null;
};

// ─── Plan Selection Screen ────────────────────────────────────────────────────

function PlanSelectionScreen({ currentPlanId }) {
  const [selected, setSelected] = useState(currentPlanId ?? "free");
  const [submitting, setSubmitting] = useState(false);

  const plan = PLAN_DEFS[selected];

  return (
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
      }}
    >
      <h1 style={{ margin: "0 0 6px", fontSize: "24px", fontWeight: 700, color: "#202223" }}>
        Choose your plan
      </h1>
      <p style={{ margin: "0 0 36px", fontSize: "14px", color: "#6d7175" }}>
        Select a plan below, then confirm to get started. You can switch at any time.
      </p>

      {/* Cards */}
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

              {/* Selection indicator */}
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
                  transition: "all 0.15s",
                }}
              >
                {isSelected && (
                  <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
                    <path d="M1 4L3.5 6.5L9 1" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </div>

              <div style={{ fontSize: "17px", fontWeight: 700, marginBottom: "4px", color: "#202223" }}>
                {p.name}
              </div>
              <div style={{ marginBottom: "14px" }}>
                <span style={{ fontSize: "26px", fontWeight: 800, color: "#202223" }}>{p.price}</span>
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

      {/* Confirm button */}
      <Form method="post" onSubmit={() => setSubmitting(true)}>
        <input type="hidden" name="intent" value="select_plan" />
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
          {submitting ? "Setting up…" : `Get started with ${plan.name}`}
        </button>
      </Form>

      <p style={{ marginTop: "14px", fontSize: "12px", color: "#8c9196" }}>
        Payment processing coming soon. No card required right now.
      </p>
    </div>
  );
}

// ─── Main App Screen ──────────────────────────────────────────────────────────

export default function Index() {
  const { apiKey, sessions, subscription, ready } = useLoaderData();
  const [confirmId, setConfirmId] = useState(null);

  const showNormalUI = ready || sessions.length > 0;
  const currentPlan = PLAN_DEFS[subscription?.plan] ?? PLAN_DEFS.free;

  return (
    <AppProvider embedded apiKey={apiKey}>
      {!showNormalUI ? (
        <PlanSelectionScreen currentPlanId={subscription?.plan} />
      ) : (
        <div style={{ padding: "32px 40px", fontFamily: "Inter, -apple-system, sans-serif", color: "#202223" }}>

          {/* ── Header ── */}
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: "32px" }}>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "4px" }}>
                <h1 style={{ margin: 0, fontSize: "20px", fontWeight: 650 }}>Assistant GPT</h1>
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
              </div>
              <p style={{ margin: 0, fontSize: "14px", color: "#6d7175" }}>
                Manage your Shopify store with AI — themes, orders, products, customers, and more.
              </p>
            </div>
            <div style={{ display: "flex", gap: "8px", flexShrink: 0 }}>
              <Link to="/assistant/debug" style={linkBtnStyle}>🐛 Debug</Link>
              <Link to="/assistant/settings" style={linkBtnStyle}>Settings</Link>
              <Link to="/assistant/new" style={{ ...linkBtnStyle, background: "#303030", color: "#fff", border: "1px solid #303030", fontWeight: 600 }}>
                New session
              </Link>
            </div>
          </div>

          {/* ── Session list ── */}
          {sessions.length === 0 ? (
            <div
              style={{
                padding: "48px 24px",
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
                      <button type="button" onClick={() => setConfirmId(null)} style={cancelBtnStyle}>Cancel</button>
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
                      <button type="button" onClick={() => setConfirmId(s.id)} style={ghostBtnStyle}>Delete</button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </AppProvider>
  );
}

// ─── Shared styles ────────────────────────────────────────────────────────────

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