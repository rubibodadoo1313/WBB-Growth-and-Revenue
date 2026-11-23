/* Growth & Revenue dashboard.

   Preview build: reads the JSON produced by tools/import_sheets.py. There is
   no sign-in and no server yet - rows added through Paste live in
   localStorage only, and are drawn with a green edge so they are never
   mistaken for imported data. */

'use strict';

// ---------------------------------------------------------------- reference

// Who owns whom. Contractors are a filter, never a page of their own, so that
// DCA and PNL cannot render as empty scorecards next to the tracked four.
var CONTRACTORS = {
  AB:  { name: 'AB',  manager: 'Rey',   tracked: true },
  KPK: { name: 'KPK', manager: 'Rey',   tracked: true },
  HFC: { name: 'HFC', manager: 'Apple', tracked: true },
  MAP: { name: 'MAP', manager: 'Apple', tracked: true },
  DCA: { name: 'DCA', manager: 'MGP',   tracked: false },
  PNL: { name: 'PNL', manager: 'MGP',   tracked: false }
};

// Monthly targets per contractor, taken from the TARGET column of the
// Weekly Overview sheets. Editable from Admin once that page exists.
var TARGETS = { outreach: 400, responded: 50, warm: 150, calls: 15, closed: 2 };

var CCOLOR = { AB: 'var(--orange)', HFC: 'var(--blue)', KPK: 'var(--green)', MAP: 'var(--violet)' };

var RESPONDED = ['Replied', 'Warm Lead', 'Scheduled DC', 'Closed'];
var WARM = ['Warm Lead', 'Scheduled DC', 'Closed'];
var CALLS = ['Scheduled DC', 'Closed'];
var FOLLOWS = ['1st Follow Up', '2nd Follow Up', '3rd Follow Up'];
var LIVE = ['Pending', 'Replied', 'Warm Lead', 'Scheduled DC'].concat(FOLLOWS);

var SCOLOR = {
  'Sent': 'var(--slate)', 'Pending': 'var(--amber)', 'Replied': 'var(--blue)',
  'Warm Lead': 'var(--violet)', 'Scheduled DC': 'var(--orange)',
  'Closed': 'var(--green)', 'Lost': 'var(--red)', 'No Response': 'var(--slate)',
  'Nurture': 'var(--amber)', '1st Follow Up': 'var(--blue)',
  '2nd Follow Up': 'var(--blue)', '3rd Follow Up': 'var(--blue)',
  'Unspecified': 'var(--empty-ink)'
};

var MONTH_LABEL = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// A handful of rows carry obviously mistyped dates (a lone row in Dec 2025,
// one in Apr, one in May). Charting them stretches the axis across a year of
// emptiness and makes six real months unreadable, so months holding fewer
// than this many rows are treated as stray and kept off the charts and the
// month picker. They are still imported, still counted in totals, and called
// out on the Data page - hidden from the axis is not the same as discarded.
var STRAY_LIMIT = 20;

// ---------------------------------------------------------------- state

var S = {
  sum: null, quality: null, logs: {}, local: [],
  c: 'ALL', m: 'ALL', page: 'overview', logLimit: 200
};

function $(id) { return document.getElementById(id); }
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
  });
}
function n0(v) { return (v || 0).toLocaleString('en-US'); }
function pct(a, b) { return b ? (a / b * 100) : 0; }
function pct1(a, b) { return b ? (a / b * 100).toFixed(1) + '%' : '—'; }
function monthLabel(m) {
  var p = m.split('-');
  return MONTH_LABEL[+p[1]] + ' ' + p[0].slice(2);
}

// ---------------------------------------------------------------- filtering

function facts() {
  var out = [], f = S.sum.facts, i, r;
  for (i = 0; i < f.length; i++) {
    r = f[i];
    if (S.c !== 'ALL' && r.c !== S.c) continue;
    if (S.m !== 'ALL' && r.m !== S.m) continue;
    out.push(r);
  }
  return out;
}

function tally(rows, key) {
  var map = {}, i;
  for (i = 0; i < rows.length; i++) map[rows[i][key]] = (map[rows[i][key]] || 0) + rows[i].n;
  return map;
}

function sumOf(map, keys) {
  var t = 0, i;
  for (i = 0; i < keys.length; i++) t += map[keys[i]] || 0;
  return t;
}

function totals(rows) {
  var byS = tally(rows, 's'), total = 0, i;
  for (i = 0; i < rows.length; i++) total += rows[i].n;
  return {
    outreach: total,
    responded: sumOf(byS, RESPONDED),
    warm: sumOf(byS, WARM),
    calls: sumOf(byS, CALLS),
    closed: byS['Closed'] || 0,
    lost: byS['Lost'] || 0,
    follows: sumOf(byS, FOLLOWS),
    byStatus: byS
  };
}

function monthTotals() {
  var map = {}, i;
  for (i = 0; i < S.sum.facts.length; i++) {
    map[S.sum.facts[i].m] = (map[S.sum.facts[i].m] || 0) + S.sum.facts[i].n;
  }
  return map;
}

function monthsInData() {
  var t = monthTotals();
  return Object.keys(t).filter(function (m) { return t[m] >= STRAY_LIMIT; }).sort();
}

function strayMonths() {
  var t = monthTotals();
  return Object.keys(t).filter(function (m) { return t[m] < STRAY_LIMIT; }).sort()
    .map(function (m) { return { m: m, n: t[m] }; });
}

