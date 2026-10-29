# Fudge

## Current backend

Fudge now uses the dedicated **Fudge** Supabase project in the **Account Boosters 2 Free** organization. The extension talks to the authenticated `fudge-backend` Edge Function; no service-role or secret Supabase key is shipped to a browser.

- `backend.html` is the operations frontend for service requirements, keywords, progress, workers, jobs and recent activity.
- The first upgraded run imports the currently connected Sheet into Supabase once. After that, Sheets is no longer the database.
- Google Drive remains the picture store. Saved picture links are normalized to `https://drive.google.com/file/d/<id>/view?usp=drive_link`.
- `drive-setup.html` connects a standalone Apps Script project only for Drive uploads; it does not require a spreadsheet.
- The deployable database and function sources live under `supabase/`.
- Supabase owns services, requirements, search keywords, leased jobs, reviews, assignments, businesses, workers, history and activity logs. Atomic job claims, lease expiry, heartbeats and idempotency make several extensions safe.
- Supabase Auth/RLS policies are ready for owner, admin, operator and viewer dashboard users. Chrome workers register separately and receive a hashed per-installation worker credential.
- The dashboard refreshes durable server state every five seconds; the operational tables are also in the Supabase Realtime publication for authenticated clients.

After updating the unpacked extension, reload it once at `chrome://extensions`. That first run registers the worker and imports a previously connected Sheet. Open **Fudge → Open database** to manage requirements, then press **Start** in either the dashboard or extension. The backend starts stopped after installation, so reloading cannot unexpectedly open Google tabs.

Everything below that describes Sheets is retained as migration and legacy-connector reference. The operational queue is now Supabase.

Picture links are stored one URL per line inside a single cell in both the
Structure and Reviews tabs. Copy for Sheets uses the same single-cell layout.
Fudge keeps all spreadsheet rows fixed at 21 px, including rows containing
multiple picture links.
It never auto-resizes spreadsheet columns, so manually chosen column widths remain unchanged.

Reviews collected from a confirmed specialist business are locked to that
service family, preventing ambiguous words such as "moved" from turning a
garage-door review into a Moving review. Review IDs, fingerprints, and a
text-plus-business identity prevent one review from filling multiple rows.

Fudge is a Chrome/Edge Manifest V3 extension that collects and classifies Google reviews, then fulfills a Supabase-managed work queue automatically.

## What it keeps

- Exactly 5-star reviews
- Reviews with customer photos by default, plus text-only reviews when a Structure row is marked **Self Write** or **Without Picture**
- One copy of each review, keyed by Google's review ID with an author/business migration fallback; a newly captured full review upgrades an older truncated copy
- Two-level home-service classification, with precise subsections such as Garage doors → Track & roller repair, HVAC → Thermostat, or Drywall → Texture matching
- A three-column Pictures + Picture links + Review table, grouped by service and subcategory
- Google Sheets-ready copying: the picture column is copied as an `IMAGE()` formula and review text as the adjacent cell
- Google Search **Places** batch scanning: opens each business, enters its reviews, continues to the next result page, and stops automatically at the end
- Original-size Google image URLs plus clickable picture links
- Optional Google Drive uploads with link sharing set to **Anyone with the link — Viewer**
- Desktop completion notifications and a configurable 1–4 page limit (4 pages by default)
- A persistent **Stop scan** control that halts further scrolling, businesses, and result pages while preserving reviews already collected
- Persistent Ready and **Used** sections. Marking a review Used moves it out of the working queue without deleting it, and Restore brings it back
- Faster review scanning: Fudge selects Google's **Highest** sort, walks only the five-star block, and moves on as soon as the first lower-rated review appears
- A Sheets-backed workflow with **Structure**, **Reviews**, **Search Progress**, and **Businesses** tabs
- Automatic 3× sourcing: each required Structure row gets one assigned review and two unused backups
- QC replacement: set **Quality Check** to `Change it` to reject the assigned review, replace it, and reset the cell to `QC needed`
- Reliable query resume using page position plus visited business/place IDs and collected review IDs

## Load it locally

1. Open `chrome://extensions` (or `edge://extensions`).
2. Turn on **Developer mode**.
3. Choose **Load unpacked** and select this folder.
4. Open either a business in Google Maps or a Google Search **Places** results page.
5. Choose a limit of 1, 2, 3, or 4 result pages in the Fudge sidebar.
6. Click **Start collecting**. Fudge will open businesses, enter Reviews, collect eligible reviews, advance through result pages, and notify you when it finishes. **Stop collecting** ends it, closes the runner tabs, and switches automatic fulfillment off until you press Start again. Nothing else turns collecting on: connecting a sheet, syncing, and finishing a job never do.

