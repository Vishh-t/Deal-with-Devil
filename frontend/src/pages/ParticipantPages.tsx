import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ApiError, api } from '../api'
import { ErrorMessage, Loading, PageHeading, useAuth } from '../App'
import type {
  BidResponse,
  LeaderboardEntry,
  LedgerEntryResponse,
  ProblemPreviewResponse,
  RoundPhase,
} from '../types'

type Screen = 'dashboard' | 'round' | 'results' | 'history' | 'leaderboard' | 'rules'

function topBidTotal(bids: { amount: number }[]) {
  return bids.map((bid) => bid.amount).sort((a, b) => b - a).slice(0, 3).reduce((sum, amount) => sum + amount, 0)
}

export function ParticipantPages({ screen }: { screen: Screen }) {
  switch (screen) {
    case 'dashboard': return <Dashboard />
    case 'round': return <RoundPage />
    case 'results': return <ResultsPage />
    case 'history': return <HistoryPage />
    case 'leaderboard': return <LeaderboardPage />
    case 'rules': return <RulesPage />
  }
}

function Dashboard() {
  const { user, round, config } = useAuth()
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null)
  useEffect(() => {
    if (!round?.biddingDeadline) {
      setSecondsLeft(null)
      return
    }
    const serverOffset = Date.parse(round.serverTime) - Date.now()
    const update = () => setSecondsLeft(Math.max(0, Math.floor((Date.parse(round.biddingDeadline!) - (Date.now() + serverOffset)) / 1000)))
    update()
    const timer = window.setInterval(update, 1000)
    return () => window.clearInterval(timer)
  }, [round])
  const primary = round?.phase === 'BIDDING' ? ['/app/round', 'Place your bids']
    : round && ['SOLVING', 'RESULTS'].includes(round.phase) ? ['/app/results', 'See my results']
      : ['/app/round', 'See problems']

  return (
    <>
      <PageHeading eyebrow="YOUR CONTEST DESK" title={`Welcome, ${user?.name || user?.email.split('@')[0] || 'participant'}.`}
        description="Your next move is yours to make." />
      <div className="stat-grid">
        <article className="stat-card coin-card"><p className="eyebrow">AVAILABLE COINS</p><strong>{user?.coins.toLocaleString() ?? '—'}</strong><span>Whole coins. Every choice counts.</span></article>
        <article className="stat-card"><p className="eyebrow">CURRENT ROUND</p><strong className="stat-text">{round ? `Round ${round.number}` : 'Not started'}</strong>
          <span>{round?.phase ?? 'The event has not started yet'}</span></article>
        <article className="stat-card"><p className="eyebrow">CORRUPTION LEVEL</p><strong className="stat-text">{user?.corruptionLevel} / {config?.maxCorruptionLevel ?? 3}</strong>
          <span>Determines the hint version organisers give you.</span></article>
      </div>
      {round?.biddingDeadline && round.phase === 'BIDDING' && <div className="deadline-card"><span>BIDDING CLOSES IN</span><strong>{formatCountdown(secondsLeft)}</strong></div>}
      {round?.paused && <div className="notice-box warning">This round is paused. Bidding is temporarily disabled.</div>}
      <section className="next-step">
        <div><p className="eyebrow">UP NEXT</p><h2>{round ? `Round ${round.number} · ${phaseLabel(round.phase)}` : 'The auction floor is quiet.'}</h2>
          <p>{round ? phaseDescription(round.phase) : 'When the admin starts the first round, your problem previews will appear here.'}</p></div>
        <Link className="primary-button link-button" to={primary[0]}>{primary[1]}</Link>
      </section>
    </>
  )
}

