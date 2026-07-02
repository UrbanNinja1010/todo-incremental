/* ============================================================
   Todo Incremental — "Number Go Up"
   Alle mechanica uit het ontwerpdocument:
   loting, variabele beloning, combo's, upgrades, prestige,
   streaks + freeze, mystery box, levels, juice.
   Data: localStorage, geen backend.
   ============================================================ */

"use strict";

const STORAGE_KEY = "todo-incremental-v1";

/* ---------- Constanten uit het ontwerp ---------- */

const BASE_POINTS = { S: 10, M: 25, L: 50, XL: 100 };
const SIZE_LABELS = { S: "klein klusje", M: "gemiddeld", L: "groot", XL: "project-stap" };

const PRESTIGE_THRESHOLD = 5000;   // PT in de lopende run
const LEVEL_STEP = 500;            // lifetime PT per level
const COMBO_STEP = 0.08;           // +8% per combo-stap
const COMBO_MAX = 0.80;            // cap bij combo 10
const STREAK_WEEKLY_BONUS = 2;     // +2% per volle 7-dagen-streak
const STREAK_BONUS_CAP = 50;       // gecapt op +50%
const PP_BONUS = 2;                // +2% globaal per prestige-punt
const REROLL_BASE_COST = 25;       // oplopend per gebruik binnen dezelfde dag

const UPGRADES = [
  { id: "vroegeVogel",  name: "Vroege Vogel",   base: 100, max: 3,
    effect: (l) => `+${l * 15}% punten op taken vóór 10:00` },
  { id: "extraLot",     name: "Extra Lot",      base: 250, max: 1,
    effect: () => "4e taak-optie in de dagelijkse loting" },
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
];

/* ---------- State ---------- */

function defaultState() {
  return {
    tasks: [],                    // { id, title, size, priority, deadline, createdAt }
    points: 0,                    // uitgeefbare punten (lopende run)
    runPoints: 0,                 // totaal verdiend deze run (voor prestige-PP)
    lifetimePoints: 0,            // telt door over prestiges heen (levels)
    prestigePoints: 0,
    season: 1,
    upgrades: {},                 // id -> level
    combo: { count: 0, lastAt: null },
    streak: {
      current: 0, longest: 0, freezeTokens: 1,
      lastActiveDay: null, permanentBonus: 0, lastSchildMonth: null,
    },
    rerollTokens: 0,
    doubleNextBuff: false,
    day: null,                    // laatste dag waarop daily-reset draaide
    daily: { drawIds: null, chosenId: null, freeRerollsUsed: 0, paidRerolls: 0, completions: 0, boxGiven: false },
    stats: { completed: 0, crits: 0, jackpots: 0, boxes: 0, prestiges: 0, bestCombo: 0 },
    log: [],                      // laatste CompletionEvents (max 50)
  };
}

let state = load();

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return Object.assign(defaultState(), JSON.parse(raw));
  } catch (e) { console.warn("Kon opgeslagen staat niet lezen", e); }
  return defaultState();
}

function save() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
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

/* ---------- Dagelijkse tick: streak-check, nieuwe dag ---------- */

function dailyTick() {
  const today = todayStr();
  if (state.day === today) return;

  // Streak-onderhoud: gemiste dagen opvangen met freeze-tokens
  const s = state.streak;
  if (s.lastActiveDay && s.current > 0) {
    const gap = daysBetween(s.lastActiveDay, today) - 1; // gisteren actief = gap 0
    if (gap > 0) {
      const used = Math.min(gap, s.freezeTokens);
      s.freezeTokens -= used;
      if (used < gap) {
        s.current = 0; // zacht: permanente bonus en prestige blijven altijd staan
        toast("Je streak is opnieuw begonnen. Je bonussen blijven staan — vandaag telt weer mee. 💪");
      } else if (used > 0) {
        toast(`❄️ ${used} streak-freeze${used > 1 ? "s" : ""} automatisch ingezet — je streak leeft nog!`);
      }
    }
  }

  // Streak Schild: 1 token per maand
  if ((state.upgrades.streakSchild || 0) > 0 && s.lastSchildMonth !== monthStr()) {
    s.lastSchildMonth = monthStr();
    s.freezeTokens += state.upgrades.streakSchild;
  }

  state.day = today;
  state.daily = { drawIds: null, chosenId: null, freeRerollsUsed: 0, paidRerolls: 0, completions: 0, boxGiven: false };
  save();
}

