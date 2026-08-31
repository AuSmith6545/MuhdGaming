// Changelog — a plain data file, not Firestore. Whenever a feature ships,
// add an entry to the top of this array (newest first) and it goes live
// with the next deploy. No admin form, no write rules — just a list every
// signed-in friend can read on changelog.html.
//
// Entry shape: { date: 'YYYY-MM-DD', title: '...', body: '...' }

window.MG_CHANGELOG = [
  {
    date: '2026-08-30',
    title: 'A big batch of updates',
    body: "Votes are now real yes/no (not just presence), shown as a three-state progress bar, and recommendation cards show a game's Steam price and release date up front. Cover art links out to the game's Steam page, and a new \"Check for Updates\" button on shelved games pulls its latest Steam news to help decide whether it's worth another vote. The Games library got Approved/Archived tabs plus search and platform/genre filters, and every game page now keeps a session history — how many times you've actually played it, and when. The Calendar can track when you're away, and warns if anyone's unavailable on a proposed session date. Withdrawing, archiving, demoting, or cancelling something is now locked to whoever proposed it (or an admin), and a security pass tightened up link-safety across the site. The Dashboard picked up a hero carousel, and the whole site got a pass for mobile with a collapsing nav.",
  },
  {
    date: '2026-08-28',
    title: 'Profile pages',
    body: 'Everyone now has a profile with a name and photo, shown wherever your activity shows up — notes, milestones, votes.',
  },
  {
    date: '2026-08-28',
    title: 'Self-service access requests',
    body: "New folks can request access from the sign-in screen instead of needing to be added by hand first. Admins get a one-click approve.",
  },
  {
    date: '2026-08-28',
    title: 'Sign in with email, not just Google',
    body: 'Added email/password sign-in alongside Google, for anyone who’d rather not use a Google account.',
  },
  {
    date: '2026-08-28',
    title: 'Edit and manage games',
    body: 'Games and sessions can now be edited, cancelled, moved back for a re-vote, or archived.',
  },
  {
    date: '2026-08-28',
    title: 'MuhdGaming launched',
    body: 'The site went live: Dashboard, Recommendations, Games, and Calendar.',
  },
];