// ---------------------------------------------------------------- charts

function lineChart(series, labels) {
  var W = 640, H = 210, padL = 38, padR = 12, padT = 12, padB = 26;
  var max = 1, i, j;
  for (i = 0; i < series.length; i++)
    for (j = 0; j < series[i].values.length; j++)
      if (series[i].values[j] > max) max = series[i].values[j];
  max = Math.ceil(max / 100) * 100 || 100;

  var iw = W - padL - padR, ih = H - padT - padB;
  var stepX = labels.length > 1 ? iw / (labels.length - 1) : 0;
  var X = function (k) { return padL + k * stepX; };
  var Y = function (v) { return padT + ih - (v / max) * ih; };

  var svg = '<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Outreach volume by month">';
  for (i = 0; i <= 4; i++) {
    var gy = padT + ih - (ih / 4) * i;
    svg += '<line class="gl" x1="' + padL + '" y1="' + gy + '" x2="' + (W - padR) + '" y2="' + gy + '"/>';
    svg += '<text class="ax" x="' + (padL - 7) + '" y="' + (gy + 3.5) + '" text-anchor="end">' + n0(max / 4 * i) + '</text>';
  }
  for (i = 0; i < labels.length; i++)
    svg += '<text class="ax" x="' + X(i) + '" y="' + (H - 8) + '" text-anchor="middle">' + esc(labels[i]) + '</text>';
  for (i = 0; i < series.length; i++) {
    var d = '', s = series[i];
    for (j = 0; j < s.values.length; j++) d += (j ? 'L' : 'M') + X(j) + ' ' + Y(s.values[j]);
    svg += '<path class="ln" d="' + d + '" stroke="' + s.color + '"/>';
    for (j = 0; j < s.values.length; j++)
      svg += '<circle class="dot" cx="' + X(j) + '" cy="' + Y(s.values[j]) + '" r="3.2" fill="' + s.color + '"><title>' +
        esc(s.name + ' · ' + labels[j] + ': ' + n0(s.values[j])) + '</title></circle>';
  }
  svg += '</svg>';

  var key = '<div class="chartkey">';
  for (i = 0; i < series.length; i++)
    key += '<span><i style="background:' + series[i].color + '"></i>' + esc(series[i].name) + '</span>';
  return svg + key + '</div>';
}

function metricRows(items, opts) {
  opts = opts || {};
  var max = 0, i, html = '';
  for (i = 0; i < items.length; i++) if (items[i].value > max) max = items[i].value;
  if (opts.max) max = opts.max;
  for (i = 0; i < items.length; i++) {
    var it = items[i], w = max ? (it.value / max * 100) : 0;
    html += '<div class="mrow"><span class="lab">' + esc(it.label) + '</span>' +
      '<span class="trk"><i style="width:' + w.toFixed(1) + '%;background:' + (it.color || 'var(--orange)') + '"></i></span>' +
      '<span class="num"><b>' + n0(it.value) + '</b>' + (it.note ? ' ' + esc(it.note) : '') + '</span></div>';
  }
  return html;
}

function donut(items) {
  var total = 0, i;
  for (i = 0; i < items.length; i++) total += items[i].value;
  if (!total) return '<div class="empty">Nothing to show</div>';
  var r = 54, c = 2 * Math.PI * r, off = 0;
  var svg = '<svg viewBox="0 0 140 140" style="width:140px;height:140px;flex-shrink:0" role="img" aria-label="Status split">' +
    '<g transform="translate(70,70) rotate(-90)">';
  for (i = 0; i < items.length; i++) {
    var len = items[i].value / total * c;
    svg += '<circle r="' + r + '" fill="none" stroke="' + items[i].color + '" stroke-width="20" ' +
      'stroke-dasharray="' + len.toFixed(2) + ' ' + (c - len).toFixed(2) + '" stroke-dashoffset="' + (-off).toFixed(2) + '"><title>' +
      esc(items[i].label + ': ' + n0(items[i].value)) + '</title></circle>';
    off += len;
  }
  svg += '</g></svg>';
  var leg = '<div class="legend">';
  for (i = 0; i < items.length; i++)
    leg += '<div><i style="background:' + items[i].color + '"></i>' + esc(items[i].label) +
      '<b>' + n0(items[i].value) + '</b></div>';
  return '<div class="donut">' + svg + leg + '</div></div>';
}

function gradeClass(p) { return p >= 100 ? 'ok' : p >= 60 ? 'warn' : 'bad'; }

function kpi(label, value, sub, color) {
  return '<div class="kpi" style="--k:' + (color || 'var(--orange)') + '">' +
    '<div class="lbl">' + esc(label) + '</div>' +
    '<div class="val">' + value + '</div>' +
    '<div class="sub">' + esc(sub || '') + '</div></div>';
}

// ---------------------------------------------------------------- overview

