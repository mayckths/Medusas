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

// Public URL for a photo in the photos bucket. Without `opts` returns the
// original full-res object — use that ONLY when we really need it (the
// lightbox). For widgets, grids, card thumbnails and previews, pass a
// transform options object (e.g. `{ width: 320 }`) so Supabase's image
// pipeline serves a much smaller, format-optimized payload. That keeps
// the dashboard fast and only loads the heavy original when the user
// actually opens a photo.
function publicImageUrl(path, opts) {
  if (!path) return '';
  if (!opts) return supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
  // Supabase's imgproxy ignores aspect ratio when only `width` is given —
  // it scales width but keeps the original height (we caught it serving
  // 360x4032 files for 3000x4000 originals, aspect 0.09). Always bound
  // BOTH dimensions and use `resize: contain` so the API returns an
  // image that fits inside w×h preserving the original aspect. Default
  // height to 4× width — wide enough to never crop, no matter how
  // portrait the source.
  const width = opts.width;
  const height = opts.height || (width ? width * 4 : undefined);
  const transform = { quality: 75, resize: 'contain', ...opts, width, height };
  return supabase.storage.from(BUCKET).getPublicUrl(path, { transform }).data.publicUrl;
}

// Pick a transform width sized for an on-screen CSS width, taking device
// pixel ratio into account so retina screens don't look fuzzy. Capped at
// 2x to keep payloads sane on 3x phones.
function thumbWidth(cssPx) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  return Math.ceil(cssPx * dpr);
}
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

// Make a UUID safe to use as a view-transition-name token (must be a CSS ident).
function cssSafeId(id) { return String(id).replace(/[^a-zA-Z0-9_-]/g, '-'); }

// Wrap a DOM mutation in the Browser's View Transitions API so list
// reorders (e.g., pinning) animate smoothly instead of jumping. Cards
// using `view-transition-name` will glide between their old and new
// positions; cards that disappear/appear cross-fade.
function togglePinWithTransition(mutator) {
  if (typeof document.startViewTransition !== 'function') {
    return mutator();
  }
  const t = document.startViewTransition(() => mutator());
  return t.finished.catch(() => {});
}

// ============================================================
// Custom alert / confirm modals (no native browser dialogs).
// Both are async and return a promise — uiAlert resolves with no
// value, uiConfirm resolves with true (confirmed) or false (cancelled).
// ============================================================
function ensureUiDialog() {
  let dlg = document.getElementById('ui-dialog');
  if (dlg) return dlg;
  dlg = document.createElement('dialog');
  dlg.id = 'ui-dialog';
  dlg.className = 'modal ui-dialog';
  dlg.innerHTML = `
    <div class="modal-inner">
      <div class="modal-head">
        <h2 id="ui-dialog-title"></h2>
        <button class="close-x" id="ui-dialog-close" type="button" aria-label="Cerrar">
          <span class="material-symbols-outlined">close</span>
        </button>
      </div>
      <div class="ui-dialog-message" id="ui-dialog-message"></div>
      <div class="modal-actions">
        <button class="btn" id="ui-dialog-cancel" type="button">Cancelar</button>
        <button class="btn primary" id="ui-dialog-confirm" type="button">Aceptar</button>
      </div>
    </div>
  `;
  document.body.appendChild(dlg);
  return dlg;
}

function _openUiDialog({ title, message, confirmLabel, cancelLabel, danger, withCancel }) {
  return new Promise(resolve => {
    const dlg = ensureUiDialog();
    dlg.querySelector('#ui-dialog-title').textContent = title;
    dlg.querySelector('#ui-dialog-message').textContent = message;
    const cancelBtn = dlg.querySelector('#ui-dialog-cancel');
    const confirmBtn = dlg.querySelector('#ui-dialog-confirm');
    const closeBtn = dlg.querySelector('#ui-dialog-close');
    cancelBtn.hidden = !withCancel;
    cancelBtn.textContent = cancelLabel;
    confirmBtn.textContent = confirmLabel;
    confirmBtn.classList.toggle('danger', !!danger);
    confirmBtn.classList.toggle('primary', !danger);
    let result = false;
    const finish = (value) => {
      result = value;
      try { dlg.close(); } catch {}
      cleanup();
      resolve(result);
    };
    const onConfirm = () => finish(true);
    const onCancel = () => finish(false);
    const onClose = () => finish(false);
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
      else if (e.key === 'Enter') { e.preventDefault(); onConfirm(); }
    };
    const onCancelDlg = () => finish(false); // browser fires 'cancel' on Escape
    const cleanup = () => {
      closeBtn.removeEventListener('click', onClose);
      confirmBtn.removeEventListener('click', onConfirm);
      cancelBtn.removeEventListener('click', onCancel);
      dlg.removeEventListener('keydown', onKey);
      dlg.removeEventListener('cancel', onCancelDlg);
    };
    closeBtn.addEventListener('click', onClose);
    confirmBtn.addEventListener('click', onConfirm);
    cancelBtn.addEventListener('click', onCancel);
    dlg.addEventListener('keydown', onKey);
    dlg.addEventListener('cancel', onCancelDlg);
    try { dlg.showModal(); } catch { dlg.setAttribute('open', ''); }
    setTimeout(() => confirmBtn.focus(), 30);
  });
}

function uiAlert(message, opts = {}) {
  return _openUiDialog({
    title: opts.title || 'Aviso',
    message: String(message),
    confirmLabel: opts.confirmLabel || 'Cerrar',
    cancelLabel: 'Cancelar',
    danger: !!opts.danger,
    withCancel: false,
  });
}

function uiConfirm(message, opts = {}) {
  return _openUiDialog({
    title: opts.title || 'Confirmar',
    message: String(message),
    confirmLabel: opts.confirmLabel || 'Aceptar',
    cancelLabel: opts.cancelLabel || 'Cancelar',
    danger: !!opts.danger,
    withCancel: true,
  });
}

// Async prompt — resolves to the entered string, or null if cancelled.
function uiPrompt(message, opts = {}) {
  return new Promise(resolve => {
    let dlg = document.getElementById('ui-prompt');
    if (!dlg) {
      dlg = document.createElement('dialog');
      dlg.id = 'ui-prompt';
      dlg.className = 'modal ui-dialog';
      dlg.innerHTML = `
        <div class="modal-inner">
          <div class="modal-head">
            <h2 id="ui-prompt-title"></h2>
            <button class="close-x" id="ui-prompt-close" type="button" aria-label="Cerrar">
              <span class="material-symbols-outlined">close</span>
            </button>
          </div>
          <div class="ui-dialog-message" id="ui-prompt-message"></div>
          <input type="text" id="ui-prompt-input" class="ui-prompt-input" />
          <div class="modal-actions">
            <button class="btn" id="ui-prompt-cancel" type="button">Cancelar</button>
            <button class="btn primary" id="ui-prompt-confirm" type="button">Aceptar</button>
          </div>
        </div>
      `;
      document.body.appendChild(dlg);
    }
    const titleEl = dlg.querySelector('#ui-prompt-title');
    const msgEl = dlg.querySelector('#ui-prompt-message');
    const input = dlg.querySelector('#ui-prompt-input');
    const confirmBtn = dlg.querySelector('#ui-prompt-confirm');
    const cancelBtn = dlg.querySelector('#ui-prompt-cancel');
    const closeBtn = dlg.querySelector('#ui-prompt-close');
    titleEl.textContent = opts.title || 'Escribe algo';
    msgEl.textContent = message || '';
    msgEl.hidden = !message;
    input.value = opts.defaultValue || '';
    input.placeholder = opts.placeholder || '';
    input.type = opts.type || 'text';
    confirmBtn.textContent = opts.confirmLabel || 'Aceptar';
    cancelBtn.textContent = opts.cancelLabel || 'Cancelar';

    const finish = (value) => {
      try { dlg.close(); } catch {}
      cleanup();
      resolve(value);
    };
    const onConfirm = () => {
      const v = (input.value || '').trim();
      if (opts.required && !v) { input.focus(); return; }
      finish(v);
    };
    const onCancel = () => finish(null);
    const onClose = () => finish(null);
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
      else if (e.key === 'Enter' && document.activeElement === input) { e.preventDefault(); onConfirm(); }
    };
    const onCancelDlg = () => finish(null);
    const cleanup = () => {
      confirmBtn.removeEventListener('click', onConfirm);
      cancelBtn.removeEventListener('click', onCancel);
      closeBtn.removeEventListener('click', onClose);
      dlg.removeEventListener('keydown', onKey);
      dlg.removeEventListener('cancel', onCancelDlg);
    };
    confirmBtn.addEventListener('click', onConfirm);
    cancelBtn.addEventListener('click', onCancel);
    closeBtn.addEventListener('click', onClose);
    dlg.addEventListener('keydown', onKey);
    dlg.addEventListener('cancel', onCancelDlg);
    try { dlg.showModal(); } catch { dlg.setAttribute('open', ''); }
    setTimeout(() => { input.focus(); input.select(); }, 50);
  });
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

// Try to fetch a title via oEmbed (best-effort). For Spotify, we
// additionally hit our `spotify-info` edge function because Spotify's
// own oEmbed doesn't return the artist.
async function fetchOembedTitle(parsed) {
  if (!parsed) return null;
  try {
    const target = parsed.kind === 'spotify'
      ? `https://open.spotify.com/oembed?url=${encodeURIComponent(parsed.normalizedUrl)}`
      : `https://www.youtube.com/oembed?url=${encodeURIComponent(parsed.normalizedUrl)}&format=json`;
    const res = await fetch(target);
    if (!res.ok) return null;
    const json = await res.json();
    const result = {
      title: json.title || null,
      thumbnail: json.thumbnail_url || null,
      // For YouTube this is the channel name (usually the artist).
      author: json.author_name || null,
    };
    if (parsed.kind === 'spotify') {
      // Fall back to the edge function for the artist
      try {
        const u = `https://vmdsibzivcugjidtkhzt.supabase.co/functions/v1/spotify-info?url=${encodeURIComponent(parsed.normalizedUrl)}`;
        const sres = await fetch(u);
        if (sres.ok) {
          const sjson = await sres.json();
          if (sjson?.artist && !result.author) result.author = sjson.artist;
        }
      } catch {}
    }
    return result;
  } catch {
    return null;
  }
}

// Helper used everywhere we need to render a media item label: combines
// title + artist into "Title — Artist" when both exist.
function displayMediaTitle(m) {
  if (!m) return '';
  const t = (m.title || '').trim();
  const a = (m.artist || '').trim();
  if (t && a) return `${t} — ${a}`;
  return t || a || 'Sin título';
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

// Reconcile the dashboard bell badge with the live totalUnreadCount.
// Creates the .notif-count span if needed, removes it when count drops
// to 0. Called from markAllSeen and any other code that mutates seen_by.
function refreshBellBadge() {
  const bell = document.querySelector('#notif-bell');
  if (!bell) return;
  const count = totalUnreadCount();
  let badge = bell.querySelector('.notif-count');
  if (count > 0) {
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'notif-count';
      bell.appendChild(badge);
    }
    badge.textContent = String(count);
  } else if (badge) {
    badge.remove();
  }
}

// Mark every unread item in a collection as seen for the current user
// in one go. Used when the user enters a section that has the indicator
// dot, OR when they open the notifications panel from the dashboard —
// both gestures imply they've acknowledged the new stuff.
async function markAllSeen(table, items) {
  if (!state.currentUser) return;
  const unread = items.filter(item => isUnread(item));
  if (!unread.length) return;
  unread.forEach(item => {
    const seen = Array.isArray(item.seen_by) ? item.seen_by : [];
    item.seen_by = seen.includes(state.currentUser) ? seen : [...seen, state.currentUser];
  });
  updateSidebarBadges();
  refreshBellBadge();
  try {
    await Promise.all(unread.map(item =>
      supabase.from(table).update({ seen_by: item.seen_by }).eq('id', item.id)
    ));
  } catch (e) { console.warn('markAllSeen failed', e); }
}

// Mark all unread items across every notif-producing table as seen.
// Called when the user opens the bell — by opening the panel they
// inherently acknowledge what's new.
async function markAllUnreadEverywhere() {
  // Private notes never generate notifications, so they shouldn't be
  // included — leaving them unread keeps their personal "for me" dot
  // intact even if the partner opened the bell.
  const sharedNotes = state.notes.filter(n => n.visibility !== 'private');
  await Promise.all([
    markAllSeen('notes', sharedNotes),
    markAllSeen('media', state.media),
    markAllSeen('photos', state.photos),
    markAllSeen('movies', state.movies),
  ]);
  // Belt-and-braces refresh in case any of the inner calls didn't
  // get to update the badge (e.g. an early return when its table had
  // no unread items — still leaves the total visible).
  refreshBellBadge();
}

// Match the route to its underlying collection so visiting that section
// (which already shows the indicator dots on each card) acknowledges
// them as a batch. Albums under /fotos count as visiting Fotos.
function markSectionVisited(hash) {
  if (hash === '#/notas' || hash === '#/notas/publicas' || hash === '#/notas/privadas') {
    return markAllSeen('notes', state.notes.filter(n => n.visibility !== 'private'));
  }
  if (hash === '#/musica') return markAllSeen('media', state.media);
  if (hash === '#/fotos' || hash.startsWith('#/fotos/album/')) return markAllSeen('photos', state.photos);
  if (hash === '#/pelis') return markAllSeen('movies', state.movies);
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
  postits: [],
  settings: {
    photo_widget: { mode: 'featured', interval_ms: 6000 },
  },
  view: { notas: 'cards', musica: 'cards' },
  filterTag: { notas: null, lugares: null, fotos: null, pelis: null },
  /* Pelis page top-level tab: 'watchlist' (alguien aún no la vio) or
     'together' (ambos la vieron). Persists across navigations within
     the session; resets on reload. */
  peliView: 'watchlist',
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
    { data: postits },
  ] = await Promise.all([
    supabase.from('notes').select('*').order('pinned', { ascending: false }).order('created_at', { ascending: false }),
    supabase.from('media').select('*').order('pinned', { ascending: false }).order('created_at', { ascending: false }),
    supabase.from('photos').select('*').order('pinned', { ascending: false }).order('created_at', { ascending: false }),
    supabase.from('places').select('*').order('pinned', { ascending: false }).order('created_at', { ascending: false }),
    supabase.from('movies').select('*').order('pinned', { ascending: false }).order('created_at', { ascending: false }),
    supabase.from('chats').select('*').order('created_at', { ascending: true }).limit(200),
    supabase.from('postits').select('*').order('z_index', { ascending: true }).order('created_at', { ascending: true }),
  ]);
  state.notes = notes || [];
  state.media = media || [];
  state.photos = photos || [];
  state.places = places || [];
  state.movies = movies || [];
  state.chats = chats || [];
  state.postits = postits || [];
  updateSidebarBadges();
  // Seed the ambient blurred backdrop from a featured photo (or any photo)
  // so it's already there even on non-dashboard routes
  const ambient = state.photos.find(p => p.featured) || state.photos[0];
  if (ambient) setBgPhoto(ambient.storage_path);
  // Background: backfill missing Spotify/YouTube thumbnails
  backfillMediaThumbnails();
}

let backfillRan = false;
async function backfillMediaThumbnails() {
  if (backfillRan) return;
  backfillRan = true;
  // Bump this when the backfill logic changes (e.g., new sources for
  // missing artists) so it re-runs once per client.
  const BACKFILL_VERSION = 'v2-spotify-artist';
  try {
    if (localStorage.getItem('medusas:media-backfill') === BACKFILL_VERSION) return;
  } catch {}
  // Anything that's missing a thumbnail OR an artist gets a fetch.
  const needs = state.media.filter(m => !m.thumbnail_url || !m.artist);
  if (!needs.length) return;
  let anyChanged = false;
  for (const m of needs) {
    const parsed = parseMediaUrl(m.url);
    if (!parsed) continue;
    let thumb = m.thumbnail_url || parsed.thumbnailUrl;
    let artist = m.artist;
    let oe = null;
    // Only hit oembed once per item, and only if there's something to fetch
    if (!thumb || !artist) {
      try { oe = await fetchOembedTitle(parsed); } catch {}
      if (oe?.thumbnail && !thumb) thumb = oe.thumbnail;
      if (oe?.author && !artist) artist = oe.author;
    }
    const updates = {};
    if (thumb && thumb !== m.thumbnail_url) updates.thumbnail_url = thumb;
    if (artist && artist !== m.artist) updates.artist = artist;
    if (Object.keys(updates).length) {
      Object.assign(m, updates);
      try { await supabase.from('media').update(updates).eq('id', m.id); } catch {}
      anyChanged = true;
    }
  }
  try { localStorage.setItem('medusas:media-backfill', BACKFILL_VERSION); } catch {}
  // Re-render current view to show the new thumbnails / titles
  if (anyChanged && (state.route === '#/musica' || state.route === '#/inicio')) {
    router();
  }
}

