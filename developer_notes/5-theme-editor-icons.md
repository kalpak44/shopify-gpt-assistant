# Theme Editor Icons

Theme app extensions do not expose a normal schema option for choosing a custom icon per app block in the Shopify theme
editor.

## What You Can Control

- The app name shown in Shopify surfaces
- The app branding icon or logo configured in Shopify
- Clear block names such as `General Content`

## What You Typically Cannot Control

- A custom per-block sidebar icon through the block schema
- Arbitrary icon selection for each theme app block

## Why This Matters

In the Shopify theme editor, the block picker and sidebar UI are controlled mostly by Shopify.

So even if your theme app extension contains files like:

```text
assets/icon.svg
```

that does not mean there is a documented schema setting that lets you assign that file as the block icon in the theme
editor.

## If You See Missing Or Broken Icons

If the editor shows broken image placeholders for the app:

- check the app branding image in Shopify
- verify the app icon or logo is configured correctly

This is usually an app branding issue, not a Liquid block rendering issue.

## Recommended Practice

- Set the app branding icon in Shopify at `https://dev.shopify.com/`
- Use clear, merchant-friendly block names
- Treat block-specific icons in the theme editor as Shopify-controlled UI
