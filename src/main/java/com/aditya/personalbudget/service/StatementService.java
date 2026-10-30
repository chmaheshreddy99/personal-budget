package com.aditya.personalbudget.service;

import com.aditya.personalbudget.domain.entity.StatementSubscription;
import com.aditya.personalbudget.domain.type.AccountClass;
import com.aditya.personalbudget.domain.type.ClaimStatus;
import com.aditya.personalbudget.dto.AccountDtos.AccountView;
import com.aditya.personalbudget.dto.ChitDtos.ChitDetail;
import com.aditya.personalbudget.dto.ChitDtos.ChitView;
import com.aditya.personalbudget.dto.ChitDtos.InstallmentView;
import com.aditya.personalbudget.dto.ClaimDtos.ClaimView;
import com.aditya.personalbudget.dto.ReportDtos.AccountAmount;
import com.aditya.personalbudget.dto.ReportDtos.AccountLedger;
import com.aditya.personalbudget.dto.ReportDtos.BalanceSheet;
import com.aditya.personalbudget.dto.ReportDtos.IncomeStatement;
import com.aditya.personalbudget.dto.ReportDtos.LedgerRow;
import com.aditya.personalbudget.dto.ReportDtos.SheetGroup;
import com.aditya.personalbudget.dto.ReportDtos.SheetSection;
import com.aditya.personalbudget.dto.ReportDtos.ValuePoint;
import com.aditya.personalbudget.exception.BusinessException;
import com.aditya.personalbudget.exception.NotFoundException;
import com.aditya.personalbudget.repository.StatementSubscriptionRepository;
import com.aditya.personalbudget.security.CurrentUser;
import com.aditya.personalbudget.security.UserContext;
import com.aditya.personalbudget.service.StatementPdf.Col;
import com.aditya.personalbudget.service.StatementPdf.Row;
import com.aditya.personalbudget.service.StatementPdf.Tile;
import jakarta.mail.internet.MimeMessage;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.core.io.ByteArrayResource;
import org.springframework.mail.javamail.MimeMessageHelper;
import org.springframework.stereotype.Service;

import javax.crypto.Cipher;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.time.LocalDate;
import java.time.YearMonth;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Base64;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.function.Function;
import java.util.regex.Pattern;
import java.util.stream.Collectors;

/**
 * Monthly statements by e-mail, subscribed to by the organization: the consolidated account statement, the balance
 * sheet, the chits statement, the income and expense statement, money lent and owed, and the EMIs. Each is a PDF laid
 * out like a bank statement ({@link StatementPdf}), optionally locked with a password, sent on the chosen day of the
 * month for the month before (StatementJob), or now from Settings, Statements.
 */
@Service
public class StatementService {

    private static final Logger log = LoggerFactory.getLogger(StatementService.class);
    private static final String AREA = "Statements";
    private static final String KEY = "statement.pdf-password-key";
    private static final Pattern EMAIL = Pattern.compile("^[^@\\s,;]+@[^@\\s,;]+\\.[^@\\s,;]+$");
    private static final DateTimeFormatter MONTH = DateTimeFormatter.ofPattern("MMMM yyyy", Locale.ENGLISH);
    private static final DateTimeFormatter DAY = DateTimeFormatter.ofPattern("dd MMM yyyy", Locale.ENGLISH);
    private static final int MAX_RECIPIENTS = 10;

    /** A statement one can subscribe to. */
    public record Kind(String key, String label, String description, String iconName) {
    }

    public static final List<Kind> KINDS = List.of(
            new Kind("ACCOUNTS", "Consolidated account statement", "Every bank, card, cash and loan account: opening and closing balances, then each account's transactions with the running balance, like a bank statement.", "bank"),
            new Kind("BALANCE_SHEET", "Balance sheet", "What you own and owe at the month end against the month before, net worth and its change, and the health ratios.", "scale"),
            new Kind("CHITS", "Chits statement", "Every chit: installments paid in the month and to date, dividends, what is still to pay, the next due and the full installment schedule.", "chit"),
            new Kind("INCOME_EXPENSE", "Income & expense statement", "The month's income and spending by category against the month before, the surplus and the savings rate.", "report"),
            new Kind("MONEY_OWED", "Money lent & owed", "What others owe you and what you owe: each item with what was repaid, what is outstanding, interest and due dates.", "hand"),
            new Kind("EMIS", "EMI statement", "Every running EMI: the instalment, how many are paid, what is outstanding, interest left and when it ends.", "calendar"));

    public record SubscriptionView(Long id, String kind, String kindLabel, List<String> recipients, List<Long> accountIds, int dayOfMonth,
                                   boolean protect, boolean hasPassword, boolean active, String lastPeriod, java.time.LocalDateTime lastSentAt,
                                   String lastResult, String createdBy) {
    }

    public record SubscriptionRequest(@NotBlank @Size(max = 20) String kind, @NotBlank @Size(max = 600) String recipients,
                                      List<Long> accountIds, @Min(1) @Max(28) Integer dayOfMonth, Boolean protect,
                                      @Size(min = 4, max = 64) String password, Boolean active) {
    }

    public record Overview(List<Kind> kinds, List<SubscriptionView> subscriptions, boolean mailReady, String mailFrom, String lastMonth) {
    }

    public record SendResult(String period, int sent, String result) {
    }

    /** A rendered statement: the PDF, its file name and subject, and a few lines for the e-mail. */
    public record Rendered(byte[] pdf, String fileName, String subject, List<String> highlights) {
    }

    private final StatementSubscriptionRepository subscriptions;
    private final ReportService reports;
    private final AccountService accounts;
    private final ChitService chits;
    private final ClaimService claims;
    private final EmiService emis;
    private final TenantMailService mail;
    private final AppSettingsService settings;
    private final ActivityService activity;
    private final SecureRandom random = new SecureRandom();

    public StatementService(StatementSubscriptionRepository subscriptions, ReportService reports, AccountService accounts, ChitService chits,
                            ClaimService claims, EmiService emis, TenantMailService mail, AppSettingsService settings, ActivityService activity) {
        this.subscriptions = subscriptions;
        this.reports = reports;
        this.accounts = accounts;
        this.chits = chits;
        this.claims = claims;
        this.emis = emis;
        this.mail = mail;
        this.settings = settings;
        this.activity = activity;
    }

