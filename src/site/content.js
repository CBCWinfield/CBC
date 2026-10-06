'use strict';
// Everything the church website says, in one place, so it's easy to update.
// Taken from the church's previous Wix site (October 2026).

const CHURCH = {
  name: 'Central Baptist Church',
  street: '904 Wheat Rd.',
  cityLine: 'Winfield, KS 67156',
  phone: '(620) 221-2980',
  phoneHref: 'tel:+16202212980',
  email: process.env.SITE_EMAIL || 'centralbaptistchurchcalendar@gmail.com',
  maps: 'https://www.google.com/maps/search/?api=1&query=Central+Baptist+Church+904+Wheat+Rd+Winfield+KS+67156',
  youtube: 'https://www.youtube.com/@cbcwinfield',
  youtubeLive: 'https://www.youtube.com/@cbcwinfield/streams',
  facebook: 'https://www.facebook.com/cbcwinfield/',
  give: 'https://secure.myvanco.com/YGQD/home',
  shop: 'https://cbc-shop.fourthwall.com/en-usd',
  app: process.env.APP_URL || 'https://admin.cbcwinfield.org',
  founded: 1951,
};

const TIMES = [
  { day: 'Sunday', time: '9:30 AM', what: 'Sunday School & Adult Study', note: 'Classes for every age, from nursery to adults.' },
  { day: 'Sunday', time: '10:45 AM', what: 'Worship', note: 'Children’s Church meets at the same time for kids.' },
  { day: 'Monday', time: '1:00 PM', what: 'Adult Bible Study', note: 'An afternoon study through Scripture together.' },
  { day: 'Wednesday', time: '6:00 PM', what: 'Wednesday Night', note: 'Central Teens for middle and high school students, and kids’ classes.' },
];

const MINISTRIES = [
  {
    key: 'kids', name: 'Kids', ages: 'Nursery through 5th grade',
    times: ['Sunday School, Sundays at 9:30 AM', 'Children’s Church, Sundays at 10:45 AM', 'Wednesday nights at 6:00 PM'],
    body: 'We believe kids are the heartbeat of the church. Our Kids Ministry provides a safe, fun, and nurturing environment where children learn about Jesus, grow in faith, and make friends.',
    safe: 'Every child is checked in with a printed name tag and a matching pickup code, and only the people you list can pick them up. Our teachers and volunteers complete child-safety training.',
  },
  {
    key: 'students', name: 'Central Teens', ages: 'Middle and high school',
    times: ['Wednesday nights at 6:00 PM', 'Sunday School, Sundays at 9:30 AM'],
    body: 'Central Teens is a dynamic space where middle and high school students can explore their identity in Christ, ask real questions, and build friendships that point them to Jesus.',
  },
  {
    key: 'adults', name: 'Adults', ages: 'Every season of life',
    times: ['Adult Study, Sundays at 9:30 AM', 'Adult Bible Study, Mondays at 1:00 PM'],
    body: 'Deepen your faith and build meaningful connections within our Adult Ministry. We offer small groups, Bible studies, and fellowship for every season of life.',
  },
];

const OUTREACH = [
  { name: 'Kansans For Life Baby Bottle Project', body: 'Each Mother’s Day we collect baby-bottle donations to support pro-life work across Kansas.', url: 'https://kfl.org/baby-bottle-project/' },
  { name: 'Mexico Mission Trip', body: 'Every November a team travels to Juárez with Casas Por Cristo to build a home for a family in need.', url: 'https://casasporcristo.org/' },
  { name: 'Operation Christmas Child', body: 'We pack shoeboxes with Samaritan’s Purse so children around the world hear the good news of Jesus.', url: 'https://www.samaritanspurse.org/' },
  { name: 'North American & International Missions', body: 'We support the work of Southern Baptist missionaries through NAMB and the IMB.', url: 'https://www.namb.net/', url2: 'https://www.imb.org/' },
];

