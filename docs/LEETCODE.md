# LeetCode tracking

Look records what you actually practiced. It's separate from tasks:
a task like "do 2 LeetCodes" is a plan; the tracker is the record of what
you did. The `LeetCode` task category is unchanged.

You can log from the **LeetCode** page in the web app, or through any
connected MCP client ("I solved 560 in 23 minutes in Java, needed one hint,
confidence 3/5").

## Data

- **Problem** (`leetcode_problems`): one row per LeetCode number (unique),
  with title, difficulty (easy / medium / hard), topics, and a slug/URL
  derived from the title.
- **Attempt** (`leetcode_attempts`): one row per try, linked to its problem:
  when (local time), solved, solved independently, hint used, minutes,
  language, confidence (1 very weak … 5 very strong), notes, and source
  (`manual` or `mcp`).
- **Goals** (`leetcode_goals`): one row with the daily and weekly targets.
  Until you change them, the defaults are 2 per day and 10 per week.

## No duplicate problems

Problems are identified by their LeetCode number, which has a unique
constraint. Logging an attempt for a number that's already tracked adds
the attempt to that problem; title and difficulty are needed only the first
time. On later logs, a new title or difficulty replaces the old one and new
topics are merged in. Creating a problem directly with an existing number
returns 409.

Topics are normalized so variants don't split: `sliding  window` becomes
`Sliding Window`, and short single words become acronyms (`dp` becomes `DP`,
`bfs` becomes `BFS`).

## How the numbers are defined

- **Solved independently** defaults to "solved without a hint". You can
  say otherwise (for example you looked at a solution), but an attempt that
  used a hint can't be independent.
- **Total solved:** distinct problems with at least one solved attempt.
- **Solved today / this week:** solved attempts on that local date,
  re-solves included (re-solving is practice). The week starts on Monday.
  Dates use `APP_TIMEZONE`, like the rest of Look.
- **Average solve time:** over solved attempts that recorded minutes.
- **Hint usage rate / independent solve rate:** share of *all* attempts.
- **Streak:** consecutive calendar days with at least one solved
  attempt. Today without a solve doesn't break the streak until the day is
  over; a full day with no solve does. The best streak is also reported.

## Topic weakness

For each topic, Look looks at that topic's 10 most recent attempts and
averages four factors (each 0 = good, 1 = bad):

1. unsolved rate (1 − solve rate)
2. not-independent rate (1 − independent rate)
3. hint rate
4. low confidence: (5 − average confidence) ÷ 4, when confidence was given

A topic needs at least 2 recent attempts to be rated. Topics above 0.4 are
flagged "Needs work" (at most 3). Every topic shows the reasons in words,
for example "solved 1 of 2 recent attempts, used hints on 1 of 2, average
confidence 1.5/5", and the page shows plain-language insights such as
"You rely on hints more often on DP and Graphs". It's a rule of thumb, not
a science.

## API

All under `/api/leetcode`, login required:

| Method | Path | |
|---|---|---|
| GET | `/problems?difficulty=&topic=&q=` | tracked problems with attempt summary |
| POST | `/problems` | create (409 if the number exists) |
| GET / PATCH | `/problems/{id}` | one problem with all attempts / edit details |
| POST | `/attempts` | log an attempt (creates the problem if needed) |
| GET | `/attempts?limit=&difficulty=&topic=&solved=` | recent attempts, newest first |
| DELETE | `/attempts/{id}` | remove an attempt (the problem stays) |
| GET | `/stats` | totals, streaks, rates, goals, insights |
| GET | `/topics` | per-topic progress and weakness |
| GET / PUT | `/goals` | daily and weekly targets |

MCP tools are listed in [`MCP.md`](MCP.md). Manual logging is the only
source for now: there is no LeetCode account sync, scraping or credentials.
