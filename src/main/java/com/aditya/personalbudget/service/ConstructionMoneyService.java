package com.aditya.personalbudget.service;

import com.aditya.personalbudget.domain.entity.Account;
import com.aditya.personalbudget.domain.entity.ConstructionCapital;
import com.aditya.personalbudget.domain.entity.ConstructionCost;
import com.aditya.personalbudget.domain.entity.ConstructionLoan;
import com.aditya.personalbudget.domain.entity.ConstructionLoanTxn;
import com.aditya.personalbudget.domain.entity.ConstructionPartner;
import com.aditya.personalbudget.domain.entity.ConstructionProject;
import com.aditya.personalbudget.domain.entity.ConstructionReceipt;
import com.aditya.personalbudget.domain.entity.ConstructionSale;
import com.aditya.personalbudget.domain.entity.JournalEntry;
import com.aditya.personalbudget.domain.type.AccountClass;
import com.aditya.personalbudget.domain.type.AccountType;
import com.aditya.personalbudget.domain.type.VoucherType;
import com.aditya.personalbudget.exception.BusinessException;
import com.aditya.personalbudget.exception.NotFoundException;
import com.aditya.personalbudget.security.UserContext;
import com.aditya.personalbudget.service.ConstructionService.Detail;
import com.aditya.personalbudget.service.ConstructionService.PartnerInput;
import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.PositiveOrZero;
import jakarta.validation.constraints.Size;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Objects;
import java.util.Set;

/**
 * The money of a construction project, each movement posted to the books: payments received (from the owner, a buyer
 * or the buyer's bank, with a receipt number, part of it late interest), costs (by head; the land to the land account,
 * the rest to the construction cost), partners' capital in and out, the project's loans (disbursed, interest and
 * charges, which are costs, and repayments), transfers between accounts, and the business's common accounts.
 */
@Service
public class ConstructionMoneyService {

    static final String SOURCE_RECEIPT = "CONSTRUCTION_RECEIPT";
    static final String SOURCE_COST = "CONSTRUCTION_COST";
    static final String SOURCE_CAPITAL = "CONSTRUCTION_CAPITAL";
    static final String SOURCE_LOAN = "CONSTRUCTION_LOAN";
    static final String SOURCE_TRANSFER = "CONSTRUCTION_TRANSFER";
    /** Cost heads offered (any other short name can be typed). */
    public static final List<String> HEADS = List.of("LAND", "APPROVALS", "DESIGN", "EXCAVATION", "CEMENT", "STEEL", "SAND_AGGREGATE",
            "BRICKS_BLOCKS", "CONCRETE", "LABOUR", "CONTRACTOR", "CENTERING", "ELECTRICAL", "PLUMBING", "FLOORING", "PAINTING",
            "DOORS_WINDOWS", "FABRICATION", "LIFT", "EQUIPMENT", "TRANSPORT", "SITE_EXPENSES", "REGISTRATION", "MARKETING", "OTHER");
    static final Set<String> MODES = Set.of("Cash", "UPI", "Bank", "Cheque", "DD", "Card");

    public record ReceiptRequest(Long saleId, @Size(max = 12) String payer, @Size(max = 100) String payerName, @NotNull @Positive BigDecimal amount,
                                 @PositiveOrZero BigDecimal interestAmount, @NotNull LocalDate receivedOn, @Size(max = 20) String mode,
                                 @Size(max = 60) String reference, @NotNull Long accountId, @Size(max = 200) String towards,
                                 @Size(max = 300) String note) {
    }

    public record CostRequest(@NotBlank @Size(max = 30) String head, @Size(max = 200) String description, @Size(max = 100) String vendor,
                              @Size(max = 40) String billNo, @PositiveOrZero BigDecimal quantity, @Size(max = 12) String unit,
                              @PositiveOrZero BigDecimal rate, @NotNull @Positive BigDecimal amount, @NotNull LocalDate spentOn,
                              @NotNull Long accountId, Long stageId) {
    }

    public record PartnerRequest(@NotBlank @Size(max = 100) String name, @Size(max = 20) String phone, @Size(max = 200) String address,
                                 @NotNull @PositiveOrZero @DecimalMax("100") BigDecimal sharePercent, Boolean me, @Size(max = 200) String note) {
    }

