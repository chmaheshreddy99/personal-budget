package com.aditya.personalbudget.service;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.within;

/** The statistics behind the deep expense analysis and the investment plan, against values worked out by hand. */
class StatsTests {

    @Test
    void aStraightLineFitsExactlyAndANoisyOneHasAMeasuredTrend() {
        double[] x = {0, 1, 2, 3, 4, 5};
        var exact = DeepAnalysisService.Stats.ols(x, new double[]{1, 3, 5, 7, 9, 11});
        assertThat(exact.slope()).isCloseTo(2, within(1e-9));
        assertThat(exact.intercept()).isCloseTo(1, within(1e-9));
        assertThat(exact.r2()).isCloseTo(1, within(1e-9));
        // y = 10, 12, 9, 13, 11, 14: slope 0.6, t = 1.5 (not significant at 95%: 2.776 for 4 d.f.)
        var noisy = DeepAnalysisService.Stats.ols(x, new double[]{10, 12, 9, 13, 11, 14});
        assertThat(noisy.slope()).isCloseTo(0.6, within(1e-9));
        assertThat(noisy.t()).isCloseTo(1.5, within(1e-9));
        assertThat(Math.abs(noisy.t())).isLessThan(2.776);
    }

    @Test
    void spreadAndRobustMeasures() {
        double[] v = {2, 4, 4, 4, 5, 5, 7, 9};
        assertThat(DeepAnalysisService.Stats.mean(v)).isEqualTo(5);
        assertThat(DeepAnalysisService.Stats.sd(v)).isCloseTo(2.138, within(1e-3));   // sample (n - 1)
        assertThat(DeepAnalysisService.Stats.median(v)).isEqualTo(4.5);
        assertThat(DeepAnalysisService.Stats.quantile(v, 0.25)).isCloseTo(4, within(1e-9));
        assertThat(DeepAnalysisService.Stats.mad(v, 4.5)).isEqualTo(0.5);
        assertThat(DeepAnalysisService.Stats.gini(new double[]{1, 1, 1, 1})).isCloseTo(0, within(1e-9));
        assertThat(DeepAnalysisService.Stats.gini(new double[]{0, 0, 0, 10})).isCloseTo(0.75, within(1e-9));
    }

    @Test
    void holtFollowsATrendAndTheAnnuityFormulaMatchesTheHandCalculation() {
        double[] up = DeepAnalysisService.Stats.holt(new double[]{100, 110, 120, 130, 140, 150});
        assertThat(up[0]).isCloseTo(160, within(1.0));
        // 10,000 a month for 10 years at 12% a year (1% a month, annuity due) = 2,323,391
        assertThat(InvestmentAdviceService.fv(10000, 12, 10)).isCloseTo(2_320_390, within(5_000.0));
        assertThat(InvestmentAdviceService.fv(10000, 0, 10)).isEqualTo(1_200_000);
        assertThat(InvestmentAdviceService.fvStepUp(10000, 12, 10, 0.10)).isGreaterThan(InvestmentAdviceService.fv(10000, 12, 10));
    }
}
