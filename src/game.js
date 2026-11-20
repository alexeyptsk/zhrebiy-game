// Конечный автомат фаз акта I «Жребий»: от жребия до разбора. Тексты — в data/*.json.
import * as ui from './ui.js';
import * as audio from './audio.js';
const { fmt, esc } = ui;
const SAVE = 'zhrebiy.act1.v1';
const PH = ['start', 'lot', 'parade', 'seat', 'c1', 'interval1', 'c2', 'interval2', 'c3', 'prevote', 'noise', 'urns', 'debrief'];
const rnd = a => a[Math.floor(Math.random() * a.length)];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const SEAT_NPC = { A: 'citizen', B: 'guest', C: 'expert' };
const HINT_OF_NPC = { citizen: 'neighbor_A', guest: 'guest_B', expert: 'expert_C', priest: 'priest' };

export class Game {
  constructor(world, D) { this.w = world; this.D = D; this.C = D.comedies; this.T = D.scenes; this.H = D.hotspots; this.reset() }
  reset() {
    this.f = { mood: null, phyle_name: null, priority_order: [], seat: null, seat_history: [], time_left: 0, themes: {}, laughers: {}, guest_reply: null, argument: null, my_vote: null, crowd_choice: null, crowd_response: null, final_vote: null, vote_drawn: null, winner: null, hint_pair: null, hints_collected: [], hint_pair_guess: null, score_hearing: 0, score_court: 0 };
    this.phase = 'start';
  }
  save() { try { localStorage.setItem(SAVE, JSON.stringify({ phase: this.phase, f: this.f, t: Date.now() })) } catch { } }
  load() { try { return JSON.parse(localStorage.getItem(SAVE) || 'null') } catch { return null } }
  clearSave() { try { localStorage.removeItem(SAVE) } catch { } }
  title(id) { return this.C.comedies.find(c => c.id === id).short }

  // ---------- общие помощники ----------
  waitWorld(kind, ids) { // ждём действие игрока у точки / NPC
    return new Promise(res => { this._wait = { kind, ids, res } });
  }
  bindWorld() {
    const w = this.w;
    w.on('spot', id => { const W = this._wait; if (W && W.kind === 'spot' && W.ids.includes(id)) { this._wait = null; W.res(id) } else this.onSpot?.(id) });
    w.on('npc', id => this.onNpc?.(id));
    w.on('near', n => {
      if (!n) return ui.hidePrompt();
      const lbl = n.type === 'npc' ? (this.H.npcs.find(x => x.id === n.id)?.name || '') : n.label;
      ui.prompt(`<kbd>E</kbd> или нажмите — ${esc(lbl)}`, () => w.tryInteract());
    });
    w.on('standup', () => { if (this.canStand) { w.stand(); ui.notice('Ты встал с места. Вернись до конца антракта.') } });
  }
  runTimer(sec, onTick) { // таймер фазы; возвращает {promise, add(sec), stop()}
    let left = sec, stopped = false, last = performance.now(); const speed = this.f.mood === 'indifferent' ? 1.1 : 1;
    const t = { add: s => { left = Math.max(0, left - s); ui.timer(left) }, stop: () => { stopped = true; ui.timer(null) } };
    t.promise = new Promise(res => {
      const loop = now => { if (stopped) return res('stopped'); if (!this.paused) left -= ((now - last) / 1000) * speed; last = now; this.f.time_left = left; ui.timer(left); onTick?.(left); if (left <= 0) { ui.timer(null); return res('timeout') } requestAnimationFrame(loop) };
      requestAnimationFrame(loop);
    });
    return t;
  }

