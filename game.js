// «Жребий», акт I. Полноэкранная веб-версия (Telegram Mini App), горизонтальный экран.
// Тексты берутся из data/act1.json — его выгружает скрипт export_web.py
// из «Тексты игры/акт_1.yaml» основного репозитория. Тексты правим там.

"use strict";

const tg = window.Telegram && window.Telegram.WebApp;
const inTelegram = Boolean(tg && tg.initData);
const tgAt = (v) => Boolean(tg && tg.isVersionAtLeast && tg.isVersionAtLeast(v));

const $ = (id) => document.getElementById(id);
const els = {
  stage: $("stage"), cam: $("cam"), img: $("img"), hotspots: $("hotspots"),
  caption: $("caption"), tablets: $("tablets"), panel: $("panel"), panelBody: $("panelBody"),
  kicker: $("kicker"), text: $("text"), choices: $("choices"), skip: $("skip"), toast: $("toast"),
  rotate: $("rotate"),
  videoLayer: $("videoLayer"), video: $("video"), videoPlay: $("videoPlay"),
  videoSkip: $("videoSkip"), videoPlate: $("videoPlate"),
  videoCaption: $("videoCaption"), videoNext: $("videoNext"),
};

let T = null; // тексты
let S = null; // состояние игрока

// ---------- кадры и ракурсы камеры ----------
// Ракурс: [масштаб, центр по X, центр по Y] в долях кадра.

const V = {
  full: [1, 0.5, 0.5],
  menuTheatre: [1.8, 0.75, 0.35],   // главный экран без нарисованных кнопок
  urn: [2, 0.52, 0.66],             // агора: урна
  oath: [1.35, 0.33, 0.6],          // присяга: герой и облачко
  theatre: [1.3, 0.62, 0.38],       // театр без нарисованных плашек
  stage: [1.9, 0.8, 0.3],           // сцена с актёрами
  hallLeft: [1.6, 0.3, 0.45],       // зрители слева
  hallRight: [1.6, 0.55, 0.42],     // зрители ближе к сцене
};

// Нарисованные кнопки (в долях кадра 1280×720).
const HOT = {
  menu: [
    [0.405, 0.675, 0.594, 0.744],   // Начать
    [0.405, 0.758, 0.594, 0.831],   // Продолжить
    [0.405, 0.842, 0.594, 0.914],   // Настройки
  ],
  focus: [
    [0.402, 0.411, 0.863, 0.517],   // 1. Сцена
    [0.402, 0.532, 0.863, 0.635],   // 2. Зал
    [0.402, 0.653, 0.863, 0.758],   // 3. Соседи по филе
    [0.402, 0.778, 0.863, 0.883],   // 4. Жрец Диониса
  ],
};

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

function transformFor([s, cx, cy]) {
  const w = 1 / s;
  const left = clamp(cx - w / 2, 0, 1 - w);
  const top = clamp(cy - w / 2, 0, 1 - w);
  return `scale(${s}) translate(${-left * 100}%, ${-top * 100}%)`;
}

let camView = V.full;
function camera(view, ms = 0) {
  camView = view;
  els.cam.style.transition = ms ? `transform ${ms}ms cubic-bezier(.45,.05,.4,1)` : "none";
  els.cam.style.transform = transformFor(view);
}

let currentImage = null;
function setImage(src, view) {
  if (!src || src === currentImage) {
    if (view) camera(view, 900);
    return;
  }
  currentImage = src;
  els.img.classList.add("hidden");
  const pic = new Image();
  pic.onload = pic.onerror = () => {
    els.img.src = src;
    if (view) camera(view, 0);
    requestAnimationFrame(() => els.img.classList.remove("hidden"));
  };
  pic.src = src;
}

// ---------- оформление текста ----------

