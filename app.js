import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

// ============================================================
// Constants & Supabase client
// ============================================================
const SUPABASE_URL = 'https://vmdsibzivcugjidtkhzt.supabase.co';
const SUPABASE_KEY = 'sb_publishable_ndJSJcAcexIbz9yn1zRoLw_iyeerQXy';
const BUCKET = 'notes-images';
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const TAG_SUGGESTIONS_NOTES = ['Viajes', 'Cuentas', 'Familia', 'Restaurantes', 'Citas', 'Recordar', 'Random'];
const TAG_SUGGESTIONS_PLACES = ['Restaurantes', 'Museos', 'Viajes', 'Cafés', 'Bares', 'Naturaleza'];

// ============================================================
// DOM helpers
// ============================================================
const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => Array.from(root.querySelectorAll(s));

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
const publicImageUrl = (path) => supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
const fmtDate = (iso) => {
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  return sameDay
    ? d.toLocaleTimeString('es', { hour: 'numeric', minute: '2-digit' })
    : d.toLocaleDateString('es', { month: 'short', day: 'numeric', year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric' });
};

function setStatus(el, msg, isError = false) {
  if (!el) return;
  el.textContent = msg;
  el.classList.toggle('error', isError);
  if (msg && !isError) setTimeout(() => { if (el.textContent === msg) el.textContent = ''; }, 2500);
}

// Color for a tag — stable hash → HSL
function tagColor(tag) {
  if (!tag) return 'var(--text-dim)';
  let h = 0;
  for (let i = 0; i < tag.length; i++) h = (h * 31 + tag.charCodeAt(i)) >>> 0;
  const hue = h % 360;
  return `hsl(${hue}, 62%, 50%)`;
}

// Spotify / YouTube URL parsing
function parseMediaUrl(rawUrl) {
  if (!rawUrl) return null;
  let url;
  try { url = new URL(rawUrl.trim()); } catch { return null; }
  const host = url.hostname.replace(/^www\./, '');

  if (host === 'open.spotify.com' || host === 'spotify.com') {
    const m = url.pathname.match(/^\/(playlist|track|album|episode|show|artist)\/([A-Za-z0-9]+)/);
    if (m) {
      const [, type, id] = m;
      return {
        kind: 'spotify',
        embedUrl: `https://open.spotify.com/embed/${type}/${id}`,
        normalizedUrl: `https://open.spotify.com/${type}/${id}`,
        thumbnailUrl: null,
      };
    }
  }
  if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'music.youtube.com') {
    const list = url.searchParams.get('list');
    const v = url.searchParams.get('v');
    if (v) {
      return {
        kind: 'youtube',
        embedUrl: `https://www.youtube.com/embed/${v}${list ? `?list=${list}` : ''}`,
        normalizedUrl: rawUrl,
        thumbnailUrl: `https://i.ytimg.com/vi/${v}/hqdefault.jpg`,
      };
    }
    if (url.pathname.startsWith('/playlist') && list) {
      return {
        kind: 'youtube',
        embedUrl: `https://www.youtube.com/embed/videoseries?list=${list}`,
        normalizedUrl: rawUrl,
        thumbnailUrl: null,
      };
    }
    const shorts = url.pathname.match(/^\/shorts\/([A-Za-z0-9_-]+)/);
    if (shorts) {
      return {
        kind: 'youtube',
        embedUrl: `https://www.youtube.com/embed/${shorts[1]}`,
        normalizedUrl: rawUrl,
        thumbnailUrl: `https://i.ytimg.com/vi/${shorts[1]}/hqdefault.jpg`,
      };
    }
  }
  if (host === 'youtu.be') {
    const id = url.pathname.replace(/^\//, '');
    if (id) {
      return {
        kind: 'youtube',
        embedUrl: `https://www.youtube.com/embed/${id}`,
        normalizedUrl: rawUrl,
        thumbnailUrl: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
      };
    }
  }
  return null;
}

// Try to fetch a title via oEmbed (best-effort)
async function fetchOembedTitle(parsed) {
  if (!parsed) return null;
  try {
    const target = parsed.kind === 'spotify'
      ? `https://open.spotify.com/oembed?url=${encodeURIComponent(parsed.normalizedUrl)}`
      : `https://www.youtube.com/oembed?url=${encodeURIComponent(parsed.normalizedUrl)}&format=json`;
    const res = await fetch(target);
    if (!res.ok) return null;
    const json = await res.json();
    return {
      title: json.title || null,
      thumbnail: json.thumbnail_url || null,
    };
  } catch {
    return null;
  }
}

// Unread = the other user added it and current user hasn't opened it
function isUnread(item) {
  if (!state.currentUser || !item) return false;
  if (item.created_by === state.currentUser) return false;
  const seen = Array.isArray(item.seen_by) ? item.seen_by : [];
  return !seen.includes(state.currentUser);
}

async function markSeen(table, item) {
  if (!state.currentUser || !item) return;
  const seen = Array.isArray(item.seen_by) ? item.seen_by : [];
  if (seen.includes(state.currentUser)) return;
  const next = [...seen, state.currentUser];
  // Optimistic update locally
  item.seen_by = next;
  try {
    await supabase.from(table).update({ seen_by: next }).eq('id', item.id);
    // refresh sidebar badges
    updateSidebarBadges();
  } catch (e) { console.warn('markSeen failed', e); }
}

// ============================================================
// State
// ============================================================
const state = {
  currentUser: null,
  route: '#/inicio',
  notes: [],
  media: [],
  photos: [],
  places: [],
  settings: {
    photo_widget: { mode: 'featured', interval_ms: 6000 },
  },
  view: { notas: 'cards', musica: 'cards' },
  filterTag: { notas: null, lugares: null },
};

// ============================================================
// Auth
// ============================================================
const AUTH_KEY = 'medusas:user';

async function loadUsersForLogin() {
  try {
    const { data, error } = await supabase.rpc('list_users');
    if (error) throw error;
    return (data || []).map(u => u.name);
  } catch (e) {
    console.error(e);
    return ['Jaime', 'Mayck'];
  }
}

async function tryLogin(name, password) {
  const { data, error } = await supabase.rpc('verify_password', { p_name: name, p_password: password });
  if (error) throw error;
  return !!data;
}

function loginAs(name) {
  state.currentUser = name;
  localStorage.setItem(AUTH_KEY, name);
}

function logout() {
  state.currentUser = null;
  localStorage.removeItem(AUTH_KEY);
  showLogin();
}

function showLogin() {
  $('#auth-overlay').hidden = false;
  $('#app-shell').hidden = true;
}

function hideLogin() {
  $('#auth-overlay').hidden = true;
  $('#app-shell').hidden = false;
  $('#who-am-i').textContent = state.currentUser;
}

async function initAuthUI() {
  const picker = $('#user-picker');
  const names = await loadUsersForLogin();
  picker.innerHTML = '';
  let selected = names[0];
  const make = (name) => {
    const b = document.createElement('button');
    b.textContent = name;
    if (name === selected) b.classList.add('active');
    b.addEventListener('click', () => {
      selected = name;
      $$('button', picker).forEach(x => x.classList.toggle('active', x.textContent === name));
    });
    picker.appendChild(b);
  };
  names.forEach(make);

  const submit = async () => {
    const pwd = $('#auth-password').value;
    if (!pwd) { setStatus($('#auth-status'), 'Escribe la clave', true); return; }
    setStatus($('#auth-status'), 'Verificando…');
    try {
      const ok = await tryLogin(selected, pwd);
      if (!ok) { setStatus($('#auth-status'), 'Clave incorrecta', true); return; }
      loginAs(selected);
      $('#auth-status').textContent = '';
      $('#auth-password').value = '';
      hideLogin();
      await loadSettings();
      await router();
    } catch (e) {
      setStatus($('#auth-status'), `Error: ${e.message || e}`, true);
    }
  };
  $('#auth-submit').addEventListener('click', submit);
  $('#auth-password').addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });

  $('#logout-link').addEventListener('click', (e) => { e.preventDefault(); logout(); });
}

// ============================================================
// Data
// ============================================================
async function loadAll() {
  const [
    { data: notes },
    { data: media },
    { data: photos },
    { data: places },
  ] = await Promise.all([
    supabase.from('notes').select('*').order('pinned', { ascending: false }).order('created_at', { ascending: false }),
    supabase.from('media').select('*').order('pinned', { ascending: false }).order('created_at', { ascending: false }),
    supabase.from('photos').select('*').order('pinned', { ascending: false }).order('created_at', { ascending: false }),
    supabase.from('places').select('*').order('pinned', { ascending: false }).order('created_at', { ascending: false }),
  ]);
  state.notes = notes || [];
  state.media = media || [];
  state.photos = photos || [];
  state.places = places || [];
  updateSidebarBadges();
}

