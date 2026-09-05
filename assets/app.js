// MuhdGaming shared app shell: Firebase init, the sign-in/friend gate,
// the nav bar, and every Firestore write the site makes. Each page's own
// script only handles rendering + reading data — every write with real
// logic (vote → approve, RSVP → accept, milestones, to-dos) lives here
// once, so the rule only has to be right in one place.

const firebaseConfig = {
  apiKey: "AIzaSyCA4so_tIljdGxTDsyP7vBnvnTkYG6ObuY",
  authDomain: "muhdgaming.firebaseapp.com",
  projectId: "muhdgaming",
  storageBucket: "muhdgaming.firebasestorage.app",
  messagingSenderId: "1086910389926",
  appId: "1:1086910389926:web:db03d6ba55fb09b00b9e67"
};
firebase.initializeApp(firebaseConfig);

const MG = {
  auth: firebase.auth(),
  db: firebase.firestore(),
  user: null,
  friends: [],
  friendCount: 0,
  isFriend: false,
  isAdmin: false,
  userProfiles: {}, // uid -> {displayName, photoDataUrl}, see MG.resolveName/resolveAvatar
  STEAM_PROXY: 'https://muhdgaming-steam-proxy.ausmithdesign.workers.dev',
  VOTES_TO_APPROVE: 2, // yes votes needed to auto-approve a recommendation — see MG.setVote
};
window.MG = MG;

/* ---------- small helpers ---------- */

MG.initials = function (name) {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  return (parts[0][0] + (parts[1] ? parts[1][0] : '')).toUpperCase();
};

MG.escapeHtml = function (str) {
  // Safe for both text content and quoted-attribute values (e.g. src="...")
  // — textContent round-tripping alone escapes & < > but not quote marks.
  const div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
};

MG.toDate = function (ts) {
  if (!ts) return null;
  return typeof ts.toDate === 'function' ? ts.toDate() : ts;
};

// 'YYYY-MM-DD' in the *local* calendar day — deliberately not
// date.toISOString().slice(0,10), which converts to UTC first and can
// silently shift the date by a day depending on timezone.
MG.toISODate = function (date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

MG.timeAgo = function (date) {
  if (!date) return '';
  const secs = Math.floor((Date.now() - date.getTime()) / 1000);
  if (secs < 60) return 'just now';
  const mins = Math.floor(secs / 60);
  if (mins < 60) return mins + (mins === 1 ? ' minute ago' : ' minutes ago');
  const hours = Math.floor(mins / 60);
  if (hours < 24) return hours + (hours === 1 ? ' hour ago' : ' hours ago');
  const days = Math.floor(hours / 24);
  if (days < 7) return days + (days === 1 ? ' day ago' : ' days ago');
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};

MG.formatDateTime = function (date) {
  if (!date) return '';
  return date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }) +
    ' · ' + date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
};

// Deterministic per-title cover gradient — same game always gets the same
// one of these, so it reads as "this game's color" rather than random.
const COVER_GRADIENTS = [
  'linear-gradient(135deg,#1a2530,#3a2413)',
  'linear-gradient(135deg,#1c150e,#3a2508)',
  'linear-gradient(135deg,#121820,#1c2c3a)',
  'linear-gradient(135deg,#181018,#2a1a10)',
];
MG.coverGradient = function (title) {
  let hash = 0;
  for (let i = 0; i < (title || '').length; i++) hash = (hash * 31 + title.charCodeAt(i)) | 0;
  return COVER_GRADIENTS[Math.abs(hash) % COVER_GRADIENTS.length];
};

// The gradient + oversized-initials watermark used wherever a game has no
// Steam header image — a real Steam image (when present) is layered over
// the top of this at full opacity, so this never has to look "broken",
// just quieter than a real cover.
MG.coverArtHtml = function (title, image) {
  return `
    ${image ? `<img src="${MG.escapeHtml(image)}" alt="">` : ''}
    <div class="glyph">${MG.escapeHtml((title || '?').slice(0, 2).toUpperCase())}</div>
  `;
};

// votes: { [uid]: true | false } — true is a yes, false is an explicit no,
// and a friend simply missing from the map hasn't voted yet at all.
MG.voteCounts = function (votes) {
  const vals = Object.values(votes || {});
  return {
    yes: vals.filter((v) => v === true).length,
    no: vals.filter((v) => v === false).length,
  };
};

// Renders the approval progress bar used on recommendation cards and the
// dashboard: MG.VOTES_TO_APPROVE segments, filled left-to-right as yes
// votes come in. Sized to the actual threshold rather than the whole
// crew on purpose — with only 2 needed, a bar sized to friendCount would
// sit almost empty right up until the moment it flips to approved and
// disappears from this list, making a game one vote away read as "barely
// started". No votes aren't shown here; that context lives in the mono
// tally line next to it instead. Math.min guards against ever rendering
// more filled segments than exist if this paints mid-transaction, between
// a vote landing and the resulting "approved" status catching up.
MG.approvalBarHtml = function (votes) {
  const yes = Math.min(MG.voteCounts(votes).yes, MG.VOTES_TO_APPROVE);
  return Array.from({ length: MG.VOTES_TO_APPROVE }, (_, i) =>
    `<div class="seg${i < yes ? ' on' : ''}"></div>`
  ).join('');
};

// interested: { [uid]: {name, photoURL} } — set by MG.setInterested, only
// ever meaningful once a game is approved.
MG.interestedCount = function (interested) {
  return Object.keys(interested || {}).length;
};

// Distinct friends who are "in" on an approved game: yes-voters plus anyone
// who's since tagged themselves interested. Kept as a Set rather than a
// simple sum — the UI only offers the interested toggle to non-yes-voters,
// but this stays correct even so (and if that ever changes).
MG.interestedTotal = function (votes, interested) {
  const uids = new Set(Object.keys(votes || {}).filter((uid) => votes[uid] === true));
  Object.keys(interested || {}).forEach((uid) => uids.add(uid));
  return uids.size;
};

MG.avatarHtml = function (name, photoURL, size) {
  const cls = 'avatar' + (size === 'sm' ? ' sm' : size === 'lg' ? ' lg' : '');
  if (photoURL) return `<div class="${cls} chamfer-xs"><img src="${MG.escapeHtml(photoURL)}" alt=""></div>`;
  return `<div class="${cls} chamfer-xs">${MG.escapeHtml(MG.initials(name))}</div>`;
};

// Prefers the live users/{uid} profile over whatever name/photo was frozen
// into a doc at write time — this is what makes a rename retroactive.
// Falls back to the frozen values (for anyone who's never set a custom
// profile) and finally to a plain "A friend" / no-photo state.
MG.resolveName = function (uid, fallbackName) {
  const profile = uid && MG.userProfiles[uid];
  return (profile && profile.displayName) || fallbackName || 'A friend';
};
MG.resolvePhoto = function (uid, fallbackPhoto) {
  const profile = uid && MG.userProfiles[uid];
  return (profile && profile.photoDataUrl) || fallbackPhoto || null;
};
MG.resolveAvatarHtml = function (uid, fallbackName, fallbackPhoto, size) {
  return MG.avatarHtml(MG.resolveName(uid, fallbackName), MG.resolvePhoto(uid, fallbackPhoto), size);
};

