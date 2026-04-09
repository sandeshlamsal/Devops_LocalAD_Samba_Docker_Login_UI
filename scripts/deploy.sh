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

step "Applying phpLDAPadmin (Deployment + Service)"
kubectl apply -f "$ROOT/k8s/phpldapadmin/"

step "Applying Keycloak (ConfigMap + Deployment + Service + Ingress)"
kubectl apply -f "$ROOT/k8s/keycloak/"

step "Applying LocalStack (Deployment + Service + Ingress)"
kubectl apply -f "$ROOT/k8s/localstack/"

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
echo "Stack is up. Access the apps:"
echo "  http://corp.localhost:8080                ← React login UI"
echo "  http://ldapadmin.corp.localhost:8080      ← phpLDAPadmin (LDAP web UI)"
echo "  http://keycloak.corp.localhost:8080       ← Keycloak admin (admin/admin)"
echo "  http://localstack.corp.localhost:8080     ← LocalStack AWS endpoint"
echo
echo "If hostnames don't resolve, add these lines to /etc/hosts:"
echo "  127.0.0.1  corp.localhost"
echo "  127.0.0.1  ldapadmin.corp.localhost"
echo "  127.0.0.1  keycloak.corp.localhost"
echo "  127.0.0.1  localstack.corp.localhost"
echo
echo "Note: Keycloak takes ~60s after pod Ready to finish realm import."
echo "To sync AD users → LocalStack IAM run:"
echo "  ./scripts/sync-ad-to-localstack.sh"
