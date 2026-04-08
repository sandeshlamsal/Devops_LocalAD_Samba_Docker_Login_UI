const express = require("express");
const jwt = require("jsonwebtoken");
const { body, validationResult } = require("express-validator");
const { authenticateUser } = require("../services/ldap");
const requireAuth = require("../middleware/auth");

const router = express.Router();

const signToken = (user) =>
  jwt.sign(
    {
      username: user.username,
      displayName: user.displayName,
      email: user.email,
      isAdmin: user.isAdmin,
    },
    process.env.JWT_SECRET,
    { expiresIn: "8h" }
  );

// POST /api/auth/login
router.post(
  "/login",
  [
    body("username").trim().notEmpty().withMessage("Username is required"),
    body("password").notEmpty().withMessage("Password is required"),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { username, password } = req.body;
    try {
      const user = await authenticateUser(username, password);
      if (!user) {
        return res.status(401).json({ error: "Invalid username or password" });
      }
      const token = signToken(user);
      res.json({ token, user });
    } catch (err) {
      console.error("Login error:", err.message);
      res.status(500).json({ error: "Authentication service unavailable" });
    }
  }
);

// POST /api/auth/refresh
router.post("/refresh", requireAuth, (req, res) => {
  // Re-sign with a fresh expiry (payload already verified by requireAuth)
  const { username, displayName, email, isAdmin } = req.user;
  const token = signToken({ username, displayName, email, isAdmin });
  res.json({ token });
});

module.exports = router;
