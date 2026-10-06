'use strict';
// Central's Privacy Policy and Terms of Service. A short privacy summary is shown when someone
// applies for a membership account and on the family sign-up link; the full texts live at
// /privacy and /terms.
const { html } = require('./html');

const CHURCH = { name: 'Central Baptist Church', address: '904 Wheat Rd, Winfield, KS 67156', phone: '(620) 221-2980', email: 'centralbaptistchurchcalendar@gmail.com' };
const UPDATED = 'October 6, 2026';

const SUMMARY = [
  'We use your information only to run the library, check children in and out safely, care for you in prayer, and keep you informed about church life.',
  'Children’s allergies, medical notes, custody notes and photos are seen only by approved check-in staff and leaders.',
  'We never sell, rent or trade your information. You can update it, change your privacy settings, or ask us to delete your account anytime.',
];

const SECTIONS = [
  ['What we collect', [
    'Your name, email, phone number and address.',
    'If you set up family check-in: your children’s names, birthdates, grades, allergies and medical notes, the people allowed to pick them up, any custody notes, emergency contacts, and photos you choose to add.',
    'Library activity: the books you reserve, borrow and return.',
    'What you post: prayer requests, encouragements, and messages to other members or the church team.',
  ]],
  ['Why we use it', [
    'To give you a library card number and manage your borrowing.',
    'To check children in and out safely, print name tags, and reach you quickly if your child needs you.',
    'To pray for you and let you share requests with your church family.',
    'To send the notices and reminders you choose, and occasional church greetings. You control these in Settings.',
  ]],
  ['Who can see it', [
    'Church staff and approved volunteers see only what they need for their role. Children’s allergies, medical, custody and photo information is shown only to check-in staff and leaders.',
    'Other members see only what you choose in your Privacy settings, such as whether you appear in the directory and whether your phone or email is shown.',
    'Prayer requests are visible to signed-in members, or only to the pastors and church team if you choose that when you post. You can also post anonymously.',
    'We don’t sell, rent or trade your information, and we don’t share it outside the church, except when the law requires it or to protect a child’s safety (for example, Kansas mandatory reporting).',
  ]],
  ['Children', [
    'Accounts are for adults 18 and older. A parent or guardian adds a child’s information and can change or remove it anytime.',
    'We collect children’s information only to keep them safe and cared for during church activities.',
  ]],
  ['Your choices', [
    'Update your details, family and children anytime from your account.',
    'Change who can see you and which notices you get in Settings.',
    'Ask us to correct or delete your information by contacting the church office. Some records, like check-in history and incident reports, may be kept as long as needed for child safety.',
  ]],
  ['Keeping it safe', [
    'Passwords are stored encrypted, and the site uses a secure connection. Access to sensitive information is limited by role and recorded.',
    'No system is perfect, so please don’t post anything you wouldn’t want your church family to see.',
  ]],
];

const contact = () => html`<p>Questions? Contact <strong>${CHURCH.name}</strong>, ${CHURCH.address} · <a href="tel:+16202212980">${CHURCH.phone}</a> · <a href="mailto:${CHURCH.email}">${CHURCH.email}</a>.</p>`;

// Short version with a "read the full notice" toggle, for sign-up forms.
function notice() {
  return html`<div class="privacy-box">
    <p class="privacy-title"><span aria-hidden="true">🔒</span> Your privacy</p>
    <ul>${SUMMARY.map((s) => html`<li>${s}</li>`)}</ul>
    <details><summary>Read the full Privacy Policy</summary>
      <div class="privacy-full">${SECTIONS.map(([h, items]) => html`<h3>${h}</h3><ul>${items.map((i) => html`<li>${i}</li>`)}</ul>`)}${contact()}</div>
    </details>
  </div>`;
}

