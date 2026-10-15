/* 揭棋规则引擎测试（node test-engine.js） */
'use strict';
const XQ = require('./engine.js');
const fromRows = XQ._debug.fromRows;

let pass = 0, fail = 0;
function ok(cond, name, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')); }
}
function eq(a, b, name) { ok(a === b, name, { got: a, want: b }); }
function section(t) { console.log('\n' + t); }
const R = XQ.RED, B = XQ.BLACK;
const mc = (b, r, c) => XQ.rawMoves(b, r, c).map(m => m.r + ',' + m.c).sort().join(' ');

/* ------------------------------------------------------------------ */
section('一、开局布置');
{
  const st = XQ.createGame();
  let dark = { r: 0, b: 0 }, revealed = { r: 0, b: 0 }, total = 0;
  const kinds = {};
  for (let r = 0; r < 10; r++) for (let c = 0; c < 9; c++) {
    const p = st.board[r][c];
    if (!p) continue;
    total++;
    if (p.revealed) revealed[p.color]++;
    else { dark[p.color]++; kinds[p.color + p.type] = (kinds[p.color + p.type] || 0) + 1; }
  }
  eq(total, 32, '共 32 枚棋子');
  eq(dark.r, 15, '红方 15 枚暗子');
  eq(dark.b, 15, '黑方 15 枚暗子');
  eq(revealed.r, 1, '红方仅帅为明子');
  eq(st.board[9][4].type + st.board[9][4].color, 'Kr', '红帅在 (9,4) 且为明子');
  eq(st.board[0][4].type + st.board[0][4].color, 'Kb', '黑将在 (0,4) 且为明子');
  eq(kinds.rR, 2, '红暗子含 2 车');
  eq(kinds.rA, 2, '红暗子含 2 仕');
  eq(kinds.rB, 2, '红暗子含 2 相');
  eq(kinds.rN, 2, '红暗子含 2 马');
  eq(kinds.rC, 2, '红暗子含 2 炮');
  eq(kinds.rP, 5, '红暗子含 5 兵');
  eq(st.turn, R, '红先行');

  let badSlot = null;
  for (let r = 0; r < 10; r++) for (let c = 0; c < 9; c++) {
    const p = st.board[r][c];
    if (p && !p.revealed && !XQ.ownHalf(p.color, r)) badSlot = [r, c, p.color];
  }
  ok(badSlot === null, '暗子均在己方半场', badSlot);

  // 卧底身份 = 该棋位在常规象棋中的兵种
  eq(st.board[9][0].disguise, 'R', '红方 (9,0) 暗子的卧底身份是车');
  eq(st.board[9][8].disguise, 'R', '红方 (9,8) 暗子的卧底身份是车');
  eq(st.board[9][1].disguise, 'N', '红方 (9,1) 暗子的卧底身份是马');
  eq(st.board[9][2].disguise, 'B', '红方 (9,2) 暗子的卧底身份是相');
  eq(st.board[9][3].disguise, 'A', '红方 (9,3) 暗子的卧底身份是仕');
  eq(st.board[7][1].disguise, 'C', '红方 (7,1) 暗子的卧底身份是炮');
  eq(st.board[6][4].disguise, 'P', '红方 (6,4) 暗子的卧底身份是兵');
  eq(st.board[0][0].disguise, 'R', '黑方 (0,0) 暗子的卧底身份是车');
  eq(st.board[3][4].disguise, 'P', '黑方 (3,4) 暗子的卧底身份是卒');

  const acts = XQ.legalActions(st);
  eq(acts.flips.length, 15, '开局可翻 15 枚暗子');
  ok(acts.moves.length > 3, '开局除了帅，还有 15 枚暗子可以按卧底身份走');
}

/* ------------------------------------------------------------------ */
section('二、翻子');
{
  const st = XQ.createGame();
  const res = XQ.doFlip(st, 6, 4);
  ok(res.ok, '可以翻开己方半场暗子', res);
  ok(st.board[6][4].revealed, '翻开的棋子变为明子');
  eq(st.turn, B, '翻子后轮到黑方');
  eq(st.plies, 1, '步数 +1');

  ok(!XQ.doFlip(st, 9, 4).ok, '不能翻开己方明子（帅）');
  const st2 = XQ.createGame();
  ok(!XQ.doFlip(st2, 3, 4).ok, '红方不能翻开对方半场的暗子');
  ok(!XQ.doFlip(st2, 5, 5).ok, '不能翻开空位');
}