    // ================================================================== subscriptions

    public Overview overview() {
        var sender = mail.sender();
        return new Overview(KINDS, mine().stream().map(this::view).toList(), sender.isPresent(), sender.map(TenantMailService.Sender::from).orElse(null),
                OrgClock.today().minusMonths(1).withDayOfMonth(1).toString().substring(0, 7));
    }

    public SubscriptionView create(SubscriptionRequest r) {
        StatementSubscription s = new StatementSubscription();
        s.setTenantId(UserContext.tenantId());
        s.setCreatedBy(UserContext.username());
        s.setCreatedAt(OrgClock.now().withNano(0));
        apply(s, r, true);
        s = subscriptions.save(s);
        activity.record("ADDED", AREA, "Subscribed " + String.join(", ", split(s.getRecipients())) + " to the monthly " + kind(s.getKind()).label().toLowerCase(Locale.ROOT));
        return view(s);
    }

    public SubscriptionView update(Long id, SubscriptionRequest r) {
        StatementSubscription s = own(id);
        apply(s, r, false);
        return view(subscriptions.save(s));
    }

    public void delete(Long id) {
        StatementSubscription s = own(id);
        subscriptions.deleteById(s.getId());
        activity.record("DELETED", AREA, "Stopped the monthly " + kind(s.getKind()).label().toLowerCase(Locale.ROOT) + " to " + s.getRecipients());
    }

    /** Sends a subscription's statement for {@code period} (the month before, when null) now. */
    public SendResult sendNow(Long id, YearMonth period) {
        StatementSubscription s = own(id);
        return send(s, period != null ? period : YearMonth.from(OrgClock.today()).minusMonths(1), true);
    }

    /**
     * The scheduled run for the current organization: every active subscription whose day has come and whose previous
     * month has not gone out yet. Returns how many were sent.
     */
    public int sendDue() {
        LocalDate today = OrgClock.today();
        YearMonth last = YearMonth.from(today).minusMonths(1);
        int sent = 0;
        for (StatementSubscription s : mine()) {
            if (!Boolean.TRUE.equals(s.getActive()) || today.getDayOfMonth() < day(s) || last.toString().equals(s.getLastPeriod())) {
                continue;
            }
            if (send(s, last, false).sent() > 0) {
                sent++;
            }
        }
        return sent;
    }

    private SendResult send(StatementSubscription s, YearMonth period, boolean manual) {
        List<String> to = split(s.getRecipients());
        String result;
        int sent = 0;
        try {
            TenantMailService.Sender sender = mail.sender()
                    .orElseThrow(() -> new BusinessException("E-mail is not set up: add your e-mail account in Settings, E-mail"));
            String password = Boolean.TRUE.equals(s.getProtect()) && s.getPasswordEnc() != null ? decrypt(s.getPasswordEnc()) : null;
            Rendered pdf = render(s.getKind(), period, ids(s.getAccountIds()), password);
            String org = UserContext.current().map(CurrentUser::tenantName).orElse("");
            MimeMessage message = sender.mail().createMimeMessage();
            MimeMessageHelper helper = new MimeMessageHelper(message, true, "UTF-8");
            helper.setFrom(sender.from(), sender.fromName() != null ? sender.fromName() : org);
            if (sender.replyTo() != null && !sender.replyTo().isBlank()) helper.setReplyTo(sender.replyTo());
            helper.setTo(to.toArray(String[]::new));
            helper.setSubject(pdf.subject());
            StringBuilder body = new StringBuilder("Hello,\n\nYour ").append(kind(s.getKind()).label().toLowerCase(Locale.ROOT)).append(" for ")
                    .append(MONTH.format(period)).append(" is attached (").append(pdf.fileName()).append(").\n\n");
            pdf.highlights().forEach(h -> body.append("  - ").append(h).append('\n'));
            if (password != null) body.append("\nThe PDF is locked: open it with the password set for this statement in Settings, Statements.\n");
            body.append("\nSent every month on day ").append(day(s)).append(" by ").append(org).append("'s Personal Budget.\n");
            helper.setText(body.toString(), false);
            helper.addAttachment(pdf.fileName(), new ByteArrayResource(pdf.pdf()), "application/pdf");
            sender.mail().send(message);
            sent = to.size();
            result = "Sent " + MONTH.format(period) + " to " + to.size() + " recipient" + (to.size() == 1 ? "" : "s");
            s.setLastPeriod(period.toString());
            s.setLastSentAt(OrgClock.now().withNano(0));
        } catch (Exception e) {
            result = "Not sent: " + ActivityService.cut(TenantMailService.rootMessage(e), 200);
            log.warn("Statement {} ({}) for {} not sent: {}", s.getId(), s.getKind(), period, result);
        }
        s.setLastResult(ActivityService.cut(result, 250));
        subscriptions.save(s);
        activity.record("SENT", AREA, (manual ? "" : "Monthly: ") + kind(s.getKind()).label() + " · " + result);
        return new SendResult(period.toString(), sent, result);
    }

    private void apply(StatementSubscription s, SubscriptionRequest r, boolean creating) {
        kind(r.kind());
        List<String> to = split(r.recipients());
        if (to.isEmpty()) throw new BusinessException("Add at least one e-mail address");
        if (to.size() > MAX_RECIPIENTS) throw new BusinessException("At most " + MAX_RECIPIENTS + " e-mail addresses");
        for (String a : to) {
            if (!EMAIL.matcher(a).matches()) throw new BusinessException("Not an e-mail address: " + a);
        }
        s.setKind(r.kind());
        s.setRecipients(String.join(",", to));
        if ("ACCOUNTS".equals(r.kind()) && r.accountIds() != null) {
            Set<Long> mineIds = ownAccounts().stream().map(AccountView::id).collect(Collectors.toSet());
            s.setAccountIds(r.accountIds().stream().filter(mineIds::contains).map(String::valueOf).collect(Collectors.joining(",")));
        } else {
            s.setAccountIds(null);
        }
        s.setDayOfMonth(r.dayOfMonth() == null ? 1 : r.dayOfMonth());
        boolean protect = Boolean.TRUE.equals(r.protect());
        if (r.password() != null && !r.password().isBlank()) s.setPasswordEnc(encrypt(r.password()));
        if (protect && s.getPasswordEnc() == null) throw new BusinessException("Set the password that will open the PDF");
        s.setProtect(protect);
        s.setActive(r.active() == null ? creating || Boolean.TRUE.equals(s.getActive()) : r.active());
    }

