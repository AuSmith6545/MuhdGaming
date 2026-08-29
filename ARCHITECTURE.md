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
     status ("proposed"/"approved"/"archived" — "archived" just drops it off the
     Games library; demoting an approved game back to a vote returns it to
     "proposed" and clears votes rather than adding a fourth status),
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

friends (collection)           ← the allowlist, managed by hand in the console
  └─ doc per friend, ID = email: displayName, photoURL
```

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

Still to build (site-side, not the proxy): wiring these routes into the actual recommendation form (paste a Steam URL → auto-fill) and the game-approval flow (seed the milestone board from `/achievements`). The self-updating-milestones stretch goal (auto-checking milestones as friends unlock the real achievement) stays future work — it needs friends to link a Steam ID and the stack's first recurring background job, so it's deliberately not blocking the two features above.

## Site structure

Plain static pages, no build step — sharing one stylesheet and one JS file so there's exactly one place to change a color or fix a bug:

```
index.html            Dashboard (home)
recommendations.html  Propose + vote on games
games.html             Approved game library
game.html?id=          One game's milestones, to-dos, notes (Steam-achievement suggestions live here)
calendar.html          Propose + RSVP + browse sessions

assets/styles.css      The whole visual design system — one file
assets/app.js          Firebase init, the sign-in/friend gate, the nav bar,
                        and every Firestore write with real logic in it
                        (vote→approve, RSVP→accept, milestones, to-dos, notes)
```

Each page's own inline `<script>` only reads data and renders — the actual writes all funnel through `assets/app.js` so the transaction logic only has to be correct in one place.

## Sign-in methods

Google sign-in is the default, but Firebase Authentication → Sign-in method also has **Email/Password** enabled, for any friend who doesn't have or doesn't want to use a Google account — they create an account with any email address and a password they choose instead. Both methods populate the same `request.auth.token.email` that the security rules and the friends allowlist check, so nothing else about the app treats the two differently: adding that friend's email to the `friends` collection in the console is the exact same step either way.

## One-time setup checklist

1. Create a Firebase project at console.firebase.google.com
2. Authentication → Sign-in method → enable Google
3. Firestore Database → Create database → production mode
4. Project settings → add a Web App → copy the `firebaseConfig` object into `index.html`
5. Authentication → Settings → Authorized domains → add the GitHub Pages domain
6. Firestore → Rules → paste in `firestore.rules`, edit the email allowlist, publish
7. Repo Settings → Pages → deploy from `main` branch, root
