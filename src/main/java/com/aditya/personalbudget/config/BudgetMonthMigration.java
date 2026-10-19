package com.aditya.personalbudget.config;

import com.aditya.personalbudget.domain.entity.Budget;
import com.aditya.personalbudget.storage.TsvDataStore;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.time.YearMonth;
import java.util.List;

/**
 * Budgets used to apply to every month alike; now each belongs to a month. Budgets without one become this
 * month's budgets (once, at startup); earlier months simply have none, and "copy last month" fills new months.
 */
@Component
@Order(7)
public class BudgetMonthMigration implements ApplicationRunner {

    private static final Logger log = LoggerFactory.getLogger(BudgetMonthMigration.class);

    private final TsvDataStore store;

    public BudgetMonthMigration(TsvDataStore store) {
        this.store = store;
    }

    @Override
    @Transactional
    public void run(ApplicationArguments args) {
        List<Budget> undated = store.findAll(Budget.class, b -> b.getMonth() == null);
        if (undated.isEmpty()) {
            return;
        }
        String month = YearMonth.now().toString();
        undated.forEach(b -> b.setMonth(month));
        store.saveAll(Budget.class, undated);
        log.info("{} budget(s) set for {}", undated.size(), month);
    }
}
