const $ = selector => document.querySelector(selector);
const select = $('#date'), body = $('#report-body');
const motionPreference = matchMedia('(prefers-reduced-motion: reduce)');
const svgNS = 'http://www.w3.org/2000/svg';
const reportCache = new Map();
let reports = [], current = -1, request = null, sections = [], activeSection = null, queued = false;

function node(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}
const number = value => value.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2});
const shortDate = date => date.slice(5).replace('-', '.');
function svgNode(tag, attributes) {
  const el = document.createElementNS(svgNS, tag);
  for (const [key, value] of Object.entries(attributes)) el.setAttribute(key, value);
  return el;
}

function plot(points, label) {
  const chart = node('div', 'sample-chart');
  const svg = svgNode('svg', {viewBox: '0 0 280 56', preserveAspectRatio: 'none', 'aria-hidden': 'true'});
  svg.classList.add('sparkline');
  const values = points.map(p => p.close), low = Math.min(...values), high = Math.max(...values), spread = high - low || 1;
  const x = i => 4 + i * 272 / (points.length - 1);
  const y = i => 48 - (points[i].close - low) / spread * 40;
  svg.append(svgNode('path', {d: points.map((p, i) => `${i ? 'L' : 'M'}${x(i)},${y(i)}`).join(' '), fill: 'none', stroke: 'currentColor', 'stroke-width': '1.7'}));
  const guide = svgNode('line', {x1: 276, x2: 276, y1: 4, y2: 52, stroke: 'currentColor', 'stroke-opacity': '.35', 'stroke-dasharray': '2 3'});
  guide.classList.add('sample-guide');
  const dot = svgNode('circle', {cx: 276, cy: y(points.length - 1), r: 3, fill: 'currentColor'});
  svg.append(guide, dot);
  const input = node('input', 'sample-control');
  input.type = 'range'; input.min = '0'; input.max = String(points.length - 1); input.step = '1'; input.value = input.max;
  input.setAttribute('aria-label', label + '历史收盘样本');
  input.setAttribute('aria-describedby', 'chart-instructions');
  const readout = node('output', 'sample-readout');
  const range = node('div', 'sample-dates');
  range.append(node('span', '', shortDate(points[0].date)), node('span', '', shortDate(points.at(-1).date)));
  function inspect(index) {
    const p = points[index];
    input.value = String(index);
    input.setAttribute('aria-valuetext', `${p.date}，收盘 ${number(p.close)}`);
    dot.setAttribute('cx', x(index)); dot.setAttribute('cy', y(index));
    guide.setAttribute('x1', x(index)); guide.setAttribute('x2', x(index));
    readout.textContent = `${shortDate(p.date)} · ${number(p.close)}`;
  }
  input.addEventListener('input', () => inspect(Number(input.value)));
  input.addEventListener('pointermove', event => {
    if (event.pointerType !== 'mouse') return;
    const bounds = input.getBoundingClientRect();
    inspect(Math.min(points.length - 1, Math.max(0, Math.round((event.clientX - bounds.left) / bounds.width * (points.length - 1)))));
  });
  input.addEventListener('pointerleave', () => {if (document.activeElement !== input) inspect(points.length - 1);});
  input.addEventListener('blur', () => inspect(points.length - 1));
  inspect(points.length - 1);
  chart.append(svg, input, readout, range);
  return chart;
}

function renderQuotes(report, index) {
  const cards = ['QQQ', 'SPY', '^VIX'].map((key, i) => {
    const d = report.market?.[key], name = key === '^VIX' ? 'VIX' : key, card = node('div', 'quote');
    const top = node('div', 'quote-top');
    top.append(node('span', 'quote-name', name), node('span', 'quote-desc', ['纳斯达克 100 ETF', '标普 500 ETF', '波动率指数'][i]));
    const price = node('div', 'quote-price');
    price.append(node('strong', d ? '' : 'unavailable', d ? number(d.close) : '暂无可靠数据'));
    if (d && Number.isFinite(d.pct)) price.append(node('span', 'change ' + (d.pct >= 0 ? 'up' : 'down'), (d.pct >= 0 ? '+' : '') + d.pct.toFixed(2) + '%'));
    const points = reports.slice(index, index + 12).reverse().map(r => r.market?.[key]).filter(p => p && Number.isFinite(p.close));
    const chart = node('div', 'chart-area');
    if (points.length > 1) chart.append(plot(points, name));
    else chart.append(node('p', 'no-chart', d ? '历史样本不足' : '该日报未提供独立行情数据'));
    const meta = node('div', 'quote-meta');
    meta.append(node('span', '', points.length > 1 ? `近 ${points.length} 期收盘样本` : '对应交易日收盘'), node('span', '', d && Number.isFinite(d.rsi14) ? 'RSI ' + d.rsi14.toFixed(1) : ''));
    card.append(top, price, chart, meta);
    return card;
  });
  $('#quotes').replaceChildren(...cards);
  $('#quotes').setAttribute('aria-busy', 'false');
}

