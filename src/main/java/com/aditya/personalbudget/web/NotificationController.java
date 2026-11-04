package com.aditya.personalbudget.web;

import com.aditya.personalbudget.security.Permission;
import com.aditya.personalbudget.security.RequiresPermission;
import com.aditya.personalbudget.service.NotificationService;
import com.aditya.personalbudget.service.NotificationService.Overview;
import com.aditya.personalbudget.service.NotificationService.Sent;
import com.aditya.personalbudget.service.NotificationService.SettingsRequest;
import com.aditya.personalbudget.service.NotificationService.Status;
import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** Alerts by e-mail (Settings › Alerts): what is sent and to whom, a sample, and what the dialogs need for their switch. */
@RestController
@RequestMapping("/api/notifications")
public class NotificationController {

    private final NotificationService notifications;

    public NotificationController(NotificationService notifications) {
        this.notifications = notifications;
    }

    @GetMapping
    @RequiresPermission(Permission.MANAGE_USERS)
    public Overview overview() {
        return notifications.overview();
    }

    @PutMapping
    @RequiresPermission(Permission.MANAGE_USERS)
    public Overview save(@Valid @RequestBody SettingsRequest request) {
        return notifications.save(request);
    }

    @PostMapping("/test")
    @RequiresPermission(Permission.MANAGE_USERS)
    public Sent test() {
        return notifications.test();
    }

    /** For the e-mail switch at the foot of a dialog: whether e-mail works, and what is on. */
    @GetMapping("/status")
    public Status status() {
        return notifications.status();
    }
}
