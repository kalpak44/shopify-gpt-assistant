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
    !canReadThemes  && "⚠️ Theme read access not granted — do not attempt to list or read theme files.",
    !canWriteThemes && "⚠️ Theme write access not granted — do not propose theme file changes; guide the merchant to use the Theme Editor or Shopify CLI instead.",
  ].filter(Boolean).join("\n");

  return `You are a helpful AI assistant embedded in a Shopify admin app called Assistant GPT.
You help merchants manage their entire Shopify store — themes, orders, products, customers, discounts, metaobjects, markets, finances, analytics, and more.
You have access to tools that let you read and modify theme files, and run any Shopify Admin GraphQL query or mutation.

${permissionNotes}

${loadKnowledge()}`;
}

// ─── Normalized tool definitions ─────────────────────────────────────────────

export const TOOL_DEFS = [
  ...PRODUCT_TOOL_DEFS, // app/tools/products
  ...THEME_TOOL_DEFS,   // app/tools/themes
  ...GRAPHQL_TOOL_DEFS, // app/tools/graphql
];

// ─── OpenAI-compatible agent loop ────────────────────────────────────────────

async function streamOpenAITurn({
  baseUrl, apiToken, modelName, messages, tools, onChunk, isCancelled,
}) {
  const resp = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiToken}`,
    },
    body: JSON.stringify({ model: modelName, messages, tools, stream: true }),
  });

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`OpenAI API ${resp.status}: ${err.slice(0, 300)}`);
  }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let textContent = "";
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

  return { textContent, toolCalls, assistantMsg };
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

  for (let turn = 0; turn < 8; turn++) {
    const { textContent, toolCalls, assistantMsg } = await streamOpenAITurn({
      baseUrl, apiToken, modelName, messages, tools, onChunk, isCancelled,
    });

    if (toolCalls.length === 0) return textContent;

    messages.push(assistantMsg);

    for (const tc of toolCalls) {
      if (isCancelled()) return textContent;
      onStatus(tc.name);
      let result;
      try { result = await executeTool(tc.name, tc.args); }
      catch (err) { result = { error: err.message }; }
      messages.push({
        role: "tool",
        tool_call_id: tc.id,
        content: typeof result === "string" ? result : JSON.stringify(result),
      });
    }
  }

  const msg = " [Max tool iterations reached]";
  onChunk(msg);
  return msg;
}

// ─── Anthropic agent loop ────────────────────────────────────────────────────

async function streamAnthropicTurn({
  baseUrl, apiToken, modelName, systemMsg, messages, tools, onChunk, isCancelled,
}) {
  const resp = await fetch(`${baseUrl}/v1/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiToken,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: modelName,
      system: systemMsg,
      messages,
      tools,
      stream: true,
      max_tokens: 2048,
    }),
  });

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Anthropic API ${resp.status}: ${err.slice(0, 300)}`);
  }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let textContent = "";
  const blockMap = {}; // index -> { type, id, name, inputStr }

  while (true) {
    if (isCancelled()) break;
    const { done, value } = await reader.read();
    if (done) break;

    buf += decoder.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      let evt;
      try { evt = JSON.parse(line.slice(6)); } catch { continue; }

      if (evt.type === "content_block_start") {
        blockMap[evt.index] = {
          type: evt.content_block.type,
          id: evt.content_block.id ?? "",
          name: evt.content_block.name ?? "",
          inputStr: "",
        };
      } else if (evt.type === "content_block_delta") {
        const block = blockMap[evt.index];
        if (!block) continue;
        if (evt.delta.type === "text_delta") {
          textContent += evt.delta.text;
          onChunk(evt.delta.text);
        } else if (evt.delta.type === "input_json_delta") {
          block.inputStr += evt.delta.partial_json;
        }
      }
    }
  }

  const toolUses = Object.values(blockMap)
    .filter((b) => b.type === "tool_use")
    .map((b) => {
      let args = {};
      try { args = JSON.parse(b.inputStr || "{}"); } catch { /* ignore */ }
      return { id: b.id, name: b.name, args };
    });

  return { textContent, toolUses };
}

async function runAnthropicAgentLoop({
  baseUrl, apiToken, modelName, scopes, history, executeTool, onChunk, onStatus, isCancelled,
}) {
  const messages = history
    .filter((m) => m.role !== "system")
    .map((m) => ({ role: m.role, content: m.content }));
  const tools = TOOL_DEFS.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.parameters,
  }));

  for (let turn = 0; turn < 8; turn++) {
    const { textContent, toolUses } = await streamAnthropicTurn({
      baseUrl, apiToken, modelName, systemMsg: buildSystemPrompt(scopes),
      messages, tools, onChunk, isCancelled,
    });

    if (toolUses.length === 0) return textContent;

    messages.push({
      role: "assistant",
      content: toolUses.map((tu) => ({
        type: "tool_use",
        id: tu.id,
        name: tu.name,
        input: tu.args,
      })),
    });

    const toolResults = [];
    for (const tu of toolUses) {
      if (isCancelled()) return textContent;
      onStatus(tu.name);
      let result;
      try { result = await executeTool(tu.name, tu.args); }
      catch (err) { result = { error: err.message }; }
      toolResults.push({
        type: "tool_result",
        tool_use_id: tu.id,
        content: typeof result === "string" ? result : JSON.stringify(result),
      });
    }
    messages.push({ role: "user", content: toolResults });
  }

  const msg = " [Max tool iterations reached]";
  onChunk(msg);
  return msg;
}

// ─── Session title generator ─────────────────────────────────────────────────

export async function generateSessionTitle(config, userMessage, aiResponse) {
  const baseUrl = config.baseUrl ?? "https://api.openai.com/v1";
  const modelName = config.modelName ?? "gpt-4o";
  const userSnippet = userMessage.slice(0, 300);
  const aiSnippet = aiResponse.slice(0, 300);
  const prompt = `User: ${userSnippet}\nAssistant: ${aiSnippet}`;

  try {
    if (config.provider === "anthropic") {
      const resp = await fetch(`${baseUrl}/v1/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": config.apiToken,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: modelName,
          system: "Reply with ONLY a 2-3 word title in title case. No punctuation, no quotes, no explanation.",
          messages: [{ role: "user", content: prompt }],
          max_tokens: 16,
        }),
      });
      if (!resp.ok) return null;
      const data = await resp.json();
      return data.content?.[0]?.text?.trim().slice(0, 50) ?? null;
    }

    const resp = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiToken}`,
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
  config,
  scopes,
  history,
  executeTool,
  onChunk,
  onStatus = () => {},
  isCancelled = () => false,
}) {
  const baseUrl = config.baseUrl ?? "https://api.openai.com/v1";
  const modelName = config.modelName ?? "gpt-4o";

  if (config.provider === "anthropic") {
    return runAnthropicAgentLoop({
      baseUrl, apiToken: config.apiToken, modelName, scopes,
      history, executeTool, onChunk, onStatus, isCancelled,
    });
  }

  return runOpenAIAgentLoop({
    baseUrl, apiToken: config.apiToken, modelName, scopes,
    history, executeTool, onChunk, onStatus, isCancelled,
  });
}