# Devops LocalAD — Samba Docker + React/Node Login UI

A fully containerized corporate login system using **Samba 4 Active Directory** as the identity provider, a **Node.js/Express** backend for LDAP authentication + JWT issuance, and a **React** frontend with login, profile, password change, and admin panel.

| Component | Tech | Why |
|-----------|------|-----|
| Identity Provider | Docker (Samba AD) | Lightweight, fast setup, no VM needed |
| Backend | Node.js + Express | LDAP auth → JWT API |
| Frontend | React JS + Tailwind | Login UI + admin panel |

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
