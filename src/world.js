// Мир: карта Афин из слоёв, герой, NPC, зрители, камера, маска проходимости и поиск пути.
// Координаты данных — пиксели исходной иллюстрации 1536×1024; в мире умножаются на S.
// Герой — свой лист спрайтов; NPC и зрители — листы мужчин и женщин (вариации — сменой цвета плаща).
import * as audio from './audio.js';

const hexRgb = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

export class World extends Phaser.Scene {
  constructor(data) { super('world'); this.D = data; this.S = data.hotspots.world.scale; this.events_ = {} }
  on(ev, fn) { this.events_[ev] = fn }
  emit(ev, ...a) { this.events_[ev]?.(...a) }

  preload() {
    const L = 'assets/layers/';
    this.load.image('far', L + '01_far_background.jpg');
    ['02_ground_paths', '03_buildings', '04_vegetation', '05_props', '06_foreground'].forEach(k => this.load.image(k, L + k + '.png'));
    this.load.image('mask', L + 'walkability.png');
    this.load.image('heroSheet', 'assets/sprites/hero_sheet.webp');
    this.load.image('menSheet', 'assets/sprites/men_sheet.webp');
    this.load.image('womenSheet', 'assets/sprites/women_sheet.webp');
    this.load.on('progress', p => { const t = document.getElementById('loadingText'); if (t) t.textContent = `Загрузка… ${Math.round(p * 100)}%` });
  }

  create() {
    const S = this.S, H = this.D.hotspots, W = H.world.source_w * S, Hh = H.world.source_h * S, VW = this.scale.width, VH = this.scale.height;
    this.worldW = W; this.worldH = Hh;
    const cam = this.cameras.main; cam.setBounds(0, 0, W, Hh); cam.setRoundPixels(false);
    // слои без параллакса: картинка нарисована цельной, сдвиг слоёв даёт «двоение»
    this.add.image(0, 0, 'far').setOrigin(0).setScale(S).setDepth(-10);
    ['02_ground_paths', '03_buildings', '04_vegetation', '05_props'].forEach((k, i) => this.add.image(0, 0, k).setOrigin(0).setScale(S).setDepth(-9 + i));
    this.D.map.objects.filter(o => o.occluder && o.layer !== '06_foreground' && o.bbox).forEach(o => {
      const b = o.bbox; const ay = o.anchor?.y ?? (b.y + b.h);
      this.add.image(0, 0, o.layer).setOrigin(0).setScale(S).setCrop(b.x, b.y, b.w, b.h).setDepth(ay * S);
    });
    this.add.image(0, 0, '06_foreground').setOrigin(0).setScale(S).setDepth(1e6);
    this.buildMask();
    this.buildPeople();
    const st = H.player.start;
    this.hero = this.add.sprite(st[0] * S, st[1] * S, 'hero', 2).setScale(this.personScale).setOriginFromFrame();
    this.hero.on('animationupdate', () => this.hero.setOriginFromFrame());
    this.spawnWalkers();
    this.heroDir = 'f'; this.path = null; this.control = true; this.seated = null; this.lastNear = undefined;
    this.npcs = {}; this.spectators = []; this.bubbles = []; this.markers = []; this.activeSpots = [];
    const C = H.camera; cam.startFollow(this.hero, false, C.lerp, C.lerp).setDeadzone(C.deadzone[0], C.deadzone[1]);
    this.keys = this.input.keyboard.addKeys('W,A,S,D,UP,DOWN,LEFT,RIGHT,E,SPACE');
    this.input.keyboard.on('keydown-E', () => this.tryInteract());
    this.input.keyboard.on('keydown-SPACE', () => this.tryInteract());
    this.input.on('pointerdown', p => this.onPointer(p));
    this.emit('ready');
  }
  /** Медленная панорама для меню и вступления (без зума, только сдвиг). */
  panorama(on, from = [700, 520], to = [1150, 380], ms = 16000) {
    const cam = this.cameras.main; this.tweens.killTweensOf(cam);
    if (!on) { cam.startFollow(this.hero, false, this.D.hotspots.camera.lerp, this.D.hotspots.camera.lerp); return }
    cam.stopFollow(); const S = this.S;
    cam.centerOn(from[0] * S, from[1] * S);
    this.tweens.add({ targets: cam, scrollX: to[0] * S - cam.width / 2, scrollY: to[1] * S - cam.height / 2, duration: ms, ease: 'Sine.inOut', yoyo: true, repeat: -1 });
  }
  lookAt(sx, sy, ms = 900) { const cam = this.cameras.main; this.tweens.killTweensOf(cam); cam.stopFollow(); cam.pan(sx * this.S, sy * this.S, ms, 'Sine.easeInOut') }
  follow() { const cam = this.cameras.main; this.tweens.killTweensOf(cam); const C = this.D.hotspots.camera; cam.pan(this.hero.x, this.hero.y, 600, 'Sine.easeInOut', false, (c, t) => { if (t === 1) cam.startFollow(this.hero, false, C.lerp, C.lerp) }) }

