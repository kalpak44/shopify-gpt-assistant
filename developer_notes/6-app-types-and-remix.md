# Shopify App Types

## Extension-Only App

No backend server. Just theme/admin extensions deployed via Shopify CLI.

- Use when: you only need to add UI blocks, theme sections, or admin panels
- No OAuth, no server, no API calls on install
- This playground (`shopify-app-playground`) is an example

```shell
shopify app init --template none --name my-app --package-manager npm
```

## Remix App (with backend)

Full-stack app with a Node.js/Remix backend and extensions. Required when you need to:

- Run logic on app install (e.g. create metafield definitions)
- Call the Shopify Admin API from a server
- Store data, handle webhooks, charge merchants

```
my-remix-app/
├── app/
│   ├── routes/
│   │   ├── app._index.jsx   ← main app page
│   │   └── auth.$.jsx       ← OAuth handling
│   └── shopify.server.js    ← Shopify auth config + afterAuth hook
├── extensions/              ← theme/admin extensions live here too
└── shopify.app.toml
```

## How to Create a Remix App from Scratch

```shell
shopify app init
```

Then follow the prompts:

1. App name
2. Template → choose `remix`
3. Language → JavaScript

## Adding Remix to an Existing Extension-Only App

No CLI command for this — done manually. Minimum files to add:

### Infrastructure

- `package.json` — add React Router, Shopify, and Prisma dependencies
- `vite.config.js` — build config
- `shopify.web.toml` — tells the CLI "this app has a web server"
- `.npmrc` — Node engine enforcement

### Database (session storage)

- `prisma/schema.prisma` — `Session` model (Shopify stores OAuth sessions here)

### App

- `app/db.server.js` — Prisma client
- `app/shopify.server.js` — Shopify auth config + `afterAuth` hook
- `app/entry.server.jsx` — server entry point
- `app/root.jsx` — root HTML shell
- `app/routes.js` — route config
- `app/routes/auth.$.jsx` — handles OAuth redirect
- `app/routes/auth.login/route.jsx` — login page
- `app/routes/auth.login/error.server.jsx` — error helper
- `app/routes/app.jsx` — layout with auth guard
- `app/routes/app._index.jsx` — home page

### Update

- `shopify.app.toml` — switch `embedded = true`, add build config

## npm Commands

```shell
npm install          # install dependencies (run once after adding package.json deps)
npm run dev          # start dev server (runs shopify app dev)
npm run build        # build for production
npm run start        # serve the production build
npm run setup        # run prisma generate + migrate (first-time DB setup)
npm run deploy       # deploy app to Shopify
```

`npm run dev` is the main command during development — it starts the Vite server, tunnels it via Shopify CLI, and
watches for file changes.

## Key Concept: afterAuth Hook

Fires every time a merchant installs or reinstall the app. This is where you run a one-time setup like creating
metafield definitions.

```js
const shopify = shopifyApp({
    // ...
    hooks: {
        afterAuth: async ({admin}) => {
            // create metafield definitions here
        },
    },
});
```