/* ------------------------------------------------------------------ */
section('三、卧底：暗子按背面兵种行走');
{
  // (9,0) 的暗子：卧底身份是「车」，真实身份是「兵」
  const st = fromRows([
    '...k.....',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
    'x...K....'
  ], R, { '9,0': { d: 'R', t: 'P' } });
  eq(XQ.effType(st.board[9][0]), 'R', '未翻开时按卧底身份（车）计算走法');
  eq(mc(st.board, 9, 0),
     '0,0 1,0 2,0 3,0 4,0 5,0 6,0 7,0 8,0 9,1 9,2 9,3',
     '暗子像车一样直走（撞到自家帅才停）');
  ok(XQ.legalActions(st).moves.some(m => m.from.r === 9 && m.from.c === 0 && m.to.r === 2 && m.to.c === 0),
     '暗子可以主动移动');
  ok(XQ.doMove(st, 9, 0, 4, 0).ok, '暗子可以走出己方半场');
  ok(!st.board[4][0].revealed, '走完之后仍是暗子（不亮牌）');

  // 同一枚子，翻开后按真实兵种走
  const st2 = fromRows([
    '...k.....', '.........', '.........', '.........', '.........',
    '.........', '.........', '.........', '.........',
    'x...K....'
  ], R, { '9,0': { d: 'R', t: 'P' } });
  ok(XQ.doFlip(st2, 9, 0).ok, '可以翻开己方界内的暗子');
  eq(XQ.effType(st2.board[9][0]), 'P', '翻开后按真实兵种（兵）计算走法');
  eq(mc(st2.board, 9, 0), '8,0', '翻开成兵后只能向前一步（走法与卧底身份完全不同）');

  // 暗子吃子：被吃的亮牌，吃子的不亮
  const st3 = fromRows([
    '...k.....',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
    '....p....',   // 黑明卒
    '.........',
    '...x.....',   // 红暗子，卧底为车、真实为马
    '....K....'
  ], R, { '8,3': { d: 'R', t: 'N' } });
  const res3 = XQ.doMove(st3, 8, 3, 6, 3);
  ok(res3.ok, '暗子可以吃子', res3);
  eq(st3.board[6][3].type, 'N', '暗子占据目标格');
  eq(st3.board[6][3].revealed, false, '吃子的暗子走完后仍是暗子');
  eq(st3.captured[B].length, 1, '被吃的子记入黑方损失');
  ok(/^暗·/.test(st3.log[0].text), '棋谱标出这是暗子走的', st3.log[0].text);

  // 暗子照样将军
  const st4 = fromRows([
    '...k.....',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
    '...x.K...',
    '....K....'
  ], R, { '8,3': { d: 'R', t: 'P' } });
  ok(XQ.isKingInCheck(st4.board, B), '暗子（卧底为车）与将同线即将军');

  // 记谱用卧底身份
  const st5 = fromRows([
    '...k.....', '.........', '.........', '.........', '.........',
    '.........', '.........', '.........',
    '...x.....',   // 红暗子，卧底为炮、真实为车
    '...K.....'
  ], R, { '8,3': { d: 'C', t: 'R' } });
  eq(XQ.effType(st5.board[8][3]), 'C', '卧底身份为炮');
  eq(XQ.notation(st5.board, R, 8, 3, 8, 0), '炮六平九', '暗子按卧底身份记谱');

  // 走出己方界内后不能再翻
  const st6 = fromRows([
    '....k....',
    '.........',
    '.........',
    '..x......',   // 红方暗子已深入黑方半场
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
    '...K.....'
  ], R, { '3,2': { d: 'R', t: 'N' } });
  eq(XQ.legalActions(st6).flips.length, 0, '不在己方界内的暗子不能被翻开');
  ok(!XQ.doFlip(st6, 3, 2).ok, '翻开界外己方暗子被拒绝');
  ok(XQ.legalActions(st6).moves.length > 0, '但界外的暗子仍然可以走');
}

