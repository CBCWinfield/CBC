'use strict';
// The "Ask" assistant. Fully self-contained: no AI service, no network calls.
// It reads a plain-language question, works out what the person is after
// (a topic, an author, a category, an audience, availability, or a library
// question like "when can I pick up"), and answers from the catalog and the
// library's own settings.

const { describeDays } = require('../settings');
const { fmtHm } = require('./time');

const STOP = new Set(`a an the and or but of in on at to for from with about into over under than then
  is are was were be been being am do does did done have has had having i me my we our you your they them their it its
  this that these those there here what which who whom whose where when why how can could would should will shall may might must
  any some something anything all every each most more much many few lot lots please thanks thank hi hello hey
  book books title titles read reading reads find finding show give get got want wanted need needs needed looking look search searching
  recommend recommendation recommendations suggest suggestion good great best nice new something like also just really very
  library catalog copy copies kind kinds type types sort topic topics subject subjects stuff thing things one ones
  written wrote write writer by author authors called named series help helps helping deal dealing cope coping going through
  im ive id dont doesnt cant wont maybe perhaps think know tell let lets got gotten anybody someone somebody person people`.split(/\s+/));

// Words that belong to questions about how the library works, not to book topics.
const FAQ_WORDS = new Set(`pick pickup up time times long keep free return returns returning sign signup apply application hours hour open
  renew renewal extend extension many cost costs fee fees fine fines late due check checkout out reserve reserving reservation work works does
  get card code borrow borrowing day days week weeks much where located location address contact phone call email register registration
  account join membership limit max maximum back bring drop today tomorrow come visit library`.split(/\s+/));

// Topic synonyms: a word on the left also matches words on the right.
const SYNONYMS = {
  grief: ['loss', 'grieving', 'bereavement', 'mourning', 'comfort', 'widow', 'widowed', 'sorrow'],
  loss: ['grief', 'grieving', 'bereavement', 'mourning', 'comfort'],
  death: ['grief', 'dying', 'heaven', 'eternity'],
  heaven: ['eternity', 'afterlife', 'eternal'],
  comfort: ['grief', 'hope', 'encouragement', 'peace'],
  anxiety: ['worry', 'fear', 'anxious', 'peace', 'stress', 'calm'],
  worry: ['anxiety', 'fear', 'peace', 'trust'],
  fear: ['anxiety', 'worry', 'courage', 'trust'],
  depression: ['hope', 'despair', 'sorrow', 'encouragement'],
  hope: ['encouragement', 'comfort', 'faith'],
  encouraging: ['encouragement', 'hope', 'comfort', 'peace', 'joy'],
  encouragement: ['hope', 'comfort', 'peace', 'joy'],
  encourage: ['encouragement', 'hope', 'comfort'],
  joy: ['happiness', 'peace', 'hope'],
  peace: ['calm', 'anxiety', 'worry', 'rest'],
  marriage: ['married', 'husband', 'wife', 'spouse', 'couple', 'couples', 'wedding'],
  husband: ['marriage', 'wife', 'men'],
  wife: ['marriage', 'husband', 'women'],
  parenting: ['parent', 'parents', 'mother', 'father', 'raising', 'children', 'family'],
  family: ['parenting', 'marriage', 'children', 'home'],
  prayer: ['pray', 'praying', 'prayers', 'intercession'],
  pray: ['prayer', 'praying'],
  devotional: ['devotionals', 'devotion', 'devotions', 'daily', 'quiet'],
  daily: ['devotional', 'devotions'],
  bible: ['scripture', 'scriptures', 'word', 'testament', 'gospel', 'gospels'],
  scripture: ['bible', 'word'],
  study: ['studies', 'commentary', 'workbook', 'inductive'],
  commentary: ['study', 'exposition', 'commentaries'],
  salvation: ['saved', 'gospel', 'grace', 'redemption', 'born'],
  gospel: ['salvation', 'jesus', 'christ', 'evangelism'],
  evangelism: ['witnessing', 'soul', 'gospel', 'missions', 'sharing'],
  missions: ['missionary', 'missionaries', 'mission', 'evangelism'],
  missionary: ['missions', 'missionaries', 'biography'],
  biography: ['biographies', 'life', 'memoir', 'autobiography', 'story'],
  memoir: ['biography', 'autobiography', 'story'],
  fiction: ['novel', 'novels', 'story', 'stories'],
  novel: ['fiction', 'story'],
  prophecy: ['revelation', 'end', 'times', 'eschatology', 'rapture', 'daniel'],
  revelation: ['prophecy', 'eschatology'],
  history: ['historical', 'church', 'reformation', 'baptist'],
  theology: ['doctrine', 'doctrines', 'systematic', 'beliefs'],
  doctrine: ['theology', 'beliefs'],
  apologetics: ['defense', 'evidence', 'reason', 'faith', 'skeptic'],
  worship: ['music', 'hymn', 'hymns', 'praise', 'singing'],
  hymns: ['hymn', 'worship', 'music', 'hymnal'],
  forgiveness: ['forgive', 'forgiving', 'grace', 'mercy', 'reconciliation'],
  addiction: ['recovery', 'freedom', 'sobriety'],
  money: ['finances', 'financial', 'stewardship', 'budget', 'giving'],
  leadership: ['leader', 'leaders', 'leading', 'pastor', 'ministry'],
  jesus: ['christ', 'savior', 'messiah', 'gospel'],
  christ: ['jesus'],
  holy: ['spirit'],
  spirit: ['holy', 'spiritual'],
  christmas: ['advent', 'nativity'],
  easter: ['resurrection', 'cross', 'passion'],
  creation: ['genesis', 'science', 'origins'],
  dvd: ['dvds', 'video', 'movie', 'film'],
  movie: ['dvd', 'video', 'film'],
  audiobook: ['audio', 'cd'],
  large: ['print'],
};

