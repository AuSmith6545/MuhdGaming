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

/* ---------- nav + sign-in gate ---------- */

const NAV_ITEMS = [
  ['dashboard', 'Dashboard', 'index.html'],
  ['recommendations', 'Recommendations', 'recommendations.html'],
  ['games', 'Games', 'games.html'],
  ['calendar', 'Calendar', 'calendar.html'],
  ['changelog', 'Changelog', 'changelog.html'],
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
      <div class="mark chamfer-xs">MG</div>
      <span class="wordmark">MUHDGAMING</span>
    </a>
    <div class="links">${linksHtml}</div>
    <div class="row" style="margin-left:auto;">
      <span class="mono" style="font-size:11px; color:var(--ink-dim);">${MG.friendCount} IN CREW</span>
      ${user ? `<a href="profile.html" title="Your profile">${MG.resolveAvatarHtml(user.uid, user.displayName, user.photoURL)}</a>` : ''}
      <button id="mg-signout" class="btn btn-ghost btn-sm">Sign out</button>
    </div>
  `;
  const signOutBtn = document.getElementById('mg-signout');
  if (signOutBtn) signOutBtn.onclick = () => MG.auth.signOut();
}

function showGate(state, message) {
  const gate = document.getElementById('mg-gate');
  const main = document.getElementById('mg-main');
  if (!gate) return;

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

      const friendsSnap = await MG.db.collection('friends').get();
      MG.friends = friendsSnap.docs.map(d => ({ email: d.id, ...d.data() }));
      MG.friendCount = MG.friends.length;

      const usersSnap = await MG.db.collection('users').get();
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

/* ---------- writes: games / recommendations ---------- */

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
  };
  const ref = await MG.db.collection('games').add(doc);
  return ref.id;
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

// Sends an approved game back to a fresh vote — clears the old votes so
// the crew re-decides from scratch. Milestones/todos/notes are left
// untouched so nothing is lost if it gets re-approved later.
MG.demoteGame = async function (gameId) {
  await MG.db.collection('games').doc(gameId).update({
    status: 'proposed',
    votes: {},
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

// Toggles the current friend's vote; auto-approves the moment every friend
// in the crew has voted yes. Wrapped in a transaction so two friends voting
// at once can't both think they cast the deciding vote. The friend count is
// re-read fresh right before the transaction (rather than the possibly-
// stale MG.friendCount cached at sign-in) — it can't be read *inside* the
// transaction itself, because Firestore's web SDK only allows a transaction
// to read individual documents, not a whole collection/query.
MG.toggleVote = async function (gameId) {
  const uid = MG.user.uid;
  const ref = MG.db.collection('games').doc(gameId);
  const friendsSnap = await MG.db.collection('friends').get();
  const friendCount = friendsSnap.size;

  await MG.db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return;
    const data = snap.data();
    const votes = Object.assign({}, data.votes || {});
    if (votes[uid]) delete votes[uid]; else votes[uid] = true;

    const update = { votes };
    if (data.status === 'proposed' && friendCount > 0 && Object.keys(votes).length >= friendCount) {
      update.status = 'approved';
      update.approvedAt = firebase.firestore.FieldValue.serverTimestamp();
      update.lastActivityAt = firebase.firestore.FieldValue.serverTimestamp();
    }
    tx.update(ref, update);
  });
};

/* ---------- writes: milestones / to-dos / notes ---------- */

function touchGame(batch, gameId) {
  batch.update(MG.db.collection('games').doc(gameId), {
    lastActivityAt: firebase.firestore.FieldValue.serverTimestamp(),
  });
}

MG.addMilestone = async function (gameId, title) {
  const batch = MG.db.batch();
  const ref = MG.db.collection('games').doc(gameId).collection('milestones').doc();
  batch.set(ref, {
    title, status: 'todo', order: Date.now(),
    createdBy: MG.user.displayName, createdByUid: MG.user.uid,
    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
  });
  touchGame(batch, gameId);
  await batch.commit();
};

MG.setMilestoneStatus = async function (gameId, milestoneId, status) {
  const batch = MG.db.batch();
  batch.update(MG.db.collection('games').doc(gameId).collection('milestones').doc(milestoneId), {
    status, updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
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
    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
  });
  touchGame(batch, gameId);
  await batch.commit();
};

MG.toggleTodo = async function (gameId, todoId, done) {
  const batch = MG.db.batch();
  batch.update(MG.db.collection('games').doc(gameId).collection('todos').doc(todoId), {
    done, updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
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
// wrapped for the same reason as toggleVote above.
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
  // access), approving must not silently wipe that out.
  batch.set(MG.db.collection('friends').doc(email), { displayName: name }, { merge: true });
  batch.delete(MG.db.collection('joinRequests').doc(uid));
  await batch.commit();
};

MG.declineRequest = async function (uid) {
  await MG.db.collection('joinRequests').doc(uid).delete();
};

/* ---------- shared modals (used from Dashboard, Recommendations, Calendar) ---------- */

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

// Shared by "Propose a Game" (existing = null) and "Edit Game"
// (existing = {id, title, ...the game's current fields}).
MG.openGameFormModal = function (existing) {
  const isEdit = !!existing;
  const html = `
    <div class="eyebrow">${isEdit ? 'Edit Game' : 'Propose a Game'}</div>
    <h2 style="font-size:22px; margin-top:10px;">${isEdit ? 'Update the details' : 'Add a recommendation'}</h2>
    <div class="stack" style="margin-top:20px;">
      <div class="field">
        <label>Steam store link or App ID (optional)</label>
        <div class="row">
          <input id="pg-steam" type="text" placeholder="https://store.steampowered.com/app/1426210" style="flex:1;" value="${isEdit ? MG.escapeHtml(existing.storeUrl || '') : ''}">
          <button id="pg-lookup" class="btn btn-ghost btn-sm" type="button">Look up</button>
        </div>
        <span id="pg-steam-status" class="mono" style="font-size:11px; color:var(--ink-dim);"></span>
      </div>
      <div class="field"><label>Title</label><input id="pg-title" type="text" required value="${isEdit ? MG.escapeHtml(existing.title) : ''}"></div>
      <div class="grid-2">
        <div class="field"><label>Min players</label><input id="pg-min" type="number" min="1" value="${isEdit ? (existing.minPlayers || 2) : 2}"></div>
        <div class="field"><label>Max players</label><input id="pg-max" type="number" min="1" value="${isEdit ? (existing.maxPlayers || 4) : 4}"></div>
      </div>
      <div class="grid-2">
        <div class="field"><label>Price</label><input id="pg-price" type="text" placeholder="$19.99" value="${isEdit ? MG.escapeHtml(existing.price || '') : ''}"></div>
        <div class="field"><label>Release date</label><input id="pg-release" type="text" placeholder="21 Oct, 2021" value="${isEdit ? MG.escapeHtml(existing.releaseDate || '') : ''}"></div>
      </div>
      <div class="field"><label>Platforms (comma separated)</label><input id="pg-platforms" type="text" placeholder="Steam, PC" value="${isEdit ? MG.escapeHtml((existing.platforms || []).join(', ')) : ''}"></div>
      <div class="field"><label>Genres / tags (comma separated)</label><input id="pg-genres" type="text" placeholder="Co-op, Shooter" value="${isEdit ? MG.escapeHtml((existing.genres || []).join(', ')) : ''}"></div>
      <div class="field"><label>Description</label><textarea id="pg-desc">${isEdit ? MG.escapeHtml(existing.description || '') : ''}</textarea></div>
      <div class="row" style="justify-content:flex-end; margin-top:6px;">
        <button class="btn btn-ghost" type="button" id="pg-cancel">Cancel</button>
        <button class="btn btn-primary" type="button" id="pg-submit">${isEdit ? 'Save Changes' : 'Add Recommendation'}</button>
      </div>
      <p id="pg-error" class="mono" style="color:#ff8a6a; font-size:12px;"></p>
    </div>
  `;
  const modal = MG.openModal(html);
  let steamAppId = isEdit ? (existing.steamAppId || null) : null;
  let steamImage = isEdit ? (existing.image || null) : null;

  modal.querySelector('#pg-cancel').onclick = () => MG.closeModal();

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
    // user never clicked "Look up" — otherwise editing that text looks
    // like a normal field but silently doesn't save.
    const typedAppId = MG.parseSteamAppId(modal.querySelector('#pg-steam').value);
    if (typedAppId) steamAppId = typedAppId;

    const fields = {
      title,
      minPlayers: parseInt(modal.querySelector('#pg-min').value, 10) || 2,
      maxPlayers: parseInt(modal.querySelector('#pg-max').value, 10) || 4,
      platforms: modal.querySelector('#pg-platforms').value.split(',').map(s => s.trim()).filter(Boolean),
      genres: modal.querySelector('#pg-genres').value.split(',').map(s => s.trim()).filter(Boolean),
      description: modal.querySelector('#pg-desc').value.trim(),
      storeUrl: steamAppId ? `https://store.steampowered.com/app/${steamAppId}` : (isEdit ? (existing.storeUrl || '') : ''),
      steamAppId,
      image: steamImage,
      price: modal.querySelector('#pg-price').value.trim(),
      releaseDate: modal.querySelector('#pg-release').value.trim(),
    };
    try {
      if (isEdit) await MG.updateGame(existing.id, fields); else await MG.proposeGame(fields);
      MG.closeModal();
    } catch (err) {
      errorEl.textContent = err.message;
      submitBtn.disabled = false;
    }
  };
};

MG.openProposeGameModal = function () { MG.openGameFormModal(null); };

MG.openProposeSessionModal = async function () {
  let games = [];
  try {
    const snap = await MG.db.collection('games').where('status', '==', 'approved').get();
    games = snap.docs.map(d => ({ id: d.id, ...d.data() }));
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
      <div class="field"><label>Date &amp; time</label><input id="ps-when" type="datetime-local"></div>
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
      <div class="field"><label>Date &amp; time</label><input id="es-when" type="datetime-local" value="${local}"></div>
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
