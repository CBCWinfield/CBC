'use strict';
// Everything the church website says, in one place, so it's easy to update.
// Taken from the church's previous Wix site (October 2026).

const CHURCH = {
  name: 'Central Baptist Church',
  street: '904 Wheat Rd.',
  cityLine: 'Winfield, KS 67156',
  phone: '(620) 221-2980',
  phoneHref: 'tel:+16202212980',
  email: process.env.SITE_EMAIL || 'info@cbcwinfield.com',
  maps: 'https://www.google.com/maps/search/?api=1&query=Central+Baptist+Church+904+Wheat+Rd+Winfield+KS+67156',
  youtube: 'https://www.youtube.com/@cbcwinfield',
  youtubeLive: 'https://www.youtube.com/@cbcwinfield/streams',
  facebook: 'https://www.facebook.com/cbcwinfield/',
  give: 'https://secure.myvanco.com/YGQD/home',
  site: process.env.SITE_URL || 'https://cbcwinfield.org',
  shop: 'https://cbc-shop.fourthwall.com/en-usd',
  app: process.env.APP_URL || 'https://admin.cbcwinfield.org',
  founded: 1951,
  // Bus ride requests go here (override with RIDE_EMAIL in Render).
  rideEmail: process.env.RIDE_EMAIL || 'info@cbcwinfield.com',
};

// Bus ministry pickup window (Wednesday nights).
const BUS = { day: 'Wednesday nights', pickup: 'around 5:30 PM', dropoff: 'around 7:45 PM' };

const TIMES = [
  { day: 'Sunday', time: '9:30 AM', what: 'Sunday School & Adult Study', note: 'Classes for every age, from nursery to adults.' },
  { day: 'Sunday', time: '10:45 AM', what: 'Worship', note: 'Children’s Church meets at the same time for kids.' },
  { day: 'Monday', time: '1:00 PM', what: 'Adult Bible Study', note: 'An afternoon study through Scripture together.' },
  { day: 'Wednesday', time: '6:00 PM', what: 'Wednesday Night: Meal, Fellowship & Bible Study', note: 'Supper and fellowship, then Bible study for adults. Central Teens and kids’ classes meet at the same time.' },
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
    times: ['Adult Study, Sundays at 9:30 AM', 'Adult Bible Study, Mondays at 1:00 PM', 'Meal, fellowship & Bible study, Wednesdays at 6:00 PM'],
    body: 'Deepen your faith and build meaningful connections within our Adult Ministry. We offer small groups, Bible studies, and fellowship for every season of life, including a Wednesday night meal and Bible study.',
  },
  {
    key: 'bus', name: 'Bus Ministry', ages: 'Bringing kids & students to church',
    times: ['Wednesday nights: pickup around 5:30 PM, drop-off around 7:45 PM (times depend on how far away you live)', 'Live in Cowley County? Let us know and we’ll see about a ride.', 'Want to drive or ride along? We’d love your help.'],
    body: 'For decades, our bus and van ministry has brought children and students to the Lord Jesus, literally and figuratively. Week after week, faithful drivers and helpers give their time so kids can ride to church, hear the gospel, worship, and learn God’s Word. God bless our bus ministry and everyone who serves in it.',
  },
];