    /** Every partner's share at once (they must make 100%). */
    public record SharesRequest(@NotNull List<ShareRow> shares) {
    }

    public record ShareRow(@NotNull Long partnerId, @NotNull @PositiveOrZero BigDecimal sharePercent) {
    }

    /** accountId: the project's side; fromAccountId: my own account, when I put in (or take out) my money. */
    public record CapitalRequest(@NotNull Long partnerId, @NotBlank String kind, @NotNull @Positive BigDecimal amount, @NotNull LocalDate movedOn,
                                 @NotNull Long accountId, Long fromAccountId, @Size(max = 200) String note) {
    }

    public record LoanRequest(@NotBlank @Size(max = 100) String lender, @Size(max = 40) String loanNo, @NotNull @Positive BigDecimal sanctioned,
                              @PositiveOrZero @DecimalMax("60") BigDecimal ratePercent, @Min(0) @Max(600) Integer tenureMonths,
                              LocalDate sanctionDate, @Size(max = 300) String note) {
    }

    public record LoanTxnRequest(@NotBlank String kind, @NotNull @Positive BigDecimal amount, @NotNull LocalDate movedOn, @NotNull Long accountId,
                                 @Size(max = 200) String note) {
    }

    public record TransferRequest(@NotNull Long fromAccountId, @NotNull Long toAccountId, @NotNull @Positive BigDecimal amount,
                                  @NotNull LocalDate movedOn, @Size(max = 200) String note) {
    }

    /** A common account of the business (shared by every project): a bank account, cash or a wallet. */
    public record CommonAccountRequest(@NotBlank @Size(max = 100) String name, @NotBlank String type, @Size(max = 100) String institution,
                                       @Size(max = 40) String accountNumber, @PositiveOrZero BigDecimal openingBalance, LocalDate openingDate) {
    }

    private final ConstructionService core;

    public ConstructionMoneyService(ConstructionService core) {
        this.core = core;
    }

    // ================================================================== receipts

    @Transactional
    public Detail addReceipt(Long id, ReceiptRequest r) {
        ConstructionProject p = core.requireOpen(id);
        ConstructionReceipt x = new ConstructionReceipt();
        x.setTenantId(p.getTenantId());
        x.setProjectId(p.getId());
        x.setCreatedBy(UserContext.username());
        x.setCreatedAt(LocalDateTime.now());
        x.setReceiptNo(nextReceiptNo(p));
        fill(p, x, r);
        x = core.receipts().save(x);
        x.setJournalEntryId(core.post(receiptDraft(p, x)).getId());
        core.receipts().save(x);
        core.activity().record("ADDED", ConstructionService.AREA, "Receipt " + x.getReceiptNo() + " · " + ActivityService.money(x.getAmount()) + " from "
                + Objects.toString(x.getPayerName(), "the owner") + " · " + p.getName());
        return core.detail(id);
    }

    @Transactional
    public Detail updateReceipt(Long id, Long receiptId, ReceiptRequest r) {
        ConstructionProject p = core.requireOpen(id);
        ConstructionReceipt x = requireReceipt(p, receiptId);
        fill(p, x, r);
        core.receipts().save(x);
        if (x.getJournalEntryId() != null) core.ledger().repost(x.getJournalEntryId(), receiptDraft(p, x));
        core.activity().record("CHANGED", ConstructionService.AREA, "Changed the receipt " + x.getReceiptNo() + " · " + p.getName());
        return core.detail(id);
    }

    @Transactional
    public Detail deleteReceipt(Long id, Long receiptId) {
        ConstructionProject p = core.requireOpen(id);
        ConstructionReceipt x = requireReceipt(p, receiptId);
        Long entry = x.getJournalEntryId();
        core.receipts().deleteById(x.getId());
        if (entry != null) core.ledger().delete(entry);
        core.activity().record("DELETED", ConstructionService.AREA, "Deleted the receipt " + x.getReceiptNo() + " · " + ActivityService.money(x.getAmount()) + " · " + p.getName());
        return core.detail(id);
    }