async function loadSettings() {
  try {
    const { data } = await supabase.from('app_settings').select('*');
    for (const row of (data || [])) state.settings[row.key] = row.value;
  } catch (e) { console.warn(e); }
}

async function saveSetting(key, value) {
  state.settings[key] = value;
  try {
    const { error } = await supabase.from('app_settings').upsert({ key, value });
    if (error) throw error;
  } catch (e) { console.error(e); }
}

function updateSidebarBadges() {
  const counts = {
    'home': 0,
    'notas-publicas': state.notes.filter(n => n.visibility === 'public' && isUnread(n)).length,
    'notas-privadas': state.notes.filter(n => n.visibility === 'private' && isUnread(n)).length,
    'musica': state.media.filter(isUnread).length,
    'fotos': state.photos.filter(isUnread).length,
    'lugares': state.places.filter(isUnread).length,
  };
  counts.home = counts['notas-publicas'] + counts['notas-privadas'] + counts['musica'] + counts['fotos'] + counts['lugares'];
  $$('[data-unread]').forEach(el => {
    const c = counts[el.dataset.unread] || 0;
    el.hidden = c === 0;
    el.textContent = c;
  });
}

// ============================================================
// Router
// ============================================================
function syncMenu() {
  $$('#menu a').forEach(a => a.classList.toggle('active', a.dataset.route === state.route));
}

async function router() {
  if (!state.currentUser) { showLogin(); return; }
  const hash = location.hash || '#/inicio';
  state.route = hash;
  syncMenu();
  const content = $('#content');
  content.innerHTML = '<p class="status">Cargando…</p>';
  await loadAll();
  switch (true) {
    case hash === '#/inicio': renderInicio(content); break;
    case hash === '#/notas/publicas': renderNotas(content, 'public'); break;
    case hash === '#/notas/privadas': renderNotas(content, 'private'); break;
    case hash === '#/musica': renderMusica(content); break;
    case hash === '#/fotos': renderFotos(content); break;
    case hash === '#/lugares': renderLugares(content); break;
    case hash === '#/configuracion': renderConfig(content); break;
    default: location.hash = '#/inicio';
  }
}
window.addEventListener('hashchange', router);

// ============================================================
// Page: Inicio (dashboard)
// ============================================================
function renderInicio(root) {
  const pubCount = state.notes.filter(n => n.visibility === 'public').length;
  const privCount = state.notes.filter(n => n.visibility === 'private').length;
  const mediaCount = state.media.length;
  const photoCount = state.photos.length;
  const placeCount = state.places.length;

  const unreadNotesPub = state.notes.filter(n => n.visibility === 'public' && isUnread(n)).length;
  const unreadNotesPriv = state.notes.filter(n => n.visibility === 'private' && isUnread(n)).length;
  const unreadMedia = state.media.filter(isUnread).length;
  const unreadPhotos = state.photos.filter(isUnread).length;
  const unreadPlaces = state.places.filter(isUnread).length;

  // Cross-item "new from the other user" list
  const allUnread = [
    ...state.notes.filter(isUnread).map(n => ({ ...n, _kind: 'note', _icon: n.visibility === 'private' ? '🔒' : '📝', _route: n.visibility === 'private' ? '#/notas/privadas' : '#/notas/publicas' })),
    ...state.media.filter(isUnread).map(m => ({ ...m, _kind: 'media', _icon: m.kind === 'spotify' ? '🎵' : '▶️', _route: '#/musica' })),
    ...state.photos.filter(isUnread).map(p => ({ ...p, _kind: 'photo', _icon: '📸', _route: '#/fotos' })),
    ...state.places.filter(isUnread).map(p => ({ ...p, _kind: 'place', _icon: '📍', _route: '#/lugares' })),
  ].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

  root.innerHTML = `
    <div class="page-head">
      <div>
        <h1>Hola, ${escapeHtml(state.currentUser)} 🪼</h1>
        <div class="sub">Un vistazo a todo lo nuestro</div>
      </div>
    </div>

    ${allUnread.length ? `
      <div class="unread-banner">
        <h3>Nuevo para ti (${allUnread.length})</h3>
        <div class="unread-list" id="unread-list"></div>
      </div>
    ` : ''}

    <div class="stats">
      <a class="stat" href="#/notas/publicas">
        <span class="stat-label">🌐 Notas públicas</span>
        <span class="stat-value">${pubCount}</span>
        ${unreadNotesPub ? `<span class="stat-unread">${unreadNotesPub}</span>` : ''}
      </a>
      <a class="stat" href="#/notas/privadas">
        <span class="stat-label">🔒 Notas privadas</span>
        <span class="stat-value">${privCount}</span>
        ${unreadNotesPriv ? `<span class="stat-unread">${unreadNotesPriv}</span>` : ''}
      </a>
      <a class="stat" href="#/musica">
        <span class="stat-label">🎵 Música</span>
        <span class="stat-value">${mediaCount}</span>
        ${unreadMedia ? `<span class="stat-unread">${unreadMedia}</span>` : ''}
      </a>
      <a class="stat" href="#/fotos">
        <span class="stat-label">📸 Fotos</span>
        <span class="stat-value">${photoCount}</span>
        ${unreadPhotos ? `<span class="stat-unread">${unreadPhotos}</span>` : ''}
      </a>
      <a class="stat" href="#/lugares">
        <span class="stat-label">📍 Lugares</span>
        <span class="stat-value">${placeCount}</span>
        ${unreadPlaces ? `<span class="stat-unread">${unreadPlaces}</span>` : ''}
      </a>
    </div>

    <div class="dashboard-grid">
      <div class="photo-widget" id="photo-widget">
        <div class="pw-empty">Aún no hay fotos para mostrar aquí.</div>
      </div>
      <section class="section-block" style="margin: 0;">
        <div class="section-head">
          <h2>Notas recientes</h2>
          <a href="#/notas/publicas">Ver todas →</a>
        </div>
        <div class="grid-cards" id="dash-notes-grid"></div>
      </section>
    </div>

    <section class="section-block" id="dash-media">
      <div class="section-head">
        <h2>Música reciente</h2>
        <a href="#/musica">Ver toda →</a>
      </div>
      <div class="grid-cards" id="dash-media-grid"></div>
    </section>

    <section class="section-block" id="dash-photos">
      <div class="section-head">
        <h2>Fotos recientes</h2>
        <a href="#/fotos">Ver todas →</a>
      </div>
      <div class="photo-grid" id="dash-photos-grid"></div>
    </section>

    <section class="section-block" id="dash-places">
      <div class="section-head">
        <h2>Lugares recientes</h2>
        <a href="#/lugares">Ver todos →</a>
      </div>
      <div class="grid-cards" id="dash-places-grid"></div>
    </section>
  `;

  if (allUnread.length) {
    const list = $('#unread-list');
    allUnread.slice(0, 6).forEach(item => {
      const a = document.createElement('a');
      a.className = 'unread-item';
      a.href = item._route;
      a.innerHTML = `<span class="icon">${item._icon}</span><span>${escapeHtml(item.name || item.title || item.caption || 'Sin título')}</span><span class="who">— ${escapeHtml(item.created_by)}, ${fmtDate(item.created_at)}</span>`;
      list.appendChild(a);
    });
  }

  // Recent notes (max 4)
  const notesGrid = $('#dash-notes-grid');
  const recentNotes = state.notes.slice(0, 4);
  if (recentNotes.length) recentNotes.forEach(n => notesGrid.appendChild(renderNoteCard(n)));
  else notesGrid.innerHTML = '<div class="empty">Aún no hay notas.</div>';

  // Recent media (max 4)
  const mediaGrid = $('#dash-media-grid');
  const recentMedia = state.media.slice(0, 4);
  if (recentMedia.length) recentMedia.forEach(m => mediaGrid.appendChild(renderMediaCard(m)));
  else mediaGrid.innerHTML = '<div class="empty">Aún no hay música.</div>';

  // Recent photos
  const photosGrid = $('#dash-photos-grid');
  const recentPhotos = state.photos.slice(0, 8);
  if (recentPhotos.length) recentPhotos.forEach((p, i) => photosGrid.appendChild(renderPhoto(p, recentPhotos, i)));
  else photosGrid.innerHTML = '<div class="empty">Aún no hay fotos.</div>';

  // Recent places (max 3)
  const placesGrid = $('#dash-places-grid');
  const recentPlaces = state.places.slice(0, 3);
  if (recentPlaces.length) recentPlaces.forEach(p => placesGrid.appendChild(renderPlaceCard(p)));
  else placesGrid.innerHTML = '<div class="empty">Aún no hay lugares.</div>';

  setupPhotoWidget();
}