async function loadSettings() {
  try {
    const { data } = await supabase.from('app_settings').select('*');
    for (const row of (data || [])) state.settings[row.key] = row.value;
  } catch (e) { console.warn(e); }
  // Sync the bg mode now that settings are loaded
  applyBgMode();
}

async function saveSetting(key, value) {
  state.settings[key] = value;
  // Bg setting changes need to be re-applied on the live page
  if (key === 'bg') applyBgMode();
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
    case hash.startsWith('#/fotos/album/'): renderAlbumDetail(content, hash.slice('#/fotos/album/'.length)); break;
    case hash === '#/pelis': renderPelis(content); break;
    case hash === '#/configuracion': renderConfig(content); break;
    default: location.hash = '#/inicio';
  }
  // Visiting a section is an implicit acknowledgment of its unread
  // items. Fired after render so the page's own unread-dots animate in
  // before fading on the next paint, and the DB roundtrip doesn't block
  // navigation.
  markSectionVisited(hash);
}
window.addEventListener('hashchange', router);

// Re-render the current page WITHOUT going through router/loadAll.
// Used when the only change is local state (e.g. after closing the lightbox
// where pin/feature/delete already mutated state.photos in place).
function rerenderCurrentPage() {
  const content = $('#content');
  if (!content) return;
  const hash = state.route || (location.hash || '#/inicio');
  switch (true) {
    case hash === '#/inicio': renderInicio(content); break;
    case hash === '#/notas':
    case hash === '#/notas/publicas':
    case hash === '#/notas/privadas':
      renderNotas(content); break;
    case hash === '#/musica': renderMusica(content); break;
    case hash === '#/fotos': renderFotos(content); break;
    case hash.startsWith('#/fotos/album/'): renderAlbumDetail(content, hash.slice('#/fotos/album/'.length)); break;
    case hash === '#/pelis': renderPelis(content); break;
    case hash === '#/configuracion': renderConfig(content); break;
  }
}

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
          <h2>Música y podcasts recientes</h2>
          <a href="#/musica">Ver toda →</a>
        </div>
        <div class="grid-cards" id="dash-media-grid"></div>
      </section>`,
    photos: `
      <section class="section-block dash-photos-section" data-sec="photos">
        <div class="section-head">
          <h2>Fotos recientes</h2>
          <a href="#/fotos">Ver todas →</a>
        </div>
        <div class="dash-photos-strip" id="dash-photos-grid"></div>
      </section>`,
    movies: `
      <section class="section-block" data-sec="movies">
        <div class="section-head">
          <h2>Pelis y Series recientes</h2>
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

  // The left column shows the post-it board + section blocks in the configured order.
  // The right column is the photo widget + Instantáneos chat.
  root.innerHTML = `
    <div class="page-head">
      <div>
        <h1>Hola, ${escapeHtml(state.currentUser)}</h1>
        <div class="sub">Este es nuestro lugar seguro</div>
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

    ${renderRelationshipStats()}

    <div class="dashboard-cols">
      <div class="col-left">
        ${order.map(s => sectionTemplates[s] || '').join('')}
      </div>

      <div class="col-right">
        <div class="photo-widget" id="photo-widget">
          <div class="pw-empty">Aún no hay fotos para mostrar aquí.</div>
        </div>
        <div class="postit-board-wrap">
          <div class="postit-board" id="postit-board">
            <div class="pb-empty" id="pb-empty" hidden>Toca <strong>+ Nuevo post-it</strong> para empezar el tablero.</div>
          </div>
          <!-- Sits outside the scaled board so it renders at the same size
               as the rest of the glass pill buttons (Ver todas, etc.). -->
          <button class="btn pb-new" id="pb-new" type="button">+ Nuevo post-it</button>
        </div>
      </div>
    </div>
  `;

  // Recent notes (3 cards — wider in the 2/3 column)
  const notesGrid = $('#dash-notes-grid');
  if (notesGrid) {
    const recentNotes = state.notes.slice(0, 3);
    if (recentNotes.length) recentNotes.forEach(n => notesGrid.appendChild(renderNoteCard(n)));
    else notesGrid.innerHTML = '<div class="empty">Aún no hay notas.</div>';
  }

  // Recent media (3 cards)
  const mediaGrid = $('#dash-media-grid');
  if (mediaGrid) {
    const recentMedia = state.media.slice(0, 3);
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
    const recentMovies = state.movies.slice(0, 3);
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

  setupPostitBoard();
  setupPhotoWidget();
  setupNotifBell();
  // Defer to next paint so layout is committed before we measure.
  requestAnimationFrame(() => {
    fitColRightToViewport();
    // Hide overflowing cards so dashboard sections always show one row
    ['#dash-notes-grid', '#dash-media-grid', '#dash-movies-grid', '#dash-places-grid']
      .forEach(sel => clampGridToOneRow(document.querySelector(sel)));
  });
}

// Hide any children that would wrap to a second row in a CSS grid.
// Keeps dashboard sections to a single row regardless of how many
// items the renderer queued. Re-evaluates on container resize.
function clampGridToOneRow(gridEl) {
  if (!gridEl) return;
  const apply = () => {
    const children = Array.from(gridEl.children);
    if (!children.length) return;
    // Reset visibility first so we measure with everything shown
    children.forEach(c => { c.style.display = ''; });
    // Force one layout pass
    void gridEl.offsetHeight;
    // The first row's top is the smallest offsetTop. Anything with a
    // bigger offsetTop wrapped to a later row → hide it.
    const firstTop = children[0].offsetTop;
    for (const c of children) {
      if (c.offsetTop > firstTop + 2) c.style.display = 'none';
    }
  };
  apply();
  if (typeof ResizeObserver !== 'undefined') {
    if (gridEl._clampObs) try { gridEl._clampObs.disconnect(); } catch {}
    gridEl._clampObs = new ResizeObserver(apply);
    gridEl._clampObs.observe(gridEl);
  }
}

// ============================================================
// Right column sizing: dynamically fit to visible viewport so the
// chat widget never extends past the fold. We compute the natural
// top offset (worst case at scroll = 0) and set the height to
// viewport - that top - 16px breathing room. After scrolling, the
// sticky positioning keeps the column at top:16 which leaves some
// unused space at the bottom — acceptable tradeoff for always-fits.
function fitColRightToViewport() {
  // Both right-column cards have fixed heights now, so we no longer need
  // to compute a viewport-fitting size. Clear any previously-set inline
  // height in case the user is loading a session that wrote them.
  const col = document.querySelector('.col-right');
  if (!col) return;
  col.style.height = '';
  col.style.maxHeight = '';
}
if (!window._medusasColResizeWired) {
  window._medusasColResizeWired = true;
  window.addEventListener('resize', () => {
    if (document.querySelector('.col-right')) fitColRightToViewport();
  });
}

// ============================================================
// Relationship stats widget — 4 little cards above the dashboard
// columns that show photos, notes, months together and shared movies.
// ============================================================
const RELATIONSHIP_START = new Date(2026, 3, 25); // April 25, 2026

function monthsSince(start) {
  const now = new Date();
  let months = (now.getFullYear() - start.getFullYear()) * 12
             + (now.getMonth() - start.getMonth());
  // Subtract a month if we haven't reached the same day-of-month yet
  if (now.getDate() < start.getDate()) months -= 1;
  return Math.max(0, months);
}

function moviesWatchedTogether() {
  // The user names live in state._userAssets after login (set in
  // refreshUserAssetsLocal). Fall back to the two known users if the
  // map isn't populated yet for some reason.
  const all = state._userAssets
    ? Object.keys(state._userAssets)
    : ['Jaime', 'Mayck'];
  if (all.length < 2) return 0;
  return state.movies.filter(m => {
    const wb = Array.isArray(m.watched_by) ? m.watched_by : [];
    return all.every(u => wb.includes(u));
  }).length;
}

// Pelis + series donde a alguien le falta verla todavía — mismo criterio
// que el tab "Por ver" en la página de Pelis (no las del watchlist 0/2
// solamente sino TODAS donde algún usuario no la marcó). Si los dos
// criterios divergen, la tira del dashboard miente respecto al tab.
function moviesPending() {
  const userNames = state._userAssets
    ? Object.keys(state._userAssets)
    : ['Jaime', 'Mayck'];
  return state.movies.filter(m => {
    const wb = Array.isArray(m.watched_by) ? m.watched_by : [];
    if (userNames.length < 2) return wb.length === 0;
    return !userNames.every(u => wb.includes(u));
  }).length;
}

function countCheckedItems() {
  return state.notes.reduce((sum, n) => {
    if (!Array.isArray(n.checklist)) return sum;
    return sum + n.checklist.filter(it => it && it.done).length;
  }, 0);
}

// Update the "Metas checkeadas" tile in the dashboard stats widget
// without re-rendering the whole page. Called whenever a checklist
// item is toggled (from a card preview or from inside the editor).
function refreshChecklistStat() {
  const cell = document.querySelector('.stats-widget .stat-cell[data-stat="checked-goals"] .stat-value');
  if (cell) cell.textContent = String(countCheckedItems());
}

function renderRelationshipStats() {
  const featuredPhotos = state.photos.filter(p => p.featured).length;
  const checkedGoals = countCheckedItems();
  const pending = moviesPending();
  const months = monthsSince(RELATIONSHIP_START);
  const stats = [
    { key: 'featured-photos', label: 'Fotos destacadas', value: featuredPhotos },
    { key: 'checked-goals', label: 'Metas checkeadas', value: checkedGoals },
    { key: 'movies-pending', label: 'Pelis y series por ver', value: pending },
    { key: 'months', label: 'Meses juntos', value: months },
  ];
  return `
    <div class="stats-widget">
      ${stats.map(s => `
        <div class="stat-cell" data-stat="${s.key}">
          <div class="stat-value">${s.value}</div>
          <div class="stat-label">${escapeHtml(s.label)}</div>
        </div>
      `).join('')}
    </div>
  `;
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
// ----- Ambient blurred backdrop -----
// Two stacked <img> layers crossfade to avoid jarring transitions.
let bgPhotoActiveLayer = 0;
let bgPhotoLastPath = null;
function setBgPhoto(path) {
  // Only the photo mode uses the blurred backdrop. In color mode, skip.
  const cfg = getBgSetting();
  if (cfg.mode === 'color') return;
  if (!path || path === bgPhotoLastPath) return;
  bgPhotoLastPath = path;
  const layers = [$('#bg-photo-a'), $('#bg-photo-b')];
  if (!layers[0] || !layers[1]) return;
  const next = (bgPhotoActiveLayer + 1) % 2;
  const nextEl = layers[next];
  // The blurred backdrop is heavily blurred via CSS, so a small transform
  // is fine and saves a ton of bandwidth (full-res photos can be many MB).
  const url = publicImageUrl(path, { width: 800, quality: 60 });
  // Preload so the crossfade only happens once the image is ready
  const probe = new Image();
  probe.onload = () => {
    nextEl.src = url;
    nextEl.classList.add('active');
    layers[bgPhotoActiveLayer].classList.remove('active');
    bgPhotoActiveLayer = next;
  };
  probe.src = url;
}

// ----- Background mode (photo vs solid color) -----
// Persisted under state.settings.bg = { mode: 'photo'|'color', color: '#...' }.
// Also mirrored to localStorage so the inline FOUC-prevention script can
// apply the right mode before the first paint.
function getBgSetting() {
  const s = state.settings && state.settings.bg;
  if (s && (s.mode === 'photo' || s.mode === 'color' || s.mode === 'image')) {
    return {
      mode: s.mode,
      color: s.color || '#0a0a0c',
      image_path: s.image_path || null,
    };
  }
  return { mode: 'photo', color: '#0a0a0c', image_path: null };
}
function applyBgMode() {
  const cfg = getBgSetting();
  const prevMode = document.documentElement.dataset.bgMode;
  document.documentElement.dataset.bgMode = cfg.mode;

  // Clear all bg vars first; set the ones relevant to the current mode below.
  document.documentElement.style.removeProperty('--bg-color');
  document.documentElement.style.removeProperty('--bg-image');

  if (cfg.mode === 'color') {
    document.documentElement.style.setProperty('--bg-color', cfg.color);
  } else if (cfg.mode === 'image' && cfg.image_path) {
    const url = publicAssetUrl(cfg.image_path);
    document.documentElement.style.setProperty('--bg-image', `url("${url}")`);
  } else if (cfg.mode === 'photo') {
    // Switching back to photo mode — re-seed the blurred backdrop. Reset
    // bgPhotoLastPath so setBgPhoto doesn't bail thinking nothing changed.
    if (prevMode !== 'photo' && Array.isArray(state.photos) && state.photos.length) {
      bgPhotoLastPath = null;
      const ambient = state.photos.find(p => p.featured) || state.photos[0];
      if (ambient) setBgPhoto(ambient.storage_path);
    }
  }
  // Mirror to localStorage so the inline FOUC script can apply on the next
  // load (resolve to public URL when needed so it works without the SDK).
  try {
    const ls = { mode: cfg.mode, color: cfg.color };
    if (cfg.mode === 'image' && cfg.image_path) {
      ls.image_path = cfg.image_path;
      ls.image_url = publicAssetUrl(cfg.image_path);
    }
    localStorage.setItem('medusas:bg', JSON.stringify(ls));
  } catch {}
}

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
        // Photo widget stage is ~520px wide on desktop, ~360 on mobile.
        // 1000px transform covers 2x retina without slamming the network.
        `<img src="${escapeHtml(publicImageUrl(p.storage_path, { width: 1000 }))}" alt="${escapeHtml(p.caption || '')}" class="${i === 0 ? 'active' : ''}" loading="lazy" />`
      ).join('')}
      <div class="pw-dots">${modeLabel}</div>
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

  // Sync the ambient blurred backdrop with the first photo
  setBgPhoto(pool[0].storage_path);

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
      // Crossfade the ambient backdrop to match
      setBgPhoto(pool[i].storage_path);
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
        <button class="tag-chip tag-chip-all ${!filterTag ? 'active' : ''}" data-tag="">Todas</button>
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
  card.dataset.id = note.id;
  // Unique transition name so the browser can morph this card between
  // positions when the list re-renders (e.g., on pin/unpin).
  card.style.viewTransitionName = `note-${cssSafeId(note.id)}`;
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
    await togglePinWithTransition(async () => {
      note.pinned = next;
      await supabase.from('notes').update({ pinned: next }).eq('id', note.id);
      await router();
    });
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

  if (Array.isArray(note.checklist) && note.checklist.length) {
    const cl = document.createElement('div');
    cl.className = 'card-checklist';
    // Render up to 12 items. JS (fitCardChecklist) hides extras based
    // on the actual available card height so taller cards get to show
    // more items, shorter cards show fewer + "+N más".
    const renderLimit = Math.min(note.checklist.length, 12);
    note.checklist.slice(0, renderLimit).forEach((it, idx) => {
      const row = document.createElement('div');
      row.className = `cl-pv ${it.done ? 'is-done' : ''}`;
      row.innerHTML = `
        <button class="cl-check ${it.done ? 'is-done' : ''}" type="button" aria-label="${it.done ? 'Marcar como pendiente' : 'Marcar como hecho'}">
          <span class="material-symbols-outlined">${it.done ? 'check_box' : 'check_box_outline_blank'}</span>
        </button>
        <span class="cl-pv-text">${escapeHtml(it.text)}</span>
      `;
      const checkBtn = row.querySelector('.cl-check');
      checkBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const updated = (note.checklist || []).map((x, i) => i === idx ? { ...x, done: !x.done } : x);
        note.checklist = updated;
        try { await supabase.from('notes').update({ checklist: updated }).eq('id', note.id); } catch (err) { console.error('toggle checklist', err); }
        // Update icon in-place without re-rendering everything
        const nowDone = updated[idx].done;
        checkBtn.classList.toggle('is-done', nowDone);
        row.classList.toggle('is-done', nowDone);
        const span = checkBtn.querySelector('.material-symbols-outlined');
        if (span) span.textContent = nowDone ? 'check_box' : 'check_box_outline_blank';
        // Keep the "Metas checkeadas" stat card in sync
        refreshChecklistStat();
      });
      cl.appendChild(row);
    });
    // The "+N más" tail is added/updated by fitCardChecklist after
    // we know which items overflow. Start hidden.
    const more = document.createElement('div');
    more.className = 'cl-pv-more';
    more.style.display = 'none';
    cl.appendChild(more);
    body.appendChild(cl);
  }

  if (Array.isArray(note.images) && note.images.length) {
    const gallery = document.createElement('div');
    gallery.className = 'gallery';
    note.images.forEach(path => {
      const img = document.createElement('img');
      // Card gallery thumbnails render at 42x42, so 96px transform is plenty.
      img.src = publicImageUrl(path, { width: thumbWidth(96) });
      img.alt = ''; img.loading = 'lazy';
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
  // Compact checklist badge — shown next to the date so the user can
  // see at a glance whether a note has a checklist (and how far along
  // it is). The .card-checklist preview is hidden in list view, this
  // badge replaces it.
  let checklistBadge = '';
  if (Array.isArray(note.checklist) && note.checklist.length) {
    const total = note.checklist.length;
    const done = note.checklist.filter(it => it && it.done).length;
    checklistBadge = `<span class="checklist-badge ${done === total ? 'is-complete' : ''}"><span class="material-symbols-outlined">${done === total ? 'check_box' : 'check_box_outline_blank'}</span> ${done}/${total}</span>`;
  }
  meta.innerHTML = `<span>${fmtDateWithDay(note.updated_at || note.created_at)} · ${escapeHtml(note.created_by || '?')}</span>${checklistBadge}`;
  body.appendChild(meta);

  card.appendChild(body);
  card.addEventListener('click', () => openNoteEditor(note));
  card.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openNoteEditor(note); } });
  // Once the card is in the DOM and laid out, hide checklist items that
  // overflow the available card height and show a "+N más" tail.
  if (Array.isArray(note.checklist) && note.checklist.length) {
    requestAnimationFrame(() => fitCardChecklist(card, note));
  }
  return card;
}

