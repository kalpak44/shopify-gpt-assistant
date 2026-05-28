// ─── Tool definitions ─────────────────────────────────────────────────────────
// Registered in ai.server.js TOOL_DEFS and exposed to the AI.

export const GRAPHQL_TOOL_DEFS = [
  {
    name: "shopify_schema_lookup",
    description:
      "Introspect the Shopify Admin GraphQL schema to look up types, fields, arguments, and available operations. " +
      "Call this BEFORE writing any query or mutation to confirm exact field names, argument types, and connection shapes. " +
      "Use 'QueryRoot' to discover all available queries, 'Mutation' for all mutations, then drill into specific types as needed.",
    parameters: {
      type: "object",
      properties: {
        type_name: {
          type: "string",
          description: "GraphQL type name to look up (e.g. 'Order', 'Product', 'QueryRoot', 'Mutation', 'ProductConnection')",
        },
        field_filter: {
          type: "string",
          description: "Optional: filter returned fields to those whose name contains this substring (case-insensitive)",
        },
      },
      required: ["type_name"],
    },
  },

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
  shopify_schema_lookup: "Looking up schema…",
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

const INTROSPECT_QUERY = `
  query IntrospectType($name: String!) {
    __type(name: $name) {
      name kind description
      fields(includeDeprecated: false) {
        name description
        type { name kind ofType { name kind ofType { name kind } } }
        args {
          name description defaultValue
          type { name kind ofType { name kind } }
        }
      }
      inputFields {
        name description
        type { name kind ofType { name kind } }
      }
      enumValues(includeDeprecated: false) { name description }
      interfaces { name }
      possibleTypes { name }
    }
  }
`;

function fmtTypeRef(t) {
  if (!t) return "unknown";
  if (t.kind === "NON_NULL") return `${fmtTypeRef(t.ofType)}!`;
  if (t.kind === "LIST") return `[${fmtTypeRef(t.ofType)}]`;
  return t.name ?? t.kind;
}

function formatIntrospection(t, fieldFilter) {
  const result = { name: t.name, kind: t.kind };
  if (t.description) result.description = t.description;

  if (t.fields) {
    let fields = t.fields;
    if (fieldFilter) {
      const lc = fieldFilter.toLowerCase();
      fields = fields.filter((f) => f.name.toLowerCase().includes(lc));
    }
    result.fields = fields.map((f) => ({
      name: f.name,
      type: fmtTypeRef(f.type),
      ...(f.description && { description: f.description }),
      ...(f.args?.length && {
        args: f.args.map((a) => ({
          name: a.name,
          type: fmtTypeRef(a.type),
          ...(a.description && { description: a.description }),
          ...(a.defaultValue != null && { default: a.defaultValue }),
        })),
      }),
    }));
  }

  if (t.inputFields?.length) {
    result.inputFields = t.inputFields.map((f) => ({
      name: f.name,
      type: fmtTypeRef(f.type),
      ...(f.description && { description: f.description }),
    }));
  }

  if (t.enumValues?.length) {
    result.enumValues = t.enumValues.map((v) => ({
      name: v.name,
      ...(v.description && { description: v.description }),
    }));
  }

  if (t.interfaces?.length) result.interfaces = t.interfaces.map((i) => i.name);
  if (t.possibleTypes?.length) result.possibleTypes = t.possibleTypes.map((p) => p.name);

  return result;
}

export async function executeGraphqlTool(name, args, { shop, accessToken, shopifyGraphql }) {
  switch (name) {
    case "shopify_schema_lookup": {
      const { data, errors } = await shopifyGraphql(shop, accessToken, INTROSPECT_QUERY, { name: args.type_name });
      if (errors?.length) return { error: errors.map((e) => e.message).join(", ") };
      const t = data?.__type;
      if (!t) return { error: `Type '${args.type_name}' not found in schema` };
      return formatIntrospection(t, args.field_filter ?? null);
    }

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