function safeContent(source) {
  const content = source.cloneNode(true);
  content.querySelectorAll('script,style,iframe,object,embed,form').forEach(el => el.remove());
  for (const el of [content, ...content.querySelectorAll('*')]) {
    for (const attr of [...el.attributes]) {
      if (attr.name.startsWith('on') || (['href', 'src', 'xlink:href'].includes(attr.name) && /^\s*(javascript|data:text\/html):/i.test(attr.value))) el.removeAttribute(attr.name);
    }
  }
  content.querySelectorAll('a').forEach(a => {
    if (/^https?:/i.test(a.getAttribute('href') || '')) {a.target = '_blank'; a.rel = 'noopener noreferrer';}
  });
  return content;
}

function prepareTable(table, label) {
  let wrap = table.parentElement;
  if (!wrap.classList.contains('table-wrap')) {wrap = node('div', 'table-wrap'); table.before(wrap); wrap.append(table);}
  wrap.tabIndex = 0; wrap.setAttribute('role', 'region'); wrap.setAttribute('aria-label', label + '数据表，可横向滚动');
  const rows = [...table.rows], heading = rows[0];
  heading?.querySelectorAll('th').forEach(th => th.setAttribute('scope', 'col'));
  if (heading) for (let i = 0; i < heading.cells.length; i++) {
    const cells = rows.slice(1).map(row => row.cells[i]).filter(Boolean);
    const numeric = cells.some(cell => /^[+$−-]?[\d,.]+(?:%|bp|B|M)?$/.test(cell.textContent.trim())) && cells.every(cell => /^[+$−-]?[\d,.]+(?:%|bp|B|M)?$/.test(cell.textContent.trim()) || /^(暂无可靠数据|—|–|-)$/.test(cell.textContent.trim()));
    if (numeric) {heading.cells[i].classList.add('numeric'); cells.forEach(cell => cell.classList.add('numeric'));}
    if (/驱动|解释|原因|关注|说明|含义|解读|验证|催化|关键新闻|口径/.test(heading.cells[i].textContent)) {heading.cells[i].classList.add('descriptive'); cells.forEach(cell => cell.classList.add('descriptive'));}
    if (heading.cells[i].textContent.trim() === '排名') {heading.cells[i].classList.add('rank'); cells.forEach(cell => cell.classList.add('rank'));}
  }
  const hint = node('p', 'table-hint', '横向滚动查看完整数据 →');
  wrap.before(hint);
  wrap._hint = hint;
  wrap.addEventListener('scroll', () => {
    const overflow = wrap.scrollWidth > wrap.clientWidth + 2;
    hint.hidden = !overflow;
    hint.textContent = wrap.scrollLeft >= wrap.scrollWidth - wrap.clientWidth - 3 ? '← 滚动查看前面的列' : '横向滚动查看完整数据 →';
  }, {passive: true});
}

