const express = require("express");
const { body, validationResult } = require("express-validator");
const { getUserDetails, changePassword } = require("../services/ldap");
const requireAuth = require("../middleware/auth");

const router = express.Router();
router.use(requireAuth);

// GET /api/users/me
router.get("/me", async (req, res) => {
  try {
    const user = await getUserDetails(req.user.username);
    if (!user) return res.status(404).json({ error: "User not found" });
    res.json(user);
  } catch (err) {
    console.error("GET /me error:", err.message);
    res.status(500).json({ error: "Failed to fetch user details" });
  }
});

// PUT /api/users/me/password
router.put(
  "/me/password",
  [
    body("currentPassword").notEmpty().withMessage("Current password is required"),
    body("newPassword")
      .isLength({ min: 8 })
      .withMessage("New password must be at least 8 characters"),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { currentPassword, newPassword } = req.body;
    try {
      await changePassword(req.user.username, currentPassword, newPassword);
      res.json({ message: "Password changed successfully" });
    } catch (err) {
      if (err.message === "Current password is incorrect") {
        return res.status(401).json({ error: err.message });
      }
      console.error("Password change error:", err.message);
      res.status(500).json({ error: "Failed to change password" });
    }
  }
);

module.exports = router;
