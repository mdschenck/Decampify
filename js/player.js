/* ============================================================================
 * Decampify — stations player (BUILD-SPEC §4b)
 *
 * Stations are built at runtime from data/releases.json (passed in by
 * js/main.js via MRPlayer.init(data) — single fetch, no duplicate request):
 *   1. "Shuffle All" — random order across every release track (loops,
 *      reshuffling at the end of each pass).
 *   2. One station per release — natural track order; STOPS at the end of the
 *      release (documented design choice — Bandcamp-like album behavior).
 *   3. One station per mix — one long track; stops when done.
 *
 * MOCK MODE (window.MR_CONFIG.mock === true):
 *   Zero network, zero audio files. Each track plays a short, quiet Web Audio
 *   oscillator blip (pitch varies per track) and the progress bar runs on a
 *   compressed ~8-second-per-track timer, so play/pause, next/prev,
 *   auto-advance, station switching, and shuffle are all demonstrable.
 *   The "demo audio" label in the player is shown only in mock mode.
 *
 * REAL MODE (mock:false):
 *   Requests a signed URL from MR_CONFIG.api.streamUrl?key=<streamKey>
 *   (keys come straight from releases.json) and plays it with an <audio>
 *   element. Signed URLs are cached for the session.
 *
 * Public API (used by js/main.js):
 *   MRPlayer.init(data)                       — build stations + select default
 *   MRPlayer.playRelease(releaseId, trackIdx) — jump to a release station
 *   MRPlayer.playStation(stationId)           — select any station and play
 *
 * Emits on window: CustomEvent 'mr:trackchange'
 *   detail: { stationId, releaseId, trackIndex, playing }
 * ========================================================================== */
