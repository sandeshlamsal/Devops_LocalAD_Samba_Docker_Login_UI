import { useEffect, useState } from "react";
import api from "../api/index.js";

export default function ProfilePage() {
  const [profile, setProfile] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api.get("/api/users/me")
      .then(({ data }) => setProfile(data))
      .catch(() => setError("Failed to load profile"));
  }, []);

  if (error) return <div className="p-8 text-red-600">{error}</div>;
  if (!profile) return <div className="p-8 text-gray-500">Loading...</div>;

  return (
    <div className="max-w-lg mx-auto mt-12 px-4">
      <div className="bg-white shadow rounded-lg p-8">
        <div className="flex items-center gap-4 mb-6">
          <div className="w-16 h-16 rounded-full bg-blue-600 flex items-center justify-center text-white text-2xl font-bold">
            {profile.displayName?.[0]?.toUpperCase() ?? "?"}
          </div>
          <div>
            <h2 className="text-xl font-bold text-gray-800">{profile.displayName}</h2>
            <p className="text-sm text-gray-500">{profile.email || "No email on file"}</p>
          </div>
        </div>

        <dl className="divide-y divide-gray-100 text-sm">
          <Row label="Username" value={profile.username} />
          <Row label="First Name" value={profile.givenName} />
          <Row label="Last Name" value={profile.surname} />
          <Row label="Department" value={profile.department || "—"} />
          <Row label="Role" value={profile.isAdmin ? "Administrator" : "User"} />
          <Row
            label="Groups"
            value={profile.groups?.length ? profile.groups.join(", ") : "—"}
          />
        </dl>
      </div>
    </div>
  );
}

function Row({ label, value }) {
  return (
    <div className="py-3 flex justify-between">
      <dt className="font-medium text-gray-500">{label}</dt>
      <dd className="text-gray-800">{value}</dd>
    </div>
  );
}
