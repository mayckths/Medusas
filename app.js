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
// Supabase quitó las transformaciones de imagen del plan free: el
// endpoint /render/image/ devuelve 403 FeatureNotEnabled y TODOS los
// thumbnails quedaban rotos. Probamos una vez al arrancar; si no está
// disponible, caemos a la URL pública original (pesa más, pero carga).
// Si algún día se reactiva (plan Pro o cambio de política), el probe lo
// detecta solo y los thumbnails vuelven sin tocar código.
let imageTransformsAvailable = null; // null = aún no probado
function probeImageTransforms(samplePath) {
  if (imageTransformsAvailable !== null || !samplePath) return;
  imageTransformsAvailable = false; // pesimista hasta que el probe pase
  const probeUrl = supabase.storage.from(BUCKET)
    .getPublicUrl(samplePath, { transform: { width: 32, height: 32, resize: 'contain' } }).data.publicUrl;
  fetch(probeUrl, { method: 'HEAD' }).then(r => {
    if (r.ok) {
      imageTransformsAvailable = true;
      rerenderCurrentPage(); // regenera los <img> con thumbnails livianos
    }
  }).catch(() => {});
}

function publicImageUrl(path, opts) {
  if (!path) return '';
  if (!opts || !imageTransformsAvailable) {
    return supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
  }
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
// ============================================================
// Reducir imágenes antes de subirlas
// Las fotos del teléfono llegan a 4000 px o más y varios MB. Se suben
// con el lado mayor a UPLOAD_MAX_PX como mucho: una foto de iPhone queda
// a la mitad de tamaño y pesa una fracción.
// ============================================================
const UPLOAD_MAX_PX = 2000;
const UPLOAD_JPEG_QUALITY = 0.85;

// Devuelve un File listo para subir. Devuelve el ORIGINAL sin tocar si no
// es una imagen que se pueda reducir (GIF animado, SVG, PDF…), si reducir
// no ahorra nada, o si algo falla: optimizar nunca debe impedir subir.
async function shrinkImageForUpload(file, maxPx = UPLOAD_MAX_PX) {
  if (!file || !/^image\//i.test(file.type || '') || /gif|svg/i.test(file.type)) return file;
  let url = null;
  try {
    url = URL.createObjectURL(file);
    const img = new Image();
    img.src = url;
    await img.decode(); // respeta la orientación EXIF
    const w0 = img.naturalWidth;
    const h0 = img.naturalHeight;
    if (!w0 || !h0) return file;
    const scale = Math.min(1, maxPx / Math.max(w0, h0));
    // Un JPEG que ya cabe se sube intacto (recomprimirlo solo le quita calidad).
    if (scale === 1 && /jpe?g/i.test(file.type)) return file;
    const w = Math.max(1, Math.round(w0 * scale));
    const h = Math.max(1, Math.round(h0 * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, w, h);
    // PNG / WebP solo siguen como PNG si de verdad tienen transparencia;
    // una foto guardada como PNG sale como JPEG, que pesa mucho menos.
    const type = /png|webp/i.test(file.type) && canvasHasAlpha(ctx, w, h) ? 'image/png' : 'image/jpeg';
    const blob = await new Promise(res => canvas.toBlob(res, type, UPLOAD_JPEG_QUALITY));
    if (!blob || blob.size >= file.size) return file;
    const base = String(file.name || 'foto').replace(/\.[^.]*$/, '') || 'foto';
    return new File([blob], `${base}.${type === 'image/png' ? 'png' : 'jpg'}`, { type, lastModified: file.lastModified });
  } catch (e) {
    console.warn('no se pudo reducir la imagen; se sube el original', e);
    return file;
  } finally {
    if (url) URL.revokeObjectURL(url);
  }
}

function canvasHasAlpha(ctx, w, h) {
  try {
    const data = ctx.getImageData(0, 0, w, h).data;
    for (let i = 3; i < data.length; i += 4) if (data[i] < 250) return true;
    return false;
  } catch { return true; } // ante la duda, conservar la transparencia
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

// Floating toast for transient confirmations ("Guardado ✓") and errors.
// Reusable across the app — far more visible than the old inline status
// spans (Nielsen #1, visibility of system status). Auto-dismisses; a new
// toast replaces the current one so they never stack. role=status keeps
// it announced to screen readers.
let _toastTimer = null;
function uiToast(message, opts = {}) {
  const { error = false, duration = 2600 } = opts;
  let host = document.getElementById('ui-toast');
  if (!host) {
    host = document.createElement('div');
    host.id = 'ui-toast';
    host.setAttribute('role', 'status');
    host.setAttribute('aria-live', 'polite');
    document.body.appendChild(host);
  }
  host.textContent = message;
  host.classList.toggle('is-error', !!error);
  // Restart the show animation even if a toast is already up.
  host.classList.remove('show');
  void host.offsetWidth;
  host.classList.add('show');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => host.classList.remove('show'), duration);
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
    markAllSeen('photos', state.photos),
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
  if (hash === '#/fotos' || hash.startsWith('#/fotos/album/')) return markAllSeen('photos', state.photos);
}

// ============================================================
// State
// ============================================================
const state = {
  currentUser: null,
  route: '#/inicio',
  notes: [],
  photos: [],
  places: [],
  chats: [],
  chatNotes: [],
  trips: [],
  tripDays: [],
  tripBookings: [],
  tripFlights: [],
  /* False when the trip tables don't exist yet in Supabase (the section
     shows a setup hint instead of an empty list). */
  tripsReady: false,
  /* Pestaña activa del detalle de viaje. */
  viajeTab: 'itinerario',
  settings: {
    photo_widget: { mode: 'featured', interval_ms: 6000 },
  },
  view: { notas: 'cards' },
  filterTag: { notas: null, lugares: null, fotos: null },
  /* Notas page top-level tab: false (activas) or true (archivadas).
     Archived notes hide from the default view + dashboard but their
     checklist items still count toward the "Metas checkeadas" stat. */
  notasArchived: false,
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

// Modo 'secure': cada dispositivo abre una sesión anónima de Supabase y el
// PIN la vincula a una persona (RPC link_device, verificado en el servidor
// con límite de intentos). Las tablas solo responden a sesiones vinculadas.
// Modo 'legacy': la base aún no tiene esa migración y se usa el login
// anterior, así la app funciona antes y después de correr el SQL.
let authMode = 'legacy';

// Quién tiene la sesión. En modo seguro lo dice el servidor (whoami), no
// localStorage: un nombre guardado sin sesión vinculada no abre nada.
async function resolveSession() {
  const { data, error } = await supabase.rpc('whoami');
  if (error) {
    // Base sin migrar (whoami no existe) o fallo de red: no se toca la
    // sesión guardada — un error transitorio no debe cerrar la sesión.
    authMode = 'legacy';
    return localStorage.getItem(AUTH_KEY);
  }
  authMode = 'secure';
  if (data) localStorage.setItem(AUTH_KEY, data);
  else localStorage.removeItem(AUTH_KEY);
  return data || null;
}

async function tryLogin(name, password) {
  if (authMode === 'secure') {
    const { data: s } = await supabase.auth.getSession();
    if (!s.session) {
      const { error: anonErr } = await supabase.auth.signInAnonymously();
      if (anonErr) {
        throw new Error(/anonymous/i.test(anonErr.message || '')
          ? 'Falta activar "Allow anonymous sign-ins" en Supabase'
          : anonErr.message);
      }
    }
    const { data, error } = await supabase.rpc('link_device', { p_name: name, p_password: password });
    if (error) throw error;
    return !!data;
  }
  const { data, error } = await supabase.rpc('verify_password', { p_name: name, p_password: password });
  if (error) throw error;
  return !!data;
}

function loginAs(name) {
  state.currentUser = name;
  localStorage.setItem(AUTH_KEY, name);
}

// ============================================================
// Notificaciones push (Web Push)
// Cada dispositivo se suscribe desde Configuración → Cuenta; la Edge
// Function "notify" le avisa a la otra persona cuando se crea algo.
// En iPhone solo funciona con la app agregada a la pantalla de inicio.
// ============================================================
const VAPID_PUBLIC_KEY = 'BFs0JOyzbZuLCjxB-_3dIgPqtSlG0iOo37Cqn6CjkwDU7IDEPkJHOgrBEOtO6QFhHxicnRT9QrfRoIq87Ky79d8';
const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent)
  || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches
  || window.navigator.standalone === true;
const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

let swRegistration = null;
async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return null;
  try {
    swRegistration = await navigator.serviceWorker.register('./sw.js');
    // Toque en una notificación con la app ya abierta → ir a la sección.
    navigator.serviceWorker.addEventListener('message', (e) => {
      if (e.data && e.data.type === 'medusas-navigate' && e.data.hash) location.hash = e.data.hash;
      // Llegó un push con la app abierta: el chat (o su aviso de no
      // leídos) se refresca ya en vez de esperar al siguiente sondeo.
      if (e.data && e.data.type === 'medusas-push') reloadChats({ background: true });
    });
  } catch (e) { console.warn('service worker no registrado', e); }
  return swRegistration;
}

function vapidKeyBytes() {
  const b64 = (VAPID_PUBLIC_KEY + '==='.slice((VAPID_PUBLIC_KEY.length + 3) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(b64), c => c.charCodeAt(0));
}

async function currentPushSubscription() {
  if (!pushSupported()) return null;
  const reg = swRegistration || await navigator.serviceWorker.getRegistration();
  return reg ? reg.pushManager.getSubscription() : null;
}

async function savePushSubscription(sub) {
  const j = sub.toJSON();
  const { error } = await supabase.from('push_subscriptions').upsert({
    endpoint: j.endpoint,
    name: state.currentUser,
    p256dh: j.keys.p256dh,
    auth: j.keys.auth,
  }, { onConflict: 'endpoint' });
  if (error) throw error;
}

// Debe llamarse desde un toque del usuario (iOS lo exige para el permiso).
async function enablePush() {
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('No diste permiso para las notificaciones');
  const reg = swRegistration || await registerServiceWorker();
  if (!reg) throw new Error('No se pudo preparar la app para notificaciones');
  await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: vapidKeyBytes() });
  await savePushSubscription(sub);
}

async function disablePush() {
  const sub = await currentPushSubscription();
  if (!sub) return;
  try { await supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint); } catch {}
  try { await sub.unsubscribe(); } catch {}
}

// Al abrir la app: si este dispositivo ya está suscrito, se refresca su
// fila (por si cambió de persona o el sistema renovó la suscripción).
async function syncPushSubscription() {
  try {
    if (!state.currentUser || !pushSupported() || Notification.permission !== 'granted') return;
    const sub = await currentPushSubscription();
    if (sub) await savePushSubscription(sub);
  } catch (e) { console.warn('push sync', e); }
}

// Avisa a la otra persona. Nunca bloquea ni rompe el guardado: si la
// función no existe o falla, solo queda un aviso en consola.
function notifyPartner({ title, body = '', hash = '#/inicio' }) {
  supabase.functions.invoke('notify', { body: { title, body, hash } })
    .then(({ error }) => { if (error) console.warn('notify', error.message || error); })
    .catch((e) => console.warn('notify', e));
}

async function sendTestPush() {
  const { data, error } = await supabase.functions.invoke('notify', {
    body: { title: 'Medusas 🪼', body: 'Las notificaciones funcionan en este dispositivo.', hash: '#/inicio', test: true },
  });
  if (error) throw error;
  return data;
}

async function logout() {
  stopChatBackground();
  // Antes de soltar la sesión: este dispositivo deja de recibir avisos.
  try { await disablePush(); } catch {}
  state.currentUser = null;
  localStorage.removeItem(AUTH_KEY);
  if (authMode === 'secure') {
    try { await supabase.rpc('unlink_device'); } catch {}
    try { await supabase.auth.signOut(); } catch {}
  }
  showLogin();
}

// En modo seguro las RPC que reciben un nombre quedan cerradas; estas
// variantes toman la persona de la sesión vinculada.
async function changePin(oldPin, newPin) {
  const { data, error } = authMode === 'secure'
    ? await supabase.rpc('change_pin', { p_old_password: oldPin, p_new_password: newPin })
    : await supabase.rpc('update_password', { p_name: state.currentUser, p_old_password: oldPin, p_new_password: newPin });
  if (error) throw error;
  return !!data;
}

async function setUserAssets(avatarPath, backgroundPath) {
  const { error } = authMode === 'secure'
    ? await supabase.rpc('set_my_assets', { p_avatar_path: avatarPath, p_background_path: backgroundPath })
    : await supabase.rpc('set_user_assets', { p_name: state.currentUser, p_avatar_path: avatarPath, p_background_path: backgroundPath });
  if (error) throw error;
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
      uiToast(`Error: ${e.message || e}`, { error: true });
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
    { data: photos },
    { data: places },
    { data: chats },
    { data: chatNotes },
    { data: triquiGames },
    { data: trips, error: tripsErr },
    { data: tripDays },
    { data: tripBookings },
    { data: tripFlights },
  ] = await Promise.all([
    supabase.from('notes').select('*').order('pinned', { ascending: false }).order('created_at', { ascending: false }),
    supabase.from('photos').select('*').order('pinned', { ascending: false }).order('created_at', { ascending: false }),
    supabase.from('places').select('*').order('pinned', { ascending: false }).order('created_at', { ascending: false }),
    // Los más recientes primero (y se invierten al guardar): con orden
    // ascendente + limit llegarían los mensajes MÁS VIEJOS del historial.
    supabase.from('chats').select('*').order('created_at', { ascending: false }).limit(CHAT_PAGE),
    // Notas rápidas = mensajes guardados (featured). Van aparte para que
    // no se pierdan cuando el mensaje sale de los últimos CHAT_PAGE.
    supabase.from('chats').select('*').eq('featured', true).order('created_at', { ascending: false }),
    supabase.from('triqui_games').select('*').order('created_at', { ascending: false }).limit(200),
    supabase.from('trips').select('*').order('start_date', { ascending: true }),
    supabase.from('trip_days').select('*').order('day_number', { ascending: true }),
    supabase.from('trip_bookings').select('*').order('datetime', { ascending: true }),
    supabase.from('trip_flights').select('*').order('depart_at', { ascending: true }),
  ]);
  state.notes = notes || [];
  state.photos = photos || [];
  state.places = places || [];
  state.chats = (chats || []).reverse();
  state.chatNotes = chatNotes || [];
  startChatBackground(); // tiempo real + aviso de no leídos en toda la app
  // null = la tabla aún no existe (falta correr el SQL del juego).
  state.triquiGames = triquiGames || null;
  state.trips = trips || [];
  state.tripDays = tripDays || [];
  state.tripBookings = tripBookings || [];
  state.tripFlights = tripFlights || [];
  state.tripsReady = !tripsErr;
  updateSidebarBadges();
  // ¿Siguen disponibles las transformaciones de imagen? (ver publicImageUrl)
  probeImageTransforms(state.photos[0]?.storage_path);
  // Seed the ambient blurred backdrop from a featured photo (or any photo)
  // so it's already there even on non-dashboard routes
  const ambient = state.photos.find(p => p.featured) || state.photos[0];
  if (ambient) setBgPhoto(ambient.storage_path);
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
    'triqui': triquiMyTurn() ? 1 : 0,
    'fotos': state.photos.filter(isUnread).length,
  };
  counts.home = counts.notas + counts.fotos + chatUnreadCount();
  $$('[data-unread]').forEach(el => {
    const c = counts[el.dataset.unread] || 0;
    el.hidden = c === 0;
    el.textContent = c;
  });
  // La barra inferior del teléfono solo tiene sitio para un punto.
  $$('[data-unread-dot]').forEach(el => { el.hidden = !(counts[el.dataset.unreadDot] > 0); });
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

  // ---- Note editor page routing --------------------------------------
  // Hash changes we triggered with the DOM already correct (synchronous
  // open from a tap, or hash restore after a declined discard) only need
  // the route recorded — re-rendering would wipe the user's draft.
  if (noteEditorRouteBypass) {
    noteEditorRouteBypass = false;
    state.route = hash;
    syncMenu();
    return;
  }
  const leavingEditor = (state.route || '').startsWith('#/notas/editor') && !hash.startsWith('#/notas/editor');
  // Leaving with unsaved changes → confirm first (the page equivalent of
  // sheet-dismiss-confirm). Declining restores the editor URL.
  if (leavingEditor && noteEditorDirty()) {
    const ok = await uiConfirm('¿Descartar los cambios de esta nota?', { title: 'Descartar cambios', confirmLabel: 'Descartar', danger: true });
    if (!ok) {
      noteEditorRouteBypass = true;
      location.hash = state.route;
      return;
    }
  }
  if (leavingEditor) hideNoteEditorPage();
  if (hash.startsWith('#/notas/editor')) {
    // Deep link / refresh / history nav into the editor (normal opens go
    // through openNoteEditor, which renders before the hash changes).
    state.route = hash;
    syncMenu();
    if (!state.notes.length) await loadAll();
    const id = hash.slice('#/notas/editor/'.length);
    const note = (hash === '#/notas/editor') ? null : state.notes.find(n => n.id === id);
    if (hash !== '#/notas/editor' && !note) { location.hash = '#/notas'; return; }
    showNoteEditorPage(note);
    return;
  }
  // ---------------------------------------------------------------------

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
    case hash === '#/triqui': renderTriqui(content); break;
    case hash === '#/fotos': renderFotos(content); break;
    case hash.startsWith('#/fotos/album/'): renderAlbumDetail(content, hash.slice('#/fotos/album/'.length)); break;
    case hash === '#/viajes': renderViajes(content); break;
    case hash.startsWith('#/viajes/'): renderViajeDetail(content, hash.slice('#/viajes/'.length)); break;
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

// Debug hooks (QA en preview): permiten inspeccionar el estado e
// invocar un re-render sin pasar por loadAll. No exponen nada sensible
// — la app es privada y el estado ya vive en el cliente.
window.medusasState = state;
window.medusasRerender = () => rerenderCurrentPage();

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
    case hash === '#/triqui': renderTriqui(content); break;
    case hash === '#/fotos': renderFotos(content); break;
    case hash.startsWith('#/fotos/album/'): renderAlbumDetail(content, hash.slice('#/fotos/album/'.length)); break;
    case hash === '#/viajes': renderViajes(content); break;
    case hash.startsWith('#/viajes/'): renderViajeDetail(content, hash.slice('#/viajes/'.length)); break;
    case hash === '#/configuracion': renderConfig(content); break;
  }
}

// ============================================================
// Page: Inicio (dashboard)
// ============================================================
const DEFAULT_DASHBOARD_ORDER = ['notes', 'photos', 'trips'];

function getDashboardOrder() {
  const raw = state.settings.dashboard_order;
  const sections = Array.isArray(raw?.order) ? raw.order : DEFAULT_DASHBOARD_ORDER;
  // Ensure all sections present and no extras
  const known = new Set(DEFAULT_DASHBOARD_ORDER);
  const filtered = sections.filter(s => known.has(s));
  DEFAULT_DASHBOARD_ORDER.forEach(s => { if (!filtered.includes(s)) filtered.push(s); });
  return filtered;
}

// Tracks whether the dashboard has already mounted once in this page
// load. The staggered entry animation only runs on the FIRST renderInicio
// per session — navigating away and back shouldn't re-flash the layout.
// Resets on full reload (module re-evaluates).
let _dashboardEntered = false;

