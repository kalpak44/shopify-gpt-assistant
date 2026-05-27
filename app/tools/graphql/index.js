// ─── Tool definitions ─────────────────────────────────────────────────────────
// Registered in ai.server.js TOOL_DEFS and exposed to the AI.

export const GRAPHQL_TOOL_DEFS = [
  {
    name: "shopify_graphql_query",
    description:
      "Run any Shopify Admin GraphQL query to read store data — orders, products, customers, discounts, metaobjects, inventory, markets, finances, analytics, fulfillments, shipping, gift cards, reports, etc. Construct a valid GraphQL query and optionally pass variables.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "The GraphQL query string" },
        variables: {
          type: "object",
          description: "Optional query variables",
        },
      },
      required: ["query"],
    },
  },

  {
    name: "shopify_graphql_mutation",
    description:
      "Run a Shopify Admin GraphQL mutation to create, update, or delete store data. IMPORTANT: you MUST describe the change to the merchant and receive explicit confirmation in the conversation before calling this tool. Never run destructive mutations (delete, cancel, refund, bulk delete) without clear merchant approval.",
    parameters: {
      type: "object",
      properties: {
        mutation: { type: "string", description: "The GraphQL mutation string" },
        variables: {
          type: "object",
          description: "Optional mutation variables",
        },
        summary: {
          type: "string",
          description: "One-sentence description of what this mutation does, shown to the merchant",
        },
      },
      required: ["mutation", "summary"],
    },
  },
];

// ─── Tool status labels ───────────────────────────────────────────────────────

export const GRAPHQL_TOOL_STATUS = {
  shopify_graphql_query: "Querying store data…",
  shopify_graphql_mutation: "Applying change…",
};

// ─── Tool handler ─────────────────────────────────────────────────────────────
// Returns null for unknown tool names so the caller can fall through to other handlers.
//
// Context:
//   shop          — Shopify store domain
//   accessToken   — Shopify Admin API access token
//   shopifyGraphql — async (shop, accessToken, query, variables) => { data, errors }

export async function executeGraphqlTool(name, args, { shop, accessToken, shopifyGraphql }) {
  switch (name) {
    case "shopify_graphql_query": {
      const { data, errors } = await shopifyGraphql(shop, accessToken, args.query, args.variables ?? {});
      if (errors?.length) return { error: errors.map((e) => e.message).join(", ") };
      return data;
    }

    case "shopify_graphql_mutation": {
      const { data, errors } = await shopifyGraphql(shop, accessToken, args.mutation, args.variables ?? {});
      if (errors?.length) return { error: errors.map((e) => e.message).join(", ") };
      return data;
    }

    default:
      return null; // not a graphql tool — let the caller fall through
  }
}