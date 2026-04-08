#!/usr/bin/env bash
# -----------------------------------------------------------------------------
# build-and-import.sh
# Build Docker images for all three services and import them into the k3d
# cluster so Kubernetes can pull them with imagePullPolicy: Never.
# -----------------------------------------------------------------------------
set -euo pipefail

CLUSTER_NAME="corp-cluster"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

step() { echo; echo "==> $*"; }
info() { echo "  [INFO]  $*"; }

# ---------- 1. Build images --------------------------------------------------
step "Building corp-samba:latest"
docker build -t corp-samba:latest "$ROOT/docker/samba"

step "Building corp-backend:latest"
docker build -t corp-backend:latest "$ROOT/backend"

step "Building corp-frontend:k8s  (VITE_API_URL=http://corp.localhost)"
docker build \
  --build-arg VITE_API_URL=http://corp.localhost \
  -t corp-frontend:k8s \
  "$ROOT/frontend"

# ---------- 2. Import into k3d -----------------------------------------------
step "Importing images into k3d cluster: $CLUSTER_NAME"
info "Importing corp-samba:latest ..."
k3d image import corp-samba:latest -c "$CLUSTER_NAME"

info "Importing corp-backend:latest ..."
k3d image import corp-backend:latest -c "$CLUSTER_NAME"

info "Importing corp-frontend:k8s ..."
k3d image import corp-frontend:k8s -c "$CLUSTER_NAME"

echo
echo "Images imported. Next step:"
echo "  ./scripts/deploy.sh"
