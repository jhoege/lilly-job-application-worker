# Salary validation

The worker uses the exact posting description and top card, grounded to the current job ID. Whole-page salary extraction is prohibited in discovery, comparable research, and application processing.

Employer base salary ranges and fixed amounts/caps take precedence over comparable estimates. Conflicting posting bands, nonannual pay, mismatched verified ranges, incomplete descriptions, and unsupported figures block the job. Bonuses, equity and total compensation are not base salary. Current verified Job Search records remain authoritative when the posting omits pay. Old worker-generated ranges without this validation version cannot be reused as evidence.

The target remains max(120000, min + 0.75 * (max - min)). Qualification rejects caps below the minimum and answers outside the evidenced range. Validated posted ranges cannot be silently replaced by a conflicting range or comparable estimate. Salary target and baseline are written together using values.batchUpdate.

Before submission the worker rereads the job-specific tracker target, validates entered salary fields and any salary shown on the final review, and persists evidence in Applications V:W. If an observed salary question is missing from review or differs from the target, submission is blocked. A form that has no salary question is recorded as such, without claiming the target was transmitted. Applications U identifies the salary validation version. Submitted/uncertain history remains protected.

Regression tests cover Movement ($190000-$220000, target $212500), Stealth (base cap $150000), Nabis (starting base $260000), source conflicts, compensation exclusions, fixed pay, tracker writes, and the actual worker submit/block path using a simulated application. These tests do not submit real applications or change previously submitted answers.