function renderInicio(root) {
  // Apply the entry class BEFORE innerHTML so the children are born with
  // opacity: 0 (ancestor selector applies immediately) and the animation
  // fires on their first paint instead of after a visible flash.
  if (!_dashboardEntered) {
    _dashboardEntered = true;
    root.classList.add('inicio-fresh');
    // Strip the class once the longest stagger has settled so any later
    // partial re-render of the page doesn't re-animate everything.
    setTimeout(() => root.classList.remove('inicio-fresh'), 3000);
  }
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
    photos: `
      <section class="section-block dash-photos-section" data-sec="photos">
        <div class="section-head">
          <h2>Fotos recientes</h2>
          <a href="#/fotos">Ver todas →</a>
        </div>
        <div class="dash-photos-strip" id="dash-photos-grid"></div>
      </section>`,
    trips: `
      <section class="section-block" data-sec="trips">
        <div class="section-head">
          <h2>Viajes</h2>
          <a href="#/viajes">Ver todos →</a>
        </div>
        <div class="dash-trips-strip" id="dash-trips-strip"></div>
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

  // The left column shows the section blocks in the configured order.
  // The right column is the chat + the photo widget under it.
  const greeting = getDashboardGreeting(state.currentUser);
  root.innerHTML = `
    <div class="page-head dash-head">
      <div class="dash-head-text">
        <h1>${escapeHtml(greeting.headline)}</h1>
        ${greeting.sub ? `<div class="sub">${escapeHtml(greeting.sub)}</div>` : ''}
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
        <div class="chat-widget" id="chat-widget">
          <div class="chat-head">
            <div class="chat-tabs" role="tablist" aria-label="Secciones del chat">
              <button type="button" role="tab" data-tab="chat" id="chat-tab-chat">Chat<span class="chat-online" id="chat-online" hidden></span></button>
              <button type="button" role="tab" data-tab="notes" id="chat-tab-notes">Notas rápidas<span class="chat-tab-count" id="chat-notes-count"></span></button>
            </div>
            <button type="button" class="chat-icon-btn chat-search-btn" id="chat-search-btn" aria-label="Buscar en el chat" title="Buscar en el chat"><span class="material-symbols-outlined">search</span></button>
          </div>
          <div class="chat-alert" id="chat-alert" role="status" hidden></div>
          <div class="chat-search" id="chat-search" hidden>
            <span class="material-symbols-outlined">search</span>
            <input type="search" id="chat-search-input" placeholder="Buscar en el chat…" aria-label="Buscar en el chat" autocomplete="off" />
          </div>
          <div class="chat-body" id="chat-body" role="log" aria-live="polite" aria-label="Mensajes"></div>
          <div class="chat-notes" id="chat-notes" hidden></div>
          <div class="chat-results" id="chat-results" hidden></div>
          <div class="chat-typing" id="chat-typing" aria-live="polite" hidden></div>
          <div class="chat-sheet" id="chat-sheet" hidden></div>
          <div class="chat-reply" id="chat-reply" hidden></div>
          <form class="chat-input" id="chat-form" autocomplete="off">
            <button type="button" class="chat-ghost-btn" id="chat-attach" aria-label="Foto, toque o compartir" title="Foto, toque o compartir"><span class="material-symbols-outlined">add_circle</span></button>
            <input type="file" id="chat-photo-input" accept="image/*" hidden />
            <input type="text" id="chat-input-field" maxlength="1000" enterkeyhint="send" aria-label="Mensaje" />
            <button type="button" class="chat-ghost-btn" id="chat-mic" aria-label="Grabar nota de voz" title="Grabar nota de voz" hidden><span class="material-symbols-outlined">mic</span></button>
            <button type="submit" id="chat-send" aria-label="Enviar" title="Enviar"><span class="material-symbols-outlined">arrow_upward</span></button>
          </form>
          <div class="chat-rec" id="chat-rec" hidden>
            <button type="button" class="chat-ghost-btn" id="chat-rec-cancel" aria-label="Descartar grabación" title="Descartar"><span class="material-symbols-outlined">delete</span></button>
            <span class="chat-rec-live"><i></i><span id="chat-rec-time">0:00</span> Grabando…</span>
            <button type="button" id="chat-rec-send" aria-label="Enviar nota de voz" title="Enviar nota de voz"><span class="material-symbols-outlined">arrow_upward</span></button>
          </div>
        </div>
        <div class="photo-widget" id="photo-widget">
          <div class="pw-empty">Aún no hay fotos para mostrar aquí.</div>
        </div>
      </div>
    </div>
  `;

  // Recent notes (3 cards — wider in the 2/3 column). Archived notes
  // stay out of the dashboard so the recent list always reads as
  // "active stuff" — they're still reachable through the Archivadas tab.
  const notesGrid = $('#dash-notes-grid');
  if (notesGrid) {
    const recentNotes = state.notes.filter(n => !n.archived_at).slice(0, 3);
    if (recentNotes.length) recentNotes.forEach(n => notesGrid.appendChild(renderNoteCard(n)));
    else notesGrid.innerHTML = '<div class="empty">Aún no hay notas.</div>';
  }

  // Recent photos
  const photosGrid = $('#dash-photos-grid');
  if (photosGrid) {
    const recentPhotos = state.photos.slice(0, 8);
    if (recentPhotos.length) recentPhotos.forEach((p, i) => photosGrid.appendChild(renderPhoto(p, recentPhotos, i)));
    else photosGrid.innerHTML = '<div class="empty">Aún no hay fotos.</div>';
  }

  // Viajes: los próximos primero, luego en los que ya estuvimos.
  const tripsStrip = $('#dash-trips-strip');
  if (tripsStrip) {
    const trips = sortTripsForDisplay(state.trips);
    if (trips.length) trips.forEach(t => tripsStrip.appendChild(renderTripCard(t)));
    else tripsStrip.innerHTML = '<div class="empty">Aún no hay viajes.</div>';
  }

  // Recent places (max 3)
  const placesGrid = $('#dash-places-grid');
  if (placesGrid) {
    const recentPlaces = state.places.slice(0, 3);
    if (recentPlaces.length) recentPlaces.forEach(p => placesGrid.appendChild(renderPlaceCard(p)));
    else placesGrid.innerHTML = '<div class="empty">Aún no hay lugares.</div>';
  }

  setupChatWidget();
  setupPhotoWidget();
  setupNotifBell();
  // Defer to next paint so layout is committed before we measure.
  requestAnimationFrame(() => {
    fitColRightToViewport();
    // Hide overflowing cards so dashboard sections always show one row
    ['#dash-notes-grid', '#dash-places-grid']
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
  const col = document.querySelector('.col-right');
  if (!col) return;
  col.style.height = '';
  col.style.maxHeight = '';
  sizeChatWidget();
}
if (!window._medusasColResizeWired) {
  window._medusasColResizeWired = true;
  window.addEventListener('resize', () => {
    if (document.querySelector('.col-right')) fitColRightToViewport();
  });
}

// ============================================================
// Relationship stats widget — 4 little cards above the dashboard
// columns that show photos, the next trip and months together.
// ============================================================
const RELATIONSHIP_START = new Date(2026, 3, 25); // April 25, 2026

// Birthdays for contextual greetings. Date as { month: 1-12, day: 1-31 }.
const BIRTHDAYS = {
  Mayck: { month: 12, day: 12 },
  Jaime: { month: 6,  day: 7  },
};

function monthsSince(start) {
  const now = new Date();
  let months = (now.getFullYear() - start.getFullYear()) * 12
             + (now.getMonth() - start.getMonth());
  // Subtract a month if we haven't reached the same day-of-month yet
  if (now.getDate() < start.getDate()) months -= 1;
  return Math.max(0, months);
}

// Build a dashboard headline + subtitle that adapts to the current day.
// Priority (most specific wins): birthday of the user → birthday of the
// partner → fixed festividad (NY, Christmas, etc.) → monthly anniversary
// on the 25th → weekday vibe → time of day fallback.
function getDashboardGreeting(userName) {
  const now = new Date();
  const m = now.getMonth() + 1;
  const d = now.getDate();
  const dow = now.getDay();
  const h = now.getHours();
  const safe = String(userName || 'tú');
  const partner = Object.keys(BIRTHDAYS).find(n => n !== userName) || null;
  const matches = (date) => date && date.month === m && date.day === d;

  // 1. Birthdays
  if (matches(BIRTHDAYS[userName])) {
    return { headline: `Feliz cumpleaños, ${safe}`, sub: 'Que sea un día como tú quieras.' };
  }
  if (partner && matches(BIRTHDAYS[partner])) {
    return { headline: `Hoy es el cumple de ${partner}`, sub: 'No olvides hacerle sentir todo el amor.' };
  }

  // 2. Festividades fijas
  if (m === 1  && d === 1)  return { headline: 'Feliz año nuevo',     sub: 'Un año más para llenar de recuerdos.' };
  if (m === 2  && d === 14) return { headline: 'Feliz San Valentín',  sub: 'Hoy con permiso de exagerar.' };
  if (m === 10 && d === 31) return { headline: 'Feliz Halloween',     sub: 'Que la noche esté divertida.' };
  if (m === 12 && d === 24) return { headline: 'Feliz Nochebuena',    sub: 'Que sea suave y cálida.' };
  if (m === 12 && d === 25) return { headline: `Feliz Navidad, ${safe}`, sub: 'Hoy se celebra estar juntos.' };
  if (m === 12 && d === 31) return { headline: 'Feliz fin de año',    sub: 'Buen cierre, nos vemos del otro lado.' };

  // 3. Aniversario mensual (cada día 25 desde RELATIONSHIP_START)
  if (d === RELATIONSHIP_START.getDate() && now >= RELATIONSHIP_START) {
    const months = monthsSince(RELATIONSHIP_START);
    if (months === 0) return { headline: 'Felices comienzos',    sub: 'Hoy empezó todo.' };
    if (months === 1) return { headline: 'Hoy cumplimos un mes', sub: 'Por muchos más.' };
    if (months % 12 === 0) {
      const years = months / 12;
      return { headline: `Feliz aniversario · ${years} ${years === 1 ? 'año' : 'años'}`, sub: '' };
    }
    return { headline: `Hoy cumplimos ${months} meses`, sub: 'Y los que faltan.' };
  }

  // 4. Día de la semana — solo lunes lleva sub, los demás se quedan
  //    con headline limpio (el sub se omite del template).
  if (dow === 1) return { headline: `Feliz lunes, ${safe}`,     sub: 'Buen inicio de semana.' };
  if (dow === 5) return { headline: `Por fin viernes, ${safe}`, sub: '' };
  if (dow === 6) return { headline: `Buen sábado, ${safe}`,     sub: '' };
  if (dow === 0) return { headline: `Buen domingo, ${safe}`,    sub: '' };

  // 5. Hora del día (fallback ma/mi/ju). Sin rama especial de madrugada
  //    — h<5 cae naturalmente en "Buenos días".
  const sub = 'Este es nuestro lugar seguro';
  if (h < 12) return { headline: `Buenos días, ${safe}`,   sub };
  if (h < 19) return { headline: `Buenas tardes, ${safe}`, sub };
  return         { headline: `Buenas noches, ${safe}`,     sub };
}

// Quick celebration when the user just completed the LAST unchecked
// item of a multi-item checklist: a soft pulse on the checkbox + a
// burst of 8 cream/accent dots radiating outward. Skips for single-
// item lists (no "list" to complete) and for reduced-motion users.
function celebrateChecklistCompletion(checkboxEl) {
  if (!checkboxEl) return;
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  checkboxEl.classList.remove('cl-celebrate'); // restart if mid-flight
  // Force reflow so re-adding the class restarts the animation.
  void checkboxEl.offsetWidth;
  checkboxEl.classList.add('cl-celebrate');
  const burst = document.createElement('span');
  burst.className = 'cl-burst';
  burst.setAttribute('aria-hidden', 'true');
  for (let i = 0; i < 8; i++) {
    const dot = document.createElement('span');
    dot.style.setProperty('--angle', `${i * 45}deg`);
    burst.appendChild(dot);
  }
  // Position relative so the absolute burst children center on the checkbox.
  const prevPos = checkboxEl.style.position;
  if (!prevPos) checkboxEl.style.position = 'relative';
  checkboxEl.appendChild(burst);
  setTimeout(() => {
    burst.remove();
    checkboxEl.classList.remove('cl-celebrate');
    if (!prevPos) checkboxEl.style.position = '';
  }, 700);
}

// Días que faltan para el próximo viaje (el más cercano cuya fecha de
// inicio no haya pasado). null si no hay viajes próximos.
function nextTripStat() {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const upcoming = state.trips
    .filter(t => t.start_date && new Date(t.start_date + 'T23:59:59') >= today)
    .sort((a, b) => a.start_date.localeCompare(b.start_date))[0];
  if (!upcoming) return null;
  // Con fechas tentativas no hay día exacto: se cuentan meses.
  if (isTentativeTrip(upcoming)) {
    return { key: 'next-trip', label: `Meses para ${upcoming.title}`, value: Math.max(0, monthsUntil(upcoming.start_date)) };
  }
  const days = Math.max(0, Math.ceil((new Date(upcoming.start_date + 'T00:00:00') - today) / 86400000));
  return { key: 'next-trip', label: `Días para ${upcoming.title}`, value: days };
}

function renderRelationshipStats() {
  const featuredPhotos = state.photos.filter(p => p.featured).length;
  const months = monthsSince(RELATIONSHIP_START);
  const nextTrip = nextTripStat();
  const stats = [
    { key: 'featured-photos', label: 'Fotos destacadas', value: featuredPhotos },
    ...(nextTrip ? [nextTrip] : []),
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
    + state.photos.filter(isUnread).length;
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
  const showArchived = !!state.notasArchived;
  // Split notes by archived status first so each tab feels self-contained.
  const pool = state.notes.filter(n => !!n.archived_at === showArchived);
  let filtered = pool.slice();
  if (filterTag) filtered = filtered.filter(n => Array.isArray(n.tags) && n.tags.includes(filterTag));

  // Tag counts come from the currently-visible pool so chips don't show
  // tags that only live in the other tab.
  const tagCounts = new Map();
  pool.forEach(n => (n.tags || []).forEach(t => tagCounts.set(t, (tagCounts.get(t) || 0) + 1)));
  const sortedTags = Array.from(tagCounts.entries()).sort((a, b) => b[1] - a[1]);

  // Tab counts (from the full notes set) so "Archivadas" only appears
  // once there is something to look at.
  const activeCount = state.notes.filter(n => !n.archived_at).length;
  const archivedCount = state.notes.filter(n => !!n.archived_at).length;

  root.innerHTML = `
    <div class="page-head">
      <div>
        <h1>Notas</h1>
      </div>
    </div>
    <button class="notes-fab" id="notes-add-btn" type="button" title="Nueva nota" aria-label="Nueva nota"><span class="material-symbols-outlined">add</span></button>
    ${archivedCount > 0 ? `
      <div class="seg-tabs" id="notes-archive-tabs">
        <button class="seg-tab ${!showArchived ? 'active' : ''}" data-archived="0">Activas</button>
        <button class="seg-tab ${showArchived ? 'active' : ''}" data-archived="1">Archivadas</button>
      </div>
    ` : ''}
    ${sortedTags.length ? `
      <div class="tag-filter-row" id="tag-filter-row">
        <button class="tag-chip tag-chip-all ${!filterTag ? 'active' : ''}" data-tag="">Todas</button>
        ${sortedTags.map(([tag]) => `
          <button class="tag-chip ${filterTag === tag ? 'active' : ''}" data-tag="${escapeHtml(tag)}" style="--tag-color: ${tagColor(tag)};">
            #${escapeHtml(tag)}
          </button>
        `).join('')}
      </div>
    ` : ''}
    <div class="grid-cards" id="notes-grid"></div>
  `;

  $('#notes-add-btn').addEventListener('click', () => openNoteEditor(null));
  const archiveTabs = $('#notes-archive-tabs');
  if (archiveTabs) {
    archiveTabs.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-archived]');
      if (!b) return;
      const next = b.dataset.archived === '1';
      if (next === state.notasArchived) return;
      state.notasArchived = next;
      // Changing tab invalidates the active tag filter — counts differ.
      state.filterTag.notas = null;
      renderNotas(root);
    });
  }
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
  // Mobile → 2-column masonry built with plain flex columns.
  // CSS multicol is broken on iOS WebKit (with break-inside: avoid the
  // second column starts mid-page, leaving a phantom gap), so we
  // distribute greedily into the currently-shorter column instead.
  const useMasonry = window.matchMedia('(max-width: 760px)').matches;
  if (useMasonry && filtered.length) {
    grid.classList.add('masonry');
    const colA = document.createElement('div');
    const colB = document.createElement('div');
    colA.className = 'masonry-col';
    colB.className = 'masonry-col';
    grid.append(colA, colB);
    filtered.forEach(n => {
      const target = colA.offsetHeight <= colB.offsetHeight ? colA : colB;
      target.appendChild(renderNoteCard(n));
    });
  } else {
    filtered.forEach(n => grid.appendChild(renderNoteCard(n)));
  }
  if (!filtered.length) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    if (filterTag) empty.textContent = `No hay notas con la etiqueta #${filterTag}.`;
    else if (showArchived) empty.textContent = 'Todavía no hay notas archivadas.';
    grid.appendChild(empty);
  }
}

// Any tap outside an open card/page menu closes it. Single delegated
// listener — per-card document listeners would pile up on re-renders.
document.addEventListener('click', () => {
  $$('.card-menu-popover.open').forEach(p => {
    p.classList.remove('open');
    p.closest('.card')?.classList.remove('menu-raised');
  });
});

// The notes masonry is built at render time (JS picks 2 columns vs
// grid), so crossing the mobile breakpoint needs a re-render.
window.matchMedia('(max-width: 760px)').addEventListener('change', () => {
  if ((state.route || '').startsWith('#/notas') && !(state.route || '').startsWith('#/notas/editor')) {
    rerenderCurrentPage();
  }
});

// Nudge a just-opened popover back inside the viewport (they're
// edge-aligned to their trigger, which can sit at a screen edge).
function clampPopoverX(pop) {
  pop.style.transform = '';
  const r = pop.getBoundingClientRect();
  const vw = window.innerWidth;
  let dx = 0;
  if (r.right > vw - 8) dx = (vw - 8) - r.right;
  else if (r.left < 8) dx = 8 - r.left;
  if (dx) pop.style.transform = `translateX(${dx}px)`;
}

// Colores de nota estilo Keep. Sin color elegido, cada nota toma uno fijo
// derivado de su id, así la cuadrícula se ve variada desde el primer día.
const NOTE_COLORS = [
  { key: 'crema',    label: 'Crema',    hex: '#f9f6f0' },
  { key: 'coral',    label: 'Coral',    hex: '#f8b4ab' },
  { key: 'durazno',  label: 'Durazno',  hex: '#f5b98a' },
  { key: 'arena',    label: 'Arena',    hex: '#f6ecae' },
  { key: 'menta',    label: 'Menta',    hex: '#d7efc6' },
  { key: 'salvia',   label: 'Salvia',   hex: '#b5ddd0' },
  { key: 'niebla',   label: 'Niebla',   hex: '#cfe1ee' },
  { key: 'tormenta', label: 'Tormenta', hex: '#b0cbe0' },
  { key: 'lila',     label: 'Lila',     hex: '#d4c3e6' },
  { key: 'flor',     label: 'Flor',     hex: '#f4d3df' },
];
function autoNoteColorKey(id) {
  const str = String(id || '');
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  return NOTE_COLORS[1 + (h % (NOTE_COLORS.length - 1))].key;
}
function noteColorKey(note) {
  if (note?.color && NOTE_COLORS.some(c => c.key === note.color)) return note.color;
  return note?.id ? autoNoteColorKey(note.id) : 'crema';
}
const noteColorHex = (key) => (NOTE_COLORS.find(c => c.key === key) || NOTE_COLORS[0]).hex;

function renderNoteCard(note) {
  const card = document.createElement('article');
  // Cream notebook card (rediseño Figma) — no tag stripe.
  card.className = 'card clickable note-card';
  card.dataset.id = note.id;
  card.style.setProperty('--note-bg', noteColorHex(noteColorKey(note)));
  // Unique transition name so the browser can morph this card between
  // positions when the list re-renders (e.g., on pin/unpin).
  card.style.viewTransitionName = `note-${cssSafeId(note.id)}`;
  if (note.pinned) card.classList.add('pinned');
  card.setAttribute('role', 'button');
  card.setAttribute('tabindex', '0');

  if (isUnread(note)) {
    const dot = document.createElement('span');
    dot.className = 'unread-dot';
    card.appendChild(dot);
  }

  // Ellipsis menu on the card: anclar / archivar / eliminar.
  const isArchived = !!note.archived_at;
  const menuWrap = document.createElement('div');
  menuWrap.className = 'album-menu-wrap card-menu-wrap';
  menuWrap.innerHTML = `
    <button class="card-menu-btn" type="button" aria-label="Opciones de la nota"><span class="material-symbols-outlined">more_horiz</span></button>
    <div class="album-menu-popover card-menu-popover">
      <button data-action="pin" type="button"><span class="material-symbols-outlined">${note.pinned ? 'keep_off' : 'keep'}</span> ${note.pinned ? 'Desanclar' : 'Anclar'}</button>
      <button data-action="archive" type="button"><span class="material-symbols-outlined">${isArchived ? 'unarchive' : 'archive'}</span> ${isArchived ? 'Desarchivar' : 'Archivar'}</button>
      <button data-action="delete" type="button" class="danger"><span class="material-symbols-outlined">delete</span> Eliminar</button>
    </div>`;
  const menuBtn = menuWrap.querySelector('.card-menu-btn');
  const menuPop = menuWrap.querySelector('.card-menu-popover');
  menuBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    // One open card menu at a time.
    $$('.card-menu-popover.open').forEach(p => {
      if (p !== menuPop) { p.classList.remove('open'); p.closest('.card')?.classList.remove('menu-raised'); }
    });
    const open = menuPop.classList.toggle('open');
    // Each card is its own stacking context (view-transition-name), so
    // the popover can't out-z-index sibling cards — raise the whole card.
    card.classList.toggle('menu-raised', open);
    if (open) clampPopoverX(menuPop);
  });
  menuPop.addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    e.stopPropagation();
    menuPop.classList.remove('open');
    card.classList.remove('menu-raised');
    if (btn.dataset.action === 'pin') {
      const next = !note.pinned;
      await togglePinWithTransition(async () => {
        note.pinned = next;
        await supabase.from('notes').update({ pinned: next }).eq('id', note.id);
        await router();
      });
    } else if (btn.dataset.action === 'archive') {
      const nextValue = isArchived ? null : new Date().toISOString();
      try {
        await supabase.from('notes').update({ archived_at: nextValue }).eq('id', note.id);
        note.archived_at = nextValue;
        uiToast(isArchived ? 'Nota desarchivada' : 'Nota archivada ✓');
        rerenderCurrentPage();
      } catch (err) {
        uiToast(`Error: ${err.message || err}`, { error: true });
      }
    } else if (btn.dataset.action === 'delete') {
      if (!(await uiConfirm(`¿Eliminar "${note.title}"? Esta acción no se puede deshacer.`, { title: 'Eliminar nota', confirmLabel: 'Eliminar', danger: true }))) return;
      try {
        if (Array.isArray(note.images) && note.images.length) {
          try { await supabase.storage.from(BUCKET).remove(note.images); } catch {}
        }
        const { error } = await supabase.from('notes').delete().eq('id', note.id);
        if (error) throw error;
        const i = state.notes.findIndex(n => n.id === note.id);
        if (i !== -1) state.notes.splice(i, 1);
        uiToast('Nota eliminada');
        rerenderCurrentPage();
      } catch (err) {
        uiToast(`Error al eliminar: ${err.message || err}`, { error: true });
      }
    }
  });
  card.appendChild(menuWrap);

  const body = document.createElement('div');
  body.className = 'body';

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
        // Snapshot completion BEFORE flipping so we can detect the
        // "last box checked" transition and celebrate.
        const wasAllDone = (note.checklist || []).length > 0 && (note.checklist || []).every(x => x.done);
        const updated = (note.checklist || []).map((x, i) => i === idx ? { ...x, done: !x.done } : x);
        note.checklist = updated;
        try { await supabase.from('notes').update({ checklist: updated }).eq('id', note.id); } catch (err) { console.error('toggle checklist', err); }
        // Update icon in-place without re-rendering everything
        const nowDone = updated[idx].done;
        checkBtn.classList.toggle('is-done', nowDone);
        row.classList.toggle('is-done', nowDone);
        const span = checkBtn.querySelector('.material-symbols-outlined');
        if (span) span.textContent = nowDone ? 'check_box' : 'check_box_outline_blank';
        // Celebrate when the user just finished the last unchecked box
        // of a multi-item list — single-item lists don't really feel
        // like "completing" anything.
        const isAllDone = updated.every(x => x.done);
        if (isAllDone && !wasAllDone && updated.length > 1) {
          celebrateChecklistCompletion(checkBtn);
        }
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
      // Compact pill: the label if there is one, otherwise just "Link" —
      // raw URLs in the preview were noise (rediseño Figma).
      a.textContent = link.label || 'Link';
      a.addEventListener('click', e => e.stopPropagation());
      lk.appendChild(a);
    });
    body.appendChild(lk);
  }

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

// ============================================================
// Page: Viajes
// ============================================================
// Días expandidos del itinerario (persiste dentro de la sesión).
const expandedTripDays = new Set();

// Icono que describe el día, derivado del título (con fallback por tipo).
// El orden importa: la primera regla que matchea gana.
const TRIP_DAY_ICON_RULES = [
  [/llegada|aterrizaje/, 'flight_land'],
  [/salida|regreso|checkout|aeropuerto/, 'flight_takeoff'],
  [/concierto|bowl|blades|show|festival/, 'music_note'],
  [/observator|planetari|estrellas/, 'stars'],
  [/six flags|magic mountain|universal|disney|parque de diversiones|atraccion/, 'attractions'],
  [/cine|pel[ií]|academy|film/, 'movie'],
  [/playa|costa|beach|malib[uú]|pier|mar\b/, 'beach_access'],
  [/canyon|caminata|hike|sendero|monta[ñn]a|trail/, 'hiking'],
  [/museo|getty|broad|lacma|dataland|arte|galer[ií]a/, 'museum'],
  [/ciencia|science/, 'science'],
  [/compras|shopping|grove|market|outlet/, 'shopping_bag'],
  [/restaurante|cena|comida|brunch/, 'restaurant'],
];
const TRIP_TYPE_ICONS = { transito: 'luggage', trabajo: 'laptop_mac', clase: 'school', libre: 'sunny' };

function tripDayIcon(day) {
  const t = (day.title || '').toLowerCase();
  for (const [re, icon] of TRIP_DAY_ICON_RULES) {
    if (re.test(t)) return icon;
  }
  return TRIP_TYPE_ICONS[day.day_type] || 'sunny';
}
// Reserva a resaltar al saltar desde un chip del itinerario.
let highlightBookingId = null;

// Viajes con fechas tentativas guardan solo meses: date_precision 'month',
// start_date = día 1 del mes inicial, end_date = último día del mes final.
function isTentativeTrip(trip) {
  return trip.date_precision === 'month';
}

function monthsUntil(iso) {
  const now = new Date();
  const d = new Date(iso + 'T00:00:00');
  return (d.getFullYear() - now.getFullYear()) * 12 + (d.getMonth() - now.getMonth());
}

function tripCountdown(trip) {
  if (!trip.start_date) return null;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const start = new Date(trip.start_date + 'T00:00:00');
  const end = trip.end_date ? new Date(trip.end_date + 'T23:59:59') : start;
  if (today > end) return { label: 'Viaje pasado', past: true };
  if (isTentativeTrip(trip)) {
    const m = monthsUntil(trip.start_date);
    return { label: m <= 0 ? 'Este mes ✈️' : `En ~${m} mes${m === 1 ? '' : 'es'} ✈️` };
  }
  if (today >= start) return { label: '¡En viaje! ✈️', now: true };
  const days = Math.ceil((start - today) / 86400000);
  return { label: `Falta${days === 1 ? '' : 'n'} ${days} día${days === 1 ? '' : 's'} ✈️` };
}

// Rango de fechas del viaje. Exactas: "25 sept – 3 oct 2026" (o con día
// de la semana en `long`). Tentativas: "may – jun 2027".
function fmtTripRange(trip, { long = false } = {}) {
  if (!trip.start_date) return '';
  const end = trip.end_date || trip.start_date;
  if (isTentativeTrip(trip)) {
    const s = new Date(trip.start_date + 'T00:00:00');
    const e = new Date(end + 'T00:00:00');
    const month = long ? 'long' : 'short';
    const sameMonth = s.getFullYear() === e.getFullYear() && s.getMonth() === e.getMonth();
    const sameYear = s.getFullYear() === e.getFullYear();
    let out;
    if (sameMonth) out = s.toLocaleDateString('es', { month, year: 'numeric' });
    else if (sameYear) out = `${s.toLocaleDateString('es', { month })} – ${e.toLocaleDateString('es', { month, year: 'numeric' })}`;
    else out = `${s.toLocaleDateString('es', { month, year: 'numeric' })} – ${e.toLocaleDateString('es', { month, year: 'numeric' })}`;
    out = out.charAt(0).toUpperCase() + out.slice(1);
    return long ? `${out} (fechas tentativas)` : out;
  }
  if (long) return `${fmtTripDateLong(trip.start_date)} – ${fmtTripDateLong(end)}`;
  const year = new Date(end + 'T00:00:00').getFullYear();
  if (trip.start_date.slice(0, 7) === end.slice(0, 7)) {
    // Mismo mes: "10 – 15 dic 2026"
    return `${Number(trip.start_date.slice(8, 10))} – ${fmtTripDate(end)} ${year}`;
  }
  return `${fmtTripDate(trip.start_date)} – ${fmtTripDate(end)} ${year}`;
}