    private void fill(ConstructionProject p, ConstructionReceipt x, ReceiptRequest r) {
        ConstructionSale sale = null;
        if (r.saleId() != null) {
            sale = core.sales().findById(r.saleId()).filter(s -> p.getId().equals(s.getProjectId()))
                    .orElseThrow(() -> new NotFoundException("Sale", r.saleId()));
            if ("CANCELLED".equals(sale.getStatus())) throw new BusinessException("The sale of this flat was cancelled");
        } else if (ConstructionService.DEVELOPMENT.equals(p.getKind())) {
            throw new BusinessException("Pick the flat (buyer) the money is for");
        }
        String payer = r.payer() == null ? (sale == null ? "OWNER" : "BUYER") : r.payer().trim().toUpperCase();
        if (!Set.of("OWNER", "BUYER", "BANK").contains(payer)) throw new BusinessException("Unknown payer " + payer);
        if (sale == null && !"OWNER".equals(payer)) throw new BusinessException("Money from a buyer or a bank is for a flat: pick it");
        BigDecimal interest = Money.nz(r.interestAmount());
        if (interest.compareTo(r.amount()) > 0) throw new BusinessException("The interest part is more than the amount received");
        Account into = core.requireMoneyAccount(r.accountId(), "Received into");
        x.setSaleId(sale == null ? null : sale.getId());
        x.setPayer(payer);
        x.setPayerName(ConstructionService.blank(r.payerName()) != null ? r.payerName().trim()
                : sale != null ? ("BANK".equals(payer) ? Objects.toString(sale.getLoanBank(), "the bank") + " for " + sale.getBuyerName() : sale.getBuyerName())
                : p.getClientName());
        x.setAmount(Money.round(r.amount()));
        x.setInterestAmount(interest.signum() == 0 ? null : Money.round(interest));
        x.setReceivedOn(r.receivedOn());
        x.setMode(mode(r.mode()));
        x.setReference(ConstructionService.blank(r.reference()));
        x.setAccountId(into.getId());
        x.setTowards(ConstructionService.blank(r.towards()));
        x.setNote(ConstructionService.blank(r.note()));
    }

    private JournalDraft receiptDraft(ConstructionProject p, ConstructionReceipt x) {
        BigDecimal interest = Money.nz(x.getInterestAmount());
        return JournalDraft.of(x.getReceivedOn(), VoucherType.PROJECT_RECEIPT, "Receipt " + x.getReceiptNo() + " · " + p.getName()
                        + (x.getTowards() != null ? " · " + x.getTowards() : "") + " · from " + x.getPayerName())
                .debit(x.getAccountId(), x.getAmount(), x.getMode() + (x.getReference() != null ? " " + x.getReference() : ""))
                .credit(p.getAdvancesAccountId(), x.getAmount().subtract(interest))
                .credit(p.getInterestAccountId(), interest, "Late payment interest")
                .reference(x.getReceiptNo()).party(x.getPayerName()).source(SOURCE_RECEIPT, x.getId());
    }

    private String nextReceiptNo(ConstructionProject p) {
        String prefix = ConstructionService.code(p) + "-R";
        int max = core.receipts().findByProjectId(p.getId()).stream().map(ConstructionReceipt::getReceiptNo)
                .filter(n -> n != null && n.startsWith(prefix)).mapToInt(n -> {
                    try { return Integer.parseInt(n.substring(prefix.length())); } catch (NumberFormatException e) { return 0; }
                }).max().orElse(0);
        return prefix + String.format("%04d", max + 1);
    }

    private ConstructionReceipt requireReceipt(ConstructionProject p, Long id) {
        return core.receipts().findById(id).filter(x -> p.getId().equals(x.getProjectId())).orElseThrow(() -> new NotFoundException("Receipt", id));
    }

    // ================================================================== costs

    @Transactional
    public Detail addCost(Long id, CostRequest r) {
        ConstructionProject p = core.requireOpen(id);
        ConstructionCost x = new ConstructionCost();
        x.setTenantId(p.getTenantId());
        x.setProjectId(p.getId());
        x.setCreatedBy(UserContext.username());
        x.setCreatedAt(LocalDateTime.now());
        fill(p, x, r);
        x = core.costs().save(x);
        x.setJournalEntryId(core.post(costDraft(p, x)).getId());
        core.costs().save(x);
        core.activity().record("ADDED", ConstructionService.AREA, "Cost · " + headName(x.getHead()) + " · " + ActivityService.money(x.getAmount())
                + (x.getVendor() != null ? " · " + x.getVendor() : "") + " · " + p.getName());
        return core.detail(id);
    }