// Missions & outreach on the Ministries page: what each partner does and how Central takes part, with the
// partner's logo (site/partner-logos.js, same keys) heading each paragraph and a link to their website.
const OUTREACH = [
  { key: 'kfl', name: 'Kansans for Life', what: 'Baby Bottle Project', when: 'Once a year, around Mother’s Day', url: 'https://kfl.org/baby-bottle-project/', site: 'kfl.org',
    body: 'Once a year we hand out empty baby bottles to anyone who will take one. Families take them home, fill them with spare change, cash, or a check, and bring them back to church. Every gift goes to the Kansans for Life Baby Bottle Project for their pro-life work across Kansas. It is a simple way for every one of us, young and old, to stand for the life of every child, because every life is a gift from God (Psalm 139:13–14).' },
  { key: 'casas', name: 'Casas Por Cristo', what: 'Mexico Mission Trip', when: 'Every November', url: 'https://casasporcristo.org/', site: 'casasporcristo.org',
    body: 'Every November a team from Central travels to Juárez, Mexico, with Casas Por Cristo to build a home for a family in need. In a few days of hard work, side by side, our team raises a small, sturdy house and hands the family the keys in Jesus’ name. It is the gospel lived out with hammers and hands, and the trip changes the people who go as much as the families who receive a home.' },
  { key: 'occ', name: 'Operation Christmas Child', what: 'Samaritan’s Purse', when: 'Every fall, during National Collection Week in November', url: 'https://www.samaritanspurse.org/what-we-do/operation-christmas-child/', site: 'samaritanspurse.org',
    body: 'Each fall our church packs shoebox gifts with Operation Christmas Child: toys, school supplies, and hygiene items, with a note and a prayer tucked inside. Samaritan’s Purse carries the boxes to children who need them most, in more than 170 countries, many in places where the gospel is hard to reach. Local churches give the boxes and share the good news of Jesus, and many of the children go on to The Greatest Journey, a 12-lesson course in following Christ.' },
  { key: 'namb', name: 'North American Mission Board', what: 'Missions across North America', when: 'All year, through our giving', url: 'https://www.namb.net/', site: 'namb.net',
    body: 'As a Southern Baptist church, Central gives together with churches across the country through the Cooperative Program. Part of that giving supports the North American Mission Board, which plants new churches and sends missionaries across the United States and Canada, and cares for people after disasters and in crisis through Send Relief. Each spring the Annie Armstrong Easter Offering goes straight to NAMB missionaries.' },
  { key: 'imb', name: 'International Mission Board', what: 'Missions among the nations', when: 'All year, through our giving', url: 'https://www.imb.org/', site: 'imb.org',
    body: 'The same giving helps send International Mission Board missionaries to the nations, especially to peoples who have never heard the name of Jesus. Every December the Lottie Moon Christmas Offering goes entirely to support missionaries on the field. When you give at Central, you have a part in the gospel reaching the ends of the earth (Acts 1:8).' },
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
  ['North American Mission Board (NAMB)', 'https://www.namb.net/'],
  ['International Mission Board (IMB)', 'https://www.imb.org/'],
  ['South Central Association of Southern Baptists', 'https://scasbks.com/'],
  ['Baptist Press', 'https://www.baptistpress.com/'],
];

// Our Southern Baptist family, with their logos, at the bottom of the Ministries page. Logos are copied
// from each organization's own website by site/partner-logos.js (same keys); `mark` shows until one arrives.
const FAMILY = [
  { key: 'scasb', level: 'Locally', name: 'South Central Association of Southern Baptists', mark: 'South Central Association', url: 'https://scasbks.com/',
    body: 'Close to home, we belong to the South Central Association: Southern Baptist churches and church plants across Butler, Cowley, Sumner, and Harper counties who pray, plant churches, and raise up leaders together.' },
  { key: 'churchforward', level: 'Kansas & Nebraska', name: 'Church Forward', mark: 'Church Forward', url: 'https://www.kncsb.org/',
    body: 'Across our two states, we cooperate through Church Forward, the Kansas-Nebraska Convention of Southern Baptists, helping churches start, grow, and reach their communities.' },
  { key: 'sbc', level: 'Nationally', name: 'Southern Baptist Convention', mark: 'SBC', url: 'https://www.sbc.net/',
    body: 'We are a cooperating church of the Southern Baptist Convention, a fellowship of tens of thousands of churches whose shared giving through the Cooperative Program sends missionaries across North America and around the world.' },
  { key: 'bp', level: 'News', name: 'Baptist Press', mark: 'Baptist Press', url: 'https://www.baptistpress.com/',
    body: 'The news service of the Southern Baptist Convention: stories of missions, churches, and Southern Baptist life from around the world.' },
];

const SERVE_AREAS = ['Nursery & Kids', 'Central Teens', 'Bus ministry (driving or riding along)', 'Worship & music', 'Sound, video & livestream', 'Greeting & hospitality', 'Building & grounds', 'Church library', 'Missions & outreach', 'Wherever I’m needed'];

module.exports = { BUS, CHURCH, TIMES, MINISTRIES, OUTREACH, STAFF, DEACONS, EVENTS, PARTNERS, FAMILY, SERVE_AREAS };
