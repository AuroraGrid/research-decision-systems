# NoSpinZone X Publisher

Temporary outbound publisher for the canonical `NO_SPIN_ZONE_QUEUE` Google Sheet while Manus execution credits are unavailable.

## Safety model

The publisher is fail-closed:

- Only rows with `STATUS = APPROVED` are eligible.
- `BUFFER_POST_ID` must be blank.
- Future `SCHEDULE_TIME` rows are skipped.
- A `PUBLISHING|...` marker is written before the X API call to prevent blind retries after an ambiguous failure.
- Exact duplicate text is blocked using a SHA-256 hash stored in Script Properties.
- Successful posts become `POSTED`, receive the X post ID in `BUFFER_POST_ID`, and record the result timestamp.
- Failed posts are moved to `YELLOW_REVIEW`; they are not automatically retried.
- The script never follows, likes, replies, DMs, deletes, or changes profile settings.

## Install

1. Open the canonical NoSpinZone Google Sheet.
2. Select **Extensions -> Apps Script**.
3. Replace the default editor contents with `Code.gs` from this folder and save.
4. Open **Project Settings -> Script properties**.
5. Add these four properties using the AURORAGRID / @NoSpinZone OAuth 1.0a credentials:
   - `X_CONSUMER_KEY`
   - `X_CONSUMER_SECRET`
   - `X_ACCESS_TOKEN`
   - `X_ACCESS_TOKEN_SECRET`
6. Never put credential values in the Sheet, GitHub, chat, code, logs, or screenshots.
7. In the Apps Script function selector run `verifySetup` once and approve the Google permissions requested by Apps Script.
8. Run `dryRunApprovedPosts`. Confirm only the intended human-approved row appears in the execution log.
9. For the first controlled test, run `publishApprovedPosts` manually. Confirm X created exactly one post and the Sheet changed to:
   - `STATUS = POSTED`
   - `BUFFER_POST_ID = <X post ID>`
   - `RESULT = POSTED VIA X API|...`
10. Only after the controlled test passes, run `installFiveMinuteTrigger` once. The worker will then check the queue every five minutes.

## Canonical expected columns

The existing `QUEUE` sheet must contain:

`ID`, `DRAFT_POST`, `STATUS`, `SCHEDULE_TIME`, `BUFFER_POST_ID`, `RESULT`

The current NoSpinZone sheet already contains these headers.

## Publishing state machine

`RED_REVIEW / YELLOW_REVIEW / GREEN_CANDIDATE`

-> human decision

`APPROVED`

-> Apps Script worker

`PUBLISHING|timestamp|attempt-id`

-> X `POST /2/tweets`

Success:

`POSTED` + X post ID

Failure/ambiguity:

`YELLOW_REVIEW` + error record

## Emergency stop

In the Sheet choose **NoSpinZone Publisher -> Remove publisher triggers**.

You can also change any pending row away from `APPROVED`; the worker will ignore it.

## Notes

The script is intentionally limited to ordinary text posts up to 280 characters for the launch test. Media, threads, replies, quote posts, follows, likes, and DMs are not implemented.