    private SubscriptionView view(StatementSubscription s) {
        return new SubscriptionView(s.getId(), s.getKind(), kind(s.getKind()).label(), split(s.getRecipients()), ids(s.getAccountIds()), day(s),
                Boolean.TRUE.equals(s.getProtect()), s.getPasswordEnc() != null, Boolean.TRUE.equals(s.getActive()), s.getLastPeriod(), s.getLastSentAt(),
                s.getLastResult(), s.getCreatedBy());
    }

    private List<StatementSubscription> mine() {
        return subscriptions.findByTenantId(UserContext.tenantId()).stream().sorted(Comparator.comparing(StatementSubscription::getId)).toList();
    }

    private StatementSubscription own(Long id) {
        return subscriptions.findByIdAndTenantId(id, UserContext.tenantId()).orElseThrow(() -> new NotFoundException("Statement subscription", id));
    }

    private static int day(StatementSubscription s) {
        return s.getDayOfMonth() == null ? 1 : Math.max(1, Math.min(28, s.getDayOfMonth()));
    }

    static Kind kind(String key) {
        return KINDS.stream().filter(k -> k.key().equals(key)).findFirst().orElseThrow(() -> new BusinessException("Unknown statement: " + key));
    }

    private static List<String> split(String v) {
        return v == null ? List.of() : Arrays.stream(v.split("[,;\\s]+")).map(String::trim).filter(x -> !x.isEmpty()).distinct().toList();
    }

    private static List<Long> ids(String v) {
        return v == null ? List.of() : Arrays.stream(v.split(",")).map(String::trim).filter(x -> x.matches("\\d+")).map(Long::valueOf).toList();
    }

    // ================================================================== rendering

    /** The statement for {@code period} as a PDF; {@code accountIds} narrows the account statement (empty: all). */
    public Rendered render(String kindKey, YearMonth period, List<Long> accountIds, String password) {
        Kind k = kind(kindKey);
        String org = UserContext.current().map(CurrentUser::tenantName).orElse("Personal Budget");
        LocalDate from = period.atDay(1), to = period.atEndOfMonth();
        String periodLabel = "Statement period: " + DAY.format(from) + " to " + DAY.format(to);
        List<String[]> details = new ArrayList<>(List.of(new String[]{"Statement of", org}, new String[]{"For", MONTH.format(period)},
                new String[]{"Currency", "INR (Rs.)"}));
        StatementPdf pdf = new StatementPdf().header(org, k.label(), periodLabel, details);
        List<String> highlights = switch (k.key()) {
            case "ACCOUNTS" -> accountsStatement(pdf, from, to, accountIds);
            case "BALANCE_SHEET" -> balanceSheet(pdf, to);
            case "CHITS" -> chitsStatement(pdf, from, to);
            case "INCOME_EXPENSE" -> incomeExpense(pdf, period);
            case "MONEY_OWED" -> moneyOwed(pdf, to);
            case "EMIS" -> emiStatement(pdf, to);
            default -> throw new BusinessException("Unknown statement: " + kindKey);
        };
        String file = k.label().replaceAll("[^A-Za-z0-9]+", "-").replaceAll("-+$", "") + "-" + period + ".pdf";
        return new Rendered(pdf.finish(password), file, org + " · " + k.label() + " · " + MONTH.format(period), highlights);
    }

    private List<AccountView> ownAccounts() {
        return accounts.list().stream()
                .filter(a -> a.active() && !a.chitBook() && !a.projectBook()
                        && (a.accountClass() == AccountClass.ASSET || a.accountClass() == AccountClass.LIABILITY))
                .toList();
    }

    // ---------------------------------------------------------------- the consolidated account statement

