import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import {
  BrowserRouter,
  Link,
  Navigate,
  NavLink,
  Outlet,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from 'react-router-dom'
import { ApiError, api } from './api'
import type { AuthResponse, GameConfigResponse, MeResponse, RoundResponse } from './types'
import { AdminPages } from './pages/AdminPages'
import { ParticipantPages } from './pages/ParticipantPages'
import './App.css'

const SESSION_KEY = 'deal-with-devil-session'

type Session = AuthResponse
interface AuthContextValue {
  session: Session | null
  user: MeResponse | null
  config: GameConfigResponse | null
  round: RoundResponse | null
  accountError: string
  accountLoading: boolean
  reloadAccount: () => void
  setUser: (user: MeResponse) => void
  refreshUser: () => Promise<void>
  refreshRound: () => Promise<void>
  saveSession: (session: Session) => void
  signOut: () => void
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function useAuth() {
  const value = useContext(AuthContext)
  if (!value) throw new Error('useAuth must be used inside the app')
  return value
}

let googleScriptLoad: Promise<void> | null = null

function loadGoogleIdentity(): Promise<void> {
  if (window.google) return Promise.resolve()
  if (googleScriptLoad) return googleScriptLoad
  googleScriptLoad = new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = 'https://accounts.google.com/gsi/client'
    script.async = true
    script.defer = true
    script.onload = () => resolve()
    script.onerror = () => reject(new Error('Google sign-in could not load. Check your connection and try again.'))
    document.head.appendChild(script)
  })
  return googleScriptLoad
}

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (options: {
            client_id: string
            callback: (response: { credential: string }) => void
          }) => void
          renderButton: (
            element: HTMLElement,
            options: { theme: string; size: string; shape: string; width: number },
          ) => void
        }
      }
    }
  }
}

function readSession(): Session | null {
  const stored = sessionStorage.getItem(SESSION_KEY)
  if (!stored) return null
  try {
    const session = JSON.parse(stored) as Session
    if (Date.parse(session.expiresAt) > Date.now()) return session
    sessionStorage.removeItem(SESSION_KEY)
    return null
  } catch {
    sessionStorage.removeItem(SESSION_KEY)
    return null
  }
}

