import { useState } from 'react';
import { api, ApiError } from '../lib/api';
import { useApp } from '../App';
import { Field } from '../components/ui';
import { Icon } from '../components/Icon';

export function Login() {
  const { reload } = useApp();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      await api.post('/auth/login', { username, password, remember });
      await reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.detail ?? err.title : (err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-full grid place-items-center p-4">
      <form onSubmit={submit} className="panel p-6 w-full max-w-sm">
        <div className="flex items-center gap-2 mb-5">
          <span className="w-9 h-9 rounded-xl grid place-items-center text-white" style={{ background: 'var(--accent)' }}>
            <Icon name="home" size={19} />
          </span>
          <div>
            <h1 className="font-semibold">Homestead</h1>
            <p className="text-xs dim">Sign in to your household</p>
          </div>
        </div>
        <Field label="Username or email">
          <input className="input" autoFocus autoComplete="username" value={username}
                 onChange={(e) => setUsername(e.target.value)} />
        </Field>
        <Field label="Password">
          <input className="input" type="password" autoComplete="current-password" value={password}
                 onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <label className="flex items-center gap-2 text-sm mb-4">
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
          Stay signed in on this device
        </label>
        {error && <p className="text-sm text-red-600 dark:text-red-400 mb-3">{error}</p>}
        <button className="btn btn-primary w-full" disabled={busy || !username || !password}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}
