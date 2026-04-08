const ldap = require("ldapjs");
const cfg = require("../config/ldap");

// Helper: create and bind an LDAP client, return { client, unbind }
function createClient(dn, password) {
  return new Promise((resolve, reject) => {
    const client = ldap.createClient({ url: cfg.url, tlsOptions: { rejectUnauthorized: false } });

    client.on("error", (err) => reject(err));

    client.bind(dn, password, (err) => {
      if (err) {
        client.destroy();
        return reject(err);
      }
      resolve({
        client,
        unbind: () => new Promise((res) => client.unbind(() => res())),
      });
    });
  });
}

// Helper: run an ldap search, collect all entries
function search(client, base, opts) {
  return new Promise((resolve, reject) => {
    client.search(base, opts, (err, res) => {
      if (err) return reject(err);
      const entries = [];
      res.on("searchEntry", (entry) => entries.push(entry.object));
      res.on("error", reject);
      res.on("end", () => resolve(entries));
    });
  });
}

// Parse user entry to a plain object
function parseUser(entry) {
  const memberOf = Array.isArray(entry.memberOf)
    ? entry.memberOf
    : entry.memberOf
    ? [entry.memberOf]
    : [];

  const isAdmin = memberOf.some((g) =>
    g.toLowerCase().startsWith("cn=domain admins")
  );

  return {
    username: entry.sAMAccountName,
    displayName: entry.displayName || entry.cn || entry.sAMAccountName,
    email: entry.mail || "",
    department: entry.department || "",
    givenName: entry.givenName || "",
    surname: entry.sn || "",
    groups: memberOf.map((g) => g.split(",")[0].replace("CN=", "")),
    isAdmin,
  };
}

// Authenticate a user by binding with their credentials
async function authenticateUser(username, password) {
  const userDN = `CN=${username},CN=Users,${cfg.baseDN}`;
  let conn;
  try {
    conn = await createClient(userDN, password);
  } catch (err) {
    if (err.name === "InvalidCredentialsError") return null;
    throw err;
  }

  // Fetch user details while we have the session
  const entries = await search(conn.client, cfg.usersDN, {
    scope: "sub",
    filter: `(sAMAccountName=${ldap.escapeDN(username)})`,
    attributes: ["sAMAccountName", "displayName", "cn", "mail", "memberOf", "department", "givenName", "sn"],
  });

  await conn.unbind();
  return entries.length ? parseUser(entries[0]) : null;
}

// Get one user's details via admin bind
async function getUserDetails(username) {
  const conn = await createClient(cfg.adminDN, cfg.adminPass);
  try {
    const entries = await search(conn.client, cfg.usersDN, {
      scope: "sub",
      filter: `(sAMAccountName=${ldap.escapeDN(username)})`,
      attributes: ["sAMAccountName", "displayName", "cn", "mail", "memberOf", "department", "givenName", "sn"],
    });
    return entries.length ? parseUser(entries[0]) : null;
  } finally {
    await conn.unbind();
  }
}

// List all non-system users via admin bind
async function listUsers() {
  const conn = await createClient(cfg.adminDN, cfg.adminPass);
  try {
    const entries = await search(conn.client, cfg.usersDN, {
      scope: "sub",
      filter: "(&(objectClass=user)(objectCategory=person)(!(isCriticalSystemObject=TRUE)))",
      attributes: ["sAMAccountName", "displayName", "cn", "mail", "memberOf", "department", "givenName", "sn"],
    });
    return entries.map(parseUser);
  } finally {
    await conn.unbind();
  }
}

// Create a new AD user via admin bind
async function createUser({ username, password, givenName, surname, email, department }) {
  const conn = await createClient(cfg.adminDN, cfg.adminPass);
  const userDN = `CN=${givenName} ${surname},CN=Users,${cfg.baseDN}`;

  // unicodePwd requires UTF-16LE encoding with surrounding quotes
  const encodedPassword = Buffer.from(`"${password}"`, "utf16le");

  const entry = {
    objectClass: ["top", "person", "organizationalPerson", "user"],
    sAMAccountName: username,
    userPrincipalName: `${username}@${cfg.baseDN.replace(/DC=/gi, "").replace(/,/g, ".")}`,
    givenName,
    sn: surname,
    cn: `${givenName} ${surname}`,
    displayName: `${givenName} ${surname}`,
    mail: email || "",
    department: department || "",
    unicodePwd: encodedPassword,
    userAccountControl: "512", // Normal account, enabled
  };

  return new Promise((resolve, reject) => {
    conn.client.add(userDN, entry, async (err) => {
      await conn.unbind();
      if (err) return reject(err);
      resolve({ username, displayName: `${givenName} ${surname}` });
    });
  });
}

// Delete a user via admin bind
async function deleteUser(username) {
  // First get the DN
  const user = await getUserDetails(username);
  if (!user) throw new Error("User not found");

  const conn = await createClient(cfg.adminDN, cfg.adminPass);
  const userDN = `CN=${user.displayName},CN=Users,${cfg.baseDN}`;

  return new Promise((resolve, reject) => {
    conn.client.del(userDN, async (err) => {
      await conn.unbind();
      if (err) return reject(err);
      resolve();
    });
  });
}

// Update user attributes (displayName, email, department)
async function updateUser(username, { displayName, email, department }) {
  const conn = await createClient(cfg.adminDN, cfg.adminPass);
  const user = await getUserDetails(username);
  if (!user) throw new Error("User not found");

  const userDN = `CN=${user.displayName},CN=Users,${cfg.baseDN}`;
  const changes = [];

  if (displayName) {
    changes.push(new ldap.Change({ operation: "replace", modification: new ldap.Attribute({ type: "displayName", values: [displayName] }) }));
  }
  if (email !== undefined) {
    changes.push(new ldap.Change({ operation: "replace", modification: new ldap.Attribute({ type: "mail", values: [email] }) }));
  }
  if (department !== undefined) {
    changes.push(new ldap.Change({ operation: "replace", modification: new ldap.Attribute({ type: "department", values: [department] }) }));
  }

  return new Promise((resolve, reject) => {
    conn.client.modify(userDN, changes, async (err) => {
      await conn.unbind();
      if (err) return reject(err);
      resolve();
    });
  });
}

// Change a user's own password (requires user bind then admin modify)
async function changePassword(username, oldPassword, newPassword) {
  // Verify old credentials first
  const valid = await authenticateUser(username, oldPassword);
  if (!valid) throw new Error("Current password is incorrect");

  const conn = await createClient(cfg.adminDN, cfg.adminPass);
  const userDN = `CN=${valid.displayName},CN=Users,${cfg.baseDN}`;
  const encodedPassword = Buffer.from(`"${newPassword}"`, "utf16le");

  const change = new ldap.Change({
    operation: "replace",
    modification: new ldap.Attribute({ type: "unicodePwd", values: [encodedPassword] }),
  });

  return new Promise((resolve, reject) => {
    conn.client.modify(userDN, change, async (err) => {
      await conn.unbind();
      if (err) return reject(err);
      resolve();
    });
  });
}

module.exports = { authenticateUser, getUserDetails, listUsers, createUser, deleteUser, updateUser, changePassword };
