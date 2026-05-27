# Shopify GPT Assistant

A Shopify App that lets merchants manage their store through a conversational AI chat interface. 
## Tech Stack

- **Framework:** Shopify App (Remix / Node.js)
- **Database:** Prisma ORM
- **AI:** Claude (Anthropic)
- **API:** Shopify Admin GraphQL API
- **Extensions:** Shopify App Extensions

## Project Structure

```
app/          # Remix routes, loaders, actions
extensions/   # Shopify app extensions
docs/         # GraphQL field references
assets/       # Static assets
prisma/       # Schema and migrations
```

## Development

```bash
npm install
npm run dev
```

## Rules

@.claude/rules/git.md
@.claude/rules/conventions.md