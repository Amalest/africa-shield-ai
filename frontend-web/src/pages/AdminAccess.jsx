import { useState } from "react";
import {
  ArrowRight,
  CheckCircle2,
  Eye,
  EyeOff,
  LockKeyhole,
  ShieldCheck,
  UserPlus,
} from "lucide-react";

const ADMIN_API_BASE_URL = "http://localhost:8000/api/admin";

function AdminAccess({ onAuthenticated }) {
  const [mode, setMode] = useState("welcome");

  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const [signupForm, setSignupForm] = useState({
    fullName: "",
    email: "",
    password: "",
    confirmPassword: "",
  });

  const [loginForm, setLoginForm] = useState({
    email: "",
    password: "",
  });

  const getApiError = (data, fallbackMessage) => {
    if (!data) return fallbackMessage;

    if (typeof data.detail === "string") {
      return data.detail;
    }

    if (Array.isArray(data.detail)) {
      return data.detail
        .map((item) => item?.msg || "Invalid request")
        .join(", ");
    }

    if (typeof data.message === "string") {
      return data.message;
    }

    return fallbackMessage;
  };

  const handleSignupChange = (event) => {
    const { name, value } = event.target;

    setSignupForm((previous) => ({
      ...previous,
      [name]: value,
    }));

    setError("");
    setSuccess("");
  };

  const handleLoginChange = (event) => {
    const { name, value } = event.target;

    setLoginForm((previous) => ({
      ...previous,
      [name]: value,
    }));

    setError("");
    setSuccess("");
  };

  const openSignup = () => {
    setMode("signup");
    setError("");
    setSuccess("");
  };

  const openLogin = () => {
    setMode("login");
    setError("");
    setSuccess("");
  };

  const handleSignup = async (event) => {
    event.preventDefault();

    setError("");
    setSuccess("");

    const name = signupForm.fullName.trim();
    const email = signupForm.email.trim();
    const password = signupForm.password;
    const confirmPassword = signupForm.confirmPassword;

    if (!name || !email || !password || !confirmPassword) {
      setError("Please complete all fields.");
      return;
    }

    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }

    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    try {
      setLoading(true);

      const response = await fetch(
        `${ADMIN_API_BASE_URL}/signup`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            name,
            email,
            password,
          }),
        }
      );

      const data = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(
          getApiError(
            data,
            "Unable to create your admin account."
          )
        );
      }

      /*
       * The backend returns a token after signup.
       * We intentionally do NOT store it here because
       * your desired flow is:
       *
       * SIGN UP → LOGIN → COMMAND CENTER
       *
       * The user will authenticate properly through login.
       */

      setLoginForm({
        email,
        password: "",
      });

      setSignupForm({
        fullName: "",
        email: "",
        password: "",
        confirmPassword: "",
      });

      setSuccess(
        "Account created successfully. Please log in to continue."
      );

      setMode("login");
    } catch (err) {
      setError(
        err.message ||
          "Unable to connect to the admin authentication service."
      );
    } finally {
      setLoading(false);
    }
  };

  const handleLogin = async (event) => {
    event.preventDefault();

    setError("");
    setSuccess("");

    const email = loginForm.email.trim();
    const password = loginForm.password;

    if (!email || !password) {
      setError("Please enter your email and password.");
      return;
    }

    try {
      setLoading(true);

      const response = await fetch(
        `${ADMIN_API_BASE_URL}/login`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            email,
            password,
          }),
        }
      );

      const data = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(
          getApiError(
            data,
            "Invalid email or password."
          )
        );
      }

      if (!data?.token) {
        throw new Error(
          "Login succeeded, but no authentication token was returned."
        );
      }

      /*
       * Store the real backend token.
       * Do NOT store the admin password.
       */
      localStorage.setItem(
        "afrishield_admin_token",
        data.token
      );

      if (data.admin) {
        localStorage.setItem(
          "afrishield_admin_user",
          JSON.stringify(data.admin)
        );
      }

      /*
       * Remove the old temporary authentication values.
       */
      localStorage.removeItem(
        "afrishield_admin_logged_in"
      );

      localStorage.removeItem(
        "afrishield_admin_account"
      );

      /*
       * Tell AdminPortal that authentication succeeded.
       */
      onAuthenticated(data.token);
    } catch (err) {
      setError(
        err.message ||
          "Unable to connect to the admin authentication service."
      );
    } finally {
      setLoading(false);
    }
  };

  const inputClass =
    "w-full rounded-xl border border-slate-200 bg-white px-4 py-3.5 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10";

  const primaryButtonClass =
    "flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 py-3.5 text-sm font-bold text-white shadow-lg shadow-blue-600/20 transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60";

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="flex min-h-screen">
        {/* LEFT SIDE */}
        <div className="hidden w-1/2 flex-col justify-between bg-blue-700 p-12 text-white lg:flex">
          <div>
            <div className="mb-10 flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/15">
                <ShieldCheck size={25} />
              </div>

              <div>
                <p className="text-lg font-black">
                  AfriShield AI
                </p>
                <p className="text-xs font-medium text-blue-100">
                  Admin Command Center
                </p>
              </div>
            </div>

            <div className="max-w-lg">
              <p className="mb-4 text-sm font-bold uppercase tracking-[0.2em] text-blue-100">
                EARLY WARNING
              </p>

              <h1 className="text-5xl font-black leading-tight">
                Protect communities.
                <br />
                Respond faster.
              </h1>

              <p className="mt-6 text-lg leading-8 text-blue-100">
                Manage flood incidents, verify community
                reports, coordinate emergency assistance,
                and deliver last-mile warnings from one
                command center.
              </p>
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/10 p-5 backdrop-blur-sm">
            <div className="flex items-center gap-3">
              <CheckCircle2 size={20} />

              <div>
                <p className="text-sm font-bold">
                  Secure administrative access
                </p>

                <p className="mt-1 text-xs text-blue-100">
                  Authorized personnel only
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* RIGHT SIDE */}
        <div className="flex flex-1 items-center justify-center px-6 py-10 sm:px-10">
          <div className="w-full max-w-md">
            {/* MOBILE BRAND */}
            <div className="mb-8 flex items-center gap-3 lg:hidden">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-blue-600 text-white">
                <ShieldCheck size={24} />
              </div>

              <div>
                <p className="font-black text-slate-900">
                  AfriShield AI
                </p>

                <p className="text-xs text-slate-500">
                  Admin Command Center
                </p>
              </div>
            </div>

            {/* WELCOME */}
            {mode === "welcome" && (
              <div>
                <div className="mb-8">
                  <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-50 text-blue-600">
                    <LockKeyhole size={27} />
                  </div>

                  <p className="mb-2 text-sm font-bold uppercase tracking-wider text-blue-600">
                    ADMIN ACCESS
                  </p>

                  <h2 className="text-3xl font-black text-slate-900">
                    Welcome back
                  </h2>

                  <p className="mt-3 leading-7 text-slate-500">
                    Access the AfriShield AI Command Center
                    to monitor incidents and coordinate
                    emergency response.
                  </p>
                </div>

                <div className="space-y-3">
                  <button
                    type="button"
                    onClick={openLogin}
                    className={primaryButtonClass}
                  >
                    Login
                    <ArrowRight size={18} />
                  </button>

                  <button
                    type="button"
                    onClick={openSignup}
                    className="flex w-full items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-5 py-3.5 text-sm font-bold text-slate-700 transition hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700"
                  >
                    <UserPlus size={18} />
                    Sign Up
                  </button>
                </div>
              </div>
            )}

            {/* SIGN UP */}
            {mode === "signup" && (
              <div>
                <div className="mb-7">
                  <p className="mb-2 text-sm font-bold uppercase tracking-wider text-blue-600">
                    ADMIN REGISTRATION
                  </p>

                  <h2 className="text-3xl font-black text-slate-900">
                    Create your account
                  </h2>

                  <p className="mt-2 text-sm leading-6 text-slate-500">
                    Create an authorized account for the
                    AfriShield Command Center.
                  </p>
                </div>

                {error && (
                  <div className="mb-5 rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
                    {error}
                  </div>
                )}

                {success && (
                  <div className="mb-5 rounded-xl border border-green-100 bg-green-50 px-4 py-3 text-sm font-medium text-green-700">
                    {success}
                  </div>
                )}

                <form
                  onSubmit={handleSignup}
                  className="space-y-4"
                >
                  <div>
                    <label className="mb-2 block text-sm font-bold text-slate-700">
                      Full Name
                    </label>

                    <input
                      type="text"
                      name="fullName"
                      value={signupForm.fullName}
                      onChange={handleSignupChange}
                      placeholder="Enter your full name"
                      className={inputClass}
                      autoComplete="name"
                    />
                  </div>

                  <div>
                    <label className="mb-2 block text-sm font-bold text-slate-700">
                      Email Address
                    </label>

                    <input
                      type="email"
                      name="email"
                      value={signupForm.email}
                      onChange={handleSignupChange}
                      placeholder="admin@example.com"
                      className={inputClass}
                      autoComplete="email"
                    />
                  </div>

                  <div>
                    <label className="mb-2 block text-sm font-bold text-slate-700">
                      Password
                    </label>

                    <div className="relative">
                      <input
                        type={
                          showPassword
                            ? "text"
                            : "password"
                        }
                        name="password"
                        value={signupForm.password}
                        onChange={handleSignupChange}
                        placeholder="Minimum 8 characters"
                        className={`${inputClass} pr-12`}
                        autoComplete="new-password"
                      />

                      <button
                        type="button"
                        onClick={() =>
                          setShowPassword(
                            (previous) => !previous
                          )
                        }
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700"
                      >
                        {showPassword ? (
                          <EyeOff size={19} />
                        ) : (
                          <Eye size={19} />
                        )}
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="mb-2 block text-sm font-bold text-slate-700">
                      Confirm Password
                    </label>

                    <div className="relative">
                      <input
                        type={
                          showConfirmPassword
                            ? "text"
                            : "password"
                        }
                        name="confirmPassword"
                        value={
                          signupForm.confirmPassword
                        }
                        onChange={handleSignupChange}
                        placeholder="Confirm your password"
                        className={`${inputClass} pr-12`}
                        autoComplete="new-password"
                      />

                      <button
                        type="button"
                        onClick={() =>
                          setShowConfirmPassword(
                            (previous) => !previous
                          )
                        }
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700"
                      >
                        {showConfirmPassword ? (
                          <EyeOff size={19} />
                        ) : (
                          <Eye size={19} />
                        )}
                      </button>
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={loading}
                    className={`${primaryButtonClass} mt-2`}
                  >
                    {loading
                      ? "Creating account..."
                      : "Create Admin Account"}

                    {!loading && (
                      <ArrowRight size={18} />
                    )}
                  </button>
                </form>

                <div className="mt-6 text-center">
                  <button
                    type="button"
                    onClick={openLogin}
                    className="text-sm font-bold text-blue-600 hover:text-blue-700"
                  >
                    Already have an account? Login
                  </button>
                </div>
              </div>
            )}

            {/* LOGIN */}
            {mode === "login" && (
              <div>
                <div className="mb-7">
                  <p className="mb-2 text-sm font-bold uppercase tracking-wider text-blue-600">
                    ADMIN LOGIN
                  </p>

                  <h2 className="text-3xl font-black text-slate-900">
                    Sign in to Command Center
                  </h2>

                  <p className="mt-2 text-sm leading-6 text-slate-500">
                    Enter your administrator credentials
                    to continue.
                  </p>
                </div>

                {error && (
                  <div className="mb-5 rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
                    {error}
                  </div>
                )}

                {success && (
                  <div className="mb-5 rounded-xl border border-green-100 bg-green-50 px-4 py-3 text-sm font-medium text-green-700">
                    {success}
                  </div>
                )}

                <form
                  onSubmit={handleLogin}
                  className="space-y-5"
                >
                  <div>
                    <label className="mb-2 block text-sm font-bold text-slate-700">
                      Email Address
                    </label>

                    <input
                      type="email"
                      name="email"
                      value={loginForm.email}
                      onChange={handleLoginChange}
                      placeholder="admin@example.com"
                      className={inputClass}
                      autoComplete="email"
                    />
                  </div>

                  <div>
                    <div className="mb-2 flex items-center justify-between">
                      <label className="block text-sm font-bold text-slate-700">
                        Password
                      </label>
                    </div>

                    <div className="relative">
                      <input
                        type={
                          showPassword
                            ? "text"
                            : "password"
                        }
                        name="password"
                        value={loginForm.password}
                        onChange={handleLoginChange}
                        placeholder="Enter your password"
                        className={`${inputClass} pr-12`}
                        autoComplete="current-password"
                      />

                      <button
                        type="button"
                        onClick={() =>
                          setShowPassword(
                            (previous) => !previous
                          )
                        }
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700"
                      >
                        {showPassword ? (
                          <EyeOff size={19} />
                        ) : (
                          <Eye size={19} />
                        )}
                      </button>
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={loading}
                    className={primaryButtonClass}
                  >
                    {loading
                      ? "Signing in..."
                      : "Login"}

                    {!loading && (
                      <ArrowRight size={18} />
                    )}
                  </button>
                </form>

                <div className="mt-6 flex flex-col items-center gap-2 text-center">
                  <button
                    type="button"
                    onClick={openSignup}
                    className="text-sm font-bold text-blue-600 hover:text-blue-700"
                  >
                    Don't have an account? Sign Up
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setMode("welcome");
                      setError("");
                      setSuccess("");
                    }}
                    className="text-xs font-semibold text-slate-400 hover:text-slate-600"
                  >
                    Back to Admin Access
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default AdminAccess;