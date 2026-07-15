import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "jsr:@supabase/server@^1";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;
const RECIPIENT = "christinesmith.colibri@gmail.com";

const escapeHtml = (value: unknown) => String(value ?? "")
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#039;");

const labels: Record<string, string> = {
  content_error: "Possible content error",
  unclear: "Unclear wording",
  source_question: "Source question",
  feature_idea: "Study-tool idea",
  technical: "Technical problem",
};

export default {
  fetch: withSupabase({ auth: "user" }, async (req) => {
    const body = await req.json();
    const message = String(body.message ?? "").trim();
    if (message.length < 4 || message.length > 1200) {
      return Response.json({ error: "Invalid feedback message" }, { status: 400 });
    }

    const category = labels[body.category] ?? "Master Prep feedback";
    const details = [
      ["From", body.submitterEmail],
      ["Category", category],
      ["Location", body.origin],
      ["Question", body.prompt],
      ["Source", body.source],
      ["Feedback", message],
    ].filter(([, value]) => value);

    const rows = details.map(([label, value]) => `
      <tr>
        <td style="padding:10px 14px;color:#64748b;font-size:12px;font-weight:700;vertical-align:top;width:95px">${escapeHtml(label)}</td>
        <td style="padding:10px 14px;color:#0f172a;font-size:14px;line-height:1.5">${escapeHtml(value)}</td>
      </tr>`).join("");

    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: "Master Prep <onboarding@resend.dev>",
        to: [RECIPIENT],
        subject: `Master Prep feedback: ${category}`,
        html: `<div style="font-family:Arial,sans-serif;max-width:680px;margin:auto;padding:24px">
          <div style="background:#07101c;color:#fff;padding:22px;border-radius:16px 16px 0 0">
            <div style="color:#ff5426;font-size:11px;font-weight:800;letter-spacing:1.5px">NEW STUDY FEEDBACK</div>
            <h1 style="margin:9px 0 0;font-size:25px">${escapeHtml(category)}</h1>
          </div>
          <table style="width:100%;border-collapse:collapse;border:1px solid #dbe3ea;border-top:0">${rows}</table>
          <p style="color:#64748b;font-size:12px;line-height:1.5;margin-top:16px">The permanent record is also saved in the private Master Prep feedback inbox.</p>
        </div>`,
      }),
    });

    const data = await response.json();
    if (!response.ok) return Response.json({ error: "Email delivery failed", detail: data }, { status: 502 });
    return Response.json({ ok: true, id: data.id });
  }),
};