function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function inline(s) {
  return esc(s)
    .replace(/\*\*(.+?)\*\*/gs, "<b>$1</b>")
    .replace(/(^|[^*])\*(?!\s)(.+?)(?<!\s)\*(?!\*)/gs, "$1<i>$2</i>");
}
function paras(s) {
  return String(s).trim().split(/\n\s*\n/)
    .map((p) => `<p>${inline(p).replace(/\n/g, "<br>")}</p>`).join("");
}
function quote(s) {
  return `<blockquote>${inline(String(s).trim()).replace(/\n/g, "<br>")}</blockquote>`;
}
function splitParas(s) { return String(s).trim().split(/\n\s*\n/); }

// ---------- экран ----------

function hidePanel() {
  els.panel.classList.remove("show");
}

function clearHotspots() { els.hotspots.innerHTML = ""; }

function haptic() { if (tg && tg.HapticFeedback) tg.HapticFeedback.selectionChanged(); }

// screen: { image, view, side, kicker, html, choices: [{label, go, primary}], cols, hotspots }
function show(screen) {
  els.stage.scrollTop = 0;
  els.stage.scrollLeft = 0;
  setImage(screen.image || currentImage, screen.view);
  clearHotspots();
  hideCaption();

  for (const h of screen.hotspots || []) {
    const [x1, y1, x2, y2] = h.box;
    const b = document.createElement("button");
    b.className = "hotspot";
    b.setAttribute("aria-label", h.label);
    Object.assign(b.style, {
      left: `${x1 * 100}%`, top: `${y1 * 100}%`,
      width: `${(x2 - x1) * 100}%`, height: `${(y2 - y1) * 100}%`,
    });
    b.addEventListener("click", () => { haptic(); h.go(); });
    els.hotspots.appendChild(b);
  }

  if (!screen.html && !(screen.choices || []).length) { hidePanel(); return; }

  els.panel.className = "panel " + (screen.side || "right");
  els.kicker.textContent = screen.kicker || "";
  els.text.innerHTML = screen.html || "";
  els.text.classList.remove("fade-in");
  void els.text.offsetWidth;
  els.text.classList.add("fade-in");
  els.panelBody.scrollTop = 0;

  const list = screen.choices || [];
  const auto = list.length >= 4 && list.every((c) => c.label.length <= 22) ? 2 : 0;
  const cols = screen.cols || auto;
  els.choices.className = "choices" + (cols ? ` cols-${cols}` : "");
  els.choices.innerHTML = "";
  for (const c of list) {
    const b = document.createElement("button");
    b.textContent = c.label;
    if (c.primary) b.className = "primary";
    b.addEventListener("click", () => { haptic(); c.go(); }, { once: true });
    els.choices.appendChild(b);
  }
  requestAnimationFrame(() => els.panel.classList.add("show"));
}

const next = (label, go) => [{ label, go, primary: true }];

function toast(msg) {
  els.toast.textContent = msg;
  els.toast.classList.add("show");
  clearTimeout(toast.t);
  toast.t = setTimeout(() => els.toast.classList.remove("show"), 2200);
}

function showCaption(text, top) {
  if (!text) return hideCaption();
  els.caption.innerHTML = inline(text);
  els.caption.style.top = top ? "6%" : "";
  els.caption.style.bottom = top ? "auto" : "";
  els.caption.classList.add("show");
}
function hideCaption() { els.caption.classList.remove("show"); }

// ---------- кат-сцены ----------
// shots: [{ image, from, to, ms, caption, captionTop }]

let cut = null;
function cutscene(shots, done) {
  hidePanel();
  clearHotspots();
  const token = {};
  cut = token;
  let i = 0;

  const finish = () => {
    if (cut !== token) return;
    cut = null;
    els.skip.classList.remove("show");
    els.stage.onclick = null;
    const last = shots[shots.length - 1];
    camera(last.to, 0);
    hideCaption();
    done();
  };

  const play = () => {
    if (cut !== token) return;
    if (i >= shots.length) return finish();
    const sh = shots[i++];
    const go = () => {
      camera(sh.from || camView, 0);
      void els.cam.offsetWidth;
      requestAnimationFrame(() => { if (cut === token) camera(sh.to, sh.ms); });
      if (cut === token) showCaption(sh.caption, sh.captionTop);
      setTimeout(play, sh.ms + (sh.hold || 400));
    };
    if (sh.image && sh.image !== currentImage) {
      currentImage = sh.image;
      const pic = new Image();
      pic.onload = pic.onerror = () => { els.img.src = sh.image; els.img.classList.remove("hidden"); go(); };
      pic.src = sh.image;
    } else {
      go();
    }
  };

  els.skip.classList.add("show");
  els.skip.onclick = (e) => { e.stopPropagation(); finish(); };
  els.stage.onclick = () => finish();
  play();
}

