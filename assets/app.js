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
  const div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML;
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

MG.avatarHtml = function (name, photoURL, size) {
  const cls = 'avatar' + (size === 'sm' ? ' sm' : '');
  if (photoURL) return `<div class="${cls} chamfer-xs"><img src="${MG.escapeHtml(photoURL)}" alt=""></div>`;
  return `<div class="${cls} chamfer-xs">${MG.escapeHtml(MG.initials(name))}</div>`;
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
      ${user ? MG.avatarHtml(user.displayName, user.photoURL) : ''}
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
      <p style="margin-bottom:16px; color:var(--ink-strong); font-size:16px;">Sign in to see the crew's games.</p>
      <button id="mg-signin" class="btn btn-primary">Sign in with Google</button>
      <p id="mg-signin-err" class="mono" style="color:#ff8a6a; margin-top:14px; font-size:12px;"></p>
    `;
    document.getElementById('mg-signin').onclick = () => {
      const provider = new firebase.auth.GoogleAuthProvider();
      MG.auth.signInWithPopup(provider).catch(err => {
        document.getElementById('mg-signin-err').textContent = err.message;
      });
    };
  } else if (state === 'not-friend') {
    gate.className = 'empty-state';
    gate.innerHTML = `
      <p style="color:var(--ink-strong); font-size:16px;">This account isn't on the crew list yet.</p>
      <p style="margin-top:8px;">Ask whoever set this up to add <strong>${MG.escapeHtml(MG.auth.currentUser && MG.auth.currentUser.email || '')}</strong> in Firebase.</p>
      <button id="mg-signout2" class="btn btn-ghost" style="margin-top:16px;">Sign out</button>
    `;
    document.getElementById('mg-signout2').onclick = () => MG.auth.signOut();
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

      const friendsSnap = await MG.db.collection('friends').get();
      MG.friends = friendsSnap.docs.map(d => ({ email: d.id, ...d.data() }));
      MG.friendCount = MG.friends.length;

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
    status: 'proposed',
    proposedBy: { uid, name: MG.user.displayName },
    proposedAt: firebase.firestore.FieldValue.serverTimestamp(),
    votes: {},
  };
  const ref = await MG.db.collection('games').add(doc);
  return ref.id;
};

// Toggles the current friend's vote; auto-approves the moment every friend
// in the crew has voted yes. Wrapped in a transaction so two friends voting
// at once can't both think they cast the deciding vote.
MG.toggleVote = async function (gameId) {
  const uid = MG.user.uid;
  const ref = MG.db.collection('games').doc(gameId);
  await MG.db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return;
    const data = snap.data();
    const votes = Object.assign({}, data.votes || {});
    if (votes[uid]) delete votes[uid]; else votes[uid] = true;

    const update = { votes };
    if (data.status === 'proposed' && MG.friendCount > 0 && Object.keys(votes).length >= MG.friendCount) {
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
    createdBy: MG.user.displayName,
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
    createdBy: MG.user.displayName,
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
// game's minimum player count. Transaction-wrapped for the same reason as
// toggleVote above.
MG.setRsvp = async function (sessionId, choice) {
  const uid = MG.user.uid;
  const ref = MG.db.collection('sessions').doc(sessionId);
  await MG.db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return;
    const data = snap.data();
    const rsvps = Object.assign({}, data.rsvps || {}, {
      [uid]: { choice, name: MG.user.displayName, photoURL: MG.user.photoURL || null },
    });
    const update = { rsvps };

    if (data.status === 'proposed') {
      const yesCount = Object.values(rsvps).filter(v => v.choice === 'yes').length;
      const gameSnap = await tx.get(MG.db.collection('games').doc(data.gameId));
      const minPlayers = (gameSnap.exists && gameSnap.data().minPlayers) || 2;
      if (yesCount >= minPlayers) {
        update.status = 'accepted';
        update.acceptedAt = firebase.firestore.FieldValue.serverTimestamp();
      }
    }
    tx.update(ref, update);
  });
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

MG.openProposeGameModal = function (onDone) {
  const html = `
    <div class="eyebrow">Propose a Game</div>
    <h2 style="font-size:22px; margin-top:10px;">Add a recommendation</h2>
    <div class="stack" style="margin-top:20px;">
      <div class="field">
        <label>Steam store link or App ID (optional)</label>
        <div class="row">
          <input id="pg-steam" type="text" placeholder="https://store.steampowered.com/app/1426210" style="flex:1;">
          <button id="pg-lookup" class="btn btn-ghost btn-sm" type="button">Look up</button>
        </div>
        <span id="pg-steam-status" class="mono" style="font-size:11px; color:var(--ink-dim);"></span>
      </div>
      <div class="field"><label>Title</label><input id="pg-title" type="text" required></div>
      <div class="grid-2">
        <div class="field"><label>Min players</label><input id="pg-min" type="number" min="1" value="2"></div>
        <div class="field"><label>Max players</label><input id="pg-max" type="number" min="1" value="4"></div>
      </div>
      <div class="field"><label>Platforms (comma separated)</label><input id="pg-platforms" type="text" placeholder="Steam, PC"></div>
      <div class="field"><label>Genres / tags (comma separated)</label><input id="pg-genres" type="text" placeholder="Co-op, Shooter"></div>
      <div class="field"><label>Description</label><textarea id="pg-desc"></textarea></div>
      <div class="row" style="justify-content:flex-end; margin-top:6px;">
        <button class="btn btn-ghost" type="button" id="pg-cancel">Cancel</button>
        <button class="btn btn-primary" type="button" id="pg-submit">Add Recommendation</button>
      </div>
      <p id="pg-error" class="mono" style="color:#ff8a6a; font-size:12px;"></p>
    </div>
  `;
  const modal = MG.openModal(html);
  let steamAppId = null, steamImage = null;

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
      statusEl.textContent = `Found "${details.name}" — fields filled in, edit anything before adding.`;
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
    try {
      await MG.proposeGame({
        title,
        minPlayers: parseInt(modal.querySelector('#pg-min').value, 10) || 2,
        maxPlayers: parseInt(modal.querySelector('#pg-max').value, 10) || 4,
        platforms: modal.querySelector('#pg-platforms').value.split(',').map(s => s.trim()).filter(Boolean),
        genres: modal.querySelector('#pg-genres').value.split(',').map(s => s.trim()).filter(Boolean),
        description: modal.querySelector('#pg-desc').value.trim(),
        storeUrl: steamAppId ? `https://store.steampowered.com/app/${steamAppId}` : '',
        steamAppId,
        image: steamImage,
      });
      MG.closeModal();
      if (onDone) onDone();
    } catch (err) {
      errorEl.textContent = err.message;
      submitBtn.disabled = false;
    }
  };
};

MG.openProposeSessionModal = async function (onDone) {
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
      if (onDone) onDone();
    } catch (err) {
      errorEl.textContent = err.message;
      submitBtn.disabled = false;
    }
  };
};
