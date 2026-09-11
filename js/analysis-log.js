(function () {
  "use strict";

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

  // 見出し比較用: 空白(改行含む)を全部除去して小文字化する
  function normalizeForMatch(s) {
    return String(s || "").replace(/\s+/g, "").toLowerCase();
  }

  function columnLetter(idx) {
    var s = "";
    idx = idx + 1;
    while (idx > 0) {
      var rem = (idx - 1) % 26;
      s = String.fromCharCode(65 + rem) + s;
      idx = Math.floor((idx - 1) / 26);
    }
    return s;
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

  // cols(field名→列index)を使って、指定フィールドだけを埋めた行配列を作る(他は空欄)
  function buildRowValues(cols, valuesByField) {
    var maxIdx = 0;
    Object.keys(cols).forEach(function (f) { if (cols[f] > maxIdx) maxIdx = cols[f]; });
    var row = [];
    for (var i = 0; i <= maxIdx; i++) row.push("");
    Object.keys(valuesByField).forEach(function (f) {
      if (cols[f] != null) row[cols[f]] = valuesByField[f];
    });
    return row;
  }

  function updateRange(fileId, sheetTitle, a1Range, values) {
    var range = ProductSource.quoteSheetTitle(sheetTitle) + "!" + a1Range;
    var url = "https://sheets.googleapis.com/v4/spreadsheets/" + encodeURIComponent(fileId) +
      "/values/" + encodeURIComponent(range) + "?valueInputOption=USER_ENTERED";
    return GoogleApi.fetchJson(url, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ values: values })
    });
  }

  function appendRow(fileId, sheetTitle, rowValues, rangeSuffix) {
    var range = ProductSource.quoteSheetTitle(sheetTitle) + "!" + (rangeSuffix || "A:Z");
    var url = "https://sheets.googleapis.com/v4/spreadsheets/" + encodeURIComponent(fileId) +
      "/values/" + encodeURIComponent(range) + ":append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS";
    return GoogleApi.fetchJson(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ values: [rowValues] })
    });
  }

  function findRowNumber(rows, cols, dateTimeStr, venue, itemCode) {
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      if (cellEquals(r, cols.dateTime, dateTimeStr) && cellEquals(r, cols.venue, venue) && cellEquals(r, cols.itemCode, itemCode)) {
        return i + 2; // ヘッダー行(1行目)を除いたオフセット
      }
    }
    return -1;
  }

  // params: { dateTimeStr, venue, type("アポ"|"Walk In"), products: [{itemCode, name, stockMin, stockMax, usageMin, usageMax, priceMin, priceMax, remarks, rank}] }
  function logNippouSubmission(params) {
    return getAnalysisFile().then(function (file) {
      return getColumnMap(file).then(function (cols) {
        return ProductSource.getSheetValues(file.fileId, file.sheetTitle, VALUES_RANGE).then(function (rows) {
          var ops = params.products.map(function (p) {
            var rowNum = findRowNumber(rows, cols, params.dateTimeStr, params.venue, p.itemCode);
            var fields = {
              stockMin: p.stockMin, stockMax: p.stockMax, usageMin: p.usageMin, usageMax: p.usageMax,
              priceMin: p.priceMin, priceMax: p.priceMax, remarks: p.remarks, rank: p.rank
            };
            if (rowNum !== -1) {
              var writes = Object.keys(fields)
                .filter(function (f) { return cols[f] != null; })
                .map(function (f) {
                  var col = columnLetter(cols[f]);
                  return updateRange(file.fileId, file.sheetTitle, col + rowNum + ":" + col + rowNum, [[fields[f]]]);
                });
              return Promise.all(writes);
            }
            // アポ側で対応行が見つからない場合(想定外)も含め、安全側に倒して新規追加する
            fields.dateTime = params.dateTimeStr;
            fields.venue = params.venue;
            fields.itemCode = p.itemCode;
            fields.name = p.name;
            fields.type = params.type;
            return appendRow(file.fileId, file.sheetTitle, buildRowValues(cols, fields));
          });
          return Promise.all(ops);
        });
      });
    });
  }

  function batchUpdateSheet(fileId, requests) {
    var url = "https://sheets.googleapis.com/v4/spreadsheets/" + encodeURIComponent(fileId) + ":batchUpdate";
    return GoogleApi.fetchJson(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requests: requests })
    });
  }

  // 行番号が大きい順に並べる: 上の行から消すと下の行番号がずれるため、下から順に消す
  function buildDeleteRowRequests(sheetId, rowNums) {
    return rowNums.slice().sort(function (a, b) { return b - a; }).map(function (rowNum) {
      return {
        deleteDimension: {
          range: {
            sheetId: sheetId,
            dimension: "ROWS",
            startIndex: rowNum - 1, // 0始まり・半開区間
            endIndex: rowNum
          }
        }
      };
    });
  }

  function deleteSheetRow(fileId, sheetId, rowNum) {
    return batchUpdateSheet(fileId, buildDeleteRowRequests(sheetId, [rowNum]));
  }

  // 商品を1件削除したときに、対応するAnalysis行があれば一緒に削除する。
  // 該当行が無ければ(=まだ提出されていなかった商品)何もしない。
  // params: { dateTimeStr, venue, itemCode }
  function deleteProductRow(params) {
    return getAnalysisFile().then(function (file) {
      return getColumnMap(file).then(function (cols) {
        return ProductSource.getSheetValues(file.fileId, file.sheetTitle, VALUES_RANGE).then(function (rows) {
          var rowNum = findRowNumber(rows, cols, params.dateTimeStr, params.venue, params.itemCode);
          if (rowNum === -1) return null;
          return deleteSheetRow(file.fileId, file.sheetId, rowNum);
        });
      });
    });
  }

  // 訪問(日時+訪問先)に紐づくAnalysis行を全部削除する。予定削除時に使う。
  // 該当行が無ければ(=まだ日報が提出されていなかった訪問)何もしない。
  // params: { dateTimeStr, venue }
  function deleteVisitRows(params) {
    return getAnalysisFile().then(function (file) {
      return getColumnMap(file).then(function (cols) {
        return ProductSource.getSheetValues(file.fileId, file.sheetTitle, VALUES_RANGE).then(function (rows) {
          var rowNums = [];
          for (var i = 0; i < rows.length; i++) {
            if (cellEquals(rows[i], cols.dateTime, params.dateTimeStr) && cellEquals(rows[i], cols.venue, params.venue)) {
              rowNums.push(i + 2);
            }
          }
          if (rowNums.length === 0) return null;
          return batchUpdateSheet(file.fileId, buildDeleteRowRequests(file.sheetId, rowNums));
        });
      });
    });
  }

  // params: { dateTimeStr, venue, memo }
  function logNeeds(params) {
    return getAnalysisFile().then(function (file) {
      return getColumnMap(file).then(function (cols) {
        return ProductSource.getSheetValues(file.fileId, file.sheetTitle, VALUES_RANGE).then(function (rows) {
          var rowNums = [];
          for (var i = 0; i < rows.length; i++) {
            if (cellEquals(rows[i], cols.dateTime, params.dateTimeStr) && cellEquals(rows[i], cols.venue, params.venue)) {
              rowNums.push(i + 2);
            }
          }
          if (rowNums.length === 0) return Promise.reject({ type: "no-matching-rows" });
          if (cols.needs == null) return Promise.reject({ type: "column-not-found" });
          var col = columnLetter(cols.needs);
          return Promise.all(rowNums.map(function (rowNum) {
            return updateRange(file.fileId, file.sheetTitle, col + rowNum + ":" + col + rowNum, [[params.memo]]);
          }));
        });
      });
    });
  }

  // ---- 位置情報のリアルタイム記録(6章) ----

  var LOCATION_SHEET_TITLE = "Location"; // 新規作成時のタブ名(既存タブの検索はタブ名に頼らない、下記参照)
  var LOCATION_VALUES_RANGE = "A2:F5000";
  var LOCATION_HEADER_SIGNAL_LABELS = ["緯度", "latitude"]; // 他のタブと被らない一意な見出しで判定する
  var cachedLocationSheet = null; // { fileId, sheetId, title }

  // Locationタブは実際にタブ名を変更されたことがある(Location→Visit_Logなど)ため、
  // タブ名ではなく「緯度」相当の見出しを持つタブかどうかで探す(見つからなければnull)。
  function findLocationSheet() {
    if (cachedLocationSheet) return Promise.resolve(cachedLocationSheet);

    return getAnalysisFile().then(function (file) {
      var url = "https://sheets.googleapis.com/v4/spreadsheets/" + encodeURIComponent(file.fileId) +
        "?fields=" + encodeURIComponent("sheets.properties");
      return GoogleApi.fetchJson(url).then(function (data) {
        var sheets = data.sheets || [];

        function checkNext(i) {
          if (i >= sheets.length) return null;
          var props = sheets[i].properties;
          return ProductSource.getSheetValues(file.fileId, props.title, "A1:F1").then(function (rows) {
            var header = rows[0] || [];
            var isLocationTab = header.some(function (cell) {
              var normalized = normalizeForMatch(cell);
              return LOCATION_HEADER_SIGNAL_LABELS.some(function (label) {
                return normalized.indexOf(normalizeForMatch(label)) !== -1;
              });
            });
            if (isLocationTab) return { fileId: file.fileId, sheetId: props.sheetId, title: props.title };
            return checkNext(i + 1);
          });
        }

        return checkNext(0).then(function (found) {
          if (found) cachedLocationSheet = found;
          return found;
        });
      });
    });
  }

  function getOrCreateLocationSheet() {
    return findLocationSheet().then(function (found) {
      if (found) return found;

      return getAnalysisFile().then(function (file) {
        // 「Location」タブがまだ無ければ新規作成し、ヘッダー行も書いておく
        var addUrl = "https://sheets.googleapis.com/v4/spreadsheets/" + encodeURIComponent(file.fileId) + ":batchUpdate";
        return GoogleApi.fetchJson(addUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ requests: [{ addSheet: { properties: { title: LOCATION_SHEET_TITLE } } }] })
        }).then(function (result) {
          var props = result.replies[0].addSheet.properties;
          cachedLocationSheet = { fileId: file.fileId, sheetId: props.sheetId, title: props.title };
          return updateRange(file.fileId, props.title, "A1:F1",
            [["日時", "訪問先", "緯度", "経度", "精度(m)", "地図リンク"]]
          ).then(function () { return cachedLocationSheet; });
        });
      });
    });
  }

  // 予定削除時に、対応するLocation行(到着確認で記録済みの位置情報)があれば一緒に削除する。
  // Locationタブ自体が無い、または該当行が無ければ何もしない。
  // params: { dateTimeStr, venue }
  function deleteLocationRows(params) {
    return findLocationSheet().then(function (sheet) {
      if (!sheet) return null;
      return ProductSource.getSheetValues(sheet.fileId, sheet.title, LOCATION_VALUES_RANGE).then(function (rows) {
        var rowNums = [];
        for (var i = 0; i < rows.length; i++) {
          if (cellEquals(rows[i], 0, params.dateTimeStr) && cellEquals(rows[i], 1, params.venue)) {
            rowNums.push(i + 2);
          }
        }
        if (rowNums.length === 0) return null;
        return batchUpdateSheet(sheet.fileId, buildDeleteRowRequests(sheet.sheetId, rowNums));
      });
    });
  }

  // 到着確認ボタン押下時にその場でリアルタイム書き込みする。
  // 同じ到着(日時+訪問先)からの再送(オフラインキューの再試行)は、既存行があれば上書きする。
  // params: { dateTimeStr, venue, lat, lng, accuracy, mapLink }
  function logLocationRealtime(params) {
    return getOrCreateLocationSheet().then(function (sheet) {
      return ProductSource.getSheetValues(sheet.fileId, sheet.title, LOCATION_VALUES_RANGE).then(function (rows) {
        var rowNum = -1;
        for (var i = 0; i < rows.length; i++) {
          if (cellEquals(rows[i], 0, params.dateTimeStr) && cellEquals(rows[i], 1, params.venue)) {
            rowNum = i + 2;
            break;
          }
        }
        var rowValues = [params.dateTimeStr, params.venue, params.lat, params.lng, params.accuracy, params.mapLink];
        if (rowNum !== -1) {
          return updateRange(sheet.fileId, sheet.title, "A" + rowNum + ":F" + rowNum, [rowValues]);
        }
        return appendRow(sheet.fileId, sheet.title, rowValues, "A:F");
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

  // アポ訪問のオファー商品候補を、Hearing Sheetファイルではなく Analysisシート(GASが
  // HSダウンロード時に事前作成した行)から直接取得する。Hearing Sheetは複数コピーが
  // 作られたり空欄のまま放置されたりして日報側から見て不安定なため、GAS・アプリの両方が
  // 常に読み書きしているAnalysisシートを単一の情報源として使う。
  function collectCandidateRows(rows, cols, matcher) {
    var candidates = [];
    var resolvedDateTimeStr = null;
    for (var i = 0; i < rows.length; i++) {
      if (!matcher(rows[i])) continue;
      var name = cellValue(rows[i], cols.name);
      if (!name) continue;
      if (!resolvedDateTimeStr) resolvedDateTimeStr = cellValue(rows[i], cols.dateTime);
      candidates.push({ itemCode: cellValue(rows[i], cols.itemCode), name: name });
    }
    return { dateTimeStr: resolvedDateTimeStr, candidates: candidates };
  }

  // params: { dateTimeStr, venue }
  // 戻り値: { dateTimeStr, candidates }。dateTimeStrは実際にマッチした行の値(呼び出し元の
  // paramsと食い違う可能性があるため、日報提出時はこちらを使う)。
  function getVisitCandidates(params) {
    return getAnalysisFile().then(function (file) {
      return getColumnMap(file).then(function (cols) {
        return ProductSource.getSheetValues(file.fileId, file.sheetTitle, VALUES_RANGE).then(function (rows) {
          var exact = collectCandidateRows(rows, cols, function (row) {
            return cellEquals(row, cols.dateTime, params.dateTimeStr) && cellEquals(row, cols.venue, params.venue);
          });
          if (exact.candidates.length > 0) return exact;

          // カレンダーの予定時刻とAnalysis側に記録された時刻が、GAS側の生成タイミングの
          // ズレで数分〜数時間食い違うことがある(実例あり)。日時完全一致で見つからない場合は
          // 「同じ日・同じ訪問先」まで条件を緩めて候補を探す。
          var dayPrefix = (params.dateTimeStr || "").split(" ")[0]; // "M/D/YYYY"部分
          if (!dayPrefix) return exact;
          return collectCandidateRows(rows, cols, function (row) {
            return cellValue(row, cols.dateTime).split(" ")[0] === dayPrefix && cellEquals(row, cols.venue, params.venue);
          });
        });
      });
    });
  }

  function dayKeyFromDate(d) {
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
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
