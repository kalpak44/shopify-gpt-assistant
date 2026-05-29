import { authenticate, refreshOfflineToken } from "../shopify.server";
import prisma from "../db.server";
import { runAgentLoop, isAIConfigured, friendlyAIError } from "../ai.server";
import { getMainTheme, shopifyGraphql } from "../theme.server";
import { executeProductTool } from "../tools/products/index.js";
import { executeThemeTool } from "../tools/themes/index.js";
import { executeGraphqlTool } from "../tools/graphql/index.js";
import { getOrCreateSubscription } from "../subscription.server.js";
import { getPlanModel } from "../plans.js";

/** Trim large tool results before sending over SSE debug events. */
function limitResult(result) {
  if (result === null || result === undefined) return result;
  if (typeof result === "string")
    return result.length > 2000 ? result.slice(0, 2000) + "…[truncated]" : result;
  const json = JSON.stringify(result);
  if (json.length > 4000) {
    if (Array.isArray(result))
      return { _note: `Array[${result.length}] - showing first 3`, _preview: result.slice(0, 3) };
    return { _note: "Result truncated", _preview: json.slice(0, 2000) };
  }
  return result;
}

const NO_CONFIG_MSG =
  "The AI service is not configured. Please contact the app administrator.";

const TOOL_STATUS = {
  // Products
  product_list: "Searching products…",
  product_get: "Fetching product…",
  product_create: "Creating product…",
  product_update: "Updating product…",
  product_delete: "Deleting product…",
  product_variants_create: "Creating variants…",
  product_variants_update: "Updating variants…",
  // Theme
  get_current_datetime: "Checking current date…",
  get_active_theme: "Checking active theme…",
  list_theme_files: "Listing theme files…",
  read_theme_file: "Reading theme file…",
  propose_file_change: "Creating proposal…",
  // Generic GraphQL
  shopify_schema_lookup: "Looking up schema…",
  shopify_graphql_query: "Querying store data…",
  shopify_graphql_mutation: "Applying change…",
};