// Próximos primero (el más cercano arriba), luego los pasados (el más
// reciente arriba).
function sortTripsForDisplay(trips) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const isPast = t => t.end_date && new Date(t.end_date + 'T23:59:59') < today;
  const upcoming = trips.filter(t => !isPast(t)).sort((a, b) => (a.start_date || '9999').localeCompare(b.start_date || '9999'));
  const past = trips.filter(isPast).sort((a, b) => (b.start_date || '').localeCompare(a.start_date || ''));
  return [...upcoming, ...past];
}

// cover_path puede ser una ruta del storage (app-assets), una URL completa
// o un archivo del propio sitio ('./img/...').
function tripCoverUrl(trip) {
  const p = trip.cover_path;
  if (!p) return null;
  if (/^https?:\/\//.test(p) || p.startsWith('./')) return p;
  return publicAssetUrl(p);
}

// '2026-09-25' → '25 sep'
function fmtTripDate(iso) {
  if (!iso) return '';
  return new Date(iso + 'T00:00:00').toLocaleDateString('es', { day: 'numeric', month: 'short' });
}
// '2026-09-26' → 'Sáb 26 sep'
function fmtTripDateLong(iso) {
  if (!iso) return '';
  const s = new Date(iso + 'T00:00:00').toLocaleDateString('es', { weekday: 'short', day: 'numeric', month: 'short' });
  return s.charAt(0).toUpperCase() + s.slice(1);
}
// Timestamp SIN zona ('2026-09-26T10:00:00') → 'Sáb 26 sep · 10:00 am'.
// Las columnas son TIMESTAMP (sin tz) a propósito: la hora es hora local
// del destino y debe mostrarse igual en cualquier dispositivo.
function fmtTripTs(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '';
  const date = d.toLocaleDateString('es', { weekday: 'short', day: 'numeric', month: 'short' });
  const hasTime = d.getHours() !== 0 || d.getMinutes() !== 0;
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).toLowerCase();
  return `${date.charAt(0).toUpperCase() + date.slice(1)}${hasTime ? ` · ${time}` : ''}`;
}

function renderViajes(root) {
  root.innerHTML = `
    <div class="page-head">
      <div><h1>Viajes</h1></div>
      <button class="add-btn" id="trips-add-btn" type="button" title="Nuevo viaje" aria-label="Nuevo viaje"><span class="material-symbols-outlined">add</span></button>
    </div>
    <div class="trips-list" id="trips-list"></div>
  `;
  $('#trips-add-btn').addEventListener('click', () => openTripEditor());
  const list = $('#trips-list');
  if (!state.tripsReady) {
    list.innerHTML = '<div class="empty">Faltan las tablas de viajes en Supabase — corre el SQL de configuración y recarga.</div>';
    return;
  }
  if (!state.trips.length) {
    list.innerHTML = '<div class="empty">Aún no hay viajes. Crea el primero con el botón +.</div>';
    return;
  }
  sortTripsForDisplay(state.trips).forEach(trip => list.appendChild(renderTripCard(trip)));
}

// Portada original de Los Ángeles: el editor nunca la borra del storage
// al reemplazar portadas.
const TRIP_DEFAULT_COVER_PATH = 'trips/cover-la.jpg';

function renderTripCard(trip) {
  const card = document.createElement('article');
  card.className = 'trip-card';
  const cover = tripCoverUrl(trip);
  // Sin portada: degradé de la paleta (antes caía en la foto de LA).
  if (cover) card.style.backgroundImage = `url("${cover}")`;
  else card.classList.add('no-cover');
  card.setAttribute('role', 'button');
  card.tabIndex = 0;
  const cd = tripCountdown(trip);
  const days = trip.start_date && trip.end_date && !isTentativeTrip(trip)
    ? Math.round((new Date(trip.end_date) - new Date(trip.start_date)) / 86400000) + 1
    : null;
  const bookings = state.tripBookings.filter(b => b.trip_id === trip.id);
  const dates = fmtTripRange(trip);
  card.innerHTML = `
    ${cd ? `<span class="trip-countdown${cd.past ? ' past' : ''}">${escapeHtml(cd.label)}</span>` : ''}
    <div class="trip-card-info">
      <h2>${escapeHtml(trip.title)}</h2>
      <div class="trip-dates">${escapeHtml(dates)}${trip.people ? ` · ${escapeHtml(trip.people)}` : ''}</div>
      <div class="trip-meta">
        ${days ? `<span>${days} días</span>` : ''}
        ${isTentativeTrip(trip) ? '<span>Fechas tentativas</span>' : ''}
        ${bookings.length ? `<span>${bookings.length} reserva${bookings.length === 1 ? '' : 's'}</span>` : ''}
      </div>
    </div>`;
  const open = () => { location.hash = '#/viajes/' + trip.id; };
  card.addEventListener('click', open);
  card.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
  return card;
}

function renderViajeDetail(root, id) {
  const trip = state.trips.find(t => t.id === id);
  if (!trip) { location.hash = '#/viajes'; return; }
  const cd = tripCountdown(trip);
  const tab = state.viajeTab;
  const subParts = [];
  if (trip.start_date) subParts.push(escapeHtml(fmtTripRange(trip, { long: true })));
  if (trip.base) subParts.push(`Base: ${escapeHtml(trip.base)}`);
  if (cd) subParts.push(escapeHtml(cd.label));
  root.innerHTML = `
    <div class="trip-detail-head">
      <a class="trip-back" href="#/viajes" aria-label="Volver a viajes"><span class="material-symbols-outlined">arrow_back_ios_new</span></a>
      <h1>${escapeHtml(trip.title)}</h1>
      <button class="trip-edit-btn" id="trip-edit-btn" type="button" aria-label="Editar viaje"><span class="material-symbols-outlined">edit</span></button>
    </div>
    <div class="trip-subline">${subParts.join(' · ')}</div>
    <div class="seg-tabs" id="trip-tabs">
      <button class="seg-tab ${tab === 'itinerario' ? 'active' : ''}" data-tab="itinerario">Itinerario</button>
      <button class="seg-tab ${tab === 'reservas' ? 'active' : ''}" data-tab="reservas">Reservas</button>
      <button class="seg-tab ${tab === 'vuelos' ? 'active' : ''}" data-tab="vuelos">Vuelos</button>
    </div>
    <div id="trip-tab-body"></div>
  `;
  $('#trip-edit-btn').addEventListener('click', () => openTripEditor(trip));
  $('#trip-tabs').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-tab]');
    if (!b || b.dataset.tab === state.viajeTab) return;
    state.viajeTab = b.dataset.tab;
    renderViajeDetail(root, id);
  });
  const body = $('#trip-tab-body');
  if (tab === 'itinerario') renderTripItinerary(body, trip);
  else if (tab === 'reservas') renderTripBookings(body, trip);
  else renderTripFlights(body, trip);
}

// ---- Itinerario -----------------------------------------------------------
function renderTripItinerary(root, trip) {
  const days = state.tripDays
    .filter(d => d.trip_id === trip.id)
    .sort((a, b) => (a.day_number || 0) - (b.day_number || 0));
  root.innerHTML = `
    <div class="trip-cards" id="days-list"></div>
    <button class="btn primary trip-add-row" id="add-day" type="button"><span class="material-symbols-outlined">add</span> Agregar día</button>
  `;
  $('#add-day').addEventListener('click', () => openDayEditor(trip, null));
  const list = $('#days-list');
  if (!days.length) {
    list.innerHTML = '<div class="empty">Este viaje aún no tiene itinerario. Agrega el primer día.</div>';
    return;
  }
  days.forEach(day => list.appendChild(renderTripDayCard(trip, day)));
}

// Acordeón: colapsado solo muestra icono + "Sáb 26 sept — Getty y costa";
// tocar la fila expande el día completo (bloques, notas y reservas ligadas).
function renderTripDayCard(trip, day) {
  const card = document.createElement('article');
  const expanded = expandedTripDays.has(day.id);
  card.className = 'day-card cream-panel' + (expanded ? ' open' : '');
  const blocks = Array.isArray(day.blocks) ? day.blocks : [];
  const linked = state.tripBookings.filter(b => b.day_id === day.id);
  card.innerHTML = `
    <div class="day-head" role="button" tabindex="0" aria-expanded="${expanded}">
      <span class="day-icon${day.highlight ? ' hl' : ''}"><span class="material-symbols-outlined">${tripDayIcon(day)}</span></span>
      <span class="day-title">${fmtTripDateLong(day.date)}${day.title ? ` — ${escapeHtml(day.title)}` : ''}</span>
      <button class="day-edit" type="button" aria-label="Editar día"><span class="material-symbols-outlined">edit</span></button>
      <span class="material-symbols-outlined day-chevron">expand_more</span>
    </div>
    ${expanded ? `
      <div class="day-body-wrap">
        <div class="day-body">
          ${blocks.map(b => `
            <div class="day-block">
              <span class="db-time">${escapeHtml(b.time || '')}</span>
              <span class="db-text">${escapeHtml(b.text || '')}${b.note ? `<span class="db-note">${escapeHtml(b.note)}</span>` : ''}</span>
            </div>`).join('')}
          ${day.note ? `<div class="day-note">${escapeHtml(day.note)}</div>` : ''}
          ${linked.length ? `<div class="day-tickets">${linked.map(b =>
            `<button class="ticket-chip" type="button" data-booking="${b.id}"><span class="material-symbols-outlined">confirmation_number</span> ${escapeHtml(b.title)}</button>`).join('')}</div>` : ''}
        </div>
      </div>
    ` : ''}
  `;
  const head = card.querySelector('.day-head');
  const toggle = () => {
    if (expanded) {
      expandedTripDays.delete(day.id);
      // Colapso animado: baja el grid a 0fr y re-renderiza al terminar.
      // La expansión la anima el CSS solo (@starting-style) al montar.
      const wrap = card.querySelector('.day-body-wrap');
      const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (wrap && !reduceMotion) {
        card.classList.remove('open'); // el chevron gira de vuelta ya
        wrap.style.gridTemplateRows = '0fr';
        wrap.querySelector('.day-body').style.opacity = '0';
        const finish = () => { if (card.isConnected) card.replaceWith(renderTripDayCard(trip, day)); };
        // Solo el fin de la transición de ALTURA del wrap — el fade del
        // body también burbujea transitionend y remplazaría antes de
        // tiempo (o, con el fallback largo, dejaba una pausa al final).
        wrap.addEventListener('transitionend', (e) => {
          if (e.target === wrap && e.propertyName === 'grid-template-rows') finish();
        });
        setTimeout(finish, 350); // respaldo apenas pasada la transición (300ms)
        return;
      }
    } else {
      expandedTripDays.add(day.id);
    }
    card.replaceWith(renderTripDayCard(trip, day));
  };
  head.addEventListener('click', toggle);
  head.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
  card.querySelector('.day-edit').addEventListener('click', (e) => {
    e.stopPropagation();
    openDayEditor(trip, day);
  });
  // Un chip de reserva salta a la pestaña Reservas y resalta esa card.
  card.querySelectorAll('.ticket-chip').forEach(ch => ch.addEventListener('click', (e) => {
    e.stopPropagation();
    state.viajeTab = 'reservas';
    highlightBookingId = ch.dataset.booking;
    rerenderCurrentPage();
  }));
  return card;
}

// Renumera los días del viaje por fecha (1..n) para que "Día N" siga
// siendo correcto después de agregar, editar o eliminar días.
async function renumberTripDays(tripId) {
  const { data } = await supabase.from('trip_days').select('id, date, day_number').eq('trip_id', tripId);
  const days = (data || []).sort((a, b) =>
    (a.date || '9999-99-99').localeCompare(b.date || '9999-99-99') || (a.day_number || 0) - (b.day_number || 0));
  for (let i = 0; i < days.length; i++) {
    if (days[i].day_number !== i + 1) {
      await supabase.from('trip_days').update({ day_number: i + 1 }).eq('id', days[i].id);
    }
  }
}

// ---- Modal: día del itinerario ----------------------------------------------
const dlgDay = $('#dlg-day');
let dayCtx = { trip: null, day: null };

function dayBlockRow(block = {}) {
  const row = document.createElement('div');
  row.className = 'blk-row';
  row.innerHTML = `
    <input class="blk-time" type="text" placeholder="10:00 am" maxlength="20" value="${escapeHtml(block.time || '')}" />
    <input class="blk-text" type="text" placeholder="Actividad" maxlength="200" value="${escapeHtml(block.text || '')}" />
    <button class="blk-del" type="button" aria-label="Quitar bloque"><span class="material-symbols-outlined">close</span></button>
    <input class="blk-note" type="text" placeholder="Nota (opcional)" maxlength="300" value="${escapeHtml(block.note || '')}" />
  `;
  row.querySelector('.blk-del').addEventListener('click', () => row.remove());
  return row;
}

function readDayBlocks() {
  return $$('#day-blocks .blk-row').map(row => ({
    time: row.querySelector('.blk-time').value.trim(),
    text: row.querySelector('.blk-text').value.trim(),
    note: row.querySelector('.blk-note').value.trim(),
  })).filter(b => b.time || b.text || b.note)
    .map(b => (b.note ? b : { time: b.time, text: b.text }));
}

function openDayEditor(trip, day) {
  dayCtx = { trip, day };
  $('#dlg-day-title').textContent = day ? 'Editar día' : 'Nuevo día';
  $('#day-date').value = day?.date || '';
  $('#day-type').value = day?.day_type || 'libre';
  $('#day-title').value = day?.title || '';
  $('#day-highlight').checked = !!day?.highlight;
  $('#day-note').value = day?.note || '';
  const blocksRoot = $('#day-blocks');
  blocksRoot.innerHTML = '';
  const blocks = Array.isArray(day?.blocks) && day.blocks.length ? day.blocks : [{}];
  blocks.forEach(b => blocksRoot.appendChild(dayBlockRow(b)));
  $('#day-delete').hidden = !day;
  $('#day-status').textContent = '';
  dlgDay.showModal();
}

$('#day-add-block').addEventListener('click', () => {
  const row = dayBlockRow();
  $('#day-blocks').appendChild(row);
  row.querySelector('.blk-time').focus();
});

$('#day-save').addEventListener('click', async () => {
  const { trip, day } = dayCtx;
  if (!trip) return;
  setStatus($('#day-status'), 'Guardando…');
  try {
    const payload = {
      trip_id: trip.id,
      date: $('#day-date').value || null,
      title: $('#day-title').value.trim() || null,
      day_type: $('#day-type').value,
      highlight: $('#day-highlight').checked,
      note: $('#day-note').value.trim() || null,
      blocks: readDayBlocks(),
    };
    if (day) {
      const { error } = await supabase.from('trip_days').update(payload).eq('id', day.id);
      if (error) throw error;
    } else {
      const { error } = await supabase.from('trip_days').insert(payload);
      if (error) throw error;
    }
    await renumberTripDays(trip.id);
    dlgDay.close();
    uiToast(day ? 'Día actualizado ✓' : 'Día agregado ✓');
    await router();
  } catch (e) { setStatus($('#day-status'), `Error: ${e.message || e}`, true); }
});

$('#day-delete').addEventListener('click', async () => {
  const { trip, day } = dayCtx;
  if (!day) return;
  const linked = state.tripBookings.filter(b => b.day_id === day.id).length;
  const extra = linked ? ` Sus ${linked} reserva${linked === 1 ? '' : 's'} ligada${linked === 1 ? '' : 's'} quedará${linked === 1 ? '' : 'n'} sin día asignado.` : '';
  if (!(await uiConfirm(`¿Eliminar este día del itinerario?${extra}`, { title: 'Eliminar día', confirmLabel: 'Eliminar', danger: true }))) return;
  setStatus($('#day-status'), 'Eliminando…');
  try {
    const { error } = await supabase.from('trip_days').delete().eq('id', day.id);
    if (error) throw error;
    await renumberTripDays(trip.id);
    dlgDay.close();
    uiToast('Día eliminado');
    await router();
  } catch (e) { setStatus($('#day-status'), `Error: ${e.message || e}`, true); }
});

// ---- Reservas -------------------------------------------------------------
function renderTripBookings(root, trip) {
  const bookings = state.tripBookings.filter(b => b.trip_id === trip.id);
  root.innerHTML = `
    <div class="trip-cards" id="bookings-list"></div>
    <button class="btn primary trip-add-row" id="add-booking" type="button"><span class="material-symbols-outlined">add</span> Agregar reserva</button>
  `;
  $('#add-booking').addEventListener('click', () => openBookingEditor(trip, null));
  const list = $('#bookings-list');
  if (!bookings.length) {
    list.innerHTML = '<div class="empty">Sin reservas todavía.</div>';
    return;
  }
  bookings.forEach(b => list.appendChild(renderBookingCard(trip, b)));
  if (highlightBookingId) {
    const target = list.querySelector(`[data-id="${highlightBookingId}"]`);
    highlightBookingId = null;
    if (target) {
      target.classList.add('flash');
      requestAnimationFrame(() => target.scrollIntoView({ behavior: 'smooth', block: 'center' }));
      setTimeout(() => target.classList.remove('flash'), 1600);
    }
  }
}

// Un adjunto puede ser un archivo subido al storage ({path}) o un link
// externo, p. ej. Google Drive ({url}).
function attachmentChips(item) {
  const atts = Array.isArray(item.attachments) ? item.attachments : [];
  return atts.filter(a => a && (a.path || a.url)).map(a => {
    const href = a.url || publicImageUrl(a.path);
    return `<a class="ticket-chip solid" href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer" title="${escapeHtml(a.name || '')}"><span class="material-symbols-outlined">confirmation_number</span> ${escapeHtml(a.person || 'Ticket')}</a>`;
  }).join('');
}

function wireConfChip(card, code) {
  const chip = card.querySelector('.conf-chip');
  if (!chip) return;
  chip.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(code);
      uiToast('Confirmación copiada ✓');
    } catch {
      uiToast('No se pudo copiar', { error: true });
    }
  });
}

function renderBookingCard(trip, b) {
  const card = document.createElement('article');
  card.className = 'booking-card cream-panel';
  card.dataset.id = b.id;
  const day = state.tripDays.find(d => d.id === b.day_id);
  const free = !Number(b.cost_usd);
  const subParts = [];
  if (b.datetime) subParts.push(fmtTripTs(b.datetime));
  if (day) subParts.push(`<span class="bk-day">Día ${day.day_number}</span>`);
  if (!free && Number(b.cost_cop)) subParts.push(`$${Number(b.cost_cop).toLocaleString('es-CO')} COP`);
  card.innerHTML = `
    <div class="bk-top">
      <span class="bk-title">${escapeHtml(b.title)}</span>
      <span class="bk-cost ${free ? 'free' : ''}">${free ? 'Gratis' : '$' + Number(b.cost_usd).toLocaleString('en-US')}</span>
    </div>
    ${subParts.length ? `<div class="bk-sub">${subParts.join(' · ')}</div>` : ''}
    <div class="bk-chips">
      ${b.confirmation ? `<button class="conf-chip" type="button" title="Copiar confirmación"><span class="material-symbols-outlined">content_copy</span> ${escapeHtml(b.confirmation)}</button>` : ''}
      ${attachmentChips(b)}
      <button class="bk-edit" type="button" aria-label="Editar reserva"><span class="material-symbols-outlined">edit</span></button>
    </div>`;
  wireConfChip(card, b.confirmation);
  card.querySelector('.bk-edit').addEventListener('click', () => openBookingEditor(trip, b));
  return card;
}

// ---- Vuelos ---------------------------------------------------------------
function renderTripFlights(root, trip) {
  const flights = state.tripFlights.filter(f => f.trip_id === trip.id);
  root.innerHTML = `
    <div class="trip-cards" id="flights-list"></div>
    <button class="btn primary trip-add-row" id="add-flight" type="button"><span class="material-symbols-outlined">add</span> Agregar vuelo</button>
  `;
  $('#add-flight').addEventListener('click', () => openFlightEditor(trip, null));
  const list = $('#flights-list');
  if (!flights.length) {
    list.innerHTML = '<div class="empty">Aún no hay vuelos. Agrégalos cuando los compren ✈️</div>';
    return;
  }
  flights.forEach(f => list.appendChild(renderFlightCard(trip, f)));
}

function renderFlightCard(trip, f) {
  const card = document.createElement('article');
  card.className = 'flight-card cream-panel';
  const name = [f.airline, f.flight_number].filter(Boolean).join(' ');
  const subParts = [];
  if (f.depart_at) subParts.push('Sale ' + fmtTripTs(f.depart_at));
  if (f.arrive_at) subParts.push('Llega ' + fmtTripTs(f.arrive_at));
  card.innerHTML = `
    <div class="bk-top">
      <span class="dir-chip ${f.direction === 'vuelta' ? 'vuelta' : ''}">${f.direction === 'vuelta' ? 'VUELTA' : 'IDA'}</span>
      <span class="bk-title">${escapeHtml(name || 'Vuelo')}</span>
      ${f.depart_airport || f.arrive_airport ? `<span class="fl-route">${escapeHtml(f.depart_airport || '')} → ${escapeHtml(f.arrive_airport || '')}</span>` : ''}
    </div>
    ${subParts.length ? `<div class="bk-sub">${subParts.join(' · ')}</div>` : ''}
    <div class="bk-chips">
      ${f.confirmation ? `<button class="conf-chip" type="button" title="Copiar confirmación"><span class="material-symbols-outlined">content_copy</span> ${escapeHtml(f.confirmation)}</button>` : ''}
      ${attachmentChips(f)}
      <button class="bk-edit" type="button" aria-label="Editar vuelo"><span class="material-symbols-outlined">edit</span></button>
    </div>`;
  wireConfChip(card, f.confirmation);
  card.querySelector('.bk-edit').addEventListener('click', () => openFlightEditor(trip, f));
  return card;
}

