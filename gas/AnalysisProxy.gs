/**
 * Analysis Proxy
 *
 * 担当者の{担当者名}_App_Analysisファイルは共有されていない(Ryuさんだけがアクセス権を持つ)。
 * このスクリプトはRyuさんのGoogleアカウントに紐づくプロジェクトに追加し、
 * Webアプリとして「Execute as: Me」「Who has access: Anyone」でデプロイする。
 * そうすると、誰が呼び出しても実際のSheets操作はRyuさんの権限で行われるので、
 * 担当者本人にAnalysisファイルを共有しなくても、PWAから候補取得・日報提出・
 * 位置情報記録・削除・履歴取得ができるようになる。
 *
 * なりすまし対策: リクエストに含まれる担当者自身のGoogleアクセストークンを
 * https://www.googleapis.com/oauth2/v3/userinfo に投げて検証し、Google側が
 * 返してきた検証済みの名前(name)だけを担当者名として使う。クライアントが
 * 「自分は誰だ」と申告してきた文字列は一切信用しない。
 *
 * 重要: Apps ScriptのdoPost(e)はカスタムHTTPヘッダー(Authorization等)を
 * 読み取れないため、アクセストークンは"リクエストボディの中"に入れて送ってもらう
 * (PWA側は { accessToken, action, params } というJSONをPOSTする)。
 * また、ブラウザのfetch()からCORSプリフライトに引っかからないよう、PWA側は
 * Content-Type: text/plain;charset=utf-8 で送ること(中身はJSON文字列のままでよい。
 * doPostは中身をJSON.parseするだけなので、宣言上のContent-Typeは関係ない)。
 */

var VALUES_RANGE_START_ROW = 2;
var VALUES_MAX_ROW = 5000;

// Analysisシートの列構成は今後も変わりうるため、固定の列位置に頼らず
// 見出し行(1行目)のラベル文字列で列位置を都度検出する。日英どちらの表記も受け付ける。
var COLUMN_LABELS = {
  dateTime: ['日時', 'date/time'],
  venue: ['訪問先', 'customername'],
  itemCode: ['itemcode'],
  name: ['offerproduct'],
  stockMin: ['仕入れ額min', 'purchasepricemin'],
  stockMax: ['仕入れ額max', 'purchasepricemax'],
  usageMin: ['使用量min', 'usagemin'],
  usageMax: ['使用量max', 'usagemax'],
  priceMin: ['targetpricemin'],
  priceMax: ['targetpricemax'],
  remarks: ['remarks'],
  type: ['種別', 'type'],
  rank: ['ランク', 'rank'],
  needs: ['新規ニーズ', 'newneeds']
};

var LOCATION_HEADER_SIGNAL_LABELS = ['緯度', 'latitude'];
var LOCATION_SHEET_TITLE = 'Location';

// ---- エントリーポイント ----

function doPost(e) {
  var body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (parseErr) {
    return jsonOutput_({ ok: false, error: { type: 'bad-request' } });
  }

  try {
    var caller = verifyCaller_(body.accessToken);
    var repName = caller.name;
    if (!repName) throw { type: 'rep-not-configured' };

    var ss = getAnalysisSpreadsheet_(repName);
    var params = body.params || {};
    var data;

    switch (body.action) {
      case 'getVisitCandidates': data = actionGetVisitCandidates_(ss, params); break;
      case 'logNippouSubmission': data = actionLogNippouSubmission_(ss, params); break;
      case 'logNeeds': data = actionLogNeeds_(ss, params); break;
      case 'deleteProductRow': data = actionDeleteProductRow_(ss, params); break;
      case 'deleteVisitRows': data = actionDeleteVisitRows_(ss, params); break;
      case 'deleteLocationRows': data = actionDeleteLocationRows_(ss, params); break;
      case 'logLocationRealtime': data = actionLogLocationRealtime_(ss, params); break;
      case 'getSubmittedHistory': data = actionGetSubmittedHistory_(ss); break;
      case 'getPendingVisits': data = actionGetPendingVisits_(ss); break;
      case 'getLedgerData': data = actionGetLedgerData_(ss); break;
      default: throw { type: 'unknown-action' };
    }

    return jsonOutput_({ ok: true, data: data });
  } catch (err) {
    var errType = (err && err.type) ? err.type : 'internal-error';
    Logger.log('doPost error: ' + (err && err.stack ? err.stack : JSON.stringify(err)));
    return jsonOutput_({ ok: false, error: { type: errType } });
  }
}

