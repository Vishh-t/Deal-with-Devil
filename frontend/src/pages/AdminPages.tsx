import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError, api } from '../api'
import { ErrorMessage, Loading, PageHeading, useAuth } from '../App'
import type {
  AdminLedgerEntryResponse,
  AdminProblemResponse,
  AllocationViewResponse,
  AutoFillResponse,
  AutoSlotsResponse,
  AuditLogResponse,
  BidCoverageResponse,
  CreditAllResponse,
  GameConfigResponse,
  HintResponse,
  LedgerEntryResponse,
  ManualAssignmentResponse,
  MeResponse,
  RoundPhase,
  RoundResponse,
  SettlementSummaryResponse,
  Tier,
  WinnerResponse,
} from '../types'

type Screen = 'rounds' | 'problems' | 'participants' | 'ledger' | 'audit'
const TIERS: Tier[] = ['BRONZE', 'SILVER', 'GOLD']

export function AdminPages({ screen }: { screen: Screen }) {
  switch (screen) {
    case 'rounds': return <RoundControlPage />
    case 'problems': return <ProblemBankPage />
    case 'participants': return <ParticipantsPage />
    case 'ledger': return <LedgerPage />
    case 'audit': return <AuditPage />
  }
}

function RoundControlPage() {
  const { session, round, refreshRound, config } = useAuth()
  const [summary, setSummary] = useState<SettlementSummaryResponse | null>(null)
  const [problems, setProblems] = useState<AdminProblemResponse[]>([])
  const [autoSlots, setAutoSlots] = useState<AutoSlotsResponse | null>(null)
  const [coverage, setCoverage] = useState<BidCoverageResponse | null>(null)
  const [allocation, setAllocation] = useState<AllocationViewResponse | null>(null)
  const [autoFill, setAutoFill] = useState<AutoFillResponse | null>(null)
  const [assignmentUserId, setAssignmentUserId] = useState('')
  const [assignmentProblemId, setAssignmentProblemId] = useState('')
  const [deadline, setDeadline] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const canSetDeadline = round && ['PREVIEW', 'BIDDING'].includes(round.phase)
  const token = session?.token
  useEffect(() => {
    if (!token) return
    void api<AdminProblemResponse[]>('/api/admin/problems', {}, token)
      .then(setProblems)
      .catch((cause: unknown) => setError(errorMessage(cause)))
  }, [token, round?.id])
  const roundProblems = problems.filter((problem) => problem.roundId === round?.id)

  async function reloadProblems() {
    if (!session) return
    setProblems(await api<AdminProblemResponse[]>('/api/admin/problems', {}, session.token))
  }

  const loadCoverage = useCallback(async () => {
    if (!token) return
    try {
      const result = await api<BidCoverageResponse>('/api/admin/rounds/current/bid-coverage', {}, token)
      setError('')
      setCoverage(result)
    } catch (cause) { setError(errorMessage(cause)) }
  }, [token])

  const loadAllocation = useCallback(async () => {
    if (!token) return
    try {
      const result = await api<AllocationViewResponse>('/api/admin/rounds/current/allocation', {}, token)
      setError('')
      setAllocation(result)
    } catch (cause) { setError(errorMessage(cause)) }
  }, [token])

  async function previewSlots() {
    if (!session) return
    setBusy(true)
    setError('')
    setMessage('')
    try {
      setAutoSlots(await api<AutoSlotsResponse>('/api/admin/rounds/current/slots/auto?dryRun=true', {
        method: 'POST',
      }, session.token))
    } catch (cause) { setError(errorMessage(cause)) }
    finally { setBusy(false) }
  }

  async function applySlots() {
    if (!session || !autoSlots) return
    if (!window.confirm(`Apply automatic slot allocation to ${autoSlots.problemCount} problems for ${autoSlots.participants} completed-profile participants? This assigns ${autoSlots.slotsAssigned} slots.`)) return
    setBusy(true)
    setError('')
    setMessage('')
    try {
      const result = await api<AutoSlotsResponse>('/api/admin/rounds/current/slots/auto?dryRun=false', {
        method: 'POST',
      }, session.token)
      setAutoSlots(result)
      await reloadProblems()
      setMessage('Problem slots updated.')
    } catch (cause) { setError(errorMessage(cause)) }
    finally { setBusy(false) }
  }

  async function previewAutoFill() {
    if (!session) return
    setBusy(true)
    setError('')
    setMessage('')
    try {
      setAutoFill(await api<AutoFillResponse>('/api/admin/rounds/current/auto-fill?dryRun=true', {
        method: 'POST',
      }, session.token))
    } catch (cause) { setError(errorMessage(cause)) }
    finally { setBusy(false) }
  }

  async function applyAutoFill() {
    if (!session || !autoFill) return
    const total = autoFill.assignments.reduce((sum, assignment) => sum + assignment.price, 0)
    if (!window.confirm(`Automatically assign ${autoFill.assignments.length} problem(s) at reserve price, totaling ${total} coins? Participants still short afterward: ${autoFill.stillShort.length}.`)) return
    setBusy(true)
    setError('')
    setMessage('')
    try {
      const result = await api<AutoFillResponse>('/api/admin/rounds/current/auto-fill?dryRun=false', {
        method: 'POST',
      }, session.token)
      setAutoFill(result)
      await loadAllocation()
      setMessage(`Auto-fill assigned ${result.assignments.length} problem(s).`)
    } catch (cause) { setError(errorMessage(cause)) }
    finally { setBusy(false) }
  }

  async function assignProblem() {
    if (!session || !assignmentUserId || !assignmentProblemId) return
    const participant = allocation?.participants.find((row) => row.userId === Number(assignmentUserId))
    const problem = allocation?.problems.find((row) => row.problemId === Number(assignmentProblemId))
    if (!participant || !problem) return
    if (!window.confirm(`Give "${problem.title}" to ${participant.name || participant.hackerRankId || `user ${participant.userId}`} at its reserve price? Their current wins: ${participant.wins}. ${problem.unsold === 0 ? 'This will exceed the problem slot count.' : `${problem.unsold} slot(s) are currently unsold.`}`)) return
    setBusy(true)
    setError('')
    setMessage('')
    try {
      const result = await api<ManualAssignmentResponse>('/api/admin/rounds/current/assignments', {
        method: 'POST',
        body: JSON.stringify({ userId: participant.userId, problemId: problem.problemId }),
      }, session.token)
      await loadAllocation()
      setMessage(`Assigned ${result.problemTitle} for ${result.pricePaid} coins. New balance: ${result.balanceAfter} coins.${result.overCapacity ? ' This exceeds the problem slot count.' : ''}`)
    } catch (cause) { setError(errorMessage(cause)) }
    finally { setBusy(false) }
  }

  async function runAction(path: string, method = 'POST', body?: unknown) {
    if (!session) return
    setBusy(true)
    setError('')
    setMessage('')
    try {
      const result = await api<RoundResponse | SettlementSummaryResponse>(path, {
        method,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }, session.token)
      if (path.endsWith('/settle')) setSummary(result as SettlementSummaryResponse)
      if (path === '/api/admin/rounds') {
        setAutoSlots(null)
        setCoverage(null)
        setAllocation(null)
        setAutoFill(null)
      } else if (path.endsWith('/advance') && round?.phase === 'PREVIEW') {
        setAutoSlots(null)
      }
      await refreshRound()
      setMessage('Action completed successfully.')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The action could not be completed.')
      await refreshRound().catch(() => undefined)
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    if (!session || !round || !['SOLVING', 'RESULTS'].includes(round.phase)) return
    void api<SettlementSummaryResponse>('/api/admin/rounds/current/settlement', {}, session.token)
      .then(setSummary)
      .catch((cause: unknown) => {
        if (!(cause instanceof ApiError && cause.code === 'INVALID_PHASE')) setError(errorMessage(cause))
      })
  }, [session?.token, round?.id, round?.phase])

  useEffect(() => {
    const phase = round?.phase
    if (phase === 'BIDDING') void loadCoverage()
    if (phase && ['SOLVING', 'RESULTS'].includes(phase)) void loadAllocation()
  }, [round?.phase, round?.id, loadCoverage, loadAllocation])

  const primary = !round
    ? { label: 'Start round 1', path: '/api/admin/rounds', method: 'POST' }
    : round.phase === 'RESULTS'
      ? { label: 'Start next round', path: '/api/admin/rounds', method: 'POST' }
      : round.phase === 'SETTLEMENT'
        ? { label: 'Run settlement', path: '/api/admin/rounds/current/settle', method: 'POST' }
        : round.phase === 'PREVIEW'
          ? { label: 'Open bidding', path: '/api/admin/rounds/current/advance', method: 'POST' }
          : round.phase === 'BIDDING'
            ? { label: 'Close bidding', path: '/api/admin/rounds/current/advance', method: 'POST' }
            : { label: 'Show results', path: '/api/admin/rounds/current/advance', method: 'POST' }

  return <>
    <div className="admin-control-hero">
      <div><p className="eyebrow">ADMINISTRATION · ROUND CONTROLS</p><h1>Round &<br />auction</h1>
        <p>MANAGE ROUND PHASES, BIDDING, AND SETTLEMENT</p></div>
      <div className="admin-live-indicator"><span className={round?.paused ? 'paused-dot' : ''} />{round?.paused ? 'ROUND PAUSED' : 'ROUND STATUS'}<small>ROUND {round?.number ?? '—'} · {round?.phase ?? 'NOT STARTED'}</small></div>
    </div>
    <div className="admin-command-stats">
      <div><span>ACTIVE ROUND</span><strong>{round ? `R-${String(round.number).padStart(2, '0')}` : '—'}</strong></div>
      <div><span>ROUND PROBLEMS</span><strong>{roundProblems.length.toString().padStart(2, '0')}</strong></div>
      <div><span>PHASE</span><strong className="command-phase">{round?.phase ?? 'IDLE'}</strong></div>
      <div><span>DEADLINE</span><strong className="command-deadline">{round?.biddingDeadline ? new Date(round.biddingDeadline).toLocaleString() : 'NOT SET'}</strong></div>
    </div>
    {error && <ErrorMessage message={error} />}{message && <p className="success-message">{message}</p>}
    <div className="admin-command-layout">
      <section className="command-main-panel">
        <div className="command-panel-heading"><div><p className="eyebrow">ROUND PHASES</p><h2>Round progress</h2></div>
          <span className="command-live-tag">CURRENT ROUND</span></div>
        <div className="command-pipeline">{(['PREVIEW', 'BIDDING', 'SETTLEMENT', 'SOLVING', 'RESULTS'] as RoundPhase[]).map((phase, index) => {
          const currentIndex = round ? ['PREVIEW', 'BIDDING', 'SETTLEMENT', 'SOLVING', 'RESULTS'].indexOf(round.phase) : -1
          return <div className={`pipeline-step ${index < currentIndex ? 'passed' : ''} ${phase === round?.phase ? 'current' : ''}`} key={phase}>
            <span>{String(index + 1).padStart(2, '0')}</span><strong>{phase}</strong><small>{index < currentIndex ? 'COMPLETE' : phase === round?.phase ? 'CURRENT PHASE' : 'PENDING'}</small>
          </div>
        })}</div>
        <div className="command-action-area">
          <div><span className="eyebrow">ADMIN ACTION</span><h3>{round ? primary.label : 'Start first round'}</h3>
            <p>{round?.paused ? 'Round is paused; resume it before advancing phases.' : round?.phase === 'SETTLEMENT' ? 'Calculate winners and clearing prices using the current bids.' : 'Advance the event state using the configured phase workflow.'}</p></div>
          <div className="command-action-buttons">
            <button className="command-primary-action" disabled={busy || Boolean(round?.paused)}
              onClick={() => void runAction(primary.path, primary.method)}>{busy ? 'EXECUTING…' : primary.label.toUpperCase()} <span>→</span></button>
            {round && <button className="command-secondary-action" disabled={busy} onClick={() =>
              void runAction(`/api/admin/rounds/current/${round.paused ? 'resume' : 'pause'}`)}>{round.paused ? 'RESUME ROUND' : 'PAUSE ROUND'}</button>}
          </div>
        </div>
        {round?.phase === 'PREVIEW' && roundProblems.length < (config?.winsPerRound ?? 3) && <div className="notice-box warning">At least {config?.winsPerRound ?? 3} problems are required before opening bidding.</div>}
        {round?.paused && <div className="notice-box warning">The round is paused; participants cannot submit bids.</div>}
        {canSetDeadline && <div className="command-deadline-editor"><div><strong>BIDDING CUTOFF</strong><span>{round?.biddingDeadline ? new Date(round.biddingDeadline).toLocaleString() : 'No cutoff configured'}</span></div>
          <label htmlFor="deadline">SET DEADLINE</label><input id="deadline" type="datetime-local" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
          <button className="command-secondary-action" disabled={busy || !deadline} onClick={() => {
            const date = new Date(deadline)
            if (date.getTime() <= Date.now()) { setError('Choose a deadline in the future.'); return }
            void runAction('/api/admin/rounds/current/bidding-deadline', 'PUT', { deadline: date.toISOString() })
          }}>SAVE DEADLINE</button>
          {round?.biddingDeadline && <button className="text-button" disabled={busy} onClick={() => void runAction('/api/admin/rounds/current/bidding-deadline', 'PUT', { deadline: null })}>Clear</button>}
        </div>}
        {round?.phase === 'PREVIEW' && <section className="admin-card round-tool-card">
          <div className="panel-heading"><div><p className="eyebrow">PREVIEW PHASE</p><h2>Allocate problem slots</h2></div>
            <button className="secondary-button" disabled={busy} onClick={() => void previewSlots()}>{autoSlots ? 'Refresh dry run' : 'Run dry run'}</button></div>
          <p className="muted">Preview the automatic distribution before applying it. The target is {config?.winsPerRound ?? 3} problems per participant.</p>
          {autoSlots && <>
            <div className="round-tool-summary"><span>{autoSlots.participants} completed profiles</span><span>{autoSlots.problemCount} problems</span><span>{autoSlots.slotsAssigned} / {autoSlots.slotsNeeded} slots assigned</span></div>
            {(autoSlots.problemCount < (config?.winsPerRound ?? 3) || autoSlots.slotsAssigned < autoSlots.slotsNeeded) &&
              <div className="notice-box warning">This round does not yet have enough problems or slots for the configured target. Add problems or adjust the slot distribution before opening bidding.</div>}
            <DataTable headers={['Problem', 'Proposed slots']} rows={autoSlots.slotsPerProblem.map((item) => [item.title, String(item.slots)])} />
            {autoSlots.dryRun && <button className="primary-button" disabled={busy} onClick={() => void applySlots()}>Apply slot allocation</button>}
          </>}
        </section>}
        {round?.phase === 'BIDDING' && <section className="admin-card round-tool-card">
          <div className="panel-heading"><div><p className="eyebrow">BIDDING PHASE</p><h2>Bid coverage</h2></div>
            <button className="secondary-button" disabled={busy} onClick={() => void loadCoverage()}>Refresh</button></div>
          {coverage && <><p className="muted">Participants with the fewest bids appear first. Each should bid on up to {coverage.problemCount} problems.</p>
            <DataTable headers={['Participant', 'HackerRank ID', 'Problems bid', 'Missing bids']} rows={coverage.participants.map((person) => [
              person.name || '—', person.hackerRankId || '—', String(person.bidCount), String(person.missingBids),
            ])} /></>}
        </section>}
        {round && ['SOLVING', 'RESULTS'].includes(round.phase) && allocation && <section className="admin-card round-tool-card">
          <div className="panel-heading"><div><p className="eyebrow">ROUND {allocation.roundNumber} · {allocation.winsPerRound} TARGET WINS</p><h2>Allocation</h2></div>
            <button className="secondary-button" disabled={busy} onClick={() => void loadAllocation()}>Refresh</button></div>
          <p className="muted">{allocation.atTargetCount} of {allocation.participantCount} participants are at the target.</p>
          <DataTable headers={['Participant', 'HackerRank ID', 'Wins', 'Missing', 'Unaffordable bids']} rows={allocation.participants.map((person) => [
            person.name || '—', person.hackerRankId || '—', String(person.wins), String(person.missing), String(person.unaffordableBids),
          ])} />
          <h3>Problem slots</h3>
          <DataTable headers={['Problem', 'Slots', 'Sold', 'Unsold', 'Unaffordable', 'Over capacity']} rows={allocation.problems.map((problem) => [
            problem.title, String(problem.slots), String(problem.sold), String(problem.unsold), String(problem.unaffordable), String(problem.overCapacity),
          ])} />
          {round.phase === 'SOLVING' && <>
            <div className="round-tool-actions">
              <button className="secondary-button" disabled={busy} onClick={() => void previewAutoFill()}>{autoFill ? 'Refresh auto-fill dry run' : 'Preview auto-fill'}</button>
              {autoFill?.dryRun && <button className="primary-button" disabled={busy || autoFill.assignments.length === 0} onClick={() => void applyAutoFill()}>Apply auto-fill</button>}
            </div>
            {autoFill?.dryRun && <>
              <p className="muted">{autoFill.assignments.length} proposed assignment(s); {autoFill.stillShort.length} participant(s) would remain below target.</p>
              <DataTable headers={['Participant', 'Problem', 'Reserve price']} rows={autoFill.assignments.map((assignment) => [
                assignment.name || assignment.hackerRankId || `User ${assignment.userId}`, assignment.problemTitle, `${assignment.price} coins`,
              ])} />
              {autoFill.stillShort.length > 0 && <DataTable headers={['Still short', 'Current wins', 'Missing']} rows={autoFill.stillShort.map((person) => [
                person.name || person.hackerRankId || `User ${person.userId}`, String(person.wins), String(person.missing),
              ])} />}
            </>}
            {allocation.participants.some((person) => person.missing > 0) && <div className="round-manual-assignment">
              <h3>Manual assignment</h3>
              <p className="muted">Assign one problem to a participant still below the target. The participant pays its reserve price.</p>
              <div className="inline-form">
                <label htmlFor="assignment-user">Participant</label>
                <select id="assignment-user" value={assignmentUserId} onChange={(event) => setAssignmentUserId(event.target.value)}>
                  <option value="">Select participant</option>
                  {allocation.participants.filter((person) => person.missing > 0).map((person) => <option key={person.userId} value={person.userId}>
                    {person.name || person.hackerRankId || `User ${person.userId}`} · {person.wins} wins · {person.coins} coins
                  </option>)}
                </select>
                <label htmlFor="assignment-problem">Problem</label>
                <select id="assignment-problem" value={assignmentProblemId} onChange={(event) => setAssignmentProblemId(event.target.value)}>
                  <option value="">Select problem</option>
                  {allocation.problems.map((problem) => <option key={problem.problemId} value={problem.problemId}>
                    {problem.title} · {problem.unsold} unsold · {problem.slots} slots
                  </option>)}
                </select>
                <button className="secondary-button" disabled={busy || !assignmentUserId || !assignmentProblemId} onClick={() => void assignProblem()}>Assign problem</button>
              </div>
            </div>}
          </>}
        </section>}
        {summary && <section className="settlement-results">
          <div className="command-panel-heading"><div><p className="eyebrow">SETTLEMENT RESPONSE</p><h2>Round {summary.roundNumber} complete</h2></div>
            <strong>{summary.totalCollected.toLocaleString()} coins collected</strong></div>
          <DataTable headers={['Problem', 'Bids', 'Winners', 'Unaffordable', 'Clearing price']} rows={summary.problems.map((p) =>
            [p.title, String(p.bidCount), String(p.winnerCount), String(p.unaffordableCount), `${p.clearingPrice.toLocaleString()} coins`])} />
          <p className="muted small-note">Summary returned by the settlement API. Individual bid rankings and bidder identities are not available here.</p>
        </section>}
      </section>
      <aside className="command-sidebar">
        <div className="command-panel-heading"><div><p className="eyebrow">ROUND {round?.number ?? '—'} / CONFIGURATION</p><h2>Problem bank</h2></div><strong>{roundProblems.length.toString().padStart(2, '0')}</strong></div>
        {roundProblems.length === 0 ? <p className="muted">No problems attached to the active round.</p> : roundProblems.map((problem) =>
          <article className="command-problem" key={problem.id}><div><span className={`tier tier-${problem.tier.toLowerCase()}`}>{problem.tier}</span></div>
            <h3>{problem.title}</h3><p>{problem.category}</p><footer><span>{problem.slots} winner slot{problem.slots === 1 ? '' : 's'}</span><strong>Reserve: {problem.basePrice.toLocaleString()} coins</strong></footer></article>)}
        <div className="command-config-note"><span>HINT PRICE</span><strong>{config?.hintPrice ?? '—'} coins</strong>
          <span>SETTLEMENT SUMMARY</span><p>The summary shows bid and winner counts and clearing prices after settlement. It does not include a ranked list of bidders.</p></div>
      </aside>
    </div>
  </>
}