function renderDocument(html, report) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const originals = [...doc.querySelectorAll('main > section')].filter(s => s.querySelector('h2'));
  $('#toc').replaceChildren(); sections = []; activeSection = null;
  if (originals.length >= 4) {
    const ids = new Map(originals.map((section, i) => [section.id, 'report-section-' + i]));
    sections = originals.map((source, i) => {
      const section = safeContent(source); section.id = 'report-section-' + i; section.classList.add('report-section'); section.tabIndex = -1;
      const heading = section.querySelector('h2');
      const label = heading.textContent.replace(/^\s*\d+[.、\s]*/, '').trim();
      heading.replaceChildren(node('span', 'section-number', String(i).padStart(2, '0')), node('span', 'section-title', label));
      const link = node('a', 'toc-link'); link.href = '#' + section.id;
      link.append(node('span', 'toc-number', String(i).padStart(2, '0')), node('span', '', label));
      $('#toc').append(link);
      section.querySelectorAll('a[href^="#"]').forEach(a => {const id = ids.get(a.getAttribute('href').slice(1)); if (id) a.href = '#' + id;});
      section.querySelectorAll('table').forEach(table => prepareTable(table, label));
      section.querySelectorAll('.chart').forEach(chart => {chart.tabIndex = 0; chart.setAttribute('role', 'region'); chart.setAttribute('aria-label', label + '图表，可横向滚动');});
      return section;
    });
    body.replaceChildren(...sections); $('#contents').hidden = false; $('#section-count').textContent = sections.length + ' 个章节';
    const header = doc.querySelector('header .meta');
    if (header) body.prepend(node('p', 'report-source-meta', header.textContent));
  } else {
    const note = node('p', 'legacy-note', '此期保留原始报告版式。也可通过上方“独立阅读完整报告”在新页面打开。');
    const frame = node('iframe', 'legacy-report'); frame.src = report.url; frame.title = report.date + '完整历史报告';
    frame.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox');
    body.replaceChildren(note, frame); $('#contents').hidden = true; $('#section-count').textContent = '历史原版';
  }
}

function updateLayout() {
  const mobile = matchMedia('(max-width: 800px)').matches;
  const offset = mobile && !$('#contents').hidden ? $('#contents').getBoundingClientRect().height + 18 : 32;
  document.documentElement.style.setProperty('--chapter-offset', offset + 'px');
  document.querySelectorAll('.table-wrap').forEach(wrap => {const overflow = wrap.scrollWidth > wrap.clientWidth + 2; wrap._hint.hidden = !overflow; wrap.dataset.overflow = String(overflow);});
  updateReading();
}

function updateReading() {
  queued = false;
  const rect = body.getBoundingClientRect(), length = rect.height - innerHeight;
  const fraction = body.getAttribute('aria-busy') === 'false' && length > 0 ? Math.min(1, Math.max(0, -rect.top / length)) : 0;
  $('#progress').style.transform = `scaleX(${fraction})`;
  if (!sections.length) {$('#reading-position').textContent = ''; return;}
  const mobile = matchMedia('(max-width: 800px)').matches;
  const threshold = mobile ? $('#contents').getBoundingClientRect().height + 22 : 38;
  let selected = sections[0];
  for (const section of sections) {if (section.getBoundingClientRect().top <= threshold) selected = section; else break;}
  if (selected === activeSection) return;
  activeSection = selected;
  const links = [...document.querySelectorAll('.toc-link')];
  for (const link of links) {
    const active = link.hash === '#' + selected.id;
    link.classList.toggle('active', active);
    if (active) link.setAttribute('aria-current', 'location'); else link.removeAttribute('aria-current');
  }
  const active = links.find(link => link.classList.contains('active'));
  const title = selected.querySelector('.section-title').textContent;
  $('#reading-position').textContent = `${String(sections.indexOf(selected)).padStart(2, '0')} / ${String(sections.length - 1).padStart(2, '0')} · ${title}`;
  if (active && mobile && !document.activeElement.closest('#toc')) {
    const nav = $('#toc');
    const left = active.offsetLeft, right = left + active.offsetWidth;
    if (left < nav.scrollLeft || right > nav.scrollLeft + nav.clientWidth) nav.scrollTo({left: Math.max(0, left - 12), behavior: 'instant'});
  }
}
function queueReading() {if (!queued) {queued = true; requestAnimationFrame(updateReading);}}
function restoreAnchor() {
  const id = location.hash.slice(1);
  const target = /^report-section-\d+$/.test(id) ? document.getElementById(id) : null;
  if (target) {target.scrollIntoView({behavior: 'instant', block: 'start'}); target.focus({preventScroll: true});}
  updateReading();
}

