import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { runAgentLoop, generateSessionTitle } from "../ai.server";
import { getMainTheme, shopifyGraphql } from "../theme.server";
import { executeProductTool } from "../tools/products/index.js";
import { executeThemeTool } from "../tools/themes/index.js";
import { executeGraphqlTool } from "../tools/graphql/index.js";

const DEBUG = process.env.DEBUGG === "true";

function limitResult(result) {
  if (result === null || result === undefined) return result;
  if (typeof result === "string")
    return result.length > 2000 ? result.slice(0, 2000) + "…[truncated]" : result;
  const json = JSON.stringify(result);
  if (json.length > 4000) {
    if (Array.isArray(result))
      return { _note: `Array[${result.length}] — showing first 3`, _preview: result.slice(0, 3) };
    return { _note: "Result truncated", _preview: json.slice(0, 2000) };
  }
  return result;
}

const NO_CONFIG_MSG =
  "No AI provider configured. Please go to **Settings** and add your API token.";

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
  shopify_graphql_query: "Querying store data…",
  shopify_graphql_mutation: "Applying change…",
};

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const { accessToken } = session;

  if (!shop || !accessToken) return new Response("Unauthorized", { status: 401 });

  const formData = await request.formData();
  const content = (formData.get("message") ?? "").toString().trim();
  if (!content) return new Response("Bad request", { status: 400 });

  const chatSession = await prisma.chatSession.create({
    data: { shop, title: "New session", status: "open" },
  });
  const sessionId = chatSession.id;

  await prisma.chatMessage.create({
    data: { sessionId, role: "user", content },
  });

  const [config, history] = await Promise.all([
    prisma.assistantConfig.findUnique({ where: { shop } }),
    prisma.chatMessage.findMany({
      where: { sessionId },
      orderBy: { createdAt: "asc" },
      take: 40,
    }),
  ]);

  const encoder = new TextEncoder();
  let cancelled = false;

  const body = new ReadableStream({
    async start(controller) {
      const send = (evt) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(evt)}\n\n`));

      send({ type: "created", sessionId });

      let fullText = "";
      let createdProposalId = null;

      let cachedTheme = null;
      const getTheme = async () => {
        if (!cachedTheme) cachedTheme = await getMainTheme(shop, accessToken);
        return cachedTheme;
      };

      let debugSeq = 0;

      const executeToolImpl = async (name, args) => {
        // Product tools — app/tools/products
        const productResult = await executeProductTool(name, args, { shop, accessToken, shopifyGraphql });
        if (productResult !== null) return productResult;

        // Theme + datetime tools — app/tools/themes
        const themeResult = await executeThemeTool(name, args, {
          shop,
          accessToken,
          getTheme,
          sessionId,
          onProposal: ({ proposalId, summary, files }) => {
            createdProposalId = proposalId;
            send({ type: "proposal", proposalId, summary, files });
          },
        });
        if (themeResult !== null) return themeResult;

        // Generic GraphQL passthrough — app/tools/graphql
        const graphqlResult = await executeGraphqlTool(name, args, { shop, accessToken, shopifyGraphql });
        if (graphqlResult !== null) return graphqlResult;

        return { error: `Unknown tool: ${name}` };
      };

      const executeTool = async (name, args) => {
        const seq = ++debugSeq;
        console.log(`[chat/new→${sessionId}] tool →`, name, JSON.stringify(args).slice(0, 120));
        if (DEBUG) send({ type: "debug", kind: "call", tool: name, args, seq });
        const t0 = Date.now();
        try {
          const result = await executeToolImpl(name, args);
          if (DEBUG) send({ type: "debug", kind: "result", tool: name, result: limitResult(result), durationMs: Date.now() - t0, seq });
          return result;
        } catch (err) {
          if (DEBUG) send({ type: "debug", kind: "error", tool: name, error: err.message, durationMs: Date.now() - t0, seq });
          throw err;
        }
      };

      if (!config?.apiToken) {
        for (const char of NO_CONFIG_MSG) {
          if (cancelled) break;
          send({ type: "chunk", text: char });
          await new Promise((r) => setTimeout(r, 18));
        }
        fullText = NO_CONFIG_MSG;
      } else {
        try {
          fullText = await runAgentLoop({
            config,
            scopes: session.scope,
            history,
            executeTool,
            onChunk: (text) => send({ type: "chunk", text }),
            onStatus: (toolName) =>
              send({ type: "status", text: TOOL_STATUS[toolName] ?? `Running ${toolName}…` }),
            isCancelled: () => cancelled,
          });
        } catch (err) {
          fullText = `**Error:** ${err.message}`;
          send({ type: "chunk", text: fullText });
        }
      }

      await prisma.chatMessage.create({
        data: { sessionId, role: "assistant", content: fullText, proposalId: createdProposalId },
      });

      // Generate a short title from the first exchange
      let title = "New session";
      if (config?.apiToken) {
        title = (await generateSessionTitle(config, content, fullText)) ?? title;
      }
      await prisma.chatSession.update({
        where: { id: sessionId },
        data: { title },
      });

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