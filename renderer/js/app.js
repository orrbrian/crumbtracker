// CrumbTracker — UI logic.

const MEALS = [
  { key: 'breakfast', label: 'Breakfast' },
  { key: 'lunch',     label: 'Lunch' },
  { key: 'dinner',    label: 'Dinner' },
  { key: 'snacks',    label: 'Snacks' }
];

const DEFAULT_TARGETS = { calories: 2000, protein: 150, carbs: 220, fat: 65, preset: 'custom' };

const state = {
  date: isoDate(new Date()),
  meal: 'breakfast',
  targets: { ...DEFAULT_TARGETS }
};

function isoDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function toast(msg, ms = 2200) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.add('hidden'), ms);
}

function $(sel, root = document) { return root.querySelector(sel); }
function $$(sel, root = document) { return Array.from(root.querySelectorAll(sel)); }

// Themed replacement for window.confirm. Returns a Promise that resolves to
// true (OK) / false (Cancel/Esc/backdrop click). Supports an optional title,
// body (string or HTML), button labels, and a destructive-styling flag.
function confirmDialog({ title = 'Confirm', body = '', okLabel = 'OK', cancelLabel = 'Cancel', destructive = false } = {}) {
  return new Promise(resolve => {
    const modal = document.getElementById('confirm-modal');
    const yes = document.getElementById('confirm-yes');
    const no  = document.getElementById('confirm-no');
    document.getElementById('confirm-title').textContent = title;
    const bodyEl = document.getElementById('confirm-body');
    if (body && body.trim().startsWith('<')) bodyEl.innerHTML = body;
    else bodyEl.textContent = body;
    yes.textContent = okLabel;
    no.textContent = cancelLabel;
    yes.classList.toggle('danger-btn', !!destructive);
    yes.classList.toggle('primary-btn', !destructive);

    const cleanup = (result) => {
      modal.classList.add('hidden');
      yes.removeEventListener('click', onYes);
      no.removeEventListener('click', onNo);
      modal.removeEventListener('click', onBackdrop);
      document.removeEventListener('keydown', onKey);
      resolve(result);
    };
    const onYes = () => cleanup(true);
    const onNo  = () => cleanup(false);
    const onBackdrop = (e) => { if (e.target === modal) cleanup(false); };
    const onKey = (e) => {
      if (e.key === 'Escape') cleanup(false);
      else if (e.key === 'Enter') cleanup(true);
    };
    yes.addEventListener('click', onYes);
    no.addEventListener('click', onNo);
    modal.addEventListener('click', onBackdrop);
    document.addEventListener('keydown', onKey);
    modal.classList.remove('hidden');
    yes.focus();
  });
}

// ------- NAV -------
$$('.nav-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    $$('.nav-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const view = btn.dataset.view;
    $$('.view').forEach(v => v.classList.add('hidden'));
    $('#view-' + view).classList.remove('hidden');
    if (view === 'foods') renderCustomFoods() && renderRecentFoods();
    if (view === 'progress') renderProgress();
    if (view === 'settings') fillSettings();
  });
});

// ------- DIARY -------
function formatMacros(e) {
  return `P ${r(e.protein)}g · C ${r(e.carbs)}g · F ${r(e.fat)}g`;
}
function r(n) { return Math.round((Number(n) || 0) * 10) / 10; }

async function renderDiary() {
  try {
    $('#date-picker').value = state.date;
    const entries = await CT.db.listEntriesForDate(state.date);
    const totals = { calories: 0, protein: 0, carbs: 0, fat: 0 };
    for (const e of entries) {
      totals.calories += e.calories;
      totals.protein  += e.protein;
      totals.carbs    += e.carbs;
      totals.fat      += e.fat;
    }

    const exercises = await CT.db.listExercisesForDate(state.date);
    const burned = exercises.reduce((s, e) => s + (e.calories || 0), 0);

    renderTotals(totals);
    renderNet(totals, burned);
    renderMacroPie(totals);
    renderQuip(totals);
    renderMeals(entries);
    renderExercise(exercises, burned);
    await renderNotes();
  } catch (e) {
    console.error('[renderDiary] failed', e);
    toast('Diary render failed: ' + (e.message || e) + ' - try Settings > Reset, or reset your IndexedDB.', 8000);
  }
}

function renderExercise(list, burned) {
  $('#ex-total').textContent = `${r(burned)} kcal burned`;
  const el = $('#exercise-list');
  if (!list.length) {
    el.innerHTML = '';
    return;
  }
  el.innerHTML = list.map(e => `
    <div class="ex-entry" data-id="${e.id}">
      <div class="name">
        <div class="n">${escapeHtml(e.name)}</div>
        <div class="sub">${e.duration_min ? r(e.duration_min) + ' min' : ''}</div>
      </div>
      <div class="kcal">${r(e.calories)} kcal</div>
      <button class="del" title="Remove">✕</button>
    </div>
  `).join('');
  $$('#exercise-list .del').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.closest('.ex-entry').dataset.id;
      await CT.db.deleteExercise(id);
      renderDiary();
    });
  });
}

let _noteSaveTimer = null;
let _noteDate = null;

async function renderNotes() {
  const ta = $('#notes-text');
  const status = $('#notes-status');
  _noteDate = state.date;
  const text = await CT.db.getNote(state.date);
  ta.value = text || '';
  status.textContent = '';
}

$('#notes-text').addEventListener('input', () => {
  const status = $('#notes-status');
  const date = _noteDate || state.date;
  const text = $('#notes-text').value;
  status.textContent = 'saving…';
  clearTimeout(_noteSaveTimer);
  _noteSaveTimer = setTimeout(async () => {
    await CT.db.saveNote(date, text);
    status.textContent = 'saved';
    setTimeout(() => { if (status.textContent === 'saved') status.textContent = ''; }, 1500);
  }, 400);
});

const MACRO_COLORS = { protein: '#7dd3a0', carbs: '#f0c26a', fat: '#f06a6a' };

function ringSegmentPath(cx, cy, rOuter, rInner, startAngle, endAngle) {
  const a1 = startAngle * Math.PI / 180;
  const a2 = endAngle * Math.PI / 180;
  const large = (endAngle - startAngle) > 180 ? 1 : 0;
  const x1o = (cx + rOuter * Math.cos(a1)).toFixed(2);
  const y1o = (cy + rOuter * Math.sin(a1)).toFixed(2);
  const x2o = (cx + rOuter * Math.cos(a2)).toFixed(2);
  const y2o = (cy + rOuter * Math.sin(a2)).toFixed(2);
  const x1i = (cx + rInner * Math.cos(a1)).toFixed(2);
  const y1i = (cy + rInner * Math.sin(a1)).toFixed(2);
  const x2i = (cx + rInner * Math.cos(a2)).toFixed(2);
  const y2i = (cy + rInner * Math.sin(a2)).toFixed(2);
  return `M${x1o},${y1o} A${rOuter},${rOuter} 0 ${large},1 ${x2o},${y2o} L${x2i},${y2i} A${rInner},${rInner} 0 ${large},0 ${x1i},${y1i} Z`;
}

function ringSlices(slices, rOuter, rInner, cx, cy, opacity = 1) {
  const total = slices.reduce((s, x) => s + x.value, 0);
  if (total <= 0) return '';
  const nonZero = slices.filter(s => s.value > 0);
  const titleFor = s => s.label ? `<title>${escapeHtml(s.label)}</title>` : '';
  if (nonZero.length === 1) {
    const s = nonZero[0];
    return `<path fill-rule="evenodd" fill="${s.color}" opacity="${opacity}"
      d="M${cx - rOuter},${cy} a${rOuter},${rOuter} 0 1,0 ${rOuter * 2},0 a${rOuter},${rOuter} 0 1,0 ${-rOuter * 2},0
         M${cx - rInner},${cy} a${rInner},${rInner} 0 1,0 ${rInner * 2},0 a${rInner},${rInner} 0 1,0 ${-rInner * 2},0">${titleFor(s)}</path>`;
  }
  let angle = -90;
  return nonZero.map(s => {
    const portion = s.value / total;
    const next = angle + portion * 360;
    const d = ringSegmentPath(cx, cy, rOuter, rInner, angle, next);
    angle = next;
    return `<path d="${d}" fill="${s.color}" opacity="${opacity}">${titleFor(s)}</path>`;
  }).join('');
}

