package com.aditya.personalbudget.service;

import com.aditya.personalbudget.domain.entity.Account;
import com.aditya.personalbudget.domain.entity.ConstructionCapital;
import com.aditya.personalbudget.domain.entity.ConstructionCost;
import com.aditya.personalbudget.domain.entity.ConstructionLoanTxn;
import com.aditya.personalbudget.domain.entity.ConstructionProject;
import com.aditya.personalbudget.domain.entity.ConstructionReceipt;
import com.aditya.personalbudget.domain.entity.JournalEntry;
import com.aditya.personalbudget.domain.entity.JournalLine;
import com.aditya.personalbudget.repository.AccountRepository;
import com.aditya.personalbudget.repository.ConstructionCapitalRepository;
import com.aditya.personalbudget.repository.ConstructionCostRepository;
import com.aditya.personalbudget.repository.ConstructionLoanTxnRepository;
import com.aditya.personalbudget.repository.ConstructionProjectRepository;
import com.aditya.personalbudget.repository.ConstructionReceiptRepository;
import com.aditya.personalbudget.repository.JournalEntryRepository;
import com.aditya.personalbudget.repository.JournalLineRepository;
import com.aditya.personalbudget.security.UserContext;
import org.springframework.stereotype.Service;

import java.util.Collection;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.function.Function;
import java.util.stream.Collectors;

/**
 * Which construction project an entry belongs to, so the journal and every account statement (the personal bank or
 * card that paid a cost, the account a partner's capital came from) can flag it: posted by Construction (its source:
 * a receipt, a cost, partner capital, a loan movement, a transfer or the closing) or touching a project's accounts
 * (an opening balance, a manual voucher, a reversal). Entries on the business's common accounts only are tagged as
 * the construction business.
 */
@Service
public class ConstructionTagService {

    /** projectId null: the business's common accounts. what: Receipt, Cost, Capital, Loan, Transfer, Closing, Entry. */
    public record ProjectTag(Long projectId, String project, String code, String what) {
    }

    private final ConstructionProjectRepository projects;
    private final ConstructionReceiptRepository receipts;
    private final ConstructionCostRepository costs;
    private final ConstructionCapitalRepository capital;
    private final ConstructionLoanTxnRepository loanTxns;
    private final AccountRepository accounts;
    private final JournalEntryRepository entries;
    private final JournalLineRepository lines;

    public ConstructionTagService(ConstructionProjectRepository projects, ConstructionReceiptRepository receipts, ConstructionCostRepository costs,
                                  ConstructionCapitalRepository capital, ConstructionLoanTxnRepository loanTxns, AccountRepository accounts,
                                  JournalEntryRepository entries, JournalLineRepository lines) {
        this.projects = projects;
        this.receipts = receipts;
        this.costs = costs;
        this.capital = capital;
        this.loanTxns = loanTxns;
        this.accounts = accounts;
        this.entries = entries;
        this.lines = lines;
    }

    public Map<Long, ProjectTag> forEntryIds(Collection<Long> ids) {
        if (ids.isEmpty()) return Map.of();
        Set<Long> wanted = Set.copyOf(ids);
        return forEntries(entries.findByTenantId(UserContext.tenantId()).stream().filter(e -> wanted.contains(e.getId())).toList());
    }

    /** Entry id → its project, for the entries that are construction's (the others are left out). */
    public Map<Long, ProjectTag> forEntries(Collection<JournalEntry> list) {
        if (list.isEmpty()) return Map.of();
        Long tenant = UserContext.tenantId();
        List<ConstructionProject> all = projects.findByTenantId(tenant);
        if (all.isEmpty()) return Map.of();
        Map<Long, ConstructionProject> byId = all.stream().collect(Collectors.toMap(ConstructionProject::getId, Function.identity()));
        // the project of each account in the construction book (null: a common account), and each project's own bank
        Map<Long, Long> accountProject = new HashMap<>();
        Set<Long> common = new java.util.HashSet<>();
        for (Account a : accounts.findByTenantId(tenant)) {
            if (a.getProjectId() != null) accountProject.put(a.getId(), a.getProjectId());
            else if (a.isProjectBook()) common.add(a.getId());
        }
        Map<String, Map<Long, Long>> bySource = new HashMap<>();
        Function<String, Map<Long, Long>> source = type -> bySource.computeIfAbsent(type, t -> switch (t) {
            case ConstructionMoneyService.SOURCE_RECEIPT -> receipts.findByTenantId(tenant).stream().collect(Collectors.toMap(ConstructionReceipt::getId, ConstructionReceipt::getProjectId));
            case ConstructionMoneyService.SOURCE_COST -> costs.findByTenantId(tenant).stream().collect(Collectors.toMap(ConstructionCost::getId, ConstructionCost::getProjectId));
            case ConstructionMoneyService.SOURCE_CAPITAL -> capital.findByTenantId(tenant).stream().collect(Collectors.toMap(ConstructionCapital::getId, ConstructionCapital::getProjectId));
            case ConstructionMoneyService.SOURCE_LOAN -> loanTxns.findByTenantId(tenant).stream().collect(Collectors.toMap(ConstructionLoanTxn::getId, ConstructionLoanTxn::getProjectId));
            default -> Map.of();
        });
        Map<Long, List<JournalLine>> linesByEntry = lines.findByJournalEntryIdIn(list.stream().map(JournalEntry::getId).collect(Collectors.toSet())).stream()
                .collect(Collectors.groupingBy(JournalLine::getJournalEntryId));
        Map<Long, ProjectTag> out = new HashMap<>();
        for (JournalEntry e : list) {
            String type = e.getSourceType();
            Long projectId = null;
            String what = null;
            if (type != null && type.startsWith("CONSTRUCTION_")) {
                what = switch (type) {
                    case ConstructionMoneyService.SOURCE_RECEIPT -> "Receipt";
                    case ConstructionMoneyService.SOURCE_COST -> "Cost";
                    case ConstructionMoneyService.SOURCE_CAPITAL -> "Capital";
                    case ConstructionMoneyService.SOURCE_LOAN -> "Loan";
                    case ConstructionMoneyService.SOURCE_TRANSFER -> "Transfer";
                    case ConstructionService.SOURCE_CLOSE -> "Closing";
                    default -> "Entry";
                };
                projectId = switch (type) {
                    case ConstructionMoneyService.SOURCE_TRANSFER, ConstructionService.SOURCE_CLOSE -> e.getSourceId();
                    default -> e.getSourceId() == null ? null : source.apply(type).get(e.getSourceId());
                };
            }
            boolean touchesCommon = false;
            if (projectId == null) {
                for (JournalLine l : linesByEntry.getOrDefault(e.getId(), List.of())) {
                    Long p = accountProject.get(l.getAccountId());
                    if (p != null) { projectId = p; break; }
                    if (common.contains(l.getAccountId())) touchesCommon = true;
                }
                if (projectId == null && (what != null || touchesCommon)) {
                    out.put(e.getId(), new ProjectTag(null, "Construction", "", what != null ? what : "Entry"));
                    continue;
                }
                if (projectId == null) continue;
                if (what == null) what = "Entry";
            }
            ConstructionProject p = byId.get(projectId);
            out.put(e.getId(), p == null ? new ProjectTag(null, "Construction", "", what)
                    : new ProjectTag(p.getId(), p.getName(), ConstructionService.code(p), what));
        }
        return out;
    }
}