Fudge selects **Highest** using Google's `data-sort="3"` review control, keeps only five-star reviews with customer photos, and stops scrolling that business as soon as the sorted feed reaches a lower rating. Google changes Maps markup periodically, so the DOM selectors in `content.js` are intentionally grouped in one place for maintenance.

Google Search Places support is matched to the current `AtSb` business-result cards, `NkTNVb` Reviews control, `ujKaBc` review dialog, `RjvGlb`/`OSrXXb` selected-business names, `bwb7ce` review cards, `h3PQJ` star blocks, direct `d83Iyc` review text (plus the older wrappers), and `SeRB9d` attached-photo elements.

Before saving a review, Fudge activates its `FrlmTe` **More** control and independently selects the longest full-text review node. Every attached `SeRB9d`/indexed review image is retained, upgraded to its original-size Google URL, displayed in the dashboard, included in picture links, copied to Sheets, and uploaded to Drive when enabled.

## Legacy Google Sheet import and Google Drive setup

This section documents the old combined connector and the one-time import path. New installations use Supabase for data and need Apps Script only for Google Drive uploads (and the optional website writer).

1. Choose **Connect** under *Sheets automation* in the Fudge sidebar.
2. Create or open the Google Sheet you want to use and choose **Extensions → Apps Script**.
3. Copy the complete protected connector from Fudge, replace the starter code in Apps Script, and save it.
4. Return to the Sheet, refresh it, then choose **Fudge → Set OpenAI API key** and paste your new key. The script stores it as `FUDGE_OPENAI_API_KEY`.
5. Select `fudgeInstallAutomation` beside **Run**, click **Run**, and approve Google’s permissions once. Fudge also installs these triggers itself the first time it connects, so this step is a fallback rather than a requirement — but approving the permission here once is what lets it do so.
6. Choose **Deploy → New deployment → Web app**. Set **Execute as** to *Me* and access to *Anyone*, then deploy.
7. Paste the deployment URL ending in `/exec` into Fudge and choose **Connect Sheet and Drive**.

The generated connector includes a long random secret, and every request without that exact secret is rejected. Fudge creates the Structure, Reviews, Search Progress, and Businesses tabs inside that Sheet. It also creates a `Fudge Reviews` Drive folder, downloads original review images through Apps Script, and shares them as **Anyone with the link — Viewer**. Workspace administrators can prohibit public links; Fudge reports that error while keeping the reviews locally.

To connect another computer to the same Sheet, open **Change sheet** on the already connected computer and choose **Copy connection code**. Paste that code into the setup field on the other computer. The deployment URL alone is insufficient because each fresh extension installation creates a different private secret. Share the connection code only with people who should be able to use this Sheet connector.

### Giving someone else the extension

The folder carries no connection: a new installation generates its own secret and starts at the setup page. Two failures mean two different things.

- **`404`** is Google refusing to serve the deployment, so it happens before any secret is read. The deployment is private: its owner must open **Deploy → Manage deployments → ✏️**, set **Execute as: Me** and **Who has access: Anyone**, and deploy. The owner never sees this, because the deployment always answers for its owner. A browser signed in to several Google accounts can also get `404` for a non-default account.
- **`secret does not match`** is the connector running with a different secret than the request. Either the recipient pasted a bare `/exec` URL — which carries no secret, so they need the `FUDGE1|` connection code instead — or they pasted new connector code and never redeployed, because `/exec` keeps serving the previously deployed **version** until **Deploy → Manage deployments → ✏️ → Version: New version → Deploy**.

Sharing the owner's deployment means the recipient reads and writes the **owner's** Sheet and Drive folder, since the web app executes as its owner. For a separate database, the recipient copies the connector from their own setup page into their own Sheet and deploys that.

## Google Sheets automation

Connecting the Apps Script web app prepares the Sheet; **Start collecting** in the side panel is what turns automatic fulfillment on, and **Stop collecting** is what turns it off. While it is on, Fudge checks Structure about every 30 seconds and opens Google itself. Enter one requirement per row in the **Structure** tab using the `Service Keyword` and `City` columns. Use `Self Write` or `Without Picture` in `Review Type` when a five-star text-only review is required; otherwise Fudge requires customer pictures.

### What happens after Start or a new keyword