// ---- Adjuntos (tickets / pases) -------------------------------------------
// Son documentos (PDF, pases con código QR): se suben tal cual, sin reducir.
async function uploadTripFile(tripId, person, file) {
  const ext = (file.name.split('.').pop() || 'bin').toLowerCase();
  const path = `trips/${tripId}/${crypto.randomUUID()}-${person.toLowerCase()}.${ext}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
    cacheControl: '3600', upsert: false, contentType: file.type || 'application/octet-stream',
  });
  if (error) throw error;
  return { person, path, name: file.name };
}

// Junta adjuntos existentes + archivos recién elegidos en los inputs
// `#{prefix}-file-jaime/mayck`. Reemplaza (y borra del storage) el
// adjunto previo de esa persona si sube uno nuevo.
async function collectTripAttachments(prefix, tripId, existing) {
  const atts = Array.isArray(existing) ? existing.filter(a => a && (a.path || a.url)) : [];
  for (const person of ['Jaime', 'Mayck']) {
    const input = $(`#${prefix}-file-${person.toLowerCase()}`);
    const file = input && input.files && input.files[0];
    if (!file) continue;
    const prevIdx = atts.findIndex(a => a.person === person);
    if (prevIdx >= 0 && atts[prevIdx].path) {
      try { await supabase.storage.from(BUCKET).remove([atts[prevIdx].path]); } catch {}
    }
    const uploaded = await uploadTripFile(tripId, person, file);
    if (prevIdx >= 0) atts[prevIdx] = uploaded; else atts.push(uploaded);
  }
  return atts;
}

function tripAttachmentName(item, person) {
  const a = (item?.attachments || []).find(x => x && x.person === person);
  return a ? '· ' + (a.name || 'archivo') : '';
}

// ---- Modal: viaje (crear / editar) ------------------------------------------
const dlgTrip = $('#dlg-trip');
let tripCtx = null; // viaje en edición (null = nuevo)

// Fechas tentativas: los inputs pasan a type=month ('2027-05') y se
// convierte el valor que hubiera para no perderlo al cambiar de modo.
function setTripTentative(on) {
  $('#trip-tentative').checked = on;
  $('#trip-start-label').textContent = on ? 'Mes de inicio' : 'Inicio';
  $('#trip-end-label').textContent = on ? 'Mes de fin' : 'Fin';
  for (const id of ['#trip-start', '#trip-end']) {
    const input = $(id);
    const v = input.value;
    input.type = on ? 'month' : 'date';
    input.value = !v ? '' : (on ? v.slice(0, 7) : (v.length === 7 ? `${v}-01` : v));
  }
}

// '2027-06' → '2027-06-30'
function lastDayOfMonth(ym) {
  const [y, m] = ym.split('-').map(Number);
  return `${ym}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`;
}

$('#trip-tentative').addEventListener('change', (e) => setTripTentative(e.target.checked));

function openTripEditor(trip = null) {
  tripCtx = trip;
  $('#dlg-trip-title').textContent = trip ? 'Editar viaje' : 'Nuevo viaje';
  $('#trip-title').value = trip?.title || '';
  $('#trip-start').value = '';
  $('#trip-end').value = '';
  setTripTentative(!!trip && isTentativeTrip(trip));
  $('#trip-start').value = isTentativeTrip(trip || {}) ? (trip.start_date || '').slice(0, 7) : (trip?.start_date || '');
  $('#trip-end').value = isTentativeTrip(trip || {}) ? (trip.end_date || '').slice(0, 7) : (trip?.end_date || '');
  $('#trip-people').value = trip?.people ?? 'Jaime & Mayck';
  $('#trip-base').value = trip?.base || '';
  $('#trip-cover-input').value = '';
  $('#trip-cover-name').textContent = trip?.cover_path ? '· portada actual' : '';
  $('#trip-delete').hidden = !trip;
  $('#trip-status').textContent = '';
  dlgTrip.showModal();
  $('#trip-title').focus();
}

$('#trip-cover-input').addEventListener('change', (e) => {
  $('#trip-cover-name').textContent = e.target.files[0]
    ? '· ' + e.target.files[0].name
    : (tripCtx?.cover_path ? '· portada actual' : '');
});

$('#trip-save').addEventListener('click', async () => {
  const title = $('#trip-title').value.trim();
  if (!title) { setStatus($('#trip-status'), 'El destino es obligatorio', true); $('#trip-title').focus(); return; }
  const tentative = $('#trip-tentative').checked;
  let start = $('#trip-start').value || null;
  let end = $('#trip-end').value || null;
  if (tentative) {
    // Solo meses: inicio = día 1, fin = último día del mes final
    // (si no hay mes final, el viaje cabe en el mes de inicio).
    if (!start) { setStatus($('#trip-status'), 'Elige al menos el mes de inicio', true); return; }
    end = lastDayOfMonth(end || start);
    start = `${start}-01`;
  }
  if (start && end && end < start) { setStatus($('#trip-status'), 'El fin no puede ser antes del inicio', true); return; }
  setStatus($('#trip-status'), 'Guardando…');
  const payload = {
    title,
    start_date: start,
    end_date: end,
    people: $('#trip-people').value.trim() || null,
    base: $('#trip-base').value.trim() || null,
  };
  // date_precision solo se envía si hace falta: las fechas exactas ya son
  // el default de la columna, y así crear o editar viajes con fecha
  // exacta funciona aunque la columna aún no exista en la base.
  if (tentative || (tripCtx && 'date_precision' in tripCtx)) {
    payload.date_precision = tentative ? 'month' : 'day';
  }
  try {
    // Portada: se sube a app-assets y se guarda la ruta en cover_path.
    const coverOriginal = $('#trip-cover-input').files[0];
    if (coverOriginal) {
      const coverFile = await shrinkImageForUpload(coverOriginal);
      const ext = (coverFile.name.split('.').pop() || 'jpg').toLowerCase();
      const path = `trips/${crypto.randomUUID()}-cover.${ext}`;
      const { error: upErr } = await supabase.storage.from(APP_ASSETS_BUCKET).upload(path, coverFile, {
        cacheControl: '31536000', upsert: false, contentType: coverFile.type || 'image/jpeg',
      });
      if (upErr) throw upErr;
      payload.cover_path = path;
      // Limpia la portada anterior (nunca la default compartida).
      const old = tripCtx?.cover_path;
      if (old && old !== TRIP_DEFAULT_COVER_PATH) {
        try { await supabase.storage.from(APP_ASSETS_BUCKET).remove([old]); } catch {}
      }
    }
    if (tripCtx) {
      const { error } = await supabase.from('trips').update(payload).eq('id', tripCtx.id);
      if (error) throw error;
      dlgTrip.close();
      uiToast('Viaje actualizado ✓');
      await router();
    } else {
      payload.created_by = state.currentUser;
      const { data, error } = await supabase.from('trips').insert(payload).select().single();
      if (error) throw error;
      dlgTrip.close();
      uiToast('Viaje creado ✓');
      location.hash = '#/viajes/' + data.id;
    }
  } catch (e) {
    // Si la columna cover_path aún no existe en Supabase, guardamos el
    // resto y avisamos qué falta.
    if (payload.cover_path && /cover_path/.test(e.message || '')) {
      delete payload.cover_path;
      try {
        if (tripCtx) await supabase.from('trips').update(payload).eq('id', tripCtx.id);
        else { payload.created_by = state.currentUser; await supabase.from('trips').insert(payload); }
        dlgTrip.close();
        uiToast('Guardado sin portada — corre el SQL de cover_path', { duration: 5000 });
        await router();
        return;
      } catch (e2) { setStatus($('#trip-status'), `Error: ${e2.message || e2}`, true); return; }
    }
    setStatus($('#trip-status'), `Error: ${e.message || e}`, true);
  }
});

$('#trip-delete').addEventListener('click', async () => {
  if (!tripCtx) return;
  const ok = await uiConfirm(
    `¿Eliminar el viaje "${tripCtx.title}"? Se borra todo su itinerario, reservas y vuelos. Esta acción no se puede deshacer.`,
    { title: 'Eliminar viaje', confirmLabel: 'Eliminar todo', danger: true }
  );
  if (!ok) return;
  setStatus($('#trip-status'), 'Eliminando…');
  try {
    // Limpia del storage los adjuntos subidos (los links externos no aplican).
    const paths = [...state.tripBookings, ...state.tripFlights]
      .filter(x => x.trip_id === tripCtx.id)
      .flatMap(x => (x.attachments || []).map(a => a && a.path).filter(Boolean));
    if (paths.length) { try { await supabase.storage.from(BUCKET).remove(paths); } catch {} }
    const { error } = await supabase.from('trips').delete().eq('id', tripCtx.id);
    if (error) throw error;
    dlgTrip.close();
    uiToast('Viaje eliminado');
    location.hash = '#/viajes';
    if (state.route === '#/viajes') await router();
  } catch (e) { setStatus($('#trip-status'), `Error: ${e.message || e}`, true); }
});

// ---- Modal: reserva --------------------------------------------------------
const dlgBooking = $('#dlg-booking');
let bookingCtx = { trip: null, booking: null };

function openBookingEditor(trip, booking) {
  bookingCtx = { trip, booking };
  $('#dlg-booking-title').textContent = booking ? 'Editar reserva' : 'Nueva reserva';
  $('#booking-title').value = booking?.title || '';
  const dt = booking?.datetime ? String(booking.datetime) : '';
  $('#booking-date').value = dt ? dt.slice(0, 10) : '';
  $('#booking-time').value = dt.length >= 16 ? dt.slice(11, 16) : '';
  $('#booking-usd').value = booking?.cost_usd ?? '';
  $('#booking-cop').value = booking?.cost_cop ?? '';
  $('#booking-confirmation').value = booking?.confirmation || '';
  const days = state.tripDays
    .filter(d => d.trip_id === trip.id)
    .sort((a, b) => (a.day_number || 0) - (b.day_number || 0));
  $('#booking-day').innerHTML = '<option value="">Sin día asignado</option>' + days.map(d =>
    `<option value="${d.id}" ${booking?.day_id === d.id ? 'selected' : ''}>Día ${d.day_number} · ${fmtTripDateLong(d.date)}${d.title ? ` — ${escapeHtml(d.title)}` : ''}</option>`
  ).join('');
  $('#booking-file-jaime').value = '';
  $('#booking-file-mayck').value = '';
  $('#booking-file-jaime-name').textContent = tripAttachmentName(booking, 'Jaime');
  $('#booking-file-mayck-name').textContent = tripAttachmentName(booking, 'Mayck');
  $('#booking-delete').hidden = !booking;
  $('#booking-status').textContent = '';
  dlgBooking.showModal();
  $('#booking-title').focus();
}

$('#booking-file-jaime').addEventListener('change', (e) => {
  $('#booking-file-jaime-name').textContent = e.target.files[0] ? '· ' + e.target.files[0].name : tripAttachmentName(bookingCtx.booking, 'Jaime');
});
$('#booking-file-mayck').addEventListener('change', (e) => {
  $('#booking-file-mayck-name').textContent = e.target.files[0] ? '· ' + e.target.files[0].name : tripAttachmentName(bookingCtx.booking, 'Mayck');
});

$('#booking-save').addEventListener('click', async () => {
  const { trip, booking } = bookingCtx;
  if (!trip) return;
  const title = $('#booking-title').value.trim();
  if (!title) { setStatus($('#booking-status'), 'El nombre es obligatorio', true); $('#booking-title').focus(); return; }
  const date = $('#booking-date').value;
  const time = $('#booking-time').value;
  setStatus($('#booking-status'), 'Guardando…');
  try {
    const attachments = await collectTripAttachments('booking', trip.id, booking?.attachments);
    const payload = {
      trip_id: trip.id,
      day_id: $('#booking-day').value || null,
      title,
      datetime: date ? `${date}T${time || '00:00'}:00` : null,
      cost_usd: $('#booking-usd').value === '' ? null : Number($('#booking-usd').value),
      cost_cop: $('#booking-cop').value === '' ? null : Number($('#booking-cop').value),
      confirmation: $('#booking-confirmation').value.trim() || null,
      attachments,
    };
    if (booking) {
      const { error } = await supabase.from('trip_bookings').update(payload).eq('id', booking.id);
      if (error) throw error;
    } else {
      const { error } = await supabase.from('trip_bookings').insert(payload);
      if (error) throw error;
    }
    dlgBooking.close();
    uiToast(booking ? 'Reserva actualizada ✓' : 'Reserva guardada ✓');
    await router();
  } catch (e) { setStatus($('#booking-status'), `Error: ${e.message || e}`, true); }
});

$('#booking-delete').addEventListener('click', async () => {
  const { booking } = bookingCtx;
  if (!booking) return;
  if (!(await uiConfirm(`¿Eliminar la reserva "${booking.title}"?`, { title: 'Eliminar reserva', confirmLabel: 'Eliminar', danger: true }))) return;
  setStatus($('#booking-status'), 'Eliminando…');
  try {
    const paths = (booking.attachments || []).map(a => a && a.path).filter(Boolean);
    if (paths.length) { try { await supabase.storage.from(BUCKET).remove(paths); } catch {} }
    const { error } = await supabase.from('trip_bookings').delete().eq('id', booking.id);
    if (error) throw error;
    dlgBooking.close();
    uiToast('Reserva eliminada');
    await router();
  } catch (e) { setStatus($('#booking-status'), `Error: ${e.message || e}`, true); }
});

// ---- Modal: vuelo ----------------------------------------------------------
const dlgFlight = $('#dlg-flight');
let flightCtx = { trip: null, flight: null };

function openFlightEditor(trip, flight) {
  flightCtx = { trip, flight };
  $('#dlg-flight-title').textContent = flight ? 'Editar vuelo' : 'Nuevo vuelo';
  $('#flight-direction').value = flight?.direction || 'ida';
  $('#flight-airline').value = flight?.airline || '';
  $('#flight-number').value = flight?.flight_number || '';
  $('#flight-from').value = flight?.depart_airport || '';
  $('#flight-to').value = flight?.arrive_airport || '';
  $('#flight-depart').value = flight?.depart_at ? String(flight.depart_at).slice(0, 16) : '';
  $('#flight-arrive').value = flight?.arrive_at ? String(flight.arrive_at).slice(0, 16) : '';
  $('#flight-confirmation').value = flight?.confirmation || '';
  $('#flight-file-jaime').value = '';
  $('#flight-file-mayck').value = '';
  $('#flight-file-jaime-name').textContent = tripAttachmentName(flight, 'Jaime');
  $('#flight-file-mayck-name').textContent = tripAttachmentName(flight, 'Mayck');
  $('#flight-delete').hidden = !flight;
  $('#flight-status').textContent = '';
  dlgFlight.showModal();
}

$('#flight-file-jaime').addEventListener('change', (e) => {
  $('#flight-file-jaime-name').textContent = e.target.files[0] ? '· ' + e.target.files[0].name : tripAttachmentName(flightCtx.flight, 'Jaime');
});
$('#flight-file-mayck').addEventListener('change', (e) => {
  $('#flight-file-mayck-name').textContent = e.target.files[0] ? '· ' + e.target.files[0].name : tripAttachmentName(flightCtx.flight, 'Mayck');
});

$('#flight-save').addEventListener('click', async () => {
  const { trip, flight } = flightCtx;
  if (!trip) return;
  setStatus($('#flight-status'), 'Guardando…');
  try {
    const attachments = await collectTripAttachments('flight', trip.id, flight?.attachments);
    const payload = {
      trip_id: trip.id,
      direction: $('#flight-direction').value,
      airline: $('#flight-airline').value.trim() || null,
      flight_number: $('#flight-number').value.trim() || null,
      depart_airport: $('#flight-from').value.trim() || null,
      arrive_airport: $('#flight-to').value.trim() || null,
      depart_at: $('#flight-depart').value ? $('#flight-depart').value + ':00' : null,
      arrive_at: $('#flight-arrive').value ? $('#flight-arrive').value + ':00' : null,
      confirmation: $('#flight-confirmation').value.trim() || null,
      attachments,
    };
    if (flight) {
      const { error } = await supabase.from('trip_flights').update(payload).eq('id', flight.id);
      if (error) throw error;
    } else {
      const { error } = await supabase.from('trip_flights').insert(payload);
      if (error) throw error;
    }
    dlgFlight.close();
    uiToast(flight ? 'Vuelo actualizado ✓' : 'Vuelo guardado ✓');
    await router();
  } catch (e) { setStatus($('#flight-status'), `Error: ${e.message || e}`, true); }
});

$('#flight-delete').addEventListener('click', async () => {
  const { flight } = flightCtx;
  if (!flight) return;
  if (!(await uiConfirm('¿Eliminar este vuelo?', { title: 'Eliminar vuelo', confirmLabel: 'Eliminar', danger: true }))) return;
  setStatus($('#flight-status'), 'Eliminando…');
  try {
    const paths = (flight.attachments || []).map(a => a && a.path).filter(Boolean);
    if (paths.length) { try { await supabase.storage.from(BUCKET).remove(paths); } catch {} }
    const { error } = await supabase.from('trip_flights').delete().eq('id', flight.id);
    if (error) throw error;
    dlgFlight.close();
    uiToast('Vuelo eliminado');
    await router();
  } catch (e) { setStatus($('#flight-status'), `Error: ${e.message || e}`, true); }
});

// ============================================================
// Page: Triqui (tres en línea por turnos, cada uno en su celular)
// Una fila de triqui_games por partida. X siempre empieza; quien empieza
// se alterna entre partidas. El marcador sale del historial.
// ============================================================
const TRIQUI_LINES = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];
function triquiWinLine(board) {
  return TRIQUI_LINES.find(([a, b, c]) => board[a] !== '.' && board[a] === board[b] && board[b] === board[c]) || null;
}
function triquiPlayers() {
  const names = state._userAssets ? Object.keys(state._userAssets) : ['Jaime', 'Mayck'];
  const me = state.currentUser;
  return { me, partner: names.find(n => n !== me) || 'tu pareja' };
}
const triquiCurrent = () => (state.triquiGames && state.triquiGames[0]) || null;
function triquiTurnName(g) { return g.turn === 'X' ? g.x_player : g.o_player; }
function triquiMyTurn() {
  const g = triquiCurrent();
  return !!g && g.status === 'playing' && triquiTurnName(g) === state.currentUser;
}

async function triquiFetch() {
  const { data, error } = await supabase.from('triqui_games').select('*').order('created_at', { ascending: false }).limit(200);
  if (error) return false;
  const changed = JSON.stringify(data) !== JSON.stringify(state.triquiGames);
  state.triquiGames = data || [];
  return changed;
}

async function triquiNewGame() {
  const { me, partner } = triquiPlayers();
  const last = triquiCurrent();
  // Alterna quién empieza; la primera partida la abre quien la crea.
  const starter = last ? (last.x_player === me ? partner : me) : me;
  const other = starter === me ? partner : me;
  const { error } = await supabase.from('triqui_games').insert({ x_player: starter, o_player: other });
  if (error) { uiToast(`No se pudo crear la partida: ${error.message}`, { error: true }); return; }
  await triquiFetch();
  rerenderCurrentPage(); updateSidebarBadges();
  notifyPartner({
    title: 'Triqui: partida nueva',
    body: starter === me ? `${me} empieza. Espera tu turno.` : `${me} te retó. ¡Empiezas tú!`,
    hash: '#/triqui',
  });
}

let triquiBusy = false;
async function triquiPlay(index) {
  const g = triquiCurrent();
  if (triquiBusy || !g || g.status !== 'playing' || g.board[index] !== '.' || !triquiMyTurn()) return;
  triquiBusy = true;
  try {
    const { me } = triquiPlayers();
    const board = g.board.slice(0, index) + g.turn + g.board.slice(index + 1);
    const won = !!triquiWinLine(board);
    const draw = !won && !board.includes('.');
    const patch = {
      board,
      turn: g.turn === 'X' ? 'O' : 'X',
      status: won ? 'won' : draw ? 'draw' : 'playing',
      winner: won ? me : null,
      updated_at: new Date().toISOString(),
    };
    // El filtro por el tablero anterior evita pisar una jugada que llegó
    // mientras tanto: si no coincide, no actualiza nada y se recarga.
    const { data, error } = await supabase.from('triqui_games').update(patch)
      .eq('id', g.id).eq('board', g.board).eq('status', 'playing').select('id');
    if (error) throw error;
    if (data && data.length) {
      Object.assign(g, patch);
      notifyPartner({
        title: won ? `Triqui: ganó ${me} 🏆` : draw ? 'Triqui: empate' : 'Triqui: te toca',
        body: won ? '¿Revancha?' : draw ? 'Nadie ganó esta vez.' : `${me} ya jugó.`,
        hash: '#/triqui',
      });
    } else {
      await triquiFetch();
    }
  } catch (e) {
    uiToast(`No se pudo jugar: ${e.message || e}`, { error: true });
  } finally {
    triquiBusy = false;
  }
  rerenderCurrentPage(); updateSidebarBadges();
}

function renderTriqui(root) {
  const { me, partner } = triquiPlayers();
  if (state.triquiGames === null) {
    root.innerHTML = `
      <div class="page-head"><div><h1>Triqui</h1></div></div>
      <div class="triqui-panel"><p class="triqui-status">Falta un paso para activar el juego: correr el SQL de Triqui en Supabase.</p></div>`;
    return;
  }
  const games = state.triquiGames;
  const g = triquiCurrent();
  const wins = (n) => games.filter(x => x.status === 'won' && x.winner === n).length;
  const draws = games.filter(x => x.status === 'draw').length;
  const line = g ? triquiWinLine(g.board) : null;
  const myTurn = triquiMyTurn();
  const myMark = g ? (g.x_player === me ? 'X' : 'O') : '';

  let status = 'Aún no hay partidas. ¡Empieza la primera!';
  if (g) {
    if (g.status === 'playing') status = myTurn ? `Tu turno — juegas con ${myMark}` : `Turno de ${escapeHtml(triquiTurnName(g))}…`;
    else if (g.status === 'draw') status = 'Empate 🤝';
    else status = g.winner === me ? '¡Ganaste! 🏆' : `Ganó ${escapeHtml(g.winner || '')}`;
  }

  root.innerHTML = `
    <div class="page-head"><div><h1>Triqui</h1></div></div>
    <div class="triqui-panel">
      <div class="triqui-score" aria-label="Marcador">
        <div class="triqui-score-cell"><span class="n">${wins(me)}</span><span class="l">${escapeHtml(me)}</span></div>
        <div class="triqui-score-cell"><span class="n">${draws}</span><span class="l">Empates</span></div>
        <div class="triqui-score-cell"><span class="n">${wins(partner)}</span><span class="l">${escapeHtml(partner)}</span></div>
      </div>
      <p class="triqui-status ${myTurn ? 'is-mine' : ''}" role="status" aria-live="polite">${status}</p>
      ${g ? `
        <div class="triqui-board ${myTurn ? 'can-play' : ''}" id="triqui-board" role="grid" aria-label="Tablero">
          ${g.board.split('').map((c, i) => `
            <button type="button" class="triqui-cell ${c === 'X' ? 'is-x' : c === 'O' ? 'is-o' : ''} ${line && line.includes(i) ? 'is-win' : ''}"
              data-i="${i}" ${c !== '.' || !myTurn ? 'disabled' : ''}
              aria-label="Casilla ${i + 1}: ${c === '.' ? 'vacía' : c}">${c === '.' ? '' : c}</button>`).join('')}
        </div>` : ''}
      ${!g || g.status !== 'playing' ? `
        <button class="btn primary triqui-new" id="triqui-new" type="button">
          <span class="material-symbols-outlined">replay</span> ${g ? 'Nueva partida' : 'Empezar partida'}
        </button>` : ''}
    </div>`;

  const boardEl = $('#triqui-board');
  if (boardEl) boardEl.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-i]');
    if (b && !b.disabled) triquiPlay(Number(b.dataset.i));
  });
  const newBtn = $('#triqui-new');
  if (newBtn) newBtn.addEventListener('click', async () => { newBtn.disabled = true; await triquiNewGame(); });
}

// Mientras la página del juego está abierta y visible, consulta cada
// pocos segundos por si el otro ya jugó.
setInterval(async () => {
  if (state.route !== '#/triqui' || document.visibilityState !== 'visible') return;
  if (!state.currentUser || state.triquiGames === null || triquiBusy) return;
  if (await triquiFetch()) { rerenderCurrentPage(); updateSidebarBadges(); }
}, 4000);

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

// Fluid mosaic sizing: pick a column count from the available content
// width so the mosaic stretches to 100% of the page width on any
// monitor. The hero is twice as wide as a small tile; each extra column
// adds one stacked-pair of small tiles. Tile target ≈ 280px so wide
// screens get more photos automatically.
function computeMosaicLayout() {
  const w = window.innerWidth;
  const sidebarVisible = w > 760;
  const sidebar = sidebarVisible ? 240 : 0;
  const sidePadding = sidebarVisible ? 80 : 32;
  const content = Math.max(320, w - sidebar - sidePadding);
  const SMALL_TILE_TARGET = 280;
  const HERO_W = SMALL_TILE_TARGET * 2;
  const remaining = content - HERO_W;
  const smallCols = Math.max(1, Math.round(remaining / SMALL_TILE_TARGET));
  const columns = 1 + smallCols;     // hero col + N small-tile columns
  const tiles = 1 + smallCols * 2;    // hero + 2 stacked per small col
  return { columns, tiles };
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
        <button class="add-btn" id="upload-btn" type="button" title="Subir fotos" aria-label="Subir fotos"><span class="material-symbols-outlined">add</span></button>
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
        <button class="add-btn" id="upload-btn" type="button" title="Subir fotos" aria-label="Subir fotos"><span class="material-symbols-outlined">add</span></button>
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
  // Album detail uses a uniform-aspect grid (portrait 3:4) so the page
  // reads like a contact sheet instead of a Pinterest jumble. gridSlot
  // tells renderPhoto to skip the per-photo masonry aspect.
  photos.forEach((p, i) => grid.appendChild(renderPhoto(p, photos, i, { gridSlot: true })));
}

function renderAlbumSection(name, photos) {
  const isUnnamed = !name;
  const displayName = isUnnamed ? 'Sin álbum' : name;
  const slug = albumSlugFor(name);

  // Hero mosaic layout (ref 4): 1 large photo + a column of stacked tiles
  // on the right. The slot count + column count grow with viewport so
  // wide screens fill 100% of the content width instead of leaving the
  // mosaic capped at some max. The last visible tile gets a "+N · Ver
  // todas" overlay when there are still more photos beyond what fits.
  const layout = photos.length === 1 ? 'single' : photos.length === 2 ? 'pair' : 'hero';
  const mosaicLayout = computeMosaicLayout();
  const visibleCount = layout === 'hero'
    ? Math.min(mosaicLayout.tiles, photos.length)
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
  if (layout === 'hero') {
    // Inline the column count so the mosaic stretches with the viewport.
    // "2fr" gives the hero column twice the width of each small tile,
    // then each small column is 1fr. minmax(0, …) keeps long content
    // from blowing out the grid.
    const smallCols = Array(mosaicLayout.columns - 1).fill('minmax(0, 1fr)').join(' ');
    mosaic.style.gridTemplateColumns = `minmax(0, 2fr) ${smallCols}`;
  }
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
    // of replacing it — keeps the photo recognizable as a preview. The
    // click must NOT open the lightbox (which the parent tile listens
    // for) — only navigate to the album page.
    const lastTile = mosaic.lastElementChild;
    const moreEl = document.createElement('a');
    moreEl.className = 'mosaic-more';
    moreEl.href = `#/fotos/album/${slug}`;
    moreEl.innerHTML = `<span>+${more} · Ver todas</span>`;
    moreEl.addEventListener('click', (e) => e.stopPropagation());
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
    if (menu.classList.contains('open')) clampPopoverX(menu);
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
    // Filas primero: si la base las rechaza no se borran los archivos
    // (si no, quedaban fotos rotas). Con RLS un borrado sin permiso no da
    // error, solo borra 0 filas — por eso se pide el resultado.
    const { data: deleted, error } = await supabase.from('photos').delete().in('id', Array.from(ids)).select('id');
    if (error) throw error;
    if (!deleted?.length) throw new Error('sin permiso — vuelve a iniciar sesión');
    if (paths.length) {
      try { await supabase.storage.from(BUCKET).remove(paths); } catch (e) { console.warn('storage cleanup failed', e); }
    }
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
  actions.innerHTML = `<button title="${p.pinned ? 'Desanclar' : 'Anclar'}" aria-label="${p.pinned ? 'Desanclar' : 'Anclar'}" class="${p.pinned ? 'is-on' : ''}" data-action="pin"><span class="material-symbols-outlined" style="font-size:16px;">keep</span></button>`;
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
  photos: 'Fotos recientes',
  trips: 'Viajes',
  places: 'Lugares recientes',
};

