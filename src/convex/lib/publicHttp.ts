"use node";

/** Node-action-only, bounded HTTPS fetch with DNS pinning and redirect checks. */
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { request } from "node:https";

export function isPublicAddress(address: string): boolean {
  if (isIP(address) === 6) {
    const [firstText, secondText] = address.split(":");
    const first = Number.parseInt(firstText, 16);
    const second = Number.parseInt(secondText || "0", 16);
    return (
      first >= 0x2000 &&
      first <= 0x3fff &&
      first !== 0x2002 &&
      !(first === 0x2001 && (second <= 0x01ff || second === 0x0db8))
    );
  }
  if (isIP(address) !== 4) return false;
  const [a, b, c] = address.split(".").map(Number);
  return !(
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 168 || b === 0)) ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
    (a === 203 && b === 0 && c === 113)
  );
}
export function validatePublicHttps(input: string): URL {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error("A valid HTTPS URL is required.");
  }
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    (url.port && url.port !== "443") ||
    /(^localhost$|\.(localhost|local|internal|lan|home|invalid)$)/i.test(
      host,
    ) ||
    (isIP(host) && !isPublicAddress(host))
  ) {
    throw new Error(
      "Only public HTTPS endpoints without URL credentials or custom ports are allowed.",
    );
  }
  return url;
}
export async function publicGet(
  input: string,
  options: { token?: string; maxBytes?: number; timeoutMs?: number } = {},
) {
  const original = validatePublicHttps(input);
  let url = original;
  for (let redirects = 0; redirects <= 3; redirects++) {
    const host = url.hostname.replace(/^\[|\]$/g, "");
    const addresses = await lookup(host, { all: true, verbatim: true });
    if (!addresses.length || addresses.some((a) => !isPublicAddress(a.address)))
      throw new Error("Endpoint resolves to a private or reserved network.");
    if (options.token && url.origin !== original.origin)
      throw new Error(
        "Authenticated feeds cannot redirect to a different origin.",
      );
    const result = await new Promise<{
      text: string;
      status: number;
      contentType: string;
      location?: string;
    }>((resolve, reject) => {
      const req = request(
        url,
        {
          method: "GET",
          lookup: (_hostname, options, cb) =>
            options.all
              ? cb(null, addresses)
              : cb(null, addresses[0].address, addresses[0].family),
          headers: {
            Accept: "application/json,text/csv,text/html",
            "User-Agent": "KNOKH-SupplierImporter/1.0",
            ...(options.token
              ? { Authorization: `Bearer ${options.token}` }
              : {}),
          },
        },
        (res) => {
          const status = res.statusCode ?? 0;
          if ([301, 302, 303, 307, 308].includes(status)) {
            res.resume();
            resolve({
              text: "",
              status,
              contentType: "",
              location: res.headers.location,
            });
            return;
          }
          const chunks: Buffer[] = [];
          let total = 0;
          res.on("data", (chunk: Buffer) => {
            total += chunk.length;
            if (total > (options.maxBytes ?? 1_000_000)) {
              res.destroy(new Error("Response exceeds the allowed size."));
              return;
            }
            chunks.push(chunk);
          });
          res.on("error", () =>
            reject(
              new Error(
                "Supplier response failed or exceeded the allowed size.",
              ),
            ),
          );
          res.on("end", () =>
            resolve({
              text: Buffer.concat(chunks).toString("utf8"),
              status,
              contentType: res.headers["content-type"] ?? "",
            }),
          );
        },
      );
      const timer = setTimeout(
        () => req.destroy(new Error("Endpoint timed out.")),
        options.timeoutMs ?? 15_000,
      );
      req.on("close", () => clearTimeout(timer));
      req.on("error", () =>
        reject(new Error("Endpoint request failed or timed out.")),
      );
      req.end();
    });
    if (!result.location) return result;
    url = validatePublicHttps(new URL(result.location, url).toString());
  }
  throw new Error("Endpoint exceeded the redirect limit.");
}
