package com.aditya.personalbudget.service;

import com.aditya.personalbudget.domain.entity.Account;
import com.aditya.personalbudget.domain.type.AccountClass;
import com.aditya.personalbudget.service.LedgerSnapshot.PostedLine;
import org.springframework.stereotype.Service;

import java.time.DayOfWeek;
import java.time.LocalDate;
import java.time.YearMonth;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;

/**
 * Deep expense analysis: what the spending history says, with the statistics behind each statement.
 * <p>
 * <b>The series.</b> Complete months when there are at least four; otherwise complete weeks (at least six); otherwise only the
 * description of the expenses themselves, so the page always has something to say. The period in progress is shown but kept
 * out of every fit.
 * <ul>
 *   <li><b>Level and spread</b>: mean, median, sample standard deviation, coefficient of variation (sd / mean), skewness and excess
 *       kurtosis of the per-period total, the percentiles P50 / P75 / P90 / P95 (type 7), and the savings rate against income.</li>
 *   <li><b>Trend, two ways</b>: ordinary least squares with R², the t statistic of the slope against Student's t (n − 2 d.f.) and
 *       the 95% prediction interval ŷ ± t·s·√(1 + 1/n + (x₀ − x̄)²/Sxx); and the distribution-free pair, the Theil–Sen slope (median
 *       of all pairwise slopes, robust to one odd month) with the Mann–Kendall test (S = Σ sign(yⱼ − yᵢ), Z = (S − sign S)/√Var S,
 *       Var S = n(n − 1)(2n + 5)/18 less the tie correction, two-sided p from the normal distribution). Growth is the slope of ln y.</li>
 *   <li><b>Memory and control</b>: the lag-1 autocorrelation, and an EWMA control chart (λ = 0.3, ±3 σ_z, σ from the median
 *       absolute deviation × 1.4826) that flags periods whose smoothed level left the normal band.</li>
 *   <li><b>Forecast</b>: the OLS line with its 95% interval, Holt's linear smoothing (α, β by grid search on one-step squared error),
 *       and the empirical P50 / P80 / P95 of the series for a budget that is met 4 months in 5 or 19 in 20.</li>
 *   <li><b>Categories</b>: share, CV (steady below 0.25, variable below 0.6, erratic above), OLS t and Mann–Kendall p of the trend,
 *       latest period's z score, a suggested limit (P80), Pearson correlation between categories that move together, and
 *       concentration by the Pareto set, the Herfindahl–Hirschman index and the Gini coefficient.</li>
 *   <li><b>Outliers</b>: a category's period with a modified z score |0.6745 (x − median)/MAD| above 3.5 (Iglewicz–Hoaglin), and single
 *       expenses above Tukey's upper fence Q3 + 1.5·IQR of their category.</li>
 *   <li><b>Rhythm</b>: spending by weekday with Pearson's chi-square against an even spread (6 d.f.; 12.59 at 95%).</li>
 * </ul>
 */
@Service
public class DeepAnalysisService {

    /** Two-sided 95% critical values of Student's t for 1 to 30 degrees of freedom. */
    private static final double[] T95 = {12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262, 2.228, 2.201, 2.179, 2.160, 2.145,
            2.131, 2.120, 2.110, 2.101, 2.093, 2.086, 2.080, 2.074, 2.069, 2.064, 2.060, 2.056, 2.052, 2.048, 2.045, 2.042};
    private static final int MIN_MONTHS = 4, MIN_WEEKS = 6;
    private static final double LAMBDA = 0.3;

    private final LedgerService ledger;

    public DeepAnalysisService(LedgerService ledger) {
        this.ledger = ledger;
    }

    // ================================================================== result

    public record PeriodRow(String key, String label, double expense, double income, boolean partial) {
    }

    public record Summary(double total, double mean, double median, double sd, double cv, double min, String minLabel, double max, String maxLabel,
                          double income, Double savingsRate, double skew, double kurtosis, double p75, double p90, double p95, double perDay, int expenses,
                          double averageExpense, double medianExpense) {
    }

    public record Trend(double slope, double intercept, double r2, double t, double tCritical, boolean significant, String direction, double percentPerPeriod,
                        double theilSen, double tau, double mkZ, double mkP, boolean mkSignificant, double lag1, double growthPercent) {
    }

    public record Control(double centre, double sigma, double lambda, List<String> flagged, double lastEwma, double upper, double lower, String reading) {
    }

    public record Forecast(String label, double ols, double low, double high, double holt, double alpha, double beta, double p50, double p80, double p95) {
    }

    public record Season(int month, String name, double index, int samples) {
    }

    public record CategoryRow(String name, double total, double share, double mean, double sd, double cv, String volatility, double slope, double t,
                              String trend, double mkP, double latest, double latestZ, boolean committed, double suggested, List<Double> series) {
    }

    public record Correlation(String a, String b, double r, String reading) {
    }

    public record Concentration(List<String> paretoSet, double paretoShare, double hhi, double gini, String reading) {
    }

    public record Outlier(String kind, String label, String when, double amount, double expected, double score, String note) {
    }

    public record Weekday(String day, double amount, int count) {
    }

    public record Rhythm(List<Weekday> days, double weekendShare, double chi2, boolean uneven, String busiest) {
    }

    /** One part of the health score: 0 to 100, its weight, and what it says. */
    public record HealthPart(String name, double score, double weight, String reading) {
    }

    /** The spending's health in one number (the weighted mean of its parts), with a grade A to E. */
    public record Health(double score, String grade, String label, List<HealthPart> parts) {
    }

    /** A category that regularly runs above its own usual level: what bringing it back to the median would save each period. */
    public record Opportunity(String name, double typical, double average, double excess, double share, double yearly) {
    }