// Reads an <input type="file">'s image, downscales it to fit maxSize and
// compresses it to a JPEG data URL — small enough to store directly as a
// Firestore field (comfortably under its 1MiB document limit) with no
// separate file-storage service needed.
MG.resizeImageToDataUrl = function (file, maxSize) {
  return new Promise((resolve, reject) => {
    if (file.size > 20 * 1024 * 1024) {
      reject(new Error('That image is too large (max 20MB).'));
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Couldn't read that file."));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("That doesn't look like an image."));
      img.onload = () => {
        // The draw/encode step below runs inside this async callback, so a
        // thrown error here would otherwise never reach the reject() path
        // above — it'd be an unhandled exception and this promise would
        // simply never settle, leaving the caller's "Processing…" state
        // stuck forever with no error and no way to retry.
        try {
          const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
          const w = Math.round(img.width * scale), h = Math.round(img.height * scale);
          const canvas = document.createElement('canvas');
          canvas.width = w; canvas.height = h;
          canvas.getContext('2d').drawImage(img, 0, 0, w, h);
          resolve(canvas.toDataURL('image/jpeg', 0.82));
        } catch (err) {
          reject(err);
        }
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
};

// Saves the current friend's display name and (optional) photo, then
// reloads — simplest way to guarantee every cached/frozen value across the
// app (MG.user, MG.userProfiles, the nav) reflects the change consistently,
// same reasoning as the reload after email/password sign-up above.
MG.saveProfile = async function (fields) {
  const update = { displayName: fields.displayName };
  if (fields.photoDataUrl) {
    // Guard against ever silently exceeding Firestore's ~1MiB document
    // limit — not currently reachable with resizeImageToDataUrl's default
    // maxSize, but this fails with a clear message instead of a cryptic
    // Firestore error if that ever changes.
    if (fields.photoDataUrl.length > 700 * 1024) {
      throw new Error('That photo is too large after processing — try a different image.');
    }
    update.photoDataUrl = fields.photoDataUrl;
  }
  await MG.db.collection('users').doc(MG.user.uid).set(update, { merge: true });
  location.reload();
};

MG.parseSteamAppId = function (input) {
  if (!input) return null;
  const trimmed = input.trim();
  if (/^\d+$/.test(trimmed)) return trimmed;
  const m = trimmed.match(/\/app\/(\d+)/);
  return m ? m[1] : null;
};

// Only ever treat a stored URL (storeUrl, a Steam news link, ...) as safe
// to use for an href/target if it's plain http(s). The propose/edit form
// only ever writes real steampowered.com links here, but Firestore rules
// don't (and can't reasonably) enforce that at the field level — any friend
// can write any field to a game doc — so this is what actually stops a
// javascript: URL from running when someone clicks "View on Steam", not
// just what the form happens to produce.
MG.safeUrl = function (url) {
  if (typeof url !== 'string') return null;
  const trimmed = url.trim();
  return /^https?:\/\//i.test(trimmed) ? trimmed : null;
};

MG.fetchSteamDetails = async function (appId) {
  const res = await fetch(`${MG.STEAM_PROXY}/appdetails?appid=${encodeURIComponent(appId)}`);
  const data = await res.json();
  if (!res.ok || data.error) throw new Error(data.error || 'Steam lookup failed');
  return data;
};

MG.fetchSteamAchievements = async function (appId) {
  const res = await fetch(`${MG.STEAM_PROXY}/achievements?appid=${encodeURIComponent(appId)}`);
  const data = await res.json();
  if (!res.ok || data.error) throw new Error(data.error || 'Steam lookup failed');
  return data;
};

MG.fetchSteamNews = async function (appId) {
  const res = await fetch(`${MG.STEAM_PROXY}/news?appid=${encodeURIComponent(appId)}`);
  const data = await res.json();
  if (!res.ok || data.error) throw new Error(data.error || 'Steam lookup failed');
  return data;
};

/* ---------- nav + sign-in gate ---------- */

const NAV_ITEMS = [
  ['dashboard', 'Dashboard', 'index.html'],
  ['games', 'Games', 'games.html'],
  ['watchlist', 'Watchlist', 'watchlist.html'],
  ['calendar', 'Calendar', 'calendar.html'],
  ['crew', 'Crew', 'crew.html'],
];

function renderNav(activePage) {
  const navEl = document.getElementById('mg-nav');
  if (!navEl) return;
  navEl.className = 'mg-nav';

  const linksHtml = NAV_ITEMS.map(([page, label, href]) =>
    `<a href="${href}" class="nav-link${page === activePage ? ' active' : ''}">${label}</a>`
  ).join('');

  const user = MG.auth.currentUser;
  navEl.innerHTML = `
    <a href="index.html" class="brand">
      <img class="mark" src="assets/img/mascot-logo-nav.png" alt="MuhdGaming">
      <span class="wordmark">MUHDGAMING</span>
    </a>
    <button id="mg-nav-toggle" class="nav-toggle" type="button" aria-label="Menu" aria-expanded="false">
      <span></span><span></span><span></span>
    </button>
    <div id="mg-nav-panel" class="mg-nav-panel">
      <div class="links">${linksHtml}</div>
      <div class="row mg-nav-info">
        <span class="mono" style="font-size:11px; color:var(--ink-dim);">${MG.friendCount} IN CREW</span>
        ${user ? `<a href="profile.html" title="Your profile">${MG.resolveAvatarHtml(user.uid, user.displayName, user.photoURL)}</a>` : ''}
        <button id="mg-signout" class="btn btn-ghost btn-sm">Sign out</button>
      </div>
    </div>
  `;
  const signOutBtn = document.getElementById('mg-signout');
  if (signOutBtn) signOutBtn.onclick = () => MG.auth.signOut();

  // Mobile hamburger — the panel (links + friend count/avatar/sign-out) is
  // always in the DOM and laid out inline above the 860px breakpoint; below
  // it, styles.css turns it into a collapsed dropdown this toggles open.
  const toggle = document.getElementById('mg-nav-toggle');
  const panel = document.getElementById('mg-nav-panel');
  toggle.onclick = () => {
    const open = panel.classList.toggle('open');
    toggle.classList.toggle('open', open);
    toggle.setAttribute('aria-expanded', String(open));
  };
  panel.querySelectorAll('a, button').forEach((el) => {
    el.addEventListener('click', () => {
      panel.classList.remove('open');
      toggle.classList.remove('open');
      toggle.setAttribute('aria-expanded', 'false');
    });
  });
}

function showGate(state, message) {
  const gate = document.getElementById('mg-gate');
  const main = document.getElementById('mg-main');
  if (!gate) return;

  // A stuck "loading" state used to just hang there forever — the sign-in
  // check is a couple of chained Firestore reads, and on iOS a connection
  // that went stale while the phone was asleep can leave one of those
  // reads neither resolving nor rejecting for a long time. Whatever other
  // state we're moving to (including a fresh "loading"), clear any pending
  // timer from a previous one first so it can't fire late and stomp on
  // content that's since loaded fine.
  clearTimeout(MG._loadingTimer);

  if (state === 'ready') {
    gate.hidden = true;
    if (main) main.hidden = false;
    return;
  }
  if (main) main.hidden = true;
  gate.hidden = false;

  if (state === 'loading') {
    gate.className = 'loading';
    gate.textContent = 'Loading…';
    MG._loadingTimer = setTimeout(() => {
      // Only replace it if we're still on this exact loading screen — if
      // sign-in resolved (to any state) in the meantime this never fires,
      // since the state change above already cleared it.
      gate.className = 'empty-state';
      gate.innerHTML = `
        <p style="color:var(--ink-strong); font-size:16px;">This is taking longer than it should.</p>
        <p style="margin-top:8px;">Your connection may have gone stale — try reloading, or drag down from the top of the screen.</p>
        <button id="mg-reload" class="btn btn-primary" style="margin-top:16px;">Reload</button>
      `;
      document.getElementById('mg-reload').onclick = () => location.reload();
    }, 8000);
  } else if (state === 'signed-out') {
    gate.className = 'empty-state';
    gate.innerHTML = `
      <div class="stack" style="max-width:320px; margin:0 auto; text-align:left;">
        <p style="text-align:center; color:var(--ink-strong); font-size:16px;">Sign in to see the crew's games.</p>
        <button id="mg-signin-google" class="btn btn-primary">Sign in with Google</button>

        <div class="row" style="align-items:center; gap:10px; margin:6px 0;">
          <div style="flex:1; height:1px; background:var(--line);"></div>
          <span class="mono" style="font-size:10px; color:var(--ink-dim);">OR AN EMAIL ACCOUNT</span>
          <div style="flex:1; height:1px; background:var(--line);"></div>
        </div>

        <div class="field"><label>Name (only needed to create an account)</label><input id="mg-name" type="text"></div>
        <div class="field"><label>Email</label><input id="mg-email" type="email"></div>
        <div class="field"><label>Password</label><input id="mg-password" type="password"></div>
        <div class="row" style="gap:8px;">
          <button id="mg-email-signin" class="btn btn-ghost" style="flex:1;">Sign In</button>
          <button id="mg-email-signup" class="btn btn-ghost" style="flex:1;">Create Account</button>
        </div>
        <button id="mg-forgot" class="mono" type="button" style="background:none; border:none; color:var(--ink-dim); font-size:11px; text-align:left; padding:0; cursor:pointer; width:fit-content;">Forgot password?</button>

        <p id="mg-signin-err" class="mono" style="color:#ff8a6a; font-size:12px;"></p>
      </div>
    `;
    const errEl = document.getElementById('mg-signin-err');
    const showErr = (err) => { errEl.textContent = err.message || String(err); };

    document.getElementById('mg-signin-google').onclick = () => {
      const provider = new firebase.auth.GoogleAuthProvider();
      MG.auth.signInWithPopup(provider).catch(showErr);
    };
    document.getElementById('mg-email-signin').onclick = () => {
      const email = document.getElementById('mg-email').value.trim();
      const password = document.getElementById('mg-password').value;
      MG.auth.signInWithEmailAndPassword(email, password).catch(showErr);
    };
    document.getElementById('mg-email-signup').onclick = async () => {
      const name = document.getElementById('mg-name').value.trim();
      const email = document.getElementById('mg-email').value.trim();
      const password = document.getElementById('mg-password').value;
      if (!name) { showErr({ message: 'Enter your name to create an account.' }); return; }
      try {
        const cred = await MG.auth.createUserWithEmailAndPassword(email, password);
        await cred.user.updateProfile({ displayName: name });
        // onAuthStateChanged already fired (before the profile update finished), so
        // the rest of the app would otherwise render with a blank name — a full
        // reload is the simplest way to guarantee it picks up the name that was
        // just set, rather than chasing stale-state edge cases here.
        location.reload();
      } catch (err) {
        showErr(err);
      }
    };
    document.getElementById('mg-forgot').onclick = () => {
      const email = document.getElementById('mg-email').value.trim();
      if (!email) { showErr({ message: 'Enter your email first, then click this again.' }); return; }
      MG.auth.sendPasswordResetEmail(email)
        .then(() => { errEl.style.color = 'var(--accent)'; errEl.textContent = 'Password reset email sent.'; })
        .catch(showErr);
    };
  } else if (state === 'not-friend') {
    gate.className = 'empty-state';
    const user = MG.auth.currentUser;
    gate.innerHTML = `
      <p style="color:var(--ink-strong); font-size:16px;">This account isn't on the crew list yet.</p>
      <p style="margin-top:8px;">${MG.escapeHtml((user && user.email) || '')}</p>
      <div id="mg-request-area" style="margin-top:16px;">
        <p class="mono" style="font-size:11px; color:var(--ink-dim);">Checking for a pending request…</p>
      </div>
      <button id="mg-signout2" class="btn btn-ghost" style="margin-top:16px;">Sign out</button>
    `;
    document.getElementById('mg-signout2').onclick = () => MG.auth.signOut();

    const areaEl = document.getElementById('mg-request-area');
    MG.db.collection('joinRequests').doc(user.uid).get().then((reqDoc) => {
      if (reqDoc.exists) {
        areaEl.innerHTML = `<p style="color:var(--accent);">Request sent — you'll get access once it's approved.</p>`;
        return;
      }
      areaEl.innerHTML = `<button id="mg-request-access" class="btn btn-primary">Request Access</button>`;
      document.getElementById('mg-request-access').onclick = (e) => {
        e.target.disabled = true;
        MG.requestAccess().then(() => {
          areaEl.innerHTML = `<p style="color:var(--accent);">Request sent — you'll get access once it's approved.</p>`;
        }).catch((err) => {
          areaEl.innerHTML = `<p class="mono" style="color:#ff8a6a; font-size:12px;">${MG.escapeHtml(err.message)}</p>`;
        });
      };
    }).catch((err) => {
      areaEl.innerHTML = `<p class="mono" style="color:#ff8a6a; font-size:12px;">${MG.escapeHtml(err.message)}</p>`;
    });
  } else if (state === 'error') {
    gate.className = 'empty-state';
    gate.textContent = message || 'Something went wrong.';
  }
}

// Every page calls MG.ready('pagename', user => { ...render the page... }).
// It signs in, checks the friend allowlist, loads the crew roster, renders
// the nav, then hands control to the page.
MG.ready = function (activePage, onReady) {
  showGate('loading');
  MG.auth.onAuthStateChanged(async (user) => {
    MG.user = user;
    if (!user) {
      showGate('signed-out');
      return;
    }
    try {
      const friendDoc = await MG.db.collection('friends').doc(user.email).get();
      if (!friendDoc.exists) {
        MG.isFriend = false;
        showGate('not-friend');
        return;
      }
      MG.isFriend = true;
      MG.isAdmin = !!friendDoc.data().isAdmin;

      // Stamps this friend's email onto their own users/{uid} doc on every
      // sign-in (not just when they save a Profile edit) — `friends` is
      // keyed by email, `users` by uid, and this is the only link between
      // them. Without it, the Crew page could only ever resolve someone's
      // live name/photo if they'd already been credited on a game/session
      // somewhere; with it, it can look up anyone who's ever signed in.
      // Awaited (not fire-and-forget) so it's guaranteed committed before
      // the users snapshot just below is fetched.
      await MG.db.collection('users').doc(user.uid).set({ email: user.email }, { merge: true });

      // These two used to be awaited one after the other, which put three
      // sequential round trips (the stamp above, then friends, then users)
      // in front of the first pixel of every page — on a phone, on a weak
      // signal, that's the slowest thing between tapping the icon and
      // seeing anything. They don't depend on each other, so they go
      // together and cost one trip instead of two. The users read is the
      // heavier of the pair: profile docs carry base64 avatars, so it
      // grows with the crew.
      const [friendsSnap, usersSnap] = await Promise.all([
        MG.db.collection('friends').get(),
        MG.db.collection('users').get(),
      ]);
      MG.friends = friendsSnap.docs.map(d => ({ email: d.id, ...d.data() }));
      MG.friendCount = MG.friends.length;

      MG.userProfiles = {};
      usersSnap.docs.forEach((d) => { MG.userProfiles[d.id] = d.data(); });

      renderNav(activePage);
      showGate('ready');
      onReady(user);
    } catch (err) {
      console.error(err);
      showGate('error', 'Could not load your crew data — ' + err.message);
    }
  });
};

/* ---------- drag-to-refresh ---------- */

// A Home Screen install has no browser chrome, so it also has none of
// Mobile Safari's native pull-to-refresh — that gesture is a Safari-tab
// feature, not something WebKit gives a standalone web app for free. This
// is a minimal from-scratch stand-in: drag down from the very top of the
// page and past a threshold, release, and it reloads. Deliberately wired
// up unconditionally at load — not gated behind sign-in — so it's still
// available as an escape hatch even while the loading gate itself is the
// thing that's stuck (see showGate's own loading-timeout for the other
// half of that fix).
MG.initPullToRefresh = function () {
  const THRESHOLD = 70;
  const MAX_PULL = THRESHOLD + 34; // where the pull tops out, however hard you drag
  let startY = 0, dragY = 0, dragging = false, refreshing = false;

  const pill = document.createElement('div');
  pill.id = 'mg-pull-refresh';
  document.body.appendChild(pill);

  // The whole page travels down as you pull, nav included, revealing the
  // message underneath it. The transform goes on <html> rather than <body>
  // for a specific reason: a transformed element becomes the containing
  // block for its position:fixed descendants, and the nav is fixed. <body>
  // carries padding-top — the space reserved for that very nav — and a
  // fixed child resolves its `top` against the containing block's PADDING
  // box, so transforming <body> would drop the nav by that 64px + notch the
  // instant a drag began. <html> has no padding, so everything travels
  // together and nothing jumps.
  //
  // The strip this opens up at the top needs no drawing of its own: the
  // page background lives on <html> and propagates to the canvas, which
  // stays put regardless of the transform. That's the same background move
  // that fixed the iOS white bar — this effect gets a seamless backdrop out
  // of it for free.
  const root = document.documentElement;

  // A drawer/modal/menu open over the page has its own scrolling and its
  // own reason to be dragged on — this stays out of the way of all of them
  // rather than trying to reload the app out from under an open one.
  function overlayOpen() {
    return !!document.querySelector(
      '#mg-modal-backdrop, .side-drawer.open, .side-drawer-backdrop.open, .menu-panel.open, #mg-nav-panel.open, #cal-detail-backdrop.open'
    );
  }

  // animate is for the release, when the page eases back or settles at the
  // refresh position. While a finger is actually down there's no transition
  // at all — the page has to track the drag exactly, not lag behind it.
  function setDrag(px, animate) {
    dragY = px;
    const ease = animate ? 'transform .24s cubic-bezier(.22,.61,.36,1)' : '';
    root.style.transition = ease;
    pill.style.transition = animate ? ease + ', opacity .24s ease' : '';
    // Cleared to empty, never translateY(0): at rest the transform has to be
    // gone entirely, or <html> stays the containing block for every fixed
    // drawer and modal in the app and their bottom:0 would anchor to the
    // document's full height instead of the viewport.
    root.style.transform = px > 0 ? `translateY(${px}px)` : '';
    // Cancels that same movement on the pill, so it holds still in the nav's
    // own place while the nav slides down off it.
    pill.style.transform = `translate(-50%, ${-px}px)`;
    pill.style.opacity = px > 6 ? '1' : '0';
    pill.classList.toggle('armed', px > THRESHOLD);
    pill.textContent = refreshing ? 'REFRESHING…' : px > THRESHOLD ? 'RELEASE TO REFRESH' : 'PULL TO REFRESH';
  }

  // passive:true throughout — this never calls preventDefault, so it never
  // fights the page's own scrolling. It only ever reads the same finger
  // movement scrolling would, and only acts on it when there was nowhere
  // left to scroll to begin with (scrollY 0, dragging down from there).
  document.addEventListener('touchstart', (e) => {
    if (refreshing || dragging || overlayOpen() || window.scrollY > 0 || e.touches.length !== 1) return;
    // Drop any easing left over from the last release, so this drag starts
    // tracking the finger from the first pixel.
    root.style.transition = '';
    pill.style.transition = '';
    startY = e.touches[0].clientY;
    dragging = true;
  }, { passive: true });

  document.addEventListener('touchmove', (e) => {
    if (!dragging || refreshing) return;
    const dy = e.touches[0].clientY - startY;
    if (dy <= 0 || window.scrollY > 0) { dragging = false; setDrag(0, true); return; }
    // Half-speed and capped: resistance, so the page follows the finger
    // without flying open, and a hard yank can't drag the nav off-screen.
    setDrag(Math.min(dy * 0.5, MAX_PULL));
  }, { passive: true });

  function endDrag() {
    if (!dragging) return;
    dragging = false;
    if (dragY > THRESHOLD) {
      refreshing = true;
      setDrag(THRESHOLD, true); // hold it open on "Refreshing…" until the reload lands
      location.reload();
    } else {
      setDrag(0, true);
      // Drop the inline transition once the page has settled back, so it
      // isn't left on the element between gestures.
      setTimeout(() => {
        if (!dragging) { root.style.transition = ''; pill.style.transition = ''; }
      }, 260);
    }
  }
  document.addEventListener('touchend', endDrag);
  document.addEventListener('touchcancel', endDrag);
};
MG.initPullToRefresh();

// Registers the service worker that caches the app shell (see sw.js for
// what it does and does not cache — live Firestore data is never cached).
// Deliberately waits for load: registration is a background nicety and has
// no business competing with the first paint for bandwidth. A failure here
// is silent on purpose — the site works exactly as before without it, so
// there's nothing a friend could usefully do about an error message.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}

/* ---------- writes: games / watchlist / recommendations ---------- */

MG.proposeGame = async function (fields) {
  const uid = MG.user.uid;
  const doc = {
    title: fields.title,
    platforms: fields.platforms || [],
    genres: fields.genres || [],
    coopType: fields.coopType || '',
    minPlayers: fields.minPlayers || 2,
    maxPlayers: fields.maxPlayers || 4,
    description: fields.description || '',
    storeUrl: fields.storeUrl || '',
    steamAppId: fields.steamAppId || null,
    image: fields.image || null,
    price: fields.price || '',
    releaseDate: fields.releaseDate || '',
    status: 'proposed',
    proposedBy: { uid, name: MG.user.displayName },
    proposedAt: firebase.firestore.FieldValue.serverTimestamp(),
    votes: {},
    interested: {},
  };
  const ref = await MG.db.collection('games').add(doc);
  return ref.id;
};

// Adds a game straight to the Watchlist — same shape/fields as proposeGame,
// just parked as "on our radar" instead of immediately opening a vote.
// MG.promoteToVote later reuses this same doc, so nothing has to be
// re-entered when it's ready to actually go up for a vote.
MG.addToWatchlist = async function (fields) {
  const uid = MG.user.uid;
  const doc = {
    title: fields.title,
    platforms: fields.platforms || [],
    genres: fields.genres || [],
    coopType: fields.coopType || '',
    minPlayers: fields.minPlayers || 2,
    maxPlayers: fields.maxPlayers || 4,
    description: fields.description || '',
    storeUrl: fields.storeUrl || '',
    steamAppId: fields.steamAppId || null,
    image: fields.image || null,
    price: fields.price || '',
    releaseDate: fields.releaseDate || '',
    status: 'watchlist',
    proposedBy: { uid, name: MG.user.displayName },
    proposedAt: firebase.firestore.FieldValue.serverTimestamp(),
    votes: {},
    interested: {},
  };
  const ref = await MG.db.collection('games').add(doc);
  return ref.id;
};

// Promotes a Watchlist entry into a fresh vote — open to any friend (not
// just the one who added it), the same as proposing a brand-new game is:
// it's a forward, additive action, not undoing someone else's work.
MG.promoteToVote = async function (gameId) {
  await MG.db.collection('games').doc(gameId).update({
    status: 'proposed',
    votes: {},
    interested: {},
    proposedAt: firebase.firestore.FieldValue.serverTimestamp(),
    lastActivityAt: firebase.firestore.FieldValue.serverTimestamp(),
  });
};

// Shelves an in-progress vote back to the Watchlist — for an idea that
// isn't gaining traction, or one that finished a full vote without reaching
// MG.VOTES_TO_APPROVE yeses. Unlike promoting, this DOES undo an active
// proposal, so firestore.rules restricts it to the proposer or an admin,
// same as archiving/demoting a game. Clears votes/interested so a future
// re-promote starts clean.
MG.demoteToWatchlist = async function (gameId) {
  await MG.db.collection('games').doc(gameId).update({
    status: 'watchlist',
    votes: {},
    interested: {},
    lastActivityAt: firebase.firestore.FieldValue.serverTimestamp(),
  });
};

// Edits an existing game's details in place — same fields as proposeGame,
// none of votes/status/proposedBy touched.
MG.updateGame = async function (gameId, fields) {
  await MG.db.collection('games').doc(gameId).update({
    title: fields.title,
    platforms: fields.platforms || [],
    genres: fields.genres || [],
    minPlayers: fields.minPlayers || 2,
    maxPlayers: fields.maxPlayers || 4,
    description: fields.description || '',
    storeUrl: fields.storeUrl || '',
    steamAppId: fields.steamAppId || null,
    image: fields.image || null,
    price: fields.price || '',
    releaseDate: fields.releaseDate || '',
    lastActivityAt: firebase.firestore.FieldValue.serverTimestamp(),
  });
};

// Withdraws a recommendation. A freshly-proposed game never has
// milestones/todos/notes, but a *demoted* one (sent back to a vote by
// MG.demoteGame, which deliberately preserves its subcollections) can —
// so this cleans those up too rather than leaving them orphaned under a
// deleted parent doc.
MG.withdrawGame = async function (gameId) {
  const gameRef = MG.db.collection('games').doc(gameId);
  for (const sub of ['milestones', 'todos', 'notes']) {
    const snap = await gameRef.collection(sub).get();
    if (!snap.empty) {
      const batch = MG.db.batch();
      snap.docs.forEach((d) => batch.delete(d.ref));
      await batch.commit();
    }
  }
  await gameRef.delete();
};

// Sends an approved game back to a fresh vote — clears the old votes and
// interested tags so the crew re-decides from scratch. Milestones/todos/notes
// are left untouched so nothing is lost if it gets re-approved later.
MG.demoteGame = async function (gameId) {
  await MG.db.collection('games').doc(gameId).update({
    status: 'proposed',
    votes: {},
    interested: {},
    lastActivityAt: firebase.firestore.FieldValue.serverTimestamp(),
  });
};

// Retires an approved game without deleting its history — just drops off
// the active Games library.
MG.archiveGame = async function (gameId) {
  await MG.db.collection('games').doc(gameId).update({
    status: 'archived',
    lastActivityAt: firebase.firestore.FieldValue.serverTimestamp(),
  });
};

// Sets (or clears, if you click your current choice again) the current
// friend's yes/no vote; auto-approves the moment MG.VOTES_TO_APPROVE friends
// have voted yes specifically — a "no" counts the same as not having voted
// yet for approval purposes, it just makes the disagreement visible instead
// of silent. Two friends agreeing is enough to greenlight planning; nobody
// else has to vote at all — once approved, MG.setInterested lets anyone who
// didn't vote flag themselves as in without reopening the vote. Wrapped in a
// transaction so two friends voting at once can't both think they cast the
// deciding vote.
MG.setVote = async function (gameId, choice) {
  const uid = MG.user.uid;
  const ref = MG.db.collection('games').doc(gameId);

  await MG.db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return;
    const data = snap.data();
    const votes = Object.assign({}, data.votes || {});
    if (votes[uid] === choice) delete votes[uid]; else votes[uid] = choice;

    const update = { votes };
    const yesCount = Object.values(votes).filter((v) => v === true).length;
    if (data.status === 'proposed' && yesCount >= MG.VOTES_TO_APPROVE) {
      update.status = 'approved';
      update.approvedAt = firebase.firestore.FieldValue.serverTimestamp();
      update.lastActivityAt = firebase.firestore.FieldValue.serverTimestamp();
    }
    tx.update(ref, update);
  });
};

// Lets a friend who didn't vote (or voted no) flag themselves "interested"
// on an already-approved game — visible to whoever's planning a session,
// without reopening a vote that's no longer necessary once 2 friends have
// said yes. Toggles like setVote's choice does: clicking again clears it.
// Name/photo are frozen in alongside the uid for the same reason rsvps does
// it — `friends` is keyed by email, not uid, so there's no other way to
// resolve whose interest is whose when rendering the list.
MG.setInterested = async function (gameId, interested) {
  const uid = MG.user.uid;
  const ref = MG.db.collection('games').doc(gameId);

  await MG.db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return;
    const data = snap.data();
    const map = Object.assign({}, data.interested || {});
    if (interested) {
      map[uid] = { name: MG.user.displayName, photoURL: MG.user.photoURL || null };
    } else {
      delete map[uid];
    }
    tx.update(ref, { interested: map });
  });
};