    private List<String> accountsStatement(StatementPdf pdf, LocalDate from, LocalDate to, List<Long> only) {
        List<AccountView> list = ownAccounts().stream().filter(a -> only == null || only.isEmpty() || only.contains(a.id()))
                .sorted(Comparator.comparing((AccountView a) -> a.accountClass().ordinal()).thenComparing(AccountView::typeLabel).thenComparing(AccountView::name))
                .toList();
        Map<Long, AccountLedger> ledgers = new LinkedHashMap<>();
        for (AccountView a : list) {
            ledgers.put(a.id(), reports.accountLedger(a.id(), from, to));
        }
        BigDecimal assetsOpen = BigDecimal.ZERO, assetsClose = BigDecimal.ZERO, owedOpen = BigDecimal.ZERO, owedClose = BigDecimal.ZERO,
                in = BigDecimal.ZERO, out = BigDecimal.ZERO;
        int txns = 0;
        List<Row> rows = new ArrayList<>();
        for (AccountView a : list) {
            AccountLedger l = ledgers.get(a.id());
            boolean asset = a.accountClass() == AccountClass.ASSET;
            BigDecimal ins = asset ? nz(l.totalDebit()) : nz(l.totalCredit()), outs = asset ? nz(l.totalCredit()) : nz(l.totalDebit());
            if (asset) {
                assetsOpen = assetsOpen.add(nz(l.openingBalance()));
                assetsClose = assetsClose.add(nz(l.closingBalance()));
                in = in.add(ins);
                out = out.add(outs);
            } else {
                owedOpen = owedOpen.add(nz(l.openingBalance()));
                owedClose = owedClose.add(nz(l.closingBalance()));
            }
            txns += l.rows().size();
            rows.add(Row.of(a.name(), a.typeLabel() + (a.accountNumber() != null && !a.accountNumber().isBlank() ? " ..." + last4(a.accountNumber()) : ""),
                    StatementPdf.amount(l.openingBalance()), StatementPdf.amountOrBlank(ins), StatementPdf.amountOrBlank(outs), StatementPdf.amount(l.closingBalance()),
                    String.valueOf(l.rows().size())));
        }
        BigDecimal net = assetsClose.subtract(owedClose);
        pdf.tiles(List.of(
                new Tile("Money you hold", StatementPdf.rs(assetsClose), "was " + StatementPdf.rs(assetsOpen), null),
                new Tile("Money in (assets)", StatementPdf.rs(in), "credits to your accounts", "good"),
                new Tile("Money out (assets)", StatementPdf.rs(out), "debits from your accounts", "bad"),
                new Tile("Cards & loans owed", StatementPdf.rs(owedClose), "was " + StatementPdf.rs(owedOpen), owedClose.signum() > 0 ? "warn" : null),
                new Tile("Net position", StatementPdf.rs(net), "holdings less dues", net.signum() >= 0 ? "good" : "bad"),
                new Tile("Accounts", String.valueOf(list.size()), txns + " transactions in the month", null)));
        pdf.section("Account summary", "opening and closing balances for the period");
        pdf.table(List.of(Col.wrap("Account", 3.2f), Col.text("Type", 2), Col.num("Opening", 1.6f), Col.num("Money in", 1.5f), Col.num("Money out", 1.5f),
                Col.num("Closing", 1.6f), Col.num("Txns", 0.7f)), rows, null);
        pdf.note("Money in and out: for bank, cash and wallet accounts, deposits and withdrawals; for cards and loans, new charges and the payments made. "
                + "The transactions of every account that moved in the month follow; accounts that did not are in the summary only.");
        for (AccountView a : list) {
            AccountLedger l = ledgers.get(a.id());
            if (l.rows().isEmpty()) {
                continue;   // in the summary above; nothing moved
            }
            boolean asset = a.accountClass() == AccountClass.ASSET;
            pdf.keep(170).gap(6).section(a.name(), a.typeLabel() + (a.institution() != null ? " · " + a.institution() : ""));
            List<String[]> facts = new ArrayList<>();
            facts.add(new String[]{"Account", a.name()});
            facts.add(new String[]{"Type", a.typeLabel()});
            if (a.accountNumber() != null && !a.accountNumber().isBlank()) facts.add(new String[]{"Account no.", "XXXX" + last4(a.accountNumber())});
            if (a.ifsc() != null && !a.ifsc().isBlank()) facts.add(new String[]{"IFSC", a.ifsc()});
            if (a.interestRate() != null) facts.add(new String[]{"Interest rate", StatementPdf.percent(a.interestRate()) + " a year"});
            if (a.creditLimit() != null) facts.add(new String[]{"Credit limit", StatementPdf.rs(a.creditLimit())});
            facts.add(new String[]{"Opening balance", StatementPdf.rs(l.openingBalance())});
            facts.add(new String[]{"Closing balance", StatementPdf.rs(l.closingBalance())});
            pdf.facts(facts);
            List<Row> lines = new ArrayList<>();
            lines.add(Row.bold(DAY.format(from), "", "Opening balance", "", "", "", StatementPdf.amount(l.openingBalance())));
            for (LedgerRow r : l.rows()) {
                BigDecimal outAmt = asset ? r.credit() : r.debit(), inAmt = asset ? r.debit() : r.credit();
                lines.add(Row.of(DAY.format(r.date()), Objects.toString(r.entryNo(), ""), narration(r), Objects.toString(r.counterAccounts(), ""),
                        StatementPdf.amountOrBlank(outAmt), StatementPdf.amountOrBlank(inAmt), StatementPdf.amount(r.balance())));
            }
            BigDecimal ins = asset ? nz(l.totalDebit()) : nz(l.totalCredit()), outs = asset ? nz(l.totalCredit()) : nz(l.totalDebit());
            pdf.table(List.of(Col.text("Date", 1.3f), Col.text("Ref", 1.35f), Col.wrap("Narration", 3.3f), Col.wrap("Account", 2f),
                            Col.num(asset ? "Withdrawal" : "Payment", 1.45f), Col.num(asset ? "Deposit" : "Charge", 1.45f), Col.num("Balance", 1.6f)),
                    lines, Row.bold(DAY.format(to), "", "Closing balance · " + l.rows().size() + " transactions", "",
                            StatementPdf.amount(outs), StatementPdf.amount(ins), StatementPdf.amount(l.closingBalance())));
        }
        return List.of(list.size() + " accounts, " + txns + " transactions",
                "Money in " + StatementPdf.rs(in) + ", money out " + StatementPdf.rs(out),
                "Holding " + StatementPdf.rs(assetsClose) + "; cards and loans owed " + StatementPdf.rs(owedClose));
    }

    private static String narration(LedgerRow r) {
        String v = r.voucherLabel() != null ? r.voucherLabel() : "";
        String n = r.narration() != null ? r.narration() : "";
        return n.isBlank() ? v : v.isBlank() ? n : n + " (" + v + ")";
    }

    private static String last4(String number) {
        String d = number.replaceAll("\\s", "");
        return d.length() <= 4 ? d : d.substring(d.length() - 4);
    }

    // ---------------------------------------------------------------- the balance sheet