1. **Start collecting** turns the collector on immediately. With a Sheet connected, it follows the Structure queue regardless of which browser tab is open. The panel shows **Checking Sheet requirements**, **Opening Google**, or the actual retry/error while that work continues; it no longer waits for the whole Sheet read and tab load before answering the button. **On** can appear between searches; **Paused** means Google has asked the collector to slow down.
2. A **Structure** row requests reviews for its Service Keyword. The **Services** tab controls which trades and matching rules are active, but a Services entry by itself does not request a search. The **Cities** tab supplies search locations when a Structure row does not name one.
3. The extension reads the Sheet, uses matching reviews already in the Reviews inventory, and opens up to three Google searches by default for shortages. **Google tabs** in Scan settings changes the limit from one to six. New Structure edits are normally detected on the next extension check, about every 30 seconds while Chrome is running; a new search waits if all runner slots are busy. **Sync now** checks and starts waiting work immediately while collection is on. Google page loading and review scanning take additional time. When **Upload originals** is on, Drive pictures upload in the background so they cannot hold up the next business; links appear after a later sync. When it is off, Fudge keeps the reviews locally and the Drive Picture Links cells stay empty. A Google block pauses new searches for 15 to 120 minutes; the side panel shows the pause.
4. The Apps Script connector in the Sheet fills rows from existing inventory when Chrome is absent and rephrases filled Structure rows. It cannot browse Google on its own. Rephrasing requires an OpenAI key saved in the Sheet; its status and errors appear in the side panel.

The connector is a deployed copy of `apps-script.gs`, not a live link to this folder. If the side panel reports that the deployed connector is out of date, use **Change sheet → Copy connector**, replace the Sheet's Apps Script code, save it, and deploy a **New version**. Changing the Google tab limit or the extension's check cadence does not require a new connector deployment.

The deployed Sheet connector now handles existing inventory independently of Chrome. A manual Structure edit runs immediately, and a one-minute trigger catches pasted, imported, or externally updated rows. Rephrasing happens on the spot: a row you edit, a row the extension fills, and a row the Sheet fills by itself are all rephrased in that same run, not on the next tick of a clock. It runs under its own lock, so a rephrase in progress can neither time out an extension request nor swallow an edit you just made, and the five-minute trigger is only a backstop for rows nothing touched. Its state is reported to the side panel and to **Fudge → Rephrasing status** in the Sheet: a missing key, a missing trigger, or the last API error is named instead of looking like a row Fudge chose not to rephrase. **Fudge → Test rephrasing** sends one row and shows the raw API response, and the model can be overridden with the script property `FUDGE_OPENAI_MODEL`. It fills new or changed service requirements from the unused review pool and handles `Change it` QC replacement even when Fudge is stopped, Chrome is closed, or the extension is no longer installed. Collecting additional reviews from Google still requires the extension.

Fudge marks the selected row **Used** in the Reviews tab, leaves two unused backups for QC, and searches Google automatically only when the pool is short and the extension is available. Repeated service keywords are combined across the entire Structure even when other services sit between them: three Christmas-light rows are sourced as one nine-review batch, and that batch keeps its original priority until complete. Equivalent known wording such as `Christmas Light Installation` and `Christmas Lights Installation` is grouped together. If `Change it` is entered in Quality Check, the old review is marked Rejected, a replacement is assigned, and Quality Check returns to `QC needed`.

The scanner finishes the complete five-star section of the business it is currently checking, even when it reaches the target halfway through that business. It then stops before opening another business. Search progress, visited business IDs, review IDs, and exhaustion state are stored in the spreadsheet so a reordered Google result page does not cause duplicate work.

## Updating the Sheet connector

The connector is **Apps Script code living inside your spreadsheet**. `apps-script.gs`
in this folder is only the template Fudge copies — editing it does not change what is
already deployed in your Sheet. Whenever the connector gains a tab or an action, the
copy in your Sheet has to be replaced:

1. Side panel → **Change sheet** → **Copy connector**.
2. In your Sheet: **Extensions → Apps Script**, select all the old code, paste the new, and save.
3. Return to the Sheet, refresh it, then choose **Fudge → Set OpenAI API key** and paste your new key.
4. Select `fudgeInstallAutomation` in Apps Script, click **Run**, and approve any requested permissions. Fudge reinstalls the triggers on its own after an update; the side panel shows a **Repair** button if it cannot.
5. **Deploy → Manage deployments → ✏️ (edit) → Version: New version → Deploy.**

The `/exec` URL does not change, so there is nothing to re-paste into Fudge.

