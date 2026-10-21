package org.example.deal_with_devil_csa.web.controller;

import java.util.List;

import org.example.deal_with_devil_csa.security.CurrentUser;
import org.example.deal_with_devil_csa.service.AdminUserService;
import org.example.deal_with_devil_csa.web.dto.CorruptionLevelRequest;
import org.example.deal_with_devil_csa.web.dto.EraseParticipantsRequest;
import org.example.deal_with_devil_csa.web.dto.EraseParticipantsResponse;
import org.example.deal_with_devil_csa.web.dto.HintResponse;
import org.example.deal_with_devil_csa.web.dto.MeResponse;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;

/** The admin's participant manager. /api/admin/** is already restricted to ADMIN in SecurityConfig. */
@RestController
@RequestMapping("/api/admin/users")
@RequiredArgsConstructor
public class AdminUserController
{
    private final AdminUserService adminUserService;

    /**
     * Every participant with coins and corruption level, sorted by name. With ?q=text only the participants whose
     * name or HackerRank ID contains the text (any letter case) are returned, so the admin can look up a user id.
     */
    @GetMapping
    public List<MeResponse> list(@RequestParam(required = false) String q)
    {
        return adminUserService.listParticipants(q);
    }

    /** The hint text and password this participant is entitled to for a problem (by their corruption level). */
    @GetMapping("/{userId}/hints/{problemId}")
    public HintResponse hint(@PathVariable Long userId, @PathVariable Long problemId)
    {
        return adminUserService.hintFor(userId, problemId);
    }

    @PutMapping("/{userId}/corruption-level")
    public MeResponse setCorruptionLevel(@PathVariable Long userId,
                                         @Valid @RequestBody CorruptionLevelRequest request)
    {
        return adminUserService.setCorruptionLevel(userId, request.level());
    }

    /** Signs the user out everywhere: every token issued to them earlier stops working. They can sign in again. */
    @PostMapping("/{userId}/revoke-sessions")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void revokeSessions(@PathVariable Long userId)
    {
        adminUserService.revokeSessions(userId);
    }

    /**
     * Erases every participant and all their data (bids, wallets, ledger, notifications, accounts). Admins, problems,
     * hints and rounds are kept. The body must carry the word ERASE. Meant for clearing test data before the event.
     */
    @PostMapping("/erase")
    public EraseParticipantsResponse eraseAll(@AuthenticationPrincipal CurrentUser admin,
                                              @Valid @RequestBody EraseParticipantsRequest request)
    {
        return adminUserService.eraseAllParticipants(admin.id(), request);
    }
}