// ---------- видео на весь экран ----------

function playVideo(src, caption, onDone, poster) {
  const v = els.video;
  els.videoPlate.classList.remove("show");
  els.videoSkip.style.display = "";
  els.videoPlay.classList.remove("show");
  els.videoCaption.textContent = caption || "";
  v.src = src;
  if (poster) v.poster = poster;
  els.videoLayer.classList.add("show");

  const finish = () => {
    els.videoPlate.classList.add("show");
    els.videoSkip.style.display = "none";
  };
  v.onended = finish;
  els.videoSkip.onclick = () => { v.pause(); finish(); };
  els.videoPlay.onclick = () => { els.videoPlay.classList.remove("show"); v.play(); };
  els.videoNext.onclick = () => {
    v.pause();
    els.videoLayer.classList.remove("show");
    onDone();
  };
  v.currentTime = 0;
  v.play().catch(() => els.videoPlay.classList.add("show"));
}

// ---------- игра ----------

function newState() {
  return { mood: null, focus: null, score: 0, favorite: null, vote: null, drawn: null };
}
const titles = () => T["комедии"].map((c) => c["название"]);
const shortTitle = (t) => t.split(",").pop().replace(/[«»]/g, "").trim();

// 0. Главный экран: нарисованные кнопки нажимаются.
function menu() {
  S = newState();
  show({
    image: T["старт"]["кадр"], view: V.full,
    hotspots: [
      { box: HOT.menu[0], label: "Начать", go: intro },
      { box: HOT.menu[1], label: "Продолжить", go: () => toast("Сохранений пока нет — нажмите «Начать»") },
      { box: HOT.menu[2], label: "Настройки", go: () => toast("Настройки появятся в следующей версии") },
    ],
  });
}

function intro() {
  const s = T["старт"];
  show({ image: s["кадр"], view: V.menuTheatre, side: "left", kicker: "Великие Дионисии, 421 г. до н. э.", html: paras(s["текст"]), choices: next("Дальше", lot) });
}

// 1. Жребий: наезд камеры на урну.
function lot() {
  const s = T["жребий"];
  show({ image: s["кадр"], view: V.full, side: "right", kicker: "Жребий", html: paras(s["текст"]), choices: next(s["кнопка"], () => {
    cutscene([{ to: V.urn, ms: 3200, hold: 700 }], () => {
      show({ view: V.urn, side: "right", kicker: "Жребий", html: paras(s["после"]), choices: next("Дальше", oath) });
    });
  }) });
}

// Присяга: крупный план (кадр уже нарисован с полосами и облачком).
function oath() {
  const s = T["присяга"];
  cutscene([{ image: s["кадр"], from: V.full, to: V.oath, ms: 3200, hold: 900 }], () => {
    show({
      view: V.oath, side: "right", kicker: "Присяга", html: paras(s["текст"]),
      choices: s["варианты"].map((v, i) => ({ label: v["кнопка"], go: () => {
        S.mood = i;
        show({ view: V.oath, side: "right", kicker: "Присяга", html: paras(v["ответ"]), choices: next("Идти в театр", road) });
      } })),
    });
  });
}

// Дорога в театр: видео на весь экран.
function road() {
  const s = T["дорога"];
  hidePanel();
  playVideo(s["видео"], s["текст"], ceremonies, "media/doroga_poster.jpg");
}