  // ---------- маска и путь ----------
  buildMask() {
    const img = this.textures.get('mask').getSourceImage();
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
    const g = c.getContext('2d'); g.drawImage(img, 0, 0); const d = g.getImageData(0, 0, c.width, c.height).data;
    this.mw = c.width; this.mh = c.height; this.maskData = new Uint8Array(c.width * c.height);
    for (let i = 0; i < this.maskData.length; i++) this.maskData[i] = d[i * 4] > 128 ? 1 : 0;
    // сетка для поиска пути
    this.cell = 6; this.gw = Math.ceil(this.mw / this.cell); this.gh = Math.ceil(this.mh / this.cell);
    this.grid = new Uint8Array(this.gw * this.gh);
    for (let y = 0; y < this.gh; y++) for (let x = 0; x < this.gw; x++) this.grid[y * this.gw + x] = this.walk(x * this.cell + 3, y * this.cell + 3) ? 1 : 0;
  }
  walk(sx, sy) { sx |= 0; sy |= 0; if (sx < 0 || sy < 0 || sx >= this.mw || sy >= this.mh) return false; return this.maskData[sy * this.mw + sx] === 1 }
  walkW(x, y) { return this.walk(x / this.S, y / this.S) }
  nearestWalkCell(cx, cy) {
    for (let r = 0; r < 25; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue; const x = cx + dx, y = cy + dy;
      if (x >= 0 && y >= 0 && x < this.gw && y < this.gh && this.grid[y * this.gw + x]) return [x, y];
    } return null;
  }
  findPath(fromW, toW) {
    const c = this.cell, S = this.S, gw = this.gw;
    const a = this.nearestWalkCell(Math.floor(fromW.x / S / c), Math.floor(fromW.y / S / c));
    const b = this.nearestWalkCell(Math.floor(toW.x / S / c), Math.floor(toW.y / S / c));
    if (!a || !b) return null;
    const N = this.gw * this.gh, gs = new Float32Array(N).fill(Infinity), from = new Int32Array(N).fill(-1), closed = new Uint8Array(N);
    const start = a[1] * gw + a[0], goal = b[1] * gw + b[0];
    const h = i => { const x = i % gw, y = (i / gw) | 0; const dx = Math.abs(x - b[0]), dy = Math.abs(y - b[1]); return Math.max(dx, dy) + 0.414 * Math.min(dx, dy) };
    const heap = [[h(start), start]]; gs[start] = 0;
    const push = (f, i) => { heap.push([f, i]); let k = heap.length - 1; while (k > 0) { const p = (k - 1) >> 1; if (heap[p][0] <= heap[k][0]) break;[heap[p], heap[k]] = [heap[k], heap[p]]; k = p } };
    const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let k = 0; for (; ;) { const l = 2 * k + 1, r = l + 1; let m = k; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === k) break;[heap[m], heap[k]] = [heap[k], heap[m]]; k = m } } return top };
    let it = 0;
    while (heap.length && it++ < 500000) {
      const [, i] = pop(); if (closed[i]) continue; closed[i] = 1; if (i === goal) break;
      const x = i % gw, y = (i / gw) | 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue; const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= gw || ny >= this.gh) continue;
        const j = ny * gw + nx; if (!this.grid[j] || closed[j]) continue;
        if (dx && dy && (!this.grid[y * gw + nx] || !this.grid[ny * gw + x])) continue;
        const ng = gs[i] + (dx && dy ? 1.414 : 1); if (ng < gs[j]) { gs[j] = ng; from[j] = i; push(ng + h(j), j) }
      }
    }
    if (from[goal] === -1 && goal !== start) return null;
    const pts = []; for (let i = goal; i !== -1 && i !== start; i = from[i]) pts.push(i); pts.reverse();
    // упрощаем: оставляем каждую 3-ю точку и конец
    const all = [{ x: fromW.x / S, y: fromW.y / S }, ...pts.map(i => ({ x: (i % gw) * c + c / 2, y: ((i / gw) | 0) * c + c / 2 })), { x: toW.x / S, y: toW.y / S }];
    const los = (p, q) => { const n = Math.ceil(Math.hypot(q.x - p.x, q.y - p.y) / 2); for (let k = 1; k < n; k++) { const t = k / n; if (!this.walk(p.x + (q.x - p.x) * t, p.y + (q.y - p.y) * t)) return false } return true };
    const out = []; let cur = 0;
    while (cur < all.length - 1) { let nxt = all.length - 1; while (nxt > cur + 1 && !los(all[cur], all[nxt])) nxt--; out.push({ x: all[nxt].x * S, y: all[nxt].y * S }); cur = nxt }
    return out;
  }

  // ---------- листы спрайтов ----------
  /** Убирает белый фон (заливка от краёв и линий сетки), режет на кадры по фигуре с опорой в середине ступней. */
  processSheet(key, cols = 4, rows = 4, scale = 1) {
    const src = this.textures.get(key).getSourceImage();
    const w = Math.round(src.width * scale), h = Math.round(src.height * scale);
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const g = c.getContext('2d', { willReadFrequently: true }); g.imageSmoothingQuality = 'high'; g.drawImage(src, 0, 0, w, h);
    const im = g.getImageData(0, 0, w, h), d = im.data;
    const isBg = i => { const r = d[i], gg = d[i + 1], b = d[i + 2]; return r > 222 && gg > 216 && b > 204 && Math.max(r, gg, b) - Math.min(r, gg, b) < 34 };
    const seen = new Uint8Array(w * h), st = [];
    for (let x = 0; x < w; x++) st.push(x, (h - 1) * w + x); for (let y = 0; y < h; y++) st.push(y * w, y * w + w - 1);
    for (let k = 1; k < cols; k++) { const gx = Math.round(w * k / cols); for (let y = 0; y < h; y++) st.push(y * w + gx) }
    for (let k = 1; k < rows; k++) { const gy = Math.round(h * k / rows); for (let x = 0; x < w; x++) st.push(gy * w + x) }
    while (st.length) { const p = st.pop(); if (seen[p]) continue; seen[p] = 1; if (!isBg(p * 4)) continue; d[p * 4 + 3] = 0; const x = p % w, y = (p / w) | 0; if (x > 0) st.push(p - 1); if (x < w - 1) st.push(p + 1); if (y > 0) st.push(p - w); if (y < h - 1) st.push(p + w) }
    for (let p = 0; p < w * h; p++) { if (!d[p * 4 + 3]) continue; const x = p % w, y = (p / w) | 0; const nb = (x > 0 && !d[(p - 1) * 4 + 3]) || (x < w - 1 && !d[(p + 1) * 4 + 3]) || (y > 0 && !d[(p - w) * 4 + 3]) || (y < h - 1 && !d[(p + w) * 4 + 3]); if (nb && isBg(p * 4)) d[p * 4 + 3] = 90 }
    g.putImageData(im, 0, 0);
    const cw = w / cols, ch = h / rows, frames = [];
    for (let r = 0; r < rows; r++) for (let q = 0; q < cols; q++) {
      const x0 = Math.round(q * cw), y0 = Math.round(r * ch), x1 = Math.round((q + 1) * cw) - 1, y1 = Math.round((r + 1) * ch) - 1;
      let minX = 1e9, minY = 1e9, maxX = -1, maxY = -1;
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (d[(y * w + x) * 4 + 3] > 40) { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y }
      let fx0 = 1e9, fx1 = -1; const fy = maxY - Math.round((maxY - minY) * 0.06);
      for (let y = fy; y <= maxY; y++) for (let x = minX; x <= maxX; x++) if (d[(y * w + x) * 4 + 3] > 40) { if (x < fx0) fx0 = x; if (x > fx1) fx1 = x }
      frames.push({ x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1, px: ((fx0 + fx1) / 2 - minX) / (maxX - minX + 1) });
    }
    return { c, frames };
  }
  addSheet(key, canvas, frames) {
    const tex = this.textures.addCanvas(key, canvas);
    frames.forEach((f, i) => { const fr = tex.add(i, 0, f.x, f.y, f.w, f.h); fr.customPivot = true; fr.pivotX = f.px; fr.pivotY = 0.985 });
    this.sheetFrames[key] = frames;
  }
  /** Смена цвета плаща: пиксели с оттенком около srcHue (насыщенные, ниже головы) получают оттенок dstHue. Только в указанных рядах. */
  hueShift(base, frames, rowsSel, srcHue, dstHue, dstSat = null) {
    const w = base.width, h = base.height; const c = document.createElement('canvas'); c.width = w; c.height = h;
    const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(base, 0, 0);
    const im = g.getImageData(0, 0, w, h), d = im.data; const ch = h / 4, cw = w / 4;
    for (let i = 0; i < d.length; i += 4) {
      if (!d[i + 3]) continue; const p = i / 4, x = p % w, y = (p / w) | 0; const row = Math.min(3, (y / ch) | 0); if (!rowsSel.includes(row)) continue;
      const f = frames[row * 4 + Math.min(3, (x / cw) | 0)]; if ((y - f.y) / f.h < 0.24) continue;
      const r = d[i] / 255, gg = d[i + 1] / 255, b = d[i + 2] / 255; const mx = Math.max(r, gg, b), mn = Math.min(r, gg, b), dl = mx - mn; if (!mx || dl / mx < 0.3) continue;
      let hh = mx === r ? ((gg - b) / dl) % 6 : mx === gg ? (b - r) / dl + 2 : (r - gg) / dl + 4; hh = (hh * 60 + 360) % 360;
      let diff = Math.abs(hh - srcHue); diff = Math.min(diff, 360 - diff); if (diff > 32) continue;
      const nh = (dstHue + (hh - srcHue) + 360) % 360; const s = dstSat ?? Math.min(dl / mx, 0.5); const v = mx;
      const C = v * s, X = C * (1 - Math.abs(((nh / 60) % 2) - 1)), m = v - C; const [rr, g2, bb] = nh < 60 ? [C, X, 0] : nh < 120 ? [X, C, 0] : nh < 180 ? [0, C, X] : nh < 240 ? [0, X, C] : nh < 300 ? [X, 0, C] : [C, 0, X];
      d[i] = (rr + m) * 255; d[i + 1] = (g2 + m) * 255; d[i + 2] = (bb + m) * 255;
    }
    g.putImageData(im, 0, 0); return c;
  }
  portraitFrom(key, idx) { // голова и плечи, как бумажная вырезка
    const f = this.sheetFrames[key][idx]; const src = this.textures.get(key).getSourceImage(); const ph = Math.round(f.h * 0.58);
    const pc = document.createElement('canvas'); pc.width = f.w; pc.height = ph; pc.getContext('2d').drawImage(src, f.x, f.y, f.w, ph, 0, 0, f.w, ph); return pc.toDataURL('image/png');
  }
  buildPeople() {
    this.sheetFrames = {};
    // главный герой — только он
    const H = this.processSheet('heroSheet'); this.addSheet('hero', H.c, H.frames); this.frames = H.frames;
    this.personH = 78 * this.S; this.personScale = this.personH / H.frames[2].h;
    const mk = (key, frames, rate = 8) => this.anims.create({ key, frames: frames.map(f => ({ key: 'hero', frame: f })), frameRate: rate, repeat: -1 });
    mk('walk-r', [4, 5, 6, 7]); mk('walk-f', [8, 9, 10, 11]); mk('walk-b', [12, 13, 14, 15]);
    // мужчины: ряд 0 — старик в жёлтом, 1 — бородач в зелёном, 2 — юноша в синем, 3 — старик в венке
    const M = this.processSheet('menSheet'); this.addSheet('men', M.c, M.frames);
    this.addSheet('men_expert', this.hueShift(M.c, M.frames, [0], 45, 190, 0.38), M.frames);
    this.addSheet('men_herald', this.hueShift(M.c, M.frames, [1], 72, 12, 0.5), M.frames);
    // женщины: ряды 0–1 — в бирюзовом (стоит, идёт), 2–3 — в жёлтом
    const Wm = this.processSheet('womenSheet'); this.addSheet('women', Wm.c, Wm.frames);
    this.anims.create({ key: 'womanA-walk', frames: [4, 5, 6, 7].map(f => ({ key: 'women', frame: f })), frameRate: 7, repeat: -1 });
    this.anims.create({ key: 'womanB-walk', frames: [12, 13, 14, 15].map(f => ({ key: 'women', frame: f })), frameRate: 7, repeat: -1 });
    this.NPC = { archon: ['men', 0], citizen: ['men', 4], guest: ['men', 8], priest: ['men', 12], expert: ['men_expert', 0], herald: ['men_herald', 4] };
    this.portraits = { hero: this.portraitFrom('hero', 2) };
    Object.entries(this.NPC).forEach(([id, [k, i]]) => this.portraits[id] = this.portraitFrom(k, i));
    // зрители — вариации мужчин в уменьшенном листе (разные тона плащей)
    const Ms = this.processSheet('menSheet', 4, 4, 0.42); this.crowdKeys = [];
    const src = [45, 72, 215, 345]; const dst = [[15, 0.6], [300, 0.35], [185, null], [55, null], [130, 0.4], [225, 0.5], [330, null], [25, 0.55]];
    this.addSheet('crowd0', Ms.c, Ms.frames); this.crowdKeys.push('crowd0');
    dst.forEach(([hh, ss], i) => { const k = 'crowd' + (i + 1); let cv = Ms.c; [0, 1, 2, 3].forEach(r => { cv = this.hueShift(cv, Ms.frames, [r], src[r], (hh + r * 37) % 360, ss) }); this.addSheet(k, cv, Ms.frames); this.crowdKeys.push(k) });
    this.crowdScale = (78 * 0.5 * this.S) / Ms.frames[0].h;
  }
  /** Женщины на агоре ходят туда-сюда — живой фон. */
  spawnWalkers() {
    const S = this.S; const routes = [{ anim: 'womanA-walk', idle: 2, a: [470, 806], b: [880, 800], ms: 16000 }, { anim: 'womanB-walk', idle: 10, a: [300, 812], b: [450, 745], ms: 9000 }];
    this.walkers = routes.map((r, i) => {
      const s = this.add.sprite(r.a[0] * S, r.a[1] * S, 'women', r.idle).setScale(this.personH * 0.94 / this.sheetFrames.women[r.idle].h).setOriginFromFrame();
      s.on('animationupdate', () => s.setOriginFromFrame());
      const leg = (from, to) => { s.setFlipX(to[0] < from[0]); s.play(r.anim); this.tweens.add({ targets: s, x: to[0] * S, y: to[1] * S, duration: r.ms, delay: 600 + i * 900, onUpdate: () => s.setDepth(s.y), onComplete: () => { s.anims.stop(); s.setFrame(r.idle).setOriginFromFrame(); this.time.delayedCall(2200, () => leg(to, from)) } }) };
      leg(r.a, r.b); return s;
    });
  }
  setHeroFrame(dx, dy, moving, dt = 16) {
    let want = this.heroDir;
    if (moving) { if (Math.abs(dx) > Math.abs(dy) * 0.9) want = dx > 0 ? 'r' : 'l'; else if (Math.abs(dy) > Math.abs(dx) * 1.1) want = dy > 0 ? 'f' : 'b' }
    // поворот только если новое направление держится дольше 140 мс — без дёрганья на изломах пути
    if (moving && want !== this.heroDir) { this._dirT = (this._dirT || 0) + dt; if (this._dirT < 140 && this._moving) want = this.heroDir; else this._dirT = 0 } else this._dirT = 0;
    const changed = want !== this.heroDir || moving !== this._moving; this.heroDir = want; this._moving = moving; const h = this.hero; const dir = want;
    if (moving) {
      const key = dir === 'l' || dir === 'r' ? 'walk-r' : dir === 'f' ? 'walk-f' : 'walk-b';
      if (changed || h.anims.currentAnim?.key !== key) { h.setFlipX(dir === 'l' || (dir !== 'r' && dx < -0.35)); h.play({ key, startFrame: 1 }, true); h.setOriginFromFrame() }
    } else if (changed || h.anims.isPlaying) {
      h.anims.stop(); h.setFlipX(false); h.setFrame(dir === 'r' ? 0 : dir === 'l' ? 1 : dir === 'f' ? 2 : 3); h.setOriginFromFrame();
    }
  }

  // ---------- NPC ----------
  setNpcs(list) {
    const S = this.S; const keep = new Set(list.map(n => n.id));
    Object.keys(this.npcs).forEach(id => { if (!keep.has(id)) { this.npcs[id].destroy(); delete this.npcs[id] } });
    list.forEach(n => {
      const def = this.D.hotspots.npcs.find(x => x.id === n.id); const p = n.pos || def.pos; const [k, idx] = this.NPC[n.id];
      let s = this.npcs[n.id];
      if (!s) { s = this.add.sprite(p[0] * S, p[1] * S, k, idx).setScale(this.personH * 0.96 / this.sheetFrames[k][idx].h).setOriginFromFrame(); s.def = def; s.base = idx; this.npcs[n.id] = s; if (p[0] > 1250) s.setFlipX(true) }
      s.setPosition(p[0] * S, p[1] * S).setDepth(p[1] * S); s.interact = n.interact || null;
    });
  }
  /** Короткий «разговорный» жест NPC: кадры 1–3 его ряда. */
  gesture(id, ms = 1800) { const s = this.npcs[id]; if (!s) return; let i = 0; const ev = this.time.addEvent({ delay: 450, repeat: Math.floor(ms / 450), callback: () => { i++; s.setFrame(s.base + 1 + (i % 3)).setOriginFromFrame(); if (ev.getRepeatCount() === 0) s.setFrame(s.base).setOriginFromFrame() } }) }
  moveNpc(id, to, ms = 2500) { const s = this.npcs[id]; if (!s) return; this.tweens.add({ targets: s, x: to[0] * this.S, y: to[1] * this.S, duration: ms, ease: 'Sine.inOut', onUpdate: () => s.setDepth(s.y) }) }

  // ---------- зрители ----------
  buildSpectators() {
    if (this.spectators.length) return;
    const S = this.S, cx = 1196, cy = 400; const skene = [1040, 240, 1350, 372]; let k = 0;
    const rand = (() => { let x = 7; return () => (x = (x * 16807) % 2147483647) / 2147483647 })();
    for (let row = 0; row < 9; row++) {
      const rx = 192 + row * 13, ry = 66 + row * 14, steps = 20 + row * 2;
      for (let s = 0; s <= steps; s++) {
        const d0 = 198 + row * 1.8, d1 = 342 - row * 1.8, deg = d0 + ((d1 - d0) * s) / steps, t = deg * Math.PI / 180;
        const x = cx + rx * Math.cos(t), y = cy + ry * Math.sin(t);
        if (x > skene[0] && x < skene[2] && y > skene[1] && y < skene[3]) continue;
        if (rand() < 0.22) continue;
        let grp; if (row <= 2 && deg < 240) grp = 'experts'; else if (deg < 240) grp = 'citizens'; else if (deg < 300) grp = 'metics'; else grp = 'guests';
        const key = this.crowdKeys[k % this.crowdKeys.length], fr = ((k * 7) % 4) * 4; k++;
        const img = this.add.image(x * S, y * S, key, fr).setScale(this.crowdScale * (0.92 + rand() * 0.16)).setOriginFromFrame().setDepth(y * S - 2);
        if (deg > 270) img.setFlipX(true);
        img.grp = grp; img.baseY = img.y; this.spectators.push(img);
      }
    }
  }
  clearSpectators() { this.spectators.forEach(s => s.destroy()); this.spectators = [] }
  /** Плашка-облачко в мире в стиле интерфейса: пергамент, скругление, шрифт реплик. */
  bubble(x, y, text, opts = {}) {
    const t = this.add.text(0, 0, text, { fontFamily: opts.font || 'Neucha, Lora, serif', fontSize: (opts.size || 30) + 'px', color: opts.color || '#3b2f22', align: 'center', lineSpacing: 2 }).setOrigin(0.5);
    const pw = t.width + 28, ph = t.height + 14; const g = this.add.graphics();
    g.fillStyle(0x000000, 0.25).fillRoundedRect(-pw / 2 + 2, -ph / 2 + 5, pw, ph, 6);
    g.fillStyle(0xefe2c4, 1).fillRoundedRect(-pw / 2, -ph / 2, pw, ph, 6).lineStyle(2, 0xc9ae7e, 1).strokeRoundedRect(-pw / 2, -ph / 2, pw, ph, 6);
    if (opts.tail) { g.fillStyle(0xefe2c4, 1).fillTriangle(-10, ph / 2 - 1, 10, ph / 2 - 1, 0, ph / 2 + 12) }
    const ct = this.add.container(x, y, [g, t]).setDepth(2e6); return ct;
  }
  react(map) {
    this.clearReact(); const byG = {};
    this.spectators.forEach(s => { (byG[s.grp] ||= []).push(s); this.tweens.killTweensOf(s); s.y = s.baseY; s.setAngle(0) });
    let strong = 0;
    Object.entries(map).forEach(([g, st]) => {
      const arr = g === 'priest' ? [this.npcs.priest].filter(Boolean) : (byG[g] || []);
      if (!arr.length || st === 'idle') return; if (st === 'laugh' || st === 'stand') strong++;
      arr.forEach((s, i) => {
        if (s.baseY == null) s.baseY = s.y;
        if (st === 'laugh') this.tweens.add({ targets: s, y: s.baseY - 9, duration: 170 + (i % 5) * 18, yoyo: true, repeat: 5, delay: (i % 7) * 35, ease: 'Sine.inOut' });
        else if (st === 'stand') this.tweens.add({ targets: s, y: s.baseY - 13, duration: 320, yoyo: true, repeat: 2, ease: 'Sine.inOut' });
        else if (st === 'boo') this.tweens.add({ targets: s, angle: { from: -6, to: 6 }, duration: 130, yoyo: true, repeat: 6 });
      });
      const mx = arr.reduce((a, s) => a + s.x, 0) / arr.length, my = Math.min(...arr.map(s => s.y));
      const txt = st === 'laugh' ? 'Ха-ха!' : st === 'stand' ? 'Браво!' : st === 'boo' ? 'У-у-у!' : '…';
      const label = (this.D.hotspots.audience_groups[g] || {}).label || '';
      this.bubbles.push(this.bubble(mx, my - this.personH * 0.55 - 40, `${txt}\n${label}`, { tail: true }));
    });
    const d = this.distToTheatre(); audio.laugh(strong / 2, Math.max(0.3, 1 - d / 700));
  }
  clearReact() { this.bubbles.forEach(b => b.destroy()); this.bubbles = [] }

  // ---------- точки интереса ----------
  setSpots(ids) {
    this.markers.forEach(m => { m.ring.destroy(); m.label.destroy() }); this.markers = [];
    this.activeSpots = this.D.hotspots.spots.filter(s => ids.includes(s.id)); const S = this.S;
    this.activeSpots.forEach(s => {
      const [x, y] = s.access;
      const ring = this.add.ellipse(x * S, y * S, 64, 24).setStrokeStyle(3, 0xfff6e4, 0.95).setFillStyle(0xfff6e4, 0.22).setDepth(y * S - 1);
      this.tweens.add({ targets: ring, scale: 1.22, alpha: 0.45, duration: 1200, yoyo: true, repeat: -1, ease: 'Sine.inOut' });
      const label = this.bubble(x * S, y * S - this.personH - 30, s.label, { font: 'Lora, Georgia, serif', size: 24, tail: true });
      this.markers.push({ s, ring, label });
    });
  }
  nearSpot() { const S = this.S, h = this.hero; let best = null, bd = 1e9; this.activeSpots.forEach(s => { const d = Math.hypot(h.x - s.access[0] * S, h.y - s.access[1] * S); if (d < Math.max(s.r * S, 60) && d < bd) { bd = d; best = s } }); return best }
  nearNpc() { const h = this.hero; let best = null, bd = 1e9; Object.entries(this.npcs).forEach(([id, s]) => { if (!s.interact) return; const d = Math.hypot(h.x - s.x, h.y - s.y); if (d < 45 * this.S && d < bd) { bd = d; best = id } }); return best }
  tryInteract() { if (!this.control) return; const n = this.nearNpc(); if (n) { this.emit('npc', n); return } const s = this.nearSpot(); if (s) this.emit('spot', s.id) }
  onPointer(p) {
    if (!this.control) return;
    const wx = p.worldX, wy = p.worldY;
    const n = Object.entries(this.npcs).find(([, s]) => s.interact && Math.hypot(wx - s.x, wy - (s.y - 25 * this.S)) < 30 * this.S);
    if (n && Math.hypot(this.hero.x - n[1].x, this.hero.y - n[1].y) < 50 * this.S) { this.emit('npc', n[0]); return }
    const sp = this.activeSpots.find(s => Math.hypot(wx - s.access[0] * this.S, wy - s.access[1] * this.S) < 45 * this.S);
    if (sp && this.nearSpot() === sp) { this.emit('spot', sp.id); return }
    const target = sp ? { x: sp.access[0] * this.S, y: sp.access[1] * this.S } : n ? { x: n[1].x + 20 * this.S, y: n[1].y + 5 * this.S } : { x: wx, y: wy };
    this.path = this.findPath(this.hero, target);
  }
  walkTo(sx, sy) { this.path = this.findPath(this.hero, { x: sx * this.S, y: sy * this.S }) }
  teleport(sx, sy, dir = 'f') { this.path = null; this.hero.setPosition(sx * this.S, sy * this.S); this.heroDir = dir; this._moving = true; this.setHeroFrame(0, 0, false) }
  setControl(on) { this.control = on; if (!on) { this.path = null; this.setHeroFrame(0, 0, false) } }
  sit(seat) { const sp = this.D.hotspots.spots.find(s => s.seat === seat); this.seated = seat; this.teleport(sp.pos[0] + 6, sp.pos[1] + 4, 'b') }
  stand() { this.seated = null }
  heroSource() { return { x: this.hero.x / this.S, y: this.hero.y / this.S } }
  distToTheatre() { const c = this.D.hotspots.theatre_center; const h = this.heroSource(); return Math.hypot(h.x - c[0], h.y - c[1]) }
  focusStage(on) { if (on) { const C = this.D.hotspots.camera; this.lookAt(C.stage_focus[0], C.stage_focus[1], C.stage_pan_ms) } else this.follow() }

  update(time, dt) {
    const h = this.hero; if (!h) return; dt = Math.min(dt, 50);
    let dx = 0, dy = 0; const k = this.keys; const anyKey = k.A.isDown || k.D.isDown || k.W.isDown || k.S.isDown || k.LEFT.isDown || k.RIGHT.isDown || k.UP.isDown || k.DOWN.isDown;
    if (this.control && !this.seated) {
      if (k.A.isDown || k.LEFT.isDown) dx -= 1; if (k.D.isDown || k.RIGHT.isDown) dx += 1;
      if (k.W.isDown || k.UP.isDown) dy -= 1; if (k.S.isDown || k.DOWN.isDown) dy += 1;
    } else if (this.seated && this.control && anyKey) this.emit('standup');
    const speed = this.D.hotspots.player.speed * this.S * (dt / 1000);
    if (dx || dy) { this.path = null; const l = Math.hypot(dx, dy); dx /= l; dy /= l * 1 }
    else if (this.path && this.path.length) {
      const t = this.path[0]; const vx = t.x - h.x, vy = t.y - h.y, l = Math.hypot(vx, vy);
      if (l < speed * 1.2) { this.path.shift(); if (!this.path.length) { this.path = null; this.emit('arrived') } }
      else { dx = vx / l; dy = vy / l }
    }
    const moving = !!(dx || dy);
    if (moving) {
      const vyk = this.path ? 1 : 0.64; const nx = h.x + dx * speed, ny = h.y + dy * speed * vyk;
      if (this.path) h.setPosition(nx, ny);
      else if (this.walkW(nx, ny)) h.setPosition(nx, ny);
      else if (this.walkW(nx, h.y)) h.setPosition(nx, h.y);
      else if (this.walkW(h.x, ny)) h.setPosition(h.x, ny);
    }
    this.setHeroFrame(dx, dy, moving, dt);
    h.setDepth(h.y);
    // подсказка у точек — только когда меняется цель (иначе DOM перерисовывается каждый кадр)
    let near = null;
    if (this.control) { const n = this.nearNpc(), s = n ? null : this.nearSpot(); near = n ? 'npc:' + n : s ? 'spot:' + s.id : null }
    if (near !== this.lastNear) { this.lastNear = near; this.emit('near', near ? (near.startsWith('npc:') ? { type: 'npc', id: near.slice(4) } : { type: 'spot', id: near.slice(5), label: this.activeSpots.find(s => s.id === near.slice(5))?.label }) : null) }
    if ((this._audioT = (this._audioT || 0) + dt) > 250) { this._audioT = 0; audio.crowdAt(this.distToTheatre(), 350, this.spectators.length ? 0.35 : 0.12) }
  }
}
