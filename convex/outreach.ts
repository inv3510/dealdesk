import { v } from "convex/values";
import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
} from "./_generated/server";
import { internal } from "./_generated/api";
import { status } from "./schema";
import { generateJson } from "./ai";

declare const process: { env: Record<string, string | undefined> };

const INTENTS = [
  "interested",
  "price_objection",
  "question",
  "not_interested",
] as const;
type Intent = (typeof INTENTS)[number];

export const getDeal = internalQuery({
  args: { dealId: v.id("deals") },
  handler: async (ctx, args) => await ctx.db.get(args.dealId),
});

export const getMessage = internalQuery({
  args: { messageId: v.id("messages") },
  handler: async (ctx, args) => await ctx.db.get(args.messageId),
});

export const insertMessage = internalMutation({
  args: {
    dealId: v.id("deals"),
    direction: v.union(v.literal("outbound"), v.literal("inbound")),
    state: v.union(
      v.literal("draft"),
      v.literal("sent"),
      v.literal("received"),
    ),
    subject: v.optional(v.string()),
    body: v.string(),
  },
  handler: async (ctx, args) => await ctx.db.insert("messages", args),
});

export const markSent = internalMutation({
  args: {
    messageId: v.id("messages"),
    dealId: v.id("deals"),
    body: v.optional(v.string()),
    dealStatus: status,
  },
  handler: async (ctx, args) => {
    const patch: { state: "sent"; body?: string } = { state: "sent" };
    if (args.body !== undefined) patch.body = args.body;
    await ctx.db.patch(args.messageId, patch);
    await ctx.db.patch(args.dealId, { status: args.dealStatus });
  },
});

export const setIntent = internalMutation({
  args: {
    messageId: v.id("messages"),
    intent: v.union(
      v.literal("interested"),
      v.literal("price_objection"),
      v.literal("question"),
      v.literal("not_interested"),
    ),
    suggestedReply: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const patch: {
      intent: Intent;
      suggestedReply?: string;
    } = { intent: args.intent };
    if (args.suggestedReply !== undefined) {
      patch.suggestedReply = args.suggestedReply;
    }
    await ctx.db.patch(args.messageId, patch);
  },
});

export const storeInbound = internalMutation({
  args: {
    fromEmail: v.string(),
    subject: v.optional(v.string()),
    body: v.string(),
  },
  handler: async (ctx, args): Promise<void> => {
    const email = args.fromEmail.trim();
    let deal = await ctx.db
      .query("deals")
      .withIndex("by_seller_email", (q) => q.eq("sellerEmail", email))
      .order("desc")
      .first();
    if (!deal) {
      deal = await ctx.db
        .query("deals")
        .withIndex("by_seller_email", (q) =>
          q.eq("sellerEmail", email.toLowerCase()),
        )
        .order("desc")
        .first();
    }
    if (!deal) return;
    const messageId = await ctx.db.insert("messages", {
      dealId: deal._id,
      direction: "inbound",
      state: "received",
      subject: args.subject,
      body: args.body,
    });
    if (
      deal.status === "new" ||
      deal.status === "analyzing" ||
      deal.status === "outreach_sent"
    ) {
      await ctx.db.patch(deal._id, { status: "replied" });
    }
    await ctx.scheduler.runAfter(0, internal.outreach.classifyInbound, {
      messageId,
    });
  },
});

async function sendEmail(to: string, subject: string, text: string) {
  const key = process.env.AGENTMAIL_API_KEY;
  const inbox = process.env.AGENTMAIL_INBOX;
  if (!key || !inbox) {
    throw new Error("AGENTMAIL_API_KEY or AGENTMAIL_INBOX is not set");
  }
  const allowed = (process.env.ALLOWED_RECIPIENTS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (!allowed.includes(to.trim().toLowerCase())) {
    throw new Error(
      "Demo safety: emails can only be sent to addresses listed in ALLOWED_RECIPIENTS",
    );
  }
  const res = await fetch(
    `https://api.agentmail.to/v0/inboxes/${encodeURIComponent(inbox)}/messages/send`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({ to: [to.trim()], subject, text }),
    },
  );
  if (!res.ok) {
    throw new Error(
      `AgentMail error ${res.status}: ${(await res.text()).slice(0, 200)}`,
    );
  }
}

