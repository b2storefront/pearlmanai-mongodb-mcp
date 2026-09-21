const MONEY_IN_LABEL = /-?\(?\d{1,3}(?:,\d{3})+\.\d{2}\)?|-?\(?\d+\.\d{2}\)?/;

export function parseAmount(raw: string | undefined | null): number | null {
  if (raw == null) {
    return null;
  }
  const trimmed = raw.trim();
  if (!trimmed || trimmed === "[ ]" || trimmed === "[]" || trimmed === "-") {
    return null;
  }

  const paren = /^\(.*\)$/.test(trimmed);
  const stripped = trimmed.replace(/[(),$\s%]/g, "").replace(/,/g, "");
  if (!stripped || stripped === "-") {
    return null;
  }

  const value = Number(stripped);
  if (!Number.isFinite(value)) {
    return null;
  }
  return paren ? -Math.abs(value) : value;
}

export function labelHasValue(label: string): boolean {
  return MONEY_IN_LABEL.test(label) && /[A-Za-z]{3}/.test(label);
}

export function extractAccountCode(label: string): string | undefined {
  const match = label.match(/^(\d{3,5}(?:-\d{4})?)\b/);
  return match?.[1];
}
