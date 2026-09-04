# Architecture

A static site (hosted on GitHub Pages) with a Firebase backend. No server code — the browser talks directly to Firebase.

## Stack

| Piece | Tool | Notes |
|---|---|---|
| Hosting | GitHub Pages | Serves plain HTML/CSS/JS from this repo, free |
| Sign-in | Firebase Authentication (Google) | Friends sign in with their Google account |
| Database | Firebase Firestore | Stores games, sessions, to-dos; pushes live updates to every open tab |
| Server code | None | No Cloud Functions, no build step, no npm required |

Firebase's free "Spark" plan (no credit card) covers Auth + Firestore, with daily limits (~50k reads / 20k writes) far beyond what a friend group will use. We deliberately avoid Cloud Functions since Google now requires a billing account to enable them even on the free tier.

The Firebase config object embedded in the site's JS (apiKey, projectId, etc.) is **not a secret** — it's safe to commit to a public repo. Actual access control is enforced by Firestore Security Rules, not by hiding the config.

## Data model

This is the model as actually implemented in `assets/app.js` (the earlier planning version differed slightly — this is the source of truth now):

```
games (collection)
  └─ doc per game: title, platforms[], genres[], coopType, minPlayers, maxPlayers,
     description, storeUrl, steamAppId, image,
     status ("watchlist"/"proposed"/"approved"/"archived" — every transition
     reuses the same doc rather than creating a new one, so nothing has to be
     re-entered as an idea moves through the lifecycle:
       watchlist  → proposed   MG.promoteToVote     (open to any friend)
       proposed   → watchlist  MG.demoteToWatchlist  (proposer/admin only)
       proposed   → approved   unanimous yes (MG.setVote, auto)
       approved   → proposed   MG.demoteGame         (proposer/admin only)
       approved   → archived   MG.archiveGame        (proposer/admin only)
     "watchlist" doesn't get its own vote UI — it's a flat, no-pressure list
     (Watchlist page) for things worth remembering that aren't ready for a
     vote yet. A "proposed" game where every friend has voted but it didn't
     reach unanimous yes is a dead end without a status of its own: the
     Games page's Recommendations tab detects that case client-side
     (yes+no >= friendCount) and swaps its Yes/No buttons for
     Remove/Move-to-Watchlist instead),
     proposedBy {uid, name}, proposedAt, votes ({uid: true}),
     approvedAt, lastActivityAt (bumped on any milestone/todo write — this is
     what powers the Dashboard's "Recently Active" widget without a
     collection-group query)
     ├─ milestones (subcollection): title, status ("todo"/"doing"/"done"),
     │    order, createdBy, createdAt, updatedAt
     ├─ todos (subcollection): text, done, assignedTo, createdBy, createdAt, updatedAt
     └─ notes (subcollection): text, authorUid, authorName, authorPhoto, createdAt

sessions (collection)          ← the calendar
  └─ doc per session: gameId, gameTitle, dateTime,
     status ("proposed"/"accepted"/"cancelled" — cancelling doesn't delete the
     doc, it just drops out of the calendar's views),
     proposedBy {uid, name}, notes, createdAt, acceptedAt
     rsvps: { [uid]: {choice, name, photoURL} } — the name/photo are stored
     alongside each RSVP (not just the uid) since the `friends` collection is
     keyed by email, not uid, so there'd otherwise be no way to resolve whose
     vote is whose when rendering the list

friends (collection)           ← the allowlist
  └─ doc per friend, ID = email: displayName, photoURL, isAdmin (optional bool),
     joinedAt (set by MG.approveRequest only — a friend added by hand in the
     console skips it, so the Crew page's "member since" is best-effort, not
     guaranteed for every friend)

joinRequests (collection)      ← self-service "Request Access" queue
  └─ doc per request, ID = requester's uid: email, name, photoURL, requestedAt

users (collection)             ← live profile info, separate from `friends`
  └─ doc per person, ID = their uid: displayName, photoDataUrl (a small
     resized/compressed JPEG stored as a data URL — no Storage product
     needed, comfortably under Firestore's 1MiB document limit), email
     (stamped by MG.ready on every sign-in, not just a Profile save — this
     is the only link between `friends` (keyed by email) and `users` (keyed
     by uid); the Crew page reverse-looks-up each friend's uid through it to
     resolve their live name/photo instead of only the frozen friends-doc
     values)
```

