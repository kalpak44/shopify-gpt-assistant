# Link Project To Shopify

This project must be linked to a real Shopify app before commands like extension generation, local development, and
deployment will work.

## Why Linking Is Needed

The Shopify CLI needs to know which app in your Partner Dashboard this local folder belongs to.

Without linking:

- `shopify app generate extension` may fail because the CLI cannot resolve the organization or app.
- `shopify app dev` cannot correctly connect the project to a dev store.
- `shopify app deploy` cannot create an app version for the correct app.

## Option 1: Link With Shopify CLI

Run:

```shell
shopify auth login
shopify app config link
```

Short explanation:

- `shopify auth login`
  Logs the Shopify CLI into your Shopify account.
- `shopify app config link`
  Connects the current local folder to an existing app in your Shopify Partner Dashboard.

What usually happens:

- Shopify CLI asks you to choose an organization.
- Shopify CLI asks you to choose an app.
- The CLI updates local app configuration so this folder points to that Shopify app.

## Option 2: Add The App Client ID

The app can also be identified through `shopify.app.toml`.

Current file:

```toml
client_id = ""

[access_scopes]
scopes = ""
```

After linking, the `client_id` should match the Shopify app from your Partner Dashboard.

Example shape:

```toml
client_id = "1234567890abcdef1234567890abcdef"

[access_scopes]
scopes = "write_products"
```

Short explanation:

- `client_id`
  Identifies the Shopify app.
- `scopes`
  Declares which Admin API permissions the app needs.

## Where To Find The Client ID

In Shopify Partner Dashboard:
https://partners.shopify.com/ -> https://dev.shopify.com/
- Open your app
- Open app setup or configuration details
- Find the app API key or client ID value

Depending on the Shopify UI, this may appear as:

- `Client ID`
- `API key`
- app identifier in configuration settings

## After Linking

Once the project is linked, commands like these should work:

```shell
shopify app generate extension --template theme_app_extension --name theme-extensions --path .
shopify app dev
shopify app deploy
```

## Recommended Local Flow

```shell
shopify auth login
shopify app config link
shopify app generate extension --template theme_app_extension --name theme-extensions --path .
shopify app dev
```
