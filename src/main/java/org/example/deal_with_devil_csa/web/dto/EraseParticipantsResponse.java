package org.example.deal_with_devil_csa.web.dto;

/** What the erase removed, so the admin panel can show a summary. */
public record EraseParticipantsResponse(int participants, int bids, int ledgerEntries, int notifications)
{
}