// 2. Церемонии: панорама шествия, затем нарисованный список «Куда смотреть?».
function ceremonies() {
  const s = T["куда_смотреть"];
  const [about, question] = splitParas(s["текст"]);
  cutscene([
    { image: s["кадр"], from: [2.6, 0.3, 0.19], to: [2.6, 0.62, 0.19], ms: 6500, caption: about, hold: 600 },
    { to: V.full, ms: 1400, caption: question, captionTop: true, hold: 300 },
  ], () => {
    show({
      view: V.full,
      hotspots: s["варианты"].map((v, i) => ({ box: HOT.focus[i], label: v["кнопка"], go: () => {
        S.focus = i;
        show({ view: V.full, side: "left", kicker: "Церемонии", html: paras(v["ответ"]), choices: next("К комедиям", () => comedyIntro(0)) });
      } })),
    });
    showCaption(question, true);
  });
}

// 3, 5, 6. Комедии.
function comedyIntro(ci) {
  const c = T["комедии"][ci];
  show({ image: c["кадр"], view: V.theatre, side: "right", kicker: `Комедия ${ci + 1} из 3`, html: `<p><b>${esc(c["название"])}</b></p>` + paras(c["вступление"]), choices: next("Смотреть", () => line(ci, 0)) });
}

function lineKicker(ci, li) {
  const c = T["комедии"][ci];
  return `${c["название"]} · строка ${li + 1} из ${c["строки"].length}`;
}

function line(ci, li) {
  const l = T["комедии"][ci]["строки"][li];
  show({
    view: V.stage, side: "left", kicker: lineKicker(ci, li),
    html: quote(l["текст"]) + "<p><b>В чём шутка?</b></p>", cols: 2,
    choices: T["темы"].map((t, ti) => ({ label: t, go: () => audience(ci, li, ti) })),
  });
}

function audience(ci, li, ti) {
  const l = T["комедии"][ci]["строки"][li];
  show({
    view: V.stage, side: "left", kicker: lineKicker(ci, li),
    html: quote(l["текст"]) + `<p class="note">Вы отметили: ${esc(T["темы"][ti])}</p><p><b>Кто засмеётся громче всех?</b></p>`,
    cols: 3,
    choices: T["зрители"].map((a, ai) => ({ label: a, go: () => reaction(ci, li, ti, ai) })),
  });
}

function laughCaption(who) {
  return who === "Жрец" ? "Громче всех смеётся жрец Диониса" : `Громче всех смеются: ${who.toLowerCase()}`;
}

function reaction(ci, li, ti, ai) {
  const c = T["комедии"][ci];
  const l = c["строки"][li];
  const themeOk = T["темы"][ti] === l["тема"];
  const audOk = T["зрители"][ai] === l["громче_всех"];
  if (themeOk) S.score += 1;

  let html = `<p class="verdict ${themeOk ? "ok" : "miss"}">${themeOk ? "Верно." : "Зал понял шутку иначе."} Тема: ${esc(l["тема"])}.</p>`;
  html += `<p>Громче всех смеялись: <b>${esc(l["громче_всех"])}</b>. ${audOk ? "Вы угадали." : `Вы думали: ${esc(T["зрители"][ai])}.`}</p>`;
  html += paras(l["реакция"]);
  html += `<div class="card"><b>Прототип.</b> ${inline(String(l["прототип"]).trim())}</div>`;
  if (c["условно"]) html += `<p class="note"><i>${esc(T["условно"])}</i></p>`;

  const isLast = li + 1 >= c["строки"].length;
  const after = () => {
    if (!isLast) return line(ci, li + 1);
    if (ci === 0) return interlude("гость", "В зале", 1);
    if (ci === 1) return interlude("спор", "Спор с соседом", 2);
    return favorite();
  };

  cutscene([{ from: V.hallRight, to: V.hallLeft, ms: 2800, caption: laughCaption(l["громче_всех"]), hold: 500 }], () => {
    show({ view: V.hallLeft, side: "right", kicker: lineKicker(ci, li), html, choices: next("Дальше", after) });
  });
}

