package com.aditya.personalbudget.service;

import com.aditya.personalbudget.domain.entity.Account;
import com.aditya.personalbudget.domain.type.AccountClass;
import com.aditya.personalbudget.domain.type.AccountType;
import com.aditya.personalbudget.exception.BusinessException;
import com.aditya.personalbudget.service.LedgerSnapshot.PostedLine;
import org.springframework.stereotype.Service;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.YearMonth;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.Random;
import java.util.TreeMap;

/**
 * Where to put the money that comes in: a plan from the income actually received and the money already in the banks, in the
 * order a planner would take it, with the working shown.
 * <ol>
 *   <li><b>Income and its stability</b>: average monthly income and spending over the last complete months (up to twelve), the
 *       coefficient of variation of income, and a prudent surplus built on the 25th percentile of income and the 75th of
 *       spending, so a commitment holds in a poor month too.</li>
 *   <li><b>Costly debt first</b>: card and personal-loan dues cost more than any investment reliably earns.</li>
 *   <li><b>Emergency fund</b>: six months of spending, up to twelve as income gets less steady (6 + 10 · CV, rounded).</li>
 *   <li><b>Idle money in the banks</b>: what the bank, cash and wallet accounts hold above the emergency fund and a month's spending
 *       is earning the accounts' average yield; moved to a liquid fund or deposit it would earn the alternative rate, and the difference is
 *       what waiting costs a year.</li>
 *   <li><b>Allocation</b>: equity by the "110 minus age" rule moved by risk appetite and capped by the horizon, gold 5 to 10%, the rest debt.
 *       Portfolio return μ = Σ wᵢμᵢ and risk σ = √(wᵀΣw) (Σ from the assets' volatilities and correlations), the one-year 95% value at risk
 *       μ − 1.645σ, and the Sharpe ratio (μ − risk-free) / σ.</li>
 *   <li><b>Simulation</b>: 4,000 monthly paths of correlated lognormal returns, the monthly amount invested at the start of each month,
 *       weights held at target: the 10th, 50th and 90th percentile outcome, and the chance of ending below what was put in or below inflation.
 *       With a goal, the monthly amount that reaches it in 4 simulated paths out of 5.</li>
 * </ol>
 * It is a planning aid built on rules of thumb, assumed returns and a model, not advice from a registered adviser; markets can fall,
 * returns are never guaranteed and a simulation is only as good as its assumptions.
 */
@Service
public class InvestmentAdviceService {

    private static final double[] MU = {12, 7, 8};        // equity, debt, gold: expected yearly return, %
    private static final double[] SIGMA = {18, 3.5, 14};  // yearly volatility, %
    private static final double[][] CORR = {{1, 0.1, 0.05}, {0.1, 1, 0.05}, {0.05, 0.05, 1}};
    private static final double INFLATION = 6, RISK_FREE = 6.5;
    private static final int WINDOW = 12, PATHS = 4000;

    private final LedgerService ledger;

    public InvestmentAdviceService(LedgerService ledger) {
        this.ledger = ledger;
    }

    public record Profile(int months, double income, double spending, double surplus, double savingsRate, double incomeCv, double incomeLow, double spendingHigh,
                          double prudentSurplus, double liquid, double liabilities, double emergencyMonths, double emergencyTarget, double emergencyGap,
                          double investments, double age, String risk, int horizonYears) {
    }

    public record Step(int order, String title, String detail, double monthly, String status) {
    }

    public record Bucket(String name, double percent, double monthly, double expectedReturn, double volatility, String instruments, double current, double currentPercent) {
    }

    /** A bank, cash or wallet account: what it holds, what it pays, and what keeping money there costs a year against the better place for it. */
    public record BankRow(String name, String type, double balance, Double rate, double yearlyInterest, String typeCode, double lossPerYear) {
    }

    public record Banks(List<BankRow> accounts, double liquid, double averageYield, double yearlyInterest, double idle, double alternativeRate, double idleLossPerYear,
                        String reading) {
    }

    public record Projection(int years, double invested, double low, double expected, double high, double expectedReal, double stepUp) {
    }

