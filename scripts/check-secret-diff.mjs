import { execFileSync } from "node:child_process";

const [, , base, head] = process.argv;
const validRef = /^(?:HEAD|[a-f0-9]{40})$/;
if (!validRef.test(base ?? "") || !validRef.test(head ?? "")) {
  throw new Error("Two Git revisions are required.");
}
const patterns = [
  /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----/,
  /\b(?:gh[pousr]|github_pat)_[a-zA-Z0-9_]{25,}\b/,
  /\bre_[a-zA-Z0-9]{6,}_[a-zA-Z0-9_]{15,}\b/,
  /(?:RAZORPAY_KEY_SECRET|CONVEX_DEPLOY_KEY|AUTH_GOOGLE_SECRET|RESEND_API_KEY|CLOUDFLARE_API_TOKEN)\s*[:=]\s*["']?[a-zA-Z0-9|_./+-]{20,}/,
];
const output = execFileSync(
  "git",
  ["diff", "--no-ext-diff", "--unified=0", base, head],
  {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  },
);
let possibleMatches = 0;
for (const line of output.split("\n")) {
  if (!line.startsWith("+") || line.startsWith("+++")) continue;
  if (patterns.some((pattern) => pattern.test(line))) possibleMatches++;
}
if (possibleMatches) {
  console.error(
    `Potential secret patterns in ${possibleMatches} added line(s). Review the patch privately.`,
  );
  process.exitCode = 1;
}