// Hide checklist items that don't fit in the card's available height
// and update the "+N más" tail. Runs after layout. Re-evaluates on
// resize so taller cards (e.g. desktop with fewer columns) show more
// items dynamically.
function fitCardChecklist(card, note) {
  const cl = card.querySelector('.card-checklist');
  if (!cl) return;
  const body = card.querySelector('.body');
  if (!body) return;
  const items = Array.from(cl.querySelectorAll('.cl-pv'));
  let moreEl = cl.querySelector('.cl-pv-more');
  if (!items.length) return;

  const total = note.checklist.length;
  const rendered = items.length;
  const renderShortfall = total - rendered; // items not even rendered

  if (!moreEl) {
    moreEl = document.createElement('div');
    moreEl.className = 'cl-pv-more';
    cl.appendChild(moreEl);
  }

  const updateBadge = (hiddenRendered) => {
    const hiddenTotal = renderShortfall + hiddenRendered;
    if (hiddenTotal > 0) {
      moreEl.style.display = '';
      moreEl.textContent = `+${hiddenTotal} más`;
    } else {
      moreEl.style.display = 'none';
    }
  };

  const apply = () => {
    // Reset to "all visible" so we measure naturally
    items.forEach(it => { it.style.display = ''; });
    // Set initial badge (visible only if we couldn't even render every item)
    updateBadge(0);
    let hiddenRendered = 0;
    // Hide items from the end until the body no longer overflows
    for (let i = items.length - 1; i >= 0 && body.scrollHeight > body.clientHeight + 1; i--) {
      items[i].style.display = 'none';
      hiddenRendered += 1;
      updateBadge(hiddenRendered);
    }
  };

  apply();
  // Re-fit when the card's size changes (e.g., responsive column count).
  if (typeof ResizeObserver !== 'undefined') {
    if (card._fitObs) { try { card._fitObs.disconnect(); } catch {} }
    card._fitObs = new ResizeObserver(() => apply());
    card._fitObs.observe(card);
  }
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
        <h1>Música y podcasts</h1>
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
      <button class="tag-chip tag-chip-all ${filter === 'all' ? 'active' : ''}" data-f="all">Todo <span class="count">${filterCounts.all}</span></button>
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
  card.style.viewTransitionName = `media-${cssSafeId(m.id)}`;
  if (m.featured) card.classList.add('featured');
  card.setAttribute('role', 'button');
  card.setAttribute('tabindex', '0');

  if (isUnread(m)) {
    const dot = document.createElement('span');
    dot.className = 'unread-dot';
    card.appendChild(dot);
  }

  // Card actions: feature + edit. (We dropped pin for music — featured
  // is what now drives the "Destacadas" strip at the top of /musica.)
  const actions = document.createElement('div');
  actions.className = 'card-actions';
  actions.innerHTML = `
    <button title="Editar" data-action="edit"><span class="material-symbols-outlined">edit</span></button>
    <button title="${m.featured ? 'Quitar de destacadas' : 'Destacar'}" class="${m.featured ? 'is-on' : ''}" data-action="feature"><span class="material-symbols-outlined ${m.featured ? 'filled' : ''}">star</span></button>
  `;
  actions.addEventListener('click', async (e) => {
    e.stopPropagation();
    const btn = e.target.closest('button');
    if (!btn) return;
    if (btn.dataset.action === 'edit') openMediaEditor(m);
    if (btn.dataset.action === 'feature') {
      const next = !m.featured;
      await togglePinWithTransition(async () => {
        m.featured = next;
        await supabase.from('media').update({ featured: next }).eq('id', m.id);
        await router();
      });
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
  h.textContent = displayMediaTitle(m);
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
const SIN_ALBUM_KEY = '_sin_album_';
const ALBUM_TILE_PX = 160 + 8; // tile width + gap

// How many photos fit in one row of the album strip (based on viewport / sidebar).
function computeAlbumPreviewCount() {
  const w = window.innerWidth;
  const sidebarVisible = w > 760;
  const sidebar = sidebarVisible ? 240 : 0;
  // page padding (main.content) + a little safety margin
  const sidePadding = sidebarVisible ? 80 : 32;
  const content = Math.max(320, w - sidebar - sidePadding);
  return Math.max(2, Math.floor(content / ALBUM_TILE_PX));
}

// How many photos the album hero mosaic should render. Wide viewports
// get extra columns of stacked tiles so they don't end up with a half
// empty mosaic next to the hero. Counts pair with the CSS media queries
// on .album-mosaic.mosaic-hero — every step adds one extra column (= 2
// stacked tiles), so the slots progress 3 → 5 → 7.
function computeMosaicSlots() {
  const w = window.innerWidth;
  if (w >= 1500) return 7;
  if (w >= 1200) return 5;
  return 3;
}

function albumSlugFor(name) {
  return name ? encodeURIComponent(name) : SIN_ALBUM_KEY;
}
function albumNameFromSlug(slug) {
  if (slug === SIN_ALBUM_KEY) return '';
  try { return decodeURIComponent(slug); } catch { return slug; }
}

function renderFotos(root) {
  const filterTag = state.filterTag.fotos;
  // If a tag is active, scope all the views (featured + albums) to photos
  // that include the tag. Untagged photos use state.photos.
  const scoped = filterTag
    ? state.photos.filter(p => Array.isArray(p.tags) && p.tags.includes(filterTag))
    : state.photos;
  const featured = scoped.filter(p => p.featured);

  // Group photos by album. '' (empty string) is the "Sin álbum" bucket, treated as a regular album.
  const byAlbum = new Map();
  for (const p of scoped) {
    const key = p.album || '';
    if (!byAlbum.has(key)) byAlbum.set(key, []);
    byAlbum.get(key).push(p);
  }
  const totalAlbums = byAlbum.size;

  // Build the unique tag set across ALL photos (so the filter row stays
  // consistent regardless of the current filter).
  const tagCounts = new Map();
  state.photos.forEach(p => (p.tags || []).forEach(t => {
    tagCounts.set(t, (tagCounts.get(t) || 0) + 1);
  }));
  const sortedTags = Array.from(tagCounts.entries()).sort((a, b) => b[1] - a[1]);

  root.innerHTML = `
    <div class="page-head">
      <div>
        <h1>Fotos</h1>
        <div class="sub">${scoped.length} foto${scoped.length === 1 ? '' : 's'} · ${totalAlbums} álbum${totalAlbums === 1 ? '' : 'es'}</div>
      </div>
      <div class="actions">
        <button class="btn primary" id="upload-btn">+ Subir fotos</button>
      </div>
    </div>
    ${sortedTags.length ? `
      <div class="tag-filter-row" id="photos-tag-filter">
        <button class="tag-chip tag-chip-all ${!filterTag ? 'active' : ''}" data-tag="">Todas</button>
        ${sortedTags.map(([tag, count]) => `
          <button class="tag-chip ${filterTag === tag ? 'active' : ''}" data-tag="${escapeHtml(tag)}" style="--tag-color: ${tagColor(tag)};">
            #${escapeHtml(tag)} <span class="count">${count}</span>
          </button>
        `).join('')}
      </div>
    ` : ''}
    <div class="featured-label" ${featured.length ? '' : 'hidden'}><span class="material-symbols-outlined">star</span> Destacadas</div>
    <div class="featured-strip" id="featured-strip" ${featured.length ? '' : 'hidden'}></div>
    <div id="photo-sections"></div>
  `;

  $('#upload-btn').addEventListener('click', openPhotoUpload);

  // Tag filter wiring
  const tagRow = $('#photos-tag-filter');
  if (tagRow) {
    tagRow.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-tag]');
      if (!b) return;
      state.filterTag.fotos = b.dataset.tag || null;
      renderFotos(root);
    });
  }

  if (featured.length) {
    const strip = $('#featured-strip');
    featured.forEach((p, i) => strip.appendChild(renderPhoto(p, featured, i)));
  }

  const container = $('#photo-sections');
  if (!scoped.length) {
    container.innerHTML = filterTag
      ? `<div class="empty">No hay fotos con la etiqueta #${escapeHtml(filterTag)}.</div>`
      : '<div class="empty">Aún no hay fotos. Sube las primeras con el botón "Subir fotos".</div>';
    return;
  }

  // Albums alphabetically. "Sin álbum" (empty key) at the end.
  const albumKeys = Array.from(byAlbum.keys()).sort((a, b) => {
    if (a === '' && b !== '') return 1;
    if (b === '' && a !== '') return -1;
    return a.localeCompare(b);
  });
  for (const key of albumKeys) {
    container.appendChild(renderAlbumSection(key, byAlbum.get(key)));
  }
}

function renderAlbumDetail(root, slug) {
  const albumName = albumNameFromSlug(slug);
  const photos = state.photos.filter(p => (p.album || '') === albumName);
  const displayName = albumName || 'Sin álbum';
  const isUnnamed = !albumName;

  root.innerHTML = `
    <div class="album-detail-head">
      <a class="back-link" href="#/fotos"><span class="material-symbols-outlined">arrow_back</span> Fotos</a>
      <div class="album-detail-title">
        <h1>
          ${escapeHtml(displayName)}
          <span class="album-menu-wrap">
            <button class="album-menu-btn" type="button" title="Opciones del álbum" aria-label="Opciones del álbum">
              <span class="material-symbols-outlined">keyboard_arrow_down</span>
            </button>
            <div class="album-menu-popover">
              <button data-action="rename"><span class="material-symbols-outlined">edit</span>${isUnnamed ? 'Asignar nombre…' : 'Renombrar álbum'}</button>
              <button data-action="move"><span class="material-symbols-outlined">drive_file_move</span>Mover a otro álbum…</button>
              <button data-action="delete" class="danger"><span class="material-symbols-outlined">delete</span>${isUnnamed ? 'Borrar estas fotos' : 'Borrar álbum'}</button>
            </div>
          </span>
        </h1>
      </div>
      <div class="actions">
        ${photos.length ? `<button class="btn icon-pill" id="view-all-btn" type="button" title="Ver en presentación" aria-label="Ver en presentación"><span class="material-symbols-outlined">slideshow</span></button>` : ''}
        <button class="btn icon-pill primary" id="upload-btn" type="button" title="Subir fotos" aria-label="Subir fotos"><span class="material-symbols-outlined">add</span></button>
      </div>
    </div>
    <div class="photo-grid" id="photo-grid"></div>
  `;

  $('#upload-btn').addEventListener('click', openPhotoUpload);
  if (photos.length) {
    $('#view-all-btn').addEventListener('click', () => openLightbox(photos, 0));
  }

  wireAlbumMenu($('.album-detail-title'), albumName, photos);

  const grid = $('#photo-grid');
  if (!photos.length) {
    grid.innerHTML = '<div class="empty">Este álbum está vacío.</div>';
    return;
  }
  photos.forEach((p, i) => grid.appendChild(renderPhoto(p, photos, i)));
}

function renderAlbumSection(name, photos) {
  const isUnnamed = !name;
  const displayName = isUnnamed ? 'Sin álbum' : name;
  const slug = albumSlugFor(name);

  // Hero mosaic layout (ref 4): 1 large photo + a column of stacked tiles
  // on the right. The slot count grows with viewport so wide screens
  // don't end up with a half-empty mosaic. The last visible tile gets a
  // "+N · Ver todas" overlay when there are still more photos in the
  // album beyond what fits.
  const layout = photos.length === 1 ? 'single' : photos.length === 2 ? 'pair' : 'hero';
  const heroSlots = computeMosaicSlots();
  const visibleCount = layout === 'hero'
    ? Math.min(heroSlots, photos.length)
    : photos.length;
  const visible = photos.slice(0, visibleCount);
  const more = photos.length - visibleCount;

  // Meta line: month range (from the photos' created_at) and total count.
  const meta = albumMetaLabel(photos);

  const section = document.createElement('div');
  section.className = 'album-section';
  section.innerHTML = `
    <div class="album-section-head">
      <span class="rule"></span>
      <div class="title-block">
        <h2>${escapeHtml(displayName)}</h2>
        ${meta ? `<div class="album-meta">${escapeHtml(meta)}</div>` : ''}
      </div>
      <span class="rule"></span>
      <span class="album-menu-wrap">
        <button class="album-menu-btn" type="button" title="Opciones del álbum" aria-label="Opciones del álbum">
          <span class="material-symbols-outlined">more_horiz</span>
        </button>
        <div class="album-menu-popover">
          <button data-action="rename"><span class="material-symbols-outlined">edit</span>${isUnnamed ? 'Asignar nombre…' : 'Renombrar álbum'}</button>
          <button data-action="move"><span class="material-symbols-outlined">drive_file_move</span>Mover a otro álbum…</button>
          <button data-action="delete" class="danger"><span class="material-symbols-outlined">delete</span>${isUnnamed ? 'Borrar estas fotos' : 'Borrar álbum'}</button>
        </div>
      </span>
    </div>
    <div class="album-mosaic mosaic-${layout}"></div>
  `;
  const mosaic = section.querySelector('.album-mosaic');
  visible.forEach((p, i) => {
    // gridSlot tells renderPhoto to leave the tile's aspect alone so the
    // CSS grid's hero/stack layout wins — otherwise every tile would try
    // to take its own photo's aspect and break the composition.
    const tile = renderPhoto(p, photos, i, { gridSlot: true });
    if (layout === 'hero' && i === 0) tile.classList.add('hero');
    mosaic.appendChild(tile);
  });
  if (more > 0) {
    // Overlay the last visible tile with a "+N · Ver todas" pill instead
    // of replacing it — keeps the photo recognizable as a preview.
    const lastTile = mosaic.lastElementChild;
    const moreEl = document.createElement('a');
    moreEl.className = 'mosaic-more';
    moreEl.href = `#/fotos/album/${slug}`;
    moreEl.innerHTML = `<span>+${more} · Ver todas</span>`;
    lastTile.appendChild(moreEl);
  }

  wireAlbumMenu(section, name, photos);
  return section;
}

// "MAY 2026 · 12 FOTOS" — small-caps subtitle under the album title.
// If the album spans multiple months, we show the range; otherwise just
// the single month + year.
function albumMetaLabel(photos) {
  if (!photos.length) return '';
  const dates = photos
    .map(p => p.created_at)
    .filter(Boolean)
    .map(d => new Date(d))
    .sort((a, b) => a - b);
  let when = '';
  if (dates.length) {
    const first = dates[0];
    const last = dates[dates.length - 1];
    const fmt = (d) => d.toLocaleDateString('es', { month: 'long', year: 'numeric' });
    when = (first.getMonth() === last.getMonth() && first.getFullYear() === last.getFullYear())
      ? fmt(first)
      : `${fmt(first)} – ${fmt(last)}`;
  }
  const count = `${photos.length} foto${photos.length === 1 ? '' : 's'}`;
  return when ? `${when} · ${count}` : count;
}

// Wires the ellipsis menu of an album (used in both renderAlbumSection and renderAlbumDetail).
function wireAlbumMenu(rootEl, name, photos) {
  const menuBtn = rootEl.querySelector('.album-menu-btn');
  const menu = rootEl.querySelector('.album-menu-popover');
  if (!menuBtn || !menu) return;
  const isUnnamed = !name;
  const syncOpenClass = () => menuBtn.classList.toggle('is-open', menu.classList.contains('open'));
  menuBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    document.querySelectorAll('.album-menu-popover.open').forEach(el => {
      if (el !== menu) {
        el.classList.remove('open');
        const sib = el.parentElement && el.parentElement.querySelector('.album-menu-btn');
        if (sib) sib.classList.remove('is-open');
      }
    });
    menu.classList.toggle('open');
    syncOpenClass();
  });
  document.addEventListener('click', () => {
    menu.classList.remove('open');
    syncOpenClass();
  });

  menu.addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    e.stopPropagation();
    menu.classList.remove('open');
    if (btn.dataset.action === 'rename') openAlbumEditModal('rename', name, photos);
    if (btn.dataset.action === 'move') openAlbumEditModal('move', name, photos);
    if (btn.dataset.action === 'delete') {
      const ok = await uiConfirm(
        `¿Borrar ${isUnnamed ? `las ${photos.length} fotos sin álbum` : `el álbum "${name}" y sus ${photos.length} foto${photos.length === 1 ? '' : 's'}`}?\n\nEsta acción no se puede deshacer.`,
        { title: 'Borrar álbum', confirmLabel: 'Borrar', danger: true }
      );
      if (!ok) return;
      await deletePhotosBatch(photos);
    }
  });
}