function renderOverview() {
  var rows = facts(), t = totals(rows);
  var scope = (S.c === 'ALL' ? 'All four contractors' : S.c + ' · managed by ' + CONTRACTORS[S.c].manager);
  var solid = monthsInData();
  var span = S.m === 'ALL'
    ? (solid.length ? monthLabel(solid[0]) + ' – ' + monthLabel(solid[solid.length - 1]) : '—')
    : monthLabel(S.m);
  $('ovSub').textContent = scope + ' · ' + span + ' · ' + n0(t.outreach) + ' outreach rows';

  $('ovKpis').innerHTML =
    kpi('Outreach', n0(t.outreach), 'logged touches') +
    kpi('Responded', n0(t.responded), pct1(t.responded, t.outreach) + ' of outreach', 'var(--blue)') +
    kpi('Warm leads', n0(t.warm), pct1(t.warm, t.outreach) + ' of outreach', 'var(--violet)') +
    kpi('Discovery calls', n0(t.calls), pct1(t.calls, t.warm) + ' of warm', 'var(--amber)') +
    kpi('Closed', n0(t.closed), pct1(t.closed, t.outreach) + ' of outreach', 'var(--green)') +
    kpi('Lost', n0(t.lost), pct1(t.lost, t.outreach) + ' of outreach', 'var(--red)');

  var months = solid.filter(function (m) { return S.m === 'ALL' || m === S.m; });
  var labels = months.map(monthLabel);
  var codes = S.c === 'ALL' ? ['AB', 'HFC', 'KPK', 'MAP'] : [S.c];
  var series = codes.map(function (code) {
    return {
      name: code, color: CCOLOR[code] || 'var(--orange)',
      values: months.map(function (m) {
        var n = 0, i;
        for (i = 0; i < S.sum.facts.length; i++) {
          var f = S.sum.facts[i];
          if (f.m === m && f.c === code) n += f.n;
        }
        return n;
      })
    };
  });
  $('ovTrend').innerHTML = months.length ? lineChart(series, labels) : '<div class="empty">No data</div>';
  $('ovTrendNote').textContent = months.length + ' months';

  $('ovFunnel').innerHTML = metricRows([
    { label: 'Outreach', value: t.outreach, color: 'var(--slate)' },
    { label: 'Responded', value: t.responded, color: 'var(--blue)', note: pct1(t.responded, t.outreach) },
    { label: 'Warm lead', value: t.warm, color: 'var(--violet)', note: pct1(t.warm, t.outreach) },
    { label: 'Discovery call', value: t.calls, color: 'var(--orange)', note: pct1(t.calls, t.outreach) },
    { label: 'Closed', value: t.closed, color: 'var(--green)', note: pct1(t.closed, t.outreach) }
  ], { max: t.outreach });

  var statusItems = Object.keys(t.byStatus).sort(function (a, b) { return t.byStatus[b] - t.byStatus[a]; })
    .map(function (k) { return { label: k, value: t.byStatus[k], color: SCOLOR[k] || 'var(--slate)' }; });
  $('ovStatus').innerHTML = donut(statusItems);

  // Volume per day actually worked - the rate view raw monthly totals hide.
  var byMonth = {}, days = {};
  for (var i = 0; i < S.sum.daily.length; i++) {
    var d = S.sum.daily[i];
    if (S.c !== 'ALL' && d.c !== S.c) continue;
    var m = d.d.slice(0, 7);
    if (S.m !== 'ALL' && m !== S.m) continue;
    if (solid.indexOf(m) < 0) continue;
    byMonth[m] = (byMonth[m] || 0) + d.n;
    (days[m] = days[m] || {})[d.d] = 1;
  }
  var rateItems = Object.keys(byMonth).sort().map(function (m2) {
    var dayCount = Object.keys(days[m2]).length;
    return {
      label: monthLabel(m2), value: Math.round(byMonth[m2] / dayCount),
      color: 'var(--orange)', note: 'over ' + dayCount + 'd'
    };
  });
  $('ovRate').innerHTML = rateItems.length
    ? metricRows(rateItems) + '<p class="note" style="margin-top:12px">Dated rows only, divided by the days actually worked. A month that looks like a collapse in raw volume is often flat once you divide by days.</p>'
    : '<div class="empty">No dated rows in this selection</div>';
}

// ---------------------------------------------------------------- performance

