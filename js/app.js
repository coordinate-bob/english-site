/* 我的英语学习站 —— 全部前端逻辑（原生 JS，无依赖） */
(function () {
  'use strict';

  var PREFIX = 'eng-';
  var DAY = 24 * 3600 * 1000;
  // 艾宾浩斯记忆阶段 0–5 对应的复习间隔（天）：0→1天，1→2天，2→4天，3→7天，4→15天，5→30天
  var INTERVALS = [1, 2, 4, 7, 15, 30];
  var MAX_STAGE = 5; // 第 5 关（30 天）再答对即毕业（stage 6），不再进复习队列
  var NEW_PER_DAY = 20;

  /* ---------- storage 帮助函数（统一加前缀，读取防 JSON 损坏） ---------- */
  function read(key, fallback) {
    try {
      var raw = localStorage.getItem(PREFIX + key);
      return raw === null ? fallback : JSON.parse(raw);
    } catch (e) {
      return fallback;
    }
  }
  function write(key, value) {
    try { localStorage.setItem(PREFIX + key, JSON.stringify(value)); } catch (e) {}
  }
  function removeKey(key) {
    try { localStorage.removeItem(PREFIX + key); } catch (e) {}
  }

  /* ---------- 日期工具 ---------- */
  function dateKey(d) {
    var m = String(d.getMonth() + 1).padStart(2, '0');
    var day = String(d.getDate()).padStart(2, '0');
    return d.getFullYear() + '-' + m + '-' + day;
  }
  function dayOfYear(d) {
    // 两个日期都归一到零点再算差，避免夏令时切换导致差 23/25 小时而少算一天
    var a = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    var b = new Date(d.getFullYear(), 0, 1);
    return Math.round((a - b) / DAY) + 1;
  }
  function formatDate(d) {
    return (d.getMonth() + 1) + '月' + d.getDate() + '日';
  }
  function todayKey() { return dateKey(new Date()); }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* ---------- 数据（词表按需加载，单文件失败不拖垮整站） ---------- */
  var WORDS = { cet4: [], cet6: [] };
  var wordsLoaded = { cet4: false, cet6: false };
  var wordsFailed = { cet4: false, cet6: false };
  var wordsLoading = { cet4: null, cet6: null };
  var LISTENING = [];
  var listeningFailed = false;
  var RESOURCES = [];
  var resourcesFailed = false;

  function loadJson(url) {
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
  }

  function ensureWords(lib) {
    if (wordsLoaded[lib]) return Promise.resolve(true);
    if (wordsFailed[lib]) return Promise.resolve(false);
    if (!wordsLoading[lib]) {
      wordsLoading[lib] = loadJson('data/' + lib + '.json')
        .then(function (d) {
          WORDS[lib] = d;
          wordsLoaded[lib] = true;
          return true;
        })
        .catch(function () {
          wordsFailed[lib] = true;
          return false;
        });
    }
    return wordsLoading[lib];
  }

  /* ================= 模块 A：背单词 ================= */
  var currentLib = read('current-lib', 'cet4');
  var session = null; // 当日会话，持久化到 eng-session-<lib>

  function getProgress(lib) {
    var p = read('words-' + lib, {});
    // 旧版数据迁移：familiarity(0–3) → stage；旧「已掌握」(3) 直接毕业，尊重已有学习成果
    var changed = false;
    Object.keys(p).forEach(function (w) {
      if (!p[w] || typeof p[w] !== 'object') {
        p[w] = { stage: 0, due: Date.now(), seenAt: todayKey() };
        changed = true;
        return;
      }
      if (p[w].stage === undefined) {
        p[w].stage = (p[w].familiarity || 0) >= 3 ? MAX_STAGE + 1 : (p[w].familiarity || 0);
        delete p[w].familiarity;
        changed = true;
      }
    });
    if (changed) write('words-' + lib, p);
    return p;
  }
  function getNewQueue(lib) {
    var saved = read('newqueue-' + lib, null);
    if (saved && saved.length) return saved;
    // 新词队列：全部未学词的索引，Fisher-Yates 打乱后一次性持久化
    var progress = getProgress(lib);
    var idxs = [];
    for (var i = 0; i < WORDS[lib].length; i++) {
      if (!progress[WORDS[lib][i].word]) idxs.push(i);
    }
    for (var j = idxs.length - 1; j > 0; j--) {
      var k = Math.floor(Math.random() * (j + 1));
      var t = idxs[j]; idxs[j] = idxs[k]; idxs[k] = t;
    }
    write('newqueue-' + lib, idxs);
    return idxs;
  }

  function saveSession() {
    if (session) write('session-' + session.lib, session);
  }

  function buildSession(lib) {
    // 同一天内刷新：恢复已持久化的当日会话（含已完成进度），防止刷新刷出新一批 20 词
    var saved = read('session-' + lib, null);
    if (saved && saved.date === todayKey() && Array.isArray(saved.items)) {
      session = saved;
      // 兼容旧版会话结构：补阶段字段（learn 学词 / spell 拼写巩固）
      session.phase = session.phase || 'learn';
      session.spellQueue = session.spellQueue || [];
      session.spellPos = session.spellPos || 0;
      return;
    }

    var now = Date.now();
    var progress = getProgress(lib);
    var queue = getNewQueue(lib);
    var items = [];

    // 到期复习词：due 已到且未掌握的，按到期时间先后排
    Object.keys(progress).forEach(function (w) {
      var e = progress[w];
      if (e.due <= now && e.stage <= MAX_STAGE) items.push({ type: 'review', word: w });
    });
    items.sort(function (a, b) { return progress[a.word].due - progress[b.word].due; });

    // 今日新词：最多 NEW_PER_DAY 个（队列首部的索引；展示时才真正出队并标记 seen）
    var news = queue.slice(0, NEW_PER_DAY).map(function (i) {
      return { type: 'new', index: i, word: WORDS[lib][i].word };
    });
    session = { date: todayKey(), lib: lib, items: items.concat(news), idx: 0, done: 0, total: items.length + news.length, phase: 'learn', spellQueue: [], spellPos: 0 };
    saveSession();
  }

  function currentItem() {
    if (!session || session.idx >= session.items.length) return null;
    return session.items[session.idx];
  }

  function showCurrentWord() {
    var item = currentItem();
    var doneCard = document.getElementById('done-card');
    var card = document.getElementById('word-card');
    if (!item) {
      if (session && session.phase === 'learn') { enterSpellPhase(); return; }
      showDone();
      return;
    }
    card.classList.remove('hidden');
    doneCard.classList.add('hidden');
    document.getElementById('spell-card').classList.add('hidden');

    var word = WORDS[session.lib].find(function (w) { return w.word === item.word; });
    document.getElementById('word-text').textContent = word.word;
    document.getElementById('word-phonetic').textContent = word.phonetic ? '/' + word.phonetic + '/' : '';
    document.getElementById('word-pos').textContent = word.pos || '';
    var meaningEl = document.getElementById('word-meaning');
    meaningEl.textContent = word.meaning;
    meaningEl.classList.add('hidden');
    document.getElementById('show-meaning-btn').classList.remove('hidden');

    var hint = document.getElementById('word-due-hint');
    if (item.type === 'review') {
      var entry = getProgress(session.lib)[item.word];
      hint.textContent = '🔁 今日复习（记忆阶段 ' + entry.stage + '/6）';
    } else {
      hint.textContent = '🆕 今日新词';
      markAsSeen(item);
    }
    updateTaskUI();
  }

  // 新词首次展示即记为 seen，移出新词队列，并安排次日复习
  function markAsSeen(item) {
    var progress = getProgress(session.lib);
    if (progress[item.word]) return;
    progress[item.word] = { stage: 0, due: Date.now() + INTERVALS[0] * DAY, seenAt: todayKey() };
    write('words-' + session.lib, progress);

    var queue = getNewQueue(session.lib);
    var pos = queue.indexOf(item.index);
    if (pos !== -1) queue.splice(pos, 1);
    write('newqueue-' + session.lib, queue);
  }

  // result: 'know' 进入下一记忆阶段按新间隔排期，第 5 关答对即毕业；'vague' 阶段不变、明天复习；'unknow' 退回第 0 关、明天复习
  function answer(result) {
    var item = currentItem();
    if (!item) return;
    var progress = getProgress(session.lib);
    var e = progress[item.word];
    if (e) {
      if (result === 'know') {
        if (e.stage >= MAX_STAGE) { e.stage = MAX_STAGE + 1; e.due = null; } // 毕业
        else { e.stage += 1; e.due = Date.now() + INTERVALS[e.stage] * DAY; }
      } else if (result === 'vague') {
        e.due = Date.now() + INTERVALS[0] * DAY;
      } else {
        e.stage = 0;
        e.due = Date.now() + INTERVALS[0] * DAY;
      }
      write('words-' + session.lib, progress);
    }
    // 认识/模糊的词进入拼写巩固队列；不认识的词不考拼写，按原逻辑明天复习
    if (result !== 'unknow') session.spellQueue.push(item.word);
    bumpDailyCount();
    session.idx++;
    session.done++;
    saveSession();
    updateTaskUI();
    showCurrentWord();
  }

  /* ---------- 阶段二：拼写巩固 ---------- */
  function enterSpellPhase() {
    session.phase = 'spell';
    session.spellPos = 0;
    saveSession();
    if (!session.spellQueue.length) { showDone(); return; }
    renderSpell();
  }

  function showDone() {
    document.getElementById('word-card').classList.add('hidden');
    document.getElementById('spell-card').classList.add('hidden');
    document.getElementById('done-card').classList.remove('hidden');
    // 只有真的经历了拼写巩固才说「全部拼写正确」（全部不认识/空闲日等场景不适用）
    document.getElementById('done-title').textContent =
      (session && session.spellQueue && session.spellQueue.length > 0)
        ? '今日任务已完成！今天的单词全部拼写正确。'
        : '今日任务已完成！';
    updateTaskUI();
  }

  function renderSpell() {
    if (!session || session.phase !== 'spell') return; // 防 1.8 秒停顿期间用户切词库/重置后的过期渲染
    if (session.spellPos >= session.spellQueue.length) { showDone(); return; }
    var wordCard = document.getElementById('word-card');
    var card = document.getElementById('spell-card');
    wordCard.classList.add('hidden');
    document.getElementById('done-card').classList.add('hidden');
    card.classList.remove('hidden');

    var word = session.spellQueue[session.spellPos];
    var meta = WORDS[session.lib].find(function (w) { return w.word === word; });
    document.getElementById('spell-phonetic').textContent = meta && meta.phonetic ? '/' + meta.phonetic + '/' : '';
    document.getElementById('spell-pos').textContent = meta && meta.pos ? meta.pos : '';
    document.getElementById('spell-meaning').textContent = meta ? meta.meaning : '（词表中未找到该词）';
    var input = document.getElementById('spell-input');
    input.value = '';
    input.disabled = false;
    document.getElementById('spell-submit-btn').disabled = false;
    document.getElementById('spell-feedback').textContent = '';
    var miss = (session.spellMisses && session.spellMisses[word]) || 0;
    document.getElementById('spell-due-hint').textContent = miss ? '这个词已拼错 ' + miss + ' 次，加油！' : '';
    updateTaskUI();
    input.focus();
  }

  function submitSpell() {
    if (!session || session.phase !== 'spell') return;
    if (session.spellPos >= session.spellQueue.length) return;
    var input = document.getElementById('spell-input');
    var value = input.value.trim().toLowerCase();
    if (!value) return;
    var word = session.spellQueue[session.spellPos];

    if (value === word.toLowerCase()) {
      bumpDailyCount();
      session.spellPos++;
      saveSession();
      renderSpell();
    } else {
      // 拼错：显示正确拼写，并把该词排到队尾，之后重考
      session.spellMisses = session.spellMisses || {};
      session.spellMisses[word] = (session.spellMisses[word] || 0) + 1;
      session.spellQueue.push(word);
      session.spellPos++;
      bumpDailyCount();
      saveSession();
      document.getElementById('spell-feedback').innerHTML =
        '❌ 正确拼写：<strong>' + escapeHtml(word) + '</strong>，这个词稍后会再考你';
      input.value = '';
      input.disabled = true;
      document.getElementById('spell-submit-btn').disabled = true;
      updateTaskUI();
      // 1.8 秒后自动进下一题；回调前校验会话仍是同一个拼写阶段，防切换词库/重置后误渲染
      var libAtMiss = session.lib;
      setTimeout(function () {
        if (session && session.phase === 'spell' && session.lib === libAtMiss) renderSpell();
      }, 1800);
    }
  }

  function bumpDailyCount() {
    var counts = read('daily-counts', {});
    var k = todayKey();
    counts[k] = (counts[k] || 0) + 1;
    write('daily-counts', counts);
  }

  function updateTaskUI() {
    var fill = document.getElementById('task-fill');
    var count = document.getElementById('task-count');
    var label = document.getElementById('task-label');
    if (!session) return;
    var libLabel = session.lib === 'cet4' ? '四级' : '六级';
    if (session.phase === 'spell') {
      var n = session.spellQueue.length;
      label.textContent = '拼写巩固（' + libLabel + '）';
      count.textContent = n ? '已拼 ' + Math.min(session.spellPos, n) + ' / ' + n + '（含重考）' : '';
      fill.style.width = n ? Math.round(Math.min(session.spellPos, n) / n * 100) + '%' : '100%';
    } else if (session.total === 0) {
      label.textContent = '今日任务';
      count.textContent = '暂无到期复习，新词已全部学完 🎓';
      fill.style.width = '100%';
    } else {
      label.textContent = '今日任务（' + libLabel + '）';
      count.textContent = '已完成 ' + session.done + ' / ' + session.total;
      fill.style.width = Math.round(session.done / session.total * 100) + '%';
    }
    var progress = getProgress(session.lib);
    document.getElementById('lib-progress-text').textContent =
      '已学 ' + Object.keys(progress).length + ' / ' + WORDS[session.lib].length + ' 词';
  }

  function renderWordsTab() {
    var lib = currentLib;
    document.getElementById('lib-select').value = lib;
    document.getElementById('words-error').classList.add('hidden');
    document.getElementById('word-card').classList.add('hidden');
    document.getElementById('done-card').classList.add('hidden');
    document.getElementById('task-label').textContent = '词表加载中…';
    document.getElementById('task-count').textContent = '';

    ensureWords(lib).then(function (ok) {
      if (currentLib !== lib) return; // 加载期间用户切走了词库
      if (!ok) {
        document.getElementById('task-label').textContent = '今日任务';
        var err = document.getElementById('words-error');
        err.innerHTML = '四级/六级词表（data/' + lib + '.json）加载失败。请确认通过本地服务器访问（<code>python3 -m http.server 8000</code> 后打开 http://localhost:8000），然后切换词库或刷新重试。';
        err.classList.remove('hidden');
        return;
      }
      if (!session || session.lib !== lib) buildSession(lib);
      updateTaskUI();
      if (session.phase === 'spell') renderSpell(); else showCurrentWord();
    });
  }

  function speakWord() {
    if (!('speechSynthesis' in window)) return;
    var text = document.getElementById('word-text').textContent;
    window.speechSynthesis.cancel();
    var u = new SpeechSynthesisUtterance(text);
    u.lang = 'en-US';
    u.rate = 0.9;
    window.speechSynthesis.speak(u);
  }

  /* ================= 模块 B：每日听力 ================= */
  function getCheckins() { return read('listening-checkins', {}); }

  // 今日推荐：今年第几天 % 总数
  function listeningIndex(date) {
    return (dayOfYear(date) - 1) % LISTENING.length;
  }

  function calcStreak() {
    var checkins = getCheckins();
    var d = new Date();
    if (!checkins[dateKey(d)]) d = new Date(d.getTime() - DAY); // 今天没打则从昨天往前数
    var streak = 0;
    while (checkins[dateKey(d)]) {
      streak++;
      d = new Date(d.getTime() - DAY);
    }
    return streak;
  }

  function renderListening() {
    var box = document.getElementById('today-listening');
    var weekList = document.getElementById('week-list');

    if (listeningFailed) {
      box.innerHTML = '<p class="muted">听力清单（data/listening.json）加载失败，请刷新重试。</p>';
      weekList.innerHTML = '';
      return;
    }
    if (!LISTENING.length) {
      box.innerHTML = '<p class="muted">听力清单加载中…</p>';
      weekList.innerHTML = '';
      return;
    }

    var checkins = getCheckins();
    var today = new Date();
    var todayItem = LISTENING[listeningIndex(today)];
    var checked = !!checkins[dateKey(today)];

    box.innerHTML =
      '<div class="today-item">' +
      '  <span class="badge">' + escapeHtml(todayItem.level) + ' · 约 ' + todayItem.minutes + ' 分钟 · ' + escapeHtml(todayItem.source) + '</span>' +
      '  <h3>今日推荐：' + escapeHtml(todayItem.title) + '</h3>' +
      '  <div class="today-actions">' +
      '    <a class="link-btn" href="' + escapeHtml(todayItem.url) + '" target="_blank" rel="noopener">去收听 ↗</a>' +
      '    <button id="checkin-btn" class="btn"' + (checked ? ' disabled' : '') + '>' +
      (checked ? '✔ 今日已打卡' : '🎧 今日已听打卡') + '</button>' +
      '  </div>' +
      '  <p class="streak-text">🔥 连续打卡 <strong>' + calcStreak() + '</strong> 天</p>' +
      '</div>';

    var btn = document.getElementById('checkin-btn');
    if (!checked) {
      btn.addEventListener('click', function () {
        var c = getCheckins();
        c[dateKey(new Date())] = true;
        write('listening-checkins', c);
        renderListening();
      });
    }

    weekList.innerHTML = '';
    for (var i = 0; i < 7; i++) {
      var d = new Date(today.getTime() + i * DAY);
      var it = LISTENING[listeningIndex(d)];
      var li = document.createElement('li');
      if (i === 0) li.className = 'week-today';
      li.innerHTML = '<span class="week-date">' + formatDate(d) + (i === 0 ? ' 今天' : '') + '</span>' +
        '<a class="week-title" href="' + escapeHtml(it.url) + '" target="_blank" rel="noopener">' + escapeHtml(it.title) + '</a>';
      weekList.appendChild(li);
    }
  }

  /* ================= 模块 C：资源导航 ================= */
  function renderResources() {
    var grid = document.getElementById('resource-grid');
    if (resourcesFailed) {
      grid.innerHTML = '<div class="card"><p class="muted">资源导航（data/resources.json）加载失败，请刷新重试。</p></div>';
      return;
    }
    if (!RESOURCES.length) return; // 加载中，暂不渲染
    grid.innerHTML = '';
    RESOURCES.forEach(function (cat) {
      var card = document.createElement('div');
      card.className = 'card resource-card';
      var lis = cat.items.map(function (it) {
        return '<li><a href="' + escapeHtml(it.url) + '" target="_blank" rel="noopener">' + escapeHtml(it.name) + ' ↗</a>' +
               '<p>' + escapeHtml(it.desc) + '</p></li>';
      }).join('');
      card.innerHTML = '<h2>' + escapeHtml(cat.category) + '</h2><ul>' + lis + '</ul>';
      grid.appendChild(card);
    });
  }

  /* ================= 模块 D：我的统计 ================= */
  function dayLevel(n) {
    if (n <= 0) return 0;
    if (n < 5) return 1;
    if (n < 10) return 2;
    if (n < 20) return 3;
    return 4;
  }

  function effectiveCount(counts, checkins, key) {
    return (counts[key] || 0) + (checkins[key] ? 10 : 0);
  }

  function renderPlan() {
    var el = document.getElementById('review-plan');
    if (!el) return;
    var now = Date.now();
    var today = todayKey();
    var buckets = {};
    var graduated = 0;
    ['cet4', 'cet6'].forEach(function (lib) {
      var progress = getProgress(lib);
      Object.keys(progress).forEach(function (w) {
        var e = progress[w];
        if (e.stage > MAX_STAGE) { graduated++; return; } // 毕业词不再复习
        var d = e.due <= now ? today : dateKey(new Date(e.due));
        buckets[d] = (buckets[d] || 0) + 1;
      });
    });

    var days = [];
    for (var i = 0; i < 7; i++) days.push(dateKey(new Date(now + i * DAY)));
    var max = 1;
    days.forEach(function (d) { if (buckets[d] > max) max = buckets[d]; });
    var total7 = days.reduce(function (s, d) { return s + (buckets[d] || 0); }, 0);

    el.innerHTML = days.map(function (d, i) {
      var n = buckets[d] || 0;
      var label = i === 0 ? '今天' : (i === 1 ? '明天' : formatDayLabel(d));
      return '<div class="plan-row">' +
        '<span class="plan-label">' + escapeHtml(label) + '</span>' +
        '<div class="plan-bar"><div class="plan-fill' + (i === 0 && n > 0 ? ' today' : '') + '" style="width:' + Math.round(n / max * 100) + '%"></div></div>' +
        '<span class="plan-num">' + n + ' 词</span>' +
        '</div>';
    }).join('') +
    '<p class="muted small">未来 7 天共复习 ' + total7 + ' 词次 · 已毕业 ' + graduated + ' 词 🎓</p>';
  }

  function renderStats() {
    var counts = read('daily-counts', {});
    var checkins = getCheckins();

    // 汇总：两库合计（未加载成功的词库按 0 计）
    var total = WORDS.cet4.length + WORDS.cet6.length;
    var seen = 0, mastered = 0;
    ['cet4', 'cet6'].forEach(function (lib) {
      var progress = getProgress(lib);
      Object.keys(progress).forEach(function (w) {
        seen++;
        if (progress[w].stage > MAX_STAGE) mastered++;
      });
    });
    var learnDays = {};
    Object.keys(counts).forEach(function (k) { if (counts[k] > 0) learnDays[k] = true; });
    Object.keys(checkins).forEach(function (k) { if (checkins[k]) learnDays[k] = true; });

    var summary = [
      { num: total, label: '总词条数' },
      { num: seen, label: '已学词数' },
      { num: mastered, label: '已掌握（毕业 🎓）' },
      { num: calcStreak(), label: '连续打卡天数' },
      { num: Object.keys(learnDays).length, label: '累计学习天数' }
    ];
    document.getElementById('stats-summary').innerHTML = summary.map(function (s) {
      return '<div class="stat-box"><div class="num">' + s.num + '</div><div class="label">' + escapeHtml(s.label) + '</div></div>';
    }).join('');

    // 热力图：最近 53 周（周一起始，对齐 GitHub 贡献图）
    var heatmap = document.getElementById('heatmap');
    heatmap.innerHTML = '';
    var today = new Date();
    today.setHours(0, 0, 0, 0);
    var monday = new Date(today.getTime() - ((today.getDay() + 6) % 7) * DAY);
    var start = new Date(monday.getTime() - 52 * 7 * DAY);
    for (var w = 0; w < 53; w++) {
      for (var r = 0; r < 7; r++) {
        var d = new Date(start.getTime() + (w * 7 + r) * DAY);
        var cell = document.createElement('div');
        cell.className = 'cell';
        if (d > today) continue; // 本周剩余天数留空
        var n = effectiveCount(counts, checkins, dateKey(d));
        cell.classList.add('level-' + dayLevel(n));
        cell.title = dateKey(d) + '：学习量 ' + n;
        heatmap.appendChild(cell);
      }
    }

    renderLearned();
    renderPlan();
  }

  /* ---------- 已学单词列表（统计页，按天折叠分组） ---------- */
  var learnedOpen = {}; // 各天展开状态；未记录的默认只有最新一天展开
  var learnedGroupsCache = []; // 当前渲染的分组数据，展开时懒加载行

  function collectLearned() {
    var entries = [];
    ['cet4', 'cet6'].forEach(function (lib) {
      var progress = getProgress(lib);
      var libWords = {};
      WORDS[lib].forEach(function (w) { libWords[w.word] = w; });
      Object.keys(progress).forEach(function (word) {
        var meta = libWords[word] || { word: word, phonetic: '', pos: '', meaning: '' };
        entries.push({
          lib: lib,
          word: meta.word,
          phonetic: meta.phonetic,
          pos: meta.pos,
          meaning: meta.meaning,
          familiarity: progress[word].stage || 0,
          seenAt: progress[word].seenAt || ''
        });
      });
    });
    // 熟悉度低的排前面（最需要巩固的词在最上面）
    entries.sort(function (a, b) {
      if (a.familiarity !== b.familiarity) return a.familiarity - b.familiarity;
      return a.word < b.word ? -1 : 1;
    });
    return entries;
  }

  function learnedRowHtml(e) {
    var dots = '';
    for (var i = 0; i <= MAX_STAGE; i++) dots += i < e.familiarity ? '●' : '○';
    var stageText = e.familiarity > MAX_STAGE ? '已毕业 🎓' : '记忆阶段 ' + e.familiarity + '/' + (MAX_STAGE + 1);
    return '<div class="learned-row">' +
      '<span class="learned-word">' + escapeHtml(e.word) + '</span>' +
      '<span class="learned-phonetic">' + (e.phonetic ? escapeHtml('/' + e.phonetic + '/') : '') + '</span>' +
      '<span class="learned-pos">' + escapeHtml(e.pos) + '</span>' +
      '<span class="learned-fam" title="' + stageText + '">' + dots + '</span>' +
      '<span class="lib-badge lib-' + e.lib + '">' + (e.lib === 'cet4' ? '四级' : '六级') + '</span>' +
      '<span class="learned-meaning">' + escapeHtml(e.meaning) + '</span>' +
      '</div>';
  }

  function formatDayLabel(day) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return day || '未知日期';
    return parseInt(day.slice(5, 7), 10) + '月' + parseInt(day.slice(8, 10), 10) + '日';
  }

  function groupByDay(entries) {
    var map = {}, days = [];
    entries.forEach(function (e) {
      var d = e.seenAt || '未知日期';
      if (!map[d]) { map[d] = []; days.push(d); }
      map[d].push(e);
    });
    // 真实日期倒序（最新在前），「未知日期」排最后
    days.sort(function (a, b) {
      var ra = /^\d{4}-/.test(a), rb = /^\d{4}-/.test(b);
      if (ra && rb) return a < b ? 1 : -1;
      return ra ? -1 : 1;
    });
    return days.map(function (d) { return { day: d, entries: map[d] }; });
  }

  function dayGroupHtml(g, isFirst) {
    var open = learnedOpen[g.day] !== undefined ? learnedOpen[g.day] : isFirst;
    return '<div class="day-group" data-day="' + escapeHtml(g.day) + '">' +
      '<button class="day-header">' +
      '<span class="day-caret">' + (open ? '▾' : '▸') + '</span>' +
      '<span class="day-title">📅 ' + escapeHtml(formatDayLabel(g.day)) + '</span>' +
      '<span class="day-count muted">' + g.entries.length + ' 词</span>' +
      '</button>' +
      '<div class="day-body' + (open ? '' : ' hidden') + '">' +
      (open ? g.entries.map(learnedRowHtml).join('') : '') +
      '</div>' +
      '</div>';
  }

  function renderLearned() {
    var listEl = document.getElementById('learned-list');
    var countEl = document.getElementById('learned-count');
    if (!listEl) return;
    var filter = document.getElementById('learned-filter').value;
    var all = collectLearned().filter(function (e) { return filter === 'all' || e.lib === filter; });
    var failed = [];
    if (wordsFailed.cet4) failed.push('四级');
    if (wordsFailed.cet6) failed.push('六级');
    var warn = failed.length
      ? '<p class="muted small">⚠️ ' + failed.join('、') + '词表加载失败，对应单词的释义暂时无法显示，请刷新重试。</p>'
      : '';
    if (!all.length) {
      learnedGroupsCache = [];
      countEl.textContent = '';
      listEl.innerHTML = warn + '<p class="muted">还没有已学单词，先去「背单词」学几个吧。</p>';
      return;
    }
    learnedGroupsCache = groupByDay(all);
    countEl.textContent = '共 ' + all.length + ' 词 · ' + learnedGroupsCache.length + ' 天 · 点击日期可折叠/展开';
    listEl.innerHTML = warn + learnedGroupsCache.map(function (g, i) { return dayGroupHtml(g, i === 0); }).join('');
  }

  // 折叠/展开：事件委托，展开时按需渲染该天单词
  function onLearnedListClick(e) {
    var header = e.target.closest('.day-header');
    if (!header) return;
    var groupEl = header.parentElement;
    var body = groupEl.querySelector('.day-body');
    var day = groupEl.dataset.day;
    var isOpen = !body.classList.contains('hidden');
    learnedOpen[day] = !isOpen; // 记录切换后的展开状态，筛选/刷新后保持
    if (isOpen) {
      body.classList.add('hidden');
      body.innerHTML = ''; // 收起时释放行节点
    } else {
      if (!body.innerHTML) {
        var g = learnedGroupsCache.find(function (x) { return x.day === day; });
        if (g) body.innerHTML = g.entries.map(learnedRowHtml).join('');
      }
      body.classList.remove('hidden');
    }
    header.querySelector('.day-caret').textContent = isOpen ? '▸' : '▾';
  }

  /* ================= Tab 切换 ================= */
  function switchTab(name) {
    document.querySelectorAll('.tab-btn').forEach(function (b) {
      b.classList.toggle('active', b.dataset.tab === name);
    });
    document.querySelectorAll('.tab-panel').forEach(function (p) {
      p.classList.toggle('active', p.id === 'tab-' + name);
    });
    if (name === 'words') renderWordsTab();
    else if (name === 'listening') renderListening();
    else if (name === 'stats') {
      // 统计需要两个词表的总词条数，按需加载后刷新一次汇总
      Promise.all([ensureWords('cet4'), ensureWords('cet6')]).then(function () {
        renderStats();
      });
      renderStats();
    }
  }

  /* ================= 事件绑定与初始化 ================= */
  function bindEvents() {
    document.getElementById('tab-nav').addEventListener('click', function (e) {
      var btn = e.target.closest('.tab-btn');
      if (btn) switchTab(btn.dataset.tab);
    });

    document.getElementById('lib-select').addEventListener('change', function (e) {
      currentLib = e.target.value;
      write('current-lib', currentLib);
      renderWordsTab();
    });

    document.getElementById('show-meaning-btn').addEventListener('click', function () {
      document.getElementById('word-meaning').classList.remove('hidden');
      this.classList.add('hidden');
    });
    document.getElementById('speak-btn').addEventListener('click', speakWord);
    document.getElementById('know-btn').addEventListener('click', function () { answer('know'); });
    document.getElementById('vague-btn').addEventListener('click', function () { answer('vague'); });
    document.getElementById('unknow-btn').addEventListener('click', function () { answer('unknow'); });

    document.getElementById('spell-submit-btn').addEventListener('click', submitSpell);
    document.getElementById('spell-input').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') submitSpell();
    });

    document.getElementById('reset-btn').addEventListener('click', function () {
      var lib = currentLib;
      var label = lib === 'cet4' ? '四级' : '六级';
      if (confirm('确定要清空' + label + '词库的全部学习进度吗？此操作不可恢复。')) {
        removeKey('words-' + lib);
        removeKey('newqueue-' + lib);
        removeKey('session-' + lib);
        session = null;
        renderWordsTab();
      }
    });

    document.getElementById('learned-filter').addEventListener('change', renderLearned);
    document.getElementById('learned-list').addEventListener('click', onLearnedListClick);
  }

  function init() {
    bindEvents();
    // 启动只加载小文件；词表按当前词库选择按需加载
    loadJson('data/listening.json').then(function (d) {
      LISTENING = d;
      renderListening();
    }).catch(function () {
      listeningFailed = true;
      renderListening();
    });
    loadJson('data/resources.json').then(function (d) {
      RESOURCES = d;
      renderResources();
    }).catch(function () {
      resourcesFailed = true;
      renderResources();
    });
    renderWordsTab();
  }

  init();
})();