  // ---------- старт ----------
  async menu() {
    ui.clear(); this.w.setControl(false);
    const saved = this.load();
    const m = document.createElement('div'); m.className = 'menu';
    this.w.panorama(true, [760, 600], [1180, 380], 18000);
    m.innerHTML = `<div class="box" style="position:relative"><div class="over">${esc(this.T.menu.subtitle)}</div><h1>${esc(this.T.menu.title)}</h1><div class="meander"></div><p>${esc(this.T.menu.about)}</p><div class="list" id="mb"></div><p class="soft">Управление: стрелки или WASD, клик мышью по месту; действие — E или клик. Лучше всего — на компьютере или планшете, телефон держите горизонтально.</p></div>`;
    document.getElementById('ui').appendChild(m);
    const mb = m.querySelector('#mb');
    const go = new Promise(res => {
      const b = document.createElement('button'); b.className = 'btn primary'; b.textContent = this.T.menu.start; b.onclick = () => res('new'); mb.appendChild(b);
      if (saved && saved.phase && saved.phase !== 'start' && saved.phase !== 'debrief') { const c = document.createElement('button'); c.className = 'btn'; c.textContent = `${this.T.menu.continue} — ${this.phaseName(saved.phase)}`; c.onclick = () => res('cont'); mb.appendChild(c) }
    });
    const choice = await go; m.remove(); audio.start(); this.w.tweens.killTweensOf(this.w.cameras.main);
    if (choice === 'cont') { this.f = saved.f; this.phase = saved.phase; return this.runFrom(this.phase) }
    this.reset(); this.clearSave(); return this.runFrom('start');
  }
  phaseName(p) { return { lot: 'жребий', parade: 'шествие', seat: 'выбор места', c1: 'комедия 1', interval1: 'антракт 1', c2: 'комедия 2', interval2: 'антракт 2', c3: 'комедия 3', prevote: 'перед голосованием', noise: 'шум зала', urns: 'урны' }[p] || p }

  async runFrom(p) {
    const steps = { start: () => this.pStart(), lot: () => this.pLot(), parade: () => this.pParade(), seat: () => this.pSeat(), c1: () => this.pComedy(0), interval1: () => this.pInterval(1), c2: () => this.pComedy(1), interval2: () => this.pInterval(2), c3: () => this.pComedy(2), prevote: () => this.pPrevote(), noise: () => this.pNoise(), urns: () => this.pUrns(), debrief: () => this.pDebrief() };
    // восстановление позиции при продолжении
    if (PH.indexOf(p) >= PH.indexOf('c1') && this.f.seat) { this.w.buildSpectators(); this.placeTheatreNpcs(); this.w.sit(this.f.seat) }
    else if (p === 'parade') this.w.teleport(380, 760);
    for (let i = PH.indexOf(p); i < PH.length; i++) { this.phase = PH[i]; this.save(); await steps[PH[i]]() }
  }

