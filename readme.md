# Devops LocalAD — Samba Docker + React/Node Login UI

A fully containerized corporate login system using **Samba 4 Active Directory** as the identity provider, a **Node.js/Express** backend for LDAP authentication + JWT issuance, and a **React** frontend with login, profile, password change, and admin panel.

| Component | Tech | Why |
|-----------|------|-----|
| Identity Provider | Docker (Samba AD) | Lightweight, fast setup, no VM needed |
| Backend | Node.js + Express | LDAP auth → JWT API |
| Frontend | React JS + Tailwind | Login UI + admin panel |

---

## Setup Checklist

Use this as a quick reference before running the project for the first time.

### Docker Compose (local dev)
- [ ] Docker Desktop or Colima installed and running
- [ ] `cd Devops_LocalAD_Samba_Docker_Login_UI`
- [ ] `cp backend/.env.example backend/.env` and edit secrets
- [ ] `docker compose up --build`
- [ ] Wait ~30 s for Samba domain provisioning
- [ ] Open `http://localhost:3000`

### Kubernetes / k3d (cluster mode)
- [ ] macOS with Homebrew installed
- [ ] Run `./scripts/setup-cluster.sh` (installs Colima + k3d, starts cluster)
- [ ] Add `127.0.0.1 corp.localhost` to `/etc/hosts`
- [ ] Run `./scripts/build-and-import.sh` (builds and imports Docker images)
- [ ] Run `./scripts/deploy.sh` (applies all K8s manifests)
- [ ] Wait ~60 s for Samba provisioning on first boot
- [ ] Open `http://corp.localhost`

---

## Architecture

```
Browser (React :3000)
      │
      ▼  REST + JWT
Node/Express (:3001)
      │
      ▼  LDAP (port 389)
Samba AD DC (:389)
```

All three services run as Docker containers on the same internal `ad-net` bridge network.

---

## Infrastructure Requirements

### Minimum Host Machine
| Resource | Minimum | Recommended |
|----------|---------|-------------|
| CPU | 2 cores | 4 cores |
| RAM | 6 GB free | 8 GB free |
| Disk | 10 GB free | 20 GB free |
| OS | macOS 12+ | macOS 13+ |

> **Linux users:** Colima is macOS-only. On Linux, run k3d directly after installing Docker. Skip `setup-cluster.sh` steps 1–2 and run `k3d cluster create corp-cluster --port '80:80@loadbalancer' --agents 1` directly.

