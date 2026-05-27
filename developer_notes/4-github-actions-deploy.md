# GitHub Actions Deploy

This project includes a GitHub Actions workflow that deploys the Shopify app on every push to `main`.

Workflow file:

```text
.github/workflows/deploy.yml
```

## What The Workflow Does

On every push to `main`, GitHub Actions:
- checks out the repository
- installs Node.js
- installs project dependencies
- installs Shopify CLI
- runs `shopify app deploy --allow-updates`

## Required GitHub Secret

The workflow requires this repository secret:

```text
SHOPIFY_CLI_PARTNERS_TOKEN
```

## Where To Get `SHOPIFY_CLI_PARTNERS_TOKEN`

From Shopify at:

```text
https://dev.shopify.com/
```

In the Shopify dashboard:

1. Open `Settings`
2. Open `CLI token`
3. Click `Manage tokens`
4. Choose token expiration
5. Click `Generate token`
6. Copy the token immediately

Important:
- Shopify only shows the token immediately after creation.
- If you lose it, you usually need to generate a new token.

## Add The Token To GitHub

In GitHub:

1. Open the repository
2. Go to `Settings`
3. Go to `Secrets and variables`
4. Open `Actions`
5. Click `New repository secret`
6. Name it `SHOPIFY_CLI_PARTNERS_TOKEN`
7. Paste the token value

## Important Limitation

This Shopify CI/CD method is currently available for Partner organization accounts.

That means:
- it works with CLI authentication tokens created from the Partner Dashboard
- it may not work for apps that are only managed through merchant-owned Dev Dashboard flows without Partner token support

## Practical Flow

1. Commit code
2. Push to `main`
3. GitHub Actions starts automatically
4. Shopify CLI deploys the current app configuration and extensions

## Notes

- This deploys Shopify app configuration and extensions.
- It does not deploy a custom hosted backend if the app has one.
- The workflow currently uses the default app config from `shopify.app.toml`.