function renderPerformance() {
  var months = monthsInData();
  var month = S.m === 'ALL' ? months[months.length - 1] : S.m;
  if (!month) { $('perfTargets').innerHTML = '<div class="empty">No data</div>'; return; }
  $('perfMonthNote').textContent = monthLabel(month) + (S.m === 'ALL' ? ' (latest)' : '');

  var codes = (S.c === 'ALL' ? ['AB', 'HFC', 'KPK', 'MAP'] : [S.c]);
  var html = '<div class="tgrid">', i;
  var agg = { outreach: 0, responded: 0, warm: 0, calls: 0, closed: 0 };

  for (i = 0; i < codes.length; i++) {
    var code = codes[i];
    var rows = S.sum.facts.filter(function (f) { return f.m === month && f.c === code; });
    var t = totals(rows);
    agg.outreach += t.outreach; agg.responded += t.responded; agg.warm += t.warm;
    agg.calls += t.calls; agg.closed += t.closed;

    var lines = [
      ['Outreach', t.outreach, TARGETS.outreach],
      ['Responded', t.responded, TARGETS.responded],
      ['Warm leads', t.warm, TARGETS.warm],
      ['Discovery calls', t.calls, TARGETS.calls],
      ['Closed', t.closed, TARGETS.closed]
    ];
    html += '<div class="tgcard"><h3>' + esc(code) + '<span class="who">' + esc(CONTRACTORS[code].manager) + '</span></h3>';
    for (var j = 0; j < lines.length; j++) {
      var p = pct(lines[j][1], lines[j][2]), g = gradeClass(p);
      html += '<div class="mrow"><span class="lab">' + lines[j][0] + '</span>' +
        '<span class="trk"><i class="' + g + '" style="width:' + Math.min(p, 100).toFixed(1) + '%"></i></span>' +
        '<span class="num"><b>' + n0(lines[j][1]) + '</b> / ' + n0(lines[j][2]) +
        ' <span class="' + g + '">' + p.toFixed(0) + '%</span></span></div>';
    }
    html += '</div>';
  }
  $('perfTargets').innerHTML = html + '</div>';

  var tgt = codes.length;
  $('perfKpis').innerHTML =
    kpi('Outreach', n0(agg.outreach), 'target ' + n0(TARGETS.outreach * tgt)) +
    kpi('Responded', n0(agg.responded), 'target ' + n0(TARGETS.responded * tgt), 'var(--blue)') +
    kpi('Discovery calls', n0(agg.calls), 'target ' + n0(TARGETS.calls * tgt), 'var(--amber)') +
    kpi('Closed', n0(agg.closed), 'target ' + n0(TARGETS.closed * tgt), 'var(--green)');

  // Week derived from the date, never typed - this is the fix for 662 vs 650.
  var weeks = {}, codesSeen = {};
  for (var k = 0; k < S.sum.weekly.length; k++) {
    var w = S.sum.weekly[k];
    if (w.m !== month) continue;
    if (S.c !== 'ALL' && w.c !== S.c) continue;
    (weeks[w.w] = weeks[w.w] || {})[w.c] = w.n;
    codesSeen[w.c] = 1;
  }
  var wk = Object.keys(weeks).sort(), cs = Object.keys(codesSeen).sort();
  var th = '<thead><tr><th>Week</th>';
  for (i = 0; i < cs.length; i++) th += '<th class="num">' + esc(cs[i]) + '</th>';
  th += '<th class="num">Total</th></tr></thead><tbody>';
  for (i = 0; i < wk.length; i++) {
    var rowTotal = 0;
    th += '<tr><td class="tight">Week ' + esc(wk[i]) + '</td>';
    for (var q = 0; q < cs.length; q++) {
      var v = weeks[wk[i]][cs[q]] || 0; rowTotal += v;
      th += '<td class="num">' + n0(v) + '</td>';
    }
    th += '<td class="num"><b>' + n0(rowTotal) + '</b></td></tr>';
  }
  $('perfWeeks').innerHTML = wk.length ? th + '</tbody>'
    : '<tbody><tr><td class="empty">No data for this month</td></tr></tbody>';
}

// ---------------------------------------------------------------- analytics

