// Shopify Admin GraphQL 2026-04 — Product operations
// All operations are versioned against 2026-04.

export const GET_PRODUCT = /* GraphQL */ `
  query getProduct($id: ID!) {
    product(id: $id) {
      id
      title
      handle
      descriptionHtml
      vendor
      productType
      status
      tags
      totalInventory
      tracksInventory
      hasOutOfStockVariants
      createdAt
      updatedAt
      publishedAt
      priceRangeV2 {
        minVariantPrice { amount currencyCode }
        maxVariantPrice { amount currencyCode }
      }
      compareAtPriceRange {
        minVariantCompareAtPrice { amount currencyCode }
        maxVariantCompareAtPrice { amount currencyCode }
      }
      options {
        id
        name
        values
        position
      }
      variants(first: 100) {
        nodes {
          id
          title
          sku
          price
          compareAtPrice
          inventoryQuantity
          inventoryPolicy
          selectedOptions { name value }
        }
      }
      seo { title description }
      onlineStoreUrl
    }
  }
`;

export const LIST_PRODUCTS = /* GraphQL */ `
  query listProducts(
    $first: Int!
    $after: String
    $query: String
    $sortKey: ProductSortKeys
    $reverse: Boolean
  ) {
    products(
      first: $first
      after: $after
      query: $query
      sortKey: $sortKey
      reverse: $reverse
    ) {
      nodes {
        id
        title
        handle
        status
        vendor
        productType
        tags
        totalInventory
        updatedAt
        priceRangeV2 {
          minVariantPrice { amount currencyCode }
          maxVariantPrice { amount currencyCode }
        }
        variants(first: 5) {
          nodes {
            id
            title
            sku
            price
            inventoryQuantity
          }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

export const CREATE_PRODUCT = /* GraphQL */ `
  mutation productCreate($product: ProductCreateInput!, $media: [CreateMediaInput!]) {
    productCreate(product: $product, media: $media) {
      product {
        id
        title
        handle
        status
        options { id name values position }
        variants(first: 100) {
          nodes {
            id
            title
            price
            sku
            selectedOptions { name value }
          }
        }
      }
      userErrors { field message }
    }
  }
`;

export const UPDATE_PRODUCT = /* GraphQL */ `
  mutation productUpdate($product: ProductUpdateInput!) {
    productUpdate(product: $product) {
      product {
        id
        title
        handle
        status
        vendor
        productType
        tags
        updatedAt
      }
      userErrors { field message }
    }
  }
`;

export const DELETE_PRODUCT = /* GraphQL */ `
  mutation productDelete($input: ProductDeleteInput!) {
    productDelete(input: $input) {
      deletedProductId
      userErrors { field message }
    }
  }
`;

export const VARIANTS_BULK_CREATE = /* GraphQL */ `
  mutation productVariantsBulkCreate(
    $productId: ID!
    $variants: [ProductVariantsBulkInput!]!
  ) {
    productVariantsBulkCreate(productId: $productId, variants: $variants) {
      product { id }
      productVariants {
        id
        title
        price
        compareAtPrice
        sku
        inventoryPolicy
        selectedOptions { name value }
      }
      userErrors { field message }
    }
  }
`;

export const VARIANTS_BULK_UPDATE = /* GraphQL */ `
  mutation productVariantsBulkUpdate(
    $productId: ID!
    $variants: [ProductVariantsBulkInput!]!
  ) {
    productVariantsBulkUpdate(productId: $productId, variants: $variants) {
      product { id }
      productVariants {
        id
        title
        price
        compareAtPrice
        sku
        inventoryPolicy
        selectedOptions { name value }
      }
      userErrors { field message }
    }
  }
`;