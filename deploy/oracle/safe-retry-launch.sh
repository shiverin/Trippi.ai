#!/usr/bin/env bash
set -euo pipefail

# Guarded OCI Always Free launch helper.
#
# Default mode is dry-run: it validates inputs and prints the OCI CLI command.
# To actually launch, set:
#   MODE=launch ACK_NONZERO_CONSOLE_ESTIMATE=1 ./deploy/oracle/safe-retry-launch.sh
#
# This script intentionally refuses paid shapes, preemptible/capacity-reservation
# settings, and oversized boot volumes.

MODE="${MODE:-dry-run}"
SHAPE="${SHAPE:-VM.Standard.A1.Flex}"
OCPUS="${OCPUS:-1}"
MEMORY_GB="${MEMORY_GB:-6}"
BOOT_VOLUME_GB="${BOOT_VOLUME_GB:-50}"
ASSIGN_PUBLIC_IP="${ASSIGN_PUBLIC_IP:-true}"
MAX_ATTEMPTS="${MAX_ATTEMPTS:-1}"
SLEEP_SECONDS="${SLEEP_SECONDS:-300}"
ACK_NONZERO_CONSOLE_ESTIMATE="${ACK_NONZERO_CONSOLE_ESTIMATE:-0}"

required_env=(
  OCI_COMPARTMENT_ID
  OCI_AVAILABILITY_DOMAIN
  OCI_IMAGE_ID
  OCI_SUBNET_ID
  OCI_SSH_PUBLIC_KEY_FILE
)

fail() {
  echo "ERROR: $*" >&2
  exit 1
}

for name in "${required_env[@]}"; do
  [[ -n "${!name:-}" ]] || fail "Missing required env var: ${name}"
done

[[ -f "${OCI_SSH_PUBLIC_KEY_FILE}" ]] || fail "SSH public key file not found: ${OCI_SSH_PUBLIC_KEY_FILE}"

case "${MODE}" in
  dry-run | launch) ;;
  *) fail "MODE must be dry-run or launch, got: ${MODE}" ;;
esac

case "${SHAPE}" in
  VM.Standard.A1.Flex | VM.Standard.E2.1.Micro) ;;
  *) fail "Refusing non-Always-Free candidate shape: ${SHAPE}" ;;
esac

[[ "${BOOT_VOLUME_GB}" =~ ^[0-9]+$ ]] || fail "BOOT_VOLUME_GB must be a whole number"
(( BOOT_VOLUME_GB <= 50 )) || fail "Refusing boot volume above 50 GB for strict zero-spend guardrail"

if [[ "${SHAPE}" == "VM.Standard.A1.Flex" ]]; then
  [[ "${OCPUS}" == "1" ]] || fail "A1 retry guardrail allows only 1 OCPU"
  case "${MEMORY_GB}" in
    1 | 4 | 6) ;;
    *) fail "A1 retry guardrail allows only 1, 4, or 6 GB RAM" ;;
  esac
else
  OCPUS=""
  MEMORY_GB=""
fi

case "${ASSIGN_PUBLIC_IP}" in
  true | false) ;;
  *) fail "ASSIGN_PUBLIC_IP must be true or false" ;;
esac

if [[ "${MODE}" == "launch" ]]; then
  [[ "${ACK_NONZERO_CONSOLE_ESTIMATE}" == "1" ]] ||
    fail "Refusing launch because OCI console showed a non-zero estimate. Set ACK_NONZERO_CONSOLE_ESTIMATE=1 only after explicit owner approval."
  command -v oci >/dev/null 2>&1 || fail "OCI CLI is not installed"
fi

tmpdir="$(mktemp -d)"
cleanup() {
  rm -rf "${tmpdir}"
}
trap cleanup EXIT

ssh_public_key="$(cat "${OCI_SSH_PUBLIC_KEY_FILE}")"

cat > "${tmpdir}/source-details.json" <<JSON
{
  "sourceType": "image",
  "imageId": "${OCI_IMAGE_ID}",
  "bootVolumeSizeInGBs": ${BOOT_VOLUME_GB}
}
JSON

cat > "${tmpdir}/create-vnic-details.json" <<JSON
{
  "subnetId": "${OCI_SUBNET_ID}",
  "assignPublicIp": ${ASSIGN_PUBLIC_IP}
}
JSON

SSH_PUBLIC_KEY="${ssh_public_key}" python3 - <<'PY' > "${tmpdir}/metadata.json"
import os
import json
print(json.dumps({"ssh_authorized_keys": os.environ["SSH_PUBLIC_KEY"]}))
PY

cmd=(
  oci compute instance launch
  --compartment-id "${OCI_COMPARTMENT_ID}"
  --availability-domain "${OCI_AVAILABILITY_DOMAIN}"
  --display-name "${DISPLAY_NAME:-trippi-backend-01}"
  --shape "${SHAPE}"
  --source-details "file://${tmpdir}/source-details.json"
  --create-vnic-details "file://${tmpdir}/create-vnic-details.json"
  --metadata "file://${tmpdir}/metadata.json"
)

if [[ "${SHAPE}" == "VM.Standard.A1.Flex" ]]; then
  cat > "${tmpdir}/shape-config.json" <<JSON
{
  "ocpus": ${OCPUS},
  "memoryInGBs": ${MEMORY_GB}
}
JSON
  cmd+=(--shape-config "file://${tmpdir}/shape-config.json")
fi

echo "Validated strict Always-Free candidate:"
echo "  shape=${SHAPE}"
if [[ "${SHAPE}" == "VM.Standard.A1.Flex" ]]; then
  echo "  ocpus=${OCPUS}"
  echo "  memory_gb=${MEMORY_GB}"
fi
echo "  boot_volume_gb=${BOOT_VOLUME_GB}"
echo "  assign_public_ip=${ASSIGN_PUBLIC_IP}"
echo "  mode=${MODE}"
echo

if [[ "${MODE}" == "dry-run" ]]; then
  printf 'Dry-run command:\n  '
  printf '%q ' "${cmd[@]}"
  printf '\n'
  exit 0
fi

attempt=1
while (( attempt <= MAX_ATTEMPTS )); do
  echo "OCI launch attempt ${attempt}/${MAX_ATTEMPTS}..."
  if "${cmd[@]}"; then
    echo "Launch request submitted."
    exit 0
  fi

  if (( attempt == MAX_ATTEMPTS )); then
    fail "All launch attempts failed"
  fi

  sleep_for=$(( SLEEP_SECONDS + RANDOM % 30 ))
  echo "Retrying in ${sleep_for}s..."
  sleep "${sleep_for}"
  attempt=$((attempt + 1))
done
