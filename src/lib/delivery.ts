export function deliveryDateRange(from: string, to: string) {
  const formatter = new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
  return `${formatter.format(new Date(from))} – ${formatter.format(new Date(to))}`;
}