  // 0 Старт
  async pStart() {
    const ids = this.C.comedies.map(c => c.id);
    this.f.winner = rnd(ids); const other = rnd(ids.filter(i => i !== this.f.winner)); this.f.hint_pair = [this.f.winner, other].sort();
    const shots = [[1150, 300], [1000, 420], [700, 700], [260, 760]];
    for (let i = 0; i < this.T.intro.length; i++) { this.w.lookAt(...shots[i % shots.length], 1400); await ui.caption(esc(this.T.intro[i]), { button: 'Дальше' }) }
    ui.clear(); this.w.follow();
  }
  // 1 Жребий
  async pLot() {
    const w = this.w; const T = this.T.lot; ui.clear();
    w.setNpcs([{ id: 'archon' }]); w.setSpots(['urn_phyle']); w.setControl(true);
    ui.task(T.over, T.go);
    await this.waitWorld('spot', ['urn_phyle']);
    w.setControl(false); w.setSpots([]); ui.task(); ui.hidePrompt();
    this.f.phyle_name = rnd(this.T.phyles);
    this.w.lookAt(200, 740, 700);
    await ui.caption(`${esc(T.text)}<br><b>${esc(fmt(T.result, { phyle: this.f.phyle_name }))}</b><br><span class="soft">${esc(T.note)}</span>`, { button: 'Дальше' });
    const O = this.T.oath; w.gesture('archon', 2600);
    await ui.moment({ speaker: O.speaker, text: O.text, left: w.portraits.hero, right: this.w.portraits.archon, from: 'right', options: [{ label: O.answer, value: 'yes', primary: true }] });
    const M = this.T.mood;
    this.f.mood = await ui.moment({ speaker: M.speaker, text: M.text, left: w.portraits.hero, from: 'left', options: Object.entries(M.options).map(([v, l]) => ({ label: l, value: v })) });
    ui.notice(M.effects[this.f.mood], 4200);
    await sleep(600);
    await ui.video({ src: 'assets/video/road_to_theatre.mp4', caption: 'Герой идёт с агоры к театру. По дороге — шествие.' });
    ui.clear(); w.setNpcs([]); w.teleport(380, 760, 'r'); w.follow();
  }
  // 2 Шествие
  async pParade() {
    const w = this.w, T = this.T.parade; ui.clear();
    w.setSpots(['parade']); w.setControl(true); ui.task(T.over, T.go);
    await this.waitWorld('spot', ['parade']);
    w.setControl(false); w.setSpots([]); ui.task(); ui.hidePrompt();
    const order = [];
    const p = ui.plaqueEl({ over: T.over, title: '', html: `<p>${esc(T.text)}</p><p><b>${esc(T.ask)}</b></p><div class="list" id="rk"></div><p class="soft">${esc(T.explain)}</p><p class="soft">${esc(T.note)}</p>`, side: 'right' });
    const rk = p.querySelector('#rk'); const acts = p.querySelector('.acts');
    const next = document.createElement('button'); next.className = 'btn primary'; next.textContent = 'Дальше'; next.disabled = true; acts.appendChild(next);
    const draw = () => { rk.innerHTML = ''; Object.entries(T.items).forEach(([k, l]) => { const b = document.createElement('button'); const i = order.indexOf(k); b.className = 'btn' + (i >= 0 ? ' picked' : ''); b.innerHTML = (i >= 0 ? `<span class="rank">${i + 1}</span>` : '') + esc(l); b.onclick = () => { if (i >= 0) order.splice(i, 1); else order.push(k); draw() }; rk.appendChild(b) }); next.disabled = order.length < 4 };
    draw();
    await new Promise(r => next.onclick = r);
    this.f.priority_order = order.slice(); ui.clear();
  }
  // 3 Выбор места
  placeTheatreNpcs(interval = 0) {
    const list = [{ id: 'citizen' }, { id: 'guest' }, { id: 'expert' }, { id: 'priest' }, { id: 'herald' }];
    this.w.setNpcs(list);
  }
  async pSeat() {
    const w = this.w, T = this.T.seat, t = this.H.timers.seat; ui.clear();
    w.buildSpectators(); this.placeTheatreNpcs();
    w.setSpots(['seat_A', 'seat_B', 'seat_C']); w.setControl(true); ui.task(T.over, fmt(T.go, { t }));
    const timer = this.runTimer(t);
    let chosen = null;
    const pick = (async () => {
      while (!chosen) {
        const id = await this.waitWorld('spot', ['seat_A', 'seat_B', 'seat_C']); const seat = id.slice(-1); const P = T.places[seat];
        w.setControl(false);
        const v = await ui.plaque({ over: T.over, title: P.name, html: `<p>Рядом: ${esc(P.who)}. ${esc(P.view)}.</p>`, buttons: [{ label: T.sit, value: 'sit', primary: true }, { label: 'Посмотреть другие места', value: 'no' }], side: seat === 'B' ? 'left' : 'right' });
        ui.clear(); w.setControl(true);
        if (v === 'sit') chosen = seat;
      }
    })();
    const r = await Promise.race([pick, timer.promise]);
    timer.stop(); this._wait = null; ui.clear();
    if (!chosen) { chosen = 'A'; ui.notice(T.auto, 3500) }
    this.f.seat = chosen; this.f.seat_history.push(chosen);
    w.setSpots([]); ui.task(); ui.hidePrompt(); w.setControl(false); w.sit(chosen);
    await sleep(500);
  }

