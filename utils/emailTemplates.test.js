import test from "node:test";
import assert from "node:assert/strict";
import { escapeHtml, renderPasswordResetEmail } from "./emailTemplates.js";

const URL_OK = "https://flow-wise-client.vercel.app/reset-password?token=abc123&email=a%40b.it";

test("reset password: oggetto, link nel pulsante e nel testo, scadenza", () => {
  const { subject, html, text } = renderPasswordResetEmail({
    resetUrl: URL_OK,
    frontendUrl: "https://flow-wise-client.vercel.app/",
  });
  assert.equal(subject, "Reset your Flow Wise password");
  // nell'HTML la & del link e' escapata, e il link compare nel pulsante e in chiaro
  const escaped = URL_OK.replace(/&/g, "&amp;");
  assert.equal(html.split(`href="${escaped}"`).length - 1, 2);
  assert.match(html, /Choose a new password/);
  assert.match(html, /expires in <strong>1 hour<\/strong>/);
  assert.match(html, /#117e63/, "il pulsante usa il verde primario di Flow Wise");
  // logo dal sito, senza doppia barra
  assert.match(html, /src="https:\/\/flow-wise-client\.vercel\.app\/web-app-manifest-192x192\.png"/);
  // versione testo: link non escapato, niente HTML
  assert.ok(text.includes(URL_OK));
  assert.ok(!/[<>]/.test(text));
});

test("reset password: senza FRONTEND_URL niente logo rotto, la mail resta valida", () => {
  const { html } = renderPasswordResetEmail({ resetUrl: URL_OK });
  assert.ok(!html.includes("<img"));
  assert.match(html, /Flow Wise/);
});

test("reset password: un link con caratteri HTML non rompe il markup", () => {
  const { html } = renderPasswordResetEmail({ resetUrl: 'https://x.test/r?t="><script>alert(1)</script>' });
  assert.ok(!html.includes("<script>"));
  assert.ok(html.includes("&lt;script&gt;"));
});

test("reset password: senza link e' un errore, non una mail vuota", () => {
  assert.throws(() => renderPasswordResetEmail({}), TypeError);
});

test("escapeHtml", () => {
  assert.equal(escapeHtml(`<a href="x">&'</a>`), "&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;");
});
