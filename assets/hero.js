// Hero carousel slides for the Dashboard — same idea as assets/changelog.js:
// a plain data file, not Firestore, so you edit it directly and it goes
// live with the next deploy.
//
// Add a real `image` URL once you have artwork for a slide; until then (or
// for any slide left at null) it falls back to the same gradient +
// title-monogram placeholder used everywhere else a game has no cover art,
// so nothing ever looks broken or unfinished.
//
// Slide shape: { title, subtitle, image, cta: { label, href } | null }

window.MG_HERO_SLIDES = [
  {
    title: 'MuhdGaming',
    subtitle: 'Propose games, vote as a crew, and lock in session times — all in one place.',
    image: null,
    cta: { label: 'Propose a Game', href: 'recommendations.html' },
  },
  {
    title: 'This Week',
    subtitle: 'RSVP yes, maybe, or no, and see what sessions are coming up.',
    image: null,
    cta: { label: 'View Calendar', href: 'calendar.html' },
  },
  {
    title: "What's New",
    subtitle: "A running log of what's shipped recently on the site.",
    image: null,
    cta: { label: 'View Changelog', href: 'changelog.html' },
  },
];
