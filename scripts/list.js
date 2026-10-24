"use strict";

/* ============ Просмотрено ============ */
// Фильм может быть в одном из трёх состояний: ничего / «К просмотру» (liked) / «Просмотрено» (watched).
// Просмотренный фильм не показывается в колоде и живёт в отдельном списке.
function markWatched(m) {
  if (!m || isWatched(m.id)) return;
  const id = m.id;
  const likedIdx = state.liked.findIndex(x => x.id === id);
  const prev = likedIdx >= 0 ? state.liked.splice(likedIdx, 1)[0] : null;
  const entry = Object.assign(prev || snap(m), { watchedAt: Date.now() });
  if (!entry.runtime && m.runtime) entry.runtime = m.runtime;
  state.watched.unshift(entry);
  passed.delete(id);
  const wasInDeck = deck.some(d => d.id === id);
  deck = deck.filter(d => d.id !== id);
  history_ = history_.filter(h => h.movie.id !== id);
  if (!entry.runtime) loadRuntime(id);
  save();
  haptic();
  renderAll();
  showToast({
    sub: "Отмечено просмотренным", title: entry.title,
    undo: () => {
      const i = state.watched.findIndex(x => x.id === id);
      if (i >= 0) state.watched.splice(i, 1);
      delete entry.watchedAt;
      if (prev) state.liked.splice(Math.min(likedIdx, state.liked.length), 0, prev);
      else if (wasInDeck) deck.unshift(m);
      save();
      renderAll();
    },
  });
}

function unmarkWatched(id) {
  const i = state.watched.findIndex(x => x.id === id);
  if (i < 0) return;
  const entry = state.watched.splice(i, 1)[0];
  const copy = Object.assign({}, entry);
  delete copy.watchedAt;
  state.liked.push(copy);
  passed.delete(id);
  save();
  haptic();
  renderAll();
  showToast({
    sub: "Вернули в «Мой вечер»", title: entry.title,
    undo: () => {
      const j = state.liked.findIndex(x => x.id === id);
      if (j >= 0) state.liked.splice(j, 1);
      state.watched.splice(Math.min(i, state.watched.length), 0, entry);
      save();
      renderAll();
    },
  });
}

function deleteLiked(id) {
  const idx = state.liked.findIndex(x => x.id === id);
  if (idx < 0) return;
  const removed = state.liked.splice(idx, 1)[0];
  save();
  refreshList();
  showToast({
    sub: "Удалено из вечера", title: removed.title,
    undo: () => { state.liked.splice(Math.min(idx, state.liked.length), 0, removed); save(); refreshList(); },
  });
}

function deleteWatched(id) {
  const idx = state.watched.findIndex(x => x.id === id);
  if (idx < 0) return;
  const removed = state.watched.splice(idx, 1)[0];
  save();
  refreshList();
  showToast({
    sub: "Удалено из просмотренных", title: removed.title,
    undo: () => { state.watched.splice(Math.min(idx, state.watched.length), 0, removed); save(); refreshList(); },
  });
}

// dir < 0 — смахнули влево (удалить), dir > 0 — вправо (просмотрено / вернуть в вечер)
function commitRow(dir, id) {
  if (listMode === "queue") {
    if (dir < 0) deleteLiked(id);
    else markWatched(state.liked.find(x => x.id === id));
  } else {
    if (dir < 0) deleteWatched(id);
    else unmarkWatched(id);
  }
}

/* Пользователь нажал «Смотреть» → при возвращении в приложение предлагаем отметить фильм просмотренным */
function rememberPending(id) {
  const m = findMovie(id) || sheetMovie;
  if (m && m.id === id && !isWatched(id)) ls.set(PENDING_KEY, JSON.stringify(snap(m)));
}
function checkPending() {
  let p = null;
  try { p = JSON.parse(ls.get(PENDING_KEY) || "null"); } catch (e) {}
  if (!p || !p.id) return;
  ls.set(PENDING_KEY, "");
  if (isWatched(p.id)) return;
  showToast({
    sub: "Посмотрели фильм?", title: p.title, ms: 8000, actionLabel: "Просмотрено",
    undo: () => markWatched(findMovie(p.id) || p),
  });
}
document.addEventListener("visibilitychange", () => { if (!document.hidden) setTimeout(checkPending, 600); });

