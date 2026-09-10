"use strict";

var CACHE_NAME = "sendo-daichou-v39";
var PRECACHE_URLS = [
  "./",
  "./index.html",
  "./schedule.html",
  "./ledger.html",
  "./karte.html",
  "./nippou.html",
  "./css/style.css",
  "./css/ledger.css",
  "./js/i18n.js",
  "./js/app.js",
  "./js/auth-config.js",
  "./js/rep-config.js",
  "./js/auth.js",
  "./js/google-api.js",
  "./js/product-source.js",
  "./js/analysis-log.js",
  "./js/schedule.js",
  "./js/ledger.js",
  "./js/nippou.js",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-192.png",
  "./icons/icon-maskable-512.png"
];

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      return cache.addAll(PRECACHE_URLS);
    }).then(function () {
      return self.skipWaiting();
    })
  );
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(
        keys
          .filter(function (key) { return key !== CACHE_NAME; })
          .map(function (key) { return caches.delete(key); })
      );
    }).then(function () {
      return self.clients.claim();
    })
  );
});

self.addEventListener("fetch", function (event) {
  if (event.request.method !== "GET") return;

  event.respondWith(
    caches.match(event.request).then(function (cached) {
      var networkFetch = fetch(event.request)
        .then(function (response) {
          if (response && response.status === 200 && response.type === "basic") {
            var responseClone = response.clone();
            caches.open(CACHE_NAME).then(function (cache) {
              cache.put(event.request, responseClone);
            });
          }
          return response;
        })
        .catch(function () {
          if (event.request.mode === "navigate") {
            return caches.match("./index.html");
          }
          return cached;
        });

      return cached || networkFetch;
    })
  );
});