/* ---------- writes: milestones / to-dos / notes ---------- */

function touchGame(batch, gameId) {
  batch.update(MG.db.collection('games').doc(gameId), {
    lastActivityAt: firebase.firestore.FieldValue.serverTimestamp(),
  });
}

// Milestones/todos/notes stay collaborative — any friend can add to or
// change one, same as always. What's new is updatedBy/updatedByUid: it
// starts equal to whoever created the item and moves to whoever last
// changed its status/done state, so "who's actually doing this" is visible
// without locking who's allowed to touch it. A real assign/resolve model
// (distinct creator vs. resolver, an explicit "done by") is the planned
// next step once this is in place.
MG.addMilestone = async function (gameId, title) {
  const batch = MG.db.batch();
  const ref = MG.db.collection('games').doc(gameId).collection('milestones').doc();
  batch.set(ref, {
    title, status: 'todo', order: Date.now(),
    createdBy: MG.user.displayName, createdByUid: MG.user.uid,
    updatedBy: MG.user.displayName, updatedByUid: MG.user.uid,
    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
  });
  touchGame(batch, gameId);
  await batch.commit();
};

MG.setMilestoneStatus = async function (gameId, milestoneId, status) {
  const batch = MG.db.batch();
  batch.update(MG.db.collection('games').doc(gameId).collection('milestones').doc(milestoneId), {
    status,
    updatedBy: MG.user.displayName, updatedByUid: MG.user.uid,
    updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
  });
  touchGame(batch, gameId);
  await batch.commit();
};