**Why names/photos are stored twice.** Every place someone is credited (a game's `proposedBy`, a session's `rsvps`, a note's `authorName`, a milestone/to-do's `createdBy`) freezes their name at the moment they act — that's what lets those render without extra lookups. But it means a renamed friend's *old* activity would still show their old name, which isn't what "change your name" should mean. The `users` collection is the fix: every render resolves through `MG.resolveName(uid, frozenNameFallback)` / `MG.resolveAvatarHtml(...)`, which prefers a friend's live profile and only falls back to the frozen value if they've never visited the Profile page. Changing your name or photo on `profile.html` therefore updates it everywhere you've ever been credited, not just future activity.

**Admins** are just a friend doc with `isAdmin: true` — not hardcoded anywhere, for the same reason the friends list itself isn't (keeps identity out of git regardless of repo visibility). An admin sees a "Pending Requests" panel on the Dashboard: anyone who signs in but isn't yet a friend can hit "Request Access" on the gate screen, which writes a `joinRequests` doc with their exact email already attached — approving is then one click (creates the `friends` doc, clears the request) rather than typing an email into the Firestore console by hand. The console is still there as a fallback for adding/editing friends directly.

**No server-side approval/acceptance logic exists** — since the site is 100% static, the "unanimous vote → approved" and "enough RSVPs → accepted" rules run client-side: whoever casts the deciding vote/RSVP is whose browser writes the status change, inside a Firestore transaction (so two friends acting at once can't race into a bad state). All Firestore queries deliberately use only single-field equality filters with client-side sorting — no `orderBy` combined with a `where` on a different field — so the app never needs a Firestore composite index to be created by hand.

## Access control

Google sign-in proves *who* someone is, not that they're allowed in. Firestore Security Rules restrict all reads/writes to friends listed in a `friends` collection in Firestore itself (see `firestore.rules`) — **not** hardcoded in this repo. That's deliberate: none of your friends' emails, and nothing they type anywhere on the site (recommendations, comments, to-do text, calendar entries), ever touches git or GitHub. It all lives only in Firestore, gated by these rules.

Adding a friend = adding one document to the `friends` collection by hand in the Firebase console (Firestore Database → Data tab), doc ID = their email. No code change, no git commit, no redeploy.

## Steam integration

Firestore/Auth work by letting the browser talk to Firebase directly, which is why no server was needed for the core site. Steam's APIs don't allow that (no CORS support, and achievement data needs a secret API key), so reaching Steam goes through one small server-side piece in between — a **Cloudflare Worker** (free tier, no billing info required, ~100k requests/day). Written once, not maintained per game.

**Status: built and live.** Code lives in `worker/` in this repo. Deployed at:

```
https://muhdgaming-steam-proxy.ausmithdesign.workers.dev
```

Routes (both public, read-only, cached at the edge for an hour):

- `GET /appdetails?appid=NNN` → name, description, cover image, platforms, genres, co-op tags
- `GET /achievements?appid=NNN` → that game's real Steam achievement list (name, description, icon)

The Steam Web API key the achievements route needs is stored as a Cloudflare Worker **secret** (`STEAM_API_KEY`), set directly via `npx wrangler secret put STEAM_API_KEY` from the `worker/` folder — it's never in this repo. To redeploy after editing `worker/src/index.js`: `cd worker && npx wrangler deploy`.

**Site-side wiring: built.** The Propose/Edit Game form looks a title or Steam URL up via `/appdetails` and auto-fills title/description/cover/price/release date/platforms/genres; "Suggest from Steam" on a game's page seeds its milestone board by picking real achievements from `/achievements`; "Check for Updates" pulls that game's recent announcements from `/news` to help decide whether a shelved game is worth another vote. The self-updating-milestones stretch goal (auto-checking milestones as friends unlock the real achievement) stays future work — it needs friends to link a Steam ID and the stack's first recurring background job.

## Site structure

Plain static pages, no build step — sharing one stylesheet and one JS file so there's exactly one place to change a color or fix a bug:

```
index.html            Dashboard (home)
games.html             Recommendations / Approved / Archived, as tabs
watchlist.html          Flat, no-vote list of things worth keeping an eye on
game.html?id=          One game's milestones, to-dos, notes (Steam-achievement suggestions live here)
calendar.html          Propose + RSVP + browse sessions
crew.html               The roster — everyone with access, avatar + admin
                        badge + member-since, sorted oldest member first
profile.html            Your display name + photo (click the avatar in the nav)

assets/styles.css      The whole visual design system — one file
assets/app.js          Firebase init, the sign-in/friend gate, the nav bar,
                        and every Firestore write with real logic in it
                        (vote→approve, RSVP→accept, milestones, to-dos, notes)
```

Each page's own inline `<script>` only reads data and renders — the actual writes all funnel through `assets/app.js` so the transaction logic only has to be correct in one place.

## Sign-in methods

Google sign-in is the default, but Firebase Authentication → Sign-in method also has **Email/Password** enabled, for any friend who doesn't have or doesn't want to use a Google account — they create an account with any email address and a password they choose instead. Both methods populate the same `request.auth.token.email` that the security rules and the friends allowlist check, so nothing else about the app treats the two differently: adding that friend's email to the `friends` collection in the console is the exact same step either way.

## PWA / home-screen install

`manifest.json` + per-page `<head>` tags (manifest link, theme-color, `apple-mobile-web-app-*`, a favicon) let the site be added to a phone's home screen and launch full-screen, standalone, no browser chrome. `icons/` holds the app icon (192/512/maskable) and `icons/splash/` holds iOS's static launch-screen images (one per unique iPhone screen size, via `apple-touch-startup-image` — iOS's manifest-based splash auto-generation is unreliable for home-screen web apps, so explicit per-size images are the actual working mechanism). No service worker — not required for home-screen install, and skipped deliberately to avoid a caching layer that would need to stay in sync with every deploy.

**To do:** the current icon/splash artwork is a placeholder — solid `--accent` orange with the plain "MG" nav mark, generated to unblock install support, not a real design pass. Revisit once real branding exists, and consider replacing the static iOS launch image with an **animated** splash — that'd mean building it as an in-page loading animation (the `#mg-gate` "Loading…" state every page already shows while the sign-in gate resolves is the natural place) rather than the native `apple-touch-startup-image`, since Apple's mechanism only supports a static image.

**To do:** `body::after` (assets/styles.css) fills the bottom safe-area strip (home-indicator gesture area / Safari's bottom toolbar) with the page background on the Dashboard and Games grid, but the `#mg-gate` loading screen and `game.html`'s detail page were reported (2026-09-01, tested live on an installed iOS home-screen app over Remote Control, not locally) to still show a white bar there. Needs visual debugging with local files on desktop — can't be diagnosed blind over a live push-and-check loop, and it's not yet confirmed whether this is a real gap on those two page types specifically or another stale-cached-instance false alarm (installed iOS home-screen apps can keep showing an old page after a push; a re-add to home screen forces the update).

## One-time setup checklist

1. Create a Firebase project at console.firebase.google.com
2. Authentication → Sign-in method → enable Google
3. Firestore Database → Create database → production mode
4. Project settings → add a Web App → copy the `firebaseConfig` object into `index.html`
5. Authentication → Settings → Authorized domains → add the GitHub Pages domain
6. Firestore → Rules → paste in `firestore.rules`, edit the email allowlist, publish
7. Repo Settings → Pages → deploy from `main` branch, root