    public record DeepAnalysis(LocalDate from, LocalDate to, String unit, boolean enough, String message, List<PeriodRow> periods, Summary summary, Trend trend,
                               Control control, Forecast forecast, List<Season> seasons, List<CategoryRow> categories, List<Correlation> correlations,
                               Concentration concentration, List<Outlier> outliers, Rhythm rhythm, double committedShare, List<String> advice, List<String> findings,
                               Health health, List<Opportunity> opportunities) {
    }

    // ================================================================== the analysis

    private record Bucket(String key, String label, LocalDate start, LocalDate end) {
    }

    public DeepAnalysis analyse(LocalDate from, LocalDate to) {
        LedgerSnapshot books = ledger.snapshot();
        LocalDate today = OrgClock.today();

        // ---- what was spent and earned
        record Line(LocalDate date, double amount, double debit, String category, String narration) {
        }
        List<Line> spent = new ArrayList<>();
        List<double[]> earned = new ArrayList<>();   // { epoch day, amount }
        for (PostedLine l : books.lines()) {
            if (l.date().isBefore(from) || l.date().isAfter(to)) continue;
            Account a = books.account(l.accountId());
            if (a.getAccountClass() == AccountClass.EXPENSE) {
                String name = l.categoryId() == null || books.category(l.categoryId()) == null ? "Uncategorised" : books.category(l.categoryId()).getName();
                spent.add(new Line(l.date(), l.net().doubleValue(), l.debit().doubleValue(), name, l.narration() == null ? name : l.narration()));
            } else if (a.getAccountClass() == AccountClass.INCOME) {
                earned.add(new double[]{l.date().toEpochDay(), l.credit().subtract(l.debit()).doubleValue()});
            }
        }
        if (spent.isEmpty()) {
            return new DeepAnalysis(from, to, "none", false, "No expenses in this period. Pick a longer period (6 to 12 months works best).", List.of(), null, null, null, null,
                    List.of(), List.of(), List.of(), null, List.of(), null, 0, List.of(), List.of(), null, List.of());
        }

        // ---- the buckets: months if there are enough complete ones, else weeks, else none
        List<Bucket> months = new ArrayList<>(), weeks = new ArrayList<>();
        for (YearMonth m = YearMonth.from(from); !m.isAfter(YearMonth.from(to)); m = m.plusMonths(1)) {
            months.add(new Bucket(m.toString(), m.toString(), m.atDay(1), m.atEndOfMonth()));
        }
        for (LocalDate d = from.with(DayOfWeek.MONDAY); !d.isAfter(to); d = d.plusWeeks(1)) {
            weeks.add(new Bucket(d.toString(), d.toString(), d, d.plusDays(6)));
        }
        java.util.function.Predicate<Bucket> complete = b -> !b.start().isBefore(from) && !b.end().isAfter(to) && b.end().isBefore(today);
        List<Bucket> fullMonths = months.stream().filter(complete).toList(), fullWeeks = weeks.stream().filter(complete).toList();
        String unit = fullMonths.size() >= MIN_MONTHS ? "month" : fullWeeks.size() >= MIN_WEEKS ? "week" : "none";
        List<Bucket> all = unit.equals("month") ? months : unit.equals("week") ? weeks : List.of();
        List<Bucket> used = unit.equals("month") ? fullMonths : unit.equals("week") ? fullWeeks : List.of();
        int n = used.size();

        // ---- the expenses themselves: described whatever the series
        double[] amounts = spent.stream().filter(l -> l.debit() > 0).mapToDouble(Line::debit).toArray();
        double totalSpent = spent.stream().mapToDouble(Line::amount).sum();
        long days = Math.max(1, ChronoUnit.DAYS.between(spent.stream().map(Line::date).min(LocalDate::compareTo).orElse(from), to.isAfter(today) ? today : to) + 1);
        double skew = Stats.skew(amounts), kurt = Stats.kurtosis(amounts);

        double[] weekday = new double[7];
        int[] weekdayCount = new int[7];
        for (Line l : spent) {
            if (l.debit() <= 0) continue;
            weekday[l.date().getDayOfWeek().getValue() - 1] += l.debit();
            weekdayCount[l.date().getDayOfWeek().getValue() - 1]++;
        }
        double wsum = 0;
        for (double v : weekday) wsum += v;
        List<Weekday> dayRows = new ArrayList<>();
        double chi2 = 0, expectedPerDay = wsum / 7;
        int busiest = 0;
        for (int d = 0; d < 7; d++) {
            dayRows.add(new Weekday(DayOfWeek.of(d + 1).getDisplayName(java.time.format.TextStyle.SHORT, java.util.Locale.ENGLISH), r(weekday[d]), weekdayCount[d]));
            if (expectedPerDay > 0) chi2 += (weekday[d] - expectedPerDay) * (weekday[d] - expectedPerDay) / expectedPerDay;
            if (weekday[d] > weekday[busiest]) busiest = d;
        }
        Rhythm rhythm = new Rhythm(dayRows, round(wsum == 0 ? 0 : (weekday[5] + weekday[6]) / wsum, 3), round(chi2, 1), chi2 > 12.59, dayRows.get(busiest).day());

        // ---- per-period totals
        Map<String, double[]> perBucket = new LinkedHashMap<>();   // key → { expense, income }
        for (Bucket b : all) perBucket.put(b.key(), new double[2]);
        for (Line l : spent) {
            Bucket b = bucketOf(unit, l.date());
            if (b != null && perBucket.containsKey(b.key())) perBucket.get(b.key())[0] += l.amount();
        }
        for (double[] e : earned) {
            Bucket b = bucketOf(unit, LocalDate.ofEpochDay((long) e[0]));
            if (b != null && perBucket.containsKey(b.key())) perBucket.get(b.key())[1] += e[1];
        }
        List<PeriodRow> rows = new ArrayList<>();
        for (Bucket b : all) {
            double[] v = perBucket.get(b.key());
            rows.add(new PeriodRow(b.key(), b.label(), r(v[0]), r(v[1]), !complete.test(b)));
        }
        double[] y = used.stream().mapToDouble(b -> perBucket.get(b.key())[0]).toArray();
        double[] inc = used.stream().mapToDouble(b -> perBucket.get(b.key())[1]).toArray();
        double totalIncome = 0;
        for (double v : inc) totalIncome += v;

        // ---- categories (totals always; series statistics when there is a series)
        Map<String, Double> catTotals = new LinkedHashMap<>();
        for (Line l : spent) catTotals.merge(l.category(), l.amount(), Double::sum);
        Map<String, double[]> catSeries = new LinkedHashMap<>();
        for (String cat : catTotals.keySet()) {
            double[] s = new double[n];
            for (int i = 0; i < n; i++) s[i] = 0;
            catSeries.put(cat, s);
        }
        for (Line l : spent) {
            Bucket b = bucketOf(unit, l.date());
            int idx = b == null ? -1 : used.indexOf(b);
            if (idx >= 0) catSeries.get(l.category())[idx] += l.amount();
        }

        double[] x = new double[n];
        for (int i = 0; i < n; i++) x[i] = i;
        double mean = n == 0 ? 0 : Stats.mean(y), sd = n == 0 ? 0 : Stats.sd(y), median = n == 0 ? 0 : Stats.median(y);
        double tCrit = n >= 3 ? tCritical(n - 2) : 0;

        Summary summary;
        Trend trend = null;
        Control control = null;
        Forecast forecast = null;
        List<Season> seasons = new ArrayList<>();
        String unitName = unit.equals("week") ? "week" : "month";
        if (n >= 4) {
            int lo = 0, hi = 0;
            for (int i = 1; i < n; i++) { if (y[i] < y[lo]) lo = i; if (y[i] > y[hi]) hi = i; }
            double sumY = 0;
            for (double v : y) sumY += v;
            Double savings = totalIncome > 0 ? (totalIncome - sumY) / totalIncome : null;
            summary = new Summary(r(totalSpent), r(mean), r(median), r(sd), round(mean == 0 ? 0 : sd / mean, 3), y[lo], used.get(lo).label(), y[hi], used.get(hi).label(),
                    r(totalIncome), savings == null ? null : round(savings, 3), round(Stats.skew(y), 2), round(Stats.kurtosis(y), 2), r(Stats.quantile(y, 0.75)),
                    r(Stats.quantile(y, 0.90)), r(Stats.quantile(y, 0.95)), r(totalSpent / days), amounts.length, r(Stats.mean(amounts)), r(Stats.median(amounts)));

            Stats.Fit fit = Stats.ols(x, y);
            boolean sig = Math.abs(fit.t()) > tCrit;
            double[] mk = Stats.mannKendall(y);
            double ts = Stats.theilSen(y);
            double[] ln = new double[n];
            boolean positive = true;
            for (int i = 0; i < n; i++) { if (y[i] <= 0) positive = false; else ln[i] = Math.log(y[i]); }
            double growth = positive ? (Math.exp(Stats.ols(x, ln).slope()) - 1) * 100 : Double.NaN;
            trend = new Trend(r(fit.slope()), r(fit.intercept()), round(fit.r2(), 3), round(fit.t(), 2), tCrit, sig, !sig ? "flat" : fit.slope() > 0 ? "rising" : "falling",
                    round(mean == 0 ? 0 : fit.slope() / mean * 100, 2), r(ts), round(mk[0], 3), round(mk[1], 2), round(mk[2], 4), mk[2] < 0.05, round(Stats.lag1(y), 2),
                    Double.isNaN(growth) ? 0 : round(growth, 2));

            // EWMA control chart on the level of spending
            double robust = Stats.mad(y, median) * 1.4826;
            double sigma = robust > 0 ? robust : sd;
            double z = mean;
            List<String> flagged = new ArrayList<>();
            double upper = mean, lower = mean;
            for (int i = 0; i < n; i++) {
                z = LAMBDA * y[i] + (1 - LAMBDA) * z;
                double sz = sigma * Math.sqrt(LAMBDA / (2 - LAMBDA) * (1 - Math.pow(1 - LAMBDA, 2 * (i + 1))));
                upper = mean + 3 * sz;
                lower = mean - 3 * sz;
                if (sz > 0 && (z > upper || z < lower)) flagged.add(used.get(i).label());
            }
            control = new Control(r(mean), r(sigma), LAMBDA, flagged, r(z), r(upper), r(lower),
                    flagged.isEmpty() ? "in control: the level of spending has stayed within its normal band" : "the level moved out of its normal band in " + String.join(", ", flagged));

            // forecast
            double next = fit.intercept() + fit.slope() * n;
            double xbar = Stats.mean(x), sxx = 0;
            for (double v : x) sxx += (v - xbar) * (v - xbar);
            double pi = tCrit * fit.s() * Math.sqrt(1 + 1.0 / n + (n - xbar) * (n - xbar) / (sxx == 0 ? 1 : sxx));
            double[] holt = Stats.holt(y);
            String nextLabel = unit.equals("month") ? YearMonth.parse(used.get(n - 1).key()).plusMonths(1).toString() : LocalDate.parse(used.get(n - 1).key()).plusWeeks(1).toString();
            forecast = new Forecast(nextLabel, r(Math.max(0, next)), r(Math.max(0, next - pi)), r(next + pi), r(Math.max(0, holt[0])), holt[1], holt[2],
                    r(Stats.quantile(y, 0.5)), r(Stats.quantile(y, 0.8)), r(Stats.quantile(y, 0.95)));

            if (unit.equals("month") && n >= 12) {
                double[] sum = new double[13];
                int[] cnt = new int[13];
                for (int i = 0; i < n; i++) {
                    int mo = YearMonth.parse(used.get(i).key()).getMonthValue();
                    sum[mo] += y[i];
                    cnt[mo]++;
                }
                for (int mo = 1; mo <= 12; mo++) {
                    if (cnt[mo] > 0 && mean > 0) {
                        seasons.add(new Season(mo, java.time.Month.of(mo).getDisplayName(java.time.format.TextStyle.SHORT, java.util.Locale.ENGLISH), round(sum[mo] / cnt[mo] / mean, 2), cnt[mo]));
                    }
                }
            }
        } else {
            summary = new Summary(r(totalSpent), 0, 0, 0, 0, 0, "", 0, "", r(earned.stream().mapToDouble(e -> e[1]).sum()), null, round(skew, 2), round(kurt, 2),
                    r(Stats.quantile(amounts, 0.75)), r(Stats.quantile(amounts, 0.90)), r(Stats.quantile(amounts, 0.95)), r(totalSpent / days), amounts.length,
                    r(Stats.mean(amounts)), r(Stats.median(amounts)));
        }

        // ---- category rows
        List<CategoryRow> cats = new ArrayList<>();
        double committed = 0, grand = 0;
        for (double v : catTotals.values()) if (v > 0) grand += v;
        for (Map.Entry<String, Double> e : catTotals.entrySet()) {
            if (e.getValue() <= 0) continue;
            double[] s = catSeries.get(e.getKey());
            double m = 0, sdc = 0, cv = 0, slope = 0, t = 0, mkp = 1, latest = 0, zl = 0, suggested = 0;
            boolean steady = false;
            String trendWord = "flat", vol = "";
            if (n >= 4) {
                m = Stats.mean(s);
                sdc = Stats.sd(s);
                cv = m == 0 ? 0 : sdc / m;
                Stats.Fit f = Stats.ols(x, s);
                slope = f.slope();
                t = f.t();
                mkp = Stats.mannKendall(s)[2];
                trendWord = Math.abs(t) > tCrit && mkp < 0.2 ? (slope > 0 ? "rising" : "falling") : "flat";
                latest = s[n - 1];
                zl = sdc == 0 ? 0 : (latest - m) / sdc;
                long present = java.util.Arrays.stream(s).filter(v -> v > 0).count();
                steady = cv < 0.25 && present >= Math.ceil(n * 0.8);
                if (steady) committed += e.getValue();
                suggested = Stats.quantile(s, 0.8);
                vol = cv < 0.25 ? "steady" : cv < 0.6 ? "variable" : "erratic";
            }
            List<Double> series = new ArrayList<>();
            for (double v : s) series.add(r(v));
            cats.add(new CategoryRow(e.getKey(), r(e.getValue()), 0, r(m), r(sdc), round(cv, 2), vol, r(slope), round(t, 2), trendWord, round(mkp, 3), r(latest), round(zl, 2), steady,
                    r(suggested), series));
        }
        cats.sort(Comparator.comparingDouble(CategoryRow::total).reversed());
        List<CategoryRow> shares = new ArrayList<>();
        for (CategoryRow c : cats) {
            shares.add(new CategoryRow(c.name(), c.total(), round(grand == 0 ? 0 : c.total() / grand, 4), c.mean(), c.sd(), c.cv(), c.volatility(), c.slope(), c.t(), c.trend(),
                    c.mkP(), c.latest(), c.latestZ(), c.committed(), c.suggested(), c.series()));
        }

        // ---- concentration
        List<String> pareto = new ArrayList<>();
        double run = 0, hhi = 0;
        for (CategoryRow c : shares) {
            hhi += c.share() * c.share();
            if (run < 0.8) { pareto.add(c.name()); run += c.share(); }
        }
        double gini = Stats.gini(shares.stream().mapToDouble(CategoryRow::total).toArray());
        String reading = hhi > 0.25 ? "very concentrated: a few categories decide the budget" : hhi > 0.15 ? "moderately concentrated" : "spread across many categories";
        Concentration conc = new Concentration(pareto, round(run, 3), round(hhi, 3), round(gini, 3), reading);

        // ---- categories that move together
        List<Correlation> correlations = new ArrayList<>();
        if (n >= 6) {
            List<CategoryRow> top = shares.stream().filter(c -> c.total() > 0).limit(8).toList();
            for (int i = 0; i < top.size(); i++) {
                for (int j = i + 1; j < top.size(); j++) {
                    double[] a = top.get(i).series().stream().mapToDouble(Double::doubleValue).toArray(), b = top.get(j).series().stream().mapToDouble(Double::doubleValue).toArray();
                    double rr = Stats.pearson(a, b);
                    double tt = Math.abs(rr) >= 1 ? 99 : rr * Math.sqrt((n - 2) / (1 - rr * rr));
                    if (Math.abs(rr) >= 0.6 && Math.abs(tt) > tCritical(n - 2)) {
                        correlations.add(new Correlation(top.get(i).name(), top.get(j).name(), round(rr, 2),
                                rr > 0 ? "rise and fall together" : "one rises when the other falls"));
                    }
                }
            }
            correlations.sort(Comparator.comparingDouble((Correlation c) -> -Math.abs(c.r())));
            if (correlations.size() > 5) correlations = new ArrayList<>(correlations.subList(0, 5));
        }

        // ---- outliers
        List<Outlier> outliers = new ArrayList<>();
        if (n >= 5) {
            for (CategoryRow c : shares) {
                double[] s = c.series().stream().mapToDouble(Double::doubleValue).toArray();
                double med = Stats.median(s), mad = Stats.mad(s, med);
                // a category that is normally zero (MAD 0) has a one-off spike: fall back to the mean absolute deviation (Iglewicz–Hoaglin: z = (x − median) / (1.253314 · MeanAD))
                double meanAd = 0;
                for (double v : s) meanAd += Math.abs(v - med);
                meanAd /= s.length;
                if (mad == 0 && meanAd == 0) continue;
                for (int i = 0; i < s.length; i++) {
                    double mz = mad > 0 ? 0.6745 * (s[i] - med) / mad : (s[i] - med) / (1.253314 * meanAd);
                    if (Math.abs(mz) > 3.5 && s[i] > 0) {
                        outliers.add(new Outlier("period", c.name(), used.get(i).label(), s[i], r(med), round(mz, 1), (mz > 0 ? "far above" : "far below") + " its usual " + Math.round(med)));
                    }
                }
            }
        }
        Map<String, List<Line>> byCat = new LinkedHashMap<>();
        for (Line l : spent) if (l.debit() > 0) byCat.computeIfAbsent(l.category(), k -> new ArrayList<>()).add(l);
        for (Map.Entry<String, List<Line>> e : byCat.entrySet()) {
            List<Line> list = e.getValue();
            if (list.size() < 8) continue;
            double[] am = list.stream().mapToDouble(Line::debit).toArray();
            double q1 = Stats.quantile(am, 0.25), q3 = Stats.quantile(am, 0.75), fence = q3 + 1.5 * (q3 - q1);
            for (Line l : list) {
                if (l.debit() > fence) {
                    outliers.add(new Outlier("expense", l.narration(), l.date().toString(), r(l.debit()), r(q3), round(q3 == q1 ? 0 : (l.debit() - q3) / (q3 - q1), 1),
                            "above the usual range of " + e.getKey() + " (upper fence " + Math.round(fence) + ")"));
                }
            }
        }
        outliers.sort(Comparator.comparingDouble((Outlier o) -> -Math.abs(o.score())));
        List<Outlier> topOutliers = outliers.size() > 15 ? new ArrayList<>(outliers.subList(0, 15)) : outliers;

        double committedShare = grand == 0 ? 0 : committed / grand;

        // ---- advice and findings
        List<String> advice = new ArrayList<>();
        List<String> findings = new ArrayList<>();
        findings.add(String.format("%d expenses totalling ₹%,.0f over %d days: ₹%,.0f a day. The typical expense is ₹%,.0f (median); the average is ₹%,.0f, %s by a few large ones (skewness %.1f).",
                amounts.length, totalSpent, days, totalSpent / days, summary.medianExpense(), summary.averageExpense(), skew > 1 ? "pulled up" : "close to the median", skew));
        if (trend != null) {
            findings.add(String.format("A %s spends about ₹%,.0f (median ₹%,.0f); it varies by ±%.0f%% (CV %.2f), which is %s. Kurtosis %.1f: %s.", unitName, mean, median, summary.cv() * 100, summary.cv(),
                    summary.cv() < 0.15 ? "very steady" : summary.cv() < 0.3 ? "fairly steady" : "irregular", summary.kurtosis(), summary.kurtosis() > 1 ? "occasional extreme periods" : "no heavy tails"));
            findings.add(trend.significant()
                    ? String.format("Spending is %s by ₹%,.0f a %s (%.1f%% of the average): the least-squares trend is significant (t = %.2f against %.2f, R² %.2f).", trend.direction(),
                            Math.abs(trend.slope()), unitName, Math.abs(trend.percentPerPeriod()), trend.t(), tCrit, trend.r2())
                    : String.format("No statistically significant least-squares trend (t = %.2f, below %.2f).", trend.t(), tCrit));
            findings.add(String.format("The robust check agrees%s: Theil–Sen slope ₹%,.0f a %s, Mann–Kendall τ = %.2f, p = %.3f (%s). Growth %.1f%% a %s.",
                    trend.mkSignificant() == trend.significant() ? "" : " only in part", trend.theilSen(), unitName, trend.tau(), trend.mkP(),
                    trend.mkSignificant() ? "a real monotonic trend" : "no monotonic trend", trend.growthPercent(), unitName));
            findings.add(String.format("Memory: lag-1 autocorrelation %.2f (%s). Control chart: %s.", trend.lag1(),
                    trend.lag1() > 0.4 ? "a high month tends to be followed by another high one" : trend.lag1() < -0.4 ? "a high month is followed by a low one" : "each period is mostly independent of the last", control.reading()));
            findings.add(String.format("Next %s (%s): ₹%,.0f by trend (95%% range ₹%,.0f to ₹%,.0f), ₹%,.0f by smoothing. Historically 4 in 5 %ss stayed under ₹%,.0f and 19 in 20 under ₹%,.0f.",
                    unitName, forecast.label(), forecast.ols(), forecast.low(), forecast.high(), forecast.holt(), unitName, forecast.p80(), forecast.p95()));
            advice.add(String.format("Set the %s spending limit at about ₹%,.0f (the 80th percentile): you would have met it in 4 of 5 %ss. ₹%,.0f is the 95th percentile, a safe ceiling for the worst %s.",
                    unitName, forecast.p80(), unitName, forecast.p95(), unitName));
            if (summary.savingsRate() != null) {
                findings.add(String.format("You kept %.0f%% of income (₹%,.0f of ₹%,.0f)%s.", summary.savingsRate() * 100, totalIncome - sumOf(y), totalIncome,
                        summary.savingsRate() < 0.1 ? ": thin, aim for 20% or more" : summary.savingsRate() >= 0.3 ? ": strong" : ""));
            }
        } else if (summary != null) {
            findings.add(String.format("There are not enough complete periods for trend statistics (need %d full months or %d full weeks); what follows describes the expenses themselves. Widen the period or come back as the history grows.", MIN_MONTHS, MIN_WEEKS));
        }
        if (!shares.isEmpty()) {
            findings.add(String.format("%d of %d categories make %.0f%% of the spending (%s); concentration is %s (HHI %.2f, Gini %.2f).", pareto.size(), shares.size(), run * 100,
                    String.join(", ", pareto.subList(0, Math.min(4, pareto.size()))) + (pareto.size() > 4 ? "…" : ""), reading, hhi, gini));
        }
        if (n >= 4) {
            findings.add(String.format("About %.0f%% of spending is committed (steady categories present nearly every period with CV under 0.25); the other %.0f%% is where you can adjust.",
                    committedShare * 100, (1 - committedShare) * 100));
            shares.stream().filter(c -> "rising".equals(c.trend()) && c.share() >= 0.04).limit(3)
                    .forEach(c -> findings.add(String.format("%s is rising by ₹%,.0f a %s (t = %.2f, Mann–Kendall p = %.3f).", c.name(), c.slope(), unitName, c.t(), c.mkP())));
            shares.stream().filter(c -> c.latestZ() > 2).limit(2)
                    .forEach(c -> findings.add(String.format("%s in the latest %s (₹%,.0f) is %.1f standard deviations above its average of ₹%,.0f.", c.name(), unitName, c.latest(), c.latestZ(), c.mean())));
            shares.stream().filter(c -> "erratic".equals(c.volatility()) && c.share() >= 0.05).limit(2)
                    .forEach(c -> advice.add(String.format("%s is erratic (CV %.2f): plan a buffer of about ₹%,.0f a %s instead of the average ₹%,.0f.", c.name(), c.cv(), c.suggested(), unitName, c.mean())));
            shares.stream().filter(c -> "rising".equals(c.trend()) && c.share() >= 0.08).limit(2)
                    .forEach(c -> advice.add(String.format("Look at %s first: it is the largest rising item (₹%,.0f a %s more each %s).", c.name(), c.slope(), unitName, unitName)));
        }
        for (Correlation c : correlations.stream().limit(2).toList()) {
            findings.add(String.format("%s and %s %s (r = %.2f): one tends to bring the other.", c.a(), c.b(), c.reading(), c.r()));
        }
        if (rhythm.uneven()) findings.add(String.format("Spending is unevenly spread over the week (χ² = %.1f, above 12.59): %s is the busiest day and %.0f%% falls on the weekend.", chi2, rhythm.busiest(), rhythm.weekendShare() * 100));
        if (!topOutliers.isEmpty()) findings.add(topOutliers.size() + " unusual item" + (topOutliers.size() == 1 ? "" : "s") + " stand out from the pattern (see below).");
        if (advice.isEmpty()) advice.add("Nothing stands out to change: keep recording, and the limits above will firm up as the history grows.");

        // ---- where the money can be saved: categories that run above their own median, on average, by this much each period
        List<Opportunity> opportunities = new ArrayList<>();
        double totalExcess = 0;
        if (n >= 4) {
            for (CategoryRow c : shares) {
                if (c.committed()) continue;
                double[] s = c.series().stream().mapToDouble(Double::doubleValue).toArray();
                double med = Stats.median(s), excess = 0;
                for (double v : s) excess += Math.max(0, v - med);
                excess /= s.length;
                if (excess > 0) opportunities.add(new Opportunity(c.name(), r(med), c.mean(), r(excess), 0, r(excess * (unit.equals("week") ? 52 : 12))));
                totalExcess += excess;
            }
            opportunities.sort(Comparator.comparingDouble(Opportunity::excess).reversed());
            final double tot = totalExcess;
            opportunities = new ArrayList<>(opportunities.stream().limit(8).map(o -> new Opportunity(o.name(), o.typical(), o.average(), o.excess(), round(tot == 0 ? 0 : o.excess() / tot, 3), o.yearly())).toList());
            if (!opportunities.isEmpty()) {
                Opportunity top = opportunities.get(0);
                advice.add(0, String.format("Biggest saving: %s. In an ordinary %s you spend about ₹%,.0f on it, but it often runs higher; keeping it at its usual level would save about ₹%,.0f a %s (₹%,.0f a year). All the categories together: ₹%,.0f a %s.",
                        top.name(), unitName, top.typical(), top.excess(), unitName, top.yearly(), totalExcess, unitName));
            }
        }

        // ---- the health of the spending, in one number
        Health health = null;
        if (trend != null) {
            List<HealthPart> parts = new ArrayList<>();
            double steady = 100 * Math.max(0, Math.min(1, 1 - summary.cv() / 0.6));
            parts.add(new HealthPart("Steadiness", r(steady), 0.25, String.format("CV %.2f: %s", summary.cv(), summary.cv() < 0.15 ? "very steady" : summary.cv() < 0.3 ? "fairly steady" : "irregular")));
            double up = trend.significant() && trend.slope() > 0 ? Math.max(0, 100 - 10 * Math.abs(trend.percentPerPeriod())) : 100;
            parts.add(new HealthPart("Direction", r(up), 0.20, trend.significant() ? "spending is " + trend.direction() + " by " + String.format("%.1f%%", Math.abs(trend.percentPerPeriod())) + " a " + unitName : "no significant trend"));
            if (summary.savingsRate() != null) {
                double sv = 100 * Math.max(0, Math.min(1, summary.savingsRate() / 0.3));
                parts.add(new HealthPart("Savings", r(sv), 0.25, String.format("%.0f%% of income kept (30%% scores full marks)", summary.savingsRate() * 100)));
            }
            double conc01 = 100 * (1 - Math.max(0, Math.min(1, (hhi - 0.10) / 0.30)));
            parts.add(new HealthPart("Balance across categories", r(conc01), 0.10, reading));
            double pred = Math.max(0, 100 - 15 * control.flagged().size() - 8 * topOutliers.size());
            parts.add(new HealthPart("Predictability", r(pred), 0.10, String.format("%d control-chart signals, %d unusual items", control.flagged().size(), topOutliers.size())));
            double flex = 100 * (1 - Math.max(0, Math.min(1, (committedShare - 0.6) / 0.4)));
            parts.add(new HealthPart("Room to adjust", r(flex), 0.10, String.format("%.0f%% is committed; %.0f%% can be changed", committedShare * 100, (1 - committedShare) * 100)));
            double wsum2 = parts.stream().mapToDouble(HealthPart::weight).sum(), score = parts.stream().mapToDouble(p -> p.score() * p.weight()).sum() / wsum2;
            String grade = score >= 85 ? "A" : score >= 70 ? "B" : score >= 55 ? "C" : score >= 40 ? "D" : "E";
            health = new Health(r(score), grade, score >= 85 ? "Excellent" : score >= 70 ? "Good" : score >= 55 ? "Fair" : score >= 40 ? "Needs attention" : "At risk", parts);
        }

        return new DeepAnalysis(from, to, unit, true, null, rows, summary, trend, control, forecast, seasons, shares, correlations, conc, topOutliers, rhythm, round(committedShare, 3),
                advice, findings, health, opportunities);
    }

