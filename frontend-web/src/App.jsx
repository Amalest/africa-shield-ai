import { BrowserRouter, Routes, Route } from "react-router-dom";
import AppLayout from "./components/AppLayout";

import AdminPortal from "./pages/AdminPortal";

import Dashboard from "./pages/Dashboard";
import LiveFloodMap from "./pages/LiveFloodMap";
import Alerts from "./pages/Alerts";
import Regions from "./pages/Regions";
import Analytics from "./pages/Analytics";
import Reports from "./pages/Reports";
import Settings from "./pages/Settings";
import HelpSupport from "./pages/HelpSupport";

function App() {
  return (
    <BrowserRouter>
      <Routes>

        {/* Shared application layout */}
        <Route element={<AppLayout />}>

          {/* Main Dashboard */}
          <Route path="/" element={<Dashboard />} />

          {/* Flood Map */}
          <Route path="/map" element={<LiveFloodMap />} />

          {/* Alerts */}
          <Route path="/alerts" element={<Alerts />} />

          {/* Regions */}
          <Route path="/regions" element={<Regions />} />

          {/* Analytics */}
          <Route path="/analytics" element={<Analytics />} />

          {/* Community Reports */}
          <Route path="/reports" element={<Reports />} />

          {/* Admin Command Center + Authentication */}
          <Route
            path="/admin"
            element={<AdminPortal />}
          />

          {/* Settings */}
          <Route path="/settings" element={<Settings />} />

          {/* Help & Support */}
          <Route path="/help" element={<HelpSupport />} />

        </Route>

      </Routes>
    </BrowserRouter>
  );
}

export default App;