function App() {
  const [session, setSession] = useState<Session | null>(() => readSession())
  const [user, setUser] = useState<MeResponse | null>(null)
  const [config, setConfig] = useState<GameConfigResponse | null>(null)
  const [round, setRound] = useState<RoundResponse | null>(null)
  const [accountError, setAccountError] = useState('')
  const [accountLoading, setAccountLoading] = useState(false)
  const [accountRetry, setAccountRetry] = useState(0)

  const signOut = useCallback(() => {
    sessionStorage.removeItem(SESSION_KEY)
    setSession(null)
    setUser(null)
    setConfig(null)
    setRound(null)
  }, [])

  const saveSession = useCallback((next: Session) => {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(next))
    setSession(next)
  }, [])

  const refreshUser = useCallback(async () => {
    if (!session) return
    const result = await api<MeResponse>('/api/me', {}, session.token)
    setUser(result)
  }, [session])

  const refreshRound = useCallback(async () => {
    if (!session) return
    try {
      const result = await api<RoundResponse>('/api/rounds/current', {}, session.token)
      setRound(result)
    } catch (error) {
      if (error instanceof ApiError && error.code === 'ROUND_NOT_FOUND') {
        setRound(null)
        return
      }
      throw error
    }
  }, [session])

  const reloadAccount = useCallback(() => setAccountRetry((value) => value + 1), [])

  useEffect(() => {
    if (!session) return
    let disposed = false
    const token = session.token
    setAccountLoading(true)
    setAccountError('')

    async function loadAccount() {
      try {
        const [me, gameConfig] = await Promise.all([
          api<MeResponse>('/api/me', {}, token),
          api<GameConfigResponse>('/api/config', {}, token),
        ])
        if (!disposed) {
          setUser(me)
          setConfig(gameConfig)
        }
        try {
          const current = await api<RoundResponse>('/api/rounds/current', {}, token)
          if (!disposed) setRound(current)
        } catch (error) {
          if (error instanceof ApiError && error.code === 'ROUND_NOT_FOUND') {
            if (!disposed) setRound(null)
          } else {
            throw error
          }
        }
        if (!disposed) setAccountError('')
      } catch (error) {
        if (disposed) return
        if (error instanceof ApiError && error.status === 401) {
          signOut()
        } else {
          setAccountError(error instanceof Error ? error.message : 'Could not load your account.')
        }
      } finally {
        if (!disposed) setAccountLoading(false)
      }
    }
    void loadAccount()
    return () => {
      disposed = true
    }
  }, [session, signOut, accountRetry])

  useEffect(() => {
    if (!session) return
    const expiresIn = Date.parse(session.expiresAt) - Date.now()
    const refreshIn = Math.max(0, expiresIn - 15 * 60 * 1000)
    const timer = window.setTimeout(() => {
      void api<AuthResponse>('/api/auth/refresh', { method: 'POST' }, session.token)
        .then(saveSession)
        .catch((error: unknown) => {
          if (error instanceof ApiError && error.status === 401) signOut()
        })
    }, refreshIn)
    return () => window.clearTimeout(timer)
  }, [session, saveSession, signOut])

  useEffect(() => {
    if (!session) return
    const onExpired = () => signOut()
    window.addEventListener('auth:expired', onExpired)
    return () => window.removeEventListener('auth:expired', onExpired)
  }, [session, signOut])

  const context = useMemo<AuthContextValue>(() => ({
    session,
    user,
    config,
    round,
    accountError,
    accountLoading,
    reloadAccount,
    setUser,
    refreshUser,
    refreshRound,
    saveSession,
    signOut,
  }), [session, user, config, round, accountError, accountLoading, reloadAccount, refreshUser, refreshRound, saveSession, signOut])

  return (
    <BrowserRouter>
      <AuthContext.Provider value={context}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/profile" element={<Protected><ProfilePage /></Protected>} />
          <Route path="/app" element={<Protected role="PARTICIPANT"><ParticipantLayout /></Protected>}>
            <Route index element={<ParticipantPages screen="dashboard" />} />
            <Route path="round" element={<ParticipantPages screen="round" />} />
            <Route path="results" element={<ParticipantPages screen="results" />} />
            <Route path="history" element={<ParticipantPages screen="history" />} />
            <Route path="leaderboard" element={<ParticipantPages screen="leaderboard" />} />
            <Route path="rules" element={<ParticipantPages screen="rules" />} />
          </Route>
          <Route path="/admin" element={<Protected role="ADMIN"><AdminLayout /></Protected>}>
            <Route index element={<AdminPages screen="rounds" />} />
            <Route path="problems" element={<AdminPages screen="problems" />} />
            <Route path="participants" element={<AdminPages screen="participants" />} />
            <Route path="ledger" element={<AdminPages screen="ledger" />} />
            <Route path="audit" element={<AdminPages screen="audit" />} />
          </Route>
          <Route path="*" element={<RoleHome />} />
        </Routes>
      </AuthContext.Provider>
    </BrowserRouter>
  )
}

function Protected({ role, children }: { role?: 'ADMIN' | 'PARTICIPANT'; children: React.ReactNode }) {
  const { session, user, accountError, accountLoading, reloadAccount, signOut } = useAuth()
  const location = useLocation()
  if (!session) return <Navigate to="/login" replace state={{ from: location.pathname }} />
  if (accountLoading || !user) {
    if (!accountError) return <main className="center-state"><span className="spinner" /><p>Loading your account…</p></main>
    return <main className="center-state"><div><ErrorMessage message={accountError} />
      <button className="secondary-button" onClick={reloadAccount}>Try again</button>
      <button className="text-button" onClick={signOut}>Sign out</button></div></main>
  }
  if (user.role === 'PARTICIPANT' && !user.profileComplete && location.pathname !== '/profile') {
    return <Navigate to="/profile" replace />
  }
  if (location.pathname === '/profile') return <>{children}</>
  if (role && session.role !== role) return <RoleRedirect />
  return <>{children}</>
}

function RoleRedirect() {
  const { session } = useAuth()
  return <Navigate to={session?.role === 'ADMIN' ? '/admin' : '/app'} replace />
}

function RoleHome() {
  const { session } = useAuth()
  return <Navigate to={session ? (session.role === 'ADMIN' ? '/admin' : '/app') : '/login'} replace />
}

