package org.example.deal_with_devil_csa.repository;

import java.util.Collection;
import java.util.List;

import org.example.deal_with_devil_csa.domain.LedgerEntry;
import org.example.deal_with_devil_csa.domain.Role;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface LedgerEntryRepository extends JpaRepository<LedgerEntry, Long>
{
    List<LedgerEntry> findByUserIdOrderByCreatedAtDesc(Long userId);

    /** True if some REVERSAL entry already undoes the entry with this id. */
    boolean existsByReversalOf(Long reversalOf);

    /** Newest entries of every participant, with the user and the acting admin loaded (admin ledger viewer). */
    @Query("select e from LedgerEntry e join fetch e.user left join fetch e.actor order by e.createdAt desc, e.id desc")
    List<LedgerEntry> findRecent(Pageable pageable);

    /** Newest entries of one participant, with the user and the acting admin loaded (admin ledger viewer). */
    @Query("select e from LedgerEntry e join fetch e.user left join fetch e.actor where e.user.id = :userId order by e.createdAt desc, e.id desc")
    List<LedgerEntry> findRecentByUser(@Param("userId") Long userId, Pageable pageable);

    /** Of the given entry ids, the ones that have already been undone. */
    @Query("select e.reversalOf from LedgerEntry e where e.reversalOf in :ids")
    List<Long> findReversedIds(@Param("ids") Collection<Long> ids);

    /**
     * Bulk delete of every ledger entry that belongs to, or was made by, a user with the given role (used by
     * "erase participant data"). The ledger is append-only in normal operation; this is the one deliberate exception.
     */
    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("delete from LedgerEntry e where e.user.id in (select u.id from User u where u.role = :role)"
            + " or e.actor.id in (select u.id from User u where u.role = :role)")
    int deleteAllByUserOrActorRole(@Param("role") Role role);
}
