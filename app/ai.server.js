import { readFileSync, readdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { PRODUCT_TOOL_DEFS } from "./tools/products/index.js";
import { THEME_TOOL_DEFS } from "./tools/themes/index.js";
import { GRAPHQL_TOOL_DEFS } from "./tools/graphql/index.js";

const _dir = dirname(fileURLToPath(import.meta.url));
const KNOWLEDGE_DIR = join(_dir, "..", "docs", "2026-04");

function loadKnowledge() {
  try {
    return readdirSync(KNOWLEDGE_DIR)
      .filter((f) => f.endsWith(".md"))
      .sort()
      .map((f) => readFileSync(join(KNOWLEDGE_DIR, f), "utf-8"))
      .join("\n\n");
  } catch {
    return "";
  }
}

function buildSystemPrompt(scopes) {
  const scopeList = (scopes ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const has = (...ss) => scopeList.length === 0 || ss.some((s) => scopeList.includes(s));

  const canReadThemes  = has("read_themes", "write_themes");
  const canWriteThemes = has("write_themes");

  const permissionNotes = [
    `Granted OAuth scopes: ${scopeList.length ? scopeList.join(", ") : "unknown (assume full access)"}`,
    !canReadThemes  && "⚠️ Theme read access not granted - do not attempt to list or read theme files.",
    !canWriteThemes && "⚠️ Theme write access not granted - do not propose theme file changes; guide the merchant to use the Theme Editor or Shopify CLI instead.",
  ].filter(Boolean).join("\n");

  return `You are a helpful AI assistant embedded in a Shopify admin app called Assistant GPT.
You help merchants manage their entire Shopify store - themes, orders, products, customers, discounts, metaobjects, markets, finances, analytics, and more.
You have access to tools that let you read and modify theme files, and run any Shopify Admin GraphQL query or mutation.

## GraphQL workflow
Before writing any query or mutation you MUST use shopify_schema_lookup to research the schema:
1. Look up QueryRoot (for queries) or Mutation (for mutations) with a field_filter to find the relevant operation.
2. Look up the specific return type to discover available fields and connection shapes.
3. Only then construct and run the query or mutation with the confirmed field names.
This prevents field-name errors and ensures you use the correct argument types and pagination patterns.

${permissionNotes}

${loadKnowledge()}`;
}

// ─── Normalized tool definitions ─────────────────────────────────────────────

export const TOOL_DEFS = [
  ...PRODUCT_TOOL_DEFS, // app/tools/products
  ...THEME_TOOL_DEFS,   // app/tools/themes
  ...GRAPHQL_TOOL_DEFS, // app/tools/graphql
];

// ─── Credentials from environment ────────────────────────────────────────────

function getOpenAICredentials() {
  return {
    baseUrl: (process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1").replace(/\/$/, ""),
    apiToken: process.env.OPENAI_API_KEY ?? "",
  };
}

export function isAIConfigured() {
  return Boolean(process.env.OPENAI_API_KEY);
}

/**
 * Maps raw API errors to user-friendly chat messages.
 * Returns null if the error should surface as-is.
 */
export function friendlyAIError(err) {
  if (/API 429|rate.?limit|token.*limit|quota/i.test(err.message)) {
    return "I've hit the AI rate limit for this moment — the model is temporarily out of capacity. This usually clears in a few seconds. If it keeps happening, upgrading to a higher plan gives you access to a larger token quota and a more capable model. You can do that in **[Settings → Subscription](/assistant/settings)**.";
  }
  return null;
}

// ─── OpenAI streaming turn ───────────────────────────────────────────────────

async function streamOpenAITurn({
  baseUrl, apiToken, modelName, messages, tools, onChunk, isCancelled,
}) {
  const resp = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiToken}`,
    },
    body: JSON.stringify({
      model: modelName,
      messages,
      tools,
      stream: true,
      stream_options: { include_usage: true },
    }),
  });

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`OpenAI API ${resp.status}: ${err.slice(0, 300)}`);
  }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let textContent = "";
  let usage = null;
  const tcMap = {}; // index -> { id, name, argsStr }

  while (true) {
    if (isCancelled()) break;
    const { done, value } = await reader.read();
    if (done) break;

    buf += decoder.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const payload = line.slice(6).trim();
      if (payload === "[DONE]") continue;
      let chunk;
      try { chunk = JSON.parse(payload); } catch { continue; }

      // Capture usage from the final usage-only chunk
      if (chunk.usage) {
        usage = {
          promptTokens: chunk.usage.prompt_tokens ?? 0,
          completionTokens: chunk.usage.completion_tokens ?? 0,
          totalTokens: chunk.usage.total_tokens ?? 0,
        };
      }

      const delta = chunk.choices?.[0]?.delta;
      if (!delta) continue;

      if (delta.content) {
        textContent += delta.content;
        onChunk(delta.content);
      }

      if (delta.tool_calls) {
        for (const tc of delta.tool_calls) {
          const idx = tc.index;
          if (!tcMap[idx]) tcMap[idx] = { id: "", name: "", argsStr: "" };
          if (tc.id) tcMap[idx].id = tc.id;
          if (tc.function?.name) tcMap[idx].name += tc.function.name;
          if (tc.function?.arguments) tcMap[idx].argsStr += tc.function.arguments;
        }
      }
    }
  }

  const toolCalls = Object.values(tcMap).map((tc) => {
    let args = {};
    try { args = JSON.parse(tc.argsStr || "{}"); } catch { /* ignore */ }
    return { id: tc.id, name: tc.name, args };
  });

  const assistantMsg = {
    role: "assistant",
    content: textContent || null,
    ...(toolCalls.length > 0 && {
      tool_calls: toolCalls.map((tc) => ({
        id: tc.id,
        type: "function",
        function: { name: tc.name, arguments: JSON.stringify(tc.args) },
      })),
    }),
  };

  return { textContent, toolCalls, assistantMsg, usage };
}

const RETRY_DELAYS_MS = [3000, 4000, 5000];

async function withRateLimitRetry(fn) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt >= RETRY_DELAYS_MS.length || !/API 429|rate.?limit|token.*limit|quota/i.test(err.message)) throw err;
      await new Promise((r) => setTimeout(r, RETRY_DELAYS_MS[attempt]));
    }
  }
}

async function runOpenAIAgentLoop({
  baseUrl, apiToken, modelName, scopes, history, executeTool, onChunk, onStatus, isCancelled,
}) {
  const messages = [
    { role: "system", content: buildSystemPrompt(scopes) },
    ...history.map((m) => ({ role: m.role, content: m.content })),
  ];
  const tools = TOOL_DEFS.map((t) => ({
    type: "function",
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }));

  let totalUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

  const maxIter = parseInt(process.env.MAX_TOOL_ITERATIONS ?? "8", 10);
  for (let turn = 0; turn < maxIter; turn++) {
    const { textContent, toolCalls, assistantMsg, usage } = await withRateLimitRetry(() =>
      streamOpenAITurn({ baseUrl, apiToken, modelName, messages, tools, onChunk, isCancelled })
    );

    if (usage) {
      totalUsage.promptTokens     += usage.promptTokens;
      totalUsage.completionTokens += usage.completionTokens;
      totalUsage.totalTokens      += usage.totalTokens;
    }

    if (toolCalls.length === 0) return { text: textContent, usage: totalUsage };

    messages.push(assistantMsg);

    for (const tc of toolCalls) {
      if (isCancelled()) return { text: textContent, usage: totalUsage };
      onStatus(tc.name);
      let result;
      try { result = await executeTool(tc.name, tc.args); }
      catch (err) {
        if (/\b401\b/.test(err.message)) throw err; // let auth errors surface to the caller
        result = { error: err.message };
      }
      messages.push({
        role: "tool",
        tool_call_id: tc.id,
        content: typeof result === "string" ? result : JSON.stringify(result),
      });
    }
  }

  const msg = " [Max tool iterations reached]";
  onChunk(msg);
  return { text: msg, usage: totalUsage };
}

// ─── Session title generator ─────────────────────────────────────────────────

export async function generateSessionTitle(modelName, userMessage, aiResponse) {
  const { baseUrl, apiToken } = getOpenAICredentials();
  if (!apiToken) return null;

  const prompt = `User: ${userMessage.slice(0, 300)}\nAssistant: ${aiResponse.slice(0, 300)}`;

  try {
    const resp = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiToken}`,
      },
      body: JSON.stringify({
        model: modelName,
        messages: [
          { role: "system", content: "Reply with ONLY a 2-3 word title in title case. No punctuation, no quotes, no explanation." },
          { role: "user", content: prompt },
        ],
        max_tokens: 16,
      }),
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    return data.choices?.[0]?.message?.content?.trim().slice(0, 50) ?? null;
  } catch {
    return null;
  }
}

// ─── Public API ──────────────────────────────────────────────────────────────

export async function runAgentLoop({
  modelName,
  scopes,
  history,
  executeTool,
  onChunk,
  onStatus = () => {},
  isCancelled = () => false,
}) {
  const { baseUrl, apiToken } = getOpenAICredentials();
  return runOpenAIAgentLoop({
    baseUrl, apiToken, modelName, scopes,
    history, executeTool, onChunk, onStatus, isCancelled,
  });
}