    @Transactional
    public Detail updateCost(Long id, Long costId, CostRequest r) {
        ConstructionProject p = core.requireOpen(id);
        ConstructionCost x = requireCost(p, costId);
        fill(p, x, r);
        core.costs().save(x);
        if (x.getJournalEntryId() != null) core.ledger().repost(x.getJournalEntryId(), costDraft(p, x));
        core.activity().record("CHANGED", ConstructionService.AREA, "Changed a cost · " + headName(x.getHead()) + " · " + p.getName());
        return core.detail(id);
    }

    @Transactional
    public Detail deleteCost(Long id, Long costId) {
        ConstructionProject p = core.requireOpen(id);
        ConstructionCost x = requireCost(p, costId);
        Long entry = x.getJournalEntryId();
        core.costs().deleteById(x.getId());
        if (entry != null) core.ledger().delete(entry);
        core.activity().record("DELETED", ConstructionService.AREA, "Deleted a cost · " + headName(x.getHead()) + " · " + ActivityService.money(x.getAmount()) + " · " + p.getName());
        return core.detail(id);
    }

    private void fill(ConstructionProject p, ConstructionCost x, CostRequest r) {
        String head = r.head().trim().toUpperCase().replaceAll("[^A-Z0-9]+", "_").replaceAll("^_|_$", "");
        if (head.isEmpty()) throw new BusinessException("Say what the money was spent on");
        if ("LAND".equals(head) && p.getLandAccountId() == null) {
            throw new BusinessException("Land costs are for developments; a contract work's site is the owner's");
        }
        Account from = core.accountService().require(r.accountId());
        boolean card = from.getAccountType() == AccountType.CREDIT_CARD;
        if (!card) core.requireMoneyAccount(r.accountId(), "Paid from");
        if (r.stageId() != null) core.requireStage(p, r.stageId());
        x.setHead(ActivityService.cut(head, 30));
        x.setDescription(ConstructionService.blank(r.description()));
        x.setVendor(ConstructionService.blank(r.vendor()));
        x.setBillNo(ConstructionService.blank(r.billNo()));
        x.setQuantity(r.quantity());
        x.setUnit(ConstructionService.blank(r.unit()));
        x.setRate(r.rate());
        x.setAmount(Money.round(r.amount()));
        x.setSpentOn(r.spentOn());
        x.setAccountId(from.getId());
        x.setStageId(r.stageId());
    }

    private JournalDraft costDraft(ConstructionProject p, ConstructionCost x) {
        Long to = "LAND".equals(x.getHead()) ? p.getLandAccountId() : p.getCostAccountId();
        String what = headName(x.getHead()) + (x.getDescription() != null ? " · " + x.getDescription() : "");
        return JournalDraft.of(x.getSpentOn(), VoucherType.PROJECT_COST, what + " · " + p.getName())
                .debit(to, x.getAmount(), x.getQuantity() != null ? x.getQuantity().stripTrailingZeros().toPlainString() + " " + Objects.toString(x.getUnit(), "")
                        + (x.getRate() != null ? " @ " + x.getRate().stripTrailingZeros().toPlainString() : "") : null)
                .credit(x.getAccountId(), x.getAmount())
                .reference(x.getBillNo()).party(x.getVendor()).source(SOURCE_COST, x.getId());
    }

    private ConstructionCost requireCost(ConstructionProject p, Long id) {
        return core.costs().findById(id).filter(x -> p.getId().equals(x.getProjectId())).orElseThrow(() -> new NotFoundException("Cost", id));
    }

    static String headName(String head) {
        String s = head.replace('_', ' ').toLowerCase();
        return Character.toUpperCase(s.charAt(0)) + s.substring(1);
    }

    // ================================================================== partners and their capital