Each connector carries a `FUDGE_CONNECTOR_VERSION`, returned on every response. When
the deployed copy is older than the extension expects, Fudge keeps syncing the tabs
that copy does understand and the side panel says *"Sheet connector is out of date"*
rather than failing with an unexplained error.

## Services — what you actually do

The **Services** tab is both your trade list and the rule editor: one service per row.
Put `Paused` in **Status** to switch a row off. Fudge keeps only reviews that match
an active row, so a scan never fills the library with work you do not sell. Leave the
tab empty and nothing is filtered.

Existing A:D rows are upgraded automatically on the next extension sync. Fudge fills
the trained defaults into the new columns once; after that, the Sheet owns them and
does not require a code change. Add a new service by adding a row and setting:

| Column | What it controls |
| --- | --- |
| Service Keyword | The wording used in Structure and rephrasing |
| Search Term | The Google query before the city is added |
| Business Name Keywords | Words that identify a specialist business and allow scanning without a topic chip |
| Review Keywords | Any one of these must appear in the review |
| Required Review Keywords | Every listed word or phrase must appear |
| Google Filter Keywords | Words used to choose Google's review topic chip |
| Exclude Keywords | Any one of these rejects the review |
| Service Family | Keeps reviews inside the correct trade |
| Subcategory | Keeps precise jobs separate inside a family |
| Topic Filter Required | `Yes` skips a general business if Google has no matching topic |
| Collect Family Reviews | `Yes` also saves other subcategories from a confirmed specialist business |
| Rewrite Service Phrase | Preferred service wording in Rephrased Content |
| Equivalent Service Phrases | Supported alternate wording that should become the preferred phrase |

Separate alternatives with `|`, for example `sofa | couch`. Use `-` or `none` when a
list should intentionally be empty. Fudge writes back only **Status** and
**Reviews Collected**; it never overwrites configured rule cells. The same rules are
cached in the extension for Google collection and read directly by Apps Script for
Sheet-only queue matching, so offline assignment follows the same service boundaries.

## Google's own review topics

Before scrolling anything, Fudge uses the **Filter reviews** chips Google shows above
a business's reviews. Google has already grouped the reviews by what they are about,
which is far stronger evidence than reading the text afterwards.

**The filter is only used when the business needs it.** Fudge reads the selected
business name from Google's current detail-panel heading and uses flexible service
signals rather than the entire phrase. `Assembly Help`, `TV Mount Helpers`, `Ashton
Painter Services`, `Ashton Sheetrock`, and a name containing `Garage` are already
specialists, so they are scanned without a topic filter. `Ashton Plumbing` still needs
the toilet filter, `Ashton Electrical` still needs the Christmas-light filter, and a
general handyman still needs the TV-mounting filter.

When narrowing is needed, Fudge:

1. Clicks **+N more review topics** first — the specific trades usually hide there.
   On a Houston plumber, `toilet replacement` only appears after expanding `+6`.
2. Scores every topic against the requirement's keyword and picks the best match,
   preferring the most specific one and then the one with the most reviews.
3. Clicks that topic, so the feed now contains only reviews about it.
4. Applies the **Highest** sort as usual and scans the five-star block.

