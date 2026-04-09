# Devops LocalAD — Samba Docker + React/Node Login UI

A fully containerised corporate login system using **Samba 4 Active Directory** as the identity provider, a **Node.js/Express** backend for LDAP authentication + JWT issuance, a **React** frontend with login, profile, password change, and admin panel, and **phpLDAPadmin** for browsing the LDAP directory.

| Component | Tech | Purpose |
|-----------|------|---------|
| Identity Provider | Samba 4 AD DC (Docker) | Single source of truth for all user identities |
| Backend | Node.js + Express + ldapjs v3 | LDAP auth → JWT issuance + admin API |
| Frontend | React 18 + Vite + Tailwind CSS | Login UI, profile, password change, admin panel |
| LDAP Admin UI | phpLDAPadmin (`osixia/phpldapadmin:0.9.0`) | Browse and manage the raw LDAP directory |
| Identity Federation | Keycloak 24 (`quay.io/keycloak/keycloak:24.0`) | SAML 2.0 / OIDC IdP — bridges Samba AD to cloud services |
| Local AWS Emulator | LocalStack (`localstack/localstack:latest`) | Fake IAM, STS, S3 locally — no real AWS account needed |
| Cluster | k3d (`corp-cluster`) via Colima | Local Kubernetes on macOS |
| Ingress | Traefik (k3s default) | Path + host-based routing |

---

## Table of Contents