MG.addTodo = async function (gameId, text) {
  const batch = MG.db.batch();
  const ref = MG.db.collection('games').doc(gameId).collection('todos').doc();
  batch.set(ref, {
    text, done: false, assignedTo: null,
    createdBy: MG.user.displayName, createdByUid: MG.user.uid,
    updatedBy: MG.user.displayName, updatedByUid: MG.user.uid,
    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
  });
  touchGame(batch, gameId);
  await batch.commit();
};

MG.toggleTodo = async function (gameId, todoId, done) {
  const batch = MG.db.batch();
  batch.update(MG.db.collection('games').doc(gameId).collection('todos').doc(todoId), {
    done,
    updatedBy: MG.user.displayName, updatedByUid: MG.user.uid,
    updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
  });
  touchGame(batch, gameId);
  await batch.commit();
};

MG.addNote = async function (gameId, text) {
  await MG.db.collection('games').doc(gameId).collection('notes').add({
    text,
    authorUid: MG.user.uid,
    authorName: MG.user.displayName,
    authorPhoto: MG.user.photoURL || null,
    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
  });
};

/* ---------- writes: sessions / calendar ---------- */

MG.proposeSession = async function (fields) {
  const uid = MG.user.uid;
  const doc = {
    gameId: fields.gameId,
    gameTitle: fields.gameTitle,
    dateTime: firebase.firestore.Timestamp.fromDate(fields.dateTime),
    status: 'proposed',
    proposedBy: { uid, name: MG.user.displayName },
    // Each RSVP carries the friend's name/photo alongside their choice —
    // not just their uid — so any page can render "who said yes" without
    // a separate uid -> profile lookup (the friends list is keyed by
    // email, not uid, so that lookup isn't otherwise available).
    rsvps: { [uid]: { choice: 'yes', name: MG.user.displayName, photoURL: MG.user.photoURL || null } },
    notes: fields.notes || '',
    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
  };
  const ref = await MG.db.collection('sessions').add(doc);
  return ref.id;
};