For a specific toilet requirement at a general plumbing company, a matching toilet
topic is mandatory. If the company name/category is not toilet-specific and Google
does not expose a toilet topic, Fudge skips that business without scrolling it. For
other services, no topic match still falls back to review-text matching because
Google's topic list can be incomplete. Sentiment topics like `courteous staff`, `fair
pricing` and `prompt arrival` never count as a service match.

The selected business title and review-topic carousel are both allowed to settle
before this decision. The wait is adaptive: a fully rendered panel proceeds in a few
hundred milliseconds, while a still-loading Google panel gets a short grace period so
Fudge does not mistake “not rendered yet” for “no toilet topic.”

If a business shows no topic chips at all, Fudge normally carries on with text
matching. A general plumbing company being searched for toilet work is the exception:
without a toilet business signal or toilet topic, it is skipped immediately.

### When no topic matches

The business is **still scanned**, for about four seconds. Google's topic list is not
exhaustive, so a business can hold the reviews you want without a chip naming them.
The Highest sort is still applied and the top of the feed is read before Fudge moves
on, rather than skipping the business outright.

### Sponsored results are never opened

Paid placements sit above the organic results and are repeated on **every** results
page, so without this they get re-scanned page after page. They are detected by
`data-is-ad`, `local-ad-unit` and their `/aclk?` tracking links, and dropped from the
target list.

A business is recognised by its Google feature id, `/g/` place id or
`data-feature-id` — never by the `tsuid_` container id, which embeds the page's event
id and so changes on every results page. That fallback is what previously made the
same sponsored business look new on each page and get visited again.

## Matching a review to a keyword

A review has to be *about* the thing the keyword names. Previously `toilet
replacement` resolved to the catch-all "General plumbing" bucket, which then matched
every plumbing review — a water-heater review could satisfy a toilet requirement.

Now the configured services use one-word or closely related signals instead of exact
phrases. Examples include `window/windows`, `gutter/rainspout`, `carpet/rug`,
`light/lights`, `move/moving/movers`, `TV/mount/mounted`, `toilet`,
`paint/painter`, the appliance names, and the drywall/outlet vocabularies. Furniture
assembly uses signals such as `furniture`, `assemble`, `assembly`, `IKEA`, `wardrobe`
and `dresser`; junk removal uses `junk`, `haul`, `debris` and `cleanout`; upholstery
uses `upholstery`, `sofa` and `couch`; pressure washing uses `pressure` and power-wash
variants; picture hanging uses `picture`, `frame`, `hung`, `artwork` and `gallery`.

In addition:

- A keyword that lands on a precise subcategory (`garage door track`, `ac repair`,
  `cabinet painting`) must match that subcategory, as before.
- A keyword that only lands on a family's catch-all is checked against the review
  text: every meaningful word of the keyword must appear in the review. Action words
  — repair, replacement, installation, service, fix, new — are ignored, so
  `toilet replacement` looks for **toilet**.
- A keyword that simply names the trade (`plumbing`, `drywall`, `hvac`) still accepts
  anything in that trade.

Matching is stem-aware, so `springs` satisfies `spring`, and `matching` finds
`matched`. No AI call is involved — the keywords carry the signal on their own.

A business-name match only decides whether Google's topic filter is needed; the review
still needs one of its configured service signals. Garage specialists are the useful
exception: Fudge stores their track, spring, opener and other garage reviews together,
classifies each into the correct subsection, and counts only reviews matching the
current requirement toward the stopping target. A spring review therefore remains
available in inventory but can never fill a track-only Structure row.

## Cities

You fill in **Structure** requirements only — review type and service keyword. Leave
the City column blank and Fudge gives each service its own stable shuffled choice
from the **Cities** tab, where
you paste your list (one city per row in column A; a thousand rows is fine).

For each requirement Fudge takes the first unfinished city in that service's shuffled
order, builds the query, and searches up to four Google result pages. Different
services therefore start in different places instead of all beginning at row one.
When Google has no next page or the four-page ceiling is reached, the combination is
marked `Exhausted` in **Search Progress** and is never searched again. The next sync
moves that service to its next shuffled city automatically.

Once a service starts a city, it stays there until that combination is exhausted. A
city that was only part-searched is resumed at the saved page, business position and
visited Place IDs rather than restarted, including after Chrome restarts.

Search Progress stays the single source of truth for exhaustion. The Cities tab
mirrors it for reading — `Status`, `Last Used` and `Exhausted Keywords` — and only
rows that actually changed are rewritten, so a thousand-city list is not rewritten on
every sync. The keyword/city matrix is never generated upfront; a Search Progress row
appears only once a city has really been searched.

Writing a city on a Structure row still overrides the list for that row. When every
city is exhausted for a keyword, the side panel says so instead of stalling quietly.

Once the current connector is deployed it creates missing tabs on demand, so you do
not need to re-run setup after that. Getting the current connector into an existing
Sheet does require the update steps above.

## Starting and stopping

Fudge has exactly one switch, and the two buttons at the top of the side panel are the
only things that move it. Nothing else — connecting a sheet, a sync, a finished job —
turns collecting on.

**Start collecting** does the navigating for you.

- On a Google Maps business or a Google Places results page, it scans the page you
  are looking at.
- Anywhere else, it takes the next outstanding Structure requirement, opens Google
  Places for it in a new foreground tab, and begins — you never have to go to Google
  yourself. The page limit you picked in the side panel is honoured.
- It also switches automatic fulfillment on, so Fudge keeps checking Structure every
  minute and opening Google itself until you stop it. The panel says **Running**.

Beside the automatic work there are manual buttons for when you would rather not wait
for anything. In the side panel under *Sheets automation*: **Fill rows now**,
**Rephrase now**, **Sync now** and **Repair**. In the Sheet's own **Fudge** menu:
**Rephrase now**, **Fill rows now**, **Test rephrasing** and **Rephrasing status**.
They do exactly what the triggers do and skip every cooldown.

**Stop collecting** ends every running scan, closes the tabs Fudge opened, and
switches automation off. Nothing opens again until you press Start. Reviews already
collected stay saved, and each scan's place in Google is kept in **Search Progress**,
so starting again resumes where it left off rather than from page one.
- The page selector offers 1, 2, 3, or 4 pages. Reaching that selected limit completes
  the keyword/city and advances to the next city; no scan can exceed four pages.
- With no sheet connected, or with nothing left to search, it says which of those it
  is instead of opening a tab.

The hourly automation uses the same path, just opening its tab in the background.

## How the search query is built

You never type a query. Fudge builds one from the Structure row's service keyword
and city, and it searches for **the speciality as written** — because the keyword is
what finds businesses whose reviews are actually about it:

| Service keyword in Structure | Google is searched for |
|---|---|
| `toilet replacement` | `toilet replacement in <city>` |
| `water heater replacement` | `water heater replacement in <city>` |
| `garage door track` | `garage door track in <city>` |
| `drywall texture matching` | `drywall texture matching in <city>` |
| `cabinet painting` | `cabinet painting in <city>` |
| `thermostat` | `thermostat in <city>` |

**Appliance repair is the one exception.** No business lists itself as a "washer
repair" company, so every appliance speciality collapses to the trade:

| Service keyword | Google is searched for |
|---|---|
| `washer repair`, `dryer repair` | `appliance repair in <city>` |
| `refrigerator not cooling`, `dishwasher repair` | `appliance repair in <city>` |

To make another family behave like appliances, add `collapseToFamily: true` to it in
`shared.js`; it will then use that family's `searchTerm`. A keyword Fudge does not
recognise at all is used verbatim.

The keyword is also what Fudge matches reviews against, but customers do not have to
repeat it word for word. Fudge combines flexible service signals, natural synonyms,
and Google's selected review topic. Phrases such as `put together our IKEA wardrobe`,
`off its rails`, and `fixed the hole in our wall` can satisfy Furniture Assembly,
Garage Door Track Repair, and Drywall Patch Repair respectively. Known conflicting
subsections remain separate, so a spring or opener review cannot satisfy a garage-door
track requirement.

**City is optional.** With a city the query is `<keyword> in <city>`; without one it is
just `<keyword>`, and the requirement can be filled from reviews collected in any city.
A Structure row with a review type but no service keyword is marked
**Needs a service keyword** rather than being skipped silently.

## Adjustable Google tabs

Fudge runs **three Places tabs in parallel by default**. Choose one to six in Scan
settings. Each tab handles a different service keyword, and they open a fraction of
a second apart. Increasing the limit fills free slots as soon as the next Sheet read
finds work. Decreasing it stops new tabs from opening; scans already underway finish.

Making this safe needed the job record to change: jobs are now stored per id under
`scanJobs`, and each tab checks its own job. Previously a single `scanJob` meant the
second tab's job overwrote the first's, and the first tab saw an unfamiliar id and
stopped itself.

**Stop** ends every running job and closes its tabs. Result pages are capped at
**four** per keyword/city.

## When Google blocks us

Fudge now recognises the rate-limit page — a `/sorry/` URL, a reCAPTCHA form, or
"unusual traffic" / "not a robot" text — and treats it as a pause, not as a result:

- The run stops with the stage **Blocked by Google**.
- The current business is **not** marked visited and `businessIndex` does not advance,
  so that work is retried rather than skipped forever.
- The keyword/city is **never** marked `Exhausted` because of a block.
- A cooldown starts immediately — 15 minutes for the first block episode, then 30,
  60 and 120 minutes if a retry is blocked again. Several tabs blocked during one
  active cooldown count as one episode. No new Google job opens until it expires;
  the next extension check resumes work. A clean run after the cooldown resets the
  ladder to 15 minutes.

There is no CAPTCHA solving or evasion here; the point is to stop politely and resume
later without losing work.

## Reviews without pictures

A photo-backed review is always preferred. If Fudge has been hunting one keyword for
**five minutes** without filling the requirement, it starts accepting complete
five-star reviews that have no photo, and writes **"No picture found"** in the picture
column so the row is obviously text-only.

## Opening a business

A click that lands while the previous review panel is still closing is swallowed by
Google and nothing happens. A single attempt then looks identical to "this business
has no reviews", and the business was skipped permanently.

Now the click is retried up to three times, and the first wait is short (1.2s) so a
business that opens immediately costs nothing extra. Fudge also waits for the previous
panel to actually clear before clicking the next business, instead of a flat delay, and
`openReviews` refuses to accept a feed whose first reviews are the ones already on
screen — so the previous business's reviews can never be read as the new one's.

## Scrolling the review feed

The feed is walked with an adaptive step rather than a fixed one:

- The step starts at 1.6 screens and grows to 2.6 while each scroll still **overlaps**
  the rows already read.
- If two consecutive screens share no review, the scroll jumped past rows that never
  rendered. Fudge rewinds one screen, halves the step and re-reads — so going faster
  can never silently skip reviews.
- Each scroll continues the moment new rows appear instead of waiting out a fixed
  delay. When nothing appears the step eases off, and a stalled lazy feed gets a small
  up-then-down nudge rather than being sat on.
- The scan job is read from storage at most every 400ms instead of on every pass.
- A sub-five-star row only ends the scan when the ratings on screen really are
  descending, so reading the feed in the instant after the sort is clicked cannot end
  it early.

## How the scan works

Fudge does not read every review. For each business it sorts the feed by **Highest
rating** and scrolls only as far as the five-star block goes:

1. Open the business and its reviews.
2. Select **Highest rating**. Both layouts are handled — the inline radiogroup in the
   Google Search *Places* dialog, and the sort *menu* behind a button on Google Maps.
3. Confirm the sort actually landed, in two ways: the control reports Highest, **and**
   the ratings now on screen are non-increasing. The click alone is not trusted.
4. Scroll, collecting five-star reviews that have photos, until a review below five
   stars appears. Because the order is descending, everything after it rates lower —
   so Fudge stops there and moves to the next business.

After the last business on a results page, Fudge follows Google's real `pnnext` link
to the next page. It uses the link URL directly because Google renders the visible
arrow inside a floated child, which can make the parent link report a zero-size box.
The city is marked complete after the Next control genuinely does not exist or after
page four, whichever happens first.

The next-page checkpoint is written to **Search Progress before navigation**. If the
tab reloads onto an older URL, Fudge restores the saved page instead of scanning page
one again. If Google reorders results, Fudge restarts only the current page and skips
visited Place IDs; it never resets the entire city to page one.

If the sort cannot be applied or the feed does not come back in descending order,
Fudge falls back to scrolling the whole feed. That is slower but never under-collects,
which is the failure that actually matters.

Scrolling waits for the next rows to render rather than sleeping for a fixed delay, so
a responsive feed is walked at the speed it can render. Against a 32-review test feed
holding 7 eligible reviews, the sorted path reads 12 cards in ~0.7 s where the full-feed
fallback reads all 32 in ~6.9 s, and both find the same 7 reviews.

## Changing the connected sheet

The side panel's **Connected sheet** row has **Open sheet** and **Change sheet**.
*Change sheet* reopens the setup page, where you can paste a different connector URL
or disconnect entirely. Disconnecting clears every cache tied to the old spreadsheet —
known review IDs, fingerprints and logged businesses — so the next sheet starts clean
instead of inheriting the previous one's "already known" sets.

## Ready and Used

Every review is **Ready** until you press **Used** on its row, which moves it to the
**Used** tab. Nothing is deleted — used reviews stay saved and **Restore** puts them
back. The side panel's counts, the "Freshly filed" list, *Copy for Sheets* and *Save to
Drive* all act on the tab you are looking at, so a review you have already published
stops showing up in your working set.

Reviews live in `chrome.storage.local`, which survives closing the browser. The
extension requests `unlimitedStorage` so a large library is neither capped at the
default quota nor evicted under storage pressure, and a failed write is now reported
instead of passing silently.

## Interface

The UI was rebuilt from a single design system. `styles.css` is layered in a fixed
order — fonts, tokens, reset, primitives, side panel, dashboard, utilities — and
overrides are never appended below the component layer; change a component or add a
token instead. `AUDIT.md` records what was wrong with the previous interface and why
each decision was made.

- **Type.** Space Grotesk (wordmark, headings, all numerals) and Inter (UI and body),
  bundled as variable `woff2` subsets in `assets/fonts/` so nothing is fetched at
  runtime. Nine sizes on one scale, four real weights, 11px floor, tabular numerals
  on every counter. See `assets/fonts/LICENSE.md`.
- **Tokens.** Spacing on a 4px scale, five radii, a three-step text ramp and two-step
  border ramp. Every text pairing on both surfaces passes WCAG AA.
- **Icons.** One inline SVG sprite per page — 24px grid, 1.75 stroke, `currentColor`.
- **Side panel.** The scan card is state-driven (`data-state` = idle / ready / running
  / done / error) and reports live page, business and review counts while a batch runs.
- **Dashboard.** 72px icon rail, sticky toolbar with search, sort and service filters,
  grouped tables sized to content, and a detail sheet for long reviews and photos past
  the fourth.
- **Accessibility.** `:focus-visible` on every control including the Drive switch,
  live regions on toasts and the table, `prefers-reduced-motion` and
  `forced-colors` support.

## Website writer

The review detail sheet in the dashboard has a **Website writer** section that rewrites a
collected review into publishable website copy using OpenAI's `gpt-5.6-luna`. The rewrite
removes business names, locations, dates and relative time phrases, weather references,
original phone numbers, and original staff names. It preserves the reviewer's first-person
voice and uses one replacement name from the Names tab. The Structure Service Keyword
is authoritative: the prompt converts conflicting season, product, subservice, or
  related-service details so the finished review consistently describes that keyword. The
  connector requires the configured rewrite phrase and rejects leftover conflicting services.

The only real phone number the writer may ever produce is yours — enter it (or several,
comma separated) once in the writer's phone field. The connector appends one of twelve
short contact lines so the wording varies while the supplied number stays exact. When the
phone field is empty, the rewrite contains no phone number or contact invitation. Your crew
  list is stored in the Names tab and is shuffled; every name is used once before a new
  random cycle begins.

Each rewrite is checked a second time locally before it is shown, so a leftover business
name, date, weather reference, original crew name, or foreign number is flagged in the panel for you to
regenerate rather than quietly published. "Call today" inside a CTA is understood as
marketing language, not a date. Rewrites are cached per review and copied with one click;
the original review and its photos are never modified.

### Automatic rephrasing into the Google Sheet

The **Structure** tab has **Numbers** in column L and **Rephrased Content** in
column M. Paste or change a review in **Review** (column E) and Apps Script
rewrites it into M. If L contains a phone number, the rewrite must include that
number; if L is empty, the rewrite contains no phone number. Changing Service Keyword,
City, Review, Business, or Numbers refreshes the previous copy, and clearing Review clears
M. The prompt and API call
live in Apps Script. An authorized edit trigger handles direct Sheet edits;
the one-minute trigger catches pasted/imported or script-written changes. Temporary API
failures use delayed retries and stop after three attempts; permanent request or key errors
stop immediately until the row is edited. Existing copy stays visible on a failed refresh,
and M displays its text without requiring the cell to be clicked. This works while Fudge is closed or uninstalled on
every computer, provided the Sheet's Apps Script remains installed, its trigger
is active, and `FUDGE_OPENAI_API_KEY` is configured. Rephrasing is deliberately
minimal: it preserves the original wording, order, tone, detail, and approximate
length, changing only prohibited names, locations, dates, weather, phone handling, service
terminology, and necessary grammar repairs.
The checker distinguishes the ordinary word “may” from the month “May” and asks
the writer to correct one failed draft automatically before reporting an error.

The Reviews tab keeps **Website Copy** in column R and **Phone** in column S for rewrites
created explicitly from the dashboard. Inventory rows are never rewritten automatically,
so collecting or syncing hundreds of reviews does not spend API credits. Automatic
rephrasing runs only for filled Structure rows; the original review remains unchanged.

### Setup

Get an OpenAI API key at platform.openai.com. Refresh the Sheet and choose **Fudge →
Set OpenAI API key**. The script saves it in Script properties; the key does not go in
the script source. Save and deploy the latest connector version. The dashboard's **Rewrite for
website** button also uses this connected script. If an API key was previously kept in
`config.js`, remove it and rotate that key because extension source files are readable.

## Privacy

Fudge stores collected review data and Used status locally in the browser via `chrome.storage.local`. The data survives closing and reopening Chrome and remains until the extension is removed, its site data is cleared, or a confirmed **Clear unused data** / **Clear Used data** action is used. When connected, it sends structured review data and selected image URLs only to the Apps Script web app deployed inside your own Google account.

## Stable unpacked extension ID

The public `key` in `manifest.json` fixes this development build to extension ID
`bhpbiejhocblflacbgkohbiejnhopdan`. The key is public identity material, not a password or connector secret. Adding it changes
the ID once for installations that previously relied on Chrome's path-derived unpacked
ID. Before the first reload of this version, copy or otherwise preserve any important
reviews stored by the previous installation; Chrome keeps extension storage isolated by
extension ID.
