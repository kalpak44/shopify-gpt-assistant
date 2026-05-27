# Router Guide

This project uses React Router with file-based routes. The router decides which file handles a request based on the file name under `app/routes`.

The short version:

- `loader` handles `GET` requests on the server.
- `action` handles form submissions and other mutations on the server.
- `default export` renders the React page.
- `ErrorBoundary` renders when the route throws an error or a response.
- `headers` lets a route attach or forward HTTP headers.

## 1. How routes are discovered

Route discovery is configured in `app/routes.js`:

```js
import { flatRoutes } from "@react-router/fs-routes";

export default flatRoutes();
```

That means files inside `app/routes` become routes automatically.

Examples from this app:

- `app/routes/_index/route.jsx` -> `/`
- `app/routes/app.jsx` -> `/app` parent layout route
- `app/routes/app._index.jsx` -> `/app` index child route
- `app/routes/proxy.modals.jsx` -> `/proxy/modals`
- `app/routes/auth.$.jsx` -> auth catch-all route used by Shopify auth flows

## 2. The three main route jobs

Most routes do one or more of these jobs:

1. Load data with `loader`
2. Change data with `action`
3. Render UI with the route component

### Example: admin page route

`app/routes/app._index.jsx` does all three:

```jsx
export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const modals = await prisma.modal.findMany({
    where: { shop: session.shop },
    orderBy: { updatedAt: "desc" },
  });

  return { modals };
};

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();

  // create, toggle, delete
  return { success: "Modal created." };
};

export default function AppIndex() {
  const { modals } = useLoaderData();
  const actionData = useActionData();

  return <div>{modals.length}</div>;
}
```

What happens:

- browser opens `/app`
- server runs `loader`
- `loader` returns `{ modals }`
- React renders the component
- component reads data with `useLoaderData()`
- when a `<Form method="post">` submits, the `action` runs
- component reads `action` result with `useActionData()`

### Example: data-only route

`app/routes/proxy.modals.jsx` is different:

```jsx
export const loader = async ({ request }) => {
  const url = new URL(request.url);
  const shop = url.searchParams.get("shop");
  const pageType = url.searchParams.get("pageType") || "index";

  const modals = await prisma.modal.findMany({
    where: { shop, enabled: true },
    orderBy: { updatedAt: "desc" },
  });

  const modal = modals.find((entry) => matchesPageTarget(entry.pageTargets, pageType)) || null;

  return Response.json({ modal });
};
```

This route has no React component. It behaves like an API endpoint.

What happens:

- storefront JavaScript calls `/apps/store-modals`
- Shopify app proxy forwards that to `/proxy/modals`
- React Router matches `app/routes/proxy.modals.jsx`
- `loader` runs on the server
- the route returns JSON
- no admin page is rendered

Use this pattern when another client is doing `fetch()` and you want JSON instead of HTML.

## 3. When a route renders a page

A route renders a page when it exports a React component as the default export.

Example from `app/routes/app.jsx`:

```jsx
export default function App() {
  const { apiKey } = useLoaderData();

  return (
    <AppProvider embedded apiKey={apiKey}>
      <s-app-nav>
        <s-link href="/app">Home</s-link>
        <s-link href="/settings">Settings</s-link>
      </s-app-nav>
      <Outlet />
    </AppProvider>
  );
}
```

This is a layout route. It renders shared admin UI and an `<Outlet />` where child routes appear.

Example:

- request goes to `/app`
- `app/routes/app.jsx` runs as parent
- `app/routes/app._index.jsx` runs as child index route
- parent renders the shell
- child renders inside `<Outlet />`

## 4. Nested routes and `<Outlet />`

`<Outlet />` is how parent routes render child routes.

In this app:

- `app/root.jsx` is the top-level HTML shell
- `app/routes/app.jsx` is the embedded admin shell
- `app/routes/app._index.jsx` is the admin home page content

Think of it as layers:

1. `root.jsx` renders `<html>`, `<head>`, `<body>`
2. `app.jsx` renders app navigation and Shopify provider
3. `app._index.jsx` renders the actual page content

## 5. What `loader` is for

Use `loader` when you need server-side data for a `GET` request.

Typical uses:

- authenticate the request
- read query params
- inspect the HTTP method when needed for debugging
- fetch database records
- return data for the page
- return JSON for `fetch()`
- redirect the user

### Example: redirect loader

`app/routes/_index/route.jsx` redirects `/` to `/app`:

```jsx
export const loader = async ({ request }) => {
  const url = new URL(request.url);
  const query = url.searchParams.toString();
  const method = request.method;

  console.log("loader method", method);

  throw redirect(query ? `/app?${query}` : "/app");
};
```

This route technically has a component, but it never really renders because the loader redirects first.

For loaders, `request.method` is typically `"GET"` because loaders handle page/data loading requests.

## 6. What `action` is for

Use `action` when the route needs to handle a mutation.

Typical uses:

- create a record
- update a record
- delete a record
- process a form

Example from `app/routes/app._index.jsx`:

