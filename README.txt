MAFIA MILESTONE 08

Includes: skip vote, unique-role composition from Milestone 07, soft dawn transition, animated casualty report, and a six-second dawn cutscene before the day timer/discussion begins. Daylight text is near-black for contrast. The side panel shows faction counts only, not a full role-by-role reveal.

INSTALL
1. Replace index.html, app.js, and styles.css in your existing Mafia GitHub repository.
2. In the Mafia Supabase project, run milestone_08_dawn_skip_vote.sql. This replaces two existing RPC functions; it does not drop tables.
3. Hard-refresh the site (Ctrl+F5).

Run this migration after Milestone 07. It contains the gameplay RPC definitions from the timed-gameplay migration with two changes: skip is valid during daytime voting, and the day phase timestamp starts six seconds after the night resolves.
