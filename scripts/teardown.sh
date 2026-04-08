#!/usr/bin/env bash
# -----------------------------------------------------------------------------
# teardown.sh
# Delete the k3d cluster and stop the Colima VM.
# WARNING: This destroys all cluster state, including Samba AD data.
# -----------------------------------------------------------------------------
set -euo pipefail

CLUSTER_NAME="corp-cluster"

echo "WARNING: This will delete the '$CLUSTER_NAME' cluster and stop Colima."
echo "All Kubernetes resources (including Samba AD data) will be lost."
read -rp "Continue? [y/N] " confirm
[[ "${confirm,,}" == "y" ]] || { echo "Aborted."; exit 0; }

echo
echo "==> Deleting k3d cluster: $CLUSTER_NAME"
k3d cluster delete "$CLUSTER_NAME" 2>/dev/null || echo "Cluster not found, skipping."

echo
echo "==> Stopping Colima"
colima stop 2>/dev/null || echo "Colima not running, skipping."

echo
echo "Done. To restart from scratch:"
echo "  ./scripts/setup-cluster.sh"
echo "  ./scripts/build-and-import.sh"
echo "  ./scripts/deploy.sh"
