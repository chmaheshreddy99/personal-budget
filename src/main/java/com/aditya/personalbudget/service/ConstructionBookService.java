package com.aditya.personalbudget.service;

import com.aditya.personalbudget.domain.entity.Account;
import com.aditya.personalbudget.domain.entity.ConstructionProject;
import com.aditya.personalbudget.domain.type.AccountClass;
import com.aditya.personalbudget.domain.type.AccountType;
import com.aditya.personalbudget.dto.ReportDtos.AccountLedger;
import com.aditya.personalbudget.dto.ReportDtos.LedgerRow;
import com.aditya.personalbudget.exception.BusinessException;
import com.aditya.personalbudget.security.UserContext;
import com.aditya.personalbudget.service.ConstructionTagService.ProjectTag;
import com.aditya.personalbudget.service.LedgerSnapshot.PostedLine;
import org.springframework.stereotype.Service;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.function.Function;
import java.util.stream.Collectors;

/**
 * Construction › Accounts: every account of the construction book (each project's own, the business's common ones)
 * with its balance and this month's money in and out, and the user's own accounts that construction money went
 * through (a cost paid from a personal card, my capital from my bank), with how much of each project's money moved
 * there. A statement of a book account shows all of it; of a personal account, only the construction lines.
 */
@Service
public class ConstructionBookService {

    /** One project's part of an account (its tagged lines, natural sign). */
    public record Share(Long projectId, String projectName, BigDecimal amount) {
    }

    /**
     * group: OWN (a project's own account), COMMON (shared by every project), PERSONAL (one of my accounts that
     * construction money went through; a project's bank account that is one of mine counts here too).
     */
    public record BookAccount(Long id, String name, String group, String role, AccountType type, AccountClass accountClass,
                              BigDecimal balance, Long projectId, String projectName, String institution, String accountNumber,
                              BigDecimal monthIn, BigDecimal monthOut, int entries, List<Share> byProject, List<Long> bankOf) {
    }

    public record BookProject(Long id, String name, String code, String kind, String landMode, String status, Long bankAccountId,
                              BigDecimal moneyBalance, BigDecimal received, BigDecimal spent, BigDecimal loans) {
    }

    public record Book(List<BookProject> projects, List<BookAccount> accounts) {
    }

    private final ConstructionService core;
    private final ConstructionTagService tags;
    private final ReportService reports;

    public ConstructionBookService(ConstructionService core, ConstructionTagService tags, ReportService reports) {
        this.core = core;
        this.tags = tags;
        this.reports = reports;
    }

