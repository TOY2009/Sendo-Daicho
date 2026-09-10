// 担当者名の解決。複数人が同じデプロイ先を使う前提のため、コードに決め打ちせず、
// ①ログイン中のGoogleアカウントの表示名を自動採用、②Hearing Sheetのフォルダ名・
// {担当者名}_App_Analysisのファイル名と表示名が一致しない場合は、ブラウザごとに
// 手動で上書き設定できるようにする(localStorageに保存、この端末だけに効く)。
(function () {
  "use strict";

  var OVERRIDE_KEY = "sendo-rep-name-override";

  function getOverride() {
    try {
      return (localStorage.getItem(OVERRIDE_KEY) || "").trim();
    } catch (e) {
      return "";
    }
  }

  function setOverride(name) {
    try {
      var trimmed = (name || "").trim();
      if (trimmed) localStorage.setItem(OVERRIDE_KEY, trimmed);
      else localStorage.removeItem(OVERRIDE_KEY);
    } catch (e) {
      console.warn("failed to save rep name override", e);
    }
  }

  function getAutoDetectedName() {
    if (!window.Auth || !Auth.isLoggedIn()) return "";
    var session = Auth.getSession();
    var name = session && session.profile && session.profile.name;
    return (name || "").trim();
  }

  // 上書き設定があればそれを優先、無ければGoogleログインの表示名を使う
  function getRepName() {
    return getOverride() || getAutoDetectedName();
  }

  window.SENDO_REP_CONFIG = {
    getRepName: getRepName,
    getOverride: getOverride,
    getAutoDetectedName: getAutoDetectedName,
    setOverride: setOverride
  };
})();
