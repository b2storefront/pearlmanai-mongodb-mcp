# PearlmanAI Reports MCP

FastMCP server for property financial reports from the isolated `pearlman_financials` database (the scraped monthly archive). It returns printed rows as stored. Use **search_line_items** for a matching line (for example net operating income); use **get_report** for a whole statement.

This replaces the generic MongoDB MCP at `https://mcp.pearlmanai-saas.b2s.app/mcp`.

## Tools

| Tool | Purpose |
|------|---------|
| `get_coverage` | Properties, report types, periods, bases, document and row counts |
| `search_line_items` | Matching printed rows from one report type (label substring or account code) |
| `get_report` | One whole report in printed order (ledgers page at 2000 rows) |
| `get_source` | Original extracted markdown plus provenance |

## Setup

```bash
cp .env.example .env
npm install
npm run build
```

```env
MONGODB_URI=mongodb+srv://USER:PASSWORD@cluster/
MONGODB_DB=pearlman_financials
MCP_TRANSPORT=http
MCP_HTTP_HOST=127.0.0.1
MCP_HTTP_PORT=8008
MCP_AUTH=none
```

Production nginx already authenticates clients. The process binds localhost only.

## Coverage

Eleven properties. Orchard MRI: 2025 (cash) plus 2026 through July (accrual). Bell Ranch, Timbers, Muse, and Corbett: 2026 only. **641** reports after the 2025 load. Parkway has no May 2025 general ledger. Muse and Corbett 2026 have no June P&L. Bell Ranch has two income-statement layouts per month — pass `layout`. No cash flow.
