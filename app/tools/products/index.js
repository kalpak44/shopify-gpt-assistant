import {
  GET_PRODUCT,
  LIST_PRODUCTS,
  CREATE_PRODUCT,
  UPDATE_PRODUCT,
  DELETE_PRODUCT,
  VARIANTS_BULK_CREATE,
  VARIANTS_BULK_UPDATE,
} from "./graphql.js";

// ─── Tool definitions ─────────────────────────────────────────────────────────
// Registered in ai.server.js TOOL_DEFS and exposed to the AI.

export const PRODUCT_TOOL_DEFS = [
  {
    name: "product_list",
    description:
      "List and search products in the store. Supports filtering by title, status, vendor, product type, tag, or SKU using Shopify query syntax (e.g. 'status:active vendor:Nike'). Returns paginated results with key fields. Use product_get for full details on a single item.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "Shopify filter string. Examples: 'status:active', 'title:shirt', 'vendor:Nike tag:sale', 'sku:ABC-123'. Omit to list all products.",
        },
        first: {
          type: "integer",
          description: "Number of products to return (1–250). Default: 20.",
        },
        sort_key: {
          type: "string",
          enum: ["TITLE", "PRODUCT_TYPE", "VENDOR", "INVENTORY_TOTAL", "UPDATED_AT", "CREATED_AT", "PUBLISHED_AT", "ID"],
          description: "Sort field. Default: UPDATED_AT.",
        },
        reverse: {
          type: "boolean",
          description: "Reverse sort order. Default: false.",
        },
        after: {
          type: "string",
          description: "Pagination cursor from a previous response's pageInfo.endCursor.",
        },
      },
      required: [],
    },
  },

  {
    name: "product_get",
    description:
      "Fetch complete details of a single product by its GID, including all variants, options, pricing, SEO, and inventory. Required before updating variants — use this to get variant IDs.",
    parameters: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "Product GID — e.g. gid://shopify/Product/1234567890",
        },
      },
      required: ["id"],
    },
  },

  {
    name: "product_create",
    description:
      "Create a new product. Returns the product and its auto-generated variants. To set a price after creation, call product_variants_update with the returned variant id. For a product with options (Size, Color), pass product_options and Shopify will generate all variant combinations.",
    parameters: {
      type: "object",
      properties: {
        title: {
          type: "string",
          description: "Product title (required).",
        },
        description_html: {
          type: "string",
          description: "HTML product description.",
        },
        vendor: {
          type: "string",
          description: "Brand or supplier name.",
        },
        product_type: {
          type: "string",
          description: "Merchant-defined category string.",
        },
        status: {
          type: "string",
          enum: ["ACTIVE", "DRAFT", "ARCHIVED"],
          description: "Publication status. Defaults to DRAFT.",
        },
        tags: {
          type: "array",
          items: { type: "string" },
          description: "List of tag strings.",
        },
        product_options: {
          type: "array",
          description:
            "Variant dimensions. Example: [{ name: 'Size', values: ['S','M','L'] }]. Shopify auto-creates one variant per combination of values.",
          items: {
            type: "object",
            properties: {
              name: { type: "string", description: "Option name e.g. 'Size', 'Color'." },
              values: {
                type: "array",
                items: { type: "string" },
                description: "Option values e.g. ['S', 'M', 'L'].",
              },
            },
            required: ["name", "values"],
          },
        },
        seo_title: {
          type: "string",
          description: "SEO page title override.",
        },
        seo_description: {
          type: "string",
          description: "SEO meta description override.",
        },
        media_urls: {
          type: "array",
          items: { type: "string" },
          description: "Public image URLs to attach to the product.",
        },
      },
      required: ["title"],
    },
  },

  {
    name: "product_update",
    description:
      "Update fields on an existing product. Only include the fields you want to change — omitted fields are left as-is. Use product_variants_update for price/SKU changes.",
    parameters: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "Product GID.",
        },
        title: { type: "string" },
        description_html: { type: "string" },
        vendor: { type: "string" },
        product_type: { type: "string" },
        status: {
          type: "string",
          enum: ["ACTIVE", "DRAFT", "ARCHIVED"],
        },
        tags: {
          type: "array",
          items: { type: "string" },
          description: "Replaces all existing tags.",
        },
        handle: {
          type: "string",
          description: "URL slug. Auto-synced with title if omitted.",
        },
        seo_title: { type: "string" },
        seo_description: { type: "string" },
      },
      required: ["id"],
    },
  },

  {
    name: "product_delete",
    description:
      "Permanently delete a product and all its variants, media, and publications. IRREVERSIBLE — always confirm with the merchant before calling this tool.",
    parameters: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "Product GID to delete.",
        },
      },
      required: ["id"],
    },
  },

  {
    name: "product_variants_create",
    description:
      "Add new variants to an existing product. Each variant must specify option_values matching the product's existing options (e.g. [{ name: 'Size', value: 'XL' }]). Use product_get first to confirm option names.",
    parameters: {
      type: "object",
      properties: {
        product_id: {
          type: "string",
          description: "Product GID.",
        },
        variants: {
          type: "array",
          items: {
            type: "object",
            properties: {
              price: {
                type: "string",
                description: "Decimal price string e.g. '29.99'.",
              },
              compare_at_price: {
                type: "string",
                description: "Original price shown as strikethrough e.g. '49.99'.",
              },
              sku: { type: "string" },
              option_values: {
                type: "array",
                description: "Option name/value pairs matching the product's options.",
                items: {
                  type: "object",
                  properties: {
                    name: { type: "string", description: "Option name e.g. 'Size'." },
                    value: { type: "string", description: "Option value e.g. 'XL'." },
                  },
                  required: ["name", "value"],
                },
              },
            },
            required: ["price"],
          },
        },
      },
      required: ["product_id", "variants"],
    },
  },

  {
    name: "product_variants_update",
    description:
      "Update price, compareAtPrice, SKU, or inventoryPolicy on one or more existing variants. Use product_get first to obtain variant IDs. Only include fields you want to change.",
    parameters: {
      type: "object",
      properties: {
        product_id: {
          type: "string",
          description: "Product GID (parent of the variants).",
        },
        variants: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: {
                type: "string",
                description: "Variant GID — e.g. gid://shopify/ProductVariant/1234567890.",
              },
              price: {
                type: "string",
                description: "Decimal price string e.g. '29.99'.",
              },
              compare_at_price: {
                type: "string",
                description: "Original/strikethrough price e.g. '49.99'. Pass null to clear.",
              },
              sku: { type: "string" },
              inventory_policy: {
                type: "string",
                enum: ["DENY", "CONTINUE"],
                description: "DENY = stop selling when out of stock. CONTINUE = allow oversell.",
              },
            },
            required: ["id"],
          },
        },
      },
      required: ["product_id", "variants"],
    },
  },
];

