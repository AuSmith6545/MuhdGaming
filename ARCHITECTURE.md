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

```
games (collection)
  └─ doc per game: title, platforms, genre, coopType, maxPlayers,
     description, link, status (proposed/approved/archived),
     proposedBy, votes
     ├─ milestones (subcollection): title, status, order, dueDate
     └─ todos (subcollection): text, done, assignedTo, createdBy

sessions (collection)          ← the calendar
  └─ doc per session: gameId, proposedDate/time, status (proposed/accepted),
     proposedBy, rsvps (map of uid -> yes/no/maybe), notes

friends (collection)           ← profile info, filled in on first sign-in
  └─ doc per friend: email, displayName, photoURL, joinedAt
```

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

## One-time setup checklist

1. Create a Firebase project at console.firebase.google.com
2. Authentication → Sign-in method → enable Google
3. Firestore Database → Create database → production mode
4. Project settings → add a Web App → copy the `firebaseConfig` object into `index.html`
5. Authentication → Settings → Authorized domains → add the GitHub Pages domain
6. Firestore → Rules → paste in `firestore.rules`, edit the email allowlist, publish
7. Repo Settings → Pages → deploy from `main` branch, root
