'use strict';
// Agreements parents sign during onboarding. Each has a version; when the wording
// changes, bump the version so new signatures are tied to the exact text signed.
// IMPORTANT: have a Kansas attorney or the church's insurance carrier review this wording.

const CHURCH = 'Central Baptist Church, 904 Wheat Rd, Winfield, Kansas 67156';

const AGREEMENTS = {
  participation: {
    version: '2026-10-1',
    title: 'Participation, assumption of risk and release',
    required: true,
    text: `I am the parent or legal guardian of the child or children listed below, and I give permission for them to take part in Central Kids and Central Teens ministry activities of ${CHURCH} ("the Church"). These include classes, worship services, games, crafts, snacks, recreation, and on-site or off-site activities that I am told about in advance.

I understand that these activities, like any activity involving children, carry some risk of injury, illness or loss of property. I accept those risks for my child.

To the fullest extent permitted by Kansas law, I release and agree not to hold the Church, its pastors, staff and volunteers responsible for any injury, illness, loss or damage to my child or my child's property arising from participation, except where caused by gross negligence or willful misconduct.

I agree that my child will follow the instructions of ministry leaders. I understand the Church may contact me to pick up my child for behavior, illness or safety reasons, and that I or an authorized person must sign my child out using the pickup tag issued at check-in.

I confirm that the information I have given about my child, including health, allergy and custody information, is true and complete, and I will update it when it changes.`,
  },
  medical: {
    version: '2026-10-1',
    title: 'Medical treatment authorization',
    required: true,
    text: `If my child is injured or becomes ill during a Church activity and I cannot be reached right away, I authorize the Church's ministry leaders to obtain emergency medical care for my child, including first aid, calling 911 or emergency transport, and treatment by licensed medical professionals they believe is necessary.

I understand the Church will make every reasonable effort to contact me or my emergency contacts first. I agree to be responsible for the cost of any medical care my child receives.

This authorization stays in effect until I withdraw it in writing.`,
  },
  photo: {
    version: '2026-10-1',
    title: 'Photo and video release',
    required: false,
    text: `I give permission for photos or video of my child taken during Church activities to be used by the Church in its newsletters, slideshows, website and social media. The Church will not publish my child's full name or contact information with any photo.

If I decline, the Church will make reasonable efforts to keep my child out of published photos.`,
  },
  esign: {
    version: '2026-10-1',
    title: 'Consent to sign electronically',
    required: true,
    text: `I agree to sign these documents electronically. I understand that typing my full name and selecting "Sign agreements" has the same effect as a handwritten signature, that the Church will keep a record of what I signed and when, and that I can ask the Church for a paper copy at any time.`,
  },
};

module.exports = { AGREEMENTS, CHURCH };
