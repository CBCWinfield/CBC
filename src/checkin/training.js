'use strict';
// Required training for the check-in team. Each module is short, drawn from
// public, reputable sources (cited at the bottom of each page), and ends with
// commitments the person must tick. Videos are ERLC (Southern Baptist Ethics &
// Religious Liberty Commission) "Caring Well" talks on Vimeo.
//
// Changing a module's `version` makes everyone take that module again.

const SRC = {
  cwig: { title: 'Child Welfare Information Gateway (U.S. Dept. of Health & Human Services): What Is Child Abuse and Neglect? Recognizing the Signs and Symptoms', url: 'https://www.childwelfare.gov/resources/what-child-abuse-and-neglect-recognizing-signs-and-symptoms/' },
  hhs: { title: 'HHS: What is child abuse? (federal CAPTA definition)', url: 'https://www.hhs.gov/answers/programs-for-families-and-children/what-is-child-abuse/index.html' },
  d2l: { title: 'Darkness to Light: The 5 Steps to Protecting Children', url: 'https://www.d2l.org/fall5steps/' },
  cdc: { title: 'CDC: Preventing Child Sexual Abuse Within Youth-serving Organizations: Getting Started on Policies and Procedures (2007)', url: 'https://stacks.cdc.gov/view/cdc/7538' },
  sbc: { title: 'SBC Abuse Prevention: free Essentials training and resources for Southern Baptist churches', url: 'https://sbcabuseprevention.com/' },
  caring: { title: 'ERLC Caring Well conference videos', url: 'https://bradhambrick.com/caringwell/' },
  cfc: { title: 'Committee for Children: Responding to Disclosure (Early, Open, Often)', url: 'https://www.earlyopenoften.org/be-ready-to-respond/responding-to-disclosure/' },
  ksdcf: { title: 'Kansas DCF: Report Child Abuse and Neglect (Kansas Protection Report Center)', url: 'https://www.dcf.ks.gov/services/PPS/pages/reportchildabuseandneglect.aspx' },
  kslaw: { title: 'Child Welfare Information Gateway: Kansas reporting law summary (K.S.A. 38-2223)', url: 'https://www.childwelfare.gov/resources/clergy-mandatory-reporters-child-abuse-and-neglect-kansas/' },
  rainn: { title: 'RAINN: How to talk with survivors of sexual violence', url: 'https://rainn.org/show-up-speak-out-step-in/how-to-talk-with-survivors-of-sexual-violence/' },
};