    public Book book() {
        Long tenant = UserContext.tenantId();
        LedgerSnapshot books = core.ledger().snapshot();
        Map<Long, BigDecimal> bal = books.balancesAsOf(ConstructionService.FOREVER);
        List<ConstructionProject> ps = core.projects().findByTenantId(tenant).stream()
                .sorted(Comparator.comparing((ConstructionProject p) -> ConstructionService.CLOSED.equals(p.getStatus()))
                        .thenComparing(ConstructionProject::getId, Comparator.reverseOrder())).toList();
        Map<Long, ConstructionProject> byId = ps.stream().collect(Collectors.toMap(ConstructionProject::getId, Function.identity()));
        List<Account> all = core.accounts().findByTenantId(tenant);
        Map<Long, ProjectTag> tagged = tags.forEntryIds(books.lines().stream().map(PostedLine::entryId).collect(Collectors.toSet()));
        LocalDate monthStart = LocalDate.now().withDayOfMonth(1);
        Map<Long, BigDecimal[]> month = new HashMap<>();   // account -> {debits, credits} this month
        Map<Long, Integer> count = new HashMap<>();
        Map<Long, Map<Long, BigDecimal>> shares = new HashMap<>();   // account -> project -> natural amount
        for (PostedLine l : books.lines()) {
            count.merge(l.accountId(), 1, Integer::sum);
            if (!l.date().isBefore(monthStart) && !l.date().isAfter(LocalDate.now())) {
                BigDecimal[] m = month.computeIfAbsent(l.accountId(), k -> new BigDecimal[]{Money.ZERO, Money.ZERO});
                m[0] = m[0].add(l.debit());
                m[1] = m[1].add(l.credit());
            }
            ProjectTag t = tagged.get(l.entryId());
            if (t != null && t.projectId() != null) {
                shares.computeIfAbsent(l.accountId(), k -> new LinkedHashMap<>()).merge(t.projectId(), books.natural(l.accountId(), l.net()), BigDecimal::add);
            }
        }
        Map<Long, List<Long>> bankOf = new HashMap<>();
        ps.forEach(p -> { if (p.getBankAccountId() != null) bankOf.computeIfAbsent(p.getBankAccountId(), k -> new ArrayList<>()).add(p.getId()); });

        List<BookAccount> out = new ArrayList<>();
        for (Account a : all) {
            boolean own = a.getProjectId() != null;
            boolean common = !own && a.isProjectBook();
            boolean personal = !own && !common && (bankOf.containsKey(a.getId()) || (shares.containsKey(a.getId())
                    && (a.getAccountClass() == AccountClass.ASSET && a.getAccountType().isLiquid() || a.getAccountType() == AccountType.CREDIT_CARD)));
            if (!own && !common && !personal) continue;
            if (!Boolean.TRUE.equals(a.getActive()) && Money.nz(bal.get(a.getId())).signum() == 0 && !count.containsKey(a.getId())) continue;
            BigDecimal[] m = month.getOrDefault(a.getId(), new BigDecimal[]{Money.ZERO, Money.ZERO});
            boolean debitNormal = a.getAccountClass() == AccountClass.ASSET || a.getAccountClass() == AccountClass.EXPENSE;
            List<Share> sh = shares.getOrDefault(a.getId(), Map.of()).entrySet().stream()
                    .filter(e -> e.getValue().signum() != 0 && byId.containsKey(e.getKey()))
                    .map(e -> new Share(e.getKey(), byId.get(e.getKey()).getName(), e.getValue())).toList();
            ConstructionProject p = own ? byId.get(a.getProjectId()) : null;
            out.add(new BookAccount(a.getId(), a.getName(), own ? "OWN" : common ? "COMMON" : "PERSONAL", a.getProjectRole(), a.getAccountType(),
                    a.getAccountClass(), Money.nz(bal.get(a.getId())), own ? a.getProjectId() : null, p == null ? null : p.getName(),
                    a.getInstitution(), a.getAccountNumber(), debitNormal ? m[0] : m[1], debitNormal ? m[1] : m[0],
                    count.getOrDefault(a.getId(), 0), sh, bankOf.getOrDefault(a.getId(), List.of())));
        }
        out.sort(Comparator.comparing((BookAccount a) -> switch (a.group()) { case "OWN" -> 0; case "COMMON" -> 1; default -> 2; })
                .thenComparing(a -> Objects.requireNonNullElse(a.projectId(), 0L), Comparator.reverseOrder())
                .thenComparing(a -> roleOrder(a.role())).thenComparing(BookAccount::id));
        Map<Long, ConstructionService.Figures> figures = new HashMap<>();
        List<BookProject> projects = ps.stream().map(p -> {
            ConstructionService.Figures f = figures.computeIfAbsent(p.getId(), k -> core.figures(p, bal));
            return new BookProject(p.getId(), p.getName(), ConstructionService.code(p), p.getKind(), p.getLandMode(), p.getStatus(), p.getBankAccountId(),
                    f.moneyBalance(), f.received().add(f.interestReceived()), f.totalCost(), f.loanOutstanding());
        }).toList();
        return new Book(projects, out);
    }

    /** An account's statement: all of a construction book account; of my own account, only what construction moved. */
    public AccountLedger statement(Long accountId, LocalDate from, LocalDate to) {
        Account a = core.accountService().require(accountId);
        AccountLedger full = reports.accountLedger(accountId, from, to);
        if (a.isProjectBook()) return full;
        List<LedgerRow> mine = full.rows().stream().filter(r -> r.construction() != null).toList();
        if (mine.isEmpty() && book().accounts().stream().noneMatch(x -> x.id().equals(accountId))) {
            throw new BusinessException(a.getName() + " has no construction money");
        }
        // only construction's lines: the balance runs over them alone, from zero
        BigDecimal running = Money.ZERO, dr = Money.ZERO, cr = Money.ZERO;
        LedgerSnapshot books = core.ledger().snapshot();
        List<LedgerRow> rows = new ArrayList<>();
        for (LedgerRow r : mine) {
            running = running.add(books.natural(accountId, r.debit().subtract(r.credit())));
            dr = dr.add(r.debit());
            cr = cr.add(r.credit());
            rows.add(new LedgerRow(r.entryId(), r.entryNo(), r.date(), r.voucherType(), r.voucherLabel(), r.narration(), r.counterAccounts(),
                    r.debit(), r.credit(), running, r.chitTrail(), r.construction()));
        }
        return new AccountLedger(full.accountId(), full.code(), full.name(), full.accountClass(), from, to, Money.ZERO, dr, cr, running, rows);
    }

    private static int roleOrder(String role) {
        List<String> order = List.of("BANK", "COMMON", "COST", "LAND", "ADVANCES", "INTEREST", "LOAN", "CAPITAL", "PROFIT");
        int i = order.indexOf(Objects.toString(role, ""));
        return i < 0 ? 99 : i;
    }
}
