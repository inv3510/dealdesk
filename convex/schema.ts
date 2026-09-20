import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export const status = v.union(
  v.literal("new"),
  v.literal("analyzing"),
  v.literal("outreach_sent"),
  v.literal("replied"),
  v.literal("negotiating"),
  v.literal("under_contract"),
  v.literal("dead"),
);

export default defineSchema({
  deals: defineTable({
    sessionId: v.string(),
    isDemo: v.boolean(),
    status,
    address: v.string(),
    listingUrl: v.optional(v.string()),
    askingPrice: v.optional(v.number()),
    beds: v.optional(v.number()),
    baths: v.optional(v.number()),
    sqft: v.optional(v.number()),
    yearBuilt: v.optional(v.number()),
    description: v.optional(v.string()),
    arv: v.optional(v.number()),
    repairs: v.optional(v.number()),
    fee: v.optional(v.number()),
    mao: v.optional(v.number()),
    score: v.optional(v.number()),
    rationale: v.optional(v.string()),
    sellerName: v.optional(v.string()),
    sellerEmail: v.optional(v.string()),
    error: v.optional(v.string()),
  })
    .index("by_session", ["sessionId"])
    .index("by_seller_email", ["sellerEmail"]),

  messages: defineTable({
    dealId: v.id("deals"),
    direction: v.union(v.literal("outbound"), v.literal("inbound")),
    state: v.union(
      v.literal("draft"),
      v.literal("sent"),
      v.literal("received"),
    ),
    subject: v.optional(v.string()),
    body: v.string(),
    intent: v.optional(
      v.union(
        v.literal("interested"),
        v.literal("price_objection"),
        v.literal("question"),
        v.literal("not_interested"),
      ),
    ),
    suggestedReply: v.optional(v.string()),
  }).index("by_deal", ["dealId"]),
});