function interlude(key, kicker, nextComedy) {
  const s = T[key];
  show({
    view: V.hallLeft, side: "right", kicker, html: paras(s["текст"]),
    choices: s["варианты"].map((v) => ({ label: v["кнопка"], go: () => {
      show({
        view: V.hallLeft, side: "right", kicker,
        html: paras(v["ответ"]) + `<div class="card">${paras(s["итог"])}</div>`,
        choices: next("Дальше", () => comedyIntro(nextComedy)),
      });
    } })),
  });
}

// 6–7. Лучшая комедия и шум зала.
function favorite() {
  show({
    view: V.theatre, side: "right", kicker: "Ваш выбор", html: paras(T["лучшая"]["текст"]),
    choices: titles().map((t, i) => ({ label: t, go: () => { S.favorite = i; noise(); } })),
  });
}

const crowdChoice = () => (S.favorite !== 0 ? 0 : 1);

function noise() {
  const s = T["шум"];
  const crowd = titles()[crowdChoice()];
  cutscene([
    { from: V.hallLeft, to: V.hallRight, ms: 1600, caption: `«${shortTitle(crowd)}!» — кричит зал`, hold: 200 },
    { to: V.hallLeft, ms: 1600, caption: `«${shortTitle(crowd)}!»`, hold: 400 },
  ], () => {
    show({
      view: V.hallLeft, side: "right", kicker: "Шум зала",
      html: `<p class="note">${esc(T["лучшая"]["после"])}</p>` + paras(String(s["текст"]).replace("{комедия}", crowd)),
      choices: s["варианты"].map((v, i) => ({ label: v["кнопка"], go: () => {
        S.vote = i === 0 ? crowdChoice() : S.favorite;
        show({ view: V.hallLeft, side: "right", kicker: "Шум зала", html: paras(v["ответ"]) + `<div class="card">${paras(s["итог"])}</div>`, choices: next("К урнам", urns) });
      } })),
    });
  });
}

// 8. Урны: таблички по одной.
function drawnTablets() {
  const winner = titles().indexOf(T["урны"]["победитель"]);
  const others = [0, 1, 2].filter((i) => i !== winner);
  let rest;
  if (!S.drawn) rest = [winner, winner, winner, ...others];
  else if (S.vote === winner) rest = [winner, winner, ...others];
  else rest = [winner, winner, winner, others.find((i) => i !== S.vote)];
  rest.sort(() => Math.random() - 0.5);
  const list = rest.map((i) => ({ i, mine: false }));
  if (S.drawn) list.splice(Math.floor(Math.random() * (list.length + 1)), 0, { i: S.vote, mine: true });
  return list;
}

function urns() {
  const s = T["урны"];
  const image = s["кадр"] || T["жребий"]["кадр"];
  const [about, drawing] = splitParas(s["текст"]);
  show({ image, view: V.urn, side: "right", kicker: "Урны", html: paras(about), choices: next(s["кнопка"], () => {
    S.drawn = Math.random() < 0.5;
    const list = drawnTablets();
    hidePanel();
    showCaption(drawing);
    els.tablets.innerHTML = list.map((t) => `<div class="tablet${t.mine ? " mine" : ""}"><small>${t.mine ? "ваша табличка" : "табличка"}</small>${esc(shortTitle(titles()[t.i]))}</div>`).join("");
    const nodes = [...els.tablets.children];
    nodes.forEach((n, k) => setTimeout(() => n.classList.add("show"), 600 + k * 900));
    setTimeout(() => {
      hideCaption();
      els.tablets.innerHTML = "";
      show({ view: V.urn, side: "right", kicker: "Урны", html: `<p><b>${esc(S.drawn ? s["вынули"] : s["не_вынули"])}</b></p>` + paras(s["итог"]), choices: next("К разбору", review) });
    }, 600 + nodes.length * 900 + 1600);
  }) });
}