let configActiveTab = 'apariencia';

function renderConfig(root) {
  const tabs = [
    { id: 'apariencia', icon: 'palette', label: 'Apariencia' },
    { id: 'perfil', icon: 'account_circle', label: 'Perfil' },
    { id: 'cuenta', icon: 'lock', label: 'Cuenta' },
  ];

  root.innerHTML = `
    <div class="page-head">
      <div>
        <h1>Configuración</h1>
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
    case 'apariencia': renderConfigApariencia(body); break;
    case 'perfil': renderConfigLogin(body); break;
    case 'cuenta': renderConfigCuenta(body); break;
    // Legacy tab ids (old 4-tab layout) map onto the new 3-tab one.
    case 'dashboard':
    case 'tags': renderConfigApariencia(body); break;
    case 'login': renderConfigLogin(body); break;
    case 'clave':
    case 'logout': renderConfigCuenta(body); break;
    default: renderConfigApariencia(body);
  }
}

// "Apariencia" groups everything visual: dashboard order, app background,
// and tag colors. Each sub-renderer appends its own cards into the body
// (they re-call renderConfigTab on change, which clears + rebuilds here).
function renderConfigApariencia(body) {
  body.innerHTML = '';
  renderConfigDashboard(body);
  renderConfigTags(body);
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
    <div class="settings-card" id="cfg-push-card">
      <h3>Notificaciones</h3>
      <div id="cfg-push-body"></div>
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
      const ok = await changePin(oldp, newp);
      if (!ok) { setStatus(statusEl, 'Clave actual incorrecta', true); return; }
      // Success celebrated via toast; clear the inline error span.
      setStatus(statusEl, '');
      uiToast('Clave cambiada ✓');
      $('#cfg-old-pw').value = ''; $('#cfg-new-pw').value = '';
    } catch (e) { uiToast(`Error: ${e.message || e}`, { error: true }); }
  });
  renderPushSettings();
  $('#cfg-logout').addEventListener('click', async () => {
    if (!(await uiConfirm('¿Cerrar sesión ahora?', { title: 'Cerrar sesión', confirmLabel: 'Cerrar sesión' }))) return;
    await logout();
  });
}

async function renderPushSettings() {
  const box = $('#cfg-push-body');
  if (!box) return;
  const hint = (t) => `<div class="sub" style="color:var(--text-dim);font-size:.82rem;">${t}</div>`;
  if (!pushSupported()) {
    box.innerHTML = hint(isIOS && !isStandalone()
      ? 'En iPhone las notificaciones solo funcionan con la app instalada: en Safari toca <strong>Compartir</strong> → <strong>Agregar a inicio</strong>, ábrela desde el ícono y vuelve aquí.'
      : 'Este navegador no permite notificaciones.');
    return;
  }
  if (Notification.permission === 'denied') {
    box.innerHTML = hint('Están bloqueadas para Medusas en los ajustes del sistema. Actívalas ahí y vuelve a abrir la app.');
    return;
  }
  const sub = Notification.permission === 'granted' ? await currentPushSubscription() : null;
  if (!$('#cfg-push-body')) return; // la pestaña cambió mientras se consultaba
  if (!sub) {
    box.innerHTML = `
      ${hint('Recibe un aviso cuando tu pareja agregue una nota, fotos o música.')}
      <div class="row" style="margin-top:.7rem;">
        <button class="btn primary" id="cfg-push-on"><span class="material-symbols-outlined">notifications_active</span> Activar notificaciones</button>
      </div>`;
    $('#cfg-push-on').addEventListener('click', async (e) => {
      e.currentTarget.disabled = true;
      try { await enablePush(); uiToast('Notificaciones activadas ✓'); }
      catch (err) { uiToast(`No se pudieron activar: ${err.message || err}`, { error: true, duration: 5000 }); }
      renderPushSettings();
    });
    return;
  }
  box.innerHTML = `
    ${hint('Activadas en este dispositivo.')}
    <div class="row" style="margin-top:.7rem;gap:.5rem;flex-wrap:wrap;">
      <button class="btn primary" id="cfg-push-test"><span class="material-symbols-outlined">send</span> Enviar prueba</button>
      <button class="btn" id="cfg-push-off">Desactivar</button>
    </div>`;
  $('#cfg-push-test').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      const r = await sendTestPush();
      if (r && r.sent > 0) uiToast('Prueba enviada — debería llegar en unos segundos');
      else uiToast(`No se pudo entregar: ${r?.failures?.[0]?.detail || r?.error || 'sin dispositivos suscritos'}`, { error: true, duration: 6000 });
    } catch (err) { uiToast(`Error al enviar la prueba: ${err.message || err}`, { error: true, duration: 6000 }); }
    btn.disabled = false;
  });
  $('#cfg-push-off').addEventListener('click', async () => {
    await disablePush();
    uiToast('Notificaciones desactivadas');
    renderPushSettings();
  });
}

function renderConfigDashboard(body) {
  const bg = getBgSetting();
  const order = getDashboardOrder();
  const presets = ['#0a0a0c', '#15151a', '#1a1142', '#1e3a5f', '#3a1d4a', '#0d2616', '#f5f4ee'];

  // Append (not replace) — the parent renderConfigApariencia clears the
  // body once, then this + renderConfigTags each add their own cards.
  body.insertAdjacentHTML('beforeend', `
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
    </div>
  `);

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
    await saveSetting('bg', next);
    uiToast('Fondo actualizado ✓');
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
        uiToast('El archivo no es una imagen', { error: true });
        return;
      }
      uiToast('Subiendo…');
      try {
        const path = await uploadAssetFile(file, 'app-bg');
        const next = { mode: 'image', color: bgColorInput.value || '#0a0a0c', image_path: path };
        await saveSetting('bg', next);
        uiToast('Imagen aplicada ✓');
        // Refresh the card so the preview + Remove button show up
        renderConfigTab(body);
      } catch (err) {
        console.error('bg upload', err);
        uiToast('Error al subir: ' + (err.message || err), { error: true });
      }
    });
  }
  const bgRemoveBtn = $('#cfg-bg-image-remove');
  if (bgRemoveBtn) {
    bgRemoveBtn.addEventListener('click', async () => {
      // Confirm before removing — deletes the uploaded file from storage,
      // which is only recoverable by re-uploading (Nielsen #5).
      if (!(await uiConfirm('¿Quitar la imagen de fondo?', { title: 'Quitar imagen', confirmLabel: 'Quitar', danger: true }))) return;
      if (bg.image_path) {
        try { await supabase.storage.from(APP_ASSETS_BUCKET).remove([bg.image_path]); } catch {}
      }
      await saveSetting('bg', { mode: 'image', color: bgColorInput.value || '#0a0a0c', image_path: null });
      uiToast('Imagen quitada');
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

  // Append — shares the body with the dashboard card (see renderConfigApariencia).
  body.insertAdjacentHTML('beforeend', `
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
    </div>
  `);

  $$('input.tag-color-picker').forEach(input => {
    input.addEventListener('change', async () => {
      const tag = input.dataset.tag;
      const next = { ...(state.settings.tag_colors || {}) };
      next[tag] = input.value;
      await saveSetting('tag_colors', next);
      uiToast('Color guardado ✓');
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
  `;
  setupAssetUploaders();
}

async function uploadAssetFile(original, prefix) {
  const file = await shrinkImageForUpload(original);
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

  renderAssetPreview($('#cfg-avatar-preview'), assets.avatar, false);
  renderAssetPreview($('#cfg-bg-preview'), assets.bg, true);
  renderAssetPreview($('#cfg-default-bg-preview'), defaultBg, true);

  async function pickAndUpload(input, prefix, save) {
    if (!input.files?.length) return;
    const file = input.files[0];
    input.value = '';
    uiToast('Subiendo…');
    try {
      const path = await uploadAssetFile(file, prefix);
      await save(path);
      await refreshUserAssetsLocal();
      uiToast('Guardado ✓');
      setupAssetUploaders(); // refresh previews
    } catch (e) {
      console.error(e);
      uiToast(`Error: ${e.message || e}`, { error: true });
    }
  }

  $('#cfg-avatar-input').addEventListener('change', (e) => pickAndUpload(e.target, `avatars/${me}`, async (path) => {
    await setUserAssets(path, null);
    state._userAssets[me].avatar = path;
  }));

  $('#cfg-bg-input').addEventListener('change', (e) => pickAndUpload(e.target, `backgrounds/${me}`, async (path) => {
    await setUserAssets(null, path);
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
    uiToast('Quitando…');
    try {
      await setUserAssets('', null);
      try { await supabase.storage.from(APP_ASSETS_BUCKET).remove([current]); } catch {}
      state._userAssets[me].avatar = null;
      uiToast('Quitado ✓');
      setupAssetUploaders();
    } catch (e) { uiToast(`Error: ${e.message || e}`, { error: true }); }
  });
  $('#cfg-bg-clear').addEventListener('click', async () => {
    const current = state._userAssets[me]?.bg;
    if (!current) return;
    if (!(await uiConfirm('¿Quitar tu imagen del login?', { title: 'Quitar imagen', confirmLabel: 'Quitar', danger: true }))) return;
    uiToast('Quitando…');
    try {
      await setUserAssets(null, '');
      try { await supabase.storage.from(APP_ASSETS_BUCKET).remove([current]); } catch {}
      state._userAssets[me].bg = null;
      uiToast('Quitada ✓');
      setupAssetUploaders();
    } catch (e) { uiToast(`Error: ${e.message || e}`, { error: true }); }
  });
  $('#cfg-default-bg-clear').addEventListener('click', async () => {
    if (!state._defaultBg) return;
    if (!(await uiConfirm('¿Quitar la foto por defecto?', { title: 'Quitar foto', confirmLabel: 'Quitar', danger: true }))) return;
    uiToast('Quitando…');
    try {
      const old = state._defaultBg;
      await saveSetting('default_background_path', '');
      try { await supabase.storage.from(APP_ASSETS_BUCKET).remove([old]); } catch {}
      state._defaultBg = '';
      uiToast('Quitada ✓');
      setupAssetUploaders();
    } catch (e) { uiToast(`Error: ${e.message || e}`, { error: true }); }
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
    // Re-render the whole Apariencia tab (clears + rebuilds dashboard +
    // tags cards) to refresh the up/down disabled states. Calling
    // renderConfigDashboard alone would append a duplicate set of cards.
    renderConfigApariencia($('#config-body'));
  });

  async function persistOrder() {
    const newOrder = $$('.reorder-item', list).map(el => el.dataset.sec);
    await saveSetting('dashboard_order', { order: newOrder });
    uiToast('Orden actualizado ✓');
  }
}

// ============================================================
// Note editor — full page (#/notas/editor[/{id}]), not a dialog.
// The page participates in document flow, so the iOS keyboard just
// scrolls it like any web page instead of panning a top-layer dialog.
// ============================================================
const noteEditorPage = $('#note-editor-page');
// Where the X / save / delete should navigate back to. Defaults to the
// notes list (also the fallback after a refresh on a deep link).
let noteEditorReturnHash = '#/notas';
// Set when WE change the hash while the DOM is already correct (opening
// synchronously from a tap, or restoring the hash after a declined
// discard) — tells router() to only record the route, not re-render.
let noteEditorRouteBypass = false;
const noteDraft = {
  id: null, title: '', content: '', visibility: 'public',
  links: [], images: [], tags: [], pinned: false, checklist: [], color: 'crema',
};

// Snapshot of the editor state taken at open, used to detect unsaved
// changes before a discard (X button, backdrop click, Escape). Includes
// the live input values — title/body only land in noteDraft on save.
let noteSnapshot = null;
function serializeNoteDraft() {
  return JSON.stringify({
    t: $('#note-title-input').value,
    c: $('#note-plain').value,
    pendingTag: $('#note-tag-input').value.trim(),
    links: noteDraft.links,
    images: noteDraft.images,
    tags: noteDraft.tags,
    checklist: noteDraft.checklist,
    color: noteDraft.color,
  });
}
function noteEditorDirty() {
  return noteSnapshot !== null && serializeNoteDraft() !== noteSnapshot;
}
// Esc closes the editor page (desktop nicety). The router's dirty guard
// still confirms before an unsaved draft is lost. Skipped while a
// ui-dialog (confirm/prompt) is open so Esc dismisses THAT first.
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || noteEditorPage.hidden) return;
  if (document.querySelector('dialog[open]')) return;
  location.hash = noteEditorReturnHash;
});

// Entry point used by cards / the "Nueva nota" CTA. Renders the page
// synchronously (so iOS keeps the tap gesture and opens the keyboard on
// focus) and then records the route in the URL for back/deep-linking.
function openNoteEditor(note) {
  const cur = state.route || location.hash || '#/notas';
  noteEditorReturnHash = cur.startsWith('#/notas/editor') ? '#/notas' : cur;
  showNoteEditorPage(note);
  const target = note ? `#/notas/editor/${note.id}` : '#/notas/editor';
  if (location.hash !== target) {
    noteEditorRouteBypass = true; // page already rendered — router just records
    location.hash = target;
  }
}

function hideNoteEditorPage() {
  noteEditorPage.hidden = true;
  document.body.classList.remove('note-editor-open');
  noteSnapshot = null;
}

function renderNoteColorPicker() {
  const row = $('#note-colors');
  if (!row) return;
  row.innerHTML = NOTE_COLORS.map(c => `
    <button type="button" class="note-color-swatch ${noteDraft.color === c.key ? 'is-on' : ''}" data-color="${c.key}"
      style="--sw:${c.hex}" aria-label="Color ${c.label}" aria-pressed="${noteDraft.color === c.key}" title="${c.label}">
      ${noteDraft.color === c.key ? '<span class="material-symbols-outlined">check</span>' : ''}
    </button>`).join('');
  // El editor se tiñe con el color elegido, como la tarjeta.
  $('#note-editor-page').style.setProperty('--note-bg', noteColorHex(noteDraft.color));
}
$('#note-colors').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-color]');
  if (!b) return;
  noteDraft.color = b.dataset.color;
  renderNoteColorPicker();
});

function showNoteEditorPage(note) {
  noteDraft.id = note?.id || null;
  noteDraft.title = note?.title || '';
  noteDraft.content = note?.content || '';
  noteDraft.visibility = 'public'; // all notes are shared now
  noteDraft.links = Array.isArray(note?.links) ? [...note.links] : [];
  noteDraft.images = Array.isArray(note?.images) ? [...note.images] : [];
  noteDraft.tags = Array.isArray(note?.tags) ? [...note.tags] : [];
  noteDraft.pinned = !!note?.pinned;
  noteDraft.color = note ? noteColorKey(note) : 'crema';
  renderNoteColorPicker();
  noteDraft.archived_at = note?.archived_at || null;
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
  $('#note-tag-input').hidden = true; // (+) chip in suggestions reveals it
  $('#note-status').textContent = '';
  // Bar title mirrors the actual note title (live-synced while typing);
  // falls back to a generic label while it's empty.
  const barTitle = $('#note-bar-title');
  barTitle.dataset.fallback = note ? 'Editar nota' : 'Nueva nota';
  barTitle.textContent = (note?.title || '').trim() || barTitle.dataset.fallback;
  // Save is an icon button now; update its accessible label only.
  $('#note-save').setAttribute('aria-label', note ? 'Actualizar nota' : 'Guardar nota');
  $('#note-delete').hidden = !note;
  // Archive button only makes sense for existing notes. Icon + label
  // flip depending on current state so the same button serves both ways.
  const archiveBtn = $('#note-archive');
  if (archiveBtn) {
    archiveBtn.hidden = !note;
    const archived = !!noteDraft.archived_at;
    archiveBtn.setAttribute('aria-label', archived ? 'Desarchivar' : 'Archivar');
    const ic = archiveBtn.querySelector('.material-symbols-outlined');
    if (ic) ic.textContent = archived ? 'unarchive' : 'archive';
  }
  noteEditorPage.hidden = false;
  document.body.classList.add('note-editor-open'); // hides the app shell
  window.scrollTo(0, 0);
  // Focus the title synchronously (no setTimeout) so iOS keeps the
  // user-gesture context and actually opens the keyboard.
  const titleInput = $('#note-title-input');
  titleInput.focus();
  // For existing notes, drop the caret at the end instead of selecting
  // the whole title — friendlier for quick edits.
  if (note) titleInput.setSelectionRange(titleInput.value.length, titleInput.value.length);
  // Size the body textarea to fit its content. Capped to ~70vh via CSS
  // so long notes don't force a tiny textbox with internal scroll.
  requestAnimationFrame(() => autoGrowTextarea($('#note-plain')));

  // Baseline for the unsaved-changes guard (inputs are populated by now).
  noteSnapshot = serializeNoteDraft();

  if (note && isUnread(note)) markSeen('notes', note);
}

