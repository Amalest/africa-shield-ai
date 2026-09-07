import { useState } from "react";
import AdminAccess from "./AdminAccess";
import AdminCommandCenter from "./AdminCommandCenter";

function AdminPortal() {
  const [isAuthenticated, setIsAuthenticated] = useState(
    () => Boolean(localStorage.getItem("afrishield_admin_token"))
  );

  const handleAuthenticated = () => {
    setIsAuthenticated(true);
  };

  if (!isAuthenticated) {
    return (
      <AdminAccess
        onAuthenticated={handleAuthenticated}
      />
    );
  }

  return <AdminCommandCenter />;
}

export default AdminPortal;