function renderAnalytics() {
  var rows = facts(), i;

  var plats = {};
  for (i = 0; i < rows.length; i++) {
    var r = rows[i], p = r.p || 'Unspecified';
    var e = plats[p] = plats[p] || { outreach: 0, responded: 0, warm: 0, calls: 0, closed: 0 };
    e.outreach += r.n;
    if (RESPONDED.indexOf(r.s) >= 0) e.responded += r.n;
    if (WARM.indexOf(r.s) >= 0) e.warm += r.n;
    if (CALLS.indexOf(r.s) >= 0) e.calls += r.n;
    if (r.s === 'Closed') e.closed += r.n;
  }
  var names = Object.keys(plats).sort(function (a, b) { return plats[b].outreach - plats[a].outreach; });
  var html = '<thead><tr><th>Platform</th><th class="num">Outreach</th><th class="num">Responded</th>' +
    '<th class="num">Reply rate</th><th class="num">Warm</th><th class="num">Calls</th>' +
    '<th class="num">Closed</th><th class="num">Close rate</th></tr></thead><tbody>';
  var best = null, closer = null, totalClosed = 0;
  for (i = 0; i < names.length; i++) {
    var e2 = plats[names[i]], rr = pct(e2.responded, e2.outreach);
    totalClosed += e2.closed;
    if (e2.outreach >= 500 && (!best || rr > best.rr)) best = { name: names[i], rr: rr, closed: e2.closed };
    if (!closer || e2.closed > closer.closed) closer = { name: names[i], closed: e2.closed, rr: rr };
    html += '<tr><td class="tight"><b>' + esc(names[i]) + '</b></td>' +
      '<td class="num">' + n0(e2.outreach) + '</td>' +
      '<td class="num">' + n0(e2.responded) + '</td>' +
      '<td class="num ' + (rr >= 8 ? 'ok' : rr >= 3 ? 'warn' : '') + '">' + rr.toFixed(1) + '%</td>' +
      '<td class="num">' + n0(e2.warm) + '</td>' +
      '<td class="num">' + n0(e2.calls) + '</td>' +
      '<td class="num">' + n0(e2.closed) + '</td>' +
      '<td class="num">' + pct1(e2.closed, e2.outreach) + '</td></tr>';
  }
  $('anPlat').innerHTML = html + '</tbody>';

  // Reply rate and closes rarely point at the same platform, and closes are
  // what the business is paid for - so say both rather than letting the
  // prettier number stand alone.
  var note = '';
  if (best) note += 'Highest reply rate at meaningful volume: <b>' + esc(best.name) + '</b> at ' + best.rr.toFixed(1) + '%.';
  if (closer && closer.closed > 0) {
    note += (note ? ' ' : '') + 'But <b>' + esc(closer.name) + '</b> produced <b>' + n0(closer.closed) +
      '</b> of the ' + n0(totalClosed) + ' closed clients on a ' + closer.rr.toFixed(1) + '% reply rate';
    if (best && best.name !== closer.name) note += ', while ' + esc(best.name) + ' closed ' + n0(best.closed);
    note += '. Replies are not the goal — read this table down the Closed column first.';
  }
  $('anPlatNote').innerHTML = note;

  var byC = {};
  for (i = 0; i < rows.length; i++) {
    var rc = rows[i];
    var c = byC[rc.c] = byC[rc.c] || { outreach: 0, responded: 0, closed: 0 };
    c.outreach += rc.n;
    if (RESPONDED.indexOf(rc.s) >= 0) c.responded += rc.n;
    if (rc.s === 'Closed') c.closed += rc.n;
  }
  var cItems = Object.keys(byC).sort().map(function (code) {
    return {
      label: code, value: byC[code].outreach, color: CCOLOR[code] || 'var(--orange)',
      note: pct1(byC[code].responded, byC[code].outreach) + ' reply'
    };
  });
  $('anContractors').innerHTML = cItems.length
    ? metricRows(cItems) + '<p class="note" style="margin-top:12px">Volume is the bar; reply rate is the number beside it. The two rarely agree, which is the point.</p>'
    : '<div class="empty">No data</div>';

  var byS = tally(rows, 's');
  var fItems = FOLLOWS.map(function (f) {
    return { label: f.replace(' Follow Up', ''), value: byS[f] || 0, color: 'var(--blue)' };
  });
  var anomaly = (byS['3rd Follow Up'] || 0) > (byS['2nd Follow Up'] || 0);
  $('anFollow').innerHTML = metricRows(fItems) +
    '<p class="note" style="margin-top:12px">' +
    (anomaly
      ? 'Third follow-ups outnumber seconds, which is not possible if every prospect passes through both. Status is being <b>overwritten</b> rather than appended, so the history is lost. Logging status changes as events fixes this.'
      : 'Counts fall as you would expect across the follow-up sequence.') + '</p>';

  var roles = S.sum.roles.filter(function (r2) { return r2.n >= 20; });
  roles.sort(function (a, b) { return pct(b.rep, b.n) - pct(a.rep, a.n); });
  var rh = '<thead><tr><th>Role title</th><th class="num">Touches</th><th class="num">Responded</th><th class="num">Reply rate</th><th class="num">Closed</th></tr></thead><tbody>';
  for (i = 0; i < Math.min(roles.length, 40); i++) {
    var rr2 = pct(roles[i].rep, roles[i].n);
    rh += '<tr><td><span class="trunc">' + esc(roles[i].r) + '</span></td>' +
      '<td class="num">' + n0(roles[i].n) + '</td>' +
      '<td class="num">' + n0(roles[i].rep) + '</td>' +
      '<td class="num ' + (rr2 >= 8 ? 'ok' : rr2 >= 3 ? 'warn' : '') + '">' + rr2.toFixed(1) + '%</td>' +
      '<td class="num">' + n0(roles[i].won) + '</td></tr>';
  }
  $('anRoles').innerHTML = roles.length ? rh + '</tbody>'
    : '<tbody><tr><td class="empty">Not enough role data in this selection</td></tr></tbody>';
}

// ---------------------------------------------------------------- log

function loadLogs(then) {
  var need = (S.c === 'ALL' ? ['AB', 'HFC', 'KPK', 'MAP'] : [S.c])
    .filter(function (c) { return !S.logs[c]; });
  if (!need.length) { then(); return; }
  var left = need.length;
  need.forEach(function (code) {
    fetch('data/outreach-' + code + '.json')
      .then(function (r) { return r.json(); })
      .then(function (rows) { S.logs[code] = rows; })
      .catch(function () { S.logs[code] = []; })
      .then(function () { if (--left === 0) then(); });
  });
}

function currentRows() {
  var codes = (S.c === 'ALL' ? ['AB', 'HFC', 'KPK', 'MAP'] : [S.c]);
  var out = [], i, j;
  for (i = 0; i < codes.length; i++) {
    var rows = S.logs[codes[i]] || [];
    for (j = 0; j < rows.length; j++) {
      if (S.m !== 'ALL' && rows[j].d.slice(0, 7) !== S.m) continue;
      out.push(rows[j]);
    }
  }
  for (i = 0; i < S.local.length; i++) {
    var lr = S.local[i];
    if (S.c !== 'ALL' && lr.c !== S.c) continue;
    if (S.m !== 'ALL' && lr.d.slice(0, 7) !== S.m) continue;
    out.push(lr);
  }
  out.sort(function (a, b) { return a.d < b.d ? 1 : a.d > b.d ? -1 : 0; });
  return out;
}

function filteredRows() {
  var q = ($('logQ').value || '').toLowerCase().trim();
  var st = $('logS').value, pl = $('logP').value;
  return currentRows().filter(function (r) {
    if (st && st !== 'ALL' && (r.s || 'Unspecified') !== st) return false;
    if (pl && pl !== 'ALL' && (r.p || 'Unspecified') !== pl) return false;
    if (q) {
      var hay = ((r.co || '') + ' ' + (r.r || '') + ' ' + (r.e || '') + ' ' + (r.n || '')).toLowerCase();
      if (hay.indexOf(q) < 0) return false;
    }
    return true;
  });
}