1. [Use Cases](#use-cases)
2. [Architecture](#architecture)
3. [Infrastructure Requirements](#infrastructure-requirements)
4. [Cluster Policy](#cluster-policy)
5. [Setup — Docker Compose](#setup--docker-compose)
6. [Setup — Kubernetes (Colima + k3d)](#setup--kubernetes-colima--k3d)
7. [Access URLs & Default Credentials](#access-urls--default-credentials)
8. [Managing AD Users & Groups](#managing-ad-users--groups)
9. [API Endpoints](#api-endpoints)
10. [Environment Variables](#environment-variables)
11. [Project Structure](#project-structure)
12. [Samba 4 AD — Deep Dive](#samba-4-active-directory--deep-dive)
13. [Keycloak — Identity Federation Layer](#keycloak--identity-federation-layer)
14. [LocalStack — Local AWS IAM Simulation](#localstack--local-aws-iam-simulation)
15. [Limitations](#limitations)
16. [Known Bugs & Fixes](#known-bugs--fixes)
17. [Keycloak + LocalStack Integration — Issues & Fixes](#keycloak--localstack-integration--issues--fixes)
18. [AD Users Synced to LocalStack IAM](#ad-users-synced-to-localstack-iam)

---

## Use Cases

This project demonstrates and can be used for:

| Use Case | How this project helps |
|----------|----------------------|
| **Learning LDAP / Active Directory** | See exactly how AD is structured, how LDAP binds work, and how attributes like `memberOf` and `unicodePwd` behave |
| **Corporate SSO prototype** | A working pattern for web apps that authenticate against a company Active Directory |
| **Kubernetes homelab** | Full-stack app running on k3d with Traefik ingress, StatefulSet, PVCs, ConfigMaps, Secrets, and init containers |
| **Dev/staging identity server** | Spin up a throwaway AD domain locally without a Windows Server licence |
| **Testing LDAP integrations** | Validate LDAP client code (ldapjs, python-ldap, etc.) against a real Samba AD before pointing at production |
| **phpLDAPadmin exploration** | Browse and manipulate raw LDAP objects via a web UI to understand AD internals |
| **JWT auth pattern** | Reference implementation for issuing JWTs from LDAP credentials with role claims |

---

## Architecture

### Docker Compose (local dev)

```
Browser
  │
  ├── :3000  →  frontend (React/nginx)
  │                │
  │                └── VITE_API_URL=http://localhost:3001
  │
  ├── :3001  →  backend (Node.js/Express)
  │                │
  │                └── ldaps://samba:636
  │
  ├── :389   →  samba (LDAP)
  ├── :636   →  samba (LDAPS)
  ├── :8090  →  phpldapadmin
  │
  ├── :8080  →  keycloak (SAML 2.0 / OIDC)
  │                │
  │                └── ldap://samba:389  (LDAP federation — reads AD users/groups)
  │
  └── :4566  →  localstack (fake AWS: IAM, STS, S3)
                   │
                   └── sync-ad-to-localstack.sh  (mirrors AD users/groups → IAM)
```

All services share the `ad-net` Docker bridge network. Keycloak and LocalStack are
add-on layers for identity federation and local AWS simulation — the core login
flow (frontend → backend → samba) is unchanged.

### Kubernetes — k3d + Colima

```
  macOS Host
  ┌──────────────────────────────────────────────────────┐
  │  Colima VM  (2 CPU / 4 GB RAM)                       │
  │  ┌────────────────────────────────────────────────┐  │
  │  │  k3d cluster "corp-cluster"                    │  │
  │  │  ┌──────────────────────────────────────────┐  │  │
  │  │  │  Namespace: corp-local                   │  │  │
  │  │  │                                          │  │  │
  │  │  │  [StatefulSet]  samba-0      :389/:636   │  │  │
  │  │  │  [Deployment]   backend      :3001       │  │  │
  │  │  │  [Deployment]   frontend     :80         │  │  │
  │  │  │  [Deployment]   phpldapadmin :80         │  │  │
  │  │  │                                          │  │  │
  │  │  │  [Ingress] corp.localhost                │  │  │
  │  │  │    /api  ──► backend:3001                │  │  │
  │  │  │    /     ──► frontend:80                 │  │  │
  │  │  │                                          │  │  │
  │  │  │  [Ingress] ldapadmin.corp.localhost       │  │  │
  │  │  │    /     ──► phpldapadmin:80              │  │  │
  │  │  └──────────────────────────────────────────┘  │  │
  │  │  Traefik LB ◄── host port 8080 ────────────────┼──┼── browser
  │  └────────────────────────────────────────────────┘  │
  └──────────────────────────────────────────────────────┘
```

**Two separate ingresses, two separate hostnames** — the React portal and phpLDAPadmin never share a routing rule:

| Ingress | Host | Routes to |
|---------|------|-----------|
| `corp-ingress` | `corp.localhost` | `/api` → backend, `/` → frontend |
| `phpldapadmin-ingress` | `ldapadmin.corp.localhost` | `/` → phpldapadmin |

---

## Infrastructure Requirements

### Minimum Host Machine

| Resource | Minimum | Recommended |
|----------|---------|-------------|
| CPU | 2 cores | 4 cores |
| RAM | 6 GB free | 8 GB free |
| Disk | 10 GB free | 20 GB free |
| OS | macOS 12+ | macOS 13+ |

> **Linux users:** Colima is macOS-only. On Linux run k3d directly after installing Docker. Skip `setup-cluster.sh` steps 1–2 and run `k3d cluster create corp-cluster --port '8080:80@loadbalancer' --agents 1`.

### Required Tools (auto-installed by `setup-cluster.sh`)

| Tool | Purpose |
|------|---------|
| [Homebrew](https://brew.sh) | macOS package manager (must pre-exist) |
| [Colima](https://github.com/abiosoft/colima) | Lightweight Docker/K8s VM for macOS |
| [k3d](https://k3d.io) | Runs k3s (lightweight K8s) inside Docker |
| [kubectl](https://kubernetes.io/docs/tasks/tools/) | Kubernetes CLI |
| Docker CLI | Image building (provided by Colima) |

### Port Map

| Mode | Port | Service |
|------|------|---------|
| Docker Compose | `3000` | React frontend |
| Docker Compose | `3001` | Node.js backend |
| Docker Compose | `389` | Samba LDAP |
| Docker Compose | `636` | Samba LDAPS |
| Docker Compose | `8090` | phpLDAPadmin |
| Docker Compose | `8080` | Keycloak admin UI + SAML/OIDC endpoints |
| Docker Compose | `4566` | LocalStack (IAM, STS, S3) |
| Kubernetes | `8080` | Traefik → all services |

---

## Cluster Policy

**This project uses exactly one k3d cluster: `corp-cluster`.**

No `dev`, `prod`, `qa`, or other clusters should coexist — host port 8080 can only be bound to one Traefik loadbalancer at a time. `setup-cluster.sh` automatically deletes any other clusters before creating `corp-cluster`.

```bash
k3d cluster list                  # see what's running
k3d cluster delete <name>         # remove a stale cluster
```

---

## Setup — Docker Compose

The simplest way to run the stack locally without Kubernetes.

**Prerequisites:** Docker Desktop or Colima running.

```bash
# 1. Clone the project
git clone https://github.com/sandeshlamsal/Devops_LocalAD_Samba_Docker_Login_UI
cd Devops_LocalAD_Samba_Docker_Login_UI

# 2. Copy and review backend env
cp backend/.env.example backend/.env

# 3. Build and start all services
docker compose up --build

# 4. Wait ~30 seconds for Samba domain provisioning on first boot

# 5. Open the apps
open http://localhost:3000     # React login UI
open http://localhost:8090     # phpLDAPadmin
```

To stop:
```bash
docker compose down
```

---

## Setup — Kubernetes (Colima + k3d)

### Step 1 — Start the cluster

```bash
./scripts/setup-cluster.sh
```

What it does:
- Installs `colima`, `k3d`, `kubectl` via Homebrew (skips if already present)
- Starts Colima VM: **2 CPU, 4 GB RAM, 40 GB disk**, Docker runtime
- **Deletes all existing k3d clusters** (only `corp-cluster` is allowed)
- Creates `corp-cluster` with 1 server + 1 agent, port `8080→Traefik`

### Step 2 — Add hostnames to `/etc/hosts` (one-time)

```bash
echo "127.0.0.1  corp.localhost" | sudo tee -a /etc/hosts
echo "127.0.0.1  ldapadmin.corp.localhost" | sudo tee -a /etc/hosts
```

### Step 3 — Build and import images

```bash
./scripts/build-and-import.sh
```

What it does:
- Builds `corp-samba:latest`, `corp-backend:latest`, `corp-frontend:k8s` (with `VITE_API_URL=http://corp.localhost:8080` baked in)
- Imports all three into the k3d cluster via `k3d image import` — no registry needed
- Manifests use `imagePullPolicy: Never` to use the imported images

### Step 4 — Deploy

```bash
./scripts/deploy.sh
```

What it does:
- `kubectl apply` all manifests under `k8s/` in dependency order
- Waits up to 3 minutes for all pods to reach `Ready`
- Prints a summary of pods, services, and ingresses

### Step 5 — Verify

```bash
# All pods should show 1/1 Running
kubectl get pods -n corp-local

# API health check through Traefik
curl http://corp.localhost:8080/api/health

# Test login
curl -s -X POST http://corp.localhost:8080/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"testuser1","password":"User@Corp#1"}' | jq .

# Open the apps
open http://corp.localhost:8080              # React login UI
open http://ldapadmin.corp.localhost:8080   # phpLDAPadmin
```

### Teardown

```bash
./scripts/teardown.sh
```

What it destroys:
- k3d cluster `corp-cluster` — all pods, services, ingresses, PVCs, namespaces
- Colima VM — the Docker daemon and all images built inside it
- kubeconfig context for `corp-cluster`

> **Everything is gone after teardown.** Samba AD data (users, passwords, groups) is lost. The next `deploy.sh` provisions a fresh domain and re-seeds the default users.

> Git code is **not** affected — the repo on disk and on GitHub remains intact.

---

### Teardown & Full Recreation from Scratch

Use this when you want a completely clean environment — new cluster, fresh AD, no leftover state.

#### Step 1 — Destroy everything

```bash
./scripts/teardown.sh
# Prompts: "Continue? [y/N]" → type y
```

Verify it's clean:
```bash
k3d cluster list          # should show: no clusters
colima status             # should show: not running
kubectl config get-contexts  # should be empty
```

#### Step 2 — Clone (if starting on a new machine) or use existing code

```bash
# On a new machine:
git clone https://github.com/sandeshlamsal/Devops_LocalAD_Samba_Docker_Login_UI
cd Devops_LocalAD_Samba_Docker_Login_UI

# On existing machine (already cloned):
cd Devops_LocalAD_Samba_Docker_Login_UI
git pull origin main       # get latest code
```

#### Step 3 — Add hostnames to `/etc/hosts` (one-time per machine)

```bash
# Check if already present
grep "corp.localhost" /etc/hosts

# If not present, add both:
echo "127.0.0.1  corp.localhost" | sudo tee -a /etc/hosts
echo "127.0.0.1  ldapadmin.corp.localhost" | sudo tee -a /etc/hosts
```

#### Step 4 — Create the cluster

```bash
./scripts/setup-cluster.sh
```

Expected output:
```
==> Checking / installing dependencies
==> Starting Colima VM
==> Deleting any existing k3d clusters
==> Creating k3d cluster: corp-cluster
kubectl cluster-info  ← shows the cluster is up
```

Verify:
```bash
k3d cluster list      # NAME: corp-cluster, SERVERS: 1/1, AGENTS: 1/1
colima status         # colima is running
kubectl get nodes     # 2 nodes Ready
```

#### Step 5 — Build Docker images and import into the cluster

```bash
./scripts/build-and-import.sh
```

What gets built:
| Image | Source | Notes |
|-------|--------|-------|
| `corp-samba:latest` | `docker/samba/` | Ubuntu 22.04 + Samba 4 AD |
| `corp-backend:latest` | `backend/` | Node.js + Express + ldapjs |
| `corp-frontend:k8s` | `frontend/` | React + Vite, `VITE_API_URL` baked in |

> phpLDAPadmin uses the public `osixia/phpldapadmin:0.9.0` image — it is pulled from Docker Hub automatically on first deploy, no build needed.

Verify images are imported:
```bash
docker images | grep corp-   # shows corp-samba, corp-backend, corp-frontend
```

#### Step 6 — Deploy all manifests

```bash
./scripts/deploy.sh
```

Expected output:
```
==> Applying namespace
==> Applying Samba
==> Applying Backend
==> Applying Frontend
==> Applying phpLDAPadmin
==> Applying Ingress
==> Waiting for all pods to be ready (timeout 3 min)
```

> Samba takes **30–60 seconds** to provision the AD domain on first boot. If `kubectl wait` times out, wait another minute and run:
> ```bash
> kubectl wait --namespace corp-local --for=condition=ready pod --all --timeout=60s
> ```

#### Step 7 — Verify everything is running

```bash
# All pods 1/1 Running
kubectl get pods -n corp-local

# Expected:
# NAME                            READY   STATUS    RESTARTS
# samba-0                         1/1     Running   0
# backend-xxxxx                   1/1     Running   0
# frontend-xxxxx                  1/1     Running   0
# phpldapadmin-xxxxx              1/1     Running   0

# API health check
curl http://corp.localhost:8080/api/health
# Expected: {"status":"ok"}

# Test login
curl -s -X POST http://corp.localhost:8080/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"testuser1","password":"User@Corp#1"}' | jq .
# Expected: { "token": "...", "user": { "username": "testuser1", ... } }
```

#### Step 8 — Open the apps

```bash
open http://corp.localhost:8080              # React login UI
open http://ldapadmin.corp.localhost:8080   # phpLDAPadmin
```

Login credentials:
- **React portal:** `testuser1` / `User@Corp#1`
- **phpLDAPadmin:** DN pre-filled → password `Admin@Corp#1234`

---

### Quick Reference — All Scripts

| Script | What it does | When to run |
|--------|-------------|-------------|
| `./scripts/setup-cluster.sh` | Install tools, start Colima, create k3d cluster | First time or after teardown |
| `./scripts/build-and-import.sh` | Build Docker images, import into k3d | After code changes |
| `./scripts/deploy.sh` | Apply all K8s manifests, wait for pods | After cluster setup or manifest changes |
| `./scripts/teardown.sh` | Delete cluster, stop Colima | When done or starting clean |

---

## Access URLs & Default Credentials

### URLs

| Environment | Service | URL |
|-------------|---------|-----|
| Kubernetes | React Portal | `http://corp.localhost:8080` |
| Kubernetes | phpLDAPadmin | `http://ldapadmin.corp.localhost:8080` |
| Kubernetes | API | `http://corp.localhost:8080/api` |
| Docker Compose | React Portal | `http://localhost:3000` |
| Docker Compose | phpLDAPadmin | `http://localhost:8090` |
| Docker Compose | Keycloak Admin | `http://localhost:8080` |
| Docker Compose | LocalStack | `http://localhost:4566` |

### Default AD Users

| Username | Password | Role | Notes |
|----------|----------|------|-------|
| `Administrator` | `Admin@Corp#1234` | Domain Admin | Built-in AD account |
| `adminuser` | `Admin@Corp#1` | Domain Admin | Seeded by entrypoint.sh |
| `testuser1` | `User@Corp#1` | Regular user | Seeded by entrypoint.sh |
| `testuser2` | `User@Corp#2` | Regular user | Seeded by entrypoint.sh |
| `sandesh` | `sandesh` | Regular user | Created manually (password complexity disabled temporarily) |

### phpLDAPadmin Login

1. Open `http://ldapadmin.corp.localhost:8080`
2. The **Login DN** is pre-filled: `cn=Administrator,cn=Users,dc=corp,dc=local`
3. Enter **Password:** `Admin@Corp#1234`
4. Click **Authenticate**

> phpLDAPadmin requires a full Distinguished Name — do **not** use the short username or UPN format here.

---

## Managing AD Users & Groups

Three options for managing users and groups in Samba AD:

| Option | Interface | Best For |
|--------|-----------|----------|
| **1. React Admin Panel** | Web UI at `/admin` | Day-to-day CRUD via the built app |
| **2. samba-tool CLI** | `kubectl exec` into the samba pod | Scripting, bulk ops, one-off fixes |
| **3. phpLDAPadmin** ✅ | `ldapadmin.corp.localhost:8080` | Full LDAP tree inspection and raw attribute edits |

**We use phpLDAPadmin** — it gives direct visibility into the raw LDAP tree (all object classes, attributes, OUs, groups) without CLI access.

### Option 1 — React Admin Panel

Accessible at `http://corp.localhost:8080/admin` after logging in as `adminuser` or `Administrator`.

Supports: list users, create user, update display name / email, delete user, change own password.

### Option 2 — samba-tool CLI

```bash
# Exec into the Samba pod
kubectl exec -it samba-0 -n corp-local -- bash

# List users
samba-tool user list

# Show user details
samba-tool user show testuser1

# Create a user (AD password complexity required)
samba-tool user create newuser 'Pass@Word#1'

# Create a user with simple password (disable complexity first)
samba-tool domain passwordsettings set --complexity=off
samba-tool user create newuser 'simplepass'
samba-tool domain passwordsettings set --complexity=on

# Delete a user
samba-tool user delete newuser

# Reset a password
samba-tool user setpassword testuser1 --newpassword='NewPass@1'

# List groups
samba-tool group list

# Add user to Domain Admins
samba-tool group addmembers "Domain Admins" newuser
```

### Option 3 — phpLDAPadmin

| Action | How |
|--------|-----|
| Browse the LDAP tree | Expand `dc=corp,dc=local` → `cn=Users` |
| View user attributes | Click a user object |
| Create a new entry | Click **Create new entry** under `cn=Users` |
| Delete a user | Select user → **Delete this entry** |
| Modify an attribute | Click the attribute value to edit inline |
| View groups | Look for entries with `groupType` attribute |

> **Password changes via phpLDAPadmin are not recommended** — writing `unicodePwd` requires UTF-16LE encoding which phpLDAPadmin doesn't handle for AD. Use the React portal's **Change Password** page or `samba-tool user setpassword` instead.

---

## K8s File Reference

```
k8s/
├── namespace.yaml              Namespace "corp-local" + privileged PSA label (for SYS_ADMIN)
├── samba/
│   ├── pvc.yaml                2 Gi PersistentVolumeClaim (local-path provisioner)
│   ├── statefulset.yaml        Samba AD DC — StatefulSet, SYS_ADMIN cap, readiness probe on :389
│   └── service.yaml            ClusterIP — ports 389 (LDAP), 636 (LDAPS), 88 (Kerberos)
├── backend/
│   ├── configmap.yaml          Non-secret env vars (LDAP_URL, BASE_DN, PORT)
│   ├── secret.yaml             Sensitive env vars (LDAP_ADMIN_PASS, JWT_SECRET)
│   ├── deployment.yaml         Node.js backend — readiness + liveness on /api/health
│   └── service.yaml            ClusterIP — port 3001
├── frontend/
│   ├── deployment.yaml         nginx serving the built React SPA
│   └── service.yaml            ClusterIP — port 80
├── phpldapadmin/
│   ├── configmap.yaml          Custom config.php — pre-fills Administrator DN on login form
│   ├── deployment.yaml         osixia/phpldapadmin, postStart hook injects config.php
│   ├── service.yaml            ClusterIP — port 80
│   ├── middleware.yaml         Traefik stripPrefix (kept for reference, not active)
│   └── ingress.yaml            Host-based Ingress: ldapadmin.corp.localhost → phpldapadmin
└── ingress.yaml                Host-based Ingress: corp.localhost /api→backend, /→frontend
```

### Why StatefulSet for Samba?

| Concern | Why it matters |
|---------|----------------|
| Stable hostname | Samba embeds the machine hostname in Kerberos keytabs at provision time — hostname changes break Kerberos |
| Ordered startup | Prevents split-brain if ever scaled to multiple replicas |
| Persistent storage | AD data in `/var/lib/samba` survives pod restarts via PVC |

---

## API Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/health` | — | Health check |
| `POST` | `/api/auth/login` | — | Authenticate, receive JWT |
| `POST` | `/api/auth/refresh` | JWT | Refresh token |
| `GET` | `/api/users/me` | JWT | Current user's AD profile |
| `PUT` | `/api/users/me/password` | JWT | Change own password |
| `GET` | `/api/admin/users` | Admin JWT | List all AD users |
| `POST` | `/api/admin/users` | Admin JWT | Create new user |
| `PUT` | `/api/admin/users/:username` | Admin JWT | Update user attributes |
| `DELETE` | `/api/admin/users/:username` | Admin JWT | Delete user |

---

## Environment Variables

**`backend/.env`**

| Variable | Default | Description |
|----------|---------|-------------|
| `LDAP_URL` | `ldaps://samba:636` | LDAP server URL — must use LDAPS for password changes |
| `LDAP_BASE_DN` | `DC=corp,DC=local` | Root DN of the domain |
| `LDAP_ADMIN_DN` | `CN=Administrator,CN=Users,DC=corp,DC=local` | Service account for admin operations |
| `LDAP_ADMIN_PASS` | `Admin@Corp#1234` | Service account password |
| `JWT_SECRET` | *(change me)* | Secret key for signing JWTs — use a long random string in production |
| `PORT` | `3001` | Backend listen port |

---

## Project Structure

```
.
├── docker/
│   ├── samba/
│   │   ├── Dockerfile        # Ubuntu 22.04 + Samba packages
│   │   └── entrypoint.sh     # Domain provision + smb.conf backup + seed users
│   └── keycloak/
│       └── realm-corp.json   # Auto-imported realm: LDAP federation + SAML client pre-wired
├── backend/
│   ├── src/
│   │   ├── app.js            # Express entry point
│   │   ├── config/ldap.js    # LDAP connection settings
│   │   ├── services/ldap.js  # All LDAP operations (auth, CRUD, password)
│   │   ├── middleware/
│   │   │   ├── auth.js       # JWT verification
│   │   │   └── requireAdmin.js
│   │   └── routes/
│   │       ├── auth.js       # POST /api/auth/login, /refresh
│   │       ├── users.js      # GET /api/users/me, PUT /me/password
│   │       └── admin.js      # CRUD /api/admin/users
│   ├── .env                  # Runtime config (copy from .env.example)
│   └── Dockerfile
├── frontend/
│   ├── src/
│   │   ├── App.jsx           # Router + NavBar
│   │   ├── context/AuthContext.jsx
│   │   ├── api/index.js      # Axios instance with JWT interceptor
│   │   ├── pages/            # LoginPage, ProfilePage, ChangePasswordPage, AdminPage
│   │   └── components/       # ProtectedRoute, AdminRoute
│   └── Dockerfile            # Multi-stage: Vite build → nginx serve
├── k8s/                      # Kubernetes manifests (see K8s File Reference)
├── scripts/
│   ├── setup-cluster.sh           # Install tools, start Colima, create k3d cluster
│   ├── build-and-import.sh        # Docker build all images, import into k3d
│   ├── deploy.sh                  # kubectl apply all manifests, wait for ready
│   ├── teardown.sh                # Delete cluster, stop Colima
│   └── sync-ad-to-localstack.sh   # Mirror Samba AD users/groups → LocalStack IAM
└── docker-compose.yml
```

---

## Samba 4 Active Directory — Deep Dive

### What is Samba 4 AD?

**Samba** is an open-source implementation of the SMB/CIFS protocol and — since version 4 — a full **Active Directory Domain Controller (AD DC)**. It lets Linux servers act as a Microsoft Windows domain controller without needing Windows.

An **Active Directory Domain Controller** is the central identity authority of a network. It:
- Stores every user account, password hash, and group membership in a database called the **LDAP directory**
- Authenticates users using **Kerberos** (ticket-based) or **NTLM** (challenge-response)
- Enforces policies on who can access what
- Answers directory queries over the **LDAP protocol** (port 389 / 636 for TLS)

In this project Samba AD is the **single source of truth for all user identities**. The Node.js backend never stores passwords — it always asks Samba.

### How the AD Directory is Structured

Active Directory organises objects (users, groups, computers) in a tree using **Distinguished Names (DN)**:

```
DC=corp,DC=local              ← domain root (corp.local)
│
├── CN=Users                  ← default Users container
│   ├── CN=Administrator      ← built-in domain admin
│   ├── CN=Test User1         ← testuser1 (CN = display name, not username)
│   ├── CN=Test User2         ← testuser2
│   ├── CN=Admin User         ← adminuser
│   └── CN=Sandesh Lamsal     ← sandesh
│
└── CN=Builtin
    └── CN=Domain Admins      ← group — members get isAdmin=true in JWT
```

| Abbreviation | Meaning |
|---|---|
| `DC` | Domain Component — a piece of the domain name (`corp`, `local`) |
| `CN` | Common Name — name of the object (user, group, container) |
| `OU` | Organizational Unit — a folder for organising objects |
| `DN` | Distinguished Name — the full path to an object |

### How the App Consumes AD

The app uses **LDAP simple bind** (not Kerberos) to talk to Samba:

#### Login — LDAP Simple Bind

```
User submits form (username: "testuser1", password: "User@Corp#1")
        │
        ▼
POST /api/auth/login  (Node.js)
        │
        ▼  Open TLS connection to samba:636
ldapjs client.bind("testuser1@corp.local", "User@Corp#1")   ← UPN format
        │
        ├── Samba checks NT hash against sam.ldb
        │
        ├── SUCCESS → search for user attributes (displayName, mail, memberOf, ...)
        │            Node.js signs JWT → returned to browser
        │
        └── FAILURE → 401 Unauthorized
```

> **Why UPN format?** Samba sets the `CN` to the user's display name (`CN=Test User1`), not the login name. Using `testuser1@corp.local` (UPN) lets Samba resolve the account regardless of display name.

#### Admin Detection — `memberOf` Attribute

```js
// backend/src/services/ldap.js
const isAdmin = memberOf.some((g) =>
    g.toLowerCase().startsWith("cn=domain admins")
);
```

If the user belongs to `CN=Domain Admins`, `isAdmin: true` is embedded in the JWT. The `requireAdmin` middleware checks this on every admin route.

#### Password Change — `unicodePwd` over LDAPS

```js
// UTF-16LE encoded, double-quoted, sent as binary
const encodedPassword = Buffer.from(`"${newPassword}"`, "utf16le");
// LDAP modify: replace unicodePwd attribute
```

`unicodePwd` is an AD-specific attribute. It **must be sent over LDAPS (TLS)** — Samba silently discards it over plain LDAP.

### Samba Configuration Files

#### `/etc/samba/smb.conf` — Main Config

```ini
[global]
    workgroup = CORP
    realm = CORP.LOCAL
    server role = active directory domain controller
    dns forwarder = 8.8.8.8
    ldap server require strong auth = no   ← added by entrypoint.sh (allows plain LDAP binds)

[sysvol]
    path = /var/lib/samba/sysvol

[netlogon]
    path = /var/lib/samba/sysvol/corp.local/scripts
```

> `smb.conf` is backed up to `/var/lib/samba/smb.conf.bak` (on the PVC) and restored on every pod restart. Without this, Samba crashes after a pod restart because `/etc/samba/` is not on the PVC.

#### `/var/lib/samba/private/` — Secret Keys & Database

```
sam.ldb       ← the AD database (users, groups, policies — everything)
secrets.ldb   ← machine account secrets
krb5.conf     ← Kerberos client config (copied to /etc/krb5.conf)
tls/          ← self-signed TLS cert for LDAPS (port 636)
```

`sam.ldb` is the Samba equivalent of `NTDS.dit` on Windows Server DC.

### Key Ports

| Port | Protocol | Purpose |
|------|----------|---------|
| 389 | TCP | LDAP — directory queries (plain) |
| 636 | TCP | LDAPS — LDAP over TLS (required for password changes) |
| 88 | TCP/UDP | Kerberos — ticket-based auth (not used by this app) |
| 53 | TCP/UDP | Samba's internal DNS server |

---

## Keycloak — Identity Federation Layer

### What is Keycloak?

**Keycloak** is an open-source Identity and Access Management (IAM) server. Its job is to answer two questions on behalf of every application:

- **Authentication** — "Who are you?" (login, MFA, session management)
- **Authorization** — "What are you allowed to do?" (roles, group claims, token scopes)

Instead of each application implementing its own login logic, every app delegates to Keycloak. Keycloak issues a signed token (JWT or SAML assertion) that the app trusts.

> In enterprise terms, Keycloak is the open-source equivalent of **Okta**, **Azure AD B2C**, or **AWS IAM Identity Center** — self-hosted and free.

---

### The Problem Keycloak Solves

```
Without Keycloak — every app manages its own auth:

  React App      Grafana        Jenkins        AWS Console
  ┌──────┐      ┌──────┐       ┌──────┐       ┌──────┐
  │login │      │login │       │login │       │login │
  │users │      │users │       │users │       │users │
  │JWT   │      │OAuth │       │LDAP  │       │IAM   │
  └──────┘      └──────┘       └──────┘       └──────┘

  → Each app re-implements auth
  → User has 4 separate passwords
  → When a user is deleted from AD, they still have active sessions elsewhere


With Keycloak — one identity layer, one session for everything:

              Samba AD (corp.local)
                    │ LDAP
                    ▼
              ┌──────────────┐
              │   Keycloak   │  ← single login, single MFA, single session
              └──────┬───────┘
                     │ issues tokens
      ┌──────────────┼──────────────┐
      ▼              ▼              ▼
  React App      Grafana        AWS Console
  (OIDC/JWT)   (OIDC/JWT)      (SAML 2.0)
```

---

### Protocols Keycloak Speaks

| Protocol | Standard | Used by |
|----------|----------|---------|
| **OIDC / OAuth 2.0** | Modern web and mobile | React apps, APIs, Grafana, Vault |
| **SAML 2.0** | Enterprise SSO | AWS IAM Identity Center, Salesforce, Jira |
| **LDAP** | Directory queries | Reading users/groups from Samba AD |

---

### Core Concepts

**Realm** — a namespace / tenant. All configuration in this project lives in the `corp` realm, which maps to the `corp.local` AD domain.

**User Federation** — instead of storing users in Keycloak's own database, the `corp` realm is configured to read users and groups directly from Samba AD via LDAP. Users never need a separate Keycloak password — they use their AD credentials.

**Clients** — applications that trust Keycloak to handle auth. Each client gets its own protocol configuration. The `aws-saml-client` in the `corp` realm is pre-configured as a SAML 2.0 client ready to be pointed at AWS IAM Identity Center.

**Mappers** — rules that translate AD attributes into token claims. For example: `sAMAccountName → username`, `givenName → firstName`, `memberOf → groups`.

---

### How Keycloak Fits in This Stack

```
                        ┌──────────────────────────────────────────┐
                        │  Samba AD (corp.local)                   │
                        │  dc1.corp.local:389                      │
                        │  Users: testuser1, adminuser, ...        │
                        │  Groups: Domain Admins, Domain Users     │
                        └────────────────┬─────────────────────────┘
                                         │ LDAP (port 389)
                                         │ federation — read-only
                                         ▼
                        ┌──────────────────────────────────────────┐
                        │  Keycloak (localhost:8080)                │
                        │  Realm: corp                             │
                        │                                          │
                        │  User Federation: samba-ad               │
                        │    • sAMAccountName → username           │
                        │    • givenName / sn → name               │
                        │    • memberOf → groups                   │
                        │    • Sync every 10 min (changedSync)     │
                        │                                          │
                        │  Clients:                                │
                        │    • aws-saml-client (SAML 2.0, disabled │
                        │      until real AWS SSO URL is set)      │
                        └───────────────────┬──────────────────────┘
                                            │
                    ┌───────────────────────┼───────────────────────┐
                    │                       │                       │
           OIDC / OAuth 2.0          SAML 2.0                OIDC
                    │                       │                       │
                    ▼                       ▼                       ▼
             React App             AWS IAM Identity           Grafana /
             (future)              Center (real AWS)          Other tools
```

---

### Keycloak vs What You Already Have

| Feature | Current (backend + ldapjs) | With Keycloak added |
|---------|---------------------------|---------------------|
| Login for React app | ✓ (custom JWT) | ✓ (unchanged — core flow untouched) |
| Login for AWS Console | ✗ | ✓ (via SAML 2.0) |
| Login for Grafana, Jenkins | ✗ | ✓ (via OIDC) |
| MFA enforcement | ✗ | ✓ (TOTP, WebAuthn) |
| Single logout (SLO) | ✗ | ✓ |
| Social login (Google, GitHub) | ✗ | ✓ |
| Group-based role mapping | Manual in JWT | Automatic via mappers |

---

### Setup & First Use

**Start Keycloak (with the rest of the stack):**
```bash
docker compose up -d
# Keycloak takes ~60 seconds to start and import the realm on first boot
```

**Access the admin console:**
```
URL:      http://localhost:8080
Username: admin
Password: admin
```

**Trigger a manual LDAP sync (first time):**
```
1. Open http://localhost:8080
2. Switch to realm: corp  (top-left dropdown)
3. User Federation → samba-ad → Synchronize all users
4. Users menu → verify AD users appear
```

**Enable the AWS SAML client (when ready for real AWS):**
```
1. Clients → aws-saml-client → Settings → Enable toggle
2. Replace the placeholder ACS URL with your real AWS SSO endpoint:
   https://signin.aws.amazon.com/saml
3. In AWS IAM Identity Center → Settings → Identity source → External IdP
   → Upload Keycloak's SAML metadata from:
   http://localhost:8080/realms/corp/protocol/saml/descriptor
```

---

### Realm Auto-Configuration (`docker/keycloak/realm-corp.json`)

The file `docker/keycloak/realm-corp.json` is mounted into Keycloak's import directory and loaded automatically on first startup (`start-dev --import-realm`). It pre-configures:

| Setting | Value |
|---------|-------|
| Realm name | `corp` |
| LDAP connection | `ldap://samba:389` |
| Bind DN | `CN=Administrator,CN=Users,DC=corp,DC=local` |
| Users DN | `CN=Users,DC=corp,DC=local` |
| Username attribute | `sAMAccountName` |
| Group sync | `CN=Users,DC=corp,DC=local` |
| Changed sync interval | every 600 seconds |
| Full sync interval | every 3600 seconds |
| Edit mode | `READ_ONLY` (Keycloak cannot modify AD) |
| AWS SAML client | pre-created, **disabled** (enable when AWS is ready) |

> Keycloak only imports the realm on first boot. If you change `realm-corp.json` and need to re-import, delete the Keycloak volume and restart: `docker compose down && docker compose up -d keycloak`.

---

## LocalStack — Local AWS IAM Simulation

### What is LocalStack?

**LocalStack** is a local emulator for AWS cloud services. It runs inside Docker and exposes the same REST API as real AWS — so `aws` CLI commands and AWS SDK calls work against it without a real AWS account.

This project uses LocalStack (community / free tier) to emulate **IAM, STS, and S3** locally, enabling you to:
- Practice writing IAM policies without a real AWS account
- Test `aws iam` CLI commands against a throwaway environment
- Mirror your Samba AD users and groups into fake IAM users and groups
- Understand how AD identities map to AWS IAM before touching real cloud infrastructure

> **Important:** LocalStack community does **not** include IAM Identity Center (AWS SSO). That service requires LocalStack Pro. For full SSO simulation use the Keycloak SAML flow against real AWS instead.

---

### Architecture — AD → LocalStack IAM Sync

```
┌───────────────────────────────────────────────────────────────┐
│  Docker Network (ad-net)                                      │
│                                                               │
│  ┌─────────────────┐         ┌──────────────────────────┐    │
│  │   Samba AD      │         │   LocalStack             │    │
│  │   :389 (LDAP)   │         │   :4566                  │    │
│  │                 │         │                          │    │
│  │  CN=testuser1   │         │  IAM user: testuser1     │    │
│  │  CN=adminuser   │         │  IAM user: adminuser     │    │
│  │  Domain Admins  │         │  IAM group: Domain-Admins│    │
│  │  Domain Users   │         │  IAM group: Domain-Users │    │
│  └────────┬────────┘         └──────────────────────────┘    │
│           │                             ▲                    │
│           │ ldapsearch                  │ aws iam create-*   │
│           └─────────────────────────────┤                    │
│                                         │                    │
│              sync-ad-to-localstack.sh ──┘                    │
│              (run manually or on a schedule)                 │
└───────────────────────────────────────────────────────────────┘
```

---

### What Gets Synced

| Samba AD object | LocalStack IAM object | Notes |
|-----------------|----------------------|-------|
| User (`objectClass=user`) | `IAM User` | Tagged with `Source=SambaAD`, `Realm=corp.local` |
| Group (`objectClass=group`) | `IAM Group` | System built-in groups are excluded |
| Group membership (`memberOf`) | `add-user-to-group` | Members added after group creation |
| — | `ReadOnlyAccess` policy | Attached to every synced group as a safe baseline |

Built-in AD system groups (Domain Controllers, Schema Admins, etc.) are filtered out — only custom groups are synced.

---

### How to Run the Sync

**Prerequisites (one-time install):**
```bash
brew install openldap awscli
```

**Start the full stack:**
```bash
docker compose up -d
```

**Run the sync:**
```bash
./scripts/sync-ad-to-localstack.sh
```

**Verify results:**
```bash
# All synced IAM users
aws --endpoint-url=http://localhost:4566 iam list-users

# All synced IAM groups
aws --endpoint-url=http://localhost:4566 iam list-groups

# Members of a specific group
aws --endpoint-url=http://localhost:4566 iam get-group --group-name Domain-Admins

# Policies attached to a group
aws --endpoint-url=http://localhost:4566 iam list-attached-group-policies \
  --group-name Domain-Admins
```

> LocalStack accepts any value for `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY`. The sync script exports `test`/`test` automatically — no real credentials needed.

---

### Integration with phpLDAPadmin

phpLDAPadmin and the LocalStack sync script work together as a **create → verify → sync** loop:

```
Step 1 — Create a user in phpLDAPadmin
──────────────────────────────────────
  Open http://localhost:8090
  Authenticate as CN=Administrator,CN=Users,DC=corp,DC=local
  Navigate: dc=corp,dc=local → cn=Users → Create new entry
  Object class: inetOrgPerson + user + organizationalPerson
  Set sAMAccountName, cn, sn, givenName

Step 2 — Verify in phpLDAPadmin
─────────────────────────────────
  Browse the tree — new user appears under cn=Users
  Confirm attributes are correct (sAMAccountName, objectClass)

Step 3 — Run the sync
──────────────────────
  ./scripts/sync-ad-to-localstack.sh
  → ldapsearch reads the new user from Samba AD
  → aws iam create-user creates them in LocalStack

Step 4 — Confirm in LocalStack
───────────────────────────────
  aws --endpoint-url=http://localhost:4566 iam list-users
  → new user appears with SambaAD tag
```

This loop mirrors what a real enterprise AD Connector + IAM Identity Center sync would do — but entirely free, entirely local.

---

### Credentials for LocalStack

```bash
# Add to ~/.aws/credentials or export in shell — any value works
export AWS_ACCESS_KEY_ID=test
export AWS_SECRET_ACCESS_KEY=test
export AWS_DEFAULT_REGION=us-east-1

# Then use --endpoint-url for every command
aws --endpoint-url=http://localhost:4566 iam list-users
```

Or create a named profile to avoid repeating `--endpoint-url`:
```bash
aws configure --profile localstack
# Access Key ID:     test
# Secret Access Key: test
# Region:            us-east-1

# Use it
aws --profile localstack --endpoint-url=http://localhost:4566 iam list-users
```

---

### Road to Real AWS IAM Identity Center

Once you understand the patterns locally, the path to real AWS is:

```
Local (now)                          Real AWS (future)
──────────────────────────────────────────────────────
Samba AD + Keycloak (SAML)     →    IAM Identity Center (external IdP)
LocalStack IAM users/groups    →    IAM Identity Center users/groups
sync-ad-to-localstack.sh       →    SCIM provisioning (automatic)
Manual aws iam commands        →    Permission Sets + Account Assignments
```

The concepts, CLI commands, and IAM policy logic you learn locally are identical to real AWS — only the endpoint URL changes.

---

## Limitations

These are known constraints of this local lab setup. They are by design for simplicity and would need to be addressed before any production use.

### Security

| Limitation | Detail | Production fix |
|------------|--------|----------------|
| Self-signed TLS cert | Samba's LDAPS cert is self-signed; backend uses `rejectUnauthorized: false` | Use a CA-signed cert or mount a trusted CA bundle |
| `ldap server require strong auth = no` | Allows plain LDAP binds from any client | Remove this setting; enforce LDAPS everywhere |
| JWT in localStorage | Tokens stored in `localStorage` are accessible to JavaScript (XSS risk) | Use `httpOnly` cookies |
| Hardcoded seed passwords | `testuser1/User@Corp#1` etc. are in `entrypoint.sh` | Use Kubernetes secrets or a provisioning tool |
| AD password complexity | Complexity must be temporarily disabled to create simple passwords (e.g. `sandesh`) | Enforce strong passwords for all users |
| Single replica | Samba runs as a single StatefulSet pod — no HA | Add a second DC, configure AD replication |

### Functionality

| Limitation | Detail |
|------------|--------|
| No Group Policy (GPO) | Samba 4 supports GPO but it is not configured here |
| No Windows domain join | Joining a Windows client to this domain requires additional DNS and Kerberos config |
| No email delivery | User `mail` attributes are stored in AD but no SMTP server is configured |
| Password change via phpLDAPadmin | `unicodePwd` requires UTF-16LE encoding; phpLDAPadmin does not handle this — use the React portal or `samba-tool` |
| No LDAP over IPv6 | Samba is configured on IPv4 only inside the container |
| Samba N-1 password grace period | After a password change, the previous password stays valid briefly — this is standard AD behaviour, not a bug |

### Infrastructure

| Limitation | Detail |
|------------|--------|
| macOS only (Colima) | The K8s scripts use Colima which is macOS-specific |
| Single cluster | Only `corp-cluster` is supported; port 8080 cannot be shared |
| No TLS on Traefik | Traefik serves plain HTTP on port 8080 — HTTPS is not configured |
| No persistent storage for backend/frontend | These are stateless — only Samba has a PVC |
| phpLDAPadmin `sleep 12` in postStart | Config injection uses `sleep 12` to wait for bootstrap — fragile on slow nodes |

---

## Known Bugs & Fixes

Every bug found during bring-up, its root cause, and the fix applied. Reference if the same issue appears in a different environment.

---

### BUG-001 — `http://corp.localhost` returns 502 Bad Gateway

| Field | Detail |
|-------|--------|
| **Symptom** | Browser / curl returns `502 Bad Gateway` from `nginx/1.27.5` |
| **Environment** | macOS + Colima + k3d |
| **Root cause** | A local Homebrew nginx was already listening on port 80 of the macOS host. The k3d cluster was created with `--port '80:80@loadbalancer'` so both competed for port 80. Every request hit the Homebrew nginx first and got proxied nowhere. |
| **Fix** | Recreated the k3d cluster with `--port '8080:80@loadbalancer'` — maps host port **8080** to Traefik. App accessible at `http://corp.localhost:8080`. Frontend image rebuilt with `VITE_API_URL=http://corp.localhost:8080`. |
| **Files changed** | `scripts/setup-cluster.sh`, `scripts/build-and-import.sh` |

---

### BUG-002 — Samba pod crashes on restart: `Can't load /etc/samba/smb.conf`

| Field | Detail |
|-------|--------|
| **Symptom** | After any pod restart, Samba enters `CrashLoopBackOff` with `Failed to load config file!` |
| **Environment** | Kubernetes StatefulSet with PVC |
| **Root cause** | `samba-tool domain provision` writes `smb.conf` to `/etc/samba/` — inside the container filesystem, not on the PVC. When the pod restarts the container gets a fresh filesystem, `/etc/samba/smb.conf` is gone, but the provision flag on the PVC causes the entrypoint to skip re-provisioning. Samba starts with no config and crashes. |
| **Fix** | After provisioning, entrypoint copies `smb.conf` to `/var/lib/samba/smb.conf.bak` (on the PVC). On every subsequent boot `restore_config()` copies it back to `/etc/samba/smb.conf` before starting Samba. |
| **Files changed** | `docker/samba/entrypoint.sh` |

---

### BUG-003 — Login fails: `Strong Auth Required`

| Field | Detail |
|-------|--------|
| **Symptom** | `POST /api/auth/login` returns error; backend logs show `Strong Auth Required` |
| **Root cause** | Samba 4 defaults `ldap server require strong auth = yes`, forcing LDAP clients to sign requests using SASL/GSSAPI. `ldapjs` uses a plain simple bind (no signing), so Samba rejects every connection. |
| **Fix** | Added `ldap server require strong auth = no` to `smb.conf` via `sed` immediately after `domain provision`. |
| **Files changed** | `docker/samba/entrypoint.sh` |
| **Production note** | For production, use LDAPS with a valid cert instead of disabling strong auth. |

---

### BUG-004 — Login fails: `Invalid username or password` with correct credentials

| Field | Detail |
|-------|--------|
| **Symptom** | `POST /api/auth/login` returns 401 even with correct credentials |
| **Root cause** | Backend constructed the bind DN as `CN=testuser1,...`. But Samba sets the CN to the **display name** (`CN=Test User1`), not the `sAMAccountName`. The DN didn't resolve and the bind failed. |
| **Fix** | Switched to **UPN format** (`testuser1@corp.local`). AD resolves UPNs to the correct account regardless of display name CN. |
| **Files changed** | `backend/src/services/ldap.js` — `authenticateUser()` |

---

### BUG-005 — Runtime error: `ldap.escapeDN is not a function`

| Field | Detail |
|-------|--------|
| **Symptom** | Backend logs `ldap.escapeDN is not a function` on every login |
| **Root cause** | `ldap.escapeDN()` was removed in ldapjs v3 (existed in v2). |
| **Fix** | Added local `escapeFilter(str)` implementing RFC 4515 escaping (backslash-encodes `\`, `*`, `(`, `)`, `NUL`). |
| **Files changed** | `backend/src/services/ldap.js` |

---

### BUG-006 — Login succeeds but user profile has all empty fields

| Field | Detail |
|-------|--------|
| **Symptom** | Login returns a JWT but user object is empty — no name, email, groups |
| **Root cause** | In ldapjs v3, `entry.pojo.attributes` is an **array** of `{type, values}` objects — not a flat map as in v2. The `entryToObject()` helper was reading it as a map so every attribute lookup returned `undefined`. |
| **Fix** | Updated `entryToObject()` to detect `Array.isArray(entry.pojo.attributes)` and iterate the array to build the flat map. |
| **Files changed** | `backend/src/services/ldap.js` — `entryToObject()` |

---

### BUG-007 — Samba image build fails: `Unable to locate package samba-tool`

| Field | Detail |
|-------|--------|
| **Symptom** | `docker build` fails with `E: Unable to locate package samba-tool` |
| **Root cause** | `samba-tool` is bundled inside the `samba` apt package on Ubuntu 22.04, not a standalone package. |
| **Fix** | Removed `samba-tool` from the `apt-get install` list in the Dockerfile. |
| **Files changed** | `docker/samba/Dockerfile` |

---

### BUG-008 — Password change succeeds but old password still works

| Field | Detail |
|-------|--------|
| **Symptom** | `PUT /api/users/me/password` returns success but the old password continues to authenticate |
| **Root cause** | Two issues: (1) AD prohibits `unicodePwd` writes over plain LDAP — Samba appears to succeed but silently discards the change. (2) Samba 4 keeps the N-1 password valid for a brief grace period (standard AD behaviour). |
| **Fix** | Changed `LDAP_URL` to `ldaps://samba:636`. Backend already had `tlsOptions: { rejectUnauthorized: false }` for Samba's self-signed cert. Password changes now go over TLS and are committed by Samba. |
| **Files changed** | `backend/.env`, `backend/.env.example`, `k8s/backend/configmap.yaml`, `docker-compose.yml` |
| **Note** | The N-1 grace period is by design — the previous password stays valid briefly. Passwords two changes back (N-2) are rejected immediately. |

---

### BUG-009 — phpLDAPadmin: CSS and images broken at `/ldapadmin`

| Field | Detail |
|-------|--------|
| **Symptom** | phpLDAPadmin page loads but is completely unstyled — logo, icons, stylesheets all fail |
| **Root cause** | phpLDAPadmin generates asset URLs as absolute paths from root (`/images/`, `/css/`). With Traefik serving it at `/ldapadmin`, the stripped path caused asset requests to hit the React frontend catch-all route instead. |
| **Fix** | Set `PHPLDAPADMIN_SERVER_PATH=/ldapadmin` — phpLDAPadmin prefixes all generated URLs with `/ldapadmin/`. Later resolved more cleanly by switching to host-based routing (`ldapadmin.corp.localhost`) so the app serves from `/` with no sub-path complications. |
| **Files changed** | `k8s/phpldapadmin/deployment.yaml`, `k8s/phpldapadmin/ingress.yaml` |

---

### BUG-010 — phpLDAPadmin: `Invalid credentials (49)` with correct password

| Field | Detail |
|-------|--------|
| **Symptom** | Entering `Administrator` / `Admin@Corp#1234` returns `Error: Invalid credentials (49)` |
| **Root cause** | phpLDAPadmin's login DN field requires a full Distinguished Name (`cn=Administrator,cn=Users,dc=corp,dc=local`). Entering just `Administrator` is not a valid DN and the bind fails. |
| **Fix** | Mounted a custom `config.php` via ConfigMap that pre-fills `bind_id` with the full Administrator DN. Users only need to enter the password. |
| **Files changed** | `k8s/phpldapadmin/configmap.yaml` (new), `k8s/phpldapadmin/deployment.yaml` |

---

### BUG-011 — phpLDAPadmin: `403 Forbidden` after mounting ConfigMap

| Field | Detail |
|-------|--------|
| **Symptom** | After mounting the ConfigMap, the page returns `403 Forbidden`. Apache logs: `DocumentRoot /var/www/phpldapadmin/htdocs does not exist` |
| **Root cause** | The `osixia/phpldapadmin` startup script bootstraps the app by copying files from `/var/www/phpldapadmin_bootstrap/` into `/var/www/phpldapadmin/` — but **only when the directory is empty**. Mounting an `emptyDir` at `/var/www/phpldapadmin/config` made the directory non-empty, so the bootstrap copy was skipped. `htdocs/`, templates, and `index.php` were never created. |
| **Fix** | Removed the `emptyDir` mount. Instead, mounted the ConfigMap read-only at `/pla-config` and used a `lifecycle.postStart` hook (`sleep 12 && cp /pla-config/config.php ...`) to inject the config after bootstrap completes. |
| **Files changed** | `k8s/phpldapadmin/deployment.yaml` |

---

## Keycloak + LocalStack Integration — Issues & Fixes

All bugs encountered while adding Keycloak and LocalStack to the k3d stack, in the order they were hit.

---

### ISSUE-001 — LocalStack `latest` requires a Pro license token

| Field | Detail |
|-------|--------|
| **Symptom** | LocalStack pod in `CrashLoopBackOff`. Log: `License activation failed! No credentials were found in the environment` |
| **Root cause** | The `localstack/localstack:latest` tag now bundles the Pro image, which requires `LOCALSTACK_AUTH_TOKEN` to start. Community IAM/STS/S3 features need the pinned community image. |
| **Fix** | Pinned image to `localstack/localstack:3.8` and added `ACTIVATE_PRO: "0"` env var in both `k8s/localstack/deployment.yaml` and `docker-compose.yml`. |
| **Files changed** | `k8s/localstack/deployment.yaml`, `docker-compose.yml` |

---

### ISSUE-002 — Keycloak crashes on realm import: `Unrecognized field "providerType"`

| Field | Detail |
|-------|--------|
| **Symptom** | Keycloak pod in `CrashLoopBackOff`. Log: `UnrecognizedPropertyException: Unrecognized field "providerType" (class ComponentExportRepresentation)` |
| **Root cause** | The `realm-corp.json` LDAP federation config included a `"providerType"` field. Keycloak 24's import format for `ComponentExportRepresentation` does not accept this field — it only allows `name`, `providerId`, `config`, `subComponents`, `subType`, `id`. |
| **Fix** | Removed the `"providerType": "org.keycloak.storage.UserStorageProvider"` line from both `k8s/keycloak/configmap.yaml` and `docker/keycloak/realm-corp.json`. |
| **Files changed** | `k8s/keycloak/configmap.yaml`, `docker/keycloak/realm-corp.json` |

---

### ISSUE-003 — `mapfile` not available on macOS default bash (3.2)

| Field | Detail |
|-------|--------|
| **Symptom** | `sync-ad-to-localstack.sh` exits immediately with: `mapfile: command not found` |
| **Root cause** | macOS ships bash 3.2 (`/bin/bash`) due to GPL licensing. `mapfile` (aka `readarray`) was introduced in bash 4.0. The shebang `#!/usr/bin/env bash` resolves to bash 3.2 on macOS unless Homebrew bash is installed and configured. |
| **Fix** | Replaced all `mapfile -t ARRAY < <(...)` patterns with `while IFS= read -r line; do ARRAY+=("$line"); done` loops compatible with bash 3.2. |
| **Files changed** | `scripts/sync-ad-to-localstack.sh` |

---

### ISSUE-004 — `set -e` / `set -o pipefail` kills script on `grep` no-match

| Field | Detail |
|-------|--------|
| **Symptom** | Script exits silently after printing `[+] Fetching groups from Samba AD...` with no error message. |
| **Root cause** | `grep` exits with code 1 when no lines match. With `set -eo pipefail`, any non-zero exit in a pipeline causes the entire script to abort — including a `grep` that legitimately finds no lines, which is not an error condition in a sync script. |
| **Fix** | Removed `set -e` and `set -o pipefail`. Added explicit `|| true` guards on all ldapsearch pipelines and used a tempfile pattern to safely read results. |
| **Files changed** | `scripts/sync-ad-to-localstack.sh` |

---

### ISSUE-005 — `awk '{print $2}'` truncates multi-word group/attribute names

| Field | Detail |
|-------|--------|
| **Symptom** | Group names like `"Domain Admins"` were read as `"Domain"`, `"Read-only Domain Controllers"` as `"Read-only"`. No custom groups were found because the truncated names all matched system group exclusion patterns. |
| **Root cause** | `awk '{print $2}'` splits on whitespace and prints only the second field. LDAP attributes formatted as `cn: Domain Admins` have the value after the first space — splitting by field index drops all subsequent words. |
| **Fix** | Replaced `awk '{print $2}'` with `sed 's/^cn: //'` (and `sed 's/^sAMAccountName: //'`) which strips only the attribute prefix and preserves the full value including spaces. |
| **Files changed** | `scripts/sync-ad-to-localstack.sh` |

---

### ISSUE-006 — `AWS="aws --endpoint-url=..."` string variable not callable in zsh

| Field | Detail |
|-------|--------|
| **Symptom** | Script dies with: `zsh: no such file or directory: aws --endpoint-url=http://127.0.0.1:4566`. Users/groups visible in ldapsearch output but no IAM calls ever succeed. |
| **Root cause** | Assigning a command with arguments to a variable (`AWS="aws --endpoint-url=..."`) and then calling it as `$AWS iam list-users` works in bash (via word splitting) but fails in zsh, which treats the entire string including spaces as the command name. |
| **Fix** | Replaced the variable with a shell function `lsaws() { aws --endpoint-url="$LOCALSTACK_ENDPOINT" "$@"; }` which works correctly in both bash and zsh. All `$AWS` call sites updated to `lsaws`. |
| **Files changed** | `scripts/sync-ad-to-localstack.sh` |

---

### ISSUE-007 — `set -u` treats shell function name as unbound variable

| Field | Detail |
|-------|--------|
| **Symptom** | After replacing the `AWS` variable with the `lsaws` function, script exits with: `line 154: AWS: unbound variable` |
| **Root cause** | `set -u` (treat unset variables as errors) fired because remaining `$AWS` call sites hadn't yet been updated. Shell functions are not variables — `$AWS` with `set -u` is an error when `AWS` is not exported as a variable. |
| **Fix** | Removed `set -u` from the script header. All call sites migrated to `lsaws`. A sync script interacting with multiple external systems should handle errors explicitly per call, not via global abort flags. |
| **Files changed** | `scripts/sync-ad-to-localstack.sh` |

---

### ISSUE-008 — bash 3.2 `while read` + process substitution (`< <(...)`) fails

| Field | Detail |
|-------|--------|
| **Symptom** | Script exits without error mid-way after switching from `mapfile` to `while read` loops using `done < <(ldapsearch ...)` process substitution. |
| **Root cause** | Process substitution (`< <(...)`) is a bash 4+ feature and is unreliable in bash 3.2 on macOS when used with external command pipelines containing `grep` or `sed` that can exit non-zero. The combination of `set -o pipefail` (even partially removed) and process substitution caused silent exits. |
| **Fix** | Replaced all process substitution patterns with a tempfile approach: run ldapsearch pipeline → write to `$(mktemp)` → read the tempfile with `while read`. Tempfile is registered in `trap cleanup EXIT` for automatic removal. |
| **Files changed** | `scripts/sync-ad-to-localstack.sh` |

---

## AD Users Synced to LocalStack IAM

Result of running `./scripts/sync-ad-to-localstack.sh` against the live k3d cluster on 2026-04-09.

### IAM Users

| IAM Username | Source | ARN | Synced From |
|---|---|---|---|
| `adminuser` | Samba AD | `arn:aws:iam::000000000000:user/adminuser` | `CN=Admin User,CN=Users,DC=corp,DC=local` |
| `testuser1` | Samba AD | `arn:aws:iam::000000000000:user/testuser1` | `CN=Test User1,CN=Users,DC=corp,DC=local` |
| `testuser2` | Samba AD | `arn:aws:iam::000000000000:user/testuser2` | `CN=Test User2,CN=Users,DC=corp,DC=local` |

> `Administrator`, `Guest`, and `krbtgt` are excluded from sync — these are built-in AD system accounts with no equivalent in IAM.

### IAM Groups

| IAM Group | Source | Members | Policy Attached |
|---|---|---|---|
| `AppUsers` | `CN=AppUsers,CN=Users,DC=corp,DC=local` | `testuser1`, `testuser2` | `ReadOnlyAccess` |

> All built-in AD groups (Domain Admins, Domain Users, Schema Admins, etc.) are excluded from sync. Only custom groups created in the domain are mirrored.

### What Was Not Synced (and Why)

| AD Object | Reason excluded |
|---|---|
| `Administrator` | Built-in system account — hardcoded exclusion |
| `Guest` | Built-in system account — hardcoded exclusion |
| `krbtgt` | Kerberos ticket-granting account — hardcoded exclusion |
| `Domain Admins` | Built-in system group — pattern exclusion |
| `Domain Users` | Built-in system group — pattern exclusion |
| `Domain Computers` | Built-in system group — pattern exclusion |
| `Schema Admins` | Built-in system group — pattern exclusion |
| *(14 other built-in groups)* | All matched system group exclusion pattern |

### Verify Live

```bash
# Re-run sync after adding new users via phpLDAPadmin or samba-tool
./scripts/sync-ad-to-localstack.sh

# Query LocalStack directly (port-forward required in k3d mode)
kubectl port-forward -n corp-local svc/localstack 4566:4566 &

aws --endpoint-url=http://localhost:4566 iam list-users
aws --endpoint-url=http://localhost:4566 iam list-groups
aws --endpoint-url=http://localhost:4566 iam get-group --group-name AppUsers
```

---

## Notes

- Samba AD is **not 100% Microsoft AD compatible** — advanced features like Group Policy Objects (GPO) and Windows domain joins may need extra configuration.
- Password changes via `unicodePwd` require LDAPS (port 636). Never use plain LDAP for password operations in production.
- JWTs are stored in `localStorage`. For production, use `httpOnly` cookies to protect against XSS.
- The `sandesh` user was created with AD password complexity temporarily disabled — `samba-tool domain passwordsettings set --complexity=off/on`.
