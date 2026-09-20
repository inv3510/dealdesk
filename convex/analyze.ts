import { v } from "convex/values";
import { action, internalMutation } from "./_generated/server";
import type { ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { generateJson } from "./ai";

declare const process: { env: Record<string, string | undefined> };

const DEFAULT_FEE = 10000;

export const start = internalMutation({
  args: {
    sessionId: v.string(),
    address: v.string(),
    listingUrl: v.optional(v.string()),
    askingPrice: v.optional(v.number()),
    beds: v.optional(v.number()),
    baths: v.optional(v.number()),
    sqft: v.optional(v.number()),
    sellerName: v.optional(v.string()),
    sellerEmail: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("deals", {
      ...args,
      isDemo: false,
      status: "analyzing",
    });
  },
});

export const save = internalMutation({
  args: {
    dealId: v.id("deals"),
    address: v.optional(v.string()),
    askingPrice: v.optional(v.number()),
    beds: v.optional(v.number()),
    baths: v.optional(v.number()),
    sqft: v.optional(v.number()),
    yearBuilt: v.optional(v.number()),
    description: v.optional(v.string()),
    arv: v.number(),
    repairs: v.number(),
    fee: v.number(),
    mao: v.number(),
    score: v.number(),
    rationale: v.string(),
  },
  handler: async (ctx, args) => {
    const { dealId, ...fields } = args;
    const patch: Record<string, any> = {};
    for (const [k, val] of Object.entries(fields)) {
      if (val !== undefined) patch[k] = val;
    }
    await ctx.db.patch(dealId, { ...patch, status: "new", error: undefined });
  },
});

export const fail = internalMutation({
  args: { dealId: v.id("deals"), error: v.string() },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.dealId, { status: "new", error: args.error });
  },
});

function num(x: unknown): number | undefined {
  let n = NaN;
  if (typeof x === "number") n = x;
  else if (typeof x === "string" && x.trim() !== "") {
    n = Number(x.replace(/[$,]/g, ""));
  }
  return Number.isFinite(n) ? n : undefined;
}

function errMsg(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  return m.slice(0, 300);
}

function usd(n: number): string {
  return "$" + Math.round(n).toLocaleString("en-US");
}

function scoreFor(asking: number | undefined, mao: number, arv: number): number {
  if (asking === undefined || arv <= 0) return 50;
  const s = 50 + ((mao - asking) / arv) * 500;
  return Math.max(5, Math.min(98, Math.round(s)));
}

async function explain(
  address: string,
  asking: number | undefined,
  arv: number,
  repairs: number,
  fee: number,
  mao: number,
): Promise<string> {
  const spread = asking === undefined ? undefined : mao - asking;
  const fallback =
    spread === undefined
      ? `MAO is ${usd(mao)} (ARV x 0.70 minus repairs and fee).`
      : spread >= 0
        ? `Asking is ${usd(spread)} under MAO of ${usd(mao)}, which leaves room for an assignment.`
        : `Asking is ${usd(-spread)} over MAO of ${usd(mao)}, so the numbers only work with a lower price.`;
  try {
    const ai: any = await generateJson(`You are a real estate wholesaling analyst.
Exact facts (do not change them):
Address: ${address}
Asking price: ${asking === undefined ? "unknown" : usd(asking)}
ARV: ${usd(arv)}
Estimated repairs: ${usd(repairs)}
Assignment fee: ${usd(fee)}
MAO (ARV x 0.70 - repairs - fee): ${usd(mao)}
MAO minus asking price: ${spread === undefined ? "unknown" : usd(spread)} (negative means the asking price is OVER MAO)
Write two plain-English sentences a wholesaler would find useful. Be accurate about whether the asking price is under or over MAO. Do not invent any other facts.
Return ONLY JSON: {"rationale": string}`);
    if (typeof ai?.rationale === "string" && ai.rationale.trim() !== "") {
      return ai.rationale.trim();
    }
  } catch {
    // fall through to the plain sentence
  }
  return fallback;
}

async function scrape(url: string): Promise<string> {
  const key = process.env.FIRECRAWL_API_KEY;
  if (!key) throw new Error("FIRECRAWL_API_KEY is not set");
  const res = await fetch("https://api.firecrawl.dev/v2/scrape", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      url,
      formats: ["markdown"],
      onlyMainContent: true,
    }),
  });
  if (!res.ok) throw new Error(`Firecrawl error ${res.status}`);
  const data: any = await res.json();
  const md: string | undefined = data?.data?.markdown;
  if (!md || md.length < 200) {
    throw new Error("The listing page had no readable text");
  }
  return md;
}