    public record Simulation(int years, double invested, double p10, double p50, double p90, double mean, double chanceBelowInvested, double chanceBelowInflation) {
    }

    public record Risk(double expectedReturn, double volatility, double var95, double sharpe, String reading) {
    }

    public record Goal(double target, int years, double requiredSip, double requiredSipSafe, double chance, String reading) {
    }

    public record FitPart(String name, double score, double weight, String reading) {
    }

    /** Financial fitness: the weighted mean of five parts, 0 to 100, with a grade. */
    public record Fitness(double score, String grade, String label, List<FitPart> parts) {
    }

    /** What to buy or sell to bring the holdings to the target mix: move > 0 to add, < 0 to hold back. */
    public record Rebalance(String name, double current, double currentPercent, double targetPercent, double target, double move) {
    }

    public record Advice(boolean enough, String message, Profile profile, double investable, double toEmergency, double toInvest, double blendedReturn,
                         List<Step> steps, List<Bucket> allocation, Banks banks, Risk risk, List<Projection> projection, List<Simulation> simulation, Goal goal,
                         List<String> notes, String disclaimer, Fitness fitness, List<Rebalance> rebalance, List<Move> moves, double movesGain) {
    }

    /**
     * A suggested transfer between my own accounts to earn more interest: from a low-paying account to a better one (or to a deposit at the
     * deposit rate), keeping the safety net liquid. gainPerYear is the extra interest a year.
     */
    public record Move(String from, String to, double amount, double fromRate, double toRate, double gainPerYear, String reason) {
    }

