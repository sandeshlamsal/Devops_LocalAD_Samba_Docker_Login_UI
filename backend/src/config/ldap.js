module.exports = {
  url: process.env.LDAP_URL || "ldap://samba",
  baseDN: process.env.LDAP_BASE_DN || "DC=corp,DC=local",
  adminDN: process.env.LDAP_ADMIN_DN || "CN=Administrator,CN=Users,DC=corp,DC=local",
  adminPass: process.env.LDAP_ADMIN_PASS || "Admin@Corp#1234",
  usersDN: `CN=Users,${process.env.LDAP_BASE_DN || "DC=corp,DC=local"}`,
};
