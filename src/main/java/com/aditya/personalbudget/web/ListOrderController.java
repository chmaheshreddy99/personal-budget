package com.aditya.personalbudget.web;

import com.aditya.personalbudget.security.Permission;
import com.aditya.personalbudget.security.RequiresPermission;
import com.aditya.personalbudget.service.ListOrderService;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Size;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.Map;

/** The order the household arranged its accounts, chits and budgets in (see {@link ListOrderService}). */
@RestController
public class ListOrderController {

    public record OrderRequest(@Size(max = 5000) List<Long> ids) {
    }

    private final ListOrderService orders;

    public ListOrderController(ListOrderService orders) {
        this.orders = orders;
    }

    @GetMapping("/api/list-order")
    @RequiresPermission(Permission.VIEW)
    public Map<String, List<Long>> orders() {
        return orders.orders();
    }

    @PutMapping("/api/list-order/{list}")
    @RequiresPermission(Permission.POST_TRANSACTIONS)
    public Map<String, List<Long>> save(@PathVariable String list, @Valid @RequestBody OrderRequest request) {
        return orders.save(list, request.ids());
    }
}
