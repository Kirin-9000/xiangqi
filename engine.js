/* ==========================================================================
 * 揭棋（暗棋）规则引擎 —— 纯逻辑实现，不依赖 DOM
 *
 * 棋盘坐标 board[row][col]
 *   row 0 = 黑方底线（棋盘顶部） ... row 9 = 红方底线（棋盘底部）
 *   col 0 = 棋盘左侧        ... col 8 = 棋盘右侧
 *
 * 规则要点（依据《象棋揭棋规则.txt》 + 用户后续调整）：
 *   1. 帅/将固定在九宫原位且为明子，其余 15 子背面朝上随机打乱落在己方半场原棋位
 *   2. 每回合二选一：翻开己方一枚暗子 / 移动己方一枚棋子（明子或暗子都可以走）
 *   3. 【卧底】暗子未翻开时，按“该棋位在常规象棋中的兵种”行走；
 *      翻开后按自己真实的兵种行走（车直走、马走日、炮隔子打……）
 *   4. 士可出九宫、象可过河（其余走法不变）；将帅不得出九宫随意行走；兵卒不可后退
 *   5. 明子吃暗子：暗子翻开后移除（吃前不知其为何子）；暗子吃子后自己仍不翻开
 *   6. 暗子可充当炮架；双方未翻开的暗子都可以“自残”（被己方吃掉）
 *   7. 只能翻开当前位于己方界内的暗子
 *   8. 将帅不可照面；被将军时必须应将（翻子不改变占位，无法解将）
 * ========================================================================== */
