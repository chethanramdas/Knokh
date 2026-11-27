import { z } from "zod";

export const indiaPin = /^[1-9][0-9]{5}$/;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const day = 86_400_000;
const indiaOffset = 330 * 60_000;
const calendarDate = z
  .string()
  .regex(datePattern)
  .refine((value) => {
    const parsed = Date.parse(`${value}T00:00:00Z`);
    return (
      Number.isFinite(parsed) &&
      new Date(parsed).toISOString().slice(0, 10) === value
    );
  }, "Holiday must be a real calendar date.");

const settingsSchema = z
  .object({
    originPin: z.string().regex(indiaPin),
    carrier: z.string().trim().min(1).max(80),
    dispatchDays: z.number().int().min(0).max(30),
    nonWorkingWeekdays: z
      .array(z.number().int().min(0).max(6))
      .refine((days) => new Set(days).size < 7),
    holidays: z.array(calendarDate),
    destinations: z.record(
      z.string().regex(indiaPin),
      z
        .object({
          minDays: z.number().int().min(1).max(60),
          maxDays: z.number().int().min(1).max(60),
        })
        .refine((range) => range.minDays <= range.maxDays),
    ),
  })
  .strict();

export function deliveryEstimate(
  pin: string,
  now: number,
  raw: string | undefined,
) {
  if (!indiaPin.test(pin)) return { status: "invalid" as const };
  // Reject invalid/out-of-range clocks before converting dates inside the loop.
  if (
    !Number.isFinite(now) ||
    Math.abs(now) > 8_640_000_000_000_000 - 1_001 * day
  ) {
    return { status: "unconfigured" as const };
  }
  let data: unknown;
  try {
    data = JSON.parse(raw ?? "");
  } catch {
    return { status: "unconfigured" as const };
  }
  const config = settingsSchema.safeParse(data);
  if (!config.success) return { status: "unconfigured" as const };
  const { destinations, dispatchDays, nonWorkingWeekdays, holidays } =
    config.data;
  const transit = destinations[pin];
  if (!transit) return { status: "unsupported" as const };

  const currentDate = Math.floor((now + indiaOffset) / day);
  const closed = new Set(holidays);
  const businessDaysAfter = (count: number) => {
    for (
      let date = currentDate, remaining = count, iterations = 0;
      iterations < 1_000;
      date++, iterations++
    ) {
      const instant = new Date(date * day);
      const label = instant.toISOString().slice(0, 10);
      if (closed.has(label) || nonWorkingWeekdays.includes(instant.getUTCDay()))
        continue;
      if (remaining-- === 0) return label;
    }
  };
  const earliest = businessDaysAfter(dispatchDays + transit.minDays);
  const latest = businessDaysAfter(dispatchDays + transit.maxDays);
  if (!earliest || !latest) return { status: "unconfigured" as const };
  return { status: "available" as const, earliest, latest };
}