    @Transactional
    public Detail addPartner(Long id, PartnerRequest r) {
        ConstructionProject p = core.requireOpen(id);
        List<ConstructionPartner> ps = core.partners().findByProjectId(id);
        if (Boolean.TRUE.equals(r.me()) && ps.stream().anyMatch(x -> Boolean.TRUE.equals(x.getMe()))) throw new BusinessException("You are already a partner");
        // a new partner's share is taken from mine (or the first partner's), so the shares still make 100%
        BigDecimal share = r.sharePercent();
        if (!ps.isEmpty() && share.signum() > 0) {
            ConstructionPartner giver = ps.stream().filter(x -> Boolean.TRUE.equals(x.getMe())).findFirst().orElse(ps.getFirst());
            if (giver.getSharePercent().compareTo(share) < 0) {
                throw new BusinessException(giver.getName() + " has " + giver.getSharePercent().stripTrailingZeros().toPlainString()
                        + "% to give; set the shares on the Partners tab instead");
            }
            giver.setSharePercent(giver.getSharePercent().subtract(share));
            core.partners().save(giver);
        }
        ConstructionPartner x = core.addPartner(p, new PartnerInput(r.name(), r.phone(), r.address(), ps.isEmpty() ? Money.HUNDRED : share, r.me()));
        x.setNote(ConstructionService.blank(r.note()));
        core.partners().save(x);
        core.activity().record("ADDED", ConstructionService.AREA, "Partner " + x.getName() + " · " + x.getSharePercent().stripTrailingZeros().toPlainString() + "% · " + p.getName());
        return core.detail(id);
    }

    @Transactional
    public Detail updatePartner(Long id, Long partnerId, PartnerRequest r) {
        ConstructionProject p = core.requireOpen(id);
        ConstructionPartner x = requirePartner(p, partnerId);
        x.setName(r.name().trim());
        x.setPhone(ConstructionService.phone(r.phone(), r.name()));
        x.setAddress(ConstructionService.blank(r.address()));
        x.setNote(ConstructionService.blank(r.note()));
        core.partners().save(x);
        return core.detail(id);
    }

    @Transactional
    public Detail shares(Long id, SharesRequest r) {
        ConstructionProject p = core.requireOpen(id);
        ConstructionService.validateShares(r.shares().stream().map(ShareRow::sharePercent).toList());
        List<ConstructionPartner> ps = core.partners().findByProjectId(id);
        if (r.shares().size() != ps.size()) throw new BusinessException("Give every partner's share");
        for (ShareRow s : r.shares()) {
            ConstructionPartner x = requirePartner(p, s.partnerId());
            x.setSharePercent(s.sharePercent());
            core.partners().save(x);
        }
        core.activity().record("CHANGED", ConstructionService.AREA, "Partners' shares of " + p.getName() + " · " + ps.size() + " partners");
        return core.detail(id);
    }

    @Transactional
    public Detail deletePartner(Long id, Long partnerId) {
        ConstructionProject p = core.requireOpen(id);
        ConstructionPartner x = requirePartner(p, partnerId);
        if (core.capital().findByProjectId(id).stream().anyMatch(c -> partnerId.equals(c.getPartnerId()))) {
            throw new BusinessException(x.getName() + " has money recorded in the project");
        }
        List<ConstructionPartner> rest = core.partners().findByProjectId(id).stream().filter(o -> !o.getId().equals(partnerId)).toList();
        if (!rest.isEmpty() && x.getSharePercent().signum() > 0) {
            // their share goes back to me (or the first partner)
            ConstructionPartner taker = rest.stream().filter(o -> Boolean.TRUE.equals(o.getMe())).findFirst().orElse(rest.getFirst());
            taker.setSharePercent(taker.getSharePercent().add(x.getSharePercent()));
            core.partners().save(taker);
        }
        Long account = x.getAccountId();
        core.partners().deleteById(partnerId);
        if (account != null && core.ledger().entryIdsTouchingAccount(account).isEmpty()) core.accounts().deleteById(account);
        core.activity().record("DELETED", ConstructionService.AREA, "Removed the partner " + x.getName() + " · " + p.getName());
        return core.detail(id);
    }

