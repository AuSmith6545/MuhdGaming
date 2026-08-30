// Changelog — a plain data file, not Firestore. Whenever a feature ships,
// add an entry to the top of this array (newest first) and it goes live
// with the next deploy. No admin form, no write rules — just a list every
// signed-in friend can read on changelog.html.
//
// Entry shape: { date: 'YYYY-MM-DD', title: '...', body: '...' }

window.MG_CHANGELOG = [
  {
    date: '2026-08-30',
    title: 'Steam price & release date',
    body: "Recommendation cards and the game page now show a game's price and release date, pulled straight from Steam when you look it up — so you know what you're voting for before you vote.",
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