function jsonOutput_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// ---- 認証 ----

function verifyCaller_(accessToken) {
  if (!accessToken) throw { type: 'unauthenticated' };
  var resp = UrlFetchApp.fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { Authorization: 'Bearer ' + accessToken },
    muteHttpExceptions: true
  });
  if (resp.getResponseCode() !== 200) throw { type: 'unauthenticated' };
  var info = JSON.parse(resp.getContentText());
  if (!info.email) throw { type: 'unauthenticated' };
  return { email: info.email, name: (info.name || '').trim() };
}

// ---- ファイル検索・列マッピング ----

function findFileByExactName_(name) {
  var it = DriveApp.searchFiles(
    "title = '" + name.replace(/'/g, "\\'") + "' and trashed = false"
  );
  var best = null;
  while (it.hasNext()) {
    var f = it.next();
    if (!best || f.getLastUpdated() > best.getLastUpdated()) best = f;
  }
  return best;
}

function getAnalysisSpreadsheet_(repName) {
  var file = findFileByExactName_(repName + '_App_Analysis');
  if (!file) throw { type: 'file-not-found' };
  return SpreadsheetApp.openById(file.getId());
}

function normalizeForMatch_(s) {
  return String(s || '').replace(/\s+/g, '').toLowerCase();
}

function getMainSheet_(ss) {
  return ss.getSheets()[0];
}

function getColumnMap_(sheet) {
  var lastCol = sheet.getLastColumn();
  var header = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var map = {};
  Object.keys(COLUMN_LABELS).forEach(function (field) {
    var labels = COLUMN_LABELS[field];
    for (var i = 0; i < header.length; i++) {
      var normalized = normalizeForMatch_(header[i]);
      var found = labels.some(function (label) { return normalized.indexOf(normalizeForMatch_(label)) !== -1; });
      if (found) { map[field] = i; break; }
    }
  });
  return map;
}

function getAllValues_(sheet) {
  var lastRow = sheet.getLastRow();
  if (lastRow < VALUES_RANGE_START_ROW) return [];
  var numRows = Math.min(lastRow, VALUES_MAX_ROW) - VALUES_RANGE_START_ROW + 1;
  return sheet.getRange(VALUES_RANGE_START_ROW, 1, numRows, sheet.getLastColumn()).getValues();
}

function cellValue_(row, idx) {
  return (row && idx != null && row[idx] != null) ? String(row[idx]).trim() : '';
}

function cellEquals_(row, idx, value) {
  return cellValue_(row, idx) === String(value || '').trim();
}

function venueEquals_(row, idx, value) {
  return normalizeForMatch_(cellValue_(row, idx)) === normalizeForMatch_(value);
}

function columnLetter_(idx) {
  var s = '';
  idx = idx + 1;
  while (idx > 0) {
    var rem = (idx - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    idx = Math.floor((idx - 1) / 26);
  }
  return s;
}

// M/D/YYYY H:MM 形式の逆変換(PWA側のformatAnalysisDateTimeと対になる)
function parseAnalysisDateTime_(str) {
  var m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})$/.exec(String(str || '').trim());
  if (!m) return null;
  return new Date(Number(m[3]), Number(m[1]) - 1, Number(m[2]), Number(m[4]), Number(m[5]));
}

function dayKeyFromDate_(d) {
  return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
}

// ---- 行検索(日時完全一致 → 同日+訪問先までフォールバック) ----

function findRowNumber_(rows, cols, dateTimeStr, venue, itemCode) {
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    if (cellEquals_(r, cols.dateTime, dateTimeStr) && venueEquals_(r, cols.venue, venue) && cellEquals_(r, cols.itemCode, itemCode)) {
      return i + VALUES_RANGE_START_ROW;
    }
  }
  return -1;
}