/* ------------------------------------------------------------------ */
section('四、士可出九宫、象可过河（揭棋特色）');
{
  const st = fromRows([
    '....k....',
    '.........',
    '.........',
    '.........',
    '....A....',   // 红仕已过河到 (4,4)
    '.........',
    '..B......',   // 红相在 (6,2)
    '.........',
    '.........',
    '....K....'
  ], R);
  eq(mc(st.board, 4, 4), '3,3 3,5 5,3 5,5', '仕在河对岸仍斜走一格（可出九宫）');
  eq(mc(st.board, 6, 2), '4,0 8,0 8,4', '相可过河走田（(4,4) 被占则塞象眼）');
}

/* ------------------------------------------------------------------ */
section('五、马 / 车 / 炮 / 兵卒走法');
{
  const m = fromRows([
    '....k....', '.........', '.........', '.........', '.........',
    '.........', '.........', '....N....', '.........', '....K....'
  ], R);
  eq(XQ.rawMoves(m.board, 7, 4).length, 8, '马无阻挡有 8 个落点');
  m.board[6][4] = { id: 'x', color: R, type: 'P', revealed: true };
  eq(XQ.rawMoves(m.board, 7, 4).length, 6, '蹩马腿后只剩 6 个落点');

  const c = fromRows([
    '....k....',
    '.........',
    '.........',
    '....o....',   // 黑暗子
    '.........',
    '....p....',   // 黑暗子（炮架）
    '.........',
    '....C....',   // 红炮
    '.........',
    '....K....'
  ], R);
  const cm = XQ.rawMoves(c.board, 7, 4).map(x => x.r + ',' + x.c);
  ok(cm.includes('3,4'), '炮可拿暗子当炮架，隔子吃后面的暗子');
  ok(!cm.includes('5,4'), '炮不能吃炮架本身');
  ok(!cm.includes('4,4'), '隔子后不能落在空位（只能吃子）');
  eq(cm.filter(s => s.startsWith('7,')).length, 8, '炮平移不受影响（(7,8) 外共 8 格）');

  const p1 = fromRows([
    '....k....', '.........', '.........', '.........',
    '.........', '.........', '....P....', '.........', '.........', '....K....'
  ], R);
  ok(!XQ.rawMoves(p1.board, 6, 4).some(x => x.r === 6 && x.c !== 4), '兵未过河不能横走');

  const p2 = fromRows([
    '....k....', '.........', '.........', '.........',
    '....P....', '.........', '.........', '.........', '.........', '....K....'
  ], R);
  eq(mc(p2.board, 4, 4), '3,4 4,3 4,5', '兵过河后可前进与左右走');

  const p3 = fromRows([
    '....k....', '.........', '.........', '.........',
    '.........', '....p....', '.........', '.........', '.........', '....K....'
  ], B);
  eq(mc(p3.board, 5, 5), '5,4 5,6 6,5', '卒过河后向前（下）与左右走');
}

/* ------------------------------------------------------------------ */
section('六、吃暗子：先揭开后移除');
{
  const st = fromRows([
    '....k....', '.........', '.........', '.........',
    '....R....',
    '....o....',   // 黑方暗子
    '.........', '.........', '.........', '....K....'
  ], R);
  const res = XQ.doMove(st, 4, 4, 5, 4);
  ok(res.ok, '车可以吃暗子', res);
  eq(st.board[5][4].type, 'R', '车占据目标格');
  eq(st.board[5][4].color, R, '目标格上现在是红车');
  eq(st.captured[B].length, 1, '被吃的暗子记入黑方损失');
  eq(st.captured[B][0].revealed, false, '保留“被吃时是暗子”的信息');
  ok(/暗子/.test(st.log[0].text), '棋谱注明吃的是暗子', st.log[0].text);
}

