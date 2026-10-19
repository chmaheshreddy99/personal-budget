package com.aditya.personalbudget.service;

import com.aditya.personalbudget.exception.BusinessException;
import com.aditya.personalbudget.security.CurrentUser;
import com.aditya.personalbudget.security.UserContext;
import com.aditya.personalbudget.service.HostedChitService.Detail;
import com.aditya.personalbudget.service.HostedChitService.MemberView;
import jakarta.mail.internet.MimeMessage;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import org.springframework.core.io.ByteArrayResource;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.mail.javamail.MimeMessageHelper;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.function.Function;
import java.util.stream.Collectors;

/**
 * E-mails hosted chit reminders and receipts to the members, all in one go. Works once e-mail is set up
 * ({@code spring.mail.host} and friends in application.yml); until then {@link #status()} says so and the app offers
 * WhatsApp instead. The page writes each message (with its link); receipts also carry the signed PDF.
 */
@Service
public class HostedChitMailService {

    private static final String AREA = "Host a Chit";
    private static final int MAX_BATCH = 100;

    /** source: HOUSEHOLD (Settings → E-mail) or SERVER (application.yml). */
    public record MailStatus(boolean configured, String from, String source) {
    }

    /** One message: to a member (their e-mail on record), optionally with a payment's receipt PDF attached. */
    public record SendItem(@NotNull Long memberId, Long paymentId, @NotBlank @Size(max = 200) String subject,
                           @NotBlank @Size(max = 5000) String body) {
    }

    /** kind: REMINDER or RECEIPT (for the activity log). */
    public record SendRequest(@Size(max = 20) String kind, @NotEmpty @Size(max = MAX_BATCH) List<@Valid SendItem> items) {
    }

    public record Failure(Long memberId, String name, String reason) {
    }

    public record SendResult(int sent, List<Failure> failed) {
    }

    private final TenantMailService accounts;
    private final HostedChitService service;
    private final HostedChitShareService shares;
    private final ActivityService activity;

    public HostedChitMailService(TenantMailService accounts, HostedChitService service, HostedChitShareService shares, ActivityService activity) {
        this.accounts = accounts;
        this.service = service;
        this.shares = shares;
        this.activity = activity;
    }

    public MailStatus status() {
        return accounts.sender().map(s -> new MailStatus(true, s.from(), s.source())).orElse(new MailStatus(false, null, null));
    }

    public SendResult send(Long chitId, SendRequest r) {
        TenantMailService.Sender account = accounts.sender()
                .orElseThrow(() -> new BusinessException("E-mail is not set up: add your e-mail account in Settings → E-mail"));
        JavaMailSender mail = account.mail();
        Detail d = service.detail(chitId);
        Map<Long, MemberView> members = d.members().stream().collect(Collectors.toMap(MemberView::id, Function.identity()));
        String household = UserContext.current().map(CurrentUser::tenantName).orElse("");
        String replyTo = account.replyTo();
        String fromName = account.fromName() != null ? account.fromName() : household.isBlank() ? d.chit().name() : household;
        int sent = 0;
        List<Failure> failed = new ArrayList<>();
        for (SendItem item : r.items()) {
            MemberView m = members.get(item.memberId());
            if (m == null) {
                failed.add(new Failure(item.memberId(), null, "Not a member of this chit"));
                continue;
            }
            if (m.email() == null || m.email().isBlank()) {
                failed.add(new Failure(m.id(), m.name(), "No e-mail address"));
                continue;
            }
            try {
                MimeMessage message = mail.createMimeMessage();
                MimeMessageHelper helper = new MimeMessageHelper(message, item.paymentId() != null, "UTF-8");
                helper.setFrom(account.from(), fromName);
                if (replyTo != null && !replyTo.isBlank()) helper.setReplyTo(replyTo);
                helper.setTo(m.email().trim());
                helper.setSubject(item.subject());
                helper.setText(item.body(), false);
                if (item.paymentId() != null) {
                    var receipt = shares.receipt(d, item.paymentId());
                    helper.addAttachment("Receipt " + receipt.receiptNo() + ".pdf",
                            new ByteArrayResource(ReceiptPdf.render(household, d.chit().name(), receipt)), "application/pdf");
                }
                mail.send(message);
                sent++;
            } catch (Exception e) {
                failed.add(new Failure(m.id(), m.name(), ActivityService.cut(rootMessage(e), 200)));
            }
        }
        String what = "RECEIPT".equalsIgnoreCase(r.kind()) ? "receipt" : "reminder";
        activity.record("SENT", AREA, "E-mailed " + sent + " " + what + (sent == 1 ? "" : "s") + " · " + d.chit().name()
                + (failed.isEmpty() ? "" : " · " + failed.size() + " not sent"));
        return new SendResult(sent, failed);
    }

    private static String rootMessage(Throwable e) {
        Throwable t = e;
        while (t.getCause() != null && t.getCause() != t) t = t.getCause();
        return t.getMessage() != null ? t.getMessage() : t.getClass().getSimpleName();
    }
}