async function show(index, {navigation = 'push', force = false} = {}) {
  if (index === current && !force) {restoreAnchor(); return;}
  current = index; request?.abort(); request = new AbortController(); const active = request;
  sections = []; activeSection = null;
  const r = reports[index];
  select.value = String(index); $('#issue').textContent = index === 0 ? '最新一期' : '历史回看';
  document.querySelectorAll('.date-chip').forEach(link => {
    if (link.dataset.date === r.date) link.setAttribute('aria-current', 'date');
    else link.removeAttribute('aria-current');
  });
  $('#year').textContent = r.date.slice(0, 4); $('#day').textContent = shortDate(r.date);
  $('#headline').textContent = r.title || '回看这一天的市场全貌、宏观变化与重点公司。';
  $('#full').href = r.url; $('#market-date').textContent = r.date + ' · 常规交易时段';
  renderQuotes(r, index);
  body.setAttribute('aria-busy', 'true'); body.replaceChildren(node('p', 'loading-copy', '正在打开 ' + r.date + ' 的报告…'));
  $('#toc').replaceChildren(); $('#contents').hidden = true; $('#section-count').textContent = ''; $('#reading-position').textContent = '';
  const url = new URL(location.href); url.searchParams.set('date', r.date);
  if (navigation === 'push') {url.hash = ''; history.pushState(null, '', url); scrollTo({top: 0, behavior: 'instant'});}
  else if (navigation === 'replace') {if (!/^#report-section-\d+$/.test(url.hash)) url.hash = ''; history.replaceState(null, '', url);}
  document.title = r.date + ' · QQQ & SPY 美股收盘日报';
  updateReading();
  if (navigation === 'push' && !motionPreference.matches) $('.edition').animate([{opacity: .45, transform: 'translateY(6px)'}, {opacity: 1, transform: 'translateY(0)'}], {duration: 360, easing: 'ease-out'});
  try {
    let html = reportCache.get(r.url);
    if (!html || force) {const response = await fetch(r.url, {signal: active.signal}); if (!response.ok) throw Error(); html = await response.text(); reportCache.set(r.url, html);}
    if (active.signal.aborted) return;
    renderDocument(html, r); body.setAttribute('aria-busy', 'false');
    $('#announce').textContent = '已打开 ' + r.date + ' 的日报';
    requestAnimationFrame(() => {if (!active.signal.aborted) {updateLayout(); if (navigation !== 'push') restoreAnchor();}});
  } catch (error) {
    if (error.name === 'AbortError' || active.signal.aborted) return;
    body.setAttribute('aria-busy', 'false');
    const p = node('p', 'error-copy', '报告暂时无法打开，请重试或独立阅读完整报告。');
    const retry = node('button', 'retry', '重新加载'); retry.onclick = () => show(index, {navigation: 'none', force: true});
    body.replaceChildren(p, retry); $('#announce').textContent = '报告加载失败，可重新加载'; updateReading();
  }
}

async function loadReports() {
  try {
    const response = await fetch('reports.json'); if (!response.ok) throw Error();
    reports = await response.json(); if (!Array.isArray(reports) || !reports.length) throw Error();
    select.replaceChildren(...reports.map((r, i) => {const option = node('option', '', r.date); option.value = String(i); return option;}));
    select.disabled = false;
    $('#recent-dates').replaceChildren(...reports.slice(0, 8).map((r, i) => {
      const link = node('a', 'date-chip', shortDate(r.date));
      link.href = '?date=' + r.date; link.dataset.date = r.date;
      link.setAttribute('aria-label', r.date + (i === 0 ? ' 最新一期' : ' 日报'));
      link.addEventListener('click', event => {
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault(); show(i);
      });
      return link;
    }));
    $('#archive-count').textContent = `已收录 ${reports.length} 期 · ${reports.at(-1).date} 至 ${reports[0].date}`;
    const date = new URL(location.href).searchParams.get('date') || location.hash.slice(1);
    await show(Math.max(0, reports.findIndex(r => r.date === date)), {navigation: 'replace'});
  } catch {
    select.disabled = true; $('#headline').textContent = '暂时无法读取报告目录，请重试。';
    $('#quotes').replaceChildren(node('p', 'board-loading', '收盘行情暂时无法加载')); $('#quotes').setAttribute('aria-busy', 'false');
    $('#contents').hidden = true; body.setAttribute('aria-busy', 'false');
    const retry = node('button', 'retry', '重新读取报告目录'); retry.onclick = loadReports;
    body.replaceChildren(node('p', 'error-copy', '报告目录暂时不可用。'), retry);
  }
}
select.addEventListener('change', () => show(Number(select.value)));
addEventListener('popstate', () => {if (!reports.length) return; const date = new URL(location.href).searchParams.get('date'); show(Math.max(0, reports.findIndex(r => r.date === date)), {navigation: 'none'});});
addEventListener('scroll', queueReading, {passive: true});
addEventListener('resize', updateLayout);
new ResizeObserver(updateLayout).observe(body);
loadReports();