/* ------------------------------------------------------------------ */
section('七、可以吃自家暗子');
{
  const st = fromRows([
    '....k....', '.........', '.........', '.........',
    '....R....',
    '....x....',   // 自家暗子
    '.........', '.........', '.........', '....K....'
  ], R);
  const mv = XQ.legalActions(st).moves.filter(m => m.to.r === 5 && m.to.c === 4);
  eq(mv.length, 1, '明车可以吃自家暗子');
  ok(mv[0].selfDark === true, '标记为吃自家暗子');
  ok(XQ.doMove(st, 4, 4, 5, 4).ok, '执行吃自家暗子');
  eq(st.captured[R].length, 1, '自家暗子被移除并记入红方损失');
}

/* ------------------------------------------------------------------ */
section('八、将帅照面 / 应将军');
{
  const st = fromRows([
    '....k....',
    '.........',
    '.........',
    '.........',
    '....R....',   // 红车挡在两将之间
    '.........',
    '.........',
    '.........',
    '.........',
    '....K....'
  ], R);
  ok(!XQ.doMove(st, 4, 4, 4, 3).ok, '不能把子走开造成将帅照面');
  ok(XQ.doMove(st, 4, 4, 3, 4).ok, '沿同一直线仍挡着则可以走');

  // 被将军时不能翻子
  const st2 = fromRows([
    '....k....',
    '.........',
    '.........',
    '.........',
    '....r....',   // 黑车将军
    '.........',
    'x........',   // 红方暗子（不在同一列）
    '.........',
    '.........',
    '....K....'
  ], R);
  ok(XQ.isKingInCheck(st2.board, R), '红帅被将军');
  ok(!XQ.doFlip(st2, 6, 0).ok, '被将军时不能翻子（翻子无法解将）');
  const acts = XQ.legalActions(st2);
  eq(acts.flips.length, 0, '被将军时没有翻子选项');
  ok(acts.moves.length > 0, '被将军时可以走子应将');
  ok(!acts.moves.some(m => m.to.r === 8 && m.to.c === 4), '不能走到仍被将军的格子');

  // 帅吃掉无保护的车
  const st3 = fromRows([
    '.....k...',
    '.........', '.........', '.........', '.........', '.........',
    '.........', '.........', '.........',
    '...Kr....'
  ], R);
  ok(XQ.isKingInCheck(st3.board, R), '车贴脸将军');
  ok(XQ.legalActions(st3).moves.some(m => m.to.r === 9 && m.to.c === 4), '帅可以吃掉无保护的车');
}

/* ------------------------------------------------------------------ */
section('九、将死判定');
{
  const st = fromRows([
    'R...k....',   // 红车 (0,0) 将军
    '.........',
    '.........',
    '.........',
    '.........',
    '........R',   // 红车 (5,8)
    '.........',
    '.........',
    '.........',
    '...K.....'
  ], R);
  ok(XQ.isKingInCheck(st.board, B), '黑将被将军');
  const res = XQ.doMove(st, 5, 8, 1, 8);
  ok(res.ok, '红方走车形成双车杀', res);
  eq(st.status, 'over', '对局结束');
  eq(st.result.winner, R, '红方获胜');
  eq(st.result.reason, '将死', '结束原因是将死');
}

