import { readThemeFile, listThemeFiles } from "../../theme.server.js";
import { generateUnifiedDiff } from "../../diff.server.js";
import prisma from "../../db.server.js";

// ─── Tool definitions ─────────────────────────────────────────────────────────
// Registered in ai.server.js TOOL_DEFS and exposed to the AI.

export const THEME_TOOL_DEFS = [
  {
    name: "get_current_datetime",
    description:
      "Get the current date and time on the server. Call this whenever the merchant's question involves relative time — 'today', 'this week', 'yesterday', 'last month', etc. — so you can construct accurate date-range filters in GraphQL queries.",
    parameters: { type: "object", properties: {}, required: [] },
  },

  {
    name: "get_active_theme",
    description: "Get the name and ID of the merchant's currently active Shopify theme.",
    parameters: { type: "object", properties: {}, required: [] },
  },

  {
    name: "list_theme_files",
    description:
      "List filenames in the active Shopify theme. Optionally filter by a directory prefix such as 'sections/', 'templates/', 'snippets/', 'assets/', 'config/', 'layout/', or 'locales/'. Returns filenames only — use read_theme_file to get the content of a specific file. Call this first to discover what sections, templates, and other files exist before reading or modifying them.",
    parameters: {
      type: "object",
      properties: {
        prefix: {
          type: "string",
          description:
            "Optional path prefix to filter results, e.g. 'sections/', 'templates/', 'config/'. Omit to list all files.",
        },
      },
      required: [],
    },
  },

  {
    name: "read_theme_file",
    description:
      "Read the content of a file from the active Shopify theme. Use this to understand the current state before proposing changes.",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description:
            "File path relative to the theme root, e.g. templates/index.json or sections/header.liquid",
        },
      },
      required: ["path"],
    },
  },

  {
    name: "propose_file_change",
    description:
      "Propose a change to a theme file. Creates a diff the merchant must review and approve before it is written. Always read the file first so the proposal reflects the actual current content.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "File path to modify" },
        new_content: {
          type: "string",
          description: "The complete new content for the file (not a diff — the full updated file)",
        },
        summary: {
          type: "string",
          description: "Brief human-readable description of what this change does",
        },
      },
      required: ["path", "new_content", "summary"],
    },
  },
];

// ─── Tool status labels ───────────────────────────────────────────────────────
// Used by chat routes to show progress messages in the UI.

export const THEME_TOOL_STATUS = {
  get_current_datetime: "Checking current date…",
  get_active_theme: "Checking active theme…",
  list_theme_files: "Listing theme files…",
  read_theme_file: "Reading theme file…",
  propose_file_change: "Creating proposal…",
};

// ─── Tool handler ─────────────────────────────────────────────────────────────
// Returns null for unknown tool names so the caller can fall through to other handlers.
//
// Context:
//   shop        — Shopify store domain
//   accessToken — Shopify Admin API access token
//   getTheme    — async () => { id, name } — cached per-request theme lookup
//   sessionId   — current chat session ID (used when creating proposals)
//   onProposal  — callback({ proposalId, summary, files }) fired after a proposal
//                 DB record is created; the route uses this to emit the SSE event
//                 and track createdProposalId

export async function executeThemeTool(name, args, { shop, accessToken, getTheme, sessionId, onProposal, shopifyGraphql: graphqlFn }) {
  switch (name) {
    case "get_current_datetime": {
      const now = new Date();
      return { iso: now.toISOString(), utcOffset: 0, readable: now.toUTCString() };
    }

    case "get_active_theme": {
      const theme = await getTheme();
      return { id: theme.id, name: theme.name };
    }

    case "list_theme_files": {
      const theme = await getTheme();
      return listThemeFiles(shop, accessToken, theme.id, args.prefix ?? null, graphqlFn);
    }

    case "read_theme_file": {
      const theme = await getTheme();
      return (await readThemeFile(shop, accessToken, theme.id, args.path, graphqlFn)) ?? `File not found: ${args.path}`;
    }

    case "propose_file_change": {
      const theme = await getTheme();
      const before = (await readThemeFile(shop, accessToken, theme.id, args.path, graphqlFn)) ?? "";
      const diff = generateUnifiedDiff(before, args.new_content, args.path);
      const proposal = await prisma.changeProposal.create({
        data: {
          sessionId,
          shop,
          themeId: theme.id,
          status: "pending",
          summary: args.summary,
          files: [{ path: args.path, before, after: args.new_content, diff }],
        },
      });
      onProposal({ proposalId: proposal.id, summary: args.summary, files: [{ path: args.path, diff }] });
      return { success: true, message: "Proposal created and shown to the merchant for review." };
    }

    default:
      return null; // not a theme tool — let the caller fall through
  }
}