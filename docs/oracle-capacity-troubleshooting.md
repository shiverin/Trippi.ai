# Oracle Capacity Troubleshooting

This repo is prepared for Oracle Cloud Infrastructure Always Free deployment, but
OCI can reject valid Always Free shapes when the selected availability domain has
no host capacity.

If Oracle remains capacity-blocked, use
[`docs/free-backend-fallback-runbook.md`](./free-backend-fallback-runbook.md) for
the current Azure, Google, AWS, Railway, and Cloudflare fallback paths.

## Current Evidence

Observed in the Singapore region, AD-1:

- `VM.Standard.A1.Flex` failed with `Out of capacity` at 1 OCPU / 6 GB RAM.
- `VM.Standard.A1.Flex` failed again at 1 OCPU / 4 GB RAM.
- `VM.Standard.A1.Flex` failed again at 1 OCPU / 1 GB RAM.
- `VM.Standard.E2.1.Micro` failed with Oracle choosing the fault domain.
- `VM.Standard.E2.1.Micro` failed explicitly in `FAULT-DOMAIN-1`.
- `VM.Standard.E2.1.Micro` failed explicitly in `FAULT-DOMAIN-2`.
- `VM.Standard.E2.1.Micro` failed explicitly in `FAULT-DOMAIN-3`.

The quota policy was updated and verified after OCI reported exact quota names.
After that, the failure changed from quota errors to host-capacity errors, so the
remaining blocker is external OCI capacity.

Current Oracle documentation lists the Always Free A1 allowance for Always Free
tenancies as 2 OCPUs and 12 GB memory total. This repo's current create attempt
is intentionally smaller: `VM.Standard.A1.Flex` at 1 OCPU / 6 GB RAM.

The original create-instance tab is no longer open, but Chrome still has an OCI
Resource Manager "Create stack" tab generated from that form. A read-only decode
of the stack URL showed:

- Region: `ap-singapore-1`.
- Availability domain: `okrn:AP-SINGAPORE-1-AD-1`.
- Shape: `VM.Standard.A1.Flex`.
- Shape config: 1 OCPU / 6 GB RAM.
- Public IPv4 assignment: `false`.
- Capacity reservation: absent.
- VCN/subnet names: `trippi-vcn` and `trippi-public-subnet`.

This stack has not been submitted.

The OCI create-instance cost panel showed `$2.76/month` for the boot volume on a
50 GB A1 create form. Oracle's cost-estimate documentation says console
estimates are based on the organization's rate card and do not include tier-unit
pricing. Oracle's Always Free documentation separately says the default 50 GB
boot volume counts toward the 200 GB Always Free block-volume allowance in the
home region. So this is likely a list-price estimate rather than the net
Always-Free bill. Still, with a strict `$0` budget, do not submit the create form
when OCI shows a non-zero cost estimate unless the account owner explicitly
confirms the action.

## Free-Safe Retry Order

1. Retry `VM.Standard.A1.Flex` with Ubuntu 24.04 aarch64, 1 OCPU, 6 GB RAM.
2. If A1 fails, retry A1 at 1 OCPU / 4 GB RAM.
3. If A1 still fails, retry A1 at 1 OCPU / 1 GB RAM.
4. Retry `VM.Standard.E2.1.Micro` with regular Ubuntu 24.04.
5. For E2 micro, test `FAULT-DOMAIN-1`, `FAULT-DOMAIN-2`, and
   `FAULT-DOMAIN-3`.
6. If all fail, wait and retry later.

Do not switch to paid shapes unless the account owner explicitly approves it.
Do not repeatedly click Create after OCI returns rate-limit errors; wait for the
rate limit to clear before retrying.
Do not click Create when the console's cost estimate shows a non-zero monthly
charge unless the account owner explicitly confirms the risk.

## What Not To Use For A Zero-Spend Setup

- Capacity reservations: Oracle documents that unused reserved capacity is
  billed, and instances created against a reservation are billed.
- Preemptible capacity: Oracle describes this as a 50% discount from on-demand
  pricing, not as an Always Free capacity workaround.
- Additional regions: do not subscribe to extra regions only to chase free
  capacity unless billing impact has been reviewed and approved. Oracle's Free
  Tier documentation says Always Free compute instances can be provisioned only
  in the tenancy home region. Subscribing the tenancy to another region is
  possible, but it does not change the home region and region subscriptions
  cannot be undone.

## Region Options

For the existing tenancy:

- Home region: Singapore.
- Home region can not be changed after tenancy creation.
- New region subscriptions are possible, but not a zero-spend fix for Always
  Free compute capacity.

Free-safe options:

- Keep retrying in the home region.
- If the owner explicitly approves it later, upgrade to Pay As You Go while
  keeping quotas capped to Always Free-sized resources, then retry in the home
  region. This may improve capacity access, but it is an account/billing change
  and is intentionally out of scope for the current strict `$0` setup.

Region-changing options:

- Create a new tenancy/account with a different home region, if Oracle allows it
  and it complies with account policy. This is more disruptive than waiting or
  upgrading because the home region is chosen only during signup.
- Subscribe this tenancy to another region only if you are intentionally willing
  to evaluate paid compute there.

## Repo Deployment Prep

`deploy/oracle/install.sh` creates a 4 GB swap file by default. Keep this enabled
for `VM.Standard.E2.1.Micro`; the VM has only 1 GB RAM and Docker image builds
are memory constrained.

For future OCI CLI retries, use `deploy/oracle/safe-retry-launch.sh`. It defaults
to dry-run, refuses non-free candidate shapes, refuses boot volumes above 50 GB,
and requires `ACK_NONZERO_CONSOLE_ESTIMATE=1` before any real launch attempt.

When a VM is finally created:

```bash
sudo apt-get update
sudo apt-get install -y git
git clone --branch experiment/oracle-autonomous-db https://github.com/shiverin/Trippi.ai.git /tmp/trippi
sudo BRANCH=experiment/oracle-autonomous-db bash /tmp/trippi/deploy/oracle/install.sh
```

Then set `/opt/trippi/app/deploy/oracle/.env` and deploy:

```bash
cd /opt/trippi/app
sudo bash deploy/oracle/deploy.sh
```

## Sources

- Oracle host capacity troubleshooting:
  https://docs.oracle.com/en-us/iaas/Content/Compute/Tasks/troubleshooting-out-of-host-capacity.htm
- Oracle Always Free resources:
  https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm
- Oracle console cost estimates:
  https://docs.oracle.com/en-us/iaas/Content/Billing/Tasks/signingup_topic-Estimating_Costs.htm
- OCI quota policies:
  https://docs.oracle.com/en-us/iaas/Content/Quotas/Concepts/resourcequotas.htm
- Oracle region management:
  https://docs.oracle.com/en-us/iaas/Content/Identity/Tasks/managingregions.htm
- Oracle capacity reservations:
  https://docs.oracle.com/en-us/iaas/Content/Compute/Tasks/reserve-capacity.htm
- Oracle preemptible instances pricing:
  https://blogs.oracle.com/cloud-infrastructure/announcing-preemptible-instances-a-new-kind-of-compute-instance-available-at-a-50-discount
- Oracle Cloud Free Tier FAQ:
  https://www.oracle.com/cloud/free/faq/
