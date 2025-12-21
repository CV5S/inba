/* timetable.js
 * - Loose parsing, duration invalid -> 0
 * - Integer minutes only
 * - Day wrap normalized with (+N)
 * - Sortable (drag reorder)
 * - PNG export via html-to-image
 * - Theme: background / border / text (applied to #exportArea via CSS variables)
 */

(function () {
  // ---------- time helpers ----------
  function parseHHMMLoose(hhmm, fallback = 0) {
    const s = String(hhmm ?? "").trim();
    const m = s.match(/^(\d{1,2}):(\d{1,2})$/);
    if (!m) return fallback;
    const hh = Number(m[1]);
    const mm = Number(m[2]);
    if (!Number.isFinite(hh) || !Number.isFinite(mm)) return fallback;
    if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return fallback;
    return Math.floor(hh) * 60 + Math.floor(mm);
  }

  function minutesToHHMM(minsAbs) {
    const dayOffset = Math.floor(minsAbs / 1440);
    const mod = ((minsAbs % 1440) + 1440) % 1440;
    const hh = Math.floor(mod / 60);
    const mm = mod % 60;
    return { hhmm: `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`, dayOffset };
  }

  function durationToIntMinLoose(x) {
    const s = String(x ?? "").trim();
    if (!s) return 0;
    const n = Number(s);
    if (!Number.isFinite(n)) return 0;
    if (!Number.isInteger(n)) return 0; // 分単位のみ
    if (n < 0) return 0;
    return n;
  }

  function buildTimetable(startHHMM, events) {
    const startMin = parseHHMMLoose(startHHMM, 0);
    let cursorAbs = startMin;
    const rows = [];

    for (const ev of events) {
      const name = String(ev?.name ?? "").trim() || "(no title)";
      const d = durationToIntMinLoose(ev?.durationMin);

      const startAbs = cursorAbs;
      const endAbs = cursorAbs + d;

      const s = minutesToHHMM(startAbs);
      const e = minutesToHHMM(endAbs);

      const suffix = e.dayOffset > s.dayOffset ? `(+${e.dayOffset - s.dayOffset})` : "";
      rows.push({
        name,
        range: `${s.hhmm}~${e.hhmm}${suffix}`,
      });

      cursorAbs = endAbs;
    }
    return rows;
  }

  // ---------- DOM ----------
  const el = {
    startTime: document.getElementById("startTime"),
    btnAdd: document.getElementById("btnAdd"),
    eventList: document.getElementById("eventList"),
    outBody: document.getElementById("outBody"),
    status: document.getElementById("status"),
    btnExportPng: document.getElementById("btnExportPng"),
    exportArea: document.getElementById("exportArea"),

    themeBg: document.getElementById("themeBg"),
    themeBorder: document.getElementById("themeBorder"),
    themeText: document.getElementById("themeText"),
  }; 

  function setStatus(msg) {
    el.status.textContent = msg || "";
  }

  function hexToRgb(hex) {
    const s = String(hex || "#000000").replace("#", "");
    const full = s.length === 3 ? s.split("").map(c => c + c).join("") : s;
    const n = parseInt(full, 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }

  function rgbToHex(r, g, b) {
    return "#" + [r, g, b].map(n => (n & 255).toString(16).padStart(2, "0")).join("");
  }

  function mixHex(bgHex, textHex, bgRatio = 0.85) {
    const bg = hexToRgb(bgHex);
    const tx = hexToRgb(textHex);
    const r = Math.round(bg.r * bgRatio + tx.r * (1 - bgRatio));
    const g = Math.round(bg.g * bgRatio + tx.g * (1 - bgRatio));
    const b = Math.round(bg.b * bgRatio + tx.b * (1 - bgRatio));
    return rgbToHex(r, g, b);
  }

  function applyTheme() {
    // exportAreaにだけテーマを適用（PNGにも反映）
    el.exportArea.style.setProperty("--tt-bg", el.themeBg.value);
    el.exportArea.style.setProperty("--tt-border", el.themeBorder.value);
    el.exportArea.style.setProperty("--tt-text", el.themeText.value);

    // table header color: mix(bg 85%, text 15%) — computed in JS to avoid color-mix() rendering mismatch when exporting PNG
    const head = mixHex(el.themeBg.value, el.themeText.value, 0.85);
    el.exportArea.style.setProperty("--tt-head", head);
  }

  function currentEventsFromUI() {
    const items = Array.from(el.eventList.querySelectorAll("li.eventItem"));
    return items.map(li => {
      const name = li.querySelector('input[data-k="name"]').value;
      const durationMin = li.querySelector('input[data-k="dur"]').value;
      return { name, durationMin: durationToIntMinLoose(durationMin) };
    });
  }

  function renderEventList(events) {
    el.eventList.innerHTML = "";
    for (const ev of events) {
      el.eventList.appendChild(makeEventItem(ev));
    }
  }

  function makeEventItem(ev) {
    const li = document.createElement("li");
    li.className = "eventItem";

    const drag = document.createElement("div");
    drag.className = "dragHandle";
    drag.textContent = "≡";
    li.appendChild(drag);

    const name = document.createElement("input");
    name.type = "text";
    name.value = String(ev?.name ?? "");
    name.placeholder = "イベント名";
    name.dataset.k = "name";
    li.appendChild(name);

    const durWrap = document.createElement("div");
    durWrap.className = "durWrap";
    const dur = document.createElement("input");
    dur.type = "number";
    dur.step = "1";
    dur.min = "0";
    dur.value = String(durationToIntMinLoose(ev?.durationMin));
    dur.placeholder = "分";
    dur.dataset.k = "dur";
    durWrap.appendChild(dur);
    li.appendChild(durWrap);

    const delWrap = document.createElement("div");
    delWrap.className = "delWrap";
    const del = document.createElement("button");
    del.className = "danger";
    del.textContent = "削除";
    del.addEventListener("click", () => {
      li.remove();
      recalcAndRender();
    });
    delWrap.appendChild(del);
    li.appendChild(delWrap);

    // any change triggers recalc
    li.addEventListener("input", () => recalcAndRender());
    return li;
  }

  function recalcAndRender() {
    const start = el.startTime.value || "00:00";
    const events = currentEventsFromUI();
    const rows = buildTimetable(start, events);

    el.outBody.innerHTML = "";
    for (const r of rows) {
      const tr = document.createElement("tr");

      const tdTime = document.createElement("td");
      tdTime.className = "timeCol";
      tdTime.textContent = r.range;

      const tdName = document.createElement("td");
      tdName.className = "nameCol";
      tdName.appendChild(document.createTextNode(r.name));

      tr.appendChild(tdTime);
      tr.appendChild(tdName);
      el.outBody.appendChild(tr);
    }
    setStatus("");
  }

  // ---------- events ----------
  el.btnAdd.addEventListener("click", () => {
    el.eventList.appendChild(makeEventItem({ name: "シーン", durationMin: 30 }));
    recalcAndRender();
  });

  el.startTime.addEventListener("input", () => recalcAndRender());

  el.themeBg.addEventListener("input", applyTheme);
  el.themeBorder.addEventListener("input", applyTheme);
  el.themeText.addEventListener("input", applyTheme);

  // Custom time-picker button: open native picker if possible
  (function setupTimePickerButton(){
    const start = el.startTime;
    const btn = document.querySelector('.timePickerBtn');
    if (!btn || !start) return;
    btn.addEventListener('click', (ev) => {
      ev.preventDefault();
      // Prefer modern showPicker API when available
      if (typeof start.showPicker === 'function') {
        try { start.showPicker(); return; } catch (e) { /* fall through */ }
      }
      // Fallback: focus and click to trigger native UI
      start.focus();
      try { start.click(); } catch (e) { /* ignore */ }
    });
  })();

  el.btnExportPng.addEventListener("click", async () => {
    try {
      setStatus("PNG生成中…");

      // Prepare a tight, transparent export by cloning the export area and sizing the clone to its border-box.
      const rect = el.exportArea.getBoundingClientRect();
      const widthPx = Math.ceil(rect.width);
      const heightPx = Math.ceil(rect.height);
      const deviceRatio = window.devicePixelRatio || 1;

      // Clone element so we don't disturb the live UI, and put it offscreen but visible to the renderer
      const clone = el.exportArea.cloneNode(true);
      // Copy computed CSS variables to the clone to ensure visual parity
      const cs = window.getComputedStyle(el.exportArea);
      ["--tt-bg", "--tt-border", "--tt-text", "--tt-head"].forEach(k => {
        const v = el.exportArea.style.getPropertyValue(k).trim() || cs.getPropertyValue(k).trim();
        if (v) clone.style.setProperty(k, v);
      });

      clone.style.boxSizing = 'border-box';
      clone.style.margin = '0';
      clone.style.display = 'inline-block';
      clone.style.overflow = 'visible';
      clone.style.width = widthPx + 'px';
      clone.style.height = heightPx + 'px';
      clone.style.position = 'fixed';
      clone.style.left = '0';
      clone.style.top = '0';
      clone.style.zIndex = '999999';
      clone.style.pointerEvents = 'none';

      // ensure clone has explicit background and border-radius so it renders independently
      const bgColor = cs.backgroundColor || el.themeBg?.value || 'transparent';
      clone.style.backgroundColor = bgColor;
      const br = cs.borderRadius || '0px';
      clone.style.borderRadius = br;

      document.body.appendChild(clone);

      // wait for the clone to be rendered/painted
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

      // Use fixed 2x export scale
      const scaleVal = 2;
      const pixelRatio = Math.max(1, deviceRatio) * scaleVal;

      // @ts-ignore
      const dataUrl = await window.htmlToImage.toPng(clone, {
        pixelRatio: pixelRatio,
        cacheBust: true,
        backgroundColor: null, // transparent outside the exportArea
      });

      // remove the temporary clone
      clone.remove();

      const a = document.createElement("a");
      a.href = dataUrl;
      a.download = `timetable@2x.png`;
      a.click();

      setStatus(`PNGを保存済み（2x）`);
    } catch (e) {
      console.error(e);
      setStatus("PNG生成に失敗しました");
    }
  });

  // ---------- sortable ----------
  // @ts-ignore
  new Sortable(el.eventList, {
    handle: ".dragHandle",
    animation: 150,
    onEnd: () => recalcAndRender(),
  });

  // ---------- init ----------
  renderEventList([
    { name: "OP", durationMin: 20 },
    { name: "戦闘", durationMin: 35 },
    { name: "ED", durationMin: 60 },
  ]);

  applyTheme();
  recalcAndRender();
})();