function RoundPage() {
  const { session, round, user, refreshRound } = useAuth()
  const [problems, setProblems] = useState<ProblemPreviewResponse[]>([])
  const [bids, setBids] = useState<BidResponse[]>([])
  const [drafts, setDrafts] = useState<Record<number, string>>({})
  const [busyId, setBusyId] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null)
  const [selectedProblemId, setSelectedProblemId] = useState<number | null>(null)
  const [tierFilter, setTierFilter] = useState<'ALL' | 'BRONZE' | 'SILVER' | 'GOLD'>('ALL')

  async function load() {
    if (!session) return
    setLoading(true)
    setError('')
    try {
      const [problemList, myBids] = await Promise.all([
        api<ProblemPreviewResponse[]>('/api/rounds/current/problems', {}, session.token),
        api<BidResponse[]>('/api/me/bids', {}, session.token),
      ])
      setProblems(problemList)
      setBids(myBids)
      setDrafts((current) => {
        const next = { ...current }
        for (const bid of myBids) if (next[bid.problemId] === undefined) next[bid.problemId] = String(bid.amount)
        return next
      })
    } catch (cause) {
      if (cause instanceof ApiError && cause.code === 'ROUND_NOT_FOUND') {
        setProblems([])
        setBids([])
      } else {
        setError(cause instanceof Error ? cause.message : 'Could not load this round.')
      }
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void load() }, [session?.token, round?.id])
  useEffect(() => {
    if (!round?.biddingDeadline) {
      setSecondsLeft(null)
      return
    }
    const offset = Date.parse(round.serverTime) - Date.now()
    let refreshedAtZero = false
    const update = () => {
      const remaining = Date.parse(round.biddingDeadline!) - Date.now() - offset
      setSecondsLeft(Math.max(0, Math.floor(remaining / 1000)))
      if (remaining <= 0 && !refreshedAtZero) {
        refreshedAtZero = true
        void refreshRound()
      }
    }
    update()
    const timer = window.setInterval(() => {
      update()
    }, 1000)
    return () => window.clearInterval(timer)
  }, [round, refreshRound])

  const editable = round?.phase === 'BIDDING' && !round.paused && (secondsLeft === null || secondsLeft > 0)
  const available = Math.max(0, (user?.coins ?? 0) - topBidTotal(bids))
  const visibleProblems = tierFilter === 'ALL' ? problems : problems.filter((problem) => problem.tier === tierFilter)
  const selectedProblem = problems.find((problem) => problem.id === selectedProblemId) ?? null

  async function saveBid(problem: ProblemPreviewResponse) {
    if (!session) return
    const amount = Number(drafts[problem.id])
    const otherBids = bids.filter((bid) => bid.problemId !== problem.id)
    if (!Number.isSafeInteger(amount) || amount < problem.basePrice) {
      setError(`Your bid must be a whole number of at least ${problem.basePrice} coins.`)
      return
    }
    if (topBidTotal([...otherBids, { amount }]) > (user?.coins ?? 0)) {
      setError('Your three highest bids would add up to more coins than you have.')
      return
    }
    setBusyId(problem.id)
    setError('')
    try {
      const bid = await api<BidResponse>(`/api/rounds/current/problems/${problem.id}/bid`, {
        method: 'PUT',
        body: JSON.stringify({ amount }),
      }, session.token)
      setBids((current) => [...current.filter((item) => item.problemId !== problem.id), bid])
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save your bid.')
      if (cause instanceof ApiError && cause.code === 'BIDDING_CLOSED') void refreshRound()
    } finally {
      setBusyId(null)
    }
  }

  if (loading) return <Loading />
  return (
    <>
      <PageHeading eyebrow={round ? `ROUND ${round.number} · ${round.phase}` : 'ROUND'} title="Current round"
        description="Review the problems and place or update your sealed bids during the bidding phase." />
      <div className="auction-hud">
        <div><span>ROUND // PHASE</span><strong>{round ? `R${round.number} · ${round.phase}` : 'WAITING FOR ROUND'}</strong></div>
        <div><span>WALLET BALANCE</span><strong>{user?.coins.toLocaleString() ?? '—'} coins</strong></div>
        <div><span>SUBMITTED BID AMOUNTS</span><strong>{bids.reduce((sum, bid) => sum + bid.amount, 0).toLocaleString()} coins</strong></div>
        <div><span>REMAINING BID BUDGET (TOP 3)</span><strong className="available-value">{available.toLocaleString()} coins</strong></div>
        {round?.biddingDeadline && <div><span>TIME UNTIL DEADLINE</span><strong>{formatCountdown(secondsLeft)}</strong></div>}
      </div>
      {round?.paused && <div className="notice-box warning">Round paused. Your bids are saved, but you cannot edit them right now.</div>}
      {round?.phase === 'PREVIEW' && <div className="notice-box">Bidding opens soon. Read the problem details and plan your bids.</div>}
      {round?.phase === 'SETTLEMENT' && <div className="notice-box">Bidding is closed. Results are being prepared.</div>}
      {round?.biddingDeadline && round.phase === 'BIDDING' && <div className="deadline-card"><span>{secondsLeft === 0 ? 'BIDDING CLOSED' : 'TIME REMAINING'}</span><strong>{formatCountdown(secondsLeft)}</strong></div>}
      {error && <ErrorMessage message={error} />}
      <div className="auction-catalog-heading">
        <div><p className="eyebrow">PROBLEMS IN THIS ROUND</p><strong>{problems.length} PROBLEMS</strong></div>
        <div className="tier-filters" aria-label="Filter by tier">
          {(['ALL', 'GOLD', 'SILVER', 'BRONZE'] as const).map((tier) =>
            <button key={tier} className={tierFilter === tier ? 'active' : ''} onClick={() => setTierFilter(tier)}>{tier}</button>)}
        </div>
      </div>
      {problems.length === 0 ? <EmptyState title={round ? 'No problems yet' : 'The event has not started yet'}
        text={round ? 'Problems for this round will appear here.' : 'Come back when the organisers start round one.'} /> : (
        <div className="auction-grid">
          {visibleProblems.map((problem, index) => {
            const ownBid = bids.find((bid) => bid.problemId === problem.id)
            return <button className="auction-problem-card" key={problem.id} onClick={() => setSelectedProblemId(problem.id)}>
              <div className="problem-topline"><span className={`tier tier-${problem.tier.toLowerCase()}`}>{problem.tier} TIER</span></div>
              <h2>{problem.title}</h2><p className="muted">{problem.category}</p>
              {problem.teaser && <p className="problem-teaser">{problem.teaser}</p>}
              <div className="problem-facts"><span>{problem.slots} winner {problem.slots === 1 ? 'slot' : 'slots'}</span><span><b>Reserve:</b> {problem.basePrice.toLocaleString()} coins</span></div>
              <div className="catalog-card-footer">
                <span>{ownBid ? `Your bid: ${ownBid.amount.toLocaleString()} coins` : 'No bid placed'}</span>
                <strong>{round?.phase === 'BIDDING' ? 'PLACE OR UPDATE BID →' : `VIEW PROBLEM ${String(index + 1).padStart(2, '0')} →`}</strong>
              </div>
            </button>
          })}
        </div>
      )}
      {round?.phase === 'BIDDING' && <div className="bid-summary"><span>Wallet balance <strong>{user?.coins.toLocaleString()} coins</strong></span>
        <span>Top 3 bids <strong>{topBidTotal(bids).toLocaleString()} coins</strong></span><span>Remaining bid budget <strong>{available.toLocaleString()} coins</strong></span></div>}
      {round && ['SOLVING', 'RESULTS'].includes(round.phase) && <Link className="primary-button link-button" to="/app/results">View my results</Link>}
      {selectedProblem && <div className="bid-drawer-backdrop" role="presentation" onClick={() => setSelectedProblemId(null)}>
        <aside className="bid-drawer" role="dialog" aria-modal="true" aria-labelledby="bid-drawer-title" onClick={(event) => event.stopPropagation()}>
          <button className="drawer-close" aria-label="Close bid panel" onClick={() => setSelectedProblemId(null)}>×</button>
          <div className="drawer-content">
            <p className="eyebrow">{selectedProblem.tier} TIER · {selectedProblem.slots} WINNER {selectedProblem.slots === 1 ? 'SLOT' : 'SLOTS'}</p>
            <h2 id="bid-drawer-title">{selectedProblem.title}</h2>
            <p className="muted">{selectedProblem.category} · SEALED BID</p>
            {selectedProblem.teaser && <p className="drawer-teaser">{selectedProblem.teaser}</p>}
            {selectedProblem.preview && <div className="question-preview"><strong>Problem preview</strong><p>{selectedProblem.preview}</p></div>}
            <div className="drawer-balance">
              <div><span>WALLET BALANCE</span><strong>{user?.coins.toLocaleString()} coins</strong></div>
              <div><span>TOP 3 BID TOTAL</span><strong>{topBidTotal(bids)} coins</strong></div>
              <div><span>REMAINING AMOUNT</span><strong className="available-value">{available.toLocaleString()} coins</strong></div>
            </div>
            {round?.phase === 'BIDDING' ? (() => {
              const ownBid = bids.find((bid) => bid.problemId === selectedProblem.id)
              const amount = Number(drafts[selectedProblem.id] || 0)
              const otherBids = bids.filter((bid) => bid.problemId !== selectedProblem.id)
              const topThreeAfter = topBidTotal([...otherBids, { amount }])
              const otherTopTwo = otherBids.map((bid) => bid.amount).sort((a, b) => b - a).slice(0, 2).reduce((sum, bidAmount) => sum + bidAmount, 0)
              const maxBidAmount = Math.max(0, (user?.coins ?? 0) - otherTopTwo)
              const exceedsBalance = topThreeAfter > (user?.coins ?? 0)
              const validBid = amount >= selectedProblem.basePrice && !exceedsBalance && Number.isSafeInteger(amount)
              const progress = Math.min(100, topThreeAfter / Math.max(1, user?.coins ?? 1) * 100)
              return <>
                <div className="bid-entry">
                  <label htmlFor={`bid-${selectedProblem.id}`}>Your bid amount <span>Minimum: {selectedProblem.basePrice.toLocaleString()} coins</span></label>
                  <div className="drawer-amount"><span>coins</span><input id={`bid-${selectedProblem.id}`} type="number" min={selectedProblem.basePrice} step={1} inputMode="numeric"
                    value={drafts[selectedProblem.id] ?? ''} disabled={!editable} onChange={(event) => setDrafts((current) => ({ ...current, [selectedProblem.id]: event.target.value }))} /></div>
                  <div className="quick-bids">
                    <button disabled={!editable} onClick={() => setDrafts((current) => ({ ...current, [selectedProblem.id]: String(Math.max(selectedProblem.basePrice, amount) + 10) }))}>+10 coins</button>
                    <button disabled={!editable} onClick={() => setDrafts((current) => ({ ...current, [selectedProblem.id]: String(Math.max(selectedProblem.basePrice, amount) + 25) }))}>+25 coins</button>
                    <button disabled={!editable || maxBidAmount < selectedProblem.basePrice} onClick={() => setDrafts((current) => ({ ...current, [selectedProblem.id]: String(maxBidAmount) }))}>MAXIMUM</button>
                  </div>
                </div>
                <section className="solvency-card">
                  <div><span>TOP 3 BIDS AFTER THIS BID</span><strong>{topThreeAfter.toLocaleString()} / {user?.coins} coins</strong></div>
                  <div className="solvency-meter"><span style={{ width: `${progress}%` }} /></div>
                  <p className={validBid ? 'available-value' : 'field-error'}>{validBid ? 'Your three highest bids fit your balance' : exceedsBalance ? 'Your three highest bids exceed your wallet balance' : `Minimum bid is ${selectedProblem.basePrice} coins`}</p>
                </section>
                <div className="auction-rule-callout"><strong>SETTLEMENT PRICE</strong><p>Eligible bids are ranked across the round. If your bid wins one of this problem’s {selectedProblem.slots} slots, you and the other winners of this problem pay its clearing price: the highest bid that could not win because the slots were full. If no bid is turned away for that reason, the reserve price applies. The three-win-per-participant limit can affect which bids are accepted.</p></div>
                {ownBid && <p className="muted drawer-saved">Current bid: {ownBid.amount.toLocaleString()} coins · submitted {new Date(ownBid.submittedAt).toLocaleTimeString()}</p>}
                {error && <ErrorMessage message={error} />}
                <div className="drawer-actions">
                  <button className="drawer-submit" disabled={!editable || busyId === selectedProblem.id || !validBid}
                    onClick={() => void saveBid(selectedProblem)}>{busyId === selectedProblem.id ? 'SAVING…' : ownBid ? 'UPDATE BID' : 'PLACE BID'}</button>
                  <button className="drawer-cancel" onClick={() => setSelectedProblemId(null)}>CLOSE</button>
                </div>
              </>
            })() : <div className="auction-rule-callout"><strong>BIDDING IS NOT OPEN</strong><p>{round?.paused ? 'This round is paused.' : `Current phase: ${round?.phase ?? 'no round'}. Problem details remain available, but bids are disabled.`}</p></div>}
          </div>
        </aside>
      </div>}
    </>
  )
}

