package com.aditya.personalbudget.web;

import com.aditya.personalbudget.dto.UserDtos.LoginRequest;
import com.aditya.personalbudget.dto.UserDtos.MeView;
import com.aditya.personalbudget.dto.UserDtos.PasswordChangeRequest;
import com.aditya.personalbudget.dto.UserDtos.RegisterRequest;
import com.aditya.personalbudget.dto.UserDtos.SessionView;
import com.aditya.personalbudget.security.AuthInterceptor;
import com.aditya.personalbudget.security.SelfService;
import com.aditya.personalbudget.service.AuthService;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

@RestController
@RequestMapping("/api/auth")
public class AuthController {

    private final AuthService auth;

    public AuthController(AuthService auth) {
        this.auth = auth;
    }

    @PostMapping("/login")
    public SessionView login(@Valid @RequestBody LoginRequest request, HttpServletRequest http) {
        return auth.login(request, http.getHeader("User-Agent"));
    }

    /** Opens an access link: a session limited to what the link allows, until it expires or is revoked. */
    @PostMapping("/link")
    public SessionView link(@RequestBody Map<String, String> request, HttpServletRequest http) {
        return auth.loginWithLink(request.get("token"), http.getHeader("User-Agent"));
    }

    @PostMapping("/register")
    public SessionView register(@Valid @RequestBody RegisterRequest request) {
        return auth.register(request);
    }

    @PostMapping("/logout")
    @SelfService
    public ResponseEntity<Void> logout(HttpServletRequest request) {
        auth.logout(AuthInterceptor.tokenOf(request));
        return ResponseEntity.noContent().build();
    }

    @GetMapping("/me")
    public MeView me() {
        return auth.me();
    }

    @PostMapping("/password")
    @SelfService
    public ResponseEntity<Void> changePassword(@Valid @RequestBody PasswordChangeRequest request) {
        auth.changePassword(request);
        return ResponseEntity.noContent().build();
    }
}
