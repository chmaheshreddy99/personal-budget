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
    /** Just the bank details of a bank or wallet account (what chit members pay into). */
    public record BankDetailsRequest(@Size(max = 100) String institution, @Size(max = 40) String accountNumber,
                                     @Size(max = 100) String holderName, @Size(max = 11) String ifsc,
                                     @Size(max = 60) String upiId, Long version) {
    }

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
            Long version,
            /* bank and wallet accounts: the account holder's name, IFSC and UPI ID (for chit members paying in) */
            @Size(max = 100) String holderName,
            @Size(max = 11) String ifsc,
            @Size(max = 60) String upiId) {

        public AccountRequest(String code, String name, AccountType accountType, String institution, String accountNumber,
                              BigDecimal openingBalance, LocalDate openingDate, BigDecimal interestRate, BigDecimal creditLimit,
                              LocalDate maturityDate, BigDecimal quantity, String description, Boolean active, Long version) {
            this(code, name, accountType, institution, accountNumber, openingBalance, openingDate, interestRate, creditLimit,
                    maturityDate, quantity, description, active, version, null, null, null);
        }
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
            Long version,
            /* part of the hosted-chit book (Host a Chit, Chit accounts), not a personal account */
            boolean chitBook,
            Long hostedChitId,
            String chitRole,
            String holderName,
            String ifsc,
            String upiId,
            /* part of the construction book (the Construction section), not a personal account */
            boolean projectBook,
            Long projectId,
            String projectRole,
            /* what is owed on an EMI (Expenses › EMIs): listed only when asked for */
            boolean emiAccount) {
    }
}