// ============================================================
// Album edit modal (rename / move)
// ============================================================
const dlgAlbumEdit = $('#dlg-album-edit');
const albumEditState = { mode: null, source: null, photos: null };

function openAlbumEditModal(mode, sourceName, photos) {
  albumEditState.mode = mode; // 'rename' | 'move'
  albumEditState.source = sourceName || '';
  albumEditState.photos = photos;

  const isUnnamed = !sourceName;
  const title = $('#album-edit-title');
  const sub = $('#album-edit-sub');
  const label = $('#album-edit-label');
  const input = $('#album-edit-input');
  const existingWrap = $('#album-edit-existing');
  const list = $('#album-edit-list');
  const saveBtn = $('#album-edit-save');

  if (mode === 'rename') {
    title.textContent = isUnnamed ? 'Asignar nombre al álbum' : `Renombrar "${sourceName}"`;
    sub.textContent = `${photos.length} foto${photos.length === 1 ? '' : 's'}`;
    label.textContent = 'Nombre del álbum';
    input.value = isUnnamed ? '' : sourceName;
    existingWrap.hidden = true;
    saveBtn.textContent = isUnnamed ? 'Asignar' : 'Renombrar';
  } else {
    // move (could be 'move' for whole album, or 'move-single' for one photo)
    const isSingle = mode === 'move-single';
    title.textContent = isSingle
      ? 'Mover esta foto a otro álbum'
      : (isUnnamed ? 'Mover fotos sin álbum' : `Mover "${sourceName}" a otro álbum`);
    if (isSingle) {
      sub.textContent = `Actualmente: ${sourceName || 'Sin álbum'}`;
    } else {
      sub.textContent = `${photos.length} foto${photos.length === 1 ? '' : 's'}. Si eliges un álbum existente, se fusionan.`;
    }
    label.textContent = 'Álbum destino';
    input.value = '';
    saveBtn.textContent = 'Mover';
    const others = Array.from(new Set(state.photos.map(p => p.album || '').filter(Boolean)))
      .filter(a => a !== sourceName).sort();
    // For move-single, also offer "Sin álbum" as a destination option
    const options = isSingle && sourceName
      ? ['', ...others]
      : others;
    if (options.length) {
      existingWrap.hidden = false;
      list.innerHTML = options.map(a => `<button type="button" data-album="${escapeHtml(a)}">
        <span class="material-symbols-outlined">${a ? 'folder' : 'folder_off'}</span>${escapeHtml(a || 'Sin álbum')}
      </button>`).join('');
    } else {
      existingWrap.hidden = true;
      list.innerHTML = '';
    }
  }

  $('#album-edit-status').textContent = '';
  dlgAlbumEdit.showModal();
  setTimeout(() => input.focus(), 0);
}

$('#album-edit-list').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-album]');
  if (!b) return;
  $('#album-edit-input').value = b.dataset.album;
});

$('#album-edit-save').addEventListener('click', async () => {
  const newName = $('#album-edit-input').value.trim();
  const { source, photos, mode } = albumEditState;
  // Rename requires a non-empty name. Move modes allow empty (= "Sin álbum").
  if (mode === 'rename' && !newName) {
    setStatus($('#album-edit-status'), 'Escribe un nombre', true);
    return;
  }
  if (newName === source) { dlgAlbumEdit.close(); return; }
  const ids = photos.map(p => p.id);
  setStatus($('#album-edit-status'), 'Guardando…');
  try {
    const { error } = await supabase.from('photos').update({ album: newName }).in('id', ids);
    if (error) throw error;
    // Mutate local state so the close+rerender is instant
    for (const p of photos) p.album = newName;
    dlgAlbumEdit.close();
    // If lightbox is open and we just moved its current photo, re-render lightbox too
    if (dlgLightbox.open) {
      lightboxState.dirty = true;
      renderLightbox();
    } else {
      rerenderCurrentPage();
    }
  } catch (e) { setStatus($('#album-edit-status'), `Error: ${e.message || e}`, true); }
});

// Allow Enter in the input to save
$('#album-edit-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); $('#album-edit-save').click(); }
});

async function deletePhotosBatch(photos) {
  if (!photos.length) return;
  const ids = new Set(photos.map(p => p.id));
  const paths = photos.map(p => p.storage_path).filter(Boolean);
  try {
    if (paths.length) {
      try { await supabase.storage.from(BUCKET).remove(paths); } catch (e) { console.warn('storage cleanup failed', e); }
    }
    const { error } = await supabase.from('photos').delete().in('id', Array.from(ids));
    if (error) throw error;
    // Update local state and re-render synchronously (no extra fetch)
    state.photos = state.photos.filter(p => !ids.has(p.id));
    // If we're inside an album detail page that's now empty, bounce to /fotos
    if (state.route.startsWith('#/fotos/album/')) {
      const slug = state.route.slice('#/fotos/album/'.length);
      const albumName = albumNameFromSlug(slug);
      const remaining = state.photos.filter(p => (p.album || '') === albumName);
      if (!remaining.length) { location.hash = '#/fotos'; return; }
    }
    rerenderCurrentPage();
  } catch (e) {
    uiAlert('Error al borrar: ' + (e.message || e), { title: 'Error' });
  }
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
    <img src="${escapeHtml(publicImageUrl(cover.storage_path, { width: thumbWidth(240) }))}" alt="${escapeHtml(name)}" loading="lazy" />
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

function renderPhoto(p, list, index, opts = {}) {
  const tile = document.createElement('div');
  tile.className = 'photo';
  tile.setAttribute('role', 'button');
  tile.setAttribute('tabindex', '0');
  // Grid tiles are ~160px square (dashboard strip + photos page grid).
  // 360px transform covers retina without loading the full original.
  const src = publicImageUrl(p.storage_path, { width: thumbWidth(180) });
  tile.innerHTML = `<img src="${escapeHtml(src)}" alt="${escapeHtml(p.caption || '')}" loading="lazy" />` +
    (p.caption ? `<div class="photo-caption">${escapeHtml(p.caption)}</div>` : '');

  // Masonry-style sizing for free-flow contexts (strips, scroll rows):
  // copy the photo's natural aspect to the tile so cover fills exactly
  // without crop or letterbox. For fixed-grid contexts (the album mosaic
  // hero layout) the parent grid already decides each cell's shape, so
  // skip this and let the cell + cover do the cropping.
  if (!opts.gridSlot) {
    const imgEl = tile.querySelector('img');
    const setAspectFromImg = () => {
      if (imgEl.naturalWidth && imgEl.naturalHeight) {
        tile.style.aspectRatio = `${imgEl.naturalWidth} / ${imgEl.naturalHeight}`;
      }
    };
    if (imgEl.complete) setAspectFromImg();
    else imgEl.addEventListener('load', setAspectFromImg, { once: true });
  }

  // Quick-feature star button (top-right). Visible on hover; persistent when featured.
  const star = document.createElement('button');
  star.type = 'button';
  star.className = `photo-star ${p.featured ? 'is-on' : ''}`;
  star.title = p.featured ? 'Quitar de destacadas' : 'Destacar';
  star.setAttribute('aria-label', star.title);
  star.innerHTML = `<span class="material-symbols-outlined ${p.featured ? 'filled' : ''}">star</span>`;
  star.addEventListener('click', async (e) => {
    e.stopPropagation();
    e.preventDefault();
    p.featured = !p.featured;
    star.classList.toggle('is-on', p.featured);
    const icon = star.querySelector('.material-symbols-outlined');
    if (icon) icon.classList.toggle('filled', p.featured);
    star.title = p.featured ? 'Quitar de destacadas' : 'Destacar';
    star.setAttribute('aria-label', star.title);
    // Keep the destacadas preview strip in sync without a full reload
    syncFeaturedStrip();
    try {
      await supabase.from('photos').update({ featured: p.featured }).eq('id', p.id);
    } catch (err) { console.error('toggle featured', err); }
  });
  tile.appendChild(star);

  // Other indicators (pinned). The featured state is now reflected on the star itself.
  if (p.pinned) {
    const indicator = document.createElement('div');
    indicator.className = 'photo-indicator';
    indicator.innerHTML = `<span title="Anclada"><span class="material-symbols-outlined" style="font-size:14px;">keep</span></span>`;
    tile.appendChild(indicator);
  }

  if (isUnread(p)) {
    const dot = document.createElement('span');
    dot.className = 'unread-dot';
    tile.appendChild(dot);
  }

  tile.addEventListener('click', () => openLightbox(list, index));
  tile.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openLightbox(list, index); } });
  return tile;
}

