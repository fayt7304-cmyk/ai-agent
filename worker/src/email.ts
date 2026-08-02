import type { Env } from "./types";

export async function sendPasswordResetEmail(env: Env, to: string, resetUrl: string): Promise<void> {
  const resp = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: env.RESEND_FROM,
      to,
      subject: "Reset your password",
      html: `<p>Someone requested a password reset for your account.</p>
             <p><a href="${resetUrl}">Click here to set a new password</a>. This link expires in 1 hour.</p>
             <p>If you didn't request this, you can ignore this email.</p>`,
    }),
  });
  if (!resp.ok) throw new Error(`Failed to send email: ${await resp.text()}`);
}