    @Transactional
    public Detail addCapital(Long id, CapitalRequest r) {
        ConstructionProject p = core.requireOpen(id);
        ConstructionPartner partner = requirePartner(p, r.partnerId());
        String kind = r.kind().trim().toUpperCase();
        if (!Set.of("INVEST", "WITHDRAW").contains(kind)) throw new BusinessException("Money put in or taken out");
        Account side = core.requireMoneyAccount(r.accountId(), "The project's account");
        boolean me = Boolean.TRUE.equals(partner.getMe());
        Account mine = null;
        if (me) {
            if (r.fromAccountId() == null) throw new BusinessException("Pick your own account the money " + ("INVEST".equals(kind) ? "comes from" : "goes to"));
            mine = core.requireMoneyAccount(r.fromAccountId(), "Your account");
            if (mine.getId().equals(side.getId())) throw new BusinessException("Pick two different accounts");
        }
        ConstructionCapital c = new ConstructionCapital();
        c.setTenantId(p.getTenantId());
        c.setProjectId(p.getId());
        c.setPartnerId(partner.getId());
        c.setKind(kind);
        c.setAmount(Money.round(r.amount()));
        c.setMovedOn(r.movedOn());
        c.setAccountId(side.getId());
        c.setFromAccountId(mine == null ? null : mine.getId());
        c.setNote(ConstructionService.blank(r.note()));
        c.setCreatedBy(UserContext.username());
        c.setCreatedAt(LocalDateTime.now());
        c = core.capital().save(c);
        Long other = me ? mine.getId() : core.partnerAccount(p, partner).getId();
        boolean in = "INVEST".equals(kind);
        JournalDraft d = JournalDraft.of(c.getMovedOn(), me ? VoucherType.TRANSFER : VoucherType.PROJECT_CAPITAL,
                        (in ? "Capital from " : "Paid to ") + (me ? "me" : partner.getName()) + " · " + p.getName() + (c.getNote() != null ? " · " + c.getNote() : ""))
                .party(partner.getName()).source(SOURCE_CAPITAL, c.getId());
        if (in) d.debit(side.getId(), c.getAmount()).credit(other, c.getAmount());
        else d.debit(other, c.getAmount()).credit(side.getId(), c.getAmount());
        c.setJournalEntryId(core.post(d).getId());
        core.capital().save(c);
        core.activity().record("ADDED", ConstructionService.AREA, (in ? "Capital in · " : "Capital out · ") + partner.getName() + " · " + ActivityService.money(c.getAmount()) + " · " + p.getName());
        return core.detail(id);
    }

    @Transactional
    public Detail deleteCapital(Long id, Long capitalId) {
        ConstructionProject p = core.requireOpen(id);
        ConstructionCapital c = core.capital().findById(capitalId).filter(x -> p.getId().equals(x.getProjectId()))
                .orElseThrow(() -> new NotFoundException("Capital", capitalId));
        if ("PROFIT".equals(c.getKind())) throw new BusinessException("A share of the profit goes with the project's closing: re-open it instead");
        Long entry = c.getJournalEntryId();
        core.capital().deleteById(capitalId);
        if (entry != null) core.ledger().delete(entry);
        return core.detail(id);
    }

    private ConstructionPartner requirePartner(ConstructionProject p, Long id) {
        return core.partners().findById(id).filter(x -> p.getId().equals(x.getProjectId())).orElseThrow(() -> new NotFoundException("Partner", id));
    }

    // ================================================================== loans

    @Transactional
    public Detail saveLoan(Long id, Long loanId, LoanRequest r) {
        ConstructionProject p = core.requireOpen(id);
        ConstructionLoan l;
        if (loanId == null) {
            l = new ConstructionLoan();
            l.setTenantId(p.getTenantId());
            l.setProjectId(p.getId());
            l.setStatus("ACTIVE");
            l.setCreatedAt(LocalDateTime.now());
            Account a = core.newAccount(p, "loan · " + r.lender().trim(), AccountType.LOAN, "LOAN", "Loan from " + r.lender().trim() + " for " + p.getName());
            a.setInstitution(ActivityService.cut(r.lender().trim(), 100));
            l.setAccountId(core.accounts().save(a).getId());
        } else {
            l = requireLoan(p, loanId);
        }
        l.setLender(r.lender().trim());
        l.setLoanNo(ConstructionService.blank(r.loanNo()));
        l.setSanctioned(Money.round(r.sanctioned()));
        l.setRatePercent(r.ratePercent());
        l.setTenureMonths(r.tenureMonths());
        l.setSanctionDate(r.sanctionDate());
        l.setNote(ConstructionService.blank(r.note()));
        l = core.loans().save(l);
        Account a = core.accounts().findById(l.getAccountId()).orElseThrow();
        a.setCreditLimit(l.getSanctioned());
        a.setInterestRate(l.getRatePercent());
        a.setAccountNumber(l.getLoanNo() == null ? null : ActivityService.cut(l.getLoanNo(), 40));
        core.accounts().save(a);
        core.activity().record(loanId == null ? "ADDED" : "CHANGED", ConstructionService.AREA, "Loan from " + l.getLender() + " · " + ActivityService.money(l.getSanctioned()) + " · " + p.getName());
        return core.detail(id);
    }

