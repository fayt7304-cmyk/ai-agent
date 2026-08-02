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

export interface LeadEmailInput {
  name: string | null;
  phone: string | null;
  email: string | null;
  message: string | null;
  hasPhoto: boolean;
  fromUsername: string;
  /** Base64-encoded photo bytes (no "data:image/...;base64," prefix), if one was attached. */
  photoBase64?: string | null;
  photoFilename?: string;
}

export async function sendLeadNotificationEmail(env: Env, to: string, lead: LeadEmailInput): Promise<void> {
  const rows = [
    ["From account", lead.fromUsername],
    ["Name", lead.name || "(not given)"],
    ["Phone", lead.phone || "(not given)"],
    ["Email", lead.email || "(not given)"],
    ["Photo attached", lead.hasPhoto ? "Yes" : "No"],
  ]
    .map(([k, v]) => `<tr><td style="padding:4px 12px 4px 0;color:#666;">${k}</td><td>${v}</td></tr>`)
    .join("");

  const body: Record<string, unknown> = {
    from: env.RESEND_FROM,
    to,
    subject: `New quote request${lead.name ? ` from ${lead.name}` : ""}`,
    html: `<h2>New quote request</h2>
           <table>${rows}</table>
           ${lead.message ? `<p><strong>Message:</strong><br>${lead.message.replace(/\n/g, "<br>")}</p>` : ""}`,
  };

  if (lead.photoBase64) {
    body.attachments = [
      {
        filename: lead.photoFilename || "photo.jpg",
        content: lead.photoBase64,
      },
    ];
  }

  const resp = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!resp.ok) throw new Error(`Failed to send lead notification: ${await resp.text()}`);
}