// Staff photos: put a square photo at public/img/staff/<key>.jpg (e.g. orr.jpg) and it shows automatically.
const STAFF = [
  { key: 'orr', names: 'Blake & Ruth Orr', role: 'Senior Pastor', body: 'Pastor Blake faithfully leads our church in preaching, teaching, and shepherding, with Ruth serving alongside him. He is in his 17th year of ministry at Central.' },
  { key: 'norris', names: 'Micah & Ashley Norris', role: 'Worship Director', body: 'Micah and Ashley lead Christ-centered worship and teach in our children’s services.' },
  { key: 'ryker', names: 'Anthony & Lacy Ryker', role: 'Youth Pastor', body: 'Anthony and Lacy lead and disciple our students, helping them grow in their walk with Christ.' },
  { key: 'higdon', names: 'Daniel & Stacey Higdon', role: 'Deacon, Teen Leaders & Church IT', body: 'Daniel and Stacey lead Wednesday teen services. Daniel manages our technology, and Stacey leads Sunday worship.' },
  { key: 'smith', names: 'Ray & Carol Smith', role: 'Building & Grounds, Church Secretary, Librarian', body: 'Ray cares for our building, serves as a deacon, and has catalogued the 3,000+ books in our library. Carol keeps the church office running with day-to-day administration and communication.' },
  { key: 'caudill', names: 'Ray & Kitty Caudill', role: 'Treasurer & Controller', body: 'Ray and Kitty oversee church finances and accounting with careful stewardship.' },
  { key: 'sodowsky', names: 'Diana Sodowsky', role: 'Sanitation Director', body: 'Diana keeps our facility clean and welcoming for every family who walks through the doors.' },
];
const DEACONS = ['Randy Norris', 'Ray Smith', 'Micah Norris', 'Daniel Higdon'];

// Upcoming events. Past events hide themselves automatically.
const EVENTS = [
  {
    key: '75th', title: '75th Anniversary of God’s Faithfulness', date: '2026-10-18', start: '10:00 AM', end: '4:00 PM',
    where: '904 Wheat Rd, Winfield', body: 'There will be fun for the kids, adults, and everyone. Come join us for a day of fellowship and fun as we celebrate 75 years of God’s faithfulness to Central.',
    short: '10:00 AM to 4:00 PM at the church. Worship, a meal, and fun for kids, adults, and everyone in between.',
    kicker: '1951 — 2026 · You’re invited', titleA: '75th Anniversary of', titleB: 'God’s faithfulness', startHm: [10, 0], endHm: [16, 0],
  },
];

const PARTNERS = [
  ['Church Forward (Kansas-Nebraska Convention of Southern Baptists)', 'https://www.kncsb.org/'],
  ['Southern Baptist Convention', 'https://www.sbc.net/'],
  ['South Central Association of Southern Baptists', 'https://scasbks.com/'],
  ['Baptist Press', 'https://www.baptistpress.com/'],
];

// Central Gear (Fourthwall shop), as featured on the homepage design.
const SHOP = [
  { name: 'Black Hoodie', sub: 'White drawstring · Central Baptist', price: '$34.06', img: 'hoodie.webp', slug: 'black-hoodie-white-string-central-baptist-church', feature: true },
  { name: 'Black T-Shirt', sub: 'Central Teens', price: '$14.75', img: 'tee-teens.webp', slug: 'black-t-shirt-central-teens', mult: true },
  { name: 'Black T-Shirt', sub: 'Central Kids', price: '$14.75', img: 'tee-kids.webp', slug: 'black-t-shirt-central-kids', mult: true },
  { name: 'Black T-Shirt', sub: 'Central Baptist Church', price: '$14.75', img: 'tee-central.webp', slug: 'black-t-shirt-central-baptist-church' },
  { name: 'Adidas Polo', sub: 'Central Baptist Church', price: '$43.80', img: 'polo.webp', slug: 'polo-shirt-adidas-central-baptist-church' },
  { name: 'Baby Outfit', sub: 'Central Kids', price: '$16.52', img: 'baby.webp', slug: 'central-kids-baby-outfit', mult: true },
  { name: 'Under Armour Hat', sub: 'Central Baptist Church', price: '$28.99', img: 'hat-front.webp', back: 'hat-back.webp', slug: 'underarmour-hat' },
];

const SERVE_AREAS = ['Nursery & Kids', 'Central Teens', 'Worship & music', 'Sound, video & livestream', 'Greeting & hospitality', 'Building & grounds', 'Church library', 'Missions & outreach', 'Wherever I’m needed'];

module.exports = { CHURCH, TIMES, MINISTRIES, OUTREACH, STAFF, DEACONS, EVENTS, PARTNERS, SHOP, SERVE_AREAS };
