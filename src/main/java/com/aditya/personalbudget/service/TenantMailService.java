package com.aditya.personalbudget.service;

import com.aditya.personalbudget.domain.entity.TenantMailSettings;
import com.aditya.personalbudget.exception.BusinessException;
import com.aditya.personalbudget.repository.TenantMailSettingsRepository;
import com.aditya.personalbudget.security.UserContext;
import jakarta.mail.internet.MimeMessage;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.Size;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.core.env.Environment;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.mail.javamail.JavaMailSenderImpl;
import org.springframework.mail.javamail.MimeMessageHelper;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import javax.crypto.Cipher;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.time.LocalDateTime;
import java.util.Base64;
import java.util.Optional;
import java.util.Properties;

/**
 * E-mail settings per household (Settings → E-mail): the SMTP account reminders and receipts are sent from. When a
 * household has none (or switched it off), the installation's {@code spring.mail} settings are used, if any.
 */
@Service
public class TenantMailService {

    /** What the settings page shows: everything but the password (only whether one is saved). */
    public record MailSettingsView(boolean saved, boolean enabled, String host, Integer port, String security, String username,
                                   boolean hasPassword, String fromAddress, String fromName, String replyTo, String updatedBy,
                                   LocalDateTime updatedAt, LocalDateTime testedAt, String testResult,
                                   boolean serverConfigured, String serverFrom, String activeSource) {
    }

    /** password: blank keeps the saved one; clearPassword removes it. */
    public record MailSettingsRequest(Boolean enabled, @Size(max = 120) String host, @Min(1) @Max(65535) Integer port,
                                      @Size(max = 10) String security, @Size(max = 120) String username, @Size(max = 200) String password,
                                      Boolean clearPassword, @Email @Size(max = 120) String fromAddress, @Size(max = 100) String fromName,
                                      @Email @Size(max = 120) String replyTo) {
    }

    public record TestRequest(@Email @Size(max = 120) String to) {
    }

    /** The account a message goes out through: the household's own, or the installation's. */
    public record Sender(JavaMailSender mail, String from, String fromName, String replyTo, String source) {
    }

    private static final String KEY = "mail.secret-key";

    private final TenantMailSettingsRepository repository;
    private final ObjectProvider<JavaMailSender> serverSender;
    private final Environment env;
    private final AppSettingsService settings;
    private final ActivityService activity;
    private final SecureRandom random = new SecureRandom();

    public TenantMailService(TenantMailSettingsRepository repository, ObjectProvider<JavaMailSender> serverSender, Environment env,
                             AppSettingsService settings, ActivityService activity) {
        this.repository = repository;
        this.serverSender = serverSender;
        this.env = env;
        this.settings = settings;
        this.activity = activity;
    }

    public MailSettingsView view() {
        TenantMailSettings s = repository.findForTenant(UserContext.tenantId()).orElse(null);
        Sender active = sender().orElse(null);
        String serverFrom = serverFrom();
        boolean server = serverSender.getIfAvailable() != null && serverFrom != null;
        if (s == null) {
            return new MailSettingsView(false, false, null, null, TenantMailSettings.STARTTLS, null, false, null, null, null, null, null,
                    null, null, server, serverFrom, active == null ? null : active.source());
        }
        return new MailSettingsView(true, Boolean.TRUE.equals(s.getEnabled()), s.getHost(), s.getPort(), s.getSecurity(), s.getUsername(),
                s.getPasswordEnc() != null, s.getFromAddress(), s.getFromName(), s.getReplyTo(), s.getUpdatedBy(), s.getUpdatedAt(),
                s.getTestedAt(), s.getTestResult(), server, serverFrom, active == null ? null : active.source());
    }

    @Transactional
    public MailSettingsView save(MailSettingsRequest r) {
        Long tenantId = UserContext.tenantId();
        TenantMailSettings s = repository.findForTenant(tenantId).orElseGet(TenantMailSettings::new);
        String host = trim(r.host());
        String from = trim(r.fromAddress());
        boolean enabled = Boolean.TRUE.equals(r.enabled());
        if (enabled || host != null || s.getId() != null) {
            if (host == null || !host.matches("[A-Za-z0-9.-]+")) throw new BusinessException("Enter the mail server, e.g. smtp.gmail.com");
            if (r.port() == null) throw new BusinessException("Enter the port, e.g. 587");
            if (from == null) throw new BusinessException("Enter the address the e-mails come from");
        }
        String security = r.security() == null ? TenantMailSettings.STARTTLS : r.security().toUpperCase();
        if (!security.equals(TenantMailSettings.STARTTLS) && !security.equals(TenantMailSettings.SSL) && !security.equals(TenantMailSettings.NONE)) {
            throw new BusinessException("Security must be STARTTLS, SSL or NONE");
        }
        s.setTenantId(tenantId);
        s.setEnabled(enabled);
        s.setHost(host);
        s.setPort(r.port());
        s.setSecurity(security);
        s.setUsername(trim(r.username()));
        if (Boolean.TRUE.equals(r.clearPassword())) s.setPasswordEnc(null);
        else if (r.password() != null && !r.password().isBlank()) s.setPasswordEnc(encrypt(r.password()));
        if (enabled && s.getUsername() != null && s.getPasswordEnc() == null) {
            throw new BusinessException("Enter the password (for Gmail, an app password)");
        }
        s.setFromAddress(from);
        s.setFromName(trim(r.fromName()));
        s.setReplyTo(trim(r.replyTo()));
        s.setUpdatedBy(UserContext.username());
        s.setUpdatedAt(LocalDateTime.now());
        repository.save(s);
        activity.record("CHANGED", "Settings", "E-mail settings " + (enabled ? "switched on · " + host + " · " + from : "saved (off)"));
        return view();
    }