// Concentric-ring macro chart: outer = actual, inner = goal. Both start at 12
// o'clock so matching splits visually align; drift shows as misaligned arc ends.
function makeMacroRingsSVG(actual, target, size) {
  const cx = size / 2;
  const cy = size / 2;
  const rOuterMax = size / 2 - 2;
  const rOuterMin = rOuterMax - 16;
  const rInnerMax = rOuterMin - 4;
  const rInnerMin = rInnerMax - 14;

  const parts = [];
  if (actual.reduce((s, x) => s + x.value, 0) > 0) {
    parts.push(ringSlices(actual, rOuterMax, rOuterMin, cx, cy));
  } else {
    const rMid = (rOuterMax + rOuterMin) / 2;
    parts.push(`<circle cx="${cx}" cy="${cy}" r="${rMid}" fill="none" stroke="var(--line)" stroke-width="${rOuterMax - rOuterMin}" opacity="0.35"/>`);
  }
  if (target.reduce((s, x) => s + x.value, 0) > 0) {
    parts.push(ringSlices(target, rInnerMax, rInnerMin, cx, cy, 0.55));
  }
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${parts.join('')}</svg>`;
}

function renderMacroPie(totals) {
  const el = $('#macros-pie');
  const empty = $('#macros-empty');
  const dateEl = $('#side-date');
  if (dateEl) {
    const d = new Date(state.date + 'T00:00:00');
    dateEl.textContent = d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  }
  const kcalP = totals.protein * 4;
  const kcalC = totals.carbs * 4;
  const kcalF = totals.fat * 9;
  const totalKcal = kcalP + kcalC + kcalF;

  const t = state.targets || {};
  // Only show the goal ring if the user has explicitly saved targets. A
  // brand-new or wiped install has default values in memory but no saved
  // record — treat that as "no goal."
  const hasGoal = !!state.targetsSaved;
  const tKcalP = hasGoal ? (t.protein || 0) * 4 : 0;
  const tKcalC = hasGoal ? (t.carbs   || 0) * 4 : 0;
  const tKcalF = hasGoal ? (t.fat     || 0) * 9 : 0;
  const targetKcal = tKcalP + tKcalC + tKcalF;

  // Zero data AND no saved goal: fall back to El Jefe empty state.
  if (totalKcal <= 0 && targetKcal <= 0) {
    el.classList.add('hidden');
    empty.classList.remove('hidden');
    return;
  }

  const pct = (v, denom) => denom > 0 ? Math.round((v / denom) * 100) : 0;
  const tPct = v => pct(v, targetKcal);
  const aPct = v => pct(v, totalKcal);

  const actualLabel = (name, grams, kcal) =>
    `Today · ${name} ${r(grams)} g (${aPct(kcal)}% of ${r(totalKcal)} kcal)`;
  const goalLabel = (name, grams, kcal) =>
    `Goal · ${name} ${r(grams)} g (${tPct(kcal)}% of ${r(targetKcal)} kcal)`;

  const svg = makeMacroRingsSVG(
    [
      { value: kcalP, color: MACRO_COLORS.protein, label: actualLabel('Protein', totals.protein, kcalP) },
      { value: kcalC, color: MACRO_COLORS.carbs,   label: actualLabel('Carbs',   totals.carbs,   kcalC) },
      { value: kcalF, color: MACRO_COLORS.fat,     label: actualLabel('Fat',     totals.fat,     kcalF) }
    ],
    [
      { value: tKcalP, color: MACRO_COLORS.protein, label: goalLabel('Protein', t.protein || 0, tKcalP) },
      { value: tKcalC, color: MACRO_COLORS.carbs,   label: goalLabel('Carbs',   t.carbs   || 0, tKcalC) },
      { value: tKcalF, color: MACRO_COLORS.fat,     label: goalLabel('Fat',     t.fat     || 0, tKcalF) }
    ],
    140
  );
  el.innerHTML = `
    <div class="pie-wrap">${svg}</div>
    <div class="pie-note">
      <span class="pie-note-row"><span class="pie-note-ring outer"></span>Outer: today</span>
      <span class="pie-note-row"><span class="pie-note-ring inner"></span>Inner: goal</span>
      <span class="pie-note-hint" title="Hover any ring segment for its exact grams and percentage.">hover for details</span>
    </div>
    <div class="pie-legend">
      <div class="pl-head">
        <span title="Outer ring: today's actual macro split by calories.">Actual</span>
        <span class="pl-head-vs">vs</span>
        <span title="Inner ring: your target macro split, in calories. Set in Settings - Daily targets.">goal</span>
      </div>
      <div class="pl-item"><span class="dot p"></span>Protein <b>${r(totals.protein)}</b> / ${r(t.protein || 0)} g <span class="pl-sub">${aPct(kcalP)}% / ${tPct(tKcalP)}%</span></div>
      <div class="pl-item"><span class="dot c"></span>Carbs   <b>${r(totals.carbs)}</b>   / ${r(t.carbs   || 0)} g <span class="pl-sub">${aPct(kcalC)}% / ${tPct(tKcalC)}%</span></div>
      <div class="pl-item"><span class="dot f"></span>Fat     <b>${r(totals.fat)}</b>     / ${r(t.fat     || 0)} g <span class="pl-sub">${aPct(kcalF)}% / ${tPct(tKcalF)}%</span></div>
      <div class="pl-kcal">${r(totalKcal)} kcal logged${targetKcal > 0 ? ` / ${r(targetKcal)} goal` : ''}</div>
    </div>
  `;
  el.classList.remove('hidden');
  empty.classList.add('hidden');
}

function renderQuip(totals) {
  const el = $('#quip');
  const line = CT.quips.pick(totals.calories, state.targets.calories, state.date);
  if (line) {
    el.textContent = line;
    el.classList.remove('hidden');
  } else {
    el.textContent = '';
    el.classList.add('hidden');
  }
}

function renderTotals(totals) {
  const t = state.targets;
  const cards = [
    ['Calories', totals.calories, t.calories, 'kcal'],
    ['Protein',  totals.protein,  t.protein, 'g'],
    ['Carbs',    totals.carbs,    t.carbs, 'g'],
    ['Fat',      totals.fat,      t.fat, 'g']
  ];
  $('#totals-bar').innerHTML = cards.map(([label, val, target, unit]) => {
    const pct = target > 0 ? Math.min(100, (val / target) * 100) : 0;
    const over = target > 0 && val > target;
    return `<div class="total-card">
      <div class="label">${label}</div>
      <div class="val">${r(val)}<small> / ${target}${unit}</small></div>
      <div class="bar"><span class="${over ? 'over' : ''}" style="width:${pct}%"></span></div>
    </div>`;
  }).join('');
}

function renderNet(totals, burned) {
  const section = $('#net-section');
  if (burned <= 0) {
    section.classList.add('hidden');
    return;
  }
  const net = totals.calories - burned;
  section.title = 'Calories eaten minus calories burned via logged exercise.';
  $('#net-val').textContent = `${r(net)} kcal`;
  $('#net-sub').innerHTML = `${r(totals.calories)} in − <span class="burned">${r(burned)} burned</span>`;
  section.classList.remove('hidden');
}

function renderMeals(entries) {
  const byMeal = {};
  MEALS.forEach(m => byMeal[m.key] = []);
  entries.forEach(e => { (byMeal[e.meal] || (byMeal[e.meal] = [])).push(e); });

  $('#meals').innerHTML = MEALS.map(({ key, label }) => {
    const list = byMeal[key] || [];
    const kcal = list.reduce((s, e) => s + e.calories, 0);
    const items = list.length
      ? list.map(e => `
          <div class="entry" data-id="${e.id}">
            <div class="name">
              <div class="n">${escapeHtml(e.name)}</div>
              <div class="sub">${escapeHtml(e.brand || '')}${e.brand ? ' · ' : ''}${r(e.servings * e.serving_size)} ${escapeHtml(e.serving_unit)}</div>
            </div>
            <div class="macro">${formatMacros(e)}</div>
            <div class="kcal">${r(e.calories)} kcal</div>
            <button class="edit" title="Edit entry">✎</button>
            <button class="del" title="Remove">✕</button>
          </div>`).join('')
      : '';
    return `<div class="meal${list.length ? ' has-entries' : ''}" data-meal="${key}">
      <h3>${label} <span class="kcal">${r(kcal)} kcal</span>
        <button class="ghost-btn add-here" data-add="${key}">+ Add food</button>
        <button class="ghost-btn copy-here" data-copy="${key}" title="Copy this meal's entries from another day into today.">↻ Copy from…</button>
      </h3>
      ${items}
    </div>`;
  }).join('');

  $$('#meals .del').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const id = btn.closest('.entry').dataset.id;
      await CT.db.deleteEntry(id);
      renderDiary();
    });
  });
  $$('#meals .edit').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.closest('.entry').dataset.id;
      const entry = entries.find(en => en.id === id);
      if (!entry) return;
      let food = await CT.db.getFood(entry.food_id);
      if (!food) {
        // Original food was deleted; synthesize a one-off from the entry so
        // the user can still edit the amount/meal/date without losing it.
        const perServing = (v) => entry.servings ? v / entry.servings : v;
        food = {
          id: entry.food_id,
          name: entry.name,
          brand: entry.brand || '',
          serving_size: entry.serving_size,
          serving_unit: entry.serving_unit,
          calories: perServing(entry.calories),
          protein:  perServing(entry.protein),
          carbs:    perServing(entry.carbs),
          fat:      perServing(entry.fat),
          image: '',
          source: 'ephemeral'
        };
      }
      openAddModal(food, entry);
    });
  });
  $$('#meals [data-add]').forEach(btn => {
    btn.addEventListener('click', () => {
      state.meal = btn.dataset.add;
      $$('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.view === 'foods'));
      $$('.view').forEach(v => v.classList.add('hidden'));
      $('#view-foods').classList.remove('hidden');
      $('#search-input').focus();
    });
  });
  $$('#meals [data-copy]').forEach(btn => {
    btn.addEventListener('click', () => openCopyMealModal(btn.dataset.copy));
  });
}

// ------- EXPORT DIARY TO PDF -------
const exportPdfModal = document.getElementById('export-pdf-modal');
const exportPdfForm = document.getElementById('export-pdf-form');

exportPdfModal.addEventListener('click', (e) => {
  if (e.target.dataset.close !== undefined || e.target === exportPdfModal) exportPdfModal.classList.add('hidden');
});

$('#btn-export-pdf').addEventListener('click', () => openExportPdfModal());

function openExportPdfModal() {
  const today = state.date;
  const end = new Date(today + 'T00:00:00');
  const start = new Date(end);
  start.setDate(start.getDate() - 6); // default: last 7 days ending today
  $('#export-pdf-from').value = isoDate(start);
  $('#export-pdf-to').value   = today;

  $('#export-pdf-shortcuts').innerHTML = `
    <button type="button" class="ghost-btn small" data-days="1">Today only</button>
    <button type="button" class="ghost-btn small" data-days="3">Last 3 days</button>
    <button type="button" class="ghost-btn small" data-days="7">Last 7 days</button>
  `;
  $$('#export-pdf-shortcuts [data-days]').forEach(btn => {
    btn.addEventListener('click', () => {
      const n = Number(btn.dataset.days);
      const e = new Date(state.date + 'T00:00:00');
      const s = new Date(e);
      s.setDate(s.getDate() - (n - 1));
      $('#export-pdf-from').value = isoDate(s);
      $('#export-pdf-to').value   = isoDate(e);
      updateExportPdfInfo();
    });
  });

  $('#export-pdf-from').addEventListener('input', updateExportPdfInfo);
  $('#export-pdf-to').addEventListener('input', updateExportPdfInfo);

  updateExportPdfInfo();
  exportPdfModal.classList.remove('hidden');
}

function updateExportPdfInfo() {
  const from = $('#export-pdf-from').value;
  const to = $('#export-pdf-to').value;
  const info = $('#export-pdf-info');
  if (!from || !to) { info.textContent = ''; return; }
  const days = daysBetween(from, to);
  if (days === null) { info.textContent = 'Invalid date range.'; info.className = 'export-pdf-info error'; return; }
  if (days < 1) { info.textContent = '"To" date must be the same or later than "From."'; info.className = 'export-pdf-info error'; return; }
  if (days > 7) { info.textContent = `${days} days selected — max is 7.`; info.className = 'export-pdf-info error'; return; }
  info.textContent = `${days} day${days === 1 ? '' : 's'} selected.`;
  info.className = 'export-pdf-info';
}

function daysBetween(fromIso, toIso) {
  const from = new Date(fromIso + 'T00:00:00');
  const to = new Date(toIso + 'T00:00:00');
  if (isNaN(from) || isNaN(to)) return null;
  return Math.round((to - from) / 86400000) + 1;
}

exportPdfForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const from = $('#export-pdf-from').value;
  const to = $('#export-pdf-to').value;
  const days = daysBetween(from, to);
  if (!days || days < 1 || days > 7) { toast('Pick a range between 1 and 7 days.'); return; }
  if (!window.ct || !window.ct.exportDiaryPdf) {
    toast('PDF export requires a full app restart after update.');
    return;
  }
  exportPdfModal.classList.add('hidden');
  toast('Building PDF...');
  try {
    const html = await buildDiaryPdfHtml(from, to);
    const filename = days === 1
      ? `crumbtracker-${from}.pdf`
      : `crumbtracker-${from}-to-${to}.pdf`;
    const res = await window.ct.exportDiaryPdf({ html, defaultFilename: filename });
    if (res && res.ok) toast('Saved: ' + res.path, 4000);
    else if (res && res.canceled) { /* silent */ }
    else toast('PDF export failed: ' + ((res && res.error) || 'unknown error'), 5000);
  } catch (err) {
    toast('PDF export failed: ' + (err.message || err), 5000);
  }
});

// Build a self-contained HTML document representing the diary for a date range.
// Inlines its own light-theme stylesheet — independent of the app's CSS so the
// PDF reads well on paper regardless of how the app looks on screen.
async function buildDiaryPdfHtml(fromIso, toIso) {
  const days = daysBetween(fromIso, toIso);
  const dates = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(fromIso + 'T00:00:00');
    d.setDate(d.getDate() + i);
    dates.push(isoDate(d));
  }

  const t = state.targets || {};
  const hasTargets = !!state.targetsSaved;
  const targetKcal = hasTargets ? (t.calories || 0) : 0;

  const dayBlocks = [];
  for (const date of dates) {
    const entries = await CT.db.listEntriesForDate(date);
    const exercises = await CT.db.listExercisesForDate(date);
    const note = await CT.db.getNote(date);
    const totals = entries.reduce((acc, e) => {
      acc.calories += e.calories || 0;
      acc.protein  += e.protein  || 0;
      acc.carbs    += e.carbs    || 0;
      acc.fat      += e.fat      || 0;
      return acc;
    }, { calories: 0, protein: 0, carbs: 0, fat: 0 });
    const burned = exercises.reduce((s, e) => s + (e.calories || 0), 0);

    // Skip completely empty days (no food, no exercise, no note) unless this
    // is a single-day export (user wants proof of "nothing logged").
    if (days > 1 && !entries.length && !exercises.length && !(note && note.trim())) continue;

    const byMeal = {};
    MEALS.forEach(m => byMeal[m.key] = []);
    entries.forEach(e => { (byMeal[e.meal] || (byMeal[e.meal] = [])).push(e); });

    const mealBlocks = MEALS.map(({ key, label }) => {
      const list = byMeal[key] || [];
      if (!list.length) return '';
      const mealKcal = list.reduce((s, e) => s + (e.calories || 0), 0);
      const rows = list.map(e => `
        <tr>
          <td class="name">${escapeHtml(e.name)}${e.brand ? ` <span class="brand">(${escapeHtml(e.brand)})</span>` : ''}</td>
          <td class="amt">${r(e.servings * e.serving_size)} ${escapeHtml(e.serving_unit)}</td>
          <td class="num">${r(e.calories)}</td>
          <td class="num">${r(e.protein)}</td>
          <td class="num">${r(e.carbs)}</td>
          <td class="num">${r(e.fat)}</td>
        </tr>`).join('');
      return `
        <div class="meal-block">
          <div class="meal-head"><b>${label}</b> <span class="meal-kcal">${r(mealKcal)} kcal</span></div>
          <table>
            <thead><tr><th>Food</th><th>Amount</th><th>kcal</th><th>P (g)</th><th>C (g)</th><th>F (g)</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>`;
    }).join('');

    const exerciseBlock = exercises.length ? `
      <div class="meal-block">
        <div class="meal-head"><b>Exercise</b> <span class="meal-kcal">${r(burned)} kcal burned</span></div>
        <table>
          <thead><tr><th>Activity</th><th>Duration</th><th>kcal</th></tr></thead>
          <tbody>
            ${exercises.map(e => `<tr>
              <td class="name">${escapeHtml(e.name)}</td>
              <td class="amt">${e.duration_min ? r(e.duration_min) + ' min' : ''}</td>
              <td class="num">${r(e.calories)}</td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>` : '';

    const noteBlock = (note && note.trim()) ? `
      <div class="meal-block notes-block">
        <div class="meal-head"><b>Notes</b></div>
        <div class="note-text">${escapeHtml(note).replace(/\n/g, '<br>')}</div>
      </div>` : '';

    const dateObj = new Date(date + 'T00:00:00');
    const dateLabel = dateObj.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

    const totalsRow = `
      <div class="day-totals">
        <span><b>${r(totals.calories)}</b> kcal${targetKcal ? ` / ${r(targetKcal)} goal` : ''}</span>
        <span>P <b>${r(totals.protein)}</b>g${hasTargets ? ` / ${r(t.protein)}g` : ''}</span>
        <span>C <b>${r(totals.carbs)}</b>g${hasTargets ? ` / ${r(t.carbs)}g` : ''}</span>
        <span>F <b>${r(totals.fat)}</b>g${hasTargets ? ` / ${r(t.fat)}g` : ''}</span>
        ${burned > 0 ? `<span class="burned">− ${r(burned)} kcal exercise</span>` : ''}
      </div>`;

    dayBlocks.push(`
      <section class="day">
        <h2>${escapeHtml(dateLabel)}</h2>
        ${totalsRow}
        ${mealBlocks || '<div class="empty">No food logged.</div>'}
        ${exerciseBlock}
        ${noteBlock}
      </section>
    `);
  }

  const content = dayBlocks.length
    ? dayBlocks.join('')
    : '<section class="day"><div class="empty">No entries in the selected range.</div></section>';

  const generatedAt = new Date().toLocaleString();
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>CrumbTracker diary ${escapeHtml(fromIso)} to ${escapeHtml(toIso)}</title>
<style>
  @page { margin: 0.5in; }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, "Segoe UI", Roboto, Arial, sans-serif; color: #1a1a1a; background: #fff; margin: 0; padding: 0; font-size: 11pt; line-height: 1.4; }
  .doc-head { border-bottom: 2px solid #333; padding-bottom: 8px; margin-bottom: 14px; }
  .doc-head h1 { margin: 0; font-size: 16pt; }
  .doc-head .sub { color: #666; font-size: 9pt; margin-top: 2px; }
  .day { page-break-inside: avoid; margin-bottom: 22px; padding-bottom: 14px; border-bottom: 1px dashed #bbb; }
  .day:last-child { border-bottom: none; }
  .day + .day { page-break-before: auto; }
  .day h2 { font-size: 13pt; margin: 0 0 6px; color: #222; }
  .day-totals { background: #f2f4f7; border: 1px solid #d8dde4; border-radius: 6px; padding: 8px 12px; margin-bottom: 10px; font-size: 10pt; display: flex; gap: 16px; flex-wrap: wrap; }
  .day-totals b { color: #111; }
  .day-totals .burned { color: #888; }
  .meal-block { margin: 0 0 10px; }
  .meal-head { font-size: 10pt; margin-bottom: 4px; color: #333; display: flex; justify-content: space-between; border-bottom: 1px solid #ddd; padding-bottom: 2px; }
  .meal-kcal { color: #666; font-size: 9pt; }
  table { border-collapse: collapse; width: 100%; font-size: 9.5pt; }
  th, td { padding: 3px 6px; text-align: left; }
  th { color: #666; font-weight: 600; border-bottom: 1px solid #ccc; font-size: 8.5pt; text-transform: uppercase; letter-spacing: 0.4px; }
  td.name { width: 45%; }
  td.brand { color: #888; font-size: 9pt; }
  td.amt { color: #444; }
  td.num { text-align: right; font-variant-numeric: tabular-nums; width: 50px; }
  th:nth-child(n+3), td.num { text-align: right; }
  .notes-block .note-text { font-size: 10pt; color: #333; white-space: pre-wrap; background: #fafaf7; border: 1px solid #eee; border-radius: 4px; padding: 8px 10px; }
  .empty { color: #888; font-style: italic; font-size: 10pt; padding: 6px 0; }
  .brand { color: #888; font-weight: normal; font-size: 9pt; }
</style>
</head><body>
<div class="doc-head">
  <h1>CrumbTracker diary</h1>
  <div class="sub">${escapeHtml(fromIso)} to ${escapeHtml(toIso)} · generated ${escapeHtml(generatedAt)}</div>
</div>
${content}
</body></html>`;
}

// ------- COPY MEAL FROM ANOTHER DAY -------
const copyMealModal = document.getElementById('copy-meal-modal');
const copyMealForm = document.getElementById('copy-meal-form');
let _copyMealTargetSection = null;

copyMealModal.addEventListener('click', (e) => {
  if (e.target.dataset.close !== undefined || e.target === copyMealModal) copyMealModal.classList.add('hidden');
});

function openCopyMealModal(targetSection) {
  _copyMealTargetSection = targetSection;
  const label = (MEALS.find(m => m.key === targetSection) || { label: targetSection }).label;
  $('#copy-meal-title').textContent = `Copy into ${label}`;

  // Sensible default: yesterday, same section.
  const d = new Date(state.date + 'T00:00:00');
  d.setDate(d.getDate() - 1);
  $('#copy-meal-date').value = isoDate(d);

  const sel = $('#copy-meal-source');
  sel.innerHTML = MEALS.map(m =>
    `<option value="${m.key}" ${m.key === targetSection ? 'selected' : ''}>${m.label}</option>`
  ).join('');

  // Quick-pick shortcuts.
  $('#copy-meal-shortcuts').innerHTML = `
    <button type="button" class="ghost-btn small" data-days="1">Yesterday</button>
    <button type="button" class="ghost-btn small" data-days="2">2 days ago</button>
    <button type="button" class="ghost-btn small" data-days="7">Last week</button>
  `;
  $$('#copy-meal-shortcuts [data-days]').forEach(btn => {
    btn.addEventListener('click', () => {
      const n = Number(btn.dataset.days);
      const dd = new Date(state.date + 'T00:00:00');
      dd.setDate(dd.getDate() - n);
      $('#copy-meal-date').value = isoDate(dd);
      renderCopyMealPreview();
    });
  });

  $('#copy-meal-date').addEventListener('input', renderCopyMealPreview);
  sel.addEventListener('change', renderCopyMealPreview);

  renderCopyMealPreview();
  copyMealModal.classList.remove('hidden');
}

async function renderCopyMealPreview() {
  const date = $('#copy-meal-date').value;
  const section = $('#copy-meal-source').value;
  const el = $('#copy-meal-preview');
  if (!date || !section) { el.innerHTML = ''; return; }
  const entries = await CT.db.listEntriesForDate(date);
  const matching = entries.filter(e => e.meal === section);
  if (!matching.length) {
    el.innerHTML = `<div class="empty" style="padding:8px">Nothing logged for that date and section.</div>`;
    return;
  }
  const totalCal = matching.reduce((s, e) => s + (e.calories || 0), 0);
  el.innerHTML = `
    <div class="copy-meal-count">${matching.length} ${matching.length === 1 ? 'entry' : 'entries'} · ${r(totalCal)} kcal</div>
    <ul class="copy-meal-list">
      ${matching.map(e => `<li>${escapeHtml(e.name)} <span class="muted">· ${r(e.calories)} kcal</span></li>`).join('')}
    </ul>
  `;
}

copyMealForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const date = $('#copy-meal-date').value;
  const section = $('#copy-meal-source').value;
  if (!date || !section) return;
  const entries = await CT.db.listEntriesForDate(date);
  const matching = entries.filter(en => en.meal === section);
  if (!matching.length) { toast('Nothing to copy from that day.'); return; }
  for (const src of matching) {
    await CT.db.addEntry({
      date: state.date,
      meal: _copyMealTargetSection,
      food_id: src.food_id,
      name: src.name,
      brand: src.brand,
      servings: src.servings,
      serving_size: src.serving_size,
      serving_unit: src.serving_unit,
      calories: src.calories,
      protein:  src.protein,
      carbs:    src.carbs,
      fat:      src.fat
    });
  }
  copyMealModal.classList.add('hidden');
  toast(`Copied ${matching.length} ${matching.length === 1 ? 'entry' : 'entries'}`);
  renderDiary();
});

$('#date-prev').addEventListener('click', () => shiftDate(-1));
$('#date-next').addEventListener('click', () => shiftDate(1));
$('#date-today').addEventListener('click', () => { state.date = isoDate(new Date()); renderDiary(); });
$('#date-picker').addEventListener('change', (e) => { state.date = e.target.value; renderDiary(); });

function shiftDate(delta) {
  const d = new Date(state.date + 'T00:00:00');
  d.setDate(d.getDate() + delta);
  state.date = isoDate(d);
  renderDiary();
}

// ------- FOODS: tabs -------
$$('.foods-tabs .tab').forEach(tab => {
  tab.addEventListener('click', () => {
    $$('.foods-tabs .tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    $$('.foods-panel').forEach(p => p.classList.add('hidden'));
    $('#panel-' + tab.dataset.tab).classList.remove('hidden');
    if (tab.dataset.tab === 'custom') renderCustomFoods();
    if (tab.dataset.tab === 'meals')  renderMealLibrary();
    if (tab.dataset.tab === 'recent') renderRecentFoods();
  });
});

// ------- FOODS: search -------
$('#search-btn').addEventListener('click', doSearch);
$('#search-input').addEventListener('keydown', e => { if (e.key === 'Enter') doSearch(); });

function looksLikeBarcode(q) {
  const digits = q.replace(/\s+/g, '');
  return /^\d+$/.test(digits) && [8, 12, 13, 14].includes(digits.length);
}

async function doSearch() {
  const q = $('#search-input').value.trim();
  const target = $('#search-results');
  if (!q) { target.innerHTML = ''; return; }
  target.innerHTML = `<div class="empty">Searching Open Food Facts…</div>`;
  try {
    const isBarcode = looksLikeBarcode(q);
    const [exact, results] = await Promise.all([
      isBarcode ? CT.api.lookupBarcode(q.replace(/\s+/g, '')).catch(() => null) : Promise.resolve(null),
      CT.api.searchProducts(q).catch(() => [])
    ]);
    const seen = new Set();
    const merged = [];
    if (exact) { merged.push({ ...exact, _exact: true }); seen.add(exact.barcode); }
    for (const r of results) {
      if (r.barcode && seen.has(r.barcode)) continue;
      merged.push(r);
    }
    if (!merged.length) { target.innerHTML = `<div class="empty">No results.</div>`; return; }
    renderResults(target, merged, { showAdd: true });
  } catch (e) {
    target.innerHTML = `<div class="empty">Search failed: ${escapeHtml(e.message)}</div>`;
  }
}

function renderFoodSourceBadge(f) {
  const m = f.entry_method || (f.source === 'custom' ? null : (f.source === 'off' ? 'searched' : null));
  // Map to label + tooltip + style class.
  const map = {
    manual:   { label: 'Manual',         tip: 'You typed this food in via Custom food.' },
    scanned:  { label: 'Scanned',        tip: 'Captured by scanning a barcode (camera, image, or phone scan).' },
    searched: { label: 'Open Food Facts', tip: 'Came from an Open Food Facts search and was saved to My Foods.' },
    label:    { label: 'Label OCR',       tip: 'Pre-filled from a Nutrition Facts label scan, then saved.' }
  };
  const info = map[m];
  if (!info) return `<div class="src-badge unknown" title="Origin unknown - this record predates source tracking.">Saved</div>`;
  return `<div class="src-badge ${m}" title="${escapeHtml(info.tip)}">${escapeHtml(info.label)}</div>`;
}

function renderResults(container, foods, { showAdd = true, showDelete = false, showSource = false } = {}) {
  container.innerHTML = '';
  foods.forEach(f => {
    const el = document.createElement('div');
    el.className = 'result';
    el.innerHTML = `
      ${f.image ? `<img src="${f.image}" alt="">` : `<div style="width:44px;height:44px;border-radius:6px;background:var(--bg-3)"></div>`}
      <div class="info">
        <div class="n">${escapeHtml(f.name)} ${f._exact ? '<span class="badge" title="Found by exact barcode lookup.">exact match</span>' : ''}</div>
        <div class="sub">${escapeHtml(f.brand || '')}${f.brand ? ' · ' : ''}${r(f.calories)} kcal / ${r(f.serving_size)} ${escapeHtml(f.serving_unit)}${f.serving_source && f.serving_source !== 'product' && f.serving_source !== 'custom' ? ' <em class="est" title="Serving size was inferred from the product category, not a label. Double-check before logging.">(est.)</em>' : ''}${f.barcode ? ' · ' + escapeHtml(f.barcode) : ''}</div>
        ${showSource ? renderFoodSourceBadge(f) : ''}
      </div>
      <div class="actions"></div>
    `;
    const actions = el.querySelector('.actions');
    if (showAdd) {
      const add = document.createElement('button');
      add.className = 'primary-btn';
      add.textContent = '+ Add';
      add.addEventListener('click', (e) => { e.stopPropagation(); openAddModal(f); });
      actions.appendChild(add);
    }
    if (showDelete) {
      const del = document.createElement('button');
      del.className = 'ghost-btn';
      del.textContent = 'Delete';
      del.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (!await confirmDialog({
          title: 'Delete custom food?',
          body: `"${f.name}" will be removed from My Foods. Existing diary entries that referenced it will keep their snapshot macros.`,
          okLabel: 'Delete',
          destructive: true
        })) return;
        await CT.db.deleteFood(f.id);
        renderCustomFoods();
      });
      actions.appendChild(del);
    }
    el.addEventListener('click', () => openAddModal(f));
    container.appendChild(el);
  });
}

// ------- FOODS: scan -------
$('#scan-btn').addEventListener('click', () => {
  CT.scanner.open(async (code) => {
    toast('Scanned ' + code);
    await handleBarcode(code);
  });
});

// ------- PHONE SCAN (experimental) -------
const phoneScanModal = document.getElementById('phone-scan-modal');
let _phoneScanUnsubCode = null;
let _phoneScanUnsubErr = null;
let _phoneScanActive = false;
let _phoneScanSession = null; // { qr, urls }

phoneScanModal.addEventListener('click', (e) => {
  // Close button / backdrop just hides the modal. It does NOT stop the server
  // - only "Stop sharing" does that.
  if (e.target.dataset.close !== undefined || e.target === phoneScanModal) {
    phoneScanModal.classList.add('hidden');
  }
});

function renderPhoneScanButton() {
  const btn = $('#phone-scan-btn');
  if (_phoneScanActive) {
    btn.classList.add('active');
    btn.innerHTML = '📱 Phone scan <span class="live-dot"></span>';
    btn.title = 'Phone scan is active. Click to view the QR code or stop sharing.';
  } else {
    btn.classList.remove('active');
    btn.innerHTML = '📱 Phone scan';
    btn.title = 'Experimental - scan a barcode with your phone\'s camera over your local network.';
  }
}

function renderPhoneScanModal() {
  if (_phoneScanSession) {
    $('#phone-scan-qr').innerHTML = `<img src="${_phoneScanSession.qr}" alt="QR code" />`;
    const urls = _phoneScanSession.urls;
    $('#phone-scan-url-text').innerHTML = urls.map((u, i) =>
      `<div class="phone-scan-url-row${i === 0 ? ' primary' : ''}">${escapeHtml(u)}</div>`
    ).join('');
    $('#phone-scan-session-actions').classList.remove('hidden');
  } else {
    $('#phone-scan-qr').innerHTML = '<div class="phone-scan-status">Starting local server…</div>';
    $('#phone-scan-url-text').textContent = '';
    $('#phone-scan-session-actions').classList.add('hidden');
  }
}

async function startPhoneScan() {
  if (!window.ct || !window.ct.remoteScanStart) {
    toast('Phone scan requires a full app restart after update.');
    return;
  }

  // Already running - just show the QR again.
  if (_phoneScanActive && _phoneScanSession) {
    renderPhoneScanModal();
    phoneScanModal.classList.remove('hidden');
    return;
  }

  _phoneScanSession = null;
  renderPhoneScanModal();
  phoneScanModal.classList.remove('hidden');

  const res = await window.ct.remoteScanStart();
  if (!res || !res.ok) {
    $('#phone-scan-qr').innerHTML = `<div class="phone-scan-status">Failed: ${escapeHtml(res && res.error || 'unknown error')}</div>`;
    return;
  }
  _phoneScanSession = {
    qr: res.qr,
    urls: res.urls && res.urls.length ? res.urls : [res.url]
  };
  _phoneScanActive = true;
  renderPhoneScanButton();
  renderPhoneScanModal();

  _phoneScanUnsubCode = window.ct.onRemoteScanCode(async (code) => {
    toast('Scanned ' + code);
    // Hide the QR modal but keep the server running so phone can send more.
    phoneScanModal.classList.add('hidden');
    try {
      await handleBarcode(code);
    } catch (e) {
      console.error('[phone scan] handleBarcode failed', e);
      toast('Couldn\'t open food dialog: ' + (e.message || e), 5000);
    }
  });
  _phoneScanUnsubErr = window.ct.onRemoteScanError((msg) => {
    toast('Phone scan error: ' + msg);
    endPhoneScanSession();
  });
}

async function endPhoneScanSession() {
  _phoneScanActive = false;
  _phoneScanSession = null;
  if (_phoneScanUnsubCode) { _phoneScanUnsubCode(); _phoneScanUnsubCode = null; }
  if (_phoneScanUnsubErr)  { _phoneScanUnsubErr();  _phoneScanUnsubErr  = null; }
  phoneScanModal.classList.add('hidden');
  renderPhoneScanButton();
  if (window.ct && window.ct.remoteScanStop) {
    try { await window.ct.remoteScanStop(); } catch {}
  }
}

$('#phone-scan-btn').addEventListener('click', () => startPhoneScan());
$('#phone-scan-stop').addEventListener('click', () => {
  endPhoneScanSession();
  toast('Phone scan stopped');
});

$('#scan-label-btn').addEventListener('click', () => {
  CT.labelScanner.open((parsed) => {
    openCustomModal({
      name: '',
      brand: '',
      barcode: '',
      serving_size: parsed.serving_size || 100,
      serving_unit: parsed.serving_unit || 'g',
      calories: parsed.calories || 0,
      protein: parsed.protein || 0,
      carbs: parsed.carbs || 0,
      fat: parsed.fat || 0,
      _method: 'label'
    });
    toast('Fill in the name and save.');
  });
});

async function handleBarcode(code) {
  // Check local foods (custom or cached) first.
  let food = await CT.db.getFoodByBarcode(code);
  if (!food) {
    try {
      const remote = await CT.api.lookupBarcode(code);
      if (remote) {
        food = await CT.db.saveFood({ ...remote, entry_method: 'scanned' }); // cache locally
      }
    } catch (e) {
      toast('Lookup error: ' + e.message, 3000);
      return;
    }
  }
  if (!food) {
    if (await confirmDialog({
      title: 'Product not found',
      body: `Open Food Facts has nothing for barcode <b>${escapeHtml(code)}</b>. Create a custom food with this barcode attached?`,
      okLabel: 'Create custom food'
    })) {
      openCustomModal({ barcode: code });
    }
    return;
  }
  openAddModal(food);
}

// ------- ADD MODAL -------
const addModal = document.getElementById('add-modal');
const addBody = document.getElementById('add-body');
addModal.addEventListener('click', (e) => {
  if (e.target.dataset.close !== undefined || e.target === addModal) addModal.classList.add('hidden');
});

function servingHint(food) {
  const sz = `${r(food.serving_size)} ${food.serving_unit}`;
  if (food.serving_source === 'category') return `Est. serving: ${sz} (category default — edit if wrong)`;
  if (food.serving_source === 'default')  return `Unknown serving: assumed ${sz} — edit to match your portion`;
  return `One serving: ${sz}`;
}

function openAddModal(food, editingEntry = null) {
  const unit = food.serving_unit || 'g';
  const defaultAmount = editingEntry
    ? (Number(editingEntry.servings) || 0) * (food.serving_size || 1)
    : (food.last_amount > 0 ? food.last_amount : food.serving_size);
  const usedLast = !editingEntry && food.last_amount > 0 && food.last_amount !== food.serving_size;
  const needsNutrition = !food.calories;
  const defaultMeal = editingEntry ? editingEntry.meal : state.meal;
  const defaultDate = editingEntry ? editingEntry.date : state.date;

  // Working copy — user edits to nutrition label mutate this, not `food`.
  const live = {
    serving_size: food.serving_size,
    calories: food.calories || 0,
    protein:  food.protein || 0,
    carbs:    food.carbs || 0,
    fat:      food.fat || 0,
    image:    food.image || ''
  };

  $('#add-title').textContent = editingEntry ? 'Edit entry' : 'Add food';
  addBody.innerHTML = `
    <div class="add-food">
      <div class="add-food-thumb" id="add-food-thumb" title="Click to change image.">
        ${live.image ? `<img src="${escapeHtml(live.image)}" alt="" />` : `<span class="thumb-empty">no image</span>`}
        <button type="button" class="thumb-edit" id="add-thumb-edit" title="Change image (file)">✎</button>
        <button type="button" class="thumb-paste" id="add-thumb-paste" title="Paste image from clipboard (Ctrl+V also works while this dialog is open)">📋</button>
      </div>
      <div class="info">
        <div class="n">${escapeHtml(food.name)}</div>
        <div class="sub"><span id="sub-brand">${escapeHtml(food.brand || '')}${food.brand ? ' · ' : ''}</span><span id="sub-cal">${r(live.calories)}</span> kcal / <span id="sub-size">${r(live.serving_size)}</span> ${escapeHtml(unit)}</div>
      </div>
      <button type="button" class="ghost-btn small" id="toggle-nutri">${needsNutrition ? '+ Add nutrition' : '✎ Edit nutrition'}</button>
      <input type="file" id="add-thumb-file" accept="image/*" style="display:none" />
    </div>
    <form class="add-form" id="add-form">
      <label>Meal
        <select name="meal">
          ${MEALS.map(m => `<option value="${m.key}" ${m.key === defaultMeal ? 'selected' : ''}>${m.label}</option>`).join('')}
        </select>
      </label>
      <label>Amount (${escapeHtml(unit)})
        <input type="number" step="0.1" min="0" name="amount" value="${defaultAmount}" autofocus />
      </label>
      <label>Date <input type="date" name="date" value="${defaultDate}" /></label>
      <label>Servings (calc)
        <input type="number" step="0.01" min="0" name="servings" value="1" />
      </label>
      <div class="serving-hint">${escapeHtml(servingHint(food))}${usedLast ? ' · prefilled from last time' : ''}</div>
      <div class="nutrition-edit ${needsNutrition ? '' : 'hidden'}" id="nutrition-edit">
        <div class="ne-head">Nutrition label — per serving</div>
        <div class="ne-grid">
          <label>Serving (${escapeHtml(unit)}) <input name="e_serving_size" type="number" step="0.1" min="0.1" value="${live.serving_size}" /></label>
          <label>Calories <input name="e_calories" type="number" step="0.1" min="0" value="${live.calories}" /></label>
          <label>Protein g <input name="e_protein" type="number" step="0.1" min="0" value="${live.protein}" /></label>
          <label>Carbs g <input name="e_carbs" type="number" step="0.1" min="0" value="${live.carbs}" /></label>
          <label>Fat g <input name="e_fat" type="number" step="0.1" min="0" value="${live.fat}" /></label>
        </div>
        <div class="ne-hint">Changes are saved to this food for next time.</div>
      </div>
      <div class="preview" id="add-preview"></div>
      ${food.source === 'meal' ? '' : `
      <label class="save-to-my-foods${food.source === 'custom' ? ' already' : ''}" title="Add this food to the 'My Foods' tab so you can find it again later without searching.">
        <input type="checkbox" name="save_to_my_foods" ${food.source === 'custom' ? 'checked disabled' : ''} />
        ${food.source === 'custom' ? 'Already in My Foods' : 'Save to My Foods'}
      </label>`}
      <div class="actions">
        <button type="button" class="ghost-btn" data-close>Cancel</button>
        <button type="submit" class="primary-btn">${editingEntry ? 'Save entry' : 'Add to diary'}</button>
      </div>
    </form>
  `;
  addModal.classList.remove('hidden');

  const form = $('#add-form');
  const amountInput = form.amount;
  const servingsInput = form.servings;
  const nutriEdit = $('#nutrition-edit');
  let lastEdited = 'amount';

  const update = () => {
    const size = live.serving_size > 0 ? live.serving_size : 1;
    let amount, servings;
    if (lastEdited === 'servings') {
      servings = Number(servingsInput.value) || 0;
      amount = servings * size;
      amountInput.value = r(amount);
    } else {
      amount = Number(amountInput.value) || 0;
      servings = amount / size;
      servingsInput.value = r(servings);
    }
    $('#sub-cal').textContent = r(live.calories);
    $('#sub-size').textContent = r(live.serving_size);
    const preview = $('#add-preview');
    preview.innerHTML = `
      <span><b>${r(live.calories * servings)}</b> kcal</span>
      <span>Protein <b>${r(live.protein * servings)}</b>g</span>
      <span>Carbs <b>${r(live.carbs * servings)}</b>g</span>
      <span>Fat <b>${r(live.fat * servings)}</b>g</span>
    `;
  };

  amountInput.addEventListener('input', () => { lastEdited = 'amount'; update(); });
  servingsInput.addEventListener('input', () => { lastEdited = 'servings'; update(); });
  form.meal.addEventListener('change', update);
  form.date.addEventListener('change', update);

  $('#toggle-nutri').addEventListener('click', () => {
    nutriEdit.classList.toggle('hidden');
    if (!nutriEdit.classList.contains('hidden')) form.e_calories.focus();
  });

  ['e_serving_size', 'e_calories', 'e_protein', 'e_carbs', 'e_fat'].forEach(name => {
    const key = name.slice(2);
    form[name].addEventListener('input', () => {
      live[key] = Number(form[name].value) || 0;
      update();
    });
  });

  // Image editing on the thumbnail.
  const thumbEl = $('#add-food-thumb');
  const thumbFile = $('#add-thumb-file');
  const refreshThumb = () => {
    thumbEl.innerHTML = `${live.image ? `<img src="${escapeHtml(live.image)}" alt="" />` : `<span class="thumb-empty">no image</span>`}
      <button type="button" class="thumb-edit" id="add-thumb-edit" title="Change image (file)">✎</button>
      <button type="button" class="thumb-paste" id="add-thumb-paste" title="Paste image from clipboard (Ctrl+V also works while this dialog is open)">📋</button>`;
    wireThumb();
  };
  const pickImage = () => thumbFile.click();
  const pasteImage = async () => {
    try {
      const url = await clipboardImageToDataUrl();
      if (url) { live.image = url; refreshThumb(); }
      else toast('No image on the clipboard');
    } catch (e) { toast('Paste failed: ' + (e.message || e)); }
  };
  const wireThumb = () => {
    // Click anywhere on the thumb except the paste button → file picker.
    thumbEl.addEventListener('click', (e) => {
      if (e.target.closest('#add-thumb-paste')) return;
      pickImage();
    }, { once: true });
    const pasteBtn = thumbEl.querySelector('#add-thumb-paste');
    if (pasteBtn) pasteBtn.addEventListener('click', (e) => { e.stopPropagation(); pasteImage(); });
  };
  thumbFile.addEventListener('change', async () => {
    const f = thumbFile.files[0];
    thumbFile.value = '';
    if (!f) return;
    try { live.image = await fileToDataUrl(f); refreshThumb(); } catch (e) { console.error(e); }
  });
  wireImageDropZone(thumbEl, (url) => { live.image = url; refreshThumb(); });
  // Ctrl+V anywhere in the add-food modal pastes an image into the thumb.
  const onPaste = async (e) => {
    const items = e.clipboardData && e.clipboardData.items;
    if (!items) return;
    for (const it of items) {
      if (it.type && it.type.startsWith('image/')) {
        const file = it.getAsFile();
        if (file) {
          e.preventDefault();
          try { live.image = await fileToDataUrl(file); refreshThumb(); } catch (err) { console.error(err); }
          return;
        }
      }
    }
  };
  addModal.addEventListener('paste', onPaste);
  // Clean up the paste listener when the modal is dismissed (the next openAddModal
  // re-installs it). Avoids accumulating handlers across multiple opens.
  const observer = new MutationObserver(() => {
    if (addModal.classList.contains('hidden')) {
      addModal.removeEventListener('paste', onPaste);
      observer.disconnect();
    }
  });
  observer.observe(addModal, { attributes: true, attributeFilter: ['class'] });
  wireThumb();

  update();

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const amount = Number(fd.get('amount')) || 0;
    const size = live.serving_size > 0 ? live.serving_size : 1;
    const servings = amount / size;

    const changed =
      live.serving_size !== food.serving_size ||
      live.calories     !== (food.calories || 0) ||
      live.protein      !== (food.protein  || 0) ||
      live.carbs        !== (food.carbs    || 0) ||
      live.fat          !== (food.fat      || 0) ||
      live.image        !== (food.image    || '');

    let saved = food;
    const isMeal = food.source === 'meal';
    const saveToMyFoods = fd.get('save_to_my_foods') === 'on';
    const alreadyCached = isMeal || food.source !== 'off' || !!(await CT.db.getFood(food.id));
    if (!isMeal && (changed || !alreadyCached || saveToMyFoods)) {
      saved = await CT.db.saveFood({
        ...food,
        serving_size: live.serving_size,
        calories: live.calories,
        protein:  live.protein,
        carbs:    live.carbs,
        fat:      live.fat,
        image:    live.image,
        source:   saveToMyFoods ? 'custom' : food.source,
        serving_source: changed ? 'custom' : food.serving_source,
        // First-time save of an OFF search result: mark as 'searched' so it's
        // distinguishable from scanned foods later. Existing entry_method
        // (e.g. 'scanned') is preserved by db.saveFood.
        entry_method: food.entry_method || (food.source === 'off' ? 'searched' : 'manual')
      });
    }

    // When editing, replace the original entry: remove it before creating the
    // new one so we don't double-count.
    if (editingEntry) {
      await CT.db.deleteEntry(editingEntry.id);
    }

    await CT.db.addEntry({
      date: fd.get('date'),
      meal: fd.get('meal'),
      food_id: saved.id,
      name: saved.name,
      brand: saved.brand,
      servings,
      serving_size: saved.serving_size,
      serving_unit: saved.serving_unit,
      calories: saved.calories * servings,
      protein:  saved.protein * servings,
      carbs:    saved.carbs * servings,
      fat:      saved.fat * servings
    });
    await CT.db.updateLastAmount(saved.id, amount);

    addModal.classList.add('hidden');
    state.date = fd.get('date');
    state.meal = fd.get('meal');
    toast(editingEntry ? 'Entry updated' : ('Added to ' + fd.get('meal')));
    renderDiary();
    $$('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.view === 'diary'));
    $$('.view').forEach(v => v.classList.add('hidden'));
    $('#view-diary').classList.remove('hidden');
  });
}

// ------- CUSTOM FOOD MODAL -------
const customModal = document.getElementById('custom-modal');
const customForm = document.getElementById('custom-form');
customModal.addEventListener('click', (e) => {
  if (e.target.dataset.close !== undefined || e.target === customModal) customModal.classList.add('hidden');
});

$('#btn-new-food').addEventListener('click', () => openCustomModal());

function setCustomImage(dataUrl) {
  const preview = $('#custom-img-preview');
  const removeBtn = $('#custom-img-remove');
  $('#custom-img-data').value = dataUrl || '';
  if (dataUrl) {
    preview.innerHTML = `<img src="${dataUrl}" alt="" />`;
    removeBtn.classList.remove('hidden');
  } else {
    preview.innerHTML = '<span class="img-placeholder">No image</span>';
    removeBtn.classList.add('hidden');
  }
}

// Stash the entry_method for the next custom-form save. Set by callers that
// open the modal pre-populated (e.g. label scanner sets 'label'). Cleared on
// modal close. Default for a blank Custom food click is 'manual'.
let _customEntryMethod = 'manual';

function openCustomModal(initial = {}) {
  $('#custom-title').textContent = initial.id ? 'Edit custom food' : 'Custom food';
  customForm.reset();
  customForm.id.value = initial.id || '';
  customForm.name.value = initial.name || '';
  customForm.brand.value = initial.brand || '';
  customForm.serving_size.value = initial.serving_size || '';
  customForm.serving_unit.value = initial.serving_unit || 'g';
  customForm.barcode.value = initial.barcode || '';
  customForm.calories.value = initial.calories ?? '';
  customForm.protein.value  = initial.protein  ?? '';
  customForm.carbs.value    = initial.carbs    ?? '';
  customForm.fat.value      = initial.fat      ?? '';
  setCustomImage(initial.image || '');
  _customEntryMethod = initial._method || 'manual';
  customModal.classList.remove('hidden');
}

// Wire image picker once.
(function wireCustomImagePicker() {
  const fileInput = $('#custom-img-file');
  $('#custom-img-upload').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', async () => {
    const f = fileInput.files[0];
    fileInput.value = '';
    if (!f) return;
    try { setCustomImage(await fileToDataUrl(f)); } catch (e) { console.error(e); }
  });
  $('#custom-img-paste').addEventListener('click', async () => {
    const hasBridge = !!(window.ct && window.ct.clipboardReadImage);
    console.log('[paste] bridge available:', hasBridge);
    if (!hasBridge) {
      toast('Clipboard bridge missing — restart the app');
      return;
    }
    try {
      const url = await clipboardImageToDataUrl();
      if (url) setCustomImage(url);
      else toast('No image on the clipboard');
    } catch (e) {
      console.error('[paste] failed', e);
      toast('Paste failed: ' + (e.message || e));
    }
  });
  $('#custom-img-remove').addEventListener('click', () => setCustomImage(''));
  wireImageDropZone($('#custom-img-preview'), setCustomImage);
  // Ctrl+V paste when modal is focused
  customModal.addEventListener('paste', async (e) => {
    const items = e.clipboardData && e.clipboardData.items;
    if (!items) return;
    for (const it of items) {
      if (it.type && it.type.startsWith('image/')) {
        const file = it.getAsFile();
        if (file) {
          e.preventDefault();
          setCustomImage(await fileToDataUrl(file));
          return;
        }
      }
    }
  });
})();

customForm.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.tagName === 'INPUT' && e.target.type !== 'submit') {
    e.preventDefault();
  }
});

customForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(customForm);
  const food = await CT.db.saveFood({
    id: fd.get('id') || undefined,
    source: 'custom',
    name: fd.get('name'),
    brand: fd.get('brand'),
    barcode: fd.get('barcode'),
    serving_size: fd.get('serving_size'),
    serving_unit: fd.get('serving_unit'),
    calories: fd.get('calories'),
    protein: fd.get('protein'),
    carbs: fd.get('carbs'),
    fat: fd.get('fat'),
    image: fd.get('image') || '',
    entry_method: _customEntryMethod
  });
  customModal.classList.add('hidden');
  toast('Saved');
  renderCustomFoods();
  openAddModal(food);
});

async function renderCustomFoods() {
  const foods = await CT.db.listFoods({ source: 'custom' });
  const el = $('#custom-results');
  if (!foods.length) { el.innerHTML = `<div class="empty">No custom foods yet. Click "+ Custom food" to add one.</div>`; return true; }
  const filter = ($('#custom-filter').value || '').trim().toLowerCase();
  const filtered = filter
    ? foods.filter(f => (f.name || '').toLowerCase().includes(filter) || (f.brand || '').toLowerCase().includes(filter))
    : foods;
  if (!filtered.length) {
    el.innerHTML = `<div class="empty">No matches for "${escapeHtml(filter)}".</div>`;
    return true;
  }
  renderResults(el, filtered, { showAdd: true, showDelete: true, showSource: true });
  return true;
}

$('#custom-filter').addEventListener('input', () => renderCustomFoods());

async function renderRecentFoods() {
  const entries = await CT.db.recentEntries(30);
  const el = $('#recent-results');
  if (!entries.length) { el.innerHTML = `<div class="empty">Log some food to see it here.</div>`; return; }
  // Resolve recent entries back to food records where possible.
  const foods = [];
  for (const e of entries) {
    const f = await CT.db.getFood(e.food_id);
    if (f) foods.push(f);
    else foods.push({
      id: e.food_id,
      name: e.name,
      brand: e.brand,
      serving_size: e.serving_size,
      serving_unit: e.serving_unit,
      calories: e.servings ? e.calories / e.servings : e.calories,
      protein: e.servings ? e.protein / e.servings : e.protein,
      carbs: e.servings ? e.carbs / e.servings : e.carbs,
      fat: e.servings ? e.fat / e.servings : e.fat,
      image: '',
      source: 'ephemeral'
    });
  }
  renderResults(el, foods, { showAdd: true });
}

// ------- MEALS -------
const mealModal = document.getElementById('meal-modal');
const mealForm = document.getElementById('meal-form');
let mealDraft = { ingredients: [] };

mealModal.addEventListener('click', (e) => {
  if (e.target.dataset.close !== undefined || e.target === mealModal) mealModal.classList.add('hidden');
});

mealForm.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.tagName === 'INPUT' && e.target.type !== 'submit') {
    e.preventDefault();
  }
});

$('#btn-new-meal').addEventListener('click', () => openMealModal());

async function renderMealLibrary() {
  const meals = await CT.db.listMeals();
  const el = $('#meals-results');
  if (!meals.length) {
    el.innerHTML = `<div class="empty">No meals yet. Click "+ New meal" to build one from your foods.</div>`;
    return;
  }
  el.innerHTML = '';
  for (const meal of meals) {
    const hydrated = await CT.db.hydrateMeal(meal);
    const unresolvedNote = hydrated.unresolved.length
      ? ` <em class="est" title="${hydrated.unresolved.length} ingredient(s) were deleted; macros may be stale.">⚠ ${hydrated.unresolved.length} missing</em>`
      : '';
    const ingNames = hydrated.resolved.map(x => x.food.name).slice(0, 4).join(', ');
    const extraCount = hydrated.resolved.length > 4 ? ` +${hydrated.resolved.length - 4} more` : '';
    const row = document.createElement('div');
    row.className = 'result';
    row.innerHTML = `
      ${meal.image ? `<img src="${escapeHtml(meal.image)}" alt="">` : `<div style="width:44px;height:44px;border-radius:6px;background:var(--bg-3)"></div>`}
      <div class="info">
        <div class="n">${escapeHtml(meal.name)}${unresolvedNote}</div>
        <div class="sub">${r(hydrated.calories)} kcal · ${escapeHtml(ingNames)}${extraCount}</div>
      </div>
      <div class="actions"></div>
    `;
    const actions = row.querySelector('.actions');
    const addBtn = document.createElement('button');
    addBtn.className = 'primary-btn';
    addBtn.textContent = '+ Add';
    addBtn.addEventListener('click', (e) => { e.stopPropagation(); openAddModal(hydrated); });
    actions.appendChild(addBtn);
    const editBtn = document.createElement('button');
    editBtn.className = 'ghost-btn';
    editBtn.textContent = 'Edit';
    editBtn.addEventListener('click', (e) => { e.stopPropagation(); openMealModal(meal); });
    actions.appendChild(editBtn);
    const delBtn = document.createElement('button');
    delBtn.className = 'ghost-btn';
    delBtn.textContent = 'Delete';
    delBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!await confirmDialog({
        title: 'Delete meal?',
        body: `"${escapeHtml(meal.name)}" will be removed. Past diary entries logged from this meal keep their snapshot macros.`,
        okLabel: 'Delete',
        destructive: true
      })) return;
      await CT.db.deleteMeal(meal.id);
      renderMealLibrary();
    });
    actions.appendChild(delBtn);
    row.addEventListener('click', () => openAddModal(hydrated));
    el.appendChild(row);
  }
}

async function openMealModal(meal) {
  mealDraft = {
    id: meal ? meal.id : '',
    name: meal ? meal.name : '',
    image: meal ? (meal.image || '') : '',
    ingredients: meal ? meal.ingredients.map(i => ({ ...i })) : []
  };
  $('#meal-title').textContent = meal ? 'Edit meal' : 'New meal';
  mealForm.id.value = mealDraft.id;
  mealForm.name.value = mealDraft.name;
  setMealImage(mealDraft.image);
  await populateMealFoodPicker();
  renderMealIngredients();
  mealModal.classList.remove('hidden');
  mealForm.name.focus();
}

function setMealImage(dataUrl) {
  $('#meal-img-data').value = dataUrl || '';
  mealDraft.image = dataUrl || '';
  const preview = $('#meal-img-preview');
  const removeBtn = $('#meal-img-remove');
  if (dataUrl) {
    preview.innerHTML = `<img src="${dataUrl}" alt="" />`;
    removeBtn.classList.remove('hidden');
  } else {
    preview.innerHTML = '<span class="img-placeholder">No image</span>';
    removeBtn.classList.add('hidden');
  }
}

async function populateMealFoodPicker() {
  const sel = $('#meal-add-food');
  sel.innerHTML = '<option value="">Select a food…</option>';
  const foods = await CT.db.listFoods();
  foods.sort((a, b) => a.name.localeCompare(b.name));
  for (const f of foods) {
    const opt = document.createElement('option');
    opt.value = f.id;
    opt.textContent = f.brand ? `${f.name} — ${f.brand}` : f.name;
    sel.appendChild(opt);
  }
}

async function renderMealIngredients() {
  const el = $('#meal-ingredients');
  if (!mealDraft.ingredients.length) {
    el.innerHTML = `<div class="empty" style="padding:12px">No ingredients yet.</div>`;
    $('#meal-totals').innerHTML = '';
    return;
  }
  let cal = 0, p = 0, c = 0, f = 0;
  el.innerHTML = '';
  for (let idx = 0; idx < mealDraft.ingredients.length; idx++) {
    const ing = mealDraft.ingredients[idx];
    const food = await CT.db.getFood(ing.food_id);
    const row = document.createElement('div');
    row.className = 'meal-ing-row';
    if (!food) {
      row.innerHTML = `
        <div class="info"><div class="n"><em>Missing food</em></div><div class="sub">(deleted; remove or replace)</div></div>
        <div class="actions"></div>
      `;
    } else {
      const s = Number(ing.servings) || 0;
      cal += (food.calories || 0) * s;
      p   += (food.protein  || 0) * s;
      c   += (food.carbs    || 0) * s;
      f   += (food.fat      || 0) * s;
      const amount = s * (food.serving_size || 1);
      row.innerHTML = `
        <div class="info">
          <div class="n">${escapeHtml(food.name)}${food.brand ? ` <span class="muted">· ${escapeHtml(food.brand)}</span>` : ''}</div>
          <div class="sub">${r(s)} serving × ${r(food.serving_size)}${escapeHtml(food.serving_unit)} = ${r(amount)}${escapeHtml(food.serving_unit)} · ${r((food.calories || 0) * s)} kcal</div>
        </div>
        <div class="actions">
          <input type="number" step="0.01" min="0" class="meal-ing-servings" value="${r(s)}" title="Servings" />
        </div>
      `;
      row.querySelector('.meal-ing-servings').addEventListener('input', (ev) => {
        mealDraft.ingredients[idx].servings = Number(ev.target.value) || 0;
        renderMealIngredients();
      });
    }
    const rm = document.createElement('button');
    rm.type = 'button';
    rm.className = 'ghost-btn small';
    rm.textContent = '✕';
    rm.title = 'Remove';
    rm.addEventListener('click', () => {
      mealDraft.ingredients.splice(idx, 1);
      renderMealIngredients();
    });
    row.querySelector('.actions').appendChild(rm);
    el.appendChild(row);
  }
  $('#meal-totals').innerHTML = `
    <b>Total per meal:</b>
    <span>${r(cal)} kcal</span>
    <span>P ${r(p)}g</span>
    <span>C ${r(c)}g</span>
    <span>F ${r(f)}g</span>
  `;
}

$('#meal-add-btn').addEventListener('click', () => {
  const foodId = $('#meal-add-food').value;
  const servings = Number($('#meal-add-servings').value) || 0;
  if (!foodId) { toast('Pick a food first'); return; }
  if (servings <= 0) { toast('Enter servings > 0'); return; }
  mealDraft.ingredients.push({ food_id: foodId, servings });
  $('#meal-add-food').value = '';
  $('#meal-add-servings').value = '';
  renderMealIngredients();
});

// Meal image picker — mirror of the custom-food one.
(function wireMealImagePicker() {
  const fileInput = $('#meal-img-file');
  $('#meal-img-upload').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', async () => {
    const f = fileInput.files[0];
    fileInput.value = '';
    if (!f) return;
    try { setMealImage(await fileToDataUrl(f)); } catch (e) { console.error(e); }
  });
  $('#meal-img-paste').addEventListener('click', async () => {
    try {
      const url = await clipboardImageToDataUrl();
      if (url) setMealImage(url);
      else toast('No image on the clipboard');
    } catch (e) { toast('Paste failed: ' + (e.message || e)); }
  });
  $('#meal-img-remove').addEventListener('click', () => setMealImage(''));
  wireImageDropZone($('#meal-img-preview'), setMealImage);
  mealModal.addEventListener('paste', async (e) => {
    const items = e.clipboardData && e.clipboardData.items;
    if (!items) return;
    for (const it of items) {
      if (it.type && it.type.startsWith('image/')) {
        const file = it.getAsFile();
        if (file) {
          e.preventDefault();
          setMealImage(await fileToDataUrl(file));
          return;
        }
      }
    }
  });
})();

mealForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(mealForm);
  if (!mealDraft.ingredients.length) { toast('Add at least one ingredient'); return; }
  await CT.db.saveMeal({
    id: fd.get('id') || undefined,
    name: fd.get('name'),
    image: mealDraft.image,
    ingredients: mealDraft.ingredients
  });
  mealModal.classList.add('hidden');
  toast('Meal saved');
  renderMealLibrary();
});

// ------- EXERCISE MODAL -------
const exerciseModal = document.getElementById('exercise-modal');
const exerciseForm = document.getElementById('exercise-form');
exerciseModal.addEventListener('click', (e) => {
  if (e.target.dataset.close !== undefined || e.target === exerciseModal) exerciseModal.classList.add('hidden');
});
$('#btn-add-exercise').addEventListener('click', () => {
  exerciseForm.reset();
  exerciseForm.date.value = state.date;
  exerciseModal.classList.remove('hidden');
  exerciseForm.name.focus();
});
exerciseForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(exerciseForm);
  await CT.db.addExercise({
    date: fd.get('date'),
    name: fd.get('name'),
    duration_min: fd.get('duration_min'),
    calories: fd.get('calories')
  });
  exerciseModal.classList.add('hidden');
  toast('Exercise logged');
  if (fd.get('date') === state.date) renderDiary();
});

// ------- WEIGH-IN MODAL -------
const weighinModal = document.getElementById('weighin-modal');
const weighinForm = document.getElementById('weighin-form');
weighinModal.addEventListener('click', (e) => {
  if (e.target.dataset.close !== undefined || e.target === weighinModal) weighinModal.classList.add('hidden');
});
$('#btn-log-weight').addEventListener('click', async () => {
  const profile = { ...DEFAULT_BODY, ...(await CT.db.getSetting('body', {})) };
  const unit = profile.units === 'imperial' ? 'lb' : 'kg';
  $('#weighin-unit').textContent = unit;
  weighinForm.reset();
  weighinForm.date.value = isoDate(new Date());
  // Prefill with most recent weigh-in if present.
  const last = await CT.db.latestWeight();
  if (last) {
    weighinForm.weight.value = profile.units === 'imperial'
      ? Math.round(kgToLb(last.kg) * 10) / 10
      : Math.round(last.kg * 10) / 10;
  } else if (profile.weight_kg) {
    weighinForm.weight.value = profile.units === 'imperial'
      ? Math.round(kgToLb(profile.weight_kg) * 10) / 10
      : Math.round(profile.weight_kg * 10) / 10;
  }
  weighinModal.classList.remove('hidden');
  weighinForm.weight.focus();
});
weighinForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(weighinForm);
  const profile = { ...DEFAULT_BODY, ...(await CT.db.getSetting('body', {})) };
  const raw = Number(fd.get('weight')) || 0;
  const kg = profile.units === 'imperial' ? lbToKg(raw) : raw;
  await CT.db.saveWeight(fd.get('date'), kg);
  // Update profile's current weight to match latest entered weigh-in.
  const all = await CT.db.listWeights();
  const latest = all[all.length - 1];
  if (latest) {
    profile.weight_kg = latest.kg;
    await CT.db.setSetting('body', profile);
  }
  weighinModal.classList.add('hidden');
  toast('Weight logged');
  renderProgress();
});

// ------- PROGRESS -------
const KCAL_PER_KG = 7700;

state.progressRange = 30;

function addDays(iso, n) {
  const d = new Date(iso + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return isoDate(d);
}

function shortDate(iso) {
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function longDate(iso) {
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

async function renderProgress() {
  const chartEl = $('#progress-chart');
  const statsEl = $('#progress-stats');
  const listEl = $('#weighin-list');

  const profile = { ...DEFAULT_BODY, ...(await CT.db.getSetting('body', {})) };
  const targets = { ...DEFAULT_TARGETS, ...(await CT.db.getSetting('targets', {})) };

  // Always show the weigh-in list, regardless of body profile completeness.
  // Logging weight should never be hidden behind "fill out body stats first."
  const weightsAll = await CT.db.listWeights();
  const listUnits = profile.units || 'imperial';
  listEl.innerHTML = renderWeighinList(weightsAll, listUnits);
  $$('#weighin-list .del').forEach(btn => {
    btn.addEventListener('click', async () => {
      const date = btn.dataset.date;
      if (!await confirmDialog({
        title: 'Delete weigh-in?',
        body: `Remove the weigh-in logged on ${escapeHtml(date)}?`,
        okLabel: 'Delete',
        destructive: true
      })) return;
      await CT.db.deleteWeight(date);
      renderProgress();
    });
  });

  if (!profile.weight_kg || !profile.height_cm || !profile.age) {
    chartEl.innerHTML = `<div class="chart-empty">Fill in Settings → Body &amp; activity to see projections.${weightsAll.length ? ' Your weigh-ins are saved below.' : ''}</div>`;
    statsEl.innerHTML = '';
    return;
  }

  const bmr = profile.sex === 'female'
    ? 10 * profile.weight_kg + 6.25 * profile.height_cm - 5 * profile.age - 161
    : 10 * profile.weight_kg + 6.25 * profile.height_cm - 5 * profile.age + 5;
  const tdee = bmr * profile.activity;
  const target_cal = targets.calories || tdee;
  const plan_exercise = Number(await CT.db.getSetting('plan_exercise', 0)) || 0;
  $('#plan-exercise').value = plan_exercise;
  const planDailyDeficit = tdee + plan_exercise - target_cal;

  const N = state.progressRange;
  const pastDays = Math.floor((N - 1) / 2);
  const futureDays = N - 1 - pastDays;
  const today = isoDate(new Date());
  const days = [];
  for (let i = -pastDays; i <= futureDays; i++) days.push(addDays(today, i));

  // Anchor the plan line at the most recent weigh-in (or today's profile weight as fallback).
  const weights = await CT.db.listWeights();
  const anchor = weights.length
    ? weights[weights.length - 1]
    : { date: today, kg: profile.weight_kg };

  const plan = days.map(d => {
    const diff = Math.round((new Date(d + 'T00:00:00') - new Date(anchor.date + 'T00:00:00')) / 86400000);
    return { date: d, kg: anchor.kg - diff * planDailyDeficit / KCAL_PER_KG };
  });

  // Weigh-ins within the range — points + connecting line.
  const firstDay = days[0];
  const lastDay = days[days.length - 1];
  const weighinsInRange = weights.filter(w => w.date >= firstDay && w.date <= lastDay);

  chartEl.innerHTML = makeChartSVG(days, plan, weighinsInRange, today, profile.units, anchor);
  statsEl.innerHTML = buildProgressStats(profile, days, plan, weighinsInRange, today, planDailyDeficit, anchor, plan_exercise);
  // Re-render list with profile units (in case they differ from default).
  listEl.innerHTML = renderWeighinList(weights, profile.units);
  $$('#weighin-list .del').forEach(btn => {
    btn.addEventListener('click', async () => {
      const date = btn.dataset.date;
      if (!await confirmDialog({
        title: 'Delete weigh-in?',
        body: `Remove the weigh-in logged on ${escapeHtml(date)}?`,
        okLabel: 'Delete',
        destructive: true
      })) return;
      await CT.db.deleteWeight(date);
      renderProgress();
    });
  });
}

function renderWeighinList(weights, units) {
  if (!weights.length) {
    return `<div class="weighin-empty">No weigh-ins yet. Click "+ Log weight" to start tracking.</div>`;
  }
  const disp = units === 'imperial' ? kgToLb : v => v;
  const unitLabel = units === 'imperial' ? 'lb' : 'kg';
  const sorted = [...weights].sort((a, b) => a.date < b.date ? 1 : -1); // newest first
  return `
    <div class="weighin-head">Weigh-ins (${weights.length})</div>
    <div class="weighin-rows">
      ${sorted.map(w => `
        <div class="weighin-row">
          <span class="date">${longDate(w.date)}</span>
          <span class="val"><b>${r(disp(w.kg))}</b> ${unitLabel}</span>
          <button class="del" data-date="${w.date}" title="Delete">✕</button>
        </div>
      `).join('')}
    </div>
  `;
}

function buildProgressStats(profile, days, plan, weighins, today, planDailyDeficit, anchor, planExercise = 0) {
  const toDisp = profile.units === 'imperial' ? kgToLb : v => v;
  const unit = profile.units === 'imperial' ? 'lb' : 'kg';
  const endIdx = days.length - 1;
  const planEnd = toDisp(plan[endIdx].kg);
  const curDisp = toDisp(anchor.kg);
  const delta = planEnd - curDisp;
  const dir = Math.abs(delta) < 0.05 ? 'maintain' : (delta < 0 ? 'lose' : 'gain');
  const rate = planDailyDeficit / KCAL_PER_KG;
  const rateWeek = profile.units === 'imperial' ? kgToLb(rate * 7) : rate * 7;

  // Weigh-in trend note: compare oldest vs newest weigh-in in range.
  let note = '';
  if (weighins.length >= 2) {
    const first = weighins[0];
    const last = weighins[weighins.length - 1];
    const actualDelta = toDisp(last.kg) - toDisp(first.kg);
    const daysBetween = Math.max(1, Math.round((new Date(last.date + 'T00:00:00') - new Date(first.date + 'T00:00:00')) / 86400000));
    const perWeek = (actualDelta / daysBetween) * 7;
    const sign = perWeek < 0 ? '−' : perWeek > 0 ? '+' : '';
    note = `<div>Based on ${weighins.length} weigh-ins: <b>${sign}${r(Math.abs(perWeek))} ${unit}/wk</b> across ${daysBetween} days.</div>`;
  } else if (weighins.length === 0) {
    note = `<div>No weigh-ins in this range. Click "+ Log weight" to track actual progress vs plan.</div>`;
  }

  const exNote = planExercise > 0
    ? `<div>Plan assumes <b>+${planExercise} kcal/day</b> burned through exercise.</div>`
    : '';

  const anchorLabel = weighins.length ? `Last weigh-in (${shortDate(anchor.date)})` : 'Current';

  return `
    <div class="stat-row">
      <div class="stat" title="Your most recent weigh-in (or current weight from Settings if none logged).">
        <div class="stat-label">${anchorLabel}</div>
        <div class="stat-val">${r(curDisp)} <small>${unit}</small></div>
      </div>
      <div class="stat" title="Weekly weight change implied by your daily deficit: (TDEE + planned exercise − calorie target) ÷ 7700 kcal/kg.">
        <div class="stat-label">Plan rate</div>
        <div class="stat-val">${rate === 0 ? 'maintain' : (rate > 0 ? '−' : '+') + r(Math.abs(rateWeek))} <small>${rate === 0 ? '' : unit + '/wk'}</small></div>
      </div>
      <div class="stat" title="Projected weight at the end of the selected range, following the plan.">
        <div class="stat-label">By ${shortDate(days[endIdx])}</div>
        <div class="stat-val">${r(planEnd)} <small>${unit}</small></div>
      </div>
      <div class="stat" title="Projected change from today to end of range.">
        <div class="stat-label">Net change</div>
        <div class="stat-val">${dir === 'maintain' ? '—' : (delta > 0 ? '+' : '') + r(delta)} <small>${dir === 'maintain' ? '' : unit}</small></div>
      </div>
    </div>
    ${(note || exNote) ? `<div class="stat-note">${exNote}${note}</div>` : ''}
  `;
}

function makeChartSVG(days, plan, weighins, todayIso, units, anchor) {
  const w = 780, h = 320;
  const pad = { top: 16, right: 16, bottom: 34, left: 52 };
  const plotW = w - pad.left - pad.right;
  const plotH = h - pad.top - pad.bottom;

  const toDisp = units === 'imperial' ? kgToLb : v => v;
  const planVals = plan.map(p => toDisp(p.kg));
  const weighVals = weighins.map(w => toDisp(w.kg));
  let yMin = Math.min(...planVals, ...weighVals);
  let yMax = Math.max(...planVals, ...weighVals);
  if (!Number.isFinite(yMin)) { yMin = toDisp(anchor.kg) - 1; yMax = toDisp(anchor.kg) + 1; }
  if (yMin === yMax) { yMin -= 1; yMax += 1; }
  const yPad = (yMax - yMin) * 0.15;
  yMin -= yPad; yMax += yPad;

  const firstDay = days[0];
  const daySpan = Math.max(1, Math.round((new Date(days[days.length - 1] + 'T00:00:00') - new Date(firstDay + 'T00:00:00')) / 86400000));

  const xForDate = iso => {
    const d = Math.round((new Date(iso + 'T00:00:00') - new Date(firstDay + 'T00:00:00')) / 86400000);
    return pad.left + (d / daySpan) * plotW;
  };
  const xForIdx = i => pad.left + (days.length <= 1 ? plotW / 2 : (i / (days.length - 1)) * plotW);
  const yFor = v => pad.top + (1 - (v - yMin) / (yMax - yMin)) * plotH;

  const planPts = plan.map((p, i) => `${xForIdx(i).toFixed(1)},${yFor(toDisp(p.kg)).toFixed(1)}`).join(' ');

  const weighPts = weighins
    .map(w => `${xForDate(w.date).toFixed(1)},${yFor(toDisp(w.kg)).toFixed(1)}`)
    .join(' ');
  const weighDots = weighins.map(w => {
    const x = xForDate(w.date).toFixed(1);
    const y = yFor(toDisp(w.kg)).toFixed(1);
    return `<circle class="c-weigh" cx="${x}" cy="${y}" r="4.5"><title>${w.date}: ${r(toDisp(w.kg))}</title></circle>`;
  }).join('');

  const todayIdx = days.indexOf(todayIso);
  const todayX = todayIdx >= 0 ? xForIdx(todayIdx).toFixed(1) : null;

  let grid = '';
  const nY = 5;
  for (let i = 0; i < nY; i++) {
    const frac = i / (nY - 1);
    const y = pad.top + frac * plotH;
    const v = yMax - frac * (yMax - yMin);
    grid += `<line class="c-grid" x1="${pad.left}" y1="${y.toFixed(1)}" x2="${w - pad.right}" y2="${y.toFixed(1)}"/>`;
    grid += `<text class="c-axis" x="${pad.left - 8}" y="${(y + 4).toFixed(1)}" text-anchor="end">${(Math.round(v * 10) / 10)}</text>`;
  }

  let xAxis = '';
  const nX = Math.min(8, days.length);
  for (let i = 0; i < nX; i++) {
    const idx = Math.round((i / (nX - 1)) * (days.length - 1));
    const x = xForIdx(idx);
    xAxis += `<text class="c-axis" x="${x.toFixed(1)}" y="${h - pad.bottom + 18}" text-anchor="middle">${shortDate(days[idx])}</text>`;
  }

  return `<svg class="chart" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
    ${grid}
    ${todayX ? `<line class="c-today" x1="${todayX}" y1="${pad.top}" x2="${todayX}" y2="${h - pad.bottom}"/>` : ''}
    <polyline class="c-plan" points="${planPts}"/>
    ${weighins.length >= 2 ? `<polyline class="c-actual" points="${weighPts}"/>` : ''}
    ${weighDots}
    ${xAxis}
  </svg>`;
}

// ------- SETTINGS -------
async function fillSettings() {
  await loadTargetsFromDb();
  const f = $('#settings-form');
  f.calories.value = state.targets.calories;
  f.protein.value  = state.targets.protein;
  f.carbs.value    = state.targets.carbs;
  f.fat.value      = state.targets.fat;
  $('#macro-preset').value = state.targets.preset || 'custom';
  await loadBody();
}

// ------- BODY (BMI / BMR / TDEE) -------
const DEFAULT_BODY = { units: 'imperial', weight_kg: 0, height_cm: 0, age: 0, sex: 'male', activity: 1.55 };

const lbToKg = lb => lb * 0.45359237;
const kgToLb = kg => kg / 0.45359237;
const inToCm = inches => inches * 2.54;
const cmToIn = cm => cm / 2.54;

function bmiCategory(bmi) {
  if (bmi < 18.5) return { label: 'Underweight', color: '#7dc3f0' };
  if (bmi < 25)   return { label: 'Normal',      color: '#7dd3a0' };
  if (bmi < 30)   return { label: 'Overweight',  color: '#f0c26a' };
  return            { label: 'High',             color: '#f06a6a' };
}

function setImperialFromMetric(f, kg, cm) {
  if (kg > 0) f.weight_lb.value = Math.round(kgToLb(kg) * 10) / 10;
  if (cm > 0) {
    const totalIn = cmToIn(cm);
    const ft = Math.floor(totalIn / 12);
    f.height_ft.value = ft;
    f.height_in.value = Math.round((totalIn - ft * 12) * 10) / 10;
  }
}
function setMetricFromImperial(f, lb, ft, inch) {
  if (lb > 0) f.weight_kg.value = Math.round(lbToKg(lb) * 10) / 10;
  const totalIn = (ft * 12) + inch;
  if (totalIn > 0) f.height_cm.value = Math.round(inToCm(totalIn));
}

function updateUnitFields(units) {
  $('#imperial-fields').classList.toggle('hidden', units !== 'imperial');
  $('#metric-fields').classList.toggle('hidden', units !== 'metric');
}

function readBodyForm() {
  const f = $('#body-form');
  const units = f.querySelector('input[name=units]:checked').value;
  let weight_kg, height_cm;
  if (units === 'metric') {
    weight_kg = Number(f.weight_kg.value) || 0;
    height_cm = Number(f.height_cm.value) || 0;
  } else {
    weight_kg = lbToKg(Number(f.weight_lb.value) || 0);
    const ft = Number(f.height_ft.value) || 0;
    const inch = Number(f.height_in.value) || 0;
    height_cm = inToCm(ft * 12 + inch);
  }
  return {
    units,
    weight_kg,
    height_cm,
    age: Number(f.age.value) || 0,
    sex: f.sex.value,
    activity: Number(f.activity.value) || 1.55
  };
}

async function loadBody() {
  const profile = { ...DEFAULT_BODY, ...(await CT.db.getSetting('body', {})) };
  const f = $('#body-form');
  $$('#units-toggle input').forEach(r => r.checked = r.value === profile.units);
  updateUnitFields(profile.units);
  if (profile.weight_kg > 0) {
    f.weight_kg.value = Math.round(profile.weight_kg * 10) / 10;
    f.weight_lb.value = Math.round(kgToLb(profile.weight_kg) * 10) / 10;
  } else {
    f.weight_kg.value = '';
    f.weight_lb.value = '';
  }
  if (profile.height_cm > 0) {
    f.height_cm.value = Math.round(profile.height_cm);
    const totalIn = cmToIn(profile.height_cm);
    const ft = Math.floor(totalIn / 12);
    f.height_ft.value = ft;
    f.height_in.value = Math.round((totalIn - ft * 12) * 10) / 10;
  } else {
    f.height_cm.value = '';
    f.height_ft.value = '';
    f.height_in.value = '';
  }
  f.age.value = profile.age || '';
  f.sex.value = profile.sex;
  f.activity.value = String(profile.activity);
  computeBody();
}

let _bodySaveTimer = null;
function computeBody() {
  const p = readBodyForm();
  clearTimeout(_bodySaveTimer);
  _bodySaveTimer = setTimeout(() => CT.db.setSetting('body', p), 300);

  const resultEl = $('#body-results');
  const actionsEl = $('#target-actions');

  if (!p.weight_kg || !p.height_cm || !p.age) {
    resultEl.innerHTML = `<div class="empty">Fill in weight, height, age, and sex.</div>`;
    actionsEl.classList.add('hidden');
    return;
  }

  const heightM = p.height_cm / 100;
  const bmi = p.weight_kg / (heightM * heightM);
  const bmr = p.sex === 'female'
    ? 10 * p.weight_kg + 6.25 * p.height_cm - 5 * p.age - 161
    : 10 * p.weight_kg + 6.25 * p.height_cm - 5 * p.age + 5;
  const tdee = bmr * p.activity;
  const cat = bmiCategory(bmi);

  resultEl.innerHTML = `
    <div class="result-card" title="Body Mass Index — weight / height². Screening measure; doesn't distinguish muscle from fat.">
      <div class="result-label">BMI</div>
      <div class="result-val">${r(bmi)}</div>
      <div class="result-sub" style="color:${cat.color}">${cat.label}</div>
    </div>
    <div class="result-card" title="Basal Metabolic Rate — calories your body burns at complete rest. Mifflin–St Jeor formula.">
      <div class="result-label">BMR</div>
      <div class="result-val">${Math.round(bmr)}</div>
      <div class="result-sub">kcal at rest</div>
    </div>
    <div class="result-card" title="Total Daily Energy Expenditure — BMR × activity multiplier. Calories to maintain current weight.">
      <div class="result-label">TDEE</div>
      <div class="result-val">${Math.round(tdee)}</div>
      <div class="result-sub">kcal maintenance</div>
    </div>
  `;
  actionsEl.classList.remove('hidden');
  actionsEl.dataset.tdee = String(Math.round(tdee));
}

function initBody() {
  $$('#units-toggle input').forEach(radio => {
    radio.addEventListener('change', () => {
      const f = $('#body-form');
      const units = radio.value;
      if (units === 'metric') {
        setMetricFromImperial(f,
          Number(f.weight_lb.value) || 0,
          Number(f.height_ft.value) || 0,
          Number(f.height_in.value) || 0);
      } else {
        setImperialFromMetric(f,
          Number(f.weight_kg.value) || 0,
          Number(f.height_cm.value) || 0);
      }
      updateUnitFields(units);
      computeBody();
    });
  });
  $('#body-form').addEventListener('input', computeBody);
  $('#body-form').addEventListener('change', computeBody);

  $$('#target-actions button').forEach(btn => {
    btn.addEventListener('click', async () => {
      const tdee = Number($('#target-actions').dataset.tdee) || 0;
      if (!tdee) return;
      let kcal = tdee;
      if (btn.dataset.target === 'deficit') kcal -= 500;
      if (btn.dataset.target === 'surplus') kcal += 300;
      kcal = Math.max(0, Math.round(kcal));
      state.targets.calories = kcal;
      $('#settings-form').calories.value = kcal;
      await CT.db.setSetting('targets', state.targets);
      state.targetsSaved = true;
      toast('Calorie target set to ' + kcal);
      renderDiary();
    });
  });
}

$('#btn-export').addEventListener('click', async () => {
  try {
    const payload = await CT.db.exportAll();
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    a.href = url;
    a.download = `crumbtracker-backup-${ts}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    toast('Exported.');
  } catch (e) {
    toast('Export failed: ' + (e.message || e), 5000);
  }
});

$('#btn-import').addEventListener('click', () => $('#import-file').click());

$('#import-file').addEventListener('change', async () => {
  const file = $('#import-file').files[0];
  $('#import-file').value = '';
  if (!file) return;
  if (!await confirmDialog({
    title: 'Import data?',
    body: `<b>${escapeHtml(file.name)}</b> will <b>replace</b> all current diary entries, custom foods, meals, and settings. Export your current data first if you want a backup.`,
    okLabel: 'Import (replace all)',
    destructive: true
  })) return;
  try {
    const text = await file.text();
    const payload = JSON.parse(text);
    await CT.db.importAll(payload);
    toast('Imported. Reloading...');
    setTimeout(() => location.reload(), 600);
  } catch (e) {
    toast('Import failed: ' + (e.message || e), 6000);
  }
});

$('#btn-wipe').addEventListener('click', async () => {
  if (!await confirmDialog({
    title: 'Wipe all data?',
    body: 'This will permanently erase all diary entries, custom foods, cached lookups, meals, weigh-ins, exercise, notes, and saved targets.',
    okLabel: 'Continue',
    destructive: true
  })) return;
  if (!await confirmDialog({
    title: 'Really wipe everything?',
    body: 'This cannot be undone. Consider exporting your data first.',
    okLabel: 'Wipe all data',
    destructive: true
  })) return;
  await CT.db.wipeAll();
  location.reload();
});

// Conventional macro splits by percentage of calories (protein / carbs / fat).
// Protein and carbs are 4 kcal/g; fat is 9 kcal/g.
const MACRO_PRESETS = {
  balanced:      { p: 25, c: 50, f: 25 },
  weight_loss:   { p: 40, c: 30, f: 30 },
  bulking:       { p: 30, c: 45, f: 25 },
  recomp:        { p: 35, c: 40, f: 25 },
  low_carb:      { p: 30, c: 20, f: 50 },
  keto:          { p: 20, c:  5, f: 75 },
  endurance:     { p: 20, c: 55, f: 25 },
  high_protein:  { p: 40, c: 35, f: 25 }
};

function applyMacroPreset(presetKey) {
  const p = MACRO_PRESETS[presetKey];
  const f = $('#settings-form');
  const kcal = Number(f.calories.value) || 0;
  if (!p || kcal <= 0) return;
  f.protein.value = Math.round(kcal * p.p / 100 / 4);
  f.carbs.value   = Math.round(kcal * p.c / 100 / 4);
  f.fat.value     = Math.round(kcal * p.f / 100 / 9);
}

$('#macro-preset').addEventListener('change', (e) => {
  if (e.target.value !== 'custom') applyMacroPreset(e.target.value);
});

// If the user recalculates calories with a preset active, re-apply it.
$('#settings-form').calories.addEventListener('input', () => {
  const sel = $('#macro-preset').value;
  if (sel !== 'custom') applyMacroPreset(sel);
});

// Manually touching any macro flips the dropdown to Custom.
['protein', 'carbs', 'fat'].forEach(name => {
  $('#settings-form')[name].addEventListener('input', () => {
    $('#macro-preset').value = 'custom';
  });
});

$('#settings-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  state.targets = {
    calories: Number(fd.get('calories')) || 0,
    protein:  Number(fd.get('protein'))  || 0,
    carbs:    Number(fd.get('carbs'))    || 0,
    fat:      Number(fd.get('fat'))      || 0,
    preset:   fd.get('macro_preset') || 'custom'
  };
  await CT.db.setSetting('targets', state.targets);
  state.targetsSaved = true;
  toast('Targets saved');
  renderDiary();
});

// ------- IMAGE HELPERS -------
function dataUrlToBlob(dataUrl) {
  const i = dataUrl.indexOf(',');
  const header = dataUrl.slice(5, i);
  const mime = (header.split(';')[0]) || 'image/png';
  const bin = atob(dataUrl.slice(i + 1));
  const bytes = new Uint8Array(bin.length);
  for (let k = 0; k < bin.length; k++) bytes[k] = bin.charCodeAt(k);
  return new Blob([bytes], { type: mime });
}

async function fileToDataUrl(blob, maxDim = 400) {
  const url = URL.createObjectURL(blob);
  const img = new Image();
  img.src = url;
  try {
    await new Promise((resolve, reject) => { img.onload = resolve; img.onerror = reject; });
    const scale = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    canvas.getContext('2d').drawImage(img, 0, 0, w, h);
    return canvas.toDataURL('image/jpeg', 0.82);
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function clipboardImageToDataUrl(maxDim = 400) {
  if (window.ct && window.ct.clipboardReadImage) {
    try {
      const result = await window.ct.clipboardReadImage();
      const dataUrl = result && (result.dataUrl || (typeof result === 'string' ? result : null));
      console.log('[paste] native result:', result && result.debug ? result.debug : { rawType: typeof result, hasData: !!dataUrl });
      if (dataUrl) {
        const blob = dataUrlToBlob(dataUrl);
        return await fileToDataUrl(blob, maxDim);
      }
    } catch (e) {
      console.warn('Electron clipboard read failed:', e);
    }
  }
  if (!navigator.clipboard || !navigator.clipboard.read) return null;
  try {
    const items = await navigator.clipboard.read();
    for (const item of items) {
      for (const type of item.types) {
        if (type.startsWith('image/')) {
          const blob = await item.getType(type);
          return await fileToDataUrl(blob, maxDim);
        }
      }
    }
  } catch (e) {
    console.warn('Clipboard read failed:', e);
  }
  return null;
}

function wireImageDropZone(el, onDataUrl) {
  el.addEventListener('dragover', (e) => { e.preventDefault(); el.classList.add('drop-active'); });
  el.addEventListener('dragleave', () => el.classList.remove('drop-active'));
  el.addEventListener('drop', async (e) => {
    e.preventDefault();
    el.classList.remove('drop-active');
    const file = e.dataTransfer.files && e.dataTransfer.files[0];
    if (!file) return;
    try {
      const url = await fileToDataUrl(file);
      onDataUrl(url);
    } catch (err) { console.error(err); }
  });
}

// ------- BOOT -------
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

$$('#range-toggle button').forEach(btn => {
  btn.addEventListener('click', () => {
    $$('#range-toggle button').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    state.progressRange = Number(btn.dataset.range) || 30;
    renderProgress();
  });
});

let _planExTimer = null;
$('#plan-exercise').addEventListener('input', () => {
  const val = Math.max(0, Number($('#plan-exercise').value) || 0);
  clearTimeout(_planExTimer);
  _planExTimer = setTimeout(async () => {
    await CT.db.setSetting('plan_exercise', val);
    renderProgress();
  }, 250);
});

async function loadTargetsFromDb() {
  const saved = await CT.db.getSetting('targets', null);
  state.targets = { ...DEFAULT_TARGETS, ...(saved || {}) };
  state.targetsSaved = !!saved;
}

(async function init() {
  await loadTargetsFromDb();
  initBody();
  await renderDiary();
})();