    private static Bucket bucketOf(String unit, LocalDate d) {
        if (unit.equals("month")) {
            YearMonth m = YearMonth.from(d);
            return new Bucket(m.toString(), m.toString(), m.atDay(1), m.atEndOfMonth());
        }
        if (unit.equals("week")) {
            LocalDate s = d.with(DayOfWeek.MONDAY);
            return new Bucket(s.toString(), s.toString(), s, s.plusDays(6));
        }
        return null;
    }

    private static double sumOf(double[] v) {
        double s = 0;
        for (double d : v) s += d;
        return s;
    }

    private static double tCritical(int df) {
        return df < 1 ? T95[0] : df <= 30 ? T95[df - 1] : 1.96;
    }

    private static double r(double v) {
        return Double.isNaN(v) || Double.isInfinite(v) ? 0 : Math.round(v * 100.0) / 100.0;
    }

    private static double round(double v, int places) {
        if (Double.isNaN(v) || Double.isInfinite(v)) return 0;
        double f = Math.pow(10, places);
        return Math.round(v * f) / f;
    }

    // ================================================================== the statistics

    /** The small statistics toolbox used above (no dependencies, so every figure can be checked by hand). */
    static final class Stats {
        private Stats() {
        }

        record Fit(double slope, double intercept, double r2, double t, double s) {
        }