// Sets the current friend's RSVP; auto-accepts once "yes" RSVPs reach the
// game's minimum player count, and auto-demotes back to "proposed" if a
// changed RSVP drops an accepted session back below that count. Transaction-
// wrapped for the same reason as setVote above.
MG.setRsvp = async function (sessionId, choice) {
  const uid = MG.user.uid;
  const ref = MG.db.collection('sessions').doc(sessionId);
  await MG.db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists || snap.data().status === 'cancelled') return;
    const data = snap.data();
    const rsvps = Object.assign({}, data.rsvps || {}, {
      [uid]: { choice, name: MG.user.displayName, photoURL: MG.user.photoURL || null },
    });
    const update = { rsvps };

    if (data.status === 'proposed' || data.status === 'accepted') {
      const yesCount = Object.values(rsvps).filter(v => v.choice === 'yes').length;
      const gameSnap = await tx.get(MG.db.collection('games').doc(data.gameId));
      const minPlayers = (gameSnap.exists && gameSnap.data().minPlayers) || 2;
      if (data.status === 'proposed' && yesCount >= minPlayers) {
        update.status = 'accepted';
        update.acceptedAt = firebase.firestore.FieldValue.serverTimestamp();
      } else if (data.status === 'accepted' && yesCount < minPlayers) {
        update.status = 'proposed';
      }
    }
    tx.update(ref, update);
  });
};

// Edits an existing session's date/time and notes.
MG.updateSession = async function (sessionId, fields) {
  const update = {};
  if (fields.dateTime) update.dateTime = firebase.firestore.Timestamp.fromDate(fields.dateTime);
  if (fields.notes !== undefined) update.notes = fields.notes;
  await MG.db.collection('sessions').doc(sessionId).update(update);
};

// Cancels a session — it drops out of the calendar's normal views but the
// doc (and its RSVP history) isn't deleted.
MG.cancelSession = async function (sessionId) {
  await MG.db.collection('sessions').doc(sessionId).update({ status: 'cancelled' });
};

/* ---------- writes: unavailability (calendar "away" ranges) ---------- */

