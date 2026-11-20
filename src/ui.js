// Интерфейс поверх кадра: плашки, крупные моменты, подписи, таймер, иконки. Всё — DOM, стили в styles.css.
const ui = () => document.getElementById('ui');
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export const fmt = (tpl, o = {}) => String(tpl).replace(/\{(\w+)\}/g, (_, k) => (o[k] ?? `{${k}}`));

let layer = null; // текущая плашка/момент/сцена
function clearLayer() { if (layer) { layer.remove(); layer = null } }
export function clear() { clearLayer(); hidePrompt() }

function el(html) { const d = document.createElement('div'); d.innerHTML = html.trim(); return d.firstElementChild }

/** Плашка. buttons: [{label, value, primary}] — промис возвращает value. html — готовая разметка тела. */
export function plaque({ over = '', title = '', html = '', buttons = [], side = 'left', cols = 1, keep = false }) {
  // если такая же плашка уже стоит на этом месте — меняем только содержимое, без мигания
  const reuse = layer && layer.classList.contains('plaque') && layer.classList.contains(side) && layer.isConnected;
  if (!reuse) clearLayer();
  return new Promise(res => {
    const inner = `<div class="body">${over ? `<div class="over">${esc(over)}</div>` : ''}${title ? `<h2>${esc(title)}</h2>` : ''}${html}</div><div class="acts ${cols === 2 ? 'two' : cols === 3 ? 'three' : ''}"></div>`;
    let p; if (reuse) { p = layer; p.classList.add('still'); p.innerHTML = inner } else p = el(`<div class="plaque ${side}" role="dialog">${inner}</div>`);
    const acts = p.querySelector('.acts');
    if (!buttons.length) acts.remove();
    buttons.forEach(b => {
      const btn = document.createElement('button');
      btn.className = 'btn' + (b.primary ? ' primary' : '');
      btn.innerHTML = b.html || esc(b.label);
      btn.onclick = () => { if (!keep) { acts.querySelectorAll('button').forEach(x => x.disabled = true) } res(b.value ?? b.label) };
      acts.appendChild(btn);
    });
    if (!reuse) ui().appendChild(p); layer = p;
    p.querySelector('.body').scrollTop = 0;
    const first = acts.querySelector('button'); if (first) setTimeout(() => first.focus({ preventScroll: true }), 50);
  });
}
/** Плашка без ожидания: вернёт сам элемент (для живых списков, например ранжирования). */
export function plaqueEl({ over = '', title = '', html = '', side = 'left' }) {
  clearLayer();
  const p = el(`<div class="plaque ${side}"><div class="body">${over ? `<div class="over">${esc(over)}</div>` : ''}${title ? `<h2>${esc(title)}</h2>` : ''}${html}</div><div class="acts"></div></div>`);
  ui().appendChild(p); layer = p; return p;
}

/** Крупный момент: затемнение, рваные полосы, портреты и облачко. */
export function moment({ speaker, text, left = null, right = null, from = 'left', options = [], bg = null }) {
  const again = layer && layer.classList.contains('moment') && layer.isConnected;
  clearLayer();
  return new Promise(res => {
    const m = el(`<div class="moment${again ? ' still' : ''}">${bg ? `<div class="scene" style="animation:none"><img src="${bg}" alt=""></div>` : ''}<div class="dim"></div><div class="bar top"></div><div class="mid"></div><div class="bar bot"></div></div>`);
    const mid = m.querySelector('.mid');
    if (left) mid.appendChild(portrait(left));
    const b = el(`<div class="bubble from-${from}"><div class="who">${esc(speaker)}</div><div class="say">${esc(text)}</div><div class="acts"></div></div>`);
    mid.appendChild(b);
    if (right) mid.appendChild(portrait(right));
    const acts = b.querySelector('.acts');
    const opts = options.length ? options : [{ label: 'Дальше', value: 'next', primary: true }];
    opts.forEach(o => { const btn = document.createElement('button'); btn.className = 'btn' + (o.primary ? ' primary' : ''); btn.textContent = o.label; btn.onclick = () => { acts.querySelectorAll('button').forEach(x => x.disabled = true); res(o.value ?? o.label) }; acts.appendChild(btn) });
    ui().appendChild(m); layer = m;
    setTimeout(() => acts.querySelector('button')?.focus({ preventScroll: true }), 60);
  });
}
function portrait(p) {
  if (typeof p === 'string' && p.startsWith('<svg')) { const d = el(`<div class="portrait svg">${p}</div>`); return d }
  const img = document.createElement('img'); img.className = 'portrait'; img.src = p; img.alt = ''; return img;
}