function findVisitRowNums_(rows, cols, dateTimeStr, venue) {
  var exact = [];
  for (var i = 0; i < rows.length; i++) {
    if (cellEquals_(rows[i], cols.dateTime, dateTimeStr) && venueEquals_(rows[i], cols.venue, venue)) exact.push(i + VALUES_RANGE_START_ROW);
  }
  if (exact.length > 0) return exact;

  var dayPrefix = String(dateTimeStr || '').split(' ')[0];
  if (!dayPrefix) return exact;
  var sameDay = [];
  for (var j = 0; j < rows.length; j++) {
    if (String(cellValue_(rows[j], cols.dateTime)).split(' ')[0] === dayPrefix && venueEquals_(rows[j], cols.venue, venue)) sameDay.push(j + VALUES_RANGE_START_ROW);
  }
  return sameDay;
}

function collectCandidateRows_(rows, cols, matcher) {
  var candidates = [];
  var resolvedDateTimeStr = null;
  var resolvedVenue = null;
  for (var i = 0; i < rows.length; i++) {
    if (!matcher(rows[i])) continue;
    var name = cellValue_(rows[i], cols.name);
    if (!name) continue;
    if (!resolvedDateTimeStr) {
      resolvedDateTimeStr = cellValue_(rows[i], cols.dateTime);
      resolvedVenue = cellValue_(rows[i], cols.venue);
    }
    candidates.push({ itemCode: cellValue_(rows[i], cols.itemCode), name: name });
  }
  return { dateTimeStr: resolvedDateTimeStr, venue: resolvedVenue, candidates: candidates };
}

// ---- 書き込みヘルパー ----

function deleteRowsDescending_(sheet, rowNums) {
  rowNums.slice().sort(function (a, b) { return b - a; }).forEach(function (r) { sheet.deleteRow(r); });
}

function buildRowValues_(cols, valuesByField, numCols) {
  var row = [];
  for (var i = 0; i < numCols; i++) row.push('');
  Object.keys(valuesByField).forEach(function (f) {
    if (cols[f] != null) row[cols[f]] = valuesByField[f];
  });
  return row;
}

// ---- actions: メイン(Analysis)シート ----

function actionGetVisitCandidates_(ss, params) {
  var sheet = getMainSheet_(ss);
  var cols = getColumnMap_(sheet);
  var rows = getAllValues_(sheet);

  var exact = collectCandidateRows_(rows, cols, function (row) {
    return cellEquals_(row, cols.dateTime, params.dateTimeStr) && venueEquals_(row, cols.venue, params.venue);
  });
  if (exact.candidates.length > 0) return exact;

  var dayPrefix = String(params.dateTimeStr || '').split(' ')[0];
  if (!dayPrefix) return exact;
  return collectCandidateRows_(rows, cols, function (row) {
    return String(cellValue_(row, cols.dateTime)).split(' ')[0] === dayPrefix && venueEquals_(row, cols.venue, params.venue);
  });
}

function actionLogNippouSubmission_(ss, params) {
  var sheet = getMainSheet_(ss);
  var cols = getColumnMap_(sheet);
  var rows = getAllValues_(sheet);
  var lastCol = sheet.getLastColumn();

  (params.products || []).forEach(function (p) {
    var rowNum = findRowNumber_(rows, cols, params.dateTimeStr, params.venue, p.itemCode);
    var fields = {
      stockMin: p.stockMin, stockMax: p.stockMax, usageMin: p.usageMin, usageMax: p.usageMax,
      priceMin: p.priceMin, priceMax: p.priceMax, remarks: p.remarks, rank: p.rank
    };
    if (rowNum !== -1) {
      Object.keys(fields).forEach(function (f) {
        if (cols[f] != null) sheet.getRange(rowNum, cols[f] + 1).setValue(fields[f]);
      });
    } else {
      // アポ側で対応行が見つからない場合(想定外)も含め、安全側に倒して新規追加する
      fields.dateTime = params.dateTimeStr;
      fields.venue = params.venue;
      fields.itemCode = p.itemCode;
      fields.name = p.name;
      fields.type = params.type;
      var newRow = buildRowValues_(cols, fields, lastCol);
      sheet.appendRow(newRow);
    }
  });
  return null;
}