// ============================================================
// Rotating photo widget on dashboard
// ============================================================
let photoWidgetTimer = null;
function setupPhotoWidget() {
  const root = $('#photo-widget');
  if (!root) return;
  if (photoWidgetTimer) { clearInterval(photoWidgetTimer); photoWidgetTimer = null; }
  const cfg = state.settings.photo_widget || { mode: 'featured', interval_ms: 6000 };
  let pool = [];
  if (cfg.mode === 'featured') {
    pool = state.photos.filter(p => p.featured);
    if (!pool.length) pool = state.photos; // fallback
  } else {
    pool = state.photos;
  }
  if (!pool.length) {
    root.innerHTML = `<div class="pw-empty">Aún no hay fotos para mostrar. Agrega algunas en la sección 📸.</div>`;
    return;
  }
  root.innerHTML = pool.map((p, i) =>
    `<img src="${escapeHtml(publicImageUrl(p.storage_path))}" alt="${escapeHtml(p.caption || '')}" class="${i === 0 ? 'active' : ''}" loading="lazy" />`
  ).join('') + `
    <div class="pw-dots">${cfg.mode === 'featured' ? '⭐ destacadas' : 'todas'} · ${pool.length}</div>
    ${pool[0].caption ? `<div class="pw-cap" id="pw-cap">${escapeHtml(pool[0].caption)}</div>` : '<div class="pw-cap" id="pw-cap" hidden></div>'}
  `;

  root.dataset.idx = '0';
  root.addEventListener('click', () => {
    const i = Number(root.dataset.idx || 0);
    openLightbox(pool, i);
  });

  if (pool.length > 1) {
    let i = 0;
    const cap = $('.pw-cap', root);
    photoWidgetTimer = setInterval(() => {
      const imgs = $$('img', root);
      imgs[i].classList.remove('active');
      i = (i + 1) % pool.length;
      imgs[i].classList.add('active');
      root.dataset.idx = i;
      if (cap) {
        if (pool[i].caption) { cap.textContent = pool[i].caption; cap.hidden = false; }
        else { cap.hidden = true; }
      }
    }, cfg.interval_ms || 6000);
  }
}

// ============================================================
// Page: Notas
// ============================================================
function renderNotas(root, visibility) {
  const label = visibility === 'public' ? 'Notas públicas' : 'Notas privadas';
  const icon = visibility === 'public' ? '🌐' : '🔒';
  const sub = visibility === 'public' ? 'Visibles para los dos' : 'Solo para los dos';
  const filterTag = state.filterTag.notas;
  let filtered = state.notes.filter(n => n.visibility === visibility);
  if (filterTag) filtered = filtered.filter(n => Array.isArray(n.tags) && n.tags.includes(filterTag));

  // Build tag-count map for filter row
  const tagCounts = new Map();
  state.notes.filter(n => n.visibility === visibility).forEach(n => {
    (n.tags || []).forEach(t => tagCounts.set(t, (tagCounts.get(t) || 0) + 1));
  });
  const sortedTags = Array.from(tagCounts.entries()).sort((a, b) => b[1] - a[1]);

  root.innerHTML = `
    <div class="page-head">
      <div>
        <h1>${icon} ${label}</h1>
        <div class="sub">${sub}</div>
      </div>
      <div class="view-toggle" id="notes-view-toggle">
        <button data-v="cards" class="${state.view.notas === 'cards' ? 'active' : ''}">Tarjetas</button>
        <button data-v="list" class="${state.view.notas === 'list' ? 'active' : ''}">Lista</button>
      </div>
    </div>
    ${sortedTags.length ? `
      <div class="tag-filter-row" id="tag-filter-row">
        <button class="tag-chip ${!filterTag ? 'active' : ''}" data-tag="" style="--tag-color: var(--text-dim);">Todas</button>
        ${sortedTags.map(([tag, count]) => `
          <button class="tag-chip ${filterTag === tag ? 'active' : ''}" data-tag="${escapeHtml(tag)}" style="--tag-color: ${tagColor(tag)};">
            #${escapeHtml(tag)} <span class="count">${count}</span>
          </button>
        `).join('')}
      </div>
    ` : ''}
    <div class="${state.view.notas === 'cards' ? 'grid-cards' : 'grid-list'}" id="notes-grid"></div>
  `;

  $('#notes-view-toggle').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-v]');
    if (!b) return;
    state.view.notas = b.dataset.v;
    renderNotas(root, visibility);
  });
  const filterRow = $('#tag-filter-row');
  if (filterRow) {
    filterRow.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-tag]');
      if (!b) return;
      state.filterTag.notas = b.dataset.tag || null;
      renderNotas(root, visibility);
    });
  }

  const grid = $('#notes-grid');
  grid.appendChild(renderNewCtaTile('Nueva nota', () => openNoteEditor(null, visibility)));
  filtered.forEach(n => grid.appendChild(renderNoteCard(n)));
  if (!filtered.length && filterTag) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = `No hay notas con la etiqueta #${filterTag}.`;
    grid.appendChild(empty);
  }
}

function renderNewCtaTile(label, onOpen) {
  const tile = document.createElement('article');
  tile.className = 'card new-cta';
  tile.setAttribute('role', 'button');
  tile.setAttribute('tabindex', '0');
  tile.setAttribute('aria-label', label);
  tile.innerHTML = `<div class="plus" aria-hidden="true">＋</div><div class="label">${escapeHtml(label)}</div>`;
  tile.addEventListener('click', onOpen);
  tile.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(); } });
  return tile;
}

function renderNoteCard(note) {
  const card = document.createElement('article');
  card.className = 'card clickable with-stripe';
  if (note.pinned) card.classList.add('pinned');
  const stripeColor = (note.tags && note.tags.length) ? tagColor(note.tags[0]) : 'var(--border)';
  card.style.setProperty('--stripe', stripeColor);
  card.setAttribute('role', 'button');
  card.setAttribute('tabindex', '0');

  if (isUnread(note)) {
    const dot = document.createElement('span');
    dot.className = 'unread-dot';
    card.appendChild(dot);
  }

  // Actions: pin
  const actions = document.createElement('div');
  actions.className = 'card-actions';
  actions.innerHTML = `<button title="${note.pinned ? 'Desanclar' : 'Anclar'}" class="${note.pinned ? 'is-on' : ''}" data-action="pin">📌</button>`;
  actions.addEventListener('click', async (e) => {
    e.stopPropagation();
    const btn = e.target.closest('button');
    if (!btn) return;
    if (btn.dataset.action === 'pin') {
      const next = !note.pinned;
      note.pinned = next;
      await supabase.from('notes').update({ pinned: next }).eq('id', note.id);
      await router();
    }
  });
  card.appendChild(actions);

  const body = document.createElement('div');
  body.className = 'body';

  if (note.tags && note.tags.length) {
    const tr = document.createElement('div');
    tr.className = 'tag-row';
    note.tags.forEach(t => {
      const tEl = document.createElement('span');
      tEl.className = 'tag';
      tEl.style.setProperty('--tag-color', tagColor(t));
      tEl.textContent = '#' + t;
      tr.appendChild(tEl);
    });
    body.appendChild(tr);
  }

  const h = document.createElement('h3');
  h.textContent = note.title;
  body.appendChild(h);

  if (note.content) {
    const p = document.createElement('div');
    p.className = 'preview';
    p.textContent = note.content;
    body.appendChild(p);
  }

  if (Array.isArray(note.images) && note.images.length) {
    const gallery = document.createElement('div');
    gallery.className = 'gallery';
    note.images.forEach(path => {
      const img = document.createElement('img');
      img.src = publicImageUrl(path); img.alt = ''; img.loading = 'lazy';
      gallery.appendChild(img);
    });
    body.appendChild(gallery);
  }

  if (Array.isArray(note.links) && note.links.length) {
    const lk = document.createElement('div');
    lk.className = 'links';
    note.links.forEach(link => {
      const a = document.createElement('a');
      a.href = link.url; a.target = '_blank'; a.rel = 'noopener noreferrer';
      a.textContent = link.label || link.url;
      a.addEventListener('click', e => e.stopPropagation());
      lk.appendChild(a);
    });
    body.appendChild(lk);
  }

  const meta = document.createElement('div');
  meta.className = 'meta';
  const badge = note.visibility === 'private'
    ? '<span class="badge private">🔒 Privada</span>'
    : '<span class="badge">🌐 Pública</span>';
  meta.innerHTML = `<span>${fmtDate(note.updated_at || note.created_at)} · ${escapeHtml(note.created_by || '?')}</span>${badge}`;
  body.appendChild(meta);

  card.appendChild(body);
  card.addEventListener('click', () => openNoteEditor(note));
  card.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openNoteEditor(note); } });
  return card;
}

