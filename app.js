import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

// ============================================================
// Constants & Supabase client
// ============================================================
const SUPABASE_URL = 'https://vmdsibzivcugjidtkhzt.supabase.co';
const SUPABASE_KEY = 'sb_publishable_ndJSJcAcexIbz9yn1zRoLw_iyeerQXy';
const BUCKET = 'notes-images';
const APP_ASSETS_BUCKET = 'app-assets';
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const publicAssetUrl = (path) => supabase.storage.from(APP_ASSETS_BUCKET).getPublicUrl(path).data.publicUrl;

const TAG_SUGGESTIONS_NOTES = ['Citas', 'Recordar', 'Pensamientos', 'Cuentas', 'Viajes', 'Familia', 'Lugares'];
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

// Curated palette of visually-distinct tag colors
const TAG_PALETTE = [
  '#e74c3c', // red
  '#e67e22', // orange
  '#f39c12', // amber
  '#27ae60', // green
  '#16a085', // teal
  '#2980b9', // blue
  '#8e44ad', // purple
  '#d35400', // burnt orange
  '#c0392b', // dark red
  '#1abc9c', // mint
  '#0984e3', // bright blue
  '#e84393', // pink
  '#9b59b6', // violet
  '#6d4c41', // brown
  '#546e7a', // slate
  '#fdcb6e', // mustard
];

function tagColor(tag) {
  if (!tag) return 'var(--text-dim)';
  // User-defined override wins
  const overrides = state.settings.tag_colors || {};
  if (overrides[tag]) return overrides[tag];
  let h = 0;
  for (let i = 0; i < tag.length; i++) h = (h * 31 + tag.charCodeAt(i)) >>> 0;
  return TAG_PALETTE[h % TAG_PALETTE.length];
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
  movies: [],
  chats: [],
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
    return data || [];
  } catch (e) {
    console.error(e);
    return [{ name: 'Jaime', avatar_path: null, background_path: null },
            { name: 'Mayck', avatar_path: null, background_path: null }];
  }
}

async function loadDefaultLoginBg() {
  try {
    const { data } = await supabase.from('app_settings').select('value').eq('key', 'default_background_path').maybeSingle();
    if (!data) return '';
    const v = data.value;
    return typeof v === 'string' ? v : (v?.path || '');
  } catch { return ''; }
}

async function tryLogin(name, password) {
  console.log('[auth] tryLogin', { name, passwordLength: password?.length });
  const { data, error } = await supabase.rpc('verify_password', { p_name: name, p_password: password });
  console.log('[auth] tryLogin result', { data, error });
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
}

async function initAuthUI() {
  const picker = $('#user-picker');
  const heroImg = $('#auth-hero-img');
  const heroFb = $('#auth-hero-fallback');
  const pincode = $('#auth-pincode');
  const pinInputs = $$('input', pincode);
  const statusEl = $('#auth-status');
  const users = await loadUsersForLogin();
  const defaultBg = await loadDefaultLoginBg();

  // Stash for the config page that lets users upload their own assets
  state._userAssets = Object.fromEntries(users.map(u => [u.name, { avatar: u.avatar_path, bg: u.background_path }]));
  state._defaultBg = defaultBg;

  picker.innerHTML = '';
  let selected = null;
  let verifying = false;

  function setHero(bgPath) {
    if (bgPath) {
      heroImg.src = publicAssetUrl(bgPath);
      heroImg.classList.add('visible');
      heroFb.classList.add('hidden');
    } else {
      heroImg.classList.remove('visible');
      heroImg.removeAttribute('src');
      heroFb.classList.remove('hidden');
    }
  }
  setHero(defaultBg);

  function clearPin(focusFirst = false) {
    pinInputs.forEach(x => { x.value = ''; x.classList.remove('filled'); });
    pincode.classList.remove('is-error', 'is-verifying');
    if (focusFirst) pinInputs[0].focus();
  }

  async function attemptLogin(pwd) {
    if (!selected) {
      setStatus(statusEl, 'Selecciona quién eres', true);
      pincode.classList.add('is-error');
      setTimeout(() => clearPin(false), 600);
      return;
    }
    if (verifying) return;
    verifying = true;
    pincode.classList.add('is-verifying');
    setStatus(statusEl, 'Verificando…');
    try {
      const ok = await tryLogin(selected, pwd);
      if (!ok) {
        pincode.classList.remove('is-verifying');
        pincode.classList.add('is-error');
        setStatus(statusEl, `Clave incorrecta`, true);
        setTimeout(() => clearPin(true), 500);
        verifying = false;
        return;
      }
      loginAs(selected);
      statusEl.textContent = '';
      clearPin();
      hideLogin();
      await loadSettings();
      await router();
    } catch (e) {
      console.error('[auth] error', e);
      pincode.classList.remove('is-verifying');
      pincode.classList.add('is-error');
      setStatus(statusEl, `Error: ${e.message || e}`, true);
      setTimeout(() => clearPin(true), 600);
    } finally {
      verifying = false;
    }
  }

  // ===== Pincode behaviour =====
  pinInputs.forEach((input, i) => {
    input.addEventListener('input', (e) => {
      // Strip everything but digits, cap at 1 char
      const raw = (e.target.value || '').replace(/\D/g, '');
      e.target.value = raw.slice(0, 1);
      e.target.classList.toggle('filled', !!e.target.value);
      if (e.target.value && i < pinInputs.length - 1) pinInputs[i + 1].focus();

      // Check if all are filled → auto-submit
      const all = pinInputs.map(x => x.value).join('');
      if (all.length === pinInputs.length && /^\d{4}$/.test(all)) attemptLogin(all);
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Backspace') {
        if (!e.target.value && i > 0) {
          pinInputs[i - 1].focus();
          pinInputs[i - 1].value = '';
          pinInputs[i - 1].classList.remove('filled');
          e.preventDefault();
        }
      } else if (e.key === 'ArrowLeft' && i > 0) {
        pinInputs[i - 1].focus();
      } else if (e.key === 'ArrowRight' && i < pinInputs.length - 1) {
        pinInputs[i + 1].focus();
      }
    });
    input.addEventListener('paste', (e) => {
      e.preventDefault();
      const text = ((e.clipboardData || window.clipboardData)?.getData('text') || '').replace(/\D/g, '').slice(0, pinInputs.length - i);
      [...text].forEach((d, idx) => {
        if (i + idx < pinInputs.length) {
          pinInputs[i + idx].value = d;
          pinInputs[i + idx].classList.add('filled');
        }
      });
      const lastIdx = Math.min(i + text.length, pinInputs.length - 1);
      pinInputs[lastIdx].focus();
      const all = pinInputs.map(x => x.value).join('');
      if (all.length === pinInputs.length && /^\d{4}$/.test(all)) attemptLogin(all);
    });
    input.addEventListener('focus', () => input.select());
  });

  // ===== User pickers =====
  for (const u of users) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'user-btn';

    const avatar = document.createElement('div');
    avatar.className = 'avatar';
    if (u.avatar_path) {
      const img = document.createElement('img');
      img.src = publicAssetUrl(u.avatar_path);
      img.alt = u.name;
      avatar.appendChild(img);
    } else {
      const fb = document.createElement('span');
      fb.className = 'avatar-fallback';
      fb.textContent = '🪼';
      avatar.appendChild(fb);
    }

    const name = document.createElement('div');
    name.className = 'name';
    name.textContent = u.name;

    btn.appendChild(avatar);
    btn.appendChild(name);
    btn.addEventListener('click', () => {
      selected = u.name;
      $$('.user-btn', picker).forEach(x => x.classList.remove('is-active'));
      btn.classList.add('is-active');
      setHero(u.background_path || defaultBg);
      // Focus the pincode first box
      clearPin(true);
      statusEl.textContent = '';
    });
    picker.appendChild(btn);
  }
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
    { data: movies },
    { data: chats },
  ] = await Promise.all([
    supabase.from('notes').select('*').order('pinned', { ascending: false }).order('created_at', { ascending: false }),
    supabase.from('media').select('*').order('pinned', { ascending: false }).order('created_at', { ascending: false }),
    supabase.from('photos').select('*').order('pinned', { ascending: false }).order('created_at', { ascending: false }),
    supabase.from('places').select('*').order('pinned', { ascending: false }).order('created_at', { ascending: false }),
    supabase.from('movies').select('*').order('pinned', { ascending: false }).order('created_at', { ascending: false }),
    supabase.from('chats').select('*').order('created_at', { ascending: true }).limit(200),
  ]);
  state.notes = notes || [];
  state.media = media || [];
  state.photos = photos || [];
  state.places = places || [];
  state.movies = movies || [];
  state.chats = chats || [];
  updateSidebarBadges();
  // Background: backfill missing Spotify/YouTube thumbnails
  backfillMediaThumbnails();
}

let backfillRan = false;
async function backfillMediaThumbnails() {
  if (backfillRan) return;
  backfillRan = true;
  const missing = state.media.filter(m => !m.thumbnail_url);
  if (!missing.length) return;
  for (const m of missing) {
    const parsed = parseMediaUrl(m.url);
    if (!parsed) continue;
    let thumb = parsed.thumbnailUrl;
    if (!thumb) {
      try {
        const oe = await fetchOembedTitle(parsed);
        if (oe?.thumbnail) thumb = oe.thumbnail;
      } catch {}
    }
    if (thumb) {
      m.thumbnail_url = thumb;
      try { await supabase.from('media').update({ thumbnail_url: thumb }).eq('id', m.id); } catch {}
    }
  }
  // Re-render current view to show the new thumbnails
  if (state.route === '#/musica' || state.route === '#/inicio') {
    router();
  }
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
  // Private notes never generate notifications (intentional — they're personal)
  const notifNotes = state.notes.filter(n => n.visibility !== 'private' && isUnread(n)).length;
  const counts = {
    'home': 0,
    'notas': notifNotes,
    'musica': state.media.filter(isUnread).length,
    'fotos': state.photos.filter(isUnread).length,
    'pelis': state.movies.filter(isUnread).length,
  };
  counts.home = counts.notas + counts.musica + counts.fotos + counts.pelis;
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
  $$('#mobile-nav a').forEach(a => a.classList.toggle('active', a.dataset.route === state.route));
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
    case hash === '#/notas':
    case hash === '#/notas/publicas':
    case hash === '#/notas/privadas':
      // Legacy public/private URLs collapse into a single notes view
      renderNotas(content);
      break;
    case hash === '#/musica': renderMusica(content); break;
    case hash === '#/fotos': renderFotos(content); break;
    case hash === '#/pelis': renderPelis(content); break;
    case hash === '#/configuracion': renderConfig(content); break;
    default: location.hash = '#/inicio';
  }
}
window.addEventListener('hashchange', router);

