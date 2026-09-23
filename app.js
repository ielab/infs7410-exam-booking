/* INFS7410 oral exam booking — student page. Talks to the Apps Script backend (config.js). */
(function () {
  'use strict';
  if (window.top !== window.self) { try { window.top.location = window.location.href; } catch (e) { /* framed cross-origin */ } }

  const API = (window.BOOKING_API_URL || '').trim();
  const DEMO = !API;
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const MONTH = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const utc = ds => { const p = ds.split('-').map(Number); return Date.UTC(p[0], p[1] - 1, p[2]); };
  const ymd = t => new Date(t).toISOString().slice(0, 10);
  const human = ds => { const d = new Date(utc(ds)); return DAYS[d.getUTCDay()] + ' ' + d.getUTCDate() + ' ' + MONTH[d.getUTCMonth()] + ' ' + d.getUTCFullYear(); };
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const jitter = (a, b) => a + Math.random() * (b - a);
  const NAME_RE = /^[\p{L}\p{M}][\p{L}\p{M} .'’\-]*$/u;

  let DATA = null, day = null, slot = null, submitting = false, done = false, pending = null;

  // ---------------------------------------------------------------- API
  const OVERLOADED = 'The booking server is overloaded right now. Please wait a minute and try again.';
  const NET = 'Could not reach the booking server. Please check your internet connection and try again.';
  const MAYBE = ' (If you pressed "Yes, book this slot", your booking may already be saved — check your UQ email first. ' +
    'Trying again is safe: you will never be booked twice.)';

  async function fetchJson(url, opts, timeoutMs) {
    const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
    try {
      const res = await fetch(url, Object.assign({ redirect: 'follow', cache: 'no-store', signal: ctrl ? ctrl.signal : undefined }, opts));
      const text = await res.text();
      try { return { json: JSON.parse(text) }; } catch (e) { return { kind: 'overloaded' }; } // Google returned an HTML error page
    } catch (err) {
      return { kind: err && err.name === 'AbortError' ? 'timeout' : 'network' };
    } finally { if (timer) clearTimeout(timer); }
  }

  /** GET retries on anything; POST retries only on "busy", overload, timeout or network — safe because the
   *  server treats a repeated booking for the same student + slot as the same booking. */
  async function api(method, body) {
    if (DEMO) return demoApi(method, body);
    const isGet = method === 'GET';
    const opts = isGet ? { method: 'GET' } :
      // text/plain avoids a CORS preflight, which Apps Script cannot answer
      { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body) };
    const tries = isGet ? 3 : 4;
    let last = null;
    for (let attempt = 0; attempt < tries; attempt++) {
      const url = isGet ? API + '?action=slots&t=' + Date.now() : API;
      const r = await fetchJson(url, opts, isGet ? 15000 : 40000);
      if (r.json && !(r.json.ok === false && r.json.busy)) return r.json;
      last = r.json || r;
      if (attempt < tries - 1) {
        if (!isGet) $('submit').textContent = $('confirmBook').textContent = 'Busy — retrying…';
        await sleep(isGet ? jitter(1000, 3000) : jitter(2000, 8000));
      }
    }
    if (last && last.busy) return { ok: false, message: last.message + (isGet ? '' : ' Please try again in a minute.' + MAYBE) };
    const msg = last && last.kind === 'network' ? NET : OVERLOADED;
    return { ok: false, transport: true, message: msg + (isGet ? '' : MAYBE) };
  }

  // Show the last known availability instantly (from this browser), then refresh from the server.
  // Bookings are always re-checked live on the server, so a stale number can never overbook a slot.
  const CACHE = 'infs7410-booking-cache-v2';
  const CACHE_MAX_AGE = 10 * 60e3;
  function fromCache() {
    try { const c = JSON.parse(localStorage.getItem(CACHE) || 'null'); if (c && Date.now() - c.at < CACHE_MAX_AGE && c.api === API) return c; } catch (e) {}
    return null;
  }
  const valid = r => r && r.ok && r.config && Array.isArray(r.slots);

  let loading = false;
  async function load(first) {
    if (loading) return; loading = true;
    try {
      let cachedAt = null;
      if (first && !DEMO) { const c = fromCache(); if (c && valid(c.data)) { apply(c.data); cachedAt = c.at; $('updating').hidden = false; } }
      const r = await api('GET');
      $('updating').hidden = true;
      if (!valid(r)) {
        const msg = (r && r.message) || 'Could not load slots.';
        if (!DATA) { $('calendar').innerHTML = '<div class="banner bad">' + esc(msg) + ' Please reload the page.</div>'; return; }
        const at = new Date(cachedAt || DATA._at || Date.now());
        showStale('Could not refresh availability — showing places left as of ' + at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) +
          '; it may be out of date. Your booking is always checked live.');
        return;
      }
      $('stale').hidden = true;
      r._at = Date.now();
      try { localStorage.setItem(CACHE, JSON.stringify({ at: Date.now(), api: API, data: r })); } catch (e) {}
      apply(r);
    } finally { loading = false; }
  }
  function showStale(m) { $('stale').textContent = m; $('stale').hidden = false; }

  function apply(r) {
    const focus = document.activeElement && (document.activeElement.dataset || {});
    DATA = r;
    const c = r.config;
    document.title = c.courseCode + ' ' + c.examName + ' Booking';
    $('title').textContent = c.courseCode + ' ' + c.examName + ' Booking';
    $('notice').textContent = c.notice || '';
    $('closed').hidden = c.bookingOpen;
    $('demo').hidden = !DEMO;
    $('footer').textContent = '';
    $('footer').append('Questions? Email ');
    if (/^[^\s@<>"]+@[^\s@<>"]+$/.test(c.contactEmail || '')) {
      const a = document.createElement('a'); a.href = 'mailto:' + c.contactEmail; a.textContent = c.contactEmail; $('footer').append(a);
    }
    renderCalendar();
    if (day) {
      renderTimes();
      if (slot) {
        const now = r.slots.find(s => s.id === slot.id);
        if (!now || !bookable(now)) { // the chosen time is gone or full: keep details, ask for another time
          slot = null; renderTimes(); closeForm();
          timeMsg('The time you chose is no longer available. Please pick another time — your details are kept.');
        } else slot = now;
      }
    }
    if (focus && focus.date) { const el = document.querySelector('button.cal-cell[data-date="' + focus.date + '"]'); if (el) el.focus({ preventScroll: true }); }
    if (focus && focus.id) { const el = document.querySelector('button.time[data-id="' + CSS.escape(focus.id) + '"]'); if (el) el.focus({ preventScroll: true }); }
  }
  const bookable = s => s.open && s.remaining > 0 && DATA.config.bookingOpen;

  // ---------------------------------------------------------------- calendar
  function renderCalendar() {
    const byDate = {};
    DATA.slots.forEach(s => (byDate[s.date] = byDate[s.date] || []).push(s));
    const dates = Object.keys(byDate).sort();
    if (!dates.length) { $('calendar').innerHTML = '<p class="muted">No exam slots are available yet. Please check back later.</p>'; return; }
    const weekend = dates.some(d => [0, 6].includes(new Date(utc(d)).getUTCDay()));
    const cols = weekend ? 7 : 5;
    const heads = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].slice(0, cols);
    const from = dates[0], to = dates[dates.length - 1];
    let t = utc(from); t -= ((new Date(t).getUTCDay() + 6) % 7) * 864e5; // Monday of first week
    let html = '', lastMonth = '';
    for (; t <= utc(to); t += 7 * 864e5) {
      const weekDates = Array.from({ length: cols }, (_, i) => ymd(t + i * 864e5));
      const firstReal = weekDates.find(d => byDate[d]) || weekDates[0];
      const mKey = firstReal.slice(0, 7);
      if (!weekDates.some(d => byDate[d])) continue; // skip empty weeks
      if (mKey !== lastMonth) {
        const md = new Date(utc(firstReal));
        html += '<div class="month">' + MONTH[md.getUTCMonth()] + ' ' + md.getUTCFullYear() + '</div>' +
          '<div class="cal-head cols' + cols + '">' + heads.map(h => '<div>' + h + '</div>').join('') + '</div>';
        lastMonth = mKey;
      }
      html += '<div class="cal-row cols' + cols + '">';
      weekDates.forEach(ds => {
        const d = new Date(utc(ds));
        const label = d.getUTCDate() + ' ' + MON[d.getUTCMonth()];
        const list = byDate[ds];
        if (!list) { html += '<div class="cal-cell ' + (ds < from || ds > to ? 'out' : 'none') + '"><div class="d">' + label + '</div></div>'; return; }
        const left = list.filter(s => s.open).reduce((a, s) => a + s.remaining, 0);
        const ok = left > 0 && DATA.config.bookingOpen;
        const meta = left > 0 ? left + (left === 1 ? ' place' : ' places') + ' left' : (list.some(s => s.open) ? 'Full' : 'Too soon');
        html += ok
          ? '<button type="button" class="cal-cell avail' + (ds === day ? ' sel' : '') + '" data-date="' + ds + '" aria-pressed="' + (ds === day) + '" aria-label="' +
            esc(human(ds) + ', ' + meta) + '"><div class="d">' + label + '</div><div class="m">' + meta + '</div></button>'
          : '<div class="cal-cell full" aria-label="' + esc(human(ds) + ', ' + meta) + '"><div class="d">' + label + '</div><div class="m">' + meta + '</div></div>';
      });
      html += '</div>';
    }
    $('calendar').innerHTML = html;
  }

  $('calendar').addEventListener('click', e => {
    const c = e.target.closest('button.cal-cell'); if (!c || done) return;
    day = c.dataset.date; slot = null;
    renderCalendar(); renderTimes(); closeForm(); timeMsg('');
    const again = document.querySelector('button.cal-cell[data-date="' + day + '"]'); if (again) again.focus({ preventScroll: true });
    $('stepTime').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  function renderTimes() {
    const list = DATA.slots.filter(s => s.date === day).sort((a, b) => a.start < b.start ? -1 : 1);
    $('dayLabel').textContent = human(day);
    const hrs = DATA.config.minHoursBefore;
    $('times').innerHTML = list.length ? list.map(s => {
      const ok = bookable(s);
      const label = !s.open ? 'Too soon to book online (less than ' + hrs + ' h away)' : s.remaining > 0 ? s.remaining + ' of ' + s.capacity + ' places left' : 'Full';
      const sel = slot && slot.id === s.id;
      return '<button type="button" class="time' + (sel ? ' sel' : '') + '" data-id="' + esc(s.id) + '" aria-pressed="' + !!sel + '"' + (ok ? '' : ' disabled') +
        '><b>' + esc(s.start) + ' – ' + esc(s.end) + '</b><span>' + esc(label) + '</span></button>';
    }).join('') : '<p class="muted">No times left on this day. Please choose another day.</p>';
    $('stepTime').hidden = false;
  }
  function timeMsg(m) { $('timeMsg').textContent = m; $('timeMsg').hidden = !m; if (m) { $('timeMsg').focus({ preventScroll: true }); $('stepTime').scrollIntoView({ behavior: 'smooth', block: 'start' }); } }

  $('times').addEventListener('click', e => {
    const b = e.target.closest('button.time'); if (!b || b.disabled || done) return;
    slot = DATA.slots.find(s => s.id === b.dataset.id);
    renderTimes(); timeMsg('');
    $('chosen').textContent = human(slot.date) + ', ' + slot.start + ' – ' + slot.end + ' (Brisbane time)';
    $('error').hidden = true;
    openForm();
    $('stepForm').scrollIntoView({ behavior: 'smooth', block: 'start' });
    $('name').focus({ preventScroll: true });
  });

  function openForm() { $('stepForm').hidden = false; $('form').hidden = false; $('review').hidden = true; }
  function closeForm() { $('stepForm').hidden = true; $('review').hidden = true; $('form').hidden = false; pending = null; }
  $('back').addEventListener('click', () => { closeForm(); $('stepTime').scrollIntoView({ behavior: 'smooth' }); });

  // ---------------------------------------------------------------- form
  const expectedEmail = num => DATA && num.length === 8
    ? ('s' + num.slice(0, DATA.config.uqEmailDigits) + '@' + DATA.config.studentEmailDomain).toLowerCase() : '';
  const MISMATCH = 'Your UQ student email does not match your student number. A UQ student email is the letter "s", ' +
    'followed by the FIRST 7 DIGITS of your 8-digit student number, then @student.uq.edu.au. ' +
    'Please check BOTH your student number and your email carefully — a wrong student number may mean a 0 for your oral exam.';

  // Only warns on mismatch — never displays the "correct" address, so students check their own details.
  function checkEmailMatch() {
    const num = $('studentNumber').value.trim(), email = $('email').value.trim().toLowerCase();
    const bad = num.length === 8 && email.length > 0 && email !== expectedEmail(num);
    setHint('emailHint', bad ? '⚠ ' + MISMATCH : '', bad, 'email');
    return !bad;
  }
  function setHint(id, text, warn, field) {
    $(id).textContent = text; $(id).className = warn ? 'hint warn' : 'hint';
    if (field) $(field).setAttribute('aria-invalid', warn ? 'true' : 'false');
  }

  const digitsOnly = v => String(v || '').normalize('NFKC').replace(/\D/g, '');
  $('studentNumber').addEventListener('input', e => {
    if (e.isComposing) return;
    const v = digitsOnly(e.target.value);
    if (v !== e.target.value) e.target.value = v;
    if (v.length > 8) setHint('uqHint', 'That is ' + v.length + ' digits — a student number has exactly 8. Please check it.', true, 'studentNumber');
    else setHint('uqHint', v.length && v.length < 8 ? (8 - v.length) + ' more digit' + (8 - v.length === 1 ? '' : 's') + ' needed.' : '', false, 'studentNumber');
    if ($('emailHint').textContent) checkEmailMatch();
  });
  $('studentNumber').addEventListener('compositionend', e => e.target.dispatchEvent(new Event('input')));
  // Delay the check a moment after leaving a field, so a click on the next control lands before the warning moves the layout.
  const laterCheck = () => setTimeout(() => { if ($('email').value) checkEmailMatch(); }, 350);
  $('studentNumber').addEventListener('blur', laterCheck);
  $('email').addEventListener('blur', laterCheck);
  $('email').addEventListener('input', () => { if ($('emailHint').textContent) checkEmailMatch(); });
  $('name').addEventListener('blur', () => {
    const n = $('name').value.trim();
    setHint('nameHint', n && !NAME_RE.test(n) ? 'Please use letters only (spaces, hyphens and apostrophes are fine).' : '', !!n && !NAME_RE.test(n), 'name');
  });

  function showError(msg, field) {
    $('review').hidden = true; $('form').hidden = false;
    $('error').textContent = msg; $('error').hidden = false;
    if (field) { $(field).focus(); $(field).scrollIntoView({ behavior: 'smooth', block: 'center' }); }
    else { $('error').focus({ preventScroll: true }); $('error').scrollIntoView({ behavior: 'smooth', block: 'center' }); }
  }

  $('form').addEventListener('submit', e => {
    e.preventDefault();
    if (submitting || done) return;
    $('error').hidden = true;
    const name = $('name').value.trim().replace(/\s+/g, ' ');
    const num = digitsOnly($('studentNumber').value);
    const email = $('email').value.trim();
    if (!slot) return showError('Please choose a time first.');
    if (Array.from(name).length < 2) return showError('Please enter your full name.', 'name');
    if (!NAME_RE.test(name)) return showError('Please enter your name using letters only (spaces, hyphens and apostrophes are fine).', 'name');
    if (!/^\d{8}$/.test(num)) return showError('Student number must be exactly 8 digits, numbers only.', 'studentNumber');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return showError('Please enter a valid email address.', 'email');
    if (!checkEmailMatch()) return showError(MISMATCH, 'email');
    if (!$('confirmDetails').checked || !$('confirmFirstBooking').checked) return showError('Please read and tick both confirmation boxes.', 'confirmDetails');
    pending = { action: 'book', name: name, studentNumber: num, email: email, slotId: slot.id, confirmDetails: true, confirmFirstBooking: true };
    $('reviewDetails').innerHTML = [['Name', name], ['Student number', num], ['UQ email', email],
      ['Exam time', human(slot.date) + ', ' + slot.start + ' – ' + slot.end + ' (Brisbane time)']]
      .map(r => '<dt>' + esc(r[0]) + '</dt><dd>' + esc(r[1]) + '</dd>').join('');
    $('form').hidden = true; $('review').hidden = false;
    $('reviewTitle').focus({ preventScroll: true });
    $('review').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  $('edit').addEventListener('click', () => { $('review').hidden = true; $('form').hidden = false; $('name').focus(); });

  $('confirmBook').addEventListener('click', async () => {
    if (submitting || done || !pending) return;
    submitting = true;
    $('confirmBook').disabled = $('edit').disabled = true; $('confirmBook').textContent = 'Booking…';
    const r = await api('POST', pending);
    submitting = false;
    $('confirmBook').disabled = $('edit').disabled = false; $('confirmBook').textContent = 'Yes, book this slot';
    $('submit').textContent = 'Review booking';
    if (r && r.ok) return showDone(r);
    if (r && r.refresh) {
      await load();
      if (!slot || !DATA.slots.some(s => s.id === slot.id && bookable(s))) {
        slot = null; renderTimes(); closeForm();
        return timeMsg((r.message || 'That time is no longer available.') + ' Your details are kept — just pick another time.');
      }
    }
    showError((r && r.message) || 'Something went wrong. Please try again.');
  });

  window.addEventListener('beforeunload', e => { if (submitting) { e.preventDefault(); e.returnValue = ''; } });

  function showDone(r) {
    done = true;
    const b = r.booking;
    ['stepCalendar', 'stepTime', 'stepForm'].forEach(id => { $(id).hidden = true; });
    $('stale').hidden = true;
    $('refCode').textContent = b.id;
    $('doneDetails').innerHTML = [['Name', b.name], ['Student number', b.number],
      ['Date & time', human(b.date) + ', ' + b.start + ' – ' + b.end + ' (Brisbane time)']]
      .map(x => '<dt>' + esc(x[0]) + '</dt><dd>' + esc(x[1]) + '</dd>').join('');
    $('doneEmail').innerHTML = r.duplicate
      ? 'This booking was already saved earlier — you are booked. A confirmation email was sent to <b>' + esc(b.uqEmail) + '</b>.'
      : r.emailSent
        ? 'A confirmation email (with a calendar invite) has been sent to <b>' + esc(b.uqEmail) + '</b>. Check your junk folder if you do not see it.'
        : '<div class="banner warn">Your booking is saved, but the confirmation email could not be sent right now. ' +
          'It will be sent automatically later — please keep a screenshot of this page.</div>';
    $('stepDone').hidden = false;
    $('doneTitle').focus({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // ---------------------------------------------------------------- check my booking
  $('lkNumber').addEventListener('input', e => { const v = digitsOnly(e.target.value); if (v !== e.target.value) e.target.value = v; });
  $('lookupForm').addEventListener('submit', async e => {
    e.preventDefault();
    const num = digitsOnly($('lkNumber').value), ref = $('lkRef').value.trim().toUpperCase().replace(/[^0-9A-F]/g, '');
    const out = $('lkResult');
    if (!/^\d{8}$/.test(num)) { out.innerHTML = '<div class="banner bad">Student number must be exactly 8 digits.</div>'; return; }
    if (!/^[0-9A-F]{8}$/.test(ref)) { out.innerHTML = '<div class="banner bad">The booking reference is the 8-character code on your confirmation (e.g. D1AD9172).</div>'; return; }
    $('lkBtn').disabled = true; $('lkBtn').textContent = 'Checking…';
    const r = await api('POST', { action: 'lookup', studentNumber: num, reference: ref });
    $('lkBtn').disabled = false; $('lkBtn').textContent = 'Check';
    if (!r || !r.ok) { out.innerHTML = '<div class="banner bad">' + esc((r && r.message) || 'Could not check right now. Please try again.') + '</div>'; return; }
    const b = r.booking, cancelled = b.status !== 'CONFIRMED';
    out.innerHTML = '<div class="lookup-card ' + (cancelled ? 'cancelled' : 'ok') + '"><b>' +
      (cancelled ? 'This booking was CANCELLED.' : '✓ You are booked.') + '</b><dl>' +
      [['Reference', b.id], ['Name', b.name], ['Student number', b.number],
       ['Date & time', human(b.date) + ', ' + b.start + ' – ' + b.end + ' (Brisbane time)']]
        .map(x => '<dt>' + esc(x[0]) + '</dt><dd>' + esc(x[1]) + '</dd>').join('') + '</dl>' +
      (cancelled ? '<p>You can make a new booking below, or email the teaching team if this is unexpected.</p>' : '') + '</div>';
  });

  // ---------------------------------------------------------------- demo mode (no backend)
  let demoState = null;
  function demoApi(method, body) {
    if (!demoState) {
      const slots = [];
      for (let t = Date.UTC(2026, 10, 9); t <= Date.UTC(2026, 10, 20); t += 864e5) {
        const dow = new Date(t).getUTCDay(); if (dow === 0 || dow === 6) continue;
        for (let m = 540; m + 30 <= 1020; m += 30) {
          if (m >= 720 && m < 780) continue;
          const hh = x => ('0' + Math.floor(x / 60)).slice(-2) + ':' + ('0' + x % 60).slice(-2);
          const cap = 3, rem = Math.max(0, cap - ((t / 864e5 + m) % 4));
          slots.push({ id: ymd(t) + ' ' + hh(m), date: ymd(t), start: hh(m), end: hh(m + 30), capacity: cap, remaining: rem, open: true });
        }
      }
      demoState = { slots: slots, booked: {} };
    }
    return sleep(300).then(() => {
      const config = { courseCode: 'INFS7410', examName: 'Final Oral Exam', contactEmail: 'INFS7410@eecs.uq.edu.au', bookingOpen: true,
        minHoursBefore: 24, studentEmailDomain: 'student.uq.edu.au', uqEmailDigits: 7, notice: 'Demo data only.' };
      if (method === 'GET') return { ok: true, config: config, slots: demoState.slots };
      if (body.action === 'lookup') return { ok: false, message: 'Demo mode: lookup needs the real booking server.' };
      if (body.email.toLowerCase() !== 's' + body.studentNumber.slice(0, 7) + '@student.uq.edu.au') return { ok: false, message: 'Your UQ student email does not match your student number.' };
      if (demoState.booked[body.studentNumber]) return { ok: false, message: 'Student number ' + body.studentNumber + ' already has a confirmed booking — you can only book once.' };
      const s = demoState.slots.find(x => x.id === body.slotId);
      if (!s || s.remaining <= 0) return { ok: false, refresh: true, message: 'Sorry, that slot has just been filled.' };
      s.remaining--; demoState.booked[body.studentNumber] = true;
      return { ok: true, emailSent: true, booking: { id: 'DEMO1234', name: body.name, number: body.studentNumber, date: s.date, start: s.start, end: s.end,
        uqEmail: 's' + body.studentNumber.slice(0, 7) + '@student.uq.edu.au' } };
    });
  }

  load(true);
  const poll = () => setTimeout(() => { if (!done && !submitting && document.visibilityState === 'visible') load(); poll(); }, jitter(80000, 110000));
  poll();
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && !done && !submitting && DATA && Date.now() - (DATA._at || 0) > 60000) load(); });
})();