function page() {
  return html`<div class="narrow privacy-page">
    <div class="page-head"><h1>Privacy Policy</h1><p class="muted">${CHURCH.name} · Last updated ${UPDATED} · See also our <a href="/terms">Terms of Service</a></p></div>
    <p class="lead">${SUMMARY.join(' ')}</p>
    ${SECTIONS.map(([h, items]) => html`<h2>${h}</h2><ul>${items.map((i) => html`<li>${i}</li>`)}</ul>`)}
    <h2>Contact us</h2>${contact()}
  </div>`;
}

const TERMS = [
  ['Agreeing to these terms', [
    'These terms apply to Central Baptist Church’s online services: the church library, the Prayer Wall, family check-in, messages and the Central app (together, “the services”). By creating an account or using the services, you agree to these terms and to our Privacy Policy.',
  ]],
  ['Your account', [
    'Accounts are for adults 18 and older. Children are added to a family by a parent or guardian.',
    'Give accurate information and keep it up to date. Each account is for one person; please don’t share your password.',
    'Accounts are reviewed and approved by the librarian or a church admin, at the church’s discretion. The church may pause or close an account that breaks these terms or puts others at risk.',
  ]],
  ['The church library', [
    'Library membership and borrowing are free. Please return items by their due date and treat them with care.',
    'If an item is lost or badly damaged, the librarian may ask you to replace it. Borrowing may be paused for overdue items.',
  ]],
  ['Prayer Wall and messages', [
    'Be kind, truthful and respectful. These spaces are for encouragement, prayer and church life.',
    'Don’t post another person’s private details (health, family matters, contact information) without their permission.',
    'Don’t harass, threaten, or bully anyone; don’t post anything sexual, hateful, or illegal; and don’t use the services to sell, advertise, or solicit.',
    'Adults should not privately message children through the services. Communication with minors should follow the church’s child-protection policies.',
    'Church admins may hide or remove content and pause accounts to protect the community. You can report a message or block someone from your Inbox.',
  ]],
  ['Children and check-in', [
    'Check-in exists to keep children safe. Children are released only to the people listed on their family’s pickup list who present the matching pickup tag, and staff may refuse release when they have a safety concern.',
    'Keep your children’s allergies, medical notes and pickup people current. Church staff follow the church’s child-protection policies, including incident reporting and Kansas mandatory-reporting law.',
  ]],
  ['What you post', [
    'You keep ownership of what you post. You give the church permission to show it within the services to the people you choose (for example, signed-in members or only the church team), and to keep the records needed for child safety.',
    'Only upload photos you have the right to share. Photos of children are visible only to check-in staff.',
  ]],
  ['Notices', [
    'We may send account, library, check-in and safety notices by email or app notification. You can choose which optional notices you get in Settings.',
  ]],
  ['The services are provided as they are', [
    'We work hard to keep the services running and accurate, but they are provided “as is” by a volunteer-supported church, without warranties of any kind. To the fullest extent allowed by law, Central Baptist Church is not liable for indirect or incidental damages from using the services.',
  ]],
  ['Changes', [
    'We may update these terms or the Privacy Policy from time to time. We’ll post the new date here, and for important changes we’ll let members know. Continuing to use the services means you accept the updated terms.',
  ]],
  ['Governing law', [
    'These terms are governed by the laws of the State of Kansas.',
  ]],
];

function termsPage() {
  return html`<div class="narrow privacy-page">
    <div class="page-head"><h1>Terms of Service</h1><p class="muted">${CHURCH.name} · Last updated ${UPDATED} · See also our <a href="/privacy">Privacy Policy</a></p></div>
    ${TERMS.map(([h, items]) => html`<h2>${h}</h2><ul>${items.map((i) => html`<li>${i}</li>`)}</ul>`)}
    <h2>Contact us</h2>${contact()}
  </div>`;
}

// "Privacy Policy · Terms of Service" links for footers.
const links = () => html`<a href="/privacy">Privacy Policy</a> · <a href="/terms">Terms of Service</a>`;

module.exports = { notice, page, termsPage, links, SUMMARY, SECTIONS, TERMS, UPDATED };