(function (global) {
  'use strict';

  var ROWS = 10, COLS = 9;
  var RED = 'r', BLACK = 'b';

  var CHAR = {
    r: { K: '帅', A: '仕', B: '相', N: '马', R: '车', C: '炮', P: '兵' },
    b: { K: '将', A: '士', B: '象', N: '马', R: '车', C: '炮', P: '卒' }
  };
  var TYPE_NAME = { K: '将/帅', A: '士/仕', B: '象/相', N: '马', R: '车', C: '炮', P: '兵/卒' };
  var COLOR_NAME = { r: '红方', b: '黑方' };
  var STEP_TYPES = { R: 1, C: 1, P: 1, K: 1 };   // 记谱时以“步数”表示进/退的兵种

  // 每方除将帅外的 15 枚暗子“真实身份”构成
  var DARK_KINDS = ['R', 'N', 'B', 'A', 'A', 'B', 'N', 'R', 'C', 'C', 'P', 'P', 'P', 'P', 'P'];

  // 开局棋位：[行, 列, 该棋位在常规象棋中的兵种]
  // 暗子未翻开时按第三项（卧底身份）行走，翻开后按真实身份行走
  var LAYOUT = {
    r: {
      king: [9, 4],
      slots: [
        [9, 0, 'R'], [9, 1, 'N'], [9, 2, 'B'], [9, 3, 'A'], [9, 5, 'A'], [9, 6, 'B'], [9, 7, 'N'], [9, 8, 'R'],
        [7, 1, 'C'], [7, 7, 'C'],
        [6, 0, 'P'], [6, 2, 'P'], [6, 4, 'P'], [6, 6, 'P'], [6, 8, 'P']
      ]
    },
    b: {
      king: [0, 4],
      slots: [
        [0, 0, 'R'], [0, 1, 'N'], [0, 2, 'B'], [0, 3, 'A'], [0, 5, 'A'], [0, 6, 'B'], [0, 7, 'N'], [0, 8, 'R'],
        [2, 1, 'C'], [2, 7, 'C'],
        [3, 0, 'P'], [3, 2, 'P'], [3, 4, 'P'], [3, 6, 'P'], [3, 8, 'P']
      ]
    }
  };

  var ORTHO = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  var DIAG = [[1, 1], [1, -1], [-1, 1], [-1, -1]];

  /* ----------------------------- 基础工具 ----------------------------- */

  function other(c) { return c === RED ? BLACK : RED; }
  function inBoard(r, c) { return r >= 0 && r < ROWS && c >= 0 && c < COLS; }
  function inPalace(color, r, c) {
    if (c < 3 || c > 5) return false;
    return color === RED ? (r >= 7 && r <= 9) : (r >= 0 && r <= 2);
  }
  // 己方半场：红方第 5~9 行，黑方第 0~4 行
  function ownHalf(color, r) { return color === RED ? r >= 5 : r <= 4; }
  function fwd(color) { return color === RED ? -1 : 1; }
  function crossedRiver(color, r) { return color === RED ? r <= 4 : r >= 5; }
  function colorName(c) { return ColorName(c); }
  function ColorName(c) { return COLOR_NAME[c] || '未知'; }
  function pieceName(p) { return p ? CHAR[p.color][p.type] : ''; }

  function shuffle(a) {
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  /* ----------------------------- 棋盘查询 ----------------------------- */

  // 【卧底】暗子未翻开时按棋位对应的常规兵种行走；翻开后按真实兵种行走
  function effType(p) {
    if (!p) return null;
    return p.revealed ? p.type : (p.disguise || p.type);
  }

  function findGeneral(board, color) {
    for (var r = 0; r < ROWS; r++) {
      for (var c = 0; c < COLS; c++) {
        var p = board[r][c];
        if (p && p.type === 'K' && p.color === color) return { r: r, c: c };
      }
    }
    return null;
  }

  // 两将之间的棋子数（用于照面判断 / 车的通路 / 炮的炮架）
  function countBetween(board, fr, fc, tr, tc) {
    var dr = Math.sign(tr - fr), dc = Math.sign(tc - fc);
    var r = fr + dr, c = fc + dc, n = 0;
    while (r !== tr || c !== tc) {
      if (!inBoard(r, c)) break;
      if (board[r][c]) n++;
      r += dr; c += dc;
    }
    return n;
  }

  // 将帅是否照面（同一竖线且中间无子）
  function generalsFacing(board) {
    var a = findGeneral(board, RED), b = findGeneral(board, BLACK);
    if (!a || !b || a.c !== b.c) return false;
    return countBetween(board, a.r, a.c, b.r, b.c) === 0;
  }

  // 某个棋子（含未翻开的暗子，按卧底身份）是否攻击到目标格
  // 目标格通常有子；炮按“隔一子吃子”判定
  function pieceAttacks(board, fr, fc, tr, tc) {
    var p = board[fr][fc];
    if (!p) return false;
    if (fr === tr && fc === tc) return false;
    var dr = tr - fr, dc = tc - fc;
    var adr = Math.abs(dr), adc = Math.abs(dc);
    switch (effType(p)) {
      case 'R':
        if (dr !== 0 && dc !== 0) return false;
        return countBetween(board, fr, fc, tr, tc) === 0;
      case 'C':
        if (dr !== 0 && dc !== 0) return false;
        return countBetween(board, fr, fc, tr, tc) === 1;
      case 'N':
        if (!((adr === 2 && adc === 1) || (adr === 1 && adc === 2))) return false;
        return !board[fr + (adr === 2 ? dr / 2 : 0)][fc + (adc === 2 ? dc / 2 : 0)];
      case 'B':
        if (adr !== 2 || adc !== 2) return false;
        return !board[fr + dr / 2][fc + dc / 2];
      case 'A':
        return adr === 1 && adc === 1;
      case 'K':
        return adr + adc === 1;
      case 'P':
        if (dc === 0 && dr === fwd(p.color)) return true;
        if (dr === 0 && dc !== 0) return crossedRiver(p.color, fr);
        return false;
    }
    return false;
  }

  function isAttacked(board, r, c, byColor) {
    for (var i = 0; i < ROWS; i++) {
      for (var j = 0; j < COLS; j++) {
        var p = board[i][j];
        if (p && p.color === byColor && pieceAttacks(board, i, j, r, c)) return true;
      }
    }
    return false;
  }

  function isKingInCheck(board, color) {
    var g = findGeneral(board, color);
    if (!g) return false;
    return isAttacked(board, g.r, g.c, other(color));
  }

  /* ----------------------------- 走法生成 ----------------------------- */

  // 目标格能否落入：空位 / 敌子（明或暗）/ 自家暗子（规则允许吃自家暗子）
  function canLand(p, t) {
    if (!t) return false;
    if (t.color !== p.color) return true;
    return !t.revealed;
  }

  // 某枚棋子的全部“几何走法”（未过滤送将）；暗子按卧底身份走
  function rawMoves(board, r, c) {
    var p = board[r][c];
    if (!p) return [];
    var out = [];
    var i, dr, dc, nr, nc, t;

    function step(nr, nc) {
      if (!inBoard(nr, nc)) return;
      t = board[nr][nc];
      if (!t || canLand(p, t)) out.push({ r: nr, c: nc });
    }

    switch (effType(p)) {
      case 'K':
        for (i = 0; i < 4; i++) {
          nr = r + ORTHO[i][0]; nc = c + ORTHO[i][1];
          if (inPalace(p.color, nr, nc)) step(nr, nc);
        }
        break;

      case 'A':   // 揭棋特色：士可走出九宫
        for (i = 0; i < 4; i++) step(r + DIAG[i][0], c + DIAG[i][1]);
        break;

      case 'B':   // 揭棋特色：象可过河；仍走田、仍塞象眼
        for (i = 0; i < 4; i++) {
          dr = DIAG[i][0] * 2; dc = DIAG[i][1] * 2;
          nr = r + dr; nc = c + dc;
          if (!inBoard(nr, nc)) continue;
          if (board[r + dr / 2][c + dc / 2]) continue;   // 塞象眼
          step(nr, nc);
        }
        break;

      case 'N':
        var KNIGHT = [[2, 1], [2, -1], [-2, 1], [-2, -1], [1, 2], [1, -2], [-1, 2], [-1, -2]];
        for (i = 0; i < 8; i++) {
          dr = KNIGHT[i][0]; dc = KNIGHT[i][1];
          nr = r + dr; nc = c + dc;
          if (!inBoard(nr, nc)) continue;
          var lr = r + (Math.abs(dr) === 2 ? dr / 2 : 0);
          var lc = c + (Math.abs(dc) === 2 ? dc / 2 : 0);
          if (board[lr][lc]) continue;                   // 蹩马腿
          step(nr, nc);
        }
        break;

      case 'R':
        for (i = 0; i < 4; i++) {
          dr = ORTHO[i][0]; dc = ORTHO[i][1];
          nr = r + dr; nc = c + dc;
          while (inBoard(nr, nc)) {
            t = board[nr][nc];
            if (!t) { out.push({ r: nr, c: nc }); }
            else {
              if (canLand(p, t)) out.push({ r: nr, c: nc });
              break;
            }
            nr += dr; nc += dc;
          }
        }
        break;

      case 'C':
        for (i = 0; i < 4; i++) {
          dr = ORTHO[i][0]; dc = ORTHO[i][1];
          nr = r + dr; nc = c + dc;
          var jumped = false;
          while (inBoard(nr, nc)) {
            t = board[nr][nc];
            if (!jumped) {
              if (!t) out.push({ r: nr, c: nc });
              else jumped = true;                        // 找到炮架（暗子亦可当炮架）
            } else if (t) {
              if (canLand(p, t)) out.push({ r: nr, c: nc });
              break;
            }
            nr += dr; nc += dc;
          }
        }
        break;

      case 'P':
        step(r + fwd(p.color), c);
        if (crossedRiver(p.color, r)) { step(r, c - 1); step(r, c + 1); }
        break;
    }
    return out;
  }

  // 试走一步后是否符合规则（不送将、不照面）
  function legalAfterMove(board, fr, fc, tr, tc, color) {
    var from = board[fr][fc], cap = board[tr][tc];
    board[tr][tc] = from; board[fr][fc] = null;
    var bad = isKingInCheck(board, color) || generalsFacing(board);
    board[fr][fc] = from; board[tr][tc] = cap;
    return !bad;
  }

  /* ----------------------------- 局面标识 ----------------------------- */

  function positionKey(st) {
    var s = st.turn;
    for (var r = 0; r < ROWS; r++) {
      for (var c = 0; c < COLS; c++) {
        var p = st.board[r][c];
        s += p ? (p.color + p.type + (p.revealed ? '1' : '0')) : '..';
      }
    }
    return s;
  }

  /* ----------------------------- 可行动作 ----------------------------- */

  // 返回 { flips:[{r,c}], moves:[{from,to,capture}] }
  function legalActions(st) {
    if (st.status !== 'playing') return { flips: [], moves: [] };
    var color = st.turn, board = st.board;
    var moves = [], flips = [], r, c, p, ms, i;

    for (r = 0; r < ROWS; r++) {
      for (c = 0; c < COLS; c++) {
        p = board[r][c];
        if (!p || p.color !== color) continue;      // 暗子也能走（按卧底身份）
        ms = rawMoves(board, r, c);
        for (i = 0; i < ms.length; i++) {
          if (legalAfterMove(board, r, c, ms[i].r, ms[i].c, color)) {
            moves.push({
              from: { r: r, c: c },
              to: { r: ms[i].r, c: ms[i].c },
              capture: board[ms[i].r][ms[i].c] || null,
              selfDark: !!(board[ms[i].r][ms[i].c] && board[ms[i].r][ms[i].c].color === color),
              dark: !p.revealed
            });
          }
        }
      }
    }

    // 被将军时不能翻子（翻开不改变棋盘占位，无法解将）
    var canFlip = !isKingInCheck(board, color) && !generalsFacing(board);
    if (canFlip) {
      for (r = 0; r < ROWS; r++) {
        for (c = 0; c < COLS; c++) {
          p = board[r][c];
          if (p && !p.revealed && p.color === color && ownHalf(color, r)) flips.push({ r: r, c: c });
        }
      }
    }
    return { flips: flips, moves: moves };
  }

  /* ----------------------------- 中文记谱 ----------------------------- */

  var CN_NUM = ['一', '二', '三', '四', '五', '六', '七', '八', '九'];

  // 红方自右向左为一~九；黑方自左向右为 1~9
  function fileLabel(color, c) {
    return color === RED ? CN_NUM[8 - c] : String(c + 1);
  }
  function numLabel(color, n) {
    return color === RED ? CN_NUM[n - 1] : String(n);
  }

  // 走子前的棋盘上生成记谱，如「车二平五」「前马退三」
  // 暗子按卧底身份记谱（其卧底身份是公开信息）
  function notation(board, color, fr, fc, tr, tc) {
    var p = board[fr][fc];
    if (!p) return '';
    var et = effType(p);
    var ch = CHAR[color][et];
    var name;

    // 同一列有两个（含）以上同兵种（按卧底/真实身份）的己方棋子时使用 前/中/后
    var rows = [];
    for (var r = 0; r < ROWS; r++) {
      var q = board[r][fc];
      if (q && q.color === color && effType(q) === et) rows.push(r);
    }
    if (rows.length > 1) {
      rows.sort(function (a, b) { return color === RED ? a - b : b - a; });
      var idx = rows.indexOf(fr);
      var pos = rows.length === 2
        ? (idx === 0 ? '前' : '后')
        : (idx === 0 ? '前' : (idx === rows.length - 1 ? '后' : '中'));
      name = pos + ch;
    } else {
      name = ch + fileLabel(color, fc);
    }

    var dr = tr - fr, dc = tc - fc;
    if (dr === 0) return name + '平' + fileLabel(color, tc);
    var isForward = color === RED ? dr < 0 : dr > 0;
    var act = isForward ? '进' : '退';
    var num = STEP_TYPES[et] ? numLabel(color, Math.abs(dr)) : fileLabel(color, tc);
    return name + act + num;
  }

  /* ----------------------------- 状态与历史 ----------------------------- */

  var SNAP_FIELDS = ['board', 'turn', 'plies', 'noCapturePlies', 'posCounts', 'checkStreak',
                     'chaseStreak', 'log', 'captured', 'lastAction', 'status', 'result',
                     'inCheck', 'options'];

  function pushHistory(st) {
    var snap = {};
    for (var i = 0; i < SNAP_FIELDS.length; i++) snap[SNAP_FIELDS[i]] = clone(st[SNAP_FIELDS[i]]);
    st.history.push(snap);
    if (st.history.length > 600) st.history.shift();
  }

  function undo(st) {
    if (!st.history || !st.history.length) return false;
    var snap = st.history.pop();
    for (var i = 0; i < SNAP_FIELDS.length; i++) st[SNAP_FIELDS[i]] = snap[SNAP_FIELDS[i]];
    return true;
  }

  function createGame() {
    var board = [], r, c;
    for (r = 0; r < ROWS; r++) {
      board.push([]);
      for (c = 0; c < COLS; c++) board[r].push(null);
    }
    var seq = 0;
    function mk(color, type, revealed, disguise) {
      seq += 1;
      return {
        id: color + seq, color: color, type: type,
        disguise: disguise || type, revealed: revealed
      };
    }
    [RED, BLACK].forEach(function (color) {
      var L = LAYOUT[color];
      board[L.king[0]][L.king[1]] = mk(color, 'K', true, 'K');
      // 15 枚棋子的真实身份全部打乱，随机落到己方半场 15 个原棋位上
      var kinds = shuffle(DARK_KINDS.slice());
      L.slots.forEach(function (slot, i) {
        board[slot[0]][slot[1]] = mk(color, kinds[i], false, slot[2]);
      });
    });

    var st = {
      board: board,
      turn: RED,
      plies: 0,
      noCapturePlies: 0,
      posCounts: {},
      checkStreak: { color: null, pieceId: null, count: 0 },
      chaseStreak: { pieceId: null, targetId: null, count: 0 },
      log: [],
      captured: { r: [], b: [] },
      lastAction: null,
      inCheck: false,
      status: 'playing',
      result: null,
      options: { longRules: true },
      history: []
    };
    st.posCounts[positionKey(st)] = 1;
    return st;
  }

  /* ----------------------------- 结果判定 ----------------------------- */

  function over(st, winner, reason) {
    st.status = 'over';
    st.result = { winner: winner, reason: reason };
    st.log.push({
      kind: 'result',
      color: winner,
      text: reason + '，' + (winner ? colorName(winner) + '胜' : '和棋'),
      ply: st.plies
    });
  }

  // 双方是否都已无进攻子力（且全部翻开，否则无从判断）
  function noAttackingMaterial(board) {
    var rr = 0, bb = 0;
    for (var r = 0; r < ROWS; r++) {
      for (var c = 0; c < COLS; c++) {
        var p = board[r][c];
        if (!p) continue;
        if (!p.revealed) return false;
        if (p.type === 'R' || p.type === 'N' || p.type === 'C' || p.type === 'P') {
          if (p.color === RED) rr++; else bb++;
        }
      }
    }
    return rr === 0 && bb === 0;
  }

  // 长捉：同一棋子（兵/卒/将/士/象除外，按卧底或真实身份）连续追捉同一个敌子
  function updateChase(st, actor) {
    var reset = { pieceId: null, targetId: null, count: 0 };
    if (!actor || actor.kind !== 'move') { st.chaseStreak = reset; return; }
    var p = st.board[actor.to.r][actor.to.c];
    if (!p) { st.chaseStreak = reset; return; }
    var et = effType(p);
    if (et === 'K' || et === 'P' || et === 'A' || et === 'B') {
      st.chaseStreak = reset; return;   // 这些子允许长捉
    }
    var targets = [];
    for (var r = 0; r < ROWS; r++) {
      for (var c = 0; c < COLS; c++) {
        var t = st.board[r][c];
        if (!t || t.color === p.color || t.type === 'K') continue;   // 将军由长将规则处理
        if (pieceAttacks(st.board, actor.to.r, actor.to.c, r, c)) targets.push(t);
      }
    }
    if (!targets.length) { st.chaseStreak = reset; return; }
    var prev = st.chaseStreak;
    if (prev.pieceId === p.id && prev.targetId) {
      for (var i = 0; i < targets.length; i++) {
        if (targets[i].id === prev.targetId) {
          st.chaseStreak = { pieceId: p.id, targetId: prev.targetId, count: prev.count + 1 };
          return;
        }
      }
    }
    st.chaseStreak = { pieceId: p.id, targetId: targets[0].id, count: 1 };
  }

  function resolve(st) {
    var actor = st.lastAction;
    var side = st.turn;               // 轮到行棋的一方
    var opp = other(side);

    // 将帅被吃（正常对局不会走到这里，作为兜底）
    if (!findGeneral(st.board, opp)) { over(st, side, '将帅被吃'); return; }

    var inCheck = isKingInCheck(st.board, side);
    st.inCheck = inCheck;

    // 将死 / 困毙
    var acts = legalActions(st);
    if (!acts.flips.length && !acts.moves.length) {
      over(st, opp, inCheck ? '将死' : '困毙（无子可动）');
      return;
    }

    // 长将计数：同一子连续将军
    if (inCheck && actor) {
      if (st.checkStreak.color === actor.color && st.checkStreak.pieceId === actor.pieceId) {
        st.checkStreak.count++;
      } else {
        st.checkStreak = { color: actor.color, pieceId: actor.pieceId, count: 1 };
      }
    } else {
      st.checkStreak = { color: null, pieceId: null, count: 0 };
    }

    updateChase(st, actor);

    if (st.options && st.options.longRules) {
      if (st.checkStreak.count > 6) { over(st, side, '长将判负（一子连续将军超过6回合）'); return; }
      if (st.chaseStreak.count > 6) { over(st, side, '长捉判负（一子连续捉同一子超过6回合）'); return; }
    }

    // 和棋：连续60回合（120步）无吃子
    if (st.noCapturePlies >= 120) { over(st, null, '连续60回合无吃子'); return; }

    // 和棋：同一局面重复5次
    var key = positionKey(st);
    st.posCounts[key] = (st.posCounts[key] || 0) + 1;
    if (st.posCounts[key] >= 5) { over(st, null, '同一局面重复5次'); return; }

    // 和棋：双方均无进攻子力
    if (noAttackingMaterial(st.board)) { over(st, null, '双方均无进攻子力'); return; }
  }

  function finishTurn(st, actor) {
    st.turn = other(st.turn);
    resolve(st);
    return st;
  }

  /* ----------------------------- 执行动作 ----------------------------- */

  function doFlip(st, r, c) {
    if (st.status !== 'playing') return { ok: false, msg: '对局已结束' };
    if (!inBoard(r, c)) return { ok: false, msg: '位置无效' };
    var p = st.board[r][c];
    if (!p || p.revealed) return { ok: false, msg: '请选择己方暗子' };
    if (p.color !== st.turn) return { ok: false, msg: '只能翻开自己的棋子' };
    if (!ownHalf(p.color, r)) return { ok: false, msg: '只能翻开位于己方界内的暗子' };
    if (isKingInCheck(st.board, st.turn) || generalsFacing(st.board)) {
      return { ok: false, msg: '被将军时不能翻子，必须先应将' };
    }

    pushHistory(st);
    p.revealed = true;
    st.plies++;
    st.noCapturePlies++;
    st.lastAction = { kind: 'flip', color: p.color, pieceId: p.id, to: { r: r, c: c } };
    st.log.push({ kind: 'flip', color: p.color, text: '翻子 ' + CHAR[p.color][p.type], ply: st.plies });
    finishTurn(st, st.lastAction);
    return { ok: true };
  }

  function doMove(st, fr, fc, tr, tc) {
    if (st.status !== 'playing') return { ok: false, msg: '对局已结束' };
    if (!inBoard(fr, fc) || !inBoard(tr, tc)) return { ok: false, msg: '位置无效' };
    var p = st.board[fr][fc];
    if (!p) return { ok: false, msg: '该位置没有棋子' };
    if (p.color !== st.turn) return { ok: false, msg: '现在不是' + colorName(p.color) + '行棋' };

    var ok = false, ms = rawMoves(st.board, fr, fc);
    for (var i = 0; i < ms.length; i++) {
      if (ms[i].r === tr && ms[i].c === tc) { ok = true; break; }
    }
    if (!ok) return { ok: false, msg: '不符合该子的走法' };
    if (!legalAfterMove(st.board, fr, fc, tr, tc, p.color)) {
      return { ok: false, msg: '不能送将或将帅照面' };
    }

    pushHistory(st);
    var target = st.board[tr][tc];
    var note = notation(st.board, p.color, fr, fc, tr, tc);

    st.board[tr][tc] = p;
    st.board[fr][fc] = null;

    var text = (p.revealed ? '' : '暗·') + note;
    if (target) {
      if (target.color === p.color) {
        text += ' 自残（揭开为' + CHAR[target.color][target.type] + '后移除）';
      } else {
        text += ' 吃' + CHAR[target.color][target.type]
             + (target.revealed ? '' : '（暗子）');
      }
      st.captured[target.color].push({ type: target.type, revealed: target.revealed, color: target.color });
      st.noCapturePlies = 0;
    } else {
      st.noCapturePlies++;
    }
    st.plies++;
    st.lastAction = {
      kind: 'move', color: p.color, pieceId: p.id,
      from: { r: fr, c: fc }, to: { r: tr, c: tc },
      capture: target ? { color: target.color, type: target.type, id: target.id, revealed: target.revealed } : null
    };
    st.log.push({ kind: 'move', color: p.color, text: text, ply: st.plies });
    finishTurn(st, st.lastAction);
    return { ok: true };
  }

  /* ----------------------------- 序列化 ----------------------------- */

  function serialize(st) { return JSON.stringify(st); }

  function deserialize(json) {
    var st = typeof json === 'string' ? JSON.parse(json) : json;
    if (!st || !st.board || st.board.length !== ROWS) return null;
    if (!st.history) st.history = [];
    if (!st.options) st.options = { longRules: true };
    return st;
  }

  // 调试/测试用：由字符画构造局面
  //   大写 = 红方明子(如 R K P)，小写 = 黑方明子(如 r k p)
  //   x = 红方暗子, o = 黑方暗子, . = 空
  // disguises: {"行,列": 'C'} 指定暗子的卧底身份（默认 'P'）
  //            也可用 {"行,列": {d:'C', t:'R'}} 同时指定卧底身份与真实身份
  function fromRows(rows, turn, disguises) {
    var board = [], seq = 0, r, c;
    for (r = 0; r < ROWS; r++) {
      board.push([]);
      for (c = 0; c < COLS; c++) board[r].push(null);
    }
    for (r = 0; r < ROWS; r++) {
      for (c = 0; c < COLS; c++) {
        var ch = rows[r][c];
        if (!ch || ch === '.') continue;
        seq++;
        if (ch === 'x' || ch === 'o') {
          var spec = (disguises && disguises[r + ',' + c]) || 'P';
          var dis = typeof spec === 'string' ? spec : spec.d;
          var tru = typeof spec === 'string' ? 'P' : (spec.t || 'P');
          board[r][c] = {
            id: (ch === 'x' ? 'r' : 'b') + seq, color: ch === 'x' ? RED : BLACK,
            type: tru, disguise: dis, revealed: false
          };
        } else if (ch === ch.toUpperCase()) {
          board[r][c] = { id: 'r' + seq, color: RED, type: ch, disguise: ch, revealed: true };
        } else {
          board[r][c] = { id: 'b' + seq, color: BLACK, type: ch.toUpperCase(), disguise: ch.toUpperCase(), revealed: true };
        }
      }
    }
    var st = {
      board: board, turn: turn || RED, plies: 0, noCapturePlies: 0, posCounts: {},
      checkStreak: { color: null, pieceId: null, count: 0 },
      chaseStreak: { pieceId: null, targetId: null, count: 0 },
      log: [], captured: { r: [], b: [] }, lastAction: null, inCheck: false,
      status: 'playing', result: null, options: { longRules: false }, history: []
    };
    st.posCounts[positionKey(st)] = 1;
    return st;
  }

  /* ----------------------------- 导出 ----------------------------- */

  var XQ = {
    RED: RED, BLACK: BLACK, ROWS: ROWS, COLS: COLS,
    CHAR: CHAR, TYPE_NAME: TYPE_NAME, COLOR_NAME: COLOR_NAME,
    other: other, inBoard: inBoard, inPalace: inPalace, ownHalf: ownHalf,
    crossedRiver: crossedRiver, colorName: colorName, pieceName: pieceName,
    effType: effType,
    createGame: createGame, legalActions: legalActions,
    doFlip: doFlip, doMove: doMove, undo: undo,
    findGeneral: findGeneral, isKingInCheck: isKingInCheck, generalsFacing: generalsFacing,
    isAttacked: isAttacked, pieceAttacks: pieceAttacks, rawMoves: rawMoves,
    notation: notation, positionKey: positionKey,
    serialize: serialize, deserialize: deserialize,
    _debug: { fromRows: fromRows, countBetween: countBetween, noAttackingMaterial: noAttackingMaterial }
  };

  global.XQ = XQ;
  if (typeof module !== 'undefined' && module.exports) module.exports = XQ;

})(typeof globalThis !== 'undefined' ? globalThis : this);
