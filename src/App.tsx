import { useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "../convex/_generated/api";
import type { Doc } from "../convex/_generated/dataModel";

type Deal = Doc<"deals">;
type Status = Deal["status"];

const STATUSES: { key: Status; label: string }[] = [
  { key: "new", label: "New" },
  { key: "analyzing", label: "Analyzing" },
  { key: "outreach_sent", label: "Outreach sent" },
  { key: "replied", label: "Replied" },
  { key: "negotiating", label: "Negotiating" },
  { key: "under_contract", label: "Under contract" },
  { key: "dead", label: "Dead" },
];

const INTENT_LABEL: Record<string, string> = {
  interested: "Interested",
  price_objection: "Price objection",
  question: "Question",
  not_interested: "Not interested",
};

function money(n?: number): string {
  return n === undefined ? "—" : "$" + Math.round(n).toLocaleString("en-US");
}

function parseNum(s: string): number | undefined {
  const t = s.replace(/[$,]/g, "").trim();
  if (t === "") return undefined;
  const n = Number(t);
  return Number.isFinite(n) ? n : undefined;
}

function errText(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  const i = m.indexOf("Uncaught Error:");
  const s = i >= 0 ? m.slice(i + 15) : m;
  return s.split("\n")[0].trim().slice(0, 220) || "Something went wrong";
}

function getSessionId(): string {
  const k = "dealdesk-session";
  try {
    let id = localStorage.getItem(k);
    if (!id) {
      id = Math.random().toString(36).slice(2) + Date.now().toString(36);
      localStorage.setItem(k, id);
    }
    return id;
  } catch {
    return "anon-" + Math.random().toString(36).slice(2);
  }
}

function scoreClass(score?: number): string {
  if (score === undefined) return "score-none";
  if (score >= 70) return "score-good";
  if (score >= 45) return "score-mid";
  return "score-bad";
}

function DraftEditor(props: {
  initial: string;
  button: string;
  onSend: (text: string) => Promise<unknown>;
}) {
  const [text, setText] = useState(props.initial);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  return (
    <div className="draftbox">
      <textarea value={text} onChange={(e) => setText(e.target.value)} />
      {err && <div className="err">{err}</div>}
      <button
        className="primary"
        disabled={busy || !text.trim()}
        onClick={async () => {
          setErr("");
          setBusy(true);
          try {
            await props.onSend(text);
          } catch (e) {
            setErr(errText(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "Sending…" : props.button}
      </button>
    </div>
  );
}

function DealCard({ deal }: { deal: Deal }) {
  const msgs = useQuery(api.deals.messages, { dealId: deal._id });
  const draft = useAction(api.outreach.draftOutreach);
  const send = useAction(api.outreach.approveSend);
  const reply = useAction(api.outreach.approveReply);
  const setStatus = useMutation(api.deals.setStatus);
  const remove = useMutation(api.deals.remove);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const list = msgs ?? [];
  const hasOutbound = list.some((m) => m.direction === "outbound");
  const spread =
    deal.mao !== undefined && deal.askingPrice !== undefined
      ? deal.mao - deal.askingPrice
      : undefined;

  const facts: string[] = [];
  if (deal.beds !== undefined) facts.push(`${deal.beds} bd`);
  if (deal.baths !== undefined) facts.push(`${deal.baths} ba`);
  if (deal.sqft !== undefined) facts.push(`${deal.sqft.toLocaleString("en-US")} sqft`);
  if (deal.yearBuilt !== undefined) facts.push(`built ${deal.yearBuilt}`);

  async function makeDraft() {
    setErr("");
    setBusy(true);
    try {
      await draft({ dealId: deal._id });
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card deal">
      <div className="deal-head">
        <div>
          <h3>{deal.address}</h3>
          {facts.length > 0 && <p className="sub">{facts.join(" · ")}</p>}
          {deal.listingUrl && deal.listingUrl !== deal.address && (
            <p className="sub">
              <a href={deal.listingUrl} target="_blank" rel="noreferrer">
                View listing
              </a>
            </p>
          )}
          {deal.sellerEmail && (
            <p className="sub">
              Seller: {deal.sellerName ? deal.sellerName + " · " : ""}
              {deal.sellerEmail}
            </p>
          )}
        </div>
        <div className={"score " + scoreClass(deal.score)}>
          {deal.score ?? "–"}
        </div>
      </div>

      {deal.status === "analyzing" && (
        <div className="busyline">Firecrawl + AI are analyzing this deal…</div>
      )}

      {deal.error && (
        <div className="err">
          Couldn't analyze this one: {deal.error}. Try "Enter manually" above.
        </div>
      )}

      {deal.arv !== undefined && (
        <>
          <div className="nums">
            <div className="num">
              <b>{money(deal.askingPrice)}</b>
              <span>Asking</span>
            </div>
            <div className="num">
              <b>{money(deal.arv)}</b>
              <span>ARV</span>
            </div>
            <div className="num">
              <b>{money(deal.repairs)}</b>
              <span>Repairs</span>
            </div>
            <div className="num mao">
              <b>{money(deal.mao)}</b>
              <span>MAO</span>
            </div>
          </div>
          {spread !== undefined && (
            <div className={spread >= 0 ? "spread-good" : "spread-bad"}>
              {spread >= 0
                ? `Asking is ${money(spread)} under MAO`
                : `Asking is ${money(-spread)} over MAO`}
            </div>
          )}
          {deal.rationale && <p className="rationale">{deal.rationale}</p>}
        </>
      )}

      {(list.length > 0 || deal.arv !== undefined) && (
        <div className="msgs">
          {list.map((m, i) => {
            if (m.direction === "outbound" && m.state === "draft") {
              return (
                <div key={m._id} className="msg msg-out">
                  <small>
                    AI draft · {m.subject ?? "Outreach"}
                    <span className="badge badge-question">needs your approval</span>
                  </small>
                  <DraftEditor
                    initial={m.body}
                    button="Approve & send"
                    onSend={(text) => send({ messageId: m._id, body: text })}
                  />
                </div>
              );
            }
            if (m.direction === "outbound") {
              return (
                <div key={m._id} className="msg msg-out">
                  <small>Sent · {m.subject ?? "Email"}</small>
                  {m.body}
                </div>
              );
            }
            const answered = list
              .slice(i + 1)
              .some((x) => x.direction === "outbound" && x.state === "sent");
            return (
              <div key={m._id}>
                <div className="msg msg-in">
                  <small>
                    Seller reply
                    {m.intent ? (
                      <span className={"badge badge-" + m.intent}>
                        {INTENT_LABEL[m.intent] ?? m.intent}
                      </span>
                    ) : (
                      <span className="badge badge-pending">AI reading…</span>
                    )}
                  </small>
                  {m.body}
                </div>
                {m.suggestedReply && !answered && (
                  <div className="msg msg-out" style={{ marginTop: 8 }}>
                    <small>AI suggested reply</small>
                    <DraftEditor
                      initial={m.suggestedReply}
                      button="Approve & send reply"
                      onSend={(text) => reply({ messageId: m._id, body: text })}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {err && <div className="err">{err}</div>}

      <div className="footer-actions">
        {deal.arv !== undefined && !hasOutbound && (
          <button className="ghost" disabled={busy} onClick={makeDraft}>
            {busy ? "Writing…" : "Draft outreach email"}
          </button>
        )}
        <select
          value={deal.status}
          onChange={(e) =>
            setStatus({ dealId: deal._id, status: e.target.value as Status })
          }
        >
          {STATUSES.map((s) => (
            <option key={s.key} value={s.key}>
              {s.label}
            </option>
          ))}
        </select>
        <button
          className="danger"
          onClick={() => {
            if (window.confirm("Delete this deal?")) {
              remove({ dealId: deal._id });
            }
          }}
        >
          Delete
        </button>
      </div>
    </div>
  );
}

function AddDeal({ sessionId }: { sessionId: string }) {
  const addByUrl = useAction(api.analyze.addByUrl);
  const addManual = useAction(api.analyze.addManual);
  const [mode, setMode] = useState<"url" | "manual">("url");
  const [url, setUrl] = useState("");
  const [email, setEmail] = useState("");
  const [fee, setFee] = useState("10000");
  const [address, setAddress] = useState("");
  const [asking, setAsking] = useState("");
  const [beds, setBeds] = useState("");
  const [baths, setBaths] = useState("");
  const [sqft, setSqft] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function submit() {
    setErr("");
    setBusy(true);
    try {
      const sellerEmail = email.trim() ? email.trim().toLowerCase() : undefined;
      const feeNum = parseNum(fee);
      if (mode === "url") {
        if (!url.trim()) throw new Error("Paste a listing link first");
        await addByUrl({ sessionId, url: url.trim(), fee: feeNum, sellerEmail });
        setUrl("");
      } else {
        if (!address.trim()) throw new Error("Enter the property address");
        await addManual({
          sessionId,
          address: address.trim(),
          askingPrice: parseNum(asking),
          beds: parseNum(beds),
          baths: parseNum(baths),
          sqft: parseNum(sqft),
          notes: notes.trim() || undefined,
          fee: feeNum,
          sellerEmail,
        });
        setAddress("");
        setAsking("");
        setBeds("");
        setBaths("");
        setSqft("");
        setNotes("");
      }
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card add">
      <h2>Add a deal</h2>
      <div className="chips">
        <button
          className={"chip" + (mode === "url" ? " active" : "")}
          onClick={() => setMode("url")}
        >
          From listing link
        </button>
        <button
          className={"chip" + (mode === "manual" ? " active" : "")}
          onClick={() => setMode("manual")}
        >
          Enter manually
        </button>
      </div>

      {mode === "url" ? (
        <input
          placeholder="Paste a listing URL (https://…)"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
      ) : (
        <>
          <input
            placeholder="Property address"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
          />
          <div className="row3">
            <input
              placeholder="Asking $"
              inputMode="numeric"
              value={asking}
              onChange={(e) => setAsking(e.target.value)}
            />
            <input
              placeholder="Beds"
              inputMode="numeric"
              value={beds}
              onChange={(e) => setBeds(e.target.value)}
            />
            <input
              placeholder="Baths"
              inputMode="numeric"
              value={baths}
              onChange={(e) => setBaths(e.target.value)}
            />
          </div>
          <input
            placeholder="Square feet"
            inputMode="numeric"
            value={sqft}
            onChange={(e) => setSqft(e.target.value)}
          />
          <textarea
            placeholder="Condition notes (roof, foundation, kitchen…)"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </>
      )}

      <div className="row">
        <input
          placeholder="Seller email (optional)"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <input
          placeholder="Your assignment fee $"
          inputMode="numeric"
          value={fee}
          onChange={(e) => setFee(e.target.value)}
        />
      </div>

      {err && <div className="err">{err}</div>}
      <button className="primary" disabled={busy} onClick={submit}>
        {busy ? "Analyzing… (10–20 seconds)" : "Analyze deal"}
      </button>
    </div>
  );
}

export default function App() {
  const [sessionId] = useState(getSessionId);
  const deals = useQuery(api.deals.list, { sessionId });
  const seedDemo = useMutation(api.deals.seedDemo);
  const [filter, setFilter] = useState<Status | "all">("all");

  const all = deals ?? [];
  const shown = filter === "all" ? all : all.filter((d) => d.status === filter);
  const replied = all.filter((d) => d.status === "replied").length;
  const best = all.reduce((m, d) => Math.max(m, d.score ?? 0), 0);

  return (
    <>
      <div className="hero">
        <div>
          <h1>DealDesk</h1>
          <p>Live deal room for real estate wholesalers</p>
        </div>
        <button className="ghost" onClick={() => seedDemo({ sessionId })}>
          Try demo
        </button>
      </div>

      <div className="stats">
        <div className="stat">
          <b>{all.length}</b>
          <span>Deals</span>
        </div>
        <div className="stat">
          <b>{replied}</b>
          <span>Replies waiting</span>
        </div>
        <div className="stat">
          <b>{best || "–"}</b>
          <span>Best score</span>
        </div>
      </div>

      <AddDeal sessionId={sessionId} />

      <div className="chips">
        <button
          className={"chip" + (filter === "all" ? " active" : "")}
          onClick={() => setFilter("all")}
        >
          All ({all.length})
        </button>
        {STATUSES.map((s) => (
          <button
            key={s.key}
            className={"chip" + (filter === s.key ? " active" : "")}
            onClick={() => setFilter(s.key)}
          >
            {s.label} ({all.filter((d) => d.status === s.key).length})
          </button>
        ))}
      </div>

      {deals !== undefined && shown.length === 0 && (
        <div className="card empty">
          No deals here yet. Paste a listing link above, or tap "Try demo" to
          load five sample DFW deals.
        </div>
      )}

      <div className="grid">
        {shown.map((d) => (
          <DealCard key={d._id} deal={d} />
        ))}
      </div>

      <p className="empty">
        Built with Convex · Firecrawl · AgentMail · Gemini
      </p>
    </>
  );
}