// ============================================================
// Page: Música
// ============================================================
function renderMusica(root) {
  root.innerHTML = `
    <div class="page-head">
      <div>
        <h1>🎵 Música</h1>
        <div class="sub">Playlists de Spotify y videos de YouTube</div>
      </div>
      <div class="view-toggle" id="media-view-toggle">
        <button data-v="cards" class="${state.view.musica === 'cards' ? 'active' : ''}">Tarjetas</button>
        <button data-v="list" class="${state.view.musica === 'list' ? 'active' : ''}">Lista</button>
      </div>
    </div>
    <div class="${state.view.musica === 'cards' ? 'grid-cards' : 'grid-list'}" id="media-grid"></div>
  `;
  $('#media-view-toggle').addEventListener('click', e => {
    const b = e.target.closest('button[data-v]');
    if (!b) return;
    state.view.musica = b.dataset.v;
    renderMusica(root);
  });

  const grid = $('#media-grid');
  grid.appendChild(renderNewCtaTile('Nueva música', () => openMediaEditor(null)));
  state.media.forEach(m => grid.appendChild(renderMediaCard(m)));
}

function renderMediaCard(m) {
  const card = document.createElement('article');
  card.className = `card clickable media-card ${m.kind}`;
  if (m.pinned) card.classList.add('pinned');
  card.setAttribute('role', 'button');
  card.setAttribute('tabindex', '0');

  if (isUnread(m)) {
    const dot = document.createElement('span');
    dot.className = 'unread-dot';
    card.appendChild(dot);
  }

  // Card actions: pin + edit
  const actions = document.createElement('div');
  actions.className = 'card-actions';
  actions.innerHTML = `
    <button title="Editar" data-action="edit">✎</button>
    <button title="${m.pinned ? 'Desanclar' : 'Anclar'}" class="${m.pinned ? 'is-on' : ''}" data-action="pin">📌</button>
  `;
  actions.addEventListener('click', async (e) => {
    e.stopPropagation();
    const btn = e.target.closest('button');
    if (!btn) return;
    if (btn.dataset.action === 'edit') openMediaEditor(m);
    if (btn.dataset.action === 'pin') {
      const next = !m.pinned;
      m.pinned = next;
      await supabase.from('media').update({ pinned: next }).eq('id', m.id);
      await router();
    }
  });
  card.appendChild(actions);

  // Thumbnail with play overlay
  const thumbWrap = document.createElement('div');
  thumbWrap.className = 'thumb-wrap';
  if (m.thumbnail_url) {
    const img = document.createElement('img');
    img.src = m.thumbnail_url; img.alt = ''; img.loading = 'lazy';
    thumbWrap.appendChild(img);
  } else {
    const ph = document.createElement('div');
    ph.className = 'placeholder';
    ph.textContent = m.kind === 'spotify' ? '🎵' : '▶️';
    thumbWrap.appendChild(ph);
  }
  const overlay = document.createElement('div');
  overlay.className = 'play-overlay';
  overlay.innerHTML = '<div class="play">▶</div>';
  thumbWrap.appendChild(overlay);
  card.appendChild(thumbWrap);

  const body = document.createElement('div');
  body.className = 'body';
  const h = document.createElement('h3');
  h.textContent = m.title;
  body.appendChild(h);
  if (m.note) {
    const p = document.createElement('div');
    p.className = 'preview';
    p.textContent = m.note;
    body.appendChild(p);
  }
  const meta = document.createElement('div');
  meta.className = 'meta';
  const kindLabel = m.kind === 'spotify' ? '🟢 Spotify' : '▶️ YouTube';
  meta.innerHTML = `<span>${fmtDate(m.created_at)} · ${escapeHtml(m.created_by || '?')}</span><span class="badge">${kindLabel}</span>`;
  body.appendChild(meta);
  card.appendChild(body);

  // Whole card → theater
  card.addEventListener('click', () => openTheater(m));
  card.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openTheater(m); } });
  return card;
}

// ============================================================
// Page: Fotos
// ============================================================
function renderFotos(root) {
  root.innerHTML = `
    <div class="page-head">
      <div>
        <h1>📸 Fotos</h1>
        <div class="sub">Nuestro álbum · ${state.photos.length} fotos</div>
      </div>
      <div class="actions">
        ${state.photos.length ? `<button class="btn" id="view-all-btn">Ver todas en presentación</button>` : ''}
        <button class="btn primary" id="upload-btn">+ Subir fotos</button>
      </div>
    </div>
    <div class="photo-grid" id="photo-grid"></div>
  `;
  $('#upload-btn').addEventListener('click', openPhotoUpload);
  if (state.photos.length) {
    $('#view-all-btn').addEventListener('click', () => openLightbox(state.photos, 0));
  }
  const grid = $('#photo-grid');
  state.photos.forEach((p, i) => grid.appendChild(renderPhoto(p, state.photos, i)));
  if (!state.photos.length) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = 'Aún no hay fotos. Sube las primeras con el botón "Subir fotos".';
    grid.appendChild(empty);
  }
}

function renderPhoto(p, list, index) {
  const tile = document.createElement('div');
  tile.className = 'photo';
  tile.setAttribute('role', 'button');
  tile.setAttribute('tabindex', '0');
  const src = publicImageUrl(p.storage_path);
  tile.innerHTML = `<img src="${escapeHtml(src)}" alt="${escapeHtml(p.caption || '')}" loading="lazy" />` +
    (p.caption ? `<div class="photo-caption">${escapeHtml(p.caption)}</div>` : '');

  const indicator = document.createElement('div');
  indicator.className = 'photo-indicator';
  if (p.pinned) indicator.innerHTML += `<span title="Anclada">📌</span>`;
  if (p.featured) indicator.innerHTML += `<span title="Destacada">⭐</span>`;
  if (indicator.children.length) tile.appendChild(indicator);

  if (isUnread(p)) {
    const dot = document.createElement('span');
    dot.className = 'unread-dot';
    tile.appendChild(dot);
  }

  tile.addEventListener('click', () => openLightbox(list, index));
  tile.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openLightbox(list, index); } });
  return tile;
}

// ============================================================
// Page: Lugares (Leaflet map)
// ============================================================
let placesMap = null;
let placesLayerGroup = null;
let placingMode = false;

function renderLugares(root) {
  const filterTag = state.filterTag.lugares;
  let filtered = state.places;
  if (filterTag) filtered = filtered.filter(p => Array.isArray(p.tags) && p.tags.includes(filterTag));

  const tagCounts = new Map();
  state.places.forEach(p => (p.tags || []).forEach(t => tagCounts.set(t, (tagCounts.get(t) || 0) + 1)));
  const sortedTags = Array.from(tagCounts.entries()).sort((a, b) => b[1] - a[1]);

  root.innerHTML = `
    <div class="page-head">
      <div>
        <h1>📍 Lugares</h1>
        <div class="sub">Nuestros sitios en el mapa</div>
      </div>
      <div class="actions">
        <button class="btn primary" id="new-place-btn">+ Nuevo lugar</button>
      </div>
    </div>
    <div class="placing-banner" id="placing-banner" hidden>
      <span>🖱 Haz clic en el mapa para colocar el lugar.</span>
      <button class="btn" id="cancel-placing">Cancelar</button>
    </div>
    ${sortedTags.length ? `
      <div class="tag-filter-row" id="places-tag-filter">
        <button class="tag-chip ${!filterTag ? 'active' : ''}" data-tag="" style="--tag-color: var(--text-dim);">Todos</button>
        ${sortedTags.map(([tag, count]) => `
          <button class="tag-chip ${filterTag === tag ? 'active' : ''}" data-tag="${escapeHtml(tag)}" style="--tag-color: ${tagColor(tag)};">
            #${escapeHtml(tag)} <span class="count">${count}</span>
          </button>
        `).join('')}
      </div>
    ` : ''}
    <div id="places-map"></div>
    <div class="grid-cards" id="places-grid"></div>
  `;

  $('#new-place-btn').addEventListener('click', () => enterPlacingMode());
  $('#cancel-placing').addEventListener('click', () => exitPlacingMode());
  const filterRow = $('#places-tag-filter');
  if (filterRow) {
    filterRow.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-tag]');
      if (!b) return;
      state.filterTag.lugares = b.dataset.tag || null;
      renderLugares(root);
    });
  }

  // Init map
  initPlacesMap(filtered);

  // Cards list
  const grid = $('#places-grid');
  if (!filtered.length) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = filterTag ? `No hay lugares con #${filterTag}.` : 'Aún no hay lugares.';
    grid.appendChild(empty);
  } else {
    filtered.forEach(p => grid.appendChild(renderPlaceCard(p)));
  }
}