  // 4/6/8 Комедия
  async pComedy(k) {
    const w = this.w, c = this.C.comedies[k], T = this.T.comedy; ui.clear(); ui.hidePrompt();
    if (this.f.seat && !w.seated) w.sit(this.f.seat);
    w.setControl(false); w.focusStage(true); this.placeTheatreNpcs();
    await sleep(900);
    await ui.plaque({ over: `${['Первая', 'Вторая', 'Третья'][k]} комедия`, title: `${c.author}, ${c.title}`, html: `<p>${esc(c.premise)}</p><p class="soft">${esc(c.source_note)}</p>`, buttons: [{ label: T.watch, value: 'go', primary: true }], side: 'left' });
    for (let n = 0; n < 2; n++) {
      const L = c.lines[n]; const over = fmt(T.over_tpl, { short: c.short, n: n + 1 });
      // строка звучит: сцена из театра
      let text = L.text; let seatNote = '';
      if (this.f.seat === 'B') { const words = text.split(' '); text = words.map((x, i) => (i % 5 === 3 ? '…' : x)).join(' '); seatNote = T.far }
      if (this.f.seat === 'C') seatNote = T.best;
      const sc = { remove() { } };
      const qHtml = (extra = '') => `<div class="quote">${esc(text)}</div>${seatNote ? `<p class="soft">${esc(seatNote)}</p>` : ''}${extra}`;
      const themeBtns = Object.entries(this.C.themes).map(([v, l]) => ({ label: l, value: v }));
      const theme = await ui.plaque({ over, title: T.q_theme, html: qHtml(), buttons: themeBtns, cols: 2, side: 'right' });
      const audBtns = Object.entries(this.C.audiences).map(([v, l]) => ({ label: l, value: v }));
      const aud = await ui.plaque({ over, title: T.q_aud, html: qHtml(`<p class="soft">Тема: ${esc(this.C.themes[theme])}</p>`), buttons: audBtns, cols: 3, side: 'right' });
      this.f.themes[L.id] = theme; this.f.laughers[L.id] = aud;
      sc.remove(); ui.clear();
      // реакция зала в кадре
      const map = { citizens: 'idle', experts: 'idle', guests: 'idle', metics: 'idle', priest: 'idle' }; map[L.audience] = 'laugh';
      if (L.audience !== 'citizens') map.citizens = 'idle';
      w.react(map); await sleep(1200);
      const okT = theme === L.theme, okA = aud === L.audience;
      const verdict = okT && okA ? `<p class="verdict ok">${T.right}</p>` : `<p class="verdict no">${T.wrong}</p>`;
      const tag = { text: 'текст пьесы, пересказ', fragments: 'по фрагментам', conditional: 'условно' }[L.certainty];
      await ui.plaque({ over, html: `${verdict}<p>Тема: <b>${esc(this.C.themes[L.theme])}</b>${okT ? '' : ` (ты выбрал: ${esc(this.C.themes[theme])})`}.<br>Громче всех смеялись: <b>${esc(this.C.audiences[L.audience])}</b>${okA ? '' : ` (ты выбрал: ${esc(this.C.audiences[aud])})`}.</p><div class="card"><span>${esc(L.explain)}</span><span class="tag">${esc(tag)}</span></div>`, buttons: [{ label: 'Дальше', value: 'n', primary: true }], side: 'left' });
      w.clearReact();
    }
    // после комедии — слухи
    await this.deliverHints(k);
    w.focusStage(false); await sleep(800);
  }

