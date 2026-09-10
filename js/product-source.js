(function () {
  "use strict";

  var CATALOG_STORAGE_PREFIX = "sendo-catalog-";

  // Product Master Referenceの列構成も今後変わりうる(実際にItem Code/Product Name/Unitの
  // 列位置が入れ替わったことがある)ため、固定の列位置に頼らず見出しラベルの文字列で都度検出する
  var CATALOG_COLUMN_LABELS = {
    itemCode: ["itemcode", "商品コード"],
    name: ["productname", "商品名"],
    unit: ["unit", "単位"]
  };

  function normalizeForMatch(s) {
    return String(s || "").replace(/\s+/g, "").toLowerCase();
  }

  function findCatalogHeaderRowIndex(rows) {
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      for (var c = 0; c < row.length; c++) {
        var normalized = normalizeForMatch(row[c]);
        if (normalized.indexOf("productname") !== -1 || normalized.indexOf("商品名") !== -1) return i;
      }
    }
    return -1;
  }

  function findCatalogColumnMap(header) {
    var map = {};
    Object.keys(CATALOG_COLUMN_LABELS).forEach(function (field) {
      var labels = CATALOG_COLUMN_LABELS[field];
      for (var i = 0; i < header.length; i++) {
        var normalized = normalizeForMatch(header[i]);
        var found = labels.some(function (label) { return normalized.indexOf(normalizeForMatch(label)) !== -1; });
        if (found) { map[field] = i; break; }
      }
    });
    return map;
  }

  function todayKey() {
    var d = new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }

  function escapeDriveQueryValue(v) {
    return String(v).replace(/'/g, "\\'");
  }

  function driveFilesUrl(query) {
    // Hearing SheetフォルダはGoogle Workspaceの共有ドライブ配下にあるため、
    // 共有ドライブの中身も検索対象に含めるパラメータが必須(無いと存在するファイルもヒットしない)
    return "https://www.googleapis.com/drive/v3/files" +
      "?q=" + encodeURIComponent(query) +
      "&corpora=allDrives" +
      "&includeItemsFromAllDrives=true" +
      "&supportsAllDrives=true" +
      "&fields=" + encodeURIComponent("files(id,name,modifiedTime)");
  }

  function searchDriveFileByExactName(name) {
    var query = "name = '" + escapeDriveQueryValue(name) + "' and trashed = false";
    return GoogleApi.fetchJson(driveFilesUrl(query)).then(function (data) {
      var files = data.files || [];
      if (files.length === 0) return null;
      files.sort(function (a, b) { return (b.modifiedTime || "").localeCompare(a.modifiedTime || ""); });
      return files[0];
    });
  }

  function getFirstSheetInfo(spreadsheetId) {
    var url = "https://sheets.googleapis.com/v4/spreadsheets/" + encodeURIComponent(spreadsheetId) +
      "?fields=" + encodeURIComponent("sheets.properties");
    return GoogleApi.fetchJson(url).then(function (data) {
      var sheets = data.sheets || [];
      if (sheets.length === 0) throw { type: "no-sheets" };
      return { sheetId: sheets[0].properties.sheetId, title: sheets[0].properties.title };
    });
  }

  function getFirstSheetTitle(spreadsheetId) {
    return getFirstSheetInfo(spreadsheetId).then(function (info) { return info.title; });
  }

  function quoteSheetTitle(title) {
    return "'" + title.replace(/'/g, "''") + "'";
  }

  function getSheetValues(spreadsheetId, sheetTitle, a1Range) {
    var range = quoteSheetTitle(sheetTitle) + "!" + a1Range;
    var url = "https://sheets.googleapis.com/v4/spreadsheets/" + encodeURIComponent(spreadsheetId) +
      "/values/" + encodeURIComponent(range);
    return GoogleApi.fetchJson(url).then(function (data) {
      return data.values || [];
    });
  }

  function cell(row, idx) {
    return (row && row[idx] != null) ? String(row[idx]).trim() : "";
  }

  function parseCatalogRows(rows) {
    var headerIdx = findCatalogHeaderRowIndex(rows);
    if (headerIdx === -1) return [];

    var cols = findCatalogColumnMap(rows[headerIdx]);
    if (cols.itemCode == null || cols.name == null) return [];

    var byCode = {};
    for (var r = headerIdx + 1; r < rows.length; r++) {
      var itemCode = cell(rows[r], cols.itemCode);
      var name = cell(rows[r], cols.name);
      if (!itemCode || !name) continue;
      byCode[itemCode] = { itemCode: itemCode, name: name, unit: cols.unit != null ? cell(rows[r], cols.unit) : "" };
    }

    var list = [];
    Object.keys(byCode).forEach(function (code) { list.push(byCode[code]); });
    list.sort(function (a, b) { return a.name.localeCompare(b.name); });
    return list;
  }

  function loadCatalogCache() {
    try {
      var raw = localStorage.getItem(CATALOG_STORAGE_PREFIX + todayKey());
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function saveCatalogCache(list) {
    try {
      localStorage.setItem(CATALOG_STORAGE_PREFIX + todayKey(), JSON.stringify(list));
    } catch (e) {
      console.warn("failed to cache product catalog", e);
    }
  }

  function getWalkinCatalog() {
    var cached = loadCatalogCache();
    if (cached && cached.length > 0) return Promise.resolve(cached);

    return searchDriveFileByExactName("Product Master Reference").then(function (file) {
      if (!file) return [];
      return getFirstSheetTitle(file.id).then(function (sheetTitle) {
        return getSheetValues(file.id, sheetTitle, "A1:K2000").then(function (rows) {
          var list = parseCatalogRows(rows);
          // 空リストをキャッシュすると、その日は二度と再取得されなくなってしまうため
          // 実際に商品が取れた時だけキャッシュする
          if (list.length > 0) saveCatalogCache(list);
          return list;
        });
      });
    });
  }

  window.ProductSource = {
    getWalkinCatalog: getWalkinCatalog,
    searchDriveFileByExactName: searchDriveFileByExactName,
    getFirstSheetTitle: getFirstSheetTitle,
    getFirstSheetInfo: getFirstSheetInfo,
    getSheetValues: getSheetValues,
    quoteSheetTitle: quoteSheetTitle
  };
})();
