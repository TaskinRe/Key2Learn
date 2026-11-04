/* Key to Learn: static homework site (no database, no student sign-in).
   Homework lives in the repo's /homework folder. Results travel as small files or codes.
   Security notes:
   - All text from homework files, names and result files is rendered with textContent (never innerHTML).
   - Homework runs in play.html inside a sandboxed iframe (no allow-same-origin), so it cannot read
     this page, its storage, or other students' data.
   - Messages from the game are accepted only from that iframe and are size-limited and type-checked.
*/
(function () {
  'use strict';

  var CFG = window.K2L_CONFIG || {};
  var MAX_HOMEWORK_BYTES = 30 * 1024 * 1024; // 30 MB safety cap for the browser
  var RESULT_PREFIX = 'K2L1:';
  var LS = {
    name: 'k2l_student_name',
    done: 'k2l_done',          // student: homework files finished on this device
    results: 'k2l_results',    // teacher: imported results
  };

  // ---------- small helpers ----------
  function $(sel) { return document.querySelector(sel); }
  function el(tag, attrs, kids) {
    var n = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v == null || v === false) return;
      if (k === 'text') n.textContent = v;
      else if (k === 'class') n.className = v;
      else if (k.slice(0, 2) === 'on') n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? '' : v);
    });
    (kids || []).forEach(function (c) { if (c) n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return n;
  }
  function lsGet(k, fallback) { try { var v = localStorage.getItem(k); return v == null ? fallback : JSON.parse(v); } catch (e) { return fallback; } }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* storage blocked */ } }
  function say(msg) { var l = $('#live'); l.textContent = ''; setTimeout(function () { l.textContent = msg; }, 50); }
  function clip(v, n) { return String(v == null ? '' : v).slice(0, n); }
  function fmtTime(s) { s = Math.max(0, Math.round(s || 0)); var m = Math.floor(s / 60); return m ? m + ' min ' + (s % 60) + ' s' : s + ' s'; }
  function prettyName(file) {
    return file.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/^./, function (c) { return c.toUpperCase(); });
  }
  function download(filename, text, type) {
    var blob = new Blob([text], { type: type || 'application/json' });
    var a = el('a', { href: URL.createObjectURL(blob), download: filename });
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }
  function safeFile(s) { return clip(s, 60).replace(/[^A-Za-z0-9 _-]/g, '').trim().replace(/\s+/g, '-') || 'student'; }

  // Base64 for UTF-8 text
  function b64enc(str) { return btoa(unescape(encodeURIComponent(str))); }
  function b64dec(b) { return decodeURIComponent(escape(atob(b))); }

  // Simple checksum to catch damaged or edited-by-accident codes (not a security feature).
  function checksum(str) { var h = 2166136261; for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); }

  // ---------- GitHub repo detection ----------
  function repoInfo() {
    var owner = CFG.githubOwner, repo = CFG.githubRepo;
    var host = location.hostname;
    if ((!owner || !repo) && /\.github\.io$/i.test(host)) {
      owner = owner || host.split('.')[0];
      var seg = location.pathname.split('/').filter(Boolean)[0];
      repo = repo || (seg && !/\.html?$/i.test(seg) ? seg : host);
    }
    return owner && repo ? { owner: owner, repo: repo, branch: CFG.branch || 'main' } : null;
  }

  // ---------- homework list ----------
  var homeworkCache = null;
  function loadHomework() {
    if (homeworkCache) return Promise.resolve(homeworkCache);
    // 1) list.json is written automatically by the GitHub Action (no rate limits)
    return fetch('homework/list.json', { cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw new Error('no list'); return r.json(); })
      .then(function (list) { return normalizeList(list); })
      .catch(function () {
        // 2) fall back to the public GitHub API
        var info = repoInfo();
        if (!info) return [];
        var url = 'https://api.github.com/repos/' + encodeURIComponent(info.owner) + '/' + encodeURIComponent(info.repo) +
          '/contents/homework?ref=' + encodeURIComponent(info.branch);
        return fetch(url).then(function (r) { if (!r.ok) throw new Error('api'); return r.json(); })
          .then(function (items) {
            return normalizeList((items || []).map(function (it) { return { file: it.name, size: it.size }; }));
          });
      })
      .then(function (list) { homeworkCache = list; return list; });
  }
  function normalizeList(list) {
    if (!Array.isArray(list)) return [];
    return list
      .filter(function (h) { return h && typeof h.file === 'string' && /^[^/\\]+\.html?$/i.test(h.file) && h.file.toLowerCase() !== 'index.html'; })
      .map(function (h) {
        return { file: h.file, title: clip(h.title || prettyName(h.file), 120), size: Number(h.size) || 0, added: clip(h.added || '', 30) };
      })
      .sort(function (a, b) { return String(b.added).localeCompare(String(a.added)) || a.title.localeCompare(b.title); });
  }

  // ---------- layout ----------
  var isTeacher = new URLSearchParams(location.search).has('teacher');
  var main = $('#main');
  function setTabs(items, active) {
    var nav = $('#tabs'); nav.textContent = '';
    items.forEach(function (t) {
      nav.appendChild(el('button', { class: 'tab', 'aria-current': t.id === active ? 'page' : null, text: t.label, onclick: t.go }));
    });
  }
  function screen(nodes) {
    main.textContent = '';
    nodes.forEach(function (n) { if (n) main.appendChild(n); });
    main.focus({ preventScroll: true });
    window.scrollTo(0, 0);
  }

  // =====================================================================
  // STUDENT
  // =====================================================================
  function studentName() { return clip(lsGet(LS.name, ''), 60); }

  function studentHome() {
    setTabs([], null);
    var name = studentName();
    if (!name) return askName();

    var list = el('div', { class: 'grid', 'aria-busy': 'true' }, [el('p', { class: 'muted', text: 'Loading your homework…' })]);
    screen([
      el('section', { class: 'hero small' }, [
        el('h1', { text: 'Hi ' + name + '!' }),
        el('p', { text: 'Pick your homework below.' }),
        el('button', { class: 'link', text: 'Not ' + name + '? Change name', onclick: function () { lsSet(LS.name, ''); askName(); } }),
      ]),
      el('h2', { text: 'Your homework' }),
      list,
    ]);

    loadHomework().then(function (hw) {
      list.textContent = ''; list.removeAttribute('aria-busy');
      if (!hw.length) { list.appendChild(el('p', { class: 'muted', text: 'No homework yet. Check back later!' })); return; }
      var done = lsGet(LS.done, {});
      hw.forEach(function (h) {
        list.appendChild(el('article', { class: 'card' }, [
          el('h3', { text: h.title }),
          done[h.file] ? el('p', { class: 'badge ok', text: 'Finished' }) : el('p', { class: 'badge', text: 'To do' }),
          el('button', { class: 'btn big', text: done[h.file] ? 'Do it again' : 'Start', onclick: function () { play(h, false); } }),
        ]));
      });
    }).catch(function () {
      list.textContent = '';
      list.appendChild(el('p', { class: 'error', role: 'alert', text: 'Could not load homework. Check your internet and refresh the page.' }));
    });
  }

  function askName() {
    setTabs([], null);
    var input = el('input', { id: 'nm', type: 'text', maxlength: '60', autocomplete: 'given-name', required: true, class: 'input big' });
    var form = el('form', { class: 'hero', onsubmit: function (e) {
      e.preventDefault();
      var v = input.value.replace(/\s+/g, ' ').trim();
      if (!v) { input.focus(); return; }
      lsSet(LS.name, clip(v, 60));
      studentHome();
    } }, [
      el('h1', { text: 'Welcome!' }),
      el('label', { for: 'nm', class: 'label', text: 'What is your name?' }),
      input,
      el('button', { class: 'btn big', type: 'submit', text: 'Go' }),
    ]);
    screen([form]);
    setTimeout(function () { input.focus(); }, 50);
  }

  // ---------- player (shared by student and teacher preview) ----------
  var activeListener = null;
  function play(h, preview, localHtml) {
    var session = { file: h.file, title: h.title, startedAt: new Date().toISOString(), answers: [], mistakes: [], score: null, maxScore: null, reflection: '', seconds: 0 };
    var t0 = Date.now();
    var status = el('p', { class: 'muted', role: 'status', text: 'Loading…' });
    var frame = el('iframe', {
      class: 'game', title: h.title,
      sandbox: 'allow-scripts allow-forms allow-modals', // no allow-same-origin: the game cannot touch this site
      referrerpolicy: 'no-referrer', allow: 'fullscreen; autoplay',
      src: 'play.html',
    });
    var finishBtn = el('button', { class: 'btn', text: preview ? 'Close preview' : 'I am finished', onclick: function () { end(true); } });

    setTabs([], null);
    screen([
      el('div', { class: 'playerbar' }, [
        el('button', { class: 'btn ghost', text: '← Back', onclick: function () { cleanup(); preview ? teacherHome('homework') : studentHome(); } }),
        el('h1', { class: 'ptitle', text: h.title }),
        finishBtn,
      ]),
      status,
      frame,
    ]);

    var htmlPromise = localHtml != null ? Promise.resolve(localHtml) :
      fetch('homework/' + encodeURIComponent(h.file), { cache: 'no-store' }).then(function (r) {
        if (!r.ok) throw new Error('missing');
        var len = Number(r.headers.get('content-length') || 0);
        if (len > MAX_HOMEWORK_BYTES) throw new Error('too big');
        return r.text();
      });

    var html = null, ready = false;
    function send() { if (html != null && ready) { frame.contentWindow.postMessage({ type: 'K2L_LOAD', html: html }, '*'); status.textContent = ''; } }
    htmlPromise.then(function (t) { html = t; send(); }).catch(function () {
      status.className = 'error'; status.setAttribute('role', 'alert');
      status.textContent = 'This homework could not be opened. Ask your teacher to check the file.';
    });

    function onMsg(e) {
      if (e.source !== frame.contentWindow) return; // only our sandboxed game
      var d = e.data; if (!d || typeof d !== 'object' || typeof d.type !== 'string') return;
      var p = d.payload && typeof d.payload === 'object' ? d.payload : {};
      if (d.type === 'K2L_PLAYER_READY') { ready = true; send(); }
      else if (d.type === 'K2L_ANSWER' && p.item && session.answers.length < 200) {
        var it = sanitizeItem(p.item);
        session.answers.push(it);
        if (!it.isCorrect && session.mistakes.length < 100) session.mistakes.push(it);
        if (isFinite(p.score)) session.score = Number(p.score);
      } else if (d.type === 'K2L_FINISH') {
        if (isFinite(p.score)) session.score = Number(p.score);
        if (isFinite(p.maxScore) && Number(p.maxScore) > 0) session.maxScore = Number(p.maxScore);
        session.reflection = clip(p.reflection, 1000);
        end(false);
      }
    }
    if (activeListener) window.removeEventListener('message', activeListener);
    activeListener = onMsg;
    window.addEventListener('message', onMsg);

    function cleanup() { window.removeEventListener('message', onMsg); activeListener = null; }
    function end(manual) {
      cleanup();
      session.seconds = Math.round((Date.now() - t0) / 1000);
      session.finishedAt = new Date().toISOString();
      if (session.maxScore == null && session.answers.length) session.maxScore = session.answers.length;
      if (session.score == null && session.answers.length) session.score = session.answers.filter(function (a) { return a.isCorrect; }).length;
      session.manualFinish = manual;
      if (preview) { teacherHome('homework'); return; }
      showResult(session);
    }
  }

  function sanitizeItem(i) {
    return {
      questionId: clip(i.questionId, 60), questionText: clip(i.questionText, 300), userAnswer: clip(i.userAnswer, 200),
      correctAnswer: clip(i.correctAnswer, 200), isCorrect: !!i.isCorrect, attempts: Math.min(99, Number(i.attempts) || 1),
      seconds: Math.min(36000, Number(i.seconds) || 0), explanation: clip(i.explanation, 400),
    };
  }

  // ---------- result + sending to teacher ----------
  function buildResult(s) {
    var body = {
      v: 1, student: studentName(), homework: s.title, file: s.file,
      startedAt: s.startedAt, finishedAt: s.finishedAt, seconds: s.seconds,
      score: s.score, maxScore: s.maxScore, answered: s.answers.length,
      mistakes: s.mistakes, reflection: s.reflection, manualFinish: !!s.manualFinish,
    };
    var json = JSON.stringify(body);
    return { body: body, json: json, code: RESULT_PREFIX + checksum(json) + ':' + b64enc(json) };
  }

  function showResult(s) {
    var r = buildResult(s);
    var done = lsGet(LS.done, {}); done[s.file] = r.body.finishedAt; lsSet(LS.done, done);

    var pct = r.body.maxScore ? Math.round((r.body.score || 0) / r.body.maxScore * 100) : null;
    var fname = safeFile(r.body.student) + '_' + safeFile(s.title) + '.k2l.json';
    var codeBox = el('textarea', { class: 'code', readonly: true, rows: '3', 'aria-label': 'Result code' });
    codeBox.value = r.code;
    var copyBtn = el('button', { class: 'btn', text: 'Copy result code', onclick: function () {
      codeBox.select();
      (navigator.clipboard ? navigator.clipboard.writeText(r.code) : Promise.reject()).then(function () { copyBtn.textContent = 'Copied!'; say('Copied'); })
        .catch(function () { try { document.execCommand('copy'); copyBtn.textContent = 'Copied!'; } catch (e) { /* user can copy manually */ } });
    } });

    var mailBtn = null;
    if (CFG.teacherEmail && /^[^\s@<>"]+@[^\s@<>"]+$/.test(CFG.teacherEmail)) {
      var subject = 'Homework result: ' + r.body.student + ' - ' + s.title;
      var bodyTxt = 'Hi! Here is my homework result.\n\nPlease paste this code into Key to Learn > Results:\n\n' + r.code;
      if (bodyTxt.length > 1800) bodyTxt = 'Hi! My result file is attached (' + fname + ').';
      mailBtn = el('a', { class: 'btn', href: 'mailto:' + encodeURIComponent(CFG.teacherEmail) + '?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(bodyTxt), text: 'Email my result' });
    }

    screen([
      el('section', { class: 'hero' }, [
        el('h1', { text: 'Well done, ' + r.body.student + '!' }),
        pct != null ? el('p', { class: 'score', text: r.body.score + ' / ' + r.body.maxScore + '  (' + pct + '%)' }) : el('p', { text: 'You finished your homework.' }),
        el('p', { class: 'muted', text: 'Time: ' + fmtTime(r.body.seconds) }),
      ]),
      el('section', { class: 'panel' }, [
        el('h2', { text: 'Send it to your teacher' }),
        el('p', { text: 'Do one of these:' }),
        el('div', { class: 'row' }, [
          el('button', { class: 'btn big', text: 'Save result file', onclick: function () { download(fname, r.json); say('Result file saved'); } }),
          mailBtn,
          copyBtn,
        ]),
        el('p', { class: 'muted', text: 'Send the file or the code to your teacher (email, WhatsApp, or your class app).' }),
        codeBox,
      ]),
      el('button', { class: 'btn ghost', text: 'Back to my homework', onclick: studentHome }),
    ]);
  }

  // =====================================================================
  // TEACHER  (open the site with ?teacher at the end of the address)
  // =====================================================================
  function teacherHome(tab) {
    tab = tab || 'upload';
    setTabs([
      { id: 'upload', label: 'Upload', go: function () { teacherHome('upload'); } },
      { id: 'results', label: 'Results', go: function () { teacherHome('results'); } },
      { id: 'homework', label: 'Homework', go: function () { teacherHome('homework'); } },
    ], tab);
    if (tab === 'results') return teacherResults();
    if (tab === 'homework') return teacherHomework();
    return teacherUpload();
  }

  function uploadUrl() {
    var i = repoInfo();
    return i ? 'https://github.com/' + encodeURIComponent(i.owner) + '/' + encodeURIComponent(i.repo) + '/upload/' + encodeURIComponent(i.branch) + '/homework' : null;
  }

  function teacherUpload() {
    var url = uploadUrl();
    var testInput = el('input', { type: 'file', accept: '.html,.htm,text/html', class: 'sr-only', id: 'tf', onchange: function () {
      var f = testInput.files && testInput.files[0]; if (!f) return;
      if (f.size > MAX_HOMEWORK_BYTES) { alert('That file is too big to test here.'); return; }
      f.text().then(function (t) { play({ file: f.name, title: prettyName(f.name) }, true, t); });
    } });

    screen([
      el('section', { class: 'upload' }, [
        el('h1', { text: 'Upload your homework' }),
        url
          ? el('a', { class: 'dropbig', href: url, target: '_blank', rel: 'noopener noreferrer' }, [
              el('span', { class: 'upicon', 'aria-hidden': 'true', text: '↑' }),
              el('span', { class: 'uptext', text: 'Click here to upload' }),
              el('span', { class: 'muted', text: 'Opens GitHub in a new tab' }),
            ])
          : el('p', { class: 'error', text: 'Upload link not set yet. Open this site from its github.io address, or fill in githubOwner and githubRepo in config.js.' }),
        el('ol', { class: 'steps' }, [
          el('li', { text: 'Drag your homework file (.html) into the GitHub page.' }),
          el('li', { text: 'Click the green "Commit changes" button.' }),
          el('li', { text: 'Wait about 1 minute. Students will see it automatically.' }),
        ]),
        el('p', { class: 'muted' }, ['Want to check a file first? ', el('label', { for: 'tf', class: 'link', text: 'Try it here' }), testInput]),
      ]),
    ]);
  }

  function teacherHomework() {
    var list = el('div', { class: 'list' }, [el('p', { class: 'muted', text: 'Loading…' })]);
    var i = repoInfo();
    screen([el('h1', { text: 'Homework students can see' }), list]);
    homeworkCache = null;
    loadHomework().then(function (hw) {
      list.textContent = '';
      if (!hw.length) { list.appendChild(el('p', { class: 'muted', text: 'No homework uploaded yet.' })); return; }
      hw.forEach(function (h) {
        list.appendChild(el('div', { class: 'item' }, [
          el('div', { class: 'grow' }, [
            el('strong', { text: h.title }),
            el('div', { class: 'muted small', text: h.file + (h.size ? ' · ' + (h.size / 1048576).toFixed(1) + ' MB' : '') }),
          ]),
          el('button', { class: 'btn ghost', text: 'Preview', onclick: function () { play(h, true); } }),
          i ? el('a', { class: 'btn ghost', target: '_blank', rel: 'noopener noreferrer', text: 'Remove…',
            href: 'https://github.com/' + encodeURIComponent(i.owner) + '/' + encodeURIComponent(i.repo) + '/delete/' + encodeURIComponent(i.branch) + '/homework/' + encodeURIComponent(h.file) }) : null,
        ]));
      });
    }).catch(function () { list.textContent = ''; list.appendChild(el('p', { class: 'error', text: 'Could not load the homework list.' })); });
  }

  // ---------- results inbox (stored only in the teacher's browser) ----------
  function parseResult(text) {
    text = String(text || '').trim();
    var json, body;
    if (text.indexOf(RESULT_PREFIX) === 0) {
      var rest = text.slice(RESULT_PREFIX.length), cut = rest.indexOf(':');
      if (cut < 0) throw new Error('bad code');
      json = b64dec(rest.slice(cut + 1).replace(/\s+/g, ''));
      if (checksum(json) !== rest.slice(0, cut)) throw new Error('This code is damaged or incomplete.');
    } else json = text;
    if (json.length > 500000) throw new Error('Too large');
    body = JSON.parse(json);
    if (!body || body.v !== 1 || typeof body.student !== 'string') throw new Error('Not a Key to Learn result');
    return {
      id: checksum(json), student: clip(body.student, 60), homework: clip(body.homework, 120), file: clip(body.file, 200),
      finishedAt: clip(body.finishedAt, 40), seconds: Number(body.seconds) || 0,
      score: isFinite(body.score) ? Number(body.score) : null, maxScore: isFinite(body.maxScore) ? Number(body.maxScore) : null,
      answered: Number(body.answered) || 0, reflection: clip(body.reflection, 1000), manualFinish: !!body.manualFinish,
      mistakes: (Array.isArray(body.mistakes) ? body.mistakes : []).slice(0, 100).map(sanitizeItem),
    };
  }

  function addResults(texts) {
    var store = lsGet(LS.results, []), added = 0, bad = 0;
    texts.forEach(function (t) {
      try {
        var r = parseResult(t);
        if (!store.some(function (x) { return x.id === r.id; })) { store.push(r); added++; }
      } catch (e) { bad++; }
    });
    lsSet(LS.results, store);
    return { added: added, bad: bad };
  }

  function teacherResults() {
    var results = lsGet(LS.results, []).slice().sort(function (a, b) { return String(b.finishedAt).localeCompare(String(a.finishedAt)); });
    var msg = el('p', { role: 'status', class: 'muted' });
    var fileIn = el('input', { type: 'file', multiple: true, accept: '.json,application/json', class: 'sr-only', id: 'rf', onchange: function () {
      var files = Array.prototype.slice.call(fileIn.files || []).filter(function (f) { return f.size < 600000; });
      Promise.all(files.map(function (f) { return f.text(); })).then(function (texts) { report(addResults(texts)); });
    } });
    var paste = el('textarea', { class: 'code', rows: '3', placeholder: 'Paste result codes here (one or more)', 'aria-label': 'Paste result codes' });
    function report(r) {
      teacherResults();
      say(r.added + ' result(s) added' + (r.bad ? ', ' + r.bad + ' could not be read' : ''));
    }

    var drop = el('label', { for: 'rf', class: 'drop', ondragover: function (e) { e.preventDefault(); drop.classList.add('over'); },
      ondragleave: function () { drop.classList.remove('over'); },
      ondrop: function (e) {
        e.preventDefault(); drop.classList.remove('over');
        var files = Array.prototype.slice.call(e.dataTransfer.files || []).filter(function (f) { return f.size < 600000; });
        Promise.all(files.map(function (f) { return f.text(); })).then(function (texts) { report(addResults(texts)); });
      } }, [el('strong', { text: 'Add result files' }), el('span', { class: 'muted', text: 'Click or drag the files students sent you' })]);

    var table = null;
    if (results.length) {
      table = el('table', { class: 'table' }, [
        el('thead', null, [el('tr', null, ['Student', 'Homework', 'Score', 'Mistakes', 'Time', 'Finished', ''].map(function (h) { return el('th', { scope: 'col', text: h }); }))]),
        el('tbody', null, results.map(function (r) {
          var pct = r.maxScore ? Math.round((r.score || 0) / r.maxScore * 100) + '%' : '—';
          return el('tr', null, [
            el('td', { text: r.student }), el('td', { text: r.homework }),
            el('td', { text: r.maxScore ? r.score + '/' + r.maxScore + ' (' + pct + ')' : 'n/a' }),
            el('td', { text: String(r.mistakes.length) }), el('td', { text: fmtTime(r.seconds) }),
            el('td', { text: r.finishedAt ? new Date(r.finishedAt).toLocaleString() : '' }),
            el('td', null, [el('button', { class: 'btn ghost small', text: 'Details', onclick: function () { resultDetail(r); } })]),
          ]);
        })),
      ]);
    }

    screen([
      el('h1', { text: 'Results' }),
      el('section', { class: 'panel' }, [
        drop, fileIn,
        paste,
        el('button', { class: 'btn', text: 'Add pasted codes', onclick: function () {
          var codes = paste.value.split(/\s+(?=K2L1:)|\n+/).map(function (s) { return s.trim(); }).filter(Boolean);
          if (codes.length) report(addResults(codes));
        } }),
        msg,
      ]),
      results.length ? el('div', { class: 'tablewrap' }, [table]) : el('p', { class: 'muted', text: 'No results yet.' }),
      results.length ? el('div', { class: 'row' }, [
        el('button', { class: 'btn ghost', text: 'Download as spreadsheet (CSV)', onclick: function () { download('results.csv', toCsv(results), 'text/csv'); } }),
        el('button', { class: 'btn ghost danger', text: 'Clear all results', onclick: function () { if (confirm('Remove all results from this browser?')) { lsSet(LS.results, []); teacherResults(); } } }),
      ]) : null,
      el('p', { class: 'muted small', text: 'Results are saved only in this browser. Download the CSV to keep a copy.' }),
    ]);
  }

  function toCsv(rows) {
    function c(v) { v = String(v == null ? '' : v); if (/^[=+\-@\t\r]/.test(v)) v = "'" + v; return '"' + v.replace(/"/g, '""') + '"'; } // blocks spreadsheet formula injection
    var out = [['Student', 'Homework', 'Score', 'Max', 'Mistakes', 'Seconds', 'Finished'].map(c).join(',')];
    rows.forEach(function (r) { out.push([r.student, r.homework, r.score, r.maxScore, r.mistakes.length, r.seconds, r.finishedAt].map(c).join(',')); });
    return out.join('\n');
  }

  function resultDetail(r) {
    screen([
      el('button', { class: 'btn ghost', text: '← Back to results', onclick: function () { teacherHome('results'); } }),
      el('h1', { text: r.student + ': ' + r.homework }),
      el('p', { text: (r.maxScore ? 'Score ' + r.score + ' / ' + r.maxScore + ' · ' : '') + 'Time ' + fmtTime(r.seconds) + ' · ' + r.answered + ' answers' }),
      r.manualFinish ? el('p', { class: 'muted small', text: 'The student pressed "I am finished" (the game did not report a final score).' }) : null,
      r.reflection ? el('blockquote', { text: r.reflection }) : null,
      el('h2', { text: 'Mistakes (' + r.mistakes.length + ')' }),
      r.mistakes.length ? el('ul', { class: 'mistakes' }, r.mistakes.map(function (m) {
        return el('li', null, [
          el('strong', { text: m.questionText || m.questionId }),
          el('div', { text: 'Answered: ' + (m.userAnswer || '—') + '  ·  Correct: ' + (m.correctAnswer || '—') }),
          m.explanation ? el('div', { class: 'muted small', text: m.explanation }) : null,
        ]);
      })) : el('p', { class: 'muted', text: 'No mistakes recorded.' }),
    ]);
  }

  // ---------- start ----------
  document.addEventListener('DOMContentLoaded', function () {
    if (CFG.schoolName) { $('#brand-name').textContent = clip(CFG.schoolName, 60); document.title = clip(CFG.schoolName, 60); }
    if (isTeacher) teacherHome('upload'); else studentHome();
  });
})();