    @Transactional
    public Detail deleteLoan(Long id, Long loanId) {
        ConstructionProject p = core.requireOpen(id);
        ConstructionLoan l = requireLoan(p, loanId);
        if (core.loanTxns().findByProjectId(id).stream().anyMatch(t -> loanId.equals(t.getLoanId()))) {
            throw new BusinessException("The loan has money recorded; close it instead");
        }
        core.loans().deleteById(loanId);
        core.accounts().deleteById(l.getAccountId());
        return core.detail(id);
    }

    @Transactional
    public Detail addLoanTxn(Long id, Long loanId, LoanTxnRequest r) {
        ConstructionProject p = core.requireOpen(id);
        ConstructionLoan l = requireLoan(p, loanId);
        String kind = r.kind().trim().toUpperCase();
        if (!Set.of("DISBURSE", "INTEREST", "REPAY", "CHARGES").contains(kind)) throw new BusinessException("Unknown loan movement " + kind);
        Account bank = core.requireMoneyAccount(r.accountId(), "DISBURSE".equals(kind) ? "Disbursed into" : "Paid from");
        ConstructionLoanTxn t = new ConstructionLoanTxn();
        t.setTenantId(p.getTenantId());
        t.setProjectId(p.getId());
        t.setLoanId(l.getId());
        t.setKind(kind);
        t.setAmount(Money.round(r.amount()));
        t.setMovedOn(r.movedOn());
        t.setAccountId(bank.getId());
        t.setNote(ConstructionService.blank(r.note()));
        t.setCreatedBy(UserContext.username());
        t.setCreatedAt(LocalDateTime.now());
        t = core.loanTxns().save(t);
        String what = switch (kind) {
            case "DISBURSE" -> "Loan disbursed by ";
            case "INTEREST" -> "Loan interest to ";
            case "REPAY" -> "Loan repaid to ";
            default -> "Loan charges of ";
        };
        JournalDraft d = JournalDraft.of(t.getMovedOn(), VoucherType.PROJECT_LOAN, what + l.getLender() + " · " + p.getName() + (t.getNote() != null ? " · " + t.getNote() : ""))
                .party(l.getLender()).reference(l.getLoanNo()).source(SOURCE_LOAN, t.getId());
        switch (kind) {
            case "DISBURSE" -> d.debit(bank.getId(), t.getAmount()).credit(l.getAccountId(), t.getAmount());
            case "REPAY" -> d.debit(l.getAccountId(), t.getAmount()).credit(bank.getId(), t.getAmount());
            // interest and charges are a cost of the project (borrowing costs are part of what it cost to build)
            default -> d.debit(p.getCostAccountId(), t.getAmount(), "INTEREST".equals(kind) ? "Loan interest" : "Loan charges").credit(bank.getId(), t.getAmount());
        }
        t.setJournalEntryId(core.post(d).getId());
        core.loanTxns().save(t);
        if ("REPAY".equals(kind) && core.balances().getOrDefault(l.getAccountId(), Money.ZERO).signum() <= 0
                && core.loanTxns().findByProjectId(id).stream().anyMatch(x -> l.getId().equals(x.getLoanId()) && "DISBURSE".equals(x.getKind()))) {
            l.setStatus("CLOSED");
            core.loans().save(l);
        }
        core.activity().record("ADDED", ConstructionService.AREA, what + l.getLender() + " · " + ActivityService.money(t.getAmount()) + " · " + p.getName());
        return core.detail(id);
    }

