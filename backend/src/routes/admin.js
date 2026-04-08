const express = require("express");
const { body, param, validationResult } = require("express-validator");
const { listUsers, createUser, deleteUser, updateUser } = require("../services/ldap");
const requireAuth = require("../middleware/auth");
const requireAdmin = require("../middleware/requireAdmin");

const router = express.Router();
router.use(requireAuth, requireAdmin);

// GET /api/admin/users
router.get("/users", async (_req, res) => {
  try {
    const users = await listUsers();
    res.json(users);
  } catch (err) {
    console.error("List users error:", err.message);
    res.status(500).json({ error: "Failed to list users" });
  }
});

// POST /api/admin/users
router.post(
  "/users",
  [
    body("username").trim().notEmpty().withMessage("Username is required"),
    body("password").isLength({ min: 8 }).withMessage("Password must be at least 8 characters"),
    body("givenName").trim().notEmpty().withMessage("First name is required"),
    body("surname").trim().notEmpty().withMessage("Last name is required"),
    body("email").optional().isEmail().withMessage("Invalid email address"),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    try {
      const user = await createUser(req.body);
      res.status(201).json(user);
    } catch (err) {
      console.error("Create user error:", err.message);
      res.status(500).json({ error: err.message || "Failed to create user" });
    }
  }
);

// PUT /api/admin/users/:username
router.put(
  "/users/:username",
  [
    param("username").trim().notEmpty(),
    body("displayName").optional().trim().notEmpty(),
    body("email").optional().isEmail(),
    body("department").optional().trim(),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    try {
      await updateUser(req.params.username, req.body);
      res.json({ message: "User updated" });
    } catch (err) {
      console.error("Update user error:", err.message);
      res.status(500).json({ error: err.message || "Failed to update user" });
    }
  }
);

// DELETE /api/admin/users/:username
router.delete("/users/:username", async (req, res) => {
  try {
    await deleteUser(req.params.username);
    res.json({ message: "User deleted" });
  } catch (err) {
    console.error("Delete user error:", err.message);
    res.status(500).json({ error: err.message || "Failed to delete user" });
  }
});

module.exports = router;
