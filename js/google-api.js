(function () {
  "use strict";

  function fetchJson(url, options) {
    options = options || {};
    if (!window.Auth || !Auth.isLoggedIn()) {
      return Promise.reject({ type: "unauthenticated" });
    }

    var headers = {};
    if (options.headers) {
      Object.keys(options.headers).forEach(function (k) { headers[k] = options.headers[k]; });
    }
    headers.Authorization = "Bearer " + Auth.getAccessToken();

    var fetchOptions = { method: options.method || "GET", headers: headers };
    if (options.body !== undefined) fetchOptions.body = options.body;

    return fetch(url, fetchOptions).then(function (res) {
      if (res.status === 401) {
        return Promise.reject({ type: "unauthorized", status: 401 });
      }
      if (res.status === 403) {
        return Promise.reject({ type: "forbidden", status: 403 });
      }
      if (!res.ok) {
        return res.text().then(function (text) {
          return Promise.reject({ type: "http-error", status: res.status, body: text });
        });
      }
      if (res.status === 204) return null;
      return res.json();
    });
  }

  window.GoogleApi = { fetchJson: fetchJson };
})();