    @Transactional
    public Detail deleteLoanTxn(Long id, Long txnId) {
        ConstructionProject p = core.requireOpen(id);
        ConstructionLoanTxn t = core.loanTxns().findById(txnId).filter(x -> p.getId().equals(x.getProjectId()))
                .orElseThrow(() -> new NotFoundException("Loan movement", txnId));
        Long entry = t.getJournalEntryId();
        core.loanTxns().deleteById(txnId);
        if (entry != null) core.ledger().delete(entry);
        ConstructionLoan l = core.loans().findById(t.getLoanId()).orElseThrow();
        if ("CLOSED".equals(l.getStatus())) { l.setStatus("ACTIVE"); core.loans().save(l); }
        return core.detail(id);
    }

    private ConstructionLoan requireLoan(ConstructionProject p, Long id) {
        return core.loans().findById(id).filter(x -> p.getId().equals(x.getProjectId())).orElseThrow(() -> new NotFoundException("Loan", id));
    }

    // ================================================================== transfers and common accounts

    @Transactional
    public Detail transfer(Long id, TransferRequest r) {
        ConstructionProject p = core.requireOpen(id);
        Account from = core.requireMoneyAccount(r.fromAccountId(), "From");
        Account to = core.requireMoneyAccount(r.toAccountId(), "To");
        if (from.getId().equals(to.getId())) throw new BusinessException("Pick two different accounts");
        JournalEntry e = core.post(JournalDraft.of(r.movedOn(), VoucherType.TRANSFER, "Moved money · " + from.getName() + " → " + to.getName() + " · " + p.getName()
                        + (ConstructionService.blank(r.note()) != null ? " · " + r.note().trim() : ""))
                .debit(to.getId(), Money.round(r.amount())).credit(from.getId(), Money.round(r.amount())).party(p.getName()).source(SOURCE_TRANSFER, p.getId()));
        core.activity().record("ADDED", ConstructionService.AREA, "Moved " + ActivityService.money(r.amount()) + " · " + from.getName() + " → " + to.getName() + " · " + e.getEntryNo());
        return core.detail(id);
    }

    @Transactional
    public ConstructionService.Overview addCommonAccount(CommonAccountRequest r) {
        AccountType type = switch (r.type().trim().toUpperCase()) {
            case "BANK" -> AccountType.BANK;
            case "CASH" -> AccountType.CASH;
            case "WALLET" -> AccountType.WALLET;
            default -> throw new BusinessException("A bank account, cash or a wallet");
        };
        Account a = core.accountService().createInternal(core.uniqueName(r.name().trim()), type, "A common account of the construction business", false);
        a.setProjectBook(true);
        a.setProjectRole("COMMON");
        a.setInstitution(ConstructionService.blank(r.institution()));
        a.setAccountNumber(ConstructionService.blank(r.accountNumber()));
        a = core.accounts().save(a);
        if (Money.nz(r.openingBalance()).signum() > 0) {
            Account equity = core.ledger().systemAccount(DefaultChartOfAccounts.OPENING_BALANCE_EQUITY);
            core.post(JournalDraft.of(r.openingDate() != null ? r.openingDate() : LocalDate.now(), VoucherType.OPENING, "Opening balance - " + a.getName())
                    .debit(a.getId(), Money.round(r.openingBalance())).credit(equity.getId(), Money.round(r.openingBalance()))
                    .source(LedgerService.SOURCE_ACCOUNT_OPENING, a.getId()));
            a.setOpeningBalance(Money.round(r.openingBalance()));
            a.setOpeningDate(r.openingDate() != null ? r.openingDate() : LocalDate.now());
            core.accounts().save(a);
        }
        core.activity().record("ADDED", ConstructionService.AREA, "Common business account " + a.getName());
        return core.overview();
    }

    static String mode(String mode) {
        if (mode == null || mode.isBlank()) return "Bank";
        return MODES.stream().filter(m -> m.equalsIgnoreCase(mode.trim())).findFirst()
                .orElseThrow(() -> new BusinessException("Pay by cash, UPI, bank, cheque, DD or card"));
    }

    /** Accounts money of the business can move through: liquid, active, not the chit book's. */
    static boolean money(Account a) {
        return a.getAccountClass() == AccountClass.ASSET && a.getAccountType().isLiquid() && Boolean.TRUE.equals(a.getActive()) && !a.isChitBook();
    }
}
