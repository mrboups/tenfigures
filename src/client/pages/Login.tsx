import { FormEvent, useState } from "react";
import { api } from "../api.ts";

export function LoginPage({ onLoggedIn }: { onLoggedIn: (name: string) => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api.login(username, password);
      onLoggedIn(username);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={onSubmit}>
        <h1>
          Ten<span>Figures</span>
        </h1>
        <p>Sign in to place and manage live exchange orders.</p>
        <div className="field">
          <label htmlFor="user">Username</label>
          <input
            id="user"
            autoComplete="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="pass">Password</label>
          <input
            id="pass"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        {error && <div className="err">{error}</div>}
        <div style={{ height: 12 }} />
        <button className="primary" disabled={busy || !username || !password}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}
