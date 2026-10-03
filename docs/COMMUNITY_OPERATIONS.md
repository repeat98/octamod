# Community operations

These procedures accompany the forum draft. They do not authorize a production deployment, restore, data deletion or provider-plan change. Use Node 24 and the reviewed dependency lockfile. Keep operational evidence and private identifiers outside Git, screenshots and public PR descriptions.

## Opening and pausing registrations

Both Wrangler configurations default `REGISTRATION_OPEN` to `false`. The server rejects new registrations unless it is exactly `true`; hiding the frontend form is not the control. Closing registration keeps existing sign-in, verification, recovery and moderation available. The session endpoint reports mail availability separately from registration availability.

Deploy the reviewed backend and apply migrations 0011–0014 only after owner authorization. Keep registration closed while checking health, existing content, administrator access and the frontend/API origin. Open it only after the controlled runtime and real-mail tests in [FORUM_LAUNCH.md](FORUM_LAUNCH.md) pass and the owner approves public launch. An operator can pause signups by deploying the reviewed configuration with registration closed. Do not improvise changes to hashing parameters or provider billing to solve capacity problems.

## Backups and recovery

D1 [Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/) is always on for production-storage databases: the documented recovery window is seven days on Workers Free and 30 days on Workers Paid. Verify the actual account plan and database storage version. Record the current bookmark privately immediately before any migration. Time Travel restores overwrite the database and cancel in-flight queries; obtain specific owner approval before using them.

The backup helper writes an authenticated AES-256-GCM archive. Its restore command supports only a fresh local directory. The local exporter uses the pinned Wrangler/Miniflare D1 exporter with explicit persistence because `wrangler d1 export` does not accept `--persist-to`.

Create a private key once, without printing it:

```sh
mkdir -p .wrangler/private-backups
chmod 700 .wrangler/private-backups
node --input-type=module -e "import {randomBytes} from 'node:crypto'; import {writeFileSync} from 'node:fs'; writeFileSync('.wrangler/private-backups/backup-key',randomBytes(32).toString('hex'),{mode:0o600,flag:'wx'})"
```

Test with fictional local data first:

```sh
node scripts/community-backup.mjs backup --config wrangler.worker.jsonc --database octamod-community --local --persist-to .wrangler/forum-preview --archive .wrangler/private-backups/local-check.octamod --key-file .wrangler/private-backups/backup-key
node scripts/community-backup.mjs restore-local --config wrangler.worker.jsonc --database octamod-community --local --persist-to .wrangler/restore-check --archive .wrangler/private-backups/local-check.octamod --key-file .wrangler/private-backups/backup-key
```

After production access is authorized, take an encrypted remote export:

```sh
node scripts/community-backup.mjs backup --config wrangler.worker.jsonc --database octamod-community --remote --archive .wrangler/private-backups/prelaunch.octamod --key-file .wrangler/private-backups/backup-key
```

The helper withholds provider output and removes its private temporary plaintext SQL in `finally`. Exported SQL still exists briefly on the operator's disk; use a trusted encrypted device. Dumps over 256 MiB need a separately reviewed streaming procedure. Never put archives, key files or restored private databases in Git. Store an encrypted archive off-device and the recovery key in separate restricted storage; encryption is ineffective if archive and key are stolen together. Restore only on a trusted local device, compare schema/table counts, run integrity and foreign-key checks, and record metadata rather than rows. An archive is not a verified recovery point until its restore is checked.

Before launch, assign a backup operator and confirm the off-device destination, access and retention. Recommended operating cadence: daily encrypted exports, before each migration, and a recovery drill after schema changes. This document does not create a scheduler or external storage account. Confirm the archive rotation period explicitly; the application does not automatically rotate backup files. A recovery must reapply any approved removal records made after the restore point before reopening the service, to avoid restoring erased personal data.

## Private account-removal requests

Members submit a private request from Your account using their current password and a confirmation. Requests can be withdrawn while pending; duplicate active requests are merged. The Accounts tab in the administrator workspace lists the private queue. A visitor/member session cannot access it. The review note should record approval references and actions, without passwords, email addresses, action links or unnecessary personal details.

Submission and review never delete data. There is no automatic deletion endpoint. For each request:

