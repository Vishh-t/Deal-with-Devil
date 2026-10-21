export type Role = 'PARTICIPANT' | 'ADMIN'
export type Tier = 'BRONZE' | 'SILVER' | 'GOLD'
export type RoundPhase = 'PREVIEW' | 'BIDDING' | 'SETTLEMENT' | 'SOLVING' | 'RESULTS'
export type BidStatus = 'PENDING' | 'WON' | 'LOST' | 'UNAFFORDABLE'
export type LedgerType =
  | 'PRESET_CREDIT'
  | 'HINT_DEDUCTION'
  | 'BID_SETTLEMENT'
  | 'DEVIL_DEAL'
  | 'REDEMPTION'
  | 'CUSTOM'
  | 'REVERSAL'
export type EventType =
  | 'BID_WON'
  | 'BID_LOST'
  | 'BID_UNAFFORDABLE'
  | 'PRESET_CREDIT'
  | 'HINT_DEDUCTION'
  | 'DEVIL_DEAL'
  | 'REDEMPTION'
  | 'CUSTOM_ADJUSTMENT'
  | 'REVERSAL'
  | 'ROUND_STARTED'
  | 'PHASE_CHANGED'

export interface AuthResponse {
  token: string
  expiresAt: string
  profileComplete: boolean
  role: Role
}

export interface MeResponse {
  id: number
  email: string
  name: string | null
  hackerRankId: string | null
  role: Role
  corruptionLevel: number
  coins: number
  profileComplete: boolean
}

export interface RoundResponse {
  id: number
  number: number
  phase: RoundPhase
  paused: boolean
  phaseChangedAt: string
  biddingDeadline: string | null
  serverTime: string
}

export interface GameConfigResponse {
  basePrice: { bronze: number; silver: number; gold: number }
  solveReward: { bronze: number; silver: number; gold: number }
  hintPrice: number
  devil: { dealPayout: number; redemptionCost: number }
  minCorruptionLevel: number
  maxCorruptionLevel: number
  winsPerRound: number
}

export interface ProblemPreviewResponse {
  id: number
  title: string
  category: string
  tier: Tier
  teaser: string | null
  preview: string | null
  slots: number
  basePrice: number
}

export interface HintResponse {
  corruptionLevel: number
  hintText: string
  password: string
}

export interface AdminProblemResponse {
  id: number
  title: string
  category: string
  tier: Tier
  slots: number
  hackerRankLink: string
  basePrice: number
  teaser: string | null
  preview: string | null
  roundId: number | null
  hints: HintResponse[]
}

export interface AutoSlotsResponse {
  dryRun: boolean
  participants: number
  problemCount: number
  slotsNeeded: number
  slotsAssigned: number
  slotsPerProblem: { problemId: number; title: string; slots: number }[]
}

export interface BidCoverageResponse {
  roundId: number
  roundNumber: number
  problemCount: number
  winsPerRound: number
  participants: {
    userId: number
    name: string | null
    hackerRankId: string | null
    bidCount: number
    missingBids: number
  }[]
}

export interface AllocationViewResponse {
  roundId: number
  roundNumber: number
  winsPerRound: number
  participantCount: number
  atTargetCount: number
  participants: {
    userId: number
    name: string | null
    hackerRankId: string | null
    coins: number
    wins: number
    unaffordableBids: number
    missing: number
    excess: number
    atTarget: boolean
  }[]
  problems: {
    problemId: number
    title: string
    slots: number
    sold: number
    unaffordable: number
    unsold: number
    overCapacity: number
  }[]
}

export interface AutoFillResponse {
  dryRun: boolean
  winsPerRound: number
  assignments: {
    userId: number
    name: string | null
    hackerRankId: string | null
    problemId: number
    problemTitle: string
    price: number
  }[]
  stillShort: {
    userId: number
    name: string | null
    hackerRankId: string | null
    wins: number
    missing: number
  }[]
}

export interface ManualAssignmentResponse {
  userId: number
  problemId: number
  problemTitle: string
  pricePaid: number
  balanceAfter: number
  winsNow: number
  overCapacity: boolean
}

export interface CreditAllResponse {
  participants: number
  amountEach: number
  totalCredited: number
}

export interface BidResponse {
  problemId: number
  problemTitle: string
  amount: number
  status: BidStatus
  pricePaid: number | null
  hackerRankLink: string | null
  submittedAt: string
}

export interface LedgerEntryResponse {
  id: number
  type: LedgerType
  amount: number
  balanceAfter: number
  reason: string
  reversalOf: number | null
  createdAt: string
}

export interface AdminLedgerEntryResponse extends LedgerEntryResponse {
  userId: number
  userName: string | null
  actorName: string | null
  undone: boolean
}

export interface EventResponse {
  id: number
  type: EventType
  broadcast: boolean
  message: string
  amount: number | null
  balanceAfter: number | null
  corruptionLevel: number | null
  problemId: number | null
  createdAt: string
}

export interface LeaderboardEntry {
  rank: number
  userId: number
  name: string | null
  hackerRankId: string | null
  coins: number
}

export interface SettlementSummaryResponse {
  roundId: number
  roundNumber: number
  totalCollected: number
  problems: {
    problemId: number
    title: string
    bidCount: number
    winnerCount: number
    unaffordableCount: number
    clearingPrice: number
  }[]
}

export interface AuditLogResponse {
  id: number
  actorId: number
  actorName: string | null
  actorEmail: string
  method: string
  path: string
  status: number
  createdAt: string
}

export interface WinnerResponse {
  userId: number
  name: string | null
  hackerRankId: string | null
  pricePaid: number
}

export interface ApiErrorResponse {
  timestamp?: string
  status: number
  code: string
  message: string
  path?: string
  details?: Record<string, string>
}