        static double mean(double[] v) {
            double s = 0;
            for (double d : v) s += d;
            return v.length == 0 ? 0 : s / v.length;
        }

        /** Sample standard deviation (n − 1). */
        static double sd(double[] v) {
            if (v.length < 2) return 0;
            double m = mean(v), s = 0;
            for (double d : v) s += (d - m) * (d - m);
            return Math.sqrt(s / (v.length - 1));
        }

        static double median(double[] v) {
            return quantile(v, 0.5);
        }

        /** Linear-interpolated quantile (type 7, as spreadsheets do). */
        static double quantile(double[] v, double q) {
            if (v.length == 0) return 0;
            double[] s = v.clone();
            java.util.Arrays.sort(s);
            double pos = (s.length - 1) * q;
            int lo = (int) Math.floor(pos), hi = (int) Math.ceil(pos);
            return s[lo] + (s[hi] - s[lo]) * (pos - lo);
        }

        /** Median absolute deviation. */
        static double mad(double[] v, double median) {
            double[] d = new double[v.length];
            for (int i = 0; i < v.length; i++) d[i] = Math.abs(v[i] - median);
            return median(d);
        }

        /** Adjusted Fisher–Pearson sample skewness (0 for fewer than three values). */
        static double skew(double[] v) {
            int n = v.length;
            if (n < 3) return 0;
            double m = mean(v), s = sd(v);
            if (s == 0) return 0;
            double sum = 0;
            for (double d : v) sum += Math.pow((d - m) / s, 3);
            return n / ((n - 1.0) * (n - 2.0)) * sum;
        }