function actionLogNeeds_(ss, params) {
  var sheet = getMainSheet_(ss);
  var cols = getColumnMap_(sheet);
  var rows = getAllValues_(sheet);
  if (cols.needs == null) throw { type: 'column-not-found' };

  var rowNums = findVisitRowNums_(rows, cols, params.dateTimeStr, params.venue);
  if (rowNums.length === 0) throw { type: 'no-matching-rows' };

  rowNums.forEach(function (rowNum) {
    sheet.getRange(rowNum, cols.needs + 1).setValue(params.memo);
  });
  return null;
}

function actionDeleteProductRow_(ss, params) {
  var sheet = getMainSheet_(ss);
  var cols = getColumnMap_(sheet);
  var rows = getAllValues_(sheet);
  var rowNum = findRowNumber_(rows, cols, params.dateTimeStr, params.venue, params.itemCode);
  if (rowNum !== -1) sheet.deleteRow(rowNum);
  return null;
}

function actionDeleteVisitRows_(ss, params) {
  var sheet = getMainSheet_(ss);
  var cols = getColumnMap_(sheet);
  var rows = getAllValues_(sheet);
  var rowNums = findVisitRowNums_(rows, cols, params.dateTimeStr, params.venue);
  if (rowNums.length > 0) deleteRowsDescending_(sheet, rowNums);
  return null;
}

// ---- actions: Locationタブ ----

// Locationタブはタブ名を変更されたことがあるため、タブ名ではなく
// 「緯度」相当の見出しを持つタブかどうかで探す。見つからなければ新規作成する。
function findOrCreateLocationSheet_(ss) {
  var sheets = ss.getSheets();
  for (var i = 0; i < sheets.length; i++) {
    var sh = sheets[i];
    var lastCol = Math.max(sh.getLastColumn(), 1);
    var header = sh.getRange(1, 1, 1, lastCol).getValues()[0];
    var isLocationTab = header.some(function (cell) {
      var normalized = normalizeForMatch_(cell);
      return LOCATION_HEADER_SIGNAL_LABELS.some(function (label) { return normalized.indexOf(normalizeForMatch_(label)) !== -1; });
    });
    if (isLocationTab) return sh;
  }
  var created = ss.insertSheet(LOCATION_SHEET_TITLE);
  created.getRange(1, 1, 1, 6).setValues([['日時', '訪問先', '緯度', '経度', '精度(m)', '地図リンク']]);
  return created;
}

function findLocationSheetOrNull_(ss) {
  var sheets = ss.getSheets();
  for (var i = 0; i < sheets.length; i++) {
    var sh = sheets[i];
    var lastCol = Math.max(sh.getLastColumn(), 1);
    var header = sh.getRange(1, 1, 1, lastCol).getValues()[0];
    var isLocationTab = header.some(function (cell) {
      var normalized = normalizeForMatch_(cell);
      return LOCATION_HEADER_SIGNAL_LABELS.some(function (label) { return normalized.indexOf(normalizeForMatch_(label)) !== -1; });
    });
    if (isLocationTab) return sh;
  }
  return null;
}

function actionDeleteLocationRows_(ss, params) {
  var sheet = findLocationSheetOrNull_(ss);
  if (!sheet) return null;
  var rows = getAllValues_(sheet);

  var rowNums = [];
  for (var i = 0; i < rows.length; i++) {
    if (cellEquals_(rows[i], 0, params.dateTimeStr) && venueEquals_(rows[i], 1, params.venue)) rowNums.push(i + VALUES_RANGE_START_ROW);
  }
  if (rowNums.length === 0) {
    // 位置情報は「実際に到着確認した時刻」で記録される(カレンダーの予定時刻とは別物)ため、
    // 完全一致ではまず見つからない。訪問先が一致する行を同じ日に絞って対象にする。
    var dayPrefix = String(params.dateTimeStr || '').split(' ')[0];
    if (dayPrefix) {
      for (var j = 0; j < rows.length; j++) {
        if (String(cellValue_(rows[j], 0)).split(' ')[0] === dayPrefix && venueEquals_(rows[j], 1, params.venue)) rowNums.push(j + VALUES_RANGE_START_ROW);
      }
    }
  }
  if (rowNums.length > 0) deleteRowsDescending_(sheet, rowNums);
  return null;
}

