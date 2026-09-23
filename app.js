/* INFS7410 oral exam booking — student page. Talks to the Apps Script backend (config.js). */
(function () {
  'use strict';
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

  let DATA = null, day = null, slot = null, submitting = false, done = false;

  // ---------------------------------------------------------------- API
  async function api(method, body) {
    if (DEMO) return demoApi(method, body);
    const opts = method === 'GET' ? { method: 'GET' } :
      // text/plain avoids a CORS preflight, which Apps Script cannot answer
      { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body) };
    const url = method === 'GET' ? API + '?action=slots&t=' + Date.now() : API;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await fetch(url, Object.assign({ redirect: 'follow', cache: 'no-store' }, opts));
        const json = await res.json();
        if (json && json.ok === false && /busy/i.test(json.message || '') && attempt < 2) { await sleep(1500 + attempt * 1500); continue; }
        return json;
      } catch (err) {
        if (method !== 'GET' || attempt === 2) {
          // A POST may have reached the server even if the reply was lost — never silently retry a booking.
          return { ok: false, network: true, message: 'Could not reach the booking server. Check your connection. ' +
            (method === 'POST' ? 'Your booking may or may not have been saved — check your email before trying again.' : 'Please reload the page.') };
        }
        await sleep(1500);
      }
    }
  }
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  async function load() {
    const r = await api('GET');
    if (!r || !r.ok) { $('calendar').innerHTML = '<div class="banner bad">' + esc((r && r.message) || 'Could not load slots.') + '</div>'; return; }
    DATA = r;
    const c = r.config;
    document.title = c.courseCode + ' ' + c.examName + ' Booking';
    $('title').textContent = c.courseCode + ' ' + c.examName + ' Booking';
    $('notice').textContent = c.notice || '';
    $('closed').hidden = c.bookingOpen;
    $('demo').hidden = !DEMO;
    $('footer').innerHTML = 'Questions? Email <a href="mailto:' + esc(c.contactEmail) + '">' + esc(c.contactEmail) + '</a>';
    if (day && slot) { // keep selection if still valid
      slot = r.slots.find(s => s.id === slot.id) || null;
    }
    renderCalendar();
    if (day) renderTimes();
  }

  // ---------------------------------------------------------------- calendar
  function renderCalendar() {
    const byDate = {};
    DATA.slots.forEach(s => (byDate[s.date] = byDate[s.date] || []).push(s));
    const dates = Object.keys(byDate).sort();
    if (!dates.length) { $('calendar').innerHTML = '<p class="muted">No exam slots are available yet. Please check back later.</p>'; return; }
    const from = dates[0], to = dates[dates.length - 1];
    let t = utc(from); t -= ((new Date(t).getUTCDay() + 6) % 7) * 864e5; // Monday of first week
    let html = '', lastMonth = -1;
    for (; t <= utc(to); t += 7 * 864e5) {
      const m = new Date(t + 4 * 864e5).getUTCMonth();
      if (m !== lastMonth) {
        html += '<div class="month">' + MONTH[m] + ' ' + new Date(t + 4 * 864e5).getUTCFullYear() + '</div>' +
          '<div class="cal-head"><div>Mon</div><div>Tue</div><div>Wed</div><div>Thu</div><div>Fri</div></div>';
        lastMonth = m;
      }
      html += '<div class="cal-row">';
      for (let i = 0; i < 5; i++) {
        const ds = ymd(t + i * 864e5), d = new Date(t + i * 864e5);
        const label = d.getUTCDate() + ' ' + MON[d.getUTCMonth()];
        const list = byDate[ds];
        if (!list) { html += '<div class="cal-cell ' + (ds < from || ds > to ? 'out' : 'none') + '"><div class="d">' + label + '</div></div>'; continue; }
        const left = list.filter(s => s.open).reduce((a, s) => a + s.remaining, 0);
        const bookable = left > 0 && DATA.config.bookingOpen;
        const cls = bookable ? 'avail' : 'full';
        const meta = left > 0 ? left + (left === 1 ? ' place' : ' places') + ' left' : (list.some(s => s.open) ? 'Full' : 'Closed');
        html += bookable
          ? '<button type="button" class="cal-cell ' + cls + (ds === day ? ' sel' : '') + '" data-date="' + ds + '" aria-label="' + esc(human(ds) + ', ' + meta) + '">' +
            '<div class="d">' + label + '</div><div class="m">' + meta + '</div></button>'
          : '<div class="cal-cell ' + cls + '"><div class="d">' + label + '</div><div class="m">' + meta + '</div></div>';
      }
      html += '</div>';
    }
    $('calendar').innerHTML = html;
  }

  $('calendar').addEventListener('click', e => {
    const c = e.target.closest('button.cal-cell'); if (!c || done) return;
    day = c.dataset.date; slot = null;
    renderCalendar(); renderTimes();
    $('stepForm').hidden = true;
    $('stepTime').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  function renderTimes() {
    const list = DATA.slots.filter(s => s.date === day).sort((a, b) => a.start < b.start ? -1 : 1);
    $('dayLabel').textContent = human(day);
    $('times').innerHTML = list.map(s => {
      const ok = s.open && s.remaining > 0 && DATA.config.bookingOpen;
      const label = !s.open ? 'Closed for online booking' : s.remaining > 0 ? s.remaining + ' of ' + s.capacity + ' places left' : 'Full';
      return '<button type="button" class="time' + (slot && slot.id === s.id ? ' sel' : '') + '" data-id="' + esc(s.id) + '"' + (ok ? '' : ' disabled') +
        '><b>' + s.start + ' – ' + s.end + '</b><span>' + label + '</span></button>';
    }).join('');
    $('stepTime').hidden = false;
  }

  $('times').addEventListener('click', e => {
    const b = e.target.closest('button.time'); if (!b || b.disabled || done) return;
    slot = DATA.slots.find(s => s.id === b.dataset.id);
    renderTimes();
    $('chosen').textContent = human(slot.date) + ', ' + slot.start + ' – ' + slot.end + ' (Brisbane time)';
    $('error').hidden = true;
    $('stepForm').hidden = false;
    $('stepForm').scrollIntoView({ behavior: 'smooth', block: 'start' });
    $('name').focus({ preventScroll: true });
  });

  $('back').addEventListener('click', () => { $('stepForm').hidden = true; $('stepTime').scrollIntoView({ behavior: 'smooth' }); });

  // ---------------------------------------------------------------- form
  const expectedEmail = num => DATA && num.length === 8
    ? ('s' + num.slice(0, DATA.config.uqEmailDigits) + '@' + DATA.config.studentEmailDomain).toLowerCase() : '';
  const MISMATCH = 'Your UQ student email does not match your student number. A UQ student email is the letter "s", ' +
    'followed by the FIRST 7 DIGITS of your 8-digit student number, then @student.uq.edu.au. ' +
    'Please check BOTH your student number and your email carefully — a wrong student number may mean a 0 for your oral exam.';

  // Only warns on mismatch — never displays the "correct" address, so students check their own details.
  function checkEmailMatch() {
    const num = $('studentNumber').value.trim(), email = $('email').value.trim().toLowerCase();
    const h = $('emailHint');
    const bad = num.length === 8 && email.length > 0 && email !== expectedEmail(num);
    h.textContent = bad ? '⚠ ' + MISMATCH : '';
    h.className = bad ? 'hint warn' : 'hint';
    return !bad;
  }

  $('studentNumber').addEventListener('input', e => {
    const v = e.target.value.replace(/\D/g, '').slice(0, 8);
    if (v !== e.target.value) e.target.value = v;
    $('uqHint').textContent = v.length && v.length < 8 ? (8 - v.length) + ' more digit' + (8 - v.length === 1 ? '' : 's') + ' needed.' : '';
    if ($('emailHint').textContent) checkEmailMatch();
  });
  $('studentNumber').addEventListener('blur', () => { if ($('email').value) checkEmailMatch(); });
  $('email').addEventListener('blur', checkEmailMatch);
  $('email').addEventListener('input', () => { if ($('emailHint').textContent) checkEmailMatch(); });

  function showError(msg) { $('error').textContent = msg; $('error').hidden = false; $('error').scrollIntoView({ behavior: 'smooth', block: 'center' }); }

  $('form').addEventListener('submit', async e => {
    e.preventDefault();
    if (submitting || done) return;
    const name = $('name').value.trim().replace(/\s+/g, ' ');
    const num = $('studentNumber').value.trim();
    const email = $('email').value.trim();
    ['name', 'studentNumber', 'email'].forEach(id => $(id).classList.add('touched'));
    if (!slot) return showError('Please choose a time first.');
    if (name.length < 2) return showError('Please enter your full name.');
    if (!/^\d{8}$/.test(num)) return showError('Student number must be exactly 8 digits, numbers only.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return showError('Please enter a valid email address.');
    if (!$('confirmDetails').checked || !$('confirmFirstBooking').checked) return showError('Please read and tick both confirmation boxes.');
    if (!checkEmailMatch()) return showError(MISMATCH);
    if (!confirm('Please double-check before confirming:\n\nName: ' + name + '\nStudent number: ' + num + '\nEmail: ' + email +
      '\nSlot: ' + human(slot.date) + ' ' + slot.start + '–' + slot.end + '\n\nYou can only book once. Confirm this booking?')) return;

    submitting = true;
    $('submit').disabled = true; $('submit').textContent = 'Booking…';
    $('error').hidden = true;
    const r = await api('POST', { action: 'book', name: name, studentNumber: num, email: email, slotId: slot.id,
      confirmDetails: true, confirmFirstBooking: true });
    submitting = false;
    $('submit').disabled = false; $('submit').textContent = 'Confirm booking';

    if (r && r.ok) return showDone(r);
    showError((r && r.message) || 'Something went wrong. Please try again.');
    if (r && r.refresh) { await load(); if (slot && !(slot.open && slot.remaining > 0)) { slot = null; $('stepForm').hidden = true; } }
  });

  function showDone(r) {
    done = true;
    const b = r.booking;
    ['stepCalendar', 'stepTime', 'stepForm'].forEach(id => { $(id).hidden = true; });
    $('doneDetails').innerHTML =
      '<dt>Reference</dt><dd>' + esc(b.id) + '</dd>' +
      '<dt>Name</dt><dd>' + esc(b.name) + '</dd>' +
      '<dt>Student number</dt><dd>' + esc(b.number) + '</dd>' +
      '<dt>Date &amp; time</dt><dd>' + esc(human(b.date)) + ', ' + esc(b.start) + ' – ' + esc(b.end) + ' (Brisbane time)</dd>';
    $('doneEmail').innerHTML = r.emailSent
      ? 'A confirmation email (with a calendar invite) has been sent to <b>' + esc(b.uqEmail) + '</b>' + '. Check your junk folder if you do not see it.'
      : '<div class="banner warn">Your booking is saved, but the confirmation email could not be sent right now. ' +
        'It will be resent later — please keep a screenshot of this page.</div>';
    $('stepDone').hidden = false;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

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
      if (body.email.toLowerCase() !== 's' + body.studentNumber.slice(0, 7) + '@student.uq.edu.au') return { ok: false, message: 'Your UQ student email does not match your student number.' };
      if (demoState.booked[body.studentNumber]) return { ok: false, message: 'Student number ' + body.studentNumber + ' already has a confirmed booking — you can only book once.' };
      const s = demoState.slots.find(x => x.id === body.slotId);
      if (!s || s.remaining <= 0) return { ok: false, refresh: true, message: 'Sorry, that slot has just been filled.' };
      s.remaining--; demoState.booked[body.studentNumber] = true;
      return { ok: true, emailSent: true, booking: { id: 'DEMO1234', name: body.name, number: body.studentNumber, date: s.date, start: s.start, end: s.end,
        uqEmail: 's' + body.studentNumber.slice(0, 7) + '@student.uq.edu.au', email: body.email } };
    });
  }

  load();
  setInterval(() => { if (!done && !submitting && document.visibilityState === 'visible') load(); }, 60000); // keep counts fresh
})();