const MODULES = [
  {
    key: 'recognize', version: '2026-10', minutes: 10,
    title: 'Recognizing abuse and neglect',
    intro: 'You see the same children week after week, so you may notice changes others miss. This lesson covers the four kinds of child maltreatment and the warning signs to watch for.',
    sections: [
      { h: 'What counts as abuse', p: ['Federal law (the Child Abuse Prevention and Treatment Act) defines child abuse and neglect as any recent act, or failure to act, by a parent or caretaker that results in death, serious physical or emotional harm, sexual abuse or exploitation, or that presents an imminent risk of serious harm.'],
        list: ['<strong>Physical abuse:</strong> hitting, shaking, burning, kicking, or any other physical injury that isn’t an accident.', '<strong>Neglect:</strong> failing to provide food, clothing, shelter, medical care, supervision or schooling.', '<strong>Sexual abuse:</strong> any sexual activity with a child, including touching, exposure, pornography and exploitation, by an adult or by an older or more powerful child.', '<strong>Emotional abuse:</strong> a pattern of belittling, threatening, rejecting or terrorizing a child.'] },
      { h: 'Signs you might see in a child', list: ['Sudden changes in behavior, mood or school performance', 'Always watchful, as if waiting for something bad to happen', 'Arrives early, stays late, and doesn’t want to go home', 'Unexplained bruises, burns, bites or broken bones, or injuries that don’t match the explanation', 'Flinches when an adult comes near, or seems afraid of a parent or caregiver', 'Often hungry, unwashed, or without weather-appropriate clothing; medical needs left untreated', 'Trouble walking or sitting, nightmares or bed-wetting, or sexual knowledge or behavior unusual for their age', 'Extreme behavior (very demanding or very passive), acting much older or much younger than their age', 'Says they’re being hurt, or hints at it ("I have a secret," "I don’t like going to Uncle’s house")'] },
      { h: 'Signs you might see in an adult', list: ['Shows little concern for the child, or blames the child for problems', 'Describes the child as bad, worthless or a burden', 'Gives explanations for injuries that don’t make sense, or no explanation', 'Demands a level of performance the child can’t reach', 'Seems unusually controlling of who the child talks to', 'Wants a lot of time alone with one particular child (see the next lesson on grooming)'] },
      { h: 'What to remember', p: ['One sign alone doesn’t prove abuse, but patterns matter. You don’t need proof and you don’t need to investigate. If something worries you, write down what you saw and follow the steps in “Responding and reporting.”'] },
    ],
    video: { id: '365105474', title: 'Overturning Myths Related to Sexual Abuse and the Church (J.D. Greear, ERLC Caring Well)', minutes: 27 },
    sources: ['hhs', 'cwig', 'd2l'],
    confirm: ['I understand the four kinds of abuse and neglect and their common warning signs.', 'I understand I don’t need proof. A reason to suspect is enough to speak up.', 'I watched the video (or read this lesson in full if I couldn’t play it).'],
  },
  {
    key: 'prevent', version: '2026-10', minutes: 15,
    title: 'Preventing sexual abuse and recognizing grooming',
    intro: 'Most abuse is committed by someone the child and family know and trust. Prevention depends on everyone following the same simple rules, every time, with everyone.',
    sections: [
      { h: 'Learn the facts', list: ['About 90% of children who are sexually abused know their abuser (Darkness to Light).', 'People who abuse are often friendly, helpful and well liked. They may volunteer eagerly. Being a “nice person” or a long-time member is not a safeguard.', 'Children can be abused by older or more powerful children too, so supervision matters in every room, including between kids.', 'Only a small share of abuse reports turn out to be false (Darkness to Light cites 4–8%).'] },
      { h: 'How grooming works', p: ['Grooming is the slow process of gaining a child’s trust (and often the family’s) to create chances to abuse and keep the child silent. Common stages:'],
        list: ['<strong>Targeting:</strong> picking a child who seems lonely, needy or less supervised.', '<strong>Gaining trust:</strong> becoming the family’s helper; offering rides, babysitting, extra attention.', '<strong>Filling a need:</strong> gifts, special privileges, being the one adult who “understands” them.', '<strong>Isolating:</strong> finding reasons to be alone: a private talk, a ride home, a side room, private messages.', '<strong>Testing boundaries:</strong> tickling, wrestling, lap-sitting, off-color jokes, “accidental” touching, watching the child react.', '<strong>Secrecy and control:</strong> “This is our secret,” guilt, threats, or making the child feel responsible.'] },
      { h: 'Warning signs in an adult or teen leader', list: ['Seeks time alone with a child, or singles one child out as “special”', 'Gives gifts or money to one child, or contacts a child privately by text, social media or games', 'Ignores or pushes against rules (two-adult rule, doors open, no rides alone)', 'Plays rough, tickles or touches more than other leaders do; jokes about sexual topics', 'Shows more interest in the children than in the adults or the ministry itself'] },
      { h: 'Minimize opportunity', p: ['The CDC’s guidance for youth-serving organizations rests on six pieces: screening staff, rules for how adults and children interact, monitoring behavior, safe spaces, responding to concerns, and training. For you, that means:'],
        list: ['<strong>Two adults, always.</strong> Never be alone with a child out of sight of another adult. If you end up alone, move to an open, visible place right away.', '<strong>Visible and interruptible.</strong> Doors open or windows uncovered; any leader may walk in at any time.', '<strong>No private contact.</strong> No one-on-one texting, messaging or social media with minors; include a parent or another leader.', '<strong>Speak up about policy breaks,</strong> even small ones and even by people you trust. Rules only protect when they’re enforced.'] },
    ],
    video: { id: '364918155', title: 'Facts vs. Myths: Understanding Who Child Sexual Abusers Actually Are (Gregory Love, ERLC Caring Well)', minutes: 19 },
    sources: ['d2l', 'cdc', 'sbc', 'caring'],
    confirm: ['I will follow the two-adult rule and never be alone with a child out of sight of another adult.', 'I can recognize grooming, and I will report grooming behavior or policy breaks by anyone, including people I know and like.', 'I will not contact minors privately by text, social media or games.', 'I watched the video (or read this lesson in full if I couldn’t play it).'],
  },
  {
    key: 'respond', version: '2026-10', minutes: 12,
    title: 'Responding to a disclosure and reporting (Kansas)',
    intro: 'If a child tells you about abuse, how you react matters, both for the child and for any investigation. Here is what to do, step by step.',
    sections: [
      { h: 'If a child tells you', list: ['<strong>Stay calm.</strong> Your face and voice tell the child whether it was safe to tell you.', '<strong>Listen and believe.</strong> Let them use their own words. Short, open prompts only: “Tell me more.” “What happened next?”', '<strong>Reassure:</strong> “You did the right thing. I’m glad you told me.” “This is not your fault.”', '<strong>Don’t promise secrecy.</strong> Say: “I can’t keep this a secret, but I’ll only tell people whose job is to help keep you safe.”', '<strong>Don’t investigate.</strong> No leading questions (“Did he touch you here?”), no pressing for details, no examining injuries, and never confront the person accused.', '<strong>Write it down</strong> as soon as you can: the child’s exact words, the date and time, who was present, and what you saw.'] },
      { h: 'Report it', list: ['<strong>A child in immediate danger: call 911.</strong>', '<strong>Kansas Protection Report Center: 1-800-922-5330</strong>, answered 24 hours a day, 7 days a week (Kansas Department for Children and Families). Reports can also be made online through DCF.', 'Kansas law allows any person who has reason to suspect abuse or neglect to report, and requires it of many professions (K.S.A. 38-2223). You don’t need proof, and reports made in good faith are protected.', 'Then tell the children’s ministry director or a pastor, and file an <a href="/checkin/incidents/new">incident report</a> in this app. Telling church leaders never replaces a report to the authorities, and no one at church may tell you not to report.'] },
      { h: 'Sexual assault of a teen or adult', p: ['If a teenager or adult tells you they were sexually assaulted, believe them and let them lead. RAINN suggests saying “I believe you,” “It wasn’t your fault,” and “You’re not alone. I’m here to help.” The National Sexual Assault Hotline is 1-800-656-4673 (RAINN), 24/7. If the person is under 18, follow the reporting steps above.'] },
      { h: 'Afterward', p: ['Keep what you know private. Share it only with the people handling it. Don’t discuss it with other volunteers, parents or on social media, and don’t warn the person accused. Taking care of yourself matters too: talk with a pastor if it weighs on you.'] },
    ],
    video: { id: '365039843', title: 'Walking with the Broken: Caring Well for Friends and Family who Have Experienced Abuse (Jamie Ivey, ERLC Caring Well)', minutes: 13 },
    sources: ['cfc', 'ksdcf', 'kslaw', 'rainn', 'caring'],
    confirm: ['If a child tells me about abuse, I will stay calm, listen, and not promise to keep it a secret or investigate on my own.', 'I know how to report in Kansas: 911 for immediate danger, and the Kansas Protection Report Center at 1-800-922-5330.', 'I will tell church leadership and file an incident report, and I understand that never replaces a report to the authorities.', 'I watched the video (or read this lesson in full if I couldn’t play it).'],
  },
  {
    key: 'conduct', version: '2026-10', minutes: 8,
    title: 'Proper conduct and boundaries',
    intro: 'Clear boundaries protect children, protect you from misunderstanding, and help families trust Central. These are the everyday expectations for anyone serving with kids or teens.',
    sections: [
      { h: 'Touch', p: ['Healthy touch is brief, public and for the child’s benefit.'],
        list: ['<strong>Appropriate:</strong> high fives, fist bumps, side hugs, a pat on the shoulder or back, holding a young child’s hand while walking, comforting a crying preschooler while sitting beside them in view of others.', '<strong>Not appropriate:</strong> full-front or lingering hugs, kissing, tickling, wrestling, older children on your lap, massages, or touching any area a swimsuit covers (except diapering, below).', 'If a child initiates touch that isn’t appropriate, gently redirect: “Let’s do a high five instead!”'] },
      { h: 'Restrooms and diapers', list: ['Diaper and pull-up changes happen in the designated area, in view of another adult.', 'Preschoolers who need help: leave the stall door partly open and keep another adult aware. Older children go in pairs or groups, with the leader waiting outside the restroom door.', 'Never be alone in a restroom with a child.'] },
      { h: 'Supervision, rides and pickup', list: ['Two adults in every room; classrooms open or visible.', 'Release children only to the adult whose pickup tag matches (or an approved pickup the app shows). If in doubt, get a leader. Never release to someone the app flags “not allowed.”', 'No driving a child alone. Transport needs parent permission and two adults.'] },
      { h: 'Communication, photos and gifts', list: ['No private messaging or social-media friending with minors; copy a parent or another leader.', 'Post or share photos only of children whose parents gave photo permission (it’s recorded in this app), and never with names or locations.', 'No gifts to individual children; give to the whole class.'] },
      { h: 'Discipline and your own example', list: ['Never use physical discipline, isolation or humiliation. Redirect, give a calm choice, and bring a leader or parent if needed.', 'No harsh language, sarcasm about a child, sexual jokes, favoritism, tobacco, vaping or alcohol while serving.', 'Follow Central’s written policies (see Policies). When the policy and your instinct differ, follow the policy and ask a leader.'] },
    ],
    sources: ['cdc', 'sbc', 'd2l'],
    confirm: ['I will keep touch brief, public and appropriate, and redirect inappropriate touch.', 'I will follow the restroom, diapering, supervision and pickup rules.', 'I will not message minors privately, give individual gifts, or share photos of children without permission.'],
  },
  {
    key: 'words', version: '2026-10', minutes: 6,
    title: 'What to say, and what not to say',
    intro: 'Words build trust. They can also confuse a child, shame them, or quietly teach secrecy. Here are simple phrases to use, and ones to avoid.',
    sections: [
      { h: 'Every day', list: ['<strong>Say:</strong> the child’s name; “I’m glad you’re here.” “Thanks for helping.” “Let’s try that again.”', '<strong>Say:</strong> “We don’t keep secrets from parents here. Surprises (like a birthday present) are okay because everyone finds out.”', '<strong>Avoid:</strong> pet names like “babe” or “sexy,” comments about a child’s body or looks, and “let’s keep this between us.”', '<strong>Avoid:</strong> shaming or sarcasm (“What’s wrong with you?”), threats, and comparing children.'] },
      { h: 'When a child is upset or acting out', list: ['Get low, speak calmly, keep it short: “You’re safe. Let’s take a breath.” “You can choose to sit here or at the table.”', 'Name the behavior, not the child: “Hitting hurts” rather than “You’re a bad boy.”', 'Bring in a leader early instead of escalating.'] },
      { h: 'When a child or teen tells you something hard', list: ['<strong>Say:</strong> “I believe you.” “Thank you for telling me.” “It’s not your fault.” “I’m going to get help.”', '<strong>Don’t say:</strong> “Are you sure?” “Why didn’t you tell sooner?” “He would never do that.” “Don’t tell anyone else.”', '<strong>Don’t ask:</strong> leading questions or for graphic details. Leave that to trained investigators.'] },
      { h: 'With parents and other volunteers', list: ['Share incidents with parents factually and kindly (what happened, what you did); file an incident report for injuries, behavior issues and concerns.', 'Keep children’s information private: allergies, medical needs, custody notes and family situations are for serving the child, not for conversation.', 'Don’t discuss allegations or investigations with other volunteers, parents or online. Send questions to the ministry director.'] },
    ],
    sources: ['rainn', 'cfc', 'd2l'],
    confirm: ['I will use encouraging, respectful words and avoid pet names, comments about bodies, shaming and secrets.', 'I know what to say, and what not to say, when a child or teen tells me something hard.', 'I will keep children’s and families’ information private.'],
  },
];

const MODULE = Object.fromEntries(MODULES.map((m) => [m.key, m]));

module.exports = { MODULES, MODULE, SRC };
