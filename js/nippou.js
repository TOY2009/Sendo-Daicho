(function () {
  "use strict";

  function t(key, vars) {
    return window.I18n ? I18n.t(key, vars) : key;
  }

  var RANKS = ["S", "A", "B", "C", "D"];

  function todayKey() {
    var d = new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }

  var STORAGE_KEY = "sendo-nippou-" + todayKey();

  var params = new URLSearchParams(window.location.search);
  var visitId = params.get("visit") || "unknown-visit";
  var visitName = params.get("name") || "訪問先";
  var visitStart = params.get("start") || "";
  var isWalkin = visitId.indexOf("walkin-") === 0;

  var els = {
    visitNameLabel: document.getElementById("visit-name-label"),
    productList: document.getElementById("product-list"),
    addProductBtn: document.getElementById("add-product-btn"),
    addProductModal: document.getElementById("add-product-modal"),
    addProductSelect: document.getElementById("add-product-select"),
    addProductCancelBtn: document.getElementById("add-product-cancel-btn"),
    addProductConfirmBtn: document.getElementById("add-product-confirm-btn"),
    submitBtn: document.getElementById("submit-btn"),
    submitHint: document.getElementById("submit-hint"),
    toast: document.getElementById("toast")
  };

  if (els.visitNameLabel) {
    els.visitNameLabel.textContent = visitName + t("nippou.pageTitleSuffix");
  }

  var toastTimer = null;
  function showToast(message) {
    els.toast.textContent = message;
    els.toast.classList.add("is-visible");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      els.toast.classList.remove("is-visible");
    }, 2400);
  }

  function emptyProduct(name, ref, removable) {
    ref = ref || {};
    return {
      name: name,
      itemCode: ref.itemCode || "",
      unit: ref.unit || "",
      stockMin: "", stockMax: "",
      usageMin: "", usageMax: "",
      priceMin: "", priceMax: "",
      remarks: "",
      rank: "",
      removable: !!removable
    };
  }

  function loadStore() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (e) {
      console.warn("failed to load nippou store", e);
      return {};
    }
  }

  function saveStore(store) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
    } catch (e) {
      console.warn("failed to save nippou store", e);
    }
  }

  var store = loadStore();
  var record = store[visitId] || null;
  var loadStatus = record ? "ready" : "loading"; // loading | ready | error
  var openIndex = -1;

  function recalcOpenIndex() {
    openIndex = -1;
  }

  // 「見つかりませんでした」や「候補0件」は、GAS側のHS作成遅延やシート形式の読み取り不備が原因の
  // 可能性があるため、毎回再検索できるようにする(その日の間ずっとキャッシュしない)。
  // Walk In(candidateStatus="walkin")は候補0件が正常な初期状態なので対象外。
  function isRetryableStatus(candidateStatus, products) {
    if (candidateStatus === "unmatched") return true;
    if (candidateStatus === "matched" && (!products || products.length === 0)) return true;
    return false;
  }

  function finalizeNewRecord(candidateStatus, products, candidateDebug) {
    record = {
      name: visitName, products: products, submitted: false, submittedAt: null,
      candidateStatus: candidateStatus, candidateDebug: candidateDebug || null
    };
    store[visitId] = record;
    if (!isRetryableStatus(candidateStatus, products)) saveStore(store);
    recalcOpenIndex();
    loadStatus = "ready";
    render();
  }

  // 候補商品はHearing Sheetファイルを直接読みに行かず、Analysisシート
  // ({担当者名}_App_Analysis、GASがHSダウンロード時に候補ごとの行を事前作成している)から取得する。
  // Hearing Sheetは同じ取引先で何度もコピーが作られたり空欄のまま放置されたりして不安定なため、
  // GAS・アプリの両方が常に読み書きしているAnalysisシートを唯一の情報源にする。
  var CANDIDATE_RETRY_DELAYS_MS = [2000, 4000];

  function candidateDateTimeStr() {
    return visitStart && window.AnalysisLog ? AnalysisLog.formatAnalysisDateTime(new Date(visitStart)) : null;
  }

  // Item CodeはAnalysisシートに既に入っているので、Unitだけ商品マスタから補完する(無くても致命的ではない)
  function resolveUnitsByItemCode(candidates) {
    if (!window.ProductSource) return Promise.resolve(candidates);
    return ProductSource.getWalkinCatalog().then(function (catalog) {
      var byCode = {};
      catalog.forEach(function (c) { byCode[c.itemCode] = c; });
      return candidates.map(function (c) {
        var match = byCode[c.itemCode];
        return { itemCode: c.itemCode, name: c.name, unit: match ? match.unit : "" };
      });
    }).catch(function () {
      return candidates.map(function (c) { return { itemCode: c.itemCode, name: c.name, unit: "" }; });
    });
  }

  function fetchVisitCandidatesWithRetry(attempt, dateTimeStr) {
    return AnalysisLog.getVisitCandidates({ dateTimeStr: dateTimeStr, venue: visitName }).then(function (candidates) {
      var isEmpty = candidates.length === 0;
      if (isEmpty && attempt < CANDIDATE_RETRY_DELAYS_MS.length) {
        return new Promise(function (resolve) {
          setTimeout(resolve, CANDIDATE_RETRY_DELAYS_MS[attempt]);
        }).then(function () {
          return fetchVisitCandidatesWithRetry(attempt + 1, dateTimeStr);
        });
      }
      if (isEmpty) return { status: "unmatched", debug: { dateTimeStr: dateTimeStr, venue: visitName } };
      return resolveUnitsByItemCode(candidates).then(function (resolved) {
        return { status: "matched", products: resolved, debug: { dateTimeStr: dateTimeStr, venue: visitName, count: resolved.length } };
      });
    });
  }

  function initRecord() {
    if (record && !isRetryableStatus(record.candidateStatus, record.products)) {
      record.candidateStatus = record.candidateStatus || (isWalkin ? "walkin" : "matched");
      recalcOpenIndex();
      loadStatus = "ready";
      render();
      return;
    }

    record = null;
    render(); // 読み込み中の表示

    if (isWalkin) {
      finalizeNewRecord("walkin", []);
      return;
    }

    var dateTimeStr = candidateDateTimeStr();

    if (!window.AnalysisLog || !dateTimeStr || !window.Auth || !Auth.isLoggedIn()) {
      loadStatus = "error";
      render();
      return;
    }

    fetchVisitCandidatesWithRetry(0, dateTimeStr).then(function (result) {
      if (result.status === "matched") {
        var products = result.products.map(function (p) {
          return emptyProduct(p.name, { itemCode: p.itemCode, unit: p.unit });
        });
        finalizeNewRecord("matched", products, result.debug);
      } else {
        finalizeNewRecord("unmatched", [], result.debug);
      }
    }).catch(function (err) {
      console.warn("visit candidate fetch failed", err);
      loadStatus = "error";
      render();
    });
  }

  function productStatus(p) {
    if (!p.rank) return "unrated";
    var allFilled = p.stockMin !== "" && p.stockMax !== "" &&
      p.usageMin !== "" && p.usageMax !== "" &&
      p.priceMin !== "" && p.priceMax !== "" &&
      p.remarks.trim() !== "";
    return allFilled ? "done" : "tentative";
  }

  function statusBadge(status) {
    if (status === "done") return '<span class="badge badge-done">' + escapeHtml(t("nippou.badgeDone")) + '</span>';
    if (status === "tentative") return '<span class="badge badge-tentative">' + escapeHtml(t("nippou.badgeTentative")) + '</span>';
    return '<span class="badge badge-skipped">' + escapeHtml(t("nippou.badgeUnrated")) + '</span>';
  }

  function escapeHtml(str) {
    var div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  function renderRankPicker(p) {
    return '<div class="rank-picker" data-field="rank">' +
      RANKS.map(function (r) {
        return '<button type="button" class="rank-chip' + (p.rank === r ? " is-selected" : "") + '" data-rank="' + r + '">' + r + '</button>';
      }).join("") +
      '</div>';
  }

  function renderProduct(p, i) {
    var isOpen = i === openIndex;
    var item = document.createElement("div");
    item.className = "product-item" + (isOpen ? " is-open" : "");

    var refParts = [];
    if (p.itemCode) refParts.push(escapeHtml(p.itemCode));
    if (p.unit) refParts.push(escapeHtml(p.unit));
    var refHtml = refParts.length ? '<span class="product-ref">' + refParts.join(" ・ ") + '</span>' : "";
    var removeBtnHtml = p.removable
      ? '<button type="button" class="product-remove" data-remove="' + i + '" aria-label="' + escapeHtml(t("common.delete")) + '">🗑</button>'
      : "";

    item.innerHTML =
      '<div class="product-header">' +
        '<button type="button" class="product-toggle" data-toggle="' + i + '">' +
          '<span class="product-name-wrap">' +
            '<span class="product-name">' + escapeHtml(p.name) + '</span>' +
            refHtml +
          '</span>' +
          statusBadge(productStatus(p)) +
          '<span class="product-chevron" aria-hidden="true">›</span>' +
        '</button>' +
        removeBtnHtml +
      '</div>' +
      '<div class="product-body">' +
        '<div class="field-group">' +
          '<label>' + escapeHtml(t("nippou.stockLabel")) + '</label>' +
          '<div class="range-inputs">' +
            '<input type="number" inputmode="decimal" data-field="stockMin" value="' + p.stockMin + '" placeholder="Min">' +
            '<span class="range-sep">〜</span>' +
            '<input type="number" inputmode="decimal" data-field="stockMax" value="' + p.stockMax + '" placeholder="Max">' +
          '</div>' +
        '</div>' +
        '<div class="field-group">' +
          '<label>' + escapeHtml(t("nippou.usageLabel")) + '</label>' +
          '<div class="range-inputs">' +
            '<input type="number" inputmode="decimal" data-field="usageMin" value="' + p.usageMin + '" placeholder="Min">' +
            '<span class="range-sep">〜</span>' +
            '<input type="number" inputmode="decimal" data-field="usageMax" value="' + p.usageMax + '" placeholder="Max">' +
          '</div>' +
        '</div>' +
        '<div class="field-group">' +
          '<label>' + escapeHtml(t("nippou.targetPriceLabel")) + '</label>' +
          '<div class="range-inputs">' +
            '<input type="number" inputmode="decimal" data-field="priceMin" value="' + p.priceMin + '" placeholder="Min">' +
            '<span class="range-sep">〜</span>' +
            '<input type="number" inputmode="decimal" data-field="priceMax" value="' + p.priceMax + '" placeholder="Max">' +
          '</div>' +
        '</div>' +
        '<div class="field-group">' +
          '<label>' + escapeHtml(t("nippou.remarksLabel")) + '</label>' +
          '<textarea data-field="remarks" placeholder="' + escapeHtml(t("nippou.remarksPlaceholder")) + '">' + escapeHtml(p.remarks) + '</textarea>' +
        '</div>' +
        '<div class="field-group">' +
          '<label>' + escapeHtml(t("nippou.rankLabel")) + '</label>' +
          renderRankPicker(p) +
        '</div>' +
      '</div>';
    return item;
  }

  // DevToolsを使わなくても画面のスクリーンショット一枚で原因調査できるよう、
  // 検索・読み取りの内部状態をそのまま表示する
  function formatCandidateDebug(debug) {
    if (!debug) return "";
    var lines = [];
    if (debug.dateTimeStr != null) lines.push(t("nippou.debugSearchDateTime") + JSON.stringify(debug.dateTimeStr));
    if (debug.venue != null) lines.push(t("nippou.debugSearchVenue") + JSON.stringify(debug.venue));
    if (debug.count != null) lines.push(t("nippou.debugFoundCount") + debug.count);
    if (lines.length === 0) return "";
    return '<div style="font-size:10px; color:var(--ink-faint); text-align:left; margin-top:8px; padding:8px; background:var(--paper-dim); border-radius:8px; white-space:pre-wrap;">' +
      escapeHtml(lines.join("\n")) + '</div>';
  }

  function bindCandidatesRetryButton() {
    var retryBtn = document.getElementById("candidates-retry-btn");
    if (retryBtn) retryBtn.addEventListener("click", function () {
      loadStatus = "loading";
      initRecord();
    });
  }

  function render() {
    els.productList.innerHTML = "";

    if (!record) {
      if (loadStatus === "error") {
        els.productList.innerHTML =
          '<div class="empty-hint">' + escapeHtml(t("nippou.loadFailed")) + '<br>' +
          '<button class="task-link" type="button" id="candidates-retry-btn">' + escapeHtml(t("common.retry")) + '</button></div>';
        bindCandidatesRetryButton();
      } else {
        els.productList.innerHTML = '<div class="empty-hint">' + escapeHtml(t("nippou.loadingCandidates")) + '</div>';
      }
      updateSubmitState();
      updateAddButton();
      return;
    }

    if (record.candidateStatus === "unmatched") {
      els.productList.innerHTML =
        '<div class="empty-hint">' + escapeHtml(t("nippou.notFound")) + '<br>' +
        '<span style="font-size:11px;">' + escapeHtml(t("nippou.notFoundHint")) + '</span><br>' +
        '<button class="task-link" type="button" id="candidates-retry-btn">' + escapeHtml(t("common.retry")) + '</button>' +
        formatCandidateDebug(record.candidateDebug) + '</div>';
      bindCandidatesRetryButton();
    } else if (record.products.length === 0) {
      if (isWalkin) {
        els.productList.innerHTML = '<div class="empty-hint">' + escapeHtml(t("nippou.noWalkinProducts")) + '</div>';
      } else {
        els.productList.innerHTML =
          '<div class="empty-hint">' + escapeHtml(t("nippou.noCandidates")) + '<br>' +
          '<span style="font-size:11px;">' + escapeHtml(t("nippou.noCandidatesHint")) + '</span><br>' +
          '<button class="task-link" type="button" id="candidates-retry-btn">' + escapeHtml(t("common.retry")) + '</button>' +
          formatCandidateDebug(record.candidateDebug) + '</div>';
        bindCandidatesRetryButton();
      }
    } else {
      record.products.forEach(function (p, i) {
        els.productList.appendChild(renderProduct(p, i));
      });
    }

    bindEvents();
    updateSubmitState();
    updateAddButton();
  }

  function updateAddButton() {
    if (!els.addProductBtn) return;
    els.addProductBtn.hidden = false;
  }

  function bindEvents() {
    els.productList.querySelectorAll("[data-toggle]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var idx = Number(btn.getAttribute("data-toggle"));
        openIndex = openIndex === idx ? -1 : idx;
        render();
      });
    });

    els.productList.querySelectorAll("[data-remove]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var idx = Number(btn.getAttribute("data-remove"));
        var product = record.products[idx];
        if (!product) return;

        var dateTimeStr = visitStart && window.AnalysisLog ? AnalysisLog.formatAnalysisDateTime(new Date(visitStart)) : null;

        function removeLocally(toastMessage) {
          record.products.splice(idx, 1);
          openIndex = -1;
          saveStore(store);
          render();
          if (toastMessage) showToast(toastMessage);
        }

        if (!dateTimeStr || !product.itemCode || !window.AnalysisLog) {
          removeLocally();
          return;
        }

        btn.disabled = true;
        btn.textContent = t("nippou.productRemoving");

        AnalysisLog.deleteProductRow({ dateTimeStr: dateTimeStr, venue: visitName, itemCode: product.itemCode })
          .then(function (result) {
            removeLocally(result ? t("nippou.productRemovedWithSheet") : t("nippou.productRemoved"));
          })
          .catch(function (err) {
            console.warn("failed to delete analysis row", err);
            showToast(t("nippou.productRemoveFailed"));
            btn.disabled = false;
            btn.textContent = "🗑";
          });
      });
    });

    els.productList.querySelectorAll(".product-body input, .product-body textarea").forEach(function (input) {
      input.addEventListener("input", function () {
        var item = input.closest(".product-item");
        var idx = Number(item.querySelector("[data-toggle]").getAttribute("data-toggle"));
        var field = input.getAttribute("data-field");
        record.products[idx][field] = input.value;
        saveStore(store);
        updateBadgeOnly(idx);
        updateSubmitState();
      });
    });

    els.productList.querySelectorAll(".rank-chip").forEach(function (chip) {
      chip.addEventListener("click", function () {
        var item = chip.closest(".product-item");
        var idx = Number(item.querySelector("[data-toggle]").getAttribute("data-toggle"));
        var rank = chip.getAttribute("data-rank");
        record.products[idx].rank = record.products[idx].rank === rank ? "" : rank;
        saveStore(store);
        render();
      });
    });
  }

  function updateBadgeOnly(idx) {
    var item = els.productList.children[idx];
    if (!item) return;
    var badgeHost = item.querySelector(".product-header");
    var oldBadge = badgeHost.querySelector(".badge");
    if (oldBadge) oldBadge.outerHTML = statusBadge(productStatus(record.products[idx]));
  }

  function updateSubmitState() {
    if (!record || record.products.length === 0) {
      els.submitBtn.disabled = true;
      els.submitBtn.textContent = t("nippou.submitBtnDefault");
      els.submitHint.textContent = record ? t("nippou.submitHintAddProducts") : "";
      els.submitHint.classList.remove("is-warning");
      return;
    }

    var missing = record.products.filter(function (p) { return !p.rank; }).length;
    if (record.submitted) {
      els.submitBtn.disabled = false;
      els.submitBtn.textContent = t("nippou.submitBtnResubmit");
      els.submitHint.textContent = t("nippou.submitHintResubmittable");
      els.submitHint.classList.remove("is-warning");
    } else if (missing > 0) {
      els.submitBtn.disabled = true;
      els.submitBtn.textContent = t("nippou.submitBtnDefault");
      els.submitHint.textContent = t("nippou.submitHintMissingRank", { n: missing });
      els.submitHint.classList.add("is-warning");
    } else {
      els.submitBtn.disabled = false;
      els.submitBtn.textContent = t("nippou.submitBtnDefault");
      els.submitHint.textContent = t("nippou.submitHintOptional");
      els.submitHint.classList.remove("is-warning");
    }
  }

  // ---- Walk In: 商品を追加 ----

  var catalogCache = null;

  function openAddProductModal() {
    els.addProductSelect.innerHTML = '<option value="">' + escapeHtml(t("nippou.catalogLoading")) + '</option>';
    els.addProductModal.hidden = false;

    var loadCatalog = catalogCache ? Promise.resolve(catalogCache) : (window.ProductSource ? ProductSource.getWalkinCatalog() : Promise.resolve([]));
    loadCatalog.then(function (list) {
      catalogCache = list;
      if (list.length === 0) {
        els.addProductSelect.innerHTML = '<option value="">' + escapeHtml(t("nippou.catalogLoadFailed")) + '</option>';
        return;
      }
      els.addProductSelect.innerHTML = list.map(function (item, idx) {
        return '<option value="' + idx + '">' + escapeHtml(item.name) + '</option>';
      }).join("");
    }).catch(function (err) {
      console.warn("failed to load catalog", err);
      els.addProductSelect.innerHTML = '<option value="">' + escapeHtml(t("nippou.catalogFetchError")) + '</option>';
    });
  }

  function closeAddProductModal() {
    els.addProductModal.hidden = true;
  }

  function confirmAddProduct() {
    var idx = Number(els.addProductSelect.value);
    if (!catalogCache || isNaN(idx) || !catalogCache[idx]) return;
    var item = catalogCache[idx];
    if (!record) return;
    record.products.push(emptyProduct(item.name, { itemCode: item.itemCode, unit: item.unit }, true));
    openIndex = record.products.length - 1;
    saveStore(store);
    closeAddProductModal();
    render();
    showToast(t("nippou.productAdded"));
  }

  if (els.addProductBtn) {
    els.addProductBtn.addEventListener("click", openAddProductModal);
    els.addProductCancelBtn.addEventListener("click", closeAddProductModal);
    els.addProductModal.addEventListener("click", function (e) {
      if (e.target === els.addProductModal) closeAddProductModal();
    });
    els.addProductConfirmBtn.addEventListener("click", confirmAddProduct);
  }

  els.submitBtn.addEventListener("click", function () {
    if (!record || record.products.length === 0) return;
    var missing = record.products.filter(function (p) { return !p.rank; }).length;
    if (missing > 0) return;

    els.submitBtn.disabled = true;
    els.submitBtn.textContent = t("nippou.submitBtnWriting");

    var dateTimeStr = visitStart && window.AnalysisLog ? AnalysisLog.formatAnalysisDateTime(new Date(visitStart)) : null;
    var writePromise = (window.AnalysisLog && dateTimeStr)
      ? AnalysisLog.logNippouSubmission({
          dateTimeStr: dateTimeStr,
          venue: visitName,
          type: isWalkin ? "Walk In" : "アポ",
          products: record.products
        })
      : Promise.reject({ type: "not-available" });

    writePromise.then(function () {
      record.submitted = true;
      record.submittedAt = new Date().toISOString();
      saveStore(store);
      updateSubmitState();
      showToast(t("nippou.submittedToast"));
      setTimeout(function () {
        window.location.href = "schedule.html";
      }, 900);
    }).catch(function (err) {
      console.warn("failed to log nippou submission", err);
      var msg = t("nippou.submitFailed");
      if (err && err.type === "rep-not-configured") msg = t("nippou.repNotConfigured");
      else if (err && err.type === "file-not-found") msg = t("nippou.analysisFileNotFound");
      else if (err && (err.type === "unauthenticated" || err.type === "unauthorized")) msg = t("nippou.authExpired");
      showToast(msg);
      updateSubmitState();
    });
  });

  initRecord();
  if (window.Auth) {
    Auth.onChange(function () {
      if (!record) initRecord();
    });
  }
})();