```jsx
<Form method="post" className={styles.form}>
  <input type="hidden" name="intent" value="create" />
  <button type="submit">Create modal</button>
</Form>
```

When that form submits:

- React Router sends a `POST` to the same route
- the route `action` runs
- the action reads `request.formData()`
- the action can inspect `request.method`
- the action writes to Prisma
- the component receives the result through `useActionData()`

Example:

```jsx
export const action = async ({ request }) => {
  const method = request.method;
  const formData = await request.formData();

  console.log("action method", method);

  return { ok: true };
};
```

Example action branch:

```jsx
if (intent === "delete") {
  await prisma.modal.delete({
    where: { id },
  });

  return { success: "Modal deleted." };
}
```

## 7. `ErrorBoundary`: what it is

`ErrorBoundary` is a special exported component that React Router renders when the route throws.

In `app/routes/app.jsx`:

```jsx
export function ErrorBoundary() {
  return boundary.error(useRouteError());
}
```

This project uses Shopify's helper:

```jsx
import { boundary } from "@shopify/shopify-app-react-router/server";
```

Why it exists:

- a `loader` can throw an error
- an `action` can throw an error
- a route can throw a `Response`, like a redirect or authorization failure
- rendering code can throw

Without an error boundary, the user gets a less controlled failure path.

### Example situations where `ErrorBoundary` is useful

```jsx
export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);

  if (!session.shop) {
    throw new Response("Unauthorized", { status: 401 });
  }

  return { ok: true };
};
```

If that throws, `ErrorBoundary` for that route tree is used.

### Why this app uses Shopify's `boundary.error`

Shopify authentication and embedded app behavior often rely on specific thrown responses and headers. The Shopify helper makes sure those get handled in a way compatible with the app bridge and auth flow.

If you are working inside a Shopify embedded app, use the Shopify helper in route boundaries rather than inventing your own basic `div`-only fallback first.

### A custom error boundary example

You can still write your own boundary if needed:

```jsx
import { isRouteErrorResponse, useRouteError } from "react-router";

export function ErrorBoundary() {
  const error = useRouteError();

  if (isRouteErrorResponse(error)) {
    return (
      <div>
        <h1>{error.status}</h1>
        <p>{error.statusText}</p>
      </div>
    );
  }

  return (
    <div>
      <h1>Unexpected error</h1>
    </div>
  );
}
```

Use this approach when you want a route-specific error UI.

## 8. `headers`: what it is

`headers` is another special route export. It lets a route control the HTTP headers that go out with the response.

In `app/routes/app.jsx`:

```jsx
export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
```

And in `app/routes/auth.$.jsx`:

```jsx
export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
```

### Why this matters in Shopify apps

Some auth and embedded app responses need important headers to survive redirects, thrown responses, and nested route handling. Shopify's `boundary.headers(...)` helps preserve those correctly.

In this app, `headers` is mostly there to support Shopify's route handling requirements.

### A manual headers example

You can also return your own headers:

```jsx
export const headers = () => {
  return {
    "Cache-Control": "no-store",
  };
};
```

Use that when you want page-level cache behavior or custom header values.

### `Response.json(...)` vs route `headers`

These are related but different:

- `Response.json(data, { headers })` sets headers on that specific response
- route export `headers()` lets the route define headers at the route level

Example from `proxy.modals.jsx`:

```jsx
return Response.json(
  { modal },
  {
    headers: {
      "Cache-Control": "no-store",
    },
  },
);
```

That is enough for the JSON endpoint because the response is being built directly there.

## 9. When to use each pattern

### Use a page route when

- the browser is navigating to a page in your app
- you need a React component to render UI
- you want `useLoaderData()` and `useActionData()`
- you are building admin screens like `/app`

### Use a data-only route when

- another client calls the route with `fetch()`
- you want JSON, not HTML
- rendering happens in another layer, like Liquid or frontend JavaScript
- you are exposing app data to the storefront through an app proxy

## 10. What `proxy` means in the filename

`proxy` in `proxy.modals.jsx` is not a special React Router keyword.

It is just part of the filename, and because this app uses file-based routing, that filename becomes part of the URL:

```text
app/routes/proxy.modals.jsx -> /proxy/modals
```

So in this app, `proxy` is only a naming convention. It signals that this route is meant to receive proxied Shopify storefront requests.

React Router does not treat `proxy` specially. You could name the file differently:

```text
app/routes/api.modals.jsx    -> /api/modals
app/routes/public.modals.jsx -> /public/modals
```

The reason this route is called `proxy.modals.jsx` is architectural, not router magic.

## 11. Why there are two different URLs

This is the part that usually causes confusion.

There are two separate URL spaces involved:

1. The public storefront URL used by the browser
2. The backend route URL handled by your app

In this project:

```text
Storefront browser URL: /apps/store-modals
Backend app route URL: /proxy/modals
```

Those are not two route roots inside React Router. They are two layers of the request path.

### Layer 1: storefront/public URL

The Liquid embed calls:

