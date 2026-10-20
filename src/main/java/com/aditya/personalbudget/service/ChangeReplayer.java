package com.aditya.personalbudget.service;

import com.aditya.personalbudget.exception.BusinessException;
import com.aditya.personalbudget.service.PendingService.ChangePayload;
import com.aditya.personalbudget.service.PendingService.PendingView;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.core.env.Environment;
import org.springframework.stereotype.Component;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;

/**
 * Makes an approved change request: the call the maker made is made again, as it was made, by the checker approving it
 * (with the checker's session, so every rule of that call applies to them: their role, the section, the record's
 * version). Made first, then the request is marked approved; if the call is refused (the record changed since, or the
 * checker may not make it), nothing changes and the checker is told why.
 * <p>
 * It runs outside any transaction of its own, so the call (its own request, with its own transaction) never waits on it.
 */
@Component
public class ChangeReplayer {

    private final PendingService pending;
    private final Environment env;
    private final ObjectMapper json;
    private final HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build();

    public ChangeReplayer(PendingService pending, Environment env, ObjectMapper json) {
        this.pending = pending;
        this.env = env;
        this.json = json;
    }

    public PendingView approve(Long id, String note) {
        ChangePayload c = pending.changeToMake(id);
        if (c.method() == null || c.uri() == null) throw new BusinessException("This change request cannot be made: what was asked is missing");
        HttpServletRequest current = ((ServletRequestAttributes) RequestContextHolder.currentRequestAttributes()).getRequest();
        String auth = current.getHeader("Authorization");
        if (auth == null) throw new BusinessException("Sign in again to approve it");
        String port = env.getProperty("local.server.port", env.getProperty("server.port", "8080"));
        HttpRequest.BodyPublisher body = c.body() == null ? HttpRequest.BodyPublishers.noBody() : HttpRequest.BodyPublishers.ofString(c.body());
        HttpRequest call = HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + port + c.uri()))
                .timeout(Duration.ofSeconds(60))
                .header("Authorization", auth)
                .header("Content-Type", "application/json")
                .header("X-Approved-Change", String.valueOf(id))
                .method(c.method(), body).build();
        HttpResponse<String> answer;
        try {
            answer = http.send(call, HttpResponse.BodyHandlers.ofString());
        } catch (java.io.IOException e) {
            throw new BusinessException("The change could not be made: " + e.getMessage());
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new BusinessException("The change could not be made: interrupted");
        }
        if (answer.statusCode() == 202) throw new BusinessException("The change waits for approval again: approve it as someone who does not need approval");
        if (answer.statusCode() >= 300) throw new BusinessException("The change could not be made: " + messageOf(answer));
        return pending.changeMade(id, note);
    }

    private String messageOf(HttpResponse<String> answer) {
        try {
            JsonNode n = json.readTree(answer.body());
            if (n.has("message")) return n.get("message").asString();
        } catch (RuntimeException ignored) {
            // not JSON: the status says it
        }
        return "refused (" + answer.statusCode() + ")";
    }
}
