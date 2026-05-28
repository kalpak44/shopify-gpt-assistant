import { useState } from "react";
import { redirect, useLoaderData, useRouteError, Form, Link } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { getOrCreateSubscription } from "../subscription.server.js";
import { PLAN_DEFS } from "../plans.js";

// ─── Loader ──────────────────────────────────────────────────────────────────

export const loader = async ({ request }) => {
  try {
    const { session } = await authenticate.admin(request);
    const shop = session.shop;

    const subscription = await getOrCreateSubscription(shop);

    if (!subscription.confirmedAt) {
      const { searchParams } = new URL(request.url);
      const qs = searchParams.toString();
      throw redirect(`/assistant/plans${qs ? `?${qs}` : ""}`);
    }

    const sessions = await prisma.chatSession.findMany({
      where: { shop },
      orderBy: { updatedAt: "desc" },
      take: 50,
      select: { id: true, title: true, updatedAt: true },
    });

    return { apiKey: process.env.SHOPIFY_API_KEY || "", sessions, subscription };
  } catch (error) {
    if (error instanceof Response) throw error;
    throw error;
  }
};

// ─── Action ──────────────────────────────────────────────────────────────────

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const formData = await request.formData();

  if (formData.get("intent") === "delete_session") {
    const sessionId = formData.get("sessionId")?.toString();
    if (sessionId) {
      await prisma.chatSession.deleteMany({ where: { id: sessionId, shop } });
    }
    throw redirect("/");
  }

  return null;
};

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function Index() {
  const { apiKey, sessions, subscription } = useLoaderData();
  const [confirmId, setConfirmId] = useState(null);

  const currentPlan = PLAN_DEFS[subscription?.plan] ?? PLAN_DEFS.free;

  return (
    <AppProvider embedded apiKey={apiKey}>
      <div style={{ padding: "32px 40px", fontFamily: "Inter, -apple-system, sans-serif", color: "#202223" }}>

        {/* ── Header ── */}
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: "32px" }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "4px" }}>
              <h1 style={{ margin: 0, fontSize: "20px", fontWeight: 650 }}>Assistant GPT</h1>
              <span style={planBadgeStyle}>{currentPlan.name}</span>
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
          <div style={{ padding: "48px 24px", textAlign: "center", border: "1px dashed #c9cccf", borderRadius: "8px", color: "#6d7175", fontSize: "14px" }}>
            No sessions yet — click <strong>New session</strong> to start chatting.
          </div>
        ) : (
          <div style={{ border: "1px solid #e1e3e5", borderRadius: "8px", overflow: "hidden" }}>
            {sessions.map((s, i) => (
              <div key={s.id} style={{ background: "#fff", borderTop: i > 0 ? "1px solid #e1e3e5" : "none" }}>
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
    </AppProvider>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const planBadgeStyle = {
  padding: "2px 10px",
  borderRadius: "12px",
  fontSize: "11px",
  fontWeight: 700,
  background: "#f6f6f7",
  color: "#6d7175",
  border: "1px solid #e1e3e5",
};

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
  padding: "6px 14px", fontSize: "13px", fontWeight: 600,
  color: "#fff", background: "#d72c0d", border: "1px solid #b3200a",
  borderRadius: "6px", cursor: "pointer", fontFamily: "inherit",
};

const cancelBtnStyle = {
  padding: "6px 14px", fontSize: "13px", fontWeight: 500,
  color: "#202223", background: "#fff", border: "1px solid #c9cccf",
  borderRadius: "6px", cursor: "pointer", fontFamily: "inherit",
};

const ghostBtnStyle = {
  margin: "0 12px", padding: "6px 12px", fontSize: "13px", fontWeight: 500,
  color: "#6d7175", background: "transparent", border: "1px solid transparent",
  borderRadius: "6px", cursor: "pointer", fontFamily: "inherit",
};

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers = (headersArgs) => boundary.headers(headersArgs);