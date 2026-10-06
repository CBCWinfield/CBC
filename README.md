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
| `EMAIL_FROM` | e.g. `CBC Library <library@yourchurch.org>` |
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
- **Books > Import a list:** upload a spreadsheet saved as CSV. Download the template on that page to see the columns.
- **Applications:** approve or deny. The switch at the top turns automatic approval on or off.
- **Patrons:** search, pause, resume, delete, or make a temporary password for someone who's locked out.
- **Staff:** give an assistant access, or create an account for one. Assistants can manage books and checkouts; they can't approve applications, pause or delete accounts, or change settings.
- **Settings:** checkout length, books per person, pickup days and hours, slot length and capacity, closed dates, address and contact details.

**Patrons**
1. Apply on the website. They get an email with their library code once approved.
2. Find a book, choose **Check out**, enter their library code and pick a pickup time.
3. Pick up at the church. Due dates and reminders show on **My Library**.

---

## For developers
- `src/server.js`: startup, middleware, first librarian account
- `src/routes/`: public pages, patron account, librarian area
- `src/views/`: HTML templates (tagged template literals, escaped by default)
- `src/lib/ask.js`: the Ask engine (keyword scoring, synonyms, typo tolerance, library questions)
- `src/lib/push.js`: Web Push (VAPID + aes128gcm) using Node's crypto
- `src/reminders.js`: reminder emails, every 15 minutes, 8 AM–8 PM library time
- `src/db.js`: schema migrations (add new ones to the end of `MIGRATIONS`)
- Tests: `npm test` (unit). `test/e2e.js` walks through every flow against a running server.

Local run: `DATABASE_URL=postgresql://localhost/cbc ADMIN_EMAIL=… ADMIN_PASSWORD=… npm start`