const AUDIENCE_WORDS = {
  Children: ['kid', 'kids', 'child', 'children', 'childrens', "children's", 'toddler', 'toddlers', 'preschool', 'little', 'young', 'boys', 'girls', 'elementary', 'picture'],
  Youth: ['teen', 'teens', 'teenager', 'teenagers', 'youth', 'student', 'students', 'highschool', 'middle', 'junior', 'adolescent'],
  Adults: ['adult', 'adults', 'grownup', 'grownups'],
};

const FORMAT_WORDS = {
  'Large Print': ['large print', 'big print', 'large type'],
  DVD: ['dvd', 'dvds', 'blu-ray', 'bluray', 'movie', 'movies', 'film', 'films', 'video', 'videos'],
  Audiobook: ['audiobook', 'audiobooks', 'audio book', 'audio books', 'books on cd'],
  CD: ['cd', 'cds', 'music cd', 'music cds', 'album', 'albums'],
  'Board Book': ['board book', 'board books'],
  Workbook: ['workbook', 'workbooks', 'study guide', 'study guides'],
};
// Which stored formats count for each group.
const FORMAT_GROUPS = { DVD: ['DVD', 'Blu-ray'], CD: ['CD', 'Audiobook'], Audiobook: ['Audiobook', 'CD'] };
const formatMatches = (group, value) => (FORMAT_GROUPS[group] || [group]).includes(value);

const AVAILABLE_PHRASES = ['available', 'in stock', 'on the shelf', 'on shelf', 'right now', 'checked in', 'can i get', 'can i borrow', 'not checked out'];

// Very light stemmer so "praying" ~ "pray", "marriages" ~ "marriage".
function stem(w) {
  if (w.length <= 4) return w;
  if (w.endsWith('ies') && w.length > 5) return w.slice(0, -3) + 'y';
  if (w.endsWith('ing') && w.length > 6) return w.slice(0, -3);
  if (w.endsWith('ed') && w.length > 5) return w.slice(0, -2);
  if (w.endsWith('es') && w.length > 5) return w.slice(0, -2);
  if (w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1);
  return w;
}

function normalize(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9\s&-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
const words = (s) => normalize(s).split(' ').filter(Boolean);

// Edit distance where swapping two neighbouring letters counts as one typo
// ("lewsi" -> "lewis").
function lev(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const d = [];
  for (let i = 0; i <= a.length; i++) d.push([i]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    let rowMin = Infinity;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, d[i - 2][j - 2] + 1);
      d[i][j] = v;
      rowMin = Math.min(rowMin, v);
    }
    if (rowMin > max) return max + 1;
  }
  return d[a.length][b.length];
}
const fuzzyLimit = (w) => (w.length >= 8 ? 2 : w.length >= 5 ? 1 : 0);