(function () {
  'use strict';

  var cfg = window.MR_CONFIG || {};
  var MOCK = cfg.mock === true;
  var MOCK_SECS = 8;               // compressed per-track duration in mock mode
  var SEEK_MAX = 1000;

  // ---- DOM ------------------------------------------------------------------
  function $(id) { return document.getElementById(id); }
  var els = {
    stations: $('player-stations'),
    prev: $('pl-prev'), play: $('pl-play'), next: $('pl-next'),
    shuffle: $('pl-shuffle'),
    seek: $('pl-seek'), elapsed: $('pl-elapsed'), duration: $('pl-duration'),
    volume: $('pl-volume'),
    nowTitle: $('pl-now-title'), nowSub: $('pl-now-sub'),
    demo: $('pl-demo-note')
  };
  if (!els.stations) return; // player markup missing — nothing to do

  // ---- State ----------------------------------------------------------------
  var stations = [];
  var current = null;      // active station object
  var order = [];          // play order = array of indexes into current.tracks
  var pos = 0;             // position within `order`
  var isPlaying = false;
  var shuffleOn = false;
  var volume = 0.8;
  var seeking = false;

  // Real-mode audio
  var audio = null;
  var urlCache = new Map();     // streamKey -> signed URL (session cache)
  var loadSeq = 0;              // guards async races on fast track switches

  // Mock-mode audio
  var ac = null;                // AudioContext, created on first user gesture
  var mockPos = 0;              // seconds within the compressed track
  var mockTimer = null;

  // ---- Helpers --------------------------------------------------------------
  function fmt(s) {
    s = Math.max(0, Math.floor(s || 0));
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  }
  function parseDur(str) { // "6:05" -> 365 seconds
    if (!str) return 0;
    var p = String(str).split(':');
    return (parseInt(p[0], 10) || 0) * 60 + (parseInt(p[1], 10) || 0);
  }
  function shuffleArr(a) {
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var tmp = a[i]; a[i] = a[j]; a[j] = tmp;
    }
    return a;
  }
  function curTrack() { return current ? current.tracks[order[pos]] : null; }
  function trackDuration() {
    var t = curTrack();
    if (!t) return 0;
    if (MOCK) return MOCK_SECS;
    if (audio && isFinite(audio.duration) && audio.duration > 0) return audio.duration;
    return parseDur(t.duration);
  }
  function emit() {
    var t = curTrack();
    window.dispatchEvent(new CustomEvent('mr:trackchange', {
      detail: {
        stationId: current ? current.id : null,
        releaseId: t ? t.releaseId : null,
        trackIndex: t ? t.trackIndex : null,
        playing: isPlaying
      }
    }));
  }

  // ---- Stations -------------------------------------------------------------
  function buildStations(data) {
    var all = [];
    (data.releases || []).forEach(function (rel) {
      rel.tracks.forEach(function (t, i) {
        all.push({
          title: t.title, sub: rel.title, duration: t.duration,
          streamKey: t.streamKey, releaseId: rel.id, trackIndex: i
        });
      });
    });
    var releaseStations = (data.releases || []).map(function (rel) {
      return {
        id: 'rel:' + rel.id, label: rel.title, kind: 'release',
        tracks: rel.tracks.map(function (t, i) {
          return {
            title: t.title, sub: rel.title, duration: t.duration,
            streamKey: t.streamKey, releaseId: rel.id, trackIndex: i
          };
        })
      };
    });
    var mixStations = (data.mixes || []).map(function (mix) {
      return {
        id: 'mix:' + mix.id, label: mix.title, kind: 'mix',
        tracks: [{
          title: mix.title, sub: 'DJ Mix', duration: null,
          streamKey: mix.streamKey, releaseId: null, trackIndex: 0
        }]
      };
    });

    // Station list order: "Shuffle All" first, then releases with the DJ-mix
    // stations INTERLEAVED deterministically — one mix after every 3rd
    // release (#3, #6, #9, ...), any leftover mixes appended at the end.
    // Order only; station behavior is unchanged.
    stations = [{ id: 'shuffle-all', label: 'Shuffle All', kind: 'shuffle', tracks: all }];
    var mi = 0;
    releaseStations.forEach(function (rs, i) {
      stations.push(rs);
      if ((i + 1) % 3 === 0 && mi < mixStations.length) stations.push(mixStations[mi++]);
    });
    while (mi < mixStations.length) stations.push(mixStations[mi++]);
  }

  function renderChips() {
    els.stations.textContent = '';
    stations.forEach(function (st) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'station-chip';
      b.textContent = st.label;
      b.setAttribute('aria-pressed', 'false');
      // null trackIndex → shuffle stations start on a random track
      b.addEventListener('click', function () { selectStation(st.id, null, true); });
      els.stations.appendChild(b);
    });
  }
  function updateChips() {
    Array.prototype.forEach.call(els.stations.children, function (b, i) {
      b.setAttribute('aria-pressed', stations[i] === current ? 'true' : 'false');
    });
  }

  // Compute play order for the current station.
  // startIndex (a natural track index) is pinned to play first when shuffling.
  function makeOrder(startIndex) {
    var n = current.tracks.length;
    order = [];
    for (var i = 0; i < n; i++) order.push(i);
    if (current.kind === 'shuffle' || shuffleOn) {
      shuffleArr(order);
      if (typeof startIndex === 'number') {
        var j = order.indexOf(startIndex);
        if (j > 0) { order[j] = order[0]; order[0] = startIndex; }
      }
      pos = 0;
    } else {
      pos = Math.min(Math.max(startIndex || 0, 0), n - 1);
    }
  }

  function selectStation(id, trackIndex, autoplay) {
    var st = null;
    for (var i = 0; i < stations.length; i++) if (stations[i].id === id) { st = stations[i]; break; }
    if (!st || !st.tracks.length) return;
    stopPlayback();
    current = st;
    makeOrder(trackIndex);
    updateChips();
    loadTrack();
    if (autoplay) play();
  }

  // ---- Track lifecycle -------------------------------------------------------
  function loadTrack() {
    mockPos = 0;
    loadSeq++;
    if (audio) { audio.pause(); audio.removeAttribute('src'); audio.load(); }
    updateNow();
    updateTime();
    emit();
  }

  function updateNow() {
    var t = curTrack();
    els.nowTitle.textContent = t ? t.title : 'Pick a station';
    els.nowSub.textContent = t ? t.sub : '';
    els.duration.textContent = fmt(trackDuration());
  }

  function updateTime() {
    var dur = trackDuration();
    var el = MOCK ? mockPos : (audio ? audio.currentTime : 0);
    els.elapsed.textContent = fmt(el);
    els.duration.textContent = fmt(dur);
    if (!seeking) els.seek.value = dur > 0 ? Math.round((el / dur) * SEEK_MAX) : 0;
  }

  function setPlayButton() {
    els.play.textContent = isPlaying ? '❚❚' : '▶';
    els.play.setAttribute('aria-label', isPlaying ? 'Pause' : 'Play');
  }

  function play() {
    if (!curTrack()) { // nothing selected yet — default to first station
      if (stations.length) selectStation(stations[0].id, 0, true);
      return;
    }
    isPlaying = true;
    setPlayButton();
    if (MOCK) {
      ensureAC();
      blip();
      startMockTimer();
    } else {
      playReal();
    }
    emit();
  }

  function pause() {
    isPlaying = false;
    setPlayButton();
    if (MOCK) stopMockTimer();
    else if (audio) audio.pause();
    emit();
  }
  function toggle() { if (isPlaying) pause(); else play(); }

  function stopPlayback() {
    isPlaying = false;
    setPlayButton();
    stopMockTimer();
    if (audio) audio.pause();
  }

  function advance() { // auto-advance at track end
    if (pos + 1 < order.length) {
      pos++;
      loadTrack();
      play(); // advance() only fires from active playback — keep playing
      return;
    }
    // End of station queue:
    if (current.kind === 'shuffle') {         // Shuffle All loops, reshuffled
      makeOrder();
      loadTrack();
      play();
    } else {                                  // release / mix stations stop
      stopPlayback();
      pos = 0; // reset to start for the next play press
      mockPos = 0;
      loadTrack();
    }
  }

  function next() {
    if (!current) return;
    var wasPlaying = isPlaying;
    if (pos + 1 < order.length) { pos++; }
    else if (current.kind === 'shuffle') { makeOrder(); }
    else { pos = 0; } // manual next at album end wraps to track 1
    stopPlayback();
    loadTrack();
    if (wasPlaying) play();
  }

  function prev() {
    if (!current) return;
    var wasPlaying = isPlaying;
    var elapsed = MOCK ? mockPos : (audio ? audio.currentTime : 0);
    if (elapsed > 2 || pos === 0) {
      // restart current track
      mockPos = 0;
      if (audio && !MOCK) { audio.currentTime = 0; updateTime(); return; }
      stopPlayback(); loadTrack(); if (wasPlaying) play();
      return;
    }
    pos--;
    stopPlayback();
    loadTrack();
    if (wasPlaying) play();
  }

  // ---- MOCK playback (Web Audio blip + compressed timer) --------------------
  function ensureAC() {
    if (!ac) {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (AC) ac = new AC();
    }
    if (ac && ac.state === 'suspended') ac.resume();
  }

  // Short, quiet tone per track — pitch varies so track changes are audible.
  function blip() {
    if (!ac) return;
    var t = curTrack();
    var idx = t ? (t.trackIndex + (t.releaseId ? t.releaseId.length : 0)) : 0;
    var semis = [0, 3, 5, 7, 10];                       // minor pentatonic
    var freq = 220 * Math.pow(2, (semis[idx % 5] + 12 * (idx % 2)) / 12);
    var o = ac.createOscillator();
    var g = ac.createGain();
    o.type = 'square';
    o.frequency.value = freq;
    var t0 = ac.currentTime;
    var v = Math.max(0.045 * volume, 0.0006);           // quiet
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(v, t0 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.22);
    o.connect(g); g.connect(ac.destination);
    o.start(t0); o.stop(t0 + 0.25);
  }

  function startMockTimer() {
    stopMockTimer();
    var STEP = 0.2;
    mockTimer = window.setInterval(function () {
      if (!isPlaying || seeking) return;
      mockPos += STEP;
      if (mockPos >= MOCK_SECS) { advance(); }
      else updateTime();
    }, STEP * 1000);
  }
  function stopMockTimer() {
    if (mockTimer) { window.clearInterval(mockTimer); mockTimer = null; }
  }

  // ---- REAL playback (<audio> + signed URLs) --------------------------------
  function ensureAudio() {
    if (audio) return audio;
    audio = new Audio();
    audio.preload = 'auto';
    audio.volume = volume;
    audio.addEventListener('timeupdate', updateTime);
    audio.addEventListener('loadedmetadata', updateTime);
    audio.addEventListener('ended', advance);
    audio.addEventListener('error', function () {
      els.nowSub.textContent = (curTrack() ? curTrack().sub : '') + ' — track unavailable';
      stopPlayback();
    });
    return audio;
  }

  // Signed stream URL from the serverless API; cached for the session.
  function getStreamUrl(key) {
    if (urlCache.has(key)) return Promise.resolve(urlCache.get(key));
    var endpoint = (cfg.api && cfg.api.streamUrl) || '/api/stream-url';
    return fetch(endpoint + '?key=' + encodeURIComponent(key))
      .then(function (r) {
        if (!r.ok) throw new Error('stream-url ' + r.status);
        return r.json();
      })
      .then(function (j) { urlCache.set(key, j.url); return j.url; });
  }

  function playReal() {
    var t = curTrack();
    if (!t) return;
    var a = ensureAudio();
    if (a.src && a.dataset.key === t.streamKey) { a.play(); return; }
    var seq = ++loadSeq;
    getStreamUrl(t.streamKey)
      .then(function (url) {
        if (seq !== loadSeq) return;      // user already switched tracks
        a.src = url;
        a.dataset.key = t.streamKey;
        return a.play();
      })
      .catch(function () {
        if (seq !== loadSeq) return;
        els.nowSub.textContent = t.sub + ' — track unavailable';
        stopPlayback();
      });
  }

  // ---- Controls wiring -------------------------------------------------------
  els.play.addEventListener('click', toggle);
  els.next.addEventListener('click', next);
  els.prev.addEventListener('click', prev);

  els.shuffle.addEventListener('click', function () {
    shuffleOn = !shuffleOn;
    els.shuffle.setAttribute('aria-pressed', String(shuffleOn));
    if (!current) return;
    var cur = order[pos];               // keep current track playing
    if (current.kind === 'shuffle' || shuffleOn) { makeOrder(cur); }
    else {
      order = current.tracks.map(function (_, i) { return i; });
      pos = cur;
    }
  });

  els.seek.addEventListener('input', function () {
    seeking = true;
    els.elapsed.textContent = fmt((els.seek.value / SEEK_MAX) * trackDuration());
  });
  els.seek.addEventListener('change', function () {
    var frac = els.seek.value / SEEK_MAX;
    if (MOCK) { mockPos = frac * MOCK_SECS; }
    else if (audio && isFinite(audio.duration)) { audio.currentTime = frac * audio.duration; }
    seeking = false;
    updateTime();
  });

  els.volume.addEventListener('input', function () {
    volume = els.volume.value / 100;
    if (audio) audio.volume = volume;
    // mock blips read `volume` at trigger time — nothing else to do
  });

  // ---- Public API ------------------------------------------------------------
  window.MRPlayer = {
    init: function (data) {
      buildStations(data);
      renderChips();
      if (MOCK && els.demo) els.demo.hidden = false;   // "demo audio" label
      // Preselect Shuffle All (no autoplay — browsers block unsolicited audio)
      if (stations.length) selectStation('shuffle-all', null, false);
    },
    playRelease: function (releaseId, trackIndex) {
      selectStation('rel:' + releaseId, trackIndex || 0, true);
    },
    playStation: function (stationId) {
      selectStation(stationId, null, true);
    }
  };
})();
