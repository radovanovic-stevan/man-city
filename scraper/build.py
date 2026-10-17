"""Turn the raw downloads in data/raw into the compact JSON the website reads.

Output (site/data):
  games.json            every City game: result, half-time score, venue, referee ...
  players.json          every City player: bio + per season/competition lines
  plog.json             one row per City player per game
  tables.json           final league table per season
  goals.json            every goal in every game: minute, scorer, assist, which side
  box/<game id>.json    line-ups and match events for both teams
  meta.json             build date, current season
"""
import gzip
import html
import json
import re
import sys
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

from fetch import CLUB, CURRENT, RAW, SEASONS, TM, label, read

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "site" / "data"

# Transfermarkt competition names -> the names the site shows
COMP_NAMES = {
    "Premier League": "Premier League",
    "First Division (- 03/04)": "First Division",
    "Second Division (- 03/04)": "Second Division",
    "FA Cup": "FA Cup",
    "EFL Cup": "League Cup",
    "EFL Trophy": "EFL Trophy",
    "Community Shield": "Community Shield",
    "UEFA Champions League": "Champions League",
    "UEFA Champions League Qualifying": "Champions League",
    "UEFA Europa League": "Europa League",
    "UEFA Europa League Qualifying": "Europa League",
    "UEFA-Cup (- 2009)": "UEFA Cup",
    "UEFA-Cup Qualifikation": "UEFA Cup",
    "UEFA Super Cup": "UEFA Super Cup",
    "FIFA Club World Cup": "Club World Cup",
}
LEAGUES = {"Premier League", "First Division", "Second Division"}

PLOG_COLS = ["g", "k", "st", "min", "gl", "pk", "as", "yc", "rc", "og", "ga", "cs", "gk"]