/* ------------------------------------------------------------------ */
section('十、和棋规则');
{
  const st = fromRows([
    '..ba.k...',
    '.........', '.........', '.........', '.........', '.........',
    '.........', '.........', '.........',
    '..BA.K...'
  ], R);
  ok(XQ._debug.noAttackingMaterial(st.board), '仅剩士象判定为无进攻子力');

  const st2 = fromRows([
    '....k....', '.........', '.........', '.........', '.........', '.........',
    '.........', '.........', '.........',
    '....K...R'
  ], R);
  ok(!XQ._debug.noAttackingMaterial(st2.board), '还有车时不算无进攻子力');

  // 有暗子时不下“无进攻子力”结论
  const st3 = fromRows([
    '....k....', '.........', '.........', '.........', '.........', '.........',
    '.........', '.........',
    '....x....',
    '....K....'
  ], R);
  ok(!XQ._debug.noAttackingMaterial(st3.board), '还有暗子时无法判定无进攻子力');

  // 60 回合（120 步）无吃子
  const st4 = fromRows([
    '...k.....', '.........', '.........', '.........', '.........', '.........',
    '.........', '.........',
    'R........',
    '....K....'
  ], R);
  st4.noCapturePlies = 119;
  ok(XQ.doMove(st4, 8, 0, 7, 0).ok, '走一步不吃子的闲棋');
  eq(st4.status, 'over', '第 120 步无吃子判和');
  eq(st4.result.winner, null, '和棋无胜方');
  ok(/无吃子/.test(st4.result.reason), '原因：无吃子', st4.result);

  // 局面重复 5 次
  const st5 = fromRows([
    '....k....', '.........', '.........', '.........', '.........', '.........',
    '.........', '.........',
    'R........',
    '...K.....'
  ], R);
  st5.options.longRules = false;
  let n = 0;
  while (st5.status === 'playing' && n++ < 6) {
    XQ.doMove(st5, 8, 0, 7, 0);
    if (st5.status !== 'playing') break;
    XQ.doMove(st5, 0, 4, 1, 4);
    if (st5.status !== 'playing') break;
    XQ.doMove(st5, 7, 0, 8, 0);
    if (st5.status !== 'playing') break;
    XQ.doMove(st5, 1, 4, 0, 4);
  }
  eq(st5.status, 'over', '来回走子后对局结束');
  ok(/重复/.test(st5.result.reason), '原因：局面重复 5 次', st5.result);
}

/* ------------------------------------------------------------------ */
section('十一、长将判负');
{
  const st = fromRows([
    '....k....',
    '.........',
    '.........',
    '.........',
    '.........',
    '.....R...',   // 红车 (5,5)
    '.........',
    '.........',
    '.........',
    '....K....'
  ], R);
  st.options.longRules = true;
  let guard = 0;
  while (st.status === 'playing' && guard++ < 30) {
    const g = XQ.findGeneral(st.board, B);
    if (st.turn === R) {
      let rk = null;
      for (let r = 0; r < 10; r++) for (let c = 0; c < 9; c++) {
        const p = st.board[r][c];
        if (p && p.type === 'R' && p.color === R) rk = { r: r, c: c };
      }
      XQ.doMove(st, rk.r, rk.c, 5, g.c);          // 车与将同列 → 将军
    } else {
      XQ.doMove(st, g.r, g.c, 0, g.c === 4 ? 3 : 4);  // 将横移躲避
    }
  }
  ok(st.status === 'over', '长将最终结束对局');
  ok(/长将/.test(st.result.reason), '原因：长将判负', st.result);
  eq(st.result.winner, B, '判负方是红方，黑方获胜');
}

/* ------------------------------------------------------------------ */
section('十二、长将规则可关闭');
{
  const st = fromRows([
    '....k....',
    '.........',
    '.........',
    '.........',
    '.........',
    '.....R...',
    '.........',
    '.........',
    '.........',
    '....K....'
  ], R);
  st.options.longRules = false;
  const st2 = fromRows([
    '....k....',
    '.........',
    '.........',
    '.........',
    '.........',
    '.....R...',
    '.........',
    '.........',
    '.........',
    '....K....'
  ], R);
  st2.options.longRules = false;
  let guard = 0;
  while (st2.status === 'playing' && guard++ < 20) {
    const g = XQ.findGeneral(st2.board, B);
    if (st2.turn === R) {
      let rk = null;
      for (let r = 0; r < 10; r++) for (let c = 0; c < 9; c++) {
        const p = st2.board[r][c];
        if (p && p.type === 'R' && p.color === R) rk = { r: r, c: c };
      }
      XQ.doMove(st2, rk.r, rk.c, 5, g.c);
    } else {
      XQ.doMove(st2, g.r, g.c, 0, g.c === 4 ? 3 : 4);
    }
  }
  ok(!st2.result || !/长将/.test(st2.result.reason), '关闭后不再因长将判负',
     st2.result ? st2.result.reason : '进行中');
}

