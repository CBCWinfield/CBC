'use strict';
// Web Push (phone and browser notifications) implemented with Node's crypto:
// VAPID authentication (RFC 8292) and aes128gcm payload encryption (RFC 8291).
// No third-party service is involved; browsers deliver through their own push services.
const crypto = require('node:crypto');

const PUBLIC = process.env.VAPID_PUBLIC_KEY || '';
const PRIVATE = process.env.VAPID_PRIVATE_KEY || '';
const SUBJECT = process.env.VAPID_SUBJECT || 'mailto:centralbaptistchurchcalendar@gmail.com';

const b64u = (buf) => Buffer.from(buf).toString('base64url');
const fromB64u = (s) => Buffer.from(s, 'base64url');

let privateKey = null;
function key() {
  if (privateKey) return privateKey;
  const pub = fromB64u(PUBLIC);
  privateKey = crypto.createPrivateKey({
    key: { kty: 'EC', crv: 'P-256', d: PRIVATE, x: b64u(pub.subarray(1, 33)), y: b64u(pub.subarray(33, 65)) },
    format: 'jwk',
  });
  return privateKey;
}

const enabled = () => Boolean(PUBLIC && PRIVATE);

function vapidJwt(audience) {
  const header = b64u(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const payload = b64u(JSON.stringify({ aud: audience, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: SUBJECT }));
  const data = `${header}.${payload}`;
  const sig = crypto.sign('sha256', Buffer.from(data), { key: key(), dsaEncoding: 'ieee-p1363' });
  return `${data}.${b64u(sig)}`;
}

const hmac = (k, data) => crypto.createHmac('sha256', k).update(data).digest();

// Encrypt a payload for one subscription (RFC 8291, aes128gcm, single record).
function encrypt(payload, p256dh, authSecret, { salt = crypto.randomBytes(16), ecdh = null } = {}) {
  const uaPublic = fromB64u(p256dh);
  const auth = fromB64u(authSecret);
  const server = ecdh || crypto.createECDH('prime256v1');
  if (!ecdh) server.generateKeys();
  const asPublic = server.getPublicKey();
  const shared = server.computeSecret(uaPublic);

  const prkKey = hmac(auth, shared);
  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic, Buffer.from([1])]);
  const ikm = hmac(prkKey, keyInfo);
  const prk = hmac(salt, ikm);
  const cek = hmac(prk, Buffer.concat([Buffer.from('Content-Encoding: aes128gcm\0'), Buffer.from([1])])).subarray(0, 16);
  const nonce = hmac(prk, Buffer.concat([Buffer.from('Content-Encoding: nonce\0'), Buffer.from([1])])).subarray(0, 12);

  const cipher = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  const plain = Buffer.concat([Buffer.from(payload), Buffer.from([2])]);
  const body = Buffer.concat([cipher.update(plain), cipher.final(), cipher.getAuthTag()]);

  const rs = Buffer.alloc(4);
  rs.writeUInt32BE(4096);
  return Buffer.concat([salt, rs, Buffer.from([asPublic.length]), asPublic, body]);
}

// Returns 'ok', 'gone' (subscription expired: delete it) or 'error'.
async function sendPush(sub, message) {
  if (!enabled()) return 'error';
  try {
    const url = new URL(sub.endpoint);
    const body = encrypt(JSON.stringify(message), sub.p256dh, sub.auth);
    const res = await fetch(sub.endpoint, {
      method: 'POST',
      headers: {
        'Content-Encoding': 'aes128gcm',
        'Content-Type': 'application/octet-stream',
        TTL: '86400',
        Urgency: 'normal',
        Authorization: `vapid t=${vapidJwt(url.origin)}, k=${PUBLIC}`,
      },
      body,
      signal: AbortSignal.timeout(15000),
    });
    if (res.status === 404 || res.status === 410) return 'gone';
    if (!res.ok) {
      console.error(`Push failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
      return 'error';
    }
    return 'ok';
  } catch (err) {
    console.error('Push failed:', err.message);
    return 'error';
  }
}

function generateKeys() {
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.generateKeys();
  const d = ecdh.getPrivateKey();
  const priv = Buffer.alloc(32);
  d.copy(priv, 32 - d.length);
  return { publicKey: b64u(ecdh.getPublicKey()), privateKey: b64u(priv) };
}

module.exports = { enabled, sendPush, encrypt, generateKeys, publicKey: () => PUBLIC };