/* ============ Кнопка «Смотреть» ============ */
function watchButton(m, cls) {
  const url = state.urls[m.id];
  if (url && validUrl(url)) return `<a class="btn ${cls}" data-watch="${m.id}" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${ICON_PLAY}Смотреть</a>`;
  return `<button class="btn ${cls}" data-add-src="${m.id}">${ICON_PLAY}Смотреть</button>`;
}

/* ============ Список «Мой вечер» ============ */
let categoryOrder = [];

function rowHtml(m, i, watchedMode) {
  const meta = [m.year, dur(m.runtime), `★ ${(m.rating || 0).toFixed(1)}`].filter(Boolean).join(" · ");
  const date = watchedMode && m.watchedAt ? `<div class="row-date">Просмотрено ${esc(fmtDate(m.watchedAt))}</div>` : "";
  return `<div class="row-container" data-id="${m.id}" style="--i:${Math.min(i, 8)}">
    <div class="row-watch-bg" aria-hidden="true"><span>${watchedMode ? "В вечер" : "Просмотрено"}</span></div>
    <div class="row-delete-bg" aria-hidden="true"><span>Удалить</span></div>
    <div class="row">
      <div class="thumb">${posterHtml(m.poster, "w185", m.title)}</div>
      <div class="row-main">
        <div class="row-title">${esc(m.title)}</div>
        <div class="row-meta">${meta}</div>
        ${date}
      </div>
    </div>
  </div>`;
}

function renderList() {
  const list = $("#list");
  const watchedMode = listMode === "watched";
  const items = watchedMode ? state.watched : state.liked;

  if (!items.length) {
    if (!watchedMode) categoryOrder = [];
    list.innerHTML = watchedMode
      ? `<div class="empty" style="position:static;flex:1">
          <svg class="glyph" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M8 12.5l3 3 5-6"/></svg>
          <h2>Пока ничего не просмотрено</h2><p>Смахните фильм вправо в списке «К просмотру» или нажмите «Отметить просмотренным» в карточке фильма.</p></div>`
      : `<div class="empty" style="position:static;flex:1">
          <svg class="glyph" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s-7.5-4.6-9.6-9.2C.9 8.4 2.6 4.5 6.4 4.5c2.2 0 3.6 1.2 4.6 2.7h2c1-1.5 2.4-2.7 4.6-2.7 3.8 0 5.5 3.9 4 7.3C19.5 16.4 12 21 12 21z"/></svg>
          <h2>Вечер пока пуст</h2><p>Свайпайте вправо фильмы, которые хочется посмотреть. Они появятся здесь.</p></div>`;
    return;
  }

  const known = items.filter(m => m.runtime);
  const total = known.reduce((s, m) => s + m.runtime, 0);
  const totalText = known.length
    ? (watchedMode ? `Всего ${known.length < items.length ? "около " : ""}${dur(total)} кино` : `Всего ${known.length < items.length ? "около " : ""}${dur(total)} без перерывов`)
    : "Считаю длительность…";

  const scroll = list.scrollTop;
  let html = `<div class="summary" style="--i:0"><b>${items.length} ${plural(items.length)}</b><span>${totalText}</span></div>`;
if (!watchedMode && items.length >= 2) html += wheelCtaHtml(items, 1);
  let idx = 2;

  if (watchedMode) {
    html += `<div class="category-section">`;
    for (const m of items) html += rowHtml(m, idx++, true);
    html += `</div>`;
  } else {
    const groups = {};
    items.forEach(m => {
      const cat = (m.category = categoryOf(m));
      (groups[cat] = groups[cat] || []).push(m);
    });
    const current = Object.keys(groups);
    categoryOrder = categoryOrder.filter(c => current.includes(c));
    current.forEach(c => { if (!categoryOrder.includes(c)) categoryOrder.push(c); });
    for (const cat of categoryOrder) {
      html += `<div class="category-section" data-category="${esc(cat)}"><div class="list-category-title">${esc(cat)}</div>`;
      for (const m of groups[cat]) html += rowHtml(m, idx++, false);
      html += `</div>`;
    }
  }

  list.innerHTML = html;
  list.scrollTop = scroll;
  bindRowSwipe();
}

function setListMode(mode) {
  if (mode === listMode) return;
  listMode = mode;
  $("#seg-queue").setAttribute("aria-selected", mode === "queue");
  $("#seg-watched").setAttribute("aria-selected", mode === "watched");
  const l = $("#list");
  renderList();
  l.scrollTop = 0;
  l.classList.remove("enter"); void l.offsetWidth; l.classList.add("enter");
  setTimeout(() => l.classList.remove("enter"), 1200);
}

