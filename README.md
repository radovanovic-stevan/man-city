# Man City Stats

Manchester City results, line-ups, goals, player stats, managers and records for every competitive
game from 1992-93 (the first Premier League season) onward, published as a static site on GitHub Pages.

| Competition       | Seasons | Source |
|-------------------|---------|--------|
| Premier League    | 1992-93 to 1995-96, 2000-01, 2002-03 to 2026-27 | `transfermarkt.com` |
| First Division    | 1996-97, 1997-98, 1999-00, 2001-02 | same |
| Second Division   | 1998-99 | same |
| FA Cup, League Cup | every season | same |
| Champions League  | 2011-12 onward | same |
| Europa League, UEFA Cup | 2003-04, 2008-09, 2010-11, 2011-12 | same |
| Club World Cup, UEFA Super Cup, Community Shield, EFL Trophy | when City played in them | same |

Everything comes from Transfermarkt: the club's season schedule, one match report per game
(line-ups, goals with assists, substitutions, cards, referee, attendance, managers), the final
league table of each season, and a profile page for each City player.

Notes on the data:
- Transfermarkt does not list the 1999 Second Division play-offs (Wigan in the semi-final,
  Gillingham in the final at Wembley), so those three games are missing. The 1998-99 season card
  says City were promoted via the play-offs.
- The schedule adds shootout goals to the score (the 2016 League Cup final shows as 2:4). The real
  score comes from the last goal in the match report, the shootout from its penalty list.
- Games decided on penalties count as draws in records, as is usual; the game and season pages say
  who went through.
- Minutes played come from substitution and red card times (90 or 120 for a full game; stoppage
  time is not counted). If a substitution or red card ever has no reported minute, the appearance
  still counts but its minutes are left out and shown as "?".
- Clean sheets go to a goalkeeper who played the whole game without conceding.
- The schedule's league position per matchday is taken from matchday tables, which are off when
  games were rescheduled, so the final position comes from the league table.
- Older line-ups have no shirt numbers or benches.

## Layout

```
data/raw/          gzipped pages as downloaded
scraper/fetch.py   downloads into data/raw
scraper/build.py   parses data/raw into site/data (no network)
site/              the static site
```

## Updating the current season

`CURRENT` in `scraper/fetch.py` names the season in progress (by its starting year). For that
season the schedule and league table are downloaded again on every run, and match reports and
player profiles are fetched for any newly played game. Finished games are never downloaded twice.

```sh
python3 scraper/fetch.py
python3 scraper/build.py
cd site && python3 -m http.server   # http://localhost:8000
```

Python 3.9+, standard library only. When a new season starts, move `CURRENT`.

## Deploy

`.github/workflows/pages.yml` publishes `site/` on every push to `main`.