// start/end are 'YYYY-MM-DD' strings (inclusive both ends), straight out of
// a <input type="date"> — no Date/Timestamp conversion, so there's no
// timezone math to get wrong for a plain calendar-day range. Any friend can
// mark (or later remove) any entry, same trust model as the rest of the
// app — this isn't trying to police who's "allowed" to say they're away.
MG.addUnavailability = async function (fields) {
  const uid = MG.user.uid;
  await MG.db.collection('unavailability').add({
    uid,
    name: MG.user.displayName,
    start: fields.start,
    end: fields.end,
    note: fields.note || '',
    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
  });
};

MG.deleteUnavailability = async function (entryId) {
  await MG.db.collection('unavailability').doc(entryId).delete();
};

MG.fetchUnavailability = async function () {
  const snap = await MG.db.collection('unavailability').get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
};

// Display names of anyone marked away covering a given 'YYYY-MM-DD' date —
// shared by the Propose/Edit Session modals and the calendar's month grid.
MG.awayNamesOn = function (dateStr, entries) {
  return (entries || [])
    .filter((u) => u.start <= dateStr && dateStr <= u.end)
    .map((u) => MG.resolveName(u.uid, u.name));
};

/* ---------- join requests (self-service "Request Access") ---------- */

// Doc ID is the requester's own uid, so a repeat click upserts instead of
// piling up duplicate requests.
MG.requestAccess = async function () {
  const user = MG.auth.currentUser;
  await MG.db.collection('joinRequests').doc(user.uid).set({
    email: user.email,
    name: user.displayName || user.email,
    photoURL: user.photoURL || null,
    requestedAt: firebase.firestore.FieldValue.serverTimestamp(),
  });
};

// Admin-only (enforced by firestore.rules, not just this function): creates
// the friend doc — the email is already known exactly, no typing required —
// then clears the request.
MG.approveRequest = async function (uid, email, name) {
  const batch = MG.db.batch();
  // merge: true — if this email already has a friend doc (e.g. an admin
  // pre-provisioned it with isAdmin: true before the person requested
  // access), approving must not silently wipe that out. joinedAt only
  // gets set here (there's no other code path that creates a friend doc —
  // hand-adding one in the console skips it), so a hand-added friend just
  // won't show a "member since" on the Crew page, same as any other field
  // you'd normally set through the app but typed in by hand instead.
  batch.set(MG.db.collection('friends').doc(email), {
    displayName: name,
    joinedAt: firebase.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });
  batch.delete(MG.db.collection('joinRequests').doc(uid));
  await batch.commit();
};

MG.declineRequest = async function (uid) {
  await MG.db.collection('joinRequests').doc(uid).delete();
};

// Shared "⋯" overflow menu — used on condensed cards (Vote strip,
// Watchlist) and the game detail banner to keep secondary actions from
// crowding out the primary one(s). Call after rendering menu markup
// (a `.menu` wrapping a `[data-menu-btn]` button + a `.menu-panel`); safe
// to call repeatedly on the same DOM, each button is only wired once.
//
// The panel is positioned via fixed coordinates computed from the
// button's own rect, not CSS position:absolute — the Vote strip's cards
// sit in a horizontally scrolling row, and overflow-x:auto on that
// ancestor would silently clip an absolutely-positioned panel (CSS forces
// overflow-y to clip too whenever overflow-x isn't visible).
MG.closeAllMenus = function () {
  document.querySelectorAll('.menu-panel.open').forEach((p) => p.classList.remove('open'));
};
MG.initMenus = function (root) {
  (root || document).querySelectorAll('[data-menu-btn]').forEach((btn) => {
    if (btn.dataset.menuBound) return;
    btn.dataset.menuBound = '1';
    const panel = btn.nextElementSibling;
    btn.onclick = (e) => {
      e.stopPropagation();
      const willOpen = !panel.classList.contains('open');
      MG.closeAllMenus();
      if (willOpen) {
        const rect = btn.getBoundingClientRect();
        panel.style.top = `${rect.bottom + 6}px`;
        panel.style.right = `${window.innerWidth - rect.right}px`;
        panel.classList.add('open');
        // Scrolling anything (the page, or the Vote strip itself)
        // invalidates that fixed position rather than tracking it live.
        window.addEventListener('scroll', MG.closeAllMenus, { capture: true, once: true });
      }
    };
  });
};
document.addEventListener('click', MG.closeAllMenus);

/* ---------- shared modals (used from Dashboard, Games, Watchlist, Calendar) ---------- */

MG.closeModal = function () {
  const el = document.getElementById('mg-modal-backdrop');
  if (el) el.remove();
};

MG.openModal = function (innerHtml) {
  MG.closeModal();
  const backdrop = document.createElement('div');
  backdrop.id = 'mg-modal-backdrop';
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `<div class="panel chamfer modal">${innerHtml}</div>`;
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) MG.closeModal(); });
  document.body.appendChild(backdrop);
  return backdrop;
};

// Stand-ins for the browser's own confirm()/alert(), built on the modal
// above. Worth the swap for two reasons: in an installed Home Screen app
// the native dialogs are headed "muhdgaming.github.io says…", which is the
// one place the app stops looking like an app; and a native confirm() for
// something irreversible (withdrawing a game, cancelling a session) is the
// least considered UI in a site that otherwise sweats its details.
//
// Both return a promise rather than blocking the way the native pair does,
// so callers await the answer instead of branching on it inline.
MG.confirmModal = function (message, options) {
  const opts = options || {};
  const confirmLabel = opts.confirmLabel || 'Confirm';
  return new Promise((resolve) => {
    const modal = MG.openModal(`
      <div class="eyebrow">${MG.escapeHtml(opts.eyebrow || 'Confirm')}</div>
      <h2 style="font-size:21px; margin-top:10px;">${MG.escapeHtml(message)}</h2>
      ${opts.detail ? `<p style="margin-top:12px; color:var(--ink-dim);">${MG.escapeHtml(opts.detail)}</p>` : ''}
      <div class="row" style="justify-content:flex-end; margin-top:22px; gap:8px;">
        <button class="btn btn-ghost" type="button" id="mg-confirm-no">Cancel</button>
        <button class="btn ${opts.danger ? 'btn-danger' : 'btn-primary'}" type="button" id="mg-confirm-yes">${MG.escapeHtml(confirmLabel)}</button>
      </div>
    `);
    // Dismissing by clicking the backdrop counts as "no" — same as hitting
    // Escape on a native dialog. Resolve is idempotent, so whichever of
    // these fires first wins and the rest are harmless.
    const done = (answer) => { MG.closeModal(); resolve(answer); };
    modal.querySelector('#mg-confirm-yes').onclick = () => done(true);
    modal.querySelector('#mg-confirm-no').onclick = () => done(false);
    modal.addEventListener('click', (e) => { if (e.target === modal) resolve(false); });
    modal.querySelector('#mg-confirm-yes').focus();
  });
};

// The error-shaped half of the pair. Takes an Error or a string, so it can
// be dropped straight into a .catch().
MG.alertModal = function (err) {
  const message = (err && err.message) || String(err);
  return new Promise((resolve) => {
    const modal = MG.openModal(`
      <div class="eyebrow">That didn't work</div>
      <p style="margin-top:14px; color:var(--ink-strong); font-size:15px;">${MG.escapeHtml(message)}</p>
      <div class="row" style="justify-content:flex-end; margin-top:22px;">
        <button class="btn btn-primary" type="button" id="mg-alert-ok">OK</button>
      </div>
    `);
    const done = () => { MG.closeModal(); resolve(); };
    modal.querySelector('#mg-alert-ok').onclick = done;
    modal.addEventListener('click', (e) => { if (e.target === modal) resolve(); });
    modal.querySelector('#mg-alert-ok').focus();
  });
};