### Required Tools (auto-installed by `setup-cluster.sh`)
| Tool | Version | Purpose |
|------|---------|---------|
| [Homebrew](https://brew.sh) | any | macOS package manager (must pre-exist) |
| [Colima](https://github.com/abiosoft/colima) | ≥ 0.6 | Lightweight Docker/K8s VM for macOS |
| [k3d](https://k3d.io) | ≥ 5.0 | Runs k3s (lightweight K8s) inside Docker containers |
| [kubectl](https://kubernetes.io/docs/tasks/tools/) | ≥ 1.28 | Kubernetes CLI |
| Docker CLI | ≥ 24 | Image building (provided by Colima) |

### Port Map
| Mode | Port | Service |
|------|------|---------|
| Docker Compose | `3000` | React frontend |
| Docker Compose | `3001` | Node.js backend |
| Docker Compose | `389` | Samba LDAP |
| Kubernetes | `80` | Traefik → frontend (`/`) + backend (`/api`) |

---

## Running on Kubernetes (Colima + k3d)

### How it works

```
  macOS Host
  ┌────────────────────────────────────────────────────┐
  │  Colima VM  (2 CPU / 4 GB RAM)                     │
  │  ┌──────────────────────────────────────────────┐  │
  │  │  k3d cluster "corp-cluster"                  │  │
  │  │  ┌────────────────────────────────────────┐  │  │
  │  │  │  Namespace: corp-local                 │  │  │
  │  │  │                                        │  │  │
  │  │  │  [StatefulSet]  samba-0     :389 LDAP  │  │  │
  │  │  │  [Deployment]   backend     :3001 HTTP │  │  │
  │  │  │  [Deployment]   frontend    :80  HTTP  │  │  │
  │  │  │                                        │  │  │
  │  │  │  [Ingress]  corp.localhost             │  │  │
  │  │  │    /api  ──► backend:3001              │  │  │
  │  │  │    /     ──► frontend:80               │  │  │
  │  │  └────────────────────────────────────────┘  │  │
  │  │  Traefik LoadBalancer ◄── port 80 on host ───┼──┼── browser
  │  └──────────────────────────────────────────────┘  │
  └────────────────────────────────────────────────────┘
```

Traffic flow for a browser request to `http://corp.localhost/api/auth/login`:
1. macOS resolves `corp.localhost` → `127.0.0.1` (via `/etc/hosts`)
2. Colima/k3d maps host port 80 → Traefik LoadBalancer inside the cluster
3. Traefik matches the `/api` prefix → routes to `backend` Service (ClusterIP :3001)
4. Backend makes an LDAP call to `samba` Service (ClusterIP :389) — resolved by K8s DNS
5. Samba returns the authentication result; backend signs a JWT and responds

### Step 1 — Start the cluster

```bash
./scripts/setup-cluster.sh
```

What it does:
- Installs `colima`, `k3d`, `kubectl` via Homebrew (skips if already present)
- Starts a Colima VM: **2 CPU, 4 GB RAM, 40 GB disk**, Docker runtime
- Creates a k3d cluster named `corp-cluster` with **1 server + 1 agent node**
- Maps host **port 80 → Traefik** inside the cluster

### Step 2 — Add the hostname (one-time)

```bash
echo "127.0.0.1  corp.localhost" | sudo tee -a /etc/hosts
```

### Step 3 — Build and import images

```bash
./scripts/build-and-import.sh
```

What it does:
- Builds `corp-samba:latest` from `docker/samba/`
- Builds `corp-backend:latest` from `backend/`
- Builds `corp-frontend:k8s` from `frontend/` with `VITE_API_URL=http://corp.localhost`
  (Vite bakes this URL into the React bundle at build time so the browser knows where to call the API)
- Imports all three images into the k3d cluster with `k3d image import`
  (this is why manifests use `imagePullPolicy: Never` — no registry needed)

### Step 4 — Deploy

```bash
./scripts/deploy.sh
```

What it does:
- `kubectl apply` on all manifests under `k8s/` in dependency order
- Waits up to 3 minutes for all pods to reach `Ready` state
- Prints a summary of running resources and the Ingress

### Step 5 — Verify

```bash
# All pods should show Running/Ready
kubectl get pods -n corp-local

# API health check through Traefik
curl http://corp.localhost/api/health

# Login test
curl -s -X POST http://corp.localhost/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"testuser1","password":"User@Corp#1"}' | jq .

# Open the app
open http://corp.localhost
```

### Teardown

```bash
./scripts/teardown.sh   # deletes cluster + stops Colima VM
```

> **Warning:** Teardown destroys all cluster state including Samba's provisioned AD. The next `deploy.sh` will re-provision from scratch.

---

### K8s File Reference

```
k8s/
├── namespace.yaml              Namespace "corp-local" + privileged PSA label (for SYS_ADMIN)
├── samba/
│   ├── pvc.yaml                2 Gi PersistentVolumeClaim (local-path provisioner)
│   ├── statefulset.yaml        Samba AD DC — StatefulSet, SYS_ADMIN cap, readiness probe
│   └── service.yaml            ClusterIP — ports 389 (LDAP), 636 (LDAPS), 88 (Kerberos)
├── backend/
│   ├── configmap.yaml          Non-secret env vars (LDAP_URL, BASE_DN, PORT)
│   ├── secret.yaml             Sensitive env vars (LDAP_ADMIN_PASS, JWT_SECRET)
│   ├── deployment.yaml         Node.js backend — readiness + liveness on /api/health
│   └── service.yaml            ClusterIP — port 3001
├── frontend/
│   ├── deployment.yaml         nginx serving the built React SPA
│   └── service.yaml            ClusterIP — port 80
└── ingress.yaml                Traefik Ingress — /api → backend, / → frontend
```

### Why StatefulSet for Samba?

| Concern | Why it matters for Samba |
|---------|--------------------------|
| Stable hostname | Samba embeds the machine hostname in Kerberos keytabs and the AD database at provision time — if the hostname changes on restart, Kerberos breaks |
| Ordered startup | StatefulSet guarantees pod-0 starts before replicas; prevents split-brain if ever scaled |
| Persistent storage | AD data lives in `/var/lib/samba` — a regular Deployment would lose it on pod restart without explicit volume binding |

---

## Quick Start

```bash
# 1. Clone and enter the project
cd Devops_LocalAD_Samba_Docker_Login_UI

# 2. Build and start all services
docker compose up --build

# 3. Wait ~30 seconds for Samba to provision the domain on first boot

# 4. Open the app
open http://localhost:3000
```

---

## Default Credentials

| Username | Password | Role |
|----------|----------|------|
| `Administrator` | `Admin@Corp#1234` | Domain Admin |
| `adminuser` | `Admin@Corp#1` | Domain Admin |
| `testuser1` | `User@Corp#1` | Regular user |
| `testuser2` | `User@Corp#2` | Regular user |

---

## Project Structure

```
.
├── docker/
│   └── samba/
│       ├── Dockerfile        # Ubuntu 22.04 + Samba packages
│       └── entrypoint.sh     # Domain provision + seed users on first boot
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
│   │   ├── api/index.js      # Axios instance
│   │   ├── pages/            # LoginPage, ProfilePage, ChangePasswordPage, AdminPage
│   │   └── components/       # ProtectedRoute, AdminRoute
│   └── Dockerfile
└── docker-compose.yml
```

---

## API Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
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
| `LDAP_URL` | `ldap://samba` | LDAP server URL (use container name) |
| `LDAP_BASE_DN` | `DC=corp,DC=local` | Root DN of the domain |
| `LDAP_ADMIN_DN` | `CN=Administrator,CN=Users,DC=corp,DC=local` | Service account for admin operations |
| `LDAP_ADMIN_PASS` | `Admin@Corp#1234` | Service account password |
| `JWT_SECRET` | *(change me)* | Secret key for signing JWTs |
| `PORT` | `3001` | Backend listen port |

---

## Verify the Stack

```bash
# Check provisioned users in AD
docker exec samba-ad-dc samba-tool user list

# Test login API
curl -s -X POST http://localhost:3001/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"testuser1","password":"User@Corp#1"}' | jq .

# Health check
curl http://localhost:3001/api/health
```

---

## Samba 4 Active Directory — Deep Dive

### What is Samba 4 AD?

**Samba** is an open-source implementation of the **SMB/CIFS protocol** and — since version 4 — a full **Active Directory Domain Controller (AD DC)**. It lets Linux servers behave like a Microsoft Windows Server domain controller, without needing Windows at all.

An **Active Directory Domain Controller** is the central identity authority of a network. It:
- Stores every user account, password hash, and group membership in a database called the **LDAP directory**
- Authenticates users using **Kerberos** (ticket-based) or **NTLM** (older challenge-response)
- Enforces policies on who can access what
- Answers directory queries over the **LDAP protocol** (port 389 / 636 for TLS)

In this project Samba AD plays the role of the **single source of truth for all user identities**. The Node.js backend never stores passwords — it always asks Samba.

---

### How the AD Directory is Structured

Active Directory organises objects (users, groups, computers) in a tree using a notation called a **Distinguished Name (DN)**. Every object has a unique DN path from the root of the domain down to the object itself.

```
DC=corp,DC=local          ← the domain root  (corp.local)
│
├── CN=Users              ← the default "Users" container
│   ├── CN=Administrator  ← built-in domain admin account
│   ├── CN=testuser1      ← regular test user
│   ├── CN=testuser2      ← regular test user
│   └── CN=adminuser      ← custom admin seeded at startup
│
└── CN=Builtin            ← built-in security principals
    └── CN=Domain Admins  ← group — members of this have admin rights
```

Reading a DN right-to-left gives you the path: `DC=corp,DC=local` is the domain, `CN=Users` is the folder, `CN=testuser1` is the object.

Key abbreviations:

| Abbreviation | Stands for | Meaning |
|---|---|---|
| `DC` | Domain Component | A piece of the domain name (`corp`, `local`) |
| `CN` | Common Name | Name of the object (user, group, container) |
| `OU` | Organizational Unit | A folder you create to organise objects |
| `DN` | Distinguished Name | The full path to an object in the tree |

---

### Samba Configuration Files

After `samba-tool domain provision` runs inside the container, Samba generates and manages several config files. Here is what each one does:

#### `/etc/samba/smb.conf` — Main Samba Config

Generated automatically by `domain provision`. This is the master configuration file.

```ini
[global]
    workgroup = CORP                    # short NetBIOS domain name (≤15 chars)
    realm = CORP.LOCAL                  # full Kerberos realm (must match DNS domain)
    netbios name = DC1                  # this machine's NetBIOS hostname
    server role = active directory domain controller
    dns forwarder = 8.8.8.8             # forward unresolved DNS queries upstream
    idmap_ldb:use rfc2307 = yes         # map Unix UIDs/GIDs stored in AD (rfc2307)

[sysvol]
    path = /var/lib/samba/sysvol        # Group Policy / login scripts share
    read only = No

[netlogon]
    path = /var/lib/samba/sysvol/corp.local/scripts
    read only = No
```

Key settings explained:

| Setting | What it controls |
|---------|-----------------|
| `workgroup` | The short domain name Windows machines use to find the domain |
| `realm` | The Kerberos realm — must be uppercase, matches the DNS domain |
| `server role` | Tells Samba to act as an AD DC (not just a file server) |
| `dns forwarder` | Where to send DNS queries that Samba's internal DNS can't answer |
| `idmap_ldb:use rfc2307` | Store Linux UID/GID numbers inside AD attributes (useful for Linux clients) |

#### `/var/lib/samba/private/` — Secret Keys and Database

This directory is created by `domain provision` and holds the most sensitive data. **Never expose it.**

```
/var/lib/samba/private/
├── sam.ldb           ← the AD database (users, groups, policies — everything)
├── secrets.ldb       ← machine account secrets, domain trust passwords
├── krb5.conf         ← Kerberos client configuration (copied to /etc/krb5.conf)
├── tls/              ← self-signed TLS certificate for LDAPS (port 636)
│   ├── ca.pem
│   ├── cert.pem
│   └── key.pem
└── dns/              ← internal DNS zone data
```

`sam.ldb` is a **LDB** (LDAP-like database) file — the equivalent of `NTDS.dit` on a Windows Server DC. It stores every user account, password hash (NT hash + Kerberos keys), group membership, and schema definition.

#### `/etc/krb5.conf` — Kerberos Client Config

Copied from `/var/lib/samba/private/krb5.conf` by the entrypoint script. Tells the Kerberos client library which realm to use and where to find the KDC (Key Distribution Center — the auth ticket server).

```ini
[libdefaults]
    default_realm = CORP.LOCAL          # default Kerberos realm
    dns_lookup_realm = false
    dns_lookup_kdc = true               # find KDC via DNS SRV records

[realms]
    CORP.LOCAL = {
        kdc = dc1.corp.local            # the Key Distribution Center
        admin_server = dc1.corp.local
    }

[domain_realm]
    .corp.local = CORP.LOCAL            # map DNS suffix → realm
    corp.local = CORP.LOCAL
```

This is primarily used for tools like `kinit` (get a Kerberos ticket) and `samba-tool`. Our Node.js app uses **LDAP simple bind** (username + password directly), not Kerberos tickets, so this file matters for the container tooling but not the app itself.

#### `/var/lib/samba/sysvol/` — System Volume

The SYSVOL share holds **Group Policy Objects (GPOs)** and logon scripts, replicated between DCs in a real multi-DC environment. In this single-DC dev setup it's mostly empty but must exist for Samba to function correctly.

---

### How the App Consumes the AD

This project uses the **LDAP protocol** (not Kerberos) to talk to Samba AD. Here is the exact flow for each operation:

#### 1. User Login — LDAP Simple Bind

```
User submits form (username: "testuser1", password: "User@Corp#1")
        │
        ▼
POST /api/auth/login  (Node.js)
        │
        ▼  Open TCP connection to samba:389
ldapjs client.bind("CN=testuser1,CN=Users,DC=corp,DC=local", "User@Corp#1")
        │
        ├── Samba checks NT hash of password against sam.ldb
        │
        ├── SUCCESS → ldapjs searches for user attributes (displayName, mail, memberOf, ...)
        │            Node.js signs a JWT and returns it to the browser
        │
        └── FAILURE (InvalidCredentialsError) → 401 Unauthorized returned to browser
```

The bind operation is the LDAP equivalent of "login". If the bind succeeds, the password is correct.

#### 2. Admin Operations — Admin Service Account Bind

For operations that require reading all users or modifying the directory (create/delete user, change password), the backend binds as the **Administrator** service account, not as the end user:

```
GET /api/admin/users  (requires JWT with isAdmin=true)
        │
        ▼  Bind as Administrator
ldapjs client.bind("CN=Administrator,CN=Users,DC=corp,DC=local", LDAP_ADMIN_PASS)
        │
        ▼  Search
client.search("CN=Users,DC=corp,DC=local", {
    filter: "(&(objectClass=user)(objectCategory=person))",
    attributes: ["sAMAccountName", "displayName", "mail", "memberOf", ...]
})
        │
        ▼  Return list of user objects to frontend
```

#### 3. Admin Detection — `memberOf` Attribute

After a successful bind + user search, the backend reads the `memberOf` attribute — a list of all groups the user belongs to:

```js
// from backend/src/services/ldap.js
const isAdmin = memberOf.some((g) =>
    g.toLowerCase().startsWith("cn=domain admins")
);
```

If the user's `memberOf` contains `CN=Domain Admins,...`, `isAdmin: true` is embedded in the JWT. The `requireAdmin` middleware then checks `req.user.isAdmin` on every admin route.

#### 4. Password Change — `unicodePwd` Attribute

AD stores passwords via the `unicodePwd` LDAP attribute. To change it, you send a **UTF-16LE encoded string** wrapped in double quotes:

```js
// backend/src/services/ldap.js
const encodedPassword = Buffer.from(`"${newPassword}"`, "utf16le");
// LDAP modify operation: replace unicodePwd with this buffer
```

This is an AD-specific quirk — standard LDAP uses `userPassword`, but AD requires `unicodePwd` in this exact encoding. In production this must go over LDAPS (TLS) because `unicodePwd` is write-protected on plain LDAP connections by default on real Windows AD (Samba relaxes this for dev).

---

### Key Ports Used by Samba AD

| Port | Protocol | Purpose |
|------|----------|---------|
| 389 | TCP/UDP | LDAP — directory queries and authentication (plain) |
| 636 | TCP | LDAPS — LDAP over TLS (encrypted) |
| 88 | TCP/UDP | Kerberos — ticket-based authentication |
| 445 | TCP | SMB — file sharing (not used by this app) |
| 53 | TCP/UDP | DNS — Samba's internal DNS server |

This project only uses **port 389** (plain LDAP). Port 636 (LDAPS) is exposed in the Docker Compose but not yet wired into the backend — a production hardening step.

---

## Notes

- Samba AD is **not 100% Microsoft AD compatible** — advanced features like Group Policy Objects (GPO) and Windows domain joins may not work without extra configuration.
- The `unicodePwd` attribute (used for password changes) requires the LDAP connection to be over LDAPS (port 636) in a production environment. For local dev, Samba allows plain LDAP password modification.
- JWTs are stored in `localStorage`. For production, consider `httpOnly` cookies.
