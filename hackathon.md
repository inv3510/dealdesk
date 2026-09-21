# DealDesk

Realtime deal room for real estate wholesalers. Paste a listing link or enter a property by hand, get an instant deal analysis, email the seller, and manage the replies. Everything updates live.

Live app: https://next-anteater-454.convex.site
Repo: https://github.com/inv3510/dealdesk

## What it does

- Add a deal from a listing URL or by entering the details manually
- Calculates MAO (ARV x 0.70 minus repairs minus assignment fee) and a deal score in code, so the numbers are always consistent
- AI writes a plain-English rationale from those exact numbers
- Drafts a seller outreach email. Nothing is sent until you tap Approve.
- Seller replies arrive live on the deal card, tagged with an intent (interested, price objection, question, not interested) with an AI-suggested reply
- No login. Each browser gets a private board.

## How the sponsor tech is used

- **Convex**: the whole backend. Realtime queries keep the board live, mutations and actions handle deals and messages, and an HTTP action receives AgentMail webhooks.
- **Firecrawl**: scrapes a pasted listing URL so the property details can be extracted.
- **AgentMail**: sends outreach and replies from a real inbox, and its webhook delivers seller replies back into Convex.
- **AI**: Gemini by default. OpenAI is supported by setting AI_PROVIDER=openai, with no code change.

## Safety

A recipient allowlist stops the app from emailing anyone who is not on it during the demo.

## Run locally

1. npm install
2. npx convex dev
3. npm run dev
