'use strict';
// Checks that sign-ups use a real, working email address and a real phone number.
//   Email: proper format with a real ending (.com, .org, .net, .us, .edu ...), no throwaway inboxes, common typos caught
//          ("gmial.com"), and the domain must actually accept mail (DNS MX lookup).
//   Phone: a real 10-digit US number (area code and exchange can't start with 0 or 1, no 555-01xx movie numbers, no 111-1111).
// If DNS can't be reached at all, the email isn't rejected for it (a network hiccup shouldn't block a family signing up).
const dns = require('node:dns').promises;

const PROD = process.env.NODE_ENV === 'production';
const TLD = /\.(com|org|net|edu|gov|mil|us|info|biz|church|me|co|io|app|online|email|faith|life|family|ministries|ca|uk|co\.uk|au|mx|de)$/i;
const DISPOSABLE = new Set(['mailinator.com', 'guerrillamail.com', 'guerrillamail.net', '10minutemail.com', 'tempmail.com', 'temp-mail.org', 'yopmail.com', 'trashmail.com', 'getnada.com',
  'sharklasers.com', 'dispostable.com', 'maildrop.cc', 'throwawaymail.com', 'fakeinbox.com', 'mintemail.com', 'emailondeck.com', 'mohmal.com', 'tempinbox.com', 'burnermail.io', 'spamgourmet.com']);
const TYPOS = {
  'gmial.com': 'gmail.com', 'gmai.com': 'gmail.com', 'gamil.com': 'gmail.com', 'gmail.co': 'gmail.com', 'gmail.con': 'gmail.com', 'gmail.cm': 'gmail.com', 'gmaill.com': 'gmail.com', 'gnail.com': 'gmail.com',
  'yaho.com': 'yahoo.com', 'yahoo.con': 'yahoo.com', 'yahooo.com': 'yahoo.com', 'yhoo.com': 'yahoo.com', 'hotmial.com': 'hotmail.com', 'hotmai.com': 'hotmail.com', 'hotmail.con': 'hotmail.com',
  'outlok.com': 'outlook.com', 'outlook.con': 'outlook.com', 'iclod.com': 'icloud.com', 'icloud.con': 'icloud.com', 'aol.con': 'aol.com', 'att.ner': 'att.net', 'sbcglobal.ner': 'sbcglobal.net',
};
const TEST_DOMAINS = new Set(['example.com', 'example.org', 'example.net']);
const FORMAT = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/i;

const cache = new Map();
async function domainTakesMail(domain) {
  if (!PROD && TEST_DOMAINS.has(domain)) return true;
  if (process.env.EMAIL_DNS_CHECK === 'off') return true;
  const hit = cache.get(domain);
  if (hit && Date.now() - hit.at < 6 * 3600000) return hit.ok;
  const withTimeout = (p) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(Object.assign(new Error('timeout'), { code: 'ETIMEOUT' })), 4000))]);
  let ok;
  try {
    const mx = await withTimeout(dns.resolveMx(domain));
    ok = mx.some((r) => r.exchange && r.exchange !== '.');
  } catch (e) {
    if (e.code === 'ENOTFOUND' || e.code === 'ENODATA') {
      // No mail servers listed: some small domains take mail on their main address.
      try { ok = (await withTimeout(dns.resolve4(domain))).length > 0; } catch (e2) { ok = !(e2.code === 'ENOTFOUND' || e2.code === 'ENODATA'); }
    } else ok = true; // DNS unreachable: don't block anyone over it
  }
  cache.set(domain, { ok, at: Date.now() });
  return ok;
}

// Returns an error message, or null when the email looks real and can receive mail.
async function emailProblem(email) {
  email = String(email || '').trim().toLowerCase();
  if (!email) return 'Please enter your email address.';
  if (!FORMAT.test(email)) return 'Enter a real email address, like name@gmail.com.';
  const domain = email.split('@')[1];
  if (TYPOS[domain]) return `Did you mean ${email.split('@')[0]}@${TYPOS[domain]}? Please check the spelling.`;
  if (!TLD.test(domain) && !(!PROD && TEST_DOMAINS.has(domain))) return 'Please use a regular email address ending in .com, .org, .net or similar.';
  if (DISPOSABLE.has(domain)) return 'Please use your everyday email address, not a temporary one.';
  if (!(await domainTakesMail(domain))) return `We couldn’t find an email service at “${domain}”. Please check the address.`;
  return null;
}

// "620.555.0123" → "(620) 555-0123". Returns null when it isn't a real US number.
function cleanPhone(phone) {
  let d = String(phone || '').replace(/\D/g, '');
  if (d.length === 11 && d[0] === '1') d = d.slice(1);
  if (d.length !== 10) return null;
  const [a, e, n] = [d.slice(0, 3), d.slice(3, 6), d.slice(6)];
  if (/^[01]/.test(a) || /^[01]/.test(e)) return null;
  if (/^(\d)\1{9}$/.test(d) || d === '1234567890' || d === '0123456789') return null;
  if (PROD && e === '555' && /^01\d\d$/.test(n)) return null; // reserved "movie" numbers
  if (a[1] === a[2] && a[1] === '1') return null; // 211, 311, 411, 911 ... are service codes, not area codes
  return `(${a}) ${e}-${n}`;
}
const phoneProblem = (phone) => (!String(phone || '').trim() ? 'Please enter your phone number.' : cleanPhone(phone) ? null : 'Enter a real 10-digit phone number, like (620) 221-2980.');

module.exports = { emailProblem, phoneProblem, cleanPhone };