// ============================================================
// Page: Inicio (dashboard)
// ============================================================
const DEFAULT_DASHBOARD_ORDER = ['notes', 'media', 'photos', 'movies'];

function getDashboardOrder() {
  const raw = state.settings.dashboard_order;
  const sections = Array.isArray(raw?.order) ? raw.order : DEFAULT_DASHBOARD_ORDER;
  // Ensure all sections present and no extras
  const known = new Set(DEFAULT_DASHBOARD_ORDER);
  const filtered = sections.filter(s => known.has(s));
  DEFAULT_DASHBOARD_ORDER.forEach(s => { if (!filtered.includes(s)) filtered.push(s); });
  return filtered;
}

function renderInicio(root) {
  const order = getDashboardOrder();
  const sectionTemplates = {
    notes: `
      <section class="section-block" data-sec="notes">
        <div class="section-head">
          <h2>Notas recientes</h2>
          <a href="#/notas/publicas">Ver todas →</a>
        </div>
        <div class="grid-cards" id="dash-notes-grid"></div>
      </section>`,
    media: `
      <section class="section-block" data-sec="media">
        <div class="section-head">
          <h2>Música reciente</h2>
          <a href="#/musica">Ver toda →</a>
        </div>
        <div class="grid-cards" id="dash-media-grid"></div>
      </section>`,
    photos: `
      <section class="section-block" data-sec="photos">
        <div class="section-head">
          <h2>Fotos recientes</h2>
          <a href="#/fotos">Ver todas →</a>
        </div>
        <div class="photo-grid" id="dash-photos-grid"></div>
      </section>`,
    movies: `
      <section class="section-block" data-sec="movies">
        <div class="section-head">
          <h2>Pelis recientes</h2>
          <a href="#/pelis">Ver todas →</a>
        </div>
        <div class="grid-cards" id="dash-movies-grid"></div>
      </section>`,
    places: `
      <section class="section-block" data-sec="places">
        <div class="section-head">
          <h2>Lugares recientes</h2>
          <a href="#/lugares">Ver todos →</a>
        </div>
        <div class="grid-cards" id="dash-places-grid"></div>
      </section>`,
  };

  const totalUnread = totalUnreadCount();

  root.innerHTML = `
    <div class="page-head">
      <div>
        <h1>Hola, ${escapeHtml(state.currentUser)}</h1>
        <div class="sub">Un vistazo a todo lo nuestro</div>
      </div>
      <div class="actions">
        <div class="notif-bell-wrap">
          <button class="notif-bell" id="notif-bell" title="Notificaciones" aria-label="Notificaciones">
            <span class="material-symbols-outlined">notifications</span>${totalUnread ? `<span class="notif-count">${totalUnread}</span>` : ''}
          </button>
        </div>
        <a class="notif-bell settings-shortcut" href="#/configuracion" title="Configuración" aria-label="Configuración">
          <span class="material-symbols-outlined">settings</span>
        </a>
      </div>
    </div>

    <div class="dashboard-grid">
      <div class="photo-widget" id="photo-widget">
        <div class="pw-empty">Aún no hay fotos para mostrar aquí.</div>
      </div>

      <div class="chat-widget" id="chat-widget">
        <div class="chat-head">
          <span class="dot"></span>
          Instantáneos
        </div>
        <div class="chat-body" id="chat-body">
          <div class="chat-empty">Cargando…</div>
        </div>
        <div class="chat-input">
          <input type="text" id="chat-input-field" placeholder="Un mensajito…" maxlength="500" />
          <button id="chat-send" type="button">Enviar</button>
        </div>
      </div>
    </div>

    ${order.map(s => sectionTemplates[s] || '').join('')}
  `;

  // Recent notes (max 4)
  const notesGrid = $('#dash-notes-grid');
  if (notesGrid) {
    const recentNotes = state.notes.slice(0, 4);
    if (recentNotes.length) recentNotes.forEach(n => notesGrid.appendChild(renderNoteCard(n)));
    else notesGrid.innerHTML = '<div class="empty">Aún no hay notas.</div>';
  }

  // Recent media (max 4)
  const mediaGrid = $('#dash-media-grid');
  if (mediaGrid) {
    const recentMedia = state.media.slice(0, 4);
    if (recentMedia.length) recentMedia.forEach(m => mediaGrid.appendChild(renderMediaCard(m)));
    else mediaGrid.innerHTML = '<div class="empty">Aún no hay música.</div>';
  }

  // Recent photos
  const photosGrid = $('#dash-photos-grid');
  if (photosGrid) {
    const recentPhotos = state.photos.slice(0, 8);
    if (recentPhotos.length) recentPhotos.forEach((p, i) => photosGrid.appendChild(renderPhoto(p, recentPhotos, i)));
    else photosGrid.innerHTML = '<div class="empty">Aún no hay fotos.</div>';
  }

  // Recent movies
  const moviesGrid = $('#dash-movies-grid');
  if (moviesGrid) {
    const recentMovies = state.movies.slice(0, 4);
    if (recentMovies.length) recentMovies.forEach(m => moviesGrid.appendChild(renderMovieCard(m)));
    else moviesGrid.innerHTML = '<div class="empty">Aún no hay pelis.</div>';
  }

  // Recent places (max 3)
  const placesGrid = $('#dash-places-grid');
  if (placesGrid) {
    const recentPlaces = state.places.slice(0, 3);
    if (recentPlaces.length) recentPlaces.forEach(p => placesGrid.appendChild(renderPlaceCard(p)));
    else placesGrid.innerHTML = '<div class="empty">Aún no hay lugares.</div>';
  }

  setupPhotoWidget();
  setupChatWidget();
  setupNotifBell();
}

function totalUnreadCount() {
  // Private notes never count as notifications
  return state.notes.filter(n => n.visibility !== 'private' && isUnread(n)).length
    + state.media.filter(isUnread).length
    + state.photos.filter(isUnread).length
    + state.movies.filter(isUnread).length;
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
    if (!pool.length) pool = state.photos;
  } else if (cfg.mode && cfg.mode.startsWith('album:')) {
    const album = cfg.mode.slice('album:'.length);
    pool = state.photos.filter(p => (p.album || '') === album);
    if (!pool.length) pool = state.photos;
  } else {
    pool = state.photos;
  }

  const albums = Array.from(new Set(state.photos.map(p => p.album || '').filter(Boolean))).sort();

  const menuHtml = `
    <button class="pw-menu-btn" id="pw-menu-btn" title="Opciones" aria-label="Opciones"><span class="material-symbols-outlined">more_horiz</span></button>
    <div class="pw-menu" id="pw-menu">
      <div class="pw-section">Qué mostrar</div>
      <button class="pw-opt ${cfg.mode === 'featured' ? 'active' : ''}" data-mode="featured"><span class="material-symbols-outlined">star</span> Solo destacadas</button>
      <button class="pw-opt ${cfg.mode === 'all' ? 'active' : ''}" data-mode="all"><span class="material-symbols-outlined">photo_library</span> Todas las fotos</button>
      <div class="pw-section">Álbumes</div>
      ${albums.length
        ? albums.map(a => `<button class="pw-opt ${cfg.mode === 'album:'+a ? 'active' : ''}" data-mode="album:${escapeHtml(a)}"><span class="material-symbols-outlined">folder</span> ${escapeHtml(a)}</button>`).join('')
        : `<div style="padding:.4rem .65rem;font-size:.78rem;color:var(--text-dim);">Aún no tienes álbumes.<br/>Crea uno desde 📸 Fotos.</div>`}
      <div class="pw-section">Intervalo</div>
      <div class="pw-row">
        <input type="number" min="2" max="60" step="1" id="pw-interval" value="${(cfg.interval_ms || 6000)/1000}" />
        <span style="color:var(--text-dim);font-size:.78rem;">segundos</span>
        <button class="btn" id="pw-interval-save" style="margin-left:auto;padding:.3rem .55rem;">OK</button>
      </div>
    </div>`;

  if (!pool.length) {
    root.innerHTML = `<div class="pw-empty">Aún no hay fotos para mostrar. Agrégalas en la sección de fotos.</div>${menuHtml}`;
    wirePwMenu(root, cfg);
    return;
  }

  const modeLabel = cfg.mode === 'featured'
    ? '<span class="material-symbols-outlined" style="font-size:13px;vertical-align:-2px;">star</span> destacadas'
    : (cfg.mode && cfg.mode.startsWith('album:')
        ? `<span class="material-symbols-outlined" style="font-size:13px;vertical-align:-2px;">folder</span> ${escapeHtml(cfg.mode.slice(6))}`
        : 'todas');

  root.innerHTML = `
    <div class="pw-stage" id="pw-stage">
      ${pool.map((p, i) =>
        `<img src="${escapeHtml(publicImageUrl(p.storage_path))}" alt="${escapeHtml(p.caption || '')}" class="${i === 0 ? 'active' : ''}" loading="lazy" />`
      ).join('')}
      <div class="pw-dots">${modeLabel} · ${pool.length}</div>
      ${pool[0].caption ? `<div class="pw-cap" id="pw-cap">${escapeHtml(pool[0].caption)}</div>` : '<div class="pw-cap" id="pw-cap" hidden></div>'}
    </div>
    ${menuHtml}
  `;

  const stage = $('#pw-stage', root);
  stage.dataset.idx = '0';
  stage.addEventListener('click', () => {
    const i = Number(stage.dataset.idx || 0);
    openLightbox(pool, i);
  });

  wirePwMenu(root, cfg);

  if (pool.length > 1) {
    let i = 0;
    const cap = $('.pw-cap', root);
    photoWidgetTimer = setInterval(() => {
      const imgs = $$('img', stage);
      imgs[i].classList.remove('active');
      i = (i + 1) % pool.length;
      imgs[i].classList.add('active');
      stage.dataset.idx = i;
      if (cap) {
        if (pool[i].caption) { cap.textContent = pool[i].caption; cap.hidden = false; }
        else { cap.hidden = true; }
      }
    }, cfg.interval_ms || 6000);
  }
}

