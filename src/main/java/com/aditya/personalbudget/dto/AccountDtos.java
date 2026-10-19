package com.aditya.personalbudget.dto;

import com.aditya.personalbudget.domain.type.AccountClass;
import com.aditya.personalbudget.domain.type.AccountType;
import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.PositiveOrZero;
import jakarta.validation.constraints.Size;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;

public final class AccountDtos {

    private AccountDtos() {
    }

    /** Create / update an account. Leave {@code code} empty to have one assigned. */
    public record AccountRequest(
            @Size(max = 20) String code,
            @NotBlank @Size(max = 100) String name,
            @NotNull AccountType accountType,
            @Size(max = 100) String institution,
            @Size(max = 40) String accountNumber,
            @PositiveOrZero BigDecimal openingBalance,
            LocalDate openingDate,
            @PositiveOrZero @DecimalMax("100") BigDecimal interestRate,
            @PositiveOrZero BigDecimal creditLimit,
            LocalDate maturityDate,
            @PositiveOrZero BigDecimal quantity,
            @Size(max = 255) String description,
            Boolean active,
            /* the version the form was loaded with; a stale edit is refused */
            Long version) {
    }

    /** An account with its live balance. */
    public record AccountView(
            Long id,
            String code,
            String name,
            AccountClass accountClass,
            AccountType accountType,
            String typeLabel,
            String institution,
            String accountNumber,
            BigDecimal openingBalance,
            LocalDate openingDate,
            BigDecimal interestRate,
            BigDecimal creditLimit,
            LocalDate maturityDate,
            BigDecimal quantity,
            String description,
            boolean systemAccount,
            boolean active,
            BigDecimal balance,
            BigDecimal monthMovement,
            BigDecimal monthIn,
            BigDecimal monthOut,
            BigDecimal change30Days,
            BigDecimal utilizationPercent,
            BigDecimal availableCredit,
            Long daysToMaturity,
            String bucket,
            LocalDate lastActivity,
            long transactionCount,
            /* Month-end balances of the last five months plus today's balance (oldest first). */
            List<BigDecimal> trend,
            Long version) {
    }
}
