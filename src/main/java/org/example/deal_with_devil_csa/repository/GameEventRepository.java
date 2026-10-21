package org.example.deal_with_devil_csa.repository;

import java.util.List;

import org.example.deal_with_devil_csa.domain.GameEvent;
import org.example.deal_with_devil_csa.domain.Role;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface GameEventRepository extends JpaRepository<GameEvent, Long>
{
    /** Events for one person (personal ones plus broadcasts) newer than a cursor, oldest first. */
    @Query("select e from GameEvent e where (e.user is null or e.user.id = :userId) and e.id > :after order by e.id asc")
    List<GameEvent> findFeedAfter(@Param("userId") Long userId, @Param("after") Long after, Pageable pageable);

    /** The newest events for one person, newest first (the caller reverses them). */
    @Query("select e from GameEvent e where e.user is null or e.user.id = :userId order by e.id desc")
    List<GameEvent> findLatestFeed(@Param("userId") Long userId, Pageable pageable);

    /** Bulk delete of the personal notifications of users with the given role. Broadcasts (no user) are kept. */
    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("delete from GameEvent e where e.user.id in (select u.id from User u where u.role = :role)")
    int deleteAllByUserRole(@Param("role") Role role);
}
