package com.aditya.personalbudget.config;

import com.aditya.personalbudget.domain.entity.Account;
import com.aditya.personalbudget.domain.entity.Budget;
import com.aditya.personalbudget.domain.entity.Category;
import com.aditya.personalbudget.domain.entity.Chit;
import com.aditya.personalbudget.domain.entity.Claim;
import com.aditya.personalbudget.domain.entity.ClaimRepayment;
import com.aditya.personalbudget.domain.entity.JournalLine;
import com.aditya.personalbudget.domain.entity.RecurringTransaction;
import com.aditya.personalbudget.domain.entity.Tenant;
import com.aditya.personalbudget.domain.type.AccountClass;
import com.aditya.personalbudget.domain.type.AccountType;
import com.aditya.personalbudget.domain.type.CategoryKind;
import com.aditya.personalbudget.service.DefaultChartOfAccounts;
import com.aditya.personalbudget.service.TenantProvisioningService;
import com.aditya.personalbudget.storage.TsvDataStore;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Stream;

/**
 * One-time conversion of books kept with one account per expense / income category and one account per
 * chit into the current model: one Expenses, one Income and one Chit Funds account, with the category or
 * chit carried on each journal line.
 * <p>
 * A tenant needs it when it has no categories yet. Before anything changes, every table file is copied to
 * {@code data/backup-<timestamp>/}. The whole conversion runs in one transaction: it is written completely
 * or not at all. Amounts and dates are untouched, so every balance stays the same.
 */
@Component
@Order(5)
public class CategoryMigration implements ApplicationRunner {

    private static final Logger log = LoggerFactory.getLogger(CategoryMigration.class);

    private final TsvDataStore store;
    private final TenantProvisioningService provisioning;

    public CategoryMigration(TsvDataStore store, TenantProvisioningService provisioning) {
        this.store = store;
        this.provisioning = provisioning;
    }

    @Override
    @Transactional
    public void run(ApplicationArguments args) {
        List<Tenant> pending = store.findAll(Tenant.class, t -> true).stream()
                .filter(t -> store.count(Category.class, c -> c.getTenantId().equals(t.getId())) == 0)
                .toList();
        if (pending.isEmpty()) {
            return;
        }
        Map<Long, Long> legacyBudgetAccounts = legacyBudgetAccounts();
        Path backup = backup();
        for (Tenant tenant : pending) {
            migrate(tenant.getId(), legacyBudgetAccounts);
        }
        log.info("Moved {} tenant(s) to categories and the Chit Funds sub-ledger; previous data saved in {}",
                pending.size(), backup);
    }

