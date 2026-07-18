/* ============================================================================
 * Decampify — store buy-flow (BUILD-SPEC §5)
 *
 * Exposes window.MRStore = { open(releaseId) }.
 * main.js wires the "Buy / Download" button on each release to MRStore.open().
 *
 * Panel behavior:
 *   - Accessible modal dialog matching the site design system (uses the
 *     .card / .btn / .btn-primary / .section-heading / .visually-hidden
 *     class contract from css/style.css plus a few scoped .mr-store-* rules
 *     injected below — style.css itself is untouched).
 *   - WAV / MP3 format toggle. Amount input for nyp / nyp-floor releases
 *     (prefilled with the floor, minimum enforced). $0 allowed for nyp/free
 *     ("Download for free").
 *
 * MOCK MODE (window.MR_CONFIG.mock === true):
 *   No network calls at all. Confirm simulates a short "processing" pause and
 *   then shows a success panel with clearly-labeled placeholder downloads
 *   ("demo — real files delivered after upload"), echoing the chosen
 *   amount/format. The whole purchase UX is clickable with no accounts.
 *
 * REAL MODE (mock:false):
 *   Confirm → POST MR_CONFIG.api.createCheckout:
 *     { url }          → redirect to Stripe Checkout
 *     { free, token }  → GET MR_CONFIG.api.verifyDownload?token=… and render
 *                        the returned signed download links
 *   Returning from Stripe: the success_url lands back on the home page with
 *   ?purchase=success&session_id=… — on load this module auto-opens the panel
 *   and calls verifyDownload?session_id=… to show the buyer's downloads.
 * ========================================================================== */