function ResultsPage() {
  const { session, round, user, config } = useAuth()
  const [bids, setBids] = useState<BidResponse[]>([])
  const [ledger, setLedger] = useState<LedgerEntryResponse[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const token = session?.token
  useEffect(() => {
    if (!token) return
    void Promise.all([
      api<BidResponse[]>('/api/me/bids', {}, token),
      api<LedgerEntryResponse[]>('/api/me/history', {}, token),
    ]).then(([myBids, history]) => { setBids(myBids); setLedger(history) })
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : 'Could not load results.'))
      .finally(() => setLoading(false))
  }, [token, round?.id])
  if (loading) return <Loading />
  const won = bids.filter((bid) => bid.status === 'WON')
  const saved = won.reduce((sum, bid) => sum + Math.max(0, bid.amount - (bid.pricePaid ?? bid.amount)), 0)
  return <>
    <div className="vault-hero">
      <div><p className="eyebrow">PARTICIPANT: {user?.hackerRankId || '—'} · ROUND {round?.number ?? '—'}</p>
        <h1>My results</h1>
        <p>{won.length} WON PROBLEM{won.length === 1 ? '' : 'S'} IN THIS ROUND</p></div>
      <div className="vault-phase"><span>ROUND {round?.number ?? '—'} · PHASE</span><strong>{round?.phase ?? 'WAITING'}</strong><span>{round?.phase === 'SOLVING' ? 'Solving phase' : round?.phase === 'RESULTS' ? 'Results available' : 'Results are available after settlement'}</span></div>
    </div>
    {error && <ErrorMessage message={error} />}
    <div className="vault-metrics">
      <div><span>PROBLEMS WON</span><strong>{String(won.length).padStart(2, '0')} <small>OF {String(bids.length).padStart(2, '0')} BIDS</small></strong></div>
      <div><span>CORRUPTION LEVEL</span><strong>{user?.corruptionLevel ?? '—'} <small>OF {config?.maxCorruptionLevel ?? 3}</small></strong></div>
      <div><span>DIFFERENCE BETWEEN BIDS AND PRICE PAID</span><strong>{saved.toLocaleString()} <small>coins</small></strong></div>
      <div><span>WALLET BALANCE</span><strong>{user?.coins.toLocaleString() ?? '—'} <small>coins</small></strong></div>
    </div>
    <div className="vault-columns">
      <section className="vault-challenges">
        <div className="vault-section-heading"><h2>Problems you won</h2><span>ROUND RESULTS</span></div>
        {won.length === 0 ? <EmptyState title="No problems won yet" text={bids.length ? 'Your bids did not win a slot this round.' : 'Your results will appear here after the auction is settled.'} /> :
          won.map((bid) => <article className="vault-problem" key={bid.problemId}>
            <div className="vault-problem-header">
              <div><span className="tier tier-gold">WON · ROUND {round?.number ?? '—'}</span>
                <h2>{bid.problemTitle}</h2><p>Your bid: {bid.amount.toLocaleString()} coins</p></div>
              <div className="clearance-amount"><span>PRICE PAID</span><strong>{bid.pricePaid?.toLocaleString() ?? '—'} coins</strong>
                <small>{Math.max(0, bid.amount - (bid.pricePaid ?? bid.amount))} coins difference</small></div>
            </div>
            <div className="vault-dispatch">
              <div><span>HACKERRANK PROBLEM</span><p>Open the problem using the link provided for this win.</p></div>
              {bid.hackerRankLink && <a className="dispatch-button" href={bid.hackerRankLink} target="_blank" rel="noreferrer">OPEN HACKERRANK ↗</a>}
            </div>
            <div className="hint-vault-note"><span>🔐</span><div><strong>HINTS ARE PROVIDED BY AN ORGANISER</strong>
              <p>Your corruption level ({user?.corruptionLevel}) determines which hint version the admin looks up. Ask the event team if you need help; hint text and passwords are not exposed to this participant screen.</p></div></div>
          </article>)}
        {bids.filter((bid) => bid.status !== 'WON').map((bid) => <article className="vault-result-row" key={bid.problemId}>
          <div><StatusBadge status={bid.status} /><strong>{bid.problemTitle}</strong></div>
          <span>Your bid {bid.amount.toLocaleString()} coins</span>
          <p>{bid.status === 'UNAFFORDABLE' ? 'You would have won, but your balance could not cover the clearing price. No coins were charged and the slot was not reassigned.' : 'This bid did not win a problem slot.'}</p>
        </article>)}
      </section>
      <aside className="vault-sidebar">
        <section className="vault-side-panel devil-chamber">
          <div className="vault-section-heading"><h2>The Devil’s deal</h2><span>ADMIN-MANAGED</span></div>
          <p className="vault-subtitle">COINS AND CORRUPTION LEVEL</p>
          <div className="corruption-meter"><div><span>CURRENT CORRUPTION LEVEL</span><strong>LEVEL {user?.corruptionLevel} / {config?.maxCorruptionLevel ?? 3}</strong></div>
            <div className="corruption-levels">{[1, 2, 3].map((level) => <span className={level <= (user?.corruptionLevel ?? 1) ? 'filled' : ''} key={level}>LEVEL {level}</span>)}</div>
            <p>Your corruption level determines which hint version an admin provides.</p></div>
          <article className="pact-option"><div><h3>Devil’s deal</h3><strong>+{config?.devil.dealPayout ?? '—'} coins</strong></div>
            <p>The deal raises corruption by one level and grants the configured coins. An event admin performs this action.</p>
            <span className="muted">Available below level {config?.maxCorruptionLevel ?? 3}</span></article>
          <article className="pact-option redemption"><div><h3>Redemption</h3><strong>−{config?.devil.redemptionCost ?? '—'} coins</strong></div>
            <p>Redemption lowers corruption by one level and deducts the configured cost, subject to balance and corruption-level limits.</p>
            <span className="muted">Admin-managed · subject to balance and level limits</span></article>
          <div className="notice-box">Ask an event organiser about a Devil’s deal or redemption. These are admin actions and cannot be started from your participant account.</div>
        </section>
        <section className="vault-side-panel">
          <div className="vault-section-heading"><h2>Recent wallet history</h2><Link to="/app/history">VIEW FULL HISTORY ↗</Link></div>
          {ledger.length === 0 ? <p className="muted">No wallet transactions yet.</p> : ledger.slice(0, 6).map((entry) =>
            <div className="vault-ledger-row" key={entry.id}><div><strong>{entry.type.replaceAll('_', ' ')}</strong><small>{entry.reason}</small></div>
              <span className={entry.amount >= 0 ? 'positive' : 'negative'}>{entry.amount > 0 ? '+' : ''}{entry.amount} coins</span><small>Balance: {entry.balanceAfter} coins</small></div>)}
        </section>
      </aside>
    </div>
  </>
}