  // ---------- подсказки ----------
  clarity(attention) { const r = this.f.priority_order.indexOf(attention); let c = r === 0 ? 'full' : r === 1 ? 'partial' : 'sound'; if (this.f.mood === 'indifferent' && c === 'full' && attention !== this.f.priority_order[0]) c = 'partial'; return c }
  makeHint(srcId, own) {
    const H = this.D.hints, S = H.sources[srcId]; const tpl = H.templates[S.who];
    let pair = this.f.hint_pair.slice(); let false_ = false;
    if (!own && Math.random() < 0.25) { const ids = this.C.comedies.map(c => c.id); const wrong = ids.filter(i => !pair.includes(i))[0]; pair = [wrong, rnd(pair)].sort(); false_ = true }
    const [A, B] = pair.map(i => this.C.comedies.find(c => c.id === i).title);
    const cl = this.clarity(S.attention); let text, form;
    if (cl === 'full') { form = 'line'; text = fmt(tpl.line[this.f.mood] || tpl.line.peace, { A, B }) }
    else if (cl === 'partial') { form = 'line'; const full = fmt(tpl.line[this.f.mood] || tpl.line.peace, { A, B }); text = fmt(H.unclear.partial, { X: full.split(' ').map((x, i) => (i % 3 === 1 ? '…' : x)).join(' ') }) }
    else { form = Math.random() < 0.5 ? 'sound' : 'gesture'; text = fmt(tpl[form], { A, B }) }
    const h = { source: S.name, srcId, form, pair, own, false: false_, text, clarity: cl };
    this.f.hints_collected.push(h); return h;
  }
  async deliverHints(k) {
    const seat = this.f.seat; const list = [];
    const neigh = { A: 'neighbor_A', B: 'guest_B', C: 'expert_C' }[seat]; list.push([neigh, true]);
    if (seat === 'C') { list.push(['priest', true]); list.push(['stage', true]) }
    else if (this.f.priority_order[0] === 'priest') list.push(['priest', false]);
    else if (this.f.priority_order[0] === 'stage') list.push(['stage', false]);
    list.push(['hall', false]);
    const hs = list.map(([s, own]) => this.makeHint(s, own));
    await ui.plaque({ over: 'Что говорят вокруг', html: `<div class="list">${hs.map(h => `<div class="hint">${esc(h.text)}</div>`).join('')}</div><p class="soft">Всё услышанное — в свитке слева вверху. Не всякий слух верен.</p>`, buttons: [{ label: 'Дальше', value: 'n', primary: true }], side: 'right' });
    this.save();
  }
  showHints() {
    const hs = this.f.hints_collected; this.paused = true;
    const html = hs.length ? `<div class="list">${hs.map(h => `<div class="hint">${esc(h.text)}</div>`).join('')}</div>` : '<p>Пока ты ничего не слышал.</p>';
    const prev = document.querySelector('.plaque, .moment, .scene');
    const box = document.createElement('div'); box.className = 'plaque center'; box.style.zIndex = 5; box.innerHTML = `<div class="body"><div class="over">Услышанное</div>${html}</div><div class="acts"><button class="btn primary">Закрыть</button></div>`;
    box.querySelector('button').onclick = () => { box.remove(); this.paused = false };
    document.getElementById('ui').appendChild(box);
  }

