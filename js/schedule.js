(function () {
  "use strict";

  function todayKey() {
    var d = new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }

  var STORAGE_KEY = "sendo-schedule-" + todayKey();
  var NEEDS_STORAGE_KEY = "sendo-needs-" + todayKey();

  var els = {
    ticker: document.getElementById("ticker"),
    appointmentList: document.getElementById("appointment-list"),
    walkinList: document.getElementById("walkin-list"),
    taskPanelSlot: document.getElementById("task-panel-slot"),
    addWalkinBtn: document.getElementById("add-walkin-btn"),
    walkinModal: document.getElementById("walkin-modal"),
    walkinNameInput: document.getElementById("walkin-name-input"),
    walkinCancelBtn: document.getElementById("walkin-cancel-btn"),
    walkinConfirmBtn: document.getElementById("walkin-confirm-btn"),
    deleteModal: document.getElementById("delete-modal"),
    deleteModalText: document.getElementById("delete-modal-text"),
    deleteCancelBtn: document.getElementById("delete-cancel-btn"),
    deleteConfirmBtn: document.getElementById("delete-confirm-btn"),
    toast: document.getElementById("toast"),
    historyList: document.getElementById("history-list"),
    historyDetailModal: document.getElementById("history-detail-modal"),
    historyDetailTitle: document.getElementById("history-detail-title"),
    historyDetailSubtitle: document.getElementById("history-detail-subtitle"),
    historyDetailProducts: document.getElementById("history-detail-products"),
    historyDetailCloseBtn: document.getElementById("history-detail-close-btn"),
    futureList: document.getElementById("future-list")
  };

  var state = loadState();
  var pendingDeleteId = null;
  var toastTimer = null;
  var needsEditorOpen = false;
  var syncStatus = "idle"; // idle | loading | success | error | unauthenticated
  var futureAppointments = []; // [{ dateKey, items: [...] }] 閲覧専用(ローカル保存しない)

  function seedState() {
    return {
      activeVisitId: null,
      appointments: [],
      walkins: [],
      hiddenAppointmentIds: []
    };
  }

  function loadState() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        var parsed = JSON.parse(raw);
        parsed.hiddenAppointmentIds = parsed.hiddenAppointmentIds || [];
        return parsed;
      }
    } catch (e) {
      console.warn("failed to load schedule state", e);
    }
    return seedState();
  }

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      console.warn("failed to save schedule state", e);
    }
  }

  function findVisit(id) {
    return state.appointments.find(function (v) { return v.id === id; }) ||
      state.walkins.find(function (v) { return v.id === id; }) ||
      findFutureVisit(id);
  }

  // 「今後の予定」欄(閲覧専用プレビュー、state.appointmentsには含まれない)から探す
  function findFutureVisit(id) {
    for (var i = 0; i < futureAppointments.length; i++) {
      var match = futureAppointments[i].items.find(function (v) { return v.id === id; });
      if (match) return match;
    }
    return null;
  }

  function removeFutureVisitLocally(id) {
    futureAppointments = futureAppointments
      .map(function (g) { return { dateKey: g.dateKey, items: g.items.filter(function (v) { return v.id !== id; }) }; })
      .filter(function (g) { return g.items.length > 0; });
  }

  function showToast(message) {
    els.toast.textContent = message;
    els.toast.classList.add("is-visible");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      els.toast.classList.remove("is-visible");
    }, 2600);
  }

  function parseTodayTime(hhmm) {
    var parts = hhmm.split(":");
    var d = new Date();
    d.setHours(Number(parts[0]), Number(parts[1]), 0, 0);
    return d;
  }

  var EARLY_ACCESS_MS = 24 * 60 * 60 * 1000; // 訪問の24時間前から入力可能にする

  function isFuture(visit) {
    if (visit.type !== "appointment") return false;
    var startMs = visit.startDateTime ? new Date(visit.startDateTime).getTime() : parseTodayTime(visit.time).getTime();
    return startMs - Date.now() > EARLY_ACCESS_MS;
  }

  function formatTime(iso) {
    var d = new Date(iso);
    return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
  }

  // ---- Google Calendar sync ----

  var MEETING_PREFIX = "【Sales】";
  var FUTURE_DAYS = 7; // 本日より先、何日分の予定を閲覧用に先読みするか
  var WEEKDAY_LABELS = ["日", "月", "火", "水", "木", "金", "土"];

  function calendarTimeRange() {
    var start = new Date();
    start.setHours(0, 0, 0, 0);
    var end = new Date();
    end.setDate(end.getDate() + FUTURE_DAYS);
    end.setHours(23, 59, 59, 999);
    return { timeMin: start.toISOString(), timeMax: end.toISOString() };
  }

  function dateKeyFromDate(d) {
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }

  function formatFutureDateHeading(dateKey) {
    var parts = dateKey.split("-").map(Number);
    var d = new Date(parts[0], parts[1] - 1, parts[2]);
    return parts[1] + "/" + parts[2] + "(" + WEEKDAY_LABELS[d.getDay()] + ")";
  }

  function extractMeetingName(summary) {
    if (!summary) return null;
    var trimmed = summary.trim();
    if (trimmed.indexOf(MEETING_PREFIX) !== 0) return null;
    var name = trimmed.slice(MEETING_PREFIX.length).trim();
    return name || null;
  }

  function mergeCalendarAppointments(fetched) {
    var hidden = state.hiddenAppointmentIds || [];
    var existingById = {};
    state.appointments.forEach(function (v) {
      if (v.id.indexOf("gcal-") === 0) existingById[v.id] = v;
    });

    var merged = [];
    fetched.forEach(function (f) {
      if (hidden.indexOf(f.id) !== -1) return;
      var existing = existingById[f.id];
      if (existing) {
        existing.name = f.name;
        existing.time = f.time;
        existing.calendarLocation = f.calendarLocation;
        existing.startDateTime = f.startDateTime;
        merged.push(existing);
      } else {
        merged.push({
          id: f.id,
          type: "appointment",
          name: f.name,
          time: f.time,
          calendarLocation: f.calendarLocation,
          startDateTime: f.startDateTime,
          status: "scheduled",
          arrivedAt: null,
          location: null
        });
      }
    });

    if (state.activeVisitId && state.activeVisitId.indexOf("gcal-") === 0) {
      var stillExists = merged.some(function (v) { return v.id === state.activeVisitId; });
      if (!stillExists) state.activeVisitId = null;
    }

    state.appointments = merged;
  }

  function syncCalendar() {
    if (!window.Auth || !Auth.isLoggedIn()) {
      syncStatus = "unauthenticated";
      futureAppointments = [];
      render();
      renderFutureAppointments();
      return;
    }

    syncStatus = "loading";
    render();
    renderFutureAppointments();

    var range = calendarTimeRange();
    var url = "https://www.googleapis.com/calendar/v3/calendars/primary/events" +
      "?timeMin=" + encodeURIComponent(range.timeMin) +
      "&timeMax=" + encodeURIComponent(range.timeMax) +
      "&singleEvents=true&orderBy=startTime";

    GoogleApi.fetchJson(url).then(function (data) {
      var fetched = (data.items || []).map(function (item) {
        var name = extractMeetingName(item.summary);
        if (!name || !item.start || !item.start.dateTime) return null;
        return {
          id: "gcal-" + item.id,
          name: name,
          time: formatTime(item.start.dateTime),
          calendarLocation: item.location || "",
          startDateTime: item.start.dateTime
        };
      }).filter(function (v) { return v !== null; });

      var todayK = todayKey();
      var todays = [];
      var futureByDate = {};
      var futureDateKeys = [];
      fetched.forEach(function (f) {
        var dateKey = dateKeyFromDate(new Date(f.startDateTime));
        if (dateKey === todayK) {
          todays.push(f);
        } else if (dateKey > todayK) {
          if (!futureByDate[dateKey]) { futureByDate[dateKey] = []; futureDateKeys.push(dateKey); }
          futureByDate[dateKey].push(f);
        }
      });
      futureDateKeys.sort();
      futureAppointments = futureDateKeys.map(function (dateKey) {
        return {
          dateKey: dateKey,
          items: futureByDate[dateKey].sort(function (a, b) { return a.startDateTime.localeCompare(b.startDateTime); })
        };
      });

      mergeCalendarAppointments(todays);
      syncStatus = "success";
      saveState();
      render();
      renderFutureAppointments();
    }).catch(function (err) {
      console.warn("calendar sync failed", err);
      syncStatus = (err && (err.type === "unauthorized" || err.type === "unauthenticated")) ? "unauthenticated" : "error";
      futureAppointments = [];
      render();
      renderFutureAppointments();
    });
  }

  function renderFutureAppointments() {
    if (!els.futureList) return;
    if (syncStatus === "unauthenticated") {
      els.futureList.innerHTML = '<div class="empty-hint">Googleアカウントでログインすると今後の予定が表示されます</div>';
      return;
    }
    if (syncStatus === "loading" && futureAppointments.length === 0) {
      els.futureList.innerHTML = '<div class="empty-hint">予定を読み込み中…</div>';
      return;
    }
    if (syncStatus === "error") {
      els.futureList.innerHTML = '<div class="empty-hint">予定の取得に失敗しました</div>';
      return;
    }
    if (futureAppointments.length === 0) {
      els.futureList.innerHTML = '<div class="empty-hint">今後' + FUTURE_DAYS + '日以内の予定はありません</div>';
      return;
    }
    els.futureList.innerHTML = futureAppointments.map(function (group) {
      var rows = group.items.map(function (v) {
        var metaHtml = v.calendarLocation ? '<span class="history-meta">' + escapeHtml(v.calendarLocation) + '</span>' : '';
        return '<div class="future-row">' +
          '<span class="history-date">' + escapeHtml(v.time) + '</span>' +
          '<span class="history-info">' +
            '<span class="history-name">' + escapeHtml(v.name) + '</span>' +
            metaHtml +
          '</span>' +
          '<button class="visit-delete" type="button" data-delete-id="' + v.id + '" aria-label="削除">🗑</button>' +
        '</div>';
      }).join("");
      return '<div class="future-date-heading">' + escapeHtml(formatFutureDateHeading(group.dateKey)) + '</div>' + rows;
    }).join("");

    bindFutureRowEvents();
  }

  function bindFutureRowEvents() {
    if (!els.futureList) return;
    els.futureList.querySelectorAll(".visit-delete").forEach(function (btn) {
      btn.addEventListener("click", function () {
        openDeleteModal(btn.getAttribute("data-delete-id"));
      });
    });
  }

  function getLocation() {
    return new Promise(function (resolve) {
      if (!("geolocation" in navigator)) {
        resolve(null);
        return;
      }
      navigator.geolocation.getCurrentPosition(
        function (pos) {
          resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy });
        },
        function () {
          resolve(null);
        },
        { timeout: 6000, maximumAge: 60000 }
      );
    });
  }

  function getNippouRecord(visitId) {
    try {
      var raw = localStorage.getItem("sendo-nippou-" + todayKey());
      if (!raw) return null;
      var store = JSON.parse(raw);
      return store[visitId] || null;
    } catch (e) {
      return null;
    }
  }

  function loadNeedsStore() {
    try {
      var raw = localStorage.getItem(NEEDS_STORAGE_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (e) {
      console.warn("failed to load needs store", e);
      return {};
    }
  }

  function saveNeedsStore(store) {
    try {
      localStorage.setItem(NEEDS_STORAGE_KEY, JSON.stringify(store));
    } catch (e) {
      console.warn("failed to save needs store", e);
    }
  }

  function getNeedsRecord(visitId) {
    var store = loadNeedsStore();
    return store[visitId] || null;
  }

  function saveNeedsRecord(visitId, memo) {
    var store = loadNeedsStore();
    store[visitId] = { memo: memo, submittedAt: new Date().toISOString() };
    saveNeedsStore(store);
  }

  function getNippouStatus(visitId) {
    var record = getNippouRecord(visitId);
    if (!record || !record.submitted) return null;
    var allDone = record.products.every(function (p) {
      return p.rank && p.stockMin !== "" && p.stockMax !== "" &&
        p.usageMin !== "" && p.usageMax !== "" &&
        p.priceMin !== "" && p.priceMax !== "" &&
        p.remarks.trim() !== "";
    });
    return allDone ? "done" : "tentative";
  }

  function badgeForVisit(visit) {
    if (visit.status !== "arrived") return "";
    var nippouStatus = getNippouStatus(visit.id);
    if (nippouStatus === "done") return '<span class="badge badge-done">🟢 完了</span>';
    if (nippouStatus === "tentative") return '<span class="badge badge-tentative">🟡 仮</span>';
    return '<span class="badge badge-not-reported">🔴 未報告</span>';
  }

  function renderVisitRow(visit) {
    var future = isFuture(visit);
    var arrived = visit.status === "arrived";
    var metaParts = [];
    if (arrived) {
      metaParts.push("到着 " + formatTime(visit.arrivedAt));
      metaParts.push(badgeForVisit(visit));
    } else if (future) {
      var startMs = visit.startDateTime ? new Date(visit.startDateTime).getTime() : parseTodayTime(visit.time).getTime();
      var availableAt = new Date(startMs - EARLY_ACCESS_MS);
      var availableLabel = (availableAt.getMonth() + 1) + "/" + availableAt.getDate() + " " +
        String(availableAt.getHours()).padStart(2, "0") + ":" + String(availableAt.getMinutes()).padStart(2, "0");
      metaParts.push('<span class="future-tag">' + availableLabel + " から対応可</span>");
    } else if (visit.type === "appointment") {
      metaParts.push("未対応");
    } else {
      metaParts.push("未対応");
    }

    var timeLabel = visit.type === "appointment" ? visit.time : "Walk In";
    var disabledAttr = future ? "disabled" : "";
    var row = document.createElement("div");
    row.className = "visit-row";
    row.innerHTML =
      '<button class="visit-main" type="button" data-visit-id="' + visit.id + '" ' + disabledAttr + '>' +
        '<span class="visit-time">' + timeLabel + '</span>' +
        '<span class="visit-info">' +
          '<span class="visit-name">' + escapeHtml(visit.name) + '</span>' +
          '<span class="visit-meta">' + metaParts.join(" ") + '</span>' +
        '</span>' +
        '<span class="visit-chevron" aria-hidden="true">' + (future ? "" : "›") + '</span>' +
      '</button>' +
      '<button class="visit-delete" type="button" data-delete-id="' + visit.id + '" aria-label="削除">🗑</button>';
    return row;
  }

  function escapeHtml(str) {
    var div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  // ---- 過去の日報(履歴) ----

  var NIPPOU_STORAGE_PREFIX = "sendo-nippou-";
  var HISTORY_DAYS = 7;
  var historyEntries = [];

  function formatHistoryDate(dateKey) {
    var parts = dateKey.split("-");
    if (parts.length !== 3) return dateKey;
    return Number(parts[1]) + "/" + Number(parts[2]);
  }

  function historyCutoffKey() {
    var d = new Date();
    d.setDate(d.getDate() - HISTORY_DAYS);
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }

  function collectNippouHistory() {
    var todayK = todayKey();
    var cutoffK = historyCutoffKey();
    var entries = [];
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var key = localStorage.key(i);
        if (!key || key.indexOf(NIPPOU_STORAGE_PREFIX) !== 0) continue;
        var dateKey = key.slice(NIPPOU_STORAGE_PREFIX.length);
        if (dateKey === todayK) continue; // 本日分は上のリストに出ているので除く
        if (dateKey < cutoffK) continue; // 直近1週間より前は表示しない

        var raw = localStorage.getItem(key);
        if (!raw) continue;
        var store;
        try { store = JSON.parse(raw); } catch (e) { continue; }

        Object.keys(store).forEach(function (visitId) {
          var record = store[visitId];
          if (record && record.submitted) {
            entries.push({
              dateKey: dateKey,
              visitId: visitId,
              name: record.name,
              submittedAt: record.submittedAt,
              products: record.products
            });
          }
        });
      }
    } catch (e) {
      console.warn("failed to collect nippou history", e);
    }

    entries.sort(function (a, b) { return (b.submittedAt || "").localeCompare(a.submittedAt || ""); });
    return entries;
  }

  function renderHistory() {
    if (!els.historyList) return;
    historyEntries = collectNippouHistory();
    if (historyEntries.length === 0) {
      els.historyList.innerHTML = '<div class="empty-hint">過去の日報はまだありません</div>';
      return;
    }
    els.historyList.innerHTML = historyEntries.map(function (e, i) {
      var timeLabel = e.submittedAt ? formatTime(e.submittedAt) : "";
      var countLabel = e.products.length + "品";
      return '<button type="button" class="history-row" data-history-index="' + i + '">' +
        '<span class="history-date">' + escapeHtml(formatHistoryDate(e.dateKey)) + '</span>' +
        '<span class="history-info">' +
          '<span class="history-name">' + escapeHtml(e.name) + '</span>' +
          '<span class="history-meta">最終提出 ' + escapeHtml(timeLabel) + ' ・ ' + escapeHtml(countLabel) + '</span>' +
        '</span>' +
        '<span class="history-chevron" aria-hidden="true">›</span>' +
      '</button>';
    }).join("");

    els.historyList.querySelectorAll("[data-history-index]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        openHistoryDetail(Number(btn.getAttribute("data-history-index")));
      });
    });
  }

  function formatFigureRange(min, max) {
    if (!min && !max) return "—";
    return (min || "—") + " 〜 " + (max || "—");
  }

  function openHistoryDetail(i) {
    var entry = historyEntries[i];
    if (!entry || !els.historyDetailModal) return;

    els.historyDetailTitle.textContent = entry.name;
    els.historyDetailSubtitle.textContent =
      formatHistoryDate(entry.dateKey) + "(最終提出 " + (entry.submittedAt ? formatTime(entry.submittedAt) : "—") + "・閲覧のみ)";

    els.historyDetailProducts.innerHTML = entry.products.map(function (p) {
      var refParts = [];
      if (p.itemCode) refParts.push(escapeHtml(p.itemCode));
      if (p.unit) refParts.push(escapeHtml(p.unit));
      var refHtml = refParts.length ? ' <span class="history-detail-ref">' + refParts.join(" ・ ") + '</span>' : "";
      return '<div class="history-detail-product">' +
        '<div class="history-detail-product-head">' +
          '<span class="history-detail-name">' + escapeHtml(p.name) + refHtml + '</span>' +
          '<span class="badge ' + (p.rank ? "badge-done" : "badge-skipped") + '">' + (p.rank ? "ランク " + escapeHtml(p.rank) : "未評価") + '</span>' +
        '</div>' +
        '<div class="kv-row"><span class="k">仕入れ額/月 (฿)</span><span>' + escapeHtml(formatFigureRange(p.stockMin, p.stockMax)) + '</span></div>' +
        '<div class="kv-row"><span class="k">使用量</span><span>' + escapeHtml(formatFigureRange(p.usageMin, p.usageMax)) + '</span></div>' +
        '<div class="kv-row"><span class="k">Target Price (฿)</span><span>' + escapeHtml(formatFigureRange(p.priceMin, p.priceMax)) + '</span></div>' +
        '<div class="kv-row"><span class="k">Remarks</span><span>' + escapeHtml(p.remarks || "—") + '</span></div>' +
      '</div>';
    }).join("");

    els.historyDetailModal.hidden = false;
  }

  function closeHistoryDetail() {
    if (els.historyDetailModal) els.historyDetailModal.hidden = true;
  }

  // タスクパネルは常に、対応中の予定行の直下に表示する(アポ・Walk In問わず)
  function positionTaskPanel(visitId) {
    var match = null;
    document.querySelectorAll(".visit-main").forEach(function (btn) {
      if (btn.getAttribute("data-visit-id") === visitId) match = btn;
    });
    if (!match) return;
    var row = match.closest(".visit-row");
    if (row) row.insertAdjacentElement("afterend", els.taskPanelSlot);
  }

  function renderTaskPanel() {
    els.taskPanelSlot.innerHTML = "";
    if (!state.activeVisitId) return;
    var visit = findVisit(state.activeVisitId);
    if (!visit) return;

    positionTaskPanel(visit.id);

    var arrived = visit.status === "arrived";
    var arrivalItemHtml;
    if (arrived) {
      var locText = visit.location ? "位置情報を取得済み" : "位置情報は取得できませんでした";
      arrivalItemHtml =
        '<div class="task-item is-done">' +
          '<span class="task-check">✓</span>' +
          '<span class="task-body">' +
            '<span class="task-label">① 到着</span>' +
            '<span class="task-sub">' + formatTime(visit.arrivedAt) + ' に記録 ・ ' + locText + '</span>' +
          '</span>' +
        '</div>';
    } else {
      arrivalItemHtml =
        '<div class="task-item">' +
          '<span class="task-check"></span>' +
          '<span class="task-body">' +
            '<span class="task-label">① 到着</span>' +
            '<span class="task-sub">ボタンを押すと位置情報・時刻を記録します</span>' +
          '</span>' +
          '<button class="task-link" type="button" id="task-arrival-btn">📍 到着確認</button>' +
        '</div>';
    }

    var nippouStatus = arrived ? getNippouStatus(visit.id) : null;
    var nippouSubmitted = nippouStatus !== null;

    var nippouSub;
    if (!arrived) {
      nippouSub = "①の後に解放されます";
    } else if (nippouStatus === "done") {
      nippouSub = "提出済み(全項目入力済み)";
    } else if (nippouStatus === "tentative") {
      nippouSub = "提出済み(ランクのみ・一部項目は空欄)";
    } else {
      nippouSub = "訪問後の商品評価・所感を入力";
    }

    var nippouItemHtml =
      '<div class="task-item' + (nippouSubmitted ? ' is-done' : (arrived ? '' : ' is-locked')) + '">' +
        '<span class="task-check">' + (nippouSubmitted ? '✓' : '') + '</span>' +
        '<span class="task-body">' +
          '<span class="task-label">② 日報を書く</span>' +
          '<span class="task-sub">' + nippouSub + '</span>' +
        '</span>' +
        '<button class="task-link" type="button" id="task-nippou-link"' + (arrived ? '' : ' disabled') + '>' +
          (arrived ? (nippouSubmitted ? '編集する' : '入力する') : 'ロック中') +
        '</button>' +
      '</div>';

    var needsRecord = nippouSubmitted ? getNeedsRecord(visit.id) : null;
    var needsSubmitted = !!needsRecord;

    var needsSub;
    if (!nippouSubmitted) {
      needsSub = "②の後に解放されます";
    } else if (needsSubmitted) {
      needsSub = (needsRecord.memo ? needsRecord.memo : "特になし") + "(" + formatTime(needsRecord.submittedAt) + " 記録)";
    } else {
      needsSub = "訪問先の新しいニーズ・要望を記入(なければ空欄のまま記録可)";
    }

    var needsToggleLabel = needsEditorOpen ? "閉じる" : (needsSubmitted ? "編集する" : "入力する");
    var needsItemHtml =
      '<div class="task-item' + (needsSubmitted ? ' is-done' : (nippouSubmitted ? '' : ' is-locked')) + '">' +
        '<span class="task-check">' + (needsSubmitted ? '✓' : '') + '</span>' +
        '<span class="task-body">' +
          '<span class="task-label">③ 新規ニーズ確認</span>' +
          '<span class="task-sub">' + escapeHtml(needsSub) + '</span>' +
        '</span>' +
        '<button class="task-link" type="button" id="task-needs-toggle"' + (nippouSubmitted ? '' : ' disabled') + '>' +
          (nippouSubmitted ? needsToggleLabel : 'ロック中') +
        '</button>' +
      '</div>' +
      (nippouSubmitted && needsEditorOpen ?
        '<div class="needs-editor">' +
          '<div class="field-group">' +
            '<label>新規ニーズ・要望メモ(任意)</label>' +
            '<textarea id="needs-memo-input" placeholder="例: 新しいメニューでウニの仕入れを検討中とのこと">' + escapeHtml(needsRecord ? needsRecord.memo : '') + '</textarea>' +
          '</div>' +
          '<div class="modal-actions">' +
            '<button class="btn btn-secondary" type="button" id="needs-cancel-btn">キャンセル</button>' +
            '<button class="btn btn-primary" type="button" id="needs-save-btn">記録する</button>' +
          '</div>' +
        '</div>' : '');

    var followUpHtml =
      '<div class="task-item is-locked">' +
        '<span class="task-check"></span>' +
        '<span class="task-body">' +
          '<span class="task-label">④ 課ごとの確認項目</span>' +
          '<span class="task-sub">' + (needsSubmitted ? "近日実装予定です(課ごとに内容が異なります)" : "③の後に解放されます(課ごとに内容が異なります)") + '</span>' +
        '</span>' +
        '<button class="task-link" type="button" disabled>ロック中</button>' +
      '</div>';

    var panel = document.createElement("div");
    panel.className = "task-panel";
    panel.innerHTML =
      '<div class="task-panel-header">' +
        '<span class="task-panel-title">' + escapeHtml(visit.name) + ' のタスク</span>' +
        '<button class="task-panel-close" type="button" id="task-panel-close" aria-label="閉じる">✕</button>' +
      '</div>' +

      arrivalItemHtml +
      nippouItemHtml +
      needsItemHtml +
      followUpHtml;

    els.taskPanelSlot.appendChild(panel);

    document.getElementById("task-panel-close").addEventListener("click", function () {
      state.activeVisitId = null;
      needsEditorOpen = false;
      renderTaskPanel();
    });

    if (arrived) {
      document.getElementById("task-nippou-link").addEventListener("click", function () {
        var startDateTime = visit.type === "appointment" ? visit.startDateTime : visit.arrivedAt;
        window.location.href = "nippou.html?visit=" + encodeURIComponent(visit.id) +
          "&name=" + encodeURIComponent(visit.name) +
          "&start=" + encodeURIComponent(startDateTime || "");
      });
    } else {
      document.getElementById("task-arrival-btn").addEventListener("click", function (e) {
        e.target.disabled = true;
        e.target.textContent = "取得中…";
        recordArrival(visit);
      });
    }

    if (nippouSubmitted) {
      document.getElementById("task-needs-toggle").addEventListener("click", function () {
        needsEditorOpen = !needsEditorOpen;
        renderTaskPanel();
      });
    }

    if (nippouSubmitted && needsEditorOpen) {
      document.getElementById("needs-cancel-btn").addEventListener("click", function () {
        needsEditorOpen = false;
        renderTaskPanel();
      });
      document.getElementById("needs-save-btn").addEventListener("click", function () {
        var memo = document.getElementById("needs-memo-input").value.trim();
        var btn = document.getElementById("needs-save-btn");
        btn.disabled = true;
        btn.textContent = "記録中…";

        var startDateTime = visit.type === "appointment" ? visit.startDateTime : visit.arrivedAt;
        var dateTimeStr = startDateTime && window.AnalysisLog ? AnalysisLog.formatAnalysisDateTime(new Date(startDateTime)) : null;
        var writePromise = (window.AnalysisLog && dateTimeStr)
          ? AnalysisLog.logNeeds({ dateTimeStr: dateTimeStr, venue: visit.name, memo: memo })
          : Promise.reject({ type: "not-available" });

        writePromise.then(function () {
          saveNeedsRecord(visit.id, memo);
          needsEditorOpen = false;
          renderTaskPanel();
          showToast(memo ? "新規ニーズを記録しました" : "「特になし」として記録しました");
        }).catch(function (err) {
          console.warn("failed to log needs to analysis sheet", err);
          var msg = "評価ログへの書き込みに失敗しました。もう一度お試しください";
          if (err && err.type === "rep-not-configured") msg = "担当者名が未設定です(js/rep-config.js)";
          else if (err && err.type === "file-not-found") msg = "評価ログの書き込み先が見つかりませんでした";
          else if (err && err.type === "no-matching-rows") msg = "対応する行が見つかりませんでした";
          showToast(msg);
          btn.disabled = false;
          btn.textContent = "記録する";
        });
      });
    }
  }

  function renderTicker() {
    var all = state.appointments.concat(state.walkins);
    var arrived = all.filter(function (v) { return v.status === "arrived"; }).length;
    var pending = all.filter(function (v) { return v.status !== "arrived" && !isFuture(v); }).length;
    els.ticker.innerHTML =
      '<div class="tick"><div class="label">本日の予定</div><div class="val">' + all.length + '</div></div>' +
      '<div class="tick"><div class="label">到着済み</div><div class="val good">' + arrived + '</div></div>' +
      '<div class="tick"><div class="label">未対応</div><div class="val' + (pending > 0 ? ' warn' : '') + '">' + pending + '</div></div>';
  }

  function render() {
    renderTicker();
    els.appointmentList.innerHTML = "";
    if (syncStatus === "unauthenticated") {
      els.appointmentList.innerHTML = '<div class="empty-hint">Googleアカウントでログインすると本日の予定が表示されます</div>';
    } else if (syncStatus === "loading" && state.appointments.length === 0) {
      els.appointmentList.innerHTML = '<div class="empty-hint">予定を読み込み中…</div>';
    } else if (syncStatus === "error") {
      els.appointmentList.innerHTML =
        '<div class="empty-hint">予定の取得に失敗しました<br>' +
        '<button class="task-link" type="button" id="calendar-retry-btn">再試行</button></div>';
    } else if (state.appointments.length === 0) {
      els.appointmentList.innerHTML = '<div class="empty-hint">本日のアポイントメントはありません</div>';
    } else {
      state.appointments
        .slice()
        .sort(function (a, b) { return a.time.localeCompare(b.time); })
        .forEach(function (v) { els.appointmentList.appendChild(renderVisitRow(v)); });
    }

    els.walkinList.innerHTML = "";
    if (state.walkins.length === 0) {
      els.walkinList.innerHTML = '<div class="empty-hint">本日のWalk In訪問はまだありません</div>';
    } else {
      state.walkins.forEach(function (v) { els.walkinList.appendChild(renderVisitRow(v)); });
    }

    bindRowEvents();
    renderTaskPanel();

    var retryBtn = document.getElementById("calendar-retry-btn");
    if (retryBtn) retryBtn.addEventListener("click", syncCalendar);
  }

  function bindRowEvents() {
    document.querySelectorAll(".visit-main").forEach(function (btn) {
      btn.addEventListener("click", function () {
        handleVisitTap(btn.getAttribute("data-visit-id"));
      });
    });
    document.querySelectorAll(".visit-delete").forEach(function (btn) {
      btn.addEventListener("click", function () {
        openDeleteModal(btn.getAttribute("data-delete-id"));
      });
    });
  }

  function handleVisitTap(id) {
    var visit = findVisit(id);
    if (!visit) return;
    if (isFuture(visit)) return;

    state.activeVisitId = state.activeVisitId === id ? null : id;
    needsEditorOpen = false;
    renderTaskPanel();
  }

  // ---- 位置情報のリアルタイム記録(オフライン時はキューに積んで後で再送) ----

  var LOCATION_QUEUE_KEY = "sendo-location-queue";

  function loadLocationQueue() {
    try {
      var raw = localStorage.getItem(LOCATION_QUEUE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      return [];
    }
  }

  function saveLocationQueue(queue) {
    try {
      localStorage.setItem(LOCATION_QUEUE_KEY, JSON.stringify(queue));
    } catch (e) {
      console.warn("failed to save location queue", e);
    }
  }

  function queueLocationEntry(entry) {
    var queue = loadLocationQueue();
    queue.push(entry);
    saveLocationQueue(queue);
  }

  // 到着確認は現場でその場で押すボタンなので、電波が悪くてもローカルの到着記録はブロックしない。
  // シートへの書き込みはベストエフォートで行い、失敗した分だけキューに残して後で再送する。
  function flushLocationQueue() {
    if (!window.AnalysisLog || !window.Auth || !Auth.isLoggedIn()) return;
    var queue = loadLocationQueue();
    queue.forEach(function (entry) {
      AnalysisLog.logLocationRealtime(entry).then(function () {
        var remaining = loadLocationQueue().filter(function (e) { return e.id !== entry.id; });
        saveLocationQueue(remaining);
      }).catch(function (err) {
        console.warn("failed to flush queued location entry", err);
      });
    });
  }

  function recordArrival(visit) {
    showToast("📍 位置情報を取得しています…");
    getLocation().then(function (loc) {
      visit.status = "arrived";
      visit.arrivedAt = new Date().toISOString();
      visit.location = loc;
      state.activeVisitId = visit.id;
      saveState();
      render();
      showToast(loc ? "到着を記録しました(位置情報を取得できました)" : "到着を記録しました(位置情報は取得できませんでした)");

      if (loc && window.AnalysisLog) {
        var mapLink = "https://www.google.com/maps?q=" + loc.lat + "," + loc.lng;
        queueLocationEntry({
          id: visit.id + "-" + visit.arrivedAt,
          dateTimeStr: AnalysisLog.formatAnalysisDateTime(new Date(visit.arrivedAt)),
          venue: visit.name,
          lat: loc.lat,
          lng: loc.lng,
          accuracy: loc.accuracy != null ? Math.round(loc.accuracy) : "",
          mapLink: mapLink
        });
        flushLocationQueue();
      }

      if (visit.type === "appointment" && visit.id.indexOf("gcal-") === 0 && !visit.calendarLocation) {
        alert("この予定には位置情報が登録されていません。カレンダーに登録してください");
      }
    });
  }

  // ---- Walk-in modal ----

  function openWalkinModal() {
    els.walkinNameInput.value = "";
    els.walkinModal.hidden = false;
    els.walkinNameInput.focus();
  }

  function closeWalkinModal() {
    els.walkinModal.hidden = true;
  }

  function confirmWalkin() {
    var name = els.walkinNameInput.value.trim() || "Walk In";
    var visit = {
      id: "walkin-" + Date.now(),
      type: "walkin",
      name: name,
      time: null,
      status: "scheduled",
      arrivedAt: null,
      location: null
    };
    state.walkins.push(visit);
    state.activeVisitId = visit.id;
    saveState();
    closeWalkinModal();
    render();
    showToast("Walk Inを追加しました。到着確認ボタンを押してください");
  }

  // ---- Delete modal ----

  function openDeleteModal(id) {
    var visit = findVisit(id);
    if (!visit) return;
    pendingDeleteId = id;
    var label = visit.type === "walkin" ? visit.name + "(Walk In)" : visit.name + "(" + visit.time + ")";
    var isCalendarEvent = id.indexOf("gcal-") === 0;
    els.deleteModalText.textContent = isCalendarEvent
      ? "「" + label + "」を削除します。Googleカレンダー側の予定も削除されます。"
      : "「" + label + "」をアプリ内の予定から削除します。";
    els.deleteModal.hidden = false;
  }

  function closeDeleteModal() {
    els.deleteModal.hidden = true;
    pendingDeleteId = null;
  }

  function removeVisitLocally(id) {
    state.appointments = state.appointments.filter(function (v) { return v.id !== id; });
    state.walkins = state.walkins.filter(function (v) { return v.id !== id; });
    if (state.activeVisitId === id) state.activeVisitId = null;
    saveState();
  }

  function deleteCalendarEvent(id) {
    var eventId = id.slice("gcal-".length);
    var url = "https://www.googleapis.com/calendar/v3/calendars/primary/events/" + encodeURIComponent(eventId);
    return GoogleApi.fetchJson(url, { method: "DELETE" }).catch(function (err) {
      // 404/410 = カレンダー側で既に削除済み。アプリ側から見れば削除成功と同じ扱いでよい
      if (err && (err.status === 404 || err.status === 410)) return null;
      return Promise.reject(err);
    });
  }

  function confirmDelete() {
    if (!pendingDeleteId) return;
    var id = pendingDeleteId;
    var isCalendarEvent = id.indexOf("gcal-") === 0;

    if (!isCalendarEvent) {
      removeVisitLocally(id);
      closeDeleteModal();
      render();
      showToast("削除しました");
      return;
    }

    var visit = findVisit(id);
    var isFutureOnly = !!visit && !visit.type; // 「今後の予定」欄由来(state.appointmentsには無い)
    var dateTimeStr = (visit && visit.startDateTime && window.AnalysisLog)
      ? AnalysisLog.formatAnalysisDateTime(new Date(visit.startDateTime))
      : null;

    els.deleteConfirmBtn.disabled = true;
    els.deleteConfirmBtn.textContent = "削除中…";

    var analysisCleanup = (dateTimeStr && visit)
      ? Promise.all([
          AnalysisLog.deleteVisitRows({ dateTimeStr: dateTimeStr, venue: visit.name }),
          AnalysisLog.deleteLocationRows({ dateTimeStr: dateTimeStr, venue: visit.name })
        ])
      : Promise.resolve();

    Promise.all([
      deleteCalendarEvent(id),
      analysisCleanup
    ]).then(function () {
      if (isFutureOnly) {
        removeFutureVisitLocally(id);
        renderFutureAppointments();
      } else {
        state.hiddenAppointmentIds = state.hiddenAppointmentIds || [];
        if (state.hiddenAppointmentIds.indexOf(id) === -1) {
          state.hiddenAppointmentIds.push(id);
        }
        removeVisitLocally(id);
        render();
      }
      closeDeleteModal();
      showToast("Googleカレンダーの予定を削除しました");
    }).catch(function (err) {
      console.warn("calendar/analysis event delete failed", err);
      closeDeleteModal();
      var msg = "削除に失敗しました。もう一度お試しください";
      if (err && err.type === "forbidden") {
        msg = "削除権限がありません。ログアウトして再度ログインしてください";
      } else if (err && (err.type === "unauthorized" || err.type === "unauthenticated")) {
        msg = "ログインの有効期限が切れています。再度ログインしてください";
      }
      showToast(msg);
    }).then(function () {
      els.deleteConfirmBtn.disabled = false;
      els.deleteConfirmBtn.textContent = "削除する";
    });
  }

  // ---- events ----

  els.addWalkinBtn.addEventListener("click", openWalkinModal);
  els.walkinCancelBtn.addEventListener("click", closeWalkinModal);
  els.walkinModal.addEventListener("click", function (e) {
    if (e.target === els.walkinModal) closeWalkinModal();
  });
  els.walkinConfirmBtn.addEventListener("click", confirmWalkin);

  els.deleteCancelBtn.addEventListener("click", closeDeleteModal);
  els.deleteModal.addEventListener("click", function (e) {
    if (e.target === els.deleteModal) closeDeleteModal();
  });
  els.deleteConfirmBtn.addEventListener("click", confirmDelete);

  if (els.historyDetailCloseBtn) els.historyDetailCloseBtn.addEventListener("click", closeHistoryDetail);
  if (els.historyDetailModal) {
    els.historyDetailModal.addEventListener("click", function (e) {
      if (e.target === els.historyDetailModal) closeHistoryDetail();
    });
  }

  render();
  renderHistory();
  syncCalendar();
  if (window.Auth) Auth.onChange(syncCalendar);
  setInterval(render, 30000);

  flushLocationQueue();
  if (window.Auth) Auth.onChange(flushLocationQueue);
  window.addEventListener("online", flushLocationQueue);
})();
