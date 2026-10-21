package org.example.deal_with_devil_csa.repository;

import java.util.List;

import org.example.deal_with_devil_csa.domain.Bid;
import org.example.deal_with_devil_csa.domain.BidStatus;
import org.example.deal_with_devil_csa.domain.Role;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface BidRepository extends JpaRepository<Bid, Long>
{
    /** One participant's bids on the problems of one round, with the problems loaded. */
    @Query("select b from Bid b join fetch b.problem p where b.user.id = :userId and p.round.id = :roundId order by p.id")
    List<Bid> findByUserAndRound(@Param("userId") Long userId, @Param("roundId") Long roundId);

    /** Every bid of one round in a given status, with problems and bidders loaded (used by settlement). */
    @Query("select b from Bid b join fetch b.problem p join fetch b.user where p.round.id = :roundId and b.status = :status order by b.id")
    List<Bid> findByRoundAndStatus(@Param("roundId") Long roundId, @Param("status") BidStatus status);

    /** Every bid of one round whatever its status, with problems and bidders loaded (used for the settlement summary). */
    @Query("select b from Bid b join fetch b.problem p join fetch b.user where p.round.id = :roundId order by b.id")
    List<Bid> findAllByRound(@Param("roundId") Long roundId);

    /** The bids of one problem in a given status with the bidders loaded, highest bid first (used for the winners list). */
    @Query("select b from Bid b join fetch b.user where b.problem.id = :problemId and b.status = :status order by b.amount desc, b.submittedAt asc, b.id asc")
    List<Bid> findByProblemAndStatus(@Param("problemId") Long problemId, @Param("status") BidStatus status);

    /** Bulk delete of every bid placed by users with the given role (used by "erase participant data"). */
    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("delete from Bid b where b.user.id in (select u.id from User u where u.role = :role)")
    int deleteAllByUserRole(@Param("role") Role role);
}
