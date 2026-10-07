'use strict';
// Keeps foul language off the Prayer Wall and out of messages.
// Matches whole words (so "class", "assess", "Scunthorpe" and "hello" are fine), sees through common tricks
// (f*ck, sh1t, $hit, fuuuck, f.u.c.k), and leaves Bible words alone ("hell", "damnation", Balaam's "ass", "pricks").

const WORDS = [
  // f-word family
  'fuck', 'fucks', 'fucked', 'fucker', 'fuckers', 'fucking', 'fuckin', 'fuckup', 'fuckface', 'fuckhead', 'motherfucker', 'motherfuckers', 'motherfucking', 'mf', 'mfer', 'fck', 'fcking', 'fk', 'fking', 'fukc', 'fuk', 'fuking', 'phuck', 'wtf', 'stfu', 'gtfo', 'fml', 'ffs',
  // s-word family
  'shit', 'shits', 'shitty', 'shitting', 'shitted', 'shithead', 'shithole', 'bullshit', 'horseshit', 'dipshit', 'chickenshit', 'shite', 'sht',
  // others
  'bitch', 'bitches', 'bitching', 'bitchy', 'biatch', 'btch', 'bastard', 'bastards', 'asshole', 'assholes', 'arsehole', 'jackass', 'dumbass', 'fatass', 'badass', 'smartass', 'asshat', 'ass-hole',
  'damn', 'dammit', 'damnit', 'goddamn', 'goddamned', 'goddammit', 'godamn',
  'piss', 'pissed', 'pissing', 'pissoff', 'dickhead', 'dickheads', 'cocksucker', 'cunt', 'cunts', 'twat', 'twats', 'slut', 'sluts', 'skank', 'wanker', 'tits', 'titties', 'boobs', 'jizz', 'dildo',
  // slurs
  'nigger', 'niggers', 'nigga', 'niggas', 'faggot', 'faggots', 'fag', 'fags', 'retard', 'retarded', 'tranny', 'spic', 'chink', 'kike', 'wetback',
];
const SET = new Set(WORDS);
// Strong words also caught when spelled out with spaces or dots: "f u c k", "s.h.i.t".
const SPELLED = ['fuck', 'shit', 'bitch', 'cunt', 'nigger', 'faggot', 'asshole', 'damn', 'motherfucker'];

const LEET = { 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't', 8: 'b', '@': 'a', $: 's', '!': 'i', '|': 'i', '*': '', '+': 't' };
const collapse = (w) => w.replace(/(.)\1+/g, '$1');
const COLLAPSED = new Set(WORDS.map(collapse));

function words(text) {
  return String(text || '').toLowerCase()
    .replace(/[0-9@$!|*+]/g, (c) => (c in LEET ? LEET[c] : c))
    .split(/[^a-z\-']+/).map((w) => w.replace(/^['-]+|['-]+$/g, '')).filter(Boolean);
}

// Returns the first offending word, or null when the text is clean.
function find(text) {
  for (const w of words(text)) {
    const bare = w.replace(/['-]/g, '');
    if (SET.has(w) || SET.has(bare) || COLLAPSED.has(collapse(bare))) return w;
  }
  // spelled out letter by letter
  const singles = String(text || '').toLowerCase().match(/(?:\b[a-z0-9@$*]\b[\s.\-_]*){3,}/g) || [];
  for (const run of singles) {
    const joined = run.replace(/[^a-z0-9@$*]/g, '').replace(/[0-9@$*]/g, (c) => LEET[c] || '');
    if (SPELLED.some((s) => collapse(joined).includes(collapse(s)))) return run.trim();
  }
  return null;
}

const isClean = (text) => !find(text);

module.exports = { find, isClean };
