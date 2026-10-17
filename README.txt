MAFIA MILESTONE 09 - SECRET MAFIA CHAT + NO FRIENDLY FIRE

Files:
- index.html, app.js, styles.css: website files
- milestone_09_mafia_secret_chat.sql: SQL migration

Install:
1. Make sure Milestone 07 (unique roles) and Milestone 08 (dawn cutscene/skip vote) have already been applied to the Mafia Supabase project.
2. Run milestone_09_mafia_secret_chat.sql in the SAME Mafia project's SQL Editor.
3. Replace index.html, app.js, and styles.css in the existing GitHub repository.
4. Commit/push and refresh the site with Ctrl+F5.

Features:
- Every Mafia member can see the names and roles of their fellow Mafia members.
- A separate Mafia-only chat is available at night. It is not written into Town chat and is only returned by the server to Mafia-role clients.
- Only living Mafia players can send secret chat messages, and only during the night.
- The server rejects Assassin kill actions targeting any Mafia role, and the night-resolution query also ignores any Mafia-on-Mafia kill.
- The migration creates a separate RLS-protected chat table and does not drop existing tables or game data.

Security note: secret messages are never shown to Town players in the game UI/API response. The Supabase project owner/database administrators can still access project data according to their database privileges; do not treat this as protection from the project owner.
