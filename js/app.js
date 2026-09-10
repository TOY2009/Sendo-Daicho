(function () {
  "use strict";

  var WEEKDAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
  var WEEKDAY_JA = ["日", "月", "火", "水", "木", "金", "土"];
  var WEEKDAY_LONG_JA = ["日曜日", "月曜日", "火曜日", "水曜日", "木曜日", "金曜日", "土曜日"];

  // i18n.jsを読み込んでいないページ(karte.htmlなど)でも壊れないよう、
  // 未読み込み時は日本語のフォールバックを使う
  function weekday(dayIndex) {
    return window.I18n ? I18n.t("weekday." + WEEKDAY_KEYS[dayIndex]) : WEEKDAY_JA[dayIndex];
  }

  function weekdayLong(dayIndex) {
    return window.I18n ? I18n.t("weekdayLong." + WEEKDAY_KEYS[dayIndex]) : WEEKDAY_LONG_JA[dayIndex];
  }

  function formatToday() {
    var d = new Date();
    return d.getFullYear() + "年" + (d.getMonth() + 1) + "月" + d.getDate() + "日(" + weekday(d.getDay()) + ")";
  }

  function pad2(n) {
    return String(n).padStart(2, "0");
  }

  document.querySelectorAll("[data-today]").forEach(function (el) {
    el.textContent = formatToday();
  });

  var todayDateEl = document.getElementById("today-date");
  if (todayDateEl) {
    var d = new Date();
    todayDateEl.innerHTML =
      '<span class="date-big">' + d.getFullYear() + '.' + pad2(d.getMonth() + 1) + '.' + pad2(d.getDate()) + '</span>' +
      '<span class="date-weekday">' + weekdayLong(d.getDay()) + '</span>';
  }

  if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) {
    window.addEventListener("load", function () {
      navigator.serviceWorker.register("sw.js").catch(function (err) {
        console.warn("SW registration failed:", err);
      });
    });
  }
})();