    private List<String> balanceSheet(StatementPdf pdf, LocalDate to) {
        LocalDate before = to.withDayOfMonth(1).minusDays(1);
        BalanceSheet bs = reports.balanceSheet(to, before);
        pdf.tiles(List.of(
                new Tile("Net worth", StatementPdf.rs(bs.netWorth()), "on " + DAY.format(bs.asOf()), bs.netWorth().signum() >= 0 ? "good" : "bad"),
                new Tile("Change in the month", signed(bs.netWorthChange()), bs.netWorthChangePercent() == null ? "" : StatementPdf.percent(bs.netWorthChangePercent()) + " against " + DAY.format(bs.compareDate()),
                        nz(bs.netWorthChange()).signum() >= 0 ? "good" : "bad"),
                new Tile("Total assets", StatementPdf.rs(bs.assets().total()), "was " + StatementPdf.rs(bs.assets().previous()), null),
                new Tile("Total liabilities", StatementPdf.rs(bs.liabilities().total()), "was " + StatementPdf.rs(bs.liabilities().previous()), "warn")));
        sheetSection(pdf, bs.assets(), bs);
        sheetSection(pdf, bs.liabilities(), bs);
        if (bs.equity() != null && !bs.equity().groups().isEmpty()) sheetSection(pdf, bs.equity(), bs);
        pdf.section("Financial health", "ratios on " + DAY.format(bs.asOf()));
        pdf.table(List.of(Col.wrap("Measure", 4), Col.num("Value", 1.6f), Col.wrap("What it means", 5)), List.of(
                Row.of("Liquid assets", StatementPdf.rs(bs.liquidAssets()), "Cash, bank and wallet money you can use at once"),
                Row.of("Emergency fund", bs.emergencyFundMonths() == null ? "-" : bs.emergencyFundMonths().setScale(1, RoundingMode.HALF_UP) + " months",
                        "Liquid money against an average month of spending" + (bs.averageMonthlyExpense() == null ? "" : " (" + StatementPdf.rs(bs.averageMonthlyExpense()) + ")")),
                Row.of("Debt to assets", ratio(bs.debtToAssetRatio()), "What you owe for every rupee you own; under 0.40 is comfortable"),
                Row.of("Debt to net worth", ratio(bs.debtToNetWorthRatio()), "What you owe against what is yours"),
                Row.of("Liquidity ratio", ratio(bs.liquidityRatio()), "Liquid assets against what is due soon; above 1 covers it"),
                Row.of("Investments", StatementPdf.percent(bs.investmentShare()), "Share of assets in deposits, funds, stocks and gold"),
                Row.of("Due within a year", StatementPdf.rs(bs.shortTermLiabilities()), "Cards and short-term dues"),
                Row.of("Due later", StatementPdf.rs(bs.longTermLiabilities()), "Loans running beyond a year")), null);
        if (bs.netWorthTrend() != null && !bs.netWorthTrend().isEmpty()) {
            pdf.section("Net worth, month by month", null);
            List<Row> trend = new ArrayList<>();
            BigDecimal prev = null;
            for (ValuePoint p : bs.netWorthTrend()) {
                trend.add(Row.of(p.label(), StatementPdf.amount(p.value()), prev == null ? "" : signedAmount(nz(p.value()).subtract(prev))));
                prev = nz(p.value());
            }
            pdf.table(List.of(Col.text("Month", 3), Col.num("Net worth", 2), Col.num("Change", 2)), trend, null);
        }
        return List.of("Net worth " + StatementPdf.rs(bs.netWorth()) + " (" + signed(bs.netWorthChange()) + " in the month)",
                "Assets " + StatementPdf.rs(bs.assets().total()) + ", liabilities " + StatementPdf.rs(bs.liabilities().total()));
    }

    private void sheetSection(StatementPdf pdf, SheetSection s, BalanceSheet bs) {
        pdf.section(s.label(), "on " + DAY.format(bs.asOf()) + " against " + DAY.format(bs.compareDate()));
        List<Row> rows = new ArrayList<>();
        for (SheetGroup g : s.groups()) {
            rows.add(Row.bold(g.label(), StatementPdf.amount(g.previous()), StatementPdf.amount(g.total()), signedAmount(nz(g.total()).subtract(nz(g.previous())))));
            for (AccountAmount a : g.accounts()) {
                rows.add(Row.of("    " + a.name(), StatementPdf.amount(a.previous()), StatementPdf.amount(a.amount()), signedAmount(nz(a.amount()).subtract(nz(a.previous())))));
            }
        }
        pdf.table(List.of(Col.wrap("", 5), Col.num(DAY.format(bs.compareDate()), 1.8f), Col.num(DAY.format(bs.asOf()), 1.8f), Col.num("Change", 1.6f)), rows,
                Row.bold("Total " + s.label().toLowerCase(Locale.ROOT), StatementPdf.amount(s.previous()), StatementPdf.amount(s.total()),
                        signedAmount(nz(s.total()).subtract(nz(s.previous())))));
    }

    // ---------------------------------------------------------------- chits

