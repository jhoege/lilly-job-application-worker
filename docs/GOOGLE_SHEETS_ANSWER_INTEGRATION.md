# Google Sheets answer database integration

Spreadsheet: https://docs.google.com/spreadsheets/d/1g4eUIwU1-zyZWuNyMCxradZLhtDnjBcTS34DkxUcItg/edit

Tabs: Approved Answers, Questions To Answer, Applications, Automation Rules.

## Access architecture
The ChatGPT Google Drive connector can read and update the sheet when invoked in conversation. The Railway worker has no delegated Google Sheets credentials merely because ChatGPT has access. Do not place OAuth access tokens or API keys in source control.

Provision a restricted Google service account or OAuth integration with access only to this sheet. Store credentials in Railway secret variables, and use the official Google Sheets API over TLS.

## Synchronization
- Read Approved Answers at the beginning of each processing run.
- Use only rows marked Approved. Treat blanks and Review as unknown.
- Match exact normalized questions first; propose semantic equivalents for human review, not automatic high-stakes answers.
- Append unknown questions to Questions To Answer with unique hash(platform, jobId, normalized question).
- Refresh approved answers between jobs; do not silently change an in-progress answer.
- Write application status only after independently verified submission.
- Protect sheet against concurrent write races and never overwrite user's answers.
- Never put passwords, verification codes, cookies, SSNs, or government IDs in this sheet.

## Execution
A separate LinkedIn adapter and Indeed adapter must inspect supported application forms and respect each site's terms and access controls. Unsupported forms or security challenges go to manual review. The current Railway worker has no automated submit implementation; TEST_MODE remains enabled.

## Acceptance criteria
1. Approved answers load from Google Sheet using least-privilege credentials.
2. Unknown questions are appended once and remain pending until approved.
3. Changing a pending row to Approved makes it available to the next job.
4. No submission occurs on missing, uncertain, or inconsistent required answers.
5. All verified submissions are recorded with platform job ID and evidence.
