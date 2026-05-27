# Project Conventions

- Shopify Admin GraphQL API is the primary integration layer — see `docs/` for field references
- Chat messages are processed server-side; Claude interprets intent and maps it to GraphQL operations
- All Shopify API mutations must be idempotent where possible
- Auth is handled via Shopify's OAuth flow (`shopify.app.toml`)