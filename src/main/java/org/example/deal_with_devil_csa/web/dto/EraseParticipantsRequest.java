package org.example.deal_with_devil_csa.web.dto;

import jakarta.validation.constraints.NotBlank;

/**
 * Admin button "erase all participant data". A safety latch against a stray call: the body must carry the exact word
 * ERASE (see AdminUserService.ERASE_CONFIRMATION), the same word the admin types in the confirm box.
 */
public record EraseParticipantsRequest(@NotBlank String confirmation)
{
}
