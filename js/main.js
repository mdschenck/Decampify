/* ============================================================================
 * Decampify — page renderer (BUILD-SPEC §4c, §4d)
 *
 * Fetches data/releases.json (the ONLY catalog source — nothing hardcoded),
 * then:
 *   1. hands the data to MRPlayer.init() (stations player, js/player.js),
 *   2. renders the Bandcamp-style album grid + expandable release detail,
 *   3. renders the Connect section from artist data + window.MR_CONFIG,
 *   4. fills the footer social nav from MR_CONFIG.socials.
 *
 * HISTORY / DEEP LINKS:
 *   Opening a release detail pushes a history entry with hash #album/<id>,
 *   so browser Back closes the detail and returns to the grid (popstate)
 *   instead of leaving the site. Closing via ✕ / breadcrumb / re-clicking the
 *   card calls history.back() so URL and UI stay in sync. Loading the page
 *   with #album/<id> already in the URL deep-links straight to that release.
 *   Switching directly from one open album to another REPLACES the history
 *   entry (back always returns to the grid, not a chain of albums).
 *
 * Store integration: the Buy/Download button calls window.MRStore.open(id)
 * (defined by js/store.js, owned by the store agent). If the store module has
 * not loaded, the button degrades gracefully (disabled state + tooltip).
 *
 * Adding a release = add an object to data/releases.json. That's it (§9).
 * ========================================================================== */