function setNoteVisibility(v) {
  noteDraft.visibility = v;
  $$('#note-visibility button').forEach(b => b.classList.toggle('active', b.dataset.vis === v));
}
function renderNoteLinkChips() {
  const root = $('#note-links');
  root.innerHTML = '';
  noteDraft.links.forEach((link, i) => {
    const chip = document.createElement('span');
    chip.className = 'chip';
    chip.innerHTML = `<span class="material-symbols-outlined" style="font-size:14px;">link</span> <a href="${escapeHtml(link.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(link.label || link.url)}</a> <button type="button" aria-label="Quitar">×</button>`;
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
      const wasAllDone = noteDraft.checklist.length > 0 && noteDraft.checklist.every(it => it.done);
      noteDraft.checklist[i].done = !noteDraft.checklist[i].done;
      const isAllDone = noteDraft.checklist.every(it => it.done);
      renderNoteChecklist();
      // renderNoteChecklist rebuilt every row, so the original check
      // element is orphaned. Re-target the fresh checkbox at the same
      // index so the burst animates on something still in the DOM.
      if (isAllDone && !wasAllDone && noteDraft.checklist.length > 1) {
        const freshCheck = $$('#note-checklist .cl-row')[i]?.querySelector('.cl-check');
        if (freshCheck) celebrateChecklistCompletion(freshCheck);
      }
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

// Reveal / hide the custom-tag input. Hidden by default — tapping the
// existing-tag chips is the primary flow; the (+) chip at the end of the
// suggestions opens this input for a brand-new tag.
function showNoteTagInput(show) {
  const input = $('#note-tag-input');
  input.hidden = !show;
  if (show) input.focus();
  else input.value = '';
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
  // (+) chip → reveals the custom-tag input. Only while the input is
  // hidden; once it's open the chip would be redundant.
  if ($('#note-tag-input').hidden) {
    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'tag-sugg tag-sugg-add';
    add.setAttribute('aria-label', 'Nueva etiqueta');
    add.innerHTML = '<span class="material-symbols-outlined" style="font-size:14px;">add</span>';
    add.addEventListener('click', () => {
      showNoteTagInput(true);
      renderNoteTagSuggestions('');
    });
    root.appendChild(add);
  }
}

function addNoteTag(raw) {
  const t = raw.replace(/^#/, '').trim();
  if (!t) return;
  if (noteDraft.tags.some(x => x.toLowerCase() === t.toLowerCase())) return;
  noteDraft.tags.push(t);
  renderNoteTags();
  renderNoteTagSuggestions($('#note-tag-input').value);
  // Selected chips live at the FRONT of the strip — snap back so the
  // user sees their pick land there.
  const strip = document.querySelector('.note-editor-body .tag-strip');
  if (strip) strip.scrollLeft = 0;
}

$('#note-tag-input').addEventListener('input', (e) => renderNoteTagSuggestions(e.target.value));
$('#note-tag-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ',') {
    e.preventDefault();
    addNoteTag(e.target.value);
    e.target.value = '';
    // Back to the chip-picking flow after adding a custom tag.
    showNoteTagInput(false);
    renderNoteTagSuggestions('');
  } else if (e.key === 'Backspace' && !e.target.value && noteDraft.tags.length) {
    noteDraft.tags.pop();
    renderNoteTags();
    renderNoteTagSuggestions('');
  } else if (e.key === 'Escape') {
    // Close just the tag input, not the whole editor.
    e.preventDefault();
    e.stopPropagation();
    showNoteTagInput(false);
    renderNoteTagSuggestions('');
  }
});
// Empty + lost focus → tuck the input away again. Delayed so a tap on a
// suggestion chip (which fires blur first) still lands on the chip.
$('#note-tag-input').addEventListener('blur', () => {
  setTimeout(() => {
    const input = $('#note-tag-input');
    if (!input.hidden && document.activeElement !== input && !input.value.trim()) {
      showNoteTagInput(false);
      renderNoteTagSuggestions('');
    }
  }, 200);
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
    for (const original of files) {
      const file = await shrinkImageForUpload(original);
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

// The inline save (below the inputs) delegates to the top-bar save —
// it exists because the iOS keyboard can pan the top bar off-screen.
$('#note-save-bottom').addEventListener('click', () => $('#note-save').click());

// X / volver — navigate back; the router's dirty guard confirms if the
// draft has unsaved changes.
$('#note-close').addEventListener('click', () => {
  location.hash = noteEditorReturnHash;
});

// Keep the bar title mirroring the title input while the user types.
$('#note-title-input').addEventListener('input', (e) => {
  const barTitle = $('#note-bar-title');
  barTitle.textContent = e.target.value.trim() || barTitle.dataset.fallback || 'Nueva nota';
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
    color: noteDraft.color,
  };
  setStatus($('#note-status'), 'Guardando…');
  const isUpdate = !!noteDraft.id;
  try {
    // Si la base aún no tiene la columna color, se guarda sin ella.
    const write = async (p) => isUpdate
      ? supabase.from('notes').update(p).eq('id', noteDraft.id)
      : supabase.from('notes').insert(p);
    if (!isUpdate) {
      payload.created_by = state.currentUser;
      payload.seen_by = [state.currentUser];
    }
    let { error } = await write(payload);
    if (error && /color/i.test(error.message || '')) {
      const { color, ...withoutColor } = payload;
      ({ error } = await write(withoutColor));
    }
    if (error) throw error;
    if (!isUpdate) {
      // Las notas privadas no avisan a nadie.
      if (payload.visibility !== 'private') {
        notifyPartner({ title: `${state.currentUser} escribió una nota`, body: payload.title || '', hash: '#/notas' });
      }
    }
    hideNoteEditorPage();
    uiToast(isUpdate ? 'Nota actualizada ✓' : 'Nota guardada ✓');
    location.hash = noteEditorReturnHash; // hashchange → router re-renders
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
    hideNoteEditorPage();
    uiToast('Nota eliminada');
    location.hash = noteEditorReturnHash;
  } catch (e) { setStatus($('#note-status'), `Error al eliminar: ${e.message || e}`, true); }
});

// Archive / desarchivar — flip the archived_at timestamp on the note.
// Archived notes hide from the default Notas view + dashboard recent
// list, but their checklist items keep counting in the dashboard stat
// so the user can keep accumulating "metas checkeadas".
$('#note-archive').addEventListener('click', async () => {
  if (!noteDraft.id) return;
  const note = state.notes.find(n => n.id === noteDraft.id);
  if (!note) return;
  const isArchived = !!note.archived_at;
  const nextValue = isArchived ? null : new Date().toISOString();
  setStatus($('#note-status'), isArchived ? 'Desarchivando…' : 'Archivando…');
  try {
    const { error } = await supabase.from('notes').update({ archived_at: nextValue }).eq('id', note.id);
    if (error) throw error;
    note.archived_at = nextValue;
    noteDraft.archived_at = nextValue;
    hideNoteEditorPage();
    uiToast(nextValue ? 'Nota archivada' : 'Nota desarchivada');
    location.hash = noteEditorReturnHash;
  } catch (e) {
    setStatus($('#note-status'), `Error al ${isArchived ? 'desarchivar' : 'archivar'}: ${e.message || e}`, true);
  }
});

// ============================================================
// Photo upload (drag-drop + multi)
// ============================================================
const dlgPhoto = $('#dlg-photo');
const dz = $('#photo-dropzone');
const uploadList = $('#upload-list');
// Files the user picked but hasn't uploaded yet. Held here until they
// confirm the album in the modal.
let pendingPhotos = [];
// Album to preselect in the upload modal (set when "Subir fotos" is
// pressed from inside an album detail page). Consumed by resetUploadDialog.
let pendingPreselectAlbum = null;
// After a successful upload we jump to this album's detail page (set in
// startConfirmedUpload, read by the dialog's close handler).
let afterUploadAlbumSlug = null;

// "Subir fotos" button entry-point. On mobile this means: open the
// device's photo picker directly instead of a modal. After the user
// selects something, we open the modal asking for the album.
function openPhotoUpload() {
  // If we're inside a named album, preselect it so photos land there
  // by default (the user came here to add to THIS album).
  if (state.route && state.route.startsWith('#/fotos/album/')) {
    const name = albumNameFromSlug(state.route.slice('#/fotos/album/'.length));
    pendingPreselectAlbum = name || null; // skip the unnamed "Sin álbum" bucket
  } else {
    pendingPreselectAlbum = null;
  }
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
  // Preselect the album we came from (album detail page). Otherwise no
  // default — force the user to choose so we don't silently dump photos
  // into the first existing album.
  select.value = (pendingPreselectAlbum && albums.includes(pendingPreselectAlbum))
    ? pendingPreselectAlbum
    : '';
  pendingPreselectAlbum = null; // consume — one-shot
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
  const { row, album, caption } = item;
  row.classList.remove('pending');
  row.classList.add('uploading');
  row.querySelector('.status-icon').textContent = 'cloud_upload';
  const bar = row.querySelector('.progress > div');
  bar.style.width = '15%';
  try {
    const file = await shrinkImageForUpload(item.file);
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
  const failedBefore = uploadList.querySelectorAll('.upload-row.error').length;
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
  // Once the whole queue drains: if everything landed cleanly, close the
  // modal and jump to the album so the user sees the new photos. If any
  // row errored, keep the modal open so they can see what failed.
  const anyError = uploadList.querySelector('.upload-row.error');
  // Un solo aviso por tanda, contando solo las que sí subieron.
  const uploadedOk = uploadList.querySelectorAll('.upload-row.done').length;
  if (uploadedOk > 0) {
    notifyPartner({
      title: `${state.currentUser} subió ${uploadedOk === 1 ? 'una foto' : `${uploadedOk} fotos`}`,
      body: album ? `Álbum: ${album}` : '',
      hash: '#/fotos',
    });
  }
  if (!anyError && uploadDone > 0) {
    afterUploadAlbumSlug = albumSlugFor(album);
    uiToast(`${uploadDone} foto${uploadDone === 1 ? '' : 's'} subida${uploadDone === 1 ? '' : 's'} ✓`);
    dlgPhoto.close();
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
  // If we just finished an upload, land on the album's detail page so
  // the new photos are front and center. router() (via loadAll) fetches
  // the freshly-inserted rows.
  const target = afterUploadAlbumSlug;
  afterUploadAlbumSlug = null;
  if (target) {
    const hash = `#/fotos/album/${target}`;
    if (location.hash === hash) router();   // already there → manual refresh
    else location.hash = hash;              // navigate → hashchange fires router
  } else {
    router();
  }
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
  const img = $('#lightbox-img');
  const spinner = $('#lb-spinner');
  const nextSrc = publicImageUrl(p.storage_path);
  // Always hide the previous frame BEFORE the new src downloads — otherwise
  // the stale photo sits visible for the duration of the new image's
  // network roundtrip. Show the spinner while the next image decodes.
  // A token guards against out-of-order onload events when the user
  // clicks Next several times before the first image arrives.
  if (img.src !== nextSrc) {
    img.classList.add('loading');
    if (spinner) spinner.hidden = false;
    const token = (renderLightbox._token = (renderLightbox._token || 0) + 1);
    const finish = () => {
      if (renderLightbox._token !== token) return; // a newer src superseded us
      img.classList.remove('loading');
      if (spinner) spinner.hidden = true;
    };
    img.onload = finish;
    img.onerror = finish;
    img.src = nextSrc;
  }
  img.alt = p.caption || '';
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
  // Primero la fila: si la base la rechaza, la foto se queda (antes se
  // escondía de la pantalla aunque fallara y volvía al recargar).
  const { data: deleted, error } = await supabase.from('photos').delete().eq('id', p.id).select('id');
  if (error || !deleted?.length) {
    // uiAlert y no uiToast: el visor es un <dialog> modal y taparía el toast.
    uiAlert(`No se pudo eliminar la foto${error ? `: ${error.message}` : ' (sin permiso — vuelve a iniciar sesión)'}`, { title: 'Error' });
    return;
  }
  try { await supabase.storage.from(BUCKET).remove([p.storage_path]); } catch {}
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
  b.innerHTML = `<span class="material-symbols-outlined" style="font-size:16px;">keep</span> ${p ? 'Anclado' : 'Anclar'}`;
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
  dlg.addEventListener('click', async (e) => {
    // Use closest() instead of matches() so clicks on the icon inside
    // the close button (e.g. <span class="material-symbols-outlined">)
    // still trigger the close.
    const wantsClose = e.target === dlg || e.target.closest('[data-close]');
    if (!wantsClose) return;
    dlg.close();
  });
});

// ============================================================
// Chat (dashboard) — ocupa el lugar del tablero de post-its.
// Cada mensaje enviado le avisa a la otra persona con un push.
//
// La tabla chats solo tiene texto (body), así que todo lo que no es un
// mensaje normal viaja como un body con forma "[[tipo:...]]":
//   [[sticker:<archivo>]]            foto enviada como sticker
//   [[voice:<archivo>]]              nota de voz
//   [[share:photo|trip:<id>]]        tarjeta que abre una foto o un viaje
//   [[nudge]]                        toque ("pensando en ti")
//   [[react:<id>:<emoji>]]           reacción a otro mensaje (no se pinta
//                                    como mensaje, se cuelga del original)
//   [[re:<id>|<autor>|<cita>]]texto  respuesta citando otro mensaje
// ============================================================
const CHAT_PAGE = 200;          // últimos N mensajes que se cargan
const CHAT_POLL_MS = 6000;      // sondeo con el chat en pantalla
const CHAT_BG_POLL_MS = 30000;  // sondeo en otras secciones (solo para el aviso de no leídos)
const CHAT_REACTIONS = ['❤️', '😂', '😮', '😢', '👍', '🪼'];
const CHAT_VOICE_MAX_S = 120;
const CHAT_NUDGE_COOLDOWN_MS = 10000;
const CHAT_STICKER_PX = 512;    // lado mayor del sticker que se sube

const CHAT_STICKER_RE = /^\[\[sticker:(sticker-[0-9a-f-]{36}-(\d{1,4})x(\d{1,4})\.(?:jpg|png))\]\]$/;
const CHAT_VOICE_RE = /^\[\[voice:(voice-[0-9a-f-]{36}-(\d{1,3})s\.(?:m4a|webm|ogg))\]\]$/;
const CHAT_REACT_RE = /^\[\[react:([\w-]{1,64}):([^\]\s:]{1,16})\]\]$/;
const CHAT_SHARE_RE = /^\[\[share:(photo|trip):([\w-]{1,64})\]\]$/;
const CHAT_REPLY_RE = /^\[\[re:([\w-]{1,64})\|([^|\]]{0,40})\|([^\]]{0,400})\]\]([\s\S]*)$/;
const CHAT_NUDGE = '[[nudge]]';

let chatPollTimer = null;
let chatBgTimer = null;
let chatSending = false;    // un envío a la vez
let chatMutating = 0;       // reacciones / borrados / notas en curso
// 'ok' | 'none' (la otra persona no tiene avisos activos) | 'error'
let chatNotifyState = 'ok';
// Estado de la tarjeta. Vive fuera del DOM para sobrevivir a un re-render
// de Inicio (que reconstruye el widget).
let chatTab = 'chat';       // 'chat' | 'notes' | 'search'
let chatStick = true;       // ¿la lista está abajo del todo?
let chatDraft = '';
let chatBodyObserver = null;
// Panel inferior: null | {type:'actions', id} | {type:'attach'} |
// {type:'pick-photo'} | {type:'pick-trip'} | {type:'note-list', id}
let chatSheet = null;
let chatReplyTo = null;     // id del mensaje al que se responde
let chatSearchQuery = '';
let chatSearchResults = [];
let chatSearchBusy = false;
let chatSearchSeq = 0;
let chatSearchTimer = null;
let chatLastNudge = 0;
// Tiempo real (presencia + "escribiendo…")
let chatChannel = null;
let chatPartnerOnline = false;
let chatPartnerTyping = false;
let chatTypingTimer = null;
let chatLastTypingSent = 0;
// Notas de voz
let chatRec = null;         // grabación en curso
let chatAudio = null;       // reproductor compartido
let chatPlaying = null;     // archivo que suena

const chatOnScreen = () => !!document.getElementById('chat-widget') && !document.hidden;
const chatStacked = () => window.matchMedia('(max-width: 980px)').matches;
const chatPartner = () => triquiPlayers().partner;
const chatVoiceSupported = () => typeof MediaRecorder !== 'undefined' && !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
const chatFmtSecs = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const chatFind = (id) => state.chats.find(m => String(m.id) === String(id)) || state.chatNotes.find(m => String(m.id) === String(id)) || null;

// ---- Tipos de mensaje ----
function chatParse(body) {
  let x;
  if ((x = CHAT_STICKER_RE.exec(body))) return { kind: 'sticker', path: x[1], w: Number(x[2]) || 1, h: Number(x[3]) || 1, cutout: x[1].endsWith('.png') };
  if ((x = CHAT_VOICE_RE.exec(body))) return { kind: 'voice', path: x[1], secs: Number(x[2]) || 0 };
  if ((x = CHAT_REACT_RE.exec(body))) return { kind: 'react', target: x[1], emoji: x[2] };
  if ((x = CHAT_SHARE_RE.exec(body))) return { kind: 'share', what: x[1], ref: x[2] };
  if (body === CHAT_NUDGE) return { kind: 'nudge' };
  if ((x = CHAT_REPLY_RE.exec(body))) {
    let snippet = x[3];
    try { snippet = decodeURIComponent(x[3]); } catch {}
    return { kind: 'text', text: x[4], reply: { id: x[1], author: x[2], snippet } };
  }
  return { kind: 'text', text: body, reply: null };
}
// Con caché por mensaje: se consulta en cada render.
function chatP(m) {
  const body = String(m.body || '');
  if (m._pb !== body) { m._pb = body; m._p = chatParse(body); }
  return m._p;
}
const chatVisible = () => state.chats.filter(m => chatP(m).kind !== 'react');

// Texto corto que representa un mensaje (citas, avisos, notas, búsqueda).
function chatPreview(m) {
  const p = chatP(m);
  if (p.kind === 'sticker') return '📷 Foto';
  if (p.kind === 'voice') return `🎤 Nota de voz (${chatFmtSecs(p.secs)})`;
  if (p.kind === 'nudge') return '🪼 Toque';
  if (p.kind === 'share') {
    if (p.what === 'trip') { const t = state.trips.find(t => String(t.id) === p.ref); return `✈️ Viaje${t ? `: ${t.title}` : ''}`; }
    return '🖼️ Foto del álbum';
  }
  if (p.kind === 'react') return p.emoji;
  return p.text;
}

// Mensajes de la otra persona que aún no he visto (para el aviso en Inicio).
function chatUnreadCount() {
  const me = state.currentUser;
  if (!me) return 0;
  return chatVisible().filter(m => m.author !== me && !(m.read_by || []).includes(me)).length;
}

// id del mensaje → Map(autor → { emoji, row }). Una reacción por persona.
function chatReactionMap() {
  const map = new Map();
  for (const m of state.chats) {
    const p = chatP(m);
    if (p.kind !== 'react') continue;
    if (!map.has(p.target)) map.set(p.target, new Map());
    map.get(p.target).set(m.author, { emoji: p.emoji, row: m });
  }
  return map;
}

// ============================================================
// Montaje
// ============================================================
function setupChatWidget() {
  const root = $('#chat-widget');
  if (!root) return;
  if (chatPollTimer) { clearInterval(chatPollTimer); chatPollTimer = null; }
  if (chatBodyObserver) { try { chatBodyObserver.disconnect(); } catch {} chatBodyObserver = null; }

  const input = $('#chat-input-field');
  const body = $('#chat-body');
  input.placeholder = `Mensaje para ${chatPartner()}…`;
  input.value = chatDraft;
  input.addEventListener('input', () => {
    chatDraft = input.value;
    updateChatComposer();
    if (input.value) chatSendTyping();
  });
  $('#chat-search-input').value = chatSearchQuery;

  renderChatNotifyHint();
  renderChatBody({ stick: true });
  renderChatNotes();
  renderChatResults();
  renderChatSheet();
  renderChatReply();
  renderChatPresence();
  renderChatTyping();
  updateChatComposer();
  applyChatTab();
  sizeChatWidget();
  markIncomingChatsRead();

  $('#chat-form').addEventListener('submit', (e) => { e.preventDefault(); sendChatMessage(); });
  // Los botones del compositor no deben robarle el foco al campo: en el
  // teléfono eso cierra el teclado después de cada mensaje.
  $('#chat-send').addEventListener('mousedown', (e) => e.preventDefault());

  // "+" → adjuntar (foto, toque, compartir, stickers recientes)
  $('#chat-attach').addEventListener('click', (e) => {
    e.stopPropagation();
    setChatSheet({ type: 'attach' });
  });
  const photoInput = $('#chat-photo-input');
  photoInput.addEventListener('change', () => {
    const file = photoInput.files && photoInput.files[0];
    photoInput.value = ''; // permite volver a elegir la misma foto
    if (file) sendChatSticker(file);
  });

  // Nota de voz
  $('#chat-mic').addEventListener('click', (e) => { e.stopPropagation(); startChatRecording(); });
  $('#chat-rec-cancel').addEventListener('click', (e) => { e.stopPropagation(); stopChatRecording(false); });
  $('#chat-rec-send').addEventListener('click', (e) => { e.stopPropagation(); stopChatRecording(true); });

  // Lista de mensajes
  body.addEventListener('click', onChatListClick);
  body.addEventListener('contextmenu', (e) => {
    const el = e.target.closest('[data-id]');
    if (!el || el.dataset.pending) return;
    e.preventDefault();
    setChatSheet({ type: 'actions', id: el.dataset.id });
  });
  $('#chat-notes').addEventListener('click', onChatListClick);
  $('#chat-results').addEventListener('click', onChatListClick);
  $('#chat-sheet').addEventListener('click', onChatSheetClick);
  $('#chat-reply').addEventListener('click', (e) => {
    if (e.target.closest('[data-act="cancel-reply"]')) { chatReplyTo = null; renderChatReply(); }
  });

  // Pestañas + búsqueda
  $('.chat-tabs', root).addEventListener('click', (e) => {
    const b = e.target.closest('button[data-tab]');
    if (!b) return;
    chatTab = b.dataset.tab;
    setChatSheet(null);
    applyChatTab();
  });
  $('#chat-search-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    chatTab = chatTab === 'search' ? 'chat' : 'search';
    setChatSheet(null);
    applyChatTab();
    if (chatTab === 'search') $('#chat-search-input').focus();
  });
  $('#chat-search-input').addEventListener('input', (e) => {
    chatSearchQuery = e.target.value;
    clearTimeout(chatSearchTimer);
    chatSearchTimer = setTimeout(runChatSearch, 250);
  });

  // Escape cierra el panel abierto o la búsqueda.
  root.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (chatSheet) { e.preventDefault(); setChatSheet(null); return; }
    if (chatTab === 'search') { e.preventDefault(); chatTab = 'chat'; applyChatTab(); }
  });

  // Solo el scroll de la persona decide si "está abajo": mientras la
  // tarjeta se anima el alto cambia en cada cuadro y esos eventos de
  // scroll no cuentan (un salto grande la haría parecer subida).
  let bodyH = body.clientHeight;
  body.addEventListener('scroll', () => {
    if (body.clientHeight !== bodyH) return; // redimensionando: lo resuelve el observer
    chatStick = body.scrollHeight - body.scrollTop - body.clientHeight < 40;
  });
  if (typeof ResizeObserver !== 'undefined') {
    chatBodyObserver = new ResizeObserver(() => {
      bodyH = body.clientHeight;
      if (chatStick) body.scrollTop = body.scrollHeight;
    });
    chatBodyObserver.observe(body);
  }

  chatPollTimer = setInterval(() => {
    if (!document.getElementById('chat-widget')) { clearInterval(chatPollTimer); chatPollTimer = null; return; }
    if (!document.hidden) reloadChats();
  }, CHAT_POLL_MS);
}

// Al volver a la pestaña / abrir la app desde la notificación.
document.addEventListener('visibilitychange', () => {
  chatTrackPresence();
  if (!document.hidden && state.currentUser) reloadChats({ background: true });
});
function onChatListClick(e) {
  const hit = (sel) => e.target.closest(sel);
  let el;
  if ((el = hit('[data-more]'))) { e.stopPropagation(); setChatSheet({ type: 'actions', id: el.dataset.more }); return; }
  if ((el = hit('[data-react]'))) { e.stopPropagation(); toggleChatReaction(el.dataset.target, el.dataset.react); return; }
  if ((el = hit('[data-voice]'))) { e.stopPropagation(); toggleChatVoice(el.dataset.voice); return; }
  if ((el = hit('[data-open-share]'))) { e.stopPropagation(); openChatShare(el.dataset.openShare); return; }
  if ((el = hit('[data-jump]'))) { e.stopPropagation(); jumpToChatMessage(el.dataset.jump); return; }
  if ((el = hit('[data-note-to-notes]'))) { e.stopPropagation(); chatNoteToNotes(el.dataset.noteToNotes); return; }
  if ((el = hit('[data-note-to-list]'))) { e.stopPropagation(); setChatSheet({ type: 'note-list', id: el.dataset.noteToList }); return; }
  if ((el = hit('[data-note-id]'))) { e.stopPropagation(); toggleChatNote(el.dataset.noteId); return; }
  if ((el = hit('.chat-sticker img, .chat-note img'))) openStickerViewer(el.currentSrc || el.src);
}

// ============================================================
// Tarjeta: alto y pestañas
// ============================================================
// El chat siempre está a tamaño completo. En el teléfono el alto es fijo
// (CSS). En desktop se calcula para que el chat y la foto de debajo
// quepan juntos en la columna cuando queda pegada arriba, y para que el
// campo de texto se vea sin hacer scroll al entrar.
function sizeChatWidget() {
  const chat = document.getElementById('chat-widget');
  if (!chat) return;
  if (chatStacked()) { chat.style.removeProperty('--chat-h'); return; }
  const cols = document.querySelector('.dashboard-cols');
  const photo = document.getElementById('photo-widget');
  const top = cols ? cols.getBoundingClientRect().top + window.scrollY : chat.getBoundingClientRect().top + window.scrollY;
  const withPhoto = window.innerHeight - 48 - (photo ? photo.offsetHeight : 0); // 16 arriba + 16 de separación + 16 abajo
  const onEntry = window.innerHeight - top - 20;
  const h = Math.round(Math.max(320, Math.min(620, withPhoto, onEntry)));
  chat.style.setProperty('--chat-h', `${h}px`);
}

function applyChatTab() {
  const root = $('#chat-widget');
  if (!root) return;
  $$('.chat-tabs button', root).forEach(b => {
    const on = b.dataset.tab === chatTab;
    b.classList.toggle('active', on);
    b.setAttribute('aria-selected', String(on));
  });
  $('#chat-search-btn').classList.toggle('active', chatTab === 'search');
  $('#chat-search').hidden = chatTab !== 'search';
  $('#chat-body').hidden = chatTab !== 'chat';
  $('#chat-notes').hidden = chatTab !== 'notes';
  $('#chat-results').hidden = chatTab !== 'search';
  applyChatBottom();
  if (chatTab === 'chat') { const body = $('#chat-body'); if (chatStick) body.scrollTop = body.scrollHeight; }
}

// Qué se ve en la franja inferior: compositor, grabadora o panel.
function applyChatBottom() {
  if (!$('#chat-widget')) return;
  const inChat = chatTab === 'chat';
  const recording = !!chatRec;
  $('#chat-form').hidden = !inChat || !!chatSheet || recording;
  $('#chat-rec').hidden = !recording;
  $('#chat-reply').hidden = !inChat || !chatReplyTo || !!chatSheet || recording;
  $('#chat-typing').hidden = !inChat || !chatPartnerTyping;
  $('#chat-sheet').hidden = !chatSheet;
}

function updateChatComposer() {
  const input = $('#chat-input-field');
  if (!input) return;
  const hasText = !!input.value.trim();
  const voice = chatVoiceSupported();
  $('#chat-send').hidden = voice && !hasText;
  $('#chat-mic').hidden = !voice || hasText;
}

function setChatBusy(busy) {
  ['#chat-send', '#chat-attach', '#chat-mic'].forEach(sel => { const b = $(sel); if (b) b.disabled = busy; });
}

// El texto aparece (en una franja) solo cuando el aviso NO salió, que es
// cuando hace falta leerlo.
function renderChatNotifyHint() {
  const alert = $('#chat-alert');
  if (!alert) return;
  const partner = chatPartner();
  const ok = chatNotifyState === 'ok';
  alert.hidden = ok;
  alert.textContent = ok ? '' : chatNotifyState === 'none' ? `${partner} no tiene avisos activos` : `No se pudo avisar a ${partner}`;
}

// ============================================================
// Panel inferior (acciones del mensaje, adjuntar, selectores)
// ============================================================
function setChatSheet(sheet) {
  chatSheet = sheet;
  renderChatSheet();
}

function renderChatSheet() {
  const root = $('#chat-sheet');
  if (!root) return;
  const me = state.currentUser;
  const head = (title) => `<div class="chat-sheet-head"><span class="chat-sheet-title">${title}</span>`
    + '<button type="button" data-act="close" aria-label="Cerrar" title="Cerrar"><span class="material-symbols-outlined">close</span></button></div>';
  const act = (name, icon, label, extra = '') => `<button type="button" data-act="${name}" class="chat-act ${extra}"><span class="material-symbols-outlined">${icon}</span><span>${label}</span></button>`;
  let html = '';
  const s = chatSheet;
  // Marca el mensaje elegido
  $$('#chat-body .is-selected').forEach(el => el.classList.remove('is-selected'));

  if (s && s.type === 'actions') {
    const m = chatFind(s.id);
    if (!m || m._pending) { chatSheet = null; }
    else {
      const p = chatP(m);
      const mine = m.author === me;
      const myReaction = (chatReactionMap().get(String(m.id)) || new Map()).get(me);
      const sel = document.querySelector(`#chat-body [data-id="${CSS.escape(String(m.id))}"]`);
      if (sel) sel.classList.add('is-selected');
      html = head(escapeHtml(chatPreview(m)))
        + `<div class="chat-emoji-row">${CHAT_REACTIONS.map(em => `<button type="button" data-emoji="${em}" class="${myReaction && myReaction.emoji === em ? 'is-on' : ''}" aria-label="Reaccionar ${em}" aria-pressed="${!!(myReaction && myReaction.emoji === em)}">${em}</button>`).join('')}</div>`
        + '<div class="chat-acts">'
        + act('reply', 'reply', 'Responder')
        + act('note', 'bookmark', m.featured ? 'Quitar nota' : 'Nota rápida', m.featured ? 'is-on' : '')
        + (p.kind === 'text' ? act('copy', 'content_copy', 'Copiar') : '')
        + (mine ? act('delete', 'delete', 'Borrar', 'danger') : '')
        + '</div>';
    }
  } else if (s && s.type === 'attach') {
    const recent = chatRecentStickers();
    html = head('Enviar')
      + '<div class="chat-acts">'
      + act('new-photo', 'add_a_photo', 'Foto')
      + act('nudge', 'favorite', 'Toque')
      + act('pick-photo', 'photo_library', 'Del álbum')
      + act('pick-trip', 'flight_takeoff', 'Viaje')
      + '</div>'
      + (recent.length
        ? `<div class="chat-sheet-label">Stickers recientes</div><div class="chat-tray">${recent.map(st => `<button type="button" data-sticker="${escapeHtml(st.path)}" aria-label="Enviar este sticker"><img src="${escapeHtml(publicImageUrl(st.path))}" alt="" loading="lazy" /></button>`).join('')}</div>`
        : '');
  } else if (s && s.type === 'pick-photo') {
    const photos = state.photos.slice(0, 30);
    html = head('Compartir una foto del álbum')
      + (photos.length
        ? `<div class="chat-tray">${photos.map(ph => `<button type="button" data-photo="${escapeHtml(String(ph.id))}" aria-label="Compartir esta foto"><img src="${escapeHtml(publicImageUrl(ph.storage_path, { width: thumbWidth(72) }))}" alt="${escapeHtml(ph.caption || '')}" loading="lazy" /></button>`).join('')}</div>`
        : '<div class="chat-sheet-empty">Aún no hay fotos en el álbum.</div>');
  } else if (s && s.type === 'pick-trip') {
    const trips = sortTripsForDisplay(state.trips);
    html = head('Compartir un viaje')
      + (trips.length
        ? `<div class="chat-list">${trips.map(t => `<button type="button" data-trip="${escapeHtml(String(t.id))}"><span class="material-symbols-outlined">flight_takeoff</span><span><b>${escapeHtml(t.title || 'Viaje')}</b><small>${escapeHtml(t.start_date ? fmtTripRange(t) : '')}</small></span></button>`).join('')}</div>`
        : '<div class="chat-sheet-empty">Aún no hay viajes.</div>');
  } else if (s && s.type === 'note-list') {
    const lists = state.notes.filter(n => !n.archived_at && Array.isArray(n.checklist) && n.checklist.length);
    html = head('Añadir a una lista')
      + (lists.length
        ? `<div class="chat-list">${lists.map(n => `<button type="button" data-list="${escapeHtml(String(n.id))}"><span class="material-symbols-outlined">checklist</span><span><b>${escapeHtml(n.title || 'Sin título')}</b><small>${n.checklist.length} ítem${n.checklist.length === 1 ? '' : 's'}</small></span></button>`).join('')}</div>`
        : '<div class="chat-sheet-empty">No hay notas con lista. Crea una en Notas y vuelve.</div>');
  }
  root.innerHTML = html;
  applyChatBottom();
}

