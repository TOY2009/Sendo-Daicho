(function () {
  "use strict";

  // clients: 取引先鮮度一覧の1行 = 1取引先
  // {
  //   name: string,            店舗名
  //   type: string,            業態 / エリア
  //   owner: string,           担当者名
  //   team: string,            所属課
  //   days: number,            最終接触からの経過日数
  //   trend: number[],         発注推移(直近6ヶ月分の数値)
  //   last: number,            直近の発注量
  //   mom: number,             先月比(%、マイナス可)
  //   existing: string[],      既存納品商材
  //   ai: { item: string, reason: string },   AI提案の商材と理由
  //   own: { item: string, reason: string },  営業担当自身の提案案と理由
  //   result: string,          直近訪問の結果・所感
  //   menu: string,            メニュー・仕入れ状況の説明
  //   visits: [string, string, string][]  [日付, 種別(訪問/電話), メモ] の配列
  // }
  var clients = [];

  // reps: 担当者別サマリーの1枚 = 1担当者
  // {
  //   name: string,       担当者名
  //   team: string,       所属課
  //   coverage: number,   フォロー網羅率(%)
  //   atrisk: number,     要フォロー放置件数
  //   momentum: string    担当先 発注モメンタム(例: "+6.2%")
  // }
  var reps = [];

  // handovers: 引継ぎ客の1行 = 1件の引継ぎ
  // {
  //   name: string,     取引先名
  //   from: string,     旧担当(退職/異動などの注記可)
  //   to: string,       新担当
  //   date: string,     引継ぎ日(表示用文字列)
  //   trend: string,    引継ぎ後の発注傾向(表示用文字列)
  //   status: "要注意" | "良好"
  // }
  var handovers = [];

  function cell(row, idx) {
    return (row && idx != null && row[idx] != null) ? String(row[idx]).trim() : "";
  }

  // Analysisシートの生行から取引先ごとに集計する。列位置はAnalysisLog.getColumns()で都度検出したものを使う
  // (列の挿入・並び替えが実際に発生したため、固定インデックスには頼らない)。
  // 「発注推移」「先月比」「AI提案」などはシートに元データが無いため、当面プレースホルダーのまま残す。
  // 「既存納品商材」「経過日数」「訪問ログ」「直近の所感」はシートの実データからそのまま作れるので実データ化する。
  function buildClientsFromRows(rows, cols) {
    var byVenue = {};
    var order = [];

    rows.forEach(function (row) {
      var venue = cell(row, cols.venue);
      if (!venue) return;
      if (!byVenue[venue]) {
        byVenue[venue] = [];
        order.push(venue);
      }
      byVenue[venue].push(row);
    });

    var owner = (window.SENDO_REP_CONFIG && window.SENDO_REP_CONFIG.getRepName) ? window.SENDO_REP_CONFIG.getRepName().trim() : "";

    var result = order.map(function (venue) {
      var venueRows = byVenue[venue];

      var existingMap = {};
      var existing = [];
      var lastContact = null;
      venueRows.forEach(function (row) {
        var d = AnalysisLog.parseAnalysisDateTime(cell(row, cols.dateTime));
        if (d && (!lastContact || d > lastContact)) lastContact = d;
        if (cell(row, cols.rank)) {
          var product = cell(row, cols.name);
          if (product && !existingMap[product]) {
            existingMap[product] = true;
            existing.push(product);
          }
        }
      });

      var days = lastContact ? Math.max(0, Math.floor((Date.now() - lastContact.getTime()) / 86400000)) : 0;

      var visits = venueRows.slice().sort(function (a, b) {
        return cell(b, cols.dateTime).localeCompare(cell(a, cols.dateTime));
      }).map(function (row) {
        var memo = cell(row, cols.needs) || cell(row, cols.remarks) || "";
        return [cell(row, cols.dateTime), cell(row, cols.type) || "訪問", memo];
      });

      var resultText = visits.length > 0 ? (visits[0][2] || "まだ所感の記録がありません") : "まだ所感の記録がありません";

      return {
        name: venue,
        type: "",
        owner: owner,
        team: "",
        days: days,
        trend: [0, 0, 0, 0, 0, 0],
        last: 0,
        mom: 0,
        existing: existing,
        ai: { item: "—", reason: "データ未連携(将来対応)" },
        own: { item: "—", reason: "データ未連携(将来対応)" },
        result: resultText,
        menu: "データ未連携(将来対応)",
        visits: visits
      };
    });

    result.sort(function (a, b) { return b.days - a.days; });
    return result;
  }

  function loadClientsFromAnalysis() {
    if (!window.Auth || !Auth.isLoggedIn() || !window.AnalysisLog) return;
    Promise.all([AnalysisLog.getColumns(), AnalysisLog.getAllRows()]).then(function (results) {
      clients = buildClientsFromRows(results[1], results[0]);
      renderTicker();
      renderClients();
    }).catch(function (err) {
      console.warn("failed to load Analysis rows for ledger", err);
    });
  }

  function freshColor(days) {
    if (days <= 7) return getComputedStyle(document.documentElement).getPropertyValue("--seafoam");
    if (days <= 14) return getComputedStyle(document.documentElement).getPropertyValue("--amber");
    return getComputedStyle(document.documentElement).getPropertyValue("--vermillion");
  }

  function sparkline(data) {
    var w = 100, h = 28, max = Math.max.apply(null, data), min = Math.min.apply(null, data);
    var pts = data.map(function (v, i) {
      var x = (i / (data.length - 1)) * w;
      var y = h - ((v - min) / (max - min || 1)) * h;
      return x + "," + y;
    }).join(" ");
    var trendUp = data[data.length - 1] >= data[0];
    var color = trendUp ? "#3E8E7E" : "#A5201D";
    return '<svg width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '"><polyline points="' + pts + '" fill="none" stroke="' + color + '" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  }

  function renderClients() {
    var tbody = document.getElementById("client-rows");
    if (clients.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6"><div class="empty-hint">取引先データがまだありません</div></td></tr>';
      return;
    }
    tbody.innerHTML = clients.map(function (c, i) {
      var color = freshColor(c.days);
      var pct = Math.max(8, 100 - (c.days * 4));
      var momClass = c.mom >= 0 ? "up" : "down";
      var momSign = c.mom >= 0 ? "+" : "";
      return '<tr onclick="Ledger.openModal(' + i + ')">' +
        '<td>' +
          '<div class="client-name">' + c.name + '</div>' +
          '<div class="client-type">' + c.type + '</div>' +
        '</td>' +
        '<td><span class="owner">' + c.owner + '</span><br><span class="team-tag">' + c.team + '</span></td>' +
        '<td>' +
          '<div class="gauge-wrap">' +
            '<div class="gauge"><div class="fill" style="width:' + pct + '%; background:' + color + ';"></div></div>' +
            '<span class="gauge-days">' + c.days + '日</span>' +
          '</div>' +
        '</td>' +
        '<td>' + sparkline(c.trend) + '</td>' +
        '<td><span class="trend"><span class="amt ' + momClass + '">' + momSign + c.mom + '%</span></span></td>' +
        '<td>' + (c.days > 14 ? '<span class="flag">要フォロー</span>' : '') + '</td>' +
      '</tr>';
    }).join("");
  }

  function renderTicker() {
    var total = clients.length;
    var follow = clients.filter(function (c) { return c.days > 14; }).length;
    var decline = clients.filter(function (c) { return c.mom < 0; }).length;

    document.getElementById("tick-total").textContent = total > 0 ? total : "—";
    document.getElementById("tick-follow").textContent = total > 0 ? follow : "—";
    document.getElementById("tick-decline").textContent = total > 0 ? decline : "—";
    document.getElementById("tick-handover").textContent = handovers.length > 0 ? handovers.length : "—";

    document.getElementById("tick-follow").classList.toggle("warn", follow > 0);
    document.getElementById("tick-decline").classList.toggle("warn", decline > 0);
  }

  function renderReps() {
    var grid = document.getElementById("rep-cards");
    if (reps.length === 0) {
      grid.innerHTML = '<div class="empty-hint">担当者データがまだありません</div>';
      return;
    }
    grid.innerHTML = reps.map(function (r) {
      return '<div class="rep-card">' +
        '<div class="name">' + r.name + '</div>' +
        '<div class="team">' + r.team + '</div>' +
        '<div class="rep-stat"><span>フォロー網羅率</span><span class="v">' + r.coverage + '%</span></div>' +
        '<div class="rep-stat"><span>要フォロー放置件数</span><span class="v" style="color:' + (r.atrisk > 2 ? "var(--vermillion)" : "inherit") + '">' + r.atrisk + '件</span></div>' +
        '<div class="rep-stat"><span>担当先 発注モメンタム</span><span class="v">' + r.momentum + '</span></div>' +
      '</div>';
    }).join("");
  }

  function renderHandover() {
    var tbody = document.getElementById("handover-rows");
    if (handovers.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6"><div class="empty-hint">引継ぎ客データがまだありません</div></td></tr>';
      return;
    }
    tbody.innerHTML = handovers.map(function (h) {
      return '<tr>' +
        '<td class="client-name">' + h.name + '</td>' +
        '<td class="owner">' + h.from + '</td>' +
        '<td class="owner">' + h.to + '</td>' +
        '<td class="mono" style="font-size:12px;">' + h.date + '</td>' +
        '<td style="font-size:12px;">' + h.trend + '</td>' +
        '<td>' + (h.status === "要注意" ? '<span class="flag">要注意</span>' : '<span style="font-size:11px;color:var(--seafoam);">良好</span>') + '</td>' +
      '</tr>';
    }).join("");
  }

  function openModal(i) {
    var c = clients[i];
    var modal = document.getElementById("modal-content");
    modal.innerHTML =
      '<div class="modal-head">' +
        '<div>' +
          '<h2>' + c.name + '</h2>' +
          '<div class="type">' + c.type + ' ・ 担当: ' + c.owner + '(' + c.team + ')</div>' +
        '</div>' +
        '<div class="close" onclick="Ledger.closeModal()">✕</div>' +
      '</div>' +

      '<div class="section-label">メニュー・仕入れ状況</div>' +
      '<div style="font-size:13px; line-height:1.7;">' + c.menu + '</div>' +
      '<div class="kv-row"><span class="k">既存納品商材</span><span>' + c.existing.join(" / ") + '</span></div>' +

      '<div class="section-label">提案準備</div>' +
      '<div class="reco" style="border-left:3px solid var(--seafoam);"><span class="badge ai">AI提案</span><span><b>' + c.ai.item + '</b><br><span style="color:var(--ink-soft);">' + c.ai.reason + '</span></span></div>' +
      '<div class="reco" style="border-left:3px solid var(--amber);"><span class="badge own">自分の案</span><span><b>' + c.own.item + '</b><br><span style="color:var(--ink-soft);">' + c.own.reason + '</span></span></div>' +

      '<div class="section-label">訪問結果</div>' +
      '<div style="font-size:13px; line-height:1.7;">' + c.result + '</div>' +

      '<div class="section-label">訪問ログ</div>' +
      c.visits.map(function (v) {
        return '<div class="visit-log"><span class="d">' + v[0] + " " + v[1] + '</span><span>' + v[2] + '</span></div>';
      }).join("");
    document.getElementById("modal").classList.add("open");
  }

  function closeModal() {
    document.getElementById("modal").classList.remove("open");
  }

  window.Ledger = { openModal: openModal, closeModal: closeModal };

  document.getElementById("modal").addEventListener("click", function (e) {
    if (e.target.id === "modal") closeModal();
  });

  document.querySelectorAll(".tab").forEach(function (tab) {
    tab.addEventListener("click", function () {
      document.querySelectorAll(".tab").forEach(function (t) { t.classList.remove("active"); });
      document.querySelectorAll(".panel").forEach(function (p) { p.classList.remove("active"); });
      tab.classList.add("active");
      document.getElementById("panel-" + tab.dataset.tab).classList.add("active");
    });
  });

  renderTicker();
  renderClients();
  renderReps();
  renderHandover();

  loadClientsFromAnalysis();
  if (window.Auth) Auth.onChange(loadClientsFromAnalysis);
})();
