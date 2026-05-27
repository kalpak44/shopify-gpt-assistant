# Local Setup

## First-Time Setup

**1. Install dependencies**
```bash
npm install
```

**2. Create `.env` file** (never commit this)
```
DATABASE_URL=postgresql://user:pass@host:5432/shopify-app-playground
```

**3. Apply database migrations**
```bash
npx prisma migrate deploy
```

**4. Start dev server**
```bash
npm run dev
```

## Subsequent Runs

Just `npm run dev`.

## After Adding a New Migration

```bash
npx prisma migrate deploy
npm run dev
```

## Notes

- `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET`, and `SHOPIFY_APP_URL` are injected automatically by the Shopify CLI during dev
- App URLs in `shopify.app.dev.toml` are overridden automatically via `automatically_update_urls_on_dev = true`