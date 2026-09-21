const ENTITY_MAP: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

export function decodeHtml(input: string): string {
  return input
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/?[^>]+>/g, "")
    .replace(/&([a-z]+);/gi, (_, name: string) => ENTITY_MAP[name.toLowerCase()] ?? `&${name};`)
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) =>
      String.fromCharCode(parseInt(code, 16)),
    )
    .replace(/\s+/g, " ")
    .trim();
}

export interface TableCell {
  text: string;
  colspan: number;
}

export interface TableRow {
  cells: string[];
  raw: TableCell[];
}

export type Block =
  | { type: "text"; text: string }
  | { type: "table"; rows: TableRow[] };

function parseRow(html: string): TableRow {
  const raw: TableCell[] = [];
  const tdRe = /<td\b([^>]*)>([\s\S]*?)<\/td>/gi;
  let match: RegExpExecArray | null;
  while ((match = tdRe.exec(html))) {
    const attrs = match[1] ?? "";
    const spanMatch = attrs.match(/colspan\s*=\s*["']?(\d+)/i);
    raw.push({
      text: decodeHtml(match[2] ?? ""),
      colspan: spanMatch ? Number(spanMatch[1]) : 1,
    });
  }
  return { cells: raw.map((cell) => cell.text), raw };
}

function parseTable(html: string): TableRow[] {
  const rows: TableRow[] = [];
  const trRe = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
  let match: RegExpExecArray | null;
  while ((match = trRe.exec(html))) {
    rows.push(parseRow(match[1] ?? ""));
  }
  return rows;
}

export function parseBlocks(markdown: string): { preamble: string; blocks: Block[] } {
  const blocks: Block[] = [];
  const tableRe = /<table\b[^>]*>([\s\S]*?)<\/table>/gi;
  let last = 0;
  let preamble = "";
  let foundTable = false;
  let match: RegExpExecArray | null;

  while ((match = tableRe.exec(markdown))) {
    const before = markdown.slice(last, match.index).trim();
    if (!foundTable) {
      preamble = before;
      foundTable = true;
    } else if (before) {
      blocks.push({ type: "text", text: before });
    }
    blocks.push({ type: "table", rows: parseTable(match[1] ?? "") });
    last = match.index + match[0].length;
  }

  const trailing = markdown.slice(last).trim();
  if (trailing) {
    blocks.push({ type: "text", text: trailing });
  }

  return { preamble, blocks };
}
