import { useAction, useMutation, useQuery } from "convex/react";
import { Download, FileSpreadsheet, Link2, Loader2, RotateCcw, Upload } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";
import * as XLSX from "xlsx";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { InfoNote, LoadingBlock, SectionHeading, StatusPill } from "@/components/knokh/ui";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { downloadTextFile, formatDateTime, titleCase } from "@/lib/format";
import { usePageMeta } from "@/lib/seo";
import { useStore } from "@/lib/store";

const FIELD_LABELS: Record<string, string> = {
  name: "Product name *",
  sku: "SKU *",
  price: "Selling price *",
  compare_at: "Compare-at price",
  cost: "Supplier cost",
  currency: "Currency",
  stock: "Stock quantity",
  category: "Category",
  subcategory: "Subcategory",
  brand: "Brand",
  supplier_sku: "Supplier SKU",
  supplier_product_id: "Supplier product id",
  image_url: "Main image URL",
  image_urls: "Additional image URLs",
  summary: "Short summary",
  description: "Description",
  variant_name: "Variant name",
  variant_option: "Variant option",
  weight_g: "Weight (grams)",
  delivery_days: "Dispatch days",
  ships_to: "Ships to (ISO codes)",
  status: "Status",
  tags: "Tags",
};

export default function AdminImports() {
  const { config } = useStore();
  const jobs = useQuery(api.imports.listImportJobs, {});
  const suppliers = useQuery(api.suppliers.listSuppliers, {});
  const categories = useQuery(api.admin.listCategoriesAdmin, {});
  const template = useQuery(api.imports.importTemplateCsv, {});

  const startImport = useMutation(api.imports.startImport);
  const commitBatch = useMutation(api.imports.commitImportBatch);
  const finalizeImport = useMutation(api.imports.finalizeImport);
  const rollbackImport = useMutation(api.imports.rollbackImport);
  const retryFailed = useMutation(api.imports.retryFailedRows);
  const createDraft = useMutation(api.imports.createDraftFromPreview);
  const fetchPreview = useAction(api.importsActions.fetchUrlPreview);

  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [fileName, setFileName] = useState("");
  const [fileSize, setFileSize] = useState(0);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [mode, setMode] = useState<"create_only" | "update_only" | "upsert">("upsert");
  const [publish, setPublish] = useState(false);
  const [supplierId, setSupplierId] = useState("");
  const [activeJobId, setActiveJobId] = useState<Id<"import_jobs"> | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [busy, setBusy] = useState(false);

  const [urlInput, setUrlInput] = useState("");
  const [urlPreview, setUrlPreview] = useState<Record<string, unknown> | null>(null);
  const [urlReason, setUrlReason] = useState<string | null>(null);

  const activeJob = useQuery(
    api.imports.getImportJob,
    activeJobId ? { jobId: activeJobId } : "skip",
  );

  usePageMeta({ title: "Import centre", noIndex: true, path: "/admin/imports", siteUrl: config?.seo.siteUrl });

  const handleFile = async (file: File) => {
    setBusy(true);
    try {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: "array" });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const parsed = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
        defval: "",
        raw: false,
      });
      if (parsed.length === 0) throw new Error("The file contains no data rows.");
      const detectedHeaders = Object.keys(parsed[0]);
      const autoMap: Record<string, string> = {};
      for (const [field, label] of Object.entries(FIELD_LABELS)) {
        void label;
        const match = detectedHeaders.find(
          (header) => header.toLowerCase().replace(/[\s-]+/g, "_") === field,
        );
        if (match) autoMap[field] = match;
      }
      setRows(parsed);
      setHeaders(detectedHeaders);
      setMapping(autoMap);
      setFileName(file.name);
      setFileSize(file.size);
      setActiveJobId(null);
      toast.success(
        `${parsed.length} rows read from ${file.name}. Check the column mapping below.`,
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not read that file.");
    } finally {
      setBusy(false);
    }
  };

  const runImport = async () => {
    if (rows.length === 0) return;
    setBusy(true);
    setProgress({ done: 0, total: rows.length });
    try {
      const started = await startImport({
        type: fileName.toLowerCase().endsWith(".xlsx") ? "xlsx" : "csv",
        fileName,
        fileSizeBytes: fileSize,
        rows,
        mapping,
        mode,
        publish,
        supplierId: supplierId ? (supplierId as Id<"suppliers">) : undefined,
      });
      setActiveJobId(started.jobId);
      toast.success(
        `${started.validRows} valid and ${started.invalidRows} invalid rows validated. Nothing is written until you commit.`,
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Validation failed.");
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  const commitAll = async () => {
    if (!activeJobId) return;
    setBusy(true);
    let processed = 0;
    try {
      for (;;) {
        const result = await commitBatch({ jobId: activeJobId, batchSize: 25 });
        processed += result.processed;
        setProgress({ done: processed, total: processed + result.remaining });
        if (result.done || result.processed === 0) break;
      }
      await finalizeImport({ jobId: activeJobId });
      toast.success(`Import committed (${processed} rows processed).`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The import could not be committed.");
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  return (
    <div className="space-y-6">
      <SectionHeading
        title="Import centre"
        subtitle="Bring products in from a spreadsheet or from a supplier you are authorised to read from. Nothing is published without your confirmation."
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-border bg-card p-5">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <FileSpreadsheet className="size-4" /> 1. Upload CSV or XLSX
          </h2>
          <input
            type="file"
            accept=".csv,.xlsx,.xls"
            className="mt-3 w-full rounded-lg border border-border bg-background p-2 text-sm"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void handleFile(file);
            }}
          />
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={!template}
              onClick={() => {
                if (!template) return;
                downloadTextFile("knokh-import-template.csv", template.csv);
              }}
            >
              <Download className="size-3.5" /> Download template
            </Button>
            <span className="text-xs text-muted-foreground">
              Limit: {config?.commerce.maxImportRows ?? 5000} rows ·{" "}
              {Math.round((config?.commerce.maxImportFileBytes ?? 5242880) / (1024 * 1024))} MB
            </span>
          </div>
          {fileName ? (
            <p className="mt-2 text-xs text-muted-foreground">
              {fileName} · {rows.length} rows · {headers.length} columns
            </p>
          ) : null}
        </div>

        <div className="rounded-xl border border-border bg-card p-5">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <Link2 className="size-4" /> Or import from a supplier URL
          </h2>
          <p className="mt-2 text-xs text-muted-foreground">
            Only URLs from suppliers you have registered can be imported, and robots.txt is always
            respected. Arbitrary shops cannot be scraped — use the spreadsheet importer instead.
          </p>
          <div className="mt-3 flex gap-2">
            <Input
              value={urlInput}
              onChange={(event) => setUrlInput(event.target.value)}
              placeholder="https://supplier.example/product/123"
            />
            <Button
              variant="outline"
              disabled={busy || !urlInput}
              onClick={async () => {
                setBusy(true);
                setUrlPreview(null);
                setUrlReason(null);
                try {
                  const result = await fetchPreview({ url: urlInput });
                  if (!result.ok) {
                    setUrlReason(result.reason ?? "That source cannot be imported.");
                    return;
                  }
                  setUrlPreview({
                    title: result.preview.title,
                    description: result.preview.description,
                    priceMinor: result.preview.priceMinor,
                    currency: result.preview.currency,
                    sku: result.preview.sku,
                    images: result.preview.images,
                    robotsNote: result.robotsNote,
                    sourceUrl: result.sourceUrl,
                  });
                } catch (error) {
                  setUrlReason(error instanceof Error ? error.message : "Fetch failed.");
                } finally {
                  setBusy(false);
                }
              }}
            >
              Fetch preview
            </Button>
          </div>
          {urlReason ? <InfoNote tone="warning" className="mt-3">{urlReason}</InfoNote> : null}
          {urlPreview ? (
            <div className="mt-3 space-y-3 rounded-lg border border-border p-3 text-sm">
              <p className="font-medium">{String(urlPreview.title)}</p>
              <p className="text-xs text-muted-foreground">{String(urlPreview.robotsNote ?? "")}</p>
              <div>
                <Label htmlFor="url-title">Title (editable)</Label>
                <Input
                  id="url-title"
                  value={String(urlPreview.title ?? "")}
                  onChange={(event) => setUrlPreview({ ...urlPreview, title: event.target.value })}
                />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <Label htmlFor="url-cost">Cost (base currency)</Label>
                  <Input
                    id="url-cost"
                    inputMode="decimal"
                    value={
                      urlPreview.priceMinor
                        ? (Number(urlPreview.priceMinor) / 100).toFixed(2)
                        : ""
                    }
                    onChange={(event) =>
                      setUrlPreview({
                        ...urlPreview,
                        priceMinor: Math.round(Number(event.target.value) * 100),
                      })
                    }
                  />
                </div>
                <div>
                  <Label htmlFor="url-sku">SKU</Label>
                  <Input
                    id="url-sku"
                    value={String(urlPreview.sku ?? "")}
                    onChange={(event) => setUrlPreview({ ...urlPreview, sku: event.target.value })}
                  />
                </div>
              </div>
              <div>
                <Label htmlFor="url-desc">Description</Label>
                <Textarea
                  id="url-desc"
                  rows={2}
                  value={String(urlPreview.description ?? "")}
                  onChange={(event) =>
                    setUrlPreview({ ...urlPreview, description: event.target.value })
                  }
                />
              </div>
              <Button
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    const created = await createDraft({
                      supplierId: supplierId ? (supplierId as Id<"suppliers">) : undefined,
                      sourceUrl: String(urlPreview.sourceUrl ?? urlInput),
                      title: String(urlPreview.title ?? "Imported product"),
                      description: urlPreview.description
                        ? String(urlPreview.description)
                        : undefined,
                      sku: urlPreview.sku ? String(urlPreview.sku) : undefined,
                      costMinor: urlPreview.priceMinor
                        ? Number(urlPreview.priceMinor)
                        : undefined,
                      currency: urlPreview.currency ? String(urlPreview.currency) : undefined,
                      images: Array.isArray(urlPreview.images)
                        ? (urlPreview.images as string[])
                        : undefined,
                    });
                    toast.success(
                      `Draft product created with SKU ${created.sku}. Review and publish it from Products.`,
                    );
                    setUrlPreview(null);
                    setUrlInput("");
                  } catch (error) {
                    toast.error(error instanceof Error ? error.message : "Could not save the draft.");
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <Upload className="size-4" /> Save as draft product
              </Button>
              <p className="text-xs text-muted-foreground">
                Only import images and descriptions you are permitted to use. Supplier product data
                often carries usage restrictions.
              </p>
            </div>
          ) : null}
        </div>
      </div>

      {rows.length > 0 ? (
        <div className="rounded-xl border border-border bg-card p-5">
          <h2 className="text-sm font-semibold">2. Column mapping & options</h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {Object.entries(FIELD_LABELS).map(([field, label]) => (
              <div key={field}>
                <Label htmlFor={`map-${field}`}>{label}</Label>
                <select
                  id={`map-${field}`}
                  value={mapping[field] ?? ""}
                  onChange={(event) =>
                    setMapping({ ...mapping, [field]: event.target.value })
                  }
                  className="h-10 w-full rounded-lg border border-border bg-background px-2 text-sm"
                >
                  <option value="">— not mapped —</option>
                  {headers.map((header) => (
                    <option key={header} value={header}>
                      {header}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <div>
              <Label htmlFor="i-mode">Existing SKUs</Label>
              <select
                id="i-mode"
                value={mode}
                onChange={(event) => setMode(event.target.value as typeof mode)}
                className="h-10 w-full rounded-lg border border-border bg-background px-2 text-sm"
              >
                <option value="upsert">Create new, update existing</option>
                <option value="create_only">Create new only (fail on duplicates)</option>
                <option value="update_only">Update existing only</option>
              </select>
            </div>
            <div>
              <Label htmlFor="i-supplier">Attach to supplier</Label>
              <select
                id="i-supplier"
                value={supplierId}
                onChange={(event) => setSupplierId(event.target.value)}
                className="h-10 w-full rounded-lg border border-border bg-background px-2 text-sm"
              >
                <option value="">No supplier</option>
                {(suppliers ?? []).map((supplier) => (
                  <option key={supplier._id} value={supplier._id}>
                    {supplier.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label htmlFor="i-publish">Publish after import?</Label>
              <select
                id="i-publish"
                value={publish ? "yes" : "no"}
                onChange={(event) => setPublish(event.target.value === "yes")}
                className="h-10 w-full rounded-lg border border-border bg-background px-2 text-sm"
              >
                <option value="no">No — keep everything as draft</option>
                <option value="yes">Yes — publish rows marked published</option>
              </select>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <Button onClick={() => void runImport()} disabled={busy}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}{" "}
              Validate rows
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setRows([]);
                setHeaders([]);
                setFileName("");
                setMapping({});
              }}
            >
              Clear
            </Button>
            <span className="self-center text-xs text-muted-foreground">
              Category and brand names are matched against your catalog; unknown values are kept as
              warnings so nothing is silently lost.
            </span>
          </div>

          {categories && categories.length === 0 ? (
            <InfoNote tone="warning" className="mt-3">
              You have no categories yet. Create them in Catalog &amp; coupons (or use the “Create
              categories, brands and suppliers” button on the dashboard) so imported rows can be
              filed correctly.
            </InfoNote>
          ) : null}
        </div>
      ) : null}

      {progress ? (
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-sm">
            Processing {progress.done} of {progress.total} rows…
          </p>
          <Progress
            className="mt-2"
            value={progress.total ? (progress.done / progress.total) * 100 : 0}
          />
        </div>
      ) : null}

      {activeJob ? (
        <div className="rounded-xl border border-border bg-card p-5">
          <h2 className="text-sm font-semibold">3. Review and commit</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            {activeJob.job.fileName} · {titleCase(activeJob.job.status)} · {activeJob.counts.valid}{" "}
            ready · {activeJob.counts.invalid} invalid · {activeJob.counts.imported} created ·{" "}
            {activeJob.counts.updated} updated · {activeJob.counts.failed} failed
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button onClick={() => void commitAll()} disabled={busy}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : null} Commit import
            </Button>
            <ErrorReportButton jobId={activeJob.job._id} />
            <Button
              variant="outline"
              onClick={async () => {
                const result = await retryFailed({ jobId: activeJob.job._id });
                toast.success(`${result.retried} failed row(s) reset for retry.`);
              }}
            >
              Retry failed rows
            </Button>
            <Button
              variant="ghost"
              onClick={async () => {
                const result = await rollbackImport({ jobId: activeJob.job._id });
                toast.success(
                  `Rollback: ${result.deleted} created product(s) deleted, ${result.restored} restored, ${result.skipped} skipped (changed since import).`,
                );
              }}
            >
              <RotateCcw className="size-4" /> Roll back
            </Button>
          </div>

          {activeJob.rows.length > 0 ? (
            <div className="mt-4 max-h-80 overflow-auto rounded-lg border border-border">
              <table className="w-full text-xs">
                <thead className="bg-muted/60 text-left uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2">Row</th>
                    <th className="px-3 py-2">SKU</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2">Errors / warnings</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {activeJob.rows.map((row) => (
                    <tr key={row._id}>
                      <td className="px-3 py-2">{row.rowNumber}</td>
                      <td className="px-3 py-2">{row.sku ?? "—"}</td>
                      <td className="px-3 py-2">
                        <StatusPill
                          tone={
                            row.status === "invalid" || row.status === "failed"
                              ? "danger"
                              : row.status === "valid"
                                ? "warning"
                                : "success"
                          }
                        >
                          {titleCase(row.status)}
                        </StatusPill>
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {[...row.errors, ...row.warnings].join(" · ") || "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="rounded-xl border border-border bg-card p-5">
        <h2 className="text-sm font-semibold">Import history</h2>
        {jobs === undefined ? (
          <LoadingBlock />
        ) : jobs.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">No imports have been run yet.</p>
        ) : (
          <ul className="mt-3 space-y-2 text-sm">
            {jobs.map((job) => (
              <li key={job._id} className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  className="font-medium hover:text-primary"
                  onClick={() => setActiveJobId(job._id)}
                >
                  {job.fileName ?? job.type}
                </button>
                <StatusPill
                  tone={
                    job.status === "completed"
                      ? "success"
                      : job.status === "failed"
                        ? "danger"
                        : "warning"
                  }
                >
                  {titleCase(job.status)}
                </StatusPill>
                <span className="text-xs text-muted-foreground">
                  {job.createdRows} created · {job.updatedRows} updated · {job.invalidRows} invalid ·{" "}
                  {formatDateTime(job.createdAt)}
                </span>
                <Link to="/admin/products" className="ml-auto text-xs text-primary hover:underline">
                  View products
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function ErrorReportButton({ jobId }: { jobId: Id<"import_jobs"> }) {
  const report = useQuery(api.imports.importErrorReport, { jobId });
  return (
    <Button
      variant="outline"
      disabled={!report}
      onClick={() => {
        if (!report) return;
        downloadTextFile(`knokh-import-errors-${jobId}.csv`, report.csv);
        toast.success(`Error report downloaded (${report.count} rows).`);
      }}
    >
      <Download className="size-4" /> Error report
    </Button>
  );
}