        /** Sample excess kurtosis (0 for fewer than four values). */
        static double kurtosis(double[] v) {
            int n = v.length;
            if (n < 4) return 0;
            double m = mean(v), s = sd(v);
            if (s == 0) return 0;
            double sum = 0;
            for (double d : v) sum += Math.pow((d - m) / s, 4);
            return n * (n + 1.0) / ((n - 1.0) * (n - 2.0) * (n - 3.0)) * sum - 3.0 * (n - 1.0) * (n - 1.0) / ((n - 2.0) * (n - 3.0));
        }

        /** Pearson's correlation coefficient. */
        static double pearson(double[] a, double[] b) {
            int n = Math.min(a.length, b.length);
            if (n < 3) return 0;
            double ma = mean(a), mb = mean(b), sab = 0, saa = 0, sbb = 0;
            for (int i = 0; i < n; i++) {
                sab += (a[i] - ma) * (b[i] - mb);
                saa += (a[i] - ma) * (a[i] - ma);
                sbb += (b[i] - mb) * (b[i] - mb);
            }
            return saa == 0 || sbb == 0 ? 0 : sab / Math.sqrt(saa * sbb);
        }

        /** The lag-1 autocorrelation of a series. */
        static double lag1(double[] y) {
            if (y.length < 3) return 0;
            double m = mean(y), num = 0, den = 0;
            for (int i = 0; i < y.length; i++) {
                den += (y[i] - m) * (y[i] - m);
                if (i + 1 < y.length) num += (y[i] - m) * (y[i + 1] - m);
            }
            return den == 0 ? 0 : num / den;
        }