function HistoryPage() {
  const { session } = useAuth()
  const [entries, setEntries] = useState<LedgerEntryResponse[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  useEffect(() => {
    if (!session) return
    void api<LedgerEntryResponse[]>('/api/me/history', {}, session.token).then(setEntries)
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : 'Could not load transaction history.'))
      .finally(() => setLoading(false))
  }, [session?.token])
  if (loading) return <Loading />
  return <>
    <PageHeading eyebrow="YOUR ACCOUNT" title="Coin history" description="Every credit and deduction, newest first." />
    {error && <ErrorMessage message={error} />}
    {entries.length === 0 ? <EmptyState title="No transactions yet" text="Your coin activity will appear here." /> :
      <div className="table-wrap"><table><thead><tr><th>Time</th><th>Activity</th><th>Reason</th><th>Change</th><th>Balance after</th></tr></thead>
        <tbody>{entries.map((entry) => <tr key={entry.id}><td>{new Date(entry.createdAt).toLocaleString()}</td><td>{entry.type.replaceAll('_', ' ')}</td>
          <td>{entry.reason}</td><td className={entry.amount >= 0 ? 'positive' : 'negative'}>{entry.amount > 0 ? '+' : ''}{entry.amount}</td><td>{entry.balanceAfter.toLocaleString()}</td></tr>)}</tbody></table></div>}
  </>
}

