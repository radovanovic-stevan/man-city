/* Man City Stats: single-page app, no dependencies. */
(() => {
  "use strict";

  // ------------------------------------------------------------------ state
  const S = { games: [], players: [], plog: [], goals: [], tables: {}, byId: {}, byKey: {}, box: {}, meta: {} };
  const COMPS = ["Premier League", "First Division", "Second Division", "FA Cup", "League Cup", "Champions League",
    "Europa League", "UEFA Cup", "Club World Cup", "UEFA Super Cup", "Community Shield", "EFL Trophy"];
  const LEAGUES = new Set(["Premier League", "First Division", "Second Division"]);
  const COMP_VAR = {
    "Premier League": "--c-lg", "First Division": "--c-lg", "Second Division": "--c-lg", "FA Cup": "--c-fa",
    "League Cup": "--c-lc", "Champions League": "--c-cl", "Europa League": "--c-el", "UEFA Cup": "--c-el",
    "Club World Cup": "--c-int", "UEFA Super Cup": "--c-int", "Community Shield": "--c-cs", "EFL Trophy": "--c-cs",
  };
  const COMP_SHORT = {
    "Premier League": "PL", "First Division": "Div 1", "Second Division": "Div 2", "FA Cup": "FAC", "League Cup": "LC",
    "Champions League": "UCL", "Europa League": "UEL", "UEFA Cup": "UEFA", "Club World Cup": "CWC",
    "UEFA Super Cup": "USC", "Community Shield": "CS", "EFL Trophy": "EFL T",
  };
  const STAT = ["gl", "pk", "as", "yc", "rc", "og", "ga", "cs", "gk"];
  // Transfermarkt does not list the 1999 Second Division play-offs (Wigan, then Gillingham at Wembley)
  const NOTES = { "1998-99|Second Division": "Promoted via play-offs" };
  const main = document.getElementById("main");

  // ------------------------------------------------------------------ utils
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const cssVar = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  const compColor = (c) => `var(${COMP_VAR[c] || "--muted"})`;
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const fmtDate = (d, short) => {
    const [y, m, day] = d.slice(0, 10).split("-").map(Number);
    return short ? `${MONTHS[m - 1]} ${day}` : `${MONTHS[m - 1]} ${day}, ${y}`;
  };
  const fmt1 = (v) => (v == null || isNaN(v) ? "-" : v.toFixed(1));
  const fmt2 = (v) => (v == null || isNaN(v) ? "-" : v.toFixed(2));
  const int = (n) => (n == null ? "-" : Math.round(n).toLocaleString("en-US"));
  const signed = (n) => (n > 0 ? `+${n}` : `${n}`);
  const ordinal = (n) => n + (["th", "st", "nd", "rd"][(n % 100 - 20) % 10] || ["th", "st", "nd", "rd"][n % 100] || "th");
  const initials = (n) => n.split(/\s+/).map((w) => w[0]).slice(0, 2).join("");
  const fold = (s) => s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const opp = (g) => (g.cityHome ? g.away : g.home);
  const city = (g) => (g.cityHome ? g.home : g.away);
  const margin = (g) => city(g).score - opp(g).score;
  const score = (g) => `${city(g).score}-${opp(g).score}`;
  const extra = (g) => (g.pens ? ` (${g.pens[g.cityHome ? 0 : 1]}-${g.pens[g.cityHome ? 1 : 0]} pens)` : g.aet ? " aet" : "");
  const won = (g) => g.res === "W" || g.adv === true;
  const minLabel = (m, ex) => (m == null ? "?" : `${m}${ex ? "+" + ex : ""}'`);
  const seasonsList = () => [...new Set(S.games.map((g) => g.season))].sort();
  const compsIn = (games) => COMPS.filter((c) => games.some((g) => g.comp === c));
  const RES = { W: "Win", D: "Draw", L: "Loss" };
  const wl = (g) => `<span class="wl ${g.res.toLowerCase()}" title="${RES[g.res]}${g.pens ? (g.adv ? ", won on penalties" : ", lost on penalties") : ""}">${g.res}</span>`;
  const logo = (t, cls = "logo") => (t.logo ? `<img class="${cls}" src="${esc(t.logo)}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">` : `<span class="${cls}"></span>`);
  const record = (games) => {
    const w = games.filter((g) => g.res === "W").length, d = games.filter((g) => g.res === "D").length;
    const gf = games.reduce((s, g) => s + city(g).score, 0), ga = games.reduce((s, g) => s + opp(g).score, 0);
    return { w, d, l: games.length - w - d, n: games.length, pct: games.length ? w / games.length : 0, gf, ga };
  };
  const wdl = (r) => `${r.w}-${r.d}-${r.l}`;
  const avatar = (p, cls = "avatar") =>
    `<div class="${cls}">${p && p.img ? `<img src="${esc(p.img)}" alt="" loading="lazy" onerror="this.remove()">` : ""}${p && !p.img ? esc(initials(p.n)) : ""}</div>`;
  const pLink = (k, n) => (S.byKey[k] ? `<a href="#/player/${encodeURIComponent(k)}">${esc(n || S.byKey[k].n)}</a>` : esc(n));
  const pName = (k) => S.byKey[k]?.n || k;
  const vsAt = (g) => `${g.cityHome ? "vs" : "at"} ${esc(opp(g).name)}`;

  // per-game player rows -> totals
  function sumRows(rows) {
    const t = { gp: 0, gs: 0, min: 0, nomin: 0, w: 0, d: 0 };
    STAT.forEach((s) => (t[s] = 0));
    for (const r of rows) {
      t.gp++;
      t.gs += r.st;
      if (r.min == null) t.nomin++;
      else t.min += r.min;
      const g = S.byId[r.g];
      t.w += g.res === "W" ? 1 : 0;
      t.d += g.res === "D" ? 1 : 0;
      for (const s of STAT) t[s] += r[s];
    }
    t.l = t.gp - t.w - t.d;
    t.gi = t.gl + t.as;
    return t;
  }

  // ------------------------------------------------------------------ data
  const rowsToObjects = ({ cols, rows }) => rows.map((r) => {
    const o = {};
    cols.forEach((c, i) => (o[c] = r[i]));
    return o;
  });
  async function load() {
    const [games, players, plog, goals, tables, meta] = await Promise.all(
      ["games", "players", "plog", "goals", "tables", "meta"].map((f) => fetch(`data/${f}.json`).then((r) => r.json()))
    );
    S.games = games;
    S.players = players;
    S.meta = meta;
    games.forEach((g) => (S.byId[g.id] = g));
    players.forEach((p) => (S.byKey[p.k] = p));
    tables.forEach((t) => (S.tables[t.season] = t));
    S.plog = rowsToObjects(plog);
    S.goals = rowsToObjects(goals);
  }
  async function loadBox(id) {
    if (!S.box[id]) S.box[id] = await fetch(`data/box/${encodeURIComponent(id)}.json`).then((r) => r.json());
    return S.box[id];
  }

  // league place from the final table
  function leagueRow(season) {
    const t = S.tables[season];
    return t ? t.rows.find((r) => r.id === 281) : null;
  }

  // season finish per competition: { text, title }
  function finish(season, comp) {
    const games = S.games.filter((g) => g.season === season && g.comp === comp);
    if (!games.length) return { text: "", title: false };
    const live = season === S.meta.current;
    if (LEAGUES.has(comp)) {
      const t = S.tables[season], r = leagueRow(season);
      if (!r) return { text: "", title: false };
      const n = t.rows.length;
      if (live) return { text: `${ordinal(r.pos)} · in progress`, title: false };
      if (r.pos === 1) return { text: comp === "Premier League" ? "Champions" : `Champions · promoted`, title: true };
      let note = NOTES[`${season}|${comp}`] || "";
      if (!note && comp === "First Division" && r.pos <= 2) note = "Promoted";
      if (!note && r.pos > n - 3) note = "Relegated";
      return { text: `${ordinal(r.pos)}${note ? " · " + note : ""}`, title: false };
    }
    const last = [...games].sort((a, b) => a.date.localeCompare(b.date)).pop();
    if (last.round === "Final") return won(last) ? { text: "Winners", title: true } : { text: "Runner-up", title: false };
    if (live) return { text: "In progress", title: false };
    return { text: `Out in ${last.round.replace(/^Group Stage$/, "group stage").replace(/^intermediate stage$/, "knockout play-off")}`, title: false };
  }
  function trophies() {
    const out = [];
    seasonsList().forEach((s) => COMPS.forEach((c) => { if (finish(s, c).title) out.push({ season: s, comp: c }); }));
    return out;
  }

  // ------------------------------------------------------------------ tooltip
  const tip = document.createElement("div");
  tip.className = "tip";
  document.body.appendChild(tip);
  function showTip(evt, nodes) {
    tip.replaceChildren(...nodes);
    tip.classList.add("show");
    const pad = 14;
    const r = tip.getBoundingClientRect();
    let x = evt.clientX + pad, y = evt.clientY + pad;
    if (x + r.width > innerWidth - 8) x = evt.clientX - r.width - pad;
    if (y + r.height > innerHeight - 8) y = evt.clientY - r.height - pad;
    tip.style.left = `${x + scrollX}px`;
    tip.style.top = `${y + scrollY}px`;
  }
  const hideTip = () => tip.classList.remove("show");
  const tnode = (cls, text) => {
    const d = document.createElement("div");
    d.className = cls;
    d.textContent = text;
    return d;
  };

  // ------------------------------------------------------------------ charts
  const NS = "http://www.w3.org/2000/svg";
  const el = (tag, attrs = {}, parent) => {
    const n = document.createElementNS(NS, tag);
    for (const k in attrs) n.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(n);
    return n;
  };
  const niceStep = (max, ticks = 4) => {
    const raw = max / ticks;
    const p = Math.pow(10, Math.floor(Math.log10(raw)));
    return [1, 2, 2.5, 5, 10].map((m) => m * p).find((s) => s >= raw);
  };
  // rounded-top bar path anchored to a baseline
  function barPath(x, w, y0, y1, r = 3) {
    const up = y1 < y0;
    const h = Math.abs(y1 - y0);
    r = Math.min(r, w / 2, h);
    if (h < 0.5) return "";
    if (up) return `M${x},${y0}V${y1 + r}Q${x},${y1} ${x + r},${y1}H${x + w - r}Q${x + w},${y1} ${x + w},${y1 + r}V${y0}Z`;
    return `M${x},${y0}V${y1 - r}Q${x},${y1} ${x + r},${y1}H${x + w - r}Q${x + w},${y1} ${x + w},${y1 - r}V${y0}Z`;
  }

  /** Columns per item (chronological). value(it) -> number; color(it) -> css color.
   *  Zero values get a short tick on the baseline so draws stay visible. */
  function columnChart(host, items, { value, color, tipFor, onClick, height = 220, bands = null, yLabel = "", zeroTick = false }) {
    host.innerHTML = "";
    host.classList.add("chart");
    const W = Math.max(host.clientWidth || 800, 320), H = height;
    const m = { t: bands ? 26 : 10, r: 8, b: 22, l: 36 };
    const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": yLabel });
    host.appendChild(svg);
    const vals = items.map(value);
    let max = Math.max(1, ...vals), min = Math.min(0, ...vals);
    const step = niceStep(Math.max(max, -min) || 1);
    max = Math.ceil(max / step) * step;
    min = Math.floor(min / step) * step;
    const iw = W - m.l - m.r, ih = H - m.t - m.b;
    const y = (v) => m.t + ih - ((v - min) / (max - min)) * ih;
    const slot = iw / items.length;
    const bw = Math.max(1, Math.min(24, slot - (slot > 4 ? 2 : 1)));
    for (let v = min; v <= max + 1e-9; v += step) {
      el("line", { x1: m.l, x2: W - m.r, y1: y(v), y2: y(v), class: v === 0 ? "baseline" : "gridline" }, svg);
      const t = el("text", { x: m.l - 6, y: y(v) + 4, "text-anchor": "end" }, svg);
      t.textContent = v;
    }
    if (bands) {
      const short = bands.length > 1 && iw / bands.length < 48;
      bands.forEach((b, i) => {
        const x0 = m.l + b.from * slot;
        if (b.from > 0) el("line", { x1: x0, x2: x0, y1: m.t - 18, y2: H - m.b, class: "gridline" }, svg);
        if (short && i % 2) return;
        const t = el("text", { x: x0 + 3, y: m.t - 10 }, svg);
        t.textContent = short ? `'${b.label.slice(2, 4)}` : b.label;
        t.style.fill = cssVar("--ink-2");
        t.style.fontWeight = 600;
      });
    }
    const g = el("g", {}, svg);
    items.forEach((it, i) => {
      const x = m.l + i * slot + (slot - bw) / 2;
      if (vals[i] === 0 && zeroTick) {
        const r = el("rect", { x, y: y(0) - 1.5, width: bw, height: 3, rx: 1 }, g);
        r.style.fill = color(it);
        return;
      }
      const p = el("path", { d: barPath(x, bw, y(0), y(vals[i]), bw > 6 ? 4 : 1) }, g);
      p.style.fill = color(it);
    });
    // hover layer: nearest column
    const hl = el("rect", { y: m.t, height: ih, width: Math.max(slot, 2), fill: cssVar("--ink"), opacity: 0 }, svg);
    hl.style.opacity = 0;
    hl.style.fillOpacity = 0.06;
    const hit = el("rect", { x: m.l, y: 0, width: iw, height: H, fill: "transparent" }, svg);
    const idxAt = (evt) => {
      const r = svg.getBoundingClientRect();
      const px = ((evt.clientX - r.left) / r.width) * W;
      return Math.max(0, Math.min(items.length - 1, Math.floor((px - m.l) / slot)));
    };
    hit.addEventListener("pointermove", (evt) => {
      const i = idxAt(evt);
      hl.setAttribute("x", m.l + i * slot);
      hl.style.opacity = 1;
      showTip(evt, tipFor(items[i]));
    });
    hit.addEventListener("pointerleave", () => { hideTip(); hl.style.opacity = 0; });
    if (onClick) {
      hit.style.cursor = "pointer";
      hit.addEventListener("click", (evt) => { hideTip(); onClick(items[idxAt(evt)]); });
    }
  }

  const resColor = (g) => (g.res === "W" ? "var(--pos)" : g.res === "L" ? "var(--neg)" : "var(--zero)");
  const gameTip = (g) => [
    tnode("tv", `${score(g)}${extra(g)}`),
    tnode("", `${RES[g.res]} ${g.cityHome ? "vs" : "at"} ${opp(g).name}`),
    tnode("ts", `${g.comp} · ${g.round}`),
    tnode("ts", fmtDate(g.date)),
  ];

  function marginChart(host, games, withBands) {
    let bands = null;
    if (withBands) {
      bands = [];
      games.forEach((g, i) => {
        if (!bands.length || bands[bands.length - 1].label !== g.season) bands.push({ label: g.season, from: i });
      });
    }
    columnChart(host, games, {
      value: margin,
      color: resColor,
      tipFor: gameTip,
      onClick: (g) => (location.hash = `#/game/${g.id}`),
      bands,
      zeroTick: true,
      yLabel: "Goal difference per game",
    });
  }

  /** League finish per season on one ladder: Premier League places first, then the
   *  First Division below it, then the Second Division. */
  function finishChart(host) {
    host.innerHTML = "";
    host.classList.add("chart", "finish-chart");
    const seasons = seasonsList().filter((s) => S.tables[s]);
    const tiers = ["Premier League", "First Division", "Second Division"];
    const size = { "Premier League": 20, "First Division": 24, "Second Division": 24 };
    const offset = (comp) => tiers.slice(0, tiers.indexOf(comp)).reduce((s, c) => s + size[c], 0);
    const pts = seasons.map((s) => {
      const t = S.tables[s], r = leagueRow(s);
      return { s, comp: t.comp, r, n: t.rows.length, rank: offset(t.comp) + Math.min(r.pos, size[t.comp]) };
    });
    const W = Math.max(host.clientWidth || 800, 320), H = 260;
    const m = { t: 10, r: 12, b: 24, l: 12 };
    const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": "League finish by season" });
    host.appendChild(svg);
    const total = tiers.reduce((s, c) => s + size[c], 0);
    const iw = W - m.l - m.r, ih = H - m.t - m.b;
    const y = (rank) => m.t + ((rank - 0.5) / total) * ih;
    const slot = iw / pts.length;
    const x = (i) => m.l + slot * (i + 0.5);
    tiers.forEach((c, i) => {
      const y0 = m.t + (offset(c) / total) * ih, h = (size[c] / total) * ih;
      if (i % 2 === 0) el("rect", { x: m.l, y: y0, width: iw, height: h, class: "band" }, svg);
      const t = el("text", { x: W - m.r - 6, y: y0 + h - 6, "text-anchor": "end", class: "band-label" }, svg);
      t.textContent = c;
    });
    const top = el("line", { x1: m.l, x2: W - m.r, y1: y(1), y2: y(1), class: "gridline" }, svg);
    top.style.strokeDasharray = "3 3";
    el("path", { d: pts.map((p, i) => `${i ? "L" : "M"}${x(i)},${y(p.rank)}`).join(""), class: "line" }, svg);
    pts.forEach((p, i) => {
      const c = el("circle", { cx: x(i), cy: y(p.rank), r: p.r.pos === 1 ? 6 : 4.5, class: "pt" }, svg);
      c.style.fill = p.r.pos === 1 ? "var(--sky)" : p.s === S.meta.current ? "var(--muted)" : "var(--ink)";
      if (i % Math.ceil(pts.length / Math.max(1, Math.floor(iw / 44))) === 0) {
        const t = el("text", { x: x(i), y: H - 6, "text-anchor": "middle" }, svg);
        t.textContent = `'${p.s.slice(2, 4)}`;
      }
    });
    const hit = el("rect", { x: m.l, y: 0, width: iw, height: H, fill: "transparent" }, svg);
    const idxAt = (evt) => {
      const r = svg.getBoundingClientRect();
      return Math.max(0, Math.min(pts.length - 1, Math.floor((((evt.clientX - r.left) / r.width) * W - m.l) / slot)));
    };
    hit.style.cursor = "pointer";
    hit.addEventListener("pointermove", (evt) => {
      const p = pts[idxAt(evt)];
      showTip(evt, [tnode("tv", `${ordinal(p.r.pos)} of ${p.n}`), tnode("", p.comp), tnode("ts", `${p.s} · ${p.r.pts} pts · ${p.r.gf}-${p.r.ga}`), tnode("ts", finish(p.s, p.comp).text)]);
    });
    hit.addEventListener("pointerleave", hideTip);
    hit.addEventListener("click", (evt) => { hideTip(); location.hash = `#/season/${pts[idxAt(evt)].s}`; });
  }

  // ------------------------------------------------------------------ sortable table
  function table(host, cols, rows, opts = {}) {
    let sortKey = opts.sort || null, asc = !!opts.asc;
    const render = () => {
      const data = [...rows];
      if (sortKey) {
        const c = cols.find((c) => c.key === sortKey);
        const get = c.sortVal || c.val || ((r) => r[c.key]);
        data.sort((a, b) => {
          const va = get(a), vb = get(b);
          const d = typeof va === "string" ? va.localeCompare(vb) : (va ?? -1e9) - (vb ?? -1e9);
          return asc ? d : -d;
        });
      }
      const head = cols.map((c) => `<th class="${c.num ? "n " : ""}${c.sortable !== false && !opts.fixed ? "sortable " : ""}${c.key === sortKey ? "sorted " + (asc ? "asc" : "") : ""}${c.cls || ""}" data-k="${c.key}" ${c.title ? `title="${esc(c.title)}"` : ""}>${esc(c.label)}</th>`).join("");
      const body = data.map((r) => r.sep ? `<tr class="sep"><td colspan="${cols.length}">${esc(r.sep)}</td></tr>` : `<tr class="${opts.rowCls ? opts.rowCls(r) : ""}" ${opts.href ? `data-href="${esc(opts.href(r))}"` : ""}>${cols.map((c) => `<td class="${c.num ? "n " : ""}${c.cls || ""}">${c.html ? c.html(r) : esc(c.val ? c.val(r) : r[c.key])}</td>`).join("")}</tr>`).join("");
      const foot = opts.foot ? `<tr class="total">${cols.map((c) => `<td class="${c.num ? "n " : ""}${c.cls || ""}">${opts.foot[c.key] ?? ""}</td>`).join("")}</tr>` : "";
      host.innerHTML = `<div class="table-wrap"><table class="${opts.tableCls || ""}"><thead><tr>${head}</tr></thead><tbody>${body}${foot}</tbody></table></div>`;
      if (!opts.fixed) host.querySelectorAll("th.sortable").forEach((th) =>
        th.addEventListener("click", () => {
          const k = th.dataset.k;
          if (sortKey === k) asc = !asc;
          else { sortKey = k; asc = cols.find((c) => c.key === k).num ? false : true; }
          render();
        })
      );
      host.querySelectorAll("tr[data-href]").forEach((tr) => {
        tr.classList.add("clickable");
        tr.addEventListener("click", (e) => { if (!e.target.closest("a")) location.hash = tr.dataset.href; });
      });
    };
    render();
  }

  // player aggregate columns (per game or totals)
  function statCols(mode, first) {
    const pg = mode === "avg";
    const v = (k) => (r) => (pg ? (r.gp ? r[k] / r.gp : 0) : r[k]);
    const f = (k, digits = 2) => (r) => (pg ? (digits === 2 ? fmt2 : fmt1)(v(k)(r)) : int(r[k]));
    return [
      ...first,
      { key: "gp", label: "Apps", num: true },
      { key: "gs", label: "Starts", num: true },
      { key: "min", label: "Min", num: true, title: "Minutes; a few older games have no substitution times", val: (r) => (pg ? fmt1(r.min / ((r.gp - r.nomin) || 1)) : int(r.min)), sortVal: (r) => (pg ? r.min / ((r.gp - r.nomin) || 1) : r.min) },
      { key: "gl", label: "Goals", num: true, val: f("gl"), sortVal: v("gl"), cls: "strong" },
      { key: "as", label: "Assists", num: true, val: f("as"), sortVal: v("as") },
      { key: "ga_", label: "G+A", num: true, title: "Goals plus assists", val: (r) => (pg ? fmt2((r.gl + r.as) / r.gp) : r.gl + r.as), sortVal: (r) => (pg ? (r.gl + r.as) / r.gp : r.gl + r.as) },
      { key: "pk", label: "Pens", num: true, title: "Penalties scored", val: f("pk"), sortVal: v("pk") },
      { key: "yc", label: "YC", num: true, title: "Yellow cards", val: f("yc"), sortVal: v("yc") },
      { key: "rc", label: "RC", num: true, title: "Red cards, including second yellows", val: f("rc"), sortVal: v("rc") },
      { key: "cs", label: "CS", num: true, title: "Clean sheets (goalkeepers who played the whole game)", val: (r) => (r.gk ? f("cs")(r) : ""), sortVal: (r) => (r.gk ? v("cs")(r) : -1) },
      { key: "w", label: "Win %", num: true, val: (r) => ((100 * r.w) / r.gp).toFixed(0), sortVal: (r) => r.w / r.gp },
    ];
  }

  function aggregateBy(rows, keyFn) {
    const groups = new Map();
    rows.forEach((r) => {
      const k = keyFn(r);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(r);
    });
    return [...groups].map(([k, rs]) => ({ key: k, ...sumRows(rs) }));
  }

  // ------------------------------------------------------------------ chips
  function chips(host, options, current, onPick) {
    host.innerHTML = options.map((o) => `<button class="chip ${o.value === current ? "on" : ""}" data-v="${esc(o.value)}">${o.dot ? `<span class="dot" style="background:${o.dot}"></span>` : ""}${esc(o.label)}</button>`).join("");
    host.querySelectorAll(".chip").forEach((b) => b.addEventListener("click", () => onPick(b.dataset.v)));
    // long groups become one sideways-scrolling row on phones; keep the picked chip in view
    host.classList.toggle("chip-row", options.length > 4);
    const on = host.querySelector(".chip.on");
    if (on && host.scrollWidth > host.clientWidth) host.scrollLeft = on.offsetLeft - (host.clientWidth - on.offsetWidth) / 2;
  }

  // ------------------------------------------------------------------ views
  function gameRow(g) {
    const o = opp(g);
    const note = g.pens ? `${g.adv ? "Won" : "Lost"} ${Math.max(...g.pens)}-${Math.min(...g.pens)} on pens` : g.aet ? "After extra time" : "";
    return `<a class="game-row" href="#/game/${g.id}">
      <div class="date">${fmtDate(g.date, true)}<br>${g.date.slice(0, 4)}</div>
      <div class="opp">${logo(o)}<div style="min-width:0"><div class="opp-name">${g.cityHome ? "" : '<span class="muted">@ </span>'}${esc(o.name)}</div>
        <div class="meta"><span class="dot" style="background:${compColor(g.comp)}"></span> ${esc(g.comp)} · ${esc(g.round)}</div></div></div>
      <div class="score">${score(g)}${note ? `<div class="meta">${note}</div>` : ""}</div>
      ${wl(g)}
    </a>`;
  }

  function gamesList(games, groupByMonth = true) {
    let out = "", lastMonth = "";
    for (const g of games) {
      const mk = g.date.slice(0, 7);
      if (groupByMonth && mk !== lastMonth) {
        const [y, m] = mk.split("-").map(Number);
        out += `<div class="month-head">${MONTHS[m - 1]} ${y}</div>`;
        lastMonth = mk;
      }
      out += gameRow(g);
    }
    return `<div class="card games">${out || '<div class="empty">No games</div>'}</div>`;
  }

  const leadItem = (i, who, ctx, val) => `<li><span class="rk">${i + 1}</span><span>${who}${ctx}</span><span class="val">${val}</span></li>`;

  // ---------------- home
  function viewHome() {
    const all = S.games;
    const r = record(all);
    const seasons = seasonsList();
    const cups = trophies();
    const byComp = {};
    cups.forEach((t) => (byComp[t.comp] = (byComp[t.comp] || 0) + 1));
    const career = aggregateBy(S.plog, (r) => r.k);
    const leaders = (stat, n = 5) => [...career].sort((a, b) => b[stat] - a[stat] || b.gp - a.gp).slice(0, n);
    const leadList = (stat, label) => `<div class="card pad"><h3>${label}</h3><ol class="lead-list">${leaders(stat).map((p, i) => leadItem(i, pLink(p.key), `<span class="ctx">${p.gp} games</span>`, int(p[stat]))).join("")}</ol></div>`;

    main.innerHTML = `
      <section class="hero">
        <div class="kicker">Manchester City FC · ${seasons[0]} to ${seasons[seasons.length - 1]}</div>
        <h1>Man City<br>Stats</h1>
        <p class="lede">Every competitive game since the first Premier League season: results, line-ups, goals, player stats and records, through the First and Second Division years to the treble.</p>
        <div class="hero-stats">
          <div class="hero-stat"><div class="v">${int(r.n)}</div><div class="l">Games</div></div>
          <div class="hero-stat"><div class="v">${wdl(r)}</div><div class="l">Won · drawn · lost</div></div>
          <div class="hero-stat"><div class="v">${(r.pct * 100).toFixed(1)}%</div><div class="l">Win rate</div></div>
          <div class="hero-stat"><div class="v">${int(r.gf)}</div><div class="l">Goals scored</div></div>
          <div class="hero-stat"><div class="v">${S.players.length}</div><div class="l">Players</div></div>
          <div class="hero-stat"><div class="v">${cups.length}</div><div class="l">Trophies</div></div>
        </div>
      </section>

      <section class="section">
        <div class="section-head"><h2>Trophies</h2><span class="sub">${Object.entries(byComp).map(([c, n]) => `${esc(c)} ${n}`).join(" · ")}</span></div>
        <div class="card pad"><div class="filters" style="margin:0">${cups.slice().reverse().map((t) => `<a class="chip" href="#/season/${t.season}/${encodeURIComponent(t.comp)}"><span class="dot" style="background:${compColor(t.comp)}"></span>${esc(t.comp)} ${t.season}</a>`).join("")}</div></div>
      </section>

      <section class="section">
        <div class="section-head"><h2>League finish</h2><span class="sub">Click a season to open it</span></div>
        <div class="card pad"><div id="finish-all"></div></div>
      </section>

      <section class="section">
        <div class="section-head"><h2>Seasons</h2></div>
        <div class="grid g5">${seasons.slice().reverse().map(seasonCard).join("")}</div>
      </section>

      <section class="section">
        <div class="section-head"><h2>Goal difference by game</h2><span class="sub">Click a bar to open the game</span></div>
        <div class="card pad">
          <div class="legend"><span><i class="sw" style="background:var(--pos)"></i>Win</span><span><i class="sw" style="background:var(--zero)"></i>Draw</span><span><i class="sw" style="background:var(--neg)"></i>Loss</span></div>
          <div id="margin-all"></div>
        </div>
      </section>

      <section class="section">
        <div class="section-head"><h2>Leaders</h2><a class="sub" href="#/records">All records</a></div>
        <div class="grid g4">
          ${leadList("gp", "Appearances")}${leadList("gl", "Goals")}${leadList("as", "Assists")}${leadList("cs", "Clean sheets")}
        </div>
      </section>

      <section class="section">
        <div class="section-head"><h2>Latest games</h2><a class="sub" href="#/season/${seasons[seasons.length - 1]}">Full season</a></div>
        ${gamesList([...all].slice(-8).reverse(), false)}
      </section>`;
    finishChart(document.getElementById("finish-all"));
    marginChart(document.getElementById("margin-all"), all, true);
  }

  function seasonCard(s) {
    const gs = S.games.filter((g) => g.season === s);
    const r = record(gs);
    const lines = compsIn(gs).map((c) => {
      const cr = record(gs.filter((g) => g.comp === c));
      const fin = finish(s, c);
      return `<div class="comp-line"><span class="dot" style="background:${compColor(c)}"></span>
        <span class="nm">${esc(c)}<span class="finish">${fin.title ? "🏆 " : ""}${esc(fin.text)}</span></span>
        <span class="num">${wdl(cr)}</span></div>`;
    }).join("");
    return `<a class="card season-card" href="#/season/${s}">
      <div class="yr">${s}</div>
      <div class="rec">${wdl(r)} · ${(r.pct * 100).toFixed(0)}% wins · ${r.gf}-${r.ga}</div>
      <div class="bar-track"><div class="bar-fill" style="width:${r.pct * 100}%;background:var(--sky)"></div></div>
      ${lines}</a>`;
  }

  // ---------------- season
  function viewSeason(season, comp) {
    const seasons = seasonsList();
    if (!seasons.includes(season)) season = seasons[seasons.length - 1];
    const sg = S.games.filter((g) => g.season === season);
    const comps = compsIn(sg);
    if (comp && !comps.includes(comp)) comp = "";
    const games = comp ? sg.filter((g) => g.comp === comp) : sg;
    const r = record(games);
    const home = record(games.filter((g) => g.cityHome)), away = record(games.filter((g) => !g.cityHome));
    const att = games.filter((g) => g.cityHome && g.att);
    const avgAtt = att.reduce((s, g) => s + g.att, 0) / (att.length || 1);
    const coaches = [...new Set(games.map((g) => g.coach).filter(Boolean))];
    const table_ = S.tables[season];
    const lr = leagueRow(season);
    const showTable = table_ && (!comp || comp === table_.comp);
    const cleanSheets = games.filter((g) => opp(g).score === 0).length;

    main.innerHTML = `
      <div class="crumb"><a href="#/">Home</a> / Season</div>
      <div class="section-head" style="margin-bottom:6px"><h2 style="font-size:40px">${season}</h2>
        <span class="sub">${comps.map((c) => { const f = finish(season, c); return `${esc(c)}: <b>${f.title ? "🏆 " : ""}${esc(f.text)}</b>`; }).join(" · ")}</span></div>
      <div class="filters" id="season-pick"></div>
      <div class="filters" id="comp-pick"></div>
      <div class="grid g4">
        <div class="card tile"><div class="l">Record</div><div class="v">${wdl(r)}</div><div class="d">${(r.pct * 100).toFixed(1)}% wins · ${r.n} games</div></div>
        ${lr && showTable ? `<div class="card tile"><div class="l">${esc(table_.comp)}</div><div class="v">${ordinal(lr.pos)}</div><div class="d">${lr.pts} points · ${lr.w}-${lr.d}-${lr.l}</div></div>` : ""}
        <div class="card tile"><div class="l">Goals</div><div class="v">${r.gf}-${r.ga}</div><div class="d">${fmt2(r.gf / (r.n || 1))} scored, ${fmt2(r.ga / (r.n || 1))} conceded per game · ${cleanSheets} clean sheets</div></div>
        <div class="card tile"><div class="l">Home / away</div><div class="v">${wdl(home)} <span class="muted" style="font-weight:400">/</span> ${wdl(away)}</div><div class="d">at home / away and neutral</div></div>
        <div class="card tile"><div class="l">Home attendance</div><div class="v">${att.length ? int(avgAtt) : "-"}</div><div class="d">average over ${att.length} home game${att.length === 1 ? "" : "s"}</div></div>
        ${coaches.length ? `<div class="card tile"><div class="l">Manager${coaches.length > 1 ? "s" : ""}</div><div class="v" style="font-size:20px">${coaches.map((c) => `<a href="#/managers/${encodeURIComponent(c)}">${esc(c)}</a>`).join(", ")}</div></div>` : ""}
        <div class="card tile"><div class="l">Form · last 10</div><div class="v"><div class="form">${games.slice(-10).map(wl).join("")}</div></div></div>
      </div>
      <section class="section">
        <div class="section-head"><h2>Game by game</h2><span class="sub">Goal difference</span></div>
        <div class="card pad"><div class="legend"><span><i class="sw" style="background:var(--pos)"></i>Win</span><span><i class="sw" style="background:var(--zero)"></i>Draw</span><span><i class="sw" style="background:var(--neg)"></i>Loss</span></div><div id="margin-season"></div></div>
      </section>
      ${showTable ? `<section class="section"><div class="section-head"><h2>${esc(table_.comp)} table</h2><span class="sub">${season === S.meta.current ? "Current standings" : "Final standings"}</span></div><div class="card" id="league-table"></div></section>` : ""}
      <section class="section">
        <div class="section-head"><h2>Player stats</h2><div class="filters" id="mode-pick" style="margin:0"></div></div>
        <div class="card" id="season-players"></div>
      </section>
      <section class="section">
        <div class="section-head"><h2>Results</h2><span class="sub">${games.length} games</span></div>
        ${gamesList(games)}
      </section>`;

    chips(document.getElementById("season-pick"), seasons.map((s) => ({ value: s, label: s })), season, (v) => (location.hash = `#/season/${v}${comp ? "/" + encodeURIComponent(comp) : ""}`));
    chips(document.getElementById("comp-pick"), [{ value: "", label: "All competitions" }, ...comps.map((c) => ({ value: c, label: c, dot: compColor(c) }))], comp || "", (v) => (location.hash = `#/season/${season}${v ? "/" + encodeURIComponent(v) : ""}`));
    marginChart(document.getElementById("margin-season"), games, false);
    if (showTable) {
      table(document.getElementById("league-table"), [
        { key: "pos", label: "#", num: true },
        { key: "name", label: "Club", cls: "sticky-col" },
        { key: "p", label: "P", num: true }, { key: "w", label: "W", num: true }, { key: "d", label: "D", num: true }, { key: "l", label: "L", num: true },
        { key: "gf", label: "GF", num: true }, { key: "ga", label: "GA", num: true },
        { key: "gd", label: "GD", num: true, val: (r) => signed(r.gf - r.ga) },
        { key: "pts", label: "Pts", num: true, cls: "strong" },
      ], table_.rows, { fixed: true, tableCls: "std", rowCls: (r) => (r.id === 281 ? "city" : "") });
    }

    const ids = new Set(games.map((g) => g.id));
    const rows = aggregateBy(S.plog.filter((r) => ids.has(r.g)), (r) => r.k);
    let mode = "tot";
    const renderPlayers = () => {
      chips(document.getElementById("mode-pick"), [{ value: "tot", label: "Totals" }, { value: "avg", label: "Per game" }], mode, (v) => { mode = v; renderPlayers(); });
      table(document.getElementById("season-players"), statCols(mode, [{ key: "name", label: "Player", cls: "sticky-col", html: (r) => pLink(r.key), sortVal: (r) => pName(r.key) }]), rows, { sort: "gp" });
    };
    renderPlayers();
  }

  // ---------------- game
  const evIcon = (t) => ({
    goal: "⚽", pen: "⚽", og: "⚽", yc: '<span class="ico card yc"></span>', rc: '<span class="ico card rc"></span>',
    y2: '<span class="ico card y2"></span>', sub: '<span class="ico sub">▲</span>',
  }[t] || "");
  const evText = (e, box) => {
    const link = (k, n) => (box.teams[e.side].city ? pLink(k, n) : esc(n));
    if (e.t === "sub") return `${link(e.k, e.p)} <span class="ctx"><span class="ico subout">▼</span> ${link(e.ok, e.o)}${e.why ? " · " + esc(e.why) : ""}</span>`;
    if (e.t === "goal" || e.t === "pen" || e.t === "og") {
      // an own goal is listed under the team it helped, but the scorer played for the other side
      const who = e.t === "og" ? (box.teams[1 - e.side].city ? pLink(e.k, e.p) : esc(e.p)) : link(e.k, e.p);
      const tag = e.t === "pen" ? " (pen)" : e.t === "og" ? " (og)" : "";
      return `<b>${who}${tag}</b>${e.score ? ` <span class="ctx">${e.score[0]}-${e.score[1]}</span>` : ""}${e.a ? `<span class="ctx"> · assist ${link(e.ak, e.a)}</span>` : ""}`;
    }
    return `${link(e.k, e.p)}${e.t === "y2" ? ' <span class="ctx">second yellow</span>' : ""}`;
  };

  async function viewGame(id) {
    const g = S.byId[id];
    if (!g) return notFound();
    main.innerHTML = `<div class="loading">Loading</div>`;
    const box = await loadBox(id);
    const h = g.home, a = g.away;
    const idx = S.games.indexOf(g);
    const prev = S.games[idx - 1], next = S.games[idx + 1];
    const h2h = S.games.filter((x) => opp(x).id === opp(g).id);
    const h2hR = record(h2h);
    const scorerLine = (side) => {
      const by = new Map();
      box.events.filter((e) => ["goal", "pen", "og"].includes(e.t) && e.side === side).forEach((e) => {
        const k = `${e.p}${e.t === "og" ? " (og)" : ""}`;
        if (!by.has(k)) by.set(k, []);
        by.get(k).push(minLabel(e.min, e.ex) + (e.t === "pen" ? " pen" : ""));
      });
      return [...by].map(([n, ms]) => `${esc(n)} <span class="ball">${ms.join(", ")}</span>`).join("<br>");
    };
    const note = g.pens ? `${g.pens[0]}-${g.pens[1]} on penalties · ${g.adv ? "City" : esc(opp(g).name)} win` : g.aet ? "After extra time" : "";
    const lp = g.pos && LEAGUES.has(g.comp) ? g.pos : null;

    main.innerHTML = `
      <div class="crumb"><a href="#/">Home</a> / <a href="#/season/${g.season}/${encodeURIComponent(g.comp)}">${g.season} ${esc(g.comp)}</a> / ${esc(g.round)}</div>
      <div class="card">
        <div class="scoreboard">
          <div class="sb-team">${logo(h, "logo-lg")}<div class="nm">${esc(h.name)}</div></div>
          <div><div class="sb-score"><span class="${h.score >= a.score ? "win" : "lose"}">${h.score}</span><span class="muted"> : </span><span class="${a.score >= h.score ? "win" : "lose"}">${a.score}</span></div>
            ${g.ht ? `<div class="sb-note">Half time ${g.ht[0]}-${g.ht[1]}</div>` : ""}
            ${note ? `<div class="sb-note"><b>${note}</b></div>` : ""}
            <div class="sb-meta">${wl(g)} &nbsp;${fmtDate(g.date)}${g.date.length > 10 ? " · " + g.date.slice(11, 16) : ""}</div>
            <div class="sb-meta"><span class="dot" style="background:${compColor(g.comp)}"></span> ${esc(g.comp)} · ${esc(g.round)}</div></div>
          <div class="sb-team">${logo(a, "logo-lg")}<div class="nm">${esc(a.name)}</div></div>
        </div>
        <div class="scorers"><div>${scorerLine(0)}</div><div></div><div>${scorerLine(1)}</div></div>
      </div>
      <div class="card pad" style="margin-top:14px"><div class="info-grid">
        ${g.venue ? `<div><div class="k">Venue</div>${esc(g.venue)}</div>` : ""}
        ${g.att ? `<div><div class="k">Attendance</div>${int(g.att)}</div>` : ""}
        ${g.ref ? `<div><div class="k">Referee</div>${esc(g.ref)}</div>` : ""}
        ${box.teams[0]?.coach || box.teams[1]?.coach ? `<div><div class="k">Managers</div>${esc(box.teams[0].coach || "?")} · ${esc(box.teams[1].coach || "?")}</div>` : ""}
        ${lp ? `<div><div class="k">League position after</div>${ordinal(lp)}</div>` : ""}
        <div><div class="k">Head to head</div><a href="#/opponents/${opp(g).id}">${wdl(h2hR)} vs ${esc(opp(g).name)}</a></div>
        <div><div class="k">Source</div><a href="${esc(g.src)}" target="_blank" rel="noopener">Transfermarkt ↗</a></div>
      </div></div>
      ${box.events.length ? `<section class="section"><div class="section-head"><h2>Match events</h2></div><div class="card pad"><ul class="timeline" id="timeline"></ul></div></section>` : ""}
      ${box.shootout.length ? `<section class="section"><div class="section-head"><h2>Penalty shoot-out</h2><span class="sub">${g.pens[0]}-${g.pens[1]}</span></div><div class="card pad" id="shootout"></div></section>` : ""}
      ${g.hasBox ? `<section class="section"><div class="section-head"><h2>Line-ups</h2></div><div class="grid g2">${box.teams.map((t, i) => `<div><div class="section-head" style="margin-bottom:8px"><h3>${esc(t.name)}</h3><span class="sub">${t.formation ? esc(t.formation) + " · " : ""}${t.coach ? esc(t.coach) : ""}</span></div><div class="card" id="lu-${i}"></div></div>`).join("")}</div></section>`
        : `<div class="card pad empty" style="margin-top:14px">No line-ups are available for this game.</div>`}
      <div class="filters" style="margin-top:28px;justify-content:space-between">
        ${prev ? `<a class="chip" href="#/game/${prev.id}">Previous: ${esc(opp(prev).name)} · ${fmtDate(prev.date, true)}</a>` : "<span></span>"}
        ${next ? `<a class="chip" href="#/game/${next.id}">Next: ${esc(opp(next).name)} · ${fmtDate(next.date, true)}</a>` : ""}
      </div>`;

    const tl = document.getElementById("timeline");
    if (tl) {
      let htShown = false;
      tl.innerHTML = box.events.map((e) => {
        let pre = "";
        if (!htShown && e.min != null && e.min > 45 && !(e.min === 45 && e.ex)) { htShown = true; pre = `<li><span class="ht-mark">Half time${g.ht ? ` · ${g.ht[0]}-${g.ht[1]}` : ""}</span></li>`; }
        const body = `<span class="ev">${evIcon(e.t)}<span>${evText(e, box)}</span></span>`;
        return `${pre}<li><div class="h">${e.side === 0 ? body : ""}</div><div class="mn">${minLabel(e.min, e.ex)}</div><div>${e.side === 1 ? body : ""}</div></li>`;
      }).join("");
    }
    const so = document.getElementById("shootout");
    if (so) {
      so.innerHTML = `<div class="shootout">${box.teams.map((t, side) => `<div><b>${esc(t.name)}</b></div><div class="row">${box.shootout.filter((k) => k.side === side).map((k) => `<span class="pk ${k.in ? "in" : "out"}" title="${esc(k.p)}: ${k.in ? "scored" : "missed"}">${k.in ? "✓" : "✕"}</span>`).join("")}</div>`).join("")}</div>
        <ol class="lead-list" style="margin-top:12px">${box.shootout.map((k, i) => leadItem(i, box.teams[k.side].city ? pLink(k.k, k.p) : esc(k.p), `<span class="ctx">${esc(box.teams[k.side].name)}</span>`, k.in ? "Scored" : "Missed")).join("")}</ol>`;
    }

    box.teams.forEach((t, i) => {
      const host = document.getElementById(`lu-${i}`);
      if (!host) return;
      const played = t.players.filter((p) => !p.dnp);
      const rows = [
        ...played.filter((p) => p.st),
        ...(played.some((p) => !p.st) ? [{ sep: "Substitutes" }] : []), ...played.filter((p) => !p.st),
        ...(t.players.some((p) => p.dnp) ? [{ sep: "Unused" }] : []), ...t.players.filter((p) => p.dnp),
      ];
      const cards = (p) => (p.rc ? '<span class="ico card rc"></span>' : p.yc ? '<span class="ico card yc"></span>' : "");
      table(host, [
        { key: "no", label: "#" },
        { key: "n", label: "Player", cls: "sticky-col", html: (p) => `${t.city ? pLink(p.k, p.n) : esc(p.n)}${p.gk ? '<span class="tag">GK</span>' : ""}${p.cap ? '<span class="tag">C</span>' : ""}${p.on != null && !p.st ? `<span class="tag"><span class="ico sub">▲</span>${p.on}'</span>` : ""}${p.off != null ? `<span class="tag"><span class="ico subout">▼</span>${p.off}'</span>` : ""}` },
        { key: "min", label: "Min", num: true, val: (p) => (p.dnp ? "" : p.min == null ? "?" : p.min) },
        { key: "gl", label: "G", num: true, val: (p) => (p.gl || "") },
        { key: "as", label: "A", num: true, val: (p) => (p.as || "") },
        { key: "c", label: "", html: (p) => cards(p) },
      ], rows, { fixed: true, rowCls: (p) => (p.dnp ? "bench" : "") });
    });
  }

  // ---------------- players index
  function viewPlayers() {
    const seasons = seasonsList();
    const SORTS = [
      { value: "gp", label: "Appearances", show: (t) => `${t.gp} apps` },
      { value: "gl", label: "Goals", show: (t) => `${t.gl} goals` },
      { value: "as", label: "Assists", show: (t) => `${t.as} assists` },
      { value: "gpg", label: "Goals per game", show: (t) => `${fmt2(t.gl / t.gp)} per game` },
      { value: "cs", label: "Clean sheets", show: (t) => `${t.cs} clean sheets` },
      { value: "min", label: "Minutes", show: (t) => `${int(t.min)} min` },
      { value: "yc", label: "Yellow cards", show: (t) => `${t.yc} yellows` },
      { value: "born", label: "Youngest" },
      { value: "name", label: "Name" },
    ];
    let season = "", q = "", sort = "gp";
    main.innerHTML = `
      <div class="section-head"><h2 style="font-size:40px">Players</h2><span class="sub">${S.players.length} players</span></div>
      <div class="filters"><input class="search" id="pq" placeholder="Search players" aria-label="Search players"><span class="sep"></span><span id="ps"></span></div>
      <div class="filters"><span class="sub">Sort by</span><span id="psort"></span></div>
      <div class="grid g5" id="plist"></div>`;
    const render = () => {
      chips(document.getElementById("ps"), [{ value: "", label: "All seasons" }, ...seasons.slice().reverse().map((s) => ({ value: s, label: s }))], season, (v) => { season = v; render(); });
      chips(document.getElementById("psort"), SORTS.map(({ value, label }) => ({ value, label })), sort, (v) => { sort = v; render(); });
      const fq = fold(q);
      const list = S.players
        .filter((p) => (!season || p.lines.some((l) => l.season === season)) && (!fq || fold(p.n).includes(fq)))
        .map((p) => {
          const t = { gp: 0 };
          (season ? p.lines.filter((l) => l.season === season) : p.lines).forEach((l) => {
            for (const k in l) if (typeof l[k] === "number") t[k] = (t[k] || 0) + l[k];
          });
          return { p, t };
        });
      const by = (f) => (a, b) => f(b) - f(a) || b.t.gp - a.t.gp;
      if (sort === "name") list.sort((a, b) => a.p.n.localeCompare(b.p.n));
      else if (sort === "born") list.sort((a, b) => (b.p.born || "").localeCompare(a.p.born || ""));
      else if (sort === "gpg") list.sort(by((x) => (x.t.gp >= 20 ? x.t.gl / x.t.gp : -1)));
      else list.sort(by((x) => x.t[sort] || 0));
      const extra_ = SORTS.find((x) => x.value === sort && x.show && !["gp", "gl"].includes(x.value));
      document.getElementById("plist").innerHTML = list.slice(0, 600).map(({ p, t }) => {
        const ss = [...new Set(p.lines.map((l) => l.season))];
        return `<a class="card player-card" href="#/player/${encodeURIComponent(p.k)}">${avatar(p)}<div><div class="pn">${esc(p.n)}</div>
          <div class="ps">${ss.length > 1 ? `${ss[0]} to ${ss[ss.length - 1]}` : ss[0]}${p.pos ? " · " + esc(p.pos) : ""}</div>
          <div class="ps">${t.gp} apps · ${t.gl || 0} goals${extra_ ? " · " + extra_.show(t) : ""}</div></div></a>`;
      }).join("") || '<div class="empty">No players match</div>';
    };
    document.getElementById("pq").addEventListener("input", (e) => { q = e.target.value; render(); });
    render();
  }

  // ---------------- player
  function viewPlayer(key) {
    const p = S.byKey[key];
    if (!p) return notFound();
    const rows = S.plog.filter((r) => r.k === key).sort((a, b) => S.byId[a.g].date.localeCompare(S.byId[b.g].date));
    const tot = sumRows(rows);
    const keeper = tot.gk > tot.gp / 2;
    const age = p.born ? Math.floor((Date.now() - new Date(p.born)) / 3.15576e10) : null;
    const first = rows[0], last = rows[rows.length - 1];
    const firstGoal = rows.find((r) => r.gl > 0);
    const best = [...rows].sort((a, b) => b.gl - a.gl || b.as - a.as)[0];
    const hat = rows.filter((r) => r.gl >= 3).length;
    const ageAt = (d) => (p.born ? `aged ${Math.floor((new Date(d) - new Date(p.born)) / 3.15576e10)}` : "");
    const gameTile = (label, r, val) => { const g = S.byId[r.g]; return `<a class="card tile" href="#/game/${g.id}"><div class="l">${label}</div><div class="v" style="font-size:20px">${val}</div><div class="d">${vsAt(g)} · ${fmtDate(g.date)} · ${esc(g.comp)}</div></a>`; };

    main.innerHTML = `
      <div class="crumb"><a href="#/players">Players</a> / ${esc(p.n)}</div>
      <div class="player-head">${avatar(p, "avatar lg")}
        <div><h1>${esc(p.n)}</h1>
          <div class="bio">
            ${p.pos ? `<span>Position <b>${esc(p.pos)}</b></span>` : ""}
            ${p.height ? `<span>Height <b>${p.height} cm</b></span>` : ""}
            ${p.born ? `<span>Born <b>${fmtDate(p.born)}</b>${age ? ` (${age})` : ""}</span>` : ""}
            ${p.birthplace ? `<span>From <b>${esc(p.birthplace)}</b></span>` : ""}
            ${p.nat ? `<span>Nationality <b>${esc(p.nat)}</b></span>` : ""}
          </div></div></div>
      <div class="grid g4" style="margin-top:22px">
        <div class="card tile"><div class="l">Appearances</div><div class="v">${tot.gp}</div><div class="d">${tot.gs} starts · ${tot.w}-${tot.d}-${tot.l} record</div></div>
        ${keeper ? `<div class="card tile"><div class="l">Clean sheets</div><div class="v">${tot.cs}</div><div class="d">${tot.ga} conceded · ${fmt2(tot.ga / tot.gk)} per game</div></div>` : ""}
        <div class="card tile"><div class="l">Goals</div><div class="v">${tot.gl}</div><div class="d">${fmt2(tot.gl / tot.gp)} per game${tot.pk ? ` · ${tot.pk} penalt${tot.pk > 1 ? "ies" : "y"}` : ""}${tot.og ? ` · ${tot.og} own goal${tot.og > 1 ? "s" : ""}` : ""}</div></div>
        <div class="card tile"><div class="l">Assists</div><div class="v">${tot.as}</div><div class="d">${fmt2(tot.as / tot.gp)} per game</div></div>
        <div class="card tile"><div class="l">Minutes</div><div class="v">${int(tot.min)}</div><div class="d">${tot.gl ? `a goal every ${int(tot.min / tot.gl)} min` : "per known minutes"}${tot.nomin ? ` · ${tot.nomin} game${tot.nomin > 1 ? "s" : ""} without sub times` : ""}</div></div>
        <div class="card tile"><div class="l">Discipline</div><div class="v">${tot.yc} <span class="ico card yc"></span> ${tot.rc} <span class="ico card rc"></span></div><div class="d">yellow / red cards</div></div>
      </div>
      <section class="section"><div class="section-head"><h2>Season by season</h2><div class="filters" id="pmode" style="margin:0"></div></div><div class="card" id="plines"></div></section>
      <section class="section"><div class="section-head"><h2>${keeper ? "Clean sheets" : "Goals"} by season</h2><span class="sub">${rows.length} games</span></div>
        <div class="card pad"><div id="pseason"></div></div></section>
      <section class="section"><div class="section-head"><h2>Highlights</h2></div>
        <div class="grid g4">
          ${gameTile("Debut", first, ageAt(S.byId[first.g].date) || "First game")}
          ${firstGoal ? gameTile("First goal", firstGoal, ageAt(S.byId[firstGoal.g].date) || "") : ""}
          ${best && best.gl ? gameTile("Most goals in a game", best, `${best.gl} goal${best.gl > 1 ? "s" : ""}${hat ? ` · ${hat} hat-trick${hat > 1 ? "s" : ""}` : ""}`) : ""}
          ${last !== first ? gameTile(S.byId[last.g].season === S.meta.current ? "Latest game" : "Last game", last, ageAt(S.byId[last.g].date) || "") : ""}
        </div></section>
      <section class="section"><div class="section-head"><h2>Game log</h2></div><div class="card" id="plog"></div></section>`;

    let mode = "tot";
    const lines = aggregateBy(rows, (r) => `${S.byId[r.g].season}|${S.byId[r.g].comp}`);
    const renderLines = () => {
      chips(document.getElementById("pmode"), [{ value: "tot", label: "Totals" }, { value: "avg", label: "Per game" }], mode, (v) => { mode = v; renderLines(); });
      table(document.getElementById("plines"), statCols(mode, [
        { key: "season", label: "Season", val: (r) => r.key.split("|")[0], sortVal: (r) => r.key },
        { key: "comp", label: "Competition", html: (r) => `<span class="dot" style="background:${compColor(r.key.split("|")[1])}"></span> ${esc(r.key.split("|")[1])}`, sortVal: (r) => r.key.split("|")[1] },
      ]), lines, { sort: "season", asc: true });
    };
    renderLines();
    const bySeason = aggregateBy(rows, (r) => S.byId[r.g].season).sort((a, b) => a.key.localeCompare(b.key));
    columnChart(document.getElementById("pseason"), bySeason, {
      value: (r) => (keeper ? r.cs : r.gl),
      color: () => "var(--sky)",
      tipFor: (r) => [tnode("tv", keeper ? `${r.cs} clean sheets` : `${r.gl} goals`), tnode("", `${r.gp} apps · ${r.as} assists`), tnode("ts", r.key)],
      onClick: (r) => (location.hash = `#/season/${r.key}`),
      yLabel: keeper ? "Clean sheets per season" : "Goals per season",
    });
    table(document.getElementById("plog"), [
      { key: "date", label: "Date", val: (r) => fmtDate(S.byId[r.g].date), sortVal: (r) => S.byId[r.g].date },
      { key: "opp", label: "Opponent", html: (r) => { const g = S.byId[r.g]; return `<div class="team-cell">${logo(opp(g))}${g.cityHome ? "" : "@ "}${esc(opp(g).name)}</div>`; }, sortVal: (r) => opp(S.byId[r.g]).name },
      { key: "comp", label: "Comp", html: (r) => `<span class="dot" style="background:${compColor(S.byId[r.g].comp)}"></span> ${COMP_SHORT[S.byId[r.g].comp]}`, sortVal: (r) => S.byId[r.g].comp },
      { key: "res", label: "Result", html: (r) => { const g = S.byId[r.g]; return `${wl(g)} ${score(g)}${extra(g)}`; }, sortVal: (r) => margin(S.byId[r.g]) },
      { key: "st", label: "Start", val: (r) => (r.st ? "Yes" : "Sub") },
      { key: "min", label: "Min", num: true, val: (r) => (r.min == null ? "?" : r.min) },
      { key: "gl", label: "Goals", num: true, cls: "strong", val: (r) => r.gl || "" },
      { key: "as", label: "Assists", num: true, val: (r) => r.as || "" },
      ...(keeper ? [{ key: "ga", label: "Conceded", num: true, val: (r) => (r.gk ? r.ga : "") }] : []),
      { key: "yc", label: "Cards", html: (r) => (r.rc ? '<span class="ico card rc"></span>' : r.yc ? '<span class="ico card yc"></span>' : ""), sortVal: (r) => r.yc + 2 * r.rc },
    ], [...rows].reverse(), { href: (r) => `#/game/${r.g}` });
  }

  // ---------------- records
  function runs(games, test) {
    const out = [];
    let cur = [];
    const flush = () => { if (cur.length) out.push(cur); cur = []; };
    for (const g of games) { if (test(g)) cur.push(g); else flush(); }
    flush();
    return out.sort((a, b) => b.length - a.length);
  }

  function viewRecords() {
    const seasons = seasonsList();
    let comp = "", season = "";
    main.innerHTML = `
      <div class="section-head"><h2 style="font-size:40px">Records</h2></div>
      <div class="filters" id="rc"></div><div class="filters" id="rs"></div>
      <div id="rbody"></div>`;
    const render = () => {
      chips(document.getElementById("rc"), [{ value: "", label: "All competitions" }, ...compsIn(S.games).map((c) => ({ value: c, label: c, dot: compColor(c) }))], comp, (v) => { comp = v; render(); });
      chips(document.getElementById("rs"), [{ value: "", label: "All seasons" }, ...seasons.slice().reverse().map((s) => ({ value: s, label: s }))], season, (v) => { season = v; render(); });
      const games = S.games.filter((g) => (!comp || g.comp === comp) && (!season || g.season === season));
      const ids = new Set(games.map((g) => g.id));
      const rows = S.plog.filter((r) => ids.has(r.g));
      const career = aggregateBy(rows, (r) => r.k);
      const goals = S.goals.filter((x) => ids.has(x.g));
      const ctx = (g) => `${vsAt(g)} · ${fmtDate(g.date)}`;
      const single = (stat, label) => `<div class="card pad"><h3>${label}</h3><ol class="lead-list">${[...rows].filter((r) => r[stat] > 0).sort((a, b) => b[stat] - a[stat] || S.byId[b.g].date.localeCompare(S.byId[a.g].date)).slice(0, 8).map((r, i) => leadItem(i, pLink(r.k), `<a class="ctx" href="#/game/${r.g}">${ctx(S.byId[r.g])}</a>`, r[stat])).join("") || '<li class="muted">None</li>'}</ol></div>`;
      const careerList = (stat, label, per, minGp = 30) => `<div class="card pad"><h3>${label}</h3><ol class="lead-list">${[...career].filter((p) => (!per || (per === "gk" ? p.gk >= minGp : p.gp >= minGp)) && (per || p[stat] > 0)).sort((a, b) => (per === "gk" ? b.cs / b.gk - a.cs / a.gk : per ? b[stat] / b.gp - a[stat] / a.gp : b[stat] - a[stat])).slice(0, 8).map((p, i) => leadItem(i, pLink(p.key), `<span class="ctx">${p.gp} games</span>`, per === "gk" ? `${((100 * p.cs) / p.gk).toFixed(0)}%` : per ? fmt2(p[stat] / p.gp) : int(p[stat]))).join("") || '<li class="muted">None</li>'}</ol></div>`;
      const teamList = (label, sorted, val) => `<div class="card pad"><h3>${label}</h3><ol class="lead-list">${sorted.slice(0, 8).map((g, i) => leadItem(i, `<a href="#/game/${g.id}">${vsAt(g)}</a>`, `<span class="ctx">${esc(g.comp)} · ${fmtDate(g.date)}</span>`, val(g))).join("")}</ol></div>`;
      const runList = (label, test) => `<div class="card pad"><h3>${label}</h3><ol class="lead-list">${runs(games, test).slice(0, 8).map((r, i) => leadItem(i, `<a href="#/game/${r[0].id}">${fmtDate(r[0].date)}</a>`, `<span class="ctx">to ${fmtDate(r[r.length - 1].date)}</span>`, r.length)).join("") || '<li class="muted">None</li>'}</ol></div>`;
      const cityGoals = goals.filter((x) => x.city && x.kind !== "og" && x.min != null);
      const fastest = [...cityGoals].sort((a, b) => a.min - b.min).slice(0, 8);
      const hatTricks = rows.filter((r) => r.gl >= 3);
      const hatBy = aggregateBy(hatTricks, (r) => r.k).sort((a, b) => b.gp - a.gp);
      // goals by 15-minute period, City and opponents
      const buckets = ["1-15", "16-30", "31-45", "46-60", "61-75", "76-90", "ET"].map((l) => ({ l, f: 0, a: 0 }));
      goals.filter((x) => x.min != null).forEach((x) => {
        const b = x.min > 90 && !x.ex ? 6 : x.min > 90 ? 5 : Math.min(5, Math.floor((x.min - 1) / 15));
        const i = x.min === 45 && x.ex ? 2 : x.min === 90 && x.ex ? 5 : b;
        buckets[i][x.city ? "f" : "a"]++;
      });
      document.getElementById("rbody").innerHTML = `
        <section class="section"><div class="section-head"><h2>Single game</h2></div>
          <div class="grid g4">${single("gl", "Goals")}${single("as", "Assists")}
            <div class="card pad"><h3>Hat-tricks</h3><ol class="lead-list">${hatBy.slice(0, 8).map((p, i) => leadItem(i, pLink(p.key), `<span class="ctx">${p.gl} goals in those games</span>`, p.gp)).join("") || '<li class="muted">None</li>'}</ol></div>
            <div class="card pad"><h3>Fastest goals</h3><ol class="lead-list">${fastest.map((x, i) => leadItem(i, pLink(x.k), `<a class="ctx" href="#/game/${x.g}">${ctx(S.byId[x.g])}</a>`, minLabel(x.min, x.ex))).join("") || '<li class="muted">None</li>'}</ol></div>
          </div></section>
        <section class="section"><div class="section-head"><h2>Totals</h2></div>
          <div class="grid g4">${careerList("gp", "Appearances")}${careerList("gl", "Goals")}${careerList("as", "Assists")}${careerList("cs", "Clean sheets")}${careerList("min", "Minutes")}${careerList("pk", "Penalties scored")}${careerList("yc", "Yellow cards")}${careerList("rc", "Red cards")}</div></section>
        <section class="section"><div class="section-head"><h2>Per game</h2><span class="sub">Minimum 30 games</span></div>
          <div class="grid g4">${careerList("gl", "Goals", 1)}${careerList("as", "Assists", 1)}${careerList("gi", "Goals + assists", 1)}${careerList("cs", "Clean sheet rate", "gk")}</div></section>
        <section class="section"><div class="section-head"><h2>Team</h2></div>
          <div class="grid g4">
            ${teamList("Biggest wins", [...games].sort((a, b) => margin(b) - margin(a) || city(b).score - city(a).score), (g) => score(g))}
            ${teamList("Heaviest defeats", [...games].sort((a, b) => margin(a) - margin(b) || opp(b).score - opp(a).score), (g) => score(g))}
            ${teamList("Most goals scored", [...games].sort((a, b) => city(b).score - city(a).score || margin(b) - margin(a)), (g) => score(g))}
            ${teamList("Biggest crowds", [...games].filter((g) => g.att).sort((a, b) => b.att - a.att), (g) => int(g.att))}
            ${runList("Winning runs", (g) => g.res === "W")}
            ${runList("Unbeaten runs", (g) => g.res !== "L")}
            ${runList("Clean sheet runs", (g) => opp(g).score === 0)}
            ${runList("Scoring runs", (g) => city(g).score > 0)}
          </div></section>
        <section class="section"><div class="section-head"><h2>Goals by time of game</h2><span class="sub">${cityGoals.length ? "Goals with a reported minute" : ""}</span></div>
          <div class="card pad"><div class="legend"><span><i class="sw" style="background:var(--pos)"></i>Scored</span><span><i class="sw" style="background:var(--neg)"></i>Conceded</span></div><div id="by-minute"></div></div></section>`;
      const items = buckets.flatMap((b) => [{ ...b, side: "f" }, { ...b, side: "a" }]);
      columnChart(document.getElementById("by-minute"), items, {
        value: (it) => it[it.side],
        color: (it) => (it.side === "f" ? "var(--pos)" : "var(--neg)"),
        tipFor: (it) => [tnode("tv", `${it[it.side]} ${it.side === "f" ? "scored" : "conceded"}`), tnode("ts", it.l === "ET" ? "Extra time" : `Minutes ${it.l}`)],
        height: 200,
        yLabel: "Goals by 15-minute period",
      });
    };
    render();
  }

  // ---------------- managers
  function viewManagers(sel) {
    const map = new Map();
    for (const g of S.games) {
      const k = g.coach || "Unknown";
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(g);
    }
    const cups = trophies();
    const rows = [...map].map(([name, games]) => {
      const r = record(games);
      const won_ = cups.filter((t) => {
        const fin = S.games.filter((g) => g.season === t.season && g.comp === t.comp);
        const last = fin[fin.length - 1];
        return last.coach === name;
      });
      const lg = games.filter((g) => LEAGUES.has(g.comp));
      const lr = record(lg);
      return { name, games, ...r, first: games[0].date, last: games[games.length - 1].date, cups: won_, ppg: lg.length ? (3 * lr.w + lr.d) / lg.length : null };
    });
    main.innerHTML = `
      <div class="section-head"><h2 style="font-size:40px">Managers</h2><span class="sub">${rows.length} managers, caretakers included</span></div>
      <div class="card" id="mtab"></div>
      <section class="section" id="mdetail"></section>`;
    table(document.getElementById("mtab"), [
      { key: "name", label: "Manager", cls: "sticky-col", html: (r) => esc(r.name) },
      { key: "first", label: "From", val: (r) => fmtDate(r.first) },
      { key: "last", label: "To", val: (r) => fmtDate(r.last) },
      { key: "n", label: "GP", num: true },
      { key: "w", label: "W", num: true }, { key: "d", label: "D", num: true }, { key: "l", label: "L", num: true },
      { key: "pct", label: "Win %", num: true, val: (r) => (r.pct * 100).toFixed(1) },
      { key: "ppg", label: "League PPG", num: true, title: "Points per league game", val: (r) => fmt2(r.ppg) },
      { key: "gf", label: "GF", num: true }, { key: "ga", label: "GA", num: true },
      { key: "cups", label: "Trophies", num: true, val: (r) => r.cups.length || "", sortVal: (r) => r.cups.length },
    ], rows, { sort: "first", asc: false, href: (r) => `#/managers/${encodeURIComponent(r.name)}` });
    if (sel && map.has(sel)) {
      const m = rows.find((r) => r.name === sel);
      const d = document.getElementById("mdetail");
      const byComp = compsIn(m.games).map((c) => ({ c, ...record(m.games.filter((g) => g.comp === c)) }));
      d.innerHTML = `<div class="section-head"><h2>${esc(m.name)}</h2><span class="sub">${wdl(m)} · ${(m.pct * 100).toFixed(1)}% wins · ${fmtDate(m.first)} to ${fmtDate(m.last)}</span></div>
        ${m.cups.length ? `<div class="filters">${m.cups.map((t) => `<a class="chip" href="#/season/${t.season}/${encodeURIComponent(t.comp)}">🏆 ${esc(t.comp)} ${t.season}</a>`).join("")}</div>` : ""}
        <div class="card" id="mcomp" style="margin-bottom:14px"></div>
        ${gamesList([...m.games].reverse())}`;
      table(document.getElementById("mcomp"), [
        { key: "c", label: "Competition", html: (r) => `<span class="dot" style="background:${compColor(r.c)}"></span> ${esc(r.c)}` },
        { key: "n", label: "GP", num: true }, { key: "w", label: "W", num: true }, { key: "d", label: "D", num: true }, { key: "l", label: "L", num: true },
        { key: "gf", label: "GF", num: true }, { key: "ga", label: "GA", num: true },
        { key: "pct", label: "Win %", num: true, val: (r) => (r.pct * 100).toFixed(1) },
      ], byComp, { sort: "n" });
      d.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  // ---------------- opponents
  function viewOpponents(sel) {
    const map = new Map();
    for (const g of S.games) {
      const o = opp(g), k = String(o.id);
      if (!map.has(k)) map.set(k, { key: k, name: o.name, logo: o.logo, games: [] });
      const e = map.get(k);
      e.games.push(g);
      if (o.logo) e.logo = o.logo;
      e.name = o.name;
    }
    const rows = [...map.values()].map((e) => {
      const r = record(e.games);
      return { ...e, ...r, gd: r.gf - r.ga, comps: compsIn(e.games), last: e.games[e.games.length - 1] };
    });
    main.innerHTML = `
      <div class="section-head"><h2 style="font-size:40px">Opponents</h2><span class="sub">${rows.length} clubs</span></div>
      <div class="filters"><input class="search" id="oq" placeholder="Search clubs" aria-label="Search clubs"></div>
      <div class="card" id="otab"></div>
      <section class="section" id="odetail"></section>`;
    const renderTable = (q) => table(document.getElementById("otab"), [
      { key: "name", label: "Opponent", cls: "sticky-col", html: (r) => `<div class="team-cell">${logo(r)}${esc(r.name)}</div>`, sortVal: (r) => r.name },
      { key: "comps", label: "Competitions", html: (r) => r.comps.map((c) => `<span class="dot" style="background:${compColor(c)}" title="${esc(c)}"></span>`).join(" "), sortable: false },
      { key: "n", label: "GP", num: true },
      { key: "w", label: "W", num: true }, { key: "d", label: "D", num: true }, { key: "l", label: "L", num: true },
      { key: "gf", label: "GF", num: true }, { key: "ga", label: "GA", num: true },
      { key: "gd", label: "GD", num: true, val: (r) => signed(r.gd) },
      { key: "pct", label: "Win %", num: true, val: (r) => (r.pct * 100).toFixed(0) },
      { key: "last", label: "Last meeting", html: (r) => `${wl(r.last)} ${score(r.last)} <span class="muted">${fmtDate(r.last.date)}</span>`, sortVal: (r) => r.last.date },
    ], rows.filter((r) => !q || fold(r.name).includes(fold(q))), { sort: "n", href: (r) => `#/opponents/${r.key}` });
    renderTable("");
    document.getElementById("oq").addEventListener("input", (e) => renderTable(e.target.value));
    if (sel && map.has(sel)) {
      const e = map.get(sel);
      const r = record(e.games);
      const d = document.getElementById("odetail");
      d.innerHTML = `<div class="section-head"><h2>vs ${esc(e.name)}</h2><span class="sub">${wdl(r)} · goals ${r.gf}-${r.ga}</span></div>${gamesList([...e.games].reverse(), false)}`;
      d.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  function notFound() {
    main.innerHTML = `<div class="empty">Not found. <a href="#/">Back home</a></div>`;
  }

  // ------------------------------------------------------------------ router
  function route() {
    hideTip();
    const parts = location.hash.replace(/^#\/?/, "").split("/").map(decodeURIComponent);
    const [view, a, b] = parts;
    document.querySelectorAll(".nav a").forEach((n) => n.classList.toggle("on", n.dataset.v === (view || "home")));
    if (!["opponents", "managers"].includes(view) || !a) window.scrollTo(0, 0);
    switch (view) {
      case "season": return viewSeason(a, b);
      case "game": return viewGame(a);
      case "players": return viewPlayers();
      case "player": return viewPlayer(a);
      case "records": return viewRecords();
      case "managers": return viewManagers(a);
      case "opponents": return viewOpponents(a);
      default: return viewHome();
    }
  }

  // burger menu (shown on narrow screens only)
  const nav = document.getElementById("nav"), menuBtn = document.getElementById("menu");
  const setMenu = (open) => {
    nav.classList.toggle("open", open);
    menuBtn.setAttribute("aria-expanded", String(open));
    menuBtn.setAttribute("aria-label", open ? "Close menu" : "Open menu");
  };
  menuBtn.addEventListener("click", () => setMenu(!nav.classList.contains("open")));
  nav.addEventListener("click", (e) => { if (e.target.closest("a")) setMenu(false); });
  document.addEventListener("click", (e) => { if (!e.target.closest(".top")) setMenu(false); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") setMenu(false); });

  // theme toggle (per-viewer convenience only)
  const btn = document.getElementById("theme");
  const applyTheme = (t) => {
    if (t) document.documentElement.dataset.theme = t;
    else delete document.documentElement.dataset.theme;
  };
  try { applyTheme(localStorage.getItem("theme")); } catch (e) { /* storage unavailable */ }
  btn.addEventListener("click", () => {
    const dark = document.documentElement.dataset.theme
      ? document.documentElement.dataset.theme === "dark"
      : matchMedia("(prefers-color-scheme: dark)").matches;
    const t = dark ? "light" : "dark";
    applyTheme(t);
    try { localStorage.setItem("theme", t); } catch (e) { /* ignore */ }
    route();
  });

  addEventListener("hashchange", route);
  load().then(() => {
    document.getElementById("built").textContent = S.meta.built || "";
    route();
  }).catch((e) => {
    main.innerHTML = `<div class="empty">Could not load data (${esc(e.message)}).</div>`;
  });
})();