export const draftOutreach = action({
  args: { dealId: v.id("deals") },
  handler: async (ctx, args): Promise<void> => {
    const deal = await ctx.runQuery(internal.outreach.getDeal, {
      dealId: args.dealId,
    });
    if (!deal) throw new Error("Deal not found");
    const sender = process.env.SENDER_NAME ?? "Jonah";
    const prompt = `Write a short, friendly, honest cold email from a real estate investor named ${sender} to the owner of a house in Texas.
Property: ${deal.address}
Owner name: ${deal.sellerName ?? "unknown (use a neutral greeting)"}
Rules:
- Say you are a real estate investor who buys houses for cash, as-is. do not describe yourself as local and do not claim to live in texas .
- Ask whether they would consider selling and what price they would want.
- Do NOT state an offer price and do NOT mention any fees, margins or formulas.
- Under 110 words, plain text, no fake claims, sign off with the name ${sender}.
Return ONLY JSON: {"subject": string, "body": string}`;
    const ai: any = await generateJson(prompt);
    if (typeof ai?.subject !== "string" || typeof ai?.body !== "string") {
      throw new Error("AI did not return a subject and body");
    }
    await ctx.runMutation(internal.outreach.insertMessage, {
      dealId: args.dealId,
      direction: "outbound",
      state: "draft",
      subject: ai.subject.slice(0, 150),
      body: ai.body,
    });
  },
});

export const approveSend = action({
  args: { messageId: v.id("messages"), body: v.optional(v.string()) },
  handler: async (ctx, args): Promise<void> => {
    const msg = await ctx.runQuery(internal.outreach.getMessage, {
      messageId: args.messageId,
    });
    if (!msg || msg.state !== "draft") throw new Error("Draft not found");
    const deal = await ctx.runQuery(internal.outreach.getDeal, {
      dealId: msg.dealId,
    });
    if (!deal?.sellerEmail) {
      throw new Error("Add the seller's email before sending");
    }
    const body = args.body ?? msg.body;
    await sendEmail(deal.sellerEmail, msg.subject ?? "Your property", body);
    await ctx.runMutation(internal.outreach.markSent, {
      messageId: msg._id,
      dealId: deal._id,
      body,
      dealStatus: "outreach_sent",
    });
  },
});

export const approveReply = action({
  args: { messageId: v.id("messages"), body: v.optional(v.string()) },
  handler: async (ctx, args): Promise<void> => {
    const inbound = await ctx.runQuery(internal.outreach.getMessage, {
      messageId: args.messageId,
    });
    if (!inbound || inbound.direction !== "inbound") {
      throw new Error("Reply not found");
    }
    const body = args.body ?? inbound.suggestedReply;
    if (!body) throw new Error("There is no suggested reply to send");
    const deal = await ctx.runQuery(internal.outreach.getDeal, {
      dealId: inbound.dealId,
    });
    if (!deal?.sellerEmail) throw new Error("This deal has no seller email");
    const base = inbound.subject ?? "Your property";
    const subject = /^re:/i.test(base) ? base : `Re: ${base}`;
    await sendEmail(deal.sellerEmail, subject, body);
    const sentId = await ctx.runMutation(internal.outreach.insertMessage, {
      dealId: deal._id,
      direction: "outbound",
      state: "draft",
      subject,
      body,
    });
    await ctx.runMutation(internal.outreach.markSent, {
      messageId: sentId,
      dealId: deal._id,
      dealStatus: "negotiating",
    });
  },
});

export const classifyInbound = internalAction({
  args: { messageId: v.id("messages") },
  handler: async (ctx, args): Promise<void> => {
    const msg = await ctx.runQuery(internal.outreach.getMessage, {
      messageId: args.messageId,
    });
    if (!msg) return;
    const deal = await ctx.runQuery(internal.outreach.getDeal, {
      dealId: msg.dealId,
    });
    try {
      const sender = process.env.SENDER_NAME ?? "Jonah";
      const prompt = `You help a real estate investor named ${sender} handle replies from home sellers.
Property: ${deal?.address ?? "unknown"}. Seller's asking price: ${deal?.askingPrice ?? "unknown"}.
Seller's reply:
"""
${msg.body.slice(0, 3000)}
"""
1. Classify the intent as exactly one of: interested, price_objection, question, not_interested.
2. Write a short, polite, honest suggested reply (under 80 words, plain text, signed ${sender}). Never invent facts, never reveal internal numbers, margins or fees. If they are not interested, thank them and leave the door open.
Return ONLY JSON: {"intent": string, "suggestedReply": string}`;
      const ai: any = await generateJson(prompt);
      const intent: Intent = (INTENTS as readonly string[]).includes(ai?.intent)
        ? ai.intent
        : "question";
      await ctx.runMutation(internal.outreach.setIntent, {
        messageId: args.messageId,
        intent,
        suggestedReply:
          typeof ai?.suggestedReply === "string" ? ai.suggestedReply : undefined,
      });
    } catch {
      await ctx.runMutation(internal.outreach.setIntent, {
        messageId: args.messageId,
        intent: "question",
      });
    }
  },
});
