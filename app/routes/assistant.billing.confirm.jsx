import { redirect, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate, BILLING_PLAN_PRO, BILLING_PLAN_ENTERPRISE } from "../shopify.server";
import { syncBillingToDb } from "../subscription.server.js";

const IS_TEST = process.env.NODE_ENV !== "production";

// Shopify redirects here after the merchant approves (or declines) a billing charge.
// We check the active subscription and sync it to the local DB.
export const loader = async ({ request }) => {
  const { session, billing } = await authenticate.admin(request);

  const { appSubscriptions } = await billing.check({
    plans: [BILLING_PLAN_PRO, BILLING_PLAN_ENTERPRISE],
    isTest: IS_TEST,
  });

  await syncBillingToDb(session.shop, appSubscriptions);

  throw redirect("/");
};

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers = (headersArgs) => boundary.headers(headersArgs);