// Shared by "Propose a Game" (existing = null) and "Edit Game"
// (existing = {id, title, ...the game's current fields}).
//
// A fresh proposal starts on a fork: "Look Up on Steam" (a real primary
// button — this used to be a small ghost button next to the text field,
// easy to miss, which is how games ended up added with a title but no
// image/price/release date because nobody had actually clicked it) or
// "Enter Details Manually", equally visible, for anyone who'd rather
// quick-add just a title now and fill in the rest later via Edit. Editing
// an existing game skips straight to the full form, since there's already
// something there to work from — but its Steam field still gets a real
// "Look Up" button, so re-pointing it at a different App ID later is just
// as prominent as the first time.
// opts.targetStatus ('proposed' | 'watchlist') only matters for a fresh add
// (existing === null) — it decides whether this lands straight in a vote
// or on the Watchlist. Editing an existing game never touches status.
MG.openGameFormModal = function (existing, opts) {
  const targetStatus = (opts && opts.targetStatus) || 'proposed';
  const addLabel = targetStatus === 'watchlist' ? 'Add to Watchlist' : 'Propose a Game';

  if (existing) {
    renderDetailsStep(existing, null);
  } else {
    renderModeChoice();
  }

  function renderModeChoice() {
    const html = `
      <div class="eyebrow">${addLabel}</div>
      <h2 style="font-size:22px; margin-top:10px;">How do you want to add it?</h2>
      <div class="field" style="margin-top:20px;">
        <label>Steam store link or App ID</label>
        <input id="pg-steam0" type="text" placeholder="https://store.steampowered.com/app/1426210">
      </div>
      <button class="btn btn-primary" type="button" id="pg-lookup0" style="width:100%; margin-top:12px;">Look Up on Steam</button>
      <p id="pg-steam0-status" class="mono" style="font-size:11px; color:var(--ink-dim); margin-top:8px; min-height:14px;"></p>
      <div class="row" style="align-items:center; gap:10px; margin:6px 0;">
        <div style="flex:1; height:1px; background:var(--line);"></div>
        <span class="mono" style="font-size:10px; color:var(--ink-dim);">OR</span>
        <div style="flex:1; height:1px; background:var(--line);"></div>
      </div>
      <button class="btn btn-ghost" type="button" id="pg-manual" style="width:100%;">Enter Details Manually</button>
      <div class="row" style="justify-content:flex-end; margin-top:16px;">
        <button class="btn btn-ghost" type="button" id="pg-cancel0">Cancel</button>
      </div>
    `;
    const modal = MG.openModal(html);
    modal.querySelector('#pg-cancel0').onclick = () => MG.closeModal();
    modal.querySelector('#pg-manual').onclick = () => renderDetailsStep(null, null);
    modal.querySelector('#pg-lookup0').onclick = async () => {
      const statusEl = modal.querySelector('#pg-steam0-status');
      const appId = MG.parseSteamAppId(modal.querySelector('#pg-steam0').value);
      if (!appId) { statusEl.textContent = "Couldn't find an App ID in that — paste a store link or the numeric App ID."; return; }
      const btn = modal.querySelector('#pg-lookup0');
      btn.disabled = true;
      statusEl.textContent = 'Looking up…';
      try {
        const details = await MG.fetchSteamDetails(appId);
        renderDetailsStep(null, { appId, details });
      } catch (err) {
        statusEl.textContent = err.message;
        btn.disabled = false;
      }
    };
  }

  // existingGame: the game doc being edited, or null for a fresh proposal.
  // lookup: { appId, details }, set when arriving here right after a
  // successful Steam lookup on the mode-choice step above; null otherwise
  // (editing, or a fresh proposal entered manually).
  function renderDetailsStep(existingGame, lookup) {
    const isEdit = !!existingGame;
    const seed = lookup ? {
      title: lookup.details.name || '',
      description: lookup.details.description || '',
      platforms: Object.keys(lookup.details.platforms || {}).filter(p => lookup.details.platforms[p]),
      genres: (lookup.details.categories || []).filter(c => /co-?op/i.test(c)).concat(lookup.details.genres || []),
      price: lookup.details.price || '',
      releaseDate: lookup.details.releaseDate || '',
      storeUrl: `https://store.steampowered.com/app/${lookup.appId}`,
    } : (existingGame || {});

    const initialStatus = lookup
      ? (lookup.details.image
          ? `Found "${lookup.details.name}" — review the fields below before adding.`
          : `Found "${lookup.details.name}", but Steam isn't giving back a cover image for this App ID — everything else filled in, cover will stay blank.`)
      : '';

    const html = `
      <div class="eyebrow">${isEdit ? 'Edit Game' : addLabel}</div>
      <h2 style="font-size:22px; margin-top:10px;">${isEdit ? 'Update the details' : (targetStatus === 'watchlist' ? 'Add to the watchlist' : 'Add a recommendation')}</h2>
      <div class="stack" style="margin-top:20px;">
        <div class="field">
          <label>Steam store link or App ID (optional)</label>
          <div class="row">
            <input id="pg-steam" type="text" placeholder="https://store.steampowered.com/app/1426210" style="flex:1;" value="${MG.escapeHtml(seed.storeUrl || '')}">
            <button id="pg-lookup" class="btn btn-primary btn-sm" type="button">Look Up</button>
          </div>
          <span id="pg-steam-status" class="mono" style="font-size:11px; color:var(--ink-dim);">${MG.escapeHtml(initialStatus)}</span>
        </div>
        <div class="field"><label>Title</label><input id="pg-title" type="text" required value="${MG.escapeHtml(seed.title || '')}"></div>
        <div class="grid-2">
          <div class="field"><label>Min players</label><input id="pg-min" type="number" min="1" value="${seed.minPlayers || 2}"></div>
          <div class="field"><label>Max players</label><input id="pg-max" type="number" min="1" value="${seed.maxPlayers || 4}"></div>
        </div>
        <div class="grid-2">
          <div class="field"><label>Price</label><input id="pg-price" type="text" placeholder="$19.99" value="${MG.escapeHtml(seed.price || '')}"></div>
          <div class="field"><label>Release date</label><input id="pg-release" type="text" placeholder="21 Oct, 2021" value="${MG.escapeHtml(seed.releaseDate || '')}"></div>
        </div>
        <div class="field"><label>Platforms (comma separated)</label><input id="pg-platforms" type="text" placeholder="Steam, PC" value="${MG.escapeHtml((seed.platforms || []).join(', '))}"></div>
        <div class="field"><label>Genres / tags (comma separated)</label><input id="pg-genres" type="text" placeholder="Co-op, Shooter" value="${MG.escapeHtml((seed.genres || []).join(', '))}"></div>
        <div class="field"><label>Description</label><textarea id="pg-desc">${MG.escapeHtml(seed.description || '')}</textarea></div>
        <div class="row" style="justify-content:space-between; margin-top:6px; align-items:center;">
          ${isEdit ? '<span></span>' : '<button class="btn btn-ghost btn-sm" type="button" id="pg-back">← Start over</button>'}
          <div class="row">
            <button class="btn btn-ghost" type="button" id="pg-cancel">Cancel</button>
            <button class="btn btn-primary" type="button" id="pg-submit">${isEdit ? 'Save Changes' : addLabel}</button>
          </div>
        </div>
        <p id="pg-error" class="mono" style="color:#ff8a6a; font-size:12px;"></p>
      </div>
    `;
    const modal = MG.openModal(html);
    let steamAppId = lookup ? lookup.appId : (isEdit ? (existingGame.steamAppId || null) : null);
    let steamImage = lookup ? lookup.details.image : (isEdit ? (existingGame.image || null) : null);

    modal.querySelector('#pg-cancel').onclick = () => MG.closeModal();
    const backBtn = modal.querySelector('#pg-back');
    if (backBtn) backBtn.onclick = () => renderModeChoice();

    modal.querySelector('#pg-lookup').onclick = async () => {
      const input = modal.querySelector('#pg-steam').value;
      const appId = MG.parseSteamAppId(input);
      const statusEl = modal.querySelector('#pg-steam-status');
      if (!appId) { statusEl.textContent = "Couldn't find an App ID in that."; return; }
      statusEl.textContent = 'Looking up…';
      try {
        const details = await MG.fetchSteamDetails(appId);
        steamAppId = appId;
        steamImage = details.image;
        modal.querySelector('#pg-title').value = details.name || '';
        modal.querySelector('#pg-desc').value = details.description || '';
        modal.querySelector('#pg-platforms').value = Object.keys(details.platforms || {}).filter(p => details.platforms[p]).join(', ');
        modal.querySelector('#pg-genres').value = (details.categories || []).filter(c => /co-?op/i.test(c)).concat(details.genres || []).join(', ');
        modal.querySelector('#pg-price').value = details.price || '';
        modal.querySelector('#pg-release').value = details.releaseDate || '';
        statusEl.textContent = details.image
          ? `Found "${details.name}" — fields filled in, edit anything before ${isEdit ? 'saving' : 'adding'}.`
          : `Found "${details.name}", but Steam isn't giving back a cover image for this App ID — everything else filled in, cover will stay blank.`;
      } catch (err) {
        statusEl.textContent = err.message;
      }
    };

    modal.querySelector('#pg-submit').onclick = async () => {
      const title = modal.querySelector('#pg-title').value.trim();
      const errorEl = modal.querySelector('#pg-error');
      if (!title) { errorEl.textContent = 'Title is required.'; return; }
      const submitBtn = modal.querySelector('#pg-submit');
      submitBtn.disabled = true;

      // Respect whatever's actually typed in the Steam field, even if the
      // user never (re-)clicked "Look up" — otherwise editing that text
      // looks like a normal field but silently doesn't save.
      const typedAppId = MG.parseSteamAppId(modal.querySelector('#pg-steam').value);
      if (typedAppId) steamAppId = typedAppId;

      const fields = {
        title,
        minPlayers: parseInt(modal.querySelector('#pg-min').value, 10) || 2,
        maxPlayers: parseInt(modal.querySelector('#pg-max').value, 10) || 4,
        platforms: modal.querySelector('#pg-platforms').value.split(',').map(s => s.trim()).filter(Boolean),
        genres: modal.querySelector('#pg-genres').value.split(',').map(s => s.trim()).filter(Boolean),
        description: modal.querySelector('#pg-desc').value.trim(),
        storeUrl: steamAppId ? `https://store.steampowered.com/app/${steamAppId}` : (isEdit ? (existingGame.storeUrl || '') : ''),
        steamAppId,
        image: steamImage,
        price: modal.querySelector('#pg-price').value.trim(),
        releaseDate: modal.querySelector('#pg-release').value.trim(),
      };
      try {
        if (isEdit) await MG.updateGame(existingGame.id, fields);
        else if (targetStatus === 'watchlist') await MG.addToWatchlist(fields);
        else await MG.proposeGame(fields);
        MG.closeModal();
      } catch (err) {
        errorEl.textContent = err.message;
        submitBtn.disabled = false;
      }
    };
  }
};