function wirePwMenu(root, cfg) {
  const btn = $('#pw-menu-btn', root);
  const menu = $('#pw-menu', root);
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    menu.classList.toggle('open');
  });
  document.addEventListener('click', (e) => {
    if (!menu.contains(e.target) && e.target !== btn) menu.classList.remove('open');
  });
  $$('.pw-opt', menu).forEach(opt => {
    opt.addEventListener('click', async () => {
      const mode = opt.dataset.mode;
      const interval_ms = cfg.interval_ms || 6000;
      await saveSetting('photo_widget', { mode, interval_ms });
      setupPhotoWidget();
    });
  });
  $('#pw-interval-save', menu).addEventListener('click', async () => {
    const sec = Math.max(2, Math.min(60, Number($('#pw-interval', menu).value) || 6));
    const mode = cfg.mode || 'featured';
    await saveSetting('photo_widget', { mode, interval_ms: sec * 1000 });
    setupPhotoWidget();
  });
}

// ============================================================
// Page: Notas (single unified list)
// ============================================================
function renderNotas(root) {
  const filterTag = state.filterTag.notas;
  let filtered = state.notes.slice();
  if (filterTag) filtered = filtered.filter(n => Array.isArray(n.tags) && n.tags.includes(filterTag));

  const tagCounts = new Map();
  state.notes.forEach(n => (n.tags || []).forEach(t => tagCounts.set(t, (tagCounts.get(t) || 0) + 1)));
  const sortedTags = Array.from(tagCounts.entries()).sort((a, b) => b[1] - a[1]);

  root.innerHTML = `
    <div class="page-head">
      <div>
        <h1>Notas</h1>
        <div class="sub">Lo que recordamos</div>
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
    renderNotas(root);
  });
  const filterRow = $('#tag-filter-row');
  if (filterRow) {
    filterRow.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-tag]');
      if (!b) return;
      state.filterTag.notas = b.dataset.tag || null;
      renderNotas(root);
    });
  }

  const grid = $('#notes-grid');
  grid.appendChild(renderNewCtaTile('Nueva nota', () => openNoteEditor(null)));
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
  tile.innerHTML = `<div class="plus" aria-hidden="true"><span class="material-symbols-outlined">add</span></div><div class="label">${escapeHtml(label)}</div>`;
  tile.addEventListener('click', onOpen);
  tile.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(); } });
  return tile;
}

function renderNoteCard(note) {
  const card = document.createElement('article');
  card.className = 'card clickable with-stripe note-card';
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

  // Pin icon on the card (Material icon)
  const pinBtn = document.createElement('button');
  pinBtn.className = 'pin-card-btn';
  pinBtn.type = 'button';
  pinBtn.title = note.pinned ? 'Desanclar' : 'Anclar';
  pinBtn.innerHTML = `<span class="material-symbols-outlined">${note.pinned ? 'keep' : 'keep_off'}</span>`;
  pinBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    const next = !note.pinned;
    note.pinned = next;
    await supabase.from('notes').update({ pinned: next }).eq('id', note.id);
    await router();
  });
  card.appendChild(pinBtn);

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
  meta.innerHTML = `<span>${fmtDateWithDay(note.updated_at || note.created_at)} · ${escapeHtml(note.created_by || '?')}</span>`;
  body.appendChild(meta);

  card.appendChild(body);
  card.addEventListener('click', () => openNoteEditor(note));
  card.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openNoteEditor(note); } });
  return card;
}

// Date+time helper for note cards (always show day, plus time if today)
function fmtDateWithDay(iso) {
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) {
    return d.toLocaleTimeString('es', { hour: 'numeric', minute: '2-digit' });
  }
  const sameYear = d.getFullYear() === now.getFullYear();
  const datePart = d.toLocaleDateString('es', { day: 'numeric', month: 'short', year: sameYear ? undefined : 'numeric' });
  const timePart = d.toLocaleTimeString('es', { hour: 'numeric', minute: '2-digit' });
  return `${datePart} · ${timePart}`;
}

// ============================================================
// Page: Música
// ============================================================
function getMediaCategory(m) {
  if (m.kind === 'spotify') {
    if (m.url && m.url.includes('/playlist/')) return 'playlists';
    return 'musica';
  }
  if (m.kind === 'youtube') {
    // a playlist URL on YouTube is /playlist?list=... (no v=)
    if (m.url && /playlist\?/i.test(m.url) && !/[?&]v=/.test(m.url)) return 'playlists';
    return 'videos';
  }
  return 'musica';
}

function renderMusica(root) {
  const featured = state.media.filter(m => m.featured);
  const filter = state.filterMedia || 'all';
  const filterCounts = { all: state.media.length, musica: 0, playlists: 0, videos: 0 };
  for (const m of state.media) filterCounts[getMediaCategory(m)]++;
  const items = filter === 'all' ? state.media : state.media.filter(m => getMediaCategory(m) === filter);

  root.innerHTML = `
    <div class="page-head">
      <div>
        <h1>Música</h1>
        <div class="sub">Canciones, playlists y videos</div>
      </div>
      <div class="actions">
        <button class="btn primary" id="new-media-btn">+ Nuevo</button>
      </div>
    </div>
    ${featured.length ? `
      <div class="featured-label"><span class="material-symbols-outlined">star</span> Destacadas</div>
      <div class="featured-strip" id="featured-media-strip"></div>
    ` : ''}
    <div class="tag-filter-row" id="media-filter">
      <button class="tag-chip ${filter === 'all' ? 'active' : ''}" data-f="all" style="--tag-color: var(--text-dim);">Todo <span class="count">${filterCounts.all}</span></button>
      <button class="tag-chip ${filter === 'musica' ? 'active' : ''}" data-f="musica" style="--tag-color: #1db954;"><span class="material-symbols-outlined" style="font-size:14px;vertical-align:-3px;">music_note</span> Canciones <span class="count">${filterCounts.musica}</span></button>
      <button class="tag-chip ${filter === 'playlists' ? 'active' : ''}" data-f="playlists" style="--tag-color: #6d5be6;"><span class="material-symbols-outlined" style="font-size:14px;vertical-align:-3px;">queue_music</span> Playlists <span class="count">${filterCounts.playlists}</span></button>
      <button class="tag-chip ${filter === 'videos' ? 'active' : ''}" data-f="videos" style="--tag-color: #ff4040;"><span class="material-symbols-outlined" style="font-size:14px;vertical-align:-3px;">play_circle</span> Videos <span class="count">${filterCounts.videos}</span></button>
    </div>
    <div class="grid-cards" id="media-grid"></div>
  `;

  $('#new-media-btn').addEventListener('click', () => openMediaEditor(null));
  $('#media-filter').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-f]');
    if (!b) return;
    state.filterMedia = b.dataset.f;
    renderMusica(root);
  });

  if (featured.length) {
    const strip = $('#featured-media-strip');
    featured.forEach(m => strip.appendChild(renderMediaCard(m)));
  }

  const grid = $('#media-grid');
  grid.appendChild(renderNewCtaTile('Nuevo', () => openMediaEditor(null)));
  items.forEach(m => grid.appendChild(renderMediaCard(m)));
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
    <button title="Editar" data-action="edit"><span class="material-symbols-outlined">edit</span></button>
    <button title="${m.pinned ? 'Desanclar' : 'Anclar'}" class="${m.pinned ? 'is-on' : ''}" data-action="pin"><span class="material-symbols-outlined">keep</span></button>
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
    ph.innerHTML = `<span class="material-symbols-outlined" style="font-size:3rem;">${m.kind === 'spotify' ? 'music_note' : 'play_circle'}</span>`;
    thumbWrap.appendChild(ph);
  }
  const overlay = document.createElement('div');
  overlay.className = 'play-overlay';
  overlay.innerHTML = '<div class="play"><span class="material-symbols-outlined">play_arrow</span></div>';
  thumbWrap.appendChild(overlay);

  // Kind chip pinned to bottom-right of thumbnail
  const kindChip = document.createElement('div');
  kindChip.className = 'kind-chip';
  kindChip.textContent = m.kind === 'spotify' ? 'Spotify' : 'YouTube';
  thumbWrap.appendChild(kindChip);

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
  const featuredMark = m.featured ? '<span class="material-symbols-outlined filled" style="font-size:14px;vertical-align:-2px;color:#f9b233;">star</span>' : '';
  meta.innerHTML = `<span>${fmtDate(m.created_at)} · ${escapeHtml(m.created_by || '?')} ${featuredMark}</span>`;
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
  const featured = state.photos.filter(p => p.featured);

  // Group photos by album: '' (no album) = individual; named = grouped tile
  const byAlbum = new Map();
  for (const p of state.photos) {
    const key = p.album || '';
    if (!byAlbum.has(key)) byAlbum.set(key, []);
    byAlbum.get(key).push(p);
  }

  root.innerHTML = `
    <div class="page-head">
      <div>
        <h1>📸 Fotos</h1>
        <div class="sub">Nuestro álbum · ${state.photos.length} fotos${byAlbum.size > 1 ? ` · ${Array.from(byAlbum.keys()).filter(k => k).length} álbumes` : ''}</div>
      </div>
      <div class="actions">
        ${state.photos.length ? `<button class="btn" id="view-all-btn">Ver todas en presentación</button>` : ''}
        <button class="btn primary" id="upload-btn">+ Subir fotos</button>
      </div>
    </div>
    ${featured.length ? `
      <div class="featured-label"><span class="material-symbols-outlined">star</span> Destacadas</div>
      <div class="featured-strip" id="featured-strip"></div>
    ` : ''}
    <div class="photo-grid" id="photo-grid"></div>
  `;

  $('#upload-btn').addEventListener('click', openPhotoUpload);
  if (state.photos.length) {
    $('#view-all-btn').addEventListener('click', () => openLightbox(state.photos, 0));
  }

  if (featured.length) {
    const strip = $('#featured-strip');
    featured.forEach((p, i) => strip.appendChild(renderPhoto(p, featured, i)));
  }

  const container = $('#photo-grid');
  // Repurpose the #photo-grid container: convert it into a section host (we'll
  // append section blocks, each containing its own grid).
  container.classList.remove('photo-grid');
  container.classList.add('photo-sections');
  container.innerHTML = '';

  if (!state.photos.length) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = 'Aún no hay fotos. Sube las primeras con el botón "Subir fotos".';
    container.appendChild(empty);
    return;
  }

  // Render each named album as its own titled section, then loose photos.
  const albumKeys = Array.from(byAlbum.keys()).filter(k => k).sort();
  for (const key of albumKeys) {
    container.appendChild(renderAlbumSection(key, byAlbum.get(key)));
  }
  const loose = byAlbum.get('') || [];
  if (loose.length) {
    container.appendChild(renderAlbumSection('', loose));
  }
}

function renderAlbumSection(name, photos) {
  const section = document.createElement('div');
  section.className = 'album-section';
  const titleText = name
    ? `<span class="material-symbols-outlined" style="font-size:1.15em;vertical-align:-3px;">folder</span> ${escapeHtml(name)}`
    : 'Sin álbum';
  section.innerHTML = `
    <div class="album-title-row">
      <h2>${titleText}</h2>
      <span class="count">${photos.length} foto${photos.length === 1 ? '' : 's'}</span>
      <button class="album-menu-btn" type="button" title="Opciones del álbum">
        <span class="material-symbols-outlined">more_horiz</span>
      </button>
      <div class="album-menu-popover">
        ${name
          ? `<button data-action="rename"><span class="material-symbols-outlined">edit</span>Renombrar álbum</button>`
          : `<button data-action="assign"><span class="material-symbols-outlined">drive_file_move</span>Mover todas a un álbum…</button>`}
      </div>
    </div>
    <div class="photo-grid"></div>
  `;
  const sg = section.querySelector('.photo-grid');
  photos.forEach((p, i) => sg.appendChild(renderPhoto(p, photos, i)));

  // Ellipsis menu interactions
  const menuBtn = section.querySelector('.album-menu-btn');
  const menu = section.querySelector('.album-menu-popover');
  menuBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    document.querySelectorAll('.album-menu-popover.open').forEach(el => el !== menu && el.classList.remove('open'));
    menu.classList.toggle('open');
  });
  document.addEventListener('click', () => menu.classList.remove('open'));

  menu.addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    e.stopPropagation();
    menu.classList.remove('open');
    if (btn.dataset.action === 'rename') {
      const next = prompt(`Nuevo nombre para el álbum "${name}":`, name);
      if (!next || next === name) return;
      const ids = photos.map(p => p.id);
      const { error } = await supabase.from('photos').update({ album: next.trim() }).in('id', ids);
      if (error) { alert('Error: ' + error.message); return; }
      await router();
    }
    if (btn.dataset.action === 'assign') {
      const existing = Array.from(new Set(state.photos.map(p => p.album || '').filter(Boolean))).sort();
      const hint = existing.length ? `\n\nÁlbumes existentes: ${existing.join(', ')}` : '';
      const albumName = prompt(`Mover las ${photos.length} fotos sin álbum a un álbum:${hint}`, '');
      if (!albumName || !albumName.trim()) return;
      const ids = photos.map(p => p.id);
      const { error } = await supabase.from('photos').update({ album: albumName.trim() }).in('id', ids);
      if (error) { alert('Error: ' + error.message); return; }
      await router();
    }
  });

  return section;
}

function renderAlbumTile(name, photos) {
  const tile = document.createElement('div');
  tile.className = 'album-tile';
  tile.setAttribute('role', 'button');
  tile.setAttribute('tabindex', '0');
  tile.setAttribute('aria-label', `Abrir álbum ${name}`);

  const cover = photos[0];
  tile.innerHTML = `
    <div class="album-stack"></div>
    <img src="${escapeHtml(publicImageUrl(cover.storage_path))}" alt="${escapeHtml(name)}" loading="lazy" />
    <div class="album-info">
      <div class="album-name">📁 ${escapeHtml(name)}</div>
      <div class="album-count">${photos.length} foto${photos.length === 1 ? '' : 's'}</div>
    </div>
  `;
  tile.addEventListener('click', () => openLightbox(photos, 0));
  tile.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openLightbox(photos, 0); }
  });
  return tile;
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
  if (p.pinned) indicator.innerHTML += `<span title="Anclada"><span class="material-symbols-outlined" style="font-size:14px;">keep</span></span>`;
  if (p.featured) indicator.innerHTML += `<span title="Destacada"><span class="material-symbols-outlined" style="font-size:14px;">star</span></span>`;
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
    <div class="places-search-row">
      <input type="text" id="page-place-search" placeholder="Buscar por dirección… (ej: Plaza Mayor, Madrid)" autocomplete="off" />
      <div class="search-results" id="page-place-search-results"></div>
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

  // Wire up the in-page address search
  const searchInput = $('#page-place-search');
  const searchResults = $('#page-place-search-results');
  let pageSearchTimer = null;
  searchInput.addEventListener('input', (e) => {
    const q = e.target.value.trim();
    clearTimeout(pageSearchTimer);
    if (!q) { searchResults.classList.remove('open'); return; }
    pageSearchTimer = setTimeout(async () => {
      const results = await nominatimSearch(q);
      searchResults.innerHTML = '';
      if (!results.length) {
        searchResults.innerHTML = '<div class="res"><em style="color:var(--text-dim);">Sin resultados</em></div>';
        searchResults.classList.add('open');
        return;
      }
      for (const r of results) {
        const row = document.createElement('div');
        row.className = 'res';
        const title = r.name || r.display_name.split(',')[0];
        const sub = r.display_name;
        row.innerHTML = `<div>${escapeHtml(title)}</div><div class="res-sub">${escapeHtml(sub)}</div>`;
        row.addEventListener('click', () => {
          searchResults.classList.remove('open');
          searchInput.value = '';
          openPlaceEditor(null, { lat: parseFloat(r.lat), lng: parseFloat(r.lon) });
          // Pre-fill the name in the modal
          setTimeout(() => {
            if (!$('#place-name').value) $('#place-name').value = title;
          }, 50);
        });
        searchResults.appendChild(row);
      }
      searchResults.classList.add('open');
    }, 500);
  });
  searchInput.addEventListener('blur', () => {
    setTimeout(() => searchResults.classList.remove('open'), 200);
  });

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
const SECTION_LABELS = {
  notes: 'Notas recientes',
  media: 'Música reciente',
  photos: 'Fotos recientes',
  movies: 'Pelis recientes',
  places: 'Lugares recientes',
};

let configActiveTab = 'dashboard';

function renderConfig(root) {
  const tabs = [
    { id: 'dashboard', icon: 'home', label: 'Inicio' },
    { id: 'login', icon: 'lock_open', label: 'Login' },
    { id: 'tags', icon: 'sell', label: 'Etiquetas' },
    { id: 'cuenta', icon: 'account_circle', label: 'Cuenta' },
  ];

  root.innerHTML = `
    <div class="page-head">
      <div>
        <h1>⚙️ Configuración</h1>
        <div class="sub">Solo para ti — los cambios se guardan al instante</div>
      </div>
    </div>
    <div class="config-layout">
      <div class="config-tabs" id="config-tabs">
        ${tabs.map(t => `<button data-tab="${t.id}" class="${configActiveTab === t.id ? 'active' : ''}"><span class="material-symbols-outlined">${t.icon}</span> ${t.label}</button>`).join('')}
      </div>
      <div class="settings-grid" id="config-body"></div>
    </div>
  `;

  $('#config-tabs').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-tab]');
    if (!b) return;
    configActiveTab = b.dataset.tab;
    renderConfig(root);
  });

  renderConfigTab($('#config-body'));
}

function renderConfigTab(body) {
  switch (configActiveTab) {
    case 'dashboard': renderConfigDashboard(body); break;
    case 'login': renderConfigLogin(body); break;
    case 'tags': renderConfigTags(body); break;
    case 'cuenta': renderConfigCuenta(body); break;
    // Legacy targets fall through to cuenta
    case 'clave':
    case 'logout': renderConfigCuenta(body); break;
  }
}

function renderConfigCuenta(body) {
  body.innerHTML = `
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
      <h3>Cerrar sesión</h3>
      <div class="sub" style="color:var(--text-dim);font-size:.82rem;">Tendrás que volver a meter la clave la próxima vez.</div>
      <div class="row" style="margin-top:.7rem;">
        <button class="btn primary" id="cfg-logout"><span class="material-symbols-outlined">logout</span> Cerrar sesión ahora</button>
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
  $('#cfg-logout').addEventListener('click', () => logout());
}