function actionLogLocationRealtime_(ss, params) {
  var sheet = findOrCreateLocationSheet_(ss);
  var rows = getAllValues_(sheet);

  var rowNum = -1;
  for (var i = 0; i < rows.length; i++) {
    if (cellEquals_(rows[i], 0, params.dateTimeStr) && venueEquals_(rows[i], 1, params.venue)) { rowNum = i + VALUES_RANGE_START_ROW; break; }
  }
  var rowValues = [params.dateTimeStr, params.venue, params.lat, params.lng, params.accuracy, params.mapLink];
  if (rowNum !== -1) {
    sheet.getRange(rowNum, 1, 1, 6).setValues([rowValues]);
  } else {
    sheet.appendRow(rowValues);
  }
  return null;
}

// ---- actions: 履歴・未提出リスト・鮮度台帳 ----

function actionGetSubmittedHistory_(ss) {
  var sheet = getMainSheet_(ss);
  var cols = getColumnMap_(sheet);
  if (cols.dateTime == null || cols.venue == null || cols.rank == null) return [];
  var rows = getAllValues_(sheet);

  var byVisit = {};
  var order = [];
  rows.forEach(function (row) {
    var dateTimeStr = cellValue_(row, cols.dateTime);
    var venue = cellValue_(row, cols.venue);
    var rank = cellValue_(row, cols.rank);
    if (!dateTimeStr || !venue || !rank) return;
    var visitDate = parseAnalysisDateTime_(dateTimeStr);
    if (!visitDate) return;
    var key = dateTimeStr + '|' + venue;
    if (!byVisit[key]) {
      byVisit[key] = { dateKey: dayKeyFromDate_(visitDate), name: venue, submittedAt: null, products: [] };
      order.push(key);
    }
    byVisit[key].products.push({
      name: cellValue_(row, cols.name),
      itemCode: cellValue_(row, cols.itemCode),
      stockMin: cellValue_(row, cols.stockMin), stockMax: cellValue_(row, cols.stockMax),
      usageMin: cellValue_(row, cols.usageMin), usageMax: cellValue_(row, cols.usageMax),
      priceMin: cellValue_(row, cols.priceMin), priceMax: cellValue_(row, cols.priceMax),
      remarks: cellValue_(row, cols.remarks), rank: rank
    });
  });
  return order.map(function (key) { return byVisit[key]; });
}

function actionGetPendingVisits_(ss) {
  var sheet = getMainSheet_(ss);
  var cols = getColumnMap_(sheet);
  if (cols.dateTime == null || cols.venue == null) return [];
  var rows = getAllValues_(sheet);

  var byVisit = {};
  var order = [];
  rows.forEach(function (row) {
    var dateTimeStr = cellValue_(row, cols.dateTime);
    var venue = cellValue_(row, cols.venue);
    var name = cellValue_(row, cols.name);
    if (!dateTimeStr || !venue || !name) return;
    var rank = cols.rank != null ? cellValue_(row, cols.rank) : '';
    var key = dateTimeStr + '|' + venue;
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
      var visitDate = parseAnalysisDateTime_(v.dateTimeStr);
      return {
        dateKey: visitDate ? dayKeyFromDate_(visitDate) : '',
        name: v.venue,
        visitStart: visitDate ? visitDate.toISOString() : ''
      };
    });
}

function actionGetLedgerData_(ss) {
  var sheet = getMainSheet_(ss);
  var cols = getColumnMap_(sheet);
  var rows = getAllValues_(sheet);
  return { rows: rows, cols: cols };
}
