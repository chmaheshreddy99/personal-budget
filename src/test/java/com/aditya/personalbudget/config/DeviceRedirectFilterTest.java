package com.aditya.personalbudget.config;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class DeviceRedirectFilterTest {

    @Test
    void phonesAreTellingTabletsAndComputersAreNot() {
        assertThat(DeviceRedirectFilter.isPhone("Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36")).isTrue();
        assertThat(DeviceRedirectFilter.isPhone("Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1")).isTrue();
        assertThat(DeviceRedirectFilter.isPhone("Mozilla/5.0 (Linux; Android 13; SM-X700) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36")).isFalse();
        assertThat(DeviceRedirectFilter.isPhone("Mozilla/5.0 (iPad; CPU OS 12_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148")).isFalse();
        assertThat(DeviceRedirectFilter.isPhone("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36")).isFalse();
        assertThat(DeviceRedirectFilter.isPhone(null)).isFalse();
    }
}
