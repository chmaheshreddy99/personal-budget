package com.aditya.personalbudget.config;

import com.aditya.personalbudget.domain.entity.Claim;
import com.aditya.personalbudget.domain.entity.ClaimRepayment;
import com.aditya.personalbudget.domain.entity.JournalEntry;
import com.aditya.personalbudget.storage.TsvDataStore;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

/**
 * Repayments used to be named "Repayment from / to ..."; now a part payment says "Partial repayment" so the
 * journal and statements show at a glance that money is still owed. Renames older entries once, at startup.
 */
@Component
@Order(8)
public class RepaymentNarrationMigration implements ApplicationRunner {

    private static final Logger log = LoggerFactory.getLogger(RepaymentNarrationMigration.class);

    private final TsvDataStore store;

    public RepaymentNarrationMigration(TsvDataStore store) {
        this.store = store;
    }

    @Override
    @Transactional
    public void run(ApplicationArguments args) {
        Map<Long, List<ClaimRepayment>> byClaim = store.findAll(ClaimRepayment.class, r -> !Boolean.TRUE.equals(r.getWriteOff())
                        && r.getJournalEntryId() != null).stream()
                .collect(Collectors.groupingBy(ClaimRepayment::getClaimId));
        List<JournalEntry> changed = new ArrayList<>();
        byClaim.forEach((claimId, list) -> {
            Claim claim = store.findById(Claim.class, claimId).orElse(null);
            if (claim == null) {
                return;
            }
            BigDecimal left = claim.getAmount();
            for (ClaimRepayment r : list.stream().sorted(Comparator.comparing(ClaimRepayment::getPaidDate)
                    .thenComparing(ClaimRepayment::getId)).toList()) {
                left = left.subtract(r.getPrincipal());
                JournalEntry e = store.findById(JournalEntry.class, r.getJournalEntryId()).orElse(null);
                if (e != null && e.getNarration() != null && e.getNarration().startsWith("Repayment ")) {
                    e.setNarration((left.signum() <= 0 ? "Final r" : "Partial r") + e.getNarration().substring(1));
                    changed.add(e);
                }
            }
        });
        if (!changed.isEmpty()) {
            store.saveAll(JournalEntry.class, changed);
            log.info("{} repayment entr(ies) now say whether they were partial or final", changed.size());
        }
    }
}