function LeaderboardPage() {
  const { session, user } = useAuth()
  const [entries, setEntries] = useState<LeaderboardEntry[]>([])
  const [error, setError] = useState('')
  useEffect(() => {
    if (!session) return
    let active = true
    const load = () => void api<LeaderboardEntry[]>('/api/leaderboard', {}, session.token)
      .then((data) => { if (active) setEntries(data) })
      .catch((cause: unknown) => { if (active) setError(cause instanceof Error ? cause.message : 'Could not load leaderboard.') })
    load()
    const timer = window.setInterval(load, 15000)
    return () => { active = false; window.clearInterval(timer) }
  }, [session?.token])
  return <>
    <PageHeading eyebrow="THE STANDINGS" title="Leaderboard" description="Participants ranked by their current coin balance. Tied balances share a rank." />
    {error && <ErrorMessage message={error} />}
    {entries.length === 0 ? <EmptyState title="No standings yet" text="The leaderboard appears once participants are registered." /> :
      <div className="table-wrap"><table><thead><tr><th>Rank</th><th>Participant</th><th>HackerRank ID</th><th>Coins</th></tr></thead>
        <tbody>{entries.map((entry) => <tr key={entry.userId} className={entry.userId === user?.id ? 'current-user-row' : ''}>
          <td>#{entry.rank}</td><td>{entry.name || '—'}{entry.userId === user?.id && <span className="you-tag">YOU</span>}</td>
          <td>{entry.hackerRankId || '—'}</td><td>{entry.coins.toLocaleString()}</td></tr>)}</tbody></table></div>}
  </>
}

