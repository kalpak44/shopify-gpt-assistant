import { useEffect, useRef, useState } from "react";
import { useLoaderData, useNavigate, useRouteError, Link } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";
import { authenticate } from "../shopify.server";
import { Markdown } from "../markdown.jsx";

export const loader = async ({ request }) => {
  await authenticate.admin(request);
  return { apiKey: process.env.SHOPIFY_API_KEY || "" };
};

export default function NewSession() {
  const { apiKey } = useLoaderData();
  const navigate = useNavigate();

  const [isSending, setIsSending] = useState(false);
  const [pendingUserMessage, setPendingUserMessage] = useState(null);
  const [streamingText, setStreamingText] = useState(null);
  const [statusText, setStatusText] = useState(null);

  const textareaRef = useRef(null);
  const scrollRef = useRef(null);
  const createdSessionIdRef = useRef(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [streamingText, pendingUserMessage]);

  const handleSend = async (e) => {
    e.preventDefault();
    const message = textareaRef.current?.value.trim();
    if (!message || isSending) return;

    textareaRef.current.value = "";
    setPendingUserMessage(message);
    setStreamingText("");
    setIsSending(true);

    try {
      const resp = await fetch("/api/chat/new", {
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
            if (evt.type === "created") {
              createdSessionIdRef.current = evt.sessionId;
            } else if (evt.type === "chunk") {
              setStatusText(null);
              setStreamingText((t) => (t ?? "") + evt.text);
            } else if (evt.type === "status") {
              setStatusText(evt.text);
            } else if (evt.type === "done") {
              setStatusText(null);
              setIsSending(false);
              if (createdSessionIdRef.current) {
                navigate(`/assistant/${createdSessionIdRef.current}`, { replace: true });
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
      if (createdSessionIdRef.current) {
        navigate(`/assistant/${createdSessionIdRef.current}`, { replace: true });
      }
    }
  };

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
        {/* Header */}
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
          <span style={{ fontSize: "15px", fontWeight: 600, color: "#202223" }}>
            New session
          </span>
        </div>

        {/* Messages */}
        <div ref={scrollRef} style={{ flex: 1, overflowY: "auto", padding: "28px 0" }}>
          <div style={{ maxWidth: "760px", margin: "0 auto", padding: "0 24px" }}>

            {pendingUserMessage === null && (
              <div style={{ color: "#6d7175", fontSize: "14px", textAlign: "center", padding: "40px 0" }}>
                <div style={{ fontSize: "28px", marginBottom: "12px" }}>🤖</div>
                <p style={{ margin: "0 0 6px", fontWeight: 500, color: "#202223" }}>Assistant GPT</p>
                <p style={{ margin: 0, fontSize: "13px" }}>
                  Ask me anything about your store - themes, products, orders, customers, and more.
                </p>
              </div>
            )}

            {pendingUserMessage !== null && (
              <div style={{ marginBottom: "24px" }}>
                <div style={{ display: "flex", justifyContent: "flex-end" }}>
                  <div
                    style={{
                      maxWidth: "72%",
                      padding: "10px 14px",
                      borderRadius: "18px 18px 4px 18px",
                      background: "#303030",
                      color: "#fff",
                      fontSize: "14px",
                      lineHeight: "1.55",
                    }}
                  >
                    {pendingUserMessage}
                  </div>
                </div>
              </div>
            )}

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
                    borderTopColor: "#303030",
                    borderRadius: "50%",
                    animation: "spin 0.8s linear infinite",
                    flexShrink: 0,
                  }}
                />
                {statusText}
              </div>
            )}

            {streamingText !== null && (
              <div style={{ marginBottom: "24px" }}>
                <div style={{ fontSize: "14px", color: "#202223", lineHeight: "1.65" }}>
                  <Markdown>{streamingText}</Markdown>
                  {isSending && (
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
              </div>
            )}
          </div>
        </div>

        {/* Input */}
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
                  disabled={isSending}
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
                    background: isSending ? "#6b6b6b" : "#303030",
                    color: "#fff",
                    border: "none",
                    borderRadius: "8px",
                    fontWeight: 600,
                    fontSize: "14px",
                    cursor: isSending ? "not-allowed" : "pointer",
                    fontFamily: "inherit",
                    whiteSpace: "nowrap",
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

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};