function renderLog() {
  if (!S.logs[S.c === 'ALL' ? 'AB' : S.c]) {
    $('logTable').innerHTML = '<tbody><tr><td class="loadnote">Loading the outreach log…</td></tr></tbody>';
    loadLogs(function () { fillLogFilters(); renderLog(); });
    return;
  }
  var rows = filteredRows();
  $('logCount').textContent = n0(rows.length) + ' rows';
  var shown = rows.slice(0, S.logLimit);
  var html = '<thead><tr><th>Date</th><th>Contractor</th><th>Company</th><th>Role</th>' +
    '<th>Platform</th><th>Status</th><th>Contact</th></tr></thead><tbody>';
  for (var i = 0; i < shown.length; i++) {
    var r = shown[i];
    html += '<tr' + (r.loc ? ' class="local"' : '') + '>' +
      '<td class="tight">' + esc(r.d) + (r.inf ? '<span class="sub">inferred</span>' : '') + '</td>' +
      '<td class="tight"><span class="chip">' + esc(r.c) + '</span></td>' +
      '<td>' + (r.co ? esc(r.co) : '<span class="note">—</span>') + '</td>' +
      '<td>' + (r.l ? '<a class="lnk" href="' + esc(r.l) + '" target="_blank" rel="noopener"><span class="trunc">' + esc(r.r || 'link') + '</span></a>'
        : '<span class="trunc">' + esc(r.r || '—') + '</span>') + '</td>' +
      '<td class="tight">' + esc(r.p || '—') + '</td>' +
      '<td class="tight"><span class="chip" style="color:' + (SCOLOR[r.s] || 'var(--muted)') + '"><i></i>' + esc(r.s || 'Unspecified') + '</span></td>' +
      '<td>' + (r.e ? esc(r.e) : '<span class="note">—</span>') + '</td></tr>';
  }
  $('logTable').innerHTML = shown.length ? html + '</tbody>'
    : '<tbody><tr><td class="empty">Nothing matches those filters</td></tr></tbody>';
  $('logMore').style.display = rows.length > S.logLimit ? '' : 'none';
  $('logMore').textContent = 'Show more (' + n0(rows.length - S.logLimit) + ' hidden)';
}

function fillLogFilters() {
  var rows = currentRows(), st = {}, pl = {}, i;
  for (i = 0; i < rows.length; i++) {
    st[rows[i].s || 'Unspecified'] = 1;
    pl[rows[i].p || 'Unspecified'] = 1;
  }
  function fill(sel, map, label) {
    var cur = sel.value || 'ALL';
    sel.innerHTML = '<option value="ALL">' + label + '</option>' +
      Object.keys(map).sort().map(function (k) { return '<option>' + esc(k) + '</option>'; }).join('');
    sel.value = cur;
    if (!sel.value) sel.value = 'ALL';
  }
  fill($('logS'), st, 'All statuses');
  fill($('logP'), pl, 'All platforms');
}

// ---------------------------------------------------------------- pipeline

function daysSince(iso) {
  return Math.floor((Date.now() - new Date(iso + 'T00:00:00').getTime()) / 86400000);
}

