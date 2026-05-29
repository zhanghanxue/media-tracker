// Minimal RFC-4180-ish CSV writer. Quotes a field when it contains a comma,
// quote, or newline, doubling embedded quotes. UTF-8 (the review file is full
// of CJK); pair with a BOM when writing so Excel opens it correctly.

export function csvField(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function toCsv(headers: string[], rows: string[][]): string {
  const lines = [headers, ...rows].map((cols) => cols.map(csvField).join(","));
  return lines.join("\r\n") + "\r\n";
}
