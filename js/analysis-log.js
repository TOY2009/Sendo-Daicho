(function () {
  "use strict";

  // Analysisファイル({担当者名}_App_Analysis、同ファイル内のLocationタブ含む)は
  // 担当者本人には共有されていない(評価・ランクが見えてしまうため、意図的に非共有)。
  // そのため直接Sheets/Drive APIを叩くのではなく、Ryuさんの権限で動くGAS Webアプリ
  // (gas/AnalysisProxy.gs、"Execute as: Me"でデプロイ)経由で読み書きする。
  // 担当者名もクライアントが申告する文字列は使わず、GAS側でアクセストークンをGoogle自身に
  // 検証させて得られた名前を使う(なりすまし防止)。
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

  // params: { dateTimeStr, venue }
  // 戻り値: { dateTimeStr, venue, candidates }。dateTimeStr/venueは実際にマッチした行の値
  // (呼び出し元のparamsと食い違う可能性があるため、日報提出時はこちらを使う)。
  function getVisitCandidates(params) {
    return callProxy("getVisitCandidates", params);
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

  // ブラウザのキャッシュ・localStorageが消えても「提出済み」データ自体は失われないよう、
  // 過去の日報(履歴)をlocalStorageだけでなくAnalysisシート本体からも復元できるようにする。
  // ランクが入っている行=提出済みとみなす(提出時にランクを含めて一括で書き込むため)。
  function getSubmittedHistory() {
    return callProxy("getSubmittedHistory", {});
  }

  // 未提出の訪問も、localStorageではなくAnalysisシート本体だけを正とする。
  // GASがHSダウンロード時に候補行(Item Code・Offer Product)を事前に作るので、
  // その行群の中にランク未記入のものが1つでもあれば「まだ日報が完了していない」とみなす。
  // (Walk Inのようにシートへ一切書き込まれていない訪問はそもそも検出対象に出来ない)
  function getPendingVisits() {
    return callProxy("getPendingVisits", {});
  }

  // 鮮度台帳(ledger.html)用: 全行と列マップをまとめて取得するアクションを、
  // 呼び出し側の既存コード(getColumns/getAllRowsを別々に呼ぶ)に合わせて分けて公開する。
  function getLedgerData() {
    return callProxy("getLedgerData", {});
  }

  function getAllRows() {
    return getLedgerData().then(function (d) { return d.rows; });
  }

  function getColumns() {
    return getLedgerData().then(function (d) { return d.cols; });
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
