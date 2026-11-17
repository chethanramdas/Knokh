/** RFC4180-style CSV records, including quoted multiline descriptions. */
export function parseCsvRecords(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else quoted = !quoted;
    } else if (!quoted && c === ",") {
      row.push(cell);
      cell = "";
    } else if (!quoted && (c === "\n" || c === "\r")) {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      if (row.some((v) => v.trim())) rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  if (quoted) throw new Error("CSV has an unterminated quoted field.");
  row.push(cell);
  if (row.some((v) => v.trim())) rows.push(row);
  const headers = (rows.shift() ?? []).map((h) =>
    h.replace(/^\uFEFF/, "").trim(),
  );
  if (
    new Set(headers).size !== headers.length ||
    headers.some(
      (h) => !h || ["__proto__", "constructor", "prototype"].includes(h),
    )
  )
    throw new Error("CSV column names must be unique and safe.");
  return rows.map((cells) => {
    if (cells.length !== headers.length)
      throw new Error("CSV row has a different number of columns.");
    return Object.fromEntries(headers.map((h, i) => [h, cells[i]]));
  });
}
