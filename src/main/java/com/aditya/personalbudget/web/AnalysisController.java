package com.aditya.personalbudget.web;

import com.aditya.personalbudget.security.Permission;
import com.aditya.personalbudget.security.RequiresPermission;
import com.aditya.personalbudget.service.DeepAnalysisService;
import com.aditya.personalbudget.service.DeepAnalysisService.DeepAnalysis;
import com.aditya.personalbudget.service.InvestmentAdviceService;
import com.aditya.personalbudget.service.InvestmentAdviceService.Advice;
import com.aditya.personalbudget.service.OrgClock;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.time.LocalDate;

/** The statistical expense analysis and the investment plan (Reports). */
@RestController
@RequestMapping("/api/reports")
public class AnalysisController {

    private final DeepAnalysisService deep;
    private final InvestmentAdviceService invest;

    public AnalysisController(DeepAnalysisService deep, InvestmentAdviceService invest) {
        this.deep = deep;
        this.invest = invest;
    }

    @GetMapping("/deep-analysis")
    @RequiresPermission(Permission.VIEW)
    public DeepAnalysis deepAnalysis(@RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
                                     @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to) {
        LocalDate end = to != null ? to : OrgClock.today();
        return deep.analyse(from != null ? from : end.minusMonths(11).withDayOfMonth(1), end);
    }

    @GetMapping("/investment-plan")
    @RequiresPermission(Permission.VIEW)
    public Advice investmentPlan(@RequestParam(required = false) Integer age, @RequestParam(required = false) String risk,
                                 @RequestParam(required = false) Integer horizon, @RequestParam(required = false) Double goal,
                                 @RequestParam(required = false) Double alt) {
        return invest.advise(age, risk, horizon, goal, alt);
    }
}