function LoginPage() {
  const { session, saveSession } = useAuth()
  const navigate = useNavigate()
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [showFallback, setShowFallback] = useState(false)
  const [email, setEmail] = useState('')
  const [passcode, setPasscode] = useState('')

  useEffect(() => {
    if (session) navigate(session.role === 'ADMIN' ? '/admin' : '/app', { replace: true })
  }, [session, navigate])

  const login = useCallback(async (path: string, body: unknown) => {
    setLoading(true)
    setError('')
    try {
      const result = await api<AuthResponse>(path, { method: 'POST', body: JSON.stringify(body) })
      saveSession(result)
      navigate(result.profileComplete || result.role === 'ADMIN' ? (result.role === 'ADMIN' ? '/admin' : '/app') : '/profile')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Sign-in failed. Please try again.')
    } finally {
      setLoading(false)
    }
  }, [saveSession, navigate])

  useEffect(() => {
    const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID
    const button = document.getElementById('google-sign-in')
    if (!clientId || !button || showFallback) return
    let active = true
    void loadGoogleIdentity().then(() => {
      if (!active || !window.google) return
      window.google.accounts.id.initialize({
        client_id: clientId,
        callback: (response) => void login('/api/auth/google', { idToken: response.credential }),
      })
      window.google.accounts.id.renderButton(button, {
        theme: 'filled_black',
        size: 'large',
        shape: 'pill',
        width: Math.min(340, button.clientWidth || 340),
      })
    }).catch((cause: unknown) => {
      if (active) setError(cause instanceof Error ? cause.message : 'Google sign-in could not load.')
    })
    return () => { active = false }
  }, [login, showFallback])

  return (
    <main className="auth-layout">
      <section className="auth-card">
        <div className="brand-mark" aria-hidden="true">D</div>
        <p className="eyebrow">THE CONTEST BEGINS</p>
        <h1>Deal with<br /><span>the Devil.</span></h1>
        <p className="intro">Bid smart. Solve hard. Decide what your corruption is worth.</p>
        {!showFallback ? (
          <>
            {!import.meta.env.VITE_GOOGLE_CLIENT_ID && (
              <p className="notice">Set <code>VITE_GOOGLE_CLIENT_ID</code> in <code>frontend/.env.local</code> to enable Google sign-in.</p>
            )}
            <div id="google-sign-in" className="google-button" />
            <button className="text-button fallback-toggle" type="button" onClick={() => { setShowFallback(true); setError('') }}>
              Admin fallback sign-in
            </button>
          </>
        ) : (
          <form className="profile-form" onSubmit={(event) => {
            event.preventDefault()
            void login('/api/auth/admin-fallback', { email: email.trim(), passcode })
          }}>
            <label htmlFor="fallback-email">Admin email</label>
            <input id="fallback-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
            <label htmlFor="fallback-passcode">Passcode</label>
            <input id="fallback-passcode" type="password" required value={passcode} onChange={(e) => setPasscode(e.target.value)} />
            <button className="primary-button" disabled={loading}>{loading ? 'Signing in…' : 'Sign in as admin'}</button>
            <button className="text-button" type="button" onClick={() => { setShowFallback(false); setError('') }}>Back to Google sign-in</button>
          </form>
        )}
        {loading && <p className="muted">Signing you in…</p>}
        {error && <ErrorMessage message={error} />}
        <p className="fine-print">Use the Google account registered for the event.</p>
      </section>
      <aside className="auth-aside">
        <div className="orbit orbit-one" /><div className="orbit orbit-two" />
        <div className="aside-copy">
          <p className="eyebrow">A GAME OF CALCULATED RISK</p>
          <h2>Every bid has<br />a price.</h2>
          <p>Compete for problems. Guard your coins. Choose your bargains carefully.</p>
        </div>
        <span className="aside-index">01 / ENTER THE AUCTION</span>
      </aside>
    </main>
  )
}

function ProfilePage() {
  const { session, user, setUser, signOut } = useAuth()
  const navigate = useNavigate()
  const [name, setName] = useState(user?.name ?? '')
  const [hackerRankId, setHackerRankId] = useState(user?.hackerRankId ?? '')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!session) return
    setBusy(true)
    setError('')
    try {
      const result = await api<MeResponse>('/api/me/profile', {
        method: 'PUT',
        body: JSON.stringify({ name: name.trim(), hackerRankId: hackerRankId.trim() }),
      }, session.token)
      setUser(result)
      navigate('/app', { replace: true })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save your profile.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="auth-layout">
      <section className="auth-card profile-card">
        <button className="text-button signout-link" type="button" onClick={signOut}>Sign out</button>
        <p className="eyebrow">YOUR CONTEST IDENTITY</p>
        <h1>Complete<br /><span>your profile.</span></h1>
        <p className="intro">Your HackerRank ID lets the event team match you to contest results.</p>
        <form className="profile-form" onSubmit={(event) => void submit(event)}>
          <label htmlFor="participant-name">Display name</label>
          <input id="participant-name" autoComplete="name" maxLength={100} required value={name}
            onChange={(event) => setName(event.target.value)} />
          <label htmlFor="hacker-rank-id">HackerRank ID</label>
          <input id="hacker-rank-id" maxLength={50} pattern="\S+" required value={hackerRankId}
            onChange={(event) => setHackerRankId(event.target.value)} />
          {error && <ErrorMessage message={error} />}
          <button className="primary-button" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save profile'}</button>
        </form>
      </section>
      <aside className="auth-aside profile-aside">
        <div className="orbit orbit-one" /><div className="orbit orbit-two" />
        <div className="aside-copy"><p className="eyebrow">YOUR IDENTITY. YOUR GAME.</p><h2>Make your<br />name count.</h2>
          <p>You can update your HackerRank ID later from your profile.</p></div>
        <span className="aside-index">02 / PREPARE YOUR PROFILE</span>
      </aside>
    </main>
  )
}

