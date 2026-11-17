import * as XLSX from "xlsx";

/** Parse only the first product sheet, with explicit preview size/row limits. */
export function parseProductSpreadsheet(
  buffer: ArrayBuffer,
  limits: { maxBytes: number; maxRows: number },
) {
  if (buffer.byteLength > limits.maxBytes)
    throw new Error("The file exceeds the configured import size limit.");
  const workbook = XLSX.read(buffer, {
    type: "array",
    sheetRows: limits.maxRows + 2,
    sheets: 0,
  });
  const firstName = workbook.SheetNames[0];
  const sheet = firstName ? workbook.Sheets[firstName] : undefined;
  if (!sheet) throw new Error("The file contains no product sheet.");
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    defval: "",
    raw: false,
  });
  if (!rows.length) throw new Error("The file contains no data rows.");
  if (rows.length > limits.maxRows)
    throw new Error(
      "The file exceeds the configured row limit. Split it into smaller imports.",
    );
  return rows;
}
