import { useEffect, useRef, useState } from "react";
import {
  redirect,
  useLoaderData,
  useNavigation,
  useRevalidator,
  useRouteError,
  Form,
  Link,
  useActionData,
} from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { readThemeFile, writeThemeFile } from "../theme.server";
import { runAgentLoop } from "../ai.server";
import { Markdown } from "../markdown.jsx";
import { getOrCreateSubscription } from "../subscription.server.js";

// ─── Loader ──────────────────────────────────────────────────────────────────

export const loader = async ({ request, params }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const { sessionId } = params;

  const chatSession = await prisma.chatSession.findFirst({
    where: { id: sessionId, shop },
  });
  if (!chatSession) throw new Response("Session not found", { status: 404 });

  const [messages, proposals, subscription] = await Promise.all([
    prisma.chatMessage.findMany({
      where: { sessionId },
      orderBy: { createdAt: "asc" },
    }),
    prisma.changeProposal.findMany({
      where: { sessionId },
      orderBy: { createdAt: "asc" },
    }),
    getOrCreateSubscription(shop),
  ]);

  const proposalMap = Object.fromEntries(proposals.map((p) => [p.id, p]));

  return {
    apiKey: process.env.SHOPIFY_API_KEY || "",
    chatSession,
    messages,
    proposalMap,
    debugEnabled: subscription.debugEnabled,
  };
};

// ─── Action (approve / reject) ───────────────────────────────────────────────

export const action = async ({ request, params }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const { accessToken } = session;
  const { sessionId } = params;

  const chatSession = await prisma.chatSession.findFirst({
    where: { id: sessionId, shop },
  });
  if (!chatSession) throw new Response("Session not found", { status: 404 });

  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "approve_proposal") {
    const proposalId = formData.get("proposalId")?.toString();
    if (!proposalId) return { error: "Missing proposal ID." };

    const proposal = await prisma.changeProposal.findFirst({
      where: { id: proposalId, shop, sessionId },
    });
    if (!proposal) return { error: "Proposal not found." };
    if (proposal.status !== "pending")
      return { error: `Proposal is already ${proposal.status}.` };

    for (const file of proposal.files) {
      let current;
      try {
        current = await readThemeFile(shop, accessToken, proposal.themeId, file.path);
      } catch (err) {
        return { error: `Could not re-read ${file.path}: ${err.message}` };
      }
      if (current === null || current.trim() !== file.before.trim()) {
        return {
          error: `Conflict: ${file.path} has changed since this proposal was created. Reject and start a new session.`,
        };
      }
    }

    for (const file of proposal.files) {
      try {
        await writeThemeFile(shop, accessToken, proposal.themeId, file.path, file.after);
      } catch (err) {
        const errorUserMsg = `I tried to apply the proposed change to \`${file.path}\` but it failed with this error: ${err.message}. Can you suggest an alternative approach?`;

        await prisma.chatMessage.create({
          data: { sessionId, role: "user", content: errorUserMsg },
        });

        const [config, history] = await Promise.all([
          prisma.assistantConfig.findUnique({ where: { shop } }),
          prisma.chatMessage.findMany({
            where: { sessionId },
            orderBy: { createdAt: "asc" },
            take: 40,
          }),
        ]);

        let aiResponse =
          "The change couldn't be applied automatically. You can apply it manually via **Online Store → Themes → Edit code** in your Shopify admin, or by using the Shopify CLI (`shopify theme pull`, edit the file, then `shopify theme push`).";

        if (config?.apiToken) {
          try {
            aiResponse = await runAgentLoop({
              config,
              scopes: session.scope,
              history,
              executeTool: async (name, args) => {
                if (name === "get_active_theme") return { id: proposal.themeId, name: "active theme" };
                if (name === "read_theme_file") return (await readThemeFile(shop, accessToken, proposal.themeId, args.path)) ?? "File not found";
                return { error: `Tool ${name} is not available right now` };
              },
              onChunk: () => {},
              isCancelled: () => false,
            });
          } catch {
            // use fallback message
          }
        }

        await prisma.chatMessage.create({
          data: { sessionId, role: "assistant", content: aiResponse },
        });

        throw redirect(`/assistant/${sessionId}`);
      }
    }

    await Promise.all([
      prisma.changeProposal.update({
        where: { id: proposalId },
        data: { status: "approved" },
      }),
      prisma.chatMessage.create({
        data: { sessionId, role: "assistant", content: "Change applied successfully." },
      }),
    ]);

    throw redirect(`/assistant/${sessionId}`);
  }

  if (intent === "reject_proposal") {
    const proposalId = formData.get("proposalId")?.toString();
    if (!proposalId) return { error: "Missing proposal ID." };

    const proposal = await prisma.changeProposal.findFirst({
      where: { id: proposalId, shop, sessionId },
    });
    if (!proposal) return { error: "Proposal not found." };
    if (proposal.status !== "pending")
      return { error: `Proposal is already ${proposal.status}.` };

    await Promise.all([
      prisma.changeProposal.update({
        where: { id: proposalId },
        data: { status: "rejected" },
      }),
      prisma.chatMessage.create({
        data: { sessionId, role: "assistant", content: "Proposal rejected." },
      }),
    ]);

    throw redirect(`/assistant/${sessionId}`);
  }

  return null;
};

