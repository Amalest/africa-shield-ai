import { useState } from "react";
import AdminAccess from "./AdminAccess";
import AdminCommandCenter from "./AdminCommandCenter";

function AdminPortal() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  return isAuthenticated ? (
    <AdminCommandCenter onLoggedOut={() => setIsAuthenticated(false)} />
  ) : (
    <AdminAccess onAuthenticated={() => setIsAuthenticated(true)} />
  );
}

export default AdminPortal;
