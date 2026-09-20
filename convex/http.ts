import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";

declare const process: { env: Record<string, string | undefined> };

const http = httpRouter();

http.route({
  path: "/agentmail",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const secret = process.env.WEBHOOK_SECRET;
    if (secret) {
      const token = new URL(request.url).searchParams.get("token");
      if (token !== secret) {
        return new Response("forbidden", { status: 403 });
      }
    }

    let payload: any;
    try {
      payload = await request.json();
    } catch {
      return new Response("bad request", { status: 400 });
    }

    if (payload?.event_type === "message.received" && payload.message) {
      const m = payload.message;
      let fromRaw: any = Array.isArray(m.from) ? m.from[0] : m.from;
      if (fromRaw && typeof fromRaw === "object") fromRaw = fromRaw.email ?? "";
      const match = String(fromRaw ?? "").match(
        /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/,
      );
      if (match) {
        const raw: string =
          typeof m.text === "string"
            ? m.text
            : typeof m.preview === "string"
              ? m.preview
              : "";
        const text = raw.split(/\nOn .{0,80} wrote:/)[0].trim();
        await ctx.runMutation(internal.outreach.storeInbound, {
          fromEmail: match[0],
          subject: typeof m.subject === "string" ? m.subject : undefined,
          body: text || "(empty message)",
        });
      }
    }
    return new Response("ok", { status: 200 });
  }),
});

export default http;