    /** Sends a test message through the household's saved settings and records how it went. */
    @Transactional
    public MailSettingsView test(TestRequest r) {
        TenantMailSettings s = repository.findForTenant(UserContext.tenantId())
                .orElseThrow(() -> new BusinessException("Save the e-mail settings first"));
        String to = trim(r.to()) != null ? trim(r.to()) : s.getFromAddress();
        try {
            JavaMailSender mail = build(s);
            MimeMessage message = mail.createMimeMessage();
            MimeMessageHelper helper = new MimeMessageHelper(message, false, "UTF-8");
            helper.setFrom(s.getFromAddress(), s.getFromName() != null ? s.getFromName() : UserContext.get().tenantName());
            helper.setTo(to);
            helper.setSubject("Test e-mail from Personal Budget");
            helper.setText("This is a test. If you can read it, " + UserContext.get().tenantName()
                    + " can e-mail chit reminders and receipts from " + s.getFromAddress() + ".", false);
            mail.send(message);
            s.setTestResult("OK · sent to " + to);
        } catch (Exception e) {
            s.setTestResult(ActivityService.cut("Failed · " + rootMessage(e), 255));
        }
        s.setTestedAt(LocalDateTime.now());
        repository.save(s);
        if (!s.getTestResult().startsWith("OK")) throw new BusinessException("The test e-mail did not go out: " + s.getTestResult().substring(9));
        return view();
    }

    /** Where the current household's e-mail goes out: its own account when switched on, else the installation's. */
    public Optional<Sender> sender() {
        TenantMailSettings s = repository.findForTenant(UserContext.tenantId()).orElse(null);
        if (s != null && Boolean.TRUE.equals(s.getEnabled()) && s.getHost() != null && s.getFromAddress() != null) {
            return Optional.of(new Sender(build(s), s.getFromAddress(), s.getFromName(), s.getReplyTo(), "HOUSEHOLD"));
        }
        JavaMailSender server = serverSender.getIfAvailable();
        String from = serverFrom();
        if (server != null && from != null) {
            return Optional.of(new Sender(server, from, null, env.getProperty("budget.mail.reply-to"), "SERVER"));
        }
        return Optional.empty();
    }

    // ---------------------------------------------------------------- helpers

    private JavaMailSender build(TenantMailSettings s) {
        JavaMailSenderImpl mail = new JavaMailSenderImpl();
        mail.setHost(s.getHost());
        mail.setPort(s.getPort());
        mail.setDefaultEncoding("UTF-8");
        Properties p = mail.getJavaMailProperties();
        if (s.getUsername() != null) {
            mail.setUsername(s.getUsername());
            mail.setPassword(s.getPasswordEnc() == null ? null : decrypt(s.getPasswordEnc()));
            p.put("mail.smtp.auth", "true");
        }
        if (TenantMailSettings.STARTTLS.equals(s.getSecurity())) {
            p.put("mail.smtp.starttls.enable", "true");
            p.put("mail.smtp.starttls.required", "true");
        } else if (TenantMailSettings.SSL.equals(s.getSecurity())) {
            p.put("mail.smtp.ssl.enable", "true");
        }
        p.put("mail.smtp.connectiontimeout", "10000");
        p.put("mail.smtp.timeout", "15000");
        p.put("mail.smtp.writetimeout", "15000");
        return mail;
    }

    private String serverFrom() {
        String from = env.getProperty("budget.mail.from");
        if (from == null || from.isBlank()) from = env.getProperty("spring.mail.username");
        return from == null || from.isBlank() || !from.contains("@") ? null : from.trim();
    }

    private String encrypt(String plain) {
        try {
            byte[] iv = new byte[12];
            random.nextBytes(iv);
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.ENCRYPT_MODE, new SecretKeySpec(settings.secretKey(KEY), "AES"), new GCMParameterSpec(128, iv));
            byte[] data = cipher.doFinal(plain.getBytes(StandardCharsets.UTF_8));
            byte[] all = new byte[iv.length + data.length];
            System.arraycopy(iv, 0, all, 0, iv.length);
            System.arraycopy(data, 0, all, iv.length, data.length);
            return Base64.getEncoder().encodeToString(all);
        } catch (java.security.GeneralSecurityException e) {
            throw new IllegalStateException(e);
        }
    }

    private String decrypt(String stored) {
        try {
            byte[] all = Base64.getDecoder().decode(stored);
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE, new SecretKeySpec(settings.secretKey(KEY), "AES"), new GCMParameterSpec(128, all, 0, 12));
            return new String(cipher.doFinal(all, 12, all.length - 12), StandardCharsets.UTF_8);
        } catch (java.security.GeneralSecurityException | IllegalArgumentException e) {
            throw new BusinessException("The saved e-mail password cannot be read any more; enter it again in Settings → E-mail");
        }
    }

    private static String trim(String s) {
        return s == null || s.isBlank() ? null : s.trim();
    }

    static String rootMessage(Throwable e) {
        Throwable t = e;
        while (t.getCause() != null && t.getCause() != t) t = t.getCause();
        return t.getMessage() != null ? t.getMessage() : t.getClass().getSimpleName();
    }
}
