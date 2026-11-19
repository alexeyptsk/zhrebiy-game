// «Жребий», акт I. Полноэкранная веб-версия (Telegram Mini App).
// Тексты берутся из data/act1.json — его выгружает скрипт export_web.py
// из «Тексты игры/акт_1.yaml» основного репозитория. Тексты правим там.

"use strict";

const tg = window.Telegram && window.Telegram.WebApp;
const inTelegram = Boolean(tg && tg.initData);

const $ = (id) => document.getElementById(id);
const els = {
  app: $("app"), img: $("img"), panel: $("panel"), kicker: $("kicker"),
  text: $("text"), choices: $("choices"),
  videoLayer: $("videoLayer"), video: $("video"), videoPlay: $("videoPlay"),
  videoSkip: $("videoSkip"), videoPlate: $("videoPlate"),
  videoCaption: $("videoCaption"), videoNext: $("videoNext"),
};

let T = null; // тексты
let S = null; // состояние игрока

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

// ---------- экран ----------

let currentImage = null;

function setImage(src) {
  if (!src || src === currentImage) return;
  currentImage = src;
  els.img.classList.add("hidden");
  const next = new Image();
  next.onload = next.onerror = () => {
    els.img.src = src;
    els.img.classList.remove("hidden");
  };
  next.src = src;
}

// screen: { image, kicker, html, choices: [{label, go, primary}], cols }
function show(screen) {
  setImage(screen.image);
  els.kicker.textContent = screen.kicker || "";
  els.kicker.hidden = !screen.kicker;
  els.text.innerHTML = screen.html || "";
  els.text.classList.remove("fade-in");
  void els.text.offsetWidth;
  els.text.classList.add("fade-in");
  els.panel.scrollTop = 0;

  els.choices.innerHTML = "";
  const list = screen.choices || [];
  // Четыре и больше коротких вариантов — в две колонки, чтобы текст не уезжал под кнопки.
  const auto = list.length >= 4 && list.every((c) => c.label.length <= 22) ? 2 : 0;
  const cols = screen.cols || auto;
  els.choices.className = "choices" + (cols ? ` cols-${cols}` : "");
  for (const c of screen.choices || []) {
    const b = document.createElement("button");
    b.textContent = c.label;
    if (c.primary) b.className = "primary";
    b.addEventListener("click", () => {
      if (tg && tg.HapticFeedback) tg.HapticFeedback.selectionChanged();
      c.go();
    }, { once: true });
    els.choices.appendChild(b);
  }
}

const next = (label, go) => [{ label, go, primary: true }];

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

function titles() { return T["комедии"].map((c) => c["название"]); }

function start() {
  S = newState();
  const s = T["старт"];
  show({ image: s["кадр"], kicker: "Великие Дионисии, 421 г. до н. э.", html: paras(s["текст"]), choices: next(s["кнопка"], lot) });
}

function lot() {
  const s = T["жребий"];
  show({ image: s["кадр"], kicker: "Жребий", html: paras(s["текст"]), choices: next(s["кнопка"], lotResult) });
}

function lotResult() {
  const s = T["жребий"];
  show({ image: s["кадр"], kicker: "Жребий", html: paras(s["после"]), choices: next("Дальше", oath) });
}

function options(key, kicker, onPick, extraHtml) {
  const s = T[key];
  show({
    image: s["кадр"] || currentImage,
    kicker,
    html: (extraHtml || "") + paras(s["текст"]),
    choices: s["варианты"].map((v, i) => ({ label: v["кнопка"], go: () => onPick(i) })),
  });
}

function oath() {
  options("присяга", "Присяга", (i) => {
    S.mood = i;
    const s = T["присяга"];
    show({ image: s["кадр"], kicker: "Присяга", html: paras(s["варианты"][i]["ответ"]), choices: next("Идти в театр", road) });
  });
}

function road() {
  const s = T["дорога"];
  playVideo(s["видео"], s["текст"], focus, "media/doroga_poster.jpg");
}

function focus() {
  options("куда_смотреть", "Церемонии", (i) => {
    S.focus = i;
    const s = T["куда_смотреть"];
    show({ image: s["кадр"], kicker: "Церемонии", html: paras(s["варианты"][i]["ответ"]), choices: next("К комедиям", () => comedyIntro(0)) });
  });
}

function comedyIntro(ci) {
  const c = T["комедии"][ci];
  show({ image: c["кадр"], kicker: `Комедия ${ci + 1} из 3`, html: `<p><b>${esc(c["название"])}</b></p>` + paras(c["вступление"]), choices: next("Смотреть", () => line(ci, 0)) });
}

