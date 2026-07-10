# Manual SQL retirement

The former one-off SQL files were consolidated into
`supabase/migrations/20260710104958_remote_baseline.sql` during Milestone 0.

Do not add new SQL here. Create every future schema change with
`supabase migration new <name>`, test it with a local database reset, and then
apply it through the migration workflow.

Data repair and demo seed operations belong in reviewed scripts or
`supabase/seed/`; they must not be mixed into schema migrations.
