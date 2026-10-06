'use strict';
// Allergy symbols for name tags and screens. Each allergy type gets its own
// picture in a red circle, with the word printed underneath on the tag.

const RED = '#D0021B';
const W = '#fff';
const circle = (inner, label) => `<svg class="allergen" viewBox="0 0 40 40" role="img" aria-label="${label} allergy"><circle cx="20" cy="20" r="19" fill="${RED}"/>${inner}</svg>`;

const ICONS = {
  peanut: circle(`<ellipse cx="20" cy="13.5" rx="6.2" ry="6.6" fill="${W}"/><ellipse cx="20" cy="26" rx="6.8" ry="7.2" fill="${W}"/><rect x="15" y="17" width="10" height="5" fill="${W}"/>`, 'Peanut'),
  treenut: circle(`<rect x="19" y="7" width="2.4" height="4" rx="1" fill="${W}"/><path d="M10.5 17.5c0-4.6 4.3-7 9.5-7s9.5 2.4 9.5 7z" fill="${W}"/><ellipse cx="20" cy="24.5" rx="7" ry="8.5" fill="${W}"/>`, 'Tree nut'),
  milk: circle(`<path d="M14 15l3-5h6l3 5v17H14z" fill="${W}"/><rect x="16.5" y="19" width="7" height="6" rx="1" fill="${RED}"/>`, 'Milk'),
  egg: circle(`<path d="M20 8c5 0 9 8 9 13.5S25 32 20 32s-9-5-9-10.5S15 8 20 8z" fill="${W}"/>`, 'Egg'),
  wheat: circle(`<rect x="19.2" y="9" width="1.6" height="24" fill="${W}"/>${[13, 18.5, 24].map((y) => `<ellipse cx="16.6" cy="${y}" rx="2.4" ry="3.6" transform="rotate(-28 16.6 ${y})" fill="${W}"/><ellipse cx="23.4" cy="${y}" rx="2.4" ry="3.6" transform="rotate(28 23.4 ${y})" fill="${W}"/>`).join('')}<ellipse cx="20" cy="9" rx="2" ry="3" fill="${W}"/>`, 'Wheat'),
  soy: circle(`<path d="M11 27c2-9 9-16 18-17-1 9-8 17-18 17z" fill="${W}"/><circle cx="16" cy="24" r="2.6" fill="${RED}"/><circle cx="20.5" cy="19.5" r="2.6" fill="${RED}"/><circle cx="25" cy="15" r="2.4" fill="${RED}"/>`, 'Soy'),
  sesame: circle(`${[[14, 15, -30], [22, 12, 20], [26, 21, -10], [17, 24, 35], [21, 30, -20]].map(([x, y, r]) => `<ellipse cx="${x}" cy="${y}" rx="2.4" ry="4" transform="rotate(${r} ${x} ${y})" fill="${W}"/>`).join('')}`, 'Sesame'),
  fish: circle(`<ellipse cx="17.5" cy="20" rx="9.5" ry="6" fill="${W}"/><path d="M25 20l8-6v12z" fill="${W}"/><circle cx="13" cy="18.5" r="1.4" fill="${RED}"/>`, 'Fish'),
  shellfish: circle(`<path d="M12 13a10 10 0 1 0 16 9" stroke="${W}" stroke-width="5.5" fill="none" stroke-linecap="round"/><path d="M28 22l5-3-1 7z" fill="${W}"/><circle cx="12.5" cy="12.5" r="2.8" fill="${W}"/>`, 'Shellfish'),
  bee: circle(`<ellipse cx="14.5" cy="13" rx="4.5" ry="3.2" fill="${W}" opacity=".85"/><ellipse cx="25.5" cy="13" rx="4.5" ry="3.2" fill="${W}" opacity=".85"/><ellipse cx="20" cy="22" rx="7" ry="8.5" fill="${W}"/><rect x="13" y="19" width="14" height="2.4" fill="${RED}"/><rect x="13" y="24" width="14" height="2.4" fill="${RED}"/><path d="M20 30.5l-1.6 3.5h3.2z" fill="${W}"/>`, 'Bee sting'),
  medicine: circle(`<g transform="rotate(-45 20 20)"><rect x="9" y="15" width="22" height="10" rx="5" fill="${W}"/><rect x="19.4" y="15" width="1.4" height="10" fill="${RED}"/></g>`, 'Medicine'),
  latex: circle(`<rect x="13" y="17" width="14" height="13" rx="3" fill="${W}"/>${[13.3, 17, 20.7, 24.4].map((x) => `<rect x="${x}" y="9" width="3" height="11" rx="1.5" fill="${W}"/>`).join('')}<rect x="25" y="19" width="7" height="3.4" rx="1.7" transform="rotate(-35 25 19)" fill="${W}"/>`, 'Latex'),
  other: circle(`<rect x="17.8" y="8" width="4.4" height="16" rx="2.2" fill="${W}"/><circle cx="20" cy="29.5" r="2.6" fill="${W}"/>`, 'Allergy'),
};

const LABELS = { peanut: 'Peanut', treenut: 'Tree nut', milk: 'Milk', egg: 'Egg', wheat: 'Wheat', soy: 'Soy', sesame: 'Sesame', fish: 'Fish', shellfish: 'Shellfish', bee: 'Bee sting', medicine: 'Medicine', latex: 'Latex', other: 'Allergy' };

const RULES = [
  ['peanut', /peanut/],
  ['treenut', /tree ?nut|almond|cashew|walnut|pecan|hazelnut|pistachio|macadamia|brazil nut|(^|[^a-z])nuts?([^a-z]|$)/],
  ['milk', /milk|dairy|lactose|cheese|whey|casein|butter/],
  ['egg', /(^|[^a-z])eggs?([^a-z]|$)/],
  ['wheat', /wheat|gluten|celiac|coeliac/],
  ['soy', /(^|[^a-z])soy/],
  ['sesame', /sesame/],
  ['shellfish', /shellfish|shrimp|crab|lobster|clam|oyster|scallop|crawfish|mussel/],
  ['fish', /(^|[^a-z])fish([^a-z]|$)|salmon|tuna|(^|[^a-z])cod([^a-z]|$)|tilapia/],
  ['bee', /(^|[^a-z])bees?([^a-z]|$)|sting|wasp|hornet|insect/],
  ['medicine', /penicillin|amoxicillin|sulfa|antibiotic|ibuprofen|aspirin|codeine|medication|medicine|drug/],
  ['latex', /latex/],
];

// "Peanuts and tree nuts, bee stings" -> ['peanut', 'treenut', 'bee']
function detect(text) {
  const s = String(text || '').toLowerCase();
  if (!s.trim() || /^(none|no|n\/a|na|nka|nkda)\.?$/.test(s.trim())) return [];
  const found = RULES.filter(([, re]) => re.test(s)).map(([k]) => k);
  return found.length ? found : ['other'];
}

const icon = (key) => ICONS[key] || ICONS.other;

module.exports = { detect, icon, LABELS, ICONS };
