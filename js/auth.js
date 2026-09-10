(function () {
  "use strict";

  var SESSION_KEY = "sendo-auth-session";
  var USERINFO_URL = "https://www.googleapis.com/oauth2/v3/userinfo";
  var config = window.SENDO_AUTH_CONFIG || { clientId: "", scopes: "" };

  var session = null;       // { accessToken, expiresAt, profile: { name, email, picture } }
  var status = "loading";   // unconfigured | logged-out | signing-in | logged-in | error
  var errorMessage = "";
  var tokenClient = null;
  var listeners = [];

  function escapeHtml(str) {
    var div = document.createElement("div");
    div.textContent = str == null ? "" : str;
    return div.innerHTML;
  }

  // ---- session persistence ----

  function loadStoredSession() {
    try {
      var raw = localStorage.getItem(SESSION_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      console.warn("failed to load auth session", e);
      return null;
    }
  }

  function saveStoredSession(s) {
    try {
      localStorage.setItem(SESSION_KEY, JSON.stringify(s));
    } catch (e) {
      console.warn("failed to save auth session", e);
    }
  }

  function clearStoredSession() {
    try {
      localStorage.removeItem(SESSION_KEY);
    } catch (e) {
      console.warn("failed to clear auth session", e);
    }
  }

  function isValid(s) {
    return !!(s && s.accessToken && s.expiresAt && s.expiresAt > Date.now());
  }

  // ---- notify subscribers ----

  function notify() {
    listeners.forEach(function (fn) {
      try {
        fn(session);
      } catch (e) {
        console.warn("Auth.onChange listener failed", e);
      }
    });
    render();
  }

  // ---- Google Identity Services helpers ----

  function isGisReady() {
    return !!(window.google && google.accounts && google.accounts.oauth2);
  }

  function ensureTokenClient() {
    if (tokenClient) return tokenClient;
    if (!isGisReady() || !config.clientId) return null;
    tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: config.clientId,
      scope: config.scopes,
      callback: handleTokenResponse,
      error_callback: handleTokenError
    });
    return tokenClient;
  }

  function handleTokenResponse(resp) {
    if (!resp || resp.error) {
      handleTokenError(resp);
      return;
    }
    var expiresAt = Date.now() + (Number(resp.expires_in) || 3600) * 1000;
    fetchProfile(resp.access_token).then(function (profile) {
      session = { accessToken: resp.access_token, expiresAt: expiresAt, profile: profile };
      saveStoredSession(session);
      status = "logged-in";
      errorMessage = "";
      notify();
    });
  }

  function handleTokenError(err) {
    console.warn("Google login failed", err);
    status = config.clientId ? "error" : "unconfigured";
    errorMessage = "ログインに失敗しました(同意が拒否されたか、ポップアップがブロックされました)";
    notify();
  }

  function fetchProfile(accessToken) {
    return fetch(USERINFO_URL, { headers: { Authorization: "Bearer " + accessToken } })
      .then(function (res) {
        if (!res.ok) throw new Error("userinfo request failed: " + res.status);
        return res.json();
      })
      .then(function (data) {
        return { name: data.name || data.email || "ログイン中", email: data.email || "", picture: data.picture || "" };
      })
      .catch(function (e) {
        console.warn("failed to fetch Google profile", e);
        return { name: "ログイン中", email: "", picture: "" };
      });
  }

  // ---- public actions ----

  function login() {
    if (!config.clientId) {
      status = "unconfigured";
      render();
      return;
    }
    if (!isGisReady()) {
      status = "error";
      errorMessage = "読み込みに失敗しました(オフラインの可能性があります)。再読み込みしてください。";
      render();
      return;
    }
    var client = ensureTokenClient();
    if (!client) {
      status = "error";
      errorMessage = "初期化に失敗しました。再読み込みしてください。";
      render();
      return;
    }
    status = "signing-in";
    errorMessage = "";
    render();
    client.requestAccessToken({ prompt: "consent" });
  }

  function logout() {
    if (session && session.accessToken && isGisReady()) {
      try {
        google.accounts.oauth2.revoke(session.accessToken, function () {});
      } catch (e) {
        console.warn("failed to revoke Google token", e);
      }
    }
    session = null;
    clearStoredSession();
    status = config.clientId ? "logged-out" : "unconfigured";
    errorMessage = "";
    notify();
  }

  function onChange(fn) {
    if (typeof fn === "function") listeners.push(fn);
  }

  // ---- widget rendering ----

  function findHeader() {
    return document.querySelector(".ledger-header") || document.querySelector(".app-header");
  }

  function widgetInner() {
    if (status === "unconfigured") {
      return '<span class="auth-status-text">Google認証: 未設定です</span>';
    }
    if (status === "signing-in") {
      return '<span class="auth-status-text">サインイン中…</span>' +
        '<button class="auth-login-btn" type="button" disabled>Googleでログイン</button>';
    }
    if (status === "error") {
      return '<span class="auth-status-text auth-status-error">' + escapeHtml(errorMessage) + '</span>' +
        '<button class="auth-login-btn" type="button" id="auth-login-btn">再試行</button>';
    }
    if (status === "logged-in" && session) {
      var profile = session.profile || {};
      var avatar = profile.picture
        ? '<img class="auth-avatar" id="auth-avatar-img" src="' + escapeHtml(profile.picture) + '" alt="">'
        : '<span class="auth-avatar auth-avatar-fallback">' + escapeHtml((profile.name || "?").charAt(0)) + '</span>';
      var repName = (window.SENDO_REP_CONFIG && window.SENDO_REP_CONFIG.getRepName) ? window.SENDO_REP_CONFIG.getRepName() : "";
      return avatar +
        '<span class="auth-name-wrap">' +
          '<span class="auth-name">' + escapeHtml(profile.name) + '</span>' +
          '<button class="auth-repname-btn" type="button" id="auth-repname-btn">担当者名: ' + escapeHtml(repName || "未設定") + ' ✎</button>' +
        '</span>' +
        '<button class="auth-logout-btn" type="button" id="auth-logout-btn">ログアウト</button>';
    }
    // logged-out
    return '<span class="auth-status-text">Googleアカウントでログインしてください</span>' +
      '<button class="auth-login-btn" type="button" id="auth-login-btn">Googleでログイン</button>';
  }

  // Hearing Sheetのフォルダ名・{担当者名}_App_Analysisのファイル名とGoogleアカウントの
  // 表示名が一致しない場合に、この端末だけの上書き設定をしてもらうためのプロンプト
  function promptRepNameOverride() {
    var current = (window.SENDO_REP_CONFIG && window.SENDO_REP_CONFIG.getRepName) ? window.SENDO_REP_CONFIG.getRepName() : "";
    var input = window.prompt(
      "担当者名を入力してください。\n" +
      "Hearing Sheetのフォルダ名・{担当者名}_App_Analysisのファイル名と、\n" +
      "一字一句(全角半角・スペースまで)完全に一致させてください。\n" +
      "例: Nine (Pacharach Phanyapornsuk)",
      current
    );
    if (input === null) return; // キャンセル
    if (window.SENDO_REP_CONFIG && window.SENDO_REP_CONFIG.setOverride) {
      window.SENDO_REP_CONFIG.setOverride(input);
    }
    location.reload();
  }

  function render() {
    var header = findHeader();
    if (!header) return;

    var widget = header.querySelector(".auth-widget");
    if (!widget) {
      widget = document.createElement("div");
      widget.className = "auth-widget";
      header.appendChild(widget);
    }
    widget.className = "auth-widget" + (status === "logged-in" ? " is-logged-in" : "");
    widget.innerHTML = widgetInner();

    var loginBtn = widget.querySelector("#auth-login-btn");
    if (loginBtn) loginBtn.addEventListener("click", login);

    var logoutBtn = widget.querySelector("#auth-logout-btn");
    if (logoutBtn) logoutBtn.addEventListener("click", logout);

    var repNameBtn = widget.querySelector("#auth-repname-btn");
    if (repNameBtn) repNameBtn.addEventListener("click", promptRepNameOverride);

    var avatarImg = widget.querySelector("#auth-avatar-img");
    if (avatarImg) {
      avatarImg.addEventListener("error", function () {
        var profile = session && session.profile ? session.profile : {};
        var fallback = document.createElement("span");
        fallback.className = "auth-avatar auth-avatar-fallback";
        fallback.textContent = (profile.name || "?").charAt(0);
        avatarImg.replaceWith(fallback);
      });
    }
  }

  // ---- init ----

  var stored = loadStoredSession();
  if (isValid(stored)) {
    session = stored;
    status = "logged-in";
  } else {
    if (stored) clearStoredSession();
    status = config.clientId ? "logged-out" : "unconfigured";
  }
  render();

  window.Auth = {
    getSession: function () { return session; },
    isLoggedIn: function () { return isValid(session); },
    getAccessToken: function () { return isValid(session) ? session.accessToken : null; },
    login: login,
    logout: logout,
    onChange: onChange
  };
})();