// ---------------- Library questions ----------------
function faqAnswer(q, s) {
  const n = ` ${normalize(q)} `;
  const has = (...ps) => ps.some((p) => n.includes(` ${p}`));
  const hours = `${describeDays(s.pickup_days)}, ${fmtHm(s.pickup_start)}–${fmtHm(s.pickup_end)}`;

  if (has('hour', 'hours', 'open', 'when can i pick', 'when can i come', 'pick up time', 'pickup time', 'what time', 'pick up', 'pickup', 'what days')) {
    return `Books are picked up ${hours}. When you check out a book online you choose a ${s.slot_minutes}-minute pickup time in that window.`;
  }
  if (has('how long', 'keep', 'due', 'loan period', 'checkout period', 'check out period', 'borrow for')) {
    return `You can keep books for ${s.checkout_days} days, counted from the day you pick them up. Your due dates are listed on your My Library page.`;
  }
  if (has('renew', 'extend', 'more time', 'longer')) {
    return `Need more time? Contact the librarian before your due date and he can extend your checkout${s.max_extensions ? ` (up to ${s.max_extensions} time${s.max_extensions > 1 ? 's' : ''} per book)` : ''}.`;
  }
  if (has('how many', 'limit', 'maximum', 'max')) {
    return `You can have up to ${s.max_books} book${s.max_books > 1 ? 's' : ''} reserved or checked out at a time.`;
  }
  if (has('cost', 'fee', 'fees', 'free', 'price', 'pay', 'fine', 'fines', 'charge')) {
    return 'The library is free. There are no fees or late fines; we just ask that you bring books back on time so others can enjoy them.';
  }
  if (has('return', 'bring back', 'drop off', 'give back')) {
    return `Bring books back to the church library during library hours (${hours}). The librarian will check them in for you.`;
  }
  if (has('sign up', 'signup', 'register', 'apply', 'application', 'join', 'membership', 'account', 'library card', 'library code', 'get a card', 'become a member')) {
    return s.auto_approve
      ? 'Fill out the short application on the Apply page. Your account is approved right away, and you will get a library code to use when you check out books.'
      : 'Fill out the short application on the Apply page. The librarian reviews it, and once you are approved you will get a library code by email to use when you check out books.';
  }
  if (has('where', 'location', 'address', 'directions')) {
    return s.library_address ? `The library is at ${s.library_address}.` : `The library is inside ${s.church_name}.`;
  }
  if (has('contact', 'phone', 'call', 'email the', 'reach', 'talk to')) {
    const bits = [s.contact_phone && `call ${s.contact_phone}`, s.contact_email && `email ${s.contact_email}`].filter(Boolean);
    return bits.length ? `You can reach the library: ${bits.join(' or ')}.` : 'Ask the librarian during library hours, or contact the church office.';
  }
  if (has('check out', 'checkout', 'borrow', 'reserve', 'how do i get', 'how does it work', 'how does this work')) {
    return `Find a book, choose Check out, enter your library code and pick a pickup time (${hours}). Then come get it at the church.`;
  }
  return null;
}

// ---------------- Catalog search ----------------
const prepared = new WeakMap();
function prepareBook(b) {
  if (prepared.has(b)) return prepared.get(b);
  const fields = {
    title: words([b.title, b.subtitle].filter(Boolean).join(' ')),
    author: words(b.author),
    category: words([b.category, b.subcategory].filter(Boolean).join(' ')),
    tags: words(b.tags),
    series: words(b.series),
    number: words(b.call_number),
    description: words(b.description),
    audience: words(b.audience),
    format: words(b.format),
  };
  const sets = {};
  for (const [k, list] of Object.entries(fields)) sets[k] = new Set(list.flatMap((w) => [w, stem(w)]));
  const p = { b, fields, sets, titleNorm: normalize(b.title), authorNorm: normalize(b.author) };
  prepared.set(b, p);
  return p;
}

const WEIGHTS = { title: 6, author: 5, series: 5, number: 6, category: 4, tags: 4, audience: 2, format: 2, description: 1.5 };
const NO_FUZZY = new Set(['description', 'number']); // too many words to check spelling against, or exact codes