function initPlacesMap(places) {
  placesLayerGroup = null;
  const mapEl = $('#places-map');
  if (!mapEl) return;

  // Default center: world view; fit to bounds if we have places
  if (placesMap) {
    placesMap.remove();
    placesMap = null;
  }
  placesMap = L.map(mapEl, { scrollWheelZoom: true }).setView([20, 0], 2);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '© OpenStreetMap',
  }).addTo(placesMap);

  placesLayerGroup = L.layerGroup().addTo(placesMap);

  if (places.length) {
    const bounds = [];
    places.forEach(p => {
      const color = (p.tags && p.tags.length) ? tagColor(p.tags[0]) : 'var(--accent)';
      const icon = L.divIcon({
        className: '',
        html: `<div class="leaflet-marker-tag" style="background:${color};">📍</div>`,
        iconSize: [30, 30],
        iconAnchor: [15, 15],
      });
      const marker = L.marker([p.lat, p.lng], { icon }).addTo(placesLayerGroup);
      const tagHtml = (p.tags || []).map(t => `<span style="display:inline-block;background:${tagColor(t)};color:#fff;padding:1px 8px;border-radius:999px;font-size:11px;margin-right:3px;">#${escapeHtml(t)}</span>`).join('');
      marker.bindPopup(`
        <strong>${escapeHtml(p.name)}</strong>
        ${p.description ? `<div style="margin-top:4px;color:#555;">${escapeHtml(p.description)}</div>` : ''}
        ${tagHtml ? `<div style="margin-top:6px;">${tagHtml}</div>` : ''}
        <div style="margin-top:6px;"><button id="popup-edit-${p.id}" class="popup-edit-btn" style="background:#7a4ed8;color:white;border:0;padding:4px 10px;border-radius:6px;cursor:pointer;font-size:12px;">Editar</button></div>
      `);
      marker.on('popupopen', () => {
        const btn = document.getElementById(`popup-edit-${p.id}`);
        if (btn) btn.addEventListener('click', () => openPlaceEditor(p));
        if (isUnread(p)) markSeen('places', p);
      });
      bounds.push([p.lat, p.lng]);
    });
    if (bounds.length === 1) placesMap.setView(bounds[0], 13);
    else placesMap.fitBounds(bounds, { padding: [40, 40] });
  }

  // Click-to-place mode
  placesMap.on('click', (e) => {
    if (!placingMode) return;
    openPlaceEditor(null, { lat: e.latlng.lat, lng: e.latlng.lng });
    exitPlacingMode();
  });
}

function enterPlacingMode() {
  placingMode = true;
  const banner = $('#placing-banner');
  if (banner) banner.hidden = false;
  if (placesMap) placesMap.getContainer().style.cursor = 'crosshair';
}
function exitPlacingMode() {
  placingMode = false;
  const banner = $('#placing-banner');
  if (banner) banner.hidden = true;
  if (placesMap) placesMap.getContainer().style.cursor = '';
}

function renderPlaceCard(p) {
  const card = document.createElement('article');
  card.className = 'card clickable with-stripe';
  if (p.pinned) card.classList.add('pinned');
  card.style.setProperty('--stripe', (p.tags && p.tags.length) ? tagColor(p.tags[0]) : 'var(--border)');

  if (isUnread(p)) {
    const dot = document.createElement('span');
    dot.className = 'unread-dot';
    card.appendChild(dot);
  }

  const actions = document.createElement('div');
  actions.className = 'card-actions';
  actions.innerHTML = `<button title="${p.pinned ? 'Desanclar' : 'Anclar'}" class="${p.pinned ? 'is-on' : ''}" data-action="pin">📌</button>`;
  actions.addEventListener('click', async (e) => {
    e.stopPropagation();
    const btn = e.target.closest('button[data-action="pin"]');
    if (!btn) return;
    const next = !p.pinned;
    p.pinned = next;
    await supabase.from('places').update({ pinned: next }).eq('id', p.id);
    await router();
  });
  card.appendChild(actions);

  const body = document.createElement('div');
  body.className = 'body';

  if (p.tags && p.tags.length) {
    const tr = document.createElement('div');
    tr.className = 'tag-row';
    p.tags.forEach(t => {
      const tEl = document.createElement('span');
      tEl.className = 'tag';
      tEl.style.setProperty('--tag-color', tagColor(t));
      tEl.textContent = '#' + t;
      tr.appendChild(tEl);
    });
    body.appendChild(tr);
  }

  const h = document.createElement('h3');
  h.textContent = p.name;
  body.appendChild(h);
  if (p.description) {
    const desc = document.createElement('div');
    desc.className = 'preview';
    desc.textContent = p.description;
    body.appendChild(desc);
  }
  const meta = document.createElement('div');
  meta.className = 'meta';
  meta.innerHTML = `<span>${fmtDate(p.created_at)} · ${escapeHtml(p.created_by || '?')}</span><span class="badge">${p.lat.toFixed(3)}, ${p.lng.toFixed(3)}</span>`;
  body.appendChild(meta);

  card.appendChild(body);
  card.addEventListener('click', () => {
    if (placesMap) {
      placesMap.setView([p.lat, p.lng], 14, { animate: true });
      // find and open popup
      placesLayerGroup.eachLayer(l => {
        const ll = l.getLatLng();
        if (Math.abs(ll.lat - p.lat) < 1e-6 && Math.abs(ll.lng - p.lng) < 1e-6) l.openPopup();
      });
    }
    if (isUnread(p)) markSeen('places', p);
  });
  return card;
}

// ============================================================
// Page: Configuración
// ============================================================
function renderConfig(root) {
  const cfg = state.settings.photo_widget || { mode: 'featured', interval_ms: 6000 };
  root.innerHTML = `
    <div class="page-head">
      <div>
        <h1>⚙️ Configuración</h1>
        <div class="sub">Solo para ti — los cambios se guardan al instante</div>
      </div>
    </div>
    <div class="settings-grid">
      <div class="settings-card">
        <h3>Mi clave</h3>
        <div class="field"><label>Usuario</label><input type="text" value="${escapeHtml(state.currentUser)}" disabled /></div>
        <div class="field"><label>Clave actual</label><input type="password" id="cfg-old-pw" placeholder="0000" /></div>
        <div class="field"><label>Nueva clave</label><input type="password" id="cfg-new-pw" placeholder="Mínimo 4 caracteres" /></div>
        <div class="row" style="margin-top:.4rem;">
          <button class="btn primary" id="cfg-save-pw">Cambiar clave</button>
          <span class="status" id="cfg-pw-status"></span>
        </div>
      </div>

      <div class="settings-card">
        <h3>Widget de fotos en el inicio</h3>
        <div class="sub" style="color:var(--text-dim);font-size:.82rem;">Decide qué fotos rotan en la portada del dashboard.</div>
        <div class="opts" id="cfg-widget-mode">
          <button data-mode="featured" class="${cfg.mode === 'featured' ? 'active' : ''}">⭐ Solo destacadas</button>
          <button data-mode="all" class="${cfg.mode === 'all' ? 'active' : ''}">Todas las fotos</button>
        </div>
        <div class="row" style="margin-top:.7rem;">
          <label style="font-size:.8rem;color:var(--text-dim);">Intervalo (segundos)</label>
          <input type="number" min="2" max="60" step="1" value="${(cfg.interval_ms || 6000)/1000}" id="cfg-widget-interval" style="width:80px;padding:.35rem .5rem;border-radius:6px;border:1px solid var(--border);background:var(--surface-alt);color:var(--text);" />
          <button class="btn" id="cfg-widget-save">Guardar</button>
          <span class="status" id="cfg-widget-status"></span>
        </div>
        <div class="sub" style="color:var(--text-dim);font-size:.78rem;margin-top:.5rem;">
          Para destacar fotos, abre cualquier foto y pulsa ⭐.
        </div>
      </div>
    </div>
  `;

  $('#cfg-save-pw').addEventListener('click', async () => {
    const oldp = $('#cfg-old-pw').value;
    const newp = $('#cfg-new-pw').value;
    const statusEl = $('#cfg-pw-status');
    if (!oldp || !newp) { setStatus(statusEl, 'Llena los dos campos', true); return; }
    if (newp.length < 4) { setStatus(statusEl, 'La nueva clave debe tener al menos 4 caracteres', true); return; }
    setStatus(statusEl, 'Cambiando…');
    try {
      const { data, error } = await supabase.rpc('update_password', {
        p_name: state.currentUser, p_old_password: oldp, p_new_password: newp,
      });
      if (error) throw error;
      if (!data) { setStatus(statusEl, 'Clave actual incorrecta', true); return; }
      setStatus(statusEl, 'Clave cambiada ✓');
      $('#cfg-old-pw').value = ''; $('#cfg-new-pw').value = '';
    } catch (e) { setStatus(statusEl, `Error: ${e.message || e}`, true); }
  });

  $('#cfg-widget-mode').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-mode]');
    if (!b) return;
    $$('#cfg-widget-mode button').forEach(x => x.classList.toggle('active', x === b));
  });

  $('#cfg-widget-save').addEventListener('click', async () => {
    const mode = $('#cfg-widget-mode button.active').dataset.mode;
    const sec = Math.max(2, Math.min(60, Number($('#cfg-widget-interval').value) || 6));
    setStatus($('#cfg-widget-status'), 'Guardando…');
    await saveSetting('photo_widget', { mode, interval_ms: sec * 1000 });
    setStatus($('#cfg-widget-status'), 'Guardado ✓');
  });
}