/* ---------- Weging & loting (§3, §4) ---------- */

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
  // driehoeksverdeling 0,8–1,3 met top op ~1,05
  const mult = 0.8 + ((Math.random() + Math.random()) / 2) * 0.5;
  return { type: "normal", label: "Normaal", mult };
}

function comboWindowMs() {
  return ((state.upgrades.comboMeester || 0) > 0 ? 6 : 4) * 3600 * 1000;
}

function globalBonusPct() {
  return state.prestigePoints * PP_BONUS + state.streak.permanentBonus;
}

/* ---------- Taak voltooien: de kern van de loop ---------- */

function completeTask(taskId) {
  dailyTick();
  const idx = state.tasks.findIndex((t) => t.id === taskId);
  if (idx === -1) return;
  const task = state.tasks.splice(idx, 1)[0];
  const now = Date.now();

  // Combo (§6): volgende taak binnen het venster, zelfde dag
  const c = state.combo;
  if (c.lastAt && todayStr(new Date(c.lastAt)) === todayStr() && now - c.lastAt <= comboWindowMs()) {
    c.count += 1;
  } else {
    c.count = 0;
  }
  c.lastAt = now;
  state.stats.bestCombo = Math.max(state.stats.bestCombo, c.count);
  const comboBonus = Math.min(c.count * COMBO_STEP, COMBO_MAX);

  // Streak (§9): eerste voltooide taak van de dag
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

  // De worp (§5)
  const roll = rollMultiplier();
  const base = BASE_POINTS[task.size];

  state.daily.completions += 1;
  const situBonuses = [];
  let situPct = 0;
  if ((state.upgrades.vroegeVogel || 0) > 0 && new Date().getHours() < 10) {
    const p = state.upgrades.vroegeVogel * 15;
    situPct += p; situBonuses.push(`vroege vogel +${p}%`);
  }
  if ((state.upgrades.batchBonus || 0) > 0 && state.daily.completions >= 3) {
    situPct += 5; situBonuses.push("batch +5%");
  }
  if (comboBonus > 0) situBonuses.push(`combo ×${c.count} +${Math.round(comboBonus * 100)}%`);
  const globalPct = globalBonusPct();
  if (globalPct > 0) situBonuses.push(`globaal +${globalPct}%`);

  let points = base * roll.mult * (1 + comboBonus) * (1 + situPct / 100) * (1 + globalPct / 100);
  if (state.doubleNextBuff) {
    points *= 2;
    state.doubleNextBuff = false;
    situBonuses.push("dubbele punten ×2");
  }
  points = Math.max(1, Math.round(points)); // nooit 0 punten — harde grens

  state.points += points;
  state.runPoints += points;
  state.lifetimePoints += points;
  state.stats.completed += 1;
  if (roll.type === "crit") state.stats.crits += 1;
  if (roll.type === "jackpot") state.stats.jackpots += 1;

  state.log.unshift({
    title: task.title, base, mult: roll.mult, type: roll.type,
    combo: c.count, points, at: now,
  });
  state.log = state.log.slice(0, 50);

  // Loting bijwerken
  if (state.daily.drawIds) state.daily.drawIds = state.daily.drawIds.filter((id) => id !== taskId);
  if (state.daily.chosenId === taskId) state.daily.chosenId = null;

  // Mystery box (§10): eerste taak van de dag + gegarandeerd bij jackpot
  const boxes = [];
  if (!state.daily.boxGiven) { state.daily.boxGiven = true; boxes.push("daily"); }
  if (roll.type === "jackpot") boxes.push("jackpot");

  save();
  showReward(task, roll, points, situBonuses, boxes);
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
      const bonus = 5 * (2 + Math.floor(Math.random() * 5)); // 10–30 PT
      state.points += bonus; state.runPoints += bonus; state.lifetimePoints += bonus;
      visual.textContent = "💰";
      text = `Puntenbonus: +${bonus} PT`;
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
  return Math.round(Math.sqrt(state.runPoints / 100));
}