function ParticipantLayout() {
  const { user, round, refreshRound, refreshUser, signOut } = useAuth()
  const [events, setEvents] = useState<import('./types').EventResponse[]>([])
  const [popups, setPopups] = useState<import('./types').EventResponse[]>([])
  const [bellOpen, setBellOpen] = useState(false)
  const [lastId, setLastId] = useState<number | null>(null)
  const [readId, setReadId] = useState(0)
  const [error, setError] = useState('')
  const location = useLocation()
  const token = useAuth().session?.token

  useEffect(() => {
    if (!token) return
    let alive = true
    const poll = async () => {
      try {
        if (lastId === null) {
          const initial = await api<import('./types').EventResponse[]>('/api/me/events?limit=20', {}, token)
          if (!alive) return
          setEvents(initial.slice(-50))
          setLastId(initial.reduce((max, event) => Math.max(max, event.id), 0))
          return
        }
        const incoming = await api<import('./types').EventResponse[]>(`/api/me/events?after=${lastId}&limit=50`, {}, token)
        if (!alive || incoming.length === 0) return
        setEvents((previous) => [...previous, ...incoming].slice(-50))
        setLastId(incoming.reduce((max, event) => Math.max(max, event.id), lastId))
        setPopups((previous) => [...previous, ...incoming.filter((event) => !event.broadcast)])
        if (incoming.some((event) => event.broadcast)) void refreshRound()
        void refreshUser()
        setError('')
      } catch (cause) {
        if (alive) setError(cause instanceof Error ? cause.message : 'Notifications could not be refreshed.')
      }
    }
    void poll()
    const interval = window.setInterval(() => void poll(), 5000)
    return () => { alive = false; window.clearInterval(interval) }
  }, [token, lastId, refreshRound, refreshUser])

  useEffect(() => {
    if (!token) return
    const poll = () => {
      void refreshRound().catch((cause: unknown) => setError(cause instanceof Error ? cause.message : 'Round could not be refreshed.'))
    }
    poll()
    const interval = window.setInterval(poll, 5000)
    return () => window.clearInterval(interval)
  }, [token, refreshRound])

  useEffect(() => {
    if (!token) return
    const poll = () => void refreshUser().catch((cause: unknown) => setError(cause instanceof Error ? cause.message : 'Account could not be refreshed.'))
    const interval = window.setInterval(poll, 15000)
    const visible = () => { if (document.visibilityState === 'visible') poll() }
    document.addEventListener('visibilitychange', visible)
    return () => { window.clearInterval(interval); document.removeEventListener('visibilitychange', visible) }
  }, [token, refreshUser])

  useEffect(() => {
    if (popups.length < 2) return
    const timer = window.setTimeout(() => setPopups((items) => items.slice(1)), 6000)
    return () => window.clearTimeout(timer)
  }, [popups])

  function openBell() {
    setBellOpen((open) => {
      if (!open) setReadId(events.reduce((max, event) => Math.max(max, event.id), readId))
      return !open
    })
  }

  const currentPopup = popups[0]
  return (
    <main className="app-shell">
      <header className="topbar">
        <Link className="wordmark" to="/app"><span className="wordmark-icon">D</span> DEAL WITH THE DEVIL</Link>
        <nav className="main-nav">
          <NavLink to="/app" end>Dashboard</NavLink>
          <NavLink to="/app/round">Round</NavLink>
          <NavLink to="/app/results">My problems</NavLink>
          <NavLink to="/app/history">History</NavLink>
          <NavLink to="/app/leaderboard">Leaderboard</NavLink>
          <NavLink to="/app/rules">Rules</NavLink>
          <NavLink to="/profile">Profile</NavLink>
        </nav>
        <div className="topbar-right">
          <button className="bell-button" onClick={openBell} aria-label={`Notifications, ${events.filter((event) => event.id > readId).length} unread`}>
            <svg className="bell-icon" aria-hidden="true" viewBox="0 0 24 24"><path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" /></svg>
            <span>{events.filter((event) => event.id > readId).length || ''}</span>
          </button>
          <span className="role-pill">{user?.coins.toLocaleString()} coins</span>
          <button className="text-button" type="button" onClick={signOut}>Sign out</button>
        </div>
      </header>
      <PhaseBanner round={round} />
      {error && <ErrorMessage message={error} />}
      <section className="page-content"><Outlet /></section>
      {bellOpen && <aside className="notification-panel">
        <div className="panel-heading"><h2>Notifications</h2><button className="text-button" onClick={() => setBellOpen(false)}>Close</button></div>
        {events.length === 0 ? <p className="muted">No notifications yet.</p> : [...events].reverse().map((event) =>
          <article className="notification-item" key={event.id}><p>{event.message}</p><time>{new Date(event.createdAt).toLocaleString()}</time></article>)}
      </aside>}
      {currentPopup && <div className="toast" role="status" aria-live="polite">
        <div><p className="eyebrow">{currentPopup.type.replaceAll('_', ' ')}</p><p>{currentPopup.message}</p>
          {currentPopup.amount !== null && <strong className={currentPopup.amount >= 0 ? 'positive' : 'negative'}>{currentPopup.amount > 0 ? '+' : ''}{currentPopup.amount} coins</strong>}
        </div>
        <button className="text-button" onClick={() => setPopups((items) => items.slice(1))}>Dismiss {popups.length > 1 ? `(${popups.length})` : ''}</button>
      </div>}
      <span className="sr-only">{location.pathname}</span>
    </main>
  )
}

