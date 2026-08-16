# SLIPWAY — Brand & Design Guidance

> No mockup HTML was provided for SLIPWAY (unlike the HeyPay template, which had an attached mock). This is a proposed direction based on the project's identity as **Stellar developer infrastructure** — technical, trustworthy, low-drama. Treat as a starting point to adjust once you have a preference or real mockup.

## Tone

SLIPWAY is infrastructure, not a consumer product. The dashboard should feel like a **systems/ops tool** — closer to a monitoring dashboard (Grafana-adjacent) than a fintech app. Precision over polish-for-polish's-sake. The throughput chart is the hero element; everything else supports it.

## Color Palette

Dark-first, matching the aesthetic of Stellar's own developer tooling (raven.stellar.org uses a dark theme with a single warm accent):

| Role | Color | Use |
|---|---|---|
| Background | `#0B0D0E` | App shell, dashboard base |
| Surface | `#14171A` | Cards, panels, table rows |
| Border | `#262B2F` | Dividers, card outlines |
| Text primary | `#E8EAED` | Headings, key numbers |
| Text secondary | `#8A9199` | Labels, captions |
| Accent | `#F9A826` (Stellar-adjacent amber/orange) | Primary actions, active states, the throughput line on charts |
| Success | `#3FCF8E` | `Available`, `Merged`, successful submits |
| Warning | `#F2C744` | `Resync`, `Draining` |
| Danger | `#EF5B5B` | `Failed`, low fee-balance alerts |
| Info | `#5B9CEF` | `Provisioning`, `Leased`, `Submitted` |

## Typography

- **UI text**: Inter or system-ui sans-serif — clean, neutral, legible at small sizes for dense tables.
- **Numbers & code**: a monospace font (JetBrains Mono or Menlo fallback) for public keys, XDR snippets, sequence numbers, and metrics — this is a technical audience and monospace signals precision.
- Keep headings restrained (no display/decorative fonts) — this product earns trust through clarity, not visual flourish.

## Layout Principles

- **Data density over whitespace** for the channels table and metrics views — operators will be scanning many rows.
- **One hero number per page**: e.g. utilization % on the main dashboard, throughput on the metrics page. Follow the spec's own framing: "the demo is a number."
- Channel state should always be shown as a **colored badge** using the palette above, consistently, across the channels table, channel detail page, and pool status widget.
- Use a **fixed left sidebar nav** (Dashboard / Channels / Tenants / Metrics / Settings) — standard ops-tool convention, minimizes navigation thinking.

## Voice

Direct, technical, no marketing language in the UI copy. Error states should state the actual condition (`"Channel in Resync — sequence must be re-read from chain before reuse"`) rather than a generic friendly message. This mirrors the original spec's own writing style: precise, slightly blunt, engineer-to-engineer.
