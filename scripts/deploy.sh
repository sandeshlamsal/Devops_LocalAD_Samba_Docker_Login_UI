#!/usr/bin/env bash
# -----------------------------------------------------------------------------
# deploy.sh
# Apply all Kubernetes manifests in order and wait for pods to become ready.
# -----------------------------------------------------------------------------
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
NS="corp-local"

step() { echo; echo "==> $*"; }

# ---------- 1. Apply manifests -----------------------------------------------
step "Applying namespace"
kubectl apply -f "$ROOT/k8s/namespace.yaml"

step "Applying Samba (PVC + StatefulSet + Service)"
kubectl apply -f "$ROOT/k8s/samba/"

step "Applying Backend (ConfigMap + Secret + Deployment + Service)"
kubectl apply -f "$ROOT/k8s/backend/"

step "Applying Frontend (Deployment + Service)"
kubectl apply -f "$ROOT/k8s/frontend/"

step "Applying Ingress"
kubectl apply -f "$ROOT/k8s/ingress.yaml"

# ---------- 2. Wait for pods -------------------------------------------------
step "Waiting for all pods in namespace '$NS' to be ready (timeout 3 min)"
# Samba needs extra time for domain provisioning on first boot
kubectl wait \
  --namespace "$NS" \
  --for=condition=ready pod \
  --all \
  --timeout=180s || {
    echo
    echo "[WARN] Some pods may still be starting. Current status:"
    kubectl get pods -n "$NS"
    echo
    echo "Samba takes ~30-60 s to provision on first boot — retry:"
    echo "  kubectl wait --namespace $NS --for=condition=ready pod --all --timeout=60s"
  }

# ---------- 3. Summary -------------------------------------------------------
echo
step "Deployment summary"
kubectl get all -n "$NS"
echo
kubectl get ingress -n "$NS"

echo
echo "Stack is up. Access the app:"
echo "  http://corp.localhost"
echo
echo "If corp.localhost doesn't resolve, add this line to /etc/hosts:"
echo "  127.0.0.1  corp.localhost"