function AdminLayout() {
  const { user, round, refreshRound, signOut } = useAuth()
  const [error, setError] = useState('')
  useEffect(() => {
    const poll = () => void refreshRound().catch((cause: unknown) => setError(cause instanceof Error ? cause.message : 'Round could not be refreshed.'))
    poll()
    const interval = window.setInterval(poll, 5000)
    return () => window.clearInterval(interval)
  }, [refreshRound])
  return (
    <main className="app-shell admin-shell">
      <header className="topbar">
        <Link className="wordmark" to="/admin"><span className="wordmark-icon">D</span> DEAL WITH THE DEVIL <span className="role-pill">ADMIN</span></Link>
        <div className="topbar-right"><span className="muted">{user?.name || user?.email}</span><button className="text-button" onClick={signOut}>Sign out</button></div>
      </header>
      <div className="admin-layout">
        <aside className="admin-nav">
          <p className="eyebrow">EVENT CONTROL</p>
          <NavLink to="/admin" end>Round & auction</NavLink>
          <NavLink to="/admin/problems">Problem bank</NavLink>
          <NavLink to="/admin/participants">Participants</NavLink>
          <NavLink to="/admin/ledger">Ledger</NavLink>
          <NavLink to="/admin/audit">Audit log</NavLink>
          <div className="admin-round-state"><span>ROUND {round?.number ?? '—'}</span><strong>{round?.phase ?? 'NOT STARTED'}</strong><small>{round?.paused ? 'PAUSED' : 'LIVE'}</small></div>
        </aside>
        <div className="admin-main">
          {error && <ErrorMessage message={error} />}
          <Outlet />
        </div>
      </div>
    </main>
  )
}

function PhaseBanner({ round }: { round: RoundResponse | null }) {
  if (!round) return <div className="phase-banner empty-phase"><span>The event has not started yet</span></div>
  return <div className={`phase-banner ${round.paused ? 'paused' : ''}`}>
    <span>ROUND {round.number}</span><strong>{round.phase}</strong>{round.paused && <b>PAUSED · Bidding is disabled</b>}
    {round.biddingDeadline && <time>Deadline {new Date(round.biddingDeadline).toLocaleTimeString()}</time>}
  </div>
}

export function PageHeading({ eyebrow, title, description }: { eyebrow: string; title: string; description?: string }) {
  return <header className="page-heading"><p className="eyebrow">{eyebrow}</p><h1>{title}</h1>{description && <p className="muted">{description}</p>}</header>
}

export function ErrorMessage({ message }: { message: string }) {
  return <p className="error-message" role="alert">{message}</p>
}

export function Loading() {
  return <div className="center-state"><span className="spinner" /> Loading…</div>
}

export default App