// ============================================================
// Note editor
// ============================================================
const dlgNote = $('#dlg-note');
const noteDraft = {
  id: null, title: '', content: '', visibility: 'public',
  links: [], images: [], tags: [], pinned: false,
};

function openNoteEditor(note, defaultVis = 'public') {
  noteDraft.id = note?.id || null;
  noteDraft.title = note?.title || '';
  noteDraft.content = note?.content || '';
  noteDraft.visibility = note?.visibility || defaultVis;
  noteDraft.links = Array.isArray(note?.links) ? [...note.links] : [];
  noteDraft.images = Array.isArray(note?.images) ? [...note.images] : [];
  noteDraft.tags = Array.isArray(note?.tags) ? [...note.tags] : [];
  noteDraft.pinned = !!note?.pinned;

  $('#note-title-input').value = noteDraft.title;
  $('#note-plain').value = noteDraft.content;
  setNoteVisibility(noteDraft.visibility);
  setNotePin(noteDraft.pinned);
  renderNoteLinkChips();
  renderNoteImagePreviews();
  renderNoteTags();
  renderNoteTagSuggestions('');
  $('#note-tag-input').value = '';
  $('#note-status').textContent = '';
  $('#dlg-note-title').textContent = note ? 'Editar nota' : 'Nueva nota';
  $('#note-save').textContent = note ? 'Actualizar nota' : 'Guardar nota';
  $('#note-delete').hidden = !note;
  dlgNote.showModal();
  setTimeout(() => $('#note-title-input').focus(), 0);

  if (note && isUnread(note)) markSeen('notes', note);
}

function setNoteVisibility(v) {
  noteDraft.visibility = v;
  $$('#note-visibility button').forEach(b => b.classList.toggle('active', b.dataset.vis === v));
}
function setNotePin(p) {
  noteDraft.pinned = p;
  const b = $('#note-pin-toggle');
  b.classList.toggle('is-pinned', p);
  b.textContent = p ? '📌 Anclada' : '📌 Anclar';
}

function renderNoteLinkChips() {
  const root = $('#note-links');
  root.innerHTML = '';
  noteDraft.links.forEach((link, i) => {
    const chip = document.createElement('span');
    chip.className = 'chip';
    chip.innerHTML = `🔗 <a href="${escapeHtml(link.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(link.label || link.url)}</a> <button type="button" aria-label="Quitar">×</button>`;
    chip.querySelector('button').addEventListener('click', () => { noteDraft.links.splice(i, 1); renderNoteLinkChips(); });
    root.appendChild(chip);
  });
}

function renderNoteImagePreviews() {
  const root = $('#note-images');
  root.innerHTML = '';
  noteDraft.images.forEach((path, i) => {
    const thumb = document.createElement('div');
    thumb.className = 'thumb';
    thumb.innerHTML = `<img src="${escapeHtml(publicImageUrl(path))}" alt="" /><button class="remove" type="button" aria-label="Quitar">×</button>`;
    thumb.querySelector('button.remove').addEventListener('click', async () => {
      try { await supabase.storage.from(BUCKET).remove([path]); } catch {}
      noteDraft.images.splice(i, 1); renderNoteImagePreviews();
    });
    root.appendChild(thumb);
  });
}

function renderNoteTags() {
  const root = $('#note-tags');
  root.innerHTML = '';
  noteDraft.tags.forEach((t, i) => {
    const chip = document.createElement('span');
    chip.className = 'tag-chip-selected';
    chip.style.setProperty('--tag-color', tagColor(t));
    chip.innerHTML = `#${escapeHtml(t)} <button type="button" aria-label="Quitar">×</button>`;
    chip.querySelector('button').addEventListener('click', () => { noteDraft.tags.splice(i, 1); renderNoteTags(); });
    root.appendChild(chip);
  });
}

function renderNoteTagSuggestions(query) {
  const root = $('#note-tag-suggestions');
  root.innerHTML = '';
  const existingTags = new Set();
  state.notes.forEach(n => (n.tags || []).forEach(t => existingTags.add(t)));
  TAG_SUGGESTIONS_NOTES.forEach(t => existingTags.add(t));
  let all = Array.from(existingTags).filter(t => !noteDraft.tags.includes(t));
  if (query) {
    const q = query.toLowerCase();
    all = all.filter(t => t.toLowerCase().includes(q));
  }
  all.slice(0, 10).forEach(t => {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'tag-sugg';
    el.textContent = '#' + t;
    el.addEventListener('click', () => addNoteTag(t));
    root.appendChild(el);
  });
}

function addNoteTag(raw) {
  const t = raw.replace(/^#/, '').trim();
  if (!t) return;
  if (noteDraft.tags.some(x => x.toLowerCase() === t.toLowerCase())) return;
  noteDraft.tags.push(t);
  renderNoteTags();
  renderNoteTagSuggestions($('#note-tag-input').value);
}

$('#note-visibility').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-vis]');
  if (b) setNoteVisibility(b.dataset.vis);
});
$('#note-pin-toggle').addEventListener('click', () => setNotePin(!noteDraft.pinned));

$('#note-tag-input').addEventListener('input', (e) => renderNoteTagSuggestions(e.target.value));
$('#note-tag-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ',') {
    e.preventDefault();
    addNoteTag(e.target.value);
    e.target.value = '';
    renderNoteTagSuggestions('');
  } else if (e.key === 'Backspace' && !e.target.value && noteDraft.tags.length) {
    noteDraft.tags.pop();
    renderNoteTags();
    renderNoteTagSuggestions('');
  }
});

$('#note-add-link').addEventListener('click', () => {
  const url = prompt('URL del enlace:');
  if (!url) return;
  let normalized = url.trim();
  if (!/^https?:\/\//i.test(normalized)) normalized = 'https://' + normalized;
  const label = prompt('Etiqueta (opcional):', '') || '';
  noteDraft.links.push({ url: normalized, label });
  renderNoteLinkChips();
});

$('#note-add-image').addEventListener('click', () => $('#note-image-input').click());

$('#note-image-input').addEventListener('change', async () => {
  const files = Array.from($('#note-image-input').files || []);
  $('#note-image-input').value = '';
  if (!files.length) return;
  setStatus($('#note-status'), 'Subiendo…');
  try {
    for (const file of files) {
      const ext = (file.name.split('.').pop() || 'png').toLowerCase();
      const path = `${crypto.randomUUID()}.${ext}`;
      const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
        cacheControl: '3600', upsert: false, contentType: file.type,
      });
      if (error) throw error;
      noteDraft.images.push(path);
    }
    renderNoteImagePreviews();
    setStatus($('#note-status'), 'Subida completa');
  } catch (e) { setStatus($('#note-status'), `Error al subir: ${e.message || e}`, true); }
});

$('#note-save').addEventListener('click', async () => {
  const title = $('#note-title-input').value.trim();
  if (!title) { setStatus($('#note-status'), 'El título es obligatorio', true); $('#note-title-input').focus(); return; }
  const payload = {
    title,
    content: $('#note-plain').value,
    content_is_rich: false,
    visibility: noteDraft.visibility,
    links: noteDraft.links,
    images: noteDraft.images,
    tags: noteDraft.tags,
    pinned: noteDraft.pinned,
  };
  setStatus($('#note-status'), 'Guardando…');
  try {
    if (noteDraft.id) {
      const { error } = await supabase.from('notes').update(payload).eq('id', noteDraft.id);
      if (error) throw error;
    } else {
      payload.created_by = state.currentUser;
      payload.seen_by = [state.currentUser];
      const { error } = await supabase.from('notes').insert(payload);
      if (error) throw error;
    }
    dlgNote.close();
    await router();
  } catch (e) { setStatus($('#note-status'), `Error al guardar: ${e.message || e}`, true); }
});

$('#note-delete').addEventListener('click', async () => {
  if (!noteDraft.id) return;
  const note = state.notes.find(n => n.id === noteDraft.id);
  if (!note) return;
  if (!confirm(`¿Eliminar "${note.title}"? Esta acción no se puede deshacer.`)) return;
  setStatus($('#note-status'), 'Eliminando…');
  try {
    if (Array.isArray(note.images) && note.images.length) {
      try { await supabase.storage.from(BUCKET).remove(note.images); } catch {}
    }
    const { error } = await supabase.from('notes').delete().eq('id', note.id);
    if (error) throw error;
    dlgNote.close();
    await router();
  } catch (e) { setStatus($('#note-status'), `Error al eliminar: ${e.message || e}`, true); }
});

