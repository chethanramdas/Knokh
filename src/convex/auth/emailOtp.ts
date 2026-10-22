import { Email } from "@convex-dev/auth/providers/Email";
import { RandomReader, generateRandomString } from "@oslojs/crypto/random";

export const emailOtp = Email({
  id: "email-otp",
  maxAge: 60 * 15, // 15 minutes
  async generateVerificationToken() {
    const random: RandomReader = {
      read(bytes: Uint8Array) {
        crypto.getRandomValues(bytes);
      },
    };
    return generateRandomString(random, "0123456789", 6);
  },
  async sendVerificationRequest({ identifier: email, token }) {
    const apiKey = process.env.RESEND_API_KEY;
    const from = process.env.RESEND_FROM_EMAIL;
    if (!apiKey || !from) {
      throw new Error(
        "Email sign-in is not configured. Set RESEND_API_KEY and RESEND_FROM_EMAIL in the Convex environment.",
      );
    }

    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [email],
        subject: "Your KNOKH sign-in code",
        text: `Your KNOKH sign-in code is ${token}. It expires in 15 minutes.`,
        html: `<p>Your KNOKH sign-in code is:</p><p style="font-size:24px;font-weight:700;letter-spacing:4px">${token}</p><p>This code expires in 15 minutes. If you did not request it, you can ignore this email.</p>`,
      }),
    });

    if (!response.ok) {
      const detail = await response.text();
      throw new Error(
        `Could not send the sign-in code (Resend HTTP ${response.status}): ${detail.slice(0, 300)}`,
      );
    }
  },
});