        /** Theil–Sen slope: the median of the slopes between every pair of points (x = 0, 1, 2 …). */
        static double theilSen(double[] y) {
            List<Double> slopes = new ArrayList<>();
            for (int i = 0; i < y.length; i++) for (int j = i + 1; j < y.length; j++) slopes.add((y[j] - y[i]) / (j - i));
            return median(slopes.stream().mapToDouble(Double::doubleValue).toArray());
        }

        /**
         * Mann–Kendall trend test: { tau, Z, two-sided p }. S = Σ sign(yⱼ − yᵢ); Var S = [n(n − 1)(2n + 5) − Σ tₖ(tₖ − 1)(2tₖ + 5)] / 18
         * with tₖ the sizes of tied groups; Z = (S − sign S) / √Var S.
         */
        static double[] mannKendall(double[] y) {
            int n = y.length;
            if (n < 3) return new double[]{0, 0, 1};
            double s = 0;
            for (int i = 0; i < n; i++) for (int j = i + 1; j < n; j++) s += Math.signum(y[j] - y[i]);
            Map<Double, Integer> ties = new TreeMap<>();
            for (double v : y) ties.merge(v, 1, Integer::sum);
            double tieTerm = 0;
            for (int t : ties.values()) if (t > 1) tieTerm += t * (t - 1.0) * (2.0 * t + 5);
            double var = (n * (n - 1.0) * (2.0 * n + 5) - tieTerm) / 18.0;
            double z = var <= 0 ? 0 : (s - Math.signum(s)) / Math.sqrt(var);
            double tau = s / (n * (n - 1.0) / 2.0);
            return new double[]{tau, z, 2 * (1 - normalCdf(Math.abs(z)))};
        }

