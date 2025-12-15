import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
import "../styles/Login.css";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  async function signIn() {
    setErr(null); setMsg(null); setLoading(true);
    
    // Debug: Log session before sign-in
    const sessionBefore = await supabase.auth.getSession();
    console.log("[Login] Session BEFORE sign-in:", sessionBefore);
    
    // Attempt sign-in
    const result = await supabase.auth.signInWithPassword({ email, password });
    console.log("[Login] signInWithPassword FULL result:", result);
    
    // Debug: Log session after sign-in
    const sessionAfter = await supabase.auth.getSession();
    console.log("[Login] Session AFTER sign-in:", sessionAfter);
    
    setLoading(false);
    
    if (result.error) {
      console.error("[Login] Sign-in ERROR:", result.error.message);
      setErr(result.error.message);
      return;
    }
    
    // Success - navigate to search page
    if (result.data.session) {
      console.log("[Login] Sign-in SUCCESS, navigating to /search...");
      navigate("/search");
    } else {
      console.warn("[Login] No session returned despite no error");
    }
  }

  async function signUp() {
    setErr(null); setMsg(null); setLoading(true);
    const { error } = await supabase.auth.signUp({ email, password });
    setLoading(false);
    if (error) return setErr(error.message);
    setMsg("Account created. You can sign in now.");
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <h1>NFO Asset<br />Verification</h1>

        {err && <div className="error">{err}</div>}
        {msg && <div className="success">{msg}</div>}

        <label>Email</label>
        <input
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="your@email.com"
          type="email"
        />

        <label>Password</label>
        <input
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="••••••••"
          type="password"
        />

        <button onClick={signIn} disabled={loading || !email || !password}>
          {loading ? "Please wait..." : "Sign In"}
        </button>

        <div style={{ display: "flex", marginTop: 12, justifyContent: "center" }}>
          <button className="secondary" onClick={signUp} disabled={loading || !email || !password}>
            Create account
          </button>
        </div>
      </div>
    </div>
  );
}
