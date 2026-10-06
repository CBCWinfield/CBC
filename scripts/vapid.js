'use strict';
// Prints a new pair of keys for phone/browser notifications.
// Run once with `npm run vapid` and paste the two values into Render's environment.
const { generateKeys } = require('../src/lib/push');

const { publicKey, privateKey } = generateKeys();
console.log('Add these to your Render environment variables:\n');
console.log(`VAPID_PUBLIC_KEY=${publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${privateKey}`);
console.log('VAPID_SUBJECT=mailto:your-library-email@example.com');
