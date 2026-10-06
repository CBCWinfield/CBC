# Central Baptist Church Public Christian Library

The online side of the church library: a public catalog, library applications, online checkouts with pickup scheduling, and a dashboard for the librarian and assistants.

- **Public:** home page, catalog, book pages, apply for an account, My Library (holds, due dates, library code, reminders).
- **Librarian:** Today (pickups and overdue books), pickups and checkouts, books (add, edit, ISBN lookup, cover photos, CSV import), applications (with an automatic-approval switch), patrons (pause, resume, delete, temporary passwords), staff (assistants), and settings (checkout length, pickup days and hours, closed dates).
- **Ask bar:** the search box at the top answers plain questions ("books about grief for teens", "when can I pick up?") from the catalog and library settings. It runs entirely inside this app. Nothing is sent to any AI service.
- **Notices:** emails through Resend (approval with library code, pickup confirmation with a calendar file, pickup reminders, due-soon and overdue notices), plus optional phone notifications.

Runs on Render (web service) with a Neon Postgres database. The only dependency is the `pg` database driver.

---

## Setup (one time)

### 1. Neon (the database)
1. In Neon, open your **cbc-library** project and click **Connect**.
2. Copy the connection string. It starts with `postgresql://`. You'll paste it into Render as `DATABASE_URL`.

The app creates its own tables the first time it starts.

### 2. Render (the website)
1. In Render, choose **New > Web Service** and connect the **CBC** repository.
2. Settings:
   - **Runtime:** Node
   - **Build command:** `npm install --omit=dev`
   - **Start command:** `npm start`
   - **Health check path:** `/healthz` (under Advanced)
   - **Instance type:** Free
3. Under **Environment**, add:

| Name | Value |
| --- | --- |
| `NODE_ENV` | `production` |
| `DATABASE_URL` | your Neon connection string |
| `ADMIN_EMAIL` | the librarian's email |
| `ADMIN_PASSWORD` | a temporary password for the librarian (change it after first login) |
| `ADMIN_FIRST_NAME` / `ADMIN_LAST_NAME` | the librarian's name |
| `RESEND_API_KEY` | from Resend (step 3) |
| `EMAIL_FROM` | optional; defaults to `Central Baptist Church <noreply@mail.cbcwinfield.org>` (verified in Resend) |
| `EMAIL_REPLY_TO` | where replies should go, e.g. the librarian's email (optional) |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` | optional, for phone notifications (step 5) |

4. Click **Create Web Service**. When it says **Live**, open the address Render gives you (something like `https://cbc-library.onrender.com`).
5. Log in with `ADMIN_EMAIL` and `ADMIN_PASSWORD`, then change the password on **My Library**.

Alternatively, use **New > Blueprint**: `render.yaml` in this repository sets everything up and asks for the values above.

### 3. Resend (email)
1. In Resend, go to **Domains > Add Domain** and enter the church's domain.
2. Resend shows a few DNS records. Add them where the domain is managed (for a Wix domain: Wix dashboard > Domains > your domain > Manage DNS records). Wait for Resend to show **Verified**.
3. Go to **API Keys > Create API Key** and paste it into Render as `RESEND_API_KEY`.
4. Set `EMAIL_FROM` to an address at that domain.

Until the domain is verified, Resend only delivers to your own Resend account email, so patrons won't get messages yet. The site still works; emails are just skipped.

### 4. UptimeRobot (keep it awake)
Add an **HTTP(s)** monitor for `https://YOUR-RENDER-ADDRESS/healthz` every 5 minutes. This keeps the free service from sleeping, which also keeps reminder emails on time.

Render's free plan includes 750 hours a month per account. One service running all month uses about 744, so keep this as the only always-on free service in the church's Render account.

### 5. Phone notifications (optional)
Patrons and the librarian can turn on notifications from **My Library**. To enable them, Render needs three values (`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`). Generate a key pair with `npm run vapid` on any computer with Node, or ask Claude for a pair. On iPhones, notifications only work after the person adds the site to their Home Screen (Share > Add to Home Screen) and opens it from there.

### 6. Link it from the Wix site
In the Wix editor, add a menu item or button called **Library** that links to the Render address. To use your own address (like `library.yourchurch.org`), add a custom domain in Render (Settings > Custom Domains) and the matching CNAME record in your domain's DNS.

---

## Using it

