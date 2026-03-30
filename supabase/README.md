Supabase setup notes

1. Create a Supabase project.
2. Run schema.sql in the SQL editor.
3. Use the tables below for long-term reporting storage:
   - customer_profiles
   - pod_sites
   - daily_temp_snapshots
   - pod_snapshots
4. For Vercel deployment, set environment variables there for any future Supabase sync logic.

This repo currently ships the schema and Vercel entrypoint so the app can be deployed cleanly. Temp error snapshots can now be synced into Supabase and used as the reporting source for compile/daily temp reports, while local JSON remains the fallback runtime cache.

5. Optional for web-dashboard login + admin management:
   - create the `dashboard_web_users` table from `schema.sql`
   - set `SUPABASE_URL`
   - set `SUPABASE_SERVICE_ROLE_KEY`
6. If the Supabase env vars are missing, the app falls back to local bootstrap mode with `admin / admin` so local development is not blocked.


7. If you already created `daily_temp_snapshots` earlier, rerun `schema.sql` so the newer optional columns are added with `alter table ... add column if not exists ...`.
