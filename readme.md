# Devops LocalAD — Samba Docker + React/Node Login UI

A fully containerised corporate login system using **Samba 4 Active Directory** as the identity provider, a **Node.js/Express** backend for LDAP authentication + JWT issuance, a **React** frontend with login, profile, password change, and admin panel, and **phpLDAPadmin** for browsing the LDAP directory.

| Component | Tech | Purpose |
|-----------|------|---------|
| Identity Provider | Samba 4 AD DC (Docker) | Single source of truth for all user identities |
| Backend | Node.js + Express + ldapjs v3 | LDAP auth → JWT issuance + admin API |
| Frontend | React 18 + Vite + Tailwind CSS | Login UI, profile, password change, admin panel |
| LDAP Admin UI | phpLDAPadmin (`osixia/phpldapadmin:0.9.0`) | Browse and manage the raw LDAP directory |
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
13. [Limitations](#limitations)
14. [Known Bugs & Fixes](#known-bugs--fixes)

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
  └── :8090  →  phpldapadmin
```

All four services share the `ad-net` Docker bridge network. The backend is the only service that talks to Samba.

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
./scripts/teardown.sh   # deletes cluster + stops Colima VM
```

> **Warning:** Teardown destroys all cluster state including Samba's provisioned AD. The next `deploy.sh` re-provisions from scratch and seeds fresh users.

### Re-creating a Clean Cluster

```bash
./scripts/teardown.sh          # delete cluster + stop Colima
./scripts/setup-cluster.sh     # fresh Colima VM + corp-cluster
./scripts/build-and-import.sh  # rebuild and import images
./scripts/deploy.sh            # apply manifests
```

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
│   └── samba/
│       ├── Dockerfile        # Ubuntu 22.04 + Samba packages
│       └── entrypoint.sh     # Domain provision + smb.conf backup + seed users
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
│   ├── setup-cluster.sh      # Install tools, start Colima, create k3d cluster
│   ├── build-and-import.sh   # Docker build all images, import into k3d
│   ├── deploy.sh             # kubectl apply all manifests, wait for ready
│   └── teardown.sh           # Delete cluster, stop Colima
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

## Notes

- Samba AD is **not 100% Microsoft AD compatible** — advanced features like Group Policy Objects (GPO) and Windows domain joins may need extra configuration.
- Password changes via `unicodePwd` require LDAPS (port 636). Never use plain LDAP for password operations in production.
- JWTs are stored in `localStorage`. For production, use `httpOnly` cookies to protect against XSS.
- The `sandesh` user was created with AD password complexity temporarily disabled — `samba-tool domain passwordsettings set --complexity=off/on`.