    public Advice advise(Integer ageIn, String riskIn, Integer horizonIn, Double goalAmount, Double alternativeRate) {
        int age = ageIn == null ? 30 : Math.max(18, Math.min(80, ageIn));
        String risk = riskIn == null ? "balanced" : switch (riskIn.toLowerCase()) {
            case "conservative", "growth", "balanced" -> riskIn.toLowerCase();
            default -> throw new BusinessException("Risk appetite is conservative, balanced or growth");
        };
        int horizon = horizonIn == null ? 10 : Math.max(1, Math.min(40, horizonIn));
        double alt = alternativeRate == null ? 7.0 : Math.max(0, Math.min(15, alternativeRate));

        LedgerSnapshot books = ledger.snapshot();
        LocalDate today = OrgClock.today();
        YearMonth last = YearMonth.from(today).minusMonths(1);   // the month in progress is not complete
        Map<YearMonth, double[]> perMonth = new TreeMap<>();     // month → { income, spending }
        for (PostedLine l : books.lines()) {
            YearMonth m = YearMonth.from(l.date());
            if (m.isAfter(last) || m.isBefore(last.minusMonths(WINDOW - 1))) continue;
            Account a = books.account(l.accountId());
            if (a.getAccountClass() == AccountClass.INCOME) perMonth.computeIfAbsent(m, k -> new double[2])[0] += l.credit().subtract(l.debit()).doubleValue();
            else if (a.getAccountClass() == AccountClass.EXPENSE) perMonth.computeIfAbsent(m, k -> new double[2])[1] += l.net().doubleValue();
        }
        int months = perMonth.size();
        double[] incomes = perMonth.values().stream().mapToDouble(v -> v[0]).toArray();
        double[] spends = perMonth.values().stream().mapToDouble(v -> v[1]).toArray();
        double income = DeepAnalysisService.Stats.mean(incomes), spending = DeepAnalysisService.Stats.mean(spends);
        if (months < 2 || income <= 0) {
            return new Advice(false, "The plan needs at least two complete months with income recorded. Add your salary or other income as income entries, then come back.",
                    null, 0, 0, 0, 0, List.of(), List.of(), null, null, List.of(), List.of(), null, List.of(), disclaimer(), null, List.of(), List.of(), 0);
        }
        double surplus = income - spending;
        double incomeCv = income == 0 ? 0 : DeepAnalysisService.Stats.sd(incomes) / income;
        double incomeLow = DeepAnalysisService.Stats.quantile(incomes, 0.25), spendingHigh = DeepAnalysisService.Stats.quantile(spends, 0.75);
        double prudent = incomeLow - spendingHigh;

        // ---- the books today
        Map<Long, BigDecimal> balances = books.balancesAsOf(today);
        double liquid = 0, liabilities = 0, costlyDebt = 0, equityNow = 0, debtNow = 0, goldNow = 0, otherNow = 0, yieldSum = 0;
        List<BankRow> bankRows = new ArrayList<>();
        List<String[]> deposits = new ArrayList<>();   // { name, rate } of the deposits I hold
        for (Map.Entry<Long, BigDecimal> e : balances.entrySet()) {
            Account a = books.account(e.getKey());
            if (a == null) continue;
            double v = e.getValue().doubleValue();
            if (a.isLiquid()) {
                liquid += v;
                Double rate = a.getInterestRate() == null ? null : a.getInterestRate().doubleValue();
                if (rate != null) yieldSum += v * rate;
                if (v > 0) bankRows.add(new BankRow(a.getName(), a.getAccountType().getLabel(), r(v), rate, r(v * (rate == null ? 0 : rate) / 100), a.getAccountType().name(), 0));
            }
            if ((a.getAccountType() == AccountType.FIXED_DEPOSIT || a.getAccountType() == AccountType.RECURRING_DEPOSIT) && a.getInterestRate() != null
                    && Boolean.TRUE.equals(a.getActive())) {
                deposits.add(new String[]{a.getName(), a.getInterestRate().toPlainString()});
            }
            if (a.getAccountClass() == AccountClass.LIABILITY && v > 0) {
                liabilities += v;
                if (a.getAccountType() == AccountType.CREDIT_CARD || a.getAccountType() == AccountType.PERSONAL_LOAN || a.getAccountType() == AccountType.LOAN) costlyDebt += v;
            }
            if (a.getAccountClass() == AccountClass.ASSET && v > 0) {
                switch (a.getAccountType()) {
                    case MUTUAL_FUND, STOCKS -> equityNow += v;
                    case FIXED_DEPOSIT, RECURRING_DEPOSIT, SAVINGS_SCHEME, BONDS -> debtNow += v;
                    case GOLD, SILVER -> goldNow += v;
                    case CHIT_FUND, INSURANCE_POLICY -> otherNow += v;
                    default -> { }
                }
            }
        }
        double invested = equityNow + debtNow + goldNow + otherNow;
        double avgYield = liquid > 0 ? yieldSum / liquid : 0;
        double emergencyMonths = Math.max(6, Math.min(12, Math.round(6 + incomeCv * 10)));
        double emergencyTarget = spending * emergencyMonths, gap = Math.max(0, emergencyTarget - liquid);
        double idle = Math.max(0, liquid - emergencyTarget - spending);
        double idleLoss = idle * Math.max(0, alt - avgYield) / 100;
        bankRows.sort(Comparator.comparingDouble(BankRow::balance).reversed());

        // ---- where each rupee earns most: the safety net in the best-paying liquid account, everything above it in the best deposit
        List<Move> moves = new ArrayList<>();
        java.util.Map<String, Double> loss = new java.util.HashMap<>();
        double needed = emergencyTarget + spending;   // the safety net and a month to live on stay liquid
        BankRow bestLiquid = bankRows.stream().filter(x -> x.rate() != null && "BANK".equals(x.typeCode())).max(Comparator.comparingDouble(BankRow::rate)).orElse(null);
        String[] bestDeposit = deposits.stream().max(Comparator.comparingDouble(d -> Double.parseDouble(d[1]))).orElse(null);
        double depositRate = Math.max(alt, bestDeposit == null ? 0 : Double.parseDouble(bestDeposit[1]));
        String depositName = bestDeposit != null && Double.parseDouble(bestDeposit[1]) >= alt ? bestDeposit[0] + " (or a new deposit there)" : "a fixed deposit or liquid fund";
        // what stays liquid is kept in the best-paying accounts first; the rest is the excess, taken from the worst-paying first
        List<BankRow> byRateDesc = bankRows.stream().filter(x -> "BANK".equals(x.typeCode()) || x.balance() > 20000)
                .sorted(Comparator.comparingDouble((BankRow x) -> x.rate() == null ? 0 : x.rate()).reversed()).toList();
        double keepLeft = needed;
        for (BankRow x : byRateDesc) {
            double rate = x.rate() == null ? 0 : x.rate();
            double keep = Math.min(x.balance(), keepLeft), excess = x.balance() - keep;
            keepLeft -= keep;
            if (excess >= 1000 && depositRate - rate >= 0.25) {
                double gain = excess * (depositRate - rate) / 100;
                moves.add(new Move(x.name(), depositName, r(excess), rate, depositRate, r(gain),
                        String.format("Not needed for the safety net: at %.2f%% instead of %.2f%% it earns ₹%,.0f more a year.", depositRate, rate, gain)));
                loss.merge(x.name(), gain, Double::sum);
            }
            if (keep >= 1000 && bestLiquid != null && x != bestLiquid && bestLiquid.rate() - rate >= 0.5) {
                double gain = keep * (bestLiquid.rate() - rate) / 100;
                moves.add(new Move(x.name(), bestLiquid.name(), r(keep), rate, bestLiquid.rate(), r(gain),
                        String.format("Safety-net money still liquid, but paying %.2f%% instead of %.2f%%: ₹%,.0f more a year.", bestLiquid.rate(), rate, gain)));
                loss.merge(x.name(), gain, Double::sum);
            }
        }
        moves.sort(Comparator.comparingDouble(Move::gainPerYear).reversed());
        double movesGain = moves.stream().mapToDouble(Move::gainPerYear).sum();
        bankRows = new ArrayList<>(bankRows.stream().map(x -> new BankRow(x.name(), x.type(), x.balance(), x.rate(), x.yearlyInterest(), x.typeCode(), r(loss.getOrDefault(x.name(), 0.0)))).toList());
        Banks banks = new Banks(bankRows, r(liquid), round(avgYield, 2), r(liquid * avgYield / 100), r(idle), alt, r(idleLoss),
                idle <= 0 ? "Nothing idle: the banks hold about what the emergency fund and a month's spending need."
                        : String.format("₹%,.0f sits in the banks beyond the emergency fund and a month's spending, earning %.1f%% a year. At %.1f%% (a liquid fund or deposit) it would earn ₹%,.0f more every year.",
                        idle, avgYield, alt, idleLoss));

        // ---- how the surplus is used: the prudent surplus caps the commitment so a poor month does not break it
        double investable = Math.max(0, Math.min(surplus * 0.9, Math.max(prudent, surplus * 0.5)));
        double toDebt = costlyDebt > 0 ? Math.min(investable * 0.5, costlyDebt) : 0;
        double toEmergency = gap > 0 ? Math.min(investable * 0.5, gap) : 0;
        double toInvest = Math.max(0, investable - toEmergency - toDebt);

        // ---- the mix
        double eq = 110 - age + (risk.equals("growth") ? 10 : risk.equals("conservative") ? -20 : 0);
        if (horizon < 3) eq = Math.min(eq, 20);
        else if (horizon < 5) eq = Math.min(eq, 40);
        eq = Math.max(10, Math.min(80, Math.round(eq / 5.0) * 5.0));
        double gold = risk.equals("conservative") ? 10 : risk.equals("balanced") ? 8 : 5;
        double debt = 100 - eq - gold;
        double[] w = {eq / 100, debt / 100, gold / 100};
        double mu = w[0] * MU[0] + w[1] * MU[1] + w[2] * MU[2];
        double var = 0;
        for (int i = 0; i < 3; i++) for (int j = 0; j < 3; j++) var += w[i] * w[j] * SIGMA[i] * SIGMA[j] * CORR[i][j];
        double sigma = Math.sqrt(var);
        double base = Math.max(1, invested);
        List<Bucket> allocation = List.of(
                new Bucket("Equity", eq, r(toInvest * eq / 100), MU[0], SIGMA[0], "Index funds (Nifty 50 / Next 50 / total market) by monthly SIP; ELSS for the 80C part. Keep it for 5+ years.", r(equityNow), r(equityNow / base * 100)),
                new Bucket("Debt", debt, r(toInvest * debt / 100), MU[1], SIGMA[1], "PPF / EPF top-up, short-duration or corporate-bond funds, fixed or recurring deposits, NPS (extra ₹50,000 under 80CCD(1B)).", r(debtNow), r(debtNow / base * 100)),
                new Bucket("Gold", gold, r(toInvest * gold / 100), MU[2], SIGMA[2], "Sovereign Gold Bonds (2.5% interest on top) or a gold ETF; not jewellery.", r(goldNow), r(goldNow / base * 100)));
        Risk riskView = new Risk(round(mu, 2), round(sigma, 2), round(mu - 1.645 * sigma, 2), round(sigma == 0 ? 0 : (mu - RISK_FREE) / sigma, 2),
                String.format("Expect about %.1f%% a year, with a typical swing of ±%.1f%%. In one year in twenty the portfolio does worse than %.1f%%; the Sharpe ratio of %.2f says what each point of risk is paid.",
                        mu, sigma, mu - 1.645 * sigma, sigma == 0 ? 0 : (mu - RISK_FREE) / sigma));

        // ---- the steps, in order
        List<Step> steps = new ArrayList<>();
        int o = 1;
        if (surplus <= 0) {
            steps.add(new Step(o++, "Spend less than you earn first", String.format("Spending (₹%,.0f) is at or above income (₹%,.0f) on average. Nothing is left to invest; use the Deep analysis to find what can come down.", spending, income), 0, "now"));
        }
        if (costlyDebt > 0) {
            steps.add(new Step(o++, "Clear costly debt", String.format("₹%,.0f of card or personal-loan dues. Their interest (often 15–36%%) beats any investment return; pay them before investing.", costlyDebt), r(toDebt), "now"));
        }
        steps.add(new Step(o++, "Emergency fund", gap > 0
                ? String.format("Target %.0f months of spending (income varies by %.0f%%, so %s): ₹%,.0f. Liquid now ₹%,.0f, short by ₹%,.0f; about %s at this pace.", emergencyMonths, incomeCv * 100,
                emergencyMonths > 6 ? "more than the usual six" : "the usual six", emergencyTarget, liquid, gap, toEmergency > 0 ? Math.ceil(gap / toEmergency) + " months" : "never without a surplus")
                : String.format("Done: ₹%,.0f liquid covers %.1f months of spending (target %.0f).", liquid, spending == 0 ? 0 : liquid / spending, emergencyMonths), r(toEmergency), gap > 0 ? "now" : "done"));
        if (movesGain >= 500) {
            steps.add(new Step(o++, "Move money to where it earns more", String.format("%d transfer%s between your own accounts would earn ₹%,.0f more a year (₹%,.0f a month), keeping the safety net liquid. See Banks & cash.",
                    moves.size(), moves.size() == 1 ? "" : "s", movesGain, movesGain / 12), 0, "now"));
        } else if (idle > 0 && idleLoss >= 500) {
            steps.add(new Step(o++, "Put idle bank money to work", banks.reading() + " Keep the emergency fund liquid, move the rest in one go.", 0, "now"));
        }
        steps.add(new Step(o++, "Protection", String.format("Term life cover of about ₹%,.0f (10× a year's income) if others depend on you, and a family health policy of ₹10 lakh or more. Premiums come before investing, not out of it.", income * 12 * 10), 0, "check"));
        if (toInvest > 0) {
            steps.add(new Step(o++, "Invest the rest every month", String.format("₹%,.0f a month: %.0f%% equity, %.0f%% debt, %.0f%% gold (%s, %d-year horizon). It is sized so that a poor month (income at its 25th percentile, spending at its 75th) still leaves ₹%,.0f. Start a SIP the day after salary.",
                    toInvest, eq, debt, gold, risk, horizon, Math.max(0, prudent)), r(toInvest), "monthly"));
            double taxMonthly = Math.min(toInvest, 150000.0 / 12);
            steps.add(new Step(o++, "Use the tax-saving room", String.format("Up to ₹1.5 lakh a year under 80C (about ₹%,.0f a month) through EPF, PPF, ELSS or the home-loan principal, and ₹50,000 more in NPS. Put part of the debt and equity share there, not on top.", taxMonthly), r(taxMonthly), "check"));
        }
        steps.add(new Step(o, "Raise it every year", "Increase the monthly amount by 10% each year, or whenever income rises. It adds far more than chasing a better fund.", 0, "habit"));

        // ---- projections: the plain formula and the simulation
        List<Projection> projection = new ArrayList<>();
        List<Simulation> simulation = new ArrayList<>();
        for (int years : new int[]{5, 10, 15, 20, 25}) {
            double inv = toInvest * 12 * years;
            projection.add(new Projection(years, r(inv), r(fv(toInvest, mu - 3, years)), r(fv(toInvest, mu, years)), r(fv(toInvest, mu + 2, years)),
                    r(fv(toInvest, mu, years) / Math.pow(1 + INFLATION / 100, years)), r(fvStepUp(toInvest, mu, years, 0.10))));
            if (toInvest > 0) simulation.add(simulate(toInvest, w, years, 1));
        }

        // ---- a goal, if one is given
        Goal goal = null;
        if (goalAmount != null && goalAmount > 0) {
            double need = requiredSip(goalAmount, mu, horizon);
            double safe = safeSip(goalAmount, w, horizon);
            double chance = toInvest > 0 ? chanceOf(toInvest, w, horizon, goalAmount) : 0;
            goal = new Goal(goalAmount, horizon, r(need), r(safe), round(chance, 3),
                    String.format("To reach ₹%,.0f in %d years you need ₹%,.0f a month if returns come out as expected, and ₹%,.0f a month to be 80%% sure (returns are uncertain). At ₹%,.0f a month the simulated chance is %.0f%%.",
                            goalAmount, horizon, need, safe, toInvest, chance * 100));
        }

        List<String> notes = new ArrayList<>();
        notes.add(String.format("Assumed yearly returns (volatility): equity %.0f%% (%.0f%%), debt %.0f%% (%.1f%%), gold %.0f%% (%.0f%%); your mix gives %.1f%% with risk %.1f%%.", MU[0], SIGMA[0], MU[1], SIGMA[1], MU[2], SIGMA[2], mu, sigma));
        notes.add("The projection uses the average return (low 3 points under, high 2 over; today's money takes off 6% inflation). The simulation draws 4,000 random but plausible paths, month by month, and reports where the middle 80% of them end, so it shows the spread, not just the average.");
        notes.add(String.format("Income varied by %.0f%% across %d months; the plan leans on the 25th-percentile month (₹%,.0f income, ₹%,.0f spending) rather than the average.", incomeCv * 100, months, incomeLow, spendingHigh));
        if (invested > 0) {
            double have = equityNow / base * 100;
            if (Math.abs(have - eq) > 15) notes.add(String.format("What you hold today is %.0f%% equity against a target of %.0f%%: send new money to the %s side until the mix is closer rather than selling.", have, eq, have > eq ? "debt" : "equity"));
        }
        if (months < WINDOW) notes.add("Only " + months + " complete months were available; the averages and percentiles firm up as more months are recorded.");

        Profile profile = new Profile(months, r(income), r(spending), r(surplus), Math.round(surplus / income * 1000) / 10.0, round(incomeCv, 2), r(incomeLow), r(spendingHigh), r(prudent),
                r(liquid), r(liabilities), emergencyMonths, r(emergencyTarget), r(gap), r(invested), age, risk, horizon);
        // ---- fitness: five parts, each 0 to 100
        List<FitPart> fit = new ArrayList<>();
        double annual = income * 12;
        double sv = 100 * Math.max(0, Math.min(1, (surplus / income) / 0.3));
        fit.add(new FitPart("Saving", r(sv), 0.30, String.format("%.0f%% of income kept; 30%% or more scores full marks", surplus / income * 100)));
        double em = spending == 0 ? 100 : 100 * Math.max(0, Math.min(1, liquid / emergencyTarget));
        fit.add(new FitPart("Safety net", r(em), 0.25, String.format("%.1f of %.0f months of spending in liquid accounts", spending == 0 ? 0 : liquid / spending, emergencyMonths)));
        double dti = annual == 0 ? 0 : liabilities / annual;
        double debtScore = 100 * (1 - Math.max(0, Math.min(1, (dti - 0.5) / 2.5)));
        fit.add(new FitPart("Debt", r(debtScore), 0.15, String.format("dues of %.1f× a year's income%s", dti, costlyDebt > 0 ? String.format(", ₹%,.0f of it costly", costlyDebt) : "")));
        double[][] curve = {{25, 0.3}, {30, 1}, {40, 3}, {50, 6}, {60, 8}, {70, 8}};   // invested ÷ yearly income that is on track at each age
        double targetMultiple = curve[curve.length - 1][1];
        for (int i = 1; i < curve.length; i++) {
            if (age <= curve[i][0]) { targetMultiple = curve[i - 1][1] + (curve[i][1] - curve[i - 1][1]) * (age - curve[i - 1][0]) / (curve[i][0] - curve[i - 1][0]); break; }
        }
        double have = annual == 0 ? 0 : invested / annual;
        fit.add(new FitPart("Investing", r(100 * Math.max(0, Math.min(1, have / Math.max(0.1, targetMultiple)))), 0.20,
                String.format("invested %.1f× a year's income; about %.1f× is on track at %d", have, targetMultiple, age)));
        fit.add(new FitPart("Income stability", r(100 * Math.max(0, Math.min(1, 1 - incomeCv / 0.4))), 0.10, String.format("income varies by %.0f%% month to month", incomeCv * 100)));
        double fscore = fit.stream().mapToDouble(p -> p.score() * p.weight()).sum();
        String fg = fscore >= 85 ? "A" : fscore >= 70 ? "B" : fscore >= 55 ? "C" : fscore >= 40 ? "D" : "E";
        Fitness fitness = new Fitness(r(fscore), fg, fscore >= 85 ? "Excellent" : fscore >= 70 ? "Good" : fscore >= 55 ? "Fair" : fscore >= 40 ? "Needs work" : "At risk", fit);

        // ---- what to move to reach the mix (equity, debt, gold holdings only)
        List<Rebalance> rebalance = new ArrayList<>();
        double held = equityNow + debtNow + goldNow;
        if (held > 0) {
            double[] cur = {equityNow, debtNow, goldNow}, tgt = {eq, debt, gold};
            String[] names = {"Equity", "Debt", "Gold"};
            for (int i = 0; i < 3; i++) rebalance.add(new Rebalance(names[i], r(cur[i]), r(cur[i] / held * 100), tgt[i], r(held * tgt[i] / 100), r(held * tgt[i] / 100 - cur[i])));
        }
        return new Advice(true, null, profile, r(investable), r(toEmergency), r(toInvest), Math.round(mu * 10) / 10.0, steps, allocation, banks, riskView, projection, simulation, goal, notes, disclaimer(),
                fitness, rebalance, moves, r(movesGain));
    }

