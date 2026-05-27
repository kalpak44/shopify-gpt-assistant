# Shopify Profiles

Shopify supports a profile-like workflow by using multiple app configuration files.

This is similar to Spring Boot profiles, but the mechanism is different:
- Spring Boot usually switches configuration values inside one app.
- Shopify usually switches between different Shopify app configurations using different TOML files.

## Typical Config Files

```text
shopify.app.toml
shopify.app.dev.toml
shopify.app.staging.toml
shopify.app.prod.toml
```

## What Each File Represents

- `shopify.app.toml`
  Default app configuration file.
- `shopify.app.dev.toml`
  Development app configuration.
- `shopify.app.staging.toml`
  Staging app configuration.
- `shopify.app.prod.toml`
  Production app configuration.

Each file can point to a different Shopify app through its `client_id`.

## Why Use Multiple Profiles

This helps avoid:
- developing against the production Shopify app
- deploying test changes to the wrong app
- mixing dev, staging, and production stores

## Typical Flow

### 1. Link the default app

```shell
shopify auth login
shopify app config link
```

Short explanation:
- Logs in to Shopify CLI.
- Links the current project to one Shopify app.

### 2. Link another environment

Run again:

```shell
shopify app config link
```

Short explanation:
- If `shopify.app.toml` already exists, Shopify CLI can create another named config file.
- Example: `shopify.app.dev.toml` or `shopify.app.staging.toml`

### 3. Choose the default profile

```shell
shopify app config use development
```

Short explanation:
- Sets the default configuration used by Shopify CLI commands.

### 4. Run commands against a specific profile

```shell
shopify app dev --config dev
shopify app deploy --config prod
```

Short explanation:
- `--config` explicitly chooses which configuration file to use for that command.

## Recommended Local Flow

```shell
shopify auth login
shopify app config link
shopify app config link
shopify app config use dev
shopify app generate extension --template theme_app_extension --name theme-extensions --path .
shopify app dev --config dev
```

## Notes

- `shopify.app.toml` files do not natively support Spring-style environment variable interpolation like `${VAR_NAME}`.
- If you need different values per environment, use multiple TOML files or generate TOML values in CI before running Shopify CLI.
- `client_id` is usually safe to commit because it is a public app identifier.
- Secrets should stay outside git, usually in `.env`.
- Named files like `shopify.app.dev.toml` are often kept local or ignored, depending on team workflow.