(function () {
  'use strict';

  var cfg = window.MR_CONFIG || {};
  var openDetailFor = null;   // release id currently expanded
  var detailEl = null;        // the single reusable detail panel <li>
  var nowPlaying = { releaseId: null, trackIndex: null };
  var releasesById = {};      // id -> release object
  var cardEls = {};           // id -> { li, btn }

  // ---- tiny DOM helpers ------------------------------------------------------
  function el(tag, className, text) {
    var n = document.createElement(tag);
    if (className) n.className = className;
    if (text != null) n.textContent = text;
    return n;
  }
  function extLink(a) { a.target = '_blank'; a.rel = 'noopener'; return a; }

  // ---- price labels (BUILD-SPEC §2 / §4c) ------------------------------------
  function money(n) {
    return '$' + (Number.isInteger(n) ? String(n) : n.toFixed(2));
  }
  function priceLabel(rel) {
    switch (rel.priceModel) {
      case 'nyp-floor': return money(rel.priceFloor) + ' or more';
      case 'nyp':       return 'name your price';
      case 'fixed':     return money(rel.priceFloor);
      case 'free':      return 'free';
      default:          return '';
    }
  }

  // ---- history / hash helpers -----------------------------------------------
  function albumHash(id) { return '#album/' + encodeURIComponent(id); }
  function hashAlbumId() {
    var m = /^#album\/(.+)$/.exec(window.location.hash);
    return m ? decodeURIComponent(m[1]) : null;
  }
  function clearHashUrl() {
    // strip the hash without adding a history entry
    history.replaceState(null, '', window.location.pathname + window.location.search);
  }
  // ---- boot ------------------------------------------------------------------
  var grid = document.getElementById('album-grid');

  fetch('/data/releases.json')
    .then(function (r) {
      if (!r.ok) throw new Error('releases.json ' + r.status);
      return r.json();
    })
    .then(function (data) {
      if (window.MRPlayer && window.MRPlayer.init) window.MRPlayer.init(data);
      renderGrid(data);
      renderConnect(data);
      renderSocial(document.querySelector('.site-footer .social'));
      window.addEventListener('mr:trackchange', onTrackChange);
      window.addEventListener('popstate', onPopState);

      // Deep link: /#album/<id> opens that release immediately on load.
      var initialId = hashAlbumId();
      if (initialId && releasesById[initialId]) {
        history.replaceState({ album: initialId }, '', albumHash(initialId));
        openDetail(initialId, true);
      } else if (initialId) {
        clearHashUrl(); // unknown album id in hash — drop it
      }
    })
    .catch(function (err) {
      if (grid) {
        grid.textContent = '';
        grid.appendChild(el('li', 'card-meta', 'Could not load the catalog. (' + err.message + ')'));
      }
    });

  // ---- album grid ------------------------------------------------------------
  function renderGrid(data) {
    if (!grid) return;
    grid.textContent = '';
    releasesById = {};
    cardEls = {};
    (data.releases || []).forEach(function (rel) {
      releasesById[rel.id] = rel;

      var li = el('li', 'release-card');
      li.dataset.releaseId = rel.id;

      var btn = el('button', 'card-button');
      btn.type = 'button';
      btn.setAttribute('aria-expanded', 'false');

      var img = el('img', 'card-art');
      img.src = rel.art;                       // placeholder SVG covers for now;
      img.alt = rel.title + ' cover art';      // swap real art at the same paths
      img.loading = 'lazy';
      img.width = 700; img.height = 700;       // CSS height:auto + 1:1 keeps it square

      btn.appendChild(img);
      btn.appendChild(el('span', 'card-title', rel.title));
      var meta = el('span', 'card-meta');
      meta.appendChild(el('span', 'card-year', String(rel.year)));
      meta.appendChild(el('span', 'card-price', priceLabel(rel)));
      btn.appendChild(meta);

      btn.addEventListener('click', function () {
        if (openDetailFor === rel.id) requestCloseDetail();
        else openDetail(rel.id, false);
      });
      li.appendChild(btn);
      grid.appendChild(li);
      cardEls[rel.id] = { li: li, btn: btn };
    });
  }

  // Pure-DOM close (no history side effects) — used by popstate too.
  function closeDetailDOM() {
    if (detailEl && detailEl.parentNode) detailEl.parentNode.removeChild(detailEl);
    detailEl = null;
    var openCard = grid ? grid.querySelector('.release-card.is-open') : null;
    if (openCard) {
      openCard.classList.remove('is-open');
      var b = openCard.querySelector('.card-button');
      if (b) b.setAttribute('aria-expanded', 'false');
    }
    openDetailFor = null;
  }

  // User-initiated close (✕ button, breadcrumb, re-clicking the open card):
  // go back through history when we own the current entry so URL stays synced.
  function requestCloseDetail() {
    if (history.state && history.state.album) {
      history.back();               // popstate handler does the DOM close
    } else {
      closeDetailDOM();
      if (hashAlbumId()) clearHashUrl();
    }
  }

  // Open a release detail. viaHistory=true → came from popstate/deep link,
  // so do NOT create a new history entry.
  function openDetail(id, viaHistory) {
    var rel = releasesById[id];
    var card = cardEls[id];
    if (!rel || !card) return;

    var wasOpen = openDetailFor !== null;
    closeDetailDOM();
    openDetailFor = id;
    card.li.classList.add('is-open');
    card.btn.setAttribute('aria-expanded', 'true');
    detailEl = buildDetail(rel);
    // Full-width panel flows onto the row after the clicked card
    card.li.insertAdjacentElement('afterend', detailEl);
    highlightTracks();

    if (!viaHistory) {
      if (wasOpen && history.state && history.state.album) {
        // album -> album: replace, so Back returns to the grid (not album chain)
        history.replaceState({ album: id }, '', albumHash(id));
      } else {
        history.pushState({ album: id }, '', albumHash(id));
      }
    }
    detailEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  // Back/forward: state (or hash) tells us which view this entry represents.
  function onPopState(e) {
    var id = (e.state && e.state.album) || hashAlbumId();
    if (id && releasesById[id]) openDetail(id, true);
    else closeDetailDOM();
  }

  function buildDetail(rel) {
    var li = el('li', 'release-detail');
    li.dataset.releaseId = rel.id;
    li.setAttribute('role', 'region');
    li.setAttribute('aria-label', rel.title + ' details');

    var close = el('button', 'btn btn-icon detail-close', '✕');
    close.type = 'button';
    close.setAttribute('aria-label', 'Close release details');
    close.addEventListener('click', requestCloseDetail);
    li.appendChild(close);

    // Breadcrumb: "← All releases / <Album Title>" — back link closes detail
    var crumb = el('nav', 'detail-breadcrumb');
    crumb.setAttribute('aria-label', 'Breadcrumb');
    var crumbBack = el('button', 'crumb-back', '← All releases');
    crumbBack.type = 'button';
    crumbBack.addEventListener('click', requestCloseDetail);
    crumb.appendChild(crumbBack);
    crumb.appendChild(el('span', 'crumb-sep', '/'));
    crumb.appendChild(el('span', 'crumb-current', rel.title));
    li.appendChild(crumb);

    var body = el('div', 'detail-body');

    var img = el('img', 'detail-art');
    img.src = rel.art;
    img.alt = rel.title + ' cover art';
    img.width = 700; img.height = 700;
    body.appendChild(img);

    var info = el('div', 'detail-info');
    info.appendChild(el('h3', 'detail-title', rel.title));
    info.appendChild(el('p', 'detail-meta', rel.year + ' · ' + priceLabel(rel)));

    // Actions: Buy/Download (store agent), Play release (player)
    // Note: no per-release Bandcamp link — keep the purchase decision on-site.
    // The single Bandcamp link lives in the Connect section at the bottom.
    var actions = el('div', 'detail-actions');

    // .btn-buy = success-green purchase styling (shared with the store panel)
    var buy = el('button', 'btn btn-buy', 'Buy / Download');
    buy.type = 'button';
    buy.addEventListener('click', function () {
      if (window.MRStore && typeof window.MRStore.open === 'function') {
        window.MRStore.open(rel.id);
      } else {
        // Store module (js/store.js) not loaded yet — degrade gracefully
        buy.disabled = true;
        buy.title = 'Store is still loading — try again in a moment';
        window.setTimeout(function () { buy.disabled = false; }, 1500);
      }
    });
    if (!(window.MRStore && typeof window.MRStore.open === 'function')) {
      buy.title = 'Store loading…';
    }
    actions.appendChild(buy);

    var playRel = el('button', 'btn', '▶ Play release');
    playRel.type = 'button';
    playRel.addEventListener('click', function () {
      if (window.MRPlayer) window.MRPlayer.playRelease(rel.id, 0);
    });
    actions.appendChild(playRel);

    info.appendChild(actions);

    // Track list — ▶ loads this release's station at that track (§4c)
    var list = el('ol', 'track-list');
    rel.tracks.forEach(function (t, i) {
      var row = el('li', 'track');
      row.dataset.trackIndex = String(i);

      var p = el('button', 'track-play', '▶');
      p.type = 'button';
      p.setAttribute('aria-label', 'Play ' + t.title);
      p.addEventListener('click', function () {
        if (window.MRPlayer) window.MRPlayer.playRelease(rel.id, i);
      });
      row.appendChild(p);
      row.appendChild(el('span', 'track-n', String(t.n).padStart(2, '0')));
      row.appendChild(el('span', 'track-title', t.title));
      row.appendChild(el('span', 'track-duration', t.duration || ''));
      list.appendChild(row);
    });
    info.appendChild(list);

    if (rel.notes) info.appendChild(el('p', 'detail-notes', rel.notes));
    if (rel.credits) info.appendChild(el('p', 'detail-credits', rel.credits));

    body.appendChild(info);
    li.appendChild(body);
    return li;
  }

  // ---- now-playing highlighting (event from js/player.js) --------------------
  function onTrackChange(e) {
    nowPlaying.releaseId = e.detail.releaseId;
    nowPlaying.trackIndex = e.detail.trackIndex;
    // card badge
    Array.prototype.forEach.call(grid.querySelectorAll('.release-card'), function (c) {
      c.classList.toggle('is-playing',
        e.detail.playing && c.dataset.releaseId === nowPlaying.releaseId);
    });
    highlightTracks();
  }
  function highlightTracks() {
    if (!detailEl) return;
    var match = detailEl.dataset.releaseId === nowPlaying.releaseId;
    Array.prototype.forEach.call(detailEl.querySelectorAll('.track'), function (row) {
      row.classList.toggle('is-playing',
        match && Number(row.dataset.trackIndex) === nowPlaying.trackIndex);
    });
  }

  // ---- Connect section (§4d) -------------------------------------------------
  function renderConnect(data) {
    var body = document.getElementById('connect-body');
    if (!body) return;
    body.textContent = '';

    var artist = data.artist || {};
    if (artist.bio) body.appendChild(el('p', 'bio', artist.bio));

    var actions = el('div', 'connect-actions');
    if (cfg.emailFormUrl) {  // Google Form link — never embedded as an iframe
      var mail = extLink(el('a', 'btn btn-primary', 'Join the email list'));
      mail.href = window.MRUtil.safeHref(cfg.emailFormUrl);
      actions.appendChild(mail);
    }
    if (cfg.merchUrl) {      // merch shop
      var merch = extLink(el('a', 'btn', 'Merch'));
      merch.href = window.MRUtil.safeHref(cfg.merchUrl);
      actions.appendChild(merch);
    }
    if (cfg.bandcampUrl) {
      var bc = extLink(el('a', 'btn', 'Bandcamp'));
      bc.href = window.MRUtil.safeHref(cfg.bandcampUrl);
      actions.appendChild(bc);
    }
    body.appendChild(actions);

    var social = el('nav', 'social');
    social.setAttribute('aria-label', 'Social');
    renderSocial(social);
    body.appendChild(social);

    var email = cfg.contactEmail || artist.contactEmail;
    if (email) {
      var contact = el('p', 'contact', 'Contact / booking: ');
      var a = el('a', null, email);
      a.href = 'mailto:' + email;
      contact.appendChild(a);
      body.appendChild(contact);
    }
  }

  // Social links from MR_CONFIG.socials (used in Connect AND the footer)
  function renderSocial(container) {
    if (!container) return;
    container.textContent = '';
    var socials = cfg.socials || {};
    var labels = {
      instagram: 'Instagram', tiktok: 'TikTok', x: 'X', bluesky: 'Bluesky',
      soundcloud: 'SoundCloud', youtube: 'YouTube', spotify: 'Spotify'
    };
    Object.keys(socials).forEach(function (k) {
      if (!socials[k]) return;
      var a = extLink(el('a', null, labels[k] || k));
      a.href = window.MRUtil.safeHref(socials[k]);
      container.appendChild(a);
    });
  }
})();