function RulesPage() {
  const { config } = useAuth()
  return <>
    <PageHeading eyebrow="THE TERMS OF THE GAME" title="Rules of the auction" description="Know the deal before you place a bid." />
    <div className="rules-grid">
      <RuleCard title="Sealed bids"><p>Your bid is private and can be changed until bidding closes. No one else can see what you bid.</p></RuleCard>
      <RuleCard title="Winning and settlement price"><p>Eligible bids are ranked across the round. A bid wins if the participant is still below the three-win limit and the problem has an open slot. All winners of a problem pay the same clearing price: the highest bid turned away because that problem was full. If no bid is turned away for that reason, winners pay the reserve price. The three-win limit can affect which bids are accepted.</p><p>Example: if the three-win limit does not affect selection, with 2 slots and bids 90, 70, 50, 30, the top two win and each pays 50.</p></RuleCard>
      <RuleCard title="Your coin limit"><p>Your three highest bids in a round, including the bid you are placing or changing, cannot total more than your coin balance. Coins are deducted from winners during settlement.</p></RuleCard>
      <RuleCard title="Ties and affordability"><p>Equal bids are decided by who submitted first. Changing a bid amount resets your place in the tie-break order. A winner who cannot afford the clearing price at settlement is marked unaffordable and pays nothing.</p></RuleCard>
      <RuleCard title="Corruption and hints"><p>Your corruption level runs from {config?.minCorruptionLevel ?? 1} to {config?.maxCorruptionLevel ?? 3} and determines which hint version the organisers can provide. Hints are given manually by an organiser.</p></RuleCard>
      <RuleCard title="The Devil’s deal"><p>Organisers can raise your corruption by one level in exchange for {config?.devil.dealPayout ?? '—'} coins. Redemption lowers corruption by one level and costs {config?.devil.redemptionCost ?? '—'} coins.</p></RuleCard>
    </div>
    {config && <section className="config-panel"><h2>Current game values</h2><div className="config-grid">
      <div><span>Bronze reserve</span><strong>{config.basePrice.bronze}</strong></div><div><span>Silver reserve</span><strong>{config.basePrice.silver}</strong></div><div><span>Gold reserve</span><strong>{config.basePrice.gold}</strong></div>
      <div><span>Bronze solve reward</span><strong>{config.solveReward.bronze}</strong></div><div><span>Silver solve reward</span><strong>{config.solveReward.silver}</strong></div><div><span>Gold solve reward</span><strong>{config.solveReward.gold}</strong></div>
      <div><span>Hint deduction</span><strong>{config.hintPrice}</strong></div></div></section>}
  </>
}

