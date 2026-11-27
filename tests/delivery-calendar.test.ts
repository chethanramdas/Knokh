import { expect, test } from "vitest";
import { deliveryEstimate } from "../src/convex/lib/delivery";
const config = (holidays: string[]) =>
  JSON.stringify({
    originPin: "560001",
    carrier: "Synthetic test carrier",
    dispatchDays: 0,
    nonWorkingWeekdays: [],
    holidays,
    destinations: { "560002": { minDays: 1, maxDays: 2 } },
  });
test.each(["2026-02-29", "2026-04-31", "2026-13-01", "not-a-date"])(
  "rejects impossible holiday %s",
  (date) => {
    expect(
      deliveryEstimate(
        "560002",
        Date.parse("2026-02-27T00:00:00Z"),
        config([date]),
      ).status,
    ).toBe("unconfigured");
  },
);
test("honours a real leap-day holiday", () => {
  expect(
    deliveryEstimate(
      "560002",
      Date.parse("2028-02-28T00:00:00Z"),
      config(["2028-02-29"]),
    ),
  ).toEqual({
    status: "available",
    earliest: "2028-03-01",
    latest: "2028-03-02",
  });
});
test.each([NaN, Infinity, -Infinity, Number.MAX_VALUE, 8_640_000_000_000_000])(
  "rejects an invalid clock %s without throwing",
  (now) => {
    expect(deliveryEstimate("560002", now, config([])).status).toBe(
      "unconfigured",
    );
  },
);
test("uses the Indian calendar date at the UTC day boundary", () => {
  expect(
    deliveryEstimate("560002", Date.parse("2026-11-26T20:00:00Z"), config([])),
  ).toEqual({
    status: "available",
    earliest: "2026-11-28",
    latest: "2026-11-29",
  });
});
