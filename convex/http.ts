import { httpRouter } from "convex/server";
import { Webhook } from "svix";
import { internal } from "./_generated/api";
import { httpAction } from "./_generated/server";

/** Only the fields we consume — the payload is much larger. */
type ClerkUserEvent = {
  type: string;
  data: {
    id: string;
    first_name?: string | null;
    last_name?: string | null;
    username?: string | null;
    image_url?: string | null;
    primary_email_address_id?: string | null;
    email_addresses?: { id: string; email_address: string }[];
  };
};

function displayName(data: ClerkUserEvent["data"], email?: string) {
  const full = [data.first_name, data.last_name].filter(Boolean).join(" ");
  return full || data.username || email || "Anonyme";
}

const handleClerkWebhook = httpAction(async (ctx, request) => {
  const secret = process.env.CLERK_WEBHOOK_SECRET;
  if (!secret) return new Response("Webhook secret not configured", { status: 500 });

  const body = await request.text();
  const headers = {
    "svix-id": request.headers.get("svix-id") ?? "",
    "svix-timestamp": request.headers.get("svix-timestamp") ?? "",
    "svix-signature": request.headers.get("svix-signature") ?? "",
  };

  let event: ClerkUserEvent;
  try {
    event = new Webhook(secret).verify(body, headers) as ClerkUserEvent;
  } catch {
    return new Response("Invalid signature", { status: 400 });
  }

  if (typeof event.data?.id !== "string") {
    return new Response("Malformed payload", { status: 400 });
  }

  switch (event.type) {
    case "user.created":
    case "user.updated": {
      const { data } = event;
      const email = data.email_addresses?.find(
        (e) => e.id === data.primary_email_address_id,
      )?.email_address;
      await ctx.runMutation(internal.users.upsertFromClerk, {
        clerkUserId: data.id,
        name: displayName(data, email),
        email,
        avatarUrl: data.image_url ?? undefined,
      });
      break;
    }
    case "user.deleted":
      await ctx.runMutation(internal.users.deleteFromClerk, {
        clerkUserId: event.data.id,
      });
      break;
    // Other event types are acknowledged so Clerk stops retrying them.
  }

  return new Response(null, { status: 200 });
});

const http = httpRouter();

http.route({
  path: "/clerk-webhook",
  method: "POST",
  handler: handleClerkWebhook,
});

export default http;
