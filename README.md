# PearlmanAI Reports MCP

FastMCP server that returns **whole property financial reports** from the already-imported monthly PDF packages (one MongoDB database per property). It does not search, filter, or analyse rows — the model fetches a report and reads it.

This replaces the generic MongoDB MCP at `https://mcp.pearlmanai-saas.b2s.app/mcp`.

## Tools

| Tool | Purpose |
|------|---------|
| `get_coverage` | Properties, report types, months, document counts |
| `get_report` | One whole report in printed order (ledgers page at 2000 rows) |
| `get_source` | Original extracted page text plus provenance |

## Setup

```bash
cp .env.example .env
npm install
npm run build
```

```env
MONGODB_URI=mongodb+srv://USER:PASSWORD@cluster/
MCP_TRANSPORT=http
MCP_HTTP_HOST=127.0.0.1
MCP_HTTP_PORT=8008
MCP_AUTH=none
```

Production nginx already authenticates clients. The process binds localhost only.

## Coverage

Orchard MRI properties and Bell Ranch: 2025-01 through 2026-07. Timbers: 2026 with holes. Corbett: June 2026 only, no income statement. Muse: none.