function renderConfigClave(body) {
  body.innerHTML = `
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
}

function renderConfigLogout(body) {
  body.innerHTML = `
    <div class="settings-card">
      <h3>Cerrar sesión</h3>
      <div class="sub" style="color:var(--text-dim);font-size:.82rem;">Tendrás que volver a meter la clave la próxima vez.</div>
      <div class="row" style="margin-top:.7rem;">
        <button class="btn primary" id="cfg-logout"><span class="material-symbols-outlined">logout</span> Cerrar sesión ahora</button>
      </div>
    </div>
  `;
  $('#cfg-logout').addEventListener('click', () => logout());
}

function renderConfigDashboard(body) {
  const cfg = state.settings.photo_widget || { mode: 'featured', interval_ms: 6000 };
  const order = getDashboardOrder();

  body.innerHTML = `
    <div class="settings-card">
      <h3>Orden del dashboard</h3>
      <div class="sub" style="color:var(--text-dim);font-size:.82rem;">Usa las flechas para reorganizar, o arrastra en escritorio.</div>
      <div class="reorder-list" id="cfg-reorder">
        ${order.map((s, i) => `
          <div class="reorder-item" draggable="true" data-sec="${s}">
            <span class="drag-handle" title="Arrastrar"><span class="material-symbols-outlined">drag_indicator</span></span>
            <span class="label">${SECTION_LABELS[s] || s}</span>
            <span class="move-btns">
              <button data-dir="up" ${i === 0 ? 'disabled' : ''} title="Subir"><span class="material-symbols-outlined">arrow_upward</span></button>
              <button data-dir="down" ${i === order.length - 1 ? 'disabled' : ''} title="Bajar"><span class="material-symbols-outlined">arrow_downward</span></button>
            </span>
          </div>
        `).join('')}
      </div>
      <span class="status" id="cfg-order-status"></span>
    </div>

    <div class="settings-card">
      <h3>Widget de fotos en el inicio</h3>
      <div class="sub" style="color:var(--text-dim);font-size:.82rem;">También puedes cambiarlo desde el icono ⋯ del widget.</div>
      <div class="opts" id="cfg-widget-mode">
        <button data-mode="featured" class="${cfg.mode === 'featured' ? 'active' : ''}"><span class="material-symbols-outlined">star</span> Solo destacadas</button>
        <button data-mode="all" class="${cfg.mode === 'all' ? 'active' : ''}"><span class="material-symbols-outlined">photo_library</span> Todas las fotos</button>
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
  `;

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

  setupReorder();
}

function renderConfigTags(body) {
  // Collect all unique tags across notes and places
  const allTags = new Set();
  state.notes.forEach(n => (n.tags || []).forEach(t => allTags.add(t)));
  state.places.forEach(p => (p.tags || []).forEach(t => allTags.add(t)));
  const overrides = state.settings.tag_colors || {};

  body.innerHTML = `
    <div class="settings-card">
      <h3>Colores de las etiquetas</h3>
      <div class="sub" style="color:var(--text-dim);font-size:.82rem;">Por defecto cada etiqueta tiene su propio color. Aquí puedes personalizarlos. Los cambios afectan a las notas y a los lugares.</div>
      <div class="tag-color-list" id="cfg-tag-list">
        ${allTags.size === 0 ? `<div class="empty">Aún no hay etiquetas. Crea alguna en una nota o lugar.</div>` : ''}
        ${Array.from(allTags).sort().map(t => `
          <div class="tag-color-row">
            <span class="tag-chip-selected" style="--tag-color: ${tagColor(t)};">#${escapeHtml(t)}</span>
            <input type="color" data-tag="${escapeHtml(t)}" value="${escapeHtml(toHexColor(tagColor(t)))}" class="tag-color-picker" />
            ${overrides[t] ? `<button class="btn ghost reset-tag" data-tag="${escapeHtml(t)}" type="button">Resetear</button>` : ''}
          </div>
        `).join('')}
      </div>
      <span class="status" id="cfg-tags-status"></span>
    </div>
  `;

  $$('input.tag-color-picker').forEach(input => {
    input.addEventListener('change', async () => {
      const tag = input.dataset.tag;
      const next = { ...(state.settings.tag_colors || {}) };
      next[tag] = input.value;
      setStatus($('#cfg-tags-status'), 'Guardando…');
      await saveSetting('tag_colors', next);
      setStatus($('#cfg-tags-status'), 'Guardado ✓');
      renderConfigTab(body); // refresh chip preview
    });
  });
  $$('button.reset-tag').forEach(b => {
    b.addEventListener('click', async () => {
      const tag = b.dataset.tag;
      const next = { ...(state.settings.tag_colors || {}) };
      delete next[tag];
      await saveSetting('tag_colors', next);
      renderConfigTab(body);
    });
  });
}

function toHexColor(input) {
  // Already hex
  if (typeof input === 'string' && input.startsWith('#')) return input;
  // hsl() — convert via canvas (simple)
  try {
    const c = document.createElement('canvas');
    c.width = c.height = 1;
    const ctx = c.getContext('2d');
    ctx.fillStyle = input;
    return ctx.fillStyle;
  } catch { return '#888888'; }
}

function renderConfigLogin(body) {
  body.innerHTML = `
    <div class="settings-card">
      <h3>Mi avatar</h3>
      <div class="sub" style="color:var(--text-dim);font-size:.82rem;">Pequeña imagen circular (idealmente cuadrada).</div>
      <div class="asset-row">
        <div class="asset-preview" id="cfg-avatar-preview"></div>
        <div class="asset-info">
          <label class="btn primary" for="cfg-avatar-input">Cambiar</label>
          <input type="file" accept="image/*" id="cfg-avatar-input" hidden />
          <button class="btn ghost" id="cfg-avatar-clear" type="button">Quitar</button>
        </div>
      </div>
    </div>

    <div class="settings-card">
      <h3>Mi foto del login</h3>
      <div class="sub" style="color:var(--text-dim);font-size:.82rem;">Se ve cuando te seleccionan a ti.</div>
      <div class="asset-row">
        <div class="asset-preview wide" id="cfg-bg-preview"></div>
        <div class="asset-info">
          <label class="btn primary" for="cfg-bg-input">Cambiar</label>
          <input type="file" accept="image/*" id="cfg-bg-input" hidden />
          <button class="btn ghost" id="cfg-bg-clear" type="button">Quitar</button>
        </div>
      </div>
    </div>

    <div class="settings-card">
      <h3>Foto por defecto</h3>
      <div class="sub" style="color:var(--text-dim);font-size:.82rem;">Cuando nadie está seleccionado, idealmente una foto de los dos.</div>
      <div class="asset-row">
        <div class="asset-preview wide" id="cfg-default-bg-preview"></div>
        <div class="asset-info">
          <label class="btn primary" for="cfg-default-bg-input">Cambiar</label>
          <input type="file" accept="image/*" id="cfg-default-bg-input" hidden />
          <button class="btn ghost" id="cfg-default-bg-clear" type="button">Quitar</button>
        </div>
      </div>
    </div>

    <span class="status" id="cfg-assets-status"></span>
  `;
  setupAssetUploaders();
}

async function uploadAssetFile(file, prefix) {
  const ext = (file.name.split('.').pop() || 'png').toLowerCase();
  const path = `${prefix}/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from(APP_ASSETS_BUCKET).upload(path, file, {
    cacheControl: '3600', upsert: false, contentType: file.type,
  });
  if (error) throw error;
  return path;
}