  // 5/7 Антракты
  async pInterval(n) {
    const w = this.w, T = n === 1 ? this.T.interval1 : this.T.interval2, sec = this.H.timers.interval; ui.clear();
    this.placeTheatreNpcs();
    // NPC доступны для разговора
    Object.keys(HINT_OF_NPC).forEach(id => { if (w.npcs[id]) w.npcs[id].interact = id });
    const heard = new Set(); let talkedGuest = false;
    if (n === 1) { const g = this.H.npcs.find(x => x.id === 'guest'); w.moveNpc('guest', g.aisle, 1800); ui.notice('Гость с Хиоса вышел в проход и машет тебе.', 3500) }
    if (n === 2) {
      const who = SEAT_NPC[this.f.seat]; const A = T;
      this.f.argument = await ui.moment({ speaker: A.speaker, text: A.text, left: w.portraits.hero, right: this.w.portraits[who], from: 'right', options: Object.entries(A.options).map(([v, l]) => ({ label: l, value: v })) });
      await ui.moment({ speaker: A.speaker, text: A.reply[this.f.argument], left: w.portraits.hero, right: this.w.portraits[who], from: 'right' });
      ui.clear();
    }
    w.setSpots(['seat_A', 'seat_B', 'seat_C']); w.setControl(true); this.canStand = true;
    ui.task(T.over, fmt(T.go, { t: sec }));
    const timer = this.runTimer(sec);
    this.onNpc = async id => {
      if (n === 1 && id === 'guest' && !talkedGuest) {
        talkedGuest = true; w.setControl(false); this.paused = true;
        const G = this.T.interval1;
        this.f.guest_reply = await ui.moment({ speaker: G.speaker, text: G.text, left: w.portraits.hero, right: this.w.portraits.guest, from: 'right', options: Object.entries(G.options).map(([v, l]) => ({ label: l, value: v })) });
        await ui.moment({ speaker: G.speaker, text: G.reply[this.f.guest_reply], left: w.portraits.hero, right: this.w.portraits.guest, from: 'right' });
        ui.clear(); this.paused = false; w.setControl(true); return;
      }
      if (heard.has(id)) { ui.notice('Этот зритель уже всё тебе сказал.'); return }
      heard.add(id);
      const src = HINT_OF_NPC[id]; if (!src) return;
      const own = (SEAT_NPC[this.f.seat] === id) || (id === 'priest' && this.f.seat === 'C');
      w.gesture(id); const h = this.makeHint(src, own); ui.notice(esc(h.text), 6000);
    };
    this.onSpot = async id => {
      const seat = id.slice(-1); w.setControl(false); this.paused = true;
      if (seat !== this.f.seat) {
        const v = await ui.plaque({ over: T.over, title: `Пересесть: ${this.T.seat.places[seat].name}?`, html: `<p>Рядом: ${esc(this.T.seat.places[seat].who)}. ${esc(this.T.seat.places[seat].view)}.</p><p class="soft">${esc(fmt(this.T.seat.move_cost, { s: this.H.timers.move_cost }))}</p>`, buttons: [{ label: 'Пересесть', value: 'y', primary: true }, { label: 'Остаться при своём месте', value: 'n' }], side: 'left' });
        ui.clear();
        if (v === 'y') { timer.add(this.H.timers.move_cost); this.f.seat = seat; this.f.seat_history.push(seat); w.sit(seat); ui.notice(`Новое место: ${this.T.seat.places[seat].name}.`) }
      } else { w.sit(seat); ui.notice('Ты на своём месте.') }
      this.paused = false; w.setControl(true);
    };
    await timer.promise;
    this.onNpc = null; this.onSpot = null; this.canStand = false;
    Object.values(w.npcs).forEach(s => s.interact = null);
    w.setSpots([]); ui.task(); ui.hidePrompt(); ui.clear();
    if (!w.seated || w.seated !== this.f.seat) { ui.notice('Антракт кончился — ты вернулся на своё место.', 3000); w.sit(this.f.seat) }
    w.setControl(false);
    if (n === 1) { const g = this.H.npcs.find(x => x.id === 'guest'); w.moveNpc('guest', g.pos, 800) }
  }

