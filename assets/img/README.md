# assets/img/

General site graphics — logo/wordmark art, hero banners, backgrounds, custom
game art, or any other imagery used across pages. Reference from HTML/CSS
with a relative path, e.g. `assets/img/hero-banner.jpg`.

This is separate from `icons/`, which is reserved for the PWA's
manifest-required app icons (`icons/icon-192.png`, `icons/icon-512.png`,
`icons/icon-maskable-512.png`, `icons/apple-touch-icon.png`) and iOS launch
screens (`icons/splash/`) — those have fixed filenames and sizes wired up in
`manifest.json` and each page's `<head>`, so real branding art that's meant
to *replace* the current placeholders (see the "To do" note in
ARCHITECTURE.md) goes there instead, keeping the existing filenames.

Keep files reasonably sized (compress/export web-optimized) since this is a
static GitHub Pages site with no image pipeline — whatever you commit here
ships as-is.