function RuleCard({ title, children }: { title: string; children: React.ReactNode }) {
  return <article className="rule-card"><h2>{title}</h2>{children}</article>
}

function StatusBadge({ status }: { status: string }) {
  return <span className={`status status-${status.toLowerCase()}`}>{status}</span>
}

function EmptyState({ title, text }: { title: string; text: string }) {
  return <div className="empty-state"><span className="empty-mark">—</span><h2>{title}</h2><p>{text}</p></div>
}

function phaseLabel(phase: RoundPhase) {
  const labels: Record<RoundPhase, string> = {
    PREVIEW: 'Preview problems',
    BIDDING: 'Place sealed bids',
    SETTLEMENT: 'Bids are being settled',
    SOLVING: 'Solve on HackerRank',
    RESULTS: 'Results are ready',
  }
  return labels[phase]
}

function phaseDescription(phase: RoundPhase) {
  const descriptions: Record<RoundPhase, string> = {
    PREVIEW: 'Study the problem cards and reserve prices before bidding opens.',
    BIDDING: 'Submit or update secret bids before the deadline. Your total bids cannot exceed your coins.',
    SETTLEMENT: 'The auction is closed. The organisers are calculating the winners and clearing prices.',
    SOLVING: 'Open the HackerRank links for problems you won. Hints are provided by the organisers.',
    RESULTS: 'Review your results, check your coin history, and see the leaderboard.',
  }
  return descriptions[phase]
}

function formatCountdown(seconds: number | null) {
  if (seconds === null) return 'No deadline set'
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const remainder = seconds % 60
  return [hours, minutes, remainder].map((part) => String(part).padStart(2, '0')).join(':')
}