MG.openProposeGameModal = function () { MG.openGameFormModal(null); };
MG.openAddToWatchlistModal = function () { MG.openGameFormModal(null, { targetStatus: 'watchlist' }); };

MG.openProposeSessionModal = async function () {
  let games = [];
  let unavailability = [];
  try {
    const [gamesSnap, uaEntries] = await Promise.all([
      MG.db.collection('games').where('status', '==', 'approved').get(),
      MG.fetchUnavailability(),
    ]);
    games = gamesSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    unavailability = uaEntries;
  } catch (err) { console.error(err); }

  if (games.length === 0) {
    const modal = MG.openModal(`
      <div class="eyebrow">Propose a Session</div>
      <h2 style="font-size:22px; margin-top:10px;">No approved games yet</h2>
      <p style="margin-top:12px; color:var(--ink-dim);">Get a game approved on the Recommendations page first.</p>
      <div class="row" style="justify-content:flex-end; margin-top:16px;">
        <button class="btn btn-ghost" id="ps-close" type="button">Close</button>
      </div>
    `);
    modal.querySelector('#ps-close').onclick = () => MG.closeModal();
    return;
  }

  const optionsHtml = games.map(g => `<option value="${g.id}">${MG.escapeHtml(g.title)}</option>`).join('');
  const html = `
    <div class="eyebrow">Propose a Session</div>
    <h2 style="font-size:22px; margin-top:10px;">Pick a time to play</h2>
    <div class="stack" style="margin-top:20px;">
      <div class="field"><label>Game</label><select id="ps-game">${optionsHtml}</select></div>
      <div class="field">
        <label>Date &amp; time</label>
        <input id="ps-when" type="datetime-local">
        <span id="ps-away-warning" class="mono" style="font-size:11px; color:#ff8a6a;"></span>
      </div>
      <div class="field"><label>Notes (optional)</label><textarea id="ps-notes"></textarea></div>
      <div class="row" style="justify-content:flex-end; margin-top:6px;">
        <button class="btn btn-ghost" type="button" id="ps-cancel">Cancel</button>
        <button class="btn btn-primary" type="button" id="ps-submit">Propose Session</button>
      </div>
      <p id="ps-error" class="mono" style="color:#ff8a6a; font-size:12px;"></p>
    </div>
  `;
  const modal = MG.openModal(html);
  modal.querySelector('#ps-cancel').onclick = () => MG.closeModal();
  modal.querySelector('#ps-when').oninput = (e) => {
    const dateStr = e.target.value.slice(0, 10);
    const away = dateStr ? MG.awayNamesOn(dateStr, unavailability) : [];
    modal.querySelector('#ps-away-warning').textContent = away.length ? `⚠ ${away.join(', ')} marked unavailable that day.` : '';
  };
  modal.querySelector('#ps-submit').onclick = async () => {
    const whenVal = modal.querySelector('#ps-when').value;
    const errorEl = modal.querySelector('#ps-error');
    if (!whenVal) { errorEl.textContent = 'Pick a date and time.'; return; }
    const gameId = modal.querySelector('#ps-game').value;
    const game = games.find(g => g.id === gameId);
    const submitBtn = modal.querySelector('#ps-submit');
    submitBtn.disabled = true;
    try {
      await MG.proposeSession({
        gameId,
        gameTitle: game.title,
        dateTime: new Date(whenVal),
        notes: modal.querySelector('#ps-notes').value.trim(),
      });
      MG.closeModal();
    } catch (err) {
      errorEl.textContent = err.message;
      submitBtn.disabled = false;
    }
  };
};

// Edit an existing session's date/time and notes. `session` needs
// {id, gameTitle, when (a JS Date), notes}.
MG.openEditSessionModal = function (session) {
  const local = session.when
    ? new Date(session.when.getTime() - session.when.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
    : '';
  const html = `
    <div class="eyebrow">Edit Session</div>
    <h2 style="font-size:22px; margin-top:10px;">${MG.escapeHtml(session.gameTitle)}</h2>
    <div class="stack" style="margin-top:20px;">
      <div class="field">
        <label>Date &amp; time</label>
        <input id="es-when" type="datetime-local" value="${local}">
        <span id="es-away-warning" class="mono" style="font-size:11px; color:#ff8a6a;"></span>
      </div>
      <div class="field"><label>Notes</label><textarea id="es-notes">${MG.escapeHtml(session.notes || '')}</textarea></div>
      <div class="row" style="justify-content:flex-end; margin-top:6px;">
        <button class="btn btn-ghost" type="button" id="es-cancel">Cancel</button>
        <button class="btn btn-primary" type="button" id="es-submit">Save Changes</button>
      </div>
      <p id="es-error" class="mono" style="color:#ff8a6a; font-size:12px;"></p>
    </div>
  `;
  const modal = MG.openModal(html);
  modal.querySelector('#es-cancel').onclick = () => MG.closeModal();

  let unavailability = [];
  const updateAwayWarning = () => {
    const dateStr = modal.querySelector('#es-when').value.slice(0, 10);
    const away = dateStr ? MG.awayNamesOn(dateStr, unavailability) : [];
    modal.querySelector('#es-away-warning').textContent = away.length ? `⚠ ${away.join(', ')} marked unavailable that day.` : '';
  };
  modal.querySelector('#es-when').oninput = updateAwayWarning;
  MG.fetchUnavailability().then((entries) => { unavailability = entries; updateAwayWarning(); }).catch(() => {});

  modal.querySelector('#es-submit').onclick = async () => {
    const whenVal = modal.querySelector('#es-when').value;
    const errorEl = modal.querySelector('#es-error');
    if (!whenVal) { errorEl.textContent = 'Pick a date and time.'; return; }
    const btn = modal.querySelector('#es-submit');
    btn.disabled = true;
    try {
      await MG.updateSession(session.id, { dateTime: new Date(whenVal), notes: modal.querySelector('#es-notes').value.trim() });
      MG.closeModal();
    } catch (err) {
      errorEl.textContent = err.message;
      btn.disabled = false;
    }
  };
};