/* Плавное удаление / перенос: строка уезжает с места пальца до конца,
   потом блок схлопывается по высоте, и только после этого обновляются данные. */
// Ширина плашки = открытая часть под сдвинутой строкой (dx > 0 — «Просмотрено», dx < 0 — «Удалить»)
function setPlates(container, dx) {
  const w = container.querySelector(".row-watch-bg"), d = container.querySelector(".row-delete-bg");
  if (w) w.style.width = dx > 0 ? dx + "px" : "0px";
  if (d) d.style.width = dx < 0 ? -dx + "px" : "0px";
}

async function removeRow(row, container, section, fromX, dir, commit) {
  if (container.classList.contains("gone")) return;
  haptic();
  container.classList.remove("dragging");
  container.classList.add("gone");
  void container.offsetWidth;
  setPlates(container, dir * container.offsetWidth); // плашка плавно растёт вслед за уезжающей строкой

  const siblings = section ? section.querySelectorAll(".row-container:not(.gone)").length : 1;
  const target = section && siblings === 0 ? section : container;

  if (!RM() && row.animate) {
    const w = row.offsetWidth || innerWidth;
    row.style.transition = "none";
    const remaining = Math.max(0, w - dir * fromX) / w;
    const slide = row.animate(
      [{ transform: `translateX(${fromX}px)`, opacity: 1 }, { transform: `translateX(${dir * w}px)`, opacity: 0 }],
      { duration: 200 + remaining * 160, easing: "cubic-bezier(.3,.6,.35,1)", fill: "forwards" }
    );
    try { await slide.finished; } catch (e) {}

    const h = target.offsetHeight;
    target.style.overflow = "hidden";
    const collapse = target.animate(
      [{ height: h + "px", opacity: 1, marginTop: "0px" }, { height: "0px", opacity: 0, marginTop: "-8px" }],
      { duration: 380, easing: EASE, fill: "forwards" }
    );
    try { await collapse.finished; } catch (e) {}
  }
  commit();
}

function bindRowSwipe() {
  document.querySelectorAll("#list .row").forEach(row => {
    let startX = 0, startY = 0, dx = 0, dragging = false, locked = false, moved = false;
    const container = row.closest(".row-container");
    const section = row.closest(".category-section");
    const id = +container.dataset.id;
    const clearDir = () => { container.classList.remove("dragging"); setPlates(container, 0); };

    row.addEventListener("pointerdown", e => {
      cancelRowHint(row);
      if (container.classList.contains("gone")) return;
      if (e.pointerType === "mouse" && e.button !== 0) return;
      startX = e.clientX; startY = e.clientY; dx = 0;
      dragging = true; locked = false; moved = false;
      row.style.transition = "none";
      try { row.setPointerCapture(e.pointerId); } catch (err) {}
    });

    row.addEventListener("pointermove", e => {
      if (!dragging) return;
      dx = e.clientX - startX;
      const dy = e.clientY - startY;
      if (Math.abs(dx) > 4 || Math.abs(dy) > 4) moved = true;

      if (!locked) {
        if (Math.abs(dy) > Math.abs(dx) + 2) {
          dragging = false;
          clearDir();
          row.style.transition = "";
          row.style.transform = "";
          return;
        }
        if (Math.abs(dx) > 6) { locked = true; container.classList.add("dragging"); }
      }
      if (locked) {
        row.style.transform = `translateX(${dx}px)`;
        setPlates(container, dx);
      }
    });

    const finish = () => {
      if (!dragging && !locked) { clearDir(); row.style.transition = ""; return; }
      dragging = false;

      if (locked && Math.abs(dx) > 70) {
        const from = dx, dir = dx < 0 ? -1 : 1;
        locked = false; dx = 0;
        removeRow(row, container, section, from, dir, () => commitRow(dir, id));
        return;
      }

      row.style.transition = "";
      row.style.transform = "";
      clearDir();
      if (!moved) { const m = findMovie(id); if (m) openSheet(m); }
      locked = false; dx = 0;
    };
    row.addEventListener("pointerup", finish);
    row.addEventListener("pointercancel", finish);
  });
}

function findMovie(id) {
  return deck.find(m => m.id === id)
    || state.liked.find(m => m.id === id)
    || state.watched.find(m => m.id === id)
    || history_.map(h => h.movie).find(m => m.id === id)
    || (sheetMovie && sheetMovie.related && sheetMovie.related.find(m => m.id === id));
}
