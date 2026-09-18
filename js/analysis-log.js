(function () {
  "use strict";

  // Analysisファイル({担当者名}_App_Analysis、同ファイル内のLocationタブ含む)は、
  // 担当者本人に「閲覧者」として共有されている(Ryuさんが手動で共有設定する)前提。
  // これにより読み込みは担当者自身のログインで直接Sheets APIを叩けるが、
  // 閲覧者には書き込み権限が無いため、書き込みはRyuさんの権限で動くGAS Webアプリ
  // (gas/AnalysisProxy.gs)経由で行う。これで「担当者は見れるが、本人が直接手で
  // 書き換えることはできない(アプリを通した提出しかできない)」という状態になる。
  var VALUES_RANGE = "A2:N5000";
  var cachedFile = null; // { fileId, sheetTitle, sheetId }

  function repName() {
    return (window.SENDO_REP_CONFIG && window.SENDO_REP_CONFIG.getRepName) ? window.SENDO_REP_CONFIG.getRepName().trim() : "";
  }

  function analysisFileName() {
    return repName() + "_App_Analysis";
  }

  function formatAnalysisDateTime(date) {
    return (date.getMonth() + 1) + "/" + date.getDate() + "/" + date.getFullYear() +
      " " + date.getHours() + ":" + String(date.getMinutes()).padStart(2, "0");
  }

  // formatAnalysisDateTimeの逆変換。ブラウザ依存を避けるため独自にパースする
  function parseAnalysisDateTime(str) {
    var m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})$/.exec((str || "").trim());
    if (!m) return null;
    return new Date(Number(m[3]), Number(m[1]) - 1, Number(m[2]), Number(m[4]), Number(m[5]));
  }

  // ---- 読み込み(担当者自身のViewer権限で直接Sheets APIへ) ----

  function getAnalysisFile() {
    if (cachedFile) return Promise.resolve(cachedFile);
    if (!repName()) return Promise.reject({ type: "rep-not-configured" });

    return ProductSource.searchDriveFileByExactName(analysisFileName()).then(function (file) {
      if (!file) return Promise.reject({ type: "file-not-found" });
      return ProductSource.getFirstSheetInfo(file.id).then(function (info) {
        cachedFile = { fileId: file.id, sheetTitle: info.title, sheetId: info.sheetId };
        return cachedFile;
      });
    });
  }

  function cellEquals(row, idx, value) {
    var v = (row && row[idx] != null) ? String(row[idx]).trim() : "";
    return v === value;
  }

  function cellValue(row, idx) {
    return (row && idx != null && row[idx] != null) ? String(row[idx]).trim() : "";
  }

  // 見出し比較・訪問先名比較用: 空白(改行含む)を全部除去して小文字化する
  function normalizeForMatch(s) {
    return String(s || "").replace(/\s+/g, "").toLowerCase();
  }

  // 訪問先名は「カレンダーの予定名」と「HearingSheetに手入力されたCustomer Name」という
  // 別々の入力元から来ているため、大文字小文字・前後や連続スペースの違いだけで一致しないことがある。
  function venueEquals(row, idx, value) {
    return normalizeForMatch(cellValue(row, idx)) === normalizeForMatch(value);
  }

  // Analysisシートの列構成は今後も変わりうる(実際に列の挿入・並び替えが発生した)ため、
  // 固定の列アルファベットに頼らず、見出し行(1行目)のラベル文字列で列位置を都度検出する。
  // シート側の見出しが日本語→英語に変更されたことがあるため、両方受け付ける
  var COLUMN_LABELS = {
    dateTime: ["日時", "date/time"],
    venue: ["訪問先", "customername"],
    itemCode: ["itemcode"],
    name: ["offerproduct"],
    stockMin: ["仕入れ額min", "purchasepricemin"],
    stockMax: ["仕入れ額max", "purchasepricemax"],
    usageMin: ["使用量min", "usagemin"],
    usageMax: ["使用量max", "usagemax"],
    priceMin: ["targetpricemin"],
    priceMax: ["targetpricemax"],
    remarks: ["remarks"],
    type: ["種別", "type"],
    rank: ["ランク", "rank"],
    needs: ["新規ニーズ", "newneeds"]
  };

  var cachedColumns = null; // { fileId, map: {field: colIndex} }

  function getColumnMap(file) {
    if (cachedColumns && cachedColumns.fileId === file.fileId) return Promise.resolve(cachedColumns.map);
    return ProductSource.getSheetValues(file.fileId, file.sheetTitle, "A1:Z1").then(function (rows) {
      var header = rows[0] || [];
      var map = {};
      Object.keys(COLUMN_LABELS).forEach(function (field) {
        var labels = COLUMN_LABELS[field];
        for (var i = 0; i < header.length; i++) {
          var normalized = normalizeForMatch(header[i]);
          var found = labels.some(function (label) { return normalized.indexOf(normalizeForMatch(label)) !== -1; });
          if (found) { map[field] = i; break; }
        }
      });
      cachedColumns = { fileId: file.fileId, map: map };
      return map;
    });
  }

  function dayKeyFromDate(d) {
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }

  function collectCandidateRows(rows, cols, matcher) {
    var candidates = [];
    var resolvedDateTimeStr = null;
    var resolvedVenue = null;
    for (var i = 0; i < rows.length; i++) {
      if (!matcher(rows[i])) continue;
      var name = cellValue(rows[i], cols.name);
      if (!name) continue;
      if (!resolvedDateTimeStr) {
        resolvedDateTimeStr = cellValue(rows[i], cols.dateTime);
        resolvedVenue = cellValue(rows[i], cols.venue);
      }
      candidates.push({ itemCode: cellValue(rows[i], cols.itemCode), name: name });
    }
    return { dateTimeStr: resolvedDateTimeStr, venue: resolvedVenue, candidates: candidates };
  }

  // アポ訪問のオファー商品候補を、Hearing Sheetファイルではなく Analysisシート(GASが
  // HSダウンロード時に事前作成した行)から直接取得する。
  // params: { dateTimeStr, venue }
  // 戻り値: { dateTimeStr, venue, candidates }。dateTimeStr/venueは実際にマッチした行の値
  // (呼び出し元のparamsと食い違う可能性があるため、日報提出時はこちらを使う)。
  function getVisitCandidates(params) {
    return getAnalysisFile().then(function (file) {
      return getColumnMap(file).then(function (cols) {
        return ProductSource.getSheetValues(file.fileId, file.sheetTitle, VALUES_RANGE).then(function (rows) {
          var exact = collectCandidateRows(rows, cols, function (row) {
            return cellEquals(row, cols.dateTime, params.dateTimeStr) && venueEquals(row, cols.venue, params.venue);
          });
          if (exact.candidates.length > 0) return exact;

          // カレンダーの予定時刻とAnalysis側に記録された時刻が、GAS側の生成タイミングの
          // ズレで数分〜数時間食い違うことがある(実例あり)。日時完全一致で見つからない場合は
          // 「同じ日・同じ訪問先」まで条件を緩めて候補を探す。
          var dayPrefix = (params.dateTimeStr || "").split(" ")[0]; // "M/D/YYYY"部分
          if (!dayPrefix) return exact;
          return collectCandidateRows(rows, cols, function (row) {
            return cellValue(row, cols.dateTime).split(" ")[0] === dayPrefix && venueEquals(row, cols.venue, params.venue);
          });
        });
      });
    });
  }

  // ブラウザのキャッシュ・localStorageが消えても「提出済み」データ自体は失われないよう、
  // 過去の日報(履歴)をlocalStorageだけでなくAnalysisシート本体からも復元できるようにする。
  // ランクが入っている行=提出済みとみなす(提出時にランクを含めて一括で書き込むため)。
  function getSubmittedHistory() {
    return getAnalysisFile().then(function (file) {
      return getColumnMap(file).then(function (cols) {
        if (cols.dateTime == null || cols.venue == null || cols.rank == null) return [];
        return ProductSource.getSheetValues(file.fileId, file.sheetTitle, VALUES_RANGE).then(function (rows) {
          var byVisit = {};
          var order = [];
          rows.forEach(function (row) {
            var dateTimeStr = cellValue(row, cols.dateTime);
            var venue = cellValue(row, cols.venue);
            var rank = cellValue(row, cols.rank);
            if (!dateTimeStr || !venue || !rank) return;
            var visitDate = parseAnalysisDateTime(dateTimeStr);
            if (!visitDate) return;
            var key = dateTimeStr + "|" + venue;
            if (!byVisit[key]) {
              byVisit[key] = { dateKey: dayKeyFromDate(visitDate), name: venue, submittedAt: null, products: [] };
              order.push(key);
            }
            byVisit[key].products.push({
              name: cellValue(row, cols.name),
              itemCode: cellValue(row, cols.itemCode),
              stockMin: cellValue(row, cols.stockMin), stockMax: cellValue(row, cols.stockMax),
              usageMin: cellValue(row, cols.usageMin), usageMax: cellValue(row, cols.usageMax),
              priceMin: cellValue(row, cols.priceMin), priceMax: cellValue(row, cols.priceMax),
              remarks: cellValue(row, cols.remarks), rank: rank
            });
          });
          return order.map(function (key) { return byVisit[key]; });
        });
      });
    });
  }

  // 未提出の訪問も、localStorageではなくAnalysisシート本体だけを正とする。
  // GASがHSダウンロード時に候補行(Item Code・Offer Product)を事前に作るので、
  // その行群の中にランク未記入のものが1つでもあれば「まだ日報が完了していない」とみなす。
  // (Walk Inのようにシートへ一切書き込まれていない訪問はそもそも検出対象に出来ない)
  function getPendingVisits() {
    return getAnalysisFile().then(function (file) {
      return getColumnMap(file).then(function (cols) {
        if (cols.dateTime == null || cols.venue == null) return [];
        return ProductSource.getSheetValues(file.fileId, file.sheetTitle, VALUES_RANGE).then(function (rows) {
          var byVisit = {};
          var order = [];
          rows.forEach(function (row) {
            var dateTimeStr = cellValue(row, cols.dateTime);
            var venue = cellValue(row, cols.venue);
            var name = cellValue(row, cols.name);
            if (!dateTimeStr || !venue || !name) return;
            var rank = cols.rank != null ? cellValue(row, cols.rank) : "";
            var key = dateTimeStr + "|" + venue;
            if (!byVisit[key]) {
              byVisit[key] = { dateTimeStr: dateTimeStr, venue: venue, hasUnranked: false };
              order.push(key);
            }
            if (!rank) byVisit[key].hasUnranked = true;
          });
          return order
            .map(function (key) { return byVisit[key]; })
            .filter(function (v) { return v.hasUnranked; })
            .map(function (v) {
              var visitDate = parseAnalysisDateTime(v.dateTimeStr);
              return {
                dateKey: visitDate ? dayKeyFromDate(visitDate) : "",
                name: v.venue,
                visitStart: visitDate ? visitDate.toISOString() : ""
              };
            });
        });
      });
    });
  }

  // 鮮度台帳(ledger.html)用: 全行をそのまま返す(集計・加工は呼び出し側で行う)
  function getAllRows() {
    return getAnalysisFile().then(function (file) {
      return ProductSource.getSheetValues(file.fileId, file.sheetTitle, VALUES_RANGE);
    });
  }

  // 鮮度台帳(ledger.html)用: 列位置マップを取得(field名→0始まりの列index)
  function getColumns() {
    return getAnalysisFile().then(function (file) {
      return getColumnMap(file);
    });
  }

  // ---- 書き込み(閲覧者は書けないため、Ryuさんの権限で動くGAS Webアプリ経由) ----

  // Apps ScriptのdoPost(e)はカスタムHTTPヘッダーを読み取れないため、アクセストークンは
  // Authorizationヘッダーではなくリクエストボディに含める。またブラウザのfetch()が
  // CORSプリフライトに引っかからないよう、Content-Typeはtext/plainにする
  // (中身はJSON文字列のままで、doPost側がJSON.parseする)。
  function callProxy(action, params) {
    var config = window.SENDO_ANALYSIS_PROXY_CONFIG || {};
    if (!config.url) return Promise.reject({ type: "proxy-not-configured" });
    if (!window.Auth || !Auth.isLoggedIn()) return Promise.reject({ type: "unauthenticated" });

    return fetch(config.url, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ accessToken: Auth.getAccessToken(), action: action, params: params || {} })
    }).then(function (res) {
      return res.text().then(function (text) {
        var json;
        try { json = JSON.parse(text); } catch (e) { throw { type: "http-error", status: res.status }; }
        if (!json.ok) throw (json.error || { type: "unknown-error" });
        return json.data;
      });
    });
  }

  // params: { dateTimeStr, venue, type("アポ"|"Walk In"), products: [{itemCode, name, stockMin, stockMax, usageMin, usageMax, priceMin, priceMax, remarks, rank}] }
  function logNippouSubmission(params) {
    return callProxy("logNippouSubmission", params);
  }

  // params: { dateTimeStr, venue, memo }
  function logNeeds(params) {
    return callProxy("logNeeds", params);
  }

  // params: { dateTimeStr, venue, itemCode }
  function deleteProductRow(params) {
    return callProxy("deleteProductRow", params);
  }

  // params: { dateTimeStr, venue }
  function deleteVisitRows(params) {
    return callProxy("deleteVisitRows", params);
  }

  // params: { dateTimeStr, venue }
  function deleteLocationRows(params) {
    return callProxy("deleteLocationRows", params);
  }

  // 到着確認ボタン押下時にその場でリアルタイム書き込みする。
  // 同じ到着(日時+訪問先)からの再送(オフラインキューの再試行)は、既存行があれば上書きする。
  // params: { dateTimeStr, venue, lat, lng, accuracy, mapLink }
  function logLocationRealtime(params) {
    return callProxy("logLocationRealtime", params);
  }

  window.AnalysisLog = {
    formatAnalysisDateTime: formatAnalysisDateTime,
    parseAnalysisDateTime: parseAnalysisDateTime,
    logNippouSubmission: logNippouSubmission,
    logNeeds: logNeeds,
    deleteProductRow: deleteProductRow,
    deleteVisitRows: deleteVisitRows,
    deleteLocationRows: deleteLocationRows,
    getColumns: getColumns,
    getAllRows: getAllRows,
    getVisitCandidates: getVisitCandidates,
    getSubmittedHistory: getSubmittedHistory,
    getPendingVisits: getPendingVisits,
    logLocationRealtime: logLocationRealtime
  };
})();