async function onChatSheetClick(e) {
  e.stopPropagation();
  const s = chatSheet;
  if (!s) return;
  let el;
  if ((el = e.target.closest('[data-emoji]'))) { toggleChatReaction(s.id, el.dataset.emoji); return; }
  if ((el = e.target.closest('[data-sticker]'))) { setChatSheet(null); sendChatSimple(`[[sticker:${el.dataset.sticker}]]`, '📷 Te mandó una foto', 'enviar el sticker'); return; }
  if ((el = e.target.closest('[data-photo]'))) { setChatSheet(null); sendChatSimple(`[[share:photo:${el.dataset.photo}]]`, '🖼️ Te compartió una foto del álbum', 'compartir la foto'); return; }
  if ((el = e.target.closest('[data-trip]'))) {
    const t = state.trips.find(t => String(t.id) === el.dataset.trip);
    setChatSheet(null);
    sendChatSimple(`[[share:trip:${el.dataset.trip}]]`, `✈️ Te compartió el viaje${t && t.title ? ` "${t.title}"` : ''}`, 'compartir el viaje');
    return;
  }
  if ((el = e.target.closest('[data-list]'))) { const id = s.id; setChatSheet(null); chatNoteToList(id, el.dataset.list); return; }
  if (!(el = e.target.closest('[data-act]'))) return;
  const act = el.dataset.act;
  if (act === 'close') { setChatSheet(null); return; }
  if (act === 'new-photo') { setChatSheet(null); $('#chat-photo-input').click(); return; }
  if (act === 'nudge') { setChatSheet(null); sendChatNudge(); return; }
  if (act === 'pick-photo' || act === 'pick-trip') { setChatSheet({ type: act }); return; }
  if (act === 'reply') {
    chatReplyTo = s.id;
    setChatSheet(null);
    renderChatReply();
    const input = $('#chat-input-field');
    if (input) input.focus();
    return;
  }
  if (act === 'note') { const id = s.id; setChatSheet(null); toggleChatNote(id); return; }
  if (act === 'copy') {
    const m = chatFind(s.id);
    setChatSheet(null);
    try { await navigator.clipboard.writeText(m ? chatP(m).text || '' : ''); uiToast('Copiado'); }
    catch { uiToast('No se pudo copiar', { error: true }); }
    return;
  }
  if (act === 'delete') { deleteChatMessage(s.id); }
}

// Stickers ya usados en el chat (míos o recibidos), sin repetir.
function chatRecentStickers() {
  const seen = new Set();
  const out = [];
  for (let i = state.chats.length - 1; i >= 0 && out.length < 12; i--) {
    const m = state.chats[i];
    const p = chatP(m);
    if (p.kind !== 'sticker' || m._pending || seen.has(p.path)) continue;
    seen.add(p.path);
    out.push(p);
  }
  return out;
}

function renderChatReply() {
  const root = $('#chat-reply');
  if (!root) return;
  const m = chatReplyTo ? chatFind(chatReplyTo) : null;
  if (!m) { chatReplyTo = null; root.innerHTML = ''; applyChatBottom(); return; }
  root.innerHTML = `<span class="material-symbols-outlined">reply</span>`
    + `<span class="chat-reply-text"><b>${escapeHtml(m.author)}</b> ${escapeHtml(chatPreview(m))}</span>`
    + '<button type="button" data-act="cancel-reply" aria-label="Cancelar respuesta" title="Cancelar respuesta"><span class="material-symbols-outlined">close</span></button>';
  applyChatBottom();
}

// ============================================================
// Enviar
// ============================================================
async function chatInsert(body) {
  const me = state.currentUser;
  const { data, error } = await supabase.from('chats').insert({ author: me, body, read_by: [me] }).select().single();
  if (error) throw error;
  return data;
}
// La burbuja aparece de una (provisional) y luego se confirma o se quita.
function chatPushTemp(body, extra = {}) {
  const me = state.currentUser;
  const temp = { id: `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, author: me, body, created_at: new Date().toISOString(), read_by: [me], _pending: true, ...extra };
  state.chats.push(temp);
  renderChatBody({ stick: true });
  return temp;
}
function chatCommitTemp(temp, data) {
  const saved = data || { ...temp, _pending: false, _localUrl: undefined };
  const i = state.chats.indexOf(temp);
  if (i !== -1) state.chats[i] = saved; else state.chats.push(saved);
  renderChatBody({ stick: true });
  chatBroadcast('new');
  return saved;
}
function chatDropTemp(temp) {
  state.chats = state.chats.filter(m => m !== temp);
  renderChatBody({ stick: true });
}

// Texto ya armado (sticker repetido, tarjeta, toque…): guarda y avisa.
async function sendChatSimple(body, pushBody, errLabel, pushTitle) {
  if (chatSending) return false;
  chatSending = true;
  setChatBusy(true);
  const temp = chatPushTemp(body);
  try {
    const data = await chatInsert(body);
    chatCommitTemp(temp, data);
    notifyChatMessage(pushTitle || state.currentUser, pushBody);
    return true;
  } catch (e) {
    console.error('chat send', e);
    chatDropTemp(temp);
    uiToast(`No se pudo ${errLabel}: ${e.message || e}`, { error: true, duration: 5000 });
    return false;
  } finally {
    chatSending = false;
    setChatBusy(false);
  }
}

async function sendChatMessage() {
  const input = $('#chat-input-field');
  const text = (input.value || '').trim();
  if (!text || chatSending) return;
  // Respuesta: la cita viaja dentro del mensaje para que se lea aunque
  // el original ya no esté cargado.
  let body = text;
  const replyTo = chatReplyTo ? chatFind(chatReplyTo) : null;
  if (replyTo) {
    const snippet = chatPreview(replyTo).replace(/\s+/g, ' ').slice(0, 80);
    body = `[[re:${replyTo.id}|${String(replyTo.author).replace(/[|\]]/g, '')}|${encodeURIComponent(snippet)}]]${text}`;
  }
  input.value = '';
  chatDraft = '';
  chatReplyTo = null;
  renderChatReply();
  updateChatComposer();
  const ok = await sendChatSimple(body, text.length > 140 ? `${text.slice(0, 139)}…` : text, 'enviar el mensaje');
  if (!ok && $('#chat-input-field') === input && !input.value) {
    // El texto vuelve al campo (y la cita, si había).
    input.value = text;
    chatDraft = text;
    if (replyTo) { chatReplyTo = replyTo.id; renderChatReply(); }
    updateChatComposer();
  }
}

// Toque: un "pensando en ti" sin escribir nada.
async function sendChatNudge() {
  const wait = CHAT_NUDGE_COOLDOWN_MS - (Date.now() - chatLastNudge);
  if (wait > 0) { uiToast(`Espera ${Math.ceil(wait / 1000)} s para mandar otro toque`); return; }
  const me = state.currentUser;
  if (await sendChatSimple(CHAT_NUDGE, 'Un toque desde Medusas', 'mandar el toque', `🪼 ${me} está pensando en ti`)) chatLastNudge = Date.now();
}

// Push a la otra persona. No bloquea el envío; el resultado solo decide
// si hay que avisar de que el aviso no salió.
function notifyChatMessage(title, preview) {
  supabase.functions.invoke('notify', { body: { title, body: preview, hash: '#/inicio' } })
    .then(({ data, error }) => {
      if (error) { console.warn('notify', error.message || error); chatNotifyState = 'error'; }
      else chatNotifyState = (data && data.sent === 0) ? 'none' : 'ok';
      renderChatNotifyHint();
    })
    .catch((e) => { console.warn('notify', e); chatNotifyState = 'error'; renderChatNotifyHint(); });
}

// ---- Fotos como stickers ----
// El nombre del archivo lleva el tamaño (…-320x512.jpg) para reservar el
// espacio de la burbuja antes de que la imagen cargue: así el scroll no
// salta. PNG / WebP / GIF conservan la transparencia (salen como PNG); el
// resto sale como JPEG.
async function makeStickerFile(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    try { await img.decode(); } catch { throw new Error('ese archivo no se puede leer como imagen'); }
    const scale = Math.min(1, CHAT_STICKER_PX / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    canvas.getContext('2d').drawImage(img, 0, 0, w, h);
    const keepAlpha = /png|webp|gif/i.test(file.type);
    const type = keepAlpha ? 'image/png' : 'image/jpeg';
    const blob = await new Promise(res => canvas.toBlob(res, type, 0.86));
    if (!blob) throw new Error('no se pudo procesar la imagen');
    return { blob, type, w, h, path: `sticker-${crypto.randomUUID()}-${w}x${h}.${keepAlpha ? 'png' : 'jpg'}` };
  } finally { URL.revokeObjectURL(url); }
}

// Espera (como mucho un momento) a que la imagen esté en caché, para que
// al cambiar la vista previa local por la URL real no parpadee.
function preloadImage(src, timeoutMs = 2500) {
  return new Promise(res => {
    const img = new Image();
    const done = () => res();
    img.onload = done; img.onerror = done;
    setTimeout(done, timeoutMs);
    img.src = src;
  });
}

// Sube un archivo (sticker o audio) y guarda el mensaje que lo señala.
// Si algo falla no queda ni burbuja ni archivo huérfano.
async function sendChatUpload({ path, blob, type, body, pushBody, errLabel, localUrl, preload }) {
  if (chatSending) return false;
  chatSending = true;
  setChatBusy(true);
  let temp = null;
  let uploadedPath = null;
  try {
    temp = chatPushTemp(body, localUrl ? { _localUrl: localUrl } : {});
    const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, blob, {
      cacheControl: '31536000', upsert: false, contentType: type,
    });
    if (upErr) throw upErr;
    uploadedPath = path;
    const data = await chatInsert(body);
    uploadedPath = null; // ya pertenece a un mensaje guardado
    if (preload) await preloadImage(publicImageUrl(path));
    chatCommitTemp(temp, data);
    notifyChatMessage(state.currentUser, pushBody);
    return true;
  } catch (e) {
    console.error('chat upload', e);
    if (temp) chatDropTemp(temp);
    if (uploadedPath) { try { await supabase.storage.from(BUCKET).remove([uploadedPath]); } catch {} }
    // Supabase rechaza el tipo de archivo (415 / "mime type ... is not
    // supported"): el bucket solo admite ciertos tipos. Es un ajuste del
    // bucket, no un fallo pasajero, así que se dice tal cual.
    const badType = e && (String(e.statusCode) === '415' || e.status === 415 || /mime/i.test(e.message || ''));
    uiToast(badType
      ? `El almacenamiento de Supabase no acepta archivos ${type}. Hay que añadir ese tipo a los permitidos del bucket "${BUCKET}".`
      : `No se pudo ${errLabel}: ${e.message || e}`, { error: true, duration: badType ? 9000 : 5000 });
    return false;
  } finally {
    if (localUrl) URL.revokeObjectURL(localUrl);
    chatSending = false;
    setChatBusy(false);
  }
}

async function sendChatSticker(file) {
  if (chatSending) return;
  let st;
  try { st = await makeStickerFile(file); }
  catch (e) { uiToast(`No se pudo enviar la foto: ${e.message || e}`, { error: true, duration: 5000 }); return; }
  await sendChatUpload({
    path: st.path, blob: st.blob, type: st.type, body: `[[sticker:${st.path}]]`,
    pushBody: '📷 Te mandó una foto', errLabel: 'enviar la foto',
    localUrl: URL.createObjectURL(st.blob), preload: true,
  });
}

// Sticker en grande: toca en cualquier parte para cerrar.
function openStickerViewer(src) {
  let dlg = document.getElementById('sticker-viewer');
  if (!dlg) {
    dlg = document.createElement('dialog');
    dlg.id = 'sticker-viewer';
    dlg.className = 'sticker-viewer';
    dlg.innerHTML = '<img alt="Foto del chat" /><button type="button" class="lb-close" aria-label="Cerrar" title="Cerrar"><span class="material-symbols-outlined">close</span></button>';
    dlg.addEventListener('click', () => dlg.close());
    document.body.appendChild(dlg);
  }
  dlg.querySelector('img').src = src;
  if (!dlg.open) dlg.showModal();
}

// ---- Notas de voz ----
async function startChatRecording() {
  if (chatRec || chatSending) return;
  if (!chatVoiceSupported()) { uiToast('Este navegador no permite grabar audio', { error: true }); return; }
  let stream;
  try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
  catch (e) {
    const name = e && e.name;
    uiToast(name === 'NotAllowedError' || name === 'SecurityError'
      ? 'El micrófono está bloqueado para Medusas. Actívalo en los ajustes del navegador o del teléfono y vuelve a intentar.'
      : name === 'NotFoundError' ? 'No se encontró ningún micrófono en este dispositivo.'
      : `No se pudo usar el micrófono: ${e.message || e}`, { error: true, duration: 8000 });
    return;
  }
  // mp4 primero: es lo que graba Safari y lo que suena en todas partes.
  const mime = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg'].find(t => MediaRecorder.isTypeSupported(t)) || '';
  let recorder;
  // 48 kbps basta para voz: una nota de 2 minutos pesa menos de 1 MB.
  try { recorder = new MediaRecorder(stream, { audioBitsPerSecond: 48000, ...(mime ? { mimeType: mime } : {}) }); }
  catch (e) { stream.getTracks().forEach(t => t.stop()); uiToast(`No se pudo grabar: ${e.message || e}`, { error: true }); return; }
  const rec = { recorder, stream, chunks: [], startedAt: Date.now(), send: false, timer: null };
  recorder.addEventListener('dataavailable', (e) => { if (e.data && e.data.size) rec.chunks.push(e.data); });
  recorder.addEventListener('stop', () => finishChatRecording(rec));
  recorder.start();
  chatRec = rec;
  const tick = () => {
    const secs = (Date.now() - rec.startedAt) / 1000;
    const el = $('#chat-rec-time');
    if (el) el.textContent = chatFmtSecs(secs);
    if (secs >= CHAT_VOICE_MAX_S) stopChatRecording(true);
  };
  rec.timer = setInterval(tick, 250);
  tick();
  applyChatBottom();
}

function stopChatRecording(send) {
  const rec = chatRec;
  if (!rec) return;
  rec.send = send;
  rec.secs = Math.round((Date.now() - rec.startedAt) / 1000);
  clearInterval(rec.timer);
  try { if (rec.recorder.state !== 'inactive') rec.recorder.stop(); else finishChatRecording(rec); }
  catch { finishChatRecording(rec); }
}

async function finishChatRecording(rec) {
  if (rec.done) return;
  rec.done = true;
  rec.stream.getTracks().forEach(t => t.stop());
  if (chatRec === rec) chatRec = null;
  applyChatBottom();
  if (!rec.send) return;
  if (rec.secs < 1 || !rec.chunks.length) { uiToast('La nota de voz quedó muy corta'); return; }
  const mime = rec.recorder.mimeType || (rec.chunks[0] && rec.chunks[0].type) || 'audio/webm';
  const [ext, type] = /mp4|m4a|aac/.test(mime) ? ['m4a', 'audio/mp4'] : /ogg/.test(mime) ? ['ogg', 'audio/ogg'] : ['webm', 'audio/webm'];
  const blob = new Blob(rec.chunks, { type });
  const path = `voice-${crypto.randomUUID()}-${Math.min(999, rec.secs)}s.${ext}`;
  await sendChatUpload({ path, blob, type, body: `[[voice:${path}]]`, pushBody: '🎤 Te mandó una nota de voz', errLabel: 'enviar la nota de voz' });
}

function toggleChatVoice(path) {
  if (!chatAudio) {
    chatAudio = new Audio();
    chatAudio.addEventListener('timeupdate', paintChatVoice);
    chatAudio.addEventListener('ended', () => { chatPlaying = null; paintChatVoice(); });
    chatAudio.addEventListener('pause', paintChatVoice);
    chatAudio.addEventListener('error', () => {
      if (!chatPlaying) return;
      chatPlaying = null; paintChatVoice();
      uiToast('No se pudo reproducir la nota de voz', { error: true });
    });
  }
  if (chatPlaying === path && !chatAudio.paused) { chatAudio.pause(); return; }
  if (chatPlaying !== path) { chatPlaying = path; chatAudio.src = publicImageUrl(path); }
  chatAudio.play().catch(() => {});
  paintChatVoice();
}

// Refleja el reproductor en los botones de voz que haya en pantalla.
function paintChatVoice() {
  $$('#chat-widget [data-voice]').forEach(btn => {
    const on = chatPlaying === btn.dataset.voice;
    const playing = on && chatAudio && !chatAudio.paused;
    const total = Number(btn.dataset.secs) || 0;
    const cur = on && chatAudio ? chatAudio.currentTime : 0;
    $('.material-symbols-outlined', btn).textContent = playing ? 'pause' : 'play_arrow';
    btn.setAttribute('aria-label', playing ? 'Pausar nota de voz' : 'Reproducir nota de voz');
    const row = btn.closest('.voice-row');
    if (!row) return;
    $('.voice-bar i', row).style.width = `${total ? Math.min(100, (cur / total) * 100) : 0}%`;
    $('.voice-time', row).textContent = chatFmtSecs(on && cur > 0 ? cur : total);
  });
}

// ---- Tarjetas compartidas ----
function openChatShare(ref) {
  const [what, id] = ref.split(':');
  if (what === 'trip') {
    if (state.trips.some(t => String(t.id) === id)) location.hash = `#/viajes/${id}`;
    else uiToast('Ese viaje ya no existe');
    return;
  }
  const photo = state.photos.find(p => String(p.id) === id);
  if (!photo) { uiToast('Esa foto ya no está en el álbum'); return; }
  const list = state.photos.filter(p => (p.album || '') === (photo.album || ''));
  openLightbox(list, Math.max(0, list.indexOf(photo)));
}

// ============================================================
// Reacciones, borrar
// ============================================================
async function toggleChatReaction(targetId, emoji) {
  const me = state.currentUser;
  const target = chatFind(targetId);
  if (!target || target._pending) return;
  const mine = state.chats.filter(m => { const p = chatP(m); return m.author === me && p.kind === 'react' && p.target === String(targetId); });
  const same = mine.some(m => chatP(m).emoji === emoji);
  const prev = state.chats;
  // Optimista: fuera mi reacción anterior, dentro la nueva (si cambia).
  state.chats = state.chats.filter(m => !mine.includes(m));
  let temp = null;
  if (!same) {
    temp = { id: `tmp-r-${Date.now()}`, author: me, body: `[[react:${targetId}:${emoji}]]`, created_at: new Date().toISOString(), read_by: [me], _pending: true };
    state.chats.push(temp);
  }
  chatSheet = null;
  renderChatBody();
  renderChatSheet();
  chatMutating++;
  try {
    const saved = mine.filter(m => !m._pending).map(m => m.id);
    if (saved.length) {
      const { error } = await supabase.from('chats').delete().in('id', saved);
      if (error) throw error;
    }
    if (temp) {
      const data = await chatInsert(temp.body);
      const i = state.chats.indexOf(temp);
      if (i !== -1) state.chats[i] = data || { ...temp, _pending: false };
      if (target.author !== me) notifyChatMessage(me, `Reaccionó ${emoji} a "${chatPreview(target).replace(/\s+/g, ' ').slice(0, 60)}"`);
    }
    chatBroadcast('new');
  } catch (e) {
    console.error('chat reaction', e);
    state.chats = prev;
    renderChatBody();
    uiToast(`No se pudo guardar la reacción: ${e.message || e}`, { error: true, duration: 5000 });
  } finally { chatMutating--; }
}

async function deleteChatMessage(id) {
  const me = state.currentUser;
  const m = chatFind(id);
  if (!m || m._pending || m.author !== me) return;
  if (!(await uiConfirm('¿Borrar este mensaje? Se borra para los dos y no se puede deshacer.', { title: 'Borrar mensaje', confirmLabel: 'Borrar', danger: true }))) return;
  chatMutating++;
  try {
    // .select() confirma que de verdad se borró una fila (RLS puede
    // responder "ok" sin borrar nada).
    const { data, error } = await supabase.from('chats').delete().eq('id', m.id).select('id');
    if (error) throw error;
    if (!data || !data.length) throw new Error('la base no borró el mensaje');
    const p = chatP(m);
    if (p.kind === 'sticker' || p.kind === 'voice') {
      // El archivo solo se borra si nadie más lo usa: otro mensaje (un
      // sticker reenviado) o una nota creada a partir de él.
      try {
        const inNote = state.notes.some(n => Array.isArray(n.images) && n.images.includes(p.path));
        const { data: others, error: othersErr } = await supabase.from('chats').select('id').eq('body', m.body).limit(1);
        if (!inNote && !othersErr && others && !others.length) await supabase.storage.from(BUCKET).remove([p.path]);
      } catch (e) { console.warn('chat file cleanup', e); }
      if (chatPlaying === p.path && chatAudio) { chatAudio.pause(); chatPlaying = null; }
    }
    state.chats = state.chats.filter(x => String(x.id) !== String(id));
    state.chatNotes = state.chatNotes.filter(x => String(x.id) !== String(id));
    if (String(chatReplyTo) === String(id)) chatReplyTo = null;
    chatSheet = null;
    renderChatBody();
    renderChatNotes();
    renderChatSheet();
    renderChatReply();
    chatBroadcast('new');
    uiToast('Mensaje borrado');
  } catch (e) {
    console.error('chat delete', e);
    uiToast(`No se pudo borrar el mensaje: ${e.message || e}`, { error: true, duration: 5000 });
  } finally { chatMutating--; }
}

