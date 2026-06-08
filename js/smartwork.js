(function () {
  var TOTAL = 180;
  var RADIUS = 52;
  var CIRC = 2 * Math.PI * RADIUS;
  var SCHEDULES = [
    { hour: 9,  minute: 30, endHour: 11, endMinute: 30 },
    { hour: 15, minute: 0,  endHour: 17, endMinute: 0  }
  ];

  var shownKeys = {};
  var countTimer = null;
  var dismissTimer = null;
  var secondsLeft = TOTAL;

  function pad(n) { return String(n).padStart(2, '0'); }

  function getParam(name) {
    try {
      return new URLSearchParams(location.search).get(name);
    } catch (e) {
      return null;
    }
  }

  function makeLabel(h1, m1, h2, m2) {
    var t1 = m1 === 0 ? h1 + '시' : h1 + '시 ' + pad(m1) + '분';
    var t2 = m2 === 0 ? h2 + '시' : h2 + '시 ' + pad(m2) + '분';
    return t1 + ' ~ ' + t2;
  }

  function minutesOfDay(d) {
    return d.getHours() * 60 + d.getMinutes();
  }

  function scheduleStart(s) {
    return s.hour * 60 + s.minute;
  }

  function scheduleEnd(s) {
    return s.endHour * 60 + s.endMinute;
  }

  function getForcedSchedule() {
    var forceIdx = getParam('swt');
    if (forceIdx === null) return null;
    return SCHEDULES[parseInt(forceIdx, 10) || 0] || SCHEDULES[0];
  }

  function getActiveSchedule(now) {
    var forced = getForcedSchedule();
    if (forced) return { schedule: forced, forced: true };

    var day = now.getDay();
    if (day === 0 || day === 6) return null;

    var cur = minutesOfDay(now);
    for (var i = 0; i < SCHEDULES.length; i++) {
      var s = SCHEDULES[i];
      if (cur >= scheduleStart(s) && cur <= scheduleEnd(s)) {
        return { schedule: s, forced: false };
      }
    }
    return null;
  }

  function formatRemaining(minutes) {
    minutes = Math.max(0, Math.ceil(minutes));
    var h = Math.floor(minutes / 60);
    var m = minutes % 60;
    if (h > 0 && m > 0) return h + '시간 ' + m + '분 남음';
    if (h > 0) return h + '시간 남음';
    return m + '분 남음';
  }

  function updateRing(s) {
    var fill = document.getElementById('swt-ring-fill');
    var count = document.getElementById('swt-ring-count');
    if (!fill || !count) return;
    var offset = CIRC * (1 - s / TOTAL);
    fill.style.strokeDasharray = CIRC;
    fill.style.strokeDashoffset = offset;
    count.textContent = s;
  }

  function fitTimeLabel() {
    var timeEl = document.getElementById('swt-time-label');
    if (!timeEl) return;

    timeEl.style.fontSize = '';

    var styles = window.getComputedStyle(timeEl);
    var max = parseFloat(styles.fontSize) || 120;
    var min = 32;
    var lo = min;
    var hi = Math.max(min, max);

    for (var i = 0; i < 8; i++) {
      var mid = (lo + hi) / 2;
      timeEl.style.fontSize = mid + 'px';
      if (timeEl.scrollWidth <= timeEl.clientWidth) lo = mid;
      else hi = mid;
    }

    timeEl.style.fontSize = Math.max(min, Math.floor(lo) - 2) + 'px';
  }

  function updateHeaderIndicator() {
    var indicator = document.getElementById('swt-header-indicator');
    if (!indicator) return;

    var now = new Date();
    var active = getActiveSchedule(now);
    if (!active) {
      indicator.classList.remove('is-active');
      return;
    }

    var s = active.schedule;
    var start = scheduleStart(s);
    var end = scheduleEnd(s);
    var cur = minutesOfDay(now);
    var total = Math.max(1, end - start);
    var elapsed = active.forced ? Math.max(0, Math.min(total, cur - start)) : cur - start;
    var progress = Math.max(0, Math.min(100, elapsed / total * 100));
    var timeEl = document.getElementById('swt-indicator-time');
    var remainEl = document.getElementById('swt-indicator-remain');
    var progressEl = document.getElementById('swt-indicator-progress');

    if (timeEl) timeEl.textContent = makeLabel(s.hour, s.minute, s.endHour, s.endMinute);
    if (remainEl) {
      remainEl.textContent = active.forced
        ? '스마트 워크 타임 표시 중'
        : formatRemaining(end - cur);
    }
    if (progressEl) progressEl.style.width = progress.toFixed(1) + '%';
    indicator.style.setProperty('--swt-progress', progress.toFixed(1) + '%');
    indicator.classList.add('is-active');
  }

  function show(label) {
    var overlay = document.getElementById('swt-overlay');
    var timeEl  = document.getElementById('swt-time-label');
    if (!overlay || !timeEl) return;

    clearTimeout(dismissTimer);
    clearInterval(countTimer);

    timeEl.textContent = label;
    secondsLeft = TOTAL;
    updateRing(TOTAL);

    overlay.classList.add('is-open');
    requestAnimationFrame(fitTimeLabel);

    countTimer = setInterval(function () {
      secondsLeft = Math.max(0, secondsLeft - 1);
      updateRing(secondsLeft);
    }, 1000);

    dismissTimer = setTimeout(function () { close(); }, TOTAL * 1000);
  }

  function close() {
    var overlay = document.getElementById('swt-overlay');
    if (overlay) overlay.classList.remove('is-open');
    clearInterval(countTimer);
    clearTimeout(dismissTimer);
  }

  window.swtClose = close;

  function tryShow() {
    var forceIdx = getParam('swt');
    var now = new Date();
    var today = now.toDateString();

    if (forceIdx !== null) {
      var idx = parseInt(forceIdx, 10) || 0;
      var s = SCHEDULES[idx] || SCHEDULES[0];
      var key = today + '_force_' + idx;
      if (!shownKeys[key]) {
        shownKeys[key] = true;
        show(makeLabel(s.hour, s.minute, s.endHour, s.endMinute));
      }
      return;
    }

    var day = now.getDay();
    if (day === 0 || day === 6) return;

    SCHEDULES.forEach(function (s) {
      if (now.getHours() === s.hour && now.getMinutes() === s.minute) {
        var key = today + '_' + s.hour + '-' + s.minute;
        if (!shownKeys[key]) {
          shownKeys[key] = true;
          show(makeLabel(s.hour, s.minute, s.endHour, s.endMinute));
        }
      }
    });
  }

  window.addEventListener('resize', function () {
    var overlay = document.getElementById('swt-overlay');
    if (overlay && overlay.classList.contains('is-open')) {
      requestAnimationFrame(fitTimeLabel);
    }
  });

  document.addEventListener('DOMContentLoaded', function () {
    tryShow();
    updateHeaderIndicator();
    setInterval(function () {
      tryShow();
      updateHeaderIndicator();
    }, 10000);
  });
})();
