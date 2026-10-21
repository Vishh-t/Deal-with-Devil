package org.example.deal_with_devil_csa.repository;

import java.util.List;

import org.example.deal_with_devil_csa.domain.AuditLogEntry;
import org.example.deal_with_devil_csa.domain.Role;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface AuditLogRepository extends JpaRepository<AuditLogEntry, Long>
{
    /** Newest entries first, with the actors loaded. */
    @Query("select a from AuditLogEntry a join fetch a.actor order by a.id desc")
    List<AuditLogEntry> findRecent(Pageable pageable);

    /** Newest entries of one actor first. */
    @Query("select a from AuditLogEntry a join fetch a.actor where a.actor.id = :actorId order by a.id desc")
    List<AuditLogEntry> findRecentByActor(@Param("actorId") Long actorId, Pageable pageable);

    /**
     * Removes the lines whose actor has the given role. Needed before participants are erased: a participant who
     * poked an admin URL has a refused (403) line here that points at their user row. Admin lines are untouched.
     */
    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("delete from AuditLogEntry a where a.actor.id in (select u.id from User u where u.role = :role)")
    int deleteAllByActorRole(@Param("role") Role role);
}
