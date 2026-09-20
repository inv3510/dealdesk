import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { status } from "./schema";

export const list = query({
  args: { sessionId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("deals")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .order("desc")
      .take(100);
  },
});

export const messages = query({
  args: { dealId: v.id("deals") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("messages")
      .withIndex("by_deal", (q) => q.eq("dealId", args.dealId))
      .collect();
  },
});

export const createManual = mutation({
  args: {
    sessionId: v.string(),
    address: v.string(),
    askingPrice: v.optional(v.number()),
    sellerName: v.optional(v.string()),
    sellerEmail: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("deals", {
      ...args,
      isDemo: false,
      status: "new",
    });
  },
});

export const setStatus = mutation({
  args: { dealId: v.id("deals"), status },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.dealId, { status: args.status });
  },
});

export const remove = mutation({
  args: { dealId: v.id("deals") },
  handler: async (ctx, args) => {
    const msgs = await ctx.db
      .query("messages")
      .withIndex("by_deal", (q) => q.eq("dealId", args.dealId))
      .collect();
    for (const m of msgs) await ctx.db.delete(m._id);
    await ctx.db.delete(args.dealId);
  },
});

export const seedDemo = mutation({
  args: { sessionId: v.string() },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("deals")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .take(1);
    if (existing.length > 0) return;

    const base = { sessionId: args.sessionId, isDemo: true, fee: 10000 };

    const d1 = await ctx.db.insert("deals", {
      ...base,
      status: "replied" as const,
      address: "2418 Live Oak Dr, Garland, TX",
      askingPrice: 118000,
      beds: 3,
      baths: 2,
      sqft: 1340,
      yearBuilt: 1978,
      arv: 235000,
      repairs: 32000,
      mao: 122500,
      score: 88,
      rationale:
        "Asking price is under MAO with a wide margin. Solid comps nearby and moderate cosmetic repairs.",
      sellerName: "Maria G.",
    });
    await ctx.db.insert("messages", {
      dealId: d1,
      direction: "outbound",
      state: "sent",
      subject: "Your property on Live Oak Dr",
      body: "Hi Maria, I'm a local buyer interested in your property on Live Oak Dr. Would you consider a fast, as-is cash offer?",
    });
    await ctx.db.insert("messages", {
      dealId: d1,
      direction: "inbound",
      state: "received",
      body: "Thanks for reaching out. I might consider it but I was hoping for closer to $135k.",
      intent: "price_objection",
      suggestedReply:
        "Thanks Maria. I understand. Based on the repairs the house needs, I can offer $118k cash, close on your timeline, and cover closing costs. Can we talk this week?",
    });

    const d2 = await ctx.db.insert("deals", {
      ...base,
      status: "outreach_sent" as const,
      address: "1109 Pioneer Rd, Mesquite, TX",
      askingPrice: 142000,
      beds: 4,
      baths: 2,
      sqft: 1720,
      yearBuilt: 1985,
      arv: 228000,
      repairs: 28000,
      mao: 121600,
      score: 54,
      rationale:
        "Asking price is about $20k above MAO. Worth a low offer, but the margin is thin.",
      sellerName: "David R.",
    });
    await ctx.db.insert("messages", {
      dealId: d2,
      direction: "outbound",
      state: "sent",
      subject: "Your property on Pioneer Rd",
      body: "Hi David, I'm a local buyer interested in your Pioneer Rd property. Are you open to a quick cash offer?",
    });

    await ctx.db.insert("deals", {
      ...base,
      status: "new" as const,
      address: "3316 Avenue H, Fort Worth, TX",
      askingPrice: 96000,
      beds: 3,
      baths: 1,
      sqft: 1100,
      yearBuilt: 1954,
      arv: 189000,
      repairs: 41000,
      mao: 81300,
      score: 46,
      rationale:
        "Heavy repairs and an asking price about $15k above MAO. Only pursue with a big discount.",
    });

    await ctx.db.insert("deals", {
      ...base,
      status: "under_contract" as const,
      address: "807 Pecan Ct, Arlington, TX",
      askingPrice: 168000,
      beds: 4,
      baths: 2,
      sqft: 1980,
      yearBuilt: 1992,
      arv: 310000,
      repairs: 38000,
      mao: 169000,
      score: 79,
      rationale:
        "Contract price is just under MAO with strong resale comps. Good spread for an assignment.",
      sellerName: "Linda K.",
    });

    await ctx.db.insert("deals", {
      ...base,
      status: "dead" as const,
      address: "2205 Oak Hollow, Irving, TX",
      askingPrice: 205000,
      beds: 3,
      baths: 2,
      sqft: 1500,
      yearBuilt: 2001,
      arv: 265000,
      repairs: 25000,
      mao: 150500,
      score: 22,
      rationale:
        "Asking price is more than $50k above MAO. The numbers don't work for a wholesale deal.",
    });
  },
});
