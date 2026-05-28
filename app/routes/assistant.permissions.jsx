import { useState } from "react";
import { useLoaderData, useRouteError, Link, Form, useNavigation, useActionData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";
import { authenticate } from "../shopify.server";
import { getOrCreateSubscription } from "../subscription.server.js";
import prisma from "../db.server.js";

// ─── Permission group definitions ────────────────────────────────────────────

const GROUPS = [
  {
    label: "Products & Inventory",
    scopes: [
      { id: "read_products",  label: "Read products",  description: "List and view product details, variants, and media" },
      { id: "write_products", label: "Write products", description: "Create, update, and delete products and variants" },
      { id: "read_inventory", label: "Read inventory", description: "View inventory levels and locations" },
      { id: "write_inventory",label: "Write inventory",description: "Adjust inventory quantities" },
    ],
  },
  {
    label: "Orders & Fulfillments",
    scopes: [
      { id: "read_orders",         label: "Read orders",         description: "View order details, line items, and transactions" },
      { id: "write_orders",        label: "Write orders",        description: "Edit, cancel, and manage orders" },
      { id: "read_draft_orders",   label: "Read draft orders",   description: "View draft orders" },
      { id: "write_draft_orders",  label: "Write draft orders",  description: "Create and edit draft orders" },
      { id: "read_fulfillments",   label: "Read fulfillments",   description: "View fulfillment and tracking information" },
      { id: "write_fulfillments",  label: "Write fulfillments",  description: "Create and update fulfillments" },
    ],
  },
  {
    label: "Customers",
    scopes: [
      { id: "read_customers",  label: "Read customers",  description: "View customer profiles, addresses, and order history" },
      { id: "write_customers", label: "Write customers", description: "Create and update customer records and tags" },
    ],
  },
  {
    label: "Discounts & Pricing",
    scopes: [
      { id: "read_discounts",    label: "Read discounts",    description: "View discount codes and automatic discounts" },
      { id: "write_discounts",   label: "Write discounts",   description: "Create and manage discounts" },
      { id: "read_price_rules",  label: "Read price rules",  description: "View price rule configurations" },
      { id: "write_price_rules", label: "Write price rules", description: "Create and update price rules" },
      { id: "read_gift_cards",   label: "Read gift cards",   description: "View gift card balances and history" },
      { id: "write_gift_cards",  label: "Write gift cards",  description: "Issue and manage gift cards" },
    ],
  },
  {
    label: "Themes",
    scopes: [
      { id: "read_themes",  label: "Read themes",  description: "Read theme files, templates, and assets" },
      { id: "write_themes", label: "Write themes", description: "Modify theme files and settings" },
    ],
  },
  {
    label: "Markets & Shipping",
    scopes: [
      { id: "read_markets",   label: "Read markets",   description: "View international markets and their settings" },
      { id: "write_markets",  label: "Write markets",  description: "Configure markets and currencies" },
      { id: "read_shipping",  label: "Read shipping",  description: "View shipping zones, rates, and carriers" },
      { id: "write_shipping", label: "Write shipping", description: "Create and update shipping profiles" },
      { id: "read_locations", label: "Read locations", description: "View store locations and warehouses" },
    ],
  },
  {
    label: "Analytics & Reports",
    scopes: [
      { id: "read_analytics", label: "Read analytics", description: "Access store performance metrics and dashboards" },
      { id: "read_reports",   label: "Read reports",   description: "View existing custom reports" },
      { id: "write_reports",  label: "Write reports",  description: "Create and edit custom reports" },
    ],
  },
  {
    label: "Content & Marketing",
    scopes: [
      { id: "read_metaobjects",        label: "Read metaobjects",        description: "View custom metaobject entries" },
      { id: "write_metaobjects",       label: "Write metaobjects",       description: "Create and update metaobject entries" },
      { id: "read_publications",       label: "Read publications",       description: "View sales channel publications" },
      { id: "write_publications",      label: "Write publications",      description: "Manage product publishing to channels" },
      { id: "read_marketing_events",   label: "Read marketing events",   description: "View marketing activities and UTM data" },
      { id: "write_marketing_events",  label: "Write marketing events",  description: "Log and update marketing events" },
    ],
  },
];

// ─── Loader ──────────────────────────────────────────────────────────────────

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const subscription = await getOrCreateSubscription(shop);

  const grantedScopes = (session.scope ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const aiScopes = subscription.aiScopes
    ? subscription.aiScopes.split(",").map((s) => s.trim()).filter(Boolean)
    : null; // null = not yet configured; default to all granted

  return {
    apiKey: process.env.SHOPIFY_API_KEY || "",
    grantedScopes,
    aiScopes,
  };
};

// ─── Action ──────────────────────────────────────────────────────────────────

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const formData = await request.formData();
  const aiScopes = formData.get("aiScopes") ?? "";

  await prisma.subscription.update({
    where: { shop },
    data: { aiScopes: aiScopes || null },
  });

  return { saved: true };
};

