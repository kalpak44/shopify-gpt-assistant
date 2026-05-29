import { useLoaderData, useRouteError, Link } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";
import { authenticate } from "../shopify.server";
import { TOOL_DEFS } from "../ai.server";
import { getOrCreateSubscription } from "../subscription.server.js";

// ─── Loader ──────────────────────────────────────────────────────────────────

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const subscription = await getOrCreateSubscription(session.shop);
  return {
    apiKey: process.env.SHOPIFY_API_KEY || "",
    debugEnabled: subscription.debugEnabled,
    tools: TOOL_DEFS.map((t) => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    })),
  };
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Render a JSON Schema "properties" map as a simple table. */
function ParamsTable({ parameters }) {
  const props = parameters?.properties ?? {};
  const required = new Set(parameters?.required ?? []);
  const entries = Object.entries(props);

  if (entries.length === 0) {
    return (
      <span style={{ fontSize: "11px", color: "#8c9196", fontStyle: "italic" }}>
        No parameters
      </span>
    );
  }

  return (
    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12px" }}>
      <thead>
        <tr>
          {["Name", "Type", "Required", "Description"].map((h) => (
            <th
              key={h}
              style={{
                padding: "5px 10px",
                textAlign: "left",
                background: "#f6f6f7",
                borderBottom: "1px solid #e1e3e5",
                fontWeight: 600,
                color: "#6d7175",
                fontSize: "11px",
                textTransform: "uppercase",
                letterSpacing: "0.04em",
              }}
            >
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {entries.map(([name, schema]) => (
          <tr key={name} style={{ borderBottom: "1px solid #f1f1f1" }}>
            <td
              style={{
                padding: "6px 10px",
                fontFamily: "'SFMono-Regular', Consolas, monospace",
                fontSize: "11px",
                color: "#202223",
                whiteSpace: "nowrap",
              }}
            >
              {name}
            </td>
            <td
              style={{
                padding: "6px 10px",
                fontFamily: "'SFMono-Regular', Consolas, monospace",
                fontSize: "11px",
                color: "#0550ae",
                whiteSpace: "nowrap",
              }}
            >
              {schema.type ?? (schema.oneOf ? "oneOf" : "any")}
            </td>
            <td style={{ padding: "6px 10px", textAlign: "center" }}>
              {required.has(name) ? (
                <span style={{ color: "#d72c0d", fontWeight: 700, fontSize: "11px" }}>✓</span>
              ) : (
                <span style={{ color: "#8c9196", fontSize: "11px" }}>-</span>
              )}
            </td>
            <td style={{ padding: "6px 10px", color: "#6d7175", fontSize: "12px", lineHeight: "1.4" }}>
              {schema.description ?? ""}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function AssistantDebug() {
  const { apiKey, debugEnabled, tools } = useLoaderData();

  return (
    <AppProvider embedded apiKey={apiKey}>
      <div
        style={{
          padding: "32px 40px",
          fontFamily: "Inter, -apple-system, sans-serif",
          color: "#202223",
          maxWidth: "960px",
        }}
      >
        {/* ── Header ── */}
        <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "8px" }}>
          <Link to="/" style={{ fontSize: "13px", color: "#6d7175", textDecoration: "none" }}>
            ← Assistant GPT
          </Link>
          <span style={{ color: "#e1e3e5" }}>|</span>
          <h1 style={{ fontSize: "22px", fontWeight: 600, margin: 0 }}>🐛 Debug Inspector</h1>
        </div>

        <p style={{ margin: "0 0 28px", fontSize: "14px", color: "#6d7175" }}>
          All registered AI tools and their input schemas.
        </p>

        {/* Debug mode status banner */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "10px",
            padding: "10px 16px",
            marginBottom: "28px",
            borderRadius: "8px",
            background: debugEnabled ? "#e8f5f0" : "#fdf3cd",
            border: `1px solid ${debugEnabled ? "#95c4b8" : "#f0c040"}`,
            fontSize: "13px",
            color: debugEnabled ? "#155724" : "#856404",
          }}
        >
          <span style={{ fontSize: "16px" }}>{debugEnabled ? "✅" : "⚠️"}</span>
          <span>
            {debugEnabled ? (
              <>
                <strong>Debug mode active</strong> - live tool call events are streamed to the debug
                panel in chat sessions and the server console.
              </>
            ) : (
              <>
                <strong>Debug mode inactive.</strong> Enable it in{" "}
                <Link to="/assistant/settings" style={{ color: "#008060" }}>Settings → Developer</Link>{" "}
                to stream live tool-call events to the chat debug panel and server console.
              </>
            )}
          </span>
        </div>

        {/* ── Tool list ── */}
        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          {tools.map((tool) => (
            <div
              key={tool.name}
              style={{
                border: "1px solid #e1e3e5",
                borderRadius: "8px",
                overflow: "hidden",
                background: "#fff",
              }}
            >
              {/* Tool header */}
              <div
                style={{
                  display: "flex",
                  alignItems: "baseline",
                  gap: "12px",
                  padding: "12px 16px",
                  background: "#f6f6f7",
                  borderBottom: "1px solid #e1e3e5",
                }}
              >
                <span
                  style={{
                    fontFamily: "'SFMono-Regular', Consolas, monospace",
                    fontSize: "13px",
                    fontWeight: 700,
                    color: "#202223",
                  }}
                >
                  {tool.name}
                </span>
                <span
                  style={{
                    flex: 1,
                    fontSize: "13px",
                    color: "#6d7175",
                    lineHeight: "1.4",
                  }}
                >
                  {tool.description}
                </span>
              </div>

              {/* Parameters table */}
              <div style={{ overflowX: "auto" }}>
                <ParamsTable parameters={tool.parameters} />
              </div>
            </div>
          ))}
        </div>

        <p
          style={{
            marginTop: "28px",
            fontSize: "12px",
            color: "#8c9196",
          }}
        >
          {tools.length} tools registered · Shopify Admin GraphQL API 2026-04
        </p>
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