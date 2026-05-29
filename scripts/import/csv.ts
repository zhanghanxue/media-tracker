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
  return rowsToCsv([headers, ...rows]);
}

/** Serialize already-assembled rows (lets a caller interleave label/blank rows). */
export function rowsToCsv(rows: string[][]): string {
  return rows.map((cols) => cols.map(csvField).join(",")).join("\r\n") + "\r\n";
}

/** Minimal RFC-4180 parser (handles quoted fields, doubled quotes, CRLF). */
export function parseCsv(text: string): string[][] {
  const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text; // strip BOM
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (body[i + 1] === '"') {
          field += '"';
          i += 1;
        } else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (ch !== "\r") field += ch;
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}