/** Полноэкранная иллюстрация с подписью и кнопкой. */
export function scene({ src, caption, button = 'Дальше', pan = true }) {
  clearLayer();
  return new Promise(res => {
    const s = el(`<div class="scene"><img class="${pan ? 'pan' : ''}" src="${src}" alt=""><div class="caption"><div>${caption}</div><div class="acts"><button class="btn primary">${esc(button)}</button></div></div></div>`);
    const go = () => res('next');
    s.querySelector('button').onclick = go;
    ui().appendChild(s); layer = s;
  });
}
/** Видео-катсцена с «Пропустить». */
export function video({ src, caption }) {
  clearLayer();
  return new Promise(res => {
    const s = el(`<div class="scene"><video src="${src}" muted playsinline preload="auto"></video><button class="skip">Пропустить</button></div>`);
    const v = s.querySelector('video'); let done = false;
    const end = () => { if (done) return; done = true; const cap = el(`<div class="caption"><div>${caption}</div><div class="acts"><button class="btn primary">Дальше</button></div></div>`); s.appendChild(cap); cap.querySelector('button').onclick = () => res('next'); s.querySelector('.skip')?.remove() };
    v.onended = end; v.onerror = end;
    s.querySelector('.skip').onclick = () => { v.pause(); end() };
    s.addEventListener('click', e => { if (e.target === v) { v.pause(); end() } });
    ui().appendChild(s); layer = s;
    const p = v.play(); if (p && p.catch) p.catch(() => { const b = el('<button class="play" aria-label="Смотреть">▶</button>'); s.appendChild(b); b.onclick = () => { b.remove(); v.play().catch(end) } });
  });
}
/** Подпись катсцены, гаснет сама или по кнопке. */
export function caption(text, { button = null, ms = 0 } = {}) {
  clearLayer();
  return new Promise(res => {
    const c = el(`<div class="caption"><div>${text}</div>${button ? `<div class="acts"><button class="btn primary">${esc(button)}</button></div>` : ''}</div>`);
    ui().appendChild(c); layer = c;
    if (button) c.querySelector('button').onclick = () => res('next');
    if (ms) setTimeout(() => { if (layer === c) clearLayer(); res('timeout') }, ms);
  });
}

let noticeT = null;
export function notice(text, ms = 2200) {
  let n = document.querySelector('.notice'); if (n) n.remove();
  n = el(`<div class="notice">${text}</div>`); ui().appendChild(n);
  clearTimeout(noticeT); noticeT = setTimeout(() => n.remove(), ms);
}

let timerEl = null;
export function timer(sec) {
  if (sec == null) { timerEl?.remove(); timerEl = null; return }
  if (!timerEl) { timerEl = el('<div class="timer"></div>'); ui().appendChild(timerEl) }
  const s = Math.max(0, Math.ceil(sec)); if (timerEl._s === s) return; timerEl._s = s;
  timerEl.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  timerEl.classList.toggle('low', s <= 10);
}

let taskEl = null;
export function task(over, text) {
  if (!text) { taskEl?.remove(); taskEl = null; return }
  if (!taskEl) { taskEl = el('<div class="task"></div>'); ui().appendChild(taskEl) }
  taskEl.innerHTML = `<span class="over">${esc(over)}</span>${esc(text)}`;
}

let promptEl = null;
export function prompt(text, onClick) {
  if (!text) return hidePrompt();
  if (!promptEl) { promptEl = el('<div class="prompt" role="button" tabindex="0"></div>'); ui().appendChild(promptEl) }
  if (promptEl._t !== text) { promptEl.innerHTML = text; promptEl._t = text } promptEl.onclick = onClick || null;
}
export function hidePrompt() { promptEl?.remove(); promptEl = null }

/** Иконки по углам. */
export function icons({ onMenu, onHints, onSound, onFull }) {
  const left = el(`<div class="icons left"><button class="icon" aria-label="Меню и пауза"><svg viewBox="0 0 24 24"><rect x="6" y="5" width="4" height="14" rx="1" fill="#3b2f22"/><rect x="14" y="5" width="4" height="14" rx="1" fill="#3b2f22"/></svg></button><button class="icon" aria-label="Услышанные подсказки"><svg viewBox="0 0 24 24"><rect x="5" y="4" width="14" height="16" rx="2" fill="#e6d5b0" stroke="#3b2f22" stroke-width="1.6"/><path d="M8 9h8M8 12.5h8M8 16h5" stroke="#8f3f22" stroke-width="1.6"/></svg></button></div>`);
  const right = el(`<div class="icons right"><button class="icon" aria-label="Звук" aria-pressed="true"><svg viewBox="0 0 24 24"><path d="M4 10h4l5-4v12l-5-4H4z" fill="#3b2f22"/><path d="M16 9c1.5 1.5 1.5 4.5 0 6M18.5 7c3 3 3 7 0 10" stroke="#3b2f22" stroke-width="1.6" fill="none"/></svg></button><button class="icon" aria-label="Полный экран"><svg viewBox="0 0 24 24"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" stroke="#3b2f22" stroke-width="2" fill="none"/></svg></button></div>`);
  const [bMenu, bHints] = left.querySelectorAll('button'); const [bSound, bFull] = right.querySelectorAll('button');
  bMenu.onclick = onMenu; bHints.onclick = onHints;
  bSound.onclick = () => { const on = bSound.getAttribute('aria-pressed') !== 'true'; bSound.setAttribute('aria-pressed', on); onSound(on) };
  bFull.onclick = onFull;
  ui().append(left, right);
}
export { esc };
