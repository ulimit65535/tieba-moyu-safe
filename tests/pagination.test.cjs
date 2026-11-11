const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');
const source = fs.readFileSync('tieba-moyu.user.js', 'utf8').replace('    script.init();', '    window.testAPI = { script, readPostPagination, postPageUrl, findNextPageUrl, postFloor, fetchTiebaPage }; return;\n    script.init();');
function setup(html = '', url = 'https://tieba.baidu.com/p/123') {
  const dom = new JSDOM(html, { url, runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;
  const storage = new Map();
  w.GM_registerMenuCommand = () => {};
  w.GM_getValue = k => storage.get(k);
  w.GM_setValue = (k, v) => storage.set(k, v);
  w.GM_deleteValue = k => storage.delete(k);
  w.IntersectionObserver = class {
    constructor(cb, options) { this.cb = cb; this.options = options; this.disconnected = false; }
    observe(el) { this.el = el; }
    disconnect() { this.disconnected = true; }
  };
  w.eval(source);
  return { w, dom, ...w.testAPI };
}
const pager = (pn, total = 6) => `<ul class="l_posts_num"><li class="l_pager pb_list_pager"><span class="tP">${pn}</span><a href="/p/123?pn=${total}">尾页</a></li><li class="l_reply_num">209 回复贴，共 <span>${total}</span> 页</li><li><input max-page="${total}"></li></ul>`;
const floor = n => `<div class="l_post j_l_post" data-field='{"author":{"user_name":"tester"},"content":{"post_no":${n},"post_id":"${1000 + n}"}}'><div class="d_post_content">测试楼层 ${n}</div></div>`;
const doc = (w, h) => new w.DOMParser().parseFromString(h, 'text/html');

test('实际贴吧结构：总页数在分页器兄弟节点，下一页没有 next 类', () => {
  const x = setup(pager(1));
  assert.equal(x.readPostPagination(x.w.document, x.w.location.href).totalPages, 6);
  assert.equal(x.readPostPagination(x.w.document, x.w.location.href).nextUrl, 'https://tieba.baidu.com/p/123?pn=2');
  x.dom.window.close();
});
test('支持尾页链接、max-page、直接访问中间页及最后一页', () => {
  const x = setup();
  assert.equal(x.readPostPagination(doc(x.w, '<li class="l_pager"><a href="?pn=20">尾页</a></li>'), x.w.location.href).totalPages, 20);
  assert.equal(x.readPostPagination(doc(x.w, '<input max-page="12">'), x.w.location.href).totalPages, 12);
  assert.equal(x.readPostPagination(doc(x.w, pager(3)), 'https://tieba.baidu.com/p/123?pn=3').currentPage, 3);
  assert.equal(x.readPostPagination(doc(x.w, pager(6)), 'https://tieba.baidu.com/p/123?pn=6').nextUrl, null);
  assert.equal(x.readPostPagination(doc(x.w, floor(1)), x.w.location.href).totalPages, 1);
  x.dom.window.close();
});
test('分页 URL 保留只看楼主，拒绝站外链接且不误选上一页', () => {
  const x = setup();
  assert.equal(x.postPageUrl('https://tieba.baidu.com/p/123?see_lz=1&pn=2&pid=55#55', 3), 'https://tieba.baidu.com/p/123?see_lz=1&pn=3');
  assert.throws(() => x.postPageUrl('https://evil.example/p/123', 2));
  const d = doc(x.w, '<li class="l_pager"><a href="https://evil.example/p/123?pn=99">尾页</a><a href="/p/999?pn=88">尾页</a></li>');
  assert.equal(x.readPostPagination(d, x.w.location.href).totalPages, 1);
  const forum = doc(x.w, '<div id="frs_list_pager"><a href="?kw=test&pn=0">上一页</a><a href="?kw=test&pn=100">下一页</a><a href="?kw=test&pn=900">尾页</a></div>');
  assert.equal(x.findNextPageUrl(forum, 'https://tieba.baidu.com/f?kw=test&pn=50'), 'https://tieba.baidu.com/f?kw=test&pn=100');
  x.dom.window.close();
});
test('滑块点击能切换，保存后立即启用自动翻页，关闭后断开观察器', () => {
  const x = setup('<div id="tb__excel_overlay" class="active"><div class="tb__pagination"></div></div>');
  const { script, w } = x;
  script.setting.normal.excelMode = true;
  const excel = script.getModule('ExcelMode');
  excel._sheetCache.__home__ = { rows: [], type: 'forms', currentPage: 1 };
  excel._nextPageUrls.__home__ = 'https://tieba.baidu.com/p/123?pn=2';
  script.getModule('SettingPanel').initFunc(script);
  script.openSettingPanel();
  const cb = w.document.getElementById('tb__cb_autoPage');
  cb.nextElementSibling.click();
  assert.equal(cb.checked, true);
  script.saveSetting('');
  const auto = script.getModule('AutoPage');
  assert.equal(script.setting.normal.autoPage, true);
  assert.equal(auto._observer.options.root.id, 'tb__excel_overlay');
  const old = auto._observer;
  cb.nextElementSibling.click();
  script.saveSetting('');
  assert.equal(script.setting.normal.autoPage, false);
  assert.equal(old.disconnected, true);
  assert.equal(auto._observer, null);
  w.close();
});
function excelSetup() {
  const x = setup('<div id="tb__excel_overlay" class="active"><div id="tb__excel_content"></div><span id="tb__row_count"></span></div>');
  const excel = x.script.getModule('ExcelMode');
  excel._ctx = x.script;
  excel._active = true;
  x.script.setting.normal.excelMode = true;
  excel._sheetCache.__home__ = { rows: [['30楼', 'tester', '旧内容', '']], type: 'forms', currentPage: 1, totalPages: 6, baseUrl: x.w.location.href };
  excel._nextPageUrls.__home__ = 'https://tieba.baidu.com/p/123?pn=2';
  return { ...x, excel, overlay: x.w.document.getElementById('tb__excel_overlay') };
}
test('自动翻页追加真实楼层，手动翻页替换内容，跳转可到尾页', async () => {
  const x = excelSetup();
  x.w.fetch = async url => ({ ok: true, text: async () => { const pn = Number(new URL(url).searchParams.get('pn')); return pager(pn) + floor(pn === 2 ? 35 : 180); } });
  x.overlay.scrollTop = 123;
  await x.excel._loadPostPage(x.overlay, x.w.location.href, 2, true);
  assert.deepEqual(Array.from(x.excel._sheetCache.__home__.rows, row => row[0]), ['30楼', '35楼']);
  assert.equal(x.overlay.scrollTop, 123);
  assert.equal(x.excel._sheetCache.__home__.currentPage, 2);
  await x.excel._loadPostPage(x.overlay, x.w.location.href, 6);
  assert.equal(x.excel._sheetCache.__home__.rows.length, 1);
  assert.equal(x.excel._nextPageUrls.__home__, null);
  assert.equal(x.overlay.querySelector('.tb__page-next').disabled, true);
  x.w.close();
});
test('请求失败、空响应或错误页码保留内容并释放加载锁，避免重复追加首页', async () => {
  const x = excelSetup();
  for (const response of [null, '', pager(1) + floor(1)]) {
    x.w.fetch = async () => { if (response === null) throw Error('network'); return { ok: true, text: async () => response }; };
    await x.excel._loadPostPage(x.overlay, x.w.location.href, 2, true);
    assert.equal(x.excel._sheetCache.__home__.rows[0][0], '30楼');
    assert.equal(x.excel._loadingMore, false);
    assert.ok(x.overlay.textContent.includes('旧内容'));
  }
  x.w.close();
});
test('等待响应时切换工作表不会覆盖当前工作表', async () => {
  const x = excelSetup();
  let resolve;
  x.w.fetch = () => new Promise(r => resolve = r);
  const loading = x.excel._loadPostPage(x.overlay, x.w.location.href, 2, true);
  x.excel._currentSheet = 'other';
  x.overlay.querySelector('#tb__excel_content').textContent = '其他工作表';
  resolve({ ok: true, text: async () => pager(2) + floor(35) });
  await loading;
  assert.ok(x.overlay.textContent.includes('其他工作表'));
  assert.equal(x.excel._sheetCache.__home__.currentPage, 2);
  x.w.close();
});
test('保持 HTTPS 贴吧同源 GET 和禁止重定向，HTTP 错误会拒绝', async () => {
  const x = setup();
  await assert.rejects(x.fetchTiebaPage('https://evil.example/p/123'));
  let options;
  x.w.fetch = async (_, opts) => { options = opts; return { ok: false, status: 403 }; };
  await assert.rejects(x.fetchTiebaPage('/p/123'), /403/);
  assert.equal(options.method, 'GET');
  assert.equal(options.redirect, 'error');
  assert.equal(options.credentials, 'same-origin');
  x.w.close();
});
test('滚动观察器只触发当前工作表的下一页，加载中不重复请求', async () => {
  const x = excelSetup();
  x.script.setting.normal.autoPage = true;
  const auto = x.script.getModule('AutoPage');
  x.excel._renderTable(x.overlay, x.excel._sheetCache.__home__.rows, 'forms');
  const observer = auto._observer;
  let called = 0;
  x.excel._loadPostPage = (_, base, pn, append) => { called++; assert.equal(base, x.w.location.href); assert.equal(pn, 2); assert.equal(append, true); x.excel._loadingMore = true; };
  observer.cb([{ isIntersecting: true }]);
  observer.cb([{ isIntersecting: true }]);
  assert.equal(called, 1);
  assert.equal(observer.disconnected, true);
  x.w.close();
});

test('工作表仅来自我的贴吧，排除导航推广和全页回退，保留去重及旧编码', () => {
  const x = setup(`<nav><a href="/f?kw=应用中心">应用中心</a><a href="/f?kw=手游先锋">手游先锋</a></nav>
    <div class="sug_list"><a href="/f?kw=玩家认证">玩家认证</a></div>`, 'https://tieba.baidu.com/f?kw=测试');
  const excel = x.script.getModule('ExcelMode');
  assert.equal(excel._collectBars().length, 0);
  x.w.document.body.insertAdjacentHTML('beforeend', `<div class="e_myforum">
    <a href="/f?kw=玩家认证">手游0星达人</a>
    <a href="/f?kw=应用中心">应用中心</a><a href="/f?kw=手游先锋">手游先锋</a>
    <a href="/f?fr=index&kw=明日方舟">明日方舟</a><a href="/f?kw=明日方舟">重复</a>
    <a href="https://evil.example/f?kw=伪造">伪造</a><a href="/f?kw=">空</a>
    <a href="/p/123?kw=帖子">帖子</a><a href="/f?kw=%CD%BC%C0%AD%B6%A1">图拉丁</a></div>`);
  assert.deepEqual(Array.from(excel._collectBars(), b => b.kw), ['明日方舟', '图拉丁']);
  assert.ok(excel._bars[1].href.includes('%CD%BC%C0%AD%B6%A1'));
  x.w.close();
});
const feedItem = (href = '/f?kw=%E5%9B%BE%E6%8B%89%E4%B8%81') => `<li class="j_feed_li"><span class="n_name"><a href="${href}">图拉丁吧</a></span><a href="/p/123">测试标题</a><div class="n_txt">摘要</div></li>`;
test('首页来源渲染真实链接，点击不会被帖子处理器拦截', () => {
  const x = setup(`<ul>${feedItem()}</ul><div id="tb__excel_overlay"><div id="tb__excel_content"></div></div>`, 'https://tieba.baidu.com/');
  const excel = x.script.getModule('ExcelMode');
  excel._ctx = x.script;
  const rows = excel._collectData(x.script, 'home');
  const overlay = x.w.document.getElementById('tb__excel_overlay');
  excel._renderTable(overlay, rows, 'home', false);
  excel._bindOverlayEvents(overlay);
  const sourceLink = overlay.querySelector('td:nth-child(3) a');
  assert.equal(new URL(sourceLink.href).searchParams.get('kw'), '图拉丁');
  assert.equal(sourceLink.textContent, '图拉丁吧');
  let openedPost = false;
  excel._openPost = () => { openedPost = true; };
  let intercepted;
  overlay.addEventListener('click', event => { intercepted = event.defaultPrevented; event.preventDefault(); });
  sourceLink.dispatchEvent(new x.w.MouseEvent('click', { bubbles: true, cancelable: true }));
  assert.equal(intercepted, false);
  assert.equal(openedPost, false);
  overlay.querySelector('td:nth-child(4) a').click();
  assert.equal(openedPost, true);
  for (const href of ['javascript:alert(1)', 'https://evil.example/f?kw=图拉丁', '/p/123?kw=图拉丁', '/f?kw=']) {
    const item = doc(x.w, feedItem(href)).querySelector('li');
    assert.equal(excel._forumSourceCell(item), '图拉丁吧');
  }
  const legacy = doc(x.w, feedItem('/f?kw=%CD%BC%C0%AD%B6%A1')).querySelector('li');
  assert.ok(excel._forumSourceCell(legacy).html.includes('%CD%BC%C0%AD%B6%A1'));
  x.w.close();
});
test('首页滚动追加和请求下一页均保留可点击来源', async () => {
  for (const mode of ['__home_scroll__', 'https://tieba.baidu.com/?pn=2']) {
    const x = setup('<div id="tb__excel_overlay"><div id="tb__excel_content"></div></div>', 'https://tieba.baidu.com/');
    const excel = x.script.getModule('ExcelMode');
    excel._ctx = x.script;
    excel._sheetCache.__home__ = { rows: [], type: 'home' };
    excel._nextPageUrls.__home__ = mode;
    x.script.popNotification = () => {};
    if (mode === '__home_scroll__') {
      x.w.scrollTo = () => x.w.document.body.insertAdjacentHTML('beforeend', `<ul>${feedItem()}</ul>`);
      x.w.setTimeout = cb => { cb(); return 0; };
    } else {
      x.w.fetch = async () => ({ ok: true, text: async () => `<ul>${feedItem()}</ul>` });
    }
    await excel._loadMoreRows(x.w.document.getElementById('tb__excel_overlay'));
    const link = x.w.document.querySelector('#tb__excel_content td:nth-child(3) a');
    assert.ok(link, mode);
    assert.equal(new URL(link.href).searchParams.get('kw'), '图拉丁');
    x.w.close();
  }
});
