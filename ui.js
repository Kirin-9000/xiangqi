/* ==========================================================================
 * 揭棋 —— 界面与交互
 * 单人双控：不锁定阵营，谁行棋就操作谁，还可自动翻转棋盘视角
 * ========================================================================== */
(function () {
  'use strict';

  var XQ = window.XQ;
  var PAD = 60, S = 100, VBW = 920, VBH = 1020;   // 与 SVG viewBox 一致
  var SET_KEY = 'jieqi.settings.v1';
  var GAME_KEY = 'jieqi.game.v1';

  var el = function (id) { return document.getElementById(id); };
  var boardEl = el('board'), gridEl = el('grid');
  var piecesLayer = el('piecesLayer'), marksEl = el('marksLayer');

  var state = null;
  var selected = null;          // {r,c}
  var legal = null;             // {flips, moves}
  var pieceEls = new Map();
  var ui = { flipped: false, autoFlip: false, hints: true, longRules: true };
  var toastTimer = null;
  var flashId = null;          // 刚翻开的棋子（只闪一次）

  /* ------------------------------ 设置存取 ------------------------------ */

  function loadSettings() {
    try {
      var s = JSON.parse(localStorage.getItem(SET_KEY) || '{}');
      if (typeof s.autoFlip === 'boolean') ui.autoFlip = s.autoFlip;
      if (typeof s.hints === 'boolean') ui.hints = s.hints;
      if (typeof s.longRules === 'boolean') ui.longRules = s.longRules;
      if (typeof s.flipped === 'boolean') ui.flipped = s.flipped;
    } catch (e) { /* 忽略损坏的本地数据 */ }
  }

  function saveSettings() {
    try { localStorage.setItem(SET_KEY, JSON.stringify(ui)); } catch (e) { }
  }

  var HISTORY_KEEP = 30;        // 存档时保留的撤销步数

  function saveGame() {
    try {
      if (!state) return;
      var h = state.history;
      state.history = [];                       // 避免重复序列化整段历史
      var payload = {
        state: JSON.parse(XQ.serialize(state)),
        history: h.slice(-HISTORY_KEEP),
        flipped: ui.flipped
      };
      state.history = h;
      localStorage.setItem(GAME_KEY, JSON.stringify(payload));
    } catch (e) { }
  }

  function loadGame() {
    try {
      var raw = localStorage.getItem(GAME_KEY);
      if (!raw) return null;
      var obj = JSON.parse(raw);
      var st = XQ.deserialize(obj.state);
      if (!st) return null;
      st.history = Array.isArray(obj.history) ? obj.history : [];
      if (typeof obj.flipped === 'boolean') ui.flipped = obj.flipped;
      return st;
    } catch (e) { return null; }
  }

  /* ------------------------------ 棋盘绘制 ------------------------------ */

  function buildGrid() {
    var W = VBW, H = VBH;
    // 注意：SVG 表现属性不支持 var()，这里必须用字面颜色
    var LINE = '#6b4a2a';
    var X = function (c) { return PAD + c * S; };
    var Y = function (r) { return PAD + r * S; };
    var line = function (x1, y1, x2, y2, w) {
      return '<line x1="' + x1 + '" y1="' + y1 + '" x2="' + x2 + '" y2="' + y2 +
             '" stroke="' + LINE + '" stroke-width="' + (w || 2.2) + '" stroke-linecap="round"/>';
    };
    var out = [];

    // 外框
    out.push('<rect x="' + (X(0) - 13) + '" y="' + (Y(0) - 13) + '" width="' + (8 * S + 26) +
             '" height="' + (9 * S + 26) + '" rx="8" fill="none" stroke="' + LINE + '" stroke-width="4.5"/>');

    // 横线
    for (var r = 0; r < 10; r++) out.push(line(X(0), Y(r), X(8), Y(r)));
    // 竖线（河界处断开，边线贯通）
    for (var c = 0; c < 9; c++) {
      if (c === 0 || c === 8) out.push(line(X(c), Y(0), X(c), Y(9)));
      else {
        out.push(line(X(c), Y(0), X(c), Y(4)));
        out.push(line(X(c), Y(5), X(c), Y(9)));
      }
    }
    // 九宫斜线
    out.push(line(X(3), Y(0), X(5), Y(2)));
    out.push(line(X(5), Y(0), X(3), Y(2)));
    out.push(line(X(3), Y(7), X(5), Y(9)));
    out.push(line(X(5), Y(7), X(3), Y(9)));

    // 炮位 / 兵位 十字标记
    var MARK_PTS = [[3, 0], [3, 2], [3, 4], [3, 6], [3, 8], [2, 1], [2, 7],
                    [6, 0], [6, 2], [6, 4], [6, 6], [6, 8], [7, 1], [7, 7]];
    var G = 13, L = 26;
    MARK_PTS.forEach(function (pt) {
      var r = pt[0], c = pt[1];
      var x = X(c), y = Y(r), seg = [];
      for (var sx = -1; sx <= 1; sx += 2) {
        for (var sy = -1; sy <= 1; sy += 2) {
          var okX = sx < 0 ? c > 0 : c < 8;
          var okY = sy < 0 ? r > 0 : r < 9;
          if (!okX || !okY) continue;
          seg.push('M' + (x + sx * G) + ' ' + (y + sy * G) + 'h' + (sx * L));
          seg.push('M' + (x + sx * G) + ' ' + (y + sy * G) + 'v' + (sy * L));
        }
      }
      out.push('<path d="' + seg.join(' ') + '" stroke="' + LINE + '" stroke-width="2.2" fill="none" stroke-linecap="round"/>');
    });

    // 楚河汉界
    out.push('<text x="' + (W / 2 - 118) + '" y="' + (Y(4) + S / 2 + 13) +
             '" font-size="40" fill="' + LINE + '" opacity=".7" letter-spacing="14" text-anchor="middle" font-family="KaiTi,STKaiti,serif">楚河</text>');
    out.push('<text x="' + (W / 2 + 118) + '" y="' + (Y(4) + S / 2 + 13) +
             '" font-size="40" fill="' + LINE + '" opacity=".7" letter-spacing="14" text-anchor="middle" font-family="KaiTi,STKaiti,serif">汉界</text>');

    gridEl.innerHTML = out.join('');
  }

  function layout() {
    var area = el('boardArea');
    var w = area.clientWidth - 2, h = area.clientHeight - 2;
    if (w <= 0 || h <= 0) return;
    var size = Math.min(w, h * (VBW / VBH));
    boardEl.style.width = size + 'px';
    boardEl.style.height = (size * VBH / VBW) + 'px';
    boardEl.style.setProperty('--pc-font', (size * 0.062).toFixed(1) + 'px');
  }

  /* ------------------------------ 坐标换算 ------------------------------ */

  function viewCoord(r, c) {
    return ui.flipped ? [9 - r, 8 - c] : [r, c];
  }

  function posPct(r, c) {
    var v = viewCoord(r, c);
    return {
      left: ((PAD + v[1] * S) / VBW * 100).toFixed(4) + '%',
      top: ((PAD + v[0] * S) / VBH * 100).toFixed(4) + '%'
    };
  }

  /* ------------------------------ 渲染 ------------------------------ */

  function refresh() {
    legal = XQ.legalActions(state);
    if (ui.autoFlip) ui.flipped = (state.turn === XQ.BLACK);
    renderPieces();
    renderMarks();
    renderStatus();
    renderSidebar();
    saveGame();
  }

  function renderStatus() {
    var box = el('turnBox'), txt = el('turnText');
    box.classList.toggle('black', state.turn === XQ.BLACK);
    box.classList.toggle('over', state.status === 'over');
    if (state.status === 'over') {
      var res = state.result || {};
      txt.textContent = res.winner ? XQ.colorName(res.winner) + '胜 · ' + res.reason : '和棋 · ' + res.reason;
    } else {
      txt.textContent = XQ.colorName(state.turn) + '行棋';
    }

    var chipCheck = el('chipCheck');
    chipCheck.hidden = !(state.status === 'playing' && state.inCheck);
    chipCheck.classList.toggle('alarm', state.status === 'playing' && state.inCheck);

    var dr = 0, db = 0;
    for (var r = 0; r < XQ.ROWS; r++) {
      for (var c = 0; c < XQ.COLS; c++) {
        var p = state.board[r][c];
        if (p && !p.revealed) { if (p.color === XQ.RED) dr++; else db++; }
      }
    }
    el('chipDark').textContent = '暗子 ' + dr + ' / ' + db;
  }

  function renderPieces() {
    var alive = {};
    var checkG = state.inCheck ? XQ.findGeneral(state.board, state.turn) : null;
    var flipping = flashId;
    flashId = null;

    for (var r = 0; r < XQ.ROWS; r++) {
      for (var c = 0; c < XQ.COLS; c++) {
        var p = state.board[r][c];
        if (!p) continue;
        alive[p.id] = true;

        var e = pieceEls.get(p.id), isNew = false;
        if (!e) {
          e = document.createElement('div');
          e.className = 'piece spawn';
          e.innerHTML = '<div class="card"><div class="face back"></div>' +
                        '<div class="face front"><span class="ch"></span></div></div>';
          pieceEls.set(p.id, e);
          piecesLayer.appendChild(e);
          isNew = true;
        }

        var pos = posPct(r, c);
        e.style.left = pos.left;
        e.style.top = pos.top;
        e.classList.toggle('r', p.color === XQ.RED);
        e.classList.toggle('b', p.color === XQ.BLACK);
        e.classList.toggle('revealed', p.revealed);
        if (p.revealed) e.querySelector('.ch').textContent = XQ.CHAR[p.color][p.type];

        e.classList.toggle('selected', !!(selected && selected.r === r && selected.c === c));
        e.classList.toggle('checked', !!(checkG && checkG.r === r && checkG.c === c));
        e.classList.toggle('hint', !!(ui.hints && !p.revealed && p.color === state.turn &&
                                      legal && legal.flips.some(function (f) { return f.r === r && f.c === c; })));
        e.classList.remove('just-flipped');

        if (isNew) {
          (function (node) {
            requestAnimationFrame(function () {
              requestAnimationFrame(function () { node.classList.remove('spawn'); });
            });
          })(e);
        }
        if (flipping === p.id) {
          (function (node) {
            requestAnimationFrame(function () { node.classList.add('just-flipped'); });
          })(e);
        }
      }
    }

    // 已消失的棋子（被吃）播放淡出
    pieceEls.forEach(function (e, id) {
      if (alive[id]) return;
      pieceEls.delete(id);
      e.classList.add('dead');
      setTimeout(function () { if (e.parentNode) e.parentNode.removeChild(e); }, 320);
    });
  }

  function renderMarks() {
    var html = '';
    var la = state.lastAction;

    // 上一步位置
    if (la && la.from) {
      var a = posPct(la.from.r, la.from.c);
      html += '<div class="mk mk-last" style="left:' + a.left + ';top:' + a.top + '"></div>';
      var b = posPct(la.to.r, la.to.c);
      html += '<div class="mk mk-last" style="left:' + b.left + ';top:' + b.top + '"></div>';
    }

    if (state.status === 'playing' && selected && legal) {
      var sp = posPct(selected.r, selected.c);
      html += '<div class="mk mk-sel" style="left:' + sp.left + ';top:' + sp.top + '"></div>';

      legal.moves.forEach(function (m) {
        if (m.from.r !== selected.r || m.from.c !== selected.c) return;
        var q = posPct(m.to.r, m.to.c);
        if (m.capture) {
          html += '<div class="mk mk-cap" style="left:' + q.left + ';top:' + q.top + '"></div>';
        } else {
          html += '<div class="mk mk-dot" style="left:' + q.left + ';top:' + q.top + '"></div>';
        }
      });
    }
    marksEl.innerHTML = html;
  }

  function renderSidebar() {
    var res = state.result || {};
    el('sTurn').textContent = state.status === 'over'
      ? (res.winner ? XQ.colorName(res.winner) + '胜' : '和棋')
      : XQ.colorName(state.turn);

    var dr = 0, db = 0;
    for (var r = 0; r < XQ.ROWS; r++) {
      for (var c = 0; c < XQ.COLS; c++) {
        var p = state.board[r][c];
        if (p && !p.revealed) { if (p.color === XQ.RED) dr++; else db++; }
      }
    }
    el('sDark').textContent = '红 ' + dr + ' / 黑 ' + db;
    el('sNoCap').textContent = state.noCapturePlies + ' / 120 步';
    el('sRep').textContent = (state.posCounts[XQ.positionKey(state)] || 1) + ' / 5';

    var warns = [];
    if (state.status === 'playing' && state.inCheck) warns.push(XQ.colorName(state.turn) + '被将军');
    if (ui.longRules && state.checkStreak.count > 1) {
      warns.push('连续将军 ' + state.checkStreak.count + ' / 6（超过判负）');
    }
    if (ui.longRules && state.chaseStreak.count > 1) {
      warns.push('连续捉子 ' + state.chaseStreak.count + ' / 6（超过判负）');
    }
    var row = el('sCheckRow');
    row.hidden = warns.length === 0;
    el('sCheck').textContent = warns.join('；') || '—';

    // 被吃棋子
    ['r', 'b'].forEach(function (color) {
      var box = el(color === 'r' ? 'capRed' : 'capBlack');
      var list = state.captured[color] || [];
      if (!list.length) { box.innerHTML = '<span class="log-empty" style="color:var(--txt-dim);font-size:12px">无</span>'; return; }
      box.innerHTML = list.map(function (it) {
        return '<span class="cap ' + (color === 'r' ? 'red' : '') + (it.revealed ? '' : ' dark-piece') + '">' +
               XQ.CHAR[color][it.type] + '</span>';
      }).join('');
    });

    // 棋谱
    var log = state.log.filter(function (e) { return e.kind === 'move' || e.kind === 'flip'; });
    var ol = el('logList');
    if (!log.length) {
      ol.innerHTML = '<li><span class="empty">尚未走子</span></li>';
      return;
    }
    var rows = '';
    for (var i = 0; i < log.length; i += 2) {
      var a = log[i], b = log[i + 1];
      rows += '<li><span class="no">' + (Math.floor(i / 2) + 1) + '.</span>' +
              '<span class="' + a.color + '">' + esc(a.text) + '</span>' +
              '<span class="' + (b ? b.color : '') + '">' + (b ? esc(b.text) : '') + '</span></li>';
    }
    ol.innerHTML = rows;
    ol.scrollTop = ol.scrollHeight;
  }

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (m) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m];
    });
  }

  /* ------------------------------ 交互 ------------------------------ */

  function onTap(r, c) {
    if (state.status !== 'playing') return;
    var p = state.board[r][c];

    if (selected) {
      var mv = legal.moves.filter(function (m) {
        return m.from.r === selected.r && m.from.c === selected.c && m.to.r === r && m.to.c === c;
      })[0];
      if (mv) { act(XQ.doMove(state, selected.r, selected.c, r, c)); return; }
    }

    if (p && p.color === state.turn && p.revealed) {
      selected = (selected && selected.r === r && selected.c === c) ? null : { r: r, c: c };
      renderMarks();
      renderPieces();
      return;
    }

    if (p && p.color === state.turn && !p.revealed) {
      act(XQ.doFlip(state, r, c));
      return;
    }

    if (selected) {
      selected = null;
      renderMarks();
      renderPieces();
    }
  }

  function act(res) {
    if (!res.ok) { toast(res.msg); return; }
    selected = null;
    var la = state.lastAction;
    if (la && la.kind === 'flip') flashId = la.pieceId;

    refresh();

    // 吃暗子时揭晓身份
    if (la && la.kind === 'move' && la.capture && !la.capture.revealed) {
      var capP = la.capture;
      toast((capP.color === la.color ? '吃自家暗子，揭开为「' : '吃暗子，揭开为「') +
            XQ.CHAR[capP.color][capP.type] + '」' + (capP.color === la.color ? '后移除' : ''));
    }

    if (state.status === 'over') {
      setTimeout(showResult, 450);
    } else if (state.inCheck) {
      setTimeout(function () { toast(XQ.colorName(state.turn) + '被将军！'); }, 260);
    }
  }

  function showResult() {
    var res = state.result || {};
    var title = res.winner ? XQ.colorName(res.winner) + '胜' : '和棋';
    var body = '<div class="result-big">' + title + '</div>' +
               '<div class="result-sub">' + esc(res.reason || '') + '　共 ' + state.plies + ' 步</div>';
    openModal('对局结束', body, [
      { label: '再来一局', cls: 'primary', fn: newGame },
      { label: '撤销一步', fn: function () { undo(); } },
      { label: '关闭', cls: 'ghost' }
    ]);
  }

  function newGame() {
    state = XQ.createGame();
    state.options.longRules = ui.longRules;
    selected = null;
    pieceEls.forEach(function (e) { if (e.parentNode) e.parentNode.removeChild(e); });
    pieceEls.clear();
    refresh();
    toast('新对局开始，红先行');
  }

  function undo() {
    if (!state.history.length) { toast('没有可以撤销的步骤'); return; }
    XQ.undo(state);
    selected = null;
    refresh();
    closeModal();
  }

  function confirmNew() {
    if (state.status === 'playing' && state.plies > 0) {
      openModal('重新开局', '<p>当前对局尚未结束，确定要重新开始吗？</p>', [
        { label: '重新开始', cls: 'primary', fn: newGame },
        { label: '继续下棋', cls: 'ghost' }
      ]);
    } else {
      newGame();
    }
  }

  function resign() {
    if (state.status !== 'playing') return;
    openModal('认输', '<p>确定要认输吗？</p>', [
      {
        label: '认输', cls: 'primary', fn: function () {
          var loser = state.turn;
          state.status = 'over';
          state.result = { winner: XQ.other(loser), reason: '认输' };
          state.log.push({ kind: 'result', color: XQ.other(loser), text: '认输', ply: state.plies });
          refresh();
          showResult();
        }
      },
      { label: '继续下棋', cls: 'ghost' }
    ]);
  }

  /* ------------------------------ 弹窗 / 提示 ------------------------------ */

  function openModal(title, bodyHTML, actions) {
    el('modalTitle').textContent = title;
    el('modalBody').innerHTML = bodyHTML;
    var box = el('modalActions');
    box.innerHTML = '';
    (actions || [{ label: '关闭' }]).forEach(function (a) {
      var b = document.createElement('button');
      b.className = 'btn ' + (a.cls || '');
      b.textContent = a.label;
      b.onclick = function () {
        if (a.keepOpen) { if (a.fn) a.fn(); return; }
        closeModal();
        if (a.fn) a.fn();
      };
      box.appendChild(b);
    });
    el('modal').classList.add('open');
  }

  function closeModal() { el('modal').classList.remove('open'); }

  function toast(msg) {
    var t = el('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('show'); }, 2000);
  }

  function openSettings() {
    openModal('设置',
      '<label class="sw"><input type="checkbox" id="setAutoFlip"' + (ui.autoFlip ? ' checked' : '') + '>' +
      '<span>自动翻转棋盘<small>轮到哪一方行棋，就把该方转到屏幕下方</small></span></label>' +
      '<label class="sw"><input type="checkbox" id="setHints"' + (ui.hints ? ' checked' : '') + '>' +
      '<span>提示可翻的暗子<small>用金圈标出当前可以翻开的暗子</small></span></label>' +
      '<label class="sw"><input type="checkbox" id="setLong"' + (ui.longRules ? ' checked' : '') + '>' +
      '<span>启用长将 / 长捉判负<small>平台规则：一子连续将军或捉同一子超过 6 回合判负。关闭后只提示不判负</small></span></label>',
      [{ label: '完成' }]);

    el('setAutoFlip').onchange = function () {
      ui.autoFlip = this.checked;
      saveSettings();
      refresh();
      toast(ui.autoFlip ? '已开启自动翻转' : '已关闭自动翻转');
    };
    el('setHints').onchange = function () {
      ui.hints = this.checked; saveSettings(); renderPieces();
    };
    el('setLong').onchange = function () {
      ui.longRules = this.checked;
      state.options.longRules = ui.longRules;
      saveSettings();
      renderSidebar();
      toast(ui.longRules ? '已启用长将/长捉判负' : '长将/长捉只提示，不判负');
    };
  }

  function openHelp() {
    openModal('揭棋规则',
      '<p><span class="hl">棋盘</span>就是标准中国象棋棋盘，胜负目标与象棋一致：将死对方将帅获胜。</p>' +
      '<h5>一、开局布置</h5>' +
      '<ul><li>双方帅/将固定正面摆在九宫原位（明子）</li>' +
      '<li>其余 15 颗棋子背面朝上，随机打乱放在己方半场原来的棋位上，称为暗子</li>' +
      '<li>红方先行，轮流走棋</li></ul>' +
      '<h5>二、你的回合二选一</h5>' +
      '<ul><li><b>翻子</b>：翻开自己半场任意一颗暗子</li>' +
      '<li><b>移动</b>：移动己方已经翻开的明子</li>' +
      '<li>两者不能同时进行</li></ul>' +
      '<h5>三、核心特殊规则</h5>' +
      '<ul><li><span class="hl">士、象可以过河！</span>士可出九宫、象可过河，其余走法不变（象仍走田、塞象眼；士仍斜走一格）</li>' +
      '<li>用明子吃掉暗子时，暗子会先翻开再移除，吃之前不知其为何子</li>' +
      '<li>暗子不能主动移动，只有翻开之后才能走</li>' +
      '<li>将帅不能直接对面</li>' +
      '<li>炮可以拿暗子充当炮架</li>' +
      '<li>可以吃自家的暗子</li></ul>' +
      '<h5>四、胜负</h5>' +
      '<ul><li>将死对方将帅 / 吃掉对方将帅 / 对方认输</li>' +
      '<li>和棋：连续 60 回合（120 步）无吃子；局面重复 5 次；双方均无进攻子力</li>' +
      '<li>长将：一子连续将军最多 6 回合，超出判负</li>' +
      '<li>长捉：兵/卒、帅、士、象允许长捉；其他棋子连续捉同一子最多 6 回合，超出判负</li></ul>' +
      '<h5>操作说明</h5>' +
      '<ul><li>点自己的明子 → 显示可落点 → 点落点走子</li>' +
      '<li>直接点自己半场的暗子即可翻开</li>' +
      '<li>手机竖屏用底部按钮，桌面端在右侧面板操作</li></ul>',
      [{ label: '知道了', cls: 'primary' }]);
  }

  /* ------------------------------ 事件绑定 ------------------------------ */

  function boardTap(e) {
    var rect = boardEl.getBoundingClientRect();
    if (!rect.width) return;
    var ux = (e.clientX - rect.left) / rect.width * VBW;
    var uy = (e.clientY - rect.top) / rect.height * VBH;
    var c = Math.round((ux - PAD) / S);
    var r = Math.round((uy - PAD) / S);
    if (r < 0 || r > 9 || c < 0 || c > 8) return;
    if (Math.abs(ux - (PAD + c * S)) > S * 0.7) return;
    if (Math.abs(uy - (PAD + r * S)) > S * 0.7) return;
    if (ui.flipped) { r = 9 - r; c = 8 - c; }
    onTap(r, c);
  }

  function bindEvents() {
    boardEl.addEventListener('click', boardTap);
    boardEl.addEventListener('contextmenu', function (e) { e.preventDefault(); });

    document.addEventListener('click', function (e) {
      var btn = e.target.closest ? e.target.closest('[data-act]') : null;
      if (!btn) return;
      var act = btn.getAttribute('data-act');
      if (act === 'new') confirmNew();
      else if (act === 'undo') undo();
      else if (act === 'flip') { ui.flipped = !ui.flipped; saveSettings(); refresh(); }
      else if (act === 'menu') openSettings();
      else if (act === 'help') openHelp();
      else if (act === 'resign') resign();
      else if (act === 'info') { toggleSheet(); }
    });

    el('sheetBackdrop').addEventListener('click', closeSheet);
    el('sheetHandle').addEventListener('click', closeSheet);

    el('modal').addEventListener('click', function (e) {
      if (e.target === el('modal')) closeModal();
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { closeModal(); closeSheet(); }
      else if (e.key === 'z' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); undo(); }
    });

    window.addEventListener('resize', layout);
    window.addEventListener('orientationchange', function () { setTimeout(layout, 220); });
    if (window.ResizeObserver) new ResizeObserver(layout).observe(el('boardArea'));
  }

  function toggleSheet() {
    var open = el('sidebar').classList.toggle('open');
    el('sheetBackdrop').classList.toggle('open', open);
  }
  function closeSheet() {
    el('sidebar').classList.remove('open');
    el('sheetBackdrop').classList.remove('open');
  }

  /* ------------------------------ 启动 ------------------------------ */

  function boot() {
    loadSettings();
    buildGrid();
    var saved = loadGame();
    if (saved && saved.status === 'playing' && saved.plies > 0) {
      state = saved;
      state.options.longRules = ui.longRules;
      toast('已恢复上次未完成的对局');
    } else {
      state = XQ.createGame();
      state.options.longRules = ui.longRules;
    }
    bindEvents();
    layout();
    refresh();
    if (saved && saved.status === 'playing' && saved.plies > 0) showRestoreHint();
  }

  function showRestoreHint() {
    openModal('继续对局？',
      '<p>检测到上次未下完的棋局（共 ' + state.plies + ' 步，轮到' + XQ.colorName(state.turn) + '行棋）。</p>' +
      '<p style="color:var(--txt-dim);font-size:12px">刷新前后都可撤销最近的走子。</p>',
      [{ label: '继续这局', cls: 'primary' }, { label: '重新开局', fn: newGame }]);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

})();
