package com.aditya.personalbudget.config;

import com.aditya.personalbudget.domain.entity.ChitInstallment;
import com.aditya.personalbudget.domain.entity.JournalEntry;
import com.aditya.personalbudget.domain.type.InstallmentStatus;
import com.aditya.personalbudget.repository.ChitInstallmentRepository;
import com.aditya.personalbudget.repository.JournalEntryRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

/**
 * Chit installment journals are booked on the installment's due date. Older versions booked them on
 * the day the payment was recorded; this moves any such journal to its due date once, at startup.
 * The amounts and accounts are untouched, so the books stay balanced.
 */
@Component
@Order(10)
public class ChitDateAlignment implements ApplicationRunner {

    private static final Logger log = LoggerFactory.getLogger(ChitDateAlignment.class);

    private final ChitInstallmentRepository installments;
    private final JournalEntryRepository entries;

    public ChitDateAlignment(ChitInstallmentRepository installments, JournalEntryRepository entries) {
        this.installments = installments;
        this.entries = entries;
    }

    @Override
    @Transactional
    public void run(ApplicationArguments args) {
        int moved = 0;
        for (ChitInstallment i : installments.findAll()) {
            if (i.getStatus() != InstallmentStatus.PAID || i.getJournalEntryId() == null) {
                continue;
            }
            JournalEntry entry = entries.findById(i.getJournalEntryId()).orElse(null);
            if (entry != null && !i.getDueDate().equals(entry.getEntryDate())) {
                entry.setEntryDate(i.getDueDate());
                entries.save(entry);
                moved++;
            }
        }
        if (moved > 0) {
            log.info("Moved {} chit installment journal(s) to their installment due dates", moved);
        }
    }
}