    private List<String> chitsStatement(StatementPdf pdf, LocalDate from, LocalDate to) {
        List<ChitView> list = chits.list().stream().filter(c -> c.closedAt() == null || !c.closedAt().toLocalDate().isBefore(from))
                .sorted(Comparator.comparing(ChitView::name)).toList();
        Map<Long, ChitDetail> details = list.stream().collect(Collectors.toMap(ChitView::id, c -> chits.detail(c.id()), (a, b) -> a, LinkedHashMap::new));
        // everything as it stood at the month end: a payment made after it is not in this statement
        list = list.stream().filter(c -> !c.startDate().isAfter(to)).toList();
        BigDecimal paidMonth = BigDecimal.ZERO, paidIn = BigDecimal.ZERO, still = BigDecimal.ZERO, dividends = BigDecimal.ZERO, value = BigDecimal.ZERO;
        int overdue = 0;
        List<Row> rows = new ArrayList<>();
        Map<Long, ChitAsOf> asOf = new LinkedHashMap<>();
        for (ChitView c : list) {
            ChitAsOf x = ChitAsOf.of(details.get(c.id()).installments(), from, to);
            asOf.put(c.id(), x);
            paidMonth = paidMonth.add(x.paidMonth());
            paidIn = paidIn.add(x.paid());
            still = still.add(x.still());
            dividends = dividends.add(x.dividends());
            value = value.add(nz(c.maturityAmount()));
            overdue += x.overdue();
            rows.add(Row.of(c.name() + (c.ticketNo() != null ? " (" + c.ticketNo() + ")" : ""), Objects.toString(c.organizer(), ""),
                    x.count() + " / " + c.numberOfInstallments(), StatementPdf.amountOrBlank(x.paidMonth()), StatementPdf.amount(x.paid()),
                    StatementPdf.amountOrBlank(x.dividends()), StatementPdf.amount(x.still()), x.next() == null ? "-" : DAY.format(x.next())));
        }
        pdf.tiles(List.of(
                new Tile("Paid in the month", StatementPdf.rs(paidMonth), "installments across " + list.size() + " chits", null),
                new Tile("Paid to date", StatementPdf.rs(paidIn), "chits worth " + StatementPdf.rs(value), null),
                new Tile("Dividends earned", StatementPdf.rs(dividends), "less to pay, from auctions", "good"),
                new Tile("Still to pay", StatementPdf.rs(still), overdue == 0 ? "nothing overdue" : overdue + " installment(s) overdue", overdue == 0 ? null : "bad")));
        pdf.section("Chits at a glance", "as of " + DAY.format(to));
        pdf.table(List.of(Col.wrap("Chit", 3), Col.wrap("Organizer", 2), Col.text("Paid", 1), Col.num("This month", 1.5f), Col.num("Paid to date", 1.6f),
                Col.num("Dividends", 1.4f), Col.num("Still to pay", 1.6f), Col.text("Next due", 1.4f)), rows,
                Row.bold("Total", "", "", StatementPdf.amount(paidMonth), StatementPdf.amount(paidIn), StatementPdf.amount(dividends), StatementPdf.amount(still), ""));
        for (ChitView c : list) {
            ChitDetail d = details.get(c.id());
            ChitAsOf x = asOf.get(c.id());
            pdf.keep(220).gap(6).section(c.name(), "organized by " + Objects.toString(c.organizer(), "-"));
            List<String[]> facts = new ArrayList<>();
            facts.add(new String[]{"Chit value", StatementPdf.rs(c.maturityAmount())});
            facts.add(new String[]{"Monthly installment", StatementPdf.rs(c.monthlyInstallment())});
            if (c.ticketNo() != null) facts.add(new String[]{"Ticket / group", c.ticketNo()});
            facts.add(new String[]{"Runs", DAY.format(c.startDate()) + " to " + (c.endDate() == null ? "-" : DAY.format(c.endDate()))});
            facts.add(new String[]{"Installments paid", x.count() + " of " + c.numberOfInstallments()});
            facts.add(new String[]{"Paid in (cash)", StatementPdf.rs(x.paid())});
            facts.add(new String[]{"Dividends", StatementPdf.rs(x.dividends())});
            facts.add(new String[]{"Still to pay", StatementPdf.rs(x.still())});
            if (x.overdue() > 0) facts.add(new String[]{"Overdue", x.overdue() + " installment(s)"});
            if (c.payoutAmount() != null && c.payoutAmount().signum() > 0 && c.payoutDate() != null && !c.payoutDate().isAfter(to)) {
                facts.add(new String[]{"Payout", StatementPdf.rs(c.payoutAmount()) + (c.payoutDate() != null ? " on " + DAY.format(c.payoutDate()) : "")});
            }
            if (c.impliedAnnualRate() != null && c.impliedAnnualRate().signum() != 0) facts.add(new String[]{"Return (a year)", StatementPdf.percent(c.impliedAnnualRate())});
            facts.add(new String[]{"Status", c.status().name().charAt(0) + c.status().name().substring(1).toLowerCase(Locale.ROOT)});
            pdf.facts(facts);
            List<Row> inst = new ArrayList<>();
            for (InstallmentView i : d.installments()) {
                boolean paid = ChitAsOf.paidBy(i, to);
                boolean thisMonth = paid && !i.paidDate().isBefore(from);
                boolean late = !paid && !i.dueDate().isAfter(to);
                String status = paid ? "Paid" : late ? "Overdue" : "Upcoming";
                String[] cells = {String.valueOf(i.installmentNo()), DAY.format(i.dueDate()), StatementPdf.amount(i.dueAmount()), paid ? StatementPdf.amountOrBlank(i.dividend()) : "",
                        paid ? StatementPdf.amountOrBlank(i.paidAmount()) : "", paid ? DAY.format(i.paidDate()) : "", paid ? Objects.toString(i.paidFromAccountName(), "") : "", status};
                inst.add(thisMonth || late ? Row.mark(cells) : paid ? Row.of(cells) : Row.muted(cells));
            }
            pdf.table(List.of(Col.text("#", 0.5f), Col.text("Due on", 1.3f), Col.num("Installment", 1.4f), Col.num("Dividend", 1.2f), Col.num("Paid", 1.4f),
                    Col.text("Paid on", 1.3f), Col.wrap("From account", 2), Col.text("Status", 1.1f)), inst,
                    Row.bold("", "", StatementPdf.amount(d.installments().stream().map(i -> nz(i.dueAmount())).reduce(BigDecimal.ZERO, BigDecimal::add)),
                            StatementPdf.amount(x.dividends()), StatementPdf.amount(x.paid()), "", "", ""));
            pdf.note("Highlighted: paid in " + MONTH.format(YearMonth.from(from)) + ", or overdue at its end. Grey: still to come. As it stood on " + DAY.format(to) + ".");
        }
        return List.of(list.size() + " chits; paid " + StatementPdf.rs(paidMonth) + " in the month, " + StatementPdf.rs(paidIn) + " to date",
                "Still to pay " + StatementPdf.rs(still) + (overdue > 0 ? "; " + overdue + " installment(s) overdue" : ""));
    }

    /** A chit's installments as they stood on {@code to}. */
    private record ChitAsOf(int count, BigDecimal paid, BigDecimal paidMonth, BigDecimal dividends, BigDecimal still, int overdue, LocalDate next) {

        static boolean paidBy(InstallmentView i, LocalDate to) {
            return i.paidDate() != null && !i.paidDate().isAfter(to);
        }

        static ChitAsOf of(List<InstallmentView> all, LocalDate from, LocalDate to) {
            int count = 0, overdue = 0;
            BigDecimal paid = BigDecimal.ZERO, month = BigDecimal.ZERO, dividends = BigDecimal.ZERO, still = BigDecimal.ZERO;
            LocalDate next = null;
            for (InstallmentView i : all) {
                if (paidBy(i, to)) {
                    count++;
                    paid = paid.add(nz(i.paidAmount()));
                    dividends = dividends.add(nz(i.dividend()));
                    if (!i.paidDate().isBefore(from)) month = month.add(nz(i.paidAmount()));
                } else {
                    still = still.add(nz(i.dueAmount()));
                    if (!i.dueDate().isAfter(to)) overdue++;
                    if (next == null || i.dueDate().isBefore(next)) next = i.dueDate();
                }
            }
            return new ChitAsOf(count, paid, month, dividends, still, overdue, next);
        }
    }

    // ---------------------------------------------------------------- income and expense

