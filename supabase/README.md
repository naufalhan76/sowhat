Supabase setup notes

1. Create a Supabase project.
2. Run schema.sql in the SQL editor.
3. Use the tables below for long-term reporting storage:
   - customer_profiles
   - pod_sites
   - daily_temp_snapshots
   - pod_snapshots
4. For Vercel deployment, set environment variables there for any future Supabase sync logic.

This repo currently ships the schema and Vercel entrypoint so the app can be deployed cleanly, while the local JSON storage remains the active runtime source of truth.
