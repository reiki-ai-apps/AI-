import Stripe from "https://esm.sh/stripe@17.7.0?target=deno";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, {
  apiVersion: "2024-12-18.acacia",
});
const cryptoProvider = Stripe.createSubtleCryptoProvider();

function planFromPrice(priceId: string | null | undefined) {
  if (priceId === Deno.env.get("STRIPE_PREMIUM_PRICE_ID")) return "premium";
  if (priceId === Deno.env.get("STRIPE_STANDARD_PRICE_ID")) return "standard";
  return "free";
}
function normalizedStatus(status: Stripe.Subscription.Status) {
  if (status === "incomplete_expired" || status === "paused") return "inactive";
  return status;
}

Deno.serve(async (req) => {
  const signature = req.headers.get("stripe-signature");
  if (!signature) return new Response("missing signature", { status: 400 });

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(
      await req.text(),
      signature,
      Deno.env.get("STRIPE_WEBHOOK_SIGNING_SECRET")!,
      undefined,
      cryptoProvider,
    );
  } catch {
    return new Response("invalid signature", { status: 400 });
  }

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const { data: seen } = await admin.from("stripe_events").select("id").eq("id", event.id).maybeSingle();
  if (seen) return new Response("already processed", { status: 200 });

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    const userId = session.client_reference_id;
    if (
      !userId ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(userId) ||
      !session.subscription
    ) {
      return new Response("invalid checkout reference", { status: 400 });
    }
    {
      const { data: userResult, error: userLookupError } = await admin.auth.admin.getUserById(userId);
      const accountEmail = userResult.user?.email?.trim().toLowerCase();
      const checkoutEmail = (session.customer_details?.email ?? session.customer_email)?.trim().toLowerCase();
      if (userLookupError || !accountEmail || !checkoutEmail || accountEmail !== checkoutEmail) {
        console.error("checkout user verification failed", {
          eventId: event.id,
          hasUser: !!userResult.user,
          hasCheckoutEmail: !!checkoutEmail,
        });
        return new Response("checkout user verification failed", { status: 400 });
      }
      const subscription = await stripe.subscriptions.retrieve(String(session.subscription));
      const purchasedPriceId = subscription.items.data[0]?.price?.id;
      const purchasedPlan = planFromPrice(purchasedPriceId);
      if (purchasedPlan === "free") {
        console.error("unknown subscription price", { eventId: event.id, priceId: purchasedPriceId });
        return new Response("unknown subscription price", { status: 400 });
      }
      const { error } = await admin.from("subscriptions").upsert({
        user_id: userId,
        plan: purchasedPlan,
        status: normalizedStatus(subscription.status),
        stripe_customer_id: String(subscription.customer),
        stripe_subscription_id: subscription.id,
        current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
      });
      if (error) return new Response("subscription sync failed", { status: 500 });
    }
  }

  if (
    event.type === "customer.subscription.updated" ||
    event.type === "customer.subscription.deleted"
  ) {
    const subscription = event.data.object as Stripe.Subscription;
    const { data: row } = await admin
      .from("subscriptions")
      .select("user_id")
      .eq("stripe_subscription_id", subscription.id)
      .maybeSingle();
    if (row?.user_id) {
      const { error } = await admin.from("subscriptions").update({
        plan: event.type === "customer.subscription.deleted"
          ? "free"
          : planFromPrice(subscription.items.data[0]?.price?.id),
        status: event.type === "customer.subscription.deleted" ? "canceled" : normalizedStatus(subscription.status),
        current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
      }).eq("user_id", row.user_id);
      if (error) return new Response("subscription sync failed", { status: 500 });
    }
  }

  const { error: eventError } = await admin.from("stripe_events").insert({ id: event.id, event_type: event.type });
  if (eventError) return new Response("event log failed", { status: 500 });
  return new Response("ok", { status: 200 });
});
