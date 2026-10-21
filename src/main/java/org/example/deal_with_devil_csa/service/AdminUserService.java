package org.example.deal_with_devil_csa.service;

import java.util.Comparator;
import java.util.List;

import org.example.deal_with_devil_csa.domain.ProblemHint;
import org.example.deal_with_devil_csa.domain.Role;
import org.example.deal_with_devil_csa.domain.User;
import org.example.deal_with_devil_csa.domain.Wallet;
import org.example.deal_with_devil_csa.exception.ApiException;
import org.example.deal_with_devil_csa.exception.ErrorCode;
import org.example.deal_with_devil_csa.repository.AuditLogRepository;
import org.example.deal_with_devil_csa.repository.BidRepository;
import org.example.deal_with_devil_csa.repository.BulkCreditRepository;
import org.example.deal_with_devil_csa.repository.GameEventRepository;
import org.example.deal_with_devil_csa.repository.LedgerEntryRepository;
import org.example.deal_with_devil_csa.repository.ProblemHintRepository;
import org.example.deal_with_devil_csa.repository.ProblemRepository;
import org.example.deal_with_devil_csa.repository.UserRepository;
import org.example.deal_with_devil_csa.repository.WalletRepository;
import org.example.deal_with_devil_csa.web.dto.EraseParticipantsRequest;
import org.example.deal_with_devil_csa.web.dto.EraseParticipantsResponse;
import org.example.deal_with_devil_csa.web.dto.HintResponse;
import org.example.deal_with_devil_csa.web.dto.MeResponse;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import lombok.RequiredArgsConstructor;

/**
 * The admin's view of the participants: the list, the hint that matches a participant's corruption level,
 * manual edits of the corruption level, and the "erase everything" reset used to clear test data before the event.
 */
@Service
@RequiredArgsConstructor
public class AdminUserService
{
    /** The word the admin must send (and type in the confirm box) before every participant is erased. */
    public static final String ERASE_CONFIRMATION = "ERASE";

    private final WalletRepository walletRepository;
    private final UserRepository userRepository;
    private final ProblemRepository problemRepository;
    private final ProblemHintRepository hintRepository;
    private final BidRepository bidRepository;
    private final LedgerEntryRepository ledgerEntryRepository;
    private final GameEventRepository gameEventRepository;
    private final BulkCreditRepository bulkCreditRepository;
    private final AuditLogRepository auditLogRepository;

    /** Every participant (not admins) with their coins and corruption level, sorted by name (unnamed last). */
    @Transactional(readOnly = true)
    @PreAuthorize("hasRole('ADMIN')")
    public List<MeResponse> listParticipants()
    {
        return listParticipants(null);
    }

    /**
     * Same list, narrowed by a search text: a participant is kept when the text (trimmed, any letter case) appears
     * anywhere in their name or their HackerRank ID. A null or blank text keeps everyone. This is how an admin finds
     * the user id to use in the wallet buttons.
     */
    @Transactional(readOnly = true)
    @PreAuthorize("hasRole('ADMIN')")
    public List<MeResponse> listParticipants(String search)
    {
        String needle = search == null ? "" : search.trim().toLowerCase(java.util.Locale.ROOT);
        return walletRepository.findAllByUserRole(Role.PARTICIPANT).stream()
                .filter(w -> needle.isEmpty()
                        || lower(w.getUser().getName()).contains(needle)
                        || lower(w.getUser().getHackerRankId()).contains(needle))
                .sorted(Comparator
                        .comparing((Wallet w) -> w.getUser().getName() == null || w.getUser().getName().isBlank())
                        .thenComparing(w -> lower(w.getUser().getName()))
                        .thenComparing(w -> w.getUser().getId()))
                .map(w -> toMe(w.getUser(), w.getBalance()))
                .toList();
    }

    /** The hint version a participant is entitled to for a problem, going by their current corruption level. */
    @Transactional(readOnly = true)
    @PreAuthorize("hasRole('ADMIN')")
    public HintResponse hintFor(Long userId, Long problemId)
    {
        User user = loadUser(userId);
        if (!problemRepository.existsById(problemId))
        {
            throw new ApiException(ErrorCode.PROBLEM_NOT_FOUND);
        }
        ProblemHint hint = hintRepository.findByProblemIdAndCorruptionLevel(problemId, user.getCorruptionLevel())
                .orElseThrow(() -> new ApiException(ErrorCode.NOT_FOUND,
                        "No hint has been written for corruption level " + user.getCorruptionLevel()
                                + " on this problem."));
        return HintResponse.from(hint);
    }

