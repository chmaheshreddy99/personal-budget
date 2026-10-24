package com.aditya.personalbudget.web;

import com.aditya.personalbudget.security.Permission;
import com.aditya.personalbudget.security.RequiresPermission;
import com.aditya.personalbudget.security.UserContext;
import com.aditya.personalbudget.service.ChangeNotifier;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

/** Live updates for the signed-in browser (Server-Sent Events). */
@RestController
public class EventsController {

    private final ChangeNotifier notifier;

    public EventsController(ChangeNotifier notifier) {
        this.notifier = notifier;
    }

    @GetMapping(value = "/api/events", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    @RequiresPermission(Permission.VIEW)
    public org.springframework.http.ResponseEntity<SseEmitter> events() {
        // a proxy or tunnel in between (nginx, a cloud load balancer) must pass each event on at once, not hold them back
        return org.springframework.http.ResponseEntity.ok()
                .header("Cache-Control", "no-cache, no-transform")
                .header("X-Accel-Buffering", "no")
                .body(notifier.subscribe(UserContext.get()));
    }
}