async function refreshUserAssetsLocal() {
  // Re-fetch users so we have updated avatar/bg paths for the next login render
  const users = await loadUsersForLogin();
  state._userAssets = Object.fromEntries(users.map(u => [u.name, { avatar: u.avatar_path, bg: u.background_path }]));
  state._defaultBg = await loadDefaultLoginBg();
}

function renderAssetPreview(el, path, isWide) {
  el.innerHTML = '';
  if (path) {
    const img = document.createElement('img');
    img.src = publicAssetUrl(path);
    img.alt = '';
    el.appendChild(img);
  } else {
    el.innerHTML = `<span class="asset-empty"><span class="material-symbols-outlined">${isWide ? 'image' : 'person'}</span></span>`;
  }
}

function setupAssetUploaders() {
  const me = state.currentUser;
  const assets = state._userAssets?.[me] || {};
  const defaultBg = state._defaultBg || '';
  const statusEl = $('#cfg-assets-status');

  renderAssetPreview($('#cfg-avatar-preview'), assets.avatar, false);
  renderAssetPreview($('#cfg-bg-preview'), assets.bg, true);
  renderAssetPreview($('#cfg-default-bg-preview'), defaultBg, true);

  async function pickAndUpload(input, prefix, save) {
    if (!input.files?.length) return;
    const file = input.files[0];
    input.value = '';
    setStatus(statusEl, 'Subiendo…');
    try {
      const path = await uploadAssetFile(file, prefix);
      await save(path);
      await refreshUserAssetsLocal();
      setStatus(statusEl, 'Guardado ✓');
      setupAssetUploaders(); // refresh previews
    } catch (e) {
      console.error(e);
      setStatus(statusEl, `Error: ${e.message || e}`, true);
    }
  }

  $('#cfg-avatar-input').addEventListener('change', (e) => pickAndUpload(e.target, `avatars/${me}`, async (path) => {
    const { error } = await supabase.rpc('set_user_assets', { p_name: me, p_avatar_path: path, p_background_path: null });
    if (error) throw error;
    state._userAssets[me].avatar = path;
  }));

  $('#cfg-bg-input').addEventListener('change', (e) => pickAndUpload(e.target, `backgrounds/${me}`, async (path) => {
    const { error } = await supabase.rpc('set_user_assets', { p_name: me, p_avatar_path: null, p_background_path: path });
    if (error) throw error;
    state._userAssets[me].bg = path;
  }));

  $('#cfg-default-bg-input').addEventListener('change', (e) => pickAndUpload(e.target, 'default-bg', async (path) => {
    await saveSetting('default_background_path', path);
    state._defaultBg = path;
  }));

  // "Quitar" buttons reset the path in DB and remove storage file (best-effort)
  $('#cfg-avatar-clear').addEventListener('click', async () => {
    const current = state._userAssets[me]?.avatar;
    if (!current) return;
    if (!confirm('¿Quitar tu avatar?')) return;
    setStatus(statusEl, 'Quitando…');
    try {
      const { error } = await supabase.rpc('set_user_assets', { p_name: me, p_avatar_path: '', p_background_path: null });
      if (error) throw error;
      try { await supabase.storage.from(APP_ASSETS_BUCKET).remove([current]); } catch {}
      state._userAssets[me].avatar = null;
      setStatus(statusEl, 'Quitado');
      setupAssetUploaders();
    } catch (e) { setStatus(statusEl, `Error: ${e.message || e}`, true); }
  });
  $('#cfg-bg-clear').addEventListener('click', async () => {
    const current = state._userAssets[me]?.bg;
    if (!current) return;
    if (!confirm('¿Quitar tu imagen del login?')) return;
    setStatus(statusEl, 'Quitando…');
    try {
      const { error } = await supabase.rpc('set_user_assets', { p_name: me, p_avatar_path: null, p_background_path: '' });
      if (error) throw error;
      try { await supabase.storage.from(APP_ASSETS_BUCKET).remove([current]); } catch {}
      state._userAssets[me].bg = null;
      setStatus(statusEl, 'Quitada');
      setupAssetUploaders();
    } catch (e) { setStatus(statusEl, `Error: ${e.message || e}`, true); }
  });
  $('#cfg-default-bg-clear').addEventListener('click', async () => {
    if (!state._defaultBg) return;
    if (!confirm('¿Quitar la foto por defecto?')) return;
    setStatus(statusEl, 'Quitando…');
    try {
      const old = state._defaultBg;
      await saveSetting('default_background_path', '');
      try { await supabase.storage.from(APP_ASSETS_BUCKET).remove([old]); } catch {}
      state._defaultBg = '';
      setStatus(statusEl, 'Quitada');
      setupAssetUploaders();
    } catch (e) { setStatus(statusEl, `Error: ${e.message || e}`, true); }
  });
}

