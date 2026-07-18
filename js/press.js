/*
 * Decampify — Press & Videos page renderer.
 *
 * Renders press.html entirely from /data/press.json (BUILD-SPEC §6, §9):
 * adding a new article/video = add one object to the JSON, never touch HTML.
 *
 * Item shape: { id, type ("article"|"video"), title, source, date (YYYY-MM-DD),
 *               summary, url, image }
 * If `image` is empty, a geometric SVG placeholder in the site palette is
 * generated inline (deterministic per item id, so each card looks distinct).
 */
(function () {
  "use strict";

  /* Mirrors the light-theme tokens in css/style.css :root (SVG attributes
     can't read CSS vars) — keep in sync if you re-theme. */
  var PALETTE = {
    bg: "#e9e9ec",      /* --bg-elev-2 */
    line: "#d7d7dc",    /* --line      */
    accent: "#26262b",  /* --accent    */
    accent2: "#5c5c66"  /* --text-dim  */
  };

  var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
                "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  /* "2025-12-01" -> "Dec 2025". Parsed by hand (no `new Date(string)`) so the
     result never shifts a day across timezones. Falls back to the raw string. */
  function formatDate(iso) {
    if (typeof iso !== "string") return "";
    var m = /^(\d{4})-(\d{2})/.exec(iso);
    if (!m) return iso;
    var month = MONTHS[parseInt(m[2], 10) - 1];
    return month ? month + " " + m[1] : iso;
  }

  /* Small deterministic hash so each placeholder varies per item id. */
  function hashString(str) {
    var h = 2166136261;
    str = String(str || "");
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  /* Inline geometric SVG placeholder (site palette, no network request).
     16:9 to match real preview thumbnails. Decorative — hidden from AT. */
  function makePlaceholder(seed) {
    var h = hashString(seed);
    var svgNS = "http://www.w3.org/2000/svg";
    var svg = document.createElementNS(svgNS, "svg");
    svg.setAttribute("viewBox", "0 0 320 180");
    svg.setAttribute("class", "press-media");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("focusable", "false");

    var rect = document.createElementNS(svgNS, "rect");
    rect.setAttribute("width", "320");
    rect.setAttribute("height", "180");
    rect.setAttribute("fill", PALETTE.bg);
    svg.appendChild(rect);

    /* Grid lines */
    var g = document.createElementNS(svgNS, "g");
    g.setAttribute("stroke", PALETTE.line);
    g.setAttribute("stroke-width", "1");
    for (var x = 40; x < 320; x += 40) {
      var v = document.createElementNS(svgNS, "line");
      v.setAttribute("x1", x); v.setAttribute("y1", "0");
      v.setAttribute("x2", x); v.setAttribute("y2", "180");
      g.appendChild(v);
    }
    for (var y = 45; y < 180; y += 45) {
      var hl = document.createElementNS(svgNS, "line");
      hl.setAttribute("x1", "0"); hl.setAttribute("y1", y);
      hl.setAttribute("x2", "320"); hl.setAttribute("y2", y);
      g.appendChild(hl);
    }
    svg.appendChild(g);

    /* Two triangles + a small square, positioned/colored by the seed */
    var tx = 40 + (h % 5) * 40;          /* 40..200 */
    var ty = 45 + ((h >> 3) % 3) * 30;   /* 45..105 */
    var flip = (h >> 6) % 2 === 0;

    var tri1 = document.createElementNS(svgNS, "polygon");
    tri1.setAttribute("points",
      tx + "," + (ty + 60) + " " + (tx + 60) + "," + (ty + 60) + " " + (tx + 30) + "," + ty);
    tri1.setAttribute("fill", flip ? PALETTE.accent : PALETTE.accent2);
    svg.appendChild(tri1);

    var tri2 = document.createElementNS(svgNS, "polygon");
    tri2.setAttribute("points",
      (tx + 44) + "," + ty + " " + (tx + 104) + "," + ty + " " + (tx + 74) + "," + (ty + 60));
    tri2.setAttribute("fill", "none");
    tri2.setAttribute("stroke", flip ? PALETTE.accent2 : PALETTE.accent);
    tri2.setAttribute("stroke-width", "2");
    svg.appendChild(tri2);

    var sq = document.createElementNS(svgNS, "rect");
    sq.setAttribute("x", 250 - ((h >> 9) % 4) * 30);
    sq.setAttribute("y", 24 + ((h >> 11) % 3) * 40);
    sq.setAttribute("width", "18");
    sq.setAttribute("height", "18");
    sq.setAttribute("fill", "none");
    sq.setAttribute("stroke", PALETTE.accent);
    sq.setAttribute("stroke-width", "2");
    svg.appendChild(sq);

    return svg;
  }

  /* Build one press card <li>. All JSON values are inserted with textContent /
     attribute setters — never string-built HTML — so content stays inert. */
  function buildCard(item) {
    var li = document.createElement("li");
    li.className = "card press-card";

    /* Preview image (real image if provided; generated placeholder otherwise).
       The YouTube thumbnail in press.json is the one allowed remote image. */
    if (item.image) {
      var img = document.createElement("img");
      img.className = "press-media";
      img.src = item.image;
      img.alt = "";                 /* decorative — the title is adjacent text */
      img.loading = "lazy";
      /* If the remote thumbnail ever fails, swap in the placeholder */
      img.addEventListener("error", function () {
        var ph = makePlaceholder(item.id || item.title);
        if (img.parentNode) img.parentNode.replaceChild(ph, img);
      });
      li.appendChild(img);
    } else {
      li.appendChild(makePlaceholder(item.id || item.title));
    }

    var body = document.createElement("div");
    body.className = "press-body";

    var h2 = document.createElement("h2");
    h2.textContent = item.title || "";
    body.appendChild(h2);

    var byline = document.createElement("p");
    byline.className = "press-byline";
    var srcSpan = document.createElement("span");
    srcSpan.className = "press-source";
    srcSpan.textContent = item.source || "";
    byline.appendChild(srcSpan);
    var dateText = formatDate(item.date);
    if (dateText) byline.appendChild(document.createTextNode(" — " + dateText));
    body.appendChild(byline);

    var summary = document.createElement("p");
    summary.className = "press-summary";
    summary.textContent = item.summary || "";
    body.appendChild(summary);

    if (item.url) {
      var link = document.createElement("a");
      link.className = "btn";
      link.href = window.MRUtil.safeHref(item.url);
      link.target = "_blank";
      link.rel = "noopener";
      /* Label by type: video -> Watch, everything else -> Read */
      link.textContent = (item.type === "video" ? "Watch" : "Read") + " →";
      body.appendChild(link);
    }

    li.appendChild(body);
    return li;
  }

  /* Footer social links from window.MR_CONFIG.socials (BUILD-SPEC §1 shell). */
  var SOCIAL_LABELS = {
    instagram: "Instagram", tiktok: "TikTok", x: "X", bluesky: "Bluesky",
    soundcloud: "SoundCloud", youtube: "YouTube"
  };
  function fillFooterSocials() {
    var nav = document.querySelector(".site-footer .social");
    var cfg = window.MR_CONFIG;
    if (!nav || !cfg || !cfg.socials) return;
    Object.keys(cfg.socials).forEach(function (key) {
      var a = document.createElement("a");
      a.href = window.MRUtil.safeHref(cfg.socials[key]);
      a.target = "_blank";
      a.rel = "noopener";
      a.textContent = SOCIAL_LABELS[key] || key;
      nav.appendChild(a);
    });
  }

  function init() {
    fillFooterSocials();

    var list = document.getElementById("press-list");
    if (!list) return;

    fetch("/data/press.json")
      .then(function (res) {
        if (!res.ok) throw new Error("HTTP " + res.status);
        return res.json();
      })
      .then(function (data) {
        var items = (data && Array.isArray(data.items)) ? data.items : [];
        if (!items.length) {
          var empty = document.createElement("li");
          empty.textContent = "No press items yet.";
          list.appendChild(empty);
          return;
        }
        var frag = document.createDocumentFragment();
        items.forEach(function (item) {
          frag.appendChild(buildCard(item || {}));
        });
        list.appendChild(frag);
      })
      .catch(function (err) {
        var li = document.createElement("li");
        li.textContent = "Could not load press items. (" + err.message + ")";
        list.appendChild(li);
      });
  }

  /* Scripts are deferred, so the DOM is parsed by the time this runs. */
  init();
})();
