package com.aditya.personalbudget.security;

import com.aditya.personalbudget.domain.entity.AppUser;
import com.aditya.personalbudget.domain.type.Feature;
import org.junit.jupiter.api.Test;

import java.util.EnumSet;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;

class FeaturePolicyTest {

    @Test
    void anUnlimitedUserGetsEverySectionAndEveryMobileSection() {
        AppUser user = new AppUser();
        assertThat(FeaturePolicy.granted(user, false)).isEqualTo(Feature.all());
        assertThat(FeaturePolicy.granted(user, true)).isEqualTo(Feature.allMobile());
    }

    @Test
    void mobileSectionsNeverExceedTheDesktopOnes() {
        AppUser user = new AppUser();
        user.setFeatures("EXPENSES,CHITS,REPORTS");
        user.setMobileFeatures("EXPENSES,BUDGETS");
        assertThat(FeaturePolicy.granted(user, false)).containsExactlyInAnyOrder(Feature.EXPENSES, Feature.CHITS, Feature.REPORTS);
        assertThat(FeaturePolicy.granted(user, true)).containsExactly(Feature.EXPENSES);
        user.setMobileAccess(false);
        assertThat(FeaturePolicy.granted(user, true)).isEmpty();
    }

    @Test
    void aRecorderLinkMayOnlyAddExpensesAndSeesNoBalancesWithoutTheSections() {
        CurrentUser recorder = new CurrentUser(1L, "link:Ravi", "Ravi", com.aditya.personalbudget.domain.type.UserRole.MEMBER,
                1L, "home", "Home", "INR", EnumSet.of(Feature.EXPENSES), true, 7L, true);
        assertThat(FeaturePolicy.allowsLink(recorder, "POST", "/api/expenses")).isTrue();
        assertThat(FeaturePolicy.allowsLink(recorder, "PUT", "/api/expenses/5")).isFalse();
        assertThat(FeaturePolicy.allowsLink(recorder, "POST", "/api/claims")).isFalse();
        assertThat(FeaturePolicy.allowsLink(recorder, "POST", "/api/auth/logout")).isTrue();
        assertThat(FeaturePolicy.allowsLink(recorder, "GET", "/api/pulse")).isFalse();
        assertThat(FeaturePolicy.allowsLink(recorder, "GET", "/api/accounts")).isFalse();
        assertThat(FeaturePolicy.allowsLink(recorder, "GET", "/api/activity")).isFalse();
        assertThat(FeaturePolicy.allowsLink(recorder, "GET", "/api/expenses/form-options")).isTrue();

        CurrentUser viewer = new CurrentUser(1L, "link:Amma", "Amma", com.aditya.personalbudget.domain.type.UserRole.VIEWER,
                1L, "home", "Home", "INR", EnumSet.of(Feature.DASHBOARD, Feature.EXPENSES), true, 8L, false);
        assertThat(FeaturePolicy.allowsLink(viewer, "POST", "/api/expenses")).isFalse();   // view only
        assertThat(FeaturePolicy.allowsLink(viewer, "GET", "/api/pulse")).isTrue();
    }

    @Test
    void changesNeedTheOwningSectionWhileReadsAreOpenToSectionsThatShowTheData() {
        Set<Feature> expensesOnly = EnumSet.of(Feature.EXPENSES);
        assertThat(FeaturePolicy.allows(expensesOnly, "GET", "/api/budgets")).isTrue();          // the expense dialog shows the budget
        assertThat(FeaturePolicy.allows(expensesOnly, "POST", "/api/budgets")).isFalse();
        assertThat(FeaturePolicy.allows(expensesOnly, "POST", "/api/expenses")).isTrue();
        assertThat(FeaturePolicy.allows(expensesOnly, "POST", "/api/chits/4/installments/9/pay")).isFalse();
        assertThat(FeaturePolicy.allows(expensesOnly, "GET", "/api/reports/insights")).isFalse();
        assertThat(FeaturePolicy.allows(expensesOnly, "GET", "/api/dashboard")).isFalse();
        assertThat(FeaturePolicy.allows(expensesOnly, "POST", "/api/transactions/journal")).isFalse();
        assertThat(FeaturePolicy.allows(expensesOnly, "GET", "/api/accounts")).isTrue();          // every screen needs accounts
        assertThat(FeaturePolicy.allows(expensesOnly, "GET", "/api/pulse")).isTrue();
    }
}
