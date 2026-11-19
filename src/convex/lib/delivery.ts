type Lane = { minDays: number; maxDays: number };
type Plan = {
  originPin: string;
  dispatchDays: number;
  holidays: string[];
  lanes: Record<string, Record<string, Lane>>;
};

export const indianPin = /^[1-9][0-9]{5}$/;
export type DeliveryRange = { earliest: string; latest: string };
type Estimate =
  | { status: "invalid" | "unconfigured" | "unsupported" }
  | { status: "available"; range: DeliveryRange };

function validDays(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 90;
}

export function estimateDelivery(planJson: string | undefined, pin: string, method: string, now: number): Estimate {
  if (!indianPin.test(pin)) return { status: "invalid" };
  let plan: Plan;
  try {
    plan = JSON.parse(planJson || "null");
  } catch {
    return { status: "unconfigured" };
  }

  if (!plan || !indianPin.test(plan.originPin) || !validDays(plan.dispatchDays) ||
      !Array.isArray(plan.holidays) || !plan.holidays.every((date) => typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date)) ||
      !plan.lanes || typeof plan.lanes !== "object") return { status: "unconfigured" };

  const lane = plan.lanes[pin]?.[method];
  if (!lane) return { status: "unsupported" };
  if (!validDays(lane.minDays) || !validDays(lane.maxDays) || lane.minDays > lane.maxDays) {
    return { status: "unconfigured" };
  }
  // Work in India calendar dates. Advance dispatch and transit only on business days.
  const dayMs = 86_400_000;
  let day = Math.floor((now + 330 * 60_000) / dayMs) * dayMs;
  const isoDate = () => new Date(day).toISOString().slice(0, 10);
  const holidays = new Set(plan.holidays);
  const workingDay = () => ![0, 6].includes(new Date(day).getUTCDay()) && !holidays.has(isoDate());
  while (!workingDay()) day += dayMs;
  const advance = (days: number) => {
    while (days > 0) {
      day += dayMs;
      if (workingDay()) days--;
    }
    return isoDate();
  };

  const earliest = advance(plan.dispatchDays + lane.minDays);
  const latest = advance(lane.maxDays - lane.minDays);
  return { status: "available", range: { earliest, latest } };
}
