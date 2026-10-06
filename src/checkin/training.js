'use strict';
// Required training for the check-in team: practical, factual lessons about
// working with children and teens, drawn from recognized child-protection and
// medical organizations. Every video was checked to be the publisher's own and
// embeddable; sources are cited at the bottom of each lesson.
//
// Changing a module's `version` makes everyone take that lesson again.

const SRC = {
  cwig: { title: 'Child Welfare Information Gateway (U.S. Dept. of Health & Human Services): What Is Child Abuse and Neglect? Recognizing the Signs and Symptoms', url: 'https://www.childwelfare.gov/resources/what-child-abuse-and-neglect-recognizing-signs-and-symptoms/' },
  hhs: { title: 'HHS: What is child abuse? (federal CAPTA definition)', url: 'https://www.hhs.gov/answers/programs-for-families-and-children/what-is-child-abuse/index.html' },
  stopitnow: { title: 'Stop It Now: Warning Signs of Possible Sexual Abuse in a Child’s Behaviors', url: 'https://www.stopitnow.org/ohc-content/tip-sheet-warning-signs-of-possible-sexual-abuse-in-a-childs-behaviors' },
  stopitnow2: { title: 'Stop It Now: Warning signs (adults and children at risk of harming a child)', url: 'https://www.stopitnow.org/ohc-content/warning-signs' },
  d2l: { title: 'Darkness to Light: The 5 Steps to Protecting Children', url: 'https://www.d2l.org/fall5steps/' },
  d2lflags: { title: 'Darkness to Light: Red Flags and Grooming Behaviors', url: 'https://www.d2l.org/safety-in-seconds/red-flags-and-grooming-behavior/' },
  nspccGroom: { title: 'NSPCC Learning: Grooming, recognising the signs', url: 'https://learning.nspcc.org.uk/safeguarding-child-protection/grooming' },
  nspccListen: { title: 'NSPCC Learning: Let children know you’re listening', url: 'https://learning.nspcc.org.uk/research-resources/2019/let-children-know-you-re-listening' },
  cdc: { title: 'CDC: Preventing Child Sexual Abuse Within Youth-serving Organizations: Getting Started on Policies and Procedures (2007)', url: 'https://stacks.cdc.gov/view/cdc/7538' },
  sbc: { title: 'SBC Abuse Prevention: free Essentials training for Southern Baptist churches', url: 'https://sbcabuseprevention.com/' },
  cfc: { title: 'Committee for Children: Responding to Disclosure', url: 'https://www.earlyopenoften.org/be-ready-to-respond/responding-to-disclosure/' },
  ksdcf: { title: 'Kansas DCF: Report Child Abuse and Neglect (Kansas Protection Report Center)', url: 'https://www.dcf.ks.gov/services/PPS/pages/reportchildabuseandneglect.aspx' },
  kslaw: { title: 'Child Welfare Information Gateway: Kansas reporting law summary (K.S.A. 38-2223)', url: 'https://www.childwelfare.gov/resources/clergy-mandatory-reporters-child-abuse-and-neglect-kansas/' },
  rainn: { title: 'RAINN: How to talk with survivors of sexual violence', url: 'https://rainn.org/show-up-speak-out-step-in/how-to-talk-with-survivors-of-sexual-violence/' },
  ncmec: { title: 'National Center for Missing & Exploited Children: Online Enticement', url: 'https://www.missingkids.org/theissues/onlineenticement' },
  netsmartz: { title: 'NCMEC NetSmartz videos and discussion guides', url: 'https://www.ncmec.org/netsmartz/videos' },
  fbi: { title: 'FBI: Financially Motivated Sextortion', url: 'https://www.fbi.gov/how-we-can-help-you/common-frauds-and-scams/sextortion/financially-motivated-sextortion' },
  redcrossKids: { title: 'American Red Cross: How to Perform Child and Baby CPR', url: 'https://www.redcross.org/take-a-class/cpr/performing-cpr/child-baby-cpr' },
  redcrossHands: { title: 'American Red Cross: Hands-Only CPR', url: 'https://www.redcross.org/get-help/how-to-prepare-for-emergencies/hands-only-cpr.html' },
  ahaHands: { title: 'American Heart Association: Hands-Only CPR', url: 'https://cpr.heart.org/en/cpr-courses-and-kits/hands-only-cpr' },
  ahaInfant: { title: 'American Heart Association: Infant CPR', url: 'https://cpr.heart.org/en/training-programs/community-programs/community-resources/infant-cpr' },
};

