import { useState } from "react";
import AdminAccess from "./AdminAccess";
import AdminCommandCenter from "./AdminCommandCenter";

function AdminPortal() {
  // Authentication is intentionally session-based in the React app.
  // Visiting /admin starts at the secure access screen instead of
  // automatically opening the Command Center from an old localStorage flag.
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  const handleAuthenticated = () => {
    setIsAuthenticated(true);
  };

  if (!isAuthenticated) {
    return <AdminAccess onAuthenticated={handleAuthenticated} />;
  }

  return <AdminCommandCenter />;
}

export default AdminPortal;
