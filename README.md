# Mafia Game Starter — Website + Temporary 5-Player Test Mode

This is a static website project intended for free static hosting. It uses Supabase for anonymous authentication, private rooms, lobby state, and server-side role assignment.

## Included
- `index.html`, `styles.css`, `app.js`: website files
- `supabase.sql`: original Milestone 01 database setup (only run this if setting up a new project)
- `milestone_02_roles.sql`: role-assignment migration (run once in the existing Mafia Supabase project)

## Important database instructions
If Milestone 01 is already working, **do not rerun `supabase.sql`**. If you have not already run `milestone_02_roles.sql`, run it once in Supabase SQL Editor. Do not delete your current database.

## Temporary 5-player testing mode
The “Launch 5-player test” button creates five separate anonymous Supabase auth sessions in memory, creates a room, and joins the other four test players. Use the player switcher in the lobby to inspect each player's view and private role after the host starts the game. No passwords or email addresses are needed.

This mode is for development only. It creates five anonymous Auth users in your Supabase project, which may count toward project usage. Sessions are not persisted in the browser and are cleared when the test mode is left or the page is refreshed, but anonymous user records may remain in Supabase Auth. Remove the testing panel and test code before a public launch. Do not use a service-role or secret key in the browser; the included key is a publishable key.

## Deploy as a website using Netlify Drop (no software installation)
1. Extract this ZIP on your Windows PC.
2. Open `https://app.netlify.com/drop` in your browser and sign in/create a Netlify account if prompted.
3. Drag the extracted `mafia-game-starter` folder onto the drop area. If the page does not accept the folder, open it and drag the folder's website files (`index.html`, `app.js`, `styles.css`, and supporting files) together into the drop area.
4. Wait for Netlify to publish the site, then open the generated `netlify.app` URL.
5. Test room creation and the 5-player test mode on that hosted URL.

The project URL and publishable key are configured in `app.js`. A publishable key is intended for browser use; never put a `service_role` or secret key in frontend files. Keep Supabase Row Level Security and the provided RPC permission rules in place.

## Current limitations
This milestone supports rooms, lobby membership, host-started role assignment, and temporary test-account switching. Night actions, Mafia team chat, investigations, protection, day voting, eliminations, reconnect handling, and win conditions are not implemented yet. The browser test mode is for development, not production.
