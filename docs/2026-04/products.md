# Products — Shopify Admin GraphQL API 2026-04

## Available Tools

| Tool | What it does |
|------|-------------|
| `product_list` | List/search products with filters and sorting |
| `product_get` | Fetch all fields of one product by GID |
| `product_create` | Create a new product record |
| `product_update` | Update fields on an existing product |
| `product_delete` | Permanently delete a product (irreversible) |
| `product_variants_create` | Add new variants to an existing product |
| `product_variants_update` | Update price, SKU, compareAtPrice, inventoryPolicy on existing variants |

## GID Format
All Shopify resource IDs are Global IDs:
- Product: `gid://shopify/Product/1234567890`
- Variant: `gid://shopify/ProductVariant/1234567890`

## Product Data Model

### Product Fields
| Field | Type | Notes |
|-------|------|-------|
| `id` | ID | Read-only GID |
| `title` | String | Required on create |
| `handle` | String | URL slug, auto-generated from title if omitted |
| `descriptionHtml` | HTML | HTML-formatted description |
| `vendor` | String | Brand or supplier name |
| `productType` | String | Merchant-defined category |
| `status` | ACTIVE \| DRAFT \| ARCHIVED | Defaults to DRAFT on create |
| `tags` | [String] | Array of tag strings |
| `totalInventory` | Int | Read-only, sum across all variants |
| `createdAt` / `updatedAt` / `publishedAt` | DateTime | Read-only |
| `priceRangeV2` | Object | `.minVariantPrice` / `.maxVariantPrice` each with `amount` + `currencyCode` |
| `seo.title` / `seo.description` | String | SEO overrides |
| `onlineStoreUrl` | URL | Read-only |
| `options` | [ProductOption] | Variant dimensions (e.g. Size, Color) |
| `variants` | connection | All variant nodes |

### Variant Fields
| Field | Type | Notes |
|-------|------|-------|
| `id` | ID | Read-only GID |
| `title` | String | Auto-built from option values (e.g. "S / Red") |
| `price` | Money | Decimal string e.g. `"29.99"` |
| `compareAtPrice` | Money | Shown as strikethrough original price |
| `sku` | String | Stock-keeping unit |
| `inventoryQuantity` | Int | Current stock (read-only via query) |
| `inventoryPolicy` | DENY \| CONTINUE | DENY = stop at 0, CONTINUE = allow oversell |
| `selectedOptions` | [{name, value}] | Option name/value pairs |

## Workflows

### Create a simple product with a single price
1. `product_create` → returns product with a default variant ID
2. `product_variants_update` with `{ id: <defaultVariantId>, price: "X.XX" }`

### Create a product with multiple options (e.g. Size + Color)
1. `product_create` with `product_options: [{ name: "Size", values: ["S","M","L"] }, { name: "Color", values: ["Red","Blue"] }]`
2. Shopify auto-generates one variant per combination (S/Red, S/Blue, M/Red, …)
3. `product_get` to retrieve the generated variant IDs
4. `product_variants_update` to set `price` (and optionally `sku`) on each variant

### Add more variants to an existing product
1. `product_get` to see current options
2. `product_variants_create` with `option_values` matching the existing option names

### Publish a draft product
`product_update` with `{ id, status: "ACTIVE" }`

### Delete a product
**Always confirm with the merchant first** — deletion removes all variants, media, and publications and cannot be undone. Then call `product_delete`.

## Filter Syntax for `product_list`
Passed as the `query` parameter:
- `title:Shirt` — title contains
- `status:active` — status filter (active, draft, archived)
- `vendor:Nike` — exact vendor match
- `product_type:Footwear` — product type match
- `tag:sale` — has tag
- `sku:ABC-123` — variant SKU match
- `handle:my-product` — handle match
- Combine: `status:active vendor:Nike tag:summer`

## Sort Keys for `product_list`
`TITLE` | `PRODUCT_TYPE` | `VENDOR` | `INVENTORY_TOTAL` | `UPDATED_AT` | `CREATED_AT` | `PUBLISHED_AT` | `ID`
Default: `UPDATED_AT`

## Required OAuth Scopes
- Read products: `read_products`
- Create / update / delete: `write_products`