function renderPipeline() {
  if (!S.logs[S.c === 'ALL' ? 'AB' : S.c]) {
    $('pipeTable').innerHTML = '<tbody><tr><td class="loadnote">Loading…</td></tr></tbody>';
    loadLogs(function () { renderPipeline(); });
    return;
  }
  var rows = currentRows().filter(function (r) { return LIVE.indexOf(r.s) >= 0; });
  var stages = {}, buckets = { '0–7': 0, '8–14': 0, '15–30': 0, '31–60': 0, '60+': 0 }, due = [];
  var today = new Date().toISOString().slice(0, 10);

  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    stages[r.s] = (stages[r.s] || 0) + 1;
    var age = daysSince(r.d);
    buckets[age <= 7 ? '0–7' : age <= 14 ? '8–14' : age <= 30 ? '15–30' : age <= 60 ? '31–60' : '60+']++;
    // A row with an inferred date was stamped to the first of its month, so
    // its age is manufactured. Those rows can still be chased on an explicit
    // follow-up date, but must not be called stale on a date nobody recorded.
    var overdue = r.fu && r.fu <= today;
    if (overdue || (age > 14 && !r.inf)) due.push({ row: r, age: age, guess: !!r.inf });
  }
  due.sort(function (a, b) { return b.age - a.age; });

  var warm = rows.filter(function (r) { return WARM.indexOf(r.s) >= 0; }).length;
  $('pipeKpis').innerHTML =
    kpi('Live prospects', n0(rows.length), 'not closed or lost') +
    kpi('Warm or better', n0(warm), 'warm, call or closed', 'var(--violet)') +
    kpi('Needs action', n0(due.length), 'overdue or stale', 'var(--amber)') +
    kpi('Over 60 days', n0(buckets['60+']), 'untouched', 'var(--red)');

  $('pipeStages').innerHTML = Object.keys(stages).length ? metricRows(
    Object.keys(stages).sort(function (a, b) { return stages[b] - stages[a]; }).map(function (k) {
      return { label: k, value: stages[k], color: SCOLOR[k] || 'var(--slate)' };
    })) : '<div class="empty">No live prospects</div>';

  var guessed = rows.filter(function (r) { return r.inf; }).length;
  $('pipeAge').innerHTML = metricRows(Object.keys(buckets).map(function (k) {
    return {
      label: k + ' days', value: buckets[k],
      color: k === '60+' ? 'var(--red)' : k === '31–60' ? 'var(--amber)' : 'var(--green)'
    };
  })) + (guessed
    ? '<p class="note" style="margin-top:12px"><b>' + n0(guessed) + '</b> of these rows had no date in the sheet and were stamped to the first of their month, so their age is a guess. They are excluded from the action list below unless they carry an explicit follow-up date.</p>'
    : '');

  $('pipeActNote').textContent = n0(due.length) + ' prospects';
  var html = '<thead><tr><th>Last touch</th><th class="num">Age</th><th>Contractor</th><th>Company</th><th>Role</th><th>Status</th></tr></thead><tbody>';
  for (i = 0; i < Math.min(due.length, 100); i++) {
    var d = due[i], rr = d.row;
    html += '<tr><td class="tight">' + esc(rr.d) + (d.guess ? '<span class="sub">inferred</span>' : '') + '</td>' +
      '<td class="num ' + (d.guess ? '' : d.age > 60 ? 'bad' : d.age > 30 ? 'warn' : '') + '">' +
      (d.guess ? '—' : d.age + 'd') + '</td>' +
      '<td class="tight"><span class="chip">' + esc(rr.c) + '</span></td>' +
      '<td>' + (rr.co ? esc(rr.co) : '<span class="note">—</span>') + '</td>' +
      '<td><span class="trunc">' + esc(rr.r || '—') + '</span></td>' +
      '<td class="tight"><span class="chip" style="color:' + (SCOLOR[rr.s] || 'var(--muted)') + '"><i></i>' + esc(rr.s) + '</span></td></tr>';
  }
  $('pipeTable').innerHTML = due.length ? html + '</tbody>'
    : '<tbody><tr><td class="empty">Nothing overdue</td></tr></tbody>';
}

// ---------------------------------------------------------------- data page

function renderData() {
  var q = S.quality, m = S.sum.meta;
  $('qKpis').innerHTML =
    kpi('Rows imported', n0(q.rows_imported), 'across ' + m.workbooks + ' workbooks') +
    kpi('Duplicates removed', n0(q.duplicates_removed), 'same prospect, same day', 'var(--amber)') +
    kpi('Inferred dates', n0(q.rows_with_inferred_date), 'stamped to their month', 'var(--blue)') +
    kpi('Missing status', n0(q.missing_status), 'no status recorded', 'var(--red)');

  var lines = [
    ['Rows imported', n0(q.rows_imported)],
    ['Date range', m.first + ' to ' + m.last],
    ['Duplicates removed', n0(q.duplicates_removed)],
    ['Rows with an inferred date', n0(q.rows_with_inferred_date)],
    ['Rows dropped (no date at all)', n0(q.rows_dropped_no_date)],
    ['Missing company', n0(q.missing_company)],
    ['Missing email', n0(q.missing_email)],
    ['Missing status', n0(q.missing_status)]
  ];
  var html = '<div class="tablewrap"><table><tbody>';
  for (var i = 0; i < lines.length; i++)
    html += '<tr><td>' + esc(lines[i][0]) + '</td><td class="num"><b>' + lines[i][1] + '</b></td></tr>';
  html += '</tbody></table></div>';

  var odd = Object.keys(q.unrecognised_platforms || {}).concat(Object.keys(q.unrecognised_statuses || {}));
  html += '<p class="note" style="margin-top:12px">' + (odd.length
    ? 'Values that did not match the canonical lists: <b>' + esc(odd.join(', ')) + '</b>.'
    : 'Every platform and status value mapped to a canonical value. Variants such as <code>Sents</code>, <code>BossJobs</code> and <code>GlassdoorGlassdoor</code> were folded in on import.') + '</p>';

  var stray = strayMonths();
  if (stray.length) {
    html += '<p class="note" style="margin-top:9px">Months holding fewer than ' + STRAY_LIMIT +
      ' rows are treated as mistyped dates and kept off the charts and the month picker: <b>' +
      esc(stray.map(function (s) { return monthLabel(s.m) + ' (' + s.n + ')'; }).join(', ')) +
      '</b>. They are still imported and still counted in the totals above — worth correcting at source.</p>';
  }
  $('qTable').innerHTML = html;

  $('qExplain').innerHTML =
    '<p>In AB’s November workbook the Outreach Log holds <b>838</b> rows. <b>662</b> carry a date; only <b>650</b> carry a week label. ' +
    'Monthly Overview counted the dated rows, the weekly sheets summed the labelled ones, so the same month reported 662 and 650 on different tabs.</p>' +
    '<p>Twelve rows had a date but no week label and vanished from every weekly view. A further 176 had neither and appeared in no report at all — real work, invisible.</p>' +
    '<p>Here the week is <b>derived from the date</b> rather than typed, so a row cannot belong to a month without also belonging to a week. Every figure on this site is a query over the one table, which is why the pages cannot disagree with each other the way the tabs did.</p>';
}

// ---------------------------------------------------------------- paste