function setupReorder() {
  const list = $('#cfg-reorder');
  if (!list) return;
  let dragSrc = null;

  // Drag-and-drop (desktop)
  list.addEventListener('dragstart', (e) => {
    const item = e.target.closest('.reorder-item');
    if (!item) return;
    dragSrc = item;
    item.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    try { e.dataTransfer.setData('text/plain', item.dataset.sec); } catch {}
  });
  list.addEventListener('dragend', () => {
    $$('.reorder-item', list).forEach(el => el.classList.remove('dragging', 'drop-target'));
    dragSrc = null;
  });
  list.addEventListener('dragover', (e) => {
    e.preventDefault();
    const item = e.target.closest('.reorder-item');
    if (!item || item === dragSrc) return;
    $$('.reorder-item', list).forEach(el => el.classList.toggle('drop-target', el === item));
  });
  list.addEventListener('drop', async (e) => {
    e.preventDefault();
    const target = e.target.closest('.reorder-item');
    if (!target || !dragSrc || target === dragSrc) return;
    const items = Array.from($$('.reorder-item', list));
    const srcIdx = items.indexOf(dragSrc);
    const tgtIdx = items.indexOf(target);
    if (srcIdx < tgtIdx) target.after(dragSrc); else target.before(dragSrc);
    await persistOrder();
  });

  // Arrow buttons (touch / explicit reorder)
  list.addEventListener('click', async (e) => {
    const btn = e.target.closest('.move-btns button[data-dir]');
    if (!btn) return;
    const item = btn.closest('.reorder-item');
    if (!item) return;
    if (btn.dataset.dir === 'up' && item.previousElementSibling) {
      item.previousElementSibling.before(item);
    } else if (btn.dataset.dir === 'down' && item.nextElementSibling) {
      item.nextElementSibling.after(item);
    } else {
      return;
    }
    await persistOrder();
    // Re-render the dashboard config tab to update disabled state on buttons
    renderConfigDashboard($('#config-body'));
  });

  async function persistOrder() {
    const newOrder = $$('.reorder-item', list).map(el => el.dataset.sec);
    setStatus($('#cfg-order-status'), 'Guardando…');
    await saveSetting('dashboard_order', { order: newOrder });
    setStatus($('#cfg-order-status'), 'Orden actualizado ✓');
  }
}

// ============================================================
// Note editor
// ============================================================
const dlgNote = $('#dlg-note');
const noteDraft = {
  id: null, title: '', content: '', visibility: 'public',
  links: [], images: [], tags: [], pinned: false,
};

function openNoteEditor(note) {
  noteDraft.id = note?.id || null;
  noteDraft.title = note?.title || '';
  noteDraft.content = note?.content || '';
  noteDraft.visibility = 'public'; // all notes are shared now
  noteDraft.links = Array.isArray(note?.links) ? [...note.links] : [];
  noteDraft.images = Array.isArray(note?.images) ? [...note.images] : [];
  noteDraft.tags = Array.isArray(note?.tags) ? [...note.tags] : [];
  noteDraft.pinned = !!note?.pinned;

  $('#note-title-input').value = noteDraft.title;
  $('#note-plain').value = noteDraft.content;
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
  // If the user typed a tag without pressing Enter, save it too
  const pendingTag = $('#note-tag-input').value.trim();
  if (pendingTag) {
    addNoteTag(pendingTag);
    $('#note-tag-input').value = '';
  }
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
const mediaDraft = { id: null, parsed: null, pinned: false, featured: false, thumbnail_url: null };

function setMediaPin(p) {
  mediaDraft.pinned = p;
  const b = $('#media-pin-toggle');
  b.classList.toggle('is-pinned', p);
  b.innerHTML = `<span class="material-symbols-outlined">keep</span> ${p ? 'Anclada' : 'Anclar'}`;
}
function setMediaFeatured(p) {
  mediaDraft.featured = p;
  const b = $('#media-feature-toggle');
  b.classList.toggle('is-pinned', p);
  b.innerHTML = `<span class="material-symbols-outlined">star</span> ${p ? 'Destacada' : 'Destacar'}`;
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
  setMediaFeatured(!!m?.featured);
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
$('#media-feature-toggle').addEventListener('click', () => setMediaFeatured(!mediaDraft.featured));

$('#media-save').addEventListener('click', async () => {
  const title = $('#media-title-input').value.trim();
  const parsed = parseMediaUrl($('#media-url').value);
  if (!parsed) { setStatus($('#media-status'), 'Pega un enlace válido de Spotify o YouTube', true); $('#media-url').focus(); return; }
  if (!title) { setStatus($('#media-status'), 'El título es obligatorio', true); $('#media-title-input').focus(); return; }

  // Last-ditch attempt to grab a thumbnail (album cover) before saving
  let thumb = mediaDraft.thumbnail_url || parsed.thumbnailUrl;
  if (!thumb) {
    try {
      const oe = await fetchOembedTitle(parsed);
      if (oe?.thumbnail) thumb = oe.thumbnail;
    } catch {}
  }

  const payload = {
    kind: parsed.kind,
    title,
    url: parsed.normalizedUrl,
    embed_url: parsed.embedUrl,
    thumbnail_url: thumb,
    note: $('#media-note-input').value,
    pinned: mediaDraft.pinned,
    featured: mediaDraft.featured,
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
  $('#photo-album').value = '';

  const select = $('#photo-album-select');
  const albums = Array.from(new Set(state.photos.map(p => p.album || '').filter(Boolean))).sort();
  select.innerHTML = `<option value="__new__">+ Nuevo álbum</option>` +
    albums.map(a => `<option value="${escapeHtml(a)}">${escapeHtml(a)}</option>`).join('');

  // When selecting an existing album, hide the free text input
  function syncAlbumInput() {
    const v = select.value;
    if (v === '__new__') {
      $('#photo-album').style.display = '';
      $('#photo-album').placeholder = 'Nombre del álbum nuevo';
      $('#photo-album').value = '';
    } else {
      $('#photo-album').style.display = 'none';
      $('#photo-album').value = v;
    }
  }
  select.onchange = syncAlbumInput;
  // Default: pick the most recent album if any (otherwise force new)
  if (albums.length) {
    select.value = albums[0];
  } else {
    select.value = '__new__';
  }
  syncAlbumInput();

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
    const select = $('#photo-album-select');
    const album = (select && select.value !== '__new__')
      ? select.value
      : $('#photo-album').value.trim();
    const { error: insErr } = await supabase.from('photos').insert({
      storage_path: path,
      caption,
      album,
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
  // Album required validation
  const album = $('#photo-album').value.trim() || $('#photo-album-select').value;
  if (!album || album === '__new__') {
    setStatus($('#photo-status'), 'Elige o crea un álbum antes de subir', true);
    return;
  }
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
  // Preserve scroll position when opening the modal
  const scrollY = window.scrollY;
  renderLightbox();
  if (!dlgLightbox.open) dlgLightbox.showModal();
  // Some browsers shift focus & jump scroll; restore it
  requestAnimationFrame(() => window.scrollTo({ top: scrollY, behavior: 'instant' }));
}

function renderLightbox() {
  const p = lightboxState.list[lightboxState.index];
  if (!p) return;
  $('#lightbox-img').src = publicImageUrl(p.storage_path);
  $('#lightbox-img').alt = p.caption || '';
  if (p.caption) { $('#lightbox-cap').textContent = p.caption; $('#lightbox-cap').hidden = false; }
  else $('#lightbox-cap').hidden = true;

  // Toggle icon FILL: filled when active, outlined when not
  $('#lb-pin').classList.toggle('is-on', !!p.pinned);
  $('#lb-pin .material-symbols-outlined').classList.toggle('filled', !!p.pinned);
  $('#lb-feature').classList.toggle('is-on', !!p.featured);
  $('#lb-feature .material-symbols-outlined').classList.toggle('filled', !!p.featured);

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
// (foto notes feature retired)
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

dlgLightbox.addEventListener('close', async () => {
  const scrollY = window.scrollY;
  await router();
  requestAnimationFrame(() => window.scrollTo({ top: scrollY, behavior: 'instant' }));
});

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
  $('#place-search').value = '';
  $('#place-search-results').classList.remove('open');
  $('#place-search-results').innerHTML = '';
  $('#place-coords').textContent = (placeDraft.lat || placeDraft.lng)
    ? `${placeDraft.lat.toFixed(5)}, ${placeDraft.lng.toFixed(5)}`
    : '— (busca una dirección o haz clic en el mapa)';
  setPlacePin(placeDraft.pinned);
  renderPlaceTags();
  renderPlaceTagSuggestions('');
  $('#place-tag-input').value = '';
  $('#place-status').textContent = '';
  $('#dlg-place-title').textContent = place ? 'Editar lugar' : 'Nuevo lugar';
  $('#place-save').textContent = place ? 'Actualizar' : 'Guardar lugar';
  $('#place-delete').hidden = !place;
  dlgPlace.showModal();
  setTimeout(() => (placeDraft.lat || placeDraft.lng ? $('#place-name') : $('#place-search')).focus(), 0);

  if (place && isUnread(place)) markSeen('places', place);
}

// Nominatim address search (OpenStreetMap geocoder — free, no API key)
let placeSearchTimer = null;
async function nominatimSearch(query) {
  if (!query || query.length < 3) return [];
  const url = `https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&limit=5&q=${encodeURIComponent(query)}`;
  try {
    const res = await fetch(url, { headers: { 'Accept-Language': 'es' } });
    if (!res.ok) return [];
    return await res.json();
  } catch { return []; }
}

$('#place-search').addEventListener('input', (e) => {
  const q = e.target.value.trim();
  clearTimeout(placeSearchTimer);
  if (!q) { $('#place-search-results').classList.remove('open'); return; }
  placeSearchTimer = setTimeout(async () => {
    const results = await nominatimSearch(q);
    const box = $('#place-search-results');
    box.innerHTML = '';
    if (!results.length) {
      box.innerHTML = '<div class="res"><em style="color:var(--text-dim);">Sin resultados</em></div>';
      box.classList.add('open');
      return;
    }
    for (const r of results) {
      const row = document.createElement('div');
      row.className = 'res';
      const title = r.name || r.display_name.split(',')[0];
      const sub = r.display_name;
      row.innerHTML = `<div>${escapeHtml(title)}</div><div class="res-sub">${escapeHtml(sub)}</div>`;
      row.addEventListener('click', () => {
        placeDraft.lat = parseFloat(r.lat);
        placeDraft.lng = parseFloat(r.lon);
        $('#place-coords').textContent = `${placeDraft.lat.toFixed(5)}, ${placeDraft.lng.toFixed(5)}`;
        if (!$('#place-name').value.trim()) $('#place-name').value = title;
        box.classList.remove('open');
        $('#place-search').value = sub;
      });
      box.appendChild(row);
    }
    box.classList.add('open');
  }, 500);
});

$('#place-search').addEventListener('blur', () => {
  setTimeout(() => $('#place-search-results').classList.remove('open'), 200);
});

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
// Instantáneos chat widget (dashboard)
// ============================================================
let chatPollTimer = null;
let chatFilter = 'all'; // 'all' | 'featured'

function setupChatWidget() {
  const root = $('#chat-widget');
  if (!root) return;
  if (chatPollTimer) { clearInterval(chatPollTimer); chatPollTimer = null; }

  // Inject filter buttons into the head (after the dot + title)
  const head = $('.chat-head', root);
  if (head && !$('.chat-filter', head)) {
    const filter = document.createElement('div');
    filter.className = 'chat-filter';
    filter.innerHTML = `
      <button data-f="all" class="${chatFilter === 'all' ? 'active' : ''}">Todos</button>
      <button data-f="featured" class="${chatFilter === 'featured' ? 'active' : ''}"><span class="material-symbols-outlined">star</span></button>
    `;
    head.appendChild(filter);
    filter.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-f]');
      if (!b) return;
      chatFilter = b.dataset.f;
      $$('button', filter).forEach(x => x.classList.toggle('active', x.dataset.f === chatFilter));
      renderChatBody();
    });
  }

  renderChatBody();
  markIncomingChatsRead();

  // Single delegated listener for star / delete buttons inside bubbles
  $('#chat-body').addEventListener('click', onChatBodyClick);

  const send = async () => {
    const input = $('#chat-input-field');
    const body = input.value.trim();
    if (!body) return;
    const btn = $('#chat-send');
    btn.disabled = true;
    try {
      const { error } = await supabase.from('chats').insert({
        author: state.currentUser, body, read_by: [state.currentUser],
      });
      if (error) throw error;
      input.value = '';
      await reloadChats();
      // Auto-prune: keep only the latest 5 non-featured messages
      await pruneOldChats();
    } catch (e) {
      console.error(e);
    } finally {
      btn.disabled = false;
      input.focus();
    }
  };
  $('#chat-send').addEventListener('click', send);
  $('#chat-input-field').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); send(); }
  });

  chatPollTimer = setInterval(async () => {
    await reloadChats();
    markIncomingChatsRead();
  }, 8000);
}