        /** The standard normal CDF (Abramowitz and Stegun 7.1.26 for erf, error under 1.5e-7). */
        static double normalCdf(double z) {
            double t = 1.0 / (1.0 + 0.3275911 * Math.abs(z) / Math.sqrt(2));
            double poly = ((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592;
            double erf = 1 - poly * t * Math.exp(-z * z / 2);
            return z >= 0 ? 0.5 * (1 + erf) : 0.5 * (1 - erf);
        }

        /** Ordinary least squares y = a + b·x, with R², the slope's t statistic and the residual standard error. */
        static Fit ols(double[] x, double[] y) {
            int n = x.length;
            double xb = mean(x), yb = mean(y), sxx = 0, sxy = 0, syy = 0;
            for (int i = 0; i < n; i++) {
                sxx += (x[i] - xb) * (x[i] - xb);
                sxy += (x[i] - xb) * (y[i] - yb);
                syy += (y[i] - yb) * (y[i] - yb);
            }
            double b = sxx == 0 ? 0 : sxy / sxx, a = yb - b * xb;
            double sse = 0;
            for (int i = 0; i < n; i++) {
                double e = y[i] - (a + b * x[i]);
                sse += e * e;
            }
            double s = n > 2 ? Math.sqrt(sse / (n - 2)) : 0;
            double se = sxx == 0 ? 0 : s / Math.sqrt(sxx);
            double t = se == 0 ? (b == 0 ? 0 : Math.signum(b) * 99) : b / se;
            return new Fit(b, a, syy == 0 ? 0 : 1 - sse / syy, t, s);
        }

        /** Gini coefficient of non-negative values: 0 even, near 1 when one item has it all. */
        static double gini(double[] v) {
            int n = v.length;
            if (n < 2) return 0;
            double[] s = v.clone();
            java.util.Arrays.sort(s);
            double sum = 0, weighted = 0;
            for (int i = 0; i < n; i++) { sum += s[i]; weighted += (i + 1) * s[i]; }
            return sum == 0 ? 0 : (2 * weighted) / (n * sum) - (n + 1.0) / n;
        }

        /** Holt's linear exponential smoothing: { next-step forecast, alpha, beta }, parameters chosen by grid search. */
        static double[] holt(double[] y) {
            double best = Double.MAX_VALUE, bestA = 0.5, bestB = 0.3, bestF = y.length == 0 ? 0 : y[y.length - 1];
            for (double a = 0.1; a < 0.95; a += 0.1) {
                for (double b = 0.1; b < 0.95; b += 0.1) {
                    double level = y[0], trend = y.length > 1 ? y[1] - y[0] : 0, sse = 0;
                    for (int i = 1; i < y.length; i++) {
                        double f = level + trend, e = y[i] - f;
                        sse += e * e;
                        double nl = a * y[i] + (1 - a) * (level + trend);
                        trend = b * (nl - level) + (1 - b) * trend;
                        level = nl;
                    }
                    if (sse < best) { best = sse; bestA = a; bestB = b; bestF = level + trend; }
                }
            }
            return new double[]{bestF, Math.round(bestA * 10) / 10.0, Math.round(bestB * 10) / 10.0};
        }
    }
}
