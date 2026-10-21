package org.example.deal_with_devil_csa.repository;

import java.util.List;
import java.util.Optional;

import org.example.deal_with_devil_csa.domain.Role;
import org.example.deal_with_devil_csa.domain.Wallet;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import jakarta.persistence.LockModeType;

public interface WalletRepository extends JpaRepository<Wallet, Long>
{
    Optional<Wallet> findByUserId(Long userId);

    /** Row-locked read, for flows that must not interleave (for example settlement). */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select w from Wallet w where w.user.id = :userId")
    Optional<Wallet> findByUserIdForUpdate(@Param("userId") Long userId);

    /** Every wallet of users with a given role, with the users loaded (participant list and leaderboard). */
    @Query("select w from Wallet w join fetch w.user u where u.role = :role")
    List<Wallet> findAllByUserRole(@Param("role") Role role);

    /** Bulk delete of the wallets of users with the given role (used by "erase participant data"). */
    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("delete from Wallet w where w.user.id in (select u.id from User u where u.role = :role)")
    int deleteAllByUserRole(@Param("role") Role role);
}