// Where to get certified (shown on the CPR lesson).
const CERTIFICATION = [
  { title: 'American Red Cross: CPR classes near Winfield (in person, blended or online)', url: 'https://www.redcross.org/take-a-class/cpr', note: 'For childcare volunteers, choose “Adult and Pediatric First Aid/CPR/AED.” Blended or classroom courses include the hands-on skills check most certifications require.' },
  { title: 'American Red Cross: Adult and Pediatric First Aid/CPR/AED (blended learning)', url: 'https://www.redcross.org/take-a-class/classes/adult-and-pediatric-first-aid%2Fcpr%2Faed-bl-r.25/LP-00249500.html', note: 'Online lessons plus a short in-person skills session. Two-year certification.' },
  { title: 'American Heart Association: CPR and First Aid courses', url: 'https://cpr.heart.org/en/', note: 'AHA Heartsaver Pediatric First Aid CPR AED is widely accepted for childcare. Use “Find a Course” for classes near you.' },
  { title: 'American Heart Association: Family & Friends CPR', url: 'https://cpr.heart.org/en/courses/family-and-friends-cpr', note: 'A low-cost, non-certification course that teaches adult, child and infant CPR and choking relief.' },
];

const MODULES = [
  {
    key: 'recognize', version: '2026-10b', minutes: 20,
    title: 'Recognizing abuse: what to watch for and listen for',
    intro: 'Children rarely say “I’m being abused.” They show it in their behavior and hint at it in what they say. You see the same kids every week, so you may be the adult who notices. This lesson is about exactly what to look and listen for.',
    sections: [
      { h: 'The four kinds of abuse', list: ['<strong>Physical abuse:</strong> non-accidental injury: hitting, shaking, burning, kicking, biting.', '<strong>Neglect:</strong> failure to provide food, clothing, hygiene, medical care, supervision or safety. It is the most common form of maltreatment.', '<strong>Sexual abuse:</strong> any sexual activity with a child: touching, exposure, showing pornography, taking sexual images, or exploitation, by an adult or by an older or more powerful child or teen.', '<strong>Emotional abuse:</strong> a pattern of belittling, threatening, rejecting, terrorizing or isolating a child.'] },
      { h: 'Watch for: in the child’s body', list: ['Bruises, burns, bites or welts in places kids don’t usually get hurt playing: ears, neck, cheeks, upper arms, torso, buttocks, backs of legs, or the soft skin of the inner arm', 'Marks in a pattern or shape (a hand, belt, cord, cigarette or iron), or bruises in different stages of healing', 'Injuries the explanation doesn’t fit, or a story that changes; a child who says “I don’t know” or gives an answer that sounds rehearsed', 'Trouble walking or sitting, pain, itching or bleeding in the genital area, or frequent urinary infections', 'Always hungry, hoarding or stealing food, very dirty, unwashed clothes, untreated medical or dental problems, dressed wrong for the weather'] },
      { h: 'Watch for: in the child’s behavior', list: ['A sudden change: a happy child becomes withdrawn, angry, clingy or fearful', 'Fear of a particular person or place, or not wanting to go home or be picked up by someone', 'Flinching, freezing or going very still when an adult moves quickly or raises a voice', 'Sexual knowledge, language or behavior beyond their age; acting out sexual play with toys or other children', 'Regression in younger children: bed-wetting or soiling, thumb-sucking, baby talk', 'Resisting taking off a jacket or changing clothes at times it would be normal to do so', 'In teens: self-harm (cutting, burning), running away, alcohol or drug use, eating problems, depression, suicidal talk, sudden sexual behavior', 'New gifts, money or phones with no explanation; talk of a new “older friend”'] },
      { h: 'Listen for: what children say', p: ['Children often “test the water” with part of the story, a question, or a hint to see how you react. Take these seriously:'],
        list: ['“I have a secret but I can’t tell you.” Or: “If I tell you something, do you promise not to tell?”', '“I don’t want to go to [name]’s house.” “I don’t like being alone with him.”', '“My uncle/coach/babysitter plays games with me that I don’t like.”', '“She made me take my clothes off.” “He showed me pictures.” “He touches me when Mom’s not home.”', '“Can I come live with you?” “Do I have to go home?”', 'Talking about a “special friend,” or saying an adult told them “this is just between us”', 'Drawings, writing or play that keeps returning to sexual or frightening themes', 'A teen saying someone online “has pictures” of them, or that they’re in trouble and can’t tell their parents'] },
      { h: 'Watch for: in adults around the child', list: ['A caregiver who seems unconcerned, describes the child as bad or a burden, or blames the child', 'Explanations for injuries that don’t add up, or delays in getting medical care', 'An adult who keeps a child from talking to others, or answers for the child', 'Any adult (including church volunteers) who seeks time alone with one child (see the grooming lesson)'] },
      { h: 'What to remember', p: ['One sign alone isn’t proof, but patterns, clusters and sudden changes matter. Your job isn’t to investigate or decide whether abuse happened. It’s to notice, write down exactly what you saw and heard, and report. A reason to suspect is enough.'] },
    ],
    videos: [
      { host: 'youtube', id: 'WPeLmTnxjJo', title: 'Child protection: an introduction. The signs and indicators of abuse', by: 'NSPCC Learning (the UK’s national child-protection charity)' },
      { host: 'vimeo', id: '982110495', title: 'Stewards of Children® introduction', by: 'Darkness to Light', minutes: 10 },
    ],
    sources: ['cwig', 'hhs', 'stopitnow', 'd2l'],
    confirm: ['I know the physical and behavioral warning signs to watch for in children and teens.', 'I know the kinds of hints and statements to listen for, and I will take them seriously.', 'I understand I don’t need proof. A reason to suspect is enough to report.', 'I watched the videos (or read this lesson in full if I couldn’t play them).'],
  },
  {
    key: 'prevent', version: '2026-10b', minutes: 25,
    title: 'Grooming: how abusers get access, and how to stop it',
    intro: 'About 90% of children who are sexually abused know their abuser. People who abuse rarely look dangerous. They look helpful. Grooming is how they get close to a child, win the family’s trust, and make sure no one notices or believes the child. Knowing the pattern lets you interrupt it early.',
    sections: [
      { h: 'The grooming pattern', list: ['<strong>Targeting:</strong> picks a child who is lonely, needy, struggling at home, eager for attention, or less supervised.', '<strong>Gaining trust (child and family):</strong> becomes the helpful volunteer, the “fun” leader, the one who offers rides, babysitting, tutoring or a place to hang out. Parents may feel grateful.', '<strong>Filling a need:</strong> gifts, money, food, phone credit, special privileges, extra attention, “I understand you better than your parents do.”', '<strong>Isolating:</strong> one-on-one time: a private talk in a side room, a ride home, a sleepover, private messages, “helping” after everyone leaves.', '<strong>Testing and desensitizing:</strong> tickling, wrestling, lap-sitting, back rubs, “accidental” touching, crude jokes, sexual talk, showing images, walking in while a child changes. Each step is a little further, to see whether the child objects or tells.', '<strong>Secrecy and control:</strong> “This is our secret.” “No one will believe you.” “You’ll get in trouble.” “It’s your fault.” Gifts and attention make the child feel guilty and responsible.'] },
      { h: 'Red flags in an adult or teen leader', list: ['Wants time alone with a child; finds reasons to be away from the group or the other leader', 'Has a “favorite”; gives one child gifts, money, special privileges or extra attention', 'Contacts a child privately: texting, DMs, social media, gaming chats; asks the child to keep it from parents', 'Ignores or pushes against rules: two-adult rule, open doors, restroom rules, no rides alone. “Rules are for other people.”', 'Touch that’s more frequent, longer or more private than other leaders’: tickling, wrestling, lap-sitting, kissing, touching even when a child pulls away', 'Talks about sex, makes sexual jokes, comments on a child’s body or development, or shows sexual content', 'Seems more interested in spending time with kids than with adults; volunteers for overnights and one-on-one roles', 'Allows or supplies things kids aren’t permitted (alcohol, vaping, R-rated content) and then shares a “secret” with them'] },
      { h: 'Children can harm other children', p: ['A significant share of child sexual abuse is committed by other children and teens, usually older or more powerful. Watch for:'],
        list: ['A child who repeatedly pushes others into sexual games, touching or exposure, or uses force, threats or bribes', 'Big age or size gaps in a “game” that one child clearly doesn’t want', 'Sexual behavior that’s persistent, secretive or upsetting to other children', 'Supervise bathrooms, transitions, closets, play structures and corners, where most of this happens. Never leave a group of kids unsupervised.'] },
      { h: 'Interrupt it: what you do', list: ['<strong>Two adults, always.</strong> Never alone with a child out of sight of another adult. If it happens by accident, move to an open, visible space immediately.', '<strong>Visible and interruptible.</strong> Doors open or windows uncovered. Any leader may walk in at any time, and should.', '<strong>No private contact.</strong> No one-on-one texting, DMs, social media or gaming with minors; include a parent or another leader.', '<strong>Name it early.</strong> If you see a boundary crossed (“Hey, let’s keep it to high fives”), say so, then tell the ministry director. You don’t need to know someone’s motive to report a policy break.', '<strong>Report even trusted people.</strong> Grooming works because good people don’t want to believe it. Report the behavior; let leaders and authorities sort out the rest.'] },
    ],
    videos: [
      { host: 'vimeo', id: '652549488', title: 'Grooming & Sexual Abuse', by: 'Scouting America Youth Protection', minutes: 6 },
      { host: 'vimeo', id: '364918155', title: 'Facts vs. Myths: Understanding Who Child Sexual Abusers Actually Are (Gregory Love, MinistrySafe)', by: 'ERLC Caring Well conference', minutes: 19 },
    ],
    sources: ['d2l', 'd2lflags', 'nspccGroom', 'stopitnow2', 'cdc', 'sbc'],
    confirm: ['I can describe each stage of grooming and the red flags in adults and teen leaders.', 'I will watch for harmful sexual behavior between children and supervise transitions, restrooms and corners.', 'I will follow the two-adult rule and never contact minors privately.', 'I will report boundary violations by anyone, including people I know and like.', 'I watched the videos (or read this lesson in full if I couldn’t play them).'],
  },
  {
    key: 'online', version: '2026-10', minutes: 12,
    title: 'Online grooming and sextortion (teens and preteens)',
    intro: 'Most preteens and teens have phones, and predators use the same apps they do: social media, messaging, and gaming chats. The National Center for Missing & Exploited Children and the FBI report sharp increases in online enticement and sextortion of children, especially boys 14 to 17 targeted for money.',
    sections: [
      { h: 'How it happens', list: ['Someone, often posing as a teen of the opposite sex, starts chatting in a game, on social media or in a group chat.', 'They flatter, share “common interests,” and quickly move the chat to a private or disappearing-message app.', 'They push for a photo, or send a fake one first. Once they have an image, the threats start: “Pay me or I’ll send this to your family, your friends and your church.”', '<strong>Sextortion</strong> moves very fast, sometimes within an hour. Teens feel trapped and ashamed, and some have taken their own lives.'] },
      { h: 'Watch for in a teen', list: ['Suddenly anxious, withdrawn, panicked or secretive about their phone; deleting apps or switching screens when someone walks by', 'Asking to borrow money or gift cards; selling belongings; mentioning they “owe” someone', 'A new online “friend” or boyfriend/girlfriend no one has met', 'Signs of self-harm or hopeless talk'] },
      { h: 'Listen for', list: ['“Someone has a picture of me.” “I did something stupid.” “I’m going to get in so much trouble.”', '“My parents can’t find out.” “Can I borrow $50 right now?”', 'A friend telling you, “I’m worried about [name]. Someone online is threatening them.”'] },
      { h: 'What to do', list: ['Stay calm and say it clearly: <strong>“You are not in trouble. This is not your fault. We’re going to get help.”</strong>', 'Tell them: don’t pay, don’t send more, don’t delete the account or messages. Block only after the evidence is saved.', 'Never ask a minor to send, show or forward an image to you, and don’t save one. Note the usernames, app names and times instead.', 'Bring in the parents and the ministry director right away. Report to the NCMEC <strong>CyberTipline: report.cybertip.org or 1-800-843-5678</strong>, and to the FBI (tips.fbi.gov). NCMEC’s free <strong>Take It Down</strong> service (takeitdown.ncmec.org) helps remove images of minors.', 'If a teen talks about hurting themselves, stay with them and call or text <strong>988</strong> (Suicide & Crisis Lifeline), or 911 if they’re in danger.'] },
    ],
    videos: [
      { host: 'youtube', id: 'Nb1zAY_cc8o', title: 'NSTeens: Friend or Fake', by: 'NCMEC NetSmartz' },
      { host: 'youtube', id: 'NzKLcvUQAqA', title: 'Sextortion (60-second PSA)', by: 'NCMEC NetSmartz' },
    ],
    sources: ['ncmec', 'netsmartz', 'fbi'],
    confirm: ['I know how online grooming and sextortion work and the warning signs in teens.', 'I will never ask for, view, forward or keep an image of a minor.', 'I know to report to parents, the ministry director and the NCMEC CyberTipline (1-800-843-5678), and to call or text 988 if a teen is at risk of self-harm.', 'I watched the videos (or read this lesson in full if I couldn’t play them).'],
  },
  {
    key: 'respond', version: '2026-10b', minutes: 15,
    title: 'When a child tells you: responding and reporting (Kansas)',
    intro: 'How you react in the first minute decides whether a child keeps talking, or never tells anyone again. It also matters for the investigation. Here is exactly what to do.',
    sections: [
      { h: 'In the moment', list: ['<strong>Stay calm.</strong> Keep your face and voice steady even if what you hear is upsetting.', '<strong>Give your full attention.</strong> Get to their eye level. Let them talk at their own pace and don’t interrupt pauses.', '<strong>Listen; don’t interview.</strong> Use only open prompts: “Tell me more.” “What happened next?” Never ask leading questions (“Did he touch you there?” “Was it your stepdad?”).', '<strong>Believe and reassure:</strong> “I believe you.” “You did the right thing telling me.” “This is not your fault.”', '<strong>Be honest about next steps:</strong> “I can’t keep this a secret, but I’ll only tell people whose job is to help keep you safe.” Never promise secrecy, and never promise outcomes (“Nothing bad will happen”).', '<strong>Don’t</strong> examine injuries, photograph the child, contact or confront the person accused, or tell the family yourself if the family may be involved.'] },
      { h: 'Right after', list: ['Write down the child’s exact words (not your summary), your questions, the date, time, place, who was present, and anything you observed. Sign and date it.', 'Keep the child safe and supervised by another adult. Don’t send them home with someone they named.', 'Tell the children’s ministry director or a pastor immediately, and file an <a href="/checkin/incidents/new">incident report</a>.'] },
      { h: 'Report to the authorities', list: ['<strong>Child in immediate danger: call 911.</strong>', '<strong>Kansas Protection Report Center: 1-800-922-5330</strong>, staffed 24 hours a day, 7 days a week (Kansas Department for Children and Families). Online reporting is also available through DCF.', 'Kansas law allows any person who has reason to suspect abuse or neglect to report, and requires it of many professions (K.S.A. 38-2223). You don’t need proof. Reports made in good faith are protected.', '<strong>Telling church leaders never replaces calling the state.</strong> No one at church may tell you not to report, or handle it “internally.”'] },
      { h: 'Teens and sexual assault', p: ['If a teen tells you they were sexually assaulted, follow the same steps: believe, reassure (“It wasn’t your fault”), don’t interrogate, and report. RAINN’s National Sexual Assault Hotline is 1-800-656-4673, 24/7. Keep what you know private, and don’t discuss it with other volunteers, parents or online.'] },
    ],
    videos: [
      { host: 'youtube', id: 'bvJ5uBlGYgE', title: 'Responding to a child’s disclosure of abuse', by: 'NSPCC Learning' },
      { host: 'vimeo', id: '365039843', title: 'Walking with the Broken: Caring Well for Friends and Family who Have Experienced Abuse (Jamie Ivey)', by: 'ERLC Caring Well conference', minutes: 13 },
    ],
    sources: ['cfc', 'nspccListen', 'ksdcf', 'kslaw', 'rainn'],
    confirm: ['If a child tells me about abuse, I will stay calm, listen without leading questions, and not promise secrecy.', 'I will write down the child’s exact words and tell church leadership right away.', 'I know how to report in Kansas: 911 for immediate danger, and the Kansas Protection Report Center at 1-800-922-5330.', 'I understand telling church leaders never replaces a report to the authorities.', 'I watched the videos (or read this lesson in full if I couldn’t play them).'],
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
  {
    key: 'cpr', version: '2026-10', minutes: 15,
    title: 'CPR and choking: infants, children and teens',
    intro: 'Watching videos doesn’t certify you, but it prepares you to act in the minutes before EMS arrives. Every room should know where the first-aid kit and the nearest AED are. Get certified using the links at the bottom of this lesson.',
    sections: [
      { h: 'First: check, call, push', list: ['Make sure the area is safe. Tap and shout. Is the child responsive and breathing normally? (Gasping is not normal breathing.)', 'Unresponsive and not breathing normally: <strong>shout for help, have someone call 911 and bring the AED.</strong> If you’re alone with a child or infant, give about 2 minutes of CPR first, then call.', 'Start compressions right away: <strong>push hard and fast, 100 to 120 per minute</strong>, letting the chest come all the way back up between pushes.'] },
      { h: 'Teens and adults (puberty and older)', list: ['Heel of one hand in the center of the chest, other hand on top; arms straight, shoulders over hands.', 'Push at least 2 inches deep. Hands-Only CPR (continuous compressions) is effective for teens and adults if you’re untrained or unwilling to give breaths.', 'Use the AED as soon as it arrives and follow its voice prompts.'] },
      { h: 'Children (age 1 to puberty)', list: ['Heel of one hand (or two hands for a larger child) in the center of the chest; push about 2 inches deep.', '30 compressions, then 2 breaths: head-tilt/chin-lift, seal your mouth over theirs, each breath about 1 second, just enough to make the chest rise.', 'Children’s cardiac arrests are usually caused by breathing problems, so breaths matter. Use the AED with child pads if available (adult pads if not).'] },
      { h: 'Infants (under 1 year)', list: ['Two thumbs side by side (or two fingers) on the center of the chest just below the nipple line; push about 1½ inches deep.', '30 compressions, then 2 gentle breaths covering the baby’s mouth and nose, with the head in a neutral position.', 'Continue until EMS takes over or the baby starts breathing.'] },
      { h: 'Choking', list: ['<strong>Child or teen who can’t breathe, cough or speak:</strong> stand behind, fist just above the belly button, quick inward-and-upward thrusts until the object comes out.', '<strong>Infant:</strong> face-down along your forearm, head lower than the chest: 5 firm back blows between the shoulder blades, then turn over for 5 chest thrusts with two fingers. Repeat.', 'If the child or infant becomes unresponsive, call 911 and start CPR, looking in the mouth for the object before giving breaths.', 'If a child is coughing hard, let them keep coughing and stay with them.'] },
      { h: 'Allergic reactions', p: ['Our name tags flag allergies. Signs of anaphylaxis include trouble breathing, wheezing, throat tightness, swelling of the lips or tongue, hives, vomiting, or sudden weakness. Use the child’s epinephrine auto-injector (EpiPen) if one was provided and you’re trained, call 911, contact the parent, and file an incident report.'] },
    ],
    videos: [
      { host: 'youtube', id: '5tx_8LHgxVw', title: 'Hands-Only CPR instructional video (teens and adults)', by: 'American Heart Association' },
      { host: 'youtube', id: 'PJbJ5IFvtIg', title: 'How to provide child CPR (age 1 to puberty)', by: 'Nicklaus Children’s Hospital' },
      { host: 'youtube', id: 'ksLwSIUljP4', title: 'How to provide infant (baby) CPR', by: 'Nicklaus Children’s Hospital' },
      { host: 'youtube', id: 'h_vSEviFXIo', title: 'First aid for a choking child', by: 'Nicklaus Children’s Hospital' },
      { host: 'youtube', id: 'gHZdBY-CkGw', title: 'First aid for a choking infant', by: 'Nicklaus Children’s Hospital' },
    ],
    certification: true,
    sources: ['ahaHands', 'ahaInfant', 'redcrossHands', 'redcrossKids'],
    confirm: ['I know the CPR steps for teens, children and infants, including compression depth and rate.', 'I know how to help a choking child and a choking infant.', 'I know where the first-aid kit and nearest AED are in the area where I serve (or I will ask a leader today).', 'I watched the videos, and I understand this lesson is not a CPR certification.'],
  },
];

const MODULE = Object.fromEntries(MODULES.map((m) => [m.key, m]));

module.exports = { MODULES, MODULE, SRC, CERTIFICATION };
