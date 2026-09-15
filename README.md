# PearlmanAI Reports MCP

FastMCP server that returns **whole property financial reports** from the isolated `pearlman_financials` database (the scraped monthly archive). It does not search, filter, or analyse rows — the model fetches a report and reads it.

This replaces the generic MongoDB MCP at `https://mcp.pearlmanai-saas.b2s.app/mcp`.

## Tools

| Tool | Purpose |
|------|---------|
| `get_coverage` | Properties, report types, periods, bases, document and row counts |
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

Eleven properties, January–August 2026. **306** reports: **83** income statements, **75** balance sheets, **74** forecasts, **74** general ledgers. Muse and Corbett are included. Timbers and those two TMG properties have no June P&L. Bell Ranch has two income-statement layouts per month — pass `layout`. No cash flow.