    private void migrate(Long tenantId, Map<Long, Long> legacyBudgetAccounts) {
        LocalDateTime now = LocalDateTime.now();
        List<Account> accounts = store.findAll(Account.class, a -> a.getTenantId().equals(tenantId));

        // ---- 1. one category per old expense / income account
        Map<Long, Long> categoryOf = new HashMap<>();
        Set<String> taken = new HashSet<>();
        List<Account> categoryAccounts = accounts.stream()
                .filter(a -> CategoryKind.of(a.getAccountClass()) != null && !isParent(a))
                .sorted(Comparator.comparing(Account::getCode))
                .toList();
        for (Account a : categoryAccounts) {
            CategoryKind kind = CategoryKind.of(a.getAccountClass());
            String name = a.getName();
            for (int n = 2; !taken.add(kind + "|" + name.toLowerCase()); n++) {
                name = a.getName() + " " + n;
            }
            String systemKey = DefaultChartOfAccounts.systemKeyOfLegacyCode(a.getCode());
            String finalName = name;
            Category c = new Category();
            c.setTenantId(tenantId);
            c.setKind(kind);
            c.setCode(DefaultChartOfAccounts.CATEGORIES.stream()
                    .filter(t -> t.kind() == kind && (t.name().equalsIgnoreCase(finalName)
                            || (systemKey != null && systemKey.equals(t.systemKey()))))
                    .map(DefaultChartOfAccounts.CategoryTemplate::code).findFirst().orElse(a.getCode()));
            c.setName(name);
            c.setDescription(a.getDescription());
            c.setSystemKey(systemKey);
            c.setActive(!Boolean.FALSE.equals(a.getActive()));
            c.setCreatedAt(a.getCreatedAt() == null ? now : a.getCreatedAt());
            categoryOf.put(a.getId(), store.save(Category.class, c).getId());
        }

        // ---- 2. the parent accounts (an old row is reused when it holds the well-known code)
        Set<Long> retired = new HashSet<>(categoryOf.keySet());
        Account expenses = parent(tenantId, accounts, DefaultChartOfAccounts.EXPENSES, retired);
        Account income = parent(tenantId, accounts, DefaultChartOfAccounts.INCOME, retired);
        List<Account> chitAccounts = accounts.stream().filter(a -> a.getAccountType() == AccountType.CHIT_FUND).toList();
        retired.addAll(chitAccounts.stream().map(Account::getId).toList());
        Account chitFunds = parent(tenantId, accounts, DefaultChartOfAccounts.CHIT_FUNDS, retired);
        Map<Long, Long> parentOf = new HashMap<>();
        categoryOf.keySet().forEach(id -> parentOf.put(id,
                accountById(accounts, id).getAccountClass() == AccountClass.EXPENSE ? expenses.getId() : income.getId()));
        chitAccounts.forEach(a -> parentOf.put(a.getId(), chitFunds.getId()));

        // ---- 3. chits: each one becomes a sub-ledger of Chit Funds
        Map<Long, Long> chitOfAccount = new HashMap<>();
        for (Chit chit : store.findAll(Chit.class, c -> c.getTenantId().equals(tenantId))) {
            if (chit.getAccountId() != null) {
                chitOfAccount.put(chit.getAccountId(), chit.getId());
            }
            chit.setAccountId(chitFunds.getId());
            store.save(Chit.class, chit);
        }

        // ---- 4. journal lines
        List<JournalLine> lines = store.findAll(JournalLine.class, l -> l.getTenantId().equals(tenantId)
                && parentOf.containsKey(l.getAccountId()));
        for (JournalLine line : lines) {
            Long old = line.getAccountId();
            if (categoryOf.containsKey(old)) {
                line.setCategoryId(categoryOf.get(old));
            } else if (chitOfAccount.containsKey(old)) {
                line.setChitId(chitOfAccount.get(old));
            }
            line.setAccountId(parentOf.get(old));
        }
        store.saveAll(JournalLine.class, lines);

        // ---- 5. budgets, recurring, bills to pay, write-offs
        for (Budget budget : store.findAll(Budget.class, b -> b.getTenantId().equals(tenantId))) {
            Long category = categoryOf.get(legacyBudgetAccounts.get(budget.getId()));
            if (budget.getCategoryId() != null) {
                continue;
            }
            if (category == null) {
                store.deleteById(Budget.class, budget.getId());
            } else {
                budget.setCategoryId(category);
                store.save(Budget.class, budget);
            }
        }
        for (RecurringTransaction r : store.findAll(RecurringTransaction.class, r -> r.getTenantId().equals(tenantId))) {
            if (categoryOf.containsKey(r.getDebitAccountId())) {
                r.setCategoryId(categoryOf.get(r.getDebitAccountId()));
            } else if (categoryOf.containsKey(r.getCreditAccountId())) {
                r.setCategoryId(categoryOf.get(r.getCreditAccountId()));
            }
            r.setDebitAccountId(parentOf.getOrDefault(r.getDebitAccountId(), r.getDebitAccountId()));
            r.setCreditAccountId(parentOf.getOrDefault(r.getCreditAccountId(), r.getCreditAccountId()));
            store.save(RecurringTransaction.class, r);
        }
        for (Claim claim : store.findAll(Claim.class, c -> c.getTenantId().equals(tenantId)
                && categoryOf.containsKey(c.getPaidFromAccountId()))) {
            claim.setCategoryId(categoryOf.get(claim.getPaidFromAccountId()));
            claim.setPaidFromAccountId(parentOf.get(claim.getPaidFromAccountId()));
            store.save(Claim.class, claim);
        }
        for (ClaimRepayment repayment : store.findAll(ClaimRepayment.class, r -> r.getTenantId().equals(tenantId)
                && categoryOf.containsKey(r.getAccountId()))) {
            repayment.setCategoryId(categoryOf.get(repayment.getAccountId()));
            repayment.setAccountId(parentOf.get(repayment.getAccountId()));
            store.save(ClaimRepayment.class, repayment);
        }

        // ---- 6. drop the old accounts, add whatever system account or category is still missing
        retired.removeAll(Set.of(expenses.getId(), income.getId(), chitFunds.getId()));
        store.deleteAllById(Account.class, retired);
        Set<String> codes = new HashSet<>();
        store.findAll(Account.class, a -> a.getTenantId().equals(tenantId)).forEach(a -> codes.add(a.getCode()));
        for (DefaultChartOfAccounts.Template t : DefaultChartOfAccounts.ACCOUNTS) {
            if (!codes.contains(t.code())) {
                store.save(Account.class, newAccount(tenantId, t, now));
            }
        }
        provisioning.seedCategories(tenantId, true);
        log.info("Tenant {}: {} accounts became categories, {} chit accounts merged into Chit Funds, {} journal lines retagged",
                tenantId, categoryOf.size(), chitAccounts.size(), lines.size());
    }

