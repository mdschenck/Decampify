/*
 * Decampify — EPK page renderer.
 *
 * Renders epk.html entirely from /data/epk.json (BUILD-SPEC §7, §9):
 * bio, releases, support, contact/rider, and link changes are all JSON
 * edits — this file and epk.html never need touching for content updates.
 *
 * epk.json shape: { artist, genre, location, bio,
 *                   recentReleases:[{title,label,date}], support:[string],
 *                   contact:{email,techRider}, links:[{label,url,group}] }
 *
 * Every link from the JSON is rendered — nothing is filtered out.
 */
(function () {
  "use strict";

  /* Preferred display order for link groups; any group not listed here is
     appended afterward in the order it first appears in the JSON, so new
     groups added to epk.json show up without a code change. */
  var GROUP_ORDER = ["Music", "Social", "Press", "Video", "Mixes", "Assets"];

  /* All JSON values are inserted with textContent / attribute setters —
     never string-built HTML — so content stays inert. */

  function renderHeader(data) {
    var host = document.getElementById("epk-header");
    if (!host) return;

    var h1 = document.createElement("h1");
    h1.textContent = data.artist || "";
    host.appendChild(h1);

    var tagline = document.createElement("p");
    tagline.className = "epk-tagline";
    var genre = document.createElement("span");
    genre.className = "epk-genre";
    genre.textContent = data.genre || "";
    tagline.appendChild(genre);
    if (data.location) {
      tagline.appendChild(document.createTextNode(" — " + data.location));
    }
    host.appendChild(tagline);
  }

  function renderBio(data) {
    var host = document.getElementById("epk-bio");
    if (!host || !data.bio) return;
    var p = document.createElement("p");
    p.className = "epk-bio";
    p.textContent = data.bio;
    host.appendChild(p);
  }

  function renderReleases(data) {
    var list = document.getElementById("epk-releases");
    var releases = Array.isArray(data.recentReleases) ? data.recentReleases : [];
    if (!list) return;
    releases.forEach(function (rel) {
      rel = rel || {};
      var li = document.createElement("li");

      var title = document.createElement("span");
      title.className = "epk-release-title";
      title.textContent = rel.title || "";
      li.appendChild(title);

      if (rel.label) {
        var label = document.createElement("span");
        label.className = "epk-release-label";
        label.textContent = "— " + rel.label;
        li.appendChild(label);
      }
      if (rel.date) {
        var date = document.createElement("span");
        date.className = "epk-release-date";
        date.textContent = rel.date;
        li.appendChild(date);
      }
      list.appendChild(li);
    });
  }

  function renderSupport(data) {
    var list = document.getElementById("epk-support");
    var support = Array.isArray(data.support) ? data.support : [];
    if (!list) return;
    support.forEach(function (name) {
      var li = document.createElement("li");
      li.textContent = name;
      list.appendChild(li);
    });
  }

  function renderContact(data) {
    var host = document.getElementById("epk-contact");
    var contact = data.contact || {};
    if (!host) return;

    if (contact.email) {
      var pEmail = document.createElement("p");
      var lbl = document.createElement("span");
      lbl.className = "epk-label";
      lbl.textContent = "Contact / Booking";
      pEmail.appendChild(lbl);
      var a = document.createElement("a");
      a.href = "mailto:" + contact.email;
      a.textContent = contact.email;
      pEmail.appendChild(a);
      host.appendChild(pEmail);
    }

    if (contact.techRider) {
      var pRider = document.createElement("p");
      var lbl2 = document.createElement("span");
      lbl2.className = "epk-label";
      lbl2.textContent = "Tech Rider";
      pRider.appendChild(lbl2);
      pRider.appendChild(document.createTextNode(contact.techRider));
      host.appendChild(pRider);
    }
  }

  function renderLinks(data) {
    var host = document.getElementById("epk-links");
    var links = Array.isArray(data.links) ? data.links : [];
    if (!host || !links.length) return;

    /* Bucket links by their `group` field, preserving JSON order in each. */
    var buckets = {};
    var seenOrder = [];
    links.forEach(function (link) {
      link = link || {};
      var group = link.group || "Other";
      if (!buckets[group]) {
        buckets[group] = [];
        seenOrder.push(group);
      }
      buckets[group].push(link);
    });

    /* Known groups first (spec order), then any new/unknown groups. */
    var ordered = GROUP_ORDER.filter(function (g) { return buckets[g]; })
      .concat(seenOrder.filter(function (g) { return GROUP_ORDER.indexOf(g) === -1; }));

    ordered.forEach(function (group) {
      var section = document.createElement("div");
      section.className = "epk-link-group";

      var h3 = document.createElement("h3");
      h3.textContent = group;
      section.appendChild(h3);

      var ul = document.createElement("ul");
      ul.className = "epk-link-list";
      buckets[group].forEach(function (link) {
        if (!link.url) return;
        var li = document.createElement("li");
        var a = document.createElement("a");
        a.className = "btn";
        a.href = window.MRUtil.safeHref(link.url);
        a.target = "_blank";
        a.rel = "noopener";
        a.textContent = link.label || link.url;
        li.appendChild(a);
        ul.appendChild(li);
      });
      section.appendChild(ul);
      host.appendChild(section);
    });
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

    fetch("/data/epk.json")
      .then(function (res) {
        if (!res.ok) throw new Error("HTTP " + res.status);
        return res.json();
      })
      .then(function (data) {
        data = data || {};
        renderHeader(data);
        renderBio(data);
        renderReleases(data);
        renderSupport(data);
        renderContact(data);
        renderLinks(data);
      })
      .catch(function (err) {
        var main = document.getElementById("main");
        if (!main) return;
        var p = document.createElement("p");
        p.textContent = "Could not load the press kit. (" + err.message + ")";
        main.appendChild(p);
      });
  }

  /* Scripts are deferred, so the DOM is parsed by the time this runs. */
  init();
})();