// Refresh the "Destacadas" strip at the top of the Fotos page (or the
// dashboard "Fotos destacadas" section) without rebuilding the whole
// page. Called whenever the featured flag of a photo toggles via the
// star button on a tile.
function syncFeaturedStrip() {
  const strip = document.getElementById('featured-strip');
  if (!strip) return;
  const featured = state.photos.filter(p => p.featured);
  // If the strip's host wrapper has a wrapper label, hide it when empty
  const label = strip.previousElementSibling;
  if (!featured.length) {
    strip.innerHTML = '';
    if (label && label.classList.contains('featured-label')) label.hidden = true;
    strip.hidden = true;
    return;
  }
  strip.hidden = false;
  if (label && label.classList.contains('featured-label')) label.hidden = false;
  strip.innerHTML = '';
  featured.forEach((p, i) => strip.appendChild(renderPhoto(p, featured, i)));
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
        <button class="tag-chip tag-chip-all ${!filterTag ? 'active' : ''}" data-tag="">Todos</button>
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
  media: 'Música y podcasts recientes',
  photos: 'Fotos recientes',
  movies: 'Pelis y Series recientes',
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
  const bg = getBgSetting();
  const order = getDashboardOrder();
  const presets = ['#0a0a0c', '#15151a', '#1a1142', '#1e3a5f', '#3a1d4a', '#0d2616', '#f5f4ee'];

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
      <h3>Fondo de la app</h3>
      <div class="sub" style="color:var(--text-dim);font-size:.82rem;">Elige cómo quieres que se vea el fondo.</div>
      <div class="opts" id="cfg-bg-mode">
        <button data-mode="photo" class="${bg.mode === 'photo' ? 'active' : ''}"><span class="material-symbols-outlined">photo_library</span> Adaptativo (fotos destacadas)</button>
        <button data-mode="color" class="${bg.mode === 'color' ? 'active' : ''}"><span class="material-symbols-outlined">palette</span> Color sólido</button>
        <button data-mode="image" class="${bg.mode === 'image' ? 'active' : ''}"><span class="material-symbols-outlined">image</span> Imagen</button>
      </div>
      <div class="bg-color-row" id="cfg-bg-color-row" ${bg.mode === 'color' ? '' : 'hidden'}>
        <label class="bg-picker-label">
          <input type="color" id="cfg-bg-color" value="${bg.color}" />
          <span class="bg-color-value">${bg.color}</span>
        </label>
        <div class="bg-presets" id="cfg-bg-presets">
          ${presets.map(c => `<button type="button" class="bg-preset ${c.toLowerCase() === bg.color.toLowerCase() ? 'is-active' : ''}" data-c="${c}" style="background:${c}" aria-label="${c}"></button>`).join('')}
        </div>
      </div>
      <div class="bg-image-row" id="cfg-bg-image-row" ${bg.mode === 'image' ? '' : 'hidden'}>
        <div class="bg-image-preview" id="cfg-bg-image-preview">
          ${bg.image_path ? `<img src="${escapeHtml(publicAssetUrl(bg.image_path))}" alt="" />` : '<div class="bg-image-empty"><span class="material-symbols-outlined">image</span></div>'}
        </div>
        <div class="bg-image-actions">
          <label class="btn">
            <span class="material-symbols-outlined">upload</span>
            ${bg.image_path ? 'Cambiar imagen' : 'Subir imagen'}
            <input type="file" id="cfg-bg-image-file" accept="image/*" hidden />
          </label>
          ${bg.image_path ? '<button class="btn danger" id="cfg-bg-image-remove" type="button"><span class="material-symbols-outlined">delete</span> Quitar</button>' : ''}
        </div>
      </div>
      <span class="status" id="cfg-bg-status" style="margin-top:.5rem;display:inline-block;"></span>
    </div>
  `;

  // ----- Bg mode toggle -----
  const bgColorRow = $('#cfg-bg-color-row');
  const bgImageRow = $('#cfg-bg-image-row');
  const bgColorInput = $('#cfg-bg-color');
  const bgColorValue = $('.bg-color-value', bgColorRow);
  const bgFileInput = $('#cfg-bg-image-file');

  const setActiveBgPreset = (color) => {
    $$('#cfg-bg-presets .bg-preset').forEach(p => {
      p.classList.toggle('is-active', (p.dataset.c || '').toLowerCase() === color.toLowerCase());
    });
  };

  const persistBg = async (next) => {
    setStatus($('#cfg-bg-status'), 'Guardando…');
    await saveSetting('bg', next);
    setStatus($('#cfg-bg-status'), 'Guardado ✓');
  };

  $('#cfg-bg-mode').addEventListener('click', async (e) => {
    const b = e.target.closest('button[data-mode]');
    if (!b) return;
    $$('#cfg-bg-mode button').forEach(x => x.classList.toggle('active', x === b));
    const mode = b.dataset.mode;
    bgColorRow.hidden = mode !== 'color';
    bgImageRow.hidden = mode !== 'image';
    const next = { mode, color: bgColorInput.value || '#0a0a0c', image_path: bg.image_path || null };
    await persistBg(next);
  });

  bgColorInput.addEventListener('input', (e) => {
    const color = e.target.value;
    bgColorValue.textContent = color;
    setActiveBgPreset(color);
    // Apply live for instant preview, but debounce DB writes
    document.documentElement.dataset.bgMode = 'color';
    document.documentElement.style.setProperty('--bg-color', color);
    clearTimeout(bgColorInput._t);
    bgColorInput._t = setTimeout(() => persistBg({ mode: 'color', color, image_path: null }), 350);
  });

  $('#cfg-bg-presets').addEventListener('click', async (e) => {
    const b = e.target.closest('button.bg-preset');
    if (!b) return;
    const color = b.dataset.c;
    bgColorInput.value = color;
    bgColorValue.textContent = color;
    setActiveBgPreset(color);
    await persistBg({ mode: 'color', color, image_path: null });
  });

  // ----- Bg image upload -----
  if (bgFileInput) {
    bgFileInput.addEventListener('change', async (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      if (!file.type.startsWith('image/')) {
        setStatus($('#cfg-bg-status'), 'El archivo no es una imagen', true);
        return;
      }
      setStatus($('#cfg-bg-status'), 'Subiendo…');
      try {
        const path = await uploadAssetFile(file, 'app-bg');
        const next = { mode: 'image', color: bgColorInput.value || '#0a0a0c', image_path: path };
        await saveSetting('bg', next);
        setStatus($('#cfg-bg-status'), 'Imagen aplicada ✓');
        // Refresh the card so the preview + Remove button show up
        renderConfigTab(body);
      } catch (err) {
        console.error('bg upload', err);
        setStatus($('#cfg-bg-status'), 'Error al subir: ' + (err.message || err), true);
      }
    });
  }
  const bgRemoveBtn = $('#cfg-bg-image-remove');
  if (bgRemoveBtn) {
    bgRemoveBtn.addEventListener('click', async () => {
      // Best-effort: also remove the file from storage
      if (bg.image_path) {
        try { await supabase.storage.from(APP_ASSETS_BUCKET).remove([bg.image_path]); } catch {}
      }
      await saveSetting('bg', { mode: 'image', color: bgColorInput.value || '#0a0a0c', image_path: null });
      renderConfigTab(body);
    });
  }

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
    if (!(await uiConfirm('¿Quitar tu avatar?', { title: 'Quitar avatar', confirmLabel: 'Quitar', danger: true }))) return;
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
    if (!(await uiConfirm('¿Quitar tu imagen del login?', { title: 'Quitar imagen', confirmLabel: 'Quitar', danger: true }))) return;
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
    if (!(await uiConfirm('¿Quitar la foto por defecto?', { title: 'Quitar foto', confirmLabel: 'Quitar', danger: true }))) return;
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
  links: [], images: [], tags: [], pinned: false, checklist: [],
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
  noteDraft.checklist = Array.isArray(note?.checklist)
    ? note.checklist.map(it => ({ text: String(it.text || ''), done: !!it.done }))
    : [];

  $('#note-title-input').value = noteDraft.title;
  $('#note-plain').value = noteDraft.content;
  renderNoteLinkChips();
  renderNoteImagePreviews();
  renderNoteChecklist();
  renderNoteTags();
  renderNoteTagSuggestions('');
  $('#note-tag-input').value = '';
  $('#note-status').textContent = '';
  $('#dlg-note-title').textContent = note ? 'Editar nota' : 'Nueva nota';
  $('#note-save').textContent = note ? 'Actualizar nota' : 'Guardar nota';
  $('#note-delete').hidden = !note;
  dlgNote.showModal();
  setTimeout(() => $('#note-title-input').focus(), 0);
  // Size the body textarea to fit its content. Capped to ~70vh via CSS
  // so long notes don't force a tiny textbox with internal scroll.
  requestAnimationFrame(() => autoGrowTextarea($('#note-plain')));

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

// Resize a <textarea> so its visible height matches the content height
// (CSS max-height still caps it). Called when the note editor opens and
// on every keystroke so long notes don't trap the user in a small box.
function autoGrowTextarea(textarea) {
  if (!textarea) return;
  textarea.style.height = 'auto';
  const target = textarea.scrollHeight;
  // Add a tiny buffer to avoid an unnecessary scrollbar on browsers
  // that round scrollHeight oddly.
  textarea.style.height = (target + 2) + 'px';
}

// Wire the auto-grow listener once on the live textarea (idempotent).
(function wireNoteTextareaAutoGrow() {
  const ta = document.getElementById('note-plain');
  if (!ta || ta.dataset.autogrow) return;
  ta.dataset.autogrow = '1';
  ta.addEventListener('input', () => autoGrowTextarea(ta));
})();

function renderNoteImagePreviews() {
  const root = $('#note-images');
  root.innerHTML = '';
  noteDraft.images.forEach((path, i) => {
    const thumb = document.createElement('div');
    thumb.className = 'thumb';
    thumb.innerHTML = `<img src="${escapeHtml(publicImageUrl(path, { width: thumbWidth(120) }))}" alt="" /><button class="remove" type="button" aria-label="Quitar">×</button>`;
    thumb.querySelector('button.remove').addEventListener('click', async () => {
      try { await supabase.storage.from(BUCKET).remove([path]); } catch {}
      noteDraft.images.splice(i, 1); renderNoteImagePreviews();
    });
    root.appendChild(thumb);
  });
}

// ---- Checklist editor inside the note dialog -----------------------------
function renderNoteChecklist() {
  const root = $('#note-checklist');
  if (!root) return;
  root.innerHTML = '';
  if (!noteDraft.checklist.length) return;
  noteDraft.checklist.forEach((item, i) => {
    const row = document.createElement('div');
    row.className = 'cl-row';
    row.dataset.index = String(i);
    row.innerHTML = `
      <span class="cl-grip" aria-label="Arrastrar para reordenar" title="Arrastrar para reordenar">
        <span class="material-symbols-outlined">drag_indicator</span>
      </span>
      <button class="cl-check ${item.done ? 'is-done' : ''}" type="button" aria-label="${item.done ? 'Marcar como pendiente' : 'Marcar como hecho'}">
        <span class="material-symbols-outlined">${item.done ? 'check_box' : 'check_box_outline_blank'}</span>
      </button>
      <input class="cl-text" type="text" value="${escapeHtml(item.text)}" placeholder="Elemento de la lista" maxlength="200" />
      <button class="cl-del" type="button" aria-label="Quitar">
        <span class="material-symbols-outlined">close</span>
      </button>
    `;
    const check = row.querySelector('.cl-check');
    const text = row.querySelector('.cl-text');
    const del = row.querySelector('.cl-del');
    const grip = row.querySelector('.cl-grip');

    // Pointer-events based reorder — works for both mouse and touch.
    // The grip is the only handle; drag from anywhere else is ignored
    // so the user can still select text inside the input.
    let activePointer = null;
    const root = $('#note-checklist');
    const onPointerMove = (e) => {
      if (activePointer == null || e.pointerId !== activePointer) return;
      e.preventDefault();
      const el = document.elementFromPoint(e.clientX, e.clientY);
      const target = el?.closest('.cl-row');
      // Highlight the row under the pointer (skip the source itself)
      $$('#note-checklist .cl-row').forEach(r => r.classList.toggle('cl-drop-target', r === target && r !== row));
    };
    const onPointerUp = (e) => {
      if (activePointer == null || e.pointerId !== activePointer) return;
      try { grip.releasePointerCapture(activePointer); } catch {}
      $$('#note-checklist .cl-row').forEach(r => r.classList.remove('cl-drop-target'));
      row.classList.remove('cl-dragging');
      const el = document.elementFromPoint(e.clientX, e.clientY);
      const target = el?.closest('.cl-row');
      if (target && target !== row && root.contains(target)) {
        const to = Number(target.dataset.index);
        const from = Number(row.dataset.index);
        if (!Number.isNaN(to) && !Number.isNaN(from) && from !== to) {
          const [moved] = noteDraft.checklist.splice(from, 1);
          noteDraft.checklist.splice(to, 0, moved);
          renderNoteChecklist();
        }
      }
      grip.removeEventListener('pointermove', onPointerMove);
      grip.removeEventListener('pointerup', onPointerUp);
      grip.removeEventListener('pointercancel', onPointerUp);
      activePointer = null;
    };
    grip.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      activePointer = e.pointerId;
      row.classList.add('cl-dragging');
      try { grip.setPointerCapture(e.pointerId); } catch {}
      grip.addEventListener('pointermove', onPointerMove);
      grip.addEventListener('pointerup', onPointerUp);
      grip.addEventListener('pointercancel', onPointerUp);
    });
    check.addEventListener('click', () => {
      noteDraft.checklist[i].done = !noteDraft.checklist[i].done;
      renderNoteChecklist();
    });
    text.addEventListener('input', () => { noteDraft.checklist[i].text = text.value; });
    text.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        noteDraft.checklist.splice(i + 1, 0, { text: '', done: false });
        renderNoteChecklist();
        const next = $$('#note-checklist .cl-text')[i + 1];
        if (next) next.focus();
      } else if (e.key === 'Backspace' && !text.value && noteDraft.checklist.length > 0) {
        e.preventDefault();
        noteDraft.checklist.splice(i, 1);
        renderNoteChecklist();
        const prev = $$('#note-checklist .cl-text')[Math.max(0, i - 1)];
        if (prev) { prev.focus(); prev.setSelectionRange(prev.value.length, prev.value.length); }
      }
    });
    del.addEventListener('click', () => {
      noteDraft.checklist.splice(i, 1);
      renderNoteChecklist();
    });
    if (item.done) row.classList.add('is-done');
    root.appendChild(row);
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

$('#note-add-link').addEventListener('click', async () => {
  const url = await uiPrompt('Pega o escribe la URL', { title: 'Nuevo enlace', placeholder: 'https://…', required: true });
  if (!url) return;
  let normalized = url.trim();
  if (!/^https?:\/\//i.test(normalized)) normalized = 'https://' + normalized;
  const label = await uiPrompt('Una etiqueta corta (opcional)', { title: 'Etiqueta del enlace', placeholder: 'Mi enlace', confirmLabel: 'Añadir' });
  noteDraft.links.push({ url: normalized, label: (label || '').trim() });
  renderNoteLinkChips();
});

$('#note-add-image').addEventListener('click', () => $('#note-image-input').click());

$('#note-add-checklist').addEventListener('click', () => {
  // If the list is empty, seed it with one row; otherwise append a fresh item.
  if (!noteDraft.checklist.length) {
    noteDraft.checklist.push({ text: '', done: false });
  } else {
    noteDraft.checklist.push({ text: '', done: false });
  }
  renderNoteChecklist();
  const rows = $$('#note-checklist .cl-text');
  const last = rows[rows.length - 1];
  if (last) last.focus();
});

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
  // Drop entirely-blank checklist items so we don't persist stray rows
  const cleanedChecklist = noteDraft.checklist
    .map(it => ({ text: String(it.text || '').trim(), done: !!it.done }))
    .filter(it => it.text);
  const payload = {
    title,
    content: $('#note-plain').value,
    content_is_rich: false,
    visibility: noteDraft.visibility,
    links: noteDraft.links,
    images: noteDraft.images,
    tags: noteDraft.tags,
    pinned: noteDraft.pinned,
    checklist: cleanedChecklist,
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
  if (!(await uiConfirm(`¿Eliminar "${note.title}"? Esta acción no se puede deshacer.`, { title: 'Eliminar nota', confirmLabel: 'Eliminar', danger: true }))) return;
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
const mediaDraft = { id: null, parsed: null, pinned: false, featured: false, thumbnail_url: null, artist: null };

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
  const artistInput = $('#media-artist-input');
  const alreadyHasTitle = titleInput.value.trim();
  const alreadyHasArtist = artistInput && artistInput.value.trim();
  if (alreadyHasTitle && alreadyHasArtist) return;
  $('#media-title-hint').textContent = '· buscando título…';
  const oembed = await fetchOembedTitle(parsed);
  $('#media-title-hint').textContent = '';
  if (oembed?.title && !alreadyHasTitle) titleInput.value = oembed.title;
  if (oembed?.author && !alreadyHasArtist && artistInput) {
    artistInput.value = oembed.author;
    mediaDraft.artist = oembed.author;
  }
  if (oembed?.thumbnail) mediaDraft.thumbnail_url = oembed.thumbnail;
  else if (parsed.thumbnailUrl) mediaDraft.thumbnail_url = parsed.thumbnailUrl;
}

function openMediaEditor(m) {
  mediaDraft.id = m?.id || null;
  mediaDraft.thumbnail_url = m?.thumbnail_url || null;
  mediaDraft.artist = m?.artist || null;
  $('#media-url').value = m?.url || '';
  $('#media-title-input').value = m?.title || '';
  if ($('#media-artist-input')) $('#media-artist-input').value = m?.artist || '';
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
  let title = $('#media-title-input').value.trim();
  let artist = ($('#media-artist-input')?.value || '').trim();
  const parsed = parseMediaUrl($('#media-url').value);
  if (!parsed) { setStatus($('#media-status'), 'Pega un enlace válido de Spotify o YouTube', true); $('#media-url').focus(); return; }

  // Last-ditch attempt to grab title/artist/thumbnail from oembed before
  // we save. This means the user doesn't need to type the title — pasting
  // the URL is enough.
  let thumb = mediaDraft.thumbnail_url || parsed.thumbnailUrl;
  if (!title || !artist || !thumb) {
    try {
      const oe = await fetchOembedTitle(parsed);
      if (oe?.title && !title) title = oe.title;
      if (oe?.author && !artist) artist = oe.author;
      if (oe?.thumbnail && !thumb) thumb = oe.thumbnail;
    } catch {}
  }
  if (!title) title = 'Sin título';

  const payload = {
    kind: parsed.kind,
    title,
    artist: artist || null,
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
  if (!(await uiConfirm(`¿Eliminar "${m.title}"? Esta acción no se puede deshacer.`, { title: 'Eliminar', confirmLabel: 'Eliminar', danger: true }))) return;
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
  $('#theater-title').textContent = displayMediaTitle(m);
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
// Files the user picked but hasn't uploaded yet. Held here until they
// confirm the album in the modal.
let pendingPhotos = [];

// "Subir fotos" button entry-point. On mobile this means: open the
// device's photo picker directly instead of a modal. After the user
// selects something, we open the modal asking for the album.
function openPhotoUpload() {
  // Reset the input so picking the same set again still fires change
  $('#photo-input').value = '';
  $('#photo-input').click();
}

function resetUploadDialog() {
  $('#photo-caption').value = '';
  $('#photo-album').value = '';
  const select = $('#photo-album-select');
  const albums = Array.from(new Set(state.photos.map(p => p.album || '').filter(Boolean))).sort();
  select.innerHTML = `
    <option value="">— Elige un álbum —</option>
    <option value="__new__">+ Nuevo álbum</option>
    ${albums.map(a => `<option value="${escapeHtml(a)}">${escapeHtml(a)}</option>`).join('')}
  `;
  // No default — force the user to choose so we don't silently dump
  // photos into the first existing album.
  select.value = '';
  function syncAlbumInput() {
    const v = select.value;
    if (v === '__new__') {
      $('#photo-album').style.display = '';
      $('#photo-album').placeholder = 'Nombre del álbum nuevo';
      $('#photo-album').value = '';
    } else {
      $('#photo-album').style.display = 'none';
      $('#photo-album').value = v || '';
    }
  }
  select.onchange = syncAlbumInput;
  syncAlbumInput();
  uploadList.innerHTML = '';
  $('#photo-status').textContent = '';
  uploadQueue.length = 0;
  uploadTotal = 0;
  uploadDone = 0;
  uploadProcessing = false;
  pendingPhotos = [];
}

// Opens the modal AFTER files have been picked. Pre-populates the
// pending list with previews of what was selected.
function openPhotoConfirmModal(files) {
  resetUploadDialog();
  pendingPhotos = Array.from(files || []).filter(f => f.type.startsWith('image/'));
  renderPendingUploadList();
  if (!dlgPhoto.open) dlgPhoto.showModal();
}

function renderPendingUploadList() {
  uploadList.innerHTML = '';
  for (const f of pendingPhotos) {
    pushUploadRow(f, '· por subir');
  }
  updatePhotoConfirmButton();
}

function updatePhotoConfirmButton() {
  const btn = $('#photo-confirm-upload');
  if (!btn) return;
  const n = pendingPhotos.length;
  btn.textContent = n > 1 ? `Subir ${n} fotos` : 'Subir';
  btn.disabled = !n;
}

// Upload queue state (lives across multiple handleFiles calls within the
// same dialog session; reset on openPhotoUpload).
const uploadQueue = [];
let uploadProcessing = false;
let uploadTotal = 0;
let uploadDone = 0;

function pushUploadRow(file, album) {
  const row = document.createElement('div');
  row.className = 'upload-row pending';
  const reader = new FileReader();
  reader.onload = () => row.querySelector('img.preview').src = reader.result;
  reader.readAsDataURL(file);
  row.innerHTML = `
    <img class="preview" src="" alt="" />
    <div class="row-info">
      <div class="name">${escapeHtml(file.name)}</div>
      <div class="album-tag"><span class="material-symbols-outlined">folder</span> ${escapeHtml(album)}</div>
    </div>
    <div class="progress"><div></div></div>
    <div class="row-status"><span class="material-symbols-outlined status-icon">schedule</span></div>
  `;
  uploadList.appendChild(row);
  return row;
}

function currentAlbumSelection() {
  const select = $('#photo-album-select');
  const v = (select && select.value !== '__new__') ? select.value : $('#photo-album').value.trim();
  return (!v || v === '__new__') ? null : v;
}

function updateUploadStatus() {
  if (uploadTotal === 0) { setStatus($('#photo-status'), ''); return; }
  if (uploadDone >= uploadTotal && uploadQueue.length === 0) {
    setStatus($('#photo-status'), `${uploadDone} foto${uploadDone === 1 ? '' : 's'} subida${uploadDone === 1 ? '' : 's'} ✓`);
  } else {
    setStatus($('#photo-status'), `Subiendo ${Math.min(uploadDone + 1, uploadTotal)} / ${uploadTotal}…`);
  }
}

async function uploadOne(item) {
  const { file, row, album, caption } = item;
  row.classList.remove('pending');
  row.classList.add('uploading');
  row.querySelector('.status-icon').textContent = 'cloud_upload';
  const bar = row.querySelector('.progress > div');
  bar.style.width = '15%';
  try {
    const ext = (file.name.split('.').pop() || 'png').toLowerCase();
    const path = `${crypto.randomUUID()}.${ext}`;
    bar.style.width = '40%';
    const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, file, {
      cacheControl: '3600', upsert: false, contentType: file.type,
    });
    if (upErr) throw upErr;
    bar.style.width = '80%';
    const { error: insErr } = await supabase.from('photos').insert({
      storage_path: path,
      caption,
      album, // captured snapshot, NOT live read
      created_by: state.currentUser,
      seen_by: [state.currentUser],
    });
    if (insErr) throw insErr;
    bar.style.width = '100%';
    row.classList.remove('uploading');
    row.classList.add('done');
    row.querySelector('.status-icon').textContent = 'check_circle';
  } catch (e) {
    console.error(e);
    row.classList.remove('uploading');
    row.classList.add('error');
    row.querySelector('.status-icon').textContent = 'error';
    row.querySelector('.name').textContent += ` — ${e.message || e}`;
  }
}

// Add files to pendingPhotos (doesn't upload yet). If the modal isn't
// open, open it with the picked files. If it is, append to the current
// list so the user can add more before confirming.
function addPendingFiles(fileList) {
  const files = Array.from(fileList || []).filter(f => f.type.startsWith('image/'));
  if (!files.length) return;
  if (!dlgPhoto.open) {
    openPhotoConfirmModal(files);
  } else {
    pendingPhotos = pendingPhotos.concat(files);
    renderPendingUploadList();
  }
}

// Actually starts the upload. Called by the modal's "Subir" button.
async function startConfirmedUpload() {
  const album = currentAlbumSelection();
  if (!album) {
    setStatus($('#photo-status'), 'Elige o crea un álbum primero', true);
    const select = $('#photo-album-select');
    if (select) select.focus();
    return;
  }
  if (!pendingPhotos.length) {
    setStatus($('#photo-status'), 'Elige al menos una foto', true);
    return;
  }
  const caption = $('#photo-caption').value;
  // Wipe the preview rows; we'll re-add with the chosen album label.
  uploadList.innerHTML = '';
  const filesToUpload = pendingPhotos.slice();
  pendingPhotos = [];
  updatePhotoConfirmButton();
  for (const file of filesToUpload) {
    const row = pushUploadRow(file, album);
    uploadQueue.push({ file, row, album, caption });
    uploadTotal++;
  }
  updateUploadStatus();
  if (uploadProcessing) return;
  uploadProcessing = true;
  try {
    while (uploadQueue.length > 0) {
      const item = uploadQueue.shift();
      await uploadOne(item);
      uploadDone++;
      updateUploadStatus();
    }
  } finally {
    uploadProcessing = false;
  }
}

$('#photo-pick-btn').addEventListener('click', () => $('#photo-input').click());
dz.addEventListener('click', (e) => { if (e.target.tagName !== 'BUTTON') $('#photo-input').click(); });
$('#photo-input').addEventListener('change', (e) => {
  addPendingFiles(e.target.files);
  // Allow picking the same files again later
  e.target.value = '';
});
$('#photo-confirm-upload').addEventListener('click', startConfirmedUpload);

;['dragenter', 'dragover'].forEach(ev => {
  dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add('drag-over'); });
});
;['dragleave', 'drop'].forEach(ev => {
  dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove('drag-over'); });
});
dz.addEventListener('drop', (e) => {
  addPendingFiles(e.dataTransfer.files);
});

dlgPhoto.addEventListener('close', () => {
  pendingPhotos = [];
  router();
});

// ============================================================
// Lightbox (with prev/next and keyboard nav)
// ============================================================
const dlgLightbox = $('#dlg-lightbox');
const lightboxState = { list: [], index: 0, dirty: false };

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

  renderLightboxTags(p);

  if (isUnread(p)) markSeen('photos', p);
}

function renderLightboxTags(p) {
  const root = $('#lb-tags');
  if (!root) return;
  root.innerHTML = '';
  const tags = Array.isArray(p.tags) ? p.tags : [];
  tags.forEach(t => {
    const chip = document.createElement('span');
    chip.className = 'lb-tag-chip';
    chip.style.setProperty('--tag-color', tagColor(t));
    chip.innerHTML = `#${escapeHtml(t)} <button type="button" aria-label="Quitar etiqueta">×</button>`;
    chip.querySelector('button').addEventListener('click', async (e) => {
      e.stopPropagation();
      const next = tags.filter(x => x !== t);
      p.tags = next;
      // Keep the in-memory copy in state.photos in sync
      const inState = state.photos.find(x => x.id === p.id);
      if (inState) inState.tags = next;
      renderLightboxTags(p);
      try { await supabase.from('photos').update({ tags: next }).eq('id', p.id); } catch (err) { console.error('photo tag remove', err); }
    });
    root.appendChild(chip);
  });
  // "+ Etiqueta" button
  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.className = 'lb-tag-add';
  addBtn.innerHTML = '<span class="material-symbols-outlined">add</span> Etiqueta';
  addBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    const raw = await uiPrompt('Etiqueta', { title: 'Añadir etiqueta', placeholder: 'verano, viajes…', required: true });
    if (!raw) return;
    // Allow comma-separated bulk add
    const incoming = raw.split(',').map(s => s.trim()).filter(Boolean);
    const next = Array.from(new Set([...(Array.isArray(p.tags) ? p.tags : []), ...incoming]));
    p.tags = next;
    const inState = state.photos.find(x => x.id === p.id);
    if (inState) inState.tags = next;
    renderLightboxTags(p);
    try { await supabase.from('photos').update({ tags: next }).eq('id', p.id); } catch (err) { console.error('photo tag add', err); }
  });
  root.appendChild(addBtn);
}

