import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import { api, ApiError } from './lib/api';
import { useLocalStorage } from './lib/hooks';
import { Shell } from './components/Shell';
import { ToastHost, Spinner } from './components/ui';
import { Login } from './pages/Login';
import { Setup } from './pages/Setup';
import { Today } from './pages/Today';
import { Tasks } from './pages/Tasks';
import { Board } from './pages/Board';
import { CalendarPage } from './pages/Calendar';
import { Maintenance } from './pages/Maintenance';
import { Assets, AssetDetail } from './pages/Assets';
import { Projects, ProjectDetail } from './pages/Projects';
import { Budget } from './pages/Budget';
import { Food } from './pages/Food';
import { Storage } from './pages/Storage';
import { Tools } from './pages/Tools';
import { Pets, PetDetail, CareSheet } from './pages/Pets';
import { Contacts } from './pages/Contacts';
import { Documents } from './pages/Documents';
import { Settings } from './pages/Settings';
import { Scan } from './pages/Scan';
import { WeeklyReview } from './pages/WeeklyReview';

export interface Session {
  setupComplete: boolean;
  user: { id: string; displayName: string; username: string; role: string; scope: string } | null;
  household: { id: string; name: string; timezone: string; currency: string; locale: string; unitSystem: string } | null;
}

interface AppState extends Session {
  reload: () => Promise<void>;
  currency: string;
  today: string;
  theme: 'light' | 'dark' | 'system';
  setTheme: (t: 'light' | 'dark' | 'system') => void;
}

const Ctx = createContext<AppState | null>(null);
export function useApp(): AppState {
  const value = useContext(Ctx);
  if (!value) throw new Error('useApp outside the provider');
  return value;
}

function useTheme(): ['light' | 'dark' | 'system', (t: 'light' | 'dark' | 'system') => void] {
  const [theme, setTheme] = useLocalStorage<'light' | 'dark' | 'system'>('homestead.theme', 'system');
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const dark = theme === 'dark' || (theme === 'system' && media.matches);
      document.documentElement.classList.toggle('dark', dark);
    };
    apply();
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [theme]);
  return [theme, setTheme];
}

export function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [theme, setTheme] = useTheme();

  const reload = useCallback(async () => {
    try {
      setSession(await api.get<Session>('/auth/status'));
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setSession({ setupComplete: true, user: null, household: null });
      } else throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  if (loading || !session) {
    return <div className="h-full grid place-items-center"><Spinner label="Starting Homestead" /></div>;
  }

  const state: AppState = {
    ...session,
    reload,
    currency: session.household?.currency ?? 'USD',
    today: new Date().toISOString().slice(0, 10),
    theme, setTheme,
  };

  return (
    <Ctx.Provider value={state}>
      <ToastHost>
        {!session.setupComplete ? (
          <Setup />
        ) : !session.user ? (
          <Login />
        ) : (
          <Shell>
            <Routes>
              <Route path="/" element={<Today />} />
              <Route path="/review" element={<WeeklyReview />} />
              <Route path="/tasks" element={<Tasks />} />
              <Route path="/tasks/board" element={<Board />} />
              <Route path="/tasks/calendar" element={<CalendarPage />} />
              <Route path="/maintenance" element={<Maintenance />} />
              <Route path="/assets" element={<Assets />} />
              <Route path="/assets/:id" element={<AssetDetail />} />
              <Route path="/projects" element={<Projects />} />
              <Route path="/projects/:id" element={<ProjectDetail />} />
              <Route path="/budget/*" element={<Budget />} />
              <Route path="/food/*" element={<Food />} />
              <Route path="/storage/*" element={<Storage />} />
              <Route path="/tools/*" element={<Tools />} />
              <Route path="/pets" element={<Pets />} />
              <Route path="/pets/:id" element={<PetDetail />} />
              <Route path="/pets/:id/care-sheet" element={<CareSheet />} />
              <Route path="/contacts/*" element={<Contacts />} />
              <Route path="/documents" element={<Documents />} />
              <Route path="/settings/*" element={<Settings />} />
              <Route path="/scan" element={<Scan />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Shell>
        )}
      </ToastHost>
    </Ctx.Provider>
  );
}

/** Used by pages that need to send the user somewhere after an action. */
export function useGo() {
  const navigate = useNavigate();
  return useCallback((to: string) => navigate(to), [navigate]);
}

export type { ReactNode };
