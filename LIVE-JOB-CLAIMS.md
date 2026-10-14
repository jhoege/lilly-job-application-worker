# Live queue claim gate

`LILLY_JOB_CLAIMS=supabase` enables Supabase ownership for the LinkedIn
`triageQueue` path. Sheets remains the source of answers, salary evidence,
application outcomes and operator review. Drive archives remain unchanged.

The worker claims before opening a page, renews processing leases every 30
seconds and atomically marks submitting immediately before the Submit click.
Processing leases expire after ten minutes; submitting and uncertain records
never expire into retry eligibility. All state changes require the owner's
random token. A stale worker cannot submit or record a replacement worker's
outcome. Claim API/configuration failures block the job before browser access
and preserve the existing ledger status.

Apply `migrations/20261014-live-job-claims.sql` first. Historical submitted,
excluded, expired, closed and uncertain records are seeded from the 47-row
snapshot; they are not overwritten on repeated migration. The database stores
per-platform IDs, not employer-wide deduplication. Cross-platform role matches
still require reconciliation. The original Capstone row has no job ID and
cannot seed an identity-based claim.

When the Supabase diagnostic and live gate are enabled together, startup tests
the actual live functions against a unique `claim-test:` record. No application
page is opened for the test. Logs report `liveQueueGate: true` only if a duplicate
claim and an uncertain-submission retry were both refused.

Acceptance: 48 automated tests pass. Real database competing claims allowed
exactly one winner; wrong-owner submission was refused; expired processing
recovered with a new owner; submitting could not be reclaimed; an interrupted
submission became uncertain. These checks establish the gate, not a new live
application submission. Indeed processing outside triageQueue is not covered.

Disabling the gate removes distributed protection. Do not use that as a
workaround for a database outage; restore access or pause processing instead.
