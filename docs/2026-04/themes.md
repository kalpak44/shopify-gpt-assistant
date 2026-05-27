# Themes — Shopify Admin GraphQL API 2026-04

## Available Tools

| Tool | What it does |
|------|-------------|
| `get_active_theme` | Return the ID and name of the merchant's currently published (MAIN) theme |
| `list_theme_files` | List all filenames in the active theme, optionally filtered by directory prefix |
| `read_theme_file` | Read the full content of a single theme file |
| `propose_file_change` | Stage a diff the merchant must approve before the file is written |

## Theme File Structure

Shopify themes follow this directory layout:

| Directory | Contents |
|-----------|----------|
| `layout/` | Base Liquid templates (e.g. `layout/theme.liquid`) |
| `templates/` | Page templates — JSON (`templates/index.json`) or Liquid |
| `sections/` | Reusable Liquid section files and their schema blocks |
| `snippets/` | Partial Liquid files included via `{% render %}` |
| `assets/` | CSS, JS, and image files |
| `config/` | `settings_schema.json` (theme settings definition) and `settings_data.json` (saved values) |
| `locales/` | Translation files (e.g. `locales/en.default.json`) |

## Workflow for Making Theme Changes

1. `list_theme_files` (with a prefix like `sections/`) to discover what exists
2. `read_theme_file` to inspect the current content before any edit
3. `propose_file_change` with the **complete new file content** — never a partial diff

The `propose_file_change` tool generates a unified diff and creates a pending proposal that the merchant sees in the chat UI. The file is **not written** until the merchant approves the proposal.

## Liquid & Section Schema

- Section files contain a `{% schema %}` JSON block that defines settings, blocks, and presets.
- To add or remove a section, edit the relevant `templates/*.json` file's `"sections"` and `"order"` keys.
- Settings values live in `config/settings_data.json` — edit this to change global theme settings.

## Key GraphQL Types (for `shopify_graphql_query`)

```graphql
# List all themes
query {
  themes(first: 20) {
    edges { node { id name role } }
  }
}
# role: MAIN = active, UNPUBLISHED = inactive, DEMO = demo
```

```graphql
# Read a theme file
query($themeId: ID!, $filenames: [String!]!) {
  theme(id: $themeId) {
    files(filenames: $filenames) {
      edges {
        node {
          filename
          body { ... on OnlineStoreThemeFileBodyText { content } }
        }
      }
      userErrors { code filename }
    }
  }
}
```

```graphql
# Write a theme file
mutation($themeId: ID!, $files: [OnlineStoreThemeFilesUpsertFileInput!]!) {
  themeFilesUpsert(themeId: $themeId, files: $files) {
    upsertedThemeFiles { filename }
    userErrors { field message }
  }
}
# Input: { filename: "sections/header.liquid", body: { type: TEXT, value: "..." } }
```

## GID Format

- Theme: `gid://shopify/OnlineStoreTheme/1234567890`

## Required OAuth Scopes

- Read theme files: `read_themes`
- Write theme files: `write_themes`

## Important Notes

- Never propose a theme change without first calling `read_theme_file` to get the current content.
- The `propose_file_change` tool requires the **full file content**, not a partial patch.
- If `read_themes` scope is not granted, do not attempt to list or read theme files — inform the merchant instead.
- If `write_themes` scope is not granted, do not propose changes — guide the merchant to use the Theme Editor or Shopify CLI.