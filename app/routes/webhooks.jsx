import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export const action = async ({ request }) => {
  const { topic, shop, payload } = await authenticate.webhook(request);

  switch (topic) {
    // ── GDPR: customer data export request ────────────────────────────────────
    // Our app stores chat messages as unstructured text without per-customer
    // indexing, so there is no customer-identifiable data to export.
    case "CUSTOMERS_DATA_REQUEST":
      console.log(`[webhook] CUSTOMERS_DATA_REQUEST shop=${shop} customer=${payload?.customer?.id}`);
      return new Response(null, { status: 200 });

    // ── GDPR: erase customer data ─────────────────────────────────────────────
    // Same rationale: messages are free-form text not keyed by customer ID.
    case "CUSTOMERS_REDACT":
      console.log(`[webhook] CUSTOMERS_REDACT shop=${shop} customer=${payload?.customer?.id}`);
      return new Response(null, { status: 200 });

    // ── GDPR: erase all shop data (sent ~48 h after uninstall) ───────────────
    case "SHOP_REDACT": {
      console.log(`[webhook] SHOP_REDACT shop=${shop} — deleting all data`);

      await Promise.all([
        // Sessions (offline + online)
        prisma.session.deleteMany({ where: { shop } }),
        // Chat data — ChatMessage and ChangeProposal cascade via FK
        prisma.chatSession.deleteMany({ where: { shop } }),
        // Config, billing, usage
        prisma.assistantConfig.deleteMany({ where: { shop } }),
        prisma.subscription.deleteMany({ where: { shop } }),
        prisma.tokenUsage.deleteMany({ where: { shop } }),
      ]);

      console.log(`[webhook] SHOP_REDACT shop=${shop} — done`);
      return new Response(null, { status: 200 });
    }

    default:
      console.warn(`[webhook] unhandled topic: ${topic}`);
      return new Response("Unhandled topic", { status: 404 });
  }
};