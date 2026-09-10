// Google Identity Services 設定。
// 許可済みJavaScriptオリジンに http://localhost:5500 (開発用)と
// https://toy2009.github.io (本番、GitHub Pages) を登録すること。
(function () {
  "use strict";

  window.SENDO_AUTH_CONFIG = {
    clientId: "509089849019-8k8aduk0i4u4vq0hd0ip6t006sm0bmb5.apps.googleusercontent.com",
    scopes: [
      "openid",
      "email",
      "profile",
      "https://www.googleapis.com/auth/calendar.events",
      "https://www.googleapis.com/auth/drive.readonly",
      "https://www.googleapis.com/auth/spreadsheets"
    ].join(" ")
  };
})();