    private List<String> incomeExpense(StatementPdf pdf, YearMonth period) {
        IncomeStatement now = reports.incomeStatement(period.atDay(1), period.atEndOfMonth());
        YearMonth prev = period.minusMonths(1);
        IncomeStatement before = reports.incomeStatement(prev.atDay(1), prev.atEndOfMonth());
        BigDecimal rate = now.savingsRate();
        pdf.tiles(List.of(
                new Tile("Income", StatementPdf.rs(now.totalIncome()), "was " + StatementPdf.rs(before.totalIncome()), "good"),
                new Tile("Spending", StatementPdf.rs(now.totalExpenses()), "was " + StatementPdf.rs(before.totalExpenses()), "bad"),
                new Tile("Surplus", StatementPdf.rs(now.netSurplus()), "income less spending", nz(now.netSurplus()).signum() >= 0 ? "good" : "bad"),
                new Tile("Savings rate", StatementPdf.percent(rate), "of income kept", rate != null && rate.compareTo(BigDecimal.valueOf(20)) >= 0 ? "good" : "warn")));
        categoryTable(pdf, "Income", now.income(), before.income(), now.totalIncome(), before.totalIncome(), MONTH.format(period), MONTH.format(prev));
        categoryTable(pdf, "Spending", now.expenses(), before.expenses(), now.totalExpenses(), before.totalExpenses(), MONTH.format(period), MONTH.format(prev));
        List<String> out = new ArrayList<>(List.of("Income " + StatementPdf.rs(now.totalIncome()) + ", spending " + StatementPdf.rs(now.totalExpenses()),
                "Surplus " + StatementPdf.rs(now.netSurplus()) + " (savings rate " + StatementPdf.percent(rate) + ")"));
        now.expenses().stream().max(Comparator.comparing(a -> nz(a.amount()))).ifPresent(a -> out.add("Largest spending: " + a.name() + " " + StatementPdf.rs(a.amount())));
        return out;
    }

    private void categoryTable(StatementPdf pdf, String title, List<AccountAmount> now, List<AccountAmount> before, BigDecimal total, BigDecimal totalBefore,
                               String nowLabel, String beforeLabel) {
        Map<String, BigDecimal> prev = before.stream().collect(Collectors.toMap(AccountAmount::name, a -> nz(a.amount()), BigDecimal::add));
        List<Row> rows = now.stream().sorted(Comparator.comparing((AccountAmount a) -> nz(a.amount())).reversed())
                .map(a -> Row.of(a.name(), prev.containsKey(a.name()) ? StatementPdf.amount(prev.get(a.name())) : "", StatementPdf.amount(a.amount()),
                        signedAmount(nz(a.amount()).subtract(nz(prev.get(a.name())))),
                        total == null || total.signum() == 0 ? "" : StatementPdf.percent(nz(a.amount()).multiply(BigDecimal.valueOf(100)).divide(total, 1, RoundingMode.HALF_UP))))
                .collect(Collectors.toCollection(ArrayList::new));
        before.stream().filter(b -> now.stream().noneMatch(a -> a.name().equals(b.name())))
                .forEach(b -> rows.add(Row.muted(b.name(), StatementPdf.amount(b.amount()), "", signedAmount(nz(b.amount()).negate()), "")));
        pdf.section(title, "by category");
        pdf.table(List.of(Col.wrap("Category", 4), Col.num(beforeLabel, 1.8f), Col.num(nowLabel, 1.8f), Col.num("Change", 1.6f), Col.num("Share", 1)), rows,
                Row.bold("Total " + title.toLowerCase(Locale.ROOT), StatementPdf.amount(totalBefore), StatementPdf.amount(total), signedAmount(nz(total).subtract(nz(totalBefore))), ""));
    }

    // ---------------------------------------------------------------- money lent and owed

    private List<String> moneyOwed(StatementPdf pdf, LocalDate to) {
        List<ClaimView> open = claims.list().stream().filter(c -> c.status() != ClaimStatus.SETTLED && c.status() != ClaimStatus.WRITTEN_OFF
                && nz(c.outstanding()).signum() > 0 && !c.startDate().isAfter(to)).toList();
        List<ClaimView> theyOwe = open.stream().filter(c -> !c.kind().isPayable()).sorted(Comparator.comparing((ClaimView c) -> nz(c.outstanding())).reversed()).toList();
        List<ClaimView> iOwe = open.stream().filter(c -> c.kind().isPayable()).sorted(Comparator.comparing((ClaimView c) -> nz(c.outstanding())).reversed()).toList();
        Function<List<ClaimView>, BigDecimal> sum = l -> l.stream().map(c -> nz(c.outstanding())).reduce(BigDecimal.ZERO, BigDecimal::add);
        long overdue = open.stream().filter(ClaimView::overdue).count();
        pdf.tiles(List.of(
                new Tile("Others owe you", StatementPdf.rs(sum.apply(theyOwe)), theyOwe.size() + " item(s)", "good"),
                new Tile("You owe", StatementPdf.rs(sum.apply(iOwe)), iOwe.size() + " item(s)", iOwe.isEmpty() ? null : "warn"),
                new Tile("Overdue", String.valueOf(overdue), "past their due date", overdue > 0 ? "bad" : null),
                new Tile("Net", StatementPdf.rs(sum.apply(theyOwe).subtract(sum.apply(iOwe))), "owed to you, less what you owe", null)));
        for (var part : List.of(Map.entry("Owed to you", theyOwe), Map.entry("You owe", iOwe))) {
            pdf.section(part.getKey(), part.getValue().isEmpty() ? "nothing open" : "open on " + DAY.format(to));
            if (part.getValue().isEmpty()) continue;
            List<Row> rows = part.getValue().stream().map(c -> {
                String[] cells = {c.party(), c.kindLabel() + (c.narration() != null && !c.narration().isBlank() ? ": " + c.narration() : ""), DAY.format(c.startDate()),
                        StatementPdf.amount(c.amount()), StatementPdf.amountOrBlank(c.repaid()), StatementPdf.amount(c.outstanding()),
                        StatementPdf.amountOrBlank(c.interestDue()), c.dueDate() == null ? "-" : DAY.format(c.dueDate()) + (c.overdue() ? " (overdue)" : "")};
                return c.overdue() ? Row.mark(cells) : Row.of(cells);
            }).toList();
            pdf.table(List.of(Col.wrap("Party", 1.7f), Col.wrap("What", 2.8f), Col.wrap("Since", 1.5f), Col.num("Amount", 1.4f), Col.num("Repaid", 1.3f),
                    Col.num("Outstanding", 1.65f), Col.num("Interest", 1.3f), Col.wrap("Due", 1.6f)), rows,
                    Row.bold("Total", "", "", StatementPdf.amount(part.getValue().stream().map(c -> nz(c.amount())).reduce(BigDecimal.ZERO, BigDecimal::add)),
                            StatementPdf.amount(part.getValue().stream().map(c -> nz(c.repaid())).reduce(BigDecimal.ZERO, BigDecimal::add)),
                            StatementPdf.amount(sum.apply(part.getValue())), StatementPdf.amount(part.getValue().stream().map(c -> nz(c.interestDue())).reduce(BigDecimal.ZERO, BigDecimal::add)), ""));
        }
        pdf.note("Highlighted: past the due date. Repaid and outstanding are as recorded when this statement was made.");
        return List.of("Others owe you " + StatementPdf.rs(sum.apply(theyOwe)) + "; you owe " + StatementPdf.rs(sum.apply(iOwe)),
                overdue > 0 ? overdue + " item(s) overdue" : "Nothing overdue");
    }

