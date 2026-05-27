import { useState } from "react";
import { redirect, useLoaderData, useRouteError, Form, Link } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

// ─── Loader ──────────────────────────────────────────────────────────────────

export const loader = async ({ request }) => {
  try {
    const { session } = await authenticate.admin(request);
    const sessions = await prisma.chatSession.findMany({
      where: { shop: session.shop },
      orderBy: { updatedAt: "desc" },
      take: 50,
      select: { id: true, title: true, updatedAt: true },
    });
    return { apiKey: process.env.SHOPIFY_API_KEY || "", sessions };
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
      await prisma.chatSession.deleteMany({
        where: { id: sessionId, shop },
      });
    }
    throw redirect("/");
  }

  return null;
};

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function Index() {
  const { apiKey, sessions } = useLoaderData();
  const [confirmId, setConfirmId] = useState(null);

  return (
    <AppProvider embedded apiKey={apiKey}>
      <div style={{ padding: "32px 40px", fontFamily: "Inter, sans-serif" }}>

        {/* ── Header ── */}
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: "28px" }}>
          <div>
            <h1 style={{ margin: "0 0 4px", fontSize: "20px", fontWeight: 650, color: "#202223" }}>
              Assistant GPT
            </h1>
            <p style={{ margin: 0, fontSize: "14px", color: "#6d7175" }}>
              Manage your Shopify store with AI — themes, orders, products, customers, and more.
            </p>
          </div>
          <div style={{ display: "flex", gap: "8px", flexShrink: 0 }}>
            <Link
              to="/assistant/debug"
              style={{
                padding: "8px 14px",
                fontSize: "14px",
                fontWeight: 500,
                color: "#6d7175",
                background: "#f6f6f7",
                border: "1px solid #e1e3e5",
                borderRadius: "8px",
                textDecoration: "none",
                lineHeight: "20px",
                display: "inline-block",
              }}
            >
              🐛 Debug
            </Link>
            <Link
              to="/assistant/settings"
              style={{
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
              }}
            >
              Settings
            </Link>
            <Link
              to="/assistant/new"
              style={{
                padding: "8px 14px",
                fontSize: "14px",
                fontWeight: 600,
                color: "#fff",
                background: "#303030",
                border: "1px solid #303030",
                borderRadius: "8px",
                lineHeight: "20px",
                textDecoration: "none",
                display: "inline-block",
              }}
            >
              New session
            </Link>
          </div>
        </div>

        {/* ── Session list ── */}
        {sessions.length === 0 ? (
          <div style={{
            padding: "48px 24px",
            textAlign: "center",
            border: "1px dashed #c9cccf",
            borderRadius: "8px",
            color: "#6d7175",
            fontSize: "14px",
          }}>
            No sessions yet — click <strong>New session</strong> to get started.
          </div>
        ) : (
          <div style={{ border: "1px solid #e1e3e5", borderRadius: "8px", overflow: "hidden" }}>
            {sessions.map((s, i) => (
              <div
                key={s.id}
                style={{
                  background: "#fff",
                  borderTop: i > 0 ? "1px solid #e1e3e5" : "none",
                }}
              >
                {confirmId === s.id ? (
                  /* ── Inline delete confirmation ── */
                  <div style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "12px",
                    padding: "12px 16px",
                    background: "#fff4f4",
                  }}>
                    <span style={{ flex: 1, fontSize: "14px", color: "#202223" }}>
                      Delete <strong>{s.title || "Untitled session"}</strong>? This cannot be undone.
                    </span>
                    <Form method="post">
                      <input type="hidden" name="intent" value="delete_session" />
                      <input type="hidden" name="sessionId" value={s.id} />
                      <button
                        type="submit"
                        style={{
                          padding: "6px 14px",
                          fontSize: "13px",
                          fontWeight: 600,
                          color: "#fff",
                          background: "#d72c0d",
                          border: "1px solid #b3200a",
                          borderRadius: "6px",
                          cursor: "pointer",
                          fontFamily: "inherit",
                        }}
                      >
                        Delete
                      </button>
                    </Form>
                    <button
                      type="button"
                      onClick={() => setConfirmId(null)}
                      style={{
                        padding: "6px 14px",
                        fontSize: "13px",
                        fontWeight: 500,
                        color: "#202223",
                        background: "#fff",
                        border: "1px solid #c9cccf",
                        borderRadius: "6px",
                        cursor: "pointer",
                        fontFamily: "inherit",
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  /* ── Normal row ── */
                  <div style={{ display: "flex", alignItems: "center" }}>
                    <Link
                      to={`/assistant/${s.id}`}
                      style={{
                        flex: 1,
                        display: "flex",
                        alignItems: "center",
                        gap: "12px",
                        padding: "14px 16px",
                        textDecoration: "none",
                        color: "inherit",
                        minWidth: 0,
                      }}
                    >
                      <span style={{
                        flex: 1,
                        fontSize: "14px",
                        fontWeight: 500,
                        color: "#202223",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}>
                        {s.title || "Untitled session"}
                      </span>
                      <span style={{ fontSize: "13px", color: "#8c9196", whiteSpace: "nowrap" }}>
                        {new Date(s.updatedAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
                      </span>
                    </Link>
                    <button
                      type="button"
                      onClick={() => setConfirmId(s.id)}
                      style={{
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
                      }}
                    >
                      Delete
                    </button>
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

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};