function lbNav(delta) {
  if (!lightboxState.list.length) return;
  lightboxState.index = (lightboxState.index + delta + lightboxState.list.length) % lightboxState.list.length;
  renderLightbox();
}

$('#lb-prev').addEventListener('click', (e) => { e.stopPropagation(); lbNav(-1); });
$('#lb-next').addEventListener('click', (e) => { e.stopPropagation(); lbNav(1); });
$('#lb-close').addEventListener('click', (e) => { e.stopPropagation(); dlgLightbox.close(); });
// Click anywhere outside the photo (the dim backdrop or the empty stage
// area) to close. Clicks on the img itself or the toolbar buttons keep
// the lightbox open thanks to their stopPropagation handlers.
dlgLightbox.addEventListener('click', (e) => {
  if (e.target === dlgLightbox || e.target.id === 'lb-stage') {
    dlgLightbox.close();
  }
});

$('#lb-pin').addEventListener('click', async (e) => {
  e.stopPropagation();
  const p = lightboxState.list[lightboxState.index];
  if (!p) return;
  p.pinned = !p.pinned;
  lightboxState.dirty = true;
  await supabase.from('photos').update({ pinned: p.pinned }).eq('id', p.id);
  renderLightbox();
});
$('#lb-feature').addEventListener('click', async (e) => {
  e.stopPropagation();
  const p = lightboxState.list[lightboxState.index];
  if (!p) return;
  p.featured = !p.featured;
  lightboxState.dirty = true;
  await supabase.from('photos').update({ featured: p.featured }).eq('id', p.id);
  renderLightbox();
});
$('#lb-move').addEventListener('click', (e) => {
  e.stopPropagation();
  const p = lightboxState.list[lightboxState.index];
  if (!p) return;
  // Open the album edit modal in move mode for THIS single photo
  openAlbumEditModal('move-single', p.album || '', [p]);
});
// (foto notes feature retired)
$('#lb-delete').addEventListener('click', async (e) => {
  e.stopPropagation();
  const p = lightboxState.list[lightboxState.index];
  if (!p) return;
  if (!(await uiConfirm('¿Eliminar esta foto? No se puede deshacer.', { title: 'Eliminar foto', confirmLabel: 'Eliminar', danger: true }))) return;
  try { await supabase.storage.from(BUCKET).remove([p.storage_path]); } catch {}
  await supabase.from('photos').delete().eq('id', p.id);
  // Remove from state caches
  state.photos = state.photos.filter(x => x.id !== p.id);
  lightboxState.list.splice(lightboxState.index, 1);
  lightboxState.dirty = true;
  if (!lightboxState.list.length) { dlgLightbox.close(); return; }
  lightboxState.index = Math.min(lightboxState.index, lightboxState.list.length - 1);
  renderLightbox();
});

window.addEventListener('keydown', (e) => {
  if (!dlgLightbox.open) return;
  if (e.key === 'ArrowLeft') { e.preventDefault(); lbNav(-1); }
  else if (e.key === 'ArrowRight') { e.preventDefault(); lbNav(1); }
});

dlgLightbox.addEventListener('close', () => {
  // Instant close: do NOT re-fetch from network. If anything changed in the
  // lightbox (pin/feature/delete), state.photos was mutated in place — just
  // re-render the page synchronously.
  if (lightboxState.dirty) {
    lightboxState.dirty = false;
    rerenderCurrentPage();
  }
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
  if (!(await uiConfirm('¿Eliminar este lugar? No se puede deshacer.', { title: 'Eliminar lugar', confirmLabel: 'Eliminar', danger: true }))) return;
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
    // Use closest() instead of matches() so clicks on the icon inside
    // the close button (e.g. <span class="material-symbols-outlined">)
    // still trigger the close.
    if (e.target.closest('[data-close]')) dlg.close();
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
    // Opening the panel = acknowledging what's new. Persist after the
    // list renders so the user still sees which items were unread for
    // this visit (the panel keeps the "Nuevo para ti" header until next
    // open).
    markAllUnreadEverywhere();
  });
  document.addEventListener('click', (e) => {
    if (!popover.contains(e.target) && e.target !== bell) close();
  });
}

// Collapse photo uploads that share an author + album and were created
// within a few minutes of each other into a single notification group.
function groupPhotoUploads(photos) {
  const WINDOW_MS = 10 * 60 * 1000;
  const sorted = [...photos].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  const groups = [];
  for (const p of sorted) {
    const last = groups[groups.length - 1];
    const sameBucket = last
      && last.created_by === p.created_by
      && (last.album || '') === (p.album || '')
      && Math.abs(new Date(last.last_created_at) - new Date(p.created_at)) < WINDOW_MS;
    if (sameBucket) {
      last.photos.push(p);
      last.last_created_at = p.created_at;
    } else {
      groups.push({
        created_by: p.created_by,
        album: p.album || '',
        photos: [p],
        created_at: p.created_at,
        last_created_at: p.created_at,
      });
    }
  }
  return groups;
}

