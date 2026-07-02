/* ============================================================
   Todo Incremental — "Number Go Up" v2
   Idle/incremental-hybride zonder klik-component:
   - Taken zijn de ENIGE bron van inkomen (variabele beloning).
   - Generatoren (gekocht met punten) laten het getal vanzelf
     tikken — exponentiële groei, mijlpaal-verdubbelingen.
   - De dagelijkse loting markeert bonustaken (×2), gate niets.
   - Momentum: elke voltooide taak boost de productie tijdelijk.
   - Combo's, streaks + freeze, mystery box, prestige, levels.
   Data: localStorage, geen backend.
   ============================================================ */

"use strict";

const STORAGE_KEY = "todo-incremental-v2";
const LEGACY_KEY = "todo-incremental-v1";

/* ---------- Constanten ---------- */

const BASE_POINTS = { S: 10, M: 25, L: 50, XL: 100 };
// Een taak is óók X seconden productie waard — zo blijven echte
// taken relevant, hoe groot het getal ook wordt.
const TIME_WORTH = { S: 60, M: 180, L: 480, XL: 1200 };
// Momentum: ×2 productie, duur per taakgrootte (minuten)
const MOMENTUM_MIN = { S: 30, M: 60, L: 120, XL: 240 };
const MOMENTUM_CAP_H = 12;
const MOMENTUM_MULT = 2;

const DRAW_BONUS = 2;              // bonusloten uit de loting: ×2
const COMBO_STEP = 0.08;
const COMBO_MAX = 0.80;
const STREAK_WEEKLY_BONUS = 2;
const STREAK_BONUS_CAP = 50;
const PP_BONUS = 2;                // +2% globaal per prestige-punt
const PRESTIGE_UNIT = 5000;        // PP = floor(√(run-PT / 5000))
const REROLL_BASE_COST = 25;
const LEVEL_BASE = 500;            // level-drempels groeien ×1,35
const LEVEL_GROWTH = 1.35;

const GENERATORS = [
  { id: "g1", name: "Teller",        rate: 0.1,   cost: 15 },
  { id: "g2", name: "Dubbelteller",  rate: 1,     cost: 100 },
  { id: "g3", name: "Rekenmachine",  rate: 8,     cost: 1100 },
  { id: "g4", name: "Spreadsheet",   rate: 47,    cost: 12000 },
  { id: "g5", name: "Server",        rate: 260,   cost: 130000 },
  { id: "g6", name: "Serverpark",    rate: 1400,  cost: 1.4e6 },
  { id: "g7", name: "Quantumteller", rate: 7800,  cost: 2e7 },
  { id: "g8", name: "Singulariteit", rate: 44000, cost: 3.3e8 },
];
const MILESTONES = [10, 25, 50, 100]; // per tier: output ×2 per mijlpaal

const UPGRADES = [
  { id: "vroegeVogel",  name: "Vroege Vogel",   base: 100, max: 3,
    effect: (l) => `+${l * 15}% taak-inkomen vóór 10:00` },
  { id: "extraLot",     name: "Extra Lot",      base: 250, max: 1,
    effect: () => "4e bonuslot in de dagelijkse loting" },
  { id: "herkansing",   name: "Herkansing+",    base: 150, max: 2,
    effect: (l) => `+${l} extra gratis reroll${l > 1 ? "s" : ""} per dag` },
  { id: "streakSchild", name: "Streak Schild",  base: 300, max: 1,
    effect: () => "+1 streak-freeze token per maand" },
  { id: "comboMeester", name: "Combo Meester",  base: 200, max: 1,
    effect: () => "Combo-venster 4u → 6u" },
  { id: "jackpotVinger",name: "Jackpot Vinger", base: 500, max: 3,
    effect: (l) => `Jackpotkans 1% → ${(1 + l * 0.5).toLocaleString("nl")}%` },
  { id: "batchBonus",   name: "Batch Bonus",    base: 350, max: 1,
    effect: () => "+5% op elke taak bij 3+ taken op één dag" },
  { id: "momentumPlus", name: "Momentum+",      base: 400, max: 2,
    effect: (l) => `Momentum-boost ×2 → ×${2 + l}` },
];

/* ---------- State ---------- */

function defaultState() {
  return {
    tasks: [],                    // { id, title, size, priority, deadline, createdAt }
    points: 0,                    // het grote getal — verdienen én uitgeven
    runPoints: 0,                 // totaal verdiend deze run (prestige)
    lifetimePoints: 0,            // over prestiges heen (levels)
    prestigePoints: 0,
    season: 1,
    generators: {},               // id -> aantal
    upgrades: {},                 // id -> level
    combo: { count: 0, lastAt: null },
    momentumUntil: 0,
    streak: {
      current: 0, longest: 0, freezeTokens: 1,
      lastActiveDay: null, permanentBonus: 0, lastSchildMonth: null,
    },
    rerollTokens: 0,
    doubleNextBuff: false,
    day: null,
    daily: { drawIds: null, freeRerollsUsed: 0, paidRerolls: 0, completions: 0, boxGiven: false },
    stats: { completed: 0, crits: 0, jackpots: 0, boxes: 0, prestiges: 0, bestCombo: 0 },
    log: [],
    lastSeen: Date.now(),
  };
}

