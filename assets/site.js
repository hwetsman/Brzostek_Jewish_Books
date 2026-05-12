// Brzostek site — search, lightbox, corrections form.
// Plain vanilla JS. Loaded with `defer`; runs after DOMContentLoaded.

(function () {
  "use strict";

  document.addEventListener("DOMContentLoaded", function () {
    initSearch();
    initLightbox();
    initCorrectionsForm();
  });

  // -----------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------
  function basePrefix() {
    var b = document.body.getAttribute("data-base") || "";
    return b;
  }
  function escapeHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  // -----------------------------------------------------------------
  // Search
  // -----------------------------------------------------------------
  function initSearch() {
    var box = document.getElementById("search-box");
    var resultsEl = document.getElementById("search-results");
    if (!box || !resultsEl) return;

    if (typeof MiniSearch === "undefined") {
      window.brzSearch = {
        submit: function (e) {
          if (e) e.preventDefault();
          alert("Search index could not load. Try reloading the page.");
          return false;
        }
      };
      return;
    }

    var peopleIdx = null, recordsIdx = null;
    var peopleData = [], recordsData = [];
    var loaded = false, loading = false;

    function tokenize(s) {
      return String(s || "").toLowerCase().split(/[^a-z0-9'À-ɏ]+/i)
        .filter(Boolean);
    }
    // Daitch-Mokotoff is computed at build time and stored in the
    // `phonetic` field of each doc. We OR the phoneticized query into
    // the search at lower weight.
    function dmCodes(token) {
      // Simple proxy: phonetic field is already populated. The runtime
      // can't compute DM, so we let MiniSearch's prefix+fuzzy do the
      // initial work and rely on the indexed phonetic tokens to catch
      // alternate spellings if the user types one of them. To improve
      // recall we also issue the raw query against the phonetic field.
      return [];
    }

    function load() {
      if (loaded || loading) return Promise.resolve();
      loading = true;
      return fetch(basePrefix() + "data/search-index.json")
        .then(function (r) { return r.json(); })
        .then(function (data) {
          peopleData = data.persons || [];
          recordsData = data.records || [];

          peopleIdx = new MiniSearch({
            fields: ["display", "legal_given", "common_given",
                     "legal_surname", "common_surname", "maiden_surname",
                     "father_name", "mother_name", "spouse_names",
                     "residences", "phonetic"],
            storeFields: ["id", "display", "birth_date", "death_date",
                          "residences"],
            searchOptions: {
              boost: { legal_surname: 3, common_surname: 3,
                       maiden_surname: 3,
                       legal_given: 2, common_given: 2,
                       phonetic: 1 },
              prefix: true,
              fuzzy: function (term) { return term.length >= 4 ? 0.2 : 0; }
            }
          });
          peopleIdx.addAll(peopleData);

          recordsIdx = new MiniSearch({
            fields: ["id", "summary", "prose", "people", "phonetic",
                     "book", "year"],
            storeFields: ["id", "summary", "book", "year", "number"],
            searchOptions: {
              boost: { id: 5, people: 2, summary: 2, phonetic: 1 },
              prefix: true,
              fuzzy: function (term) { return term.length >= 4 ? 0.2 : 0; }
            }
          });
          recordsIdx.addAll(recordsData);

          loaded = true; loading = false;
        })
        .catch(function (e) {
          loading = false;
          console.error("Search index failed to load:", e);
        });
    }

    function tabSwitch(name) {
      var btns = resultsEl.querySelectorAll(".search-tabs button");
      btns.forEach(function (b) {
        b.classList.toggle("active", b.dataset.tab === name);
      });
      resultsEl.querySelector("#people-list").hidden = name !== "people";
      resultsEl.querySelector("#records-list").hidden = name !== "records";
    }

    resultsEl.querySelectorAll(".search-tabs button").forEach(function (b) {
      b.addEventListener("click", function () { tabSwitch(b.dataset.tab); });
    });

    function direct(q) {
      var s = q.trim();
      if (/^P\d{4}$/.test(s)) {
        window.location.href = basePrefix() + "person/" + s + ".html";
        return true;
      }
      if (/^[bdm]-\d{4}-\d+$/.test(s)) {
        window.location.href = basePrefix() + "record/" + s + ".html";
        return true;
      }
      return false;
    }

    function render(q) {
      if (!q) {
        resultsEl.hidden = true;
        return;
      }
      if (!loaded) {
        resultsEl.hidden = false;
        document.getElementById("people-list").innerHTML =
          "<li class='meta'>Loading search index…</li>";
        document.getElementById("records-list").innerHTML = "";
        return;
      }

      var ppl = peopleIdx.search(q, { combineWith: "AND" });
      var rec = recordsIdx.search(q, { combineWith: "AND" });
      ppl = ppl.slice(0, 50);
      rec = rec.slice(0, 50);

      document.getElementById("ppl-count").textContent = ppl.length;
      document.getElementById("rec-count").textContent = rec.length;

      var pl = document.getElementById("people-list");
      pl.innerHTML = ppl.map(function (r) {
        var meta = [];
        if (r.birth_date) meta.push("b. " + escapeHtml(r.birth_date));
        if (r.death_date) meta.push("d. " + escapeHtml(r.death_date));
        if (r.residences) meta.push(escapeHtml(r.residences));
        return "<li><a href='" + basePrefix() + "person/" + r.id +
          ".html'><strong>" + escapeHtml(r.display) +
          "</strong> <code>" + r.id + "</code>" +
          "<div class='meta'>" + meta.join(" · ") + "</div></a></li>";
      }).join("") || "<li class='meta'>No people matched.</li>";

      var rl = document.getElementById("records-list");
      rl.innerHTML = rec.map(function (r) {
        return "<li><a href='" + basePrefix() + "record/" + r.id +
          ".html'><strong>" + escapeHtml(r.summary) +
          "</strong> <code>" + r.id + "</code></a></li>";
      }).join("") || "<li class='meta'>No records matched.</li>";

      resultsEl.hidden = false;
      // Default to whichever has more hits.
      tabSwitch(ppl.length >= rec.length ? "people" : "records");
    }

    var debounceTimer = null;
    box.addEventListener("input", function () {
      var q = box.value.trim();
      if (q.length < 2) { resultsEl.hidden = true; return; }
      load().then(function () {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(function () { render(q); }, 60);
      });
    });
    box.addEventListener("focus", function () { load(); });

    document.addEventListener("click", function (e) {
      if (!resultsEl.contains(e.target) && e.target !== box) {
        resultsEl.hidden = true;
      }
    });

    window.brzSearch = {
      submit: function (ev) {
        if (ev) ev.preventDefault();
        var q = box.value.trim();
        if (direct(q)) return false;
        load().then(function () { render(q); });
        return false;
      }
    };
  }

  // -----------------------------------------------------------------
  // Lightbox
  // -----------------------------------------------------------------
  function initLightbox() {
    var lb = document.getElementById("lightbox");
    if (!lb) return;
    var img = document.getElementById("lightbox-img");
    var close = lb.querySelector(".lightbox-close");
    function show(src, alt) {
      img.src = src;
      img.alt = alt || "Page scan";
      lb.hidden = false;
      document.body.style.overflow = "hidden";
    }
    function hide() {
      lb.hidden = true;
      img.src = "";
      document.body.style.overflow = "";
    }
    document.querySelectorAll(".lightbox-link").forEach(function (a) {
      a.addEventListener("click", function (e) {
        e.preventDefault();
        show(a.dataset.image || a.href, a.dataset.alt);
      });
    });
    close.addEventListener("click", hide);
    lb.addEventListener("click", function (e) {
      if (e.target === lb) hide();
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && !lb.hidden) hide();
    });
  }

  // -----------------------------------------------------------------
  // Corrections form
  // -----------------------------------------------------------------
  function initCorrectionsForm() {
    document.querySelectorAll(".corr-toggle").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var form = document.getElementById(btn.dataset.target);
        if (form) form.hidden = !form.hidden;
      });
    });
    document.querySelectorAll(".corr-form").forEach(function (form) {
      var urlField = form.querySelector("input[name=page_url]");
      if (urlField) urlField.value = window.location.href;
      form.addEventListener("submit", function (e) {
        e.preventDefault();
        var status = form.querySelector(".corr-status");
        var endpoint = (window.SITE_CONFIG && window.SITE_CONFIG.formEndpoint) || "";
        if (!endpoint) {
          // Local / pre-deploy preview: no Formspree endpoint set yet.
          // Show a clean thank-you so the form is testable without a
          // real submission going anywhere.
          form.reset();
          status.hidden = false;
          status.className = "corr-status ok";
          status.textContent =
            "Thank you. (Preview mode — the form endpoint is not yet " +
            "configured, so this submission was not actually sent.)";
          return;
        }
        form.action = endpoint;
        var fd = new FormData(form);
        fetch(endpoint, {
          method: "POST",
          body: fd,
          headers: { "Accept": "application/json" }
        }).then(function (r) {
          if (r.ok) {
            form.reset();
            status.hidden = false;
            status.className = "corr-status ok";
            status.textContent =
              "Thank you. Your correction has been sent.";
          } else {
            return r.json().then(function (j) { throw j; });
          }
        }).catch(function () {
          status.hidden = false;
          status.className = "corr-status err";
          status.textContent =
            "Something went wrong. Please try again later.";
        });
      });
    });
  }
})();