/* ------------------------------------------------------------------ */
section('十三、撤销');
{
  const st = XQ.createGame();
  const key0 = XQ.positionKey(st);
  XQ.doFlip(st, 6, 4);
  eq(st.turn, B, '翻子后轮到黑方');
  XQ.undo(st);
  eq(st.turn, R, '撤销后回到红方');
  eq(XQ.positionKey(st), key0, '撤销后局面完全恢复');
  ok(!st.board[6][4].revealed, '撤销后该子恢复为暗子');
  eq(st.plies, 0, '撤销后步数归零');
}

/* ------------------------------------------------------------------ */
section('十四、中文记谱');
{
  const st = fromRows([
    '....k....', '.........', '.........', '.........', '.........', '.........',
    '.........', '.........',
    '....R....',
    '....K....'
  ], R);
  eq(XQ.notation(st.board, R, 8, 4, 4, 4), '车五进四', '红车直进');
  eq(XQ.notation(st.board, R, 8, 4, 8, 0), '车五平九', '红车平移');

  const st2 = fromRows([
    '....k....', '.........', '.........', '.........',
    '....r....', '.........', '.........', '.........',
    '....K....', '.........'
  ], B);
  eq(XQ.notation(st2.board, B, 4, 4, 4, 5), '车5平6', '黑方用阿拉伯数字记谱');
}

/* ------------------------------------------------------------------ */
section('十五、序列化');
{
  const st = XQ.createGame();
  XQ.doFlip(st, 6, 4);
  const st2 = XQ.deserialize(XQ.serialize(st));
  eq(XQ.positionKey(st), XQ.positionKey(st2), '序列化后局面一致');
  eq(st.turn, st2.turn, '序列化后行棋方一致');
  ok(st2.board[6][4].revealed, '翻子状态保留');
}

/* ------------------------------------------------------------------ */
section('十六、随机对局压力测试');
{
  let bad = 0;
  const results = {};
  for (let g = 0; g < 40; g++) {
    const st = XQ.createGame();
    let n = 0;
    while (st.status === 'playing' && n++ < 500) {
      const acts = XQ.legalActions(st);
      const pool = acts.moves.map(m => ({ t: 'm', m })).concat(acts.flips.map(f => ({ t: 'f', f })));
      if (!pool.length) break;
      const pick = pool[Math.floor(Math.random() * pool.length)];
      const res = pick.t === 'm'
        ? XQ.doMove(st, pick.m.from.r, pick.m.from.c, pick.m.to.r, pick.m.to.c)
        : XQ.doFlip(st, pick.f.r, pick.f.c);
      if (!res.ok) { bad++; console.log('    合法动作被拒绝：' + res.msg); break; }
      // 一致性校验：棋盘上的子 + 被吃的子 = 32
      let onBoard = 0;
      for (let r = 0; r < 10; r++) for (let c = 0; c < 9; c++) if (st.board[r][c]) onBoard++;
      if (onBoard + st.captured[R].length + st.captured[B].length !== 32) {
        bad++; console.log('    子力总数不守恒');
      }
      // 一致性地校验：暗子的 effType 必须是它的卧底身份
      for (let r = 0; r < 10; r++) for (let c = 0; c < 9; c++) {
        const p = st.board[r][c];
        if (p && !p.revealed && XQ.effType(p) !== p.disguise) { bad++; console.log('    暗子的卧底身份错误'); }
        if (p && p.revealed && XQ.effType(p) !== p.type) { bad++; console.log('    明子的兵种错误'); }
      }
    }
    const k = st.result ? (st.result.winner || '和棋') + ' · ' + st.result.reason : '未结束';
    results[k] = (results[k] || 0) + 1;
  }
  eq(bad, 0, '40 局随机对局全部正常执行');
  console.log('    结果分布：');
  Object.keys(results).sort((a, b) => results[b] - results[a])
    .forEach(k => console.log('      ' + k + ' × ' + results[k]));
}

/* ------------------------------------------------------------------ */
console.log('\n────────────────────────────');
console.log('通过 ' + pass + ' 项，失败 ' + fail + ' 项');
process.exit(fail ? 1 : 0);