def text(s):
    return html.unescape(re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", s))).strip()


def club_name(name):
    """'Sunderland AFC' -> 'Sunderland', 'FC Barcelona' -> 'Barcelona'."""
    n = re.sub(r"\s*\([^)]*\d{2}[^)]*\)$", "", name)  # 'Wimbledon FC (- 2004)'
    n = re.sub(r"^(?:A?FC|CF|SC|SK|FK|SL|AC|AS|SS|SSC|RC|RCD|PFC) ", "", n)
    n = re.sub(r" (?:A?FC|CF|SC)$", "", n)
    return n.strip() or name


# ------------------------------------------------------------------ fixtures
def parse_fixtures(year):
    """Match id -> competition, round and City's league position from the season schedule."""
    page = read(RAW / "fixtures" / f"{year}.html.gz")
    out, comp = {}, None
    for row in re.split(r"<tr", page):
        m = re.search(r'class="wettbewerblogo" />&nbsp;&nbsp;<a title="([^"]+)"', row)
        if m:
            comp = m.group(1)
            continue
        mid = re.search(r'class="ergebnis-link"[^>]*id="(\d+)"', row)
        if not mid or not re.search(r'class="ergebnis-link"[^>]*>\s*<span[^>]*>\s*\d+:\d+', row):
            continue
        cells = [text(c) for c in re.findall(r"<td[^>]*>(.*?)</td>", row, re.S)]
        rnd = cells[0]
        name = COMP_NAMES.get(comp)
        if name is None:
            sys.exit(f"unknown competition {comp!r} in {year}")
        rank = re.search(r"\((\d+)\.\)", cells[4]) if len(cells) > 4 else None
        out[mid.group(1)] = {
            "comp": name,
            "round": f"Matchday {rnd}" if rnd.isdigit() else rnd,
            "pos": int(rank.group(1)) if rank and name in LEAGUES else None,
            "time": cells[2] if len(cells) > 2 else "",
        }
    return out


def parse_table(year, comp):
    """Final (or current) league table: position, club, P W D L, goals, points."""
    f = RAW / "tables" / f"{year}.html.gz"
    if not f.exists():
        return None
    page = read(f)
    i = page.find('<table class="items">')
    rows = []
    for tr in re.findall(r"<tr[^>]*>(.*?)</tr>", page[i:page.find("</table>", i)], re.S)[1:]:
        cells = [text(c) for c in re.findall(r"<td[^>]*>(.*?)</td>", tr, re.S)]
        cid = re.search(r"/verein/(\d+)", tr)
        name = re.search(r'<a title="([^"]+)" href="/[^"]*/(?:spielplan|startseite)/verein/', tr)
        if len(cells) < 10 or not cid or not cells[0].isdigit():
            continue
        gf, ga = (int(x) for x in cells[7].split(":"))
        rows.append({"pos": int(cells[0]), "id": int(cid.group(1)),
                     "name": club_name(html.unescape(name.group(1))) if name else cells[2],
                     "p": int(cells[3]), "w": int(cells[4]), "d": int(cells[5]), "l": int(cells[6]),
                     "gf": gf, "ga": ga, "pts": int(cells[9])})
    return {"season": label(year), "comp": comp, "rows": rows} if rows else None


# ------------------------------------------------------------------ match report
def minute(span_style, extra):
    """Transfermarkt draws the minute from a sprite: 36px cells, ten per row.
    A row offset of 433px (one pixel off the grid) is the 'not reported' cell."""
    m = re.search(r"background-position: -?(\d+)px -?(\d+)px", span_style)
    if not m:
        return None, None
    x, y = int(m.group(1)), int(m.group(2))
    if y % 36:
        return None, None
    mn = (y // 36) * 10 + x // 36 + 1
    ex = re.search(r"\+(\d+)", extra or "")
    return mn, int(ex.group(1)) if ex else None


def events(page, section):
    """The <li> items of one event section (sb-tore, sb-wechsel, sb-karten, ...)."""
    i = page.find(f'id="{section}"')
    if i < 0:
        return []
    end = page.find("</ul>", i)
    block = page[i:end]
    items = re.split(r'<li class="sb-aktion-(heim|gast)">', block)[1:]
    return [(0 if items[k] == "heim" else 1, items[k + 1]) for k in range(0, len(items), 2)]


def clock(li):
    m = re.search(r'sb-sprite-uhr-klein" style="([^"]*)">(.*?)</span>', li, re.S)
    return minute(m.group(1), text(m.group(2))) if m else (None, None)


def pid_links(s):
    """(player id, name) for every player link with a title, in order."""
    return [(pid, html.unescape(t)) for t, pid in
            re.findall(r'<a title="([^"]*)" class="wichtig" href="/[^"]*/spieler/(\d+)', s)]


def parse_goals(page):
    goals = []
    for side, li in events(page, "sb-tore"):
        mn, ex = clock(li)
        score = re.search(r'sb-aktion-spielstand"><b>(\d+):(\d+)</b>', li)
        act = li[li.find('sb-aktion-aktion'):]
        links = pid_links(act)
        how = act.split("</a>", 1)[1] if "</a>" in act else ""
        how = text(how.split("Assist:")[0]).strip(", ")
        kind = "og" if "Own-goal" in how else "pen" if "Penalty" in how else "goal"
        assist = None
        if "Assist:" in act and len(links) > 1:
            assist = links[1][0]
        goals.append({"side": side, "min": mn, "ex": ex, "p": links[0][0] if links else None,
                      "pn": links[0][1] if links else "", "a": assist,
                      "an": links[1][1] if assist else "", "kind": kind,
                      "score": [int(score.group(1)), int(score.group(2))] if score else None})
    return goals


def parse_subs(page):
    subs = []
    for side, li in events(page, "sb-wechsel"):
        mn, ex = clock(li)
        pin = re.search(r'sb-aktion-wechsel-ein">.*?<a title="([^"]*)"[^>]*href="/[^"]*/spieler/(\d+)', li, re.S)
        pout = re.search(r'sb-aktion-wechsel-aus">.*?<a title="([^"]*)"[^>]*href="/[^"]*/spieler/(\d+)', li, re.S)
        why = re.search(r'sb-aktion-wechsel-aus">.*?</a>(.*?)<span class="sb-sprite', li, re.S)
        reason = text(why.group(1)).strip(", ") if why else ""
        subs.append({"side": side, "min": mn, "ex": ex,
                     "in": pin.group(2) if pin else None, "inn": html.unescape(pin.group(1)) if pin else "",
                     "out": pout.group(2) if pout else None, "outn": html.unescape(pout.group(1)) if pout else "",
                     "why": "" if reason == "Not reported" else reason})
    return subs


def parse_cards(page):
    cards = []
    for side, li in events(page, "sb-karten"):
        mn, ex = clock(li)
        kind = re.search(r"sb-sprite sb-(gelb|rot|gelbrot)", li)
        links = pid_links(li)
        cards.append({"side": side, "min": mn, "ex": ex, "p": links[0][0] if links else None,
                      "pn": links[0][1] if links else "",
                      "kind": {"gelb": "yc", "rot": "rc", "gelbrot": "y2"}[kind.group(1)] if kind else "yc"})
    return cards


def parse_shootout(page):
    kicks = []
    for side, li in events(page, "sb-elfmeterscheissen"):
        links = pid_links(li)
        kicks.append({"side": side, "p": links[0][0] if links else None, "pn": links[0][1] if links else "",
                      "in": "sb-11m-tor" in li})
    return kicks


def parse_lineup(half):
    """Starters, bench and manager of one team from its half of the line-up block."""
    starters, bench = [], []
    formation = re.search(r"Starting Line-up:\s*([\d-]+)", half)
    if "formation-player-container" in half:
        for c in re.split(r'<div class="formation-player-container"', half)[1:]:
            no = re.search(r"tm-shirt-number[^>]*>\s*(\d+)", c)
            p = re.search(r'href="/([^"/]*)/profil/spieler/(\d+)">([^<]*)<', c)
            if p:
                starters.append({"k": p.group(2), "slug": p.group(1), "short": html.unescape(p.group(3)).strip(),
                                 "no": no.group(1) if no else "", "cap": "kapitaenicon" in c})
        if starters:
            starters[0]["gk"] = True  # the keeper is always drawn first
    else:
        for grp, cell in re.findall(r"<td><b>([^<]+)</b></td>\s*<td>(.*?)</td>", half, re.S):
            if grp.strip() == "Manager":
                continue
            for name, pid in re.findall(r'<a title="([^"]*)" href="/[^"]*/profil/spieler/(\d+)"', cell):
                starters.append({"k": pid, "n": html.unescape(name), "no": "", "gk": grp.strip() == "Goalkeeper"})
    bank = re.search(r'<table class="ersatzbank">(.*?)</table>', half, re.S)
    if bank:
        for row in re.findall(r"<tr>(.*?)</tr>", bank.group(1), re.S):
            p = re.search(r'<a title="([^"]*)" href="/[^"]*/profil/spieler/(\d+)"', row)
            if not p:
                continue
            no = re.search(r"tm-shirt-number[^>]*>\s*(\d+)", row)
            pos = re.findall(r"<td>\s*([A-Z]{2,3})\s*</td>", row)
            bench.append({"k": p.group(2), "n": html.unescape(p.group(1)), "no": no.group(1) if no else "",
                          "pos": pos[-1] if pos else ""})
    mgr = re.search(r'<a title="([^"]*)"[^>]*href="/[^"]*/profil/trainer/\d+"', half)
    return {"starters": starters, "bench": bench, "coach": html.unescape(mgr.group(1)) if mgr else None,
            "formation": formation.group(1) if formation else None}


def slug_name(slug):
    """'richard-edghill' -> 'Richard Edghill' (no accents, but better than a bare surname)."""
    return " ".join(w.capitalize() for w in (slug or "").split("-") if w)


def parse_report(mid):
    page = read(RAW / "match" / f"{mid}.html.gz")
    teams = []
    for side in ("sb-heim", "sb-gast"):
        i = page.find(f'class="sb-team {side}"')
        blk = page[i:i + 3000]
        cid = re.search(r"/verein/(\d+)", blk)
        name = re.search(r'class="sb-vereinslink"[^>]*>([^<]+)<', blk)
        logo = re.search(r'<img src="([^"]+/wappen/[^"]+)"', blk)
        teams.append({"id": int(cid.group(1)), "full": html.unescape(name.group(1)).strip(),
                      "logo": logo.group(1).split("?")[0] if logo else ""})
    end = re.search(r'class="sb-endstand">(.*?)</div>\s*</div>', page, re.S).group(1)
    total = [int(x) for x in re.search(r"(\d+):(\d+)", end).groups()]
    ht = re.search(r'sb-halbzeit">\(<span>(\d*):</span>(\d*)\)', end)
    note = text(re.sub(r"\(.*?\)", "", end.split('sb-halbzeit">', 1)[1])) if 'sb-halbzeit">' in end else ""
    date = re.search(r"/datum/(\d{4}-\d{2}-\d{2})", page[page.find("sb-datum"):]).group(1)
    tm = re.search(r"\|\s*&nbsp;&nbsp;\|&nbsp;&nbsp;(\d{1,2}):(\d{2}) (AM|PM)", page[page.find("sb-datum"):][:2000])
    hhmm = ""
    if tm:
        h, m_, ap = int(tm.group(1)), tm.group(2), tm.group(3)
        if not (h == 12 and m_ == "00" and ap == "AM"):  # 12:00 AM means the time is unknown
            hhmm = f"{(h % 12) + (12 if ap == 'PM' else 0):02d}:{m_}"
    info = page[page.find('class="sb-zusatzinfos"'):]
    info = info[:info.find("</p>")]
    venue = re.search(r'href="/[^"]*/stadion/[^"]*">([^<]+)<', info)
    att = re.search(r"Attendance: ([\d.]+)", info)
    ref = re.search(r'title="([^"]*)" href="/[^"]*/profil/schiedsrichter/', info)

    i = page.find("Line-Ups")
    j = page.find('<div class="sb-ereignisse"') if '<div class="sb-ereignisse"' in page else len(page)
    block = page[i:j] if i >= 0 else ""
    halves = re.split(r'<div class="large-6 columns', block)[1:3]
    lineups = [parse_lineup(h) for h in halves] if len(halves) == 2 else []

    names = {}
    for name, pid in re.findall(r'title="([^"]+)"[^>]*href="/[^"]*/(?:profil|leistungsdatendetails)/spieler/(\d+)', page):
        names.setdefault(pid, html.unescape(name))
    for pid, name in re.findall(r'href="/[^"]*/profil/spieler/(\d+)">\s*<img[^>]*title="([^"]+)"', page):
        names.setdefault(pid, html.unescape(name))

    return {"teams": teams, "total": total, "ht": [int(ht.group(1)), int(ht.group(2))] if ht and ht.group(1) else None,
            "note": note, "date": date, "time": hhmm,
            "venue": html.unescape(venue.group(1)).strip() if venue else "",
            "att": int(att.group(1).replace(".", "")) if att else None,
            "ref": html.unescape(ref.group(1)) if ref else "",
            "lineups": lineups, "names": names,
            "goals": parse_goals(page), "subs": parse_subs(page), "cards": parse_cards(page),
            "shootout": parse_shootout(page)}


def city_players(mid):
    """Ids of the City players who appeared in a game."""
    rep = parse_report(mid)
    side = 0 if rep["teams"][0]["id"] == CLUB else 1
    ids = {p["k"] for p in rep["lineups"][side]["starters"]} if rep["lineups"] else set()
    return ids | {s["in"] for s in rep["subs"] if s["side"] == side and s["in"]}


# ------------------------------------------------------------------ players
def parse_profile(pid):
    f = RAW / "players" / f"{pid}.html.gz"
    if not f.exists():
        return {}
    page = read(f)
    head = re.search(r'<h1 class="data-header__headline-wrapper">(.*?)</h1>', page, re.S)
    name = text(re.sub(r'<span class="data-header__shirt-number">.*?</span>', "", head.group(1), flags=re.S)) if head else ""
    img = re.search(r'<img src="([^"]+)"[^>]*class="data-header__profile-image"', page)
    img = img.group(1).split("?")[0] if img else ""
    if "default" in img:
        img = ""
    info = {}
    for k, v in re.findall(r'info-table__content--regular">\s*([^<:]+):\s*</span>\s*<span class="info-table__content info-table__content--bold[^"]*">(.*?)</span>\s*(?=<span class="info-table__content|</div>)', page, re.S):
        info[k.strip()] = v
    born = re.search(r"/datum/(\d{4}-\d{2}-\d{2})", info.get("Date of birth/Age", ""))
    height = re.search(r"(\d),(\d{2})", info.get("Height", ""))
    nat = re.findall(r'title="([^"]+)" alt="[^"]*" class="flaggenrahmen"', info.get("Citizenship", ""))
    place = text(info.get("Place of birth", ""))
    country = re.search(r'title="([^"]+)"', info.get("Place of birth", ""))
    pos = text(info.get("Position", ""))
    return {"n": name, "img": img, "born": born.group(1) if born else None,
            "height": int(height.group(1)) * 100 + int(height.group(2)) if height else None,
            "nat": nat[0] if nat else "", "pos": pos.split(" - ")[-1] if pos else "",
            "role": pos.split(" - ")[0] if pos else "",
            "birthplace": ", ".join(x for x in (place, country.group(1) if country else "") if x)}


# ------------------------------------------------------------------ build
def went_to_extra_time(fx, rep, season_year):
    """Shootouts in the Community Shield, and in League Cup ties before the semi-finals
    since 2018-19, go straight to penalties; everything else plays 30 minutes first."""
    if rep["note"] == "AET":
        return True
    if not rep["shootout"] and "pens" not in rep["note"]:
        return False
    if any((e["min"] or 0) > 90 and not e["ex"] for e in rep["goals"] + rep["subs"] + rep["cards"]):
        return True
    if fx["comp"] == "Community Shield":
        return False
    if fx["comp"] == "League Cup" and season_year >= 2018 and fx["round"] not in ("Semi-Finals", "Final"):
        return False
    return True


def player_minutes(k, starter, subs, cards, side, length):
    """Minutes on the pitch, or None when a substitution or red card has no reported minute."""
    on = 0 if starter else None
    for s in subs:
        if s["side"] == side and s["in"] == k:
            if s["min"] is None:
                return None
            on = min(s["min"], length)
    if on is None:
        return 0
    off = length
    for s in subs:
        if s["side"] == side and s["out"] == k:
            if s["min"] is None:
                return None
            off = min(s["min"], length)
    for c in cards:
        if c["side"] == side and c["p"] == k and c["kind"] in ("rc", "y2"):
            if c["min"] is None:
                return None
            off = min(off, c["min"])
    return max(off - on, 1 if off > on or starter else 0)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "box").mkdir(exist_ok=True)
    games, plog, seen_players, tables, goal_rows = [], [], {}, [], []
    for year in SEASONS:
        season = label(year)
        fixtures = parse_fixtures(year)
        league = next((fx["comp"] for fx in fixtures.values() if fx["comp"] in LEAGUES), None)
        table = parse_table(year, league) if league else None
        if table:
            tables.append(table)
        for mid, fx in fixtures.items():
            if not (RAW / "match" / f"{mid}.html.gz").exists():
                print(f"  missing report {mid} ({season})", file=sys.stderr)
                continue
            rep = parse_report(mid)
            home, away = rep["teams"]
            ch = 0 if home["id"] == CLUB else 1
            if (home["id"] == CLUB) == (away["id"] == CLUB):
                sys.exit(f"cannot tell City's side in {mid}")
            # the header adds shootout goals to the score; the last goal shows the real one
            goals = rep["goals"]
            score = list(goals[-1]["score"]) if goals and goals[-1]["score"] else [0, 0]
            # The header shows either the shootout score alone or the match score plus the
            # shootout; the kick list is sometimes incomplete. Trust the kicks when they agree
            # with one reading of the header, otherwise take header minus match score.
            pens = None
            if rep["shootout"] or "pens" in rep["note"]:
                summed = [rep["total"][0] - score[0], rep["total"][1] - score[1]]
                kicks = [sum(1 for x in rep["shootout"] if x["side"] == s and x["in"]) for s in (0, 1)]
                pens = kicks if kicks in (summed, rep["total"]) else summed
            else:
                score = rep["total"]
            aet = went_to_extra_time(fx, rep, year)
            length = 120 if aet else 90
            cg, og_ = score[ch], score[1 - ch]
            res = "W" if cg > og_ else "L" if cg < og_ else "D"
            lu = rep["lineups"]
            names = rep["names"]

            box_teams = []
            for side in (0, 1):
                t = rep["teams"][side]
                L = lu[side] if lu else {"starters": [], "bench": [], "coach": None, "formation": None}
                used = {s["in"] for s in rep["subs"] if s["side"] == side}
                players = []
                for st, lst in ((True, L["starters"]), (False, L["bench"])):
                    for p in lst:
                        k = p["k"]
                        if side == ch:
                            prof = seen_players.setdefault(k, parse_profile(k))
                            if prof.get("n"):
                                names[k] = prof["n"]
                        if k not in names and not p.get("n") and p.get("slug"):
                            names[k] = slug_name(p["slug"])
                        if not st and k not in used:
                            players.append({"k": k, "n": names.get(k) or p.get("n") or p.get("short", ""),
                                            "no": p["no"], "st": False, "dnp": True})
                            continue
                        players.append({"k": k, "n": names.get(k) or p.get("n") or p.get("short", ""),
                                        "no": p["no"], "st": st, "gk": bool(p.get("gk")), "cap": bool(p.get("cap"))})
                # substitutes the line-up block does not list (older games have no bench)
                listed = {p["k"] for p in players}
                for s in rep["subs"]:
                    if s["side"] == side and s["in"] and s["in"] not in listed:
                        players.append({"k": s["in"], "n": s["inn"], "no": "", "st": False})
                        listed.add(s["in"])
                for p in players:
                    if p.get("dnp"):
                        continue
                    k = p["k"]
                    p["min"] = player_minutes(k, p["st"], rep["subs"], rep["cards"], side, length)
                    p["gl"] = sum(1 for g in goals if g["p"] == k and g["side"] == side and g["kind"] != "og")
                    p["pk"] = sum(1 for g in goals if g["p"] == k and g["side"] == side and g["kind"] == "pen")
                    p["og"] = sum(1 for g in goals if g["p"] == k and g["side"] != side and g["kind"] == "og")
                    p["as"] = sum(1 for g in goals if g["a"] == k and g["side"] == side)
                    ks = [c["kind"] for c in rep["cards"] if c["p"] == k and c["side"] == side]
                    p["yc"] = sum(1 for c in ks if c in ("yc", "y2"))
                    p["rc"] = sum(1 for c in ks if c in ("rc", "y2"))
                    p["on"] = next((s["min"] for s in rep["subs"] if s["side"] == side and s["in"] == k), None)
                    p["off"] = next((s["min"] for s in rep["subs"] if s["side"] == side and s["out"] == k), None)
                box_teams.append({"name": club_name(t["full"]), "city": side == ch, "coach": L["coach"],
                                  "formation": L["formation"], "players": players})

            # opponent goals while each City keeper was on: full-match keepers concede them all
            city = box_teams[ch]
            conceded = [g for g in goals if g["side"] != ch]
            for p in city["players"]:
                if p.get("dnp"):
                    continue
                prof = seen_players.setdefault(p["k"], parse_profile(p["k"]))
                is_gk = p.get("gk") or prof.get("role") == "Goalkeeper"
                full = p["st"] and p["off"] is None and not p["rc"]
                if is_gk and full:
                    ga = len(conceded)
                elif is_gk and p["min"] is not None:
                    on = p["on"] or 0
                    off = p["off"] if p["off"] is not None else length
                    ga = sum(1 for g in conceded if g["min"] is not None and on < g["min"] <= off)
                else:
                    ga = 0
                plog.append([mid, p["k"], 1 if p["st"] else 0, p["min"], p["gl"], p["pk"], p["as"], p["yc"],
                             p["rc"], p["og"], ga if is_gk else 0, 1 if is_gk and full and not conceded else 0,
                             1 if is_gk else 0])

            for g in goals:
                goal_rows.append([mid, g["p"], g["min"], g["ex"], g["kind"], g["a"], 1 if g["side"] == ch else 0])
            ev = []
            for g in goals:
                ev.append({"t": g["kind"], "side": g["side"], "min": g["min"], "ex": g["ex"], "p": g["pn"],
                           "k": g["p"], "a": g["an"], "ak": g["a"], "score": g["score"]})
            for s in rep["subs"]:
                ev.append({"t": "sub", "side": s["side"], "min": s["min"], "ex": s["ex"], "p": s["inn"], "k": s["in"],
                           "o": s["outn"], "ok": s["out"], "why": s["why"]})
            for c in rep["cards"]:
                ev.append({"t": c["kind"], "side": c["side"], "min": c["min"], "ex": c["ex"], "p": c["pn"], "k": c["p"]})
            ev.sort(key=lambda e: ((e["min"] if e["min"] is not None else 999), e["ex"] or 0))
            shoot = [{"side": x["side"], "p": x["pn"], "k": x["p"], "in": x["in"]} for x in rep["shootout"]]
            with open(OUT / "box" / f"{mid}.json", "w") as f:
                json.dump({"teams": box_teams, "events": ev, "shootout": shoot}, f, ensure_ascii=False, separators=(",", ":"))

            date = rep["date"] + ("T" + rep["time"] if rep["time"] else "")
            games.append({
                "id": mid, "comp": fx["comp"], "season": season, "round": fx["round"], "date": date,
                "venue": rep["venue"], "att": rep["att"], "ref": rep["ref"],
                "home": {"name": club_name(home["full"]), "id": home["id"], "score": score[0], "logo": home["logo"]},
                "away": {"name": club_name(away["full"]), "id": away["id"], "score": score[1], "logo": away["logo"]},
                "ht": rep["ht"], "aet": aet, "pens": pens,
                "cityHome": ch == 0, "res": res,
                "adv": (pens[ch] > pens[1 - ch]) if pens else None,
                "coach": box_teams[ch]["coach"], "oppCoach": box_teams[1 - ch]["coach"],
                "pos": fx["pos"], "hasBox": bool(lu),
                "src": f"{TM}/spielbericht/index/spielbericht/{mid}",
            })
    games.sort(key=lambda g: g["date"])

    # players: profile + per season/competition lines
    by_id = {g["id"]: g for g in games}
    lines = defaultdict(lambda: defaultdict(lambda: defaultdict(int)))
    for r in plog:
        row = dict(zip(PLOG_COLS, r))
        g = by_id[row["g"]]
        ln = lines[row["k"]][(g["season"], g["comp"])]
        ln["gp"] += 1
        ln["min"] += row["min"] or 0
        if row["min"] is None:
            ln["nomin"] += 1
        for s in ("st", "gl", "pk", "as", "yc", "rc", "og", "ga", "cs"):
            ln[s] += row[s]
        ln["w"] += g["res"] == "W"
        ln["d"] += g["res"] == "D"
    players = []
    box_names = {}
    for f in (OUT / "box").glob("*.json"):
        for t in json.loads(f.read_text())["teams"]:
            if t["city"]:
                for p in t["players"]:
                    box_names.setdefault(p["k"], p["n"])
    for k, ls in lines.items():
        prof = seen_players.get(k) or parse_profile(k)
        players.append({
            "k": k, "n": prof.get("n") or box_names.get(k, k), "born": prof.get("born"), "nat": prof.get("nat", ""),
            "height": prof.get("height"), "pos": prof.get("pos", ""), "role": prof.get("role", ""),
            "img": prof.get("img", ""), "birthplace": prof.get("birthplace", ""),
            "lines": [{"season": s, "comp": c, **v} for (s, c), v in sorted(ls.items())],
        })
    players.sort(key=lambda p: -sum(l["gp"] for l in p["lines"]))

    with open(OUT / "games.json", "w") as f:
        json.dump(games, f, ensure_ascii=False, separators=(",", ":"))
    with open(OUT / "players.json", "w") as f:
        json.dump(players, f, ensure_ascii=False, separators=(",", ":"))
    with open(OUT / "plog.json", "w") as f:
        json.dump({"cols": PLOG_COLS, "rows": plog}, f, ensure_ascii=False, separators=(",", ":"))
    with open(OUT / "goals.json", "w") as f:
        json.dump({"cols": ["g", "k", "min", "ex", "kind", "a", "city"], "rows": goal_rows}, f, separators=(",", ":"))
    with open(OUT / "tables.json", "w") as f:
        json.dump(tables, f, ensure_ascii=False, separators=(",", ":"))
    with open(OUT / "meta.json", "w") as f:
        json.dump({"built": datetime.now(timezone.utc).strftime("%Y-%m-%d"), "current": label(CURRENT)}, f)
    print(f"{len(games)} games, {len(players)} players, {len(plog)} player-game rows")


if __name__ == "__main__":
    main()