1. Verify control of the account and confirm the exact scope with the member through an approved private support channel. Choose and record how public discussion, comments, attribution, configuration snapshots, reactions and any externally published GitHub issues will be handled. Do not infer consent to erase contributions from a bare account request.
2. Prepare a reviewed transaction and a recovery point for that exact account ID. Require separate authorization for the destructive operator action. Prefer suspension/session revocation before the approved removal to prevent concurrent writes.
3. Remove private authentication records and action tokens, private reports including their device logs, saved configurations, follows/bookmarks/notifications and moderation reports as approved. Address user references in submissions/media and review/moderation history as applicable. Inventory the current schema rather than relying on an outdated table list.
4. Apply the approved public-content handling and retain an inert `users` projection when needed for discussion/attribution foreign keys: no username, unverified, suspended, display name `Deleted member`. Do not grant the old identity to a new account. Preserve other contributors' posts and source attribution as agreed. Provider logs, existing public GitHub issues and recovery archives need separate handling; database changes cannot erase those copies.
5. Verify the original credentials and sessions fail, private APIs cannot recover the removed data, other members still work, references are valid and retained content matches the approved scope. Only then mark the request complete and record a minimal private audit note.

The server rejects completion while authentication, account tokens, legacy sessions, private reports/configurations, follows/bookmarks/notifications/reports or the active user projection remain. This is a minimum technical check; it cannot inspect provider logs, archives, public free text or externally published copies. The operator must verify those separately.

The owner chose `jannik.assfalg@gmail.com` as the public receiving support contact on 3 October 2026. Sign-in, privacy and account-removal pages link to it, and transactional email sets it as Reply-To. `accounts@octamod.app` remains the sending identity; it is not presented as a receiving mailbox. Confirm support-message receipt and the response procedure before public launch. Never ask a member to email passwords, recovery links or firmware.

## Retention and private records

Current implemented retention is deliberately stated in public privacy copy:

| Data | Current behavior |
| --- | --- |
| Verification / recovery links | Expire after 24 hours / 30 minutes; one use |
| Member / administrator sessions | Up to seven days / eight hours; revocable |
| Expired sessions, action tokens and rate-limit buckets | Removed by the hourly Worker cleanup |
| Aggregate site usage | Existing 90-day daily retention |
| Accounts and unverified registrations | Retained until operator removal |
| Forum posts, configurations, reports, notifications and review history | Retained until operator removal; no automatic deletion schedule |
| Aggregate mail counters | Retained; admin response shows at most 60 day/purpose rows |
| Resend logs / Cloudflare recovery history | Provider retention and account settings; verify in the provider dashboards |
| Encrypted export archives | Operator-controlled; no automatic rotation |

Before public launch, approve the public privacy/support details and document the chosen archive/provider retention. Define any shorter account/report/notification retention explicitly before adding irreversible cleanup; do not silently delete pending reports or retained attribution. Public free text can contain personal information despite guidance, so moderation/removal procedures apply to it too.

## Mail failures, moderation and incidents

Account acceptance responses are intentionally generic, including provider failure and exhausted global sending quotas, to avoid disclosing account membership. They are not delivery receipts. The private Accounts tab counts provider-accepted, failed and limited attempts by UTC day and purpose; it never stores recipients, action links, response bodies or message IDs. Provider acceptance does not prove inbox delivery. Investigate a failure count or support report in Resend, checking bounce/suppression/TLS failures and actual delivery. Do not copy message bodies or recipient addresses into application logs or public issues.

The sender has a ten-second request timeout and an idempotency key derived from the action token. Failed attempts consume quota. There is no automatic retry loop: members can request a fresh verification/recovery message within per-address/IP/global limits. A verification resend creates a new complete action token even within the same second and replaces the previous one. Recovery revokes other sessions and outstanding action links. Mail is transactional only; no forum notification emails or newsletters.

During the initial launch period, the assigned operator should review the private forum reports/account requests and mail counters daily and check Cloudflare request errors, CPU limits and D1 failures after releases. Use provider aggregate metrics; do not enable request-body, credential, action-link or address logging. Alerts/scheduled checks are not configured by this draft. Record the operator and escalation route before opening registration.

Forum reports, hiding, locking, suspending and private moderation history are available behind separate administrator authorization. For spam, suspend the offending account and hide the affected content with a concise private reason. Suspension revokes member/legacy sessions. Do not publish private reports or device logs as part of moderation.

For suspected credential compromise, pause registrations and affected writes through an approved deployment, capture minimal aggregate evidence, rotate the affected Worker secrets and revoke compromised sessions/action tokens. Rotating `AUTH_SECRET` alone does not replace the need to review stored sessions and action tokens. Administrator key rotation invalidates administrator sessions. Revoke/replace a compromised Resend key using domain-restricted sending-only permissions. Recover from the last verified database/Worker version with owner approval, preserve approved removal records, and test access boundaries before reopening. Keep security advisories reviewed and dependencies pinned; ordinary application checks never run firmware/DSP tests.