(function () {
  'use strict';

  var CFG = window.MR_CONFIG || {};
  var API = CFG.api || {};

  var dataPromise = null;  // cached fetch of /data/releases.json
  var overlay = null;      // current modal overlay element (null = closed)
  var lastFocus = null;    // element to restore focus to on close
  var opening = false;     // guard against double-open racing the data fetch

  /* ---- data ------------------------------------------------------------- */

  function loadData() {
    if (!dataPromise) {
      dataPromise = fetch('/data/releases.json').then(function (r) {
        if (!r.ok) throw new Error('releases.json ' + r.status);
        return r.json();
      });
    }
    return dataPromise;
  }

  function fmtUSD(n) {
    return '$' + (Math.round(n * 100) / 100).toFixed(2);
  }

  /* ---- scoped styles (site tokens; style.css is owned by the home agent) - */

  function injectStyles() {
    if (document.getElementById('mr-store-css')) return;
    var css = '' +
      '.mr-store-overlay{position:fixed;inset:0;z-index:90;background:rgba(11,11,16,.82);' +
        'display:grid;place-items:center;padding:var(--gap);overflow-y:auto;}' +
      '.mr-store-panel{width:min(480px,100%);max-height:calc(100vh - 2*var(--gap));overflow-y:auto;' +
        'position:relative;padding:var(--gap);display:grid;gap:14px;}' +
      '.mr-store-panel .section-heading{margin:0;font-size:.95rem;padding-right:5em;}' +
      '.mr-store-close{position:absolute;top:10px;right:10px;font-size:.68rem;}' +
      '.mr-store-head{display:flex;gap:14px;align-items:center;}' +
      '.mr-store-art{width:84px;height:84px;flex:0 0 auto;object-fit:cover;' +
        'border:1px solid var(--line);border-radius:var(--radius);background:var(--bg-elev-2);}' +
      '.mr-store-title{margin:0;font-size:.9rem;line-height:1.35;}' +
      '.mr-store-dim{margin:2px 0 0;font-family:var(--font-display);text-transform:uppercase;' +
        'letter-spacing:.08em;font-size:.68rem;color:var(--text-dim);}' +
      '.mr-store-row{display:flex;flex-wrap:wrap;align-items:center;gap:10px;}' +
      '.mr-store-panel .btn[aria-pressed="true"]{border-color:var(--accent);color:var(--accent);background:var(--bg);}' +
      '.mr-store-amount{width:110px;padding:.5em .7em;background:var(--bg-elev-2);color:var(--text);' +
        'border:1px solid var(--line);border-radius:var(--radius);font-family:var(--font-display);font-size:.85rem;}' +
      '.mr-store-amount:focus-visible{outline:2px solid var(--accent);outline-offset:2px;}' +
      '.mr-store-error{margin:0;font-family:var(--font-display);text-transform:uppercase;' +
        'letter-spacing:.08em;font-size:.7rem;color:var(--accent-2);}' +
      '.mr-store-files{list-style:none;margin:0;padding:0;display:grid;gap:8px;justify-items:start;}' +
      '.mr-store-note{margin:0;font-family:var(--font-display);text-transform:uppercase;' +
        'letter-spacing:.1em;font-size:.62rem;color:var(--text-dim);}' +
      '.mr-store-note::before{content:"▚ ";color:var(--accent-2);}';
    var style = document.createElement('style');
    style.id = 'mr-store-css';
    style.textContent = css;
    document.head.appendChild(style);
  }

  /* ---- modal shell ------------------------------------------------------- */

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function closePanel() {
    if (!overlay) return;
    document.removeEventListener('keydown', onKeydown, true);
    overlay.remove();
    overlay = null;
    if (lastFocus && typeof lastFocus.focus === 'function') lastFocus.focus();
    lastFocus = null;
  }

  function onKeydown(e) {
    if (!overlay) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      closePanel();
      return;
    }
    if (e.key === 'Tab') {
      // Simple focus trap: cycle within the dialog.
      var focusables = overlay.querySelectorAll(
        'button, a[href], input, select, [tabindex]:not([tabindex="-1"])'
      );
      if (!focusables.length) return;
      var first = focusables[0];
      var last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault(); last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault(); first.focus();
      }
    }
  }

  /**
   * Create (or replace) the modal shell and return the panel element to fill.
   * headingText labels the dialog for screen readers.
   */
  function openShell(headingText) {
    injectStyles();
    closePanel(); // guard: never two panels at once
    lastFocus = document.activeElement;

    overlay = el('div', 'mr-store-overlay');
    var panel = el('div', 'card mr-store-panel');
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-labelledby', 'mr-store-heading');
    panel.tabIndex = -1;

    var heading = el('h2', 'section-heading', headingText);
    heading.id = 'mr-store-heading';
    panel.appendChild(heading);

    var close = el('button', 'btn mr-store-close', 'Close ✕');
    close.type = 'button';
    close.addEventListener('click', closePanel);
    panel.appendChild(close);

    overlay.appendChild(panel);
    overlay.addEventListener('mousedown', function (e) {
      if (e.target === overlay) closePanel(); // click on backdrop closes
    });
    document.body.appendChild(overlay);
    document.addEventListener('keydown', onKeydown, true);
    panel.focus();
    return panel;
  }

  /** Cover + title header row shared by buy and success panels. */
  function headerRow(rel, subText) {
    var head = el('div', 'mr-store-head');
    var art = el('img', 'mr-store-art');
    art.src = rel.art;
    art.alt = '';
    art.width = 84; art.height = 84;
    head.appendChild(art);
    var txt = el('div');
    txt.appendChild(el('p', 'mr-store-title card-title', rel.title));
    if (subText) txt.appendChild(el('p', 'mr-store-dim', subText));
    head.appendChild(txt);
    return head;
  }

  /* ---- buy panel ---------------------------------------------------------- */

  function buildBuyPanel(rel) {
    var panel = openShell('Buy / Download');
    var model = rel.priceModel;
    var floor = Number(rel.priceFloor) || 0;
    var format = 'wav';

    panel.appendChild(headerRow(rel, rel.year + ' — digital release'));

    // Format toggle — WAV / MP3
    var fmtRow = el('div', 'mr-store-row');
    fmtRow.setAttribute('role', 'group');
    fmtRow.setAttribute('aria-label', 'Download format');
    var wavBtn = el('button', 'btn', 'WAV');
    var mp3Btn = el('button', 'btn', 'MP3');
    [wavBtn, mp3Btn].forEach(function (b) { b.type = 'button'; });
    function setFormat(f) {
      format = f;
      wavBtn.setAttribute('aria-pressed', String(f === 'wav'));
      mp3Btn.setAttribute('aria-pressed', String(f === 'mp3'));
    }
    wavBtn.addEventListener('click', function () { setFormat('wav'); });
    mp3Btn.addEventListener('click', function () { setFormat('mp3'); });
    setFormat('wav');
    fmtRow.appendChild(wavBtn);
    fmtRow.appendChild(mp3Btn);
    panel.appendChild(fmtRow);

    // Price row — varies by price model
    var amountInput = null;
    var priceRow = el('div', 'mr-store-row');
    if (model === 'fixed') {
      priceRow.appendChild(el('p', 'mr-store-dim', 'Price: ' + fmtUSD(floor)));
    } else if (model === 'free') {
      priceRow.appendChild(el('p', 'mr-store-dim', 'Free download'));
    } else { // nyp or nyp-floor
      var lbl = el('label', 'mr-store-dim',
        model === 'nyp-floor'
          ? 'Name your price (' + fmtUSD(floor) + ' or more)'
          : 'Name your price ($0 = free)');
      lbl.htmlFor = 'mr-store-amount';
      amountInput = el('input', 'mr-store-amount');
      amountInput.type = 'number';
      amountInput.id = 'mr-store-amount';
      amountInput.min = String(floor);
      amountInput.step = '0.01';
      amountInput.inputMode = 'decimal';
      amountInput.value = floor.toFixed(2);
      priceRow.appendChild(lbl);
      priceRow.appendChild(amountInput);
    }
    panel.appendChild(priceRow);

    // Error line + confirm button
    var error = el('p', 'mr-store-error');
    error.setAttribute('aria-live', 'polite');
    panel.appendChild(error);

    var actions = el('div', 'mr-store-row');
    // .btn-buy = success-green purchase styling (matches the release-detail
    // Buy/Download button — defined in css/style.css)
    var confirm = el('button', 'btn btn-buy');
    confirm.type = 'button';
    actions.appendChild(confirm);
    panel.appendChild(actions);

    function currentAmount() {
      if (model === 'free') return 0;
      if (model === 'fixed') return floor;
      var v = parseFloat(amountInput.value);
      return isNaN(v) ? NaN : v;
    }
    function refreshConfirmLabel() {
      var amt = currentAmount();
      confirm.textContent = (amt === 0 || model === 'free')
        ? 'Download for free'
        : 'Buy — ' + (isNaN(amt) ? '…' : fmtUSD(amt));
    }
    if (amountInput) amountInput.addEventListener('input', refreshConfirmLabel);
    refreshConfirmLabel();

    confirm.addEventListener('click', function () {
      var amt = currentAmount();
      // Client-side price-model check (server re-validates in real mode)
      if (isNaN(amt) || amt < 0) {
        error.textContent = 'Enter a valid amount.';
        return;
      }
      if ((model === 'nyp-floor' || model === 'fixed') && amt < floor) {
        error.textContent = 'Minimum price is ' + fmtUSD(floor) + '.';
        return;
      }
      error.textContent = '';
      confirm.disabled = true;
      confirm.textContent = 'Processing…';
      if (CFG.mock) {
        mockPurchase(rel, amt, format);
      } else {
        realPurchase(rel, amt, format, function fail(msg) {
          confirm.disabled = false;
          refreshConfirmLabel();
          error.textContent = msg;
        });
      }
    });
  }

  /* ---- mock purchase (MR_CONFIG.mock === true — no network) --------------- */

  function mockPurchase(rel, amount, format) {
    // Brief fake "processing" so the flow feels real, then a success panel.
    window.setTimeout(function () {
      var panel = openShell('Purchase complete');
      panel.appendChild(headerRow(rel,
        (amount === 0 ? 'Free download' : 'Paid ' + fmtUSD(amount)) +
        ' — ' + format.toUpperCase()));

      var list = el('ul', 'mr-store-files');
      (rel.tracks || []).forEach(function (t) {
        var li = el('li');
        var link = el('a', 'btn', t.n + '. ' + t.title + ' (' + format.toUpperCase() + ')');
        link.href = '#';
        link.setAttribute('aria-disabled', 'true');
        link.addEventListener('click', function (e) { e.preventDefault(); });
        li.appendChild(link);
        list.appendChild(li);
      });
      var bundle = el('a', 'btn btn-primary', 'Download all (ZIP — ' + format.toUpperCase() + ')');
      bundle.href = '#';
      bundle.setAttribute('aria-disabled', 'true');
      bundle.addEventListener('click', function (e) { e.preventDefault(); });
      var bundleLi = el('li');
      bundleLi.appendChild(bundle);
      list.appendChild(bundleLi);
      panel.appendChild(list);

      panel.appendChild(el('p', 'mr-store-note',
        'demo — real files delivered after upload'));
    }, 900);
  }

  /* ---- real purchase (mock:false — talks to /api) -------------------------- */

  function postJSON(url, body) {
    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (json) {
        if (!r.ok) throw new Error(json.error || ('Request failed (' + r.status + ')'));
        return json;
      });
    });
  }

  function getJSON(url) {
    return fetch(url).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (json) {
        if (!r.ok) throw new Error(json.error || ('Request failed (' + r.status + ')'));
        return json;
      });
    });
  }

  function realPurchase(rel, amount, format, onFail) {
    postJSON(API.createCheckout, { releaseId: rel.id, amount: amount, format: format })
      .then(function (json) {
        if (json.url) {
          // Paid path — hand off to Stripe Checkout. Stripe returns the buyer
          // to /?purchase=success&session_id=… (handled below on page load).
          window.location.assign(json.url);
          return;
        }
        if (json.free && json.token) {
          // Free path — redeem the token immediately for signed links.
          return getJSON(API.verifyDownload + '?token=' + encodeURIComponent(json.token))
            .then(function (dl) { renderDownloads(dl, rel); });
        }
        throw new Error('Unexpected response from checkout.');
      })
      .catch(function (err) { onFail(err.message || 'Checkout failed.'); });
  }

  /** Render verify-download's response ({ok, release, format, files, bundleUrl}). */
  function renderDownloads(dl, relMaybe) {
    var panel = openShell('Your downloads');
    if (relMaybe && relMaybe.art) {
      panel.appendChild(headerRow(relMaybe, (dl.format || '').toUpperCase() + ' files'));
    } else if (dl.release) {
      panel.appendChild(el('p', 'mr-store-title card-title', dl.release.title));
    }

    var list = el('ul', 'mr-store-files');
    (dl.files || []).forEach(function (f) {
      var li = el('li');
      var link = el('a', 'btn', f.label);
      link.href = f.url;
      link.setAttribute('download', '');
      li.appendChild(link);
      list.appendChild(li);
    });
    if (dl.bundleUrl) {
      var li = el('li');
      var bundle = el('a', 'btn btn-primary',
        'Download all (ZIP' + (dl.format ? ' — ' + dl.format.toUpperCase() : '') + ')');
      bundle.href = dl.bundleUrl;
      bundle.setAttribute('download', '');
      li.appendChild(bundle);
      list.appendChild(li);
    }
    panel.appendChild(list);
    panel.appendChild(el('p', 'mr-store-note',
      'links expire in ~10 minutes — download now'));
  }

  /* ---- public API ---------------------------------------------------------- */

  function open(releaseId) {
    if (opening) return; // guard: ignore double-clicks while data loads
    opening = true;
    loadData()
      .then(function (data) {
        var rel = (data.releases || []).find(function (r) { return r.id === releaseId; });
        if (!rel) throw new Error('Unknown release: ' + releaseId);
        buildBuyPanel(rel);
      })
      .catch(function (err) {
        // Missing data — fail quietly in UI terms, loudly in the console.
        console.error('[MRStore]', err);
      })
      .then(function () { opening = false; });
  }

  window.MRStore = { open: open };

  /* ---- Stripe success return ------------------------------------------------
   * Stripe's success_url lands here as /?purchase=success&session_id=cs_…
   * Auto-open the panel and fetch the buyer's download links. Mock mode never
   * redirects to Stripe, so this only applies when mock:false. */
  (function handleSuccessReturn() {
    var params = new URLSearchParams(window.location.search);
    if (params.get('purchase') !== 'success' || !params.get('session_id')) return;
    var sessionId = params.get('session_id');
    // Clean the URL so refresh/bookmark doesn't re-trigger verification.
    window.history.replaceState({}, '', window.location.pathname);
    if (CFG.mock) return;

    var panel = openShell('Your downloads');
    panel.appendChild(el('p', 'mr-store-dim', 'Verifying your purchase…'));
    getJSON(API.verifyDownload + '?session_id=' + encodeURIComponent(sessionId))
      .then(function (dl) {
        // Enrich with catalog art/title if we can, then render.
        return loadData()
          .catch(function () { return null; })
          .then(function (data) {
            var rel = data && dl.release
              ? (data.releases || []).find(function (r) { return r.id === dl.release.id; })
              : null;
            renderDownloads(dl, rel || null);
          });
      })
      .catch(function (err) {
        var p = openShell('Purchase');
        p.appendChild(el('p', 'mr-store-error', err.message || 'Could not verify purchase.'));
        p.appendChild(el('p', 'mr-store-dim',
          'If you were charged, contact ' + (CFG.contactEmail || 'the artist') + ' with your receipt.'));
      });
  })();
})();