    // ================================================================== the maths

    /** Future value of a monthly amount at a yearly rate (annuity due). */
    static double fv(double monthly, double yearlyPercent, int years) {
        double i = yearlyPercent / 100 / 12;
        int n = years * 12;
        return i == 0 ? monthly * n : monthly * (Math.pow(1 + i, n) - 1) / i * (1 + i);
    }

    /** The same with the monthly amount raised by a fraction at the start of every year after the first. */
    static double fvStepUp(double monthly, double yearlyPercent, int years, double raise) {
        double total = 0;
        for (int y = 0; y < years; y++) total += fv(monthly * Math.pow(1 + raise, y), yearlyPercent, years - y);
        return total;
    }

    /** The monthly amount that grows to the goal at the expected return (the annuity formula turned round). */
    static double requiredSip(double goal, double yearlyPercent, int years) {
        double per = fv(1, yearlyPercent, years);
        return per == 0 ? 0 : goal / per;
    }

    /** One simulation of the monthly amount over some years: the spread of where it ends. */
    static Simulation simulate(double monthly, double[] w, int years, long seed) {
        double[] finals = paths(monthly, w, years, seed);
        double invested = monthly * 12 * years;
        double real = invested * 0 + 0;
        int below = 0, belowInflation = 0;
        double sum = 0;
        double needed = fvInflation(monthly, years);
        for (double f : finals) {
            sum += f;
            if (f < invested) below++;
            if (f < needed) belowInflation++;
        }
        return new Simulation(years, r(invested), r(DeepAnalysisService.Stats.quantile(finals, 0.10)), r(DeepAnalysisService.Stats.quantile(finals, 0.50)),
                r(DeepAnalysisService.Stats.quantile(finals, 0.90)), r(sum / finals.length), round(below / (double) finals.length, 3), round(belowInflation / (double) finals.length, 3));
    }

