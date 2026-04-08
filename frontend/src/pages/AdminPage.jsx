import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import api from "../api/index.js";

export default function AdminPage() {
  const [users, setUsers] = useState([]);
  const [error, setError] = useState("");
  const [showCreate, setShowCreate] = useState(false);

  const fetchUsers = () =>
    api.get("/api/admin/users")
      .then(({ data }) => setUsers(data))
      .catch(() => setError("Failed to load users"));

  useEffect(() => { fetchUsers(); }, []);

  async function handleDelete(username) {
    if (!confirm(`Delete user "${username}"? This cannot be undone.`)) return;
    try {
      await api.delete(`/api/admin/users/${username}`);
      fetchUsers();
    } catch {
      alert("Failed to delete user");
    }
  }

  return (
    <div className="max-w-5xl mx-auto mt-10 px-4">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-gray-800">User Management</h2>
        <button
          onClick={() => setShowCreate(!showCreate)}
          className="bg-blue-700 text-white px-4 py-2 rounded hover:bg-blue-800 text-sm font-medium"
        >
          {showCreate ? "Cancel" : "+ New User"}
        </button>
      </div>

      {showCreate && <CreateUserForm onCreated={() => { setShowCreate(false); fetchUsers(); }} />}

      {error && <p className="text-red-600 mb-4">{error}</p>}

      <div className="bg-white shadow rounded-lg overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 text-gray-600 uppercase text-xs">
            <tr>
              <Th>Username</Th>
              <Th>Display Name</Th>
              <Th>Email</Th>
              <Th>Department</Th>
              <Th>Groups</Th>
              <Th>Role</Th>
              <Th>Actions</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {users.map((u) => (
              <tr key={u.username} className="hover:bg-gray-50">
                <Td>{u.username}</Td>
                <Td>{u.displayName}</Td>
                <Td>{u.email || "—"}</Td>
                <Td>{u.department || "—"}</Td>
                <Td>{u.groups?.join(", ") || "—"}</Td>
                <Td>
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${u.isAdmin ? "bg-red-100 text-red-700" : "bg-green-100 text-green-700"}`}>
                    {u.isAdmin ? "Admin" : "User"}
                  </span>
                </Td>
                <Td>
                  <button
                    onClick={() => handleDelete(u.username)}
                    className="text-red-600 hover:underline text-xs"
                  >
                    Delete
                  </button>
                </Td>
              </tr>
            ))}
            {users.length === 0 && (
              <tr><td colSpan={7} className="text-center py-6 text-gray-400">No users found</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CreateUserForm({ onCreated }) {
  const { register, handleSubmit, reset, formState: { errors } } = useForm();
  const [serverError, setServerError] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(data) {
    setServerError("");
    setLoading(true);
    try {
      await api.post("/api/admin/users", data);
      reset();
      onCreated();
    } catch (err) {
      setServerError(err.response?.data?.error || "Failed to create user");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="bg-gray-50 border border-gray-200 rounded-lg p-6 mb-6 grid grid-cols-2 gap-4">
      <h3 className="col-span-2 font-semibold text-gray-700">Create New User</h3>

      <FormField label="Username" reg={register("username", { required: true })} error={errors.username} />
      <FormField label="Password" type="password" reg={register("password", { required: true, minLength: 8 })} error={errors.password} />
      <FormField label="First Name" reg={register("givenName", { required: true })} error={errors.givenName} />
      <FormField label="Last Name" reg={register("surname", { required: true })} error={errors.surname} />
      <FormField label="Email" type="email" reg={register("email")} error={errors.email} />
      <FormField label="Department" reg={register("department")} error={errors.department} />

      {serverError && <p className="col-span-2 text-red-600 text-sm">{serverError}</p>}

      <div className="col-span-2 flex justify-end">
        <button
          type="submit"
          disabled={loading}
          className="bg-blue-700 text-white px-5 py-2 rounded hover:bg-blue-800 text-sm font-medium disabled:opacity-50"
        >
          {loading ? "Creating..." : "Create User"}
        </button>
      </div>
    </form>
  );
}

function FormField({ label, type = "text", reg, error }) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
      <input
        type={type}
        {...reg}
        className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
      />
      {error && <p className="text-red-500 text-xs mt-0.5">Required</p>}
    </div>
  );
}

function Th({ children }) {
  return <th className="px-4 py-3 text-left">{children}</th>;
}

function Td({ children }) {
  return <td className="px-4 py-3 text-gray-700">{children}</td>;
}
