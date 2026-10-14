# Supabase pilot

The active application ledger remains Google Sheets. This diagnostic uses only
synthetic `pilot-test:` records; it cannot claim real applications.

Database migration: `migrations/20261014-supabase-pilot.sql` (already applied to
the Lilly pilot project). Functions are restricted to the server service role.

Railway worker configuration:

- `LILLY_SUPABASE_URL=https://vjmaaljmdeaetrrogzah.supabase.co`
- `LILLY_SUPABASE_PILOT=true`
- `LILLY_SUPABASE_SERVICE_KEY`: enter the project's server-side key directly
  into Railway; never put it in this repository or a browser client.

When enabled, startup prints one `[supabase-pilot]` summary with boolean checks.
No credential or provider error body is logged. Each run has a unique synthetic
namespace, so restart does not claim previous test records. Failed diagnostics
do not stop the existing worker. Disable the flag after a verified acceptance run.

Acceptance criteria: exactly one of two claims succeeds; expired processing can
be recovered; submitted/uncertain/submitting/excluded/closed states cannot be
claimed; imported snapshot is readable. Expired `submitting` jobs intentionally
need reconciliation and never automatically return to the queue.

The October 14 management-API test passed these database checks. A deployed
worker/API access test is still required. This is not production queue locking:
the live application engine has not been switched to these functions.

The snapshot import preserved all 47 original records. Repeating it inserted
zero rows. Snapshot tables are not an ongoing synchronization or backup system.