**Librarian, day to day**
- **Today** lists today's pickups (mark them **Picked up** when the person arrives; the due date is set then) and anything overdue.
- **Pickups & checkouts** has three views: waiting for pickup, checked out (with days out and due dates), and history. **Returned** checks a book back in. **Extend** adds another checkout period.
- **Check out at the desk** is for walk-ins: enter their library code and choose the book.
- **Books > Add a book:** type the ISBN and press **Fill in from ISBN** to look up the title, author, description and cover. Snap a photo of the cover with a phone if there isn't one. **Add and start another** speeds up entering a stack of books.
- **Books > Import a list:** upload the old library system's export file (the WooCommerce "product export" CSV) as-is, or a simple spreadsheet saved as CSV (download the template on that page). Old-system books are matched by their old ID, so importing the same file again updates them instead of duplicating them.
- **Covers:** after an import, the library copies each book's cover photo from the old website (cbcwinfield.com) in the background, shrinks it, and stores it in the database. Books without a photo are looked up on Open Library by title and author. Progress shows on the Books page; **Find missing covers** retries any that didn't come through. Keep the old site online until the copying finishes.
- **Download the catalog:** exports every book in the same column layout as the old system's export, so it can be opened in a spreadsheet or imported again.
- **Applications:** approve or deny. The switch at the top turns automatic approval on or off.
- **Patrons:** search, pause, resume, delete, or make a temporary password for someone who's locked out.
- **Staff:** give an assistant access, or create an account for one. Assistants can manage books and checkouts; they can't approve applications, pause or delete accounts, or change settings.
- **Settings:** checkout length, books per person, pickup days and hours, slot length and capacity, closed dates, address and contact details.

**Patrons**
1. Apply on the website. They get an email with their library code once approved.
2. Find a book, choose **Check out**, enter their library code and pick a pickup time.
3. Pick up at the church. Due dates and reminders show on **My Library**.

---

## Central Check-In (at /checkin)

Check-in lives in the same Render service as the library, at `/checkin`, and installs on phones, tablets and laptops as its own app ("Central"). When someone opens it in a browser, a banner offers **Download the app** (phones/tablets) or **Add to desktop** (computers). The logo menu at the top switches between Library, Check-In and Inbox.

**First login.** The primary admin (centralbaptistchurchcalendar@gmail.com, Anthony Ryker) is created on first start using `CHECKIN_ADMIN_PASSWORD`, or `ADMIN_PASSWORD` if that isn't set. If that email already has a library account, it simply gets admin rights.

**Roles** (More › Team):
- **Volunteer:** check families in and out, Quick Check, add a family or guest at the desk, print name tags, scan pickups, take photos, see allergy and medical notes.
- **Ministry leader:** also edit families, see custody details, send sign-up links, manage Events.
- **Co-admin:** also Reports, Team, Automations and conversation review.
- **Primary admin:** everything, including co-admins.

**Services.** Sunday School (Sundays 9:30), Children's Church (Sundays 10:45, the station switches over at 10:30) and Wednesday Night Service (6:00 PM) are picked automatically by day and time. **More › Events** lists every event you've created; archive old ones to take them off the check-in screen (their attendance stays in Reports).

**Checking in:** search a family (name, a child's name or phone). **Quick Check** next to a family checks everyone in for the current service and prints the kids' tags without opening the family; tap the name instead to untick anyone who isn't there. No match? **Add a new family** (parent, emergency contact, then the kids) or **Quick guest check-in** (a child with no parent here: first name, class, a guardian's phone, and the family they came with).

**Name tags:** first name, class (Nursery, Toddlers, Kids, Teens, Adults), check-in date and time, the pickup code and barcode, a red picture symbol for each allergy (peanut, tree nut, milk, egg, wheat, soy, sesame, fish, shellfish, bee sting, medicine, latex) and a red cross for medical needs. On the DK-2251 red/black roll the symbols print red.

**Printing (Brother QL-810W):** on the laptop connected to the printer open **Printing** and turn on "This device is the printer". Tags from every phone and iPad queue there and print automatically. Load the 62mm continuous roll with auto-cut; the first time, choose paper **62mm × 100mm**, **landscape**, margins **none**.

**Scan (pickup):** tap **Scan a pickup tag** and hold the parent's tag to the camera (works on iPhone, iPad, Android and laptops), use a handheld barcode scanner, or type the 4-letter code. Children's photos show to confirm who's going home; people marked "not allowed to pick up" show a red stop warning. **Checked in › Check out all kids** releases everyone at the end.

**Photos:** add a photo for anyone from the family page, at the desk after adding kids, or by parents on My family. Photos are shrunk on the device and only the church team and that family can see them.

**Inbox:** everyone with an account can message other families and the church team, one-to-one or in groups. New messages arrive live, with an app notification and (if unread) an email. Members can mute, leave, block and report; co-admins can review conversations and reported messages (More › Inbox › Review).

