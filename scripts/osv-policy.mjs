import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

// Review applies to two named advisories, never to all vulnerabilities in xlsx.
export const reviewedSheetJS = {
  version: "0.20.3",
  resolved: "https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz",
  integrity:
    "sha512-oLDq3jw7AcLqKWH2AhCpVTZl8mf6X2YReP+Neh0SJUzV/BdZYjth94tG5toiMB1PPrYtxOCfaoUCkvtuH+3AJA==",
};
const reviewed = new Map([
  ["GHSA-4r6h-8v6p-xvw6", "< 0.19.3"],
  ["GHSA-5pgg-2g8v-p4x9", "< 0.20.2"],
]);
export function assessOSV(report, lock, now = new Date()) {
  if (!Array.isArray(report.results)) throw new Error("Invalid OSV report");
  const installations = Object.entries(lock.packages ?? {}).filter(([path]) =>
    path.endsWith("node_modules/xlsx"),
  );
  const exactVendor =
    installations.length === 1 &&
    Object.entries(reviewedSheetJS).every(
      ([key, value]) => installations[0][1][key] === value,
    );
  const currentReview = now < new Date("2027-02-01T00:00:00Z");
  const blocking = [];
  const reviewedFindings = [];
  for (const result of report.results) {
    if (!Array.isArray(result.packages))
      throw new Error("Missing OSV packages");
    for (const entry of result.packages) {
      if (!Array.isArray(entry.vulnerabilities))
        throw new Error("Missing OSV vulnerabilities");
      for (const vuln of entry.vulnerabilities) {
        const pkg = entry.package;
        const range = reviewed.get(vuln.id);
        const verifiedRange = vuln.affected?.some(
          (affected) =>
            affected.package?.name === "xlsx" &&
            affected.package?.ecosystem === "npm" &&
            affected.database_specific?.last_known_affected_version_range ===
              range,
        );
        const exception =
          range &&
          exactVendor &&
          currentReview &&
          verifiedRange &&
          pkg?.name === "xlsx" &&
          pkg.version === reviewedSheetJS.version &&
          pkg.ecosystem === "npm";
        (exception ? reviewedFindings : blocking).push(
          vuln.id ?? "unknown vulnerability",
        );
      }
    }
  }
  return { blocking, reviewedFindings };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const scan = spawnSync(
    process.argv[2] || "osv-scanner",
    ["scan", "source", "--lockfile=package-lock.json", "--format=json"],
    { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
  );
  if (scan.stderr) process.stderr.write(scan.stderr);
  try {
    if (scan.error || ![0, 1].includes(scan.status))
      throw new Error("OSV scanner failed; release blocked");
    const report = JSON.parse(scan.stdout);
    const result = assessOSV(
      report,
      JSON.parse(readFileSync("package-lock.json", "utf8")),
    );
    if (
      scan.status === 1 &&
      !result.blocking.length &&
      !result.reviewedFindings.length
    )
      throw new Error("Unexplained scanner failure; release blocked");
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = result.blocking.length ? 1 : 0;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