function scoreTerm(p, term, fuzzy = true, skipDescription = false) {
  let best = 0;
  const st = stem(term);
  const lim = fuzzy ? fuzzyLimit(term) : 0;
  for (const [field, w] of Object.entries(WEIGHTS)) {
    if (skipDescription && field === 'description') continue;
    const set = p.sets[field];
    let s = 0;
    if (set.has(term) || set.has(st)) s = w;
    else if (lim && !NO_FUZZY.has(field)) {
      for (const x of p.fields[field]) {
        if (x.length > 3 && lev(term, x, lim) <= lim) { s = w * 0.55; break; }
      }
    }
    if (field === 'description' && s) s = Math.min(s * 1.5, 3); // descriptions count a little more when they hit
    best = Math.max(best, s);
  }
  return best;
}

function detect(question, books, s) {
  const n = ` ${normalize(question)} `;
  const out = { availableOnly: false, audience: null, format: null, author: null, category: null };

  out.availableOnly = AVAILABLE_PHRASES.some((p) => n.includes(` ${p}`));

  for (const [aud, list] of Object.entries(AUDIENCE_WORDS)) {
    if (list.some((w) => n.includes(` ${w} `))) { out.audience = aud; break; }
  }
  for (const [fmt, list] of Object.entries(FORMAT_WORDS)) {
    if (list.some((w) => n.includes(` ${w} `) || n.includes(` ${w}s `))) { out.format = fmt; break; }
  }

  // Author: "by C.S. Lewis", "written by Max Lucado", or a question that names a known author.
  const byMatch = n.match(/ (?:by|from|author) ([a-z0-9 .&-]{2,60})/);
  const authors = [...new Set(books.map((b) => b.author).filter(Boolean))];
  const normAuthors = authors.map((a) => ({ a, n: normalize(a) }));
  if (byMatch) {
    const phrase = byMatch[1].replace(/ (that|which|available|for|about|on|in).*$/, '').trim();
    const pw = phrase.split(' ').filter((w) => w.length > 1 && !STOP.has(w));
    const hit = normAuthors.find((x) => pw.length && pw.every((w) => x.n.split(' ').some((aw) => aw === w || (w.length > 4 && lev(w, aw, 1) <= 1))));
    if (hit) out.author = hit.a;
    else if (pw.length) out.authorGuess = phrase;
  }
  if (!out.author) {
    for (const x of normAuthors) {
      const parts = x.n.split(' ').filter((w) => w.length > 2);
      const last = parts[parts.length - 1];
      if (last && last.length > 2 && n.includes(` ${last} `) && (parts.length < 2 || parts.some((w) => w !== last && n.includes(` ${w} `)) || last.length > 5)) {
        out.author = x.a; break;
      }
    }
  }
  if (!out.author) {
    // A misspelled surname on its own, like "lewsi" or "lucato".
    const qWords = n.trim().split(' ').filter((w) => w.length > 4 && !STOP.has(w));
    const knownWords = new Set(books.flatMap((b) => words([b.title, b.subtitle, b.category, b.tags].filter(Boolean).join(' '))));
    for (const x of normAuthors) {
      const last = x.n.split(' ').filter((w) => w.length > 4).pop();
      const hit = last && qWords.find((w) => !knownWords.has(w) && lev(w, last, 1) <= 1);
      if (hit) { out.author = x.a; out.authorWord = hit; break; }
    }
  }

  // Category named directly ("devotionals", "church history").
  const cats = [...new Set(books.map((b) => b.category).filter(Boolean))];
  for (const c of cats.sort((a, b) => b.length - a.length)) {
    const cn = normalize(c);
    const cw = cn.split(' ').filter((w) => w.length > 2 && w !== 'and');
    if (n.includes(` ${cn} `) || (cw.length && cw.every((w) => n.includes(` ${w} `) || n.includes(` ${w}s `) || n.includes(` ${stem(w)} `)))) {
      out.category = c; break;
    }
  }
  return out;
}

