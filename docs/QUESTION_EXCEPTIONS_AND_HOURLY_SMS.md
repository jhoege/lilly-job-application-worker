# Skip-and-continue application processing and hourly SMS

## User-approved behavior (2026-10-08)
For every job, use only approved answers from the Google Sheets answer database. If a required question is missing or ambiguous, record its exact wording, source, employer, job ID, URL, input type, timestamp, and status in Questions To Answer. Deduplicate by (platform, job ID, normalized question). Save draft where supported; otherwise exit without submission. Mark job needs_answers and continue the queue. Do not silently answer qualification, clearance, authorization, or other high-stakes questions.

Once the user enters a response and sets Approval=Approved, refresh the answer bank and requeue affected jobs. Never assume a sheet edit is approved if Approval is not Approved. Track attempts and prevent duplicate submissions.

## Hourly SMS policy
At the top of each hour, check the sheet for rows with Approval != Approved. If at least one question is pending, send one SMS to the user's verified mobile number using the existing Lilly SMS gateway. Message: 'Lilly: {count} job application question(s) need your approved answers. Update: {sheet_url}'. If zero, do not text. Log send outcome and avoid duplicate sends for the same hour. If SMS fails, retain pending state and log the error; never claim a text was sent without gateway confirmation.

## Dependencies and security
SMS gateway services exist in the Lilly Compliance Railway project, but their authenticated API contract and sending credentials must be verified before integration. Do not expose the gateway publicly or copy SMS credentials into GitHub. Job worker needs Google Sheets append/write integration; currently it only reads approved answers. Do not enable live batch submission until form adapter and submission verification tests pass.

## Acceptance tests
- Unknown question logged exactly once and job skipped; next job continues.
- Approved question makes blocked job eligible on subsequent run.
- No question pending => no SMS.
- Multiple pending questions => one hourly SMS with count and link.
- Failed SMS => logged as failed, not sent.
- Never send duplicate SMS for same hour.
- Successful application requires actual LinkedIn/Indeed confirmation.