interface ProblemForm {
  title: string
  category: string
  tier: Tier
  slots: string
  hackerRankLink: string
  basePrice: string
  teaser: string
  roundId: string
}

const emptyProblem: ProblemForm = {
  title: '', category: '', tier: 'BRONZE', slots: '1', hackerRankLink: '',
  basePrice: '', teaser: '', roundId: '',
}

function ProblemBankPage() {
  const { session, round, config } = useAuth()
  const [problems, setProblems] = useState<AdminProblemResponse[]>([])
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [form, setForm] = useState<ProblemForm>(emptyProblem)
  const [preview, setPreview] = useState('')
  const [hints, setHints] = useState<Record<number, { hintText: string; password: string }>>({})
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [winners, setWinners] = useState<WinnerResponse[] | null>(null)

  async function loadProblems() {
    if (!session) return
    setLoading(true)
    try {
      const rows = await api<AdminProblemResponse[]>('/api/admin/problems', {}, session.token)
      setProblems(rows)
    } catch (cause) { setError(errorMessage(cause)) }
    finally { setLoading(false) }
  }

  useEffect(() => { void loadProblems() }, [session?.token])
  const selected = problems.find((problem) => problem.id === selectedId)

  function selectProblem(problem: AdminProblemResponse) {
    setSelectedId(problem.id)
    setForm({
      title: problem.title, category: problem.category, tier: problem.tier,
      slots: String(problem.slots), hackerRankLink: problem.hackerRankLink,
      basePrice: String(problem.basePrice), teaser: problem.teaser ?? '',
      roundId: problem.roundId === null ? '' : String(problem.roundId),
    })
    setPreview(problem.preview ?? '')
    setHints(Object.fromEntries(problem.hints.map((hint) => [hint.corruptionLevel, {
      hintText: hint.hintText, password: hint.password,
    }])))
    setWinners(null)
    setError('')
    setMessage('')
  }

  function newProblem() {
    setSelectedId(null)
    setForm(emptyProblem)
    setPreview('')
    setHints({})
    setWinners(null)
    setError('')
    setMessage('')
  }

  async function saveProblem(event: React.FormEvent) {
    event.preventDefault()
    if (!session) return
    setBusy(true)
    setError('')
    setMessage('')
    const body = {
      title: form.title.trim(),
      category: form.category.trim(),
      tier: form.tier,
      slots: Number(form.slots),
      hackerRankLink: form.hackerRankLink.trim(),
      basePrice: form.basePrice === '' ? null : Number(form.basePrice),
      teaser: form.teaser.trim() || null,
      roundId: form.roundId === '' ? null : Number(form.roundId),
    }
    try {
      const saved = await api<AdminProblemResponse>(
        selectedId ? `/api/admin/problems/${selectedId}` : '/api/admin/problems',
        { method: selectedId ? 'PUT' : 'POST', body: JSON.stringify(body) },
        session.token,
      )
      await loadProblems()
      selectProblem(saved)
      setMessage('Problem saved.')
    } catch (cause) { setError(errorMessage(cause)) }
    finally { setBusy(false) }
  }

  async function saveHint(level: number) {
    if (!session || !selectedId) return
    setBusy(true)
    setError('')
    try {
      const saved = await api<HintResponse>(`/api/admin/problems/${selectedId}/hints/${level}`, {
        method: 'PUT',
        body: JSON.stringify(hints[level] ?? { hintText: '', password: '' }),
      }, session.token)
      setHints((current) => ({ ...current, [level]: { hintText: saved.hintText, password: saved.password } }))
      setMessage(`Level ${level} hint saved.`)
    } catch (cause) { setError(errorMessage(cause)) }
    finally { setBusy(false) }
  }

  async function savePreview() {
    if (!session || !selectedId) return
    setBusy(true)
    setError('')
    setMessage('')
    try {
      const saved = await api<AdminProblemResponse>(`/api/admin/problems/${selectedId}/preview`, {
        method: 'PUT',
        body: JSON.stringify({ preview: preview.trim() || null }),
      }, session.token)
      setProblems((current) => current.map((problem) => problem.id === saved.id ? saved : problem))
      setPreview(saved.preview ?? '')
      setMessage('Question preview saved.')
    } catch (cause) { setError(errorMessage(cause)) }
    finally { setBusy(false) }
  }

  async function removeProblem() {
    if (!session || !selectedId || !window.confirm(`Delete "${selected?.title}"? This cannot be undone.`)) return
    setBusy(true)
    setError('')
    try {
      await api<void>(`/api/admin/problems/${selectedId}`, { method: 'DELETE' }, session.token)
      newProblem()
      await loadProblems()
      setMessage('Problem deleted.')
    } catch (cause) { setError(errorMessage(cause)) }
    finally { setBusy(false) }
  }

  async function loadWinners() {
    if (!session || !selectedId) return
    setBusy(true)
    try {
      setWinners(await api<WinnerResponse[]>(`/api/admin/problems/${selectedId}/winners`, {}, session.token))
    } catch (cause) { setError(errorMessage(cause)) }
    finally { setBusy(false) }
  }

  const isLocked = Boolean(selected?.roundId && round && selected.roundId === round.id && round.phase !== 'PREVIEW')
  if (loading) return <Loading />

  return <>
    <PageHeading eyebrow="ADMINISTRATION" title="Problem bank" description="Create problems, set reserve prices, and maintain three hint versions." />
    {error && <ErrorMessage message={error} />}{message && <p className="success-message">{message}</p>}
    <div className="split-layout">
      <section className="admin-card problem-list-panel">
        <div className="panel-heading"><h2>Problems ({problems.length})</h2><button className="secondary-button" onClick={newProblem}>New problem</button></div>
        {problems.length === 0 ? <p className="muted">No problems yet. Create one to begin.</p> : problems.map((problem) =>
          <button key={problem.id} className={`problem-list-item ${problem.id === selectedId ? 'selected' : ''}`} onClick={() => selectProblem(problem)}>
            <span className={`tier tier-${problem.tier.toLowerCase()}`}>{problem.tier}</span><strong>{problem.title}</strong>
            <small>{problem.roundId ? `Round ${problem.roundId}` : 'Bank only'} · {problem.slots} slots</small>
          </button>)}
      </section>
      <div className="editor-column">
        <section className="admin-card">
          <div className="panel-heading"><h2>{selected ? 'Edit problem' : 'Create problem'}</h2>{selected && <button className="danger-button" disabled={busy || isLocked} onClick={() => void removeProblem()}>Delete</button>}</div>
          {isLocked && <div className="notice-box warning">Locked: this problem’s round has moved past preview. Hints remain editable.</div>}
          <form className="form-grid" onSubmit={(event) => void saveProblem(event)}>
            <label>Title<input required maxLength={150} value={form.title} disabled={isLocked} onChange={(e) => setForm({ ...form, title: e.target.value })} /></label>
            <label>Category<input required maxLength={60} value={form.category} disabled={isLocked} onChange={(e) => setForm({ ...form, category: e.target.value })} /></label>
            <label>Tier<select value={form.tier} disabled={isLocked} onChange={(e) => setForm({ ...form, tier: e.target.value as Tier })}>{TIERS.map((tier) => <option key={tier}>{tier}</option>)}</select></label>
            <label>Winner slots<input type="number" min="1" max="100" required value={form.slots} disabled={isLocked} onChange={(e) => setForm({ ...form, slots: e.target.value })} /></label>
            <label className="form-span">HackerRank link<input type="url" required maxLength={500} pattern="https?://.+" value={form.hackerRankLink} disabled={isLocked} onChange={(e) => setForm({ ...form, hackerRankLink: e.target.value })} /></label>
            <label>Reserve price<input type="number" min="0" step="1" placeholder={`Tier default: ${config ? priceForTier(config, form.tier) : '—'}`} value={form.basePrice} disabled={isLocked} onChange={(e) => setForm({ ...form, basePrice: e.target.value })} /></label>
            <label>Attach to round<select value={form.roundId} disabled={isLocked} onChange={(e) => setForm({ ...form, roundId: e.target.value })}>
              <option value="">Problem bank only</option>
              {form.roundId && form.roundId !== String(round?.id) && <option value={form.roundId}>Keep existing round assignment</option>}
              {round && <option value={String(round.id)} disabled={round.phase !== 'PREVIEW'}>
                Current round · Round {round.number}{round.phase === 'PREVIEW' ? '' : ' (not in preview)'}
              </option>}
            </select></label>
            <p className="muted form-span">{round
              ? `Choose whether this problem stays in the bank or is attached to Round ${round.number}.`
              : 'No round has started yet. This problem will be saved to the bank.'}</p>
            <label className="form-span">Teaser<input maxLength={500} value={form.teaser} disabled={isLocked} onChange={(e) => setForm({ ...form, teaser: e.target.value })} /></label>
            <div className="form-actions"><button className="primary-button" disabled={busy || isLocked}>{busy ? 'Saving…' : 'Save problem'}</button></div>
          </form>
          {selected && <div className="problem-preview-editor">
            <label htmlFor="question-preview">Question preview<textarea id="question-preview" maxLength={4000} rows={6} value={preview}
              disabled={isLocked} onChange={(event) => setPreview(event.target.value)} /></label>
            <button className="secondary-button" disabled={busy || isLocked} onClick={() => void savePreview()}>Save question preview</button>
            <p className="muted">This plain-text preview is shown to participants before bidding. The HackerRank link remains hidden.</p>
          </div>}
        </section>

        {selected && <section className="admin-card"><div className="panel-heading"><h2>Hint versions</h2><span className="muted">Hints can be edited at any time</span></div>
          {[1, 2, 3].map((level) => <div className="hint-editor" key={level}>
            <div className="hint-heading"><h3>Corruption level {level}</h3><span className={hints[level] ? 'status status-won' : 'status status-pending'}>{hints[level] ? 'READY' : 'EMPTY'}</span></div>
            <label>Hint text<textarea maxLength={2000} rows={3} value={hints[level]?.hintText ?? ''} onChange={(e) => setHints((current) => ({ ...current, [level]: { ...current[level], hintText: e.target.value, password: current[level]?.password ?? '' } }))} /></label>
            <label>Password<input maxLength={100} value={hints[level]?.password ?? ''} onChange={(e) => setHints((current) => ({ ...current, [level]: { hintText: current[level]?.hintText ?? '', password: e.target.value } }))} /></label>
            <button className="secondary-button" disabled={busy} onClick={() => void saveHint(level)}>Save level {level} hint</button>
          </div>)}
          <button className="secondary-button" disabled={busy} onClick={() => void loadWinners()}>Load winners</button>
          {winners && <DataTable headers={['Participant', 'HackerRank ID', 'Price paid']} rows={winners.map((winner) => [winner.name || '—', winner.hackerRankId || '—', `${winner.pricePaid} coins`])} />}
        </section>}
      </div>
    </div>
  </>
}