let state = load();

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return Object.assign(defaultState(), JSON.parse(raw));
    const legacy = localStorage.getItem(LEGACY_KEY);
    if (legacy) return migrateV1(JSON.parse(legacy));
  } catch (e) { console.warn("Kon opgeslagen staat niet lezen", e); }
  return defaultState();
}

function migrateV1(old) {
  const s = defaultState();
  for (const k of ["tasks", "points", "runPoints", "lifetimePoints", "prestigePoints",
    "season", "upgrades", "streak", "rerollTokens", "doubleNextBuff", "stats"]) {
    if (old[k] !== undefined) s[k] = old[k];
  }
  localStorage.removeItem(LEGACY_KEY);
  return s;
}

function save() {
  state.lastSeen = Date.now();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

/* ---------- Getallen formatteren (nl, met suffixen) ---------- */

const SUFFIXES = ["", "k", "M", "mld", "blj", "tlj"];

function fmt(n) {
  if (!isFinite(n)) return "∞";
  if (n < 0) return "-" + fmt(-n);
  if (n < 100) {
    const r = Math.round(n * 10) / 10;
    return Number.isInteger(r) ? String(r) : r.toFixed(1).replace(".", ",");
  }
  if (n < 1e6) return Math.floor(n).toLocaleString("nl");
  let tier = Math.min(Math.floor(Math.log10(n) / 3), SUFFIXES.length - 1);
  const v = n / Math.pow(10, tier * 3);
  return v.toLocaleString("nl", { maximumSignificantDigits: 4 }) + " " + SUFFIXES[tier];
}

function fmtRate(n) {
  if (n < 100) return n.toLocaleString("nl", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  return fmt(n);
}

/* ---------- Datum-helpers ---------- */

function todayStr(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function daysBetween(a, b) {
  return Math.round((new Date(b + "T00:00") - new Date(a + "T00:00")) / 86400000);
}

function monthStr(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/* ---------- Productie (de ticker) ---------- */

function globalBonusPct() {
  return state.prestigePoints * PP_BONUS + state.streak.permanentBonus;
}

function milestoneMult(count) {
  return Math.pow(2, MILESTONES.filter((m) => count >= m).length);
}

function momentumActive() {
  return Date.now() < state.momentumUntil;
}

function momentumMult() {
  return MOMENTUM_MULT + (state.upgrades.momentumPlus || 0);
}

function baseProduction() { // zonder momentum
  let sum = 0;
  for (const g of GENERATORS) {
    const c = state.generators[g.id] || 0;
    if (c > 0) sum += g.rate * c * milestoneMult(c);
  }
  return sum * (1 + globalBonusPct() / 100);
}

function production() {
  return baseProduction() * (momentumActive() ? momentumMult() : 1);
}

function earn(amount) {
  state.points += amount;
  state.runPoints += amount;
  state.lifetimePoints += amount;
}

/* ---------- Dagelijkse tick ---------- */

function dailyTick() {
  const today = todayStr();
  if (state.day === today) return;

  const s = state.streak;
  if (s.lastActiveDay && s.current > 0) {
    const gap = daysBetween(s.lastActiveDay, today) - 1;
    if (gap > 0) {
      const used = Math.min(gap, s.freezeTokens);
      s.freezeTokens -= used;
      if (used < gap) {
        s.current = 0; // zacht: bonussen en prestige blijven altijd staan
        toast("Je streak is opnieuw begonnen. Je bonussen blijven staan — vandaag telt weer mee. 💪");
      } else if (used > 0) {
        toast(`❄️ ${used} streak-freeze${used > 1 ? "s" : ""} automatisch ingezet — je streak leeft nog!`);
      }
    }
  }

  if ((state.upgrades.streakSchild || 0) > 0 && s.lastSchildMonth !== monthStr()) {
    s.lastSchildMonth = monthStr();
    s.freezeTokens += state.upgrades.streakSchild;
  }

  state.day = today;
  state.daily = { drawIds: null, freeRerollsUsed: 0, paidRerolls: 0, completions: 0, boxGiven: false };
  save();
}

/* ---------- Weging & loting: bonusloten (§3, §4) ---------- */

function taskWeight(t) {
  const days = Math.max(0, daysBetween(todayStr(new Date(t.createdAt)), todayStr()));
  const staleness = Math.min(days / 30, 1.0);
  let urgency = 0;
  if (t.deadline) {
    const dtd = daysBetween(todayStr(), t.deadline);
    urgency = dtd <= 0 ? 2.0 : Math.min(5 / dtd, 2.0);
  }
  return t.priority * (1 + staleness) * (1 + urgency);
}

function drawSize() {
  return 3 + (state.upgrades.extraLot || 0);
}

// Roulette-wheel selectie zonder teruglegging
function drawTasks() {
  const pool = [...state.tasks];
  const picked = [];
  const n = Math.min(drawSize(), pool.length);
  for (let i = 0; i < n; i++) {
    const total = pool.reduce((sum, t) => sum + taskWeight(t), 0);
    let r = Math.random() * total;
    let idx = 0;
    for (let j = 0; j < pool.length; j++) {
      r -= taskWeight(pool[j]);
      if (r <= 0) { idx = j; break; }
    }
    picked.push(pool.splice(idx, 1)[0].id);
  }
  return picked;
}

function isBonusTask(id) {
  return (state.daily.drawIds || []).includes(id);
}

function freeRerollsPerDay() {
  return 1 + (state.upgrades.herkansing || 0);
}

function nextPaidRerollCost() {
  return REROLL_BASE_COST * Math.pow(2, state.daily.paidRerolls);
}

/* ---------- Variabele beloning (§5) ---------- */

function rollMultiplier() {
  const jackpotChance = 1 + (state.upgrades.jackpotVinger || 0) * 0.5; // in %
  const r = Math.random() * 100;
  if (r < jackpotChance) return { type: "jackpot", label: "🎰 JACKPOT!", mult: 5.0 };
  if (r < jackpotChance + 4) return { type: "crit", label: "💥 Kritiek!", mult: 2.5 };
  if (r < jackpotChance + 4 + 12) return { type: "nice", label: "✨ Mooie worp", mult: 1.5 };
  const mult = 0.8 + ((Math.random() + Math.random()) / 2) * 0.5; // driehoek 0,8–1,3
  return { type: "normal", label: "Normaal", mult };
}

function comboWindowMs() {
  return ((state.upgrades.comboMeester || 0) > 0 ? 6 : 4) * 3600 * 1000;
}

/* ---------- Taak voltooien: de kern van de loop ---------- */

function completeTask(taskId) {
  dailyTick();
  const idx = state.tasks.findIndex((t) => t.id === taskId);
  if (idx === -1) return;
  const task = state.tasks.splice(idx, 1)[0];
  const now = Date.now();

  // Combo (§6)
  const c = state.combo;
  if (c.lastAt && todayStr(new Date(c.lastAt)) === todayStr() && now - c.lastAt <= comboWindowMs()) {
    c.count += 1;
  } else {
    c.count = 0;
  }
  c.lastAt = now;
  state.stats.bestCombo = Math.max(state.stats.bestCombo, c.count);
  const comboBonus = Math.min(c.count * COMBO_STEP, COMBO_MAX);

  // Streak (§9)
  const s = state.streak;
  if (s.lastActiveDay !== todayStr()) {
    s.lastActiveDay = todayStr();
    s.current += 1;
    s.longest = Math.max(s.longest, s.current);
    if (s.current % 10 === 0) {
      s.freezeTokens += 1;
      toast("❄️ +1 streak-freeze token (elke 10 streak-dagen)");
    }
    if (s.current % 7 === 0 && s.permanentBonus < STREAK_BONUS_CAP) {
      s.permanentBonus = Math.min(s.permanentBonus + STREAK_WEEKLY_BONUS, STREAK_BONUS_CAP);
      toast(`🔥 Volle week-streak: permanente bonus nu +${s.permanentBonus}%`);
    }
  }

  // De worp (§5) over basis + productie-waarde van de taak
  const roll = rollMultiplier();
  const prodWorth = baseProduction() * TIME_WORTH[task.size];
  const raw = BASE_POINTS[task.size] + prodWorth;

  state.daily.completions += 1;
  const bonuses = [];
  let situPct = 0;
  if ((state.upgrades.vroegeVogel || 0) > 0 && new Date().getHours() < 10) {
    const p = state.upgrades.vroegeVogel * 15;
    situPct += p; bonuses.push(`vroege vogel +${p}%`);
  }
  if ((state.upgrades.batchBonus || 0) > 0 && state.daily.completions >= 3) {
    situPct += 5; bonuses.push("batch +5%");
  }
  if (comboBonus > 0) bonuses.push(`combo ×${c.count} +${Math.round(comboBonus * 100)}%`);
  const globalPct = globalBonusPct();
  if (globalPct > 0) bonuses.push(`globaal +${globalPct}%`);

  let points = raw * roll.mult * (1 + comboBonus) * (1 + situPct / 100) * (1 + globalPct / 100);
  const bonusLot = isBonusTask(taskId);
  if (bonusLot) { points *= DRAW_BONUS; bonuses.push(`✨ bonuslot ×${DRAW_BONUS}`); }
  if (state.doubleNextBuff) {
    points *= 2;
    state.doubleNextBuff = false;
    bonuses.push("dubbele punten ×2");
  }
  points = Math.max(1, Math.round(points)); // nooit 0 punten — harde grens

  earn(points);
  state.stats.completed += 1;
  if (roll.type === "crit") state.stats.crits += 1;
  if (roll.type === "jackpot") state.stats.jackpots += 1;

  // Momentum (idle-koppeling): taak doen = productie-boost
  const addMs = MOMENTUM_MIN[task.size] * 60 * 1000;
  state.momentumUntil = Math.min(Math.max(now, state.momentumUntil) + addMs, now + MOMENTUM_CAP_H * 3600 * 1000);

  state.log.unshift({
    title: task.title, base: raw, mult: roll.mult, type: roll.type,
    combo: c.count, points, at: now,
  });
  state.log = state.log.slice(0, 50);

  if (state.daily.drawIds) state.daily.drawIds = state.daily.drawIds.filter((id) => id !== taskId);

  // Mystery box (§10)
  const boxes = [];
  if (!state.daily.boxGiven) { state.daily.boxGiven = true; boxes.push("daily"); }
  if (roll.type === "jackpot") boxes.push("jackpot");

  save();
  showReward(task, roll, points, bonuses, boxes);
}

/* ---------- Mystery Box (§10) ---------- */

function openMysteryBox(queue) {
  if (!queue.length) { render(); return; }
  const overlay = document.getElementById("box-overlay");
  const visual = document.getElementById("box-visual");
  const result = document.getElementById("box-result");
  const closeBtn = document.getElementById("box-close");

  overlay.classList.remove("hidden");
  result.classList.add("hidden");
  closeBtn.classList.add("hidden");
  visual.textContent = "🎁";
  visual.classList.add("wiggling");

  // ~1,5s anticipatie — daar zit het "wanting"-moment
  setTimeout(() => {
    visual.classList.remove("wiggling");
    const r = Math.random() * 100;
    let text;
    if (r < 60) {
      const bonus = Math.round(Math.max(15, baseProduction() * 120) * (0.7 + Math.random() * 0.6));
      earn(bonus);
      visual.textContent = "💰";
      text = `Puntenbonus: +${fmt(bonus)} PT`;
    } else if (r < 85) {
      state.rerollTokens += 1;
      visual.textContent = "🎲";
      text = "+1 reroll-token";
    } else if (r < 95) {
      state.streak.freezeTokens += 1;
      visual.textContent = "❄️";
      text = "+1 streak-freeze token";
    } else {
      state.doubleNextBuff = true;
      visual.textContent = "⚡";
      text = "Dubbele punten op je volgende taak!";
    }
    state.stats.boxes += 1;
    save();
    result.textContent = text;
    result.classList.remove("hidden");
    closeBtn.classList.remove("hidden");
    closeBtn.onclick = () => {
      overlay.classList.add("hidden");
      openMysteryBox(queue.slice(1));
    };
  }, 1500);
}

/* ---------- Prestige (§8) ---------- */

function prestigePPGain() {
  return Math.floor(Math.sqrt(state.runPoints / PRESTIGE_UNIT));
}

function nextPPAt(pp) {
  return Math.pow(pp, 2) * PRESTIGE_UNIT;
}

function doPrestige() {
  const gain = prestigePPGain();
  if (gain < 1) return;
  state.prestigePoints += gain;
  state.points = 0;
  state.runPoints = 0;
  state.generators = {};
  state.upgrades = {};
  state.momentumUntil = 0;
  state.season += 1;
  state.stats.prestiges += 1;
  state.daily.drawIds = null;
  save();
  render();
  toast(`⭐ Seizoen ${state.season} gestart! +${gain} PP (permanente bonus nu +${state.prestigePoints * PP_BONUS}% op alles).`);
}

/* ============================================================
   UI
   ============================================================ */

const $ = (sel) => document.querySelector(sel);

/* ---------- Juice ---------- */

function countUp(el, from, to, ms = 600, prefix = "") {
  const start = performance.now();
  function frame(t) {
    const p = Math.min((t - start) / ms, 1);
    const eased = 1 - Math.pow(1 - p, 3);
    el.textContent = prefix + fmt(from + (to - from) * eased);
    if (p < 1) requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

function screenShake() {
  document.body.classList.remove("screen-shake");
  void document.body.offsetWidth;
  document.body.classList.add("screen-shake");
}

function particleBurst(colorSet) {
  const holder = $("#particles");
  const cx = window.innerWidth / 2, cy = window.innerHeight / 2;
  for (let i = 0; i < 36; i++) {
    const p = document.createElement("div");
    p.className = "particle";
    const angle = Math.random() * Math.PI * 2;
    const dist = 90 + Math.random() * 220;
    p.style.left = cx + "px";
    p.style.top = cy + "px";
    p.style.setProperty("--dx", Math.cos(angle) * dist + "px");
    p.style.setProperty("--dy", Math.sin(angle) * dist + "px");
    p.style.background = colorSet[i % colorSet.length];
    holder.appendChild(p);
    setTimeout(() => p.remove(), 950);
  }
}

function toast(msg) {
  let t = document.createElement("div");
  t.textContent = msg;
  Object.assign(t.style, {
    position: "fixed", bottom: "18px", left: "50%", transform: "translateX(-50%)",
    background: "var(--surface-2)", border: "1px solid var(--border)", color: "var(--text)",
    padding: "10px 18px", borderRadius: "10px", zIndex: 70, fontSize: "0.85rem",
    maxWidth: "90vw", textAlign: "center", boxShadow: "0 6px 24px rgba(0,0,0,0.5)",
  });
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 4200);
}

/* ---------- Beloningsoverlay ---------- */

function showReward(task, roll, points, bonuses, boxQueue) {
  const overlay = $("#reward-overlay");
  const rollEl = $("#reward-roll");
  const ptsEl = $("#reward-points");
  const bdEl = $("#reward-breakdown");

  overlay.classList.remove("hidden");
  rollEl.textContent = "…";
  rollEl.className = "reward-roll roll-normal";
  ptsEl.textContent = "";
  bdEl.textContent = task.title;

  setTimeout(() => {
    rollEl.textContent = roll.label;
    rollEl.className = "reward-roll roll-" + roll.type;
    countUp(ptsEl, 0, points, 800, "+");
    const parts = [`${fmt(BASE_POINTS[task.size])} basis + ${Math.round(TIME_WORTH[task.size] / 60)} min productie, × ${roll.mult.toFixed(2).replace(".", ",")}`];
    bdEl.textContent = parts.concat(bonuses).join(" · ") + ` · momentum +${MOMENTUM_MIN[task.size]} min`;
    if (roll.type === "crit") {
      screenShake();
      particleBurst(["#ff8b5e", "#ffd447", "#ffb35e"]);
    } else if (roll.type === "jackpot") {
      screenShake();
      particleBurst(["#ffd447", "#ffffff", "#6ee7a0", "#7aa2ff"]);
      setTimeout(() => particleBurst(["#ffd447", "#ff6e9c"]), 300);
    }
  }, 700);

  $("#reward-close").onclick = () => {
    overlay.classList.add("hidden");
    if (boxQueue.length) openMysteryBox(boxQueue);
    else render();
  };
}

/* ---------- Render: header (elke tick bijgewerkt) ---------- */

function levelInfo() {
  let level = 1, need = LEVEL_BASE, rest = state.lifetimePoints;
  while (rest >= need) { rest -= need; need *= LEVEL_GROWTH; level += 1; }
  return { level, into: rest, need };
}

function renderHeader() {
  $("#points-display").textContent = fmt(state.points);
  const prod = production();
  $("#points-rate").textContent = "+" + fmtRate(prod) + "/s" +
    (momentumActive() ? ` ⚡ ×${momentumMult()}` : "");

  $("#season-badge").textContent = "S" + state.season;
  $("#streak-badge").textContent = `🔥 ${state.streak.current}` +
    (state.streak.freezeTokens ? ` ·❄️${state.streak.freezeTokens}` : "");
  $("#pp-badge").textContent = "★ " + state.prestigePoints;

  const li = levelInfo();
  $("#level-label").textContent = "Level " + li.level;
  $("#level-fill").style.width = Math.min((li.into / li.need) * 100, 100) + "%";
  $("#level-next").textContent = `${fmt(li.into)}/${fmt(li.need)} PT`;

  const chips = [];
  const g = globalBonusPct();
  if (g > 0) chips.push(`<span class="bonus-chip on">globaal +${g}%</span>`);
  if (momentumActive()) {
    const min = Math.ceil((state.momentumUntil - Date.now()) / 60000);
    chips.push(`<span class="bonus-chip on">⚡ momentum ×${momentumMult()} nog ${min > 90 ? Math.round(min / 60) + "u" : min + "m"}</span>`);
  }
  if (state.combo.count > 0 && state.combo.lastAt && Date.now() - state.combo.lastAt <= comboWindowMs())
    chips.push(`<span class="bonus-chip on">combo ×${state.combo.count} actief</span>`);
  if (state.doubleNextBuff) chips.push(`<span class="bonus-chip on">⚡ dubbele punten volgende taak</span>`);
  if (state.rerollTokens > 0) chips.push(`<span class="bonus-chip">🎲 ${state.rerollTokens} reroll-token${state.rerollTokens > 1 ? "s" : ""}</span>`);
  $("#bonus-row").innerHTML = chips.join("");
}

/* ---------- Render: Vandaag (bonusloten) ---------- */

function esc(s) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function taskMetaLine(t) {
  const bits = [`${BASE_POINTS[t.size]} PT + ${Math.round(TIME_WORTH[t.size] / 60)} min productie`, `prio ${t.priority}`];
  if (t.deadline) {
    const d = daysBetween(todayStr(), t.deadline);
    bits.push(d < 0 ? `<span class="overdue">deadline verstreken</span>` : d === 0 ? "deadline vandaag" : `deadline over ${d}d`);
  }
  return bits.join(" · ");
}

function renderToday() {
  const area = $("#draw-area");
  const comboArea = $("#combo-area");

  if (state.tasks.length === 0) {
    area.innerHTML = `<div class="draw-card"><div class="draw-placeholder">🏁<br>
      <span style="font-size:0.95rem">De backlog is leeg — de sessie is klaar.<br>
      Je generatoren tikken rustig door. Dat begrensde einde is een feature.</span></div></div>`;
    comboArea.innerHTML = "";
    return;
  }

  const drawn = (state.daily.drawIds || []).map((id) => state.tasks.find((t) => t.id === id)).filter(Boolean);
  let html = "";

  if (!state.daily.drawIds) {
    html += `<div class="draw-card" id="draw-card">
      <p class="draw-title">De loting van vandaag</p>
      <p class="draw-sub">Trekt ${Math.min(drawSize(), state.tasks.length)} bonusloten: die taken zijn vandaag <strong>×${DRAW_BONUS}</strong> waard. Alles blijft gewoon afvinkbaar — het lot bepaalt alleen wáár de bonus ligt.</p>
      <button class="btn btn-buy" id="do-draw">🎲 Trek de bonusloten</button>
    </div>`;
  } else if (drawn.length > 0) {
    const freeLeft = freeRerollsPerDay() - state.daily.freeRerollsUsed;
    const rerollLabel = freeLeft > 0 ? `↻ Reroll (${freeLeft} gratis)` :
      state.rerollTokens > 0 ? `↻ Reroll (🎲 token)` : `↻ Reroll (${fmt(nextPaidRerollCost())} PT)`;
    const canReroll = state.tasks.length > drawn.length &&
      (freeLeft > 0 || state.rerollTokens > 0 || state.points >= nextPaidRerollCost());
    html += `<div class="draw-card" id="draw-card">
      <p class="draw-title">✨ Bonusloten van vandaag (×${DRAW_BONUS})</p>
      <p class="draw-sub">Gewogen-random getrokken. Afronden mag altijd — deze leveren vandaag dubbel op.</p>
      <div class="draw-options">
        ${drawn.map((t) => `
          <div class="draw-option bonus-lot">
            <span class="size-tag size-${t.size}">${t.size}</span>
            <span style="flex:1"><div>${esc(t.title)}</div><div class="draw-option-meta">${taskMetaLine(t)}</div></span>
            <button class="btn btn-primary btn-sm" data-complete="${t.id}">✔</button>
          </div>`).join("")}
      </div>
      <div class="draw-actions">
        <button class="btn" id="do-reroll" ${canReroll ? "" : "disabled"}>${rerollLabel}</button>
      </div>
    </div>`;
  } else {
    html += `<div class="draw-card" id="draw-card">
      <p class="draw-title">Alle bonusloten van vandaag zijn binnen 🎉</p>
      <p class="draw-sub">Morgen een nieuwe trekking. De rest van je backlog blijft gewoon punten waard.</p>
    </div>`;
  }

  area.innerHTML = html;

  const active = state.combo.lastAt && Date.now() - state.combo.lastAt <= comboWindowMs() &&
    todayStr(new Date(state.combo.lastAt)) === todayStr();
  const windowH = (state.upgrades.comboMeester || 0) > 0 ? 6 : 4;
  comboArea.innerHTML = `<div class="combo-banner">
    <span>Combo: <span class="combo-value">×${active ? state.combo.count : 0}</span>
    ${active && state.combo.count > 0 ? `(+${Math.round(Math.min(state.combo.count * COMBO_STEP, COMBO_MAX) * 100)}%)` : ""}</span>
    <span style="color:var(--text-dim);font-size:0.8rem">volgende taak binnen ${windowH}u = combo +1 · missen kost niets</span>
  </div>`;

  const drawBtn = $("#do-draw");
  if (drawBtn) drawBtn.onclick = () => animateDraw(() => {
    state.daily.drawIds = drawTasks();
    save();
  });

  const rerollBtn = $("#do-reroll");
  if (rerollBtn) rerollBtn.onclick = () => {
    const freeLeft = freeRerollsPerDay() - state.daily.freeRerollsUsed;
    if (freeLeft > 0) state.daily.freeRerollsUsed += 1;
    else if (state.rerollTokens > 0) state.rerollTokens -= 1;
    else {
      const cost = nextPaidRerollCost();
      if (state.points < cost) return;
      state.points -= cost;
      state.daily.paidRerolls += 1;
    }
    animateDraw(() => {
      state.daily.drawIds = drawTasks();
      save();
    });
  };

  area.querySelectorAll("[data-complete]").forEach((b) => b.onclick = () => completeTask(b.dataset.complete));
}

// 1–2s schud-animatie vóór de onthulling: het anticipatiemoment
function animateDraw(mutate) {
  const card = $("#draw-card");
  if (card) card.classList.add("shaking");
  setTimeout(() => {
    mutate();
    render();
  }, 1200);
}

/* ---------- Render: Backlog ---------- */

function renderBacklog() {
  $("#backlog-count").textContent = state.tasks.length ? `(${state.tasks.length})` : "";
  const list = $("#task-list");
  $("#backlog-empty").classList.toggle("hidden", state.tasks.length > 0);

  const sorted = [...state.tasks].sort((a, b) => taskWeight(b) - taskWeight(a));
  list.innerHTML = sorted.map((t) => `
    <li class="task-item${isBonusTask(t.id) ? " bonus-item" : ""}">
      <button class="check-btn" data-complete="${t.id}" title="Voltooien">✔</button>
      <div class="task-item-body">
        <div class="task-item-title">${isBonusTask(t.id) ? `<span class="bonus-tag">✨×${DRAW_BONUS}</span> ` : ""}${esc(t.title)}</div>
        <div class="task-item-meta"><span class="size-tag size-${t.size}">${t.size}</span> ${taskMetaLine(t)} · gewicht ${taskWeight(t).toFixed(1).replace(".", ",")}</div>
      </div>
      <button class="icon-btn" data-delete="${t.id}" title="Verwijderen">🗑</button>
    </li>`).join("");

  list.querySelectorAll("[data-complete]").forEach((b) => b.onclick = () => completeTask(b.dataset.complete));
  list.querySelectorAll("[data-delete]").forEach((b) => b.onclick = () => {
    state.tasks = state.tasks.filter((t) => t.id !== b.dataset.delete);
    if (state.daily.drawIds) state.daily.drawIds = state.daily.drawIds.filter((id) => id !== b.dataset.delete);
    save();
    render();
  });
}

/* ---------- Render: Winkel (generatoren + taak-upgrades) ---------- */

function generatorCost(g) {
  const owned = state.generators[g.id] || 0;
  return Math.round(g.cost * Math.pow(1.15, owned));
}

function renderGenerators() {
  const list = $("#generator-list");
  // Verberg tiers die nog ver weg zijn (klassiek incremental-patroon):
  // de eerstvolgende onontdekte tier verschijnt als "???".
  const rows = [];
  for (const g of GENERATORS) {
    const owned = state.generators[g.id] || 0;
    const cost = generatorCost(g);
    const visible = g.id === "g1" || owned > 0 || state.lifetimePoints >= g.cost * 0.4;
    if (!visible) {
      rows.push(`<li class="upgrade-item locked"><div class="upgrade-body">
        <span class="upgrade-name">???</span>
        <div class="upgrade-effect">nog niet ontdekt — verdien meer punten</div>
      </div></li>`);
      break;
    }
    const mult = milestoneMult(owned);
    const nextMs = MILESTONES.find((m) => owned < m);
    const tierProd = g.rate * owned * mult * (1 + globalBonusPct() / 100);
    rows.push(`<li class="upgrade-item">
      <div class="upgrade-body">
        <span class="upgrade-name">${g.name}</span>
        <span class="upgrade-level">${owned > 0 ? `×${owned}${mult > 1 ? ` (output ×${mult})` : ""}` : ""}</span>
        <div class="upgrade-effect">${fmtRate(g.rate)} PT/s per stuk${owned > 0 ? ` · nu ${fmtRate(tierProd)}/s` : ""}${nextMs ? ` · mijlpaal bij ${nextMs}: ×2` : ""}</div>
      </div>
      <button class="btn btn-buy" data-buygen="${g.id}" data-cost="${cost}" ${state.points >= cost ? "" : "disabled"}>${fmt(cost)} PT</button>
    </li>`);
  }
  list.innerHTML = rows.join("");

  list.querySelectorAll("[data-buygen]").forEach((b) => b.onclick = () => {
    const g = GENERATORS.find((x) => x.id === b.dataset.buygen);
    const cost = generatorCost(g);
    if (state.points < cost) return;
    state.points -= cost;
    state.generators[g.id] = (state.generators[g.id] || 0) + 1;
    save();
    render();
  });
}

function upgradeCost(u) {
  const lvl = state.upgrades[u.id] || 0;
  return Math.round(u.base * Math.pow(1.15, lvl));
}

function renderUpgrades() {
  const list = $("#upgrade-list");
  list.innerHTML = UPGRADES.map((u) => {
    const lvl = state.upgrades[u.id] || 0;
    const maxed = lvl >= u.max;
    const cost = upgradeCost(u);
    return `<li class="upgrade-item">
      <div class="upgrade-body">
        <span class="upgrade-name">${u.name}</span>
        <span class="upgrade-level">${lvl > 0 ? `niv. ${lvl}${u.max > 1 ? "/" + u.max : ""}` : ""}</span>
        <div class="upgrade-effect">${u.effect(Math.max(lvl, 1))}</div>
      </div>
      ${maxed ? `<span class="upgrade-level">MAX</span>` :
        `<button class="btn btn-buy" data-buy="${u.id}" data-cost="${cost}" ${state.points >= cost ? "" : "disabled"}>${fmt(cost)} PT</button>`}
    </li>`;
  }).join("");

  list.querySelectorAll("[data-buy]").forEach((b) => b.onclick = () => {
    const u = UPGRADES.find((x) => x.id === b.dataset.buy);
    const cost = upgradeCost(u);
    if (state.points < cost || (state.upgrades[u.id] || 0) >= u.max) return;
    state.points -= cost;
    state.upgrades[u.id] = (state.upgrades[u.id] || 0) + 1;
    save();
    render();
  });
}

/* ---------- Render: Prestige ---------- */

function renderPrestige() {
  const area = $("#prestige-area");
  const gain = prestigePPGain();
  const ready = gain >= 1;
  const target = nextPPAt(gain + 1);
  const prev = nextPPAt(Math.max(gain, 1));
  const pct = ready
    ? Math.min(((state.runPoints - prev) / (target - prev)) * 100, 100)
    : Math.min((state.runPoints / nextPPAt(1)) * 100, 100);

  area.innerHTML = `
    <div class="prestige-card">
      <h3>Seizoen ${state.season}</h3>
      <p>Verdiend deze run: <strong>${fmt(state.runPoints)} PT</strong>.
      Prestige-punten: <code>PP = ⌊√(run-PT / ${fmt(PRESTIGE_UNIT)})⌋</code> — elke volgende PP kost meer, elke prestige begint sneller.
      Koppel het gerust aan een echte mijlpaal (bv. een verhuisfase) — jouw keuze, jouw moment.</p>
      <div class="progress-bar" style="margin:10px 0"><div class="progress-fill" style="width:${pct}%"></div></div>
      <p style="font-size:0.8rem;color:var(--text-dim)">${ready
        ? `Volgende PP bij ${fmt(target)} run-PT`
        : `Eerste PP bij ${fmt(nextPPAt(1))} run-PT`}</p>
      <p>Bij prestige nu: <span class="prestige-big">+${gain} PP</span> → permanente bonus wordt
      <strong>+${(state.prestigePoints + gain) * PP_BONUS}%</strong> op productie én taken.</p>
      <p style="font-size:0.8rem">Reset: punten, generatoren, taak-upgrades. Blijft: prestige-bonus, streak, levels, backlog, tokens.</p>
      <button class="btn ${ready ? "btn-buy" : ""}" id="do-prestige" ${ready ? "" : "disabled"}>
        ${ready ? `⭐ Prestige → Seizoen ${state.season + 1} (+${gain} PP)` : `Nog ${fmt(Math.max(0, nextPPAt(1) - state.runPoints))} PT te gaan`}
      </button>
      <span id="prestige-confirm"></span>
    </div>`;

  const btn = $("#do-prestige");
  if (btn && ready) btn.onclick = () => {
    const holder = $("#prestige-confirm");
    holder.innerHTML = ` <button class="btn btn-danger" id="prestige-yes">Zeker weten?</button>`;
    $("#prestige-yes").onclick = doPrestige;
  };
}

/* ---------- Render: Stats ---------- */

function renderStats() {
  const st = state.stats;
  const rows = [
    ["Productie", fmtRate(production()) + " PT/s"],
    ["Taken voltooid (lifetime)", st.completed],
    ["Punten lifetime", fmt(state.lifetimePoints)],
    ["Punten deze run", fmt(state.runPoints)],
    ["Kritieke worpen", st.crits],
    ["Jackpots 🎰", st.jackpots],
    ["Mystery boxes geopend", st.boxes],
    ["Langste streak", state.streak.longest + " dagen"],
    ["Beste combo", "×" + st.bestCombo],
    ["Prestiges", st.prestiges],
    ["Permanente streak-bonus", "+" + state.streak.permanentBonus + "%"],
    ["Freeze-tokens", state.streak.freezeTokens],
  ];
  $("#stats-list").innerHTML = rows.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join("");
}

/* ---------- Render: alles ---------- */

function render() {
  dailyTick();
  renderHeader();
  renderToday();
  renderBacklog();
  renderGenerators();
  renderUpgrades();
  renderPrestige();
  renderStats();
}

/* ---------- De ticker: het getal gaat vanzelf omhoog ---------- */

let lastTick = performance.now();
let saveCounter = 0;

setInterval(() => {
  const now = performance.now();
  const dt = Math.min((now - lastTick) / 1000, 5);
  lastTick = now;
  const gained = production() * dt;
  if (gained > 0) earn(gained);
  renderHeader();

  // Koopknoppen goedkoop bijwerken zonder volledige re-render
  document.querySelectorAll("[data-cost]").forEach((b) => {
    b.disabled = state.points < Number(b.dataset.cost);
  });

  saveCounter += 1;
  if (saveCounter >= 40) { saveCounter = 0; save(); } // elke ~10s
  if (state.day !== todayStr()) render();
}, 250);

/* ---------- Offline voortgang ---------- */

function applyOfflineProgress() {
  const elapsed = (Date.now() - state.lastSeen) / 1000;
  if (elapsed < 30) return;
  const boostSecs = Math.max(0, Math.min(state.momentumUntil, Date.now()) - state.lastSeen) / 1000;
  const plainSecs = Math.max(0, elapsed - boostSecs);
  const gained = baseProduction() * (plainSecs + boostSecs * momentumMult());
  if (gained >= 1) {
    earn(gained);
    const h = elapsed / 3600;
    toast(`⏳ Terwijl je weg was (${h >= 1 ? Math.round(h * 10) / 10 + " uur" : Math.round(elapsed / 60) + " min"}): +${fmt(gained)} PT`);
  }
}

/* ---------- Init ---------- */

document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
    document.querySelectorAll(".panel").forEach((p) => p.classList.remove("active"));
    tab.classList.add("active");
    document.getElementById("panel-" + tab.dataset.tab).classList.add("active");
  });
});

document.getElementById("task-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const title = $("#task-title").value.trim();
  if (!title) return;
  state.tasks.push({
    id: "t" + Date.now() + Math.random().toString(36).slice(2, 7),
    title,
    size: $("#task-size").value,
    priority: Number($("#task-priority").value),
    deadline: $("#task-deadline").value || null,
    createdAt: Date.now(),
  });
  $("#task-title").value = "";
  $("#task-deadline").value = "";
  save();
  render();
  $("#task-title").focus();
});

document.getElementById("reset-all").addEventListener("click", () => {
  if (confirm("Alles wissen? Dit verwijdert taken, punten, generatoren, streaks en prestige — onomkeerbaar.")) {
    localStorage.removeItem(STORAGE_KEY);
    state = defaultState();
    render();
  }
});

window.addEventListener("beforeunload", save);
document.addEventListener("visibilitychange", () => {
  if (document.hidden) save();
  else { lastTick = performance.now(); applyOfflineProgress(); render(); }
});

applyOfflineProgress();
render();

// Debug-haakje voor tests (geen gameplay-effect)
window.__game = { get state() { return state; }, save, render, applyOfflineProgress };
