import { useState } from 'react';
import { api, ApiError } from '../lib/api';
import { useApp } from '../App';
import { Field } from '../components/ui';
import { Icon } from '../components/Icon';

const TIMEZONES = (() => {
  try { return (Intl as any).supportedValuesOf?.('timeZone') as string[] ?? []; } catch { return []; }
})();

/** First run: name the household, make the admin, and get out of the way (UX-011). */
export function Setup() {
  const { reload } = useApp();
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const guessedZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

  const set = (k: string, v: string) => setFields((f) => ({ ...f, [k]: v }));
  const value = (k: string, fallback = '') => fields[k] ?? fallback;

  const submit = async () => {
    setBusy(true); setError(null);
    try {
      await api.post('/auth/setup', {
        household: {
          name: value('householdName'),
          timezone: value('timezone', guessedZone),
          currency: value('currency', 'USD').toUpperCase(),
          unitSystem: value('unitSystem', 'imperial'),
        },
        admin: {
          displayName: value('displayName'),
          username: value('username'),
          email: value('email'),
          password: value('password'),
        },
      });
      await reload();
    } catch (err) {
      setError(err instanceof ApiError
        ? Object.values(err.errors ?? {})[0]?.[0] ?? err.detail ?? err.title
        : (err as Error).message);
      setBusy(false);
    }
  };

  const stepOneValid = value('householdName').trim().length > 0;
  const stepTwoValid = value('displayName').trim() && value('username').trim().length >= 2
    && /.+@.+\..+/.test(value('email')) && value('password').length >= 8;

  return (
    <div className="min-h-full grid place-items-center p-4">
      <div className="panel p-6 w-full max-w-md">
        <div className="flex items-center gap-2 mb-1">
          <span className="w-9 h-9 rounded-xl grid place-items-center text-white" style={{ background: 'var(--accent)' }}>
            <Icon name="home" size={19} />
          </span>
          <h1 className="font-semibold">Set up Homestead</h1>
        </div>
        <p className="text-sm dim mb-5">
          {step === 0 ? 'Two steps. Nothing leaves this server.' : 'Now the account you will sign in with.'}
        </p>

        {step === 0 ? (
          <>
            <Field label="Household name" hint="Whatever you call the place. You can change it later.">
              <input className="input" autoFocus value={value('householdName')}
                     placeholder="Wild House" onChange={(e) => set('householdName', e.target.value)} />
            </Field>
            <Field label="Timezone" hint="Reminders fire on this clock.">
              {TIMEZONES.length ? (
                <select className="select" value={value('timezone', guessedZone)}
                        onChange={(e) => set('timezone', e.target.value)}>
                  {TIMEZONES.map((tz) => <option key={tz} value={tz}>{tz}</option>)}
                </select>
              ) : (
                <input className="input" value={value('timezone', guessedZone)}
                       onChange={(e) => set('timezone', e.target.value)} />
              )}
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Currency">
                <input className="input" maxLength={3} value={value('currency', 'USD')}
                       onChange={(e) => set('currency', e.target.value.toUpperCase())} />
              </Field>
              <Field label="Units">
                <select className="select" value={value('unitSystem', 'imperial')}
                        onChange={(e) => set('unitSystem', e.target.value)}>
                  <option value="imperial">Imperial</option>
                  <option value="metric">Metric</option>
                </select>
              </Field>
            </div>
            <button className="btn btn-primary w-full mt-2" disabled={!stepOneValid} onClick={() => setStep(1)}>
              Continue
            </button>
          </>
        ) : (
          <>
            <Field label="Your name">
              <input className="input" autoFocus value={value('displayName')}
                     onChange={(e) => set('displayName', e.target.value)} />
            </Field>
            <Field label="Username">
              <input className="input" autoComplete="username" value={value('username')}
                     onChange={(e) => set('username', e.target.value)} />
            </Field>
            <Field label="Email">
              <input className="input" type="email" autoComplete="email" value={value('email')}
                     onChange={(e) => set('email', e.target.value)} />
            </Field>
            <Field label="Password" hint="At least 8 characters.">
              <input className="input" type="password" autoComplete="new-password" value={value('password')}
                     onChange={(e) => set('password', e.target.value)} />
            </Field>
            {error && <p className="text-sm text-red-600 dark:text-red-400 mb-3">{error}</p>}
            <div className="flex gap-2">
              <button className="btn" onClick={() => setStep(0)}>Back</button>
              <button className="btn btn-primary flex-1" disabled={busy || !stepTwoValid} onClick={submit}>
                {busy ? 'Creating…' : 'Create household'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