function ParticipantsPage() {
  const { session, config } = useAuth()
  const [participants, setParticipants] = useState<MeResponse[]>([])
  const [problems, setProblems] = useState<AdminProblemResponse[]>([])
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<number | null>(null)
  const [bulkAmount, setBulkAmount] = useState('')
  const [bulkReason, setBulkReason] = useState('')
  const [bulkBusy, setBulkBusy] = useState(false)
  const [bulkRequestId, setBulkRequestId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const requestId = useRef(0)

  const token = session?.token
  const loadData = useCallback(async (search = query) => {
    if (!token) return
    const currentRequest = ++requestId.current
    try {
      const params = new URLSearchParams()
      if (search.trim()) params.set('q', search.trim())
      const searchSuffix = params.toString() ? `?${params}` : ''
      const [users, bank] = await Promise.all([
        api<MeResponse[]>(`/api/admin/users${searchSuffix}`, {}, token),
        api<AdminProblemResponse[]>('/api/admin/problems', {}, token),
      ])
      if (currentRequest !== requestId.current) return
      setParticipants(users)
      setProblems(bank)
      setError('')
    } catch (cause) {
      if (currentRequest === requestId.current) setError(errorMessage(cause))
    } finally {
      if (currentRequest === requestId.current) setLoading(false)
    }
  }, [token, query])
  useEffect(() => { void loadData() }, [loadData])

  const visible = participants
  const selected = visible.find((person) => person.id === selectedId) ?? visible[0] ?? null

  async function walletAction(person: MeResponse, title: string, endpoint: string, body: unknown, amount: number) {
    if (!session) return
    const amountLabel = `${amount >= 0 ? '+' : ''}${amount.toLocaleString()} coins`
    if (!window.confirm(`${title}\n\n${person.name || person.email} (${person.hackerRankId || 'no HackerRank ID'})\n${amountLabel}\nBalance: ${person.coins.toLocaleString()} coins\n\nContinue?`)) return
    setBusyId(person.id)
    setError('')
    setMessage('')
    try {
      const result = await api<LedgerEntryResponse | { entry: LedgerEntryResponse; corruptionLevel: number }>(
        endpoint, { method: 'POST', body: JSON.stringify(body) }, session.token,
      )
      const entry = 'entry' in result ? result.entry : result
      setMessage(`${title} complete. New balance: ${entry.balanceAfter.toLocaleString()} coins.`)
      await loadData(query)
    } catch (cause) { setError(errorMessage(cause)) }
    finally { setBusyId(null) }
  }

  async function giveHint(person: MeResponse) {
    if (!session || problems.length === 0) {
      setError('Create a problem before issuing a hint.')
      return
    }
    const choice = window.prompt(`Enter the problem ID for the hint:\n${problems.map((problem) => `${problem.id}: ${problem.title}`).join('\n')}`)
    if (!choice) return
    const problem = problems.find((item) => item.id === Number(choice))
    if (!problem) { setError('That problem ID was not found.'); return }
    try {
      const hint = await api<HintResponse>(`/api/admin/users/${person.id}/hints/${problem.id}`, {}, session.token)
      window.alert(`Level ${hint.corruptionLevel} hint for ${person.name || person.email}\n\n${hint.hintText}\n\nPassword: ${hint.password}`)
    } catch (cause) { setError(errorMessage(cause)); return }
    const problemNumber = Number(window.prompt('Problem number for the transaction label:', '1'))
    if (!Number.isInteger(problemNumber) || problemNumber < 1) return
    await walletAction(person, `Deduct hint fee for ${problem.title}`, '/api/admin/wallet/hint-deduction',
      { userId: person.id, problemNumber }, -(config?.hintPrice ?? 0))
  }

  async function customAmount(person: MeResponse) {
    const amount = Number(window.prompt(`Custom coin change for ${person.name || person.email}.\nPositive credits; negative deducts.`))
    if (!Number.isSafeInteger(amount) || amount === 0) return
    const reason = window.prompt('Reason (shown in participant history):')
    if (!reason?.trim()) return
    await walletAction(person, 'Apply custom coin change', '/api/admin/wallet/custom',
      { userId: person.id, amount, reason: reason.trim() }, amount)
  }

  async function setLevel(person: MeResponse) {
    if (!session) return
    const answer = Number(window.prompt(`Set corruption level for ${person.name || person.email} (1–3):`, String(person.corruptionLevel)))
    if (!Number.isInteger(answer) || answer < 1 || answer > 3) return
    setBusyId(person.id)
    try {
      await api<MeResponse>(`/api/admin/users/${person.id}/corruption-level`, {
        method: 'PUT', body: JSON.stringify({ level: answer }),
      }, session.token)
      setMessage(`Corruption level updated for ${person.name || person.email}.`)
      await loadData()
    } catch (cause) { setError(errorMessage(cause)) }
    finally { setBusyId(null) }
  }

  async function revoke(person: MeResponse) {
    if (!session || !window.confirm(`Sign ${person.name || person.email} out on every device? Their existing tokens will stop working.`)) return
    setBusyId(person.id)
    try {
      await api<void>(`/api/admin/users/${person.id}/revoke-sessions`, { method: 'POST' }, session.token)
      setMessage(`${person.name || person.email} has been signed out everywhere.`)
    } catch (cause) { setError(errorMessage(cause)) }
    finally { setBusyId(null) }
  }

  async function creditEveryone() {
    if (!session) return
    const amount = Number(bulkAmount)
    const reason = bulkReason.trim()
    if (!Number.isSafeInteger(amount) || amount < 1 || amount > 1_000_000) {
      setError('Enter a whole-number credit amount from 1 to 1,000,000 coins.')
      return
    }
    if (!reason || reason.length > 200) {
      setError('Enter a reason of 1 to 200 characters.')
      return
    }
    setBulkBusy(true)
    setError('')
    setMessage('')
    try {
      const allParticipants = await api<MeResponse[]>('/api/admin/users', {}, session.token)
      const previousRequestId = bulkRequestId
      const requestId = previousRequestId ?? crypto.randomUUID()
      setBulkRequestId(requestId)
      if (!window.confirm(`Credit all ${allParticipants.length} participant(s) ${amount.toLocaleString()} coins each?\nReason: ${reason}\nTotal: ${(allParticipants.length * amount).toLocaleString()} coins\n\nThis action cannot be undone as one bulk action; ledger entries must be reversed individually.`)) {
        if (!previousRequestId) setBulkRequestId(null)
        return
      }
      const result = await api<CreditAllResponse>('/api/admin/wallet/credit-all', {
        method: 'POST',
        body: JSON.stringify({ amount, reason, requestId }),
      }, session.token)
      setBulkRequestId(null)
      setMessage(`Credited ${result.participants} participants ${result.amountEach.toLocaleString()} coins each (${result.totalCredited.toLocaleString()} total).`)
      await loadData(query)
    } catch (cause) { setError(errorMessage(cause)) }
    finally { setBulkBusy(false) }
  }

  if (loading) return <Loading />
  return <>
    <div className="roster-hero">
      <div><p className="eyebrow">ADMINISTRATION · PARTICIPANT MANAGEMENT</p><h1>Participants</h1>
        <p>PARTICIPANT ACCOUNTS, WALLETS, AND CORRUPTION LEVELS</p></div>
      <div className="roster-total"><span>{query.trim() ? 'MATCHES' : 'PARTICIPANTS'}</span><strong>{String(participants.length).padStart(3, '0')}</strong><small>ACCOUNTS</small></div>
    </div>
    {error && <ErrorMessage message={error} />}{message && <p className="success-message">{message}</p>}
    <section className="admin-card bulk-credit-card">
      <div className="panel-heading"><div><p className="eyebrow">WALLET ACTION</p><h2>Credit everyone</h2></div></div>
      <p className="muted">Credits every participant account, not just the current search results. Run after sign-ups close.</p>
      <div className="inline-form">
        <label htmlFor="bulk-credit-amount">Coins per participant</label>
        <input id="bulk-credit-amount" type="number" min="1" max="1000000" step="1" value={bulkAmount} disabled={bulkBusy || Boolean(bulkRequestId)} onChange={(event) => setBulkAmount(event.target.value)} />
        <label htmlFor="bulk-credit-reason">Reason</label>
        <input id="bulk-credit-reason" maxLength={200} value={bulkReason} disabled={bulkBusy || Boolean(bulkRequestId)} onChange={(event) => setBulkReason(event.target.value)} />
        <button className="primary-button" disabled={bulkBusy || !bulkAmount || !bulkReason.trim()} onClick={() => void creditEveryone()}>
          {bulkBusy ? 'Processing…' : bulkRequestId ? 'Retry credit request' : 'Credit all participants'}
        </button>
      </div>
    </section>
    <div className="roster-dashboard">
      <section className="roster-table-panel">
        <div className="roster-panel-heading"><div><p className="eyebrow">REGISTERED ACCOUNTS</p><h2>Participant roster <span>{visible.length}</span></h2></div>
          <label className="roster-search"><span>⌕</span><input id="participant-search" aria-label="Search participants" placeholder="Search name / HackerRank ID" value={query} onChange={(e) => setQuery(e.target.value)} /></label></div>
        <p className="roster-search-note">Search matches are provided by the server. Email is not part of this search.</p>
        {visible.length === 0 ? <p className="muted roster-empty">No participants match this search.</p> : <div className="roster-table-scroll"><table className="roster-table"><thead><tr><th>PARTICIPANT</th><th>HACKERRANK ID</th><th>WALLET</th><th>CORRUPTION LEVEL</th><th>PROFILE</th></tr></thead>
          <tbody>{visible.map((person, index) => <tr key={person.id} className={selected?.id === person.id ? 'selected' : ''} onClick={() => setSelectedId(person.id)}>
            <td><span className="roster-index">{String(index + 1).padStart(2, '0')}</span><strong>{person.name || 'Name not set'}</strong><small>{person.email}</small></td>
            <td>{person.hackerRankId || '—'}</td><td>{person.coins.toLocaleString()} <small>coins</small></td>
            <td><span className={`roster-level level-${person.corruptionLevel}`}>LEVEL {person.corruptionLevel}</span></td>
            <td>{person.profileComplete ? 'Complete' : 'Incomplete'}</td>
          </tr>)}</tbody></table></div>}
        <div className="roster-footnote"><span>PARTICIPANT ACCOUNTS</span><span>SERVER-SIDE SEARCH</span></div>
      </section>
      {selected && <aside className="roster-action-panel">
        <div className="selected-participant">
          <p className="eyebrow">SELECTED PARTICIPANT · USER {selected.id}</p>
          <div className="participant-avatar">{(selected.name || selected.email).slice(0, 1).toUpperCase()}</div>
          <h2>{selected.name || 'Name not set'}</h2><p>{selected.hackerRankId || 'No HackerRank ID'}</p>
          <small>{selected.email}</small>
        </div>
        <div className="roster-wallet-display"><span>WALLET BALANCE</span><strong>{selected.coins.toLocaleString()} <small>coins</small></strong>
          <div><span>CORRUPTION LEVEL</span><strong className={`roster-level level-${selected.corruptionLevel}`}>LVL {selected.corruptionLevel}</strong></div>
        </div>
        <div className="roster-action-group"><p className="eyebrow">CREDIT SOLVE REWARD</p><div className="roster-reward-buttons">
          {TIERS.map((tier) => <button key={tier} disabled={busyId === selected.id} onClick={() => void walletAction(selected, `Credit ${tier.toLowerCase()} solve reward`, '/api/admin/wallet/credit-preset',
            { userId: selected.id, tier }, rewardForTier(config, tier))}><span>{tier}</span><strong>+{rewardForTier(config, tier)}</strong><small>coins</small></button>)}
        </div></div>
        <div className="roster-action-group"><p className="eyebrow">CORRUPTION & ASSISTANCE</p>
          <button className="roster-action-button" disabled={busyId === selected.id || selected.corruptionLevel >= (config?.maxCorruptionLevel ?? 3)}
            onClick={() => void walletAction(selected, 'Devil’s deal', '/api/admin/wallet/devil-deal', { userId: selected.id }, config?.devil.dealPayout ?? 0)}>
            <span>DEVIL’S DEAL</span><strong>+{config?.devil.dealPayout ?? 0} coins · level +1</strong></button>
          <button className="roster-action-button" disabled={busyId === selected.id || selected.corruptionLevel <= (config?.minCorruptionLevel ?? 1) || selected.coins < (config?.devil.redemptionCost ?? 0)}
            onClick={() => void walletAction(selected, 'Redemption', '/api/admin/wallet/redemption', { userId: selected.id }, -(config?.devil.redemptionCost ?? 0))}>
            <span>REDEMPTION</span><strong>−{config?.devil.redemptionCost ?? 0} coins · level −1</strong></button>
          <button className="roster-action-button" disabled={busyId === selected.id} onClick={() => void giveHint(selected)}>
            <span>PROVIDE HINT</span><strong>Fee: {config?.hintPrice ?? 0} coins</strong></button>
        </div>
        <div className="roster-action-group roster-utility-actions"><p className="eyebrow">ACCOUNT & WALLET</p>
          <button className="roster-action-button" disabled={busyId === selected.id} onClick={() => void customAmount(selected)}><span>CUSTOM WALLET ADJUSTMENT</span><strong>ENTER AMOUNT & REASON</strong></button>
          <button className="roster-action-button" disabled={busyId === selected.id} onClick={() => void setLevel(selected)}><span>SET CORRUPTION LEVEL</span><strong>LEVEL {selected.corruptionLevel} / {config?.maxCorruptionLevel ?? 3}</strong></button>
          <button className="roster-action-button danger" disabled={busyId === selected.id} onClick={() => void revoke(selected)}><span>REVOKE ALL SESSIONS</span><strong>SIGN OUT EVERYWHERE</strong></button>
        </div>
        <div className="notice-box">This page supports individual participant accounts. Use the Ledger page to review wallet transactions.</div>
      </aside>}
    </div>
  </>
}

function LedgerPage() {
  const { session } = useAuth()
  const [entries, setEntries] = useState<AdminLedgerEntryResponse[]>([])
  const [participants, setParticipants] = useState<MeResponse[]>([])
  const [userId, setUserId] = useState('')
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<number | null>(null)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  async function loadLedger(id = userId) {
    if (!session) return
    setLoading(true)
    setError('')
    try {
      const query = new URLSearchParams({ limit: '100' })
      if (id) query.set('userId', id)
      const data = await api<AdminLedgerEntryResponse[]>(`/api/admin/ledger?${query}`, {}, session.token)
      setEntries(data)
    } catch (cause) { setError(errorMessage(cause)) }
    finally { setLoading(false) }
  }
  useEffect(() => {
    if (!session) return
    void Promise.all([
      api<MeResponse[]>('/api/admin/users', {}, session.token).then(setParticipants),
      loadLedger(''),
    ]).catch((cause: unknown) => setError(errorMessage(cause)))
  }, [session?.token])

  async function undo(entry: AdminLedgerEntryResponse) {
    if (!session) return
    const reason = window.prompt(`Reason for reversing ${entry.amount} coins for ${entry.userName || 'participant'}:`)
    if (!reason?.trim()) return
    if (!window.confirm(`Reverse ledger entry #${entry.id} for ${entry.userName || 'participant'}?\nReason: ${reason}`)) return
    setBusyId(entry.id)
    try {
      await api<LedgerEntryResponse>(`/api/admin/wallet/undo/${entry.id}`, {
        method: 'POST', body: JSON.stringify({ reason: reason.trim() }),
      }, session.token)
      setMessage(`Entry #${entry.id} reversed.`)
      await loadLedger()
    } catch (cause) { setError(errorMessage(cause)) }
    finally { setBusyId(null) }
  }

  return <>
    <PageHeading eyebrow="ADMINISTRATION" title="Coin history" description="Review wallet changes. Correct eligible mistakes by creating a reversal; original entries are kept." />
    {error && <ErrorMessage message={error} />}{message && <p className="success-message">{message}</p>}
    <section className="admin-card">
      <div className="inline-form"><label htmlFor="ledger-person">Filter participant</label>
        <select id="ledger-person" value={userId} onChange={(e) => { setUserId(e.target.value); void loadLedger(e.target.value) }}>
          <option value="">All participants</option>{participants.map((p) => <option value={p.id} key={p.id}>{p.name || p.email}</option>)}</select>
        <button className="secondary-button" disabled={loading} onClick={() => void loadLedger()}>Refresh</button></div>
      {loading ? <Loading /> : entries.length === 0 ? <p className="muted">No ledger entries found.</p> :
        <div className="table-wrap"><table><thead><tr><th>Time</th><th>Participant</th><th>Type</th><th>Change</th><th>Balance</th><th>Reason</th><th>Actor</th><th>Action</th></tr></thead>
          <tbody>{entries.map((entry) => <tr key={entry.id}><td>{new Date(entry.createdAt).toLocaleString()}</td><td>{entry.userName || `#${entry.userId}`}</td>
            <td>{entry.type}</td><td className={entry.amount >= 0 ? 'positive' : 'negative'}>{entry.amount > 0 ? '+' : ''}{entry.amount}</td>
            <td>{entry.balanceAfter.toLocaleString()}</td><td>{entry.reason}</td><td>{entry.actorName || 'System'}</td>
            <td>{entry.type !== 'REVERSAL' && !entry.undone ? <button className="text-button danger-text" disabled={busyId === entry.id} onClick={() => void undo(entry)}>Undo</button> : entry.undone ? 'Undone' : '—'}</td></tr>)}</tbody></table></div>}
    </section>
  </>
}

function AuditPage() {
  const { session } = useAuth()
  const [entries, setEntries] = useState<AuditLogResponse[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  useEffect(() => {
    if (!session) return
    void api<AuditLogResponse[]>('/api/admin/audit?limit=100', {}, session.token)
      .then(setEntries).catch((cause: unknown) => setError(errorMessage(cause))).finally(() => setLoading(false))
  }, [session?.token])
  return <>
    <PageHeading eyebrow="ADMINISTRATION" title="Audit log" description="Read-only record of admin actions, including refused requests." />
    {error && <ErrorMessage message={error} />}
    <section className="admin-card">{loading ? <Loading /> : entries.length === 0 ? <p className="muted">No audit entries yet.</p> :
      <div className="table-wrap"><table><thead><tr><th>Time</th><th>Admin</th><th>Email</th><th>Request</th><th>Path</th><th>Status</th></tr></thead>
        <tbody>{entries.map((entry) => <tr key={entry.id}><td>{new Date(entry.createdAt).toLocaleString()}</td><td>{entry.actorName || '—'}</td>
          <td>{entry.actorEmail}</td><td>{entry.method}</td><td className="audit-path">{entry.path}</td>
          <td><span className={`status ${entry.status < 400 ? 'status-won' : 'status-unaffordable'}`}>{entry.status}</span></td></tr>)}</tbody></table></div>}
    </section>
  </>
}

export function DataTable({ headers, rows }: { headers: string[]; rows: string[][] }) {
  if (rows.length === 0) return <p className="muted">No records.</p>
  return <div className="table-wrap"><table><thead><tr>{headers.map((header) => <th key={header}>{header}</th>)}</tr></thead>
    <tbody>{rows.map((row, index) => <tr key={index}>{row.map((cell, cellIndex) => <td key={cellIndex}>{cell}</td>)}</tr>)}</tbody></table></div>
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'The request could not be completed.'
}

function priceForTier(config: GameConfigResponse, tier: Tier) {
  return config.basePrice[tier.toLowerCase() as 'bronze' | 'silver' | 'gold']
}

function rewardForTier(config: GameConfigResponse | null, tier: Tier) {
  if (!config) return 0
  return config.solveReward[tier.toLowerCase() as 'bronze' | 'silver' | 'gold']
}