// ─── DiffViewer ───────────────────────────────────────────────────────────────

function DiffViewer({ diff }) {
  const lines = (diff ?? "").split("\n");
  return (
    <pre
      style={{
        margin: 0,
        padding: "10px 14px",
        fontSize: "12px",
        fontFamily: "'SFMono-Regular', Consolas, monospace",
        lineHeight: "1.55",
        overflowX: "auto",
        background: "#fafbfc",
        maxHeight: "460px",
        overflowY: "auto",
      }}
    >
      {lines.map((line, i) => {
        let color = "inherit";
        let bg = "transparent";
        if (line.startsWith("+") && !line.startsWith("+++")) { color = "#22863a"; bg = "#e6ffed"; }
        else if (line.startsWith("-") && !line.startsWith("---")) { color = "#cb2431"; bg = "#ffeef0"; }
        else if (line.startsWith("@@")) { color = "#0550ae"; bg = "#dbedff"; }
        else if (line.startsWith("---") || line.startsWith("+++")) { color = "#586069"; }
        return (
          <span key={i} style={{ display: "block", background: bg, color, whiteSpace: "pre" }}>
            {line || " "}
          </span>
        );
      })}
    </pre>
  );
}

// ─── InlineProposalCard ───────────────────────────────────────────────────────

function InlineProposalCard({ proposal, actionError, isSubmitting }) {
  const isPending = proposal.status === "pending";
  const statusStyle = {
    pending:  { bg: "#fff3cd", color: "#856404", border: "#ffc107" },
    approved: { bg: "#d4edda", color: "#155724", border: "#c3e6cb" },
    rejected: { bg: "#f8d7da", color: "#721c24", border: "#f5c6cb" },
  }[proposal.status] ?? { bg: "#fff3cd", color: "#856404", border: "#ffc107" };

  return (
    <div
      style={{
        margin: "12px 0 4px",
        border: "1px solid #e1e3e5",
        borderRadius: "8px",
        overflow: "hidden",
        background: "#fff",
        fontSize: "13px",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "10px",
          padding: "8px 14px",
          background: "#f6f6f7",
          borderBottom: "1px solid #e1e3e5",
        }}
      >
        <span style={{ color: "#6d7175", fontSize: "12px" }}>📄</span>
        <span
          style={{
            flex: 1,
            fontFamily: "'SFMono-Regular', Consolas, monospace",
            fontSize: "12px",
            color: "#202223",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {proposal.files?.[0]?.path ?? "file change"}
        </span>
        <span
          style={{
            padding: "2px 8px",
            borderRadius: "10px",
            fontSize: "11px",
            fontWeight: 600,
            background: statusStyle.bg,
            color: statusStyle.color,
            border: `1px solid ${statusStyle.border}`,
          }}
        >
          {proposal.status}
        </span>
      </div>

      {/* Summary */}
      <div style={{ padding: "8px 14px", color: "#6d7175", fontSize: "12px", borderBottom: "1px solid #e1e3e5" }}>
        {proposal.summary}
      </div>

      {/* Diff */}
      {(proposal.files ?? []).map((file, fi) => (
        <DiffViewer key={fi} diff={file.diff} />
      ))}

      {/* Error */}
      {actionError && (
        <div
          style={{
            padding: "8px 14px",
            background: "#ffeef0",
            borderTop: "1px solid #ffc1cc",
            color: "#cb2431",
            fontSize: "12px",
          }}
        >
          {actionError}
        </div>
      )}

      {/* Actions */}
      {isPending && (
        <div
          style={{
            display: "flex",
            gap: "8px",
            padding: "10px 14px",
            borderTop: "1px solid #e1e3e5",
            background: "#f6f6f7",
          }}
        >
          <Form method="post">
            <input type="hidden" name="intent" value="approve_proposal" />
            <input type="hidden" name="proposalId" value={proposal.id} />
            <button
              type="submit"
              disabled={isSubmitting}
              style={{
                padding: "6px 16px",
                background: isSubmitting ? "#95c4b8" : "#008060",
                color: "#fff",
                border: "none",
                borderRadius: "6px",
                fontWeight: 600,
                fontSize: "12px",
                cursor: isSubmitting ? "not-allowed" : "pointer",
                fontFamily: "inherit",
              }}
            >
              {isSubmitting ? "Applying…" : "✓ Apply change"}
            </button>
          </Form>
          <Form method="post">
            <input type="hidden" name="intent" value="reject_proposal" />
            <input type="hidden" name="proposalId" value={proposal.id} />
            <button
              type="submit"
              disabled={isSubmitting}
              style={{
                padding: "6px 16px",
                background: "#fff",
                color: "#d72c0d",
                border: "1px solid #d72c0d",
                borderRadius: "6px",
                fontWeight: 600,
                fontSize: "12px",
                cursor: isSubmitting ? "not-allowed" : "pointer",
                fontFamily: "inherit",
              }}
            >
              ✗ Reject
            </button>
          </Form>
        </div>
      )}
    </div>
  );
}

// ─── DebugPanel ───────────────────────────────────────────────────────────────

const GQL_API_VERSION = "2026-04";

function GraphqlCallEntry({ call, shop }) {
  const [expandQuery, setExpandQuery] = useState(false);
  const [expandVars, setExpandVars] = useState(false);
  const [expandResp, setExpandResp] = useState(false);
  const [copied, setCopied] = useState(false);

  const isPending = call.status === "pending";
  const isError   = call.status === "error";

  const badgeBg    = call.opType === "mutation" ? "#6b21a8" : "#0550ae";
  const statusIcon = isPending ? "⏳" : isError ? "✗" : "✓";

  const hasVars = call.variables && Object.keys(call.variables).length > 0;

  const copyCurl = () => {
    const endpoint = `https://${shop}/admin/api/${GQL_API_VERSION}/graphql.json`;
    const body = JSON.stringify({
      query: call.query,
      ...(hasVars && { variables: call.variables }),
    });
    const escaped = body.replace(/'/g, "'\\''");
    const cmd = `curl -s -X POST '${endpoint}' \\\n  -H 'Content-Type: application/json' \\\n  -H 'X-Shopify-Access-Token: $SHOPIFY_ACCESS_TOKEN' \\\n  --data-raw '${escaped}'`;
    navigator.clipboard.writeText(cmd).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    });
  };

  const editorUrl = `https://${shop}/admin/api/graphiql`;

  const btnStyle = {
    display: "flex",
    alignItems: "center",
    gap: "4px",
    width: "100%",
    padding: "5px 10px",
    background: "none",
    border: "none",
    borderTop: "1px solid #e1e3e5",
    cursor: "pointer",
    fontFamily: "inherit",
    fontSize: "11px",
    color: "#6d7175",
    textAlign: "left",
  };

  return (
    <div
      style={{
        marginBottom: "6px",
        border: `1px solid ${isError ? "#f5c6cb" : "#e1e3e5"}`,
        borderRadius: "6px",
        overflow: "hidden",
        background: isError ? "#fff8f8" : "#fff",
        fontSize: "12px",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "6px",
          padding: "6px 10px",
          background: isError ? "#ffeef0" : "#f6f6f7",
        }}
      >
        <span
          style={{
            padding: "1px 7px",
            borderRadius: "4px",
            fontFamily: "'SFMono-Regular', Consolas, monospace",
            fontSize: "10px",
            fontWeight: 700,
            background: badgeBg,
            color: "#fff",
            letterSpacing: "0.02em",
            flexShrink: 0,
          }}
        >
          {call.opType ?? "query"}
        </span>
        <span
          style={{
            flex: 1,
            fontFamily: "'SFMono-Regular', Consolas, monospace",
            fontSize: "11px",
            color: "#202223",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {call.operation}
        </span>
        <span style={{ fontSize: "11px", flexShrink: 0 }}>{statusIcon}</span>
        {call.durationMs !== undefined && (
          <span style={{ color: "#8c9196", fontSize: "10px", flexShrink: 0 }}>
            {call.durationMs}ms
          </span>
        )}
      </div>

      {/* Query toggle */}
      {call.query && (
        <>
          <button style={btnStyle} onClick={() => setExpandQuery((v) => !v)}>
            <span style={{ fontFamily: "monospace", marginRight: "2px" }}>{expandQuery ? "▾" : "▸"}</span>
            query
          </button>
          {expandQuery && (
            <pre
              style={{
                margin: 0,
                padding: "8px 10px",
                background: "#fafbfc",
                fontSize: "10px",
                fontFamily: "'SFMono-Regular', Consolas, monospace",
                overflowX: "auto",
                maxHeight: "200px",
                overflowY: "auto",
                lineHeight: "1.5",
              }}
            >
              {call.query}
            </pre>
          )}
        </>
      )}

      {/* Variables toggle */}
      {hasVars && (
        <>
          <button style={btnStyle} onClick={() => setExpandVars((v) => !v)}>
            <span style={{ fontFamily: "monospace", marginRight: "2px" }}>{expandVars ? "▾" : "▸"}</span>
            variables
          </button>
          {expandVars && (
            <pre
              style={{
                margin: 0,
                padding: "8px 10px",
                background: "#fafbfc",
                fontSize: "10px",
                fontFamily: "'SFMono-Regular', Consolas, monospace",
                overflowX: "auto",
                maxHeight: "160px",
                overflowY: "auto",
                lineHeight: "1.5",
              }}
            >
              {JSON.stringify(call.variables, null, 2)}
            </pre>
          )}
        </>
      )}

      {/* Response / Error toggle */}
      {(call.response !== undefined || isError) && (
        <>
          <button
            style={{ ...btnStyle, color: isError ? "#d72c0d" : "#6d7175" }}
            onClick={() => setExpandResp((v) => !v)}
          >
            <span style={{ fontFamily: "monospace", marginRight: "2px" }}>{expandResp ? "▾" : "▸"}</span>
            {isError ? "error" : "response"}
          </button>
          {expandResp && (
            <pre
              style={{
                margin: 0,
                padding: "8px 10px",
                background: isError ? "#fff8f8" : "#fafbfc",
                fontSize: "10px",
                fontFamily: "'SFMono-Regular', Consolas, monospace",
                overflowX: "auto",
                maxHeight: "240px",
                overflowY: "auto",
                lineHeight: "1.5",
                color: isError ? "#d72c0d" : "inherit",
              }}
            >
              {isError ? call.error : JSON.stringify(call.response, null, 2)}
            </pre>
          )}
        </>
      )}

      {/* Actions */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "8px",
          padding: "6px 10px",
          borderTop: "1px solid #e1e3e5",
          background: "#fafbfc",
        }}
      >
        <button
          onClick={copyCurl}
          style={{
            padding: "3px 8px",
            fontSize: "10px",
            color: copied ? "#008060" : "#6d7175",
            background: "none",
            border: `1px solid ${copied ? "#008060" : "#e1e3e5"}`,
            borderRadius: "4px",
            cursor: "pointer",
            fontFamily: "inherit",
            transition: "all 0.15s",
          }}
        >
          {copied ? "✓ Copied" : "Copy cURL"}
        </button>
        <a
          href={editorUrl}
          target="_blank"
          rel="noopener noreferrer"
          style={{ fontSize: "10px", color: "#0550ae", textDecoration: "none", marginLeft: "auto" }}
        >
          Open in GraphQL editor ↗
        </a>
      </div>
    </div>
  );
}

function ToolCallEntry({ call }) {
  const [expandArgs, setExpandArgs] = useState(false);
  const [expandResult, setExpandResult] = useState(false);

  const isPending = call.status === "pending";
  const isError   = call.status === "error";
  const isOk      = call.status === "ok";

  const badgeBg = isPending ? "#6d7175" : isError ? "#d72c0d" : "#008060";
  const statusIcon = isPending ? "⏳" : isError ? "✗" : "✓";

  const btnStyle = {
    display: "flex",
    alignItems: "center",
    gap: "4px",
    width: "100%",
    padding: "5px 10px",
    background: "none",
    border: "none",
    borderTop: "1px solid #e1e3e5",
    cursor: "pointer",
    fontFamily: "inherit",
    fontSize: "11px",
    color: "#6d7175",
    textAlign: "left",
  };

  return (
    <div
      style={{
        marginBottom: "6px",
        border: `1px solid ${isError ? "#f5c6cb" : "#e1e3e5"}`,
        borderRadius: "6px",
        overflow: "hidden",
        background: isError ? "#fff8f8" : "#fff",
        fontSize: "12px",
      }}
    >
      {/* Header row */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "6px",
          padding: "6px 10px",
          background: isError ? "#ffeef0" : "#f6f6f7",
        }}
      >
        <span
          style={{
            padding: "1px 7px",
            borderRadius: "4px",
            fontFamily: "'SFMono-Regular', Consolas, monospace",
            fontSize: "10px",
            fontWeight: 700,
            background: badgeBg,
            color: "#fff",
            letterSpacing: "0.02em",
          }}
        >
          {call.tool}
        </span>
        <span style={{ fontSize: "11px" }}>{statusIcon}</span>
        {call.durationMs !== undefined && (
          <span style={{ marginLeft: "auto", color: "#8c9196", fontSize: "10px" }}>
            {call.durationMs}ms
          </span>
        )}
      </div>

      {/* Args toggle */}
      {call.args && (
        <>
          <button style={btnStyle} onClick={() => setExpandArgs((v) => !v)}>
            <span style={{ fontFamily: "monospace", marginRight: "2px" }}>{expandArgs ? "▾" : "▸"}</span>
            args
          </button>
          {expandArgs && (
            <pre
              style={{
                margin: 0,
                padding: "8px 10px",
                background: "#fafbfc",
                fontSize: "10px",
                fontFamily: "'SFMono-Regular', Consolas, monospace",
                overflowX: "auto",
                maxHeight: "200px",
                overflowY: "auto",
                lineHeight: "1.5",
              }}
            >
              {JSON.stringify(call.args, null, 2)}
            </pre>
          )}
        </>
      )}

      {/* Result / Error toggle */}
      {(isOk || isError) && (
        <>
          <button
            style={{ ...btnStyle, color: isError ? "#d72c0d" : "#6d7175" }}
            onClick={() => setExpandResult((v) => !v)}
          >
            <span style={{ fontFamily: "monospace", marginRight: "2px" }}>{expandResult ? "▾" : "▸"}</span>
            {isError ? "error" : "result"}
          </button>
          {expandResult && (
            <pre
              style={{
                margin: 0,
                padding: "8px 10px",
                background: isError ? "#fff8f8" : "#fafbfc",
                fontSize: "10px",
                fontFamily: "'SFMono-Regular', Consolas, monospace",
                overflowX: "auto",
                maxHeight: "240px",
                overflowY: "auto",
                lineHeight: "1.5",
                color: isError ? "#d72c0d" : "inherit",
              }}
            >
              {isError ? call.error : JSON.stringify(call.result, null, 2)}
            </pre>
          )}
        </>
      )}
    </div>
  );
}

function DebugPanel({ toolCalls, graphqlCalls, shop, onClear }) {
  const [tab, setTab] = useState("tools");
  const debugScrollRef = useRef(null);

  useEffect(() => {
    if (debugScrollRef.current) {
      debugScrollRef.current.scrollTop = debugScrollRef.current.scrollHeight;
    }
  }, [toolCalls, graphqlCalls]);

  const tabBtn = (id, label, count) => (
    <button
      onClick={() => setTab(id)}
      style={{
        padding: "4px 10px",
        fontSize: "11px",
        fontWeight: tab === id ? 600 : 400,
        color: tab === id ? "#008060" : "#6d7175",
        background: tab === id ? "#e8f5f0" : "none",
        border: `1px solid ${tab === id ? "#008060" : "#e1e3e5"}`,
        borderRadius: "4px",
        cursor: "pointer",
        fontFamily: "inherit",
        display: "flex",
        alignItems: "center",
        gap: "4px",
      }}
    >
      {label}
      <span
        style={{
          padding: "0 5px",
          borderRadius: "8px",
          fontSize: "10px",
          fontWeight: 600,
          background: tab === id ? "#008060" : "#e1e3e5",
          color: tab === id ? "#fff" : "#6d7175",
        }}
      >
        {count}
      </span>
    </button>
  );

  const hasAnything = toolCalls.length > 0 || graphqlCalls.length > 0;

  return (
    <div
      style={{
        width: "340px",
        flexShrink: 0,
        borderLeft: "1px solid #e1e3e5",
        background: "#fff",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      {/* Panel header */}
      <div
        style={{
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          gap: "6px",
          padding: "0 10px",
          height: "44px",
          background: "#f6f6f7",
          borderBottom: "1px solid #e1e3e5",
        }}
      >
        <span style={{ fontSize: "12px", fontWeight: 600, color: "#202223", marginRight: "2px" }}>
          🐛
        </span>
        {tabBtn("tools", "Tools", toolCalls.length)}
        {tabBtn("graphql", "GraphQL", graphqlCalls.length)}
        <div style={{ flex: 1 }} />
        {hasAnything && (
          <button
            onClick={onClear}
            style={{
              padding: "3px 8px",
              fontSize: "11px",
              color: "#6d7175",
              background: "none",
              border: "1px solid #e1e3e5",
              borderRadius: "4px",
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            Clear
          </button>
        )}
      </div>

      {/* Content */}
      <div
        ref={debugScrollRef}
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "10px",
        }}
      >
        {tab === "tools" && (
          toolCalls.length === 0 ? (
            <div
              style={{
                color: "#8c9196",
                fontSize: "12px",
                textAlign: "center",
                paddingTop: "24px",
                lineHeight: "1.6",
              }}
            >
              <div style={{ fontSize: "20px", marginBottom: "8px" }}>🔍</div>
              Send a message to see
              <br />
              tool activity here.
            </div>
          ) : (
            toolCalls.map((call, i) => <ToolCallEntry key={i} call={call} />)
          )
        )}

        {tab === "graphql" && (
          graphqlCalls.length === 0 ? (
            <div
              style={{
                color: "#8c9196",
                fontSize: "12px",
                textAlign: "center",
                paddingTop: "24px",
                lineHeight: "1.6",
              }}
            >
              <div style={{ fontSize: "20px", marginBottom: "8px" }}>📡</div>
              No GraphQL calls yet.
              <br />
              Send a message to see
              <br />
              requests here.
            </div>
          ) : (
            graphqlCalls.map((call, i) => (
              <GraphqlCallEntry key={i} call={call} shop={shop} />
            ))
          )
        )}
      </div>

      {/* Footer */}
      <div
        style={{
          flexShrink: 0,
          borderTop: "1px solid #e1e3e5",
          padding: "8px 14px",
          background: "#f6f6f7",
        }}
      >
        <Link
          to="/assistant/debug"
          style={{ fontSize: "11px", color: "#6d7175", textDecoration: "none" }}
        >
          Tool inspector →
        </Link>
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function AssistantSession() {
  const { apiKey, chatSession, messages, proposalMap, debugEnabled } = useLoaderData();
  const actionData = useActionData();
  const navigation = useNavigation();
  const revalidator = useRevalidator();

  const isFormSubmitting = navigation.state !== "idle";

  const [isSending, setIsSending] = useState(false);
  const [pendingUserMessage, setPendingUserMessage] = useState(null);
  const [streamingText, setStreamingText] = useState(null);
  const [statusText, setStatusText] = useState(null);
  const [streamingProposal, setStreamingProposal] = useState(null);

  // ── Debug state ──
  const [showDebug, setShowDebug] = useState(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("gpt-debug-panel") === "1";
    }
    return false;
  });
  const [debugCalls, setDebugCalls] = useState([]);
  const [graphqlCalls, setGraphqlCalls] = useState([]);

  const textareaRef = useRef(null);
  const scrollRef = useRef(null);
  const waitingRevalidateRef = useRef(false);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, streamingText, pendingUserMessage, streamingProposal]);

  useEffect(() => {
    if (waitingRevalidateRef.current && revalidator.state === "idle") {
      waitingRevalidateRef.current = false;
      setPendingUserMessage(null);
      setStreamingText(null);
      setStatusText(null);
      setStreamingProposal(null);
    }
  }, [revalidator.state]);

  const toggleDebug = () => {
    const next = !showDebug;
    setShowDebug(next);
    if (typeof window !== "undefined") {
      localStorage.setItem("gpt-debug-panel", next ? "1" : "0");
    }
  };

  const handleSend = async (e) => {
    e.preventDefault();
    const message = textareaRef.current?.value.trim();
    if (!message || isSending) return;

    textareaRef.current.value = "";
    setPendingUserMessage(message);
    setStreamingText("");
    setIsSending(true);

    try {
      const resp = await fetch(`/api/chat/${chatSession.id}`, {
        method: "POST",
        body: new URLSearchParams({ message }),
      });

      if (!resp.ok || !resp.body) throw new Error(`Request failed: ${resp.status}`);

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const evt = JSON.parse(line.slice(6));
            if (evt.type === "chunk") {
              setStatusText(null);
              setStreamingText((t) => (t ?? "") + evt.text);
            } else if (evt.type === "status") {
              setStatusText(evt.text);
            } else if (evt.type === "proposal") {
              setStreamingProposal({ ...evt, status: "pending" });
            } else if (evt.type === "done") {
              setStatusText(null);
              setIsSending(false);
              waitingRevalidateRef.current = true;
              revalidator.revalidate();
            } else if (evt.type === "debug") {
              if (evt.kind === "call") {
                setDebugCalls((prev) => [
                  ...prev,
                  { seq: evt.seq, tool: evt.tool, args: evt.args, status: "pending" },
                ]);
              } else if (evt.kind === "result") {
                setDebugCalls((prev) =>
                  prev.map((c) =>
                    c.seq === evt.seq
                      ? { ...c, status: "ok", result: evt.result, durationMs: evt.durationMs }
                      : c
                  )
                );
              } else if (evt.kind === "error") {
                setDebugCalls((prev) =>
                  prev.map((c) =>
                    c.seq === evt.seq
                      ? { ...c, status: "error", error: evt.error, durationMs: evt.durationMs }
                      : c
                  )
                );
              } else if (evt.kind === "graphql_call") {
                setGraphqlCalls((prev) => [
                  ...prev,
                  {
                    seq: evt.seq,
                    operation: evt.operation,
                    opType: evt.opType,
                    query: evt.query,
                    variables: evt.variables,
                    status: "pending",
                  },
                ]);
              } else if (evt.kind === "graphql_result") {
                setGraphqlCalls((prev) =>
                  prev.map((c) =>
                    c.seq === evt.seq
                      ? { ...c, status: "ok", response: evt.response, durationMs: evt.durationMs }
                      : c
                  )
                );
              } else if (evt.kind === "graphql_error") {
                setGraphqlCalls((prev) =>
                  prev.map((c) =>
                    c.seq === evt.seq
                      ? { ...c, status: "error", error: evt.error, durationMs: evt.durationMs }
                      : c
                  )
                );
              }
            }
          } catch {
            // ignore malformed SSE line
          }
        }
      }
    } catch (err) {
      console.error("Stream error:", err);
      setIsSending(false);
      waitingRevalidateRef.current = true;
      revalidator.revalidate();
    }
  };

  // pending proposal IDs for error attribution
  const pendingProposalIds = new Set(
    Object.values(proposalMap)
      .filter((p) => p.status === "pending")
      .map((p) => p.id)
  );

  return (
    <AppProvider embedded apiKey={apiKey}>
      <style>{`
        @keyframes blink { 0%,100%{opacity:1} 50%{opacity:0} }
        @keyframes spin { to { transform: rotate(360deg) } }
      `}</style>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          height: "100vh",
          fontFamily: "Inter, -apple-system, sans-serif",
          background: "#f6f6f7",
          color: "#202223",
        }}
      >
        {/* ── Header ── */}
        <div
          style={{
            flexShrink: 0,
            display: "flex",
            alignItems: "center",
            gap: "12px",
            padding: "0 20px",
            height: "52px",
            background: "#fff",
            borderBottom: "1px solid #e1e3e5",
          }}
        >
          <Link
            to="/"
            style={{ fontSize: "13px", color: "#6d7175", textDecoration: "none", display: "flex", alignItems: "center", gap: "4px" }}
          >
            ← Back
          </Link>
          <span style={{ color: "#e1e3e5" }}>|</span>
          <span style={{ fontSize: "15px", fontWeight: 600, color: "#202223", flex: 1 }}>
            {chatSession.title || "Assistant GPT"}
          </span>

          {/* Debug toggle — only visible when debug mode is enabled in Settings */}
          {debugEnabled && (
            <button
              onClick={toggleDebug}
              title={showDebug ? "Hide debug panel" : "Show debug panel"}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "5px",
                padding: "5px 10px",
                fontSize: "12px",
                fontWeight: 600,
                color: showDebug ? "#008060" : "#6d7175",
                background: showDebug ? "#e8f5f0" : "transparent",
                border: `1px solid ${showDebug ? "#008060" : "#e1e3e5"}`,
                borderRadius: "6px",
                cursor: "pointer",
                fontFamily: "inherit",
                transition: "all 0.15s",
              }}
            >
              🐛 Debug
            </button>
          )}
        </div>

        {/* ── Body (messages + optional debug panel) ── */}
        <div style={{ flex: 1, overflow: "hidden", display: "flex" }}>
          {/* Messages */}
          <div
            ref={scrollRef}
            style={{
              flex: 1,
              overflowY: "auto",
              padding: "28px 0",
            }}
          >
            <div style={{ maxWidth: "760px", margin: "0 auto", padding: "0 24px" }}>

              {messages.length === 0 && pendingUserMessage === null && (
                <div style={{ color: "#6d7175", fontSize: "14px", textAlign: "center", padding: "40px 0" }}>
                  <div style={{ fontSize: "28px", marginBottom: "12px" }}>🤖</div>
                  <p style={{ margin: "0 0 6px", fontWeight: 500, color: "#202223" }}>Assistant GPT</p>
                  <p style={{ margin: 0, fontSize: "13px" }}>
                    Ask me anything about your store — themes, products, orders, customers, and more.
                  </p>
                </div>
              )}

              {/* DB messages */}
              {messages.map((msg) => (
                <div key={msg.id} style={{ marginBottom: "24px" }}>
                  {msg.role === "user" ? (
                    <UserMessage content={msg.content} />
                  ) : (
                    <AssistantMessage content={msg.content} />
                  )}
                  {msg.proposalId && proposalMap[msg.proposalId] && (
                    <InlineProposalCard
                      proposal={proposalMap[msg.proposalId]}
                      actionError={
                        pendingProposalIds.has(msg.proposalId) ? actionData?.error : null
                      }
                      isSubmitting={isFormSubmitting}
                    />
                  )}
                </div>
              ))}

              {/* Optimistic user message */}
              {pendingUserMessage !== null && (
                <div style={{ marginBottom: "24px" }}>
                  <UserMessage content={pendingUserMessage} />
                </div>
              )}

              {/* Tool status */}
              {statusText && (
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                    marginBottom: "12px",
                    color: "#6d7175",
                    fontSize: "12px",
                  }}
                >
                  <span
                    style={{
                      display: "inline-block",
                      width: "12px",
                      height: "12px",
                      border: "2px solid #e1e3e5",
                      borderTopColor: "#008060",
                      borderRadius: "50%",
                      animation: "spin 0.8s linear infinite",
                      flexShrink: 0,
                    }}
                  />
                  {statusText}
                </div>
              )}

              {/* Streaming assistant message */}
              {streamingText !== null && (
                <div style={{ marginBottom: "24px" }}>
                  <AssistantMessage content={streamingText} streaming={isSending} />
                  {streamingProposal && (
                    <InlineProposalCard
                      proposal={streamingProposal}
                      isSubmitting={isFormSubmitting}
                    />
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Debug panel */}
          {debugEnabled && showDebug && (
            <DebugPanel
              toolCalls={debugCalls}
              graphqlCalls={graphqlCalls}
              shop={chatSession.shop}
              onClear={() => { setDebugCalls([]); setGraphqlCalls([]); }}
            />
          )}
        </div>

        {/* ── Input ── */}
        <div
          style={{
            flexShrink: 0,
            padding: "14px 20px",
            borderTop: "1px solid #e1e3e5",
            background: "#fff",
          }}
        >
          <div style={{ maxWidth: "760px", margin: "0 auto" }}>
            <form onSubmit={handleSend}>
              <div style={{ display: "flex", gap: "10px", alignItems: "stretch" }}>
                <textarea
                  ref={textareaRef}
                  name="message"
                  placeholder='Ask anything, e.g. "Create a collection for headphones" or "Show my top orders this week"'
                  rows={2}
                  required
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      e.currentTarget.form.requestSubmit();
                    }
                  }}
                  style={{
                    flex: 1,
                    padding: "10px 14px",
                    fontSize: "14px",
                    background: "#fff",
                    color: "#202223",
                    border: "1px solid #c9cccf",
                    borderRadius: "8px",
                    resize: "none",
                    fontFamily: "inherit",
                    lineHeight: "1.5",
                    outline: "none",
                  }}
                />
                <button
                  type="submit"
                  disabled={isSending}
                  style={{
                    padding: "0 20px",
                    background: isSending ? "#95c4b8" : "#008060",
                    color: "#fff",
                    border: "none",
                    borderRadius: "8px",
                    fontWeight: 600,
                    fontSize: "14px",
                    cursor: isSending ? "not-allowed" : "pointer",
                    fontFamily: "inherit",
                    whiteSpace: "nowrap",
                    transition: "background 0.15s",
                  }}
                >
                  {isSending ? "…" : "Send"}
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>
    </AppProvider>
  );
}

// ─── Message sub-components ──────────────────────────────────────────────────

function UserMessage({ content }) {
  return (
    <div style={{ display: "flex", justifyContent: "flex-end" }}>
      <div
        style={{
          maxWidth: "72%",
          padding: "10px 14px",
          borderRadius: "18px 18px 4px 18px",
          background: "#008060",
          color: "#fff",
          fontSize: "14px",
          lineHeight: "1.55",
        }}
      >
        {content}
      </div>
    </div>
  );
}

function AssistantMessage({ content, streaming }) {
  return (
    <div style={{ fontSize: "14px", color: "#202223", lineHeight: "1.65" }}>
      <Markdown>{content}</Markdown>
      {streaming && (
        <span
          style={{
            display: "inline-block",
            width: "2px",
            height: "14px",
            background: "#6d7175",
            marginLeft: "2px",
            verticalAlign: "text-bottom",
            animation: "blink 1s step-end infinite",
          }}
        />
      )}
    </div>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};