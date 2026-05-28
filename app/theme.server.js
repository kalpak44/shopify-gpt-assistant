const API_VERSION = "2026-04";

const TRANSIENT_CODES = new Set(["EAI_AGAIN", "ECONNRESET", "ETIMEDOUT", "ECONNREFUSED"]);

function isTransientNetworkError(err) {
  return TRANSIENT_CODES.has(err.cause?.code) || TRANSIENT_CODES.has(err.code);
}

export async function shopifyGraphql(shop, accessToken, query, variables = {}) {
  const operation = query.match(/(?:query|mutation)\s+(\w+)/)?.[1] ?? "anonymous";
  console.log(`[Shopify] ${operation}`, Object.keys(variables).length ? variables : "");

  const MAX_RETRIES = 2;
  let response;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      response = await fetch(
        `https://${shop}/admin/api/${API_VERSION}/graphql.json`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Shopify-Access-Token": accessToken,
          },
          body: JSON.stringify({ query, variables }),
        }
      );
      break;
    } catch (err) {
      if (isTransientNetworkError(err) && attempt < MAX_RETRIES) {
        console.warn(`[Shopify] ${operation} — transient error (${err.cause?.code ?? err.code}), retrying (${attempt + 1}/${MAX_RETRIES})…`);
        await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
        continue;
      }
      console.error(`[Shopify] ${operation} — fetch failed:`, err.message, err.cause ?? "");
      throw err;
    }
  }

  if (!response.ok) {
    const text = await response.text();
    console.error(`[Shopify] ${operation} — HTTP ${response.status}:`, text.slice(0, 300));
    if (response.status === 401) {
      throw new Error(
        "Shopify API returned 401 — the session token is invalid or expired. " +
        "Please reload the app from the Shopify admin to re-authenticate and get a fresh token."
      );
    }
    throw new Error(`Shopify API ${response.status}: ${text.slice(0, 200)}`);
  }

  const json = await response.json();

  if (json.errors?.length) {
    console.error(`[Shopify] ${operation} — GraphQL errors:`, JSON.stringify(json.errors));
  } else {
    console.log(`[Shopify] ${operation} — ok`);
  }

  return json;
}

const GET_THEMES_QUERY = `
  query GetThemes {
    themes(first: 20) {
      edges { node { id name role } }
    }
  }
`;

const GET_THEME_FILE_QUERY = `
  query GetThemeFile($themeId: ID!, $filenames: [String!]!) {
    theme(id: $themeId) {
      files(filenames: $filenames) {
        edges {
          node {
            filename
            body {
              ... on OnlineStoreThemeFileBodyText { content }
            }
          }
        }
        userErrors { code filename }
      }
    }
  }
`;

const LIST_THEME_FILES_QUERY = `
  query ListThemeFiles($themeId: ID!) {
    theme(id: $themeId) {
      files(first: 100) {
        edges { node { filename } }
        pageInfo { hasNextPage endCursor }
        userErrors { code filename }
      }
    }
  }
`;

const LIST_THEME_FILES_NEXT_QUERY = `
  query ListThemeFilesNext($themeId: ID!, $cursor: String!) {
    theme(id: $themeId) {
      files(first: 100, after: $cursor) {
        edges { node { filename } }
        pageInfo { hasNextPage endCursor }
        userErrors { code filename }
      }
    }
  }
`;

const UPSERT_THEME_FILE_MUTATION = `
  mutation ThemeFilesUpsert($themeId: ID!, $files: [OnlineStoreThemeFilesUpsertFileInput!]!) {
    themeFilesUpsert(themeId: $themeId, files: $files) {
      upsertedThemeFiles { filename }
      userErrors { field message }
    }
  }
`;

export async function getMainTheme(shop, accessToken, graphqlFn = shopifyGraphql) {
  const { data, errors } = await graphqlFn(shop, accessToken, GET_THEMES_QUERY);
  if (errors?.length) throw new Error(`Failed to fetch themes: ${errors[0].message}`);

  const themes = (data?.themes?.edges ?? []).map((e) => e.node);
  const main = themes.find((t) => t.role === "MAIN");
  if (!main) throw new Error("No main theme found on this store.");
  return main;
}

export async function readThemeFile(shop, accessToken, themeId, path, graphqlFn = shopifyGraphql) {
  const { data, errors } = await graphqlFn(shop, accessToken, GET_THEME_FILE_QUERY, {
    themeId,
    filenames: [path],
  });
  if (errors?.length) throw new Error(`Failed to read theme file: ${errors[0].message}`);

  const filesResult = data?.theme?.files;
  if (filesResult?.userErrors?.length) {
    throw new Error(`Theme file error: ${filesResult.userErrors.map((e) => e.code).join(", ")}`);
  }

  return filesResult?.edges?.[0]?.node?.body?.content ?? null;
}

export async function listThemeFiles(shop, accessToken, themeId, prefix = null, graphqlFn = shopifyGraphql) {
  let allFilenames = [];
  let cursor = null;

  do {
    const query = cursor ? LIST_THEME_FILES_NEXT_QUERY : LIST_THEME_FILES_QUERY;
    const variables = cursor ? { themeId, cursor } : { themeId };
    const { data, errors } = await graphqlFn(shop, accessToken, query, variables);
    if (errors?.length) throw new Error(`Failed to list theme files: ${errors[0].message}`);

    const files = data?.theme?.files;
    if (files?.userErrors?.length) {
      throw new Error(files.userErrors.map((e) => e.code).join(", "));
    }
    (files?.edges ?? []).forEach((e) => allFilenames.push(e.node.filename));
    cursor = files?.pageInfo?.hasNextPage ? files.pageInfo.endCursor : null;
  } while (cursor);

  return prefix ? allFilenames.filter((f) => f.startsWith(prefix)) : allFilenames;
}

export async function writeThemeFile(shop, accessToken, themeId, path, content) {
  const { data, errors } = await shopifyGraphql(shop, accessToken, UPSERT_THEME_FILE_MUTATION, {
    themeId,
    files: [{ filename: path, body: { type: "TEXT", value: content } }],
  });
  if (errors?.length) throw new Error(`Failed to write theme file: ${errors[0].message}`);

  const result = data?.themeFilesUpsert;
  if (result?.userErrors?.length) {
    throw new Error(result.userErrors.map((e) => e.message).join(", "));
  }
  return result?.upsertedThemeFiles ?? [];
}