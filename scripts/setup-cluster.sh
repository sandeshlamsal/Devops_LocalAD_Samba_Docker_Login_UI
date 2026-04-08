#!/usr/bin/env bash
# -----------------------------------------------------------------------------
# setup-cluster.sh
# Install Colima + k3d (via Homebrew), start the Colima VM, and create the
# k3d "corp-cluster" Kubernetes cluster with Traefik port-forwarding.
# -----------------------------------------------------------------------------
set -euo pipefail

CLUSTER_NAME="corp-cluster"
COLIMA_CPU=2
COLIMA_MEM=4       # GB
COLIMA_DISK=40     # GB

# ---------- helpers ----------------------------------------------------------
info()  { echo "  [INFO]  $*"; }
step()  { echo; echo "==> $*"; }
check() { command -v "$1" &>/dev/null; }

# ---------- 1. Install dependencies via Homebrew -----------------------------
step "Checking / installing dependencies"

if ! check brew; then
  echo "Homebrew not found. Install it from https://brew.sh and re-run."
  exit 1
fi

for tool in colima k3d kubectl; do
  if check "$tool"; then
    info "$tool already installed ($(${tool} version 2>/dev/null | head -1 || true))"
  else
    info "Installing $tool..."
    brew install "$tool"
  fi
done

# ---------- 2. Start Colima --------------------------------------------------
step "Starting Colima VM (${COLIMA_CPU} CPU / ${COLIMA_MEM} GB RAM / ${COLIMA_DISK} GB disk)"

if colima status 2>/dev/null | grep -q "Running"; then
  info "Colima is already running."
else
  colima start \
    --cpu   "$COLIMA_CPU" \
    --memory "$COLIMA_MEM" \
    --disk  "$COLIMA_DISK" \
    --runtime docker
fi

# ---------- 3. Create k3d cluster --------------------------------------------
step "Creating k3d cluster: $CLUSTER_NAME"

if k3d cluster list 2>/dev/null | grep -q "$CLUSTER_NAME"; then
  info "Cluster '$CLUSTER_NAME' already exists — skipping creation."
else
  k3d cluster create "$CLUSTER_NAME" \
    --port "80:80@loadbalancer" \
    --port "443:443@loadbalancer" \
    --agents 1
fi

# ---------- 4. Set kubectl context -------------------------------------------
step "Switching kubectl context to $CLUSTER_NAME"
kubectl config use-context "k3d-${CLUSTER_NAME}"

# ---------- 5. Verify --------------------------------------------------------
step "Cluster info"
kubectl cluster-info
echo
kubectl get nodes -o wide

echo
echo "Setup complete. Next step:"
echo "  ./scripts/build-and-import.sh"