    /** What the same instalments would be worth growing only at inflation: ending below it means the money lost buying power. */
    private static double fvInflation(double monthly, int years) {
        return fv(monthly, INFLATION, years);
    }

    /** The share of simulated paths that reach the goal. */
    static double chanceOf(double monthly, double[] w, int years, double goal) {
        double[] finals = paths(monthly, w, years, 7);
        int hit = 0;
        for (double f : finals) if (f >= goal) hit++;
        return hit / (double) finals.length;
    }

    /** The smallest monthly amount that reaches the goal in 4 simulated paths out of 5 (bisection). */
    static double safeSip(double goal, double[] w, int years) {
        double lo = 0, hi = requiredSip(goal, MU[1], years) * 1.5 + 1;
        for (int i = 0; i < 18; i++) {
            double mid = (lo + hi) / 2;
            if (chanceOf(mid, w, years, goal) >= 0.8) hi = mid; else lo = mid;
        }
        return hi;
    }

    /**
     * The values after {@code years} of {@code PATHS} simulated paths. Each month the three assets return exp(m + s·z) − 1 with the
     * lognormal parameters that give the assumed arithmetic mean and volatility, z correlated through the Cholesky factor of the correlation
     * matrix; the weights are held at target; the amount is invested at the start of the month. The generator is seeded, so the same
     * inputs always give the same answer.
     */
    static double[] paths(double monthly, double[] w, int years, long seed) {
        double[][] chol = cholesky(CORR);
        double[] m = new double[3], s = new double[3];
        for (int i = 0; i < 3; i++) {
            double mm = MU[i] / 100 / 12, sm = SIGMA[i] / 100 / Math.sqrt(12);
            double s2 = Math.log(1 + (sm / (1 + mm)) * (sm / (1 + mm)));
            s[i] = Math.sqrt(s2);
            m[i] = Math.log(1 + mm) - s2 / 2;
        }
        Random rnd = new Random(seed * 1_000_003L + years);
        double[] finals = new double[PATHS];
        int n = years * 12;
        for (int p = 0; p < PATHS; p++) {
            double value = 0;
            for (int t = 0; t < n; t++) {
                double[] z = {rnd.nextGaussian(), rnd.nextGaussian(), rnd.nextGaussian()};
                double ret = 0;
                for (int i = 0; i < 3; i++) {
                    double zi = 0;
                    for (int j = 0; j <= i; j++) zi += chol[i][j] * z[j];
                    ret += w[i] * (Math.exp(m[i] + s[i] * zi) - 1);
                }
                value = (value + monthly) * (1 + ret);
            }
            finals[p] = value;
        }
        return finals;
    }

    private static double[][] cholesky(double[][] a) {
        int n = a.length;
        double[][] l = new double[n][n];
        for (int i = 0; i < n; i++) {
            for (int j = 0; j <= i; j++) {
                double sum = 0;
                for (int k = 0; k < j; k++) sum += l[i][k] * l[j][k];
                l[i][j] = i == j ? Math.sqrt(Math.max(1e-12, a[i][i] - sum)) : (a[i][j] - sum) / l[j][j];
            }
        }
        return l;
    }

    private static double r(double v) {
        return Double.isNaN(v) || Double.isInfinite(v) ? 0 : Math.round(v * 100.0) / 100.0;
    }

    private static double round(double v, int places) {
        double f = Math.pow(10, places);
        return Double.isNaN(v) ? 0 : Math.round(v * f) / f;
    }

    private static String disclaimer() {
        return "A planning aid built on rules of thumb, assumed returns and a simulation, from your own records. It is not investment advice from a registered adviser; returns are not guaranteed, "
                + "markets can fall and a model is only as good as its assumptions. Check products, costs and tax rules (they change) before you invest, or ask a SEBI-registered adviser.";
    }
}
