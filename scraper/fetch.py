"""Download raw data for Manchester City games and store it under data/raw.

Source: www.transfermarkt.com, for every season from 1992-93 (the first Premier League
season) on, all official competitions:
  * fixtures/<year>.html   the club's season schedule (spielplandatum), every competition
  * match/<id>.html        one match report per played game: line-ups, goals, assists,
                           substitutions, cards, referee, attendance, managers
  * tables/<year>.html     the final table of the league City played in
  * players/<id>.html      profile page (birth date, nationality, height, position, photo)
                           for every City player who appears in a match report

Match reports and profiles are cached: a file that already exists is never fetched again.
For the season in progress (CURRENT) the schedule is fetched again on every run, so
re-running the script picks up newly played games. Raw pages are gzipped.
"""
import gzip
import re
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw" / "tm"

TM = "https://www.transfermarkt.com"
CLUB = 281  # Manchester City on Transfermarkt
FIRST = 1992  # 1992-93, the first Premier League season
CURRENT = 2026  # 2026-27; Transfermarkt names a season by the year it starts
SEASONS = list(range(FIRST, CURRENT + 1))

UA = "Mozilla/5.0 (man-city-stats archive; one-off fetch)"


def label(year):
    """1992 -> '1992-93'."""
    return f"{year}-{str(year + 1)[2:]}"


def get(url, retries=5):
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Language": "en"})
            with urllib.request.urlopen(req, timeout=60) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            if e.code == 404:
                raise
            wait = 5 * 2 ** attempt
            print(f"  ! {url}: {e} (retry in {wait}s)", file=sys.stderr)
            time.sleep(wait)
        except Exception as e:  # noqa: BLE001
            wait = 5 * 2 ** attempt
            print(f"  ! {url}: {e} (retry in {wait}s)", file=sys.stderr)
            time.sleep(wait)
    raise RuntimeError(f"failed to fetch {url}")


def cached(path: Path, url: str, delay=1.2, refresh=False) -> bytes:
    if path.exists() and not refresh:
        return gzip.decompress(path.read_bytes())
    print(f"GET {url}")
    body = get(url)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(gzip.compress(body, 9))
    time.sleep(delay)
    return body


def read(path: Path) -> str:
    return gzip.decompress(path.read_bytes()).decode("utf-8", "replace")


def played_ids(html):
    """Match report ids for games that already have a result ("-:-" means not played yet)."""
    out = []
    for mid, res in re.findall(r'class="ergebnis-link"[^>]*id="(\d+)"[^>]*>\s*<span[^>]*>([^<]*)<', html):
        if re.search(r"\d+:\d+", res) and mid not in out:
            out.append(mid)
    return out


def fetch_matches():
    for year in SEASONS:
        html = cached(RAW / "fixtures" / f"{year}.html.gz",
                      f"{TM}/manchester-city/spielplandatum/verein/{CLUB}/saison_id/{year}",
                      refresh=year == CURRENT).decode("utf-8", "replace")
        ids = played_ids(html)
        print(f"{label(year)}: {len(ids)} played games")
        for mid in ids:
            cached(RAW / "match" / f"{mid}.html.gz", f"{TM}/spielbericht/index/spielbericht/{mid}")


def league_code(year):
    """Transfermarkt code of the league City played in that season (GB1, EFD2, ENSD)."""
    page = read(RAW / "fixtures" / f"{year}.html.gz")
    codes = re.findall(rf"/spieltag/wettbewerb/([A-Z0-9]+)/saison_id/{year}/spieltag/", page)
    return max(set(codes), key=codes.count) if codes else None


def fetch_tables():
    """Final league table per season. The schedule's per-matchday position is taken from
    matchday tables, which are off when games were rescheduled, so the final place comes
    from here."""
    for year in SEASONS:
        code = league_code(year)
        if code:
            cached(RAW / "tables" / f"{year}.html.gz", f"{TM}/x/tabelle/wettbewerb/{code}/saison_id/{year}",
                   refresh=year == CURRENT)


def fetch_players():
    """Profiles of everyone who played for City (starters and substitutes who came on)."""
    from build import city_players  # the report parser lives in build.py
    ids = set()
    for f in sorted((RAW / "match").glob("*.html.gz")):
        ids |= city_players(f.name.split(".")[0])
    print(f"{len(ids)} City players")
    missed = []
    for pid in sorted(ids, key=int):
        # profile pages are rate limited harder than match reports: go slower, and leave
        # any that still fail for the next run instead of stopping
        try:
            cached(RAW / "players" / f"{pid}.html.gz", f"{TM}/x/profil/spieler/{pid}", delay=2.5)
        except RuntimeError:
            missed.append(pid)
    if missed:
        print(f"{len(missed)} profiles not fetched, run again: {' '.join(missed)}", file=sys.stderr)


if __name__ == "__main__":
    what = sys.argv[1:] or ["matches", "tables", "players"]
    if "matches" in what:
        fetch_matches()
    if "tables" in what:
        fetch_tables()
    if "players" in what:
        fetch_players()
