import { BrowserRouter, Routes, Route, Navigate, Link } from "react-router-dom";
import { AuthProvider, useAuth } from "./context/AuthContext.jsx";
import ProtectedRoute from "./components/ProtectedRoute.jsx";
import AdminRoute from "./components/AdminRoute.jsx";
import LoginPage from "./pages/LoginPage.jsx";
import ProfilePage from "./pages/ProfilePage.jsx";
import ChangePasswordPage from "./pages/ChangePasswordPage.jsx";
import AdminPage from "./pages/AdminPage.jsx";

function NavBar() {
  const { user, isAdmin, logout } = useAuth();
  if (!user) return null;

  return (
    <nav className="bg-blue-700 text-white px-6 py-3 flex items-center justify-between shadow">
      <span className="font-bold text-lg">Corp Portal</span>
      <div className="flex gap-4 items-center text-sm">
        <Link to="/profile" className="hover:underline">Profile</Link>
        <Link to="/change-password" className="hover:underline">Change Password</Link>
        {isAdmin && <Link to="/admin" className="hover:underline font-semibold">Admin</Link>}
        <button
          onClick={logout}
          className="bg-white text-blue-700 px-3 py-1 rounded hover:bg-blue-50 font-medium"
        >
          Logout
        </button>
      </div>
    </nav>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <NavBar />
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/profile" element={<ProtectedRoute><ProfilePage /></ProtectedRoute>} />
          <Route path="/change-password" element={<ProtectedRoute><ChangePasswordPage /></ProtectedRoute>} />
          <Route path="/admin" element={<AdminRoute><AdminPage /></AdminRoute>} />
          <Route path="*" element={<Navigate to="/profile" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
