import "@shopify/shopify-app-react-router/adapters/node";
import {
  ApiVersion,
  AppDistribution,
  BillingInterval,
  shopifyApp,
} from "@shopify/shopify-app-react-router/server";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";
import prisma from "./db.server";

export const BILLING_PLAN_PRO = "Pro";
export const BILLING_PLAN_ENTERPRISE = "Enterprise";

const shopify = shopifyApp({
  apiKey: process.env.SHOPIFY_API_KEY,
  apiSecretKey: process.env.SHOPIFY_API_SECRET || "",
  apiVersion: ApiVersion.October25,
  scopes: process.env.SCOPES?.split(",").filter(Boolean),
  appUrl: process.env.SHOPIFY_APP_URL || "",
  authPathPrefix: "/auth",
  sessionStorage: new PrismaSessionStorage(prisma),
  distribution: AppDistribution.AppStore,
  future: {
    expiringOfflineAccessTokens: true,
  },
  billing: {
    [BILLING_PLAN_PRO]: {
      lineItems: [
        { amount: 29, currencyCode: "USD", interval: BillingInterval.Every30Days },
      ],
    },
    [BILLING_PLAN_ENTERPRISE]: {
      lineItems: [
        { amount: 299, currencyCode: "USD", interval: BillingInterval.Every30Days },
      ],
    },
  },
  ...(process.env.SHOP_CUSTOM_DOMAIN
    ? { customShopDomains: [process.env.SHOP_CUSTOM_DOMAIN] }
    : {}),
});

export default shopify;
export const addDocumentResponseHeaders = shopify.addDocumentResponseHeaders;
export const authenticate = shopify.authenticate;
export const login = shopify.login;

// Exchange the stored refresh token for a fresh offline access token and
// write the result back to session storage. Returns the new accessToken, or
// null if the refresh cannot be performed (no refresh token, token expired,
// or Shopify rejected the request).
export async function refreshOfflineToken(shop) {
  const stored = await prisma.session.findUnique({
    where: { id: `offline_${shop}` },
  });

  if (!stored?.refreshToken) return null;
  if (stored.refreshTokenExpires && stored.refreshTokenExpires < new Date()) return null;

  try {
    const resp = await fetch(`https://${shop}/admin/oauth/access_token`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        client_id: process.env.SHOPIFY_API_KEY,
        client_secret: process.env.SHOPIFY_API_SECRET,
        refresh_token: stored.refreshToken,
        grant_type: "refresh_token",
      }),
    });

    if (!resp.ok) return null;

    const data = await resp.json();
    if (!data.access_token) return null;

    const now = Date.now();
    await prisma.session.update({
      where: { id: `offline_${shop}` },
      data: {
        accessToken: data.access_token,
        ...(data.expires_in && { expires: new Date(now + data.expires_in * 1000) }),
        ...(data.refresh_token && { refreshToken: data.refresh_token }),
        ...(data.refresh_token && data.refresh_token_expires_in && {
          refreshTokenExpires: new Date(now + data.refresh_token_expires_in * 1000),
        }),
      },
    });

    return data.access_token;
  } catch {
    return null;
  }
}