    // ---------------------------------------------------------------- EMIs

    private List<String> emiStatement(StatementPdf pdf, LocalDate to) {
        EmiService.Book book = emis.book(false);
        List<EmiService.PlanView> plans = book.plans().stream().filter(p -> !"CLOSED".equals(p.status())).toList();
        BigDecimal outstanding = plans.stream().map(p -> nz(p.outstanding())).reduce(BigDecimal.ZERO, BigDecimal::add);
        BigDecimal monthly = plans.stream().map(p -> nz(p.emiAmount())).reduce(BigDecimal.ZERO, BigDecimal::add);
        BigDecimal interestLeft = plans.stream().map(p -> nz(p.interestLeft())).reduce(BigDecimal.ZERO, BigDecimal::add);
        pdf.tiles(List.of(
                new Tile("EMIs a month", StatementPdf.rs(monthly), plans.size() + " running", null),
                new Tile("Outstanding", StatementPdf.rs(outstanding), "principal still to repay", "warn"),
                new Tile("Interest left", StatementPdf.rs(interestLeft), "still to be paid", interestLeft.signum() > 0 ? "bad" : null),
                new Tile("Next due", book.summary().nextDue() == null ? "-" : DAY.format(book.summary().nextDue()),
                        book.summary().nextAmount() == null ? "" : StatementPdf.rs(book.summary().nextAmount()), null)));
        pdf.section("Running EMIs", "on " + DAY.format(to));
        if (plans.isEmpty()) {
            pdf.note("No EMI is running: nothing bought on EMI is still being repaid.");
            return List.of("No running EMIs");
        }
        List<Row> rows = plans.stream().map(p -> {
            String[] cells = {p.narration(), Objects.toString(p.lender() != null ? p.lender() : p.payAccountName(), ""), StatementPdf.amount(p.emiAmount()),
                    p.paidCount() + " / " + p.months(), StatementPdf.amount(p.paidSoFar()), StatementPdf.amount(p.outstanding()), StatementPdf.amountOrBlank(p.interestLeft()),
                    p.endDate() == null ? "-" : DAY.format(p.endDate())};
            return p.dueNow() > 0 ? Row.mark(cells) : Row.of(cells);
        }).toList();
        pdf.table(List.of(Col.wrap("EMI", 3), Col.wrap("Lender / card", 2), Col.num("EMI", 1.3f), Col.text("Paid", 0.9f), Col.num("Paid so far", 1.5f),
                Col.num("Outstanding", 1.6f), Col.num("Interest left", 1.6f), Col.text("Ends", 1.3f)), rows,
                Row.bold("Total", "", StatementPdf.amount(monthly), "", StatementPdf.amount(plans.stream().map(p -> nz(p.paidSoFar())).reduce(BigDecimal.ZERO, BigDecimal::add)),
                        StatementPdf.amount(outstanding), StatementPdf.amount(interestLeft), ""));
        pdf.note("Highlighted: an instalment is due now.");
        return List.of(plans.size() + " EMIs, " + StatementPdf.rs(monthly) + " a month", "Outstanding " + StatementPdf.rs(outstanding));
    }

    // ================================================================== helpers

    private static BigDecimal nz(BigDecimal v) {
        return v == null ? BigDecimal.ZERO : v;
    }

    private static String signed(BigDecimal v) {
        return nz(v).signum() >= 0 ? "+" + StatementPdf.rs(nz(v)) : "-" + StatementPdf.rs(nz(v).abs());
    }

    private static String signedAmount(BigDecimal v) {
        return nz(v).signum() == 0 ? "" : nz(v).signum() > 0 ? "+" + StatementPdf.amount(v) : StatementPdf.amount(v);
    }

    private static String ratio(BigDecimal v) {
        return v == null ? "-" : v.setScale(2, RoundingMode.HALF_UP).toPlainString();
    }

    private String encrypt(String plain) {
        try {
            byte[] iv = new byte[12];
            random.nextBytes(iv);
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.ENCRYPT_MODE, new SecretKeySpec(settings.secretKey(KEY), "AES"), new GCMParameterSpec(128, iv));
            byte[] data = cipher.doFinal(plain.getBytes(StandardCharsets.UTF_8));
            byte[] all = new byte[iv.length + data.length];
            System.arraycopy(iv, 0, all, 0, iv.length);
            System.arraycopy(data, 0, all, iv.length, data.length);
            return Base64.getEncoder().encodeToString(all);
        } catch (java.security.GeneralSecurityException e) {
            throw new IllegalStateException(e);
        }
    }

    private String decrypt(String stored) {
        try {
            byte[] all = Base64.getDecoder().decode(stored);
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE, new SecretKeySpec(settings.secretKey(KEY), "AES"), new GCMParameterSpec(128, all, 0, 12));
            return new String(cipher.doFinal(all, 12, all.length - 12), StandardCharsets.UTF_8);
        } catch (java.security.GeneralSecurityException | IllegalArgumentException e) {
            throw new BusinessException("The saved PDF password cannot be read any more; set it again in Settings, Statements");
        }
    }
}