function topicTerms(question, filters) {
  const skip = new Set();
  const addWords = (s) => words(s).forEach((w) => { skip.add(w); skip.add(stem(w)); });
  if (filters.author) addWords(filters.author);
  if (filters.authorGuess) addWords(filters.authorGuess);
  if (filters.authorWord) skip.add(filters.authorWord);
  if (filters.audience) AUDIENCE_WORDS[filters.audience].forEach((w) => skip.add(w));
  if (filters.format) FORMAT_WORDS[filters.format].forEach((p) => p.split(' ').forEach((w) => skip.add(w)));
  if (filters.availableOnly) ['available', 'stock', 'shelf', 'right', 'now', 'checked', 'borrow'].forEach((w) => skip.add(w));
  if (filters.category) words(filters.category).forEach((w) => { skip.add(w); skip.add(`${w}s`); skip.add(stem(w)); });
  return [...new Set(words(question).filter((w) => w.length > 1 && !STOP.has(w) && !skip.has(w) && !/^\d+$/.test(w)))];
}

function askOnce(question, books, settings, { ignoreAudience = false } = {}) {
  const q = String(question || '').trim().slice(0, 300);
  if (!q) return { answer: 'Ask about a topic, a title, an author, or how the library works.', books: [] };

  const active = books.filter((b) => b.active !== false);
  // A library number typed on its own ("6871", "DVD78") goes straight to that item.
  const code = q.replace(/^(library\s*(no\.?|number|#)\s*|#)/i, '').trim().toLowerCase();
  if (/^[a-z]{0,4}\d{1,6}$/i.test(code)) {
    const hit = active.filter((b) => b.call_number && String(b.call_number).toLowerCase() === code);
    if (hit.length) {
      const b = hit[0];
      return { answer: `Library number ${b.call_number} is “${b.title}”${b.author ? ` by ${b.author}` : ''}. It is ${b.available > 0 ? 'available now' : 'checked out right now'}.`, books: hit, kind: 'search', total: hit.length };
    }
  }
  const faq = faqAnswer(q, settings);
  const filters = detect(q, active, settings);
  const askedAudience = filters.audience;
  const terms = topicTerms(q, filters);
  if (ignoreAudience) filters.audience = null;
  const hasSearch = terms.length || filters.author || filters.category || filters.audience || filters.format;

  if (faq && !hasSearch) return { answer: faq, books: [], kind: 'faq' };
  if (faq) {
    // Drop the "how does the library work" words; if nothing is left, it was only a library question.
    const left = terms.filter((w) => !FAQ_WORDS.has(w) && !FAQ_WORDS.has(stem(w)));
    if (!left.length && !filters.author && !filters.category && !filters.audience && !filters.format) return { answer: faq, books: [], kind: 'faq' };
    terms.splice(0, terms.length, ...left);
  }

  let pool = active;
  if (filters.author) pool = pool.filter((b) => b.author === filters.author);
  if (filters.audience) pool = pool.filter((b) => !b.audience || b.audience === filters.audience || b.audience === 'Everyone' || normalize(b.category).includes(normalize(filters.audience)));
  if (filters.format) pool = pool.filter((b) => formatMatches(filters.format, b.format));

  const prepared = pool.map(prepareBook);
  let scored;
  let closeOnly = false; // true when only near-spellings matched
  if (terms.length) {
    const phrase = normalize(terms.join(' '));
    const pass = (fuzzy, need) => {
      const out = prepared.map((p) => {
        let total = 0;
        let matched = 0;
        for (const term of terms) {
          let s = scoreTerm(p, term, fuzzy);
          if (!s) {
            const syns = SYNONYMS[term] || SYNONYMS[stem(term)] || [];
            for (const syn of syns) { s = Math.max(s, scoreTerm(p, syn, false, true) * 0.75); } // related words count in titles, subjects and keywords
          }
          if (s) matched++;
          total += s;
        }
        if (phrase.length > 3 && p.titleNorm.includes(phrase)) total += 8;
        if (filters.category && p.b.category === filters.category) total += 4;
        return { p, score: matched >= need ? total : 0 };
      }).filter((x) => x.score > 0);
      // Keep only reasonably strong matches, so a stray word in a description doesn't crowd the list.
      const top = out.reduce((m, x) => Math.max(m, x.score), 0);
      return out.filter((x) => x.score >= 1.5 && x.score >= top * 0.3);
    };
    // Every word must match ("amish romance" means both), spelled exactly; then loosen step by step.
    const all = terms.length <= 3 ? terms.length : Math.ceil(terms.length * 0.6);
    scored = pass(false, all);
    if (!scored.length) { scored = pass(true, all); closeOnly = scored.length > 0; }
    if (!scored.length && all > 1) scored = pass(false, 1);
  } else {
    scored = prepared
      .filter((p) => !filters.category || p.b.category === filters.category)
      .map((p) => ({ p, score: 1 + (filters.audience && p.b.audience === filters.audience ? 1 : 0) }));
    // "Something for teens": prefer books marked for that group when there are any.
    if (filters.audience) {
      const exact = scored.filter((x) => x.score > 1 || normalize(x.p.b.category).includes(normalize(filters.audience).replace(/s$/, '')));
      if (exact.length) scored = exact;
    }
  }

  if (filters.category && terms.length) {
    // If they named a category, keep only that category when it has results.
    const inCat = scored.filter((x) => x.p.b.category === filters.category);
    if (inCat.length) scored = inCat;
  }

  const totalFound = scored.length;
  let list = scored;
  if (filters.availableOnly) list = list.filter((x) => x.p.b.available > 0);
  list.sort((a, b) => b.score - a.score || (b.p.b.available > 0) - (a.p.b.available > 0) || a.p.b.title.localeCompare(b.p.b.title));
  const results = list.slice(0, 8).map((x) => x.p.b);
  const availableCount = list.filter((x) => x.p.b.available > 0).length;

  // Compose a plain-language answer.
  const about = [];
  if (terms.length) about.push(`about ${terms.slice(0, 5).join(' ')}`);
  if (filters.category && !terms.length) about.push(`in ${filters.category}`);
  if (filters.author) about.push(`by ${filters.author}`);
  if (filters.audience) about.push(`for ${filters.audience.toLowerCase()}`);
  if (filters.format && filters.format !== filters.category) about.push(`in ${filters.format}`);
  const desc = [...new Set(about)].join(' ');
  const noun = ['DVD', 'CD'].includes(filters.format) ? 'item' : 'book';

  let answer;
  if (!list.length) {
    if (filters.availableOnly && totalFound) {
      answer = `We have ${totalFound} ${noun}${totalFound > 1 ? 's' : ''} ${desc}, but they are all checked out right now. Try again soon, or browse the catalog.`;
    } else if (filters.authorGuess && !filters.author) {
      answer = `I couldn't find anything by "${filters.authorGuess}" in our catalog. Check the spelling, or try a topic instead.`;
    } else {
      answer = `I couldn't find ${noun}s ${desc || `matching "${q}"`}. Try a broader word (like prayer, marriage or devotional), or browse by category.`;
    }
  } else if (closeOnly && !filters.author) {
    answer = `I couldn't find “${terms.join(' ')}” exactly. The closest match${list.length > 1 ? 'es are' : ' is'} below.`;
  } else {
    const count = list.length;
    answer = `I found ${count} ${noun}${count > 1 ? 's' : ''}${desc ? ' ' + desc : ''}`;
    if (filters.availableOnly) answer += ' that are available now.';
    else if (availableCount === count) answer += count > 1 ? ', and all are available now.' : ', and it is available now.';
    else if (availableCount === 0) answer += count > 1 ? '. All are checked out right now.' : '. It is checked out right now.';
    else answer += `; ${availableCount} ${availableCount > 1 ? 'are' : 'is'} available now.`;
    if (count > results.length) answer += ` Here are the best ${results.length}.`;
  }
  if (faq) answer = `${faq} ${answer}`;

  return { answer, books: results, kind: 'search', total: list.length, audience: askedAudience };
}

function ask(question, books, settings) {
  const r = askOnce(question, books, settings);
  if (r.kind === 'search' && !r.books.length && r.audience) {
    // Nothing marked for that age group: show the topic anyway and say so.
    const wider = askOnce(question, books, settings, { ignoreAudience: true });
    if (wider.books.length) {
      wider.answer = `Nothing on that topic is marked for ${r.audience.toLowerCase()} yet. ${wider.answer} Look ${wider.books.length > 1 ? 'them' : 'it'} over to see if ${wider.books.length > 1 ? 'they fit' : 'it fits'}.`;
      return wider;
    }
  }
  return r;
}

module.exports = { ask, normalize, stem, lev, faqAnswer };
