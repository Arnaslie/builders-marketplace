// Money helpers. The API sends money as decimal strings ("24.99"); we keep them as strings
// everywhere and only convert at the edges: integer cents for arithmetic (no float drift),
// Intl formatting for display.

export function toCents(value: string): number {
  const match = /^(\d+)\.(\d{2})$/.exec(value);
  if (!match) throw new Error(`Not a contract money string: ${value}`);
  return Number(match[1]) * 100 + Number(match[2]);
}

// Dividing by 100 is display-only; all sums above this point are exact integers.
export function formatCents(cents: number, currency: string): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(cents / 100);
}

export function formatMoney(value: string, currency: string): string {
  return formatCents(toCents(value), currency);
}
