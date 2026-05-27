import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { runAgentLoop } from "../ai.server";
import { getMainTheme, readThemeFile, listThemeFiles, shopifyGraphql } from "../theme.server";
import { generateUnifiedDiff } from "../diff.server";
import { executeProductTool } from "../tools/products/index.js";

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

export const action = async ({ request, params }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const { accessToken } = session;
  const { sessionId } = params;

  console.log(`[chat/${sessionId}] session resolved — shop: ${shop}, hasToken: ${!!accessToken}, scope: ${session.scope}`);

  if (!shop || !accessToken) {
    console.error(`[chat/${sessionId}] session missing shop or accessToken — aborting`);
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

      let fullText = "";
      let createdProposalId = null;

      // Cache theme lookup to avoid redundant Shopify API calls per request
      let cachedTheme = null;
      const getTheme = async () => {
        if (!cachedTheme) cachedTheme = await getMainTheme(shop, accessToken);
        return cachedTheme;
      };

      const executeTool = async (name, args) => {
        console.log(`[chat/${sessionId}] tool →`, name, JSON.stringify(args).slice(0, 120));

        // Product tools
        const productResult = await executeProductTool(name, args, { shop, accessToken, shopifyGraphql });
        if (productResult !== null) return productResult;

        if (name === "get_current_datetime") {
          const now = new Date();
          return {
            iso: now.toISOString(),
            utcOffset: 0,
            readable: now.toUTCString(),
          };
        }

        if (name === "get_active_theme") {
          const theme = await getTheme();
          return { id: theme.id, name: theme.name };
        }

        if (name === "list_theme_files") {
          const theme = await getTheme();
          const files = await listThemeFiles(shop, accessToken, theme.id, args.prefix ?? null);
          return files;
        }

        if (name === "read_theme_file") {
          const theme = await getTheme();
          const fileContent = await readThemeFile(shop, accessToken, theme.id, args.path);
          return fileContent ?? `File not found: ${args.path}`;
        }

        if (name === "propose_file_change") {
          const theme = await getTheme();
          const before = (await readThemeFile(shop, accessToken, theme.id, args.path)) ?? "";
          const diff = generateUnifiedDiff(before, args.new_content, args.path);

          const proposal = await prisma.changeProposal.create({
            data: {
              sessionId,
              shop,
              themeId: theme.id,
              status: "pending",
              summary: args.summary,
              files: [{ path: args.path, before, after: args.new_content, diff }],
            },
          });

          createdProposalId = proposal.id;

          // Push the inline proposal card to the client immediately
          send({
            type: "proposal",
            proposalId: proposal.id,
            summary: args.summary,
            files: [{ path: args.path, diff }],
          });

          return {
            success: true,
            message: "Proposal created and shown to the merchant for review.",
          };
        }

        if (name === "shopify_graphql_query") {
          const { data, errors } = await shopifyGraphql(shop, accessToken, args.query, args.variables ?? {});
          if (errors?.length) return { error: errors.map((e) => e.message).join(", ") };
          return data;
        }

        if (name === "shopify_graphql_mutation") {
          const { data, errors } = await shopifyGraphql(shop, accessToken, args.mutation, args.variables ?? {});
          if (errors?.length) return { error: errors.map((e) => e.message).join(", ") };
          return data;
        }

        return { error: `Unknown tool: ${name}` };
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

      await Promise.all([
        prisma.chatMessage.create({
          data: { sessionId, role: "assistant", content: fullText, proposalId: createdProposalId },
        }),
        prisma.chatSession.update({
          where: { id: sessionId },
          data: { updatedAt: new Date() },
        }),
      ]);

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