// ─── Tool handler ─────────────────────────────────────────────────────────────
// Returns null for unknown tool names so the caller can fall through to other handlers.

export async function executeProductTool(name, args, { shop, accessToken, shopifyGraphql }) {
  switch (name) {
    case "product_list": {
      const { data, errors } = await shopifyGraphql(shop, accessToken, LIST_PRODUCTS, {
        first: Math.min(args.first ?? 20, 250),
        after: args.after ?? null,
        query: args.query ?? null,
        sortKey: args.sort_key ?? "UPDATED_AT",
        reverse: args.reverse ?? false,
      });
      if (errors?.length) return { error: errors.map((e) => e.message).join(", ") };
      return data.products;
    }

    case "product_get": {
      const { data, errors } = await shopifyGraphql(shop, accessToken, GET_PRODUCT, {
        id: args.id,
      });
      if (errors?.length) return { error: errors.map((e) => e.message).join(", ") };
      if (!data.product) return { error: `Product not found: ${args.id}` };
      return data.product;
    }

    case "product_create": {
      const product = {
        title: args.title,
        ...(args.description_html != null && { descriptionHtml: args.description_html }),
        ...(args.vendor != null && { vendor: args.vendor }),
        ...(args.product_type != null && { productType: args.product_type }),
        ...(args.status != null && { status: args.status }),
        ...(args.tags != null && { tags: args.tags }),
        ...(args.product_options != null && {
          productOptions: args.product_options.map((o) => ({
            name: o.name,
            values: o.values.map((v) => ({ name: v })),
          })),
        }),
        ...((args.seo_title != null || args.seo_description != null) && {
          seo: {
            ...(args.seo_title != null && { title: args.seo_title }),
            ...(args.seo_description != null && { description: args.seo_description }),
          },
        }),
      };

      const media = args.media_urls?.map((url) => ({
        originalSource: url,
        mediaContentType: "IMAGE",
      }));

      const variables = { product };
      if (media?.length) variables.media = media;

      const { data, errors } = await shopifyGraphql(shop, accessToken, CREATE_PRODUCT, variables);
      if (errors?.length) return { error: errors.map((e) => e.message).join(", ") };

      const { product: created, userErrors } = data.productCreate;
      if (userErrors?.length) {
        return { error: userErrors.map((e) => `${e.field?.join(".") ?? "field"}: ${e.message}`).join("; ") };
      }
      return created;
    }

    case "product_update": {
      const product = {
        id: args.id,
        ...(args.title !== undefined && { title: args.title }),
        ...(args.description_html !== undefined && { descriptionHtml: args.description_html }),
        ...(args.vendor !== undefined && { vendor: args.vendor }),
        ...(args.product_type !== undefined && { productType: args.product_type }),
        ...(args.status !== undefined && { status: args.status }),
        ...(args.tags !== undefined && { tags: args.tags }),
        ...(args.handle !== undefined && { handle: args.handle }),
        ...((args.seo_title !== undefined || args.seo_description !== undefined) && {
          seo: {
            ...(args.seo_title !== undefined && { title: args.seo_title }),
            ...(args.seo_description !== undefined && { description: args.seo_description }),
          },
        }),
      };

      const { data, errors } = await shopifyGraphql(shop, accessToken, UPDATE_PRODUCT, { product });
      if (errors?.length) return { error: errors.map((e) => e.message).join(", ") };

      const { product: updated, userErrors } = data.productUpdate;
      if (userErrors?.length) {
        return { error: userErrors.map((e) => `${e.field?.join(".") ?? "field"}: ${e.message}`).join("; ") };
      }
      return updated;
    }

    case "product_delete": {
      const { data, errors } = await shopifyGraphql(shop, accessToken, DELETE_PRODUCT, {
        input: { id: args.id },
      });
      if (errors?.length) return { error: errors.map((e) => e.message).join(", ") };

      const { deletedProductId, userErrors } = data.productDelete;
      if (userErrors?.length) {
        return { error: userErrors.map((e) => `${e.field?.join(".") ?? "field"}: ${e.message}`).join("; ") };
      }
      return { success: true, deletedProductId };
    }

    case "product_variants_create": {
      const variants = args.variants.map((v) => ({
        price: v.price,
        ...(v.compare_at_price != null && { compareAtPrice: v.compare_at_price }),
        ...(v.sku != null && { sku: v.sku }),
        ...(v.option_values != null && {
          optionValues: v.option_values.map((ov) => ({
            optionName: ov.name,
            name: ov.value,
          })),
        }),
      }));

      const { data, errors } = await shopifyGraphql(shop, accessToken, VARIANTS_BULK_CREATE, {
        productId: args.product_id,
        variants,
      });
      if (errors?.length) return { error: errors.map((e) => e.message).join(", ") };

      const { productVariants, userErrors } = data.productVariantsBulkCreate;
      if (userErrors?.length) {
        return { error: userErrors.map((e) => `${e.field?.join(".") ?? "field"}: ${e.message}`).join("; ") };
      }
      return { productVariants };
    }

    case "product_variants_update": {
      const variants = args.variants.map((v) => ({
        id: v.id,
        ...(v.price !== undefined && { price: v.price }),
        ...(v.compare_at_price !== undefined && { compareAtPrice: v.compare_at_price }),
        ...(v.sku !== undefined && { sku: v.sku }),
        ...(v.inventory_policy !== undefined && { inventoryPolicy: v.inventory_policy }),
      }));

      const { data, errors } = await shopifyGraphql(shop, accessToken, VARIANTS_BULK_UPDATE, {
        productId: args.product_id,
        variants,
      });
      if (errors?.length) return { error: errors.map((e) => e.message).join(", ") };

      const { productVariants, userErrors } = data.productVariantsBulkUpdate;
      if (userErrors?.length) {
        return { error: userErrors.map((e) => `${e.field?.join(".") ?? "field"}: ${e.message}`).join("; ") };
      }
      return { productVariants };
    }

    default:
      return null; // not a product tool — let the caller fall through
  }
}