function renderNotifList() {
  const list = $('#notif-list');
  const title = $('#notif-head-title');
  if (!list) return;

  const tagItem = (item, kind, icon, route, label) => ({ ...item, _kind: kind, _icon: icon, _route: route, _label: label });

  const mi = (n) => `<span class="material-symbols-outlined" style="font-size:18px;">${n}</span>`;

  // Group photo uploads that landed in the same album within ~10 minutes
  // of each other into a single "[user] subió N fotos a [álbum]" entry.
  const groupedPhotos = groupPhotoUploads(state.photos);

  // Helper — wraps the title in quotes (with a fallback when empty) so all
  // notification labels follow the same "Se añadió '…'" pattern.
  const named = (title, fallback) => {
    const t = (title || '').trim();
    return t ? `“${t}”` : fallback;
  };

  const all = [
    ...state.notes
      .filter(n => n.visibility !== 'private')
      .map(n => tagItem(n, 'note', mi('edit_note'), '#/notas',
        `Se añadió ${named(n.title, 'una nueva nota')}`)),
    ...state.media.map(m => {
      const icon = mi(m.kind === 'spotify' ? 'music_note' : 'play_circle');
      const kindLabel = m.kind === 'spotify' ? 'una canción' : 'un video';
      // Use the combined "Title — Artist" for media so notifs match cards
      const t = displayMediaTitle(m);
      const label = (t && t !== 'Sin título')
        ? `Se añadió “${t}”`
        : `Se añadió ${kindLabel}`;
      return tagItem(m, 'media', icon, '#/musica', label);
    }),
    ...groupedPhotos.map(g => {
      const slug = g.album ? albumSlugFor(g.album) : '';
      const route = g.album ? `#/fotos/album/${slug}` : '#/fotos';
      const n = g.photos.length;
      let label;
      if (n > 1) {
        label = g.album
          ? `Se añadieron ${n} fotos a ${g.album}`
          : `Se añadieron ${n} fotos`;
      } else {
        label = g.album
          ? `Se añadió una foto a ${g.album}`
          : `Se añadió una foto`;
      }
      return {
        _kind: 'photo',
        _icon: mi('photo_library'),
        _route: route,
        _label: label,
        created_by: g.created_by,
        created_at: g.created_at,
        read_by: g.photos.every(p => (p.read_by || []).includes(state.currentUser)) ? [state.currentUser] : [],
        id: n > 1 ? 'group-' + g.photos[0].id : g.photos[0].id,
        _group: g,
      };
    }),
    ...state.movies.map(m => tagItem(m, 'movie', mi('movie'), '#/pelis',
      `Se añadió ${named(m.title, 'una peli')}`)),
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
  const filterTag = state.filterTag.pelis;
  // A filter chip can be either a tag ("serie", "peli", "documental"…),
  // a platform (prefixed "p:Netflix"), or a watched-by chip (prefixed
  // "w:Mayck" / "w:Jaime" / "w:both"). The prefix is the namespace.
  const isPlatformFilter = filterTag && filterTag.startsWith('p:');
  const isWatchedFilter = filterTag && filterTag.startsWith('w:');
  const activePlatform = isPlatformFilter ? filterTag.slice(2) : null;
  const activeWatched = isWatchedFilter ? filterTag.slice(2) : null;
  const activeTag = (!isPlatformFilter && !isWatchedFilter) ? filterTag : null;

  // The two users (used for the watched filter chips)
  const userNames = state._userAssets ? Object.keys(state._userAssets) : ['Jaime', 'Mayck'];

  // Top-level tab filter: Watchlist (someone hasn't watched) vs
  // Watched Together (everyone watched). Tag/platform/watched-by
  // chips below filter within whichever tab is active.
  const peliView = state.peliView || 'watchlist';
  const matchesView = (m) => {
    const wb = Array.isArray(m.watched_by) ? m.watched_by : [];
    const everyone = userNames.length >= 2 && userNames.every(u => wb.includes(u));
    return peliView === 'together' ? everyone : !everyone;
  };

  const items = state.movies.filter(m => {
    if (!matchesView(m)) return false;
    if (!filterTag) return true;
    if (activePlatform) return (m.platform || '').trim() === activePlatform;
    if (activeWatched) {
      const wb = Array.isArray(m.watched_by) ? m.watched_by : [];
      if (activeWatched === 'both') return userNames.every(u => wb.includes(u));
      return wb.includes(activeWatched);
    }
    return Array.isArray(m.tags) && m.tags.includes(activeTag);
  });

  // Counts for the tabs themselves so the UI shows how many sit in each.
  const tabCounts = state.movies.reduce((acc, m) => {
    const wb = Array.isArray(m.watched_by) ? m.watched_by : [];
    const everyone = userNames.length >= 2 && userNames.every(u => wb.includes(u));
    if (everyone) acc.together += 1; else acc.watchlist += 1;
    return acc;
  }, { watchlist: 0, together: 0 });

  // Build counts for tags + platforms combined into a single ordered list
  const tagCounts = new Map();
  state.movies.forEach(m => (m.tags || []).forEach(t => tagCounts.set(t, (tagCounts.get(t) || 0) + 1)));
  const sortedTags = Array.from(tagCounts.entries()).sort((a, b) => b[1] - a[1]);
  const platformCounts = new Map();
  state.movies.forEach(m => {
    const pl = (m.platform || '').trim();
    if (pl) platformCounts.set(pl, (platformCounts.get(pl) || 0) + 1);
  });
  const sortedPlatforms = Array.from(platformCounts.entries()).sort((a, b) => b[1] - a[1]);
  // Watched-by counts: per-user + "ambos"
  const watchedCounts = {};
  state.movies.forEach(m => {
    const wb = Array.isArray(m.watched_by) ? m.watched_by : [];
    userNames.forEach(u => { if (wb.includes(u)) watchedCounts[u] = (watchedCounts[u] || 0) + 1; });
    if (userNames.length >= 2 && userNames.every(u => wb.includes(u))) {
      watchedCounts.both = (watchedCounts.both || 0) + 1;
    }
  });

  root.innerHTML = `
    <div class="page-head">
      <div>
        <h1>🎬 Pelis y Series</h1>
        <div class="sub">Lo que queremos ver y lo que ya vimos</div>
      </div>
      <div class="actions">
        <button class="btn primary" id="new-movie-btn">+ Nueva peli</button>
      </div>
    </div>
    <div class="seg-tabs" id="pelis-tabs">
      <button class="seg-tab ${peliView === 'watchlist' ? 'active' : ''}" data-view="watchlist">
        Por ver <span class="count">${tabCounts.watchlist}</span>
      </button>
      <button class="seg-tab ${peliView === 'together' ? 'active' : ''}" data-view="together">
        Vistas juntos <span class="count">${tabCounts.together}</span>
      </button>
    </div>
    ${(sortedTags.length || sortedPlatforms.length || Object.keys(watchedCounts).length) ? `
      <div class="tag-filter-row" id="pelis-tag-filter">
        <button class="tag-chip tag-chip-all ${!filterTag ? 'active' : ''}" data-tag="">Todas</button>
        ${userNames.map(u => watchedCounts[u] ? `
          <button class="tag-chip ${activeWatched === u ? 'active' : ''}" data-tag="w:${escapeHtml(u)}" style="--tag-color: #4caf50;">
            <span class="material-symbols-outlined" style="font-size:14px;vertical-align:-3px;">visibility</span> Vistas por ${escapeHtml(u)} <span class="count">${watchedCounts[u]}</span>
          </button>
        ` : '').join('')}
        ${watchedCounts.both ? `
          <button class="tag-chip ${activeWatched === 'both' ? 'active' : ''}" data-tag="w:both" style="--tag-color: #2e7d32;">
            <span class="material-symbols-outlined" style="font-size:14px;vertical-align:-3px;">groups</span> Vistas por ambos <span class="count">${watchedCounts.both}</span>
          </button>
        ` : ''}
        ${sortedTags.map(([tag, count]) => `
          <button class="tag-chip ${activeTag === tag ? 'active' : ''}" data-tag="${escapeHtml(tag)}" style="--tag-color: ${tagColor(tag)};">
            #${escapeHtml(tag)} <span class="count">${count}</span>
          </button>
        `).join('')}
        ${sortedPlatforms.map(([pl, count]) => `
          <button class="tag-chip ${activePlatform === pl ? 'active' : ''}" data-tag="p:${escapeHtml(pl)}" style="--tag-color: ${tagColor(pl)};">
            ${escapeHtml(pl)} <span class="count">${count}</span>
          </button>
        `).join('')}
      </div>
    ` : ''}
    <div class="grid-cards" id="movies-grid"></div>
  `;
  $('#new-movie-btn').addEventListener('click', () => openMovieEditor(null));
  const tabsRow = $('#pelis-tabs');
  if (tabsRow) {
    tabsRow.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-view]');
      if (!b) return;
      const next = b.dataset.view;
      if (next === state.peliView) return;
      state.peliView = next;
      // Switching tabs invalidates the active tag/watched-by chip filter
      // since the counts inside the tab are different.
      state.filterTag.pelis = null;
      renderPelis(root);
    });
  }
  const tagRow = $('#pelis-tag-filter');
  if (tagRow) {
    tagRow.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-tag]');
      if (!b) return;
      state.filterTag.pelis = b.dataset.tag || null;
      renderPelis(root);
    });
  }
  const grid = $('#movies-grid');
  if (!items.length) {
    let label;
    if (activeWatched === 'both') label = 'pelis vistas por ambos';
    else if (activeWatched) label = `pelis vistas por ${activeWatched}`;
    else if (activePlatform) label = activePlatform;
    else if (activeTag) label = `#${activeTag}`;
    else label = '';
    grid.innerHTML = filterTag
      ? `<div class="empty">Nada para ${escapeHtml(label)}.</div>`
      : '<div class="empty">Aún no hay pelis. Añade la primera con el botón.</div>';
    return;
  }
  items.forEach(m => grid.appendChild(renderMovieCard(m)));
}

function renderMovieCard(m) {
  const card = document.createElement('article');
  card.className = 'card clickable movie-card';
  card.style.viewTransitionName = `movie-${cssSafeId(m.id)}`;
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
    await togglePinWithTransition(async () => {
      m.pinned = next;
      await supabase.from('movies').update({ pinned: next }).eq('id', m.id);
      await router();
    });
  });
  card.appendChild(actions);

  const poster = document.createElement('div');
  poster.className = 'poster-wrap';
  if (m.image_path) {
    const img = document.createElement('img');
    // Posters render at ~220-280px wide (aspect 2:3). 500px transform
    // covers retina screens without hauling the original.
    img.src = publicImageUrl(m.image_path, { width: thumbWidth(280) });
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

  // Tags above the title so the kind (peli/serie/etc.) is the first thing seen
  if (Array.isArray(m.tags) && m.tags.length) {
    const tr = document.createElement('div');
    tr.className = 'tag-row';
    m.tags.forEach(t => {
      const tEl = document.createElement('span');
      tEl.className = 'tag';
      tEl.style.setProperty('--tag-color', tagColor(t));
      tEl.textContent = '#' + t;
      tr.appendChild(tEl);
    });
    body.appendChild(tr);
  }

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
const movieDraft = { id: null, score: null, watched_by: [], pinned: false, image_path: null, tags: [] };

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

const MOVIE_TAG_SUGGESTIONS = ['peli', 'serie', 'documental', 'favorita', 'pendiente'];
function renderMovieTags() {
  const root = $('#movie-tags');
  if (!root) return;
  root.innerHTML = '';
  movieDraft.tags.forEach((t, i) => {
    const chip = document.createElement('span');
    chip.className = 'tag-chip-selected';
    chip.style.setProperty('--tag-color', tagColor(t));
    chip.innerHTML = `#${escapeHtml(t)} <button type="button" aria-label="Quitar">×</button>`;
    chip.querySelector('button').addEventListener('click', () => { movieDraft.tags.splice(i, 1); renderMovieTags(); });
    root.appendChild(chip);
  });
}
function renderMovieTagSuggestions(query) {
  const root = $('#movie-tag-suggestions');
  if (!root) return;
  root.innerHTML = '';
  const existing = new Set(MOVIE_TAG_SUGGESTIONS);
  state.movies.forEach(m => (m.tags || []).forEach(t => existing.add(t)));
  let all = Array.from(existing).filter(t => !movieDraft.tags.includes(t));
  if (query) {
    const q = query.toLowerCase();
    all = all.filter(t => t.toLowerCase().includes(q));
  }
  all.slice(0, 10).forEach(t => {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'tag-sugg';
    el.textContent = '#' + t;
    el.addEventListener('click', () => addMovieTag(t));
    root.appendChild(el);
  });
}
function addMovieTag(raw) {
  const t = raw.replace(/^#/, '').trim();
  if (!t) return;
  if (movieDraft.tags.some(x => x.toLowerCase() === t.toLowerCase())) return;
  movieDraft.tags.push(t);
  renderMovieTags();
  renderMovieTagSuggestions($('#movie-tag-input').value);
}

function renderMovieImage() {
  const el = $('#movie-image-preview');
  el.innerHTML = '';
  if (movieDraft.image_path) {
    const img = document.createElement('img');
    img.src = publicImageUrl(movieDraft.image_path, { width: thumbWidth(220) });
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
  movieDraft.tags = Array.isArray(m?.tags) ? [...m.tags] : [];

  $('#movie-title-input').value = m?.title || '';
  $('#movie-platform').value = m?.platform || '';
  $('#movie-notes').value = m?.notes || '';
  $('#movie-tag-input').value = '';
  renderMovieTags();
  renderMovieTagSuggestions('');
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

// Movie tag input wiring (mirrors the note tag input)
$('#movie-tag-input').addEventListener('input', (e) => renderMovieTagSuggestions(e.target.value));
$('#movie-tag-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ',') {
    e.preventDefault();
    addMovieTag(e.target.value);
    e.target.value = '';
    renderMovieTagSuggestions('');
  } else if (e.key === 'Backspace' && !e.target.value && movieDraft.tags.length) {
    movieDraft.tags.pop();
    renderMovieTags();
    renderMovieTagSuggestions('');
  }
});

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
  // Auto-pickup any tag the user typed but didn't press Enter on
  const pendingTag = $('#movie-tag-input').value.trim();
  if (pendingTag) {
    addMovieTag(pendingTag);
    $('#movie-tag-input').value = '';
  }
  const payload = {
    title,
    score: movieDraft.score || null,
    platform: $('#movie-platform').value.trim(),
    notes: $('#movie-notes').value,
    image_path: movieDraft.image_path,
    watched_by: movieDraft.watched_by,
    pinned: movieDraft.pinned,
    tags: movieDraft.tags,
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
  if (!(await uiConfirm(`¿Eliminar "${m.title}"? No se puede deshacer.`, { title: 'Eliminar peli', confirmLabel: 'Eliminar', danger: true }))) return;
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
// Post-it board (dashboard)
// ============================================================
const POSTIT_COLORS = ['cyan', 'yellow', 'green', 'pink'];
const POSTIT_W = 130;
const POSTIT_H = 130;
let postitDragState = null;
let postitTopZ = 10;
const POSTIT_DESIGN_W = 520;
// Observer that keeps --pb-scale in sync with the wrapper's actual width
// so the postit board fits any container — col-right on desktop, full
// viewport on mobile.
let postitScaleObserver = null;
function setupPostitBoardScale() {
  const wrap = document.querySelector('.postit-board-wrap');
  if (!wrap) return;
  const apply = () => {
    const w = wrap.clientWidth || wrap.offsetWidth || 0;
    if (!w) return;
    // Uniform scale — postits keep their natural square proportions.
    // The board fills the wrapper's full width on every breakpoint;
    // height grows proportionally (taller on phones, but no awkward
    // gutters on either side).
    const scale = Math.min(1, w / POSTIT_DESIGN_W);
    wrap.style.setProperty('--pb-scale', String(scale));
  };
  apply();
  if (postitScaleObserver) { try { postitScaleObserver.disconnect(); } catch {} postitScaleObserver = null; }
  if (typeof ResizeObserver !== 'undefined') {
    postitScaleObserver = new ResizeObserver(apply);
    postitScaleObserver.observe(wrap);
  }
  // Re-apply on viewport breakpoint changes (mobile ↔ desktop)
  if (!window._pbBreakpointWired) {
    window._pbBreakpointWired = true;
    window.addEventListener('resize', apply);
  }
}
// Bring this post-it to the top of the stacking order. We bump a local
// counter, set inline z-index, and persist the new z_index to Supabase
// so it survives refreshes (for both users).
function bringPostitToFront(el, id) {
  postitTopZ += 1;
  const z = postitTopZ;
  el.style.zIndex = String(z);
  // Reflect locally so the next renderPostits() preserves it
  const p = state.postits.find(x => x.id === id);
  if (p) p.z_index = z;
  if (id != null) {
    // Fire-and-forget — drag/create UX shouldn't wait on the round trip.
    supabase.from('postits').update({ z_index: z }).eq('id', id).then(() => {}, () => {});
  }
}

function setupPostitBoard() {
  const board = $('#postit-board');
  if (!board) return;
  // Seed the local counter from the highest persisted z_index so subsequent
  // bring-to-front calls always end up on top.
  postitTopZ = Math.max(
    postitTopZ,
    ...state.postits.map(p => Number(p.z_index) || 0)
  );
  // Scale the board to fit its container (col-right is narrower than the
  // design width; mobile is narrower still). Re-runs on resize.
  setupPostitBoardScale();
  // Render initial post-its
  renderPostits();

  // Add post-it button
  $('#pb-new').addEventListener('click', async () => {
    // Use offsetWidth/Height to read the LAYOUT size (unscaled), since
    // on mobile the board is rendered with a CSS transform: scale(...).
    const w = board.offsetWidth;
    const h = board.offsetHeight;
    // Pick a random color and a position roughly in the visible area
    const color = POSTIT_COLORS[Math.floor(Math.random() * POSTIT_COLORS.length)];
    const x = Math.max(20, Math.floor(Math.random() * (w - POSTIT_W - 40)) + 20);
    const y = Math.max(20, Math.floor(Math.random() * (h - POSTIT_H - 40)) + 20);
    const rotation = (Math.random() - 0.5) * 8; // -4° to +4°
    try {
      const { data, error } = await supabase.from('postits').insert({
        author: state.currentUser, body: '', color, x, y, rotation,
      }).select().single();
      if (error) throw error;
      state.postits.unshift(data);
      renderPostits();
      // Bring the newly-created postit to the front so it sits above the rest
      const newPostit = board.querySelector(`.postit[data-id="${data.id}"]`);
      if (newPostit) bringPostitToFront(newPostit, data.id);
      // Focus the new one for immediate typing
      const newEl = board.querySelector(`[data-id="${data.id}"] .pi-body`);
      if (newEl) newEl.focus();
    } catch (e) {
      console.error('postit create', e);
      uiAlert('No se pudo crear el post-it: ' + (e.message || e), { title: 'Error' });
    }
  });

  // Light polling so the other person's post-its show up
  if (window._postitPoll) clearInterval(window._postitPoll);
  window._postitPoll = setInterval(async () => {
    try {
      const { data } = await supabase.from('postits').select('*').order('z_index', { ascending: true }).order('created_at', { ascending: true });
      if (data) {
        // Only re-render if list changed
        if (data.length !== state.postits.length ||
            data.some(p => !state.postits.find(x => x.id === p.id && x.body === p.body && x.color === p.color && x.x === p.x && x.y === p.y))) {
          // Don't disrupt a postit being edited
          if (!document.activeElement || !document.activeElement.closest('.postit')) {
            state.postits = data;
            renderPostits();
          }
        }
      }
    } catch {}
  }, 8000);
}

function renderPostits() {
  const board = $('#postit-board');
  if (!board) return;
  const empty = $('#pb-empty');
  // Wipe existing post-its (keep the + button and empty hint)
  board.querySelectorAll('.postit').forEach(el => el.remove());
  if (empty) empty.hidden = state.postits.length > 0;

  for (const p of state.postits) {
    board.appendChild(renderPostitEl(p));
  }
}

function renderPostitEl(p) {
  const el = document.createElement('div');
  el.className = `postit ${p.color}`;
  el.dataset.id = p.id;
  el.style.left = `${p.x}px`;
  el.style.top = `${p.y}px`;
  el.style.transform = `rotate(${p.rotation || 0}deg)`;
  // Stacking order comes from the DB so it survives refreshes
  if (p.z_index != null) el.style.zIndex = String(p.z_index);

  el.innerHTML = `
    <div class="pi-author">${escapeHtml(p.author || '?')}</div>
    <textarea class="pi-body" placeholder="Escribe algo…" maxlength="200">${escapeHtml(p.body || '')}</textarea>
    <div class="pi-tools">
      ${POSTIT_COLORS.map(c => `<button class="pi-color" data-color="${c}" title="Cambiar a ${c}"><span class="pi-swatch ${c}"></span></button>`).join('')}
      <button class="pi-del" title="Borrar"><span class="material-symbols-outlined" style="font-size:14px;">delete</span></button>
    </div>
  `;

  // Drag — desktop: grab the edge (not the textarea/tools) to drag.
  el.addEventListener('mousedown', (e) => {
    if (e.target.closest('.pi-body, .pi-tools')) return;
    startDrag(el, p, e);
  });

  // Touch (mobile): drag from ANYWHERE on the postit. A short tap that
  // doesn't move past the threshold focuses the textarea + shows the
  // tools. This avoids the user having to target the tiny top edge.
  let touchAnchor = null;
  let touchDragStarted = false;
  const DRAG_THRESHOLD = 8; // px

  el.addEventListener('touchstart', (e) => {
    // Let tool buttons handle their own taps
    if (e.target.closest('.pi-tools button')) return;
    const t = e.touches[0];
    touchAnchor = { x: t.clientX, y: t.clientY, target: e.target };
    touchDragStarted = false;
  }, { passive: true });

  el.addEventListener('touchmove', (e) => {
    if (!touchAnchor) return;
    const t = e.touches[0];
    if (!touchDragStarted) {
      const dx = t.clientX - touchAnchor.x;
      const dy = t.clientY - touchAnchor.y;
      if (Math.hypot(dx, dy) > DRAG_THRESHOLD) {
        touchDragStarted = true;
        // Don't pop the keyboard mid-drag
        try { el.querySelector('.pi-body')?.blur(); } catch {}
        // Hand off to the regular drag flow, starting from the original
        // touch point so the postit doesn't jump.
        startDrag(el, p, { clientX: touchAnchor.x, clientY: touchAnchor.y });
        e.preventDefault();
      }
    } else {
      // While dragging keep the page from scrolling under us
      e.preventDefault();
    }
  }, { passive: false });

  el.addEventListener('touchend', () => {
    if (!touchAnchor) return;
    const wasTap = !touchDragStarted;
    touchAnchor = null;
    touchDragStarted = false;
    if (wasTap) {
      // Show the tools row briefly so colors + delete are reachable
      // without a hover (mobile has no hover).
      el.classList.add('tools-open');
      clearTimeout(el._toolsTimer);
      el._toolsTimer = setTimeout(() => el.classList.remove('tools-open'), 3000);
      // Focus the textarea so the keyboard pops for editing
      try { el.querySelector('.pi-body')?.focus(); } catch {}
    }
  });

  // Body edit — debounced save
  const body = el.querySelector('.pi-body');
  let bodyTimer = null;
  body.addEventListener('input', (e) => {
    p.body = e.target.value;
    clearTimeout(bodyTimer);
    bodyTimer = setTimeout(async () => {
      try { await supabase.from('postits').update({ body: p.body }).eq('id', p.id); } catch {}
    }, 600);
  });

  // Color change
  el.querySelectorAll('.pi-color').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const newColor = btn.dataset.color;
      el.classList.remove(...POSTIT_COLORS);
      el.classList.add(newColor);
      p.color = newColor;
      try { await supabase.from('postits').update({ color: newColor }).eq('id', p.id); } catch {}
    });
  });

  // Delete
  el.querySelector('.pi-del').addEventListener('click', async (e) => {
    e.stopPropagation();
    if (!(await uiConfirm('¿Borrar este post-it?', { title: 'Borrar post-it', confirmLabel: 'Borrar', danger: true }))) return;
    try {
      await supabase.from('postits').delete().eq('id', p.id);
      state.postits = state.postits.filter(x => x.id !== p.id);
      renderPostits();
    } catch (err) { console.error(err); }
  });

  return el;
}