    /** Sets the corruption level directly. No coins move. */
    @Transactional
    @PreAuthorize("hasRole('ADMIN')")
    public MeResponse setCorruptionLevel(Long userId, int level)
    {
        if (level < User.MIN_CORRUPTION_LEVEL || level > User.MAX_CORRUPTION_LEVEL)
        {
            throw new ApiException(ErrorCode.VALIDATION_FAILED, null,
                    java.util.Map.of("level", "Must be between " + User.MIN_CORRUPTION_LEVEL + " and "
                            + User.MAX_CORRUPTION_LEVEL + "."));
        }
        User user = loadUser(userId);
        user.setCorruptionLevel(level);
        long coins = walletRepository.findByUserId(userId).map(Wallet::getBalance).orElse(0L);
        return toMe(user, coins);
    }

    /**
     * Signs a participant out everywhere: bumps their token version, so every JWT issued earlier is rejected
     * (TOKEN_INVALID) the next time it is used. They can sign in again normally and get a token with the new version.
     * One atomic update, so a concurrent edit of the same user cannot overwrite it.
     */
    @Transactional
    @PreAuthorize("hasRole('ADMIN')")
    public void revokeSessions(Long userId)
    {
        if (userRepository.bumpTokenVersion(userId) == 0)
        {
            throw new ApiException(ErrorCode.USER_NOT_FOUND);
        }
    }

    /**
     * Erases every participant and everything that belongs to them, so test runs can be cleared before the real
     * event: bids, wallets and coins, the ledger, personal notifications, "credit everyone" records and the participant
     * user accounts themselves. Their tokens stop working at once (the user row is gone), and anyone who signs in with
     * Google again starts fresh: a new account, the profile form, a new wallet.
     *
     * Admin accounts, problems and hints, rounds (including their phase) and broadcast notifications are NOT touched.
     * Everything runs in one transaction, so a failure leaves the data exactly as it was. The rows are deleted in
     * foreign-key order. This is the one place the append-only ledger is allowed to lose rows.
     *
     * The caller must send the confirmation word (ERASE_CONFIRMATION), a guard against a stray or scripted call.
     */
    @Transactional
    @PreAuthorize("hasRole('ADMIN') and @guard.isSelf(#adminId)")
    public EraseParticipantsResponse eraseAllParticipants(Long adminId, EraseParticipantsRequest request)
    {
        if (!ERASE_CONFIRMATION.equals(request.confirmation().trim()))
        {
            throw new ApiException(ErrorCode.VALIDATION_FAILED, null,
                    java.util.Map.of("confirmation", "Send the word " + ERASE_CONFIRMATION + " to confirm."));
        }

        Role role = Role.PARTICIPANT;
        auditLogRepository.deleteAllByActorRole(role);
        int notifications = gameEventRepository.deleteAllByUserRole(role);
        int bids = bidRepository.deleteAllByUserRole(role);
        int ledgerEntries = ledgerEntryRepository.deleteAllByUserOrActorRole(role);
        bulkCreditRepository.deleteAllInBatch();
        walletRepository.deleteAllByUserRole(role);
        int participants = userRepository.deleteAllByRole(role);
        return new EraseParticipantsResponse(participants, bids, ledgerEntries, notifications);
    }

    // ---- Internals ----

    private User loadUser(Long userId)
    {
        return userRepository.findById(userId).orElseThrow(() -> new ApiException(ErrorCode.USER_NOT_FOUND));
    }

    private static MeResponse toMe(User user, long coins)
    {
        return new MeResponse(user.getId(), user.getEmail(), user.getName(), user.getHackerRankId(),
                user.getRole(), user.getCorruptionLevel(), coins, user.isProfileComplete());
    }

    private static String lower(String value)
    {
        return value == null ? "" : value.toLowerCase(java.util.Locale.ROOT);
    }
}