async function reloadChats() {
  try {
    const { data } = await supabase.from('chats').select('*').order('created_at', { ascending: true }).limit(200);
    state.chats = data || [];
    renderChatBody();
  } catch {}
}

async function pruneOldChats() {
  // Keep only the latest 5 non-featured messages — older non-featured are deleted
  const nonFeatured = state.chats
    .filter(m => !m.featured)
    .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  if (nonFeatured.length <= 5) return;
  const toDelete = nonFeatured.slice(0, nonFeatured.length - 5);
  try {
    const ids = toDelete.map(m => m.id);
    await supabase.from('chats').delete().in('id', ids);
    state.chats = state.chats.filter(m => !ids.includes(m.id));
    renderChatBody();
  } catch (e) { console.warn('prune failed', e); }
}

async function markIncomingChatsRead() {
  // Mark any message from the OTHER user as read (only those not authored by me)
  const me = state.currentUser;
  const toMark = state.chats.filter(m => m.author !== me && !(m.read_by || []).includes(me));
  if (!toMark.length) return;
  for (const m of toMark) {
    const next = [...(m.read_by || []), me];
    m.read_by = next;
    try { await supabase.from('chats').update({ read_by: next }).eq('id', m.id); } catch {}
  }
}

// Detect URLs and convert to <a>
function linkify(text) {
  const escaped = escapeHtml(text);
  return escaped.replace(/(https?:\/\/[^\s<]+)/g, (url) => {
    return `<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`;
  });
}

function renderChatBody() {
  const body = $('#chat-body');
  if (!body) return;
  let msgs = state.chats;
  if (chatFilter === 'featured') msgs = msgs.filter(m => m.featured);

  if (!msgs.length) {
    body.innerHTML = `<div class="chat-empty">${chatFilter === 'featured' ? 'No hay mensajes destacados todavía.' : 'No hay mensajitos todavía.<br/>Escribe el primero ✨'}</div>`;
    return;
  }
  body.innerHTML = '';

  for (const m of msgs) {
    const div = document.createElement('div');
    div.className = `chat-bubble ${m.author === state.currentUser ? 'mine' : 'theirs'}${m.featured ? ' featured' : ''}`;
    const bodyText = `<div class="bubble-text">${linkify(m.body)}</div>`;

    // Read mark: only show on MY messages that the other user has read
    const otherUserRead = m.author === state.currentUser
      && Array.isArray(m.read_by)
      && m.read_by.some(u => u !== state.currentUser);

    // Actions: star toggle (destacar protege del auto-borrado)
    const starName = m.featured ? 'star' : 'star_border';
    const actions = `
      <div class="bubble-actions">
        <button class="chat-star" data-id="${m.id}" title="${m.featured ? 'Quitar destacado' : 'Destacar — se queda guardado'}"><span class="material-symbols-outlined">${starName}</span></button>
      </div>
    `;

    div.innerHTML = `
      ${bodyText}
      <div class="bubble-meta">
        ${actions}
        <span>${escapeHtml(m.author)} · ${fmtDate(m.created_at)}</span>
        ${otherUserRead ? '<span class="read-mark" title="Leído"><span class="material-symbols-outlined" style="font-size:14px;">done_all</span></span>' : ''}
      </div>
    `;
    body.appendChild(div);
  }

  // Scroll to bottom
  requestAnimationFrame(() => { body.scrollTop = body.scrollHeight; });
}

async function onChatBodyClick(e) {
  const star = e.target.closest('button.chat-star');
  if (star) {
    const id = star.dataset.id;
    const m = state.chats.find(x => x.id === id);
    if (!m) return;
    const next = !m.featured;
    m.featured = next;
    await supabase.from('chats').update({ featured: next }).eq('id', id);
    renderChatBody();
  }
}

// ============================================================
// Notifications bell (dashboard)
// ============================================================
function setupNotifBell() {
  const bell = $('#notif-bell');
  const popover = $('#notif-popover');
  if (!bell || !popover) return;

  const close = () => { popover.hidden = true; };
  $('#notif-close').addEventListener('click', close);

  bell.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!popover.hidden) { close(); return; }
    renderNotifList();
    popover.hidden = false;
  });
  document.addEventListener('click', (e) => {
    if (!popover.contains(e.target) && e.target !== bell) close();
  });
}

function renderNotifList() {
  const list = $('#notif-list');
  const title = $('#notif-head-title');
  if (!list) return;

  const tagItem = (item, kind, icon, route, label) => ({ ...item, _kind: kind, _icon: icon, _route: route, _label: label });

  const mi = (n) => `<span class="material-symbols-outlined" style="font-size:18px;">${n}</span>`;
  const all = [
    ...state.notes.filter(n => n.visibility !== 'private').map(n => tagItem(n, 'note', mi('edit_note'), '#/notas', n.title)),
    ...state.media.map(m => tagItem(m, 'media', mi(m.kind === 'spotify' ? 'music_note' : 'play_circle'), '#/musica', m.title)),
    ...state.photos.map(p => tagItem(p, 'photo', mi('photo_library'), '#/fotos', p.caption || 'Foto sin título')),
    ...state.movies.map(m => tagItem(m, 'movie', mi('movie'), '#/pelis', m.title)),
  ];

  const unread = all.filter(it => isUnread(it));
  const showUnread = unread.length > 0;
  const items = showUnread
    ? unread.sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    : all.sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 12);

  title.textContent = showUnread ? `Nuevo para ti (${unread.length})` : 'Lo más reciente';

  list.innerHTML = '';
  if (!items.length) {
    list.innerHTML = '<div class="empty">No hay nada todavía.</div>';
    return;
  }
  for (const it of items) {
    const a = document.createElement('a');
    a.className = 'notif-item';
    a.href = it._route;
    a.innerHTML = `
      ${showUnread ? '<span class="dot"></span>' : ''}
      <span class="icon">${it._icon}</span>
      <span class="info">
        <span class="title">${escapeHtml(it._label || 'Sin título')}</span>
        <span class="meta">${escapeHtml(it.created_by || '?')} · ${fmtDate(it.created_at)}</span>
      </span>
    `;
    a.addEventListener('click', () => { $('#notif-popover').hidden = true; });
    list.appendChild(a);
  }
}

// ============================================================
// Page: Pelis (movies)
// ============================================================
function renderPelis(root) {
  const featured = state.movies.filter(m => m.score && m.score >= 4); // 4+ stars as informal "destacadas"
  root.innerHTML = `
    <div class="page-head">
      <div>
        <h1>🎬 Pelis</h1>
        <div class="sub">Lo que queremos ver y lo que ya vimos</div>
      </div>
      <div class="actions">
        <button class="btn primary" id="new-movie-btn">+ Nueva peli</button>
      </div>
    </div>
    <div class="grid-cards" id="movies-grid"></div>
  `;
  $('#new-movie-btn').addEventListener('click', () => openMovieEditor(null));
  const grid = $('#movies-grid');
  if (!state.movies.length) {
    grid.innerHTML = '<div class="empty">Aún no hay pelis. Añade la primera con el botón.</div>';
    return;
  }
  state.movies.forEach(m => grid.appendChild(renderMovieCard(m)));
}