  // 9 Окно перед голосованием
  async pPrevote() {
    const w = this.w, T = this.T.prevote, B = this.T.best; ui.clear();
    if (!this.f.my_vote) this.f.my_vote = await ui.plaque({ over: B.over, title: B.text, buttons: this.C.comedies.map(c => ({ label: c.short, value: c.id })), side: 'left' });
    // догадка о паре
    const pick = [];
    const p = ui.plaqueEl({ over: T.over, title: T.guess, html: '<div class="list" id="gp"></div>', side: 'left' });
    const gp = p.querySelector('#gp'); const acts = p.querySelector('.acts'); const ok = document.createElement('button'); ok.className = 'btn primary'; ok.textContent = 'Запомнить'; ok.disabled = true; acts.appendChild(ok);
    const draw = () => { gp.innerHTML = ''; this.C.comedies.forEach(c => { const b = document.createElement('button'); b.className = 'btn' + (pick.includes(c.id) ? ' picked' : ''); b.textContent = c.short; b.onclick = () => { const i = pick.indexOf(c.id); if (i >= 0) pick.splice(i, 1); else if (pick.length < 2) pick.push(c.id); draw() }; gp.appendChild(b) }); ok.disabled = pick.length !== 2 };
    draw(); await new Promise(r => ok.onclick = r); this.f.hint_pair_guess = pick.slice().sort(); ui.clear();
    w.setSpots(['urn_vote']); w.setControl(true); this.canStand = true; Object.keys(HINT_OF_NPC).forEach(id => { if (w.npcs[id]) w.npcs[id].interact = id });
    const heard = new Set();
    this.onNpc = id => { if (heard.has(id)) return; heard.add(id); const own = SEAT_NPC[this.f.seat] === id || (id === 'priest' && this.f.seat === 'C'); const h = this.makeHint(HINT_OF_NPC[id], own); ui.notice(esc(h.text), 6000) };
    ui.task(T.over, fmt(T.go, { t: this.H.timers.prevote }));
    const timer = this.runTimer(this.H.timers.prevote);
    const r = await Promise.race([this.waitWorld('spot', ['urn_vote']), timer.promise]);
    timer.stop(); this._wait = null; this.onNpc = null; this.canStand = false;
    Object.values(w.npcs).forEach(s => s.interact = null);
    w.setSpots([]); ui.task(); ui.hidePrompt(); w.setControl(false); w.stand();
    if (r === 'timeout') { ui.notice('Время вышло — распорядитель проводит тебя к урне.', 3000); w.teleport(1206, 590, 'b') }
  }
  // 10 Шум зала
  async pNoise() {
    const w = this.w, T = this.T.noise; ui.clear();
    const others = this.C.comedies.map(c => c.id).filter(i => i !== this.f.my_vote);
    this.f.crowd_choice = rnd(others);
    w.react({ citizens: 'boo', metics: 'laugh', guests: 'idle', experts: 'idle' });
    const tt = id => this.C.comedies.find(c => c.id === id).title; const crowd = tt(this.f.crowd_choice), mine = tt(this.f.my_vote);
    const v = await ui.plaque({ over: T.over, html: `<p>${esc(fmt(T.text, { crowd }))}</p><p class="soft">${esc(T.note)}</p>`, buttons: [{ label: fmt(T.options.follow, { crowd }), value: 'follow' }, { label: fmt(T.options.hold, { mine }), value: 'hold', primary: true }], side: 'right' });
    this.f.crowd_response = v; this.f.final_vote = v === 'follow' ? this.f.crowd_choice : this.f.my_vote; w.clearReact();
  }
  // 11 Урны
  async pUrns() {
    const T = this.T.urns, f = this.f; ui.clear();
    f.vote_drawn = Math.random() < 0.5;
    const ids = this.C.comedies.map(c => c.id);
    // пять вынутых табличек: у победителя больше всех
    const drawn = [];
    if (f.vote_drawn) drawn.push({ v: f.final_vote, mine: true });
    const winCount = 3; let haveWin = drawn.filter(d => d.v === f.winner).length;
    while (drawn.length < 5) { const needWin = winCount - haveWin; const slots = 5 - drawn.length; if (needWin >= slots) { drawn.push({ v: f.winner }); haveWin++ } else { const v = rnd(ids); const cnt = drawn.filter(d => d.v === v).length; if (v !== f.winner && cnt + 1 >= winCount) continue; drawn.push({ v }); if (v === f.winner) haveWin++ } }
    for (let i = drawn.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1));[drawn[i], drawn[j]] = [drawn[j], drawn[i]] }
    const p = ui.plaqueEl({ over: T.over, html: `<p>${esc(T.text)}</p><div class="tablets" id="tb"></div><div id="res"></div><p class="soft">${esc(T.note)}</p>`, side: 'right' });
    const tb = p.querySelector('#tb');
    for (const d of drawn) { await sleep(900); audio.tick(180 + Math.random() * 60); tb.insertAdjacentHTML('beforeend', `<div class="tablet${d.mine ? ' mine' : ''}">${esc(this.title(d.v))}${d.mine ? '<small>ваша табличка</small>' : ''}</div>`) }
    await sleep(700);
    p.querySelector('#res').innerHTML = `<p><b>${esc(f.vote_drawn ? T.drawn : T.not_drawn)}</b></p><p class="verdict ok">${esc(fmt(T.winner, { w: this.title(f.winner) }))}</p>`;
    this.w.react({ citizens: 'stand', metics: 'laugh', guests: 'laugh', experts: 'idle' });
    const acts = p.querySelector('.acts'); const b = document.createElement('button'); b.className = 'btn primary'; b.textContent = 'Разбор'; acts.appendChild(b);
    await new Promise(r => b.onclick = r); this.w.clearReact();
  }
  // 12 Разбор
  async pDebrief() {
    const f = this.f, T = this.T.debrief, cards = this.D.cards; ui.clear();
    let hear = 0; this.C.comedies.forEach(c => c.lines.forEach(L => { if (f.themes[L.id] === L.theme) hear++; if (f.laughers[L.id] === L.audience) hear++ }));
    const pairOk = f.hint_pair_guess && f.hint_pair_guess.join() === f.hint_pair.slice().sort().join();
    const court = (f.final_vote === f.winner ? 1 : 0) + (f.vote_drawn ? 1 : 0) + (pairOk ? 1 : 0);
    f.score_hearing = hear; f.score_court = court;
    const hs = f.hints_collected; const falseN = hs.filter(h => h.false).length;
    const conds = new Set([f.crowd_response === 'follow' ? 'followed_crowd' : 'held', hear >= 8 ? 'hearing_high' : 'hearing_low', 'voted_' + f.final_vote]); if (f.guest_reply === 'explain') conds.add('guest_explain');
    const list = [...cards.conditional.filter(c => conds.has(c.when)), ...cards.always];
    this.phase = 'debrief'; this.save();
    const html = `<div class="score"><div class="cell"><div class="over">${T.hearing}</div><div class="num">${hear} / 12</div><div class="soft">${esc(T.hearing_note)}</div></div><div class="cell"><div class="over">${T.court}</div><div class="num">${court} / 3</div><div class="soft">${f.final_vote === f.winner ? 'голос совпал' : 'голос не совпал'} · ${f.vote_drawn ? 'табличку прочли' : 'табличку не прочли'} · ${pairOk ? 'пару угадал' : 'пару не угадал'}</div></div></div>
      <div class="card"><b>${T.hints_title}</b><span>Собрано: ${hs.length}. Из них ложных: ${falseN}. ${f.crowd_response === 'follow' ? 'Ты поддался шуму зала.' : 'Ты не поддался шуму зала.'} Слухи шептали о паре: ${f.hint_pair.map(i => this.title(i)).join(' и ')}.</span></div>
      ${list.map(c => `<div class="card"><b>${esc(c.title)}</b><span>${esc(c.text)}</span><span class="tag">${esc(cards.tags[c.tag])}</span></div>`).join('')}`;
    await ui.plaque({ over: T.over, html, buttons: [{ label: T.again, value: 'again', primary: true }], side: 'right' });
    this.clearSave(); this.reset(); this.w.clearSpectators(); this.w.setNpcs([]); this.w.teleport(...this.H.player.start); return this.menu();
  }
}
