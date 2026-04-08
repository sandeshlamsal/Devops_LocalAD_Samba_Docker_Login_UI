import { useState } from "react";
import { useForm } from "react-hook-form";
import api from "../api/index.js";

export default function ChangePasswordPage() {
  const { register, handleSubmit, watch, reset, formState: { errors } } = useForm();
  const [success, setSuccess] = useState("");
  const [serverError, setServerError] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit({ currentPassword, newPassword }) {
    setSuccess("");
    setServerError("");
    setLoading(true);
    try {
      await api.put("/api/users/me/password", { currentPassword, newPassword });
      setSuccess("Password changed successfully.");
      reset();
    } catch (err) {
      setServerError(err.response?.data?.error || "Failed to change password");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-md mx-auto mt-12 px-4">
      <div className="bg-white shadow rounded-lg p-8">
        <h2 className="text-xl font-bold text-gray-800 mb-6">Change Password</h2>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <Field
            label="Current Password"
            type="password"
            reg={register("currentPassword", { required: "Current password is required" })}
            error={errors.currentPassword}
          />
          <Field
            label="New Password"
            type="password"
            reg={register("newPassword", {
              required: "New password is required",
              minLength: { value: 8, message: "Must be at least 8 characters" },
            })}
            error={errors.newPassword}
          />
          <Field
            label="Confirm New Password"
            type="password"
            reg={register("confirmPassword", {
              required: "Please confirm your new password",
              validate: (v) => v === watch("newPassword") || "Passwords do not match",
            })}
            error={errors.confirmPassword}
          />

          {serverError && <p className="text-red-600 text-sm">{serverError}</p>}
          {success && <p className="text-green-600 text-sm">{success}</p>}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-blue-700 text-white py-2 rounded font-semibold hover:bg-blue-800 disabled:opacity-50"
          >
            {loading ? "Updating..." : "Update Password"}
          </button>
        </form>
      </div>
    </div>
  );
}

function Field({ label, type, reg, error }) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
      <input
        type={type}
        {...reg}
        className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
      />
      {error && <p className="text-red-500 text-xs mt-1">{error.message}</p>}
    </div>
  );
}