function startDrag(el, p, evt) {
  const board = $('#postit-board');
  const renderedRect = board.getBoundingClientRect(); // post-transform screen coords
  const layoutW = board.offsetWidth;                  // pre-transform (unscaled)
  const layoutH = board.offsetHeight;
  // Uniform scale — same factor on both axes.
  const scale = layoutW > 0 ? renderedRect.width / layoutW : 1;
  const elRect = el.getBoundingClientRect();
  const offsetX = evt.clientX - elRect.left;
  const offsetY = evt.clientY - elRect.top;

  el.classList.add('dragging');
  // Bring this postit to the very front and keep it there after release.
  bringPostitToFront(el, p.id);

  const onMove = (e) => {
    const pos = e.touches ? e.touches[0] : e;
    const newXScreen = pos.clientX - renderedRect.left - offsetX;
    const newYScreen = pos.clientY - renderedRect.top - offsetY;
    // Convert to layout pixels (uniform scale on both axes)
    const newX = newXScreen / scale;
    const newY = newYScreen / scale;
    // Clamp inside the board (layout coords)
    const clampedX = Math.max(0, Math.min(layoutW - POSTIT_W, newX));
    const clampedY = Math.max(0, Math.min(layoutH - POSTIT_H, newY));
    el.style.left = `${clampedX}px`;
    el.style.top = `${clampedY}px`;
    p.x = clampedX;
    p.y = clampedY;
  };

  const onEnd = async () => {
    el.classList.remove('dragging');
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onEnd);
    document.removeEventListener('touchmove', onMove);
    document.removeEventListener('touchend', onEnd);
    try { await supabase.from('postits').update({ x: p.x, y: p.y }).eq('id', p.id); } catch {}
  };

  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onEnd);
  document.addEventListener('touchmove', onMove, { passive: false });
  document.addEventListener('touchend', onEnd);
}

// ============================================================
// Garabatos — collaborative drawing board (dashboard right column)
// ============================================================
// Sentinel color used to mark erase strokes — when drawing, we set
// globalCompositeOperation = 'destination-out' which erases pixels.
const DOODLE_ERASE = '__erase__';

const doodleState = {
  strokes: [],     // persisted strokes from DB (oldest → newest)
  pending: [],     // strokes we drew locally that haven't been confirmed
  current: null,   // the stroke currently being drawn (live)
  tool: 'pen',     // 'pen' | 'erase'
  color: '#ffffff',
  prevColor: '#ffffff', // remember pen color while eraser is active
  width: 4,
  canvas: null,
  ctx: null,
  dpr: 1,
  pollTimer: null,
  resizeObs: null,
  authorTagTimer: null,
  lastRemoteCount: 0,
};

function setupDoodleBoard() {
  const board = document.getElementById('doodle-board');
  if (!board) return;
  const canvas = document.getElementById('doodle-canvas');
  if (!canvas) return;

  // Tear down any prior session (e.g., re-render of dashboard)
  if (doodleState.pollTimer) { clearInterval(doodleState.pollTimer); doodleState.pollTimer = null; }
  if (doodleState.resizeObs) { try { doodleState.resizeObs.disconnect(); } catch {} doodleState.resizeObs = null; }

  doodleState.canvas = canvas;
  doodleState.ctx = canvas.getContext('2d');
  doodleState.current = null;
  doodleState.pending = [];
  doodleState.strokes = [];

  // Author tag: shown briefly when remote strokes arrive
  const stage = board.querySelector('.db-stage');
  if (stage && !stage.querySelector('.db-author')) {
    const tag = document.createElement('div');
    tag.className = 'db-author';
    stage.appendChild(tag);
  }

  // Size canvas to its CSS box (high-DPI aware) and redraw whenever it changes
  resizeDoodleCanvas();
  redrawDoodles();
  if (typeof ResizeObserver !== 'undefined') {
    doodleState.resizeObs = new ResizeObserver(() => {
      resizeDoodleCanvas();
      redrawDoodles();
    });
    doodleState.resizeObs.observe(canvas);
  }

  // Tool wiring — colors (also exits the eraser tool)
  board.querySelectorAll('.db-color').forEach(btn => {
    btn.style.setProperty('--c', btn.dataset.color);
    btn.addEventListener('click', () => {
      doodleState.color = btn.dataset.color;
      doodleState.prevColor = btn.dataset.color;
      doodleState.tool = 'pen';
      board.querySelectorAll('.db-color').forEach(b => b.classList.toggle('is-active', b === btn));
      board.querySelectorAll('.db-tool').forEach(b => b.classList.remove('is-active'));
    });
  });
  // Sizes
  board.querySelectorAll('.db-size').forEach(btn => {
    btn.addEventListener('click', () => {
      doodleState.width = parseFloat(btn.dataset.w);
      board.querySelectorAll('.db-size').forEach(b => b.classList.toggle('is-active', b === btn));
    });
  });
  // Eraser tool — toggles between erase and the previously selected pen color
  board.querySelectorAll('.db-tool').forEach(btn => {
    btn.addEventListener('click', () => {
      const wantsErase = btn.dataset.tool === 'erase' && doodleState.tool !== 'erase';
      if (wantsErase) {
        doodleState.tool = 'erase';
        btn.classList.add('is-active');
        board.querySelectorAll('.db-color').forEach(b => b.classList.remove('is-active'));
      } else {
        // Turn the eraser off → return to the previous pen color
        doodleState.tool = 'pen';
        doodleState.color = doodleState.prevColor;
        btn.classList.remove('is-active');
        board.querySelectorAll('.db-color').forEach(b => {
          b.classList.toggle('is-active', b.dataset.color === doodleState.color);
        });
      }
    });
  });
  // Clear all
  const clearBtn = board.querySelector('.db-clear');
  if (clearBtn) {
    clearBtn.addEventListener('click', async () => {
      if (!(await uiConfirm('¿Borrar todo el dibujo? Esta acción no se puede deshacer.', { title: 'Borrar dibujo', confirmLabel: 'Borrar', danger: true }))) return;
      try {
        await supabase.from('doodles').delete().neq('id', '00000000-0000-0000-0000-000000000000');
        doodleState.strokes = [];
        doodleState.pending = [];
        redrawDoodles();
      } catch (e) {
        console.error('doodle clear', e);
        uiAlert('No se pudo borrar el dibujo: ' + (e.message || e), { title: 'Error' });
      }
    });
  }

  // Pointer events. Use Pointer Events API for unified mouse/touch/pen.
  canvas.addEventListener('pointerdown', onDoodlePointerDown);
  canvas.addEventListener('pointermove', onDoodlePointerMove);
  canvas.addEventListener('pointerup', onDoodlePointerUp);
  canvas.addEventListener('pointercancel', onDoodlePointerUp);

  // Initial load + light polling so the other person's strokes show up
  loadDoodles();
  doodleState.pollTimer = setInterval(loadDoodles, 2500);
}

function resizeDoodleCanvas() {
  const c = doodleState.canvas;
  if (!c) return;
  const dpr = window.devicePixelRatio || 1;
  const rect = c.getBoundingClientRect();
  const w = Math.max(1, Math.floor(rect.width * dpr));
  const h = Math.max(1, Math.floor(rect.height * dpr));
  if (c.width !== w) c.width = w;
  if (c.height !== h) c.height = h;
  doodleState.dpr = dpr;
}

async function loadDoodles() {
  try {
    const { data, error } = await supabase
      .from('doodles')
      .select('*')
      .order('created_at', { ascending: true });
    if (error) throw error;
    if (!data) return;
    // Only redraw if the set changed (compare ids)
    const old = doodleState.strokes;
    let changed = data.length !== old.length;
    if (!changed) {
      for (let i = 0; i < data.length; i++) {
        if (data[i].id !== old[i].id) { changed = true; break; }
      }
    }
    if (changed) {
      // Flash the author tag if a new stroke arrived from the OTHER user
      const newLast = data[data.length - 1];
      const prevLast = old[old.length - 1];
      if (newLast && (!prevLast || prevLast.id !== newLast.id) && newLast.author !== state.currentUser) {
        flashDoodleAuthor(newLast.author);
      }
      doodleState.strokes = data;
      // Drop any pending strokes that have now been confirmed by the server
      const confirmedKeys = new Set(data.map(s => `${s.author}|${s.created_at}`));
      doodleState.pending = doodleState.pending.filter(p => !confirmedKeys.has(`${p.author}|${p.created_at}`));
      redrawDoodles();
    }
  } catch (e) { console.error('doodle load', e); }
}

function flashDoodleAuthor(name) {
  const tag = document.querySelector('#doodle-board .db-author');
  if (!tag) return;
  tag.textContent = `${name} dibujando`;
  tag.classList.add('show');
  if (doodleState.authorTagTimer) clearTimeout(doodleState.authorTagTimer);
  doodleState.authorTagTimer = setTimeout(() => tag.classList.remove('show'), 1800);
}

function redrawDoodles() {
  const ctx = doodleState.ctx;
  const c = doodleState.canvas;
  if (!ctx || !c) return;
  ctx.clearRect(0, 0, c.width, c.height);
  // Persisted strokes
  for (const s of doodleState.strokes) drawStroke(s);
  // Local optimistic strokes (not yet confirmed)
  for (const s of doodleState.pending) drawStroke(s);
  // Stroke currently being drawn
  if (doodleState.current) drawStroke(doodleState.current);
}

function drawStroke(s) {
  const pts = s.points;
  if (!pts || pts.length === 0) return;
  const ctx = doodleState.ctx;
  const w = doodleState.canvas.width;
  const h = doodleState.canvas.height;
  const lineW = Math.max(0.5, (s.width || 3)) * doodleState.dpr;
  const isErase = s.color === DOODLE_ERASE;
  ctx.save();
  if (isErase) {
    // Carve out previously drawn pixels so the stage background shows through.
    ctx.globalCompositeOperation = 'destination-out';
    ctx.strokeStyle = '#000';
    ctx.fillStyle = '#000';
  } else {
    ctx.strokeStyle = s.color || '#ffffff';
    ctx.fillStyle = s.color || '#ffffff';
  }
  ctx.lineWidth = lineW;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (pts.length === 1) {
    // Single tap → small dot
    ctx.beginPath();
    ctx.arc(pts[0][0] * w, pts[0][1] * h, lineW / 2, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.beginPath();
    ctx.moveTo(pts[0][0] * w, pts[0][1] * h);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0] * w, pts[i][1] * h);
    ctx.stroke();
  }
  ctx.restore();
}

function doodleEventToNormalized(e) {
  const rect = doodleState.canvas.getBoundingClientRect();
  return [
    (e.clientX - rect.left) / rect.width,
    (e.clientY - rect.top) / rect.height,
  ];
}

function onDoodlePointerDown(e) {
  if (!doodleState.canvas) return;
  e.preventDefault();
  try { doodleState.canvas.setPointerCapture(e.pointerId); } catch {}
  const pt = doodleEventToNormalized(e);
  const isErase = doodleState.tool === 'erase';
  doodleState.current = {
    author: state.currentUser,
    color: isErase ? DOODLE_ERASE : doodleState.color,
    // Eraser is a bit chunkier than the matching pen size for usability
    width: isErase ? Math.max(doodleState.width * 3, 14) : doodleState.width,
    points: [pt],
  };
  redrawDoodles();
}

function onDoodlePointerMove(e) {
  if (!doodleState.current) return;
  e.preventDefault();
  const pt = doodleEventToNormalized(e);
  const last = doodleState.current.points[doodleState.current.points.length - 1];
  // Skip near-duplicate points to keep payload small
  if (last && Math.abs(pt[0] - last[0]) < 0.001 && Math.abs(pt[1] - last[1]) < 0.001) return;
  doodleState.current.points.push(pt);
  redrawDoodles();
}

async function onDoodlePointerUp(e) {
  if (!doodleState.current) return;
  try { doodleState.canvas.releasePointerCapture(e.pointerId); } catch {}
  const stroke = doodleState.current;
  doodleState.current = null;
  // Tag with a timestamp so we can match against the DB row when polling
  stroke.created_at = new Date().toISOString();
  // Optimistic local rendering until the insert confirms
  doodleState.pending.push(stroke);
  redrawDoodles();
  try {
    const { data, error } = await supabase.from('doodles').insert({
      author: stroke.author,
      color: stroke.color,
      width: stroke.width,
      points: stroke.points,
    }).select().single();
    if (error) throw error;
    // Append directly to strokes so we don't wait for the next poll
    doodleState.strokes.push(data);
    doodleState.pending = doodleState.pending.filter(p => p !== stroke);
    redrawDoodles();
  } catch (err) {
    console.error('doodle save', err);
    // Leave the pending stroke visible so the user doesn't lose their drawing.
  }
}

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