// ============================================================
// Notas rápidas
// Un mensaje guardado como nota rápida es el mismo mensaje con
// featured = true. Se listan en la pestaña "Notas rápidas" del chat.
// ============================================================
function renderChatNotes() {
  const root = $('#chat-notes');
  const count = $('#chat-notes-count');
  if (!root || !count) return;
  const notes = state.chatNotes;
  count.textContent = notes.length ? String(notes.length) : '';
  count.hidden = !notes.length;
  if (!notes.length) {
    root.innerHTML = '<div class="chat-empty">Aún no hay notas rápidas.<br/>En un mensaje, toca <span class="material-symbols-outlined">more_horiz</span> y elige «Nota rápida».</div>';
    return;
  }
  const btn = (attr, id, icon, label) => `<button type="button" ${attr}="${escapeHtml(String(id))}" aria-label="${label}" title="${label}"><span class="material-symbols-outlined">${icon}</span></button>`;
  root.innerHTML = notes.map(m => {
    const p = chatP(m);
    const d = new Date(m.created_at);
    const when = d.toLocaleDateString('es', { day: 'numeric', month: 'short', year: d.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });
    const content = p.kind === 'sticker'
      ? `<img src="${escapeHtml(publicImageUrl(p.path))}" alt="Foto" width="${p.w}" height="${p.h}" loading="lazy" />`
      : p.kind === 'voice' ? chatVoiceHtml(p)
      : `<div class="chat-note-text">${linkify(chatPreview(m))}</div>`;
    return `<div class="chat-note${p.kind === 'sticker' ? ' has-photo' : ''}">
      ${content}
      <div class="chat-note-meta">
        <span>${escapeHtml(m.author)} · ${escapeHtml(when)}</span>
        <span class="chat-note-acts">
          ${p.kind === 'voice' ? '' : btn('data-note-to-notes', m.id, 'note_add', 'Pasar a Notas')}
          ${p.kind === 'text' ? btn('data-note-to-list', m.id, 'playlist_add', 'Añadir a una lista') : ''}
          ${btn('data-note-id', m.id, 'bookmark_remove', 'Quitar de notas rápidas')}
        </span>
      </div>
    </div>`;
  }).join('');
  paintChatVoice();
}

async function toggleChatNote(id) {
  const inChat = state.chats.find(m => String(m.id) === String(id));
  const inNotes = state.chatNotes.find(m => String(m.id) === String(id));
  const m = inChat || inNotes;
  if (!m || m._pending) return;
  const prevNotes = state.chatNotes;
  const next = !m.featured;
  const apply = (value, notes) => {
    if (inChat) inChat.featured = value;
    if (inNotes) inNotes.featured = value;
    state.chatNotes = notes;
    renderChatBody();
    renderChatNotes();
  };
  apply(next, next
    ? [{ ...m, featured: true }, ...prevNotes.filter(x => String(x.id) !== String(id))]
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    : prevNotes.filter(x => String(x.id) !== String(id)));
  chatMutating++;
  try {
    const { error } = await supabase.from('chats').update({ featured: next }).eq('id', m.id);
    if (error) throw error;
    chatBroadcast('new');
    uiToast(next ? 'Guardado en notas rápidas' : 'Quitado de notas rápidas');
  } catch (e) {
    console.error('chat note', e);
    apply(!next, prevNotes);
    uiToast(`No se pudo ${next ? 'guardar' : 'quitar'} la nota rápida: ${e.message || e}`, { error: true, duration: 5000 });
  } finally { chatMutating--; }
}

// Nota rápida → nota de verdad en la sección Notas (compartida).
async function chatNoteToNotes(id) {
  const m = chatFind(id);
  if (!m) return;
  const p = chatP(m);
  if (p.kind === 'voice') return;
  const me = state.currentUser;
  const text = chatPreview(m).trim();
  const long = text.length > 60;
  const payload = {
    title: p.kind === 'sticker' ? 'Foto del chat' : (long ? `${text.slice(0, 57)}…` : text),
    content: p.kind !== 'sticker' && long ? text : '',
    content_is_rich: false,
    visibility: 'public',
    links: [], images: p.kind === 'sticker' ? [p.path] : [], tags: [],
    pinned: false, checklist: [],
    created_by: me, seen_by: [me],
  };
  try {
    const { data, error } = await supabase.from('notes').insert(payload).select().single();
    if (error) throw error;
    state.notes.unshift(data || { ...payload, id: `local-${Date.now()}`, created_at: new Date().toISOString() });
    uiToast('Nota creada en Notas ✓');
    notifyPartner({ title: `${me} escribió una nota`, body: payload.title, hash: '#/notas' });
  } catch (e) {
    console.error('chat note → notes', e);
    uiToast(`No se pudo crear la nota: ${e.message || e}`, { error: true, duration: 5000 });
  }
}

// Nota rápida → un ítem más en la lista de una nota existente.
async function chatNoteToList(id, noteId) {
  const m = chatFind(id);
  const note = state.notes.find(n => String(n.id) === String(noteId));
  if (!m || !note) return;
  const text = chatPreview(m).replace(/\s+/g, ' ').trim();
  const updated = [...(note.checklist || []), { text, done: false }];
  try {
    const { error } = await supabase.from('notes').update({ checklist: updated }).eq('id', note.id);
    if (error) throw error;
    note.checklist = updated;
    uiToast(`Añadido a "${note.title || 'la lista'}" ✓`);
  } catch (e) {
    console.error('chat note → list', e);
    uiToast(`No se pudo añadir a la lista: ${e.message || e}`, { error: true, duration: 5000 });
  }
}

// ============================================================
// Buscar
// ============================================================
async function runChatSearch() {
  const q = chatSearchQuery.trim();
  const seq = ++chatSearchSeq;
  if (q.length < 2) { chatSearchResults = []; chatSearchBusy = false; renderChatResults(); return; }
  const needle = q.toLowerCase();
  const match = (m) => { const p = chatP(m); return p.kind === 'text' && p.text.toLowerCase().includes(needle); };
  const byNewest = (a, b) => new Date(b.created_at) - new Date(a.created_at);
  // Primero lo que ya está cargado; luego el historial completo.
  chatSearchResults = chatVisible().filter(m => !m._pending && match(m)).sort(byNewest);
  chatSearchBusy = true;
  renderChatResults();
  try {
    const esc = q.replace(/[\\%_]/g, '\\$&');
    const { data, error } = await supabase.from('chats').select('*')
      .ilike('body', `%${esc}%`).order('created_at', { ascending: false }).limit(80);
    if (seq !== chatSearchSeq) return;
    if (error) throw error;
    const seen = new Set(chatSearchResults.map(m => String(m.id)));
    chatSearchResults = [...chatSearchResults, ...(data || []).filter(m => !seen.has(String(m.id)) && match(m))].sort(byNewest);
  } catch (e) { console.warn('chat search', e); }
  finally { if (seq === chatSearchSeq) { chatSearchBusy = false; renderChatResults(); } }
}

function renderChatResults() {
  const root = $('#chat-results');
  if (!root) return;
  const q = chatSearchQuery.trim();
  if (q.length < 2) { root.innerHTML = '<div class="chat-empty">Escribe al menos dos letras para buscar en todo el historial.</div>'; return; }
  if (!chatSearchResults.length) {
    root.innerHTML = `<div class="chat-empty">${chatSearchBusy ? 'Buscando…' : 'Sin resultados.'}</div>`;
    return;
  }
  const mark = (text) => {
    const i = text.toLowerCase().indexOf(q.toLowerCase());
    if (i === -1) return escapeHtml(text);
    const from = Math.max(0, i - 40);
    return (from ? '…' : '') + escapeHtml(text.slice(from, i)) + `<mark>${escapeHtml(text.slice(i, i + q.length))}</mark>` + escapeHtml(text.slice(i + q.length, i + q.length + 80));
  };
  root.innerHTML = chatSearchResults.map(m => {
    const d = new Date(m.created_at);
    const when = d.toLocaleDateString('es', { day: 'numeric', month: 'short', year: d.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });
    return `<button type="button" class="chat-result" data-jump="${escapeHtml(String(m.id))}">
      <span class="chat-result-text">${mark(chatP(m).text)}</span>
      <span class="chat-result-meta">${escapeHtml(m.author)} · ${escapeHtml(when)}</span>
    </button>`;
  }).join('') + (chatSearchBusy ? '<div class="chat-empty">Buscando más…</div>' : '');
}

// Lleva al mensaje dentro de la conversación y lo resalta un momento.
function jumpToChatMessage(id) {
  if (!state.chats.some(m => String(m.id) === String(id))) { uiToast('Ese mensaje es más antiguo que lo cargado en el chat'); return; }
  chatTab = 'chat';
  applyChatTab();
  const el = document.querySelector(`#chat-body [data-id="${CSS.escape(String(id))}"]`);
  if (!el) return;
  chatStick = false;
  el.scrollIntoView({ block: 'center' });
  el.classList.remove('flash');
  void el.offsetWidth; // reinicia la animación
  el.classList.add('flash');
}

// ============================================================
// Tiempo real: en línea + "escribiendo…" + refresco inmediato
// Usa un canal de Supabase Realtime (broadcast y presencia), que no
// necesita tablas. Si el proyecto no lo permite, simplemente no aparece
// y el chat sigue funcionando por sondeo.
// ============================================================
function startChatRealtime() {
  const me = state.currentUser;
  if (chatChannel || !me) return;
  try {
    const ch = supabase.channel('medusas-chat', { config: { presence: { key: me }, broadcast: { self: false } } });
    chatChannel = ch;
    ch.on('presence', { event: 'sync' }, () => {
      chatPartnerOnline = Object.keys(ch.presenceState() || {}).some(k => k !== me);
      if (!chatPartnerOnline) chatSetPartnerTyping(false);
      renderChatPresence();
    });
    ch.on('broadcast', { event: 'typing' }, ({ payload }) => {
      if (payload && payload.user && payload.user !== me) chatSetPartnerTyping(true);
    });
    ch.on('broadcast', { event: 'new' }, () => { chatSetPartnerTyping(false); reloadChats({ background: true }); });
    ch.subscribe((status) => {
      if (status === 'SUBSCRIBED') chatTrackPresence();
      else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') console.warn('chat realtime', status);
    });
  } catch (e) { console.warn('chat realtime', e); chatChannel = null; }
}

function stopChatRealtime() {
  if (!chatChannel) return;
  try { supabase.removeChannel(chatChannel); } catch {}
  chatChannel = null;
  chatPartnerOnline = false;
  chatSetPartnerTyping(false);
}

// "En línea" = con la app al frente.
function chatTrackPresence() {
  if (!chatChannel || !state.currentUser) return;
  try {
    const r = document.hidden ? chatChannel.untrack() : chatChannel.track({ user: state.currentUser });
    if (r && r.catch) r.catch(() => {});
  } catch {}
}

function chatBroadcast(event, payload = {}) {
  if (!chatChannel) return;
  try {
    const r = chatChannel.send({ type: 'broadcast', event, payload: { user: state.currentUser, ...payload } });
    if (r && r.catch) r.catch(() => {});
  } catch {}
}

function chatSendTyping() {
  const now = Date.now();
  if (now - chatLastTypingSent < 2500) return;
  chatLastTypingSent = now;
  chatBroadcast('typing');
}

function chatSetPartnerTyping(on) {
  clearTimeout(chatTypingTimer);
  chatPartnerTyping = on;
  if (on) chatTypingTimer = setTimeout(() => chatSetPartnerTyping(false), 4000);
  renderChatTyping();
}

function renderChatTyping() {
  const el = $('#chat-typing');
  if (!el) return;
  el.innerHTML = chatPartnerTyping ? `${escapeHtml(chatPartner())} está escribiendo<span class="chat-dots"><i></i><i></i><i></i></span>` : '';
  applyChatBottom();
}

function renderChatPresence() {
  const dot = $('#chat-online');
  if (!dot) return;
  dot.hidden = !chatPartnerOnline;
  dot.title = `${chatPartner()} está en línea`;
  dot.setAttribute('aria-label', dot.title);
}

// Arranca lo que vive en toda la app (no solo en Inicio): tiempo real y
// un sondeo lento para el aviso de mensajes sin leer.
function startChatBackground() {
  if (!state.currentUser) return;
  startChatRealtime();
  if (!chatBgTimer) {
    chatBgTimer = setInterval(() => {
      if (!state.currentUser || document.hidden || document.getElementById('chat-widget')) return;
      reloadChats({ background: true });
    }, CHAT_BG_POLL_MS);
  }
}

function stopChatBackground() {
  if (chatBgTimer) { clearInterval(chatBgTimer); chatBgTimer = null; }
  if (chatPollTimer) { clearInterval(chatPollTimer); chatPollTimer = null; }
  if (chatRec) stopChatRecording(false);
  if (chatAudio) { try { chatAudio.pause(); } catch {} }
  chatPlaying = null;
  stopChatRealtime();
  chatSheet = null; chatReplyTo = null; chatDraft = ''; chatTab = 'chat';
  chatSearchQuery = ''; chatSearchResults = [];
}

// ============================================================
// Recargar + leídos
// ============================================================
// `background`: también fuera de Inicio (aviso de no leídos, push, canal).
async function reloadChats(opts = {}) {
  if (chatSending || chatMutating || !state.currentUser || document.hidden) return;
  if (!opts.background && !chatOnScreen()) return;
  try {
    const [{ data, error }, { data: notes, error: notesErr }] = await Promise.all([
      supabase.from('chats').select('*').order('created_at', { ascending: false }).limit(CHAT_PAGE),
      supabase.from('chats').select('*').eq('featured', true).order('created_at', { ascending: false }),
    ]);
    if (error) { console.warn('chat reload', error.message || error); return; }
    // Un envío pudo empezar mientras esperábamos: su burbuja provisional
    // manda, este resultado ya está viejo.
    if (!data || chatSending || chatMutating) return;
    const next = data.reverse();
    const sig = (list) => list.map(m => `${m.id}:${(m.read_by || []).length}:${m.featured ? 1 : 0}`).join('|');
    // Sin cambios → no se toca el DOM (conserva scroll y selección).
    if (sig(next) !== sig(state.chats)) {
      state.chats = next;
      renderChatBody();
      if (chatSheet && chatSheet.type === 'actions') renderChatSheet();
      renderChatReply();
      markIncomingChatsRead();
      updateSidebarBadges();
    }
    if (!notesErr && notes && sig(notes) !== sig(state.chatNotes)) {
      state.chatNotes = notes;
      renderChatNotes();
    }
  } catch (e) { console.warn('chat reload', e); }
}

// Marca como leídos los mensajes de la otra persona, solo si el chat
// está realmente a la vista.
async function markIncomingChatsRead() {
  if (!chatOnScreen()) return;
  const me = state.currentUser;
  const toMark = state.chats.filter(m => m.author !== me && !m._pending && !(m.read_by || []).includes(me));
  if (!toMark.length) return;
  await Promise.all(toMark.map(async (m) => {
    const next = [...(m.read_by || []), me];
    try {
      const { error } = await supabase.from('chats').update({ read_by: next }).eq('id', m.id);
      if (error) console.warn('chat read', error.message || error);
      else m.read_by = next;
    } catch (e) { console.warn('chat read', e); }
  }));
  updateSidebarBadges();
}

// ============================================================
// Pintar la conversación
// ============================================================
// Detect URLs and convert to <a>
function linkify(text) {
  const escaped = escapeHtml(text);
  return escaped.replace(/(https?:\/\/[^\s<]+)/g, (url) => {
    return `<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`;
  });
}

function chatDayLabel(iso) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const day = new Date(iso); day.setHours(0, 0, 0, 0);
  const diff = Math.round((today - day) / 86400000);
  if (diff === 0) return 'Hoy';
  if (diff === 1) return 'Ayer';
  return day.toLocaleDateString('es', {
    weekday: 'long', day: 'numeric', month: 'short',
    year: day.getFullYear() === today.getFullYear() ? undefined : 'numeric',
  });
}

function chatVoiceHtml(p) {
  return `<span class="voice-row"><button type="button" class="voice-play" data-voice="${escapeHtml(p.path)}" data-secs="${p.secs}" aria-label="Reproducir nota de voz"><span class="material-symbols-outlined">play_arrow</span></button>`
    + `<span class="voice-bar"><i></i></span><span class="voice-time">${chatFmtSecs(p.secs)}</span></span>`;
}

function chatShareHtml(p) {
  if (p.what === 'trip') {
    const t = state.trips.find(t => String(t.id) === p.ref);
    const cover = t ? tripCoverUrl(t) : null;
    return `<button type="button" class="chat-card-main" data-open-share="trip:${escapeHtml(p.ref)}">`
      + (cover ? `<img src="${escapeHtml(cover)}" alt="" loading="lazy" />` : '<span class="chat-card-icon material-symbols-outlined">flight_takeoff</span>')
      + `<span class="chat-card-text"><small>Viaje</small><b>${escapeHtml(t ? (t.title || 'Viaje') : 'Viaje no disponible')}</b>${t && t.start_date ? `<small>${escapeHtml(fmtTripRange(t))}</small>` : ''}</span></button>`;
  }
  const ph = state.photos.find(x => String(x.id) === p.ref);
  return `<button type="button" class="chat-card-main" data-open-share="photo:${escapeHtml(p.ref)}">`
    + (ph ? `<img src="${escapeHtml(publicImageUrl(ph.storage_path, { width: thumbWidth(72) }))}" alt="" loading="lazy" />` : '<span class="chat-card-icon material-symbols-outlined">hide_image</span>')
    + `<span class="chat-card-text"><small>Foto del álbum</small><b>${escapeHtml(ph ? (ph.album || 'Sin álbum') : 'Foto no disponible')}</b>${ph && ph.caption ? `<small>${escapeHtml(ph.caption)}</small>` : ''}</span></button>`;
}

// `stick: true` baja al último mensaje pase lo que pase (al abrir y al
// enviar). Sin él, solo baja si ya estabas abajo: un mensaje nuevo no te
// arranca de lo que estabas leyendo más arriba.
function renderChatBody(opts = {}) {
  const body = $('#chat-body');
  if (!body) return;
  const atBottom = body.scrollHeight - body.scrollTop - body.clientHeight < 40;
  const prevTop = body.scrollTop;
  const msgs = chatVisible();
  if (!msgs.length) {
    body.innerHTML = '<div class="chat-empty">Todavía no hay mensajes.<br/>Escribe el primero.</div>';
    return;
  }
  body.innerHTML = '';
  const me = state.currentUser;
  const reactions = chatReactionMap();
  const selected = chatSheet && chatSheet.type === 'actions' ? String(chatSheet.id) : null;
  let lastDay = '';
  let lastAuthor = '';
  for (const m of msgs) {
    const day = chatDayLabel(m.created_at);
    if (day !== lastDay) {
      const sep = document.createElement('div');
      sep.className = 'chat-day';
      sep.textContent = day;
      body.appendChild(sep);
      lastDay = day;
      lastAuthor = '';
    }
    const p = chatP(m);
    const mine = m.author === me;
    const side = mine ? 'mine' : 'theirs';
    const div = document.createElement('div');
    div.dataset.id = String(m.id);
    if (m._pending) div.dataset.pending = '1';

    if (p.kind === 'nudge') {
      div.className = 'chat-nudge';
      div.innerHTML = `<span class="chat-nudge-emoji">🪼</span> ${mine ? `Le mandaste un toque a ${escapeHtml(chatPartner())}` : `${escapeHtml(m.author)} está pensando en ti`}`;
      body.appendChild(div);
      lastAuthor = '';
      continue;
    }

    const read = mine && Array.isArray(m.read_by) && m.read_by.some(u => u !== me);
    const time = new Date(m.created_at).toLocaleTimeString('es', { hour: 'numeric', minute: '2-digit' });
    const [mark, markTitle] = m._pending ? ['schedule', 'Enviando…'] : read ? ['done_all', 'Leído'] : ['check', 'Enviado'];
    const meta = '<span class="bubble-meta">'
      + (m.featured ? '<span class="material-symbols-outlined filled chat-saved" title="Nota rápida" aria-label="Nota rápida">bookmark</span>' : '')
      + time
      + (mine ? `<span class="material-symbols-outlined read-mark${read ? ' is-read' : ''}" title="${markTitle}" aria-label="${markTitle}">${mark}</span>` : '')
      + (m._pending ? '' : `<button type="button" class="chat-more-btn" data-more="${escapeHtml(String(m.id))}" aria-label="Opciones del mensaje" title="Opciones del mensaje"><span class="material-symbols-outlined">more_horiz</span></button>`)
      + '</span>';
    const state2 = `${m._pending ? ' pending' : ''}${selected === String(m.id) ? ' is-selected' : ''}`;

    if (p.kind === 'sticker') {
      // Sin burbuja: la foto pegada sobre el chat, un poco torcida.
      const k = 150 / Math.max(p.w, p.h);
      const tilt = (p.path.charCodeAt(8) % 2 ? 1 : -1) * (mine ? 2.5 : 2); // estable por archivo
      div.className = `chat-sticker ${side}${p.cutout ? ' cutout' : ''}${state2}`;
      div.innerHTML = `<img src="${escapeHtml(m._localUrl || publicImageUrl(p.path))}" alt="Foto"`
        + ` width="${Math.round(p.w * k)}" height="${Math.round(p.h * k)}" style="--tilt:${tilt}deg" />${meta}`;
    } else if (p.kind === 'share') {
      div.className = `chat-card ${side}${state2}`;
      div.innerHTML = chatShareHtml(p) + meta;
    } else if (p.kind === 'voice') {
      div.className = `chat-bubble voice ${side}${m.author === lastAuthor ? ' follow' : ''}${state2}`;
      div.innerHTML = chatVoiceHtml(p) + meta;
    } else {
      const quote = p.reply
        ? `<button type="button" class="chat-quote" data-jump="${escapeHtml(p.reply.id)}"><b>${escapeHtml(p.reply.author)}</b><span>${escapeHtml(p.reply.snippet)}</span></button>`
        : '';
      div.className = `chat-bubble ${side}${m.author === lastAuthor ? ' follow' : ''}${state2}`;
      div.innerHTML = `${quote}<span class="bubble-text">${linkify(p.text)}</span>${meta}`;
    }
    body.appendChild(div);

    // Reacciones colgadas del mensaje
    const rs = reactions.get(String(m.id));
    if (rs && rs.size) {
      const byEmoji = new Map();
      for (const [author, r] of rs) byEmoji.set(r.emoji, [...(byEmoji.get(r.emoji) || []), author]);
      const row = document.createElement('div');
      row.className = `chat-reactions ${side}`;
      row.innerHTML = [...byEmoji].map(([emoji, authors]) =>
        `<button type="button" data-react="${emoji}" data-target="${escapeHtml(String(m.id))}" class="${authors.includes(me) ? 'is-mine' : ''}" title="${escapeHtml(authors.join(', '))}" aria-label="${emoji} de ${escapeHtml(authors.join(' y '))}">${emoji}${authors.length > 1 ? `<span>${authors.length}</span>` : ''}</button>`
      ).join('');
      body.appendChild(row);
    }
    lastAuthor = m.author;
  }
  body.scrollTop = (opts.stick || atBottom) ? body.scrollHeight : prevTop;
  chatStick = !!(opts.stick || atBottom);
  paintChatVoice();
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

  // Narrative attribution: "Mayck escribió X" reads more like a journal
  // entry than the passive "Se añadió X" with the name buried below.
  // Verb varies by content type to keep the stream from feeling like a
  // template. Fallback "Alguien" only triggers when created_by is null.
  const who = (name) => (name && String(name).trim()) || 'Alguien';
  const named = (title, fallback) => {
    const t = (title || '').trim();
    return t ? `“${t}”` : fallback;
  };

  const all = [
    ...state.notes
      .filter(n => n.visibility !== 'private')
      .map(n => tagItem(n, 'note', mi('edit_note'), '#/notas',
        `${who(n.created_by)} escribió ${named(n.title, 'una nota')}`)),
    ...groupedPhotos.map(g => {
      const slug = g.album ? albumSlugFor(g.album) : '';
      const route = g.album ? `#/fotos/album/${slug}` : '#/fotos';
      const n = g.photos.length;
      const author = who(g.created_by);
      let label;
      if (n > 1) {
        label = g.album
          ? `${author} subió ${n} fotos a ${g.album}`
          : `${author} subió ${n} fotos`;
      } else {
        label = g.album
          ? `${author} subió una foto a ${g.album}`
          : `${author} subió una foto`;
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
    // Title already names the author ("Mayck escribió …"), so meta only
    // needs the timestamp now — keeping the name there would duplicate it.
    a.innerHTML = `
      ${showUnread ? '<span class="dot"></span>' : ''}
      <span class="icon">${it._icon}</span>
      <span class="info">
        <span class="title">${escapeHtml(it._label || 'Sin título')}</span>
        <span class="meta">${fmtDate(it.created_at)}</span>
      </span>
    `;
    a.addEventListener('click', () => { $('#notif-popover').hidden = true; });
    list.appendChild(a);
  }
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
  const saved = await resolveSession();
  if (saved) {
    // Restore the session quickly — hide the (visible-by-default) login,
    // then set up everything else in parallel.
    state.currentUser = saved;
    hideLogin();
    initAuthUI(); // wire pincode for next logout, runs async without blocking
    await loadSettings();
    if (!location.hash) location.hash = '#/inicio';
    await router();
    registerServiceWorker().then(syncPushSubscription);
  } else {
    // Logged out: the auth overlay is already visible in HTML; just wire it up.
    showLogin();
    await initAuthUI();
  }
}
boot();