function lineKicker(ci, li) {
  const c = T["комедии"][ci];
  return `${c["название"]} · строка ${li + 1} из ${c["строки"].length}`;
}

function line(ci, li) {
  const c = T["комедии"][ci];
  const l = c["строки"][li];
  show({
    image: c["кадр"],
    kicker: lineKicker(ci, li),
    html: quote(l["текст"]) + "<p><b>В чём шутка?</b></p>",
    cols: 2,
    choices: T["темы"].map((t, ti) => ({ label: t, go: () => audience(ci, li, ti) })),
  });
}

function audience(ci, li, ti) {
  const c = T["комедии"][ci];
  const l = c["строки"][li];
  show({
    image: c["кадр"],
    kicker: lineKicker(ci, li),
    html: quote(l["текст"]) + `<p class="note">Вы отметили: ${esc(T["темы"][ti])}</p><p><b>Кто засмеётся громче всех?</b></p>`,
    cols: 3,
    choices: T["зрители"].map((a, ai) => ({ label: a, go: () => reaction(ci, li, ti, ai) })),
  });
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
  show({ image: c["кадр"], kicker: lineKicker(ci, li), html, choices: next("Дальше", after) });
}

function interlude(key, kicker, nextComedy) {
  options(key, kicker, (i) => {
    const s = T[key];
    show({
      image: currentImage,
      kicker,
      html: paras(s["варианты"][i]["ответ"]) + `<div class="card">${paras(s["итог"])}</div>`,
      choices: next("Дальше", () => comedyIntro(nextComedy)),
    });
  });
}

function favorite() {
  show({
    image: T["комедии"][0]["кадр"],
    kicker: "Ваш выбор",
    html: paras(T["лучшая"]["текст"]),
    choices: titles().map((t, i) => ({ label: t, go: () => { S.favorite = i; noise(); } })),
  });
}

function crowdChoice() { return S.favorite !== 0 ? 0 : 1; }

function noise() {
  const s = T["шум"];
  const html = `<p class="note">${esc(T["лучшая"]["после"])}</p>` + paras(String(s["текст"]).replace("{комедия}", titles()[crowdChoice()]));
  show({
    image: currentImage,
    kicker: "Шум зала",
    html,
    choices: s["варианты"].map((v, i) => ({
      label: v["кнопка"],
      go: () => {
        S.vote = i === 0 ? crowdChoice() : S.favorite;
        show({ image: currentImage, kicker: "Шум зала", html: paras(v["ответ"]) + `<div class="card">${paras(s["итог"])}</div>`, choices: next("К урнам", urns) });
      },
    })),
  });
}

function urns() {
  const s = T["урны"];
  const image = s["кадр"] || T["жребий"]["кадр"];
  show({ image, kicker: "Урны", html: paras(s["текст"]), choices: next(s["кнопка"], () => {
    S.drawn = Math.random() < 0.5;
    show({ image, kicker: "Урны", html: `<p><b>${esc(S.drawn ? s["вынули"] : s["не_вынули"])}</b></p>` + paras(s["итог"]), choices: next("К разбору", review) });
  }) });
}

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

  const choices = [{ label: r["кнопка"], go: start, primary: true }];
  if (inTelegram) choices.push({ label: "Закрыть", go: () => tg.close() });
  show({ image: T["старт"]["кадр"], kicker: "Разбор: голоса эпохи", html, choices });
}

// ---------- запуск ----------

function setupTelegram() {
  if (!tg) return;
  tg.ready();
  tg.expand();
  const at = (v) => tg.isVersionAtLeast && tg.isVersionAtLeast(v);
  try { tg.setHeaderColor("#17130e"); tg.setBackgroundColor("#17130e"); } catch (e) {}
  if (at("8.0")) { try { tg.requestFullscreen(); } catch (e) {} }
  if (at("7.7")) { try { tg.disableVerticalSwipes(); } catch (e) {} }
  if (at("6.2")) { try { tg.enableClosingConfirmation(); } catch (e) {} }
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
  const res = await fetch("data/act1.json", { cache: "no-cache" });
  T = await res.json();
  preload();
  $("loading").remove();
  els.app.hidden = false;

  // Отдельная сцена по ссылке ?scene=doroga (кнопка в чат-версии бота).
  const scene = new URLSearchParams(location.search).get("scene");
  if (scene === "doroga") {
    const s = T["дорога"];
    playVideo(s["видео"], s["текст"], () => {
      if (inTelegram) tg.close();
      else start();
    }, "media/doroga_poster.jpg");
    return;
  }
  start();
}

boot().catch((e) => {
  $("loading").textContent = "Не удалось загрузить игру. Обновите страницу.";
  console.error(e);
});