function renderMovieCard(m) {
  const card = document.createElement('article');
  card.className = 'card clickable movie-card';
  if (m.pinned) card.classList.add('pinned');
  card.setAttribute('role', 'button');
  card.setAttribute('tabindex', '0');

  if (isUnread(m)) {
    const dot = document.createElement('span');
    dot.className = 'unread-dot';
    card.appendChild(dot);
  }

  const actions = document.createElement('div');
  actions.className = 'card-actions';
  actions.innerHTML = `<button title="${m.pinned ? 'Desanclar' : 'Anclar'}" class="${m.pinned ? 'is-on' : ''}" data-action="pin"><span class="material-symbols-outlined">keep</span></button>`;
  actions.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (!e.target.closest('button[data-action="pin"]')) return;
    const next = !m.pinned;
    m.pinned = next;
    await supabase.from('movies').update({ pinned: next }).eq('id', m.id);
    await router();
  });
  card.appendChild(actions);

  const poster = document.createElement('div');
  poster.className = 'poster-wrap';
  if (m.image_path) {
    const img = document.createElement('img');
    img.src = publicImageUrl(m.image_path);
    img.alt = m.title; img.loading = 'lazy';
    poster.appendChild(img);
  } else {
    const np = document.createElement('div');
    np.className = 'no-poster';
    np.innerHTML = '<span class="material-symbols-outlined" style="font-size:3rem;">movie</span>';
    poster.appendChild(np);
  }
  if (m.platform) {
    const chip = document.createElement('div');
    chip.className = 'platform-chip';
    chip.textContent = m.platform;
    poster.appendChild(chip);
  }
  // Watched badge
  const watched = Array.isArray(m.watched_by) ? m.watched_by : [];
  if (watched.length) {
    const wb = document.createElement('div');
    wb.className = 'watch-badge';
    const check = '<span class="material-symbols-outlined seen" style="font-size:14px;">check</span>';
    wb.innerHTML = watched.length === 2
      ? `${check} los dos`
      : `${check} ${escapeHtml(watched[0])}`;
    poster.appendChild(wb);
  }
  card.appendChild(poster);

  const body = document.createElement('div');
  body.className = 'body';

  const h = document.createElement('h3');
  h.textContent = m.title;
  body.appendChild(h);

  if (m.score) {
    const row = document.createElement('div');
    row.className = 'stars-row';
    const full = Math.floor(m.score);
    let html = '';
    for (let i = 0; i < 5; i++) {
      html += i < full ? '★' : '<span class="empty-star">★</span>';
    }
    row.innerHTML = html;
    body.appendChild(row);
  }

  const meta = document.createElement('div');
  meta.className = 'meta';
  meta.innerHTML = `<span>${escapeHtml(m.created_by || '?')} · ${fmtDate(m.created_at)}</span>`;
  body.appendChild(meta);

  card.appendChild(body);
  card.addEventListener('click', () => openMovieEditor(m));
  card.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openMovieEditor(m); }
  });
  return card;
}

// ---------- Movie editor ----------
const dlgMovie = $('#dlg-movie');
const movieDraft = { id: null, score: null, watched_by: [], pinned: false, image_path: null };

function setMovieStars(score) {
  movieDraft.score = score;
  $$('#movie-stars button[data-v]').forEach(b => {
    const v = Number(b.dataset.v);
    b.classList.toggle('on', v <= (score || 0));
  });
}

function setMoviePin(p) {
  movieDraft.pinned = p;
  const b = $('#movie-pin-toggle');
  b.classList.toggle('is-pinned', p);
  b.innerHTML = `<span class="material-symbols-outlined">keep</span> ${p ? 'Anclada' : 'Anclar'}`;
}

function renderMovieImage() {
  const el = $('#movie-image-preview');
  el.innerHTML = '';
  if (movieDraft.image_path) {
    const img = document.createElement('img');
    img.src = publicImageUrl(movieDraft.image_path);
    el.appendChild(img);
  } else {
    el.textContent = '🎬';
  }
}

function renderWatchedCheckboxes(usersNames) {
  const wrap = $('#movie-watched');
  // Keep label, remove existing checkboxes
  wrap.innerHTML = '<div class="watched-label">¿Quién la vio?</div>';
  for (const name of usersNames) {
    const lbl = document.createElement('label');
    lbl.className = 'watched-check';
    const checked = movieDraft.watched_by.includes(name);
    if (checked) lbl.classList.add('checked');
    lbl.innerHTML = `<input type="checkbox" ${checked ? 'checked' : ''} /> ${escapeHtml(name)}`;
    const cb = lbl.querySelector('input');
    cb.addEventListener('change', () => {
      if (cb.checked) {
        if (!movieDraft.watched_by.includes(name)) movieDraft.watched_by.push(name);
        lbl.classList.add('checked');
      } else {
        movieDraft.watched_by = movieDraft.watched_by.filter(x => x !== name);
        lbl.classList.remove('checked');
      }
    });
    wrap.appendChild(lbl);
  }
}

async function openMovieEditor(m) {
  movieDraft.id = m?.id || null;
  movieDraft.score = m?.score ? Number(m.score) : null;
  movieDraft.watched_by = Array.isArray(m?.watched_by) ? [...m.watched_by] : [];
  movieDraft.pinned = !!m?.pinned;
  movieDraft.image_path = m?.image_path || null;

  $('#movie-title-input').value = m?.title || '';
  $('#movie-platform').value = m?.platform || '';
  $('#movie-notes').value = m?.notes || '';
  setMovieStars(movieDraft.score);
  setMoviePin(movieDraft.pinned);
  renderMovieImage();
  // Fetch user names dynamically
  const userNames = Object.keys(state._userAssets || {});
  if (userNames.length === 0) userNames.push('Jaime', 'Mayck');
  renderWatchedCheckboxes(userNames);

  $('#movie-status').textContent = '';
  $('#dlg-movie-title').textContent = m ? 'Editar peli' : 'Nueva peli';
  $('#movie-save').textContent = m ? 'Actualizar' : 'Guardar';
  $('#movie-delete').hidden = !m;

  dlgMovie.showModal();
  setTimeout(() => $('#movie-title-input').focus(), 0);
  if (m && isUnread(m)) markSeen('movies', m);
}

$('#movie-stars').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-v]');
  if (!b) return;
  const v = Number(b.dataset.v);
  // Clicking the same star clears (toggle)
  if (movieDraft.score === v) setMovieStars(null);
  else setMovieStars(v);
});
$('#movie-stars-clear').addEventListener('click', () => setMovieStars(null));

$('#movie-pin-toggle').addEventListener('click', () => setMoviePin(!movieDraft.pinned));

$('#movie-image-pick').addEventListener('click', () => $('#movie-image-input').click());

$('#movie-image-input').addEventListener('change', async (e) => {
  if (!e.target.files?.length) return;
  const file = e.target.files[0];
  e.target.value = '';
  setStatus($('#movie-status'), 'Subiendo imagen…');
  try {
    const ext = (file.name.split('.').pop() || 'png').toLowerCase();
    const path = `movies/${crypto.randomUUID()}.${ext}`;
    const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
      cacheControl: '3600', upsert: false, contentType: file.type,
    });
    if (error) throw error;
    movieDraft.image_path = path;
    renderMovieImage();
    setStatus($('#movie-status'), 'Imagen subida');
  } catch (err) {
    setStatus($('#movie-status'), `Error: ${err.message || err}`, true);
  }
});

$('#movie-image-clear').addEventListener('click', () => {
  if (movieDraft.image_path) {
    supabase.storage.from(BUCKET).remove([movieDraft.image_path]).catch(() => {});
  }
  movieDraft.image_path = null;
  renderMovieImage();
});

$('#movie-save').addEventListener('click', async () => {
  const title = $('#movie-title-input').value.trim();
  if (!title) { setStatus($('#movie-status'), 'El título es obligatorio', true); $('#movie-title-input').focus(); return; }
  const payload = {
    title,
    score: movieDraft.score || null,
    platform: $('#movie-platform').value.trim(),
    notes: $('#movie-notes').value,
    image_path: movieDraft.image_path,
    watched_by: movieDraft.watched_by,
    pinned: movieDraft.pinned,
  };
  setStatus($('#movie-status'), 'Guardando…');
  try {
    if (movieDraft.id) {
      const { error } = await supabase.from('movies').update(payload).eq('id', movieDraft.id);
      if (error) throw error;
    } else {
      payload.created_by = state.currentUser;
      payload.seen_by = [state.currentUser];
      const { error } = await supabase.from('movies').insert(payload);
      if (error) throw error;
    }
    dlgMovie.close();
    await router();
  } catch (e) { setStatus($('#movie-status'), `Error al guardar: ${e.message || e}`, true); }
});

$('#movie-delete').addEventListener('click', async () => {
  if (!movieDraft.id) return;
  const m = state.movies.find(x => x.id === movieDraft.id);
  if (!m) return;
  if (!confirm(`¿Eliminar "${m.title}"? No se puede deshacer.`)) return;
  setStatus($('#movie-status'), 'Eliminando…');
  try {
    if (m.image_path) {
      try { await supabase.storage.from(BUCKET).remove([m.image_path]); } catch {}
    }
    const { error } = await supabase.from('movies').delete().eq('id', m.id);
    if (error) throw error;
    dlgMovie.close();
    await router();
  } catch (e) { setStatus($('#movie-status'), `Error al eliminar: ${e.message || e}`, true); }
});

// ============================================================
// Boot
// ============================================================
async function boot() {
  const saved = localStorage.getItem(AUTH_KEY);
  if (saved) {
    // Restore the session quickly — hide the (visible-by-default) login,
    // then set up everything else in parallel.
    state.currentUser = saved;
    hideLogin();
    initAuthUI(); // wire pincode for next logout, runs async without blocking
    await loadSettings();
    if (!location.hash) location.hash = '#/inicio';
    await router();
  } else {
    // Logged out: the auth overlay is already visible in HTML; just wire it up.
    showLogin();
    await initAuthUI();
  }
}
boot();
