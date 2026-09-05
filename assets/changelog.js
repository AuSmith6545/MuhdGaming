// Changelog — a plain data file, not Firestore. Whenever a feature ships,
// add an entry to the top of this array (newest first) and it goes live
// with the next deploy. No admin form, no write rules — just a list every
// signed-in friend can read on changelog.html.
//
// Entry shape: { date: 'YYYY-MM-DD', title: '...', summary: '...', details: [...] }
// - summary: one short sentence — the only thing shown on mobile's condensed
//   card, and the whole entry when there's nothing more to add (details: []).
// - details: bullet points shown as a formatted list. Desktop renders these
//   inline; mobile keeps just the summary and reveals this list in a
//   slide-out panel instead, so a long entry doesn't blow out every other
//   card's height in the list.

window.MG_CHANGELOG = [
  {
    date: '2026-09-04',
    title: 'Two votes to approve, and a much better installed app',
    summary: "A game only needs 2 yes votes now, anyone else can tag themselves as interested, and the home-screen app gets pull-to-refresh, faster launches and a proper edge-to-edge screen.",
    details: [
      "A game is approved as soon as 2 friends vote yes — no more waiting on votes that were never going to change the outcome.",
      "Once a game is approved, anyone who didn't vote can tag themselves \"interested\" on its page, so whoever's planning a session can see who's in without reopening the vote.",
      "Recommendation cards now show progress toward those 2 votes, with the full tally of yes/no underneath.",
      "Pull down from the top of any page to refresh — the whole page, nav and all, slides down with your finger.",
      "Today is now clearly marked on the month calendar.",
      "The installed app opens much faster, holds up on a patchy connection, and its content runs to the true bottom edge of the screen instead of stopping at a dark bar.",
      "A loading screen that gets stuck now tells you so and offers a Reload, instead of hanging silently.",
      "Confirmations and error messages are the app's own now, instead of the browser's grey system pop-ups.",
      "Behind the scenes: a security and speed pass over the whole site.",
    ],
  },
  {
    date: '2026-09-01',
    title: 'Games reorganized, new logo, smoother installed-app experience',
    summary: "Approved is now the default Games tab, search moved onto the page itself, a new mascot logo replaces the placeholder mark, and the installed app fixes a couple of rough PWA edges.",
    details: [
      "Games: Approved is now the first tab (it's the default view), search lives on the page itself instead of inside the filter drawer, and a stray scrollbar on the tab bar is fixed.",
      "Changelog moved off the main nav to a quiet link on the Dashboard.",
      "New mascot logo in the top nav, replacing the placeholder \"MG\" mark.",
      "The nav bar now stays pinned at the top instead of scrolling away, and the installed home-screen app no longer shows a white bar behind the status bar or home-indicator area.",
    ],
  },
  {
    date: '2026-08-30',
    title: 'A big batch of updates',
    summary: "Real yes/no voting, Steam price/release info, session history, away-tracking on the Calendar, and a security + mobile pass.",
    details: [
      "Votes are now real yes/no (not just presence), shown as a three-state progress bar.",
      "Recommendation cards show a game's Steam price and release date, and cover art links out to its Steam page.",
      "A new \"Check for Updates\" button on shelved games pulls its latest Steam news, to help decide whether it's worth another vote.",
      "The Games library got Approved/Archived tabs, plus search and platform/genre filters.",
      "Every game page now keeps a session history — how many times you've actually played it, and when.",
      "The Calendar can track when you're away, and warns if anyone's unavailable on a proposed session date.",
      "Withdrawing, archiving, demoting, or cancelling something is now locked to whoever proposed it (or an admin).",
      "A security pass tightened up link-safety across the site.",
      "The Dashboard picked up a hero carousel, and the whole site got a pass for mobile with a collapsing nav.",
    ],
  },
  {
    date: '2026-08-28',
    title: 'Profile pages',
    summary: 'Everyone now has a profile with a name and photo, shown wherever your activity shows up — notes, milestones, votes.',
    details: [],
  },
  {
    date: '2026-08-28',
    title: 'Self-service access requests',
    summary: "New folks can request access from the sign-in screen instead of needing to be added by hand first. Admins get a one-click approve.",
    details: [],
  },
  {
    date: '2026-08-28',
    title: 'Sign in with email, not just Google',
    summary: 'Added email/password sign-in alongside Google, for anyone who’d rather not use a Google account.',
    details: [],
  },
  {
    date: '2026-08-28',
    title: 'Edit and manage games',
    summary: 'Games and sessions can now be edited, cancelled, moved back for a re-vote, or archived.',
    details: [],
  },
  {
    date: '2026-08-28',
    title: 'MuhdGaming launched',
    summary: 'The site went live: Dashboard, Recommendations, Games, and Calendar.',
    details: [],
  },
];
