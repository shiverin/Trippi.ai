# Trippi Cloud Infrastructure and Billing Findings

> Local operator note. This file is intentionally excluded from Git.

Last verified: July 14, 2026 (Asia/Singapore)

## Current Architecture

- Application VM: Google Compute Engine `trippi-prod-01`.
- Zone: `us-central1-a`.
- Machine type: `e2-micro`.
- Boot disk: 50 GB `pd-standard`.
- External IPv4: `136.111.97.129`, reserved as `trippi-prod-ip` and attached to
  the running VM.
- Production database: Oracle Autonomous Database using the direct async Oracle
  provider (`TRIPPI_DB_PROVIDER=oracle-async`).
- Production data is in Oracle Autonomous Database. Local SQLite files are
  disposable test state and are not production backups.
- No GCP disk snapshots were present when the resource inventory was checked.

## Live Google Cloud Billing Findings

The following values were read from the signed-in Google Cloud Billing console
for the Trippi project. Billing data was available through July 13, 2026.

- Billing account state: unactivated Google Cloud Free Trial.
- Current-month total for July 1-13: SGD 0.00.
- Forecasted July total: SGD 0.00.
- June invoice amount due: SGD 0.00.
- Free-trial credit remaining: SGD 382.97 out of SGD 382.98.
- Trial expiration: September 28, 2026, with 75 days remaining when checked.
- Google states that this account is not billed during the Free Trial. If the
  account is not upgraded, trial resources stop when the trial ends rather than
  continuing as paid resources.

### Current-Month SKU Evidence

- E2 instance core usage: `$2.11`, offset by a `-$2.11` Free Tier discount.
- E2 instance RAM usage: `$1.14`, offset by a `-$1.14` Free Tier discount.
- External IP Charge on a Standard VM: 299.44 hours, `$0.00` usage cost.
- Storage PD Capacity: 20.12 GiB-month, `$0.00` usage cost at the time checked.
- Networking service usage: `$1.18`, fully offset by other savings.
- The networking amount consisted primarily of Network Intelligence Center
  resource-hour SKUs, each offset by an equal saving, plus approximately `$0.01`
  of data transfer.
- Current subtotal, tax, and total all displayed as `$0.00`/SGD 0.00.

The live billing record is authoritative for the current bill. Earlier estimates
that the external IPv4 would immediately cost about USD 3.65 per month did not
match the console: the actual External IP SKU currently shows 299.44 hours at
`$0.00`.

This does not guarantee the same net price after the Free Trial, after account
activation, or after Google changes its pricing or Free Tier rules. Recheck the
SKU report before upgrading the billing account.

## Free Tier Limits and Future Risk

- One non-preemptible `e2-micro` in `us-central1` is within the eligible Compute
  Engine Free Tier shape and region.
- The standard persistent-disk allowance is 30 GB-month. The attached disk is
  50 GB, so a full month can exceed the allowance by approximately 20 GB-month.
- At the July 13 billing cutoff, the disk had accumulated only 20.12 GiB-month,
  which is why the current disk line still displayed `$0.00`.
- Outbound network usage beyond applicable free allowances can become billable.
- The console's July forecast was SGD 0.00, but a forecast during an unactivated
  Free Trial should not be treated as proof of permanent zero cost.
- Shrinking a GCP persistent disk in place is not supported. Reducing the disk to
  30 GB would require creating a smaller replacement disk and migrating data.

## Oracle Network Dependency

- Oracle Autonomous Database is currently reached through its public endpoint.
- This deployment requires an outbound IPv4 path from the GCP VM to Oracle.
- Removing the VM's external IPv4 caused Oracle connection-pool timeouts
  (`NJS-040`) and login requests returned HTTP 502.
- Restoring the external IPv4 restored database connectivity and login.
- An Oracle public endpoint does not provide IPv4 connectivity to the GCP VM;
  the VM still needs an IPv4 source address or an IPv4 NAT path.
- Cloud NAT would add its own cost and is not currently preferable to the
  directly attached address.
- Always Free Autonomous Database cannot simply be converted to a private
  endpoint as a no-cost workaround.

## Current Decision

Keep the current architecture unchanged for now:

1. Keep `trippi-prod-01` as an `e2-micro` in `us-central1-a`.
2. Keep `trippi-prod-ip` attached so Oracle connectivity and login continue to
   work.
3. Keep the Oracle Autonomous Database direct async configuration.
4. Do not activate or upgrade the GCP billing account without reviewing the
   post-trial SKU forecast and expected disk overage.
5. Recheck billing before September 28, 2026 so the team can decide whether to
   activate billing, resize/migrate storage, or move compute.

## Verification Notes

- GCP resource inventory was checked with `gcloud` against project
  `project-3ad3d06e-bcb7-4ecf-a7e`.
- Billing totals and SKU lines were verified in the user's signed-in Chrome
  session under the Google account that owns the Trippi project.
- No infrastructure or billing settings were changed during the billing review.
