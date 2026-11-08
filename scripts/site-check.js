#!/usr/bin/env node
'use strict';
// Check the live church site by hand (the site also checks itself every morning: src/site-check-job.js).
//   node scripts/site-check.js [https://www.cbcwinfield.org]
const { check } = require('../src/lib/site-check');
const base = process.argv[2] || process.env.SITE_URL || 'https://www.cbcwinfield.org';
check(base, { log: console.log }).then((r) => {
  if (r.problems.length) { console.log(`\n${r.problems.length} problem(s) on ${r.base}:\n- ` + r.problems.join('\n- ')); process.exit(1); }
  console.log('All good.');
}).catch((e) => { console.error(e); process.exit(1); });