// ============================================================
// Media editor
// ============================================================
const dlgMedia = $('#dlg-media');
const mediaDraft = { id: null, parsed: null, pinned: false, thumbnail_url: null };

function setMediaPin(p) {
  mediaDraft.pinned = p;
  const b = $('#media-pin-toggle');
  b.classList.toggle('is-pinned', p);
  b.textContent = p ? '📌 Anclada' : '📌 Anclar';
}

function updateMediaPreview() {
  const parsed = parseMediaUrl($('#media-url').value);
  mediaDraft.parsed = parsed;
  const preview = $('#media-preview');
  if (!parsed) { preview.hidden = true; preview.innerHTML = ''; return; }
  preview.hidden = false;
  preview.className = `embed-preview ${parsed.kind}`;
  preview.innerHTML = `<iframe loading="lazy" referrerpolicy="strict-origin-when-cross-origin" allow="autoplay; encrypted-media; picture-in-picture" src="${escapeHtml(parsed.embedUrl)}"></iframe>`;
}

async function tryAutofillTitle() {
  const parsed = parseMediaUrl($('#media-url').value);
  if (!parsed) return;
  const titleInput = $('#media-title-input');
  if (titleInput.value.trim()) return;
  $('#media-title-hint').textContent = '· buscando título…';
  const oembed = await fetchOembedTitle(parsed);
  $('#media-title-hint').textContent = '';
  if (oembed?.title) titleInput.value = oembed.title;
  if (oembed?.thumbnail) mediaDraft.thumbnail_url = oembed.thumbnail;
  else if (parsed.thumbnailUrl) mediaDraft.thumbnail_url = parsed.thumbnailUrl;
}

function openMediaEditor(m) {
  mediaDraft.id = m?.id || null;
  mediaDraft.thumbnail_url = m?.thumbnail_url || null;
  $('#media-url').value = m?.url || '';
  $('#media-title-input').value = m?.title || '';
  $('#media-note-input').value = m?.note || '';
  $('#media-title-hint').textContent = '';
  setMediaPin(!!m?.pinned);
  if (m) updateMediaPreview();
  else { $('#media-preview').hidden = true; $('#media-preview').innerHTML = ''; }
  $('#media-status').textContent = '';
  $('#dlg-media-title').textContent = m ? 'Editar música' : 'Nueva música';
  $('#media-save').textContent = m ? 'Actualizar' : 'Guardar';
  $('#media-delete').hidden = !m;
  dlgMedia.showModal();
  setTimeout(() => (m ? $('#media-title-input') : $('#media-url')).focus(), 0);

  if (m && isUnread(m)) markSeen('media', m);
}

$('#media-url').addEventListener('input', updateMediaPreview);
$('#media-url').addEventListener('paste', () => setTimeout(() => { updateMediaPreview(); tryAutofillTitle(); }, 50));
$('#media-url').addEventListener('blur', () => tryAutofillTitle());
$('#media-pin-toggle').addEventListener('click', () => setMediaPin(!mediaDraft.pinned));

$('#media-save').addEventListener('click', async () => {
  const title = $('#media-title-input').value.trim();
  const parsed = parseMediaUrl($('#media-url').value);
  if (!parsed) { setStatus($('#media-status'), 'Pega un enlace válido de Spotify o YouTube', true); $('#media-url').focus(); return; }
  if (!title) { setStatus($('#media-status'), 'El título es obligatorio', true); $('#media-title-input').focus(); return; }
  const payload = {
    kind: parsed.kind,
    title,
    url: parsed.normalizedUrl,
    embed_url: parsed.embedUrl,
    thumbnail_url: mediaDraft.thumbnail_url || parsed.thumbnailUrl,
    note: $('#media-note-input').value,
    pinned: mediaDraft.pinned,
  };
  setStatus($('#media-status'), 'Guardando…');
  try {
    if (mediaDraft.id) {
      const { error } = await supabase.from('media').update(payload).eq('id', mediaDraft.id);
      if (error) throw error;
    } else {
      payload.created_by = state.currentUser;
      payload.seen_by = [state.currentUser];
      const { error } = await supabase.from('media').insert(payload);
      if (error) throw error;
    }
    dlgMedia.close();
    await router();
  } catch (e) { setStatus($('#media-status'), `Error al guardar: ${e.message || e}`, true); }
});

$('#media-delete').addEventListener('click', async () => {
  if (!mediaDraft.id) return;
  const m = state.media.find(x => x.id === mediaDraft.id);
  if (!m) return;
  if (!confirm(`¿Eliminar "${m.title}"? Esta acción no se puede deshacer.`)) return;
  setStatus($('#media-status'), 'Eliminando…');
  try {
    const { error } = await supabase.from('media').delete().eq('id', m.id);
    if (error) throw error;
    dlgMedia.close();
    await router();
  } catch (e) { setStatus($('#media-status'), `Error al eliminar: ${e.message || e}`, true); }
});

// ============================================================
// Theater (music play modal)
// ============================================================
const dlgTheater = $('#dlg-theater');
let theaterCurrent = null;

function openTheater(m) {
  theaterCurrent = m;
  const stage = $('#theater-stage');
  stage.className = `theater-stage ${m.kind}`;
  const src = m.embed_url + (m.embed_url.includes('?') ? '&' : '?') + 'autoplay=1';
  stage.innerHTML = `<iframe loading="eager" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" src="${escapeHtml(src)}"></iframe>`;
  $('#theater-title').textContent = m.title;
  dlgTheater.showModal();
  if (isUnread(m)) markSeen('media', m);
}

function closeTheater() {
  $('#theater-stage').innerHTML = '';
  if (dlgTheater.open) dlgTheater.close();
}

$('#theater-close').addEventListener('click', closeTheater);
$('#theater-edit').addEventListener('click', () => { const m = theaterCurrent; closeTheater(); if (m) openMediaEditor(m); });
dlgTheater.addEventListener('cancel', closeTheater);
dlgTheater.addEventListener('click', (e) => { if (e.target === dlgTheater) closeTheater(); });

// ============================================================
// Photo upload (drag-drop + multi)
// ============================================================
const dlgPhoto = $('#dlg-photo');
const dz = $('#photo-dropzone');
const uploadList = $('#upload-list');

function openPhotoUpload() {
  $('#photo-caption').value = '';
  uploadList.innerHTML = '';
  $('#photo-status').textContent = '';
  $('#photo-input').value = '';
  dlgPhoto.showModal();
}

function pushUploadRow(file) {
  const row = document.createElement('div');
  row.className = 'upload-row';
  const reader = new FileReader();
  reader.onload = () => row.querySelector('img.preview').src = reader.result;
  reader.readAsDataURL(file);
  row.innerHTML = `<img class="preview" src="" alt="" /><span class="name">${escapeHtml(file.name)}</span><div class="progress"><div></div></div>`;
  uploadList.appendChild(row);
  return row;
}

async function uploadOne(file) {
  const row = pushUploadRow(file);
  const bar = row.querySelector('.progress > div');
  bar.style.width = '20%';
  try {
    const ext = (file.name.split('.').pop() || 'png').toLowerCase();
    const path = `${crypto.randomUUID()}.${ext}`;
    const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, file, {
      cacheControl: '3600', upsert: false, contentType: file.type,
    });
    bar.style.width = '70%';
    if (upErr) throw upErr;
    const caption = $('#photo-caption').value;
    const { error: insErr } = await supabase.from('photos').insert({
      storage_path: path,
      caption,
      created_by: state.currentUser,
      seen_by: [state.currentUser],
    });
    if (insErr) throw insErr;
    row.classList.add('done');
  } catch (e) {
    console.error(e);
    row.classList.add('error');
    row.querySelector('.name').textContent += ` — ${e.message || e}`;
  }
}

async function handleFiles(fileList) {
  const files = Array.from(fileList || []).filter(f => f.type.startsWith('image/'));
  if (!files.length) return;
  setStatus($('#photo-status'), `Subiendo ${files.length}…`);
  for (const file of files) await uploadOne(file);
  setStatus($('#photo-status'), `Listo. Puedes seguir añadiendo o cerrar el diálogo.`);
}

$('#photo-pick-btn').addEventListener('click', () => $('#photo-input').click());
dz.addEventListener('click', (e) => { if (e.target.tagName !== 'BUTTON') $('#photo-input').click(); });
$('#photo-input').addEventListener('change', async (e) => {
  await handleFiles(e.target.files);
  e.target.value = '';
});

;['dragenter', 'dragover'].forEach(ev => {
  dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add('drag-over'); });
});
;['dragleave', 'drop'].forEach(ev => {
  dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove('drag-over'); });
});
dz.addEventListener('drop', async (e) => {
  await handleFiles(e.dataTransfer.files);
});