// 9. Разбор.
function review() {
  const r = T["разбор"];
  const total = T["комедии"].reduce((n, c) => n + c["строки"].length, 0);
  const grade = r["слух_оценки"].find((g) => S.score >= g["от"])["текст"];
  const courtOk = titles()[S.vote] === T["урны"]["победитель"];

  let html = `<div class="score">
      <div>Слух<strong>${S.score} из ${total}</strong></div>
      <div>Суд<strong>${courtOk ? "совпал" : "не совпал"}</strong></div>
    </div>`;
  html += paras(String(r["слух"]).replace("{N}", S.score).replace("{всего}", total));
  html += `<p>${inline(grade)}</p>`;
  html += paras(courtOk ? r["суд_совпал"] : r["суд_не_совпал"]);
  html += `<p class="note">${esc(S.drawn ? T["урны"]["вынули"] : T["урны"]["не_вынули"])}</p>`;
  html += r["карточки"].map((c) => `<div class="card">${paras(c)}</div>`).join("");
  html += paras(r["вопрос"]);

  const choices = [{ label: r["кнопка"], go: menu, primary: true }];
  if (inTelegram) choices.push({ label: "Закрыть", go: () => tg.close() });
  show({ image: T["старт"]["кадр"], view: V.menuTheatre, side: "right", kicker: "Разбор: голоса эпохи", html, choices });
}

// ---------- экран и Telegram ----------

function insets() {
  const z = { top: 0, bottom: 0, left: 0, right: 0 };
  if (!tg) return z;
  const a = tg.safeAreaInset || z;
  const b = tg.contentSafeAreaInset || z;
  return {
    top: (a.top || 0) + (b.top || 0), bottom: (a.bottom || 0) + (b.bottom || 0),
    left: (a.left || 0) + (b.left || 0), right: (a.right || 0) + (b.right || 0),
  };
}

function layout() {
  const W = window.innerWidth;
  const H = window.innerHeight;
  const portrait = H > W * 1.05;
  els.rotate.classList.toggle("show", portrait);
  if (!portrait && tgAt("8.0")) { try { tg.lockOrientation(); } catch (e) {} }

  const ins = insets();
  const aw = W - ins.left - ins.right;
  const ah = H - ins.top - ins.bottom;
  const w = Math.min(aw, (ah * 16) / 9);
  const h = (w * 9) / 16;
  Object.assign(els.stage.style, {
    width: `${w}px`, height: `${h}px`,
    left: `${ins.left + (aw - w) / 2}px`, top: `${ins.top + (ah - h) / 2}px`,
  });
  els.stage.style.setProperty("--u", `${h / 100}px`);
}

function setupTelegram() {
  if (!tg) return;
  tg.ready();
  tg.expand();
  try { tg.setHeaderColor("#0f0c09"); tg.setBackgroundColor("#0f0c09"); } catch (e) {}
  if (tgAt("8.0")) { try { tg.requestFullscreen(); } catch (e) {} }
  if (tgAt("7.7")) { try { tg.disableVerticalSwipes(); } catch (e) {} }
  if (tgAt("6.2")) { try { tg.enableClosingConfirmation(); } catch (e) {} }
  for (const ev of ["viewportChanged", "safeAreaChanged", "contentSafeAreaChanged", "fullscreenChanged"]) {
    try { tg.onEvent(ev, layout); } catch (e) {}
  }
}

function preload() {
  const seen = new Set();
  JSON.stringify(T, (k, v) => {
    if (k === "кадр" && v && !seen.has(v)) { seen.add(v); new Image().src = v; }
    return v;
  });
}

async function boot() {
  setupTelegram();
  window.addEventListener("resize", layout);
  const res = await fetch("data/act1.json", { cache: "no-cache" });
  T = await res.json();
  preload();
  $("loading").remove();
  els.stage.hidden = false;
  layout();

  // Отдельная сцена по ссылке ?scene=doroga (кнопка в чат-версии бота).
  if (new URLSearchParams(location.search).get("scene") === "doroga") {
    const s = T["дорога"];
    playVideo(s["видео"], s["текст"], () => (inTelegram ? tg.close() : menu()), "media/doroga_poster.jpg");
    return;
  }
  menu();
}

boot().catch((e) => {
  $("loading").textContent = "Не удалось загрузить игру. Обновите страницу.";
  console.error(e);
});
