# Project Conventions

- Shopify Admin GraphQL API 2026-04 is the primary integration layer - field references and tool docs live in `docs/2026-04/`
- Module tools live in `app/tools/<module>/` (e.g. `app/tools/products/`) - each exports `PRODUCT_TOOL_DEFS` and `executeProductTool`; register both in `app/ai.server.js` and the chat route handlers
- Chat messages are processed server-side; Claude interprets intent and maps it to GraphQL operations
- All Shopify API mutations must be idempotent where possible
- Auth is handled via Shopify's OAuth flow (`shopify.app.toml`)