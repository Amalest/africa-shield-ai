import { useState } from "react";
import { ArrowRight, CheckCircle2, Eye, EyeOff, LockKeyhole, ShieldCheck } from "lucide-react";

const ADMIN_API_BASE_URL = "http://localhost:8000/api/admin";

function AdminAccess({ onAuthenticated }) {
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState({ email: "", password: "" });

  const getApiError = (data) => {
    if (!data) return "Unable to connect to the admin authentication service.";
    if (typeof data.detail === "string") return data.detail;
    if (Array.isArray(data.detail)) return data.detail.map((item) => item?.msg || "Invalid request").join(", ");
    return data.message || "Unable to sign in.";
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError("");
    const email = form.email.trim();
    if (!email || !form.password) {
      setError("Please enter your email and password.");
      return;
    }

    try {
      setLoading(true);
      const response = await fetch(`${ADMIN_API_BASE_URL}/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password: form.password }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(getApiError(data));
      if (!data?.token) throw new Error("Login succeeded, but no authentication token was returned.");

      localStorage.setItem("afrishield_admin_token", data.token);
      if (data.admin) localStorage.setItem("afrishield_admin_user", JSON.stringify(data.admin));
      localStorage.removeItem("afrishield_admin_logged_in");
      localStorage.removeItem("afrishield_admin_account");
      onAuthenticated(data.token);
    } catch (err) {
      setError(err.message || "Unable to sign in.");
    } finally {
      setLoading(false);
    }
  };

  const inputClass = "w-full rounded-xl border border-slate-200 bg-white px-4 py-3.5 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10";
  const primaryButtonClass = "flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 py-3.5 text-sm font-bold text-white shadow-lg shadow-blue-600/20 transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60";

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="flex min-h-screen">
        <div className="hidden w-1/2 flex-col justify-between bg-blue-700 p-12 text-white lg:flex">
          <div>
            <div className="mb-10 flex items-center gap-3"><div className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/15"><ShieldCheck size={25}/></div><div><p className="text-lg font-black">AfriShield AI</p><p className="text-xs font-medium text-blue-100">Admin Command Center</p></div></div>
            <div className="max-w-lg"><p className="mb-4 text-sm font-bold uppercase tracking-[0.2em] text-blue-100">EARLY WARNING</p><h1 className="text-5xl font-black leading-tight">Protect communities.<br/>Respond faster.</h1><p className="mt-6 text-lg leading-8 text-blue-100">Manage flood incidents, review AI-generated alerts, inspect sensor health, coordinate emergency assistance, and deliver last-mile warnings from one secure command center.</p></div>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/10 p-5 backdrop-blur-sm"><div className="flex items-center gap-3"><CheckCircle2 size={20}/><div><p className="text-sm font-bold">Secure administrative access</p><p className="mt-1 text-xs text-blue-100">Authorized personnel only</p></div></div></div>
        </div>
        <div className="flex flex-1 items-center justify-center px-6 py-10 sm:px-10"><div className="w-full max-w-md">
          <div className="mb-8 flex items-center gap-3 lg:hidden"><div className="flex h-11 w-11 items-center justify-center rounded-xl bg-blue-600 text-white"><ShieldCheck size={24}/></div><div><p className="font-black text-slate-900">AfriShield AI</p><p className="text-xs text-slate-500">Admin Command Center</p></div></div>
          <div className="mb-8"><div className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-50 text-blue-600"><LockKeyhole size={27}/></div><p className="mb-2 text-sm font-bold uppercase tracking-wider text-blue-600">ADMIN ACCESS</p><h2 className="text-3xl font-black text-slate-900">Sign in to Command Center</h2><p className="mt-3 leading-7 text-slate-500">Use your authorized administrator account to access emergency operations.</p></div>
          {error && <div className="mb-5 rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">{error}</div>}
          <form onSubmit={handleSubmit} className="space-y-5">
            <div><label className="mb-2 block text-sm font-bold text-slate-700">Email Address</label><input type="email" value={form.email} onChange={(e)=>{setForm({...form,email:e.target.value});setError("")}} placeholder="admin@example.com" className={inputClass} autoComplete="email"/></div>
            <div><label className="mb-2 block text-sm font-bold text-slate-700">Password</label><div className="relative"><input type={showPassword?"text":"password"} value={form.password} onChange={(e)=>{setForm({...form,password:e.target.value});setError("")}} placeholder="Enter your password" className={`${inputClass} pr-12`} autoComplete="current-password"/><button type="button" onClick={()=>setShowPassword((previous)=>!previous)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700">{showPassword?<EyeOff size={19}/>:<Eye size={19}/>}</button></div></div>
            <button type="submit" disabled={loading} className={primaryButtonClass}>{loading?"Signing in...":"Login"}{!loading&&<ArrowRight size={18}/>}</button>
          </form>
          <div className="mt-6 rounded-xl border border-slate-200 bg-white p-4"><p className="text-[10px] font-extrabold uppercase tracking-wide text-slate-500">ACCESS CONTROL UPDATE</p><p className="mt-2 text-xs leading-5 text-slate-500">Public admin signup is disabled. An existing administrator creates new admin accounts from <span className="font-bold text-slate-700">Manage Admins</span> inside the Command Center.</p></div>
        </div></div>
      </div>
    </div>
  );
}

export default AdminAccess;