export const action = async ({ request, params }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  // let so it can be updated if the offline token is rotated mid-stream
  let accessToken = session.accessToken;
  const { sessionId } = params;

  console.log(`[chat/${sessionId}] session resolved - shop: ${shop}, hasToken: ${!!accessToken}, scope: ${session.scope}`);

  if (!shop || !accessToken) {
    console.error(`[chat/${sessionId}] session missing shop or accessToken - aborting`);
    return new Response("Unauthorized", { status: 401 });
  }

  const chatSession = await prisma.chatSession.findFirst({
    where: { id: sessionId, shop },
  });
  if (!chatSession) return new Response("Not found", { status: 404 });

  const formData = await request.formData();
  const content = (formData.get("message") ?? "").toString().trim();
  if (!content) return new Response("Bad request", { status: 400 });

  // Persist user message first so it appears in the history sent to the AI
  await prisma.chatMessage.create({
    data: { sessionId, role: "user", content },
  });

  const [subscription, history] = await Promise.all([
    getOrCreateSubscription(shop),
    prisma.chatMessage.findMany({
      where: { sessionId },
      orderBy: { createdAt: "asc" },
      take: 40,
    }),
  ]);

  const modelName = getPlanModel(subscription.plan);
  const debug = subscription.debugEnabled;

  const encoder = new TextEncoder();
  let cancelled = false;

  const body = new ReadableStream({
    async start(controller) {
      const send = (evt) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(evt)}\n\n`));

      let fullText = "";
      let createdProposalId = null;

      let debugSeq = 0;
      let graphqlSeq = 0;

      const instrumentedGraphql = async (s, _token, query, variables = {}) => {
        const seq = ++graphqlSeq;
        const operation = query.match(/(?:query|mutation)\s+(\w+)/)?.[1] ?? "anonymous";
        const opType = /^\s*mutation/i.test(query) ? "mutation" : "query";
        if (debug) {
          const evt = { type: "debug", kind: "graphql_call", seq, operation, opType, query, variables };
          console.log(`[chat/${sessionId}] debug:graphql_call`, operation, opType);
          send(evt);
        }
        const t0 = Date.now();

        const attempt = async (token) => {
          const result = await shopifyGraphql(s, token, query, variables);
          if (debug) {
            const evt = { type: "debug", kind: "graphql_result", seq, response: limitResult(result), durationMs: Date.now() - t0 };
            console.log(`[chat/${sessionId}] debug:graphql_result`, operation, `${Date.now() - t0}ms`);
            send(evt);
          }
          return result;
        };

        try {
          return await attempt(accessToken);
        } catch (err) {
          if (err.message?.includes("401")) {
            // 1. Check if a concurrent request already rotated the token in storage.
            // 2. If not, attempt an explicit OAuth token refresh.
            const stored = await prisma.session.findFirst({
              where: { shop, isOnline: false },
              select: { accessToken: true },
            });
            const freshToken =
              stored?.accessToken && stored.accessToken !== accessToken
                ? stored.accessToken
                : await refreshOfflineToken(shop);
            if (freshToken) {
              accessToken = freshToken;
              try {
                return await attempt(accessToken);
              } catch (retryErr) {
                if (debug) {
                  console.log(`[chat/${sessionId}] debug:graphql_error`, operation, retryErr.message);
                  send({ type: "debug", kind: "graphql_error", seq, error: retryErr.message, durationMs: Date.now() - t0 });
                }
                throw retryErr;
              }
            }
          }
          if (debug) {
            console.log(`[chat/${sessionId}] debug:graphql_error`, operation, err.message);
            send({ type: "debug", kind: "graphql_error", seq, error: err.message, durationMs: Date.now() - t0 });
          }
          throw err;
        }
      };

      // Cache theme lookup to avoid redundant Shopify API calls per request
      let cachedTheme = null;
      const getTheme = async () => {
        if (!cachedTheme) cachedTheme = await getMainTheme(shop, accessToken, instrumentedGraphql);
        return cachedTheme;
      };

      const executeToolImpl = async (name, args) => {
        // Product tools - app/tools/products
        const productResult = await executeProductTool(name, args, { shop, accessToken, shopifyGraphql: instrumentedGraphql });
        if (productResult !== null) return productResult;

        // Theme + datetime tools - app/tools/themes
        const themeResult = await executeThemeTool(name, args, {
          shop,
          accessToken,
          getTheme,
          sessionId,
          onProposal: ({ proposalId, summary, files }) => {
            createdProposalId = proposalId;
            send({ type: "proposal", proposalId, summary, files });
          },
          shopifyGraphql: instrumentedGraphql,
        });
        if (themeResult !== null) return themeResult;

        // Generic GraphQL passthrough - app/tools/graphql
        const graphqlResult = await executeGraphqlTool(name, args, { shop, accessToken, shopifyGraphql: instrumentedGraphql });
        if (graphqlResult !== null) return graphqlResult;

        return { error: `Unknown tool: ${name}` };
      };

      const executeTool = async (name, args) => {
        const seq = ++debugSeq;
        console.log(`[chat/${sessionId}] tool →`, name, JSON.stringify(args).slice(0, 120));
        if (debug) send({ type: "debug", kind: "call", tool: name, args, seq });
        const t0 = Date.now();
        try {
          const result = await executeToolImpl(name, args);
          if (debug) {
            console.log(`[chat/${sessionId}] debug:result`, name, `${Date.now() - t0}ms`);
            send({ type: "debug", kind: "result", tool: name, result: limitResult(result), durationMs: Date.now() - t0, seq });
          }
          return result;
        } catch (err) {
          if (debug) {
            console.log(`[chat/${sessionId}] debug:error`, name, err.message);
            send({ type: "debug", kind: "error", tool: name, error: err.message, durationMs: Date.now() - t0, seq });
          }
          throw err;
        }
      };

      let agentUsage = null;

      if (!isAIConfigured()) {
        for (const char of NO_CONFIG_MSG) {
          if (cancelled) break;
          send({ type: "chunk", text: char });
          await new Promise((r) => setTimeout(r, 18));
        }
        fullText = NO_CONFIG_MSG;
      } else {
        try {
          const result = await runAgentLoop({
            modelName,
            scopes: subscription.aiScopes ?? session.scope,
            history,
            executeTool,
            onChunk: (text) => send({ type: "chunk", text }),
            onStatus: (toolName) =>
              send({ type: "status", text: TOOL_STATUS[toolName] ?? `Running ${toolName}…` }),
            isCancelled: () => cancelled,
          });
          fullText = result.text;
          agentUsage = result.usage;
        } catch (err) {
          fullText = friendlyAIError(err) ?? `**Error:** ${err.message}`;
          send({ type: "chunk", text: fullText });
        }
      }

      const writes = [
        prisma.chatMessage.create({
          data: { sessionId, role: "assistant", content: fullText, proposalId: createdProposalId },
        }),
        prisma.chatSession.update({
          where: { id: sessionId },
          data: { updatedAt: new Date() },
        }),
      ];
      if (agentUsage?.totalTokens > 0) {
        writes.push(
          prisma.tokenUsage.create({
            data: {
              shop,
              sessionId,
              model: modelName,
              promptTokens: agentUsage.promptTokens,
              completionTokens: agentUsage.completionTokens,
              totalTokens: agentUsage.totalTokens,
            },
          })
        );
      }
      await Promise.all(writes);

      send({ type: "done" });
      controller.close();
    },
    cancel() {
      cancelled = true;
    },
  });

  return new Response(body, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "X-Accel-Buffering": "no",
    },
  });
};