"use strict";

/* ============ Шторка фильма ============ */
function mediaHtml(m) {
  const back = TMDB.img(m.backdrop, "w780") || TMDB.img(m.poster, "w780");
  return `${back ? `<img src="${back}" alt="">` : ""}<div class="spinner"></div>`;
}
function playerHtml(key) {
  const mute = IS_IOS ? "&mute=1" : "";
  return `<iframe src="https://www.youtube-nocookie.com/embed/${key}?autoplay=1&rel=0&playsinline=1${mute}" title="Трейлер"
    allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe>`;
}
function showTrailer(key) {
  const mm = $("#sheet-media");
  if (!mm) return;
  if (TRAILER_AUTOPLAY) { mm.innerHTML = playerHtml(key); return; }
  const sp = mm.querySelector(".spinner"); if (sp) sp.remove();
  mm.insertAdjacentHTML("beforeend", `<button class="play-btn" data-play="${esc(key)}" aria-label="Смотреть трейлер">${ICON_PLAY}</button>`);
}

const toggleLabel = m => isLiked(m.id) ? "Убрать из вечера" : isWatched(m.id) ? "Убрать из просмотренных" : "В мой вечер";
const watchedInner = m => isWatched(m.id) ? `${ICON_CHECK}Просмотрено · вернуть в вечер` : `${ICON_CHECK}Отметить просмотренным`;

// Нижняя панель действий — внизу экрана, в зоне большого пальца
function actionsHtml(m) {
  const mid = sheetFromWheel
    ? `<button class="btn" data-respin>${ICON_DICE}Крутить ещё</button>`
    : `<button class="btn" data-toggle="${m.id}"><span class="btn-label fade-in">${toggleLabel(m)}</span></button>`;
  return `<button class="btn icon" data-close aria-label="Закрыть">${ICON_CLOSE}</button>
    ${watchButton(m, "primary")}${mid}`;
}

// Обновляет кнопки открытой шторки после любого изменения списков
function syncSheetButtons() {
  if (!sheetMovie) return;
  const label = document.querySelector("#sheet-actions [data-toggle] .btn-label");
  if (label) label.textContent = toggleLabel(sheetMovie);
  const w = $("#sheet-watched");
  if (w) { w.innerHTML = watchedInner(sheetMovie); w.classList.toggle("on", isWatched(sheetMovie.id)); }
}

function openSheet(m, focusSrc) {
  hideToast();
  killPlayer(); // если открываем «похожий фильм» поверх другой шторки
  const o = $("#overlay");
  clearTimeout(sheetTimer);
  sheetMovie = Object.assign({}, m);
  const id = m.id;
  const url = state.urls[id] || "";

  sheetFromWheel = wheelNext; wheelNext = false;
  o.classList.remove("closing");
  o.style.opacity = "";
  o.innerHTML = `<div class="sheet movie-sheet" role="dialog" aria-modal="true" aria-label="${esc(m.title)}" id="sheet-element">
    <div class="sheet-media" id="sheet-media">${mediaHtml(m)}</div>
    <button class="close" data-close aria-label="Закрыть"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg></button>
    <div class="sheet-body">
      <div class="sheet-title"><h2>${esc(m.title)}</h2><div class="o" id="sheet-sub"></div></div>
      <div class="tags" id="sheet-tags"></div>
      <p id="sheet-overview"></p>
      <dl class="facts" id="sheet-facts"></dl>
      <button class="btn watched-btn ${isWatched(id) ? "on" : ""}" id="sheet-watched" data-watched>${watchedInner(m)}</button>
      <div class="src">
        <label for="src-input">Ссылка на ваш файл с фильмом</label>
        <div class="src-row"><input id="src-input" type="url" inputmode="url" autocapitalize="off" autocorrect="off" placeholder="https://… (ваш сервер или Google Drive)" value="${esc(url)}"><button class="btn" id="src-save">Сохранить</button></div>
        <small id="src-note">${url ? "Ссылка сохранена. Кнопка «Смотреть» откроет её в новой вкладке." : "Вставьте ссылку один раз, дальше «Смотреть» будет открывать фильм сразу."}</small>
      </div>
      <div class="related-section" id="related-section"></div>
      <div class="sheet-actions" id="sheet-actions">${actionsHtml(m)}</div>
    </div></div>`;
  o.hidden = false;
  pushLayer();
  fillSheetInfo(sheetMovie);
  if (focusSrc) {
    $("#src-input").focus();
    $("#src-note").textContent = "Сначала добавьте ссылку на этот фильм, потом «Смотреть» заработает.";
  }
  bindSheetDrag($("#sheet-element"), o);

  TMDB.details(id).then(d => {
    if (!sheetMovie || sheetMovie.id !== id) return;
    sheetMovie = Object.assign(sheetMovie, d);
    fillSheetInfo(sheetMovie);

    const stored = findStored(id);
    if (stored && (!stored.runtime || !stored.genres.length)) {
      if (d.runtime) stored.runtime = d.runtime;
      if (d.genres.length) stored.genres = d.genres;
      save(); refreshList();
    }

    const media = $("#sheet-media");
    if (media) {
      if (d.trailerKey) setTimeout(() => {
        if (!sheetMovie || sheetMovie.id !== id) return;
        showTrailer(d.trailerKey);
      }, 450);
      else {
        const sp = media.querySelector(".spinner"); if (sp) sp.remove();
        media.insertAdjacentHTML("beforeend", `<div class="no-trailer"><span>Трейлер не найден</span><a class="btn" href="${youtubeSearch(sheetMovie)}" target="_blank" rel="noopener noreferrer">Искать на YouTube</a></div>`);
      }
    }
    renderRelated(d.related);
  }).catch(() => {
    if (!sheetMovie || sheetMovie.id !== id) return;
    const media = $("#sheet-media");
    if (media) {
      const sp = media.querySelector(".spinner"); if (sp) sp.remove();
      media.insertAdjacentHTML("beforeend", `<div class="no-trailer"><span>Не удалось загрузить трейлер</span><a class="btn" href="${youtubeSearch(sheetMovie)}" target="_blank" rel="noopener noreferrer">YouTube</a></div>`);
    }
  });
}

function fillSheetInfo(m) {
  $("#sheet-sub").textContent = [m.orig && m.orig !== m.title ? m.orig : "", m.year, dur(m.runtime)].filter(Boolean).join(" · ");
  $("#sheet-tags").innerHTML = (m.genres || []).map(x => `<span class="tag">${esc(x)}</span>`).join("");
  $("#sheet-overview").textContent = m.overview || (m.runtime ? "У этого фильма пока нет описания на выбранном языке." : "");
  const facts = [["Рейтинг", m.rating ? `★ ${m.rating.toFixed(1)}` : ""], ["Режиссёр", m.director], ["В ролях", (m.cast || []).join(", ")]].filter(f => f[1]);
  $("#sheet-facts").innerHTML = facts.map(f => `<dt>${f[0]}</dt><dd>${esc(f[1])}</dd>`).join("");
}

function renderRelated(related) {
  const sec = $("#related-section");
  if (!sec || !related || !related.length) return;
  sec.innerHTML = `<div class="related-title">Похожие фильмы</div>
    <div class="related-scroll">${related.slice(0, 8).map(r => `
      <div class="related-card" data-related-id="${r.id}">
        <div class="related-poster">${r.poster ? `<img src="${TMDB.img(r.poster, "w185")}" alt="${esc(r.title)}" loading="lazy" decoding="async">` : ""}</div>
        <div class="related-name">${esc(r.title)}</div>
      </div>`).join("")}</div>`;
  anim(sec, FX_IN);
}

function saveSrc() {
  if (!sheetMovie) return;
  const id = sheetMovie.id;
  const v = $("#src-input").value.trim();
  if (v && !validUrl(v)) { $("#src-note").textContent = "Ссылка должна начинаться с http:// или https://"; return; }
  if (v) state.urls[id] = v; else delete state.urls[id];
  save();
  $("#sheet-actions").innerHTML = actionsHtml(sheetMovie);
  $("#src-note").textContent = v ? "Ссылка сохранена. Кнопка «Смотреть» откроет её в новой вкладке." : "Ссылка удалена.";
}

let toggling = false;
function toggleLike(m) {
  if (!m || toggling) return;
  toggling = true;
  const wasLiked = isLiked(m.id);
  const wasWatched = isWatched(m.id);
  const btn = document.querySelector("#sheet-actions [data-toggle]");
  const label = btn ? btn.querySelector(".btn-label") : null;
  const removing = wasLiked || wasWatched;

  if (btn) {
    btn.classList.remove("pop-stroke-red", "pop-stroke-green");
    void btn.offsetWidth;
    btn.classList.add(removing ? "pop-stroke-red" : "pop-stroke-green");
    burst(btn, removing ? "var(--nope)" : "var(--user-accent)", 10);
    haptic();
    if (label) { label.classList.remove("fade-in"); label.classList.add("fade-out"); }
  }

  setTimeout(() => {
    if (wasLiked) {
      state.liked = state.liked.filter(x => x.id !== m.id);
    } else if (wasWatched) {
      state.watched = state.watched.filter(x => x.id !== m.id);
    } else {
      state.liked.push(snap(m));
      passed.delete(m.id);
      deck = deck.filter(d => d.id !== m.id);
      if (!m.runtime) loadRuntime(m.id);
    }
    save();
    renderAll();
    if (sheetMovie && sheetMovie.id === m.id) {
      if (label && label.isConnected) {
        label.textContent = toggleLabel(m);
        label.classList.remove("fade-out");
        label.classList.add("fade-in");
      } else $("#sheet-actions").innerHTML = actionsHtml(sheetMovie);
    }
    toggling = false;
  }, 200);
}

/* ============ Фильтры ============ */
function updateFilterBadge() {
  const b = $("#filter-count");
  b.textContent = state.multiGenres.length;
  b.hidden = !state.multiGenres.length;
}

function openFiltersModal() {
  const sel = new Set(state.multiGenres.map(String));
  $("#filter-grid").innerHTML = genres.map(g => `
    <label class="filter-item">
      <input type="checkbox" value="${g.id}" ${sel.has(String(g.id)) ? "checked" : ""}>
      <span>${esc(g.name)}</span>
    </label>`).join("");
  const o = $("#filters-overlay");
  clearTimeout(filtersTimer);
  o.classList.remove("closing");
  o.style.opacity = "";
  $("#filters-sheet-element").classList.remove("dismissing");
  o.hidden = false;
  pushLayer();
  bindFilterDragOnce();
}

let filterDragBound = false;
function bindFilterDragOnce() {
  if (filterDragBound) return;
  filterDragBound = true;
  bindSheetDrag($("#filters-sheet-element"), $("#filters-overlay"));
}

function applyFiltersModal() {
  state.multiGenres = [...$("#filter-grid").querySelectorAll("input:checked")]
    .map(i => (i.value === "anime" || isNaN(i.value) ? i.value : +i.value));
  save();
  updateFilterBadge();
  closeLayer();
  deck = []; history_ = []; paging = newPaging();
  refill("filter");
}