function doPrestige() {
  const gain = prestigePPGain();
  state.prestigePoints += gain;
  state.points = 0;
  state.runPoints = 0;
  state.upgrades = {};          // tijdelijke upgrades resetten
  state.season += 1;
  state.stats.prestiges += 1;
  state.daily.drawIds = null;   // nieuwe trekking in het nieuwe seizoen
  state.daily.chosenId = null;
  save();
  render();
  toast(`⭐ Seizoen ${state.season} gestart! +${gain} Prestige Punten (nu +${state.prestigePoints * PP_BONUS}% permanent).`);
}

/* ============================================================
   UI
   ============================================================ */

const $ = (sel) => document.querySelector(sel);

/* ---------- Juice: tellende getallen, shake, partikels ---------- */

function countUp(el, from, to, ms = 600, prefix = "") {
  const start = performance.now();
  function frame(t) {
    const p = Math.min((t - start) / ms, 1);
    const eased = 1 - Math.pow(1 - p, 3);
    el.textContent = prefix + Math.round(from + (to - from) * eased).toLocaleString("nl");
    if (p < 1) requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

let displayedPoints = 0;

function updatePointsDisplay() {
  const el = $("#points-display");
  if (displayedPoints !== state.points) {
    countUp(el, displayedPoints, state.points);
    displayedPoints = state.points;
  } else {
    el.textContent = state.points.toLocaleString("nl");
  }
}

function screenShake() {
  document.body.classList.remove("screen-shake");
  void document.body.offsetWidth; // reflow om de animatie te herstarten
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
  // bescheiden melding onderin — geen schaamte, geen FOMO
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

  // korte anticipatie vóór de onthulling van de worp
  setTimeout(() => {
    rollEl.textContent = roll.label;
    rollEl.className = "reward-roll roll-" + roll.type;
    countUp(ptsEl, 0, points, 800, "+");
    const parts = [`${BASE_POINTS[task.size]} basis × ${roll.mult.toFixed(2).replace(".", ",")}`];
    bdEl.textContent = parts.concat(bonuses).join(" · ");
    if (roll.type === "crit") {
      screenShake();
      particleBurst(["#ff8b5e", "#ffd447", "#ffb35e"]);
    } else if (roll.type === "jackpot") {
      screenShake();
      particleBurst(["#ffd447", "#ffffff", "#6ee7a0", "#7aa2ff"]);
      setTimeout(() => particleBurst(["#ffd447", "#ff6e9c"]), 300);
    }
    updatePointsDisplay();
  }, 700);

  $("#reward-close").onclick = () => {
    overlay.classList.add("hidden");
    if (boxQueue.length) openMysteryBox(boxQueue);
    else render();
  };
}

/* ---------- Render: header ---------- */

function renderHeader() {
  updatePointsDisplay();
  $("#season-badge").textContent = "S" + state.season;
  $("#streak-badge").textContent = `🔥 ${state.streak.current}` +
    (state.streak.freezeTokens ? ` ·❄️${state.streak.freezeTokens}` : "");
  $("#pp-badge").textContent = "★ " + state.prestigePoints;

  const level = Math.floor(state.lifetimePoints / LEVEL_STEP) + 1;
  const into = state.lifetimePoints % LEVEL_STEP;
  $("#level-label").textContent = "Level " + level;
  $("#level-fill").style.width = (into / LEVEL_STEP) * 100 + "%";
  $("#level-next").textContent = `${into}/${LEVEL_STEP} PT`;

  const chips = [];
  const g = globalBonusPct();
  if (g > 0) chips.push(`<span class="bonus-chip on">globaal +${g}%</span>`);
  if (state.combo.count > 0 && state.combo.lastAt && Date.now() - state.combo.lastAt <= comboWindowMs())
    chips.push(`<span class="bonus-chip on">combo ×${state.combo.count} actief</span>`);
  if (state.doubleNextBuff) chips.push(`<span class="bonus-chip on">⚡ dubbele punten volgende taak</span>`);
  if (state.rerollTokens > 0) chips.push(`<span class="bonus-chip">🎲 ${state.rerollTokens} reroll-token${state.rerollTokens > 1 ? "s" : ""}</span>`);
  $("#bonus-row").innerHTML = chips.join("");
}

/* ---------- Render: Vandaag (loting) ---------- */

function esc(s) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function taskMetaLine(t) {
  const bits = [`${BASE_POINTS[t.size]} PT basis`, `prio ${t.priority}`];
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
      Dat begrensde einde is een feature, geen bug.</span></div></div>`;
    comboArea.innerHTML = "";
    return;
  }

  const drawn = (state.daily.drawIds || []).map((id) => state.tasks.find((t) => t.id === id)).filter(Boolean);
  const chosen = state.tasks.find((t) => t.id === state.daily.chosenId);

  let html = "";

  if (chosen) {
    html += `<div class="active-task">
      <div class="active-task-label">Actieve taak</div>
      <div class="active-task-title"><span class="size-tag size-${chosen.size}">${chosen.size}</span> ${esc(chosen.title)}</div>
      <div class="draw-actions">
        <button class="btn btn-primary" data-complete="${chosen.id}">✔ Voltooid!</button>
        <button class="btn btn-ghost" id="unchoose">Leg terug</button>
      </div>
    </div>`;
  }

  if (!state.daily.drawIds || (drawn.length === 0 && !chosen)) {
    html += `<div class="draw-card" id="draw-card">
      <p class="draw-title">${state.daily.drawIds ? "Trekking leeg — trek opnieuw" : "De loting van vandaag"}</p>
      <p class="draw-sub">Gewogen-random uit je backlog: prioriteit × staleness × urgentie.</p>
      <button class="btn btn-buy" id="do-draw">🎲 Trek ${Math.min(drawSize(), state.tasks.length)} ta${Math.min(drawSize(), state.tasks.length) === 1 ? "ak" : "ken"}</button>
    </div>`;
  } else if (drawn.length > 0 && !chosen) {
    const freeLeft = freeRerollsPerDay() - state.daily.freeRerollsUsed;
    const rerollLabel = freeLeft > 0 ? `↻ Reroll (${freeLeft} gratis)` :
      state.rerollTokens > 0 ? `↻ Reroll (🎲 token)` : `↻ Reroll (${nextPaidRerollCost()} PT)`;
    const canReroll = state.tasks.length > drawn.length &&
      (freeLeft > 0 || state.rerollTokens > 0 || state.points >= nextPaidRerollCost());
    html += `<div class="draw-card" id="draw-card">
      <p class="draw-title">Kies je taak</p>
      <p class="draw-sub">De keuze is aan jou — de onzekerheid zat in wélke er verschenen.</p>
      <div class="draw-options">
        ${drawn.map((t) => `
          <button class="draw-option" data-choose="${t.id}">
            <span class="size-tag size-${t.size}">${t.size}</span>
            <span><div>${esc(t.title)}</div><div class="draw-option-meta">${taskMetaLine(t)}</div></span>
          </button>`).join("")}
      </div>
      <div class="draw-actions">
        <button class="btn" id="do-reroll" ${canReroll ? "" : "disabled"}>${rerollLabel}</button>
      </div>
    </div>`;
  }

  area.innerHTML = html;

  // Combo-banner
  const active = state.combo.lastAt && Date.now() - state.combo.lastAt <= comboWindowMs() &&
    todayStr(new Date(state.combo.lastAt)) === todayStr();
  const windowH = (state.upgrades.comboMeester || 0) > 0 ? 6 : 4;
  comboArea.innerHTML = `<div class="combo-banner">
    <span>Combo: <span class="combo-value">×${active ? state.combo.count : 0}</span>
    ${active && state.combo.count > 0 ? `(+${Math.round(Math.min(state.combo.count * COMBO_STEP, COMBO_MAX) * 100)}%)` : ""}</span>
    <span style="color:var(--text-dim);font-size:0.8rem">volgende taak binnen ${windowH}u = combo +1 · missen kost niets</span>
  </div>`;

  // Events
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

  area.querySelectorAll("[data-choose]").forEach((b) => b.onclick = () => {
    state.daily.chosenId = b.dataset.choose;
    save();
    render();
  });

  const un = $("#unchoose");
  if (un) un.onclick = () => { state.daily.chosenId = null; save(); render(); };

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
    <li class="task-item">
      <button class="check-btn" data-complete="${t.id}" title="Voltooien">✔</button>
      <div class="task-item-body">
        <div class="task-item-title">${esc(t.title)}</div>
        <div class="task-item-meta"><span class="size-tag size-${t.size}">${t.size}</span> ${taskMetaLine(t)} · gewicht ${taskWeight(t).toFixed(1).replace(".", ",")}</div>
      </div>
      <button class="icon-btn" data-delete="${t.id}" title="Verwijderen">🗑</button>
    </li>`).join("");

  list.querySelectorAll("[data-complete]").forEach((b) => b.onclick = () => completeTask(b.dataset.complete));
  list.querySelectorAll("[data-delete]").forEach((b) => b.onclick = () => {
    state.tasks = state.tasks.filter((t) => t.id !== b.dataset.delete);
    if (state.daily.drawIds) state.daily.drawIds = state.daily.drawIds.filter((id) => id !== b.dataset.delete);
    if (state.daily.chosenId === b.dataset.delete) state.daily.chosenId = null;
    save();
    render();
  });
}

/* ---------- Render: Upgrades ---------- */

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
        `<button class="btn btn-buy" data-buy="${u.id}" ${state.points >= cost ? "" : "disabled"}>${cost.toLocaleString("nl")} PT</button>`}
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
  const ready = state.runPoints >= PRESTIGE_THRESHOLD;
  const gain = prestigePPGain();
  const pct = Math.min((state.runPoints / PRESTIGE_THRESHOLD) * 100, 100);

  area.innerHTML = `
    <div class="prestige-card">
      <h3>Seizoen ${state.season}</h3>
      <p>Verdiend deze run: <strong>${state.runPoints.toLocaleString("nl")} PT</strong> van de ${PRESTIGE_THRESHOLD.toLocaleString("nl")} PT-drempel.
      Je kunt prestige ook koppelen aan een echte mijlpaal (bv. een verhuisfase) — jouw keuze, jouw moment.</p>
      <div class="progress-bar" style="margin:10px 0"><div class="progress-fill" style="width:${pct}%"></div></div>
      <p>Bij prestige nu: <span class="prestige-big">+${gain} PP</span> → permanente bonus wordt
      <strong>+${(state.prestigePoints + gain) * PP_BONUS}%</strong> op alles.</p>
      <p style="font-size:0.8rem">Reset: lopende punten en upgrades. Blijft: prestige-bonussen, streak, levels, backlog, tokens.</p>
      <button class="btn ${ready ? "btn-buy" : ""}" id="do-prestige" ${ready ? "" : "disabled"}>
        ${ready ? `⭐ Prestige → Seizoen ${state.season + 1}` : `Nog ${(PRESTIGE_THRESHOLD - state.runPoints).toLocaleString("nl")} PT te gaan`}
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
    ["Taken voltooid (lifetime)", st.completed],
    ["Punten lifetime", state.lifetimePoints.toLocaleString("nl")],
    ["Punten deze run", state.runPoints.toLocaleString("nl")],
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
  renderUpgrades();
  renderPrestige();
  renderStats();
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
  if (confirm("Alles wissen? Dit verwijdert taken, punten, streaks en prestige — onomkeerbaar.")) {
    localStorage.removeItem(STORAGE_KEY);
    state = defaultState();
    displayedPoints = 0;
    render();
  }
});

displayedPoints = state.points;
render();

// Nieuwe dag detecteren als de tab open blijft staan
setInterval(() => { if (state.day !== todayStr()) render(); }, 60 * 1000);