async function analyzeAndSave(
  ctx: ActionCtx,
  dealId: Id<"deals">,
  text: string,
  fee: number,
  updateAddress: boolean,
  askingOverride?: number,
): Promise<void> {
  const prompt = `You are a real estate wholesaling analyst for the Dallas-Fort Worth, Texas market.
Below is information about a property. Do three things:
1. Extract the property details.
2. Estimate the ARV (after-repair value) as a realistic dollar number using the info and your knowledge of DFW prices.
3. Estimate repair costs from the condition described (assume a moderate rehab if the condition is unclear).

Return ONLY a JSON object with exactly these keys:
address (string), askingPrice (number or null), beds (number or null), baths (number or null), sqft (number or null), yearBuilt (number or null), description (string, max 200 characters), arv (number), repairs (number).

Property information:
${text.slice(0, 12000)}`;

  const ai: any = await generateJson(prompt);
  if (!ai || typeof ai !== "object") throw new Error("AI returned no data");
  const arv = num(ai.arv);
  const repairs = num(ai.repairs);
  if (arv === undefined || repairs === undefined) {
    throw new Error("AI did not return ARV and repairs");
  }
  const mao = Math.round(arv * 0.7 - repairs - fee);
  const asking = askingOverride ?? num(ai.askingPrice);
  const score = scoreFor(asking, mao, arv);
  const addr =
    typeof ai.address === "string" && ai.address.trim() !== ""
      ? ai.address.trim()
      : undefined;
  const rationale = await explain(
    addr ?? "this property",
    asking,
    arv,
    repairs,
    fee,
    mao,
  );

  await ctx.runMutation(internal.analyze.save, {
    dealId,
    address: updateAddress ? addr : undefined,
    askingPrice: asking,
    beds: num(ai.beds),
    baths: num(ai.baths),
    sqft: num(ai.sqft),
    yearBuilt: num(ai.yearBuilt),
    description:
      typeof ai.description === "string"
        ? ai.description.slice(0, 300)
        : undefined,
    arv: Math.round(arv),
    repairs: Math.round(repairs),
    fee,
    mao,
    score,
    rationale,
  });
}

export const addByUrl = action({
  args: {
    sessionId: v.string(),
    url: v.string(),
    fee: v.optional(v.number()),
    sellerName: v.optional(v.string()),
    sellerEmail: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<Id<"deals">> => {
    let parsed: URL;
    try {
      parsed = new URL(args.url.trim());
    } catch {
      throw new Error("Please paste a full listing link starting with https://");
    }
    const url = parsed.toString();
    const dealId: Id<"deals"> = await ctx.runMutation(internal.analyze.start, {
      sessionId: args.sessionId,
      address: url,
      listingUrl: url,
      sellerName: args.sellerName,
      sellerEmail: args.sellerEmail,
    });
    try {
      const text = await scrape(url);
      await analyzeAndSave(ctx, dealId, text, args.fee ?? DEFAULT_FEE, true);
    } catch (e) {
      await ctx.runMutation(internal.analyze.fail, {
        dealId,
        error: errMsg(e),
      });
    }
    return dealId;
  },
});

export const addManual = action({
  args: {
    sessionId: v.string(),
    address: v.string(),
    askingPrice: v.optional(v.number()),
    beds: v.optional(v.number()),
    baths: v.optional(v.number()),
    sqft: v.optional(v.number()),
    notes: v.optional(v.string()),
    fee: v.optional(v.number()),
    sellerName: v.optional(v.string()),
    sellerEmail: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<Id<"deals">> => {
    const dealId: Id<"deals"> = await ctx.runMutation(internal.analyze.start, {
      sessionId: args.sessionId,
      address: args.address,
      askingPrice: args.askingPrice,
      beds: args.beds,
      baths: args.baths,
      sqft: args.sqft,
      sellerName: args.sellerName,
      sellerEmail: args.sellerEmail,
    });
    try {
      const text = [
        `Address: ${args.address}`,
        `Asking price: ${args.askingPrice ?? "unknown"}`,
        `Beds: ${args.beds ?? "unknown"}`,
        `Baths: ${args.baths ?? "unknown"}`,
        `Square feet: ${args.sqft ?? "unknown"}`,
        `Notes: ${args.notes ?? "none"}`,
      ].join("\n");
      await analyzeAndSave(
        ctx,
        dealId,
        text,
        args.fee ?? DEFAULT_FEE,
        false,
        args.askingPrice,
      );
    } catch (e) {
      await ctx.runMutation(internal.analyze.fail, {
        dealId,
        error: errMsg(e),
      });
    }
    return dealId;
  },
});
