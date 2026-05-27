# Shopify Extension Notes

## Generate Command

```bash
shopify app generate extension --template admin_block --flavor react --name hello-world-block --path .
```

## Short Version Of Current Shopify Extension Templates

- `admin_action`: Adds an action in Shopify Admin that opens a modal workflow.
- `admin_block`: Adds an inline card or block on Admin resource pages like products or orders.
- `admin_print`: Adds a print-oriented action in Admin for printable documents and previews.
- `admin_purchase_option`: Extends Admin purchase option workflows.
- `conditional_admin_action`: Like `admin_action`, but can be shown or hidden based on context.
- `admin_link`: Adds a link entry point from Shopify Admin into your app.
- `support_link`: Adds a support or help link entry point.
- `subscription_link_extension`: Adds subscription-related linking behavior in Admin.

- `checkout_ui`: Adds custom UI inside checkout at supported extension targets.
- `post_purchase_ui`: Adds UI immediately after checkout completion.
- `customer_account_ui`: Adds UI to the customer account experience.
- `theme_app_extension`: Adds app blocks, embeds, or assets to storefront themes.
- `web_pixel`: Runs tracking or analytics logic using Shopify’s web pixel framework.

- `pos_action`: Adds an action flow in Shopify POS, usually launching a modal or screen.
- `pos_block`: Adds inline content inside an existing POS screen.
- `pos_smart_grid`: Adds a tile to the POS smart grid home screen.
- `pos_ui`: General POS UI extension scaffold.

- `flow_action`: Lets Shopify Flow send data to your app when a workflow action runs.
- `flow_trigger`: Lets your app trigger Shopify Flow workflows.
- `flow_template`: Ships a reusable example Flow workflow template.
- `flow_trigger_lifecycle_callback`: Handles lifecycle events around Flow triggers.

- `discount`: Generic discount function scaffold.
- `order_discounts`: Discount logic for order-level discounts.
- `product_discounts`: Discount logic for line-item or product discounts.
- `shipping_discounts`: Discount logic for shipping discounts.
- `discounts_allocator`: Controls how multiple discounts are allocated or applied.

- `cart_transform`: Changes cart lines or pricing behavior before checkout.
- `cart_checkout_validation`: Validates cart or checkout rules and blocks invalid states.
- `delivery_customization`: Reorders, renames, hides, or customizes delivery options.
- `payment_customization`: Reorders, renames, hides, or customizes payment methods.
- `fulfillment_constraints`: Applies fulfillment-related restrictions or rules.
- `local_pickup_delivery_option_generator`: Generates local pickup delivery options.
- `pickup_point_delivery_option_generator`: Generates pickup-point delivery choices.

- `product_configuration`: Adds custom product configuration logic.
- `discount_details_function_settings`: Settings UI for discount-related functions.
- `validation_settings_ui`: Settings UI for validation-style functions.
- `editor_extension_collection`: Extension set for editor-style experiences.
- `customer_segment_template`: Creates a customer segment-related template or example.

## `--flavor` Types

- `vanilla-js`: Plain JavaScript starter.
- `react`: React starter for UI extensions.
- `typescript`: Plain TypeScript starter.
- `typescript-react`: React + TypeScript starter for UI extensions.
- `wasm`: WebAssembly-oriented starter, typically for Shopify Functions.
- `rust`: Rust starter, typically for Shopify Functions.

More info:

```shell
shopify app generate extension --help
```
