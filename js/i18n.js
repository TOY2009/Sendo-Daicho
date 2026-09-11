// 表示言語の切り替え(日本語/英語)。アプリの文言だけを対象にし、
// ユーザーが入力したデータ(取引先名・商品名・所感メモなど)は一切翻訳しない。
(function () {
  "use strict";

  var STORAGE_KEY = "sendo-lang";
  var DEFAULT_LANG = "ja";

  var DICT = {
    common: {
      back: { ja: "戻る", en: "Back" },
      cancel: { ja: "キャンセル", en: "Cancel" },
      close: { ja: "閉じる", en: "Close" },
      delete: { ja: "削除する", en: "Delete" },
      deleting: { ja: "削除中…", en: "Deleting…" },
      add: { ja: "追加する", en: "Add" },
      retry: { ja: "再試行", en: "Retry" },
      loading: { ja: "読み込み中…", en: "Loading…" }
    },
    weekday: {
      sun: { ja: "日", en: "Sun" },
      mon: { ja: "月", en: "Mon" },
      tue: { ja: "火", en: "Tue" },
      wed: { ja: "水", en: "Wed" },
      thu: { ja: "木", en: "Thu" },
      fri: { ja: "金", en: "Fri" },
      sat: { ja: "土", en: "Sat" }
    },
    weekdayLong: {
      sun: { ja: "日曜日", en: "Sunday" },
      mon: { ja: "月曜日", en: "Monday" },
      tue: { ja: "火曜日", en: "Tuesday" },
      wed: { ja: "水曜日", en: "Wednesday" },
      thu: { ja: "木曜日", en: "Thursday" },
      fri: { ja: "金曜日", en: "Friday" },
      sat: { ja: "土曜日", en: "Saturday" }
    },
    auth: {
      unconfigured: { ja: "Google認証: 未設定です", en: "Google auth not configured" },
      signingIn: { ja: "サインイン中…", en: "Signing in…" },
      loginPrompt: { ja: "Googleアカウントでログインしてください", en: "Please log in with your Google account" },
      loginBtn: { ja: "Googleでログイン", en: "Sign in with Google" },
      logoutBtn: { ja: "ログアウト", en: "Log out" },
      unconfiguredError: { ja: "初期化に失敗しました。再読み込みしてください。", en: "Failed to initialize. Please reload the page." },
      offlineError: { ja: "読み込みに失敗しました(オフラインの可能性があります)。再読み込みしてください。", en: "Failed to load (you may be offline). Please reload the page." },
      deniedError: { ja: "ログインに失敗しました(同意が拒否されたか、ポップアップがブロックされました)", en: "Sign-in failed (consent was declined or the popup was blocked)" }
    },
    index: {
      subtitle: { ja: "TOY Sales Department", en: "TOY Sales Department" },
      ledgerLabel: { ja: "鮮度台帳", en: "Sendo Daicho" },
      ledgerDesc: { ja: "課ごとの商談・フォロー状況を確認", en: "Check deal & follow-up status by team" },
      reportLabel: { ja: "営業報告を入力", en: "Enter Sales Report" },
      reportDesc: { ja: "本日の訪問先に到着・日報を記録", en: "Record arrival & daily report for today's visits" },
      karteLabel: { ja: "カルテを確認", en: "Check Client Records" },
      karteDesc: { ja: "個人ごとの取引・フォロー履歴を確認", en: "Check per-client transaction & follow-up history" }
    },
    schedule: {
      pageTitle: { ja: "本日の予定", en: "Today's Schedule" },
      tickerToday: { ja: "本日の予定", en: "Today" },
      tickerArrived: { ja: "到着済み", en: "Arrived" },
      tickerPending: { ja: "未対応", en: "Pending" },
      headerAppointments: { ja: "アポイントメント", en: "Appointments" },
      headerFuture: { ja: "今後の予定(1週間)", en: "Upcoming (7 days)" },
      headerPending: { ja: "未提出の日報", en: "Unsubmitted Reports" },
      headerHistory: { ja: "過去の日報", en: "Past Reports" },
      addWalkinBtn: { ja: "＋ Walk In を追加", en: "+ Add Walk In" },
      loginToSeeToday: { ja: "Googleアカウントでログインすると本日の予定が表示されます", en: "Log in with Google to see today's schedule" },
      loadingSchedule: { ja: "予定を読み込み中…", en: "Loading schedule…" },
      loadFailed: { ja: "予定の取得に失敗しました", en: "Failed to load schedule" },
      noAppointmentsToday: { ja: "本日のアポイントメントはありません", en: "No appointments today" },
      noWalkinsToday: { ja: "本日のWalk In訪問はまだありません", en: "No walk-in visits yet today" },
      loginToSeeFuture: { ja: "Googleアカウントでログインすると今後の予定が表示されます", en: "Log in with Google to see upcoming appointments" },
      loadingUpcoming: { ja: "予定を読み込み中…", en: "Loading appointments…" },
      loadUpcomingFailed: { ja: "予定の取得に失敗しました", en: "Failed to load appointments" },
      noUpcoming: { ja: "今後{days}日以内の予定はありません", en: "No appointments in the next {days} days" },
      noHistory: { ja: "過去の日報はまだありません", en: "No past reports yet" },
      noPending: { ja: "未提出の日報はありません", en: "No unsubmitted reports" },
      historyLastSubmitted: { ja: "最終提出 ", en: "Last submitted " },
      historyProductCount: { ja: "{n}品", en: "{n} items" },
      historyDetailViewOnly: { ja: "閲覧のみ", en: "view only" },
      historyDetailNoSubmit: { ja: "—", en: "—" },
      historyRank: { ja: "ランク {rank}", en: "Rank {rank}" },
      historyUnrated: { ja: "未評価", en: "Not rated" },
      historyStock: { ja: "仕入れ額/月 (฿)", en: "Monthly purchase (฿)" },
      historyUsage: { ja: "使用量", en: "Usage" },
      historyTargetPrice: { ja: "Target Price (฿)", en: "Target Price (฿)" },
      historyRemarks: { ja: "Remarks", en: "Remarks" },
      arrivedAt: { ja: "到着 {time}", en: "Arrived {time}" },
      badgeDone: { ja: "🟢 完了", en: "🟢 Done" },
      badgeTentative: { ja: "🟡 仮", en: "🟡 Tentative" },
      badgeNotReported: { ja: "🔴 未報告", en: "🔴 Not reported" },
      availableFrom: { ja: "{time} から対応可", en: "Available from {time}" },
      notHandled: { ja: "未対応", en: "Not handled" },
      walkinTimeLabel: { ja: "Walk In", en: "Walk In" },
      walkinModalTitle: { ja: "Walk In 訪問を追加", en: "Add Walk-In Visit" },
      walkinModalText: {
        ja: "アポ紐付けなしの訪問です。追加後、タスク①の「到着確認」ボタンを押すと位置情報・時刻が記録されます。",
        en: "This visit has no linked appointment. After adding it, press task ① \"Confirm arrival\" to record time & location."
      },
      walkinNameLabel: { ja: "店舗名(任意・自由入力)", en: "Store name (optional, free text)" },
      walkinNamePlaceholder: { ja: "例: 未登録の店舗", en: "e.g. Unregistered store" },
      walkinAddedToast: { ja: "Walk Inを追加しました。到着確認ボタンを押してください", en: "Walk-in added. Please press the arrival confirmation button." },
      deleteModalTitle: { ja: "この予定を削除しますか？", en: "Delete this appointment?" },
      deleteTextCalendar: { ja: "「{label}」を削除します。Googleカレンダー側の予定も削除されます。", en: "Delete \"{label}\". The Google Calendar event will also be removed." },
      deleteTextLocal: { ja: "「{label}」をアプリ内の予定から削除します。", en: "Delete \"{label}\" from the in-app schedule." },
      deletedToastLocal: { ja: "削除しました", en: "Deleted" },
      deletedToastCalendar: { ja: "Googleカレンダーの予定を削除しました", en: "Deleted the Google Calendar event" },
      deleteFailed: { ja: "削除に失敗しました。もう一度お試しください", en: "Failed to delete. Please try again." },
      deleteForbidden: { ja: "削除権限がありません。ログアウトして再度ログインしてください", en: "You don't have permission to delete. Please log out and log back in." },
      deleteAuthExpired: { ja: "ログインの有効期限が切れています。再度ログインしてください", en: "Your login has expired. Please log in again." },
      taskArrival: { ja: "① 到着", en: "① Arrival" },
      taskArrivalDoneSub: { ja: "{time} に記録 ・ {locText}", en: "Recorded at {time} ・ {locText}" },
      taskArrivalLocOk: { ja: "位置情報を取得済み", en: "Location captured" },
      taskArrivalLocFail: { ja: "位置情報は取得できませんでした", en: "Could not capture location" },
      taskArrivalPendingSub: { ja: "ボタンを押すと位置情報・時刻を記録します", en: "Press the button to record time & location" },
      taskArrivalBtn: { ja: "📍 到着確認", en: "📍 Confirm arrival" },
      taskArrivalGetting: { ja: "取得中…", en: "Getting…" },
      taskNippou: { ja: "② 日報を書く", en: "② Write report" },
      nippouSubLocked: { ja: "①の後に解放されます", en: "Unlocks after ①" },
      nippouSubDone: { ja: "提出済み(全項目入力済み)", en: "Submitted (all fields complete)" },
      nippouSubTentative: { ja: "提出済み(ランクのみ・一部項目は空欄)", en: "Submitted (rank only, some fields blank)" },
      nippouSubOpen: { ja: "訪問後の商品評価・所感を入力", en: "Enter product evaluation & notes after the visit" },
      nippouEdit: { ja: "編集する", en: "Edit" },
      nippouEnter: { ja: "入力する", en: "Enter" },
      locked: { ja: "ロック中", en: "Locked" },
      taskNeeds: { ja: "③ 新規ニーズ確認", en: "③ New needs check" },
      needsSubLocked: { ja: "②の後に解放されます", en: "Unlocks after ②" },
      needsSubDoneNone: { ja: "特になし", en: "None" },
      needsSubDoneRecorded: { ja: "{memo}({time} 記録)", en: "{memo} (recorded {time})" },
      needsSubOpen: { ja: "訪問先の新しいニーズ・要望を記入(なければ空欄のまま記録可)", en: "Enter the client's new needs/requests (leave blank if none)" },
      needsToggleClose: { ja: "閉じる", en: "Close" },
      needsMemoLabel: { ja: "新規ニーズ・要望メモ(任意)", en: "New needs / request memo (optional)" },
      needsMemoPlaceholder: { ja: "例: 新しいメニューでウニの仕入れを検討中とのこと", en: "e.g. Considering buying uni for a new menu item" },
      needsSaveBtn: { ja: "記録する", en: "Save" },
      needsSaving: { ja: "記録中…", en: "Saving…" },
      needsSavedToastMemo: { ja: "新規ニーズを記録しました", en: "New needs recorded" },
      needsSavedToastNone: { ja: "「特になし」として記録しました", en: "Recorded as \"none\"" },
      needsSaveFailed: { ja: "評価ログへの書き込みに失敗しました。もう一度お試しください", en: "Failed to write to the analysis log. Please try again." },
      repNotConfigured: { ja: "担当者名が未設定です(js/rep-config.js)", en: "Rep name is not configured" },
      analysisFileNotFound: { ja: "評価ログの書き込み先が見つかりませんでした", en: "Could not find the analysis log file" },
      noMatchingRows: { ja: "対応する行が見つかりませんでした", en: "No matching rows found" },
      taskFollowUp: { ja: "④ 課ごとの確認項目", en: "④ Team-specific checklist" },
      taskFollowUpComingSoon: { ja: "近日実装予定です(課ごとに内容が異なります)", en: "Coming soon (content varies by team)" },
      taskFollowUpLocked: { ja: "③の後に解放されます(課ごとに内容が異なります)", en: "Unlocks after ③ (content varies by team)" },
      taskPanelTitle: { ja: "{name} のタスク", en: "{name} tasks" },
      locationAlert: { ja: "この予定には位置情報が登録されていません。カレンダーに登録してください", en: "This appointment has no location set. Please add one in Calendar." },
      arrivingToast: { ja: "📍 位置情報を取得しています…", en: "📍 Getting your location…" },
      arrivedToastOk: { ja: "到着を記録しました(位置情報を取得できました)", en: "Arrival recorded (location captured)" },
      arrivedToastNoLoc: { ja: "到着を記録しました(位置情報は取得できませんでした)", en: "Arrival recorded (location not captured)" }
    },
    nippou: {
      pageTitle: { ja: "日報を書く", en: "Write Report" },
      backToSchedule: { ja: "‹ 本日の予定へ", en: "‹ Back to Schedule" },
      offerProducts: { ja: "オファー商品", en: "Offer Products" },
      rankOnlyRequired: { ja: "ランクのみ必須", en: "Only rank required" },
      addProductBtn: { ja: "＋ 商品を追加", en: "+ Add Product" },
      addProductModalTitle: { ja: "商品を追加", en: "Add Product" },
      selectProductLabel: { ja: "商品を選択", en: "Select product" },
      pageTitleSuffix: { ja: " の日報", en: " Report" },
      loadFailed: { ja: "候補商品の取得に失敗しました", en: "Failed to load candidate products" },
      loadingCandidates: { ja: "候補商品を読み込み中…", en: "Loading candidate products…" },
      notFound: { ja: "対応するHearing Sheetが見つかりませんでした", en: "No matching Hearing Sheet was found" },
      notFoundHint: { ja: "HSダウンロード直後は反映まで数秒〜数十秒かかることがあります", en: "It can take up to several tens of seconds to show up right after HS download" },
      noCandidates: { ja: "候補商品がありません", en: "No candidate products" },
      noCandidatesHint: {
        ja: "評価ログの該当行に商品名が入っていない可能性があります",
        en: "The matching analysis log row may not have a product name filled in"
      },
      noWalkinProducts: { ja: "商品が追加されていません", en: "No products added yet" },
      debugSearchDateTime: { ja: "検索日時: ", en: "Search date/time: " },
      debugSearchVenue: { ja: "検索訪問先: ", en: "Search venue: " },
      debugFoundCount: { ja: "見つかった候補数: ", en: "Candidates found: " },
      stockLabel: { ja: "仕入れ額/月 (฿) ・ Min 〜 Max", en: "Monthly purchase (฿) ・ Min–Max" },
      usageLabel: { ja: "使用量 ・ Min 〜 Max", en: "Usage ・ Min–Max" },
      targetPriceLabel: { ja: "Target Price (฿) ・ Min 〜 Max", en: "Target Price (฿) ・ Min–Max" },
      remarksLabel: { ja: "Remarks", en: "Remarks" },
      remarksPlaceholder: { ja: "所感・特記事項など", en: "Notes, observations, etc." },
      rankLabel: { ja: "評価ランク(必須)", en: "Rank (required)" },
      badgeDone: { ja: "🟢 完了", en: "🟢 Done" },
      badgeTentative: { ja: "🟡 仮", en: "🟡 Tentative" },
      badgeUnrated: { ja: "未評価", en: "Not rated" },
      catalogLoading: { ja: "読み込み中…", en: "Loading…" },
      catalogLoadFailed: { ja: "商品マスタを取得できませんでした", en: "Could not load the product master list" },
      catalogFetchError: { ja: "商品マスタの取得に失敗しました", en: "Failed to fetch the product master list" },
      productAdded: { ja: "商品を追加しました", en: "Product added" },
      productRemoving: { ja: "…", en: "…" },
      productRemovedWithSheet: { ja: "商品を削除しました(評価ログからも削除)", en: "Product removed (also removed from analysis log)" },
      productRemoved: { ja: "商品を削除しました", en: "Product removed" },
      productRemoveFailed: { ja: "評価ログの削除に失敗しました。もう一度お試しください", en: "Failed to delete from the analysis log. Please try again." },
      submitBtnDefault: { ja: "日報を提出する", en: "Submit report" },
      submitBtnResubmit: { ja: "再提出する", en: "Resubmit" },
      submitBtnWriting: { ja: "書き込み中…", en: "Saving…" },
      submitHintAddProducts: { ja: "商品を追加してください", en: "Please add a product" },
      submitHintResubmittable: { ja: "提出済みです(内容を変更して再提出できます)", en: "Already submitted (you can edit and resubmit)" },
      submitHintMissingRank: { ja: "評価ランク未選択の商品が {n} 件あります", en: "{n} product(s) still need a rank" },
      submitHintOptional: { ja: "ランク以外の項目は空欄のままでも提出できます", en: "Fields other than rank can be left blank" },
      submittedToast: { ja: "日報を提出しました", en: "Report submitted" },
      submitFailed: { ja: "評価ログの書き込みに失敗しました。もう一度お試しください", en: "Failed to write to the analysis log. Please try again." },
      repNotConfigured: { ja: "担当者名が未設定です(js/rep-config.js)", en: "Rep name is not configured" },
      analysisFileNotFound: { ja: "評価ログの書き込み先が見つかりませんでした", en: "Could not find the analysis log file" },
      authExpired: { ja: "ログインの有効期限が切れています。再度ログインしてください", en: "Your login has expired. Please log in again." }
    }
  };

  function getLang() {
    try {
      var v = localStorage.getItem(STORAGE_KEY);
      return (v === "en" || v === "ja") ? v : DEFAULT_LANG;
    } catch (e) {
      return DEFAULT_LANG;
    }
  }

  function setLang(lang) {
    try {
      localStorage.setItem(STORAGE_KEY, lang === "en" ? "en" : "ja");
    } catch (e) {
      console.warn("failed to save language preference", e);
    }
    location.reload();
  }

  function interpolate(str, vars) {
    if (!vars) return str;
    return str.replace(/\{(\w+)\}/g, function (m, key) {
      return vars[key] != null ? vars[key] : m;
    });
  }

  // key: "schedule.headerAppointments" のようなドット区切り
  function t(key, vars) {
    var parts = key.split(".");
    var node = DICT;
    for (var i = 0; i < parts.length; i++) {
      node = node && node[parts[i]];
    }
    if (!node) {
      console.warn("i18n: missing key", key);
      return key;
    }
    var lang = getLang();
    var str = node[lang] != null ? node[lang] : node[DEFAULT_LANG];
    return interpolate(str, vars);
  }

  function weekdayLabels() {
    var keys = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
    return keys.map(function (k) { return t("weekday." + k); });
  }

  // 見出し行言語切替UI。ヘッダー内の <div id="lang-switcher-slot"></div> に差し込む
  function renderSwitcher() {
    var slot = document.getElementById("lang-switcher-slot");
    if (!slot) return;
    var lang = getLang();
    slot.innerHTML =
      '<select id="lang-select" class="lang-select" aria-label="Language">' +
        '<option value="ja"' + (lang === "ja" ? " selected" : "") + '>日本語</option>' +
        '<option value="en"' + (lang === "en" ? " selected" : "") + '>English</option>' +
      '</select>';
    document.getElementById("lang-select").addEventListener("change", function (e) {
      setLang(e.target.value);
    });
  }

  // data-i18n="schedule.headerAppointments" を持つ静的要素にまとめて適用
  function applyStaticText() {
    document.querySelectorAll("[data-i18n]").forEach(function (el) {
      el.textContent = t(el.getAttribute("data-i18n"));
    });
    document.querySelectorAll("[data-i18n-placeholder]").forEach(function (el) {
      el.setAttribute("placeholder", t(el.getAttribute("data-i18n-placeholder")));
    });
  }

  window.I18n = {
    t: t,
    getLang: getLang,
    setLang: setLang,
    weekdayLabels: weekdayLabels,
    renderSwitcher: renderSwitcher,
    applyStaticText: applyStaticText
  };

  document.addEventListener("DOMContentLoaded", function () {
    applyStaticText();
    renderSwitcher();
  });
})();
