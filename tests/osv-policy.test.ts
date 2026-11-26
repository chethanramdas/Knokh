import { describe, it, expect } from "vitest";
// @ts-expect-error JavaScript CI policy is executed directly by Node.
import { assessOSV, reviewedSheetJS } from "../scripts/osv-policy.mjs";
const now = new Date("2026-11-27T00:00:00Z");
const lock = () => ({
  packages: { "node_modules/xlsx": { ...reviewedSheetJS } },
});
const report = (id = "GHSA-4r6h-8v6p-xvw6") => ({
  results: [
    {
      packages: [
        {
          package: { name: "xlsx", version: "0.20.3", ecosystem: "npm" },
          vulnerabilities: [
            {
              id,
              affected: [
                {
                  package: { name: "xlsx", ecosystem: "npm" },
                  database_specific: {
                    last_known_affected_version_range: "< 0.19.3",
                  },
                },
              ],
            },
          ],
        },
      ],
    },
  ],
});
describe("OSV vendor advisory review", () => {
  it("accepts only the reviewed vendor release and advisory", () => {
    expect(assessOSV(report(), lock(), now).reviewedFindings).toHaveLength(1);
  });
  it.each(["version", "resolved", "integrity"])(
    "blocks a changed %s",
    (key) => {
      const changed = lock();
      changed.packages["node_modules/xlsx"][key] = "changed";
      expect(assessOSV(report(), changed, now).blocking).toHaveLength(1);
    },
  );
  it("blocks new vulnerabilities", () =>
    expect(assessOSV(report("NEW-CVE"), lock(), now).blocking).toHaveLength(1));
  it("expires automatically", () =>
    expect(
      assessOSV(report(), lock(), new Date("2027-02-01")).blocking,
    ).toHaveLength(1));
  it("blocks nested older installations", () => {
    const changed = lock();
    Object.assign(changed.packages, {
      "node_modules/other/node_modules/xlsx": { version: "0.18.5" },
    });
    expect(assessOSV(report(), changed, now).blocking).toHaveLength(1);
  });
  it("blocks when advisory applicability changes", () => {
    const changed = report();
    changed.results[0].packages[0].vulnerabilities[0].affected[0].database_specific.last_known_affected_version_range =
      "< 0.21.0";
    expect(assessOSV(changed, lock(), now).blocking).toHaveLength(1);
  });
  it("rejects malformed reports", () =>
    expect(() => assessOSV({}, lock(), now)).toThrow());
});