function parsePaste(text) {
  var lines = text.split(/\r?\n/).filter(function (l) { return l.trim(); });
  var out = [], bad = 0;
  for (var i = 0; i < lines.length; i++) {
    var p = lines[i].split('\t');
    var date = (p[0] || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      var alt = new Date(date);
      if (date && !isNaN(alt.getTime())) date = alt.toISOString().slice(0, 10);
      else { bad++; continue; }
    }
    out.push({
      c: S.c === 'ALL' ? 'AB' : S.c, d: date, inf: 0,
      n: (p[1] || '').trim() || null, e: (p[2] || '').trim() || null,
      co: (p[3] || '').trim() || null, p: (p[4] || '').trim() || null,
      r: (p[5] || '').trim() || null, l: (p[6] || '').trim() || null,
      s: (p[7] || '').trim() || 'Sent', nt: null, fu: null, loc: 1
    });
  }
  return { rows: out, bad: bad };
}

function setupPaste() {
  var modal = $('pasteModal');
  function close() { modal.classList.remove('on'); }
  $('btnPaste').onclick = function () {
    $('pasteBox').value = ''; $('pastePreview').textContent = '';
    $('pasteMsg').textContent = S.c === 'ALL'
      ? 'Pick a contractor first, or rows land under AB.'
      : 'Rows will be added under ' + S.c + '.';
    modal.classList.add('on'); $('pasteBox').focus();
  };
  $('pasteX').onclick = close;
  $('pasteCancel').onclick = close;
  $('pasteBox').oninput = function () {
    var r = parsePaste(this.value);
    $('pastePreview').innerHTML = this.value.trim()
      ? '<b>' + r.rows.length + '</b> row(s) ready' + (r.bad ? ', <b>' + r.bad + '</b> skipped for an unreadable date' : '')
      : '';
  };
  $('pasteSave').onclick = function () {
    var r = parsePaste($('pasteBox').value);
    if (!r.rows.length) { $('pasteMsg').textContent = 'Nothing to add — check the date column.'; return; }
    S.local = S.local.concat(r.rows);
    try { localStorage.setItem('gr-local-rows', JSON.stringify(S.local)); } catch (e) { /* private mode */ }
    close();
    S.logLimit = 200;
    fillLogFilters();
    renderLog();
  };
}

// ---------------------------------------------------------------- shell

function show(page) {
  S.page = page;
  var tabs = document.querySelectorAll('#tabs button'), i;
  for (i = 0; i < tabs.length; i++) tabs[i].classList.toggle('on', tabs[i].dataset.p === page);
  var panels = document.querySelectorAll('.panel');
  for (i = 0; i < panels.length; i++) panels[i].classList.toggle('on', panels[i].id === 'p-' + page);
  render();
}

function render() {
  if (!S.sum) return;
  if (S.page === 'overview') renderOverview();
  else if (S.page === 'performance') renderPerformance();
  else if (S.page === 'analytics') renderAnalytics();
  else if (S.page === 'log') renderLog();
  else if (S.page === 'pipeline') renderPipeline();
  else if (S.page === 'data') renderData();
}

function boot() {
  try { S.local = JSON.parse(localStorage.getItem('gr-local-rows') || '[]'); } catch (e) { S.local = []; }

  var theme = null;
  try { theme = localStorage.getItem('gr-theme'); } catch (e) { /* ignore */ }
  if (theme) document.documentElement.dataset.theme = theme;
  $('btnTheme').onclick = function () {
    var next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem('gr-theme', next); } catch (e) { /* ignore */ }
  };

  var tabs = document.querySelectorAll('#tabs button');
  for (var i = 0; i < tabs.length; i++) {
    tabs[i].onclick = function () { S.logLimit = 200; show(this.dataset.p); };
  }

  $('selC').onchange = function () { S.c = this.value; S.logLimit = 200; fillLogFilters(); render(); };
  $('selM').onchange = function () { S.m = this.value; S.logLimit = 200; render(); };
  $('logQ').oninput = function () { S.logLimit = 200; renderLog(); };
  $('logS').onchange = function () { S.logLimit = 200; renderLog(); };
  $('logP').onchange = function () { S.logLimit = 200; renderLog(); };
  $('logMore').onclick = function () { S.logLimit += 200; renderLog(); };
  setupPaste();

  Promise.all([
    fetch('data/summary.json').then(function (r) { return r.json(); }),
    fetch('data/quality.json').then(function (r) { return r.json(); })
  ]).then(function (res) {
    S.sum = res[0]; S.quality = res[1];
    $('genAt').textContent = (S.sum.meta.generated || '').replace('T', ' ');

    var codes = Object.keys(S.sum.meta.contractors).sort();
    $('selC').innerHTML = '<option value="ALL">All contractors</option>' +
      codes.map(function (c) {
        var mgr = CONTRACTORS[c] ? CONTRACTORS[c].manager : '?';
        return '<option value="' + c + '">' + c + ' · ' + mgr + '</option>';
      }).join('');

    $('selM').innerHTML = '<option value="ALL">All months</option>' +
      monthsInData().map(function (m) { return '<option value="' + m + '">' + monthLabel(m) + '</option>'; }).join('');

    render();
  }).catch(function (err) {
    $('ovSub').textContent = 'Could not load data/summary.json — run tools/import_sheets.py first, and open this over a web server rather than from the file system.';
    if (window.console) console.error(err);
  });
}

boot();
