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

Google sign-in proves *who* someone is, not that they're allowed in. Firestore Security Rules restrict all reads/writes to a hardcoded allowlist of friends' email addresses (see `firestore.rules`). Adding a friend = adding their email to that list and republishing the rule in the Firebase console (no redeploy of the site needed).

## One-time setup checklist

1. Create a Firebase project at console.firebase.google.com
2. Authentication → Sign-in method → enable Google
3. Firestore Database → Create database → production mode
4. Project settings → add a Web App → copy the `firebaseConfig` object into `index.html`
5. Authentication → Settings → Authorized domains → add the GitHub Pages domain
6. Firestore → Rules → paste in `firestore.rules`, edit the email allowlist, publish
7. Repo Settings → Pages → deploy from `main` branch, root