// ─── Scope row component ──────────────────────────────────────────────────────

function ScopeRow({ scope, granted, enabled, onToggle, isLast }) {
  const status = !granted ? "missing" : enabled ? "active" : "disabled";

  const badge = {
    active:   { bg: "#e8f5f0", color: "#008060", border: "#95c4b8", icon: "✓", text: "Active" },
    disabled: { bg: "#fff8ec", color: "#b5620a", border: "#f0c040", icon: "⚠", text: "Disabled" },
    missing:  { bg: "#fef1f0", color: "#c0392b", border: "#f5aca6", icon: "✕", text: "Not granted" },
  }[status];

  const isOn = enabled && granted;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "12px",
        padding: "10px 16px",
        borderBottom: isLast ? "none" : "1px solid #f1f1f1",
        opacity: granted ? 1 : 0.55,
      }}
    >
      {/* Toggle switch — click handler on the visual div, no hidden input */}
      <div
        role="switch"
        aria-checked={isOn}
        aria-label={scope.label}
        onClick={() => granted && onToggle(scope.id)}
        style={{
          position: "relative",
          width: "36px",
          height: "20px",
          flexShrink: 0,
          cursor: granted ? "pointer" : "not-allowed",
          userSelect: "none",
        }}
      >
        <span
          style={{
            position: "absolute",
            inset: 0,
            borderRadius: "20px",
            background: isOn ? "#008060" : "#c9cccf",
            transition: "background 0.2s",
          }}
        />
        <span
          style={{
            position: "absolute",
            top: "3px",
            left: isOn ? "19px" : "3px",
            width: "14px",
            height: "14px",
            borderRadius: "50%",
            background: "#fff",
            transition: "left 0.2s",
            boxShadow: "0 1px 2px rgba(0,0,0,0.2)",
          }}
        />
      </div>

      {/* Label + description */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: "13px", fontWeight: 500, color: "#202223" }}>{scope.label}</div>
        <div style={{ fontSize: "11px", color: "#6d7175", marginTop: "1px" }}>{scope.description}</div>
      </div>

      {/* Status badge */}
      <span
        style={{
          padding: "2px 8px",
          borderRadius: "10px",
          fontSize: "11px",
          fontWeight: 600,
          background: badge.bg,
          color: badge.color,
          border: `1px solid ${badge.border}`,
          whiteSpace: "nowrap",
          flexShrink: 0,
        }}
      >
        {badge.icon} {badge.text}
      </span>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function AssistantPermissions() {
  const { apiKey, grantedScopes, aiScopes } = useLoaderData();
  const actionData = useActionData();
  const navigation = useNavigation();
  const saving = navigation.state === "submitting";

  const allGrantedIds = new Set(grantedScopes);

  // Default: if aiScopes not yet configured, all granted scopes are enabled
  const [enabled, setEnabled] = useState(() => new Set(aiScopes ?? grantedScopes));

  const toggle = (id) =>
    setEnabled((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const checkAll = () => setEnabled(new Set(grantedScopes));
  const uncheckAll = () => setEnabled(new Set());

  const allChecked = grantedScopes.length > 0 && grantedScopes.every((s) => enabled.has(s));
  const enabledCount = [...enabled].filter((s) => allGrantedIds.has(s)).length;

  return (
    <AppProvider embedded apiKey={apiKey}>
      <div style={{ padding: "32px 40px", fontFamily: "Inter, -apple-system, sans-serif", color: "#202223", maxWidth: "720px" }}>

        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "8px" }}>
          <Link to="/assistant/settings" style={{ fontSize: "13px", color: "#6d7175", textDecoration: "none" }}>
            ← Settings
          </Link>
          <span style={{ color: "#e1e3e5" }}>|</span>
          <h1 style={{ fontSize: "22px", fontWeight: 600, margin: 0 }}>AI Permissions</h1>
        </div>

        <p style={{ fontSize: "13px", color: "#6d7175", margin: "0 0 28px" }}>
          Control which Shopify permissions the AI assistant is allowed to use.
          Permissions not granted during installation are shown as "Not granted" and cannot be enabled here.
        </p>

        {/* Summary bar */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "12px 16px",
            background: "#f6f6f7",
            border: "1px solid #e1e3e5",
            borderRadius: "8px",
            marginBottom: "20px",
          }}
        >
          <span style={{ fontSize: "13px", color: "#6d7175" }}>
            <strong style={{ color: "#202223" }}>{enabledCount}</strong> of{" "}
            <strong style={{ color: "#202223" }}>{grantedScopes.length}</strong> granted permissions active
          </span>
          <div style={{ display: "flex", gap: "8px" }}>
            <button
              type="button"
              onClick={allChecked ? uncheckAll : checkAll}
              style={{
                padding: "5px 12px",
                fontSize: "12px",
                fontWeight: 500,
                color: "#303030",
                background: "#fff",
                border: "1px solid #c9cccf",
                borderRadius: "6px",
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              {allChecked ? "Uncheck All" : "Check All"}
            </button>
          </div>
        </div>

        {/* Permission groups */}
        <Form method="post">
          <input type="hidden" name="aiScopes" value={[...enabled].join(",")} />

          <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
            {GROUPS.map((group) => {
              const enabledInGroup = group.scopes.filter((s) => enabled.has(s.id)).length;

              return (
                <section key={group.label}>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      marginBottom: "6px",
                    }}
                  >
                    <h2
                      style={{
                        fontSize: "11px",
                        fontWeight: 600,
                        textTransform: "uppercase",
                        letterSpacing: "0.05em",
                        color: "#6d7175",
                        margin: 0,
                      }}
                    >
                      {group.label}
                    </h2>
                    <span style={{ fontSize: "11px", color: "#6d7175" }}>
                      {enabledInGroup}/{group.scopes.length} active
                    </span>
                  </div>

                  <div
                    style={{
                      border: "1px solid #e1e3e5",
                      borderRadius: "10px",
                      background: "#fff",
                      overflow: "hidden",
                    }}
                  >
                    {group.scopes.map((scope, i) => (
                      <ScopeRow
                        key={scope.id}
                        scope={scope}
                        granted={allGrantedIds.has(scope.id)}
                        enabled={enabled.has(scope.id)}
                        onToggle={toggle}
                        isLast={i === group.scopes.length - 1}
                      />
                    ))}
                  </div>
                </section>
              );
            })}
          </div>

          {/* Save bar */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginTop: "28px",
              padding: "14px 16px",
              background: "#fff",
              border: "1px solid #e1e3e5",
              borderRadius: "8px",
            }}
          >
            {actionData?.saved ? (
              <span style={{ fontSize: "13px", color: "#008060", fontWeight: 500 }}>
                ✓ Permissions saved
              </span>
            ) : (
              <span style={{ fontSize: "13px", color: "#6d7175" }}>
                Changes take effect on the next chat message.
              </span>
            )}
            <button
              type="submit"
              disabled={saving}
              style={{
                padding: "7px 18px",
                fontSize: "13px",
                fontWeight: 600,
                color: "#fff",
                background: saving ? "#6d7175" : "#008060",
                border: "none",
                borderRadius: "6px",
                cursor: saving ? "not-allowed" : "pointer",
                fontFamily: "inherit",
              }}
            >
              {saving ? "Saving…" : "Save permissions"}
            </button>
          </div>
        </Form>
      </div>
    </AppProvider>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers = (headersArgs) => boundary.headers(headersArgs);