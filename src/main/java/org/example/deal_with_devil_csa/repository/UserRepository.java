package org.example.deal_with_devil_csa.repository;

import java.util.List;
import java.util.Optional;

import org.example.deal_with_devil_csa.domain.Role;
import org.example.deal_with_devil_csa.domain.User;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface UserRepository extends JpaRepository<User, Long>
{
    Optional<User> findByEmail(String email);

    Optional<User> findByGoogleId(String googleId);

    List<User> findByRole(Role role);

    /**
     * How many participants count for the slot rule and the opening block: role PARTICIPANT with a completed
     * profile (name and HackerRank ID filled), exactly what User.isProfileComplete() says. Small data set, so it is
     * counted in Java instead of a query.
     */
    default long countCompleteParticipants()
    {
        return findByRole(Role.PARTICIPANT).stream().filter(User::isProfileComplete).count();
    }

    /**
     * Adds one to the user's token version in a single atomic update, so every JWT issued earlier is rejected.
     * Returns the number of rows changed (0 when the user does not exist).
     */
    @Modifying
    @Query("update User u set u.tokenVersion = u.tokenVersion + 1 where u.id = :id")
    int bumpTokenVersion(@Param("id") Long id);

    /** True if some OTHER user already has this HackerRank ID (case-insensitive). */
    boolean existsByHackerRankIdIgnoreCaseAndIdNot(String hackerRankId, Long id);

    /**
     * Bulk delete of every user with the given role (used by "erase participant data"). Everything that points at
     * these users (bids, wallets, ledger, notifications, audit lines) must be deleted first.
     */
    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("delete from User u where u.role = :role")
    int deleteAllByRole(@Param("role") Role role);
}