dlgPhoto.addEventListener('close', () => router());

// ============================================================
// Lightbox (with prev/next and keyboard nav)
// ============================================================
const dlgLightbox = $('#dlg-lightbox');
const lightboxState = { list: [], index: 0 };

function openLightbox(list, index) {
  lightboxState.list = list;
  lightboxState.index = index;
  renderLightbox();
  if (!dlgLightbox.open) dlgLightbox.showModal();
}

function renderLightbox() {
  const p = lightboxState.list[lightboxState.index];
  if (!p) return;
  $('#lightbox-img').src = publicImageUrl(p.storage_path);
  $('#lightbox-img').alt = p.caption || '';
  if (p.caption) { $('#lightbox-cap').textContent = p.caption; $('#lightbox-cap').hidden = false; }
  else $('#lightbox-cap').hidden = true;

  $('#lb-pin').classList.toggle('is-on', !!p.pinned);
  $('#lb-feature').classList.toggle('is-on', !!p.featured);

  if (isUnread(p)) markSeen('photos', p);
}

function lbNav(delta) {
  if (!lightboxState.list.length) return;
  lightboxState.index = (lightboxState.index + delta + lightboxState.list.length) % lightboxState.list.length;
  renderLightbox();
}

$('#lb-prev').addEventListener('click', (e) => { e.stopPropagation(); lbNav(-1); });
$('#lb-next').addEventListener('click', (e) => { e.stopPropagation(); lbNav(1); });
$('#lb-close').addEventListener('click', (e) => { e.stopPropagation(); dlgLightbox.close(); });

$('#lb-pin').addEventListener('click', async (e) => {
  e.stopPropagation();
  const p = lightboxState.list[lightboxState.index];
  if (!p) return;
  p.pinned = !p.pinned;
  await supabase.from('photos').update({ pinned: p.pinned }).eq('id', p.id);
  renderLightbox();
});
$('#lb-feature').addEventListener('click', async (e) => {
  e.stopPropagation();
  const p = lightboxState.list[lightboxState.index];
  if (!p) return;
  p.featured = !p.featured;
  await supabase.from('photos').update({ featured: p.featured }).eq('id', p.id);
  renderLightbox();
});
$('#lb-delete').addEventListener('click', async (e) => {
  e.stopPropagation();
  const p = lightboxState.list[lightboxState.index];
  if (!p) return;
  if (!confirm('¿Eliminar esta foto? No se puede deshacer.')) return;
  try { await supabase.storage.from(BUCKET).remove([p.storage_path]); } catch {}
  await supabase.from('photos').delete().eq('id', p.id);
  lightboxState.list.splice(lightboxState.index, 1);
  if (!lightboxState.list.length) { dlgLightbox.close(); await router(); return; }
  lightboxState.index = Math.min(lightboxState.index, lightboxState.list.length - 1);
  renderLightbox();
});

window.addEventListener('keydown', (e) => {
  if (!dlgLightbox.open) return;
  if (e.key === 'ArrowLeft') { e.preventDefault(); lbNav(-1); }
  else if (e.key === 'ArrowRight') { e.preventDefault(); lbNav(1); }
});

dlgLightbox.addEventListener('close', () => router());

// ============================================================
// Place editor
// ============================================================
const dlgPlace = $('#dlg-place');
const placeDraft = { id: null, lat: 0, lng: 0, tags: [], pinned: false };

function setPlacePin(p) {
  placeDraft.pinned = p;
  const b = $('#place-pin-toggle');
  b.classList.toggle('is-pinned', p);
  b.textContent = p ? '📌 Anclado' : '📌 Anclar';
}

function renderPlaceTags() {
  const root = $('#place-tags');
  root.innerHTML = '';
  placeDraft.tags.forEach((t, i) => {
    const chip = document.createElement('span');
    chip.className = 'tag-chip-selected';
    chip.style.setProperty('--tag-color', tagColor(t));
    chip.innerHTML = `#${escapeHtml(t)} <button type="button" aria-label="Quitar">×</button>`;
    chip.querySelector('button').addEventListener('click', () => { placeDraft.tags.splice(i, 1); renderPlaceTags(); });
    root.appendChild(chip);
  });
}

function renderPlaceTagSuggestions(query) {
  const root = $('#place-tag-suggestions');
  root.innerHTML = '';
  const existingTags = new Set();
  state.places.forEach(p => (p.tags || []).forEach(t => existingTags.add(t)));
  TAG_SUGGESTIONS_PLACES.forEach(t => existingTags.add(t));
  let all = Array.from(existingTags).filter(t => !placeDraft.tags.includes(t));
  if (query) {
    const q = query.toLowerCase();
    all = all.filter(t => t.toLowerCase().includes(q));
  }
  all.slice(0, 10).forEach(t => {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'tag-sugg';
    el.textContent = '#' + t;
    el.addEventListener('click', () => addPlaceTag(t));
    root.appendChild(el);
  });
}

function addPlaceTag(raw) {
  const t = raw.replace(/^#/, '').trim();
  if (!t) return;
  if (placeDraft.tags.some(x => x.toLowerCase() === t.toLowerCase())) return;
  placeDraft.tags.push(t);
  renderPlaceTags();
  renderPlaceTagSuggestions($('#place-tag-input').value);
}

function openPlaceEditor(place, coords = null) {
  placeDraft.id = place?.id || null;
  placeDraft.lat = place?.lat ?? coords?.lat ?? 0;
  placeDraft.lng = place?.lng ?? coords?.lng ?? 0;
  placeDraft.tags = Array.isArray(place?.tags) ? [...place.tags] : [];
  placeDraft.pinned = !!place?.pinned;

  $('#place-name').value = place?.name || '';
  $('#place-description').value = place?.description || '';
  $('#place-coords').textContent = `${placeDraft.lat.toFixed(5)}, ${placeDraft.lng.toFixed(5)}`;
  setPlacePin(placeDraft.pinned);
  renderPlaceTags();
  renderPlaceTagSuggestions('');
  $('#place-tag-input').value = '';
  $('#place-status').textContent = '';
  $('#dlg-place-title').textContent = place ? 'Editar lugar' : 'Nuevo lugar';
  $('#place-save').textContent = place ? 'Actualizar' : 'Guardar lugar';
  $('#place-delete').hidden = !place;
  dlgPlace.showModal();
  setTimeout(() => $('#place-name').focus(), 0);

  if (place && isUnread(place)) markSeen('places', place);
}

$('#place-pin-toggle').addEventListener('click', () => setPlacePin(!placeDraft.pinned));
$('#place-tag-input').addEventListener('input', (e) => renderPlaceTagSuggestions(e.target.value));
$('#place-tag-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ',') {
    e.preventDefault();
    addPlaceTag(e.target.value);
    e.target.value = '';
    renderPlaceTagSuggestions('');
  }
});

$('#place-save').addEventListener('click', async () => {
  const name = $('#place-name').value.trim();
  if (!name) { setStatus($('#place-status'), 'El nombre es obligatorio', true); $('#place-name').focus(); return; }
  const payload = {
    name,
    description: $('#place-description').value,
    lat: placeDraft.lat,
    lng: placeDraft.lng,
    tags: placeDraft.tags,
    pinned: placeDraft.pinned,
  };
  setStatus($('#place-status'), 'Guardando…');
  try {
    if (placeDraft.id) {
      const { error } = await supabase.from('places').update(payload).eq('id', placeDraft.id);
      if (error) throw error;
    } else {
      payload.created_by = state.currentUser;
      payload.seen_by = [state.currentUser];
      const { error } = await supabase.from('places').insert(payload);
      if (error) throw error;
    }
    dlgPlace.close();
    await router();
  } catch (e) { setStatus($('#place-status'), `Error al guardar: ${e.message || e}`, true); }
});

$('#place-delete').addEventListener('click', async () => {
  if (!placeDraft.id) return;
  if (!confirm('¿Eliminar este lugar? No se puede deshacer.')) return;
  try {
    await supabase.from('places').delete().eq('id', placeDraft.id);
    dlgPlace.close();
    await router();
  } catch (e) { setStatus($('#place-status'), `Error al eliminar: ${e.message || e}`, true); }
});

// ============================================================
// Generic dialog backdrop/close behavior
// ============================================================
$$('dialog.modal').forEach(dlg => {
  dlg.addEventListener('click', (e) => {
    if (e.target === dlg) dlg.close();
    if (e.target.matches('[data-close]')) dlg.close();
  });
});

// ============================================================
// Boot
// ============================================================
async function boot() {
  await initAuthUI();
  const saved = localStorage.getItem(AUTH_KEY);
  if (saved) {
    state.currentUser = saved;
    hideLogin();
    await loadSettings();
    if (!location.hash) location.hash = '#/inicio';
    await router();
  } else {
    showLogin();
  }
}
boot();
