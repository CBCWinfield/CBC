'use strict';
// Sends email through Resend's API (https://resend.com). Without an API key,
// emails are printed to the log instead so nothing breaks during setup.
const { esc } = require('./html');

const API_KEY = process.env.RESEND_API_KEY;
const FROM = process.env.EMAIL_FROM || 'Central Baptist Church <onboarding@resend.dev>';
// Replies go to the church office unless EMAIL_REPLY_TO says otherwise.
const REPLY_TO = process.env.EMAIL_REPLY_TO || 'centralbaptistchurchcalendar@gmail.com';
const BASE_URL = (process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || `http://localhost:${process.env.PORT || 3000}`).replace(/\/$/, '');

function layout({ heading, paragraphs = [], button, footer, libraryName }) {
  const p = paragraphs.filter(Boolean).map((t) => `<p style="margin:0 0 14px;font-size:16px;line-height:1.55;color:#1C2622">${t}</p>`).join('');
  const btn = button
    ? `<p style="margin:22px 0"><a href="${esc(button.url)}" style="background:#2E7D32;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:6px;font-weight:bold;display:inline-block">${esc(button.label)}</a></p>`
    : '';
  return `<!doctype html><html><body style="margin:0;background:#F0F4EE;padding:24px 12px;font-family:Arial,Helvetica,sans-serif">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center">
  <table role="presentation" width="560" cellspacing="0" cellpadding="0" style="max-width:560px;background:#ffffff;border-radius:8px;overflow:hidden">
  <tr><td style="background:#000000;padding:16px 28px;border-bottom:4px solid #8CC63F"><img src="${esc(BASE_URL)}/img/logo-central-black.png" alt="Central Baptist Church" width="150" height="56" style="display:block;border:0;height:56px;width:auto"></td></tr>
  <tr><td style="padding:24px 28px 8px">
    <div style="font-size:14px;color:#55635C;margin-bottom:6px">${esc(libraryName)}</div>
    <h1 style="margin:0 0 18px;font-size:24px;line-height:1.25;color:#1B4D1F;font-weight:bold">${esc(heading)}</h1>
    ${p}${btn}
  </td></tr>
  <tr><td style="padding:8px 28px 26px;font-size:13px;color:#55635C;line-height:1.5">${footer || ''}</td></tr>
  </table></td></tr></table></body></html>`;
}

function toText({ heading, paragraphs = [], button }) {
  const strip = (s) => String(s).replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  return [heading, '', ...paragraphs.filter(Boolean).map(strip), button ? `${button.label}: ${button.url}` : ''].join('\n');
}

async function send({ to, subject, heading, paragraphs, button, footer, attachments, libraryName }) {
  if (!to) return { skipped: true };
  const recipients = [].concat(to).filter(Boolean);
  if (!recipients.length) return { skipped: true };
  const content = { heading: heading || subject, paragraphs, button, footer, libraryName };
  const body = {
    from: FROM,
    to: recipients,
    subject,
    html: layout(content),
    text: toText(content),
  };
  if (REPLY_TO) body.reply_to = REPLY_TO;
  if (attachments && attachments.length) {
    body.attachments = attachments.map((a) => ({ filename: a.filename, content: Buffer.from(a.content).toString('base64') }));
  }
  if (!API_KEY) {
    console.log(`[email not sent: RESEND_API_KEY missing] to=${recipients.join(', ')} subject="${subject}"`);
    return { skipped: true };
  }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      const text = await res.text();
      console.error(`Email to ${recipients.join(', ')} failed (${res.status}): ${text.slice(0, 300)}`);
      return { ok: false };
    }
    return { ok: true };
  } catch (err) {
    console.error(`Email to ${recipients.join(', ')} failed: ${err.message}`);
    return { ok: false };
  }
}

module.exports = { send, layout, enabled: () => Boolean(API_KEY) };
