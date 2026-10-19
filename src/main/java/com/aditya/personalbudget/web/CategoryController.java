package com.aditya.personalbudget.web;

import com.aditya.personalbudget.dto.PlanningDtos.CategoryRequest;
import com.aditya.personalbudget.dto.PlanningDtos.CategoryView;
import com.aditya.personalbudget.security.Permission;
import com.aditya.personalbudget.security.RequiresPermission;
import com.aditya.personalbudget.service.CategoryService;
import jakarta.validation.Valid;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

/**
 * Expense and income categories ({@code /api/categories}).
 */
@RestController
@RequestMapping("/api/categories")
public class CategoryController {

    private final CategoryService categories;

    public CategoryController(CategoryService categories) {
        this.categories = categories;
    }

    @GetMapping
    @RequiresPermission(Permission.VIEW)
    public List<CategoryView> list() {
        return categories.list();
    }

    @PostMapping
    @RequiresPermission(Permission.MANAGE_ACCOUNTS)
    public CategoryView create(@Valid @RequestBody CategoryRequest request) {
        return categories.create(request);
    }

    @PutMapping("/{id}")
    @RequiresPermission(Permission.MANAGE_ACCOUNTS)
    public CategoryView update(@PathVariable Long id, @Valid @RequestBody CategoryRequest request) {
        return categories.update(id, request);
    }

    @DeleteMapping("/{id}")
    @RequiresPermission(Permission.MANAGE_ACCOUNTS)
    public ResponseEntity<Void> delete(@PathVariable Long id) {
        categories.delete(id);
        return ResponseEntity.noContent().build();
    }
}