```text
/apps/store-modals
```

That path comes from Shopify app proxy config in `shopify.app.toml`:

```toml
[app_proxy]
url = "https://example.com/proxy/modals"
subpath = "store-modals"
prefix = "apps"
```

That means Shopify exposes this public storefront path:

```text
/apps/store-modals
```

### Layer 2: backend route URL

Shopify forwards that request to your app backend URL:

```text
/proxy/modals
```

React Router then matches that URL to:

```text
app/routes/proxy.modals.jsx
```

### End-to-end request flow

```text
modal-embed.liquid
  -> fetch("/apps/store-modals?shop=...&pageType=...")
Shopify storefront
  -> Shopify app proxy forwards the request
Your app backend
  -> /proxy/modals
React Router
  -> app/routes/proxy.modals.jsx
Route loader
  -> Prisma query
Response
  -> JSON { modal }
```

### Important conclusion

The route is a data route because it returns JSON.

It is not a data route because its name starts with `proxy`.

And it is not using `/apps/...` because React Router requires that prefix.

`/apps/...` exists only because Shopify app proxy is configured that way.

## 12. Route map for this app

### `app/root.jsx`

Top-level document shell.

Responsibilities:

- HTML document
- `<Meta />`
- `<Links />`
- `<Scripts />`
- top-level `<Outlet />`

### `app/routes/_index/route.jsx`

Route for `/`.

Responsibilities:

- redirect the root path to `/app`

### `app/routes/app.jsx`

Parent route for admin app pages.

Responsibilities:

- authenticate admin requests
- provide `apiKey`
- render `AppProvider`
- render shared nav
- render `<Outlet />` for child pages
- define Shopify-aware `ErrorBoundary`
- define Shopify-aware `headers`

### `app/routes/app._index.jsx`

Admin home page for `/app`.

Responsibilities:

- load modals from the database
- render the modal list and create form
- handle create/update/delete actions

### `app/routes/proxy.modals.jsx`

Backend JSON route for storefront requests.

Responsibilities:

- read `shop` and `pageType`
- fetch enabled modals
- choose the best matching modal
- return JSON

### `app/routes/auth.login/route.jsx`

Login page route.

Responsibilities:

- render login form
- run login logic in `loader` and `action`

### `app/routes/auth.$.jsx`

Shopify auth catch-all helper route.

Responsibilities:

- authenticate admin request
- preserve Shopify response headers through `headers`

## 13. Practical rules for this codebase

When adding a route in this app:

1. Put the file under `app/routes`.
2. Add a `loader` if the route needs `GET` data or auth checks.
3. Add an `action` if the route needs to process form submissions.
4. Add a default component if the route should render UI.
5. Add `ErrorBoundary` and `headers` when the route is part of the Shopify embedded admin flow and may need Shopify boundary handling.
6. Return `Response.json(...)` for API-like routes.
7. Use `<Outlet />` in parent routes that should render children.

## 14. Good examples to copy

### New admin page

Use `app/routes/app.some-page.jsx` style patterns:

```jsx
import { useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }) => {
  await authenticate.admin(request);

  return { message: "Hello from admin page" };
};

export default function SomePage() {
  const { message } = useLoaderData();

  return <s-page>{message}</s-page>;
}
```

### New JSON endpoint

Use a data-only route:

```jsx
export const loader = async ({ request }) => {
  const url = new URL(request.url);
  const id = url.searchParams.get("id");
  const method = request.method;

  return Response.json({ id, method, ok: true });
};
```

### New form action

```jsx
import { Form, useActionData } from "react-router";

export const action = async ({ request }) => {
  const method = request.method;
  const formData = await request.formData();
  const name = String(formData.get("name") || "");

  return { success: `Saved ${name}`, method };
};

export default function ExampleForm() {
  const actionData = useActionData();

  return (
    <>
      <Form method="post">
        <input name="name" />
        <button type="submit">Save</button>
      </Form>
      {actionData?.success ? <p>{actionData.success}</p> : null}
      {actionData?.method ? <p>Method: {actionData.method}</p> : null}
    </>
  );
}
```

## 13. How to read the request method

Both `loader` and `action` receive the Web `Request` object.

Example:

```jsx
export const loader = async ({ request }) => {
  console.log(request.method); // usually GET
  return { method: request.method };
};

export const action = async ({ request }) => {
  console.log(request.method); // often POST from <Form method="post">
  return { method: request.method };
};
```

Common values:

- `GET` for loaders
- `POST` for most route actions triggered by forms
- other methods are possible when you submit or call the route differently

## 15. Summary

Use this mental model:

- `loader` = server-side `GET`
- `action` = server-side mutation
- route component = page rendering
- `ErrorBoundary` = fallback UI for thrown errors and responses
- `headers` = response header control and Shopify header forwarding
- `Response.json(...)` = API/data endpoint response
- `<Outlet />` = child route rendering

In this app, `app._index.jsx` is the clearest example of an admin page route, and `proxy.modals.jsx` is the clearest example of a backend data-only route.