**Settings:** each person chooses their notifications (check-in, pickup, messages, greetings, library) and privacy (listed in the directory, show phone/email/children's names, who can start a conversation).

**Automations (co-admins):** welcome email on sign-up (with a link to their account and the church's address, phone and email), check-in and pickup notices, unread-message emails, and birthday, Christmas and Easter greetings. Each can be turned off, reworded and test-sent.

**Training and required policies:** new team members are locked out of check-in (they see only family features) until they read every policy marked *Required* and finish five short lessons: recognizing abuse and neglect; preventing sexual abuse and grooming; responding to a disclosure and reporting in Kansas; conduct and boundaries; and what to say and what not to say. Lessons draw on HHS/Child Welfare Information Gateway, the CDC, Darkness to Light, Committee for Children, RAINN, Kansas DCF and Southern Baptist resources (ERLC Caring Well videos, embedded from Vimeo; SBC Abuse Prevention). Each page must be scrolled to the end and every box ticked. The primary admin is exempt; admins can *Waive* someone trained elsewhere. Lesson text lives in `src/checkin/training.js` (bump a lesson's `version` to make everyone retake it).

**Admin dashboard (co-admins):** a table of every team member's policy and lesson completion with dates, recent incident reports, group-message responses, and counts of reported messages and prayer requests.

**Incident reports:** any team member files one (type, severity, who, what happened, action taken, first aid, parent notified, authorities contacted). Admins are notified, can add private notes and mark reports reviewed or closed. The form shows Kansas reporting steps (911; Kansas Protection Report Center 1-800-922-5330).

**Group messages (co-admins):** pick groups (whole team, volunteers, leaders, admins, parents, everyone, or people serving on a date) and/or individuals, start from a ready-made message (e.g. "Team meeting at 5:30 PM, click to confirm") or save your own, and send. Each person gets it in their Inbox with confirm/decline buttons; responses are tallied, with a one-tap reminder for those who haven't answered.

**Prayer Wall:** anyone with an account can post a request (optionally anonymous or team-only), tap 🙏 "I'm praying" (with a running count), comment, and mark it answered with a praise report.

**Check-out:** "Check out everyone" releases kids and their parents. Releasing a family's last child at pickup checks their parents out too. Anyone still checked in 6 hours after the service started (Sunday School 9:30, Children's Church 10:45, Wednesday 6:00 PM, or the first check-in for other events) is checked out automatically.

**Anniversaries:** adults can add a wedding anniversary (family setup or the person page); the Happy anniversary automation emails them.

**Names:** clicking a person's name anywhere (roster, check-in, pickup, family pages) opens their edit screen for leaders and admins, and returns you to where you were after saving. The Printing page has **Print a test tag**.

**Policies** (upload PDFs/Word docs or type the text), **Serving calendar** (Nursery, Toddlers, Kids, Teens and Adults for every service; admins can import a CSV), **Ask** (search bar) and **HELP** (guides with "Show me" tours) are in the header and More menu.

**Families sign up from home:** Families › Email a sign-up link. The parent creates a login and walks through five steps: family, children, health & safety, emergency contacts & pickups, and permission forms. Each signature is stored with the exact wording, date, time and signer. Have a Kansas attorney or the church's insurer review the wording in `src/checkin/agreements.js`.

**Reports (co-admins):** each service, monthly and yearly averages, first-time guests and kids by class, with a spreadsheet download.

---

## For developers
- `src/server.js`: startup, middleware, first librarian account
- `src/routes/`: public pages, patron account, librarian area
- `src/views/`: HTML templates (tagged template literals, escaped by default)
- `src/lib/ask.js`: the Ask engine (keyword scoring, synonyms, typo tolerance, library questions)
- `src/lib/push.js`: Web Push (VAPID + aes128gcm) using Node's crypto
- `src/reminders.js`: reminder emails, every 15 minutes, 8 AM–8 PM library time
- `src/lib/woo.js`: import/export of the old WooCommerce library format
- `src/covers.js`: background cover finder (old site photos, then Open Library search; resized with `sharp` when installed)
- `src/db.js`: schema migrations (add new ones to the end of `MIGRATIONS`)
- Tests: `npm test` (unit). `test/e2e.js` walks through every flow against a running server.

- `src/checkin/`: check-in (routes, screens, labels and Code 128 barcodes, agreements, notices)
- Tests: `test/checkin-e2e.js` walks through check-in against a running server.

Local run: `DATABASE_URL=postgresql://localhost/cbc ADMIN_EMAIL=… ADMIN_PASSWORD=… npm start`
