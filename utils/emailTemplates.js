/**
 * Template delle mail di sistema (13/11/2026).
 *
 * Stile di Flow Wise: sfondo grigio chiaro, card bianca con angoli arrotondati, logo e nome in alto,
 * pulsante nel verde primario dell'app (--primary 165 76% 28% = #117e63), testi secondari grigi.
 *
 * Le mail non sono pagine web: niente CSS esterno ne' classi, solo tabelle e stili inline (Gmail,
 * Outlook e Apple Mail tolgono il resto). Ogni mail ha anche la versione testo semplice.
 */

const COLORS = {
  background: "#f5f7f9",
  card: "#ffffff",
  foreground: "#1a202e",
  muted: "#676f7e",
  border: "#dcdfe5",
  primary: "#117e63",
  primarySoft: "#eaf6f3",
};

const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

/** Escape per i valori messi dentro l'HTML (anche negli attributi). */
export const escapeHtml = (value) =>
  String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

/** Base del sito per logo e link: FRONTEND_URL senza la / finale. */
const siteUrl = (frontendUrl) => String(frontendUrl || "").replace(/\/+$/, "");

/**
 * Guscio comune: logo + nome, card con il contenuto, piede con il link al sito.
 * `preheader` e' il testo che i client mostrano in anteprima accanto all'oggetto.
 */
const layout = ({ preheader, body, frontendUrl }) => {
  const site = siteUrl(frontendUrl);
  const logo = site
    ? `<img src="${escapeHtml(`${site}/web-app-manifest-192x192.png`)}" width="40" height="40" alt="" style="display:block;border:0;border-radius:10px;" />`
    : "";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="color-scheme" content="light" />
<title>Flow Wise</title>
</head>
<body style="margin:0;padding:0;background:${COLORS.background};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${COLORS.background};">
  <tr>
    <td align="center" style="padding:40px 16px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;">
        <tr>
          <td align="center" style="padding-bottom:24px;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="background:${COLORS.card};border:1px solid ${COLORS.border};border-radius:16px;">
              <tr>
                ${logo ? `<td style="padding:10px 0 10px 14px;">${logo}</td>` : ""}
                <td style="padding:10px 16px 10px 12px;font-family:${FONT};font-size:18px;font-weight:600;color:${COLORS.foreground};letter-spacing:-0.2px;">Flow Wise</td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td style="background:${COLORS.card};border:1px solid ${COLORS.border};border-radius:14px;padding:36px 32px;font-family:${FONT};color:${COLORS.foreground};">
            ${body}
          </td>
        </tr>
        <tr>
          <td align="center" style="padding:24px 8px 0;font-family:${FONT};font-size:12px;line-height:18px;color:${COLORS.muted};">
            Flow Wise &middot; personal finance${site ? ` &middot; <a href="${escapeHtml(site)}" style="color:${COLORS.muted};text-decoration:underline;">${escapeHtml(site.replace(/^https?:\/\//, ""))}</a>` : ""}<br />
            This is an automatic message: replies to this address are not read.
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;
};

/**
 * Mail di reset password.
 *
 * @param {{resetUrl: string, frontendUrl?: string, expiresInMinutes?: number}} params
 * @returns {{subject: string, html: string, text: string}}
 */
export const renderPasswordResetEmail = ({ resetUrl, frontendUrl, expiresInMinutes = 60 }) => {
  if (!resetUrl) throw new TypeError("renderPasswordResetEmail: missing resetUrl");
  const url = escapeHtml(resetUrl);
  const expiry = expiresInMinutes === 60 ? "1 hour" : `${expiresInMinutes} minutes`;

  const body = `
    <h1 style="margin:0 0 12px;font-size:24px;line-height:30px;font-weight:600;letter-spacing:-0.3px;">Reset your password</h1>
    <p style="margin:0 0 24px;font-size:15px;line-height:23px;color:${COLORS.muted};">
      We received a request to reset the password of your Flow Wise account. Click the button below to choose a new one.
    </p>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 24px;">
      <tr>
        <td align="center" bgcolor="${COLORS.primary}" style="border-radius:10px;">
          <a href="${url}" target="_blank" style="display:inline-block;padding:13px 28px;font-family:${FONT};font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:10px;">Choose a new password</a>
        </td>
      </tr>
    </table>
    <p style="margin:0 0 24px;padding:12px 14px;background:${COLORS.primarySoft};border-radius:10px;font-size:13px;line-height:20px;color:${COLORS.foreground};">
      The link works once and expires in <strong>${expiry}</strong>.
    </p>
    <p style="margin:0 0 6px;font-size:13px;line-height:20px;color:${COLORS.muted};">If the button doesn't work, copy this link into your browser:</p>
    <p style="margin:0 0 24px;font-size:13px;line-height:20px;word-break:break-all;"><a href="${url}" style="color:${COLORS.primary};">${url}</a></p>
    <p style="margin:0;padding-top:20px;border-top:1px solid ${COLORS.border};font-size:13px;line-height:20px;color:${COLORS.muted};">
      Didn't ask for this? You can ignore this email: your password stays the same.
    </p>`;

  const text = [
    "Reset your password",
    "",
    "We received a request to reset the password of your Flow Wise account.",
    "Open this link to choose a new one:",
    "",
    resetUrl,
    "",
    `The link works once and expires in ${expiry}.`,
    "",
    "Didn't ask for this? You can ignore this email: your password stays the same.",
    "",
    "— Flow Wise",
  ].join("\n");

  return {
    subject: "Reset your Flow Wise password",
    html: layout({ preheader: `Choose a new password. The link expires in ${expiry}.`, body, frontendUrl }),
    text,
  };
};