    /** Already the single Expenses / Income account (a tenant that was set up with categories in mind). */
    private static boolean isParent(Account a) {
        return Boolean.TRUE.equals(a.getSystemAccount())
                && ("Expenses".equalsIgnoreCase(a.getName()) || "Income".equalsIgnoreCase(a.getName()));
    }

    /**
     * The account holding a well-known code, turned into the parent account. The old account with that code is
     * reused (it is about to be retired anyway); otherwise a new one is created.
     */
    private Account parent(Long tenantId, List<Account> accounts, String code, Set<Long> retired) {
        DefaultChartOfAccounts.Template t = DefaultChartOfAccounts.ACCOUNTS.stream()
                .filter(x -> x.code().equals(code)).findFirst().orElseThrow();
        Account account = accounts.stream()
                .filter(a -> a.getCode().equals(code) && a.getAccountType() == t.type())
                .findFirst()
                .orElse(null);
        if (account == null) {
            // the code is held by an account of another kind: leave it and use a free code
            String free = code;
            for (int n = 1; usedCode(accounts, free); n++) {
                free = String.valueOf(Integer.parseInt(code) + n * 9);
            }
            Account created = newAccount(tenantId, t, LocalDateTime.now());
            created.setCode(free);
            return store.save(Account.class, created);
        }
        account.setName(t.name());
        account.setDescription(t.description());
        account.setSystemAccount(true);
        account.setActive(true);
        retired.remove(account.getId());
        return store.save(Account.class, account);
    }

    private static boolean usedCode(List<Account> accounts, String code) {
        return accounts.stream().anyMatch(a -> a.getCode().equals(code));
    }

    private static Account accountById(List<Account> accounts, Long id) {
        return accounts.stream().filter(a -> a.getId().equals(id)).findFirst().orElseThrow();
    }

    private static Account newAccount(Long tenantId, DefaultChartOfAccounts.Template t, LocalDateTime now) {
        Account a = new Account();
        a.setTenantId(tenantId);
        a.setCode(t.code());
        a.setName(t.name());
        a.setAccountType(t.type());
        a.setAccountClass(t.type().getAccountClass());
        a.setDescription(t.description());
        a.setSystemAccount(t.system());
        a.setActive(true);
        a.setCreatedAt(now);
        return a;
    }

    /** Budgets used to point at an expense account ({@code accountId} column, no longer on the entity). */
    private Map<Long, Long> legacyBudgetAccounts() {
        Map<Long, Long> result = new HashMap<>();
        Path file = store.dataDir().resolve("budgets.tbl");
        if (!Files.exists(file)) {
            return result;
        }
        try {
            List<String> rows = Files.readAllLines(file, StandardCharsets.UTF_8);
            if (rows.isEmpty()) {
                return result;
            }
            List<String> header = List.of(rows.getFirst().split("\t", -1));
            int id = header.indexOf("id");
            int account = header.indexOf("accountId");
            if (id < 0 || account < 0) {
                return result;
            }
            for (String row : rows.subList(1, rows.size())) {
                String[] cells = row.split("\t", -1);
                if (cells.length > Math.max(id, account) && !cells[account].isBlank()) {
                    result.put(Long.valueOf(cells[id].trim()), Long.valueOf(cells[account].trim()));
                }
            }
            return result;
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }

    /** Copies every table file (and the id sequences) to a time-stamped folder inside the data directory. */
    private Path backup() {
        Path dir = store.dataDir();
        Path target = dir.resolve("backup-" + LocalDateTime.now().format(DateTimeFormatter.ofPattern("yyyyMMdd-HHmmss")));
        try (Stream<Path> files = Files.list(dir)) {
            Files.createDirectories(target);
            List<Path> sources = new ArrayList<>(files.filter(Files::isRegularFile)
                    .filter(p -> p.toString().endsWith(".tbl") || p.toString().endsWith(".properties")).toList());
            for (Path p : sources) {
                Files.copy(p, target.resolve(p.getFileName()), StandardCopyOption.COPY_ATTRIBUTES);
            }
            return target;
        } catch (IOException e) {
            throw new UncheckedIOException("Could not back up the data folder before migrating; nothing was changed", e);
        }
    }
}
