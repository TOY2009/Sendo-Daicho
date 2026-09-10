(function () {
  "use strict";

  function formatToday() {
    var d = new Date();
    var weekday = ["日", "月", "火", "水", "木", "金", "土"][d.getDay()];
    return d.getFullYear() + "年" + (d.getMonth() + 1) + "月" + d.getDate() + "日(" + weekday + ")";
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
    var weekdayLong = ["日曜日", "月曜日", "火曜日", "水曜日", "木曜日", "金曜日", "土曜日"][d.getDay()];
    todayDateEl.innerHTML =
      '<span class="date-big">' + d.getFullYear() + '.' + pad2(d.getMonth() + 1) + '.' + pad2(d.getDate()) + '</span>' +
      '<span class="date-weekday">' + weekdayLong + '</span>';
  }

  if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) {
    window.addEventListener("load", function () {
      navigator.serviceWorker.register("sw.js").catch(function (err) {
        console.warn("SW registration failed:", err);
      });
    });
  }
})();
