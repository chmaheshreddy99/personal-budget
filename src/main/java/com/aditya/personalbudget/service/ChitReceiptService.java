package com.aditya.personalbudget.service;

import com.aditya.personalbudget.domain.entity.Chit;
import com.aditya.personalbudget.domain.entity.ChitInstallment;
import com.aditya.personalbudget.domain.entity.ChitReceiptAck;
import com.aditya.personalbudget.domain.entity.Organization;
import com.aditya.personalbudget.domain.type.InstallmentStatus;
import com.aditya.personalbudget.dto.ChitDtos.ChitDetail;
import com.aditya.personalbudget.dto.ChitDtos.ChitView;
import com.aditya.personalbudget.exception.BusinessException;
import com.aditya.personalbudget.exception.NotFoundException;
import com.aditya.personalbudget.repository.ChitInstallmentRepository;
import com.aditya.personalbudget.repository.ChitReceiptAckRepository;
import com.aditya.personalbudget.repository.ChitRepository;
import com.aditya.personalbudget.repository.OrganizationRepository;
import com.aditya.personalbudget.security.UserContext;
import com.aditya.personalbudget.service.AttachmentService.AgreementFile;
import com.aditya.personalbudget.service.ClaimAgreementService.VerificationFailed;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.Size;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.security.SecureRandom;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Base64;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;

import static com.aditya.personalbudget.service.ClaimAgreementService.asTenant;
import static com.aditya.personalbudget.service.ClaimAgreementService.blank;
import static com.aditya.personalbudget.service.ClaimAgreementService.linkUser;

/**
 * Acknowledgements of receipt for chit installments you paid (see {@link ChitReceiptAck}).
 * <p>
 * <b>Asking.</b> From a chit you pick one or several installments already paid and send one link to the organizer.
 * The figures come from the paid installments; the wording is generated and, with the figures, fixed by a SHA-256
 * fingerprint. A paid installment can be in only one acknowledged record; asking again for installments with an open
 * request replaces it (the older link stops working).
 * <p>
 * <b>Answering.</b> The link is secret (only a hash is kept), expires, and opens only with the organizer's mobile number
 * (five wrong numbers lock it). The organizer reads what they are acknowledging and either signs it or says what is
 * wrong. A signed record keeps the name, mobile number, drawn signature, selfie (if asked), time, IP address, device
 * and location (if allowed), sealed together and digitally signed by this installation. It cannot be changed or
 * deleted, and its installments cannot be undone ({@link #refuseIfAcknowledged}).
 */
@Service
public class ChitReceiptService {

    public static final String FILES = "CHIT_RECEIPT";
    /** The evidence documents on disk (see {@link EvidenceVault}). */
    static final String VAULT = "chit-receipts";
    private static final String AREA = "Chits";
    public static final int MAX_LINK_HOURS = 24 * 30;
    public static final int DEFAULT_LINK_HOURS = 72;
    static final int MAX_ATTEMPTS = 5;
    /** Installments in one acknowledgement (the lines must fit the record). */
    public static final int MAX_INSTALLMENTS = 40;
    /** Installments a payout receipt restates (they are listed in it). */
    public static final int MAX_PAYOUT_INSTALLMENTS = 150;
    private static final DateTimeFormatter DAY = DateTimeFormatter.ofPattern("dd MMM yyyy");

    // ================================================================== requests

    public record CreateRequest(@NotEmpty List<Long> installmentIds, @Size(max = 100) String organizerName,
                                @NotBlank @Size(max = 20) String organizerPhone, Boolean rememberPhone,
                                @NotBlank @Size(max = 100) String payerName, @Size(max = 200) String paymentNote,
                                @Min(1) @Max(MAX_LINK_HOURS) Integer hours, Boolean requireSelfie, Boolean requireLocation, Boolean simple) {

        public CreateRequest(List<Long> installmentIds, String organizerName, String organizerPhone, Boolean rememberPhone, String payerName,
                             String paymentNote, Integer hours, Boolean requireSelfie, Boolean requireLocation) {
            this(installmentIds, organizerName, organizerPhone, rememberPhone, payerName, paymentNote, hours, requireSelfie, requireLocation, null);
        }
    }

    /** The receipt for the payout received in full; the installments and earlier acknowledgements come from the chit. */
    public record PayoutRequest(@Size(max = 100) String organizerName, @NotBlank @Size(max = 20) String organizerPhone, Boolean rememberPhone,
                                @NotBlank @Size(max = 100) String payerName, @Size(max = 20000) String payerSignature,
                                @Size(max = 200) String paymentNote, @Min(1) @Max(MAX_LINK_HOURS) Integer hours,
                                Boolean requireSelfie, Boolean requireLocation) {
    }

    /** Withdraws a signed record (kept, marked cancelled). */
    public record CancelRequest(@NotBlank @Size(min = 3, max = 300) String reason) {
    }

    /** The organizer signed a printed copy: who signed and the day, recorded by the payer. */
    public record PaperRequest(@Size(max = 100) String name, LocalDate signedOn) {
    }

    public record RenewRequest(@Min(1) @Max(MAX_LINK_HOURS) int hours) {
    }

    public record OpenRequest(@Size(max = 20) String phone) {
    }

    public record AckRequest(@Size(max = 20) String phone, @Size(min = 2, max = 100) String name, Boolean agree,
                             @Size(max = 20000) String signature, @Size(max = 100) String location,
                             @Size(max = 2000) String device) {
    }

    public record DisputeRequest(@Size(max = 20) String phone, @Size(min = 3, max = 500) String reason) {
    }

    // ================================================================== views

    /** One paid installment of an acknowledgement. */
    public record Line(int no, LocalDate dueDate, LocalDate paidDate, BigDecimal dueAmount, BigDecimal dividend, BigDecimal cash,
                       /* the account it was paid from, the payment's reference (UTR, cheque no.) and the journal entry: on requests made from now on */
                       String paidFrom, String reference, String entryNo) {

        public Line(int no, LocalDate dueDate, LocalDate paidDate, BigDecimal dueAmount, BigDecimal dividend, BigDecimal cash) {
            this(no, dueDate, paidDate, dueAmount, dividend, cash, null, null, null);
        }
    }

    /** What the payer sees: the request, its link, and the evidence once answered. */
    public record AckView(Long id, Long chitId, String ackNo, String status, String payerName, String organizerName,
                          String organizerPhone, String chitName, String ticketNo, List<Line> lines, BigDecimal totalAmount,
                          String amountInWords, String paymentNote, String terms, String contentHash, boolean requireSelfie,
                          boolean requireLocation,
                          /* NONE, ACTIVE, EXPIRED, REVOKED or LOCKED */
                          String link, LocalDateTime linkExpiresAt, int views, LocalDateTime lastViewedAt, int failedAttempts,
                          LocalDateTime lockedAt, String acknowledgedName, LocalDateTime acknowledgedAt, String acknowledgedPhone,
                          String acknowledgedIp, String acknowledgedUserAgent, String acknowledgedDevice, String deviceHash,
                          String acknowledgedLocation, String signature, String acknowledgementSeal, String evidencePayload,
                          String digitalSignature, String publicKey, String keyFingerprint, String disputeReason,
                          LocalDateTime disputedAt, List<AgreementFile> files, String createdBy, LocalDateTime createdAt,
                          String kind, List<Line> installLines, List<String> supersedes, String payerSignature, String cancelReason,
                          LocalDateTime cancelledAt, String cancelledBy, String supersededBy,
                          /* the installments it stands for (also in a list, where the documents are not read) */
                          List<Integer> installmentNos, int installCount) {
    }

    public record CreatedLink(AckView receipt, String token) {
    }

    /**
     * What the organizer sees. step VERIFY: only who it is from and a hint of the number to type (error: why the number
     * was not accepted); OPEN: the receipt to sign; DONE: acknowledged; DISPUTED: they said it is wrong.
     */
    public record PublicAck(String step, String error, Integer attemptsLeft, String household, String payerName,
                            String organizerHint, String phoneHint, String ackNo, LocalDateTime expiresAt,
                            // ---- once the number is verified
                            String organizerName, String chitName, String ticketNo, List<Line> lines, BigDecimal totalAmount,
                            String amountInWords, String paymentNote, String terms, String contentHash, String currency,
                            boolean requireSelfie, boolean requireLocation, boolean hasSelfie, String status,
                            String acknowledgedName, LocalDateTime acknowledgedAt, String signature, String acknowledgementSeal,
                            boolean locationShared, String evidencePayload, String digitalSignature, String publicKey,
                            String keyFingerprint, String disputeReason, LocalDateTime disputedAt, LocalDateTime createdAt,
                            String kind, List<Line> installLines, List<String> supersedes, String payerSignature) {
    }

    private final ChitReceiptAckRepository acks;
    private final ChitRepository chits;
    private final ChitInstallmentRepository installments;
    private final ChitService chitService;
    private final EvidenceVault vault;
    private final AttachmentService files;
    private final AppSettingsService settings;
    private final OrganizationRepository tenants;
    private final ActivityService activity;
    private final SecureRandom random = new SecureRandom();

    private final com.aditya.personalbudget.repository.JournalEntryRepository entries;
    private final com.aditya.personalbudget.repository.AccountRepository accounts;

    public ChitReceiptService(ChitReceiptAckRepository acks, ChitRepository chits, ChitInstallmentRepository installments,
                              ChitService chitService, EvidenceVault vault, AttachmentService files, AppSettingsService settings, OrganizationRepository tenants,
                              ActivityService activity, com.aditya.personalbudget.repository.JournalEntryRepository entries,
                              com.aditya.personalbudget.repository.AccountRepository accounts) {
        this.entries = entries;
        this.accounts = accounts;
        this.acks = acks;
        this.chits = chits;
        this.installments = installments;
        this.chitService = chitService;
        this.vault = vault;
        this.files = files;
        this.settings = settings;
        this.tenants = tenants;
        this.activity = activity;
    }

    // ================================================================== the payer's side

    /** Every request of the chit, newest first. */
    public List<AckView> list(Long chitId) {
        chit(chitId);
        Map<Long, Integer> nos = new java.util.HashMap<>();
        installments.findByChitIdOrderByInstallmentNo(chitId).forEach(i -> nos.put(i.getId(), i.getInstallmentNo()));
        return acks.findByChitId(chitId).stream().filter(a -> a.getTenantId().equals(UserContext.tenantId()))
                .sorted(Comparator.comparing(ChitReceiptAck::getId).reversed()).map(a -> view(a, nos, false)).toList();
    }

    /** One record in full: its document (wording, signatures, the signed text) is read from disk now. */
    public AckView get(Long chitId, Long ackId) {
        return view(require(chitId, ackId));
    }

    /** Asks the organizer to acknowledge the picked paid installments: the wording is fixed and a link made. */
    @Transactional
    public CreatedLink create(Long chitId, CreateRequest r) {
        Chit chit = chit(chitId);
        String phone = phone(r.organizerPhone());
        Set<Long> ids = new LinkedHashSet<>(r.installmentIds());
        if (ids.size() > MAX_INSTALLMENTS) {
            throw new BusinessException("Send at most " + MAX_INSTALLMENTS + " installments in one acknowledgement");
        }
        List<ChitInstallment> picked = new ArrayList<>();
        for (Long id : ids) {
            ChitInstallment i = installments.findByIdAndTenantId(id, chit.getTenantId()).filter(x -> x.getChitId().equals(chitId))
                    .orElseThrow(() -> new NotFoundException("Chit installment", id));
            if (i.getStatus() != InstallmentStatus.PAID || i.getPaidAmount() == null || i.getPaidDate() == null) {
                throw new BusinessException("Installment " + i.getInstallmentNo() + " is not paid yet: only payments already made can be acknowledged");
            }
            picked.add(i);
        }
        picked.sort(Comparator.comparing(ChitInstallment::getInstallmentNo));

        List<ChitReceiptAck> all = acks.findByChitId(chitId);
        String done = picked.stream().filter(i -> all.stream().anyMatch(a -> isFinal(a) && has(a, i.getId())))
                .map(i -> String.valueOf(i.getInstallmentNo())).collect(Collectors.joining(", "));
        if (!done.isEmpty()) {
            throw new BusinessException("Installment " + done + " already " + (done.contains(",") ? "have" : "has") + " an acknowledgement: it is kept as the record");
        }
        // a newer request for the same installments replaces an open one
        for (ChitReceiptAck old : all) {
            if (ChitReceiptAck.PENDING.equals(old.getStatus()) && !isPayout(old) && picked.stream().anyMatch(i -> has(old, i.getId()))) {
                stop(old);
            }
        }

        String organizer = blank(r.organizerName()) != null ? blank(r.organizerName()) : chit.getOrganizer();
        if (organizer == null || organizer.isBlank()) {
            throw new BusinessException("Enter the organizer's name");
        }
        if (Boolean.TRUE.equals(r.rememberPhone()) && !phone.equals(chit.getOrganizerPhone())) {
            chit.setOrganizerPhone(phone);
            chits.save(chit);
        }
        // each payment carries its own reference (a UTR or cheque no. typed with the payment), nothing of this app's books: the names of
        // our accounts and our entry numbers mean nothing to the organizer and have no standing in the receipt
        List<Line> lines = picked.stream().map(i -> {
            var entry = i.getJournalEntryId() == null ? null : entries.findById(i.getJournalEntryId()).orElse(null);
            return new Line(i.getInstallmentNo(), i.getDueDate(), i.getPaidDate(), i.getDueAmount(), i.getDividend() == null ? BigDecimal.ZERO : i.getDividend(), i.getPaidAmount(),
                    null, plain(entry == null ? null : entry.getReference()), null);
        }).toList();
        BigDecimal total = lines.stream().map(Line::cash).reduce(BigDecimal.ZERO, BigDecimal::add);

        ChitReceiptAck a = new ChitReceiptAck();
        a.setTenantId(UserContext.tenantId());
        a.setChitId(chitId);
        a.setAckNo("CR-pending");
        a.setPayerName(r.payerName().trim());
        a.setOrganizerName(organizer.trim());
        a.setOrganizerPhone(phone);
        a.setChitName(chit.getName());
        a.setTicketNo(blank(chit.getTicketNo()));
        a.setInstallmentIds(picked.stream().map(i -> String.valueOf(i.getId())).collect(Collectors.joining(",")));
        boolean simple = Boolean.TRUE.equals(r.simple());
        a.setKind(simple ? ChitReceiptAck.KIND_SIMPLE : ChitReceiptAck.KIND_INSTALLMENTS);
        a.setLines(encode(lines));
        a.setTotalAmount(total);
        a.setPaymentNote(blank(r.paymentNote()));
        a.setRequireSelfie(Boolean.TRUE.equals(r.requireSelfie()));
        a.setRequireLocation(Boolean.TRUE.equals(r.requireLocation()));
        a.setStatus(ChitReceiptAck.PENDING);
        a.setViews(0);
        a.setFailedAttempts(0);
        a.setCreatedBy(UserContext.username());
        a.setCreatedAt(OrgClock.now().withNano(0));
        a.setTerms("pending");
        a.setContentHash("pending");
        a = acks.save(a);
        a.setAckNo(String.format("CR-%06d", a.getId()));
        a.setTerms(simple ? simpleTerms(a, lines) : terms(a, chit, lines));
        a.setContentHash(fingerprint(a));
        String token = newLink(a, r.hours() == null ? DEFAULT_LINK_HOURS : r.hours());
        keep(a);
        activity.record("ADDED", AREA, "Asked " + a.getOrganizerName() + " to acknowledge " + lines.size() + " installment"
                + (lines.size() == 1 ? "" : "s") + " of " + a.getChitName() + " · " + ActivityService.money(total) + " · " + a.getAckNo());
        return new CreatedLink(view(a), token);
    }

    /** A new secret link for a request still waiting (an older link stops working). */
    @Transactional
    public CreatedLink renew(Long chitId, Long ackId, RenewRequest r) {
        ChitReceiptAck a = require(chitId, ackId);
        if (!ChitReceiptAck.PENDING.equals(a.getStatus()) && !ChitReceiptAck.REVOKED.equals(a.getStatus())) {
            throw new BusinessException(a.getAckNo() + " is already " + a.getStatus().toLowerCase() + ": ask again from the installments instead");
        }
        for (ChitReceiptAck other : acks.findByChitId(chitId)) {
            if (!other.getId().equals(a.getId()) && isFinal(other)
                    && java.util.Arrays.stream(a.getInstallmentIds().split(",")).anyMatch(id -> has(other, Long.valueOf(id)))) {
                throw new BusinessException("Some of these installments were acknowledged meanwhile (" + other.getAckNo() + ")");
            }
        }
        a.setStatus(ChitReceiptAck.PENDING);
        String token = newLink(a, r.hours());
        acks.save(a);
        activity.record("ADDED", AREA, "Sent " + a.getAckNo() + " again to " + a.getOrganizerName() + " · new link");
        return new CreatedLink(view(a), token);
    }


    /**
     * The receipt for the payout received in full: the organizer confirms that the whole payout was paid and received, that
     * nothing more is due for it, and that the earlier acknowledgements are cancelled and replaced by this one (which
     * restates the installments). The earlier ones are cancelled when this one is signed, and kept.
     */
    @Transactional
    public CreatedLink createPayout(Long chitId, PayoutRequest r) {
        Chit chit = chit(chitId);
        String phone = phone(r.organizerPhone());
        if (chit.getPayoutAmount() == null) {
            throw new BusinessException("Record the payout first: this receipt confirms that it was received");
        }
        ChitDetail detail = chitService.detail(chitId);
        ChitView cv = detail.chit();
        if (cv.payoutPending() != null && cv.payoutPending().signum() > 0) {
            throw new BusinessException(ActivityService.money(cv.payoutPending()) + " of the payout is still to come from the organizer: record it, then ask for the receipt");
        }
        List<ChitReceiptAck> all = acks.findByChitId(chitId);
        for (ChitReceiptAck old : all) {
            if (!isPayout(old)) continue;
            if (isFinal(old)) {
                throw new BusinessException("The payout already has a signed receipt (" + old.getAckNo() + "). Withdraw it first to send a new one");
            }
            if (ChitReceiptAck.PENDING.equals(old.getStatus())) stop(old);
        }
        List<Line> parts = new ArrayList<>();
        var received = new ArrayList<>(detail.payoutReceipts());
        received.sort(Comparator.comparing(x -> x.date()));
        for (var x : received) {
            parts.add(new Line(parts.size() + 1, x.date(), x.date(), x.amount(), BigDecimal.ZERO, x.amount()));
        }
        BigDecimal total = parts.stream().map(Line::cash).reduce(BigDecimal.ZERO, BigDecimal::add);
        if (parts.isEmpty() || total.compareTo(chit.getPayoutAmount()) != 0) {
            throw new BusinessException("The payout receipts recorded (" + ActivityService.money(total) + ") do not add up to the payout ("
                    + ActivityService.money(chit.getPayoutAmount()) + "): check them in the Payout tab first");
        }
        List<ChitInstallment> schedule = installments.findByChitIdOrderByInstallmentNo(chitId);
        List<ChitInstallment> paid = schedule.stream()
                .filter(i -> i.getStatus() == InstallmentStatus.PAID && i.getPaidAmount() != null && i.getPaidDate() != null).toList();
        if (paid.size() > MAX_PAYOUT_INSTALLMENTS) {
            throw new BusinessException("The chit has " + paid.size() + " paid installments: a receipt can restate at most " + MAX_PAYOUT_INSTALLMENTS);
        }
        List<Line> paidLines = paid.stream().map(i -> new Line(i.getInstallmentNo(), i.getDueDate(), i.getPaidDate(), i.getDueAmount(),
                i.getDividend() == null ? BigDecimal.ZERO : i.getDividend(), i.getPaidAmount())).toList();
        List<ChitReceiptAck> earlier = all.stream().filter(x -> !isPayout(x) && (isFinal(x) || ChitReceiptAck.PENDING.equals(x.getStatus())))
                .sorted(Comparator.comparing(ChitReceiptAck::getId)).toList();
        String organizer = blank(r.organizerName()) != null ? blank(r.organizerName()) : chit.getOrganizer();
        if (organizer == null || organizer.isBlank()) {
            throw new BusinessException("Enter the organizer's name");
        }
        if (Boolean.TRUE.equals(r.rememberPhone()) && !phone.equals(chit.getOrganizerPhone())) {
            chit.setOrganizerPhone(phone);
            chits.save(chit);
        }
        String signature = blank(r.payerSignature()) == null ? null : HostedChitService.drawn(r.payerSignature(), "your signature");

        ChitReceiptAck a = new ChitReceiptAck();
        a.setTenantId(UserContext.tenantId());
        a.setChitId(chitId);
        a.setAckNo("CR-pending");
        a.setKind(ChitReceiptAck.KIND_PAYOUT);
        a.setPayerName(r.payerName().trim());
        a.setPayerSignature(signature);
        a.setOrganizerName(organizer.trim());
        a.setOrganizerPhone(phone);
        a.setChitName(chit.getName());
        a.setTicketNo(blank(chit.getTicketNo()));
        a.setInstallmentIds(paid.stream().map(i -> String.valueOf(i.getId())).collect(Collectors.joining(",")));
        a.setLines(encode(parts));
        a.setInstallLines(encode(paidLines));
        a.setSupersedes(earlier.stream().map(x -> String.valueOf(x.getId())).collect(Collectors.joining(",")));
        a.setTotalAmount(total);
        a.setPaymentNote(blank(r.paymentNote()));
        a.setRequireSelfie(Boolean.TRUE.equals(r.requireSelfie()));
        a.setRequireLocation(Boolean.TRUE.equals(r.requireLocation()));
        a.setStatus(ChitReceiptAck.PENDING);
        a.setViews(0);
        a.setFailedAttempts(0);
        a.setCreatedBy(UserContext.username());
        a.setCreatedAt(OrgClock.now().withNano(0));
        a.setTerms("pending");
        a.setContentHash("pending");
        a = acks.save(a);
        a.setPayerSignature(signature);                  // the saved copy keeps only what the table holds
        a.setInstallLines(encode(paidLines));
        a.setAckNo(String.format("CR-%06d", a.getId()));
        BigDecimal unpaid = schedule.stream().filter(i -> i.getStatus() != InstallmentStatus.PAID)
                .map(ChitInstallment::getDueAmount).reduce(BigDecimal.ZERO, BigDecimal::add);
        a.setTerms(payoutTerms(a, chit, parts, paidLines, earlier.stream().filter(ChitReceiptService::isFinal).toList(),
                chit.getNumberOfInstallments() - paid.size(), unpaid));
        a.setContentHash(fingerprint(a));
        String token = newLink(a, r.hours() == null ? DEFAULT_LINK_HOURS : r.hours());
        keep(a);
        activity.record("ADDED", AREA, "Asked " + a.getOrganizerName() + " to acknowledge the payout of " + a.getChitName() + " received in full · "
                + ActivityService.money(total) + " · " + a.getAckNo() + (earlier.isEmpty() ? "" : " · replaces " + earlier.size() + " earlier acknowledgement"
                + (earlier.size() == 1 ? "" : "s")));
        return new CreatedLink(view(a), token);
    }

    /**
     * Withdraws a signed record, with the reason: it is marked cancelled and kept (with all its evidence), its installments
     * are free to be acknowledged again, and it can be sent afresh.
     */
    @Transactional
    public AckView cancel(Long chitId, Long ackId, CancelRequest r) {
        ChitReceiptAck a = require(chitId, ackId);
        if (!isFinal(a)) {
            throw new BusinessException(a.getAckNo() + " was not signed: remove it instead");
        }
        a.setStatus(ChitReceiptAck.CANCELLED);
        a.setCancelReason(r.reason().trim());
        a.setCancelledAt(OrgClock.now().withNano(0));
        a.setCancelledBy(UserContext.username());
        a.setLinkRevokedAt(a.getCancelledAt());
        acks.save(a);
        activity.record("CANCELLED", AREA, "Withdrew " + a.getAckNo() + " · " + a.getOrganizerName() + " · " + a.getCancelReason());
        return view(a);
    }

    /** The organizer signed a printed copy (stamp paper or plain, with a revenue stamp): recorded by the payer. */
    @Transactional
    public AckView signedOnPaper(Long chitId, Long ackId, PaperRequest r) {
        ChitReceiptAck a = require(chitId, ackId);
        if (isFinal(a)) {
            throw new BusinessException(a.getAckNo() + " is already signed");
        }
        if (ChitReceiptAck.CANCELLED.equals(a.getStatus())) {
            throw new BusinessException(a.getAckNo() + " was withdrawn");
        }
        LocalDate today = OrgClock.now().toLocalDate();
        LocalDate signedOn = r.signedOn() == null ? today : r.signedOn();
        if (signedOn.isAfter(today)) {
            throw new BusinessException("The day it was signed cannot be in the future");
        }
        if (signedOn.isBefore(a.getCreatedAt().toLocalDate())) {
            throw new BusinessException("It cannot be signed before it was made (" + a.getCreatedAt().toLocalDate().format(DAY) + ")");
        }
        String name = blank(r.name()) == null ? a.getOrganizerName() : r.name().trim().replaceAll("\\s+", " ");
        LocalDateTime now = OrgClock.now().withNano(0);
        List<AgreementFile> scans = files.listForAgreement(FILES, a.getId()).stream().filter(f -> "SIGNED_COPY".equals(f.docType())).toList();
        a.setStatus(ChitReceiptAck.SIGNED);
        a.setAcknowledgedName(ActivityService.cut(name, 100));
        a.setAcknowledgedAt(signedOn.atStartOfDay());
        a.setLinkRevokedAt(now);
        String fileHashes = scans.stream().map(AgreementFile::sha256).collect(Collectors.joining(","));
        a.setAcknowledgementSeal(HostedChitService.sha256(String.join("|", a.getContentHash(), "PAPER", name, signedOn.toString(), UserContext.username(),
                now.toString(), fileHashes)));
        Map<String, Object> ev = new LinkedHashMap<>();
        ev.put("v", 1);
        ev.put("kind", isPayout(a) ? "CHIT_PAYOUT_SIGNED_ON_PAPER" : "CHIT_RECEIPT_SIGNED_ON_PAPER");
        ev.put("ackNo", a.getAckNo());
        ev.put("contentHash", a.getContentHash());
        ev.put("chit", a.getChitName());
        ev.put("payer", a.getPayerName());
        ev.put("organizer", a.getOrganizerName());
        ev.put("amount", a.getTotalAmount());
        ev.put("signedBy", name);
        ev.put("signedOn", signedOn.toString());
        ev.put("recordedBy", UserContext.username());
        ev.put("recordedAt", now.toString());
        ev.put("scans", scans.stream().map(AgreementFile::sha256).toList());
        ev.put("seal", a.getAcknowledgementSeal());
        a.setEvidencePayload(Kyc.json(ev));
        a.setDigitalSignature(settings.signPayLink(a.getEvidencePayload()));
        keep(a);
        if (isPayout(a)) cancelSuperseded(a);
        activity.record("ACKNOWLEDGED", AREA, a.getChitName() + ": " + name + " signed " + a.getAckNo() + " on paper · " + ActivityService.money(a.getTotalAmount())
                + (scans.isEmpty() ? " · no scan attached" : ""));
        return view(a);
    }

    /** A scan or photo of the signed paper copy. */
    @Transactional
    public AckView addScan(Long chitId, Long ackId, String name, byte[] bytes) {
        ChitReceiptAck a = require(chitId, ackId);
        if (ChitReceiptAck.CANCELLED.equals(a.getStatus()) || ChitReceiptAck.ACKNOWLEDGED.equals(a.getStatus())) {
            throw new BusinessException("A scan can only go with a record signed on paper");
        }
        files.addToAgreement(FILES, a.getId(), "SIGNED_COPY", name, bytes, "UPLOAD", "receipt " + a.getAckNo());
        activity.record("ADDED", AREA, "Added the scan of the signed copy to " + a.getAckNo());
        return view(a);
    }

    @Transactional
    public AckView revoke(Long chitId, Long ackId) {
        ChitReceiptAck a = require(chitId, ackId);
        if (ChitReceiptAck.PENDING.equals(a.getStatus())) {
            stop(a);
            activity.record("REVOKED", AREA, "Stopped the link of " + a.getAckNo() + " · " + a.getOrganizerName());
        }
        return view(a);
    }

    /** Only a request that was never answered with a signature can go; a signed one is the record. */
    @Transactional
    public void delete(Long chitId, Long ackId) {
        ChitReceiptAck a = require(chitId, ackId);
        if (isFinal(a)) {
            throw new BusinessException(a.getAckNo() + " was signed: it is kept as the record. Withdraw it instead (it is then marked cancelled and kept)");
        }
        if (ChitReceiptAck.CANCELLED.equals(a.getStatus())) {
            throw new BusinessException(a.getAckNo() + " was withdrawn: withdrawn records are kept");
        }
        files.deleteAllForAgreement(FILES, a.getId());
        vault.delete(VAULT, a.getTenantId(), a.getId());
        acks.deleteById(a.getId());
        activity.record("DELETED", AREA, "Removed " + a.getAckNo() + " · " + a.getOrganizerName());
    }

    public AttachmentService.FileContent file(Long chitId, Long ackId, Long fileId, boolean thumb) {
        return files.agreementFileContent(FILES, require(chitId, ackId).getId(), fileId, thumb);
    }

    /**
     * Called when an installment is about to be undone: an acknowledged one stays (the record says it was paid), an
     * open request for it is stopped.
     */
    static void refuseIfAcknowledged(ChitReceiptAckRepository acks, Long chitId, ChitInstallment installment) {
        for (ChitReceiptAck a : acks.findByChitId(chitId)) {
            if (!has(a, installment.getId())) continue;
            if (isFinal(a)) {
                throw new BusinessException("Installment " + installment.getInstallmentNo() + " was acknowledged by " + a.getAcknowledgedName()
                        + " on " + OrgClock.toOrg(a.getAcknowledgedAt()).format(DAY) + " (" + a.getAckNo() + "): it cannot be undone. Withdraw the acknowledgement first");
            }
            if (ChitReceiptAck.PENDING.equals(a.getStatus())) {
                a.setStatus(ChitReceiptAck.REVOKED);
                a.setLinkRevokedAt(OrgClock.now());
                acks.save(a);
            }
        }
    }

    /** Called when the payout is about to be undone: a signed payout receipt stays, an open one is stopped. */
    static void refusePayoutUndo(ChitReceiptAckRepository acks, Long chitId) {
        for (ChitReceiptAck a : acks.findByChitId(chitId)) {
            if (!isPayout(a)) continue;
            if (isFinal(a)) {
                throw new BusinessException("The payout was acknowledged by " + a.getAcknowledgedName() + " (" + a.getAckNo()
                        + "): it cannot be undone. Withdraw that receipt first");
            }
            if (ChitReceiptAck.PENDING.equals(a.getStatus())) {
                a.setStatus(ChitReceiptAck.REVOKED);
                a.setLinkRevokedAt(OrgClock.now());
                acks.save(a);
            }
        }
    }

    /** A mobile number as 10 digits, or null when empty; refuses anything else. */
    public static String phoneOrNull(String typed) {
        return typed == null || typed.isBlank() ? null : phone(typed);
    }

    // ================================================================== the organizer's side (no sign-in)

    /** Opens the link: without the right mobile number only who it is from and a hint. */
    @Transactional(noRollbackFor = VerificationFailed.class)
    public PublicAck open(String token, OpenRequest r) {
        ChitReceiptAck a = active(token);
        Organization tenant = tenant(a);
        a.setViews((a.getViews() == null ? 0 : a.getViews()) + 1);
        a.setLastViewedAt(OrgClock.now());
        acks.save(a);
        String phone = r == null ? null : blank(r.phone());
        if (phone == null) {
            return gate(a, tenant, null);
        }
        try {
            verify(a, phone);
        } catch (VerificationFailed e) {
            return gate(a, tenant, e.getMessage());
        }
        return asTenant(tenant, () -> full(a, tenant));
    }

    /** The organizer's selfie, when the payer asked for one. */
    @Transactional(noRollbackFor = VerificationFailed.class)
    public PublicAck addSelfie(String token, String phone, String name, byte[] bytes) {
        ChitReceiptAck a = active(token);
        verify(a, phone);
        requirePending(a);
        Organization tenant = tenant(a);
        return asTenant(tenant, () -> {
            files.addToAgreement(FILES, a.getId(), "SELFIE", name, bytes, "CAMERA", "receipt " + a.getAckNo());
            activity.record(linkUser(tenant, a.getOrganizerName()), "ADDED", AREA, a.getOrganizerName() + " added a selfie to " + a.getAckNo(),
                    "POST", "/public/chit-receipts");
            return full(a, tenant);
        });
    }

    /** The organizer acknowledges: the evidence is checked, sealed and digitally signed. */
    @Transactional(noRollbackFor = VerificationFailed.class)
    public PublicAck acknowledge(String token, AckRequest r, String ip, String userAgent) {
        ChitReceiptAck a = active(token);
        String phone = verify(a, r.phone());
        requirePending(a);
        load(a);
        if (!Boolean.TRUE.equals(r.agree())) {
            throw new BusinessException("Tick the box to confirm you have received these payments");
        }
        String name = r.name() == null ? "" : r.name().trim().replaceAll("\\s+", " ");
        if (name.length() < 2) {
            throw new BusinessException("Type your full name");
        }
        String signature = HostedChitService.drawn(r.signature(), "your signature with your finger");
        Organization tenant = tenant(a);
        List<AgreementFile> selfies = asTenant(tenant, () -> files.listForAgreement(FILES, a.getId()));
        if (Boolean.TRUE.equals(a.getRequireSelfie()) && selfies.stream().noneMatch(f -> "SELFIE".equals(f.docType()))) {
            throw new BusinessException("Take a selfie with your phone's front camera");
        }
        String location = r.location() == null || r.location().isBlank() ? null : r.location().trim();
        if (location != null && !location.matches("-?\\d{1,3}(\\.\\d+)?,-?\\d{1,3}(\\.\\d+)?(,\\d+(\\.\\d+)?)?")) {
            location = null;
        }
        if (Boolean.TRUE.equals(a.getRequireLocation()) && location == null) {
            throw new BusinessException("Allow your location when your phone asks: " + a.getPayerName() + " needs it with the acknowledgement");
        }
        String device = r.device() == null ? null : ActivityService.cut(r.device(), 2000);
        LocalDateTime now = OrgClock.now().withNano(0);
        a.setStatus(ChitReceiptAck.ACKNOWLEDGED);
        a.setAcknowledgedName(ActivityService.cut(name, 100));
        a.setAcknowledgedAt(now);
        a.setAcknowledgedPhone(phone);
        a.setAcknowledgedIp(ActivityService.cut(ip, 64));
        a.setAcknowledgedUserAgent(userAgent == null ? null : ActivityService.cut(userAgent, 255));
        a.setAcknowledgedDevice(device);
        a.setDeviceHash(device == null ? null : HostedChitService.sha256(device));
        a.setAcknowledgedLocation(location);
        a.setSignature(signature);
        String fileHashes = selfies.stream().map(f -> f.docType() + ":" + f.sha256()).collect(Collectors.joining(","));
        a.setAcknowledgementSeal(HostedChitService.sha256(String.join("|", a.getContentHash(), name, phone, now.toString(), String.valueOf(ip),
                String.valueOf(userAgent), String.valueOf(a.getDeviceHash()), String.valueOf(location), HostedChitService.sha256(signature),
                fileHashes)));
        Map<String, Object> ev = new LinkedHashMap<>();
        ev.put("v", 1);
        ev.put("kind", isPayout(a) ? "CHIT_PAYOUT_ACKNOWLEDGEMENT" : "CHIT_RECEIPT_ACKNOWLEDGEMENT");
        ev.put("ackNo", a.getAckNo());
        ev.put("contentHash", a.getContentHash());
        ev.put("chit", a.getChitName());
        ev.put("ticketNo", a.getTicketNo());
        ev.put("payer", a.getPayerName());
        ev.put("organizer", a.getOrganizerName());
        ev.put("amount", a.getTotalAmount());
        if (isPayout(a)) {
            ev.put("installmentCount", decode(a.getInstallLines()).size());
            ev.put("supersedes", String.join(",", supersededNos(a)));
        } else {
            ev.put("installments", decode(a.getLines()).stream().map(l -> String.valueOf(l.no())).collect(Collectors.joining(",")));
        }
        ev.put("acknowledgedName", name);
        ev.put("phoneLast4", phone.substring(6));
        ev.put("acknowledgedAt", now.toString());
        ev.put("ip", ip);
        ev.put("userAgentHash", userAgent == null ? null : HostedChitService.sha256(userAgent));
        ev.put("deviceHash", a.getDeviceHash());
        ev.put("location", location);
        ev.put("signatureHash", HostedChitService.sha256(signature));
        ev.put("files", selfies.stream().map(f -> {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("type", f.docType());
            m.put("sha256", f.sha256());
            m.put("at", f.createdAt() == null ? null : f.createdAt().withNano(0).toString());
            return m;
        }).toList());
        ev.put("seal", a.getAcknowledgementSeal());
        a.setEvidencePayload(Kyc.json(ev));
        if (a.getEvidencePayload().length() > 4000) {
            throw new BusinessException("The record is too long to seal; send fewer installments at once");
        }
        a.setDigitalSignature(settings.signPayLink(a.getEvidencePayload()));
        keep(a);
        if (isPayout(a)) cancelSuperseded(a);
        return asTenant(tenant, () -> {
            activity.record(linkUser(tenant, name), "ACKNOWLEDGED", AREA, a.getChitName() + ": " + name + " acknowledged receipt of "
                    + ActivityService.money(a.getTotalAmount()) + " · " + a.getAckNo(), "POST", "/public/chit-receipts");
            return full(a, tenant);
        });
    }

    /** The organizer says something is wrong instead of signing: kept with the time and IP, the link closes. */
    @Transactional(noRollbackFor = VerificationFailed.class)
    public PublicAck dispute(String token, DisputeRequest r, String ip) {
        ChitReceiptAck a = active(token);
        verify(a, r.phone());
        requirePending(a);
        Organization tenant = tenant(a);
        a.setStatus(ChitReceiptAck.DISPUTED);
        a.setDisputeReason(ActivityService.cut(r.reason().trim(), 500));
        a.setDisputedAt(OrgClock.now().withNano(0));
        a.setDisputeIp(ActivityService.cut(ip, 64));
        acks.save(a);
        return asTenant(tenant, () -> {
            activity.record(linkUser(tenant, a.getOrganizerName()), "DISPUTED", AREA, a.getChitName() + ": " + a.getOrganizerName()
                    + " says " + a.getAckNo() + " is not right · " + a.getDisputeReason(), "POST", "/public/chit-receipts");
            return full(a, tenant);
        });
    }

    // ================================================================== helpers

    /**
     * The standard wording, with the figures filled in: numbered clauses, each "HEADING: text". The payments are listed
     * with it (and covered by the same fingerprint).
     */
    private static String simpleTerms(ChitReceiptAck a, List<Line> lines) {
        String rupees = ActivityService.money(a.getTotalAmount()) + " (" + HostedChitService.inWords(a.getTotalAmount()) + ")";
        String nos = lines.stream().map(l -> String.valueOf(l.no())).collect(Collectors.joining(", "));
        StringBuilder t = new StringBuilder();
        t.append("I, ").append(a.getOrganizerName()).append(", received ").append(rupees).append(" from ").append(a.getPayerName())
                .append(" for installment").append(lines.size() == 1 ? " " : "s ").append(nos).append(" of the chit \"").append(a.getChitName()).append("\"")
                .append(a.getTicketNo() == null ? "" : " (ticket " + a.getTicketNo() + ")").append(". Nothing more is due for ")
                .append(lines.size() == 1 ? "it" : "them").append(".\n");
        t.append("I sign this electronically from a link sent to my phone (Information Technology Act, 2000); the time, my IP address and my phone's details are kept with it.");
        if (a.getPaymentNote() != null) {
            t.append("\nPaid by: ").append(a.getPaymentNote());
        }
        return t.toString();
    }

    private static String terms(ChitReceiptAck a, Chit chit, List<Line> lines) {
        String rupees = ActivityService.money(a.getTotalAmount()) + " (" + HostedChitService.inWords(a.getTotalAmount()) + ")";
        String chitRef = "the chit \"" + a.getChitName() + "\"" + (a.getTicketNo() == null ? "" : " (ticket / group no. " + a.getTicketNo() + ")")
                + " of " + ActivityService.money(chit.getMaturityAmount()) + " conducted by " + a.getOrganizerName();
        StringBuilder t = new StringBuilder();
        t.append("1. PARTIES: I, ").append(a.getOrganizerName()).append(", the organizer / foreman of ").append(chitRef)
                .append(", give this acknowledgement to ").append(a.getPayerName()).append(" (the Subscriber).\n");
        t.append("2. RECEIPT: I confirm that I have received from the Subscriber ").append(rupees).append(" in all, towards ")
                .append(lines.size() == 1 ? "the installment" : "the " + lines.size() + " installments")
                .append(" of this chit listed below, on the dates shown against ").append(lines.size() == 1 ? "it" : "each").append(".\n");
        t.append("3. APPLICATION: Each amount received was applied to the installment number shown against it. Where a dividend was ")
                .append("adjusted, the cash I received is that installment less the dividend, as listed.\n");
        t.append("4. NOTHING DUE FOR THESE: With these receipts, the installments listed are paid in full and nothing more is due from the Subscriber ")
                .append("for them. This does not release any other installment of the chit.\n");
        t.append("5. ELECTRONIC ACKNOWLEDGEMENT: I am acknowledging electronically, by opening a link sent to my mobile number, ")
                .append("typing my name and signing with my finger. I understand that this is an electronic record and signature ")
                .append("under the Information Technology Act, 2000; that the time, my IP address and my phone's details ")
                .append("(and my location and a selfie, if asked) are kept with it; and that it may be produced as evidence.\n");
        t.append("6. MY OWN ACT: I do this of my own free will. If any detail above is wrong I will say so instead of signing.");
        if (a.getPaymentNote() != null) {
            t.append("\n7. PAYMENT DETAILS (as stated by the Subscriber): ").append(a.getPaymentNote());
        }
        return t.toString();
    }


    static boolean isFinal(ChitReceiptAck a) {
        return ChitReceiptAck.ACKNOWLEDGED.equals(a.getStatus()) || ChitReceiptAck.SIGNED.equals(a.getStatus());
    }

    static boolean isPayout(ChitReceiptAck a) {
        return ChitReceiptAck.KIND_PAYOUT.equals(a.getKind());
    }

    private static String kindOf(ChitReceiptAck a) {
        return isPayout(a) ? ChitReceiptAck.KIND_PAYOUT : ChitReceiptAck.KIND_SIMPLE.equals(a.getKind()) ? ChitReceiptAck.KIND_SIMPLE : ChitReceiptAck.KIND_INSTALLMENTS;
    }

    /** The numbers of the acknowledgements a payout receipt cancels. */
    private List<String> supersededNos(ChitReceiptAck a) {
        if (a.getSupersedes() == null || a.getSupersedes().isBlank()) return List.of();
        return java.util.Arrays.stream(a.getSupersedes().split(",")).map(id -> acks.findById(Long.valueOf(id)).map(ChitReceiptAck::getAckNo).orElse("CR-" + id)).toList();
    }

    /** A signed payout receipt cancels the acknowledgements it replaces (they stay on record, marked cancelled). */
    private void cancelSuperseded(ChitReceiptAck payout) {
        if (payout.getSupersedes() == null || payout.getSupersedes().isBlank()) return;
        LocalDateTime now = OrgClock.now().withNano(0);
        for (String id : payout.getSupersedes().split(",")) {
            acks.findById(Long.valueOf(id)).ifPresent(old -> {
                if (!isFinal(old) && !ChitReceiptAck.PENDING.equals(old.getStatus())) return;
                old.setStatus(ChitReceiptAck.CANCELLED);
                old.setCancelReason("Replaced by the payout receipt " + payout.getAckNo());
                old.setCancelledAt(now);
                old.setCancelledBy("payout receipt");
                old.setSupersededBy(payout.getId());
                old.setLinkRevokedAt(now);
                acks.save(old);
            });
        }
    }

    /** "#1–#5" for a run, "#1, #3" otherwise. */
    private static String span(List<Line> lines) {
        List<Integer> nos = lines.stream().map(Line::no).toList();
        if (nos.isEmpty()) return "";
        boolean run = nos.size() > 2 && nos.get(nos.size() - 1) - nos.get(0) == nos.size() - 1;
        return run ? "#" + nos.get(0) + "–#" + nos.get(nos.size() - 1) : nos.stream().map(n -> "#" + n).collect(Collectors.joining(", "));
    }

    /**
     * The wording of the payout receipt and final settlement: the whole payout received, nothing more due for it, the
     * installments restated, the earlier acknowledgements cancelled and replaced, what is not released, electronic or
     * paper signature, stamp duty, governing law and free will.
     */
    private static String payoutTerms(ChitReceiptAck a, Chit chit, List<Line> parts, List<Line> paid, List<ChitReceiptAck> earlier, int unpaidCount,
                                      BigDecimal unpaidAmount) {
        String rupees = ActivityService.money(a.getTotalAmount()) + " (" + HostedChitService.inWords(a.getTotalAmount()) + ")";
        BigDecimal paidTotal = paid.stream().map(Line::cash).reduce(BigDecimal.ZERO, BigDecimal::add);
        String chitRef = "the chit \"" + a.getChitName() + "\"" + (a.getTicketNo() == null ? "" : " (ticket / group no. " + a.getTicketNo() + ")")
                + " of " + ActivityService.money(chit.getMaturityAmount()) + " conducted by " + a.getOrganizerName();
        StringBuilder t = new StringBuilder();
        t.append("1. PARTIES: I, ").append(a.getOrganizerName()).append(", the organizer / foreman of ").append(chitRef)
                .append(", give this acknowledgement to ").append(a.getPayerName()).append(" (the Subscriber), who has declared that the payout was received by the Subscriber.\n");
        t.append("2. PAYOUT PAID AND RECEIVED IN FULL: I confirm that I have paid to the Subscriber the whole payout of the chit (the prize or maturity amount), ")
                .append(rupees).append(" in all, in ").append(parts.size() == 1 ? "one payment" : parts.size() + " parts").append(" on the dates listed below, ")
                .append("and that the Subscriber has received the entire amount. Nothing of the payout remains to be paid.\n");
        t.append("3. FULL AND FINAL AS TO THE PAYOUT: In respect of the payout, nothing is due from me to the Subscriber, and neither of us has any further ")
                .append("claim against the other for it.\n");
        t.append("4. INSTALLMENTS: The Subscriber has paid ").append(paid.size()).append(" of the ").append(chit.getNumberOfInstallments())
                .append(" installments of the chit, ").append(ActivityService.money(paidTotal)).append(" in cash in all, as listed below, and I confirm I received them. ");
        if (unpaidCount > 0) {
            t.append("The remaining ").append(unpaidCount).append(" installment").append(unpaidCount == 1 ? "" : "s").append(" (").append(ActivityService.money(unpaidAmount))
                    .append(") stay payable by the Subscriber under the terms of the chit and are not released by this document.\n");
        } else {
            t.append("No installment of the chit is due from the Subscriber.\n");
        }
        if (earlier.isEmpty()) {
            t.append("5. EARLIER ACKNOWLEDGEMENTS: No earlier acknowledgement of receipt was signed for this chit; any request still open is cancelled when I sign this.\n");
        } else {
            t.append("5. EARLIER ACKNOWLEDGEMENTS CANCELLED: The earlier acknowledgement").append(earlier.size() == 1 ? "" : "s").append(" of receipt I gave for this chit — ")
                    .append(earlier.stream().map(e -> e.getAckNo() + " (installments " + span(decode(e.getLines())) + ", " + ActivityService.money(e.getTotalAmount())
                            + ", signed on " + e.getAcknowledgedAt().toLocalDate().format(DAY) + ")").collect(Collectors.joining("; ")))
                    .append(" — ").append(earlier.size() == 1 ? "is" : "are").append(", with effect from the date of my signature below, cancelled and replaced by this acknowledgement, ")
                    .append("which restates the payments they covered. They are kept only as a record and are not to be relied on separately.\n");
        }
        t.append("6. ELECTRONIC OR PAPER SIGNATURE: I am signing either electronically, by opening a link sent to my mobile number, typing my name and signing with my finger, ")
                .append("or on a printed copy. I understand that an electronic signature is an electronic record and signature under the Information Technology Act, 2000; ")
                .append("that the time, my IP address and my phone's details (and my location and a selfie, if asked) are kept with it; and that either form may be produced as evidence.\n");
        t.append("7. STAMP DUTY: Any stamp duty payable on this document is to be borne by the Subscriber; it may be stamped as the law requires before it is produced in evidence.\n");
        t.append("8. GOVERNING LAW: This acknowledgement is governed by the laws of India, and the courts of India having jurisdiction may decide any dispute about it.\n");
        t.append("9. MY OWN ACT: I do this of my own free will, after reading it. If any detail above is wrong I will say so instead of signing.");
        if (a.getPaymentNote() != null) {
            t.append("\n10. PAYOUT DETAILS (as stated by the Subscriber): ").append(a.getPaymentNote());
        }
        return t.toString();
    }

    /** SHA-256 of the wording and the payments, so changing either shows. */
    private static String fingerprint(ChitReceiptAck a) {
        return HostedChitService.sha256(String.join("\n", a.getAckNo(), a.getPayerName(), a.getOrganizerName(), a.getChitName(),
                String.valueOf(a.getTicketNo()), a.getLines(), a.getTotalAmount().toPlainString(), a.getTerms(), String.valueOf(a.getKind()),
                String.valueOf(a.getInstallLines()), String.valueOf(a.getSupersedes())));
    }

    private static String encode(List<Line> lines) {
        return lines.stream().map(l -> l.no() + "|" + l.dueDate() + "|" + l.paidDate() + "|" + l.dueAmount().toPlainString() + "|"
                + l.dividend().toPlainString() + "|" + l.cash().toPlainString()
                + (l.paidFrom() == null && l.reference() == null && l.entryNo() == null ? ""
                : "|" + java.util.Objects.toString(l.paidFrom(), "") + "|" + java.util.Objects.toString(l.reference(), "") + "|" + java.util.Objects.toString(l.entryNo(), "")))
                .collect(Collectors.joining("\n"));
    }

    /** Text safe inside a line (no separator, no line break); null when empty. */
    private static String plain(String v) {
        if (v == null) return null;
        String t = v.replace('|', '/').replace('\n', ' ').replace('\r', ' ').trim();
        return t.isEmpty() ? null : t.length() > 80 ? t.substring(0, 80) : t;
    }

    private static String part(String[] p, int i) {
        return p.length > i && !p[i].isBlank() ? p[i] : null;
    }

    static List<Line> decode(String lines) {
        List<Line> out = new ArrayList<>();
        for (String row : lines.split("\n")) {
            String[] p = row.split("\\|");
            if (p.length < 6) continue;
            out.add(new Line(Integer.parseInt(p[0]), LocalDate.parse(p[1]), LocalDate.parse(p[2]), new BigDecimal(p[3]), new BigDecimal(p[4]),
                    new BigDecimal(p[5]), part(p, 6), part(p, 7), part(p, 8)));
        }
        return out;
    }

    private static boolean has(ChitReceiptAck a, Long installmentId) {
        for (String id : a.getInstallmentIds().split(",")) {
            if (id.equals(String.valueOf(installmentId))) return true;
        }
        return false;
    }

    private static String phone(String typed) {
        String digits = typed == null ? "" : typed.replaceAll("\\D", "");
        if (digits.length() > 10 && digits.startsWith("91")) digits = digits.substring(digits.length() - 10);
        if (!digits.matches("[6-9]\\d{9}")) {
            throw new BusinessException("Enter the organizer's 10-digit mobile number");
        }
        return digits;
    }

    /** Makes a fresh token (an older one stops working) and starts its time limit. */
    private String newLink(ChitReceiptAck a, int hours) {
        byte[] bytes = new byte[32];
        random.nextBytes(bytes);
        String token = Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
        a.setTokenHash(AccessLinkService.hash(token));
        a.setLinkExpiresAt(OrgClock.now().plusHours(Math.min(hours, MAX_LINK_HOURS)));
        a.setLinkRevokedAt(null);
        a.setFailedAttempts(0);
        a.setLockedAt(null);
        a.setViews(0);
        a.setLastViewedAt(null);
        return token;
    }

    private void stop(ChitReceiptAck a) {
        a.setStatus(ChitReceiptAck.REVOKED);
        a.setLinkRevokedAt(OrgClock.now());
        acks.save(a);
    }

    private String verify(ChitReceiptAck a, String typed) {
        if (a.getLockedAt() != null) {
            throw new BusinessException("This link is locked after too many wrong numbers. Ask " + a.getPayerName() + " for a new link.");
        }
        String digits = typed == null ? "" : typed.replaceAll("\\D", "");
        if (digits.length() > 10 && digits.startsWith("91")) digits = digits.substring(digits.length() - 10);
        if (!digits.matches("[6-9]\\d{9}")) {
            throw new BusinessException("Enter your 10-digit mobile number");
        }
        if (!digits.equals(a.getOrganizerPhone())) {
            int failed = (a.getFailedAttempts() == null ? 0 : a.getFailedAttempts()) + 1;
            a.setFailedAttempts(failed);
            if (failed >= MAX_ATTEMPTS) a.setLockedAt(OrgClock.now());
            acks.save(a);
            throw new VerificationFailed(failed >= MAX_ATTEMPTS
                    ? "That is not the number this was sent to. The link is now locked: ask " + a.getPayerName() + " for a new one."
                    : "That is not the number this was sent to (" + (MAX_ATTEMPTS - failed) + " tr" + (MAX_ATTEMPTS - failed == 1 ? "y" : "ies") + " left)");
        }
        return digits;
    }

    private static void requirePending(ChitReceiptAck a) {
        if (isFinal(a)) {
            throw new BusinessException("This was already acknowledged on " + OrgClock.toOrg(a.getAcknowledgedAt()).format(DAY));
        }
        if (!ChitReceiptAck.PENDING.equals(a.getStatus())) {
            throw new BusinessException("This request is closed. Ask " + a.getPayerName() + " for a new one.");
        }
    }

    private PublicAck gate(ChitReceiptAck a, Organization t, String error) {
        int left = MAX_ATTEMPTS - (a.getFailedAttempts() == null ? 0 : a.getFailedAttempts());
        String hint = java.util.Arrays.stream(a.getOrganizerName().split("\\s+"))
                .map(w -> w.isEmpty() ? w : w.charAt(0) + "•••").collect(Collectors.joining(" "));
        return new PublicAck("VERIFY", error, Math.max(0, left), t.getName(), a.getPayerName(), hint, "••••••" + a.getOrganizerPhone().substring(6),
                a.getAckNo(), a.getLinkExpiresAt(), null, null, null, List.of(), null, null, null, null, null, t.getCurrency(),
                Boolean.TRUE.equals(a.getRequireSelfie()), Boolean.TRUE.equals(a.getRequireLocation()), false, a.getStatus(),
                null, null, null, null, false, null, null, null, null, null, null, null, kindOf(a), List.of(), List.of(), null);
    }

    private PublicAck full(ChitReceiptAck a, Organization t) {
        load(a);
        boolean selfie = files.listForAgreement(FILES, a.getId()).stream().anyMatch(f -> "SELFIE".equals(f.docType()));
        String step = ChitReceiptAck.PENDING.equals(a.getStatus()) ? "OPEN" : ChitReceiptAck.DISPUTED.equals(a.getStatus()) ? "DISPUTED" : "DONE";
        return new PublicAck(step, null, null, t.getName(), a.getPayerName(), null, "••••••" + a.getOrganizerPhone().substring(6), a.getAckNo(),
                a.getLinkExpiresAt(), a.getOrganizerName(), a.getChitName(), a.getTicketNo(), decode(a.getLines()), a.getTotalAmount(),
                HostedChitService.inWords(a.getTotalAmount()), a.getPaymentNote(), a.getTerms(), a.getContentHash(), t.getCurrency(),
                Boolean.TRUE.equals(a.getRequireSelfie()), Boolean.TRUE.equals(a.getRequireLocation()), selfie, a.getStatus(),
                a.getAcknowledgedName(), a.getAcknowledgedAt(), a.getSignature(), a.getAcknowledgementSeal(), a.getAcknowledgedLocation() != null,
                a.getEvidencePayload(), a.getDigitalSignature(), settings.publicKeyFor(a.getEvidencePayload(), a.getDigitalSignature()), settings.fingerprintFor(a.getEvidencePayload(), a.getDigitalSignature()), a.getDisputeReason(),
                a.getDisputedAt(), a.getCreatedAt(), kindOf(a), a.getInstallLines() == null ? List.of() : decode(a.getInstallLines()), supersededNos(a),
                a.getPayerSignature());
    }

    private AckView view(ChitReceiptAck a) {
        Map<Long, Integer> nos = new java.util.HashMap<>();
        installments.findByChitIdOrderByInstallmentNo(a.getChitId()).forEach(i -> nos.put(i.getId(), i.getInstallmentNo()));
        return view(a, nos, true);
    }

    /** full: the record's document is read from disk too; a list does not (wording, signatures and the signed text stay on disk). */
    private AckView view(ChitReceiptAck a, Map<Long, Integer> nos, boolean full) {
        if (full) load(a);
        LocalDateTime now = OrgClock.now();
        String link = a.getTokenHash() == null ? "NONE" : a.getLockedAt() != null ? "LOCKED" : a.getLinkRevokedAt() != null ? "REVOKED"
                : a.getLinkExpiresAt() != null && a.getLinkExpiresAt().isAfter(now) ? "ACTIVE" : "EXPIRED";
        return new AckView(a.getId(), a.getChitId(), a.getAckNo(), a.getStatus(), a.getPayerName(), a.getOrganizerName(), a.getOrganizerPhone(),
                a.getChitName(), a.getTicketNo(), decode(a.getLines()), a.getTotalAmount(), HostedChitService.inWords(a.getTotalAmount()),
                a.getPaymentNote(), a.getTerms(), a.getContentHash(), Boolean.TRUE.equals(a.getRequireSelfie()), Boolean.TRUE.equals(a.getRequireLocation()),
                link, a.getLinkExpiresAt(), a.getViews() == null ? 0 : a.getViews(), a.getLastViewedAt(),
                a.getFailedAttempts() == null ? 0 : a.getFailedAttempts(), a.getLockedAt(), a.getAcknowledgedName(), a.getAcknowledgedAt(),
                a.getAcknowledgedPhone(), a.getAcknowledgedIp(), a.getAcknowledgedUserAgent(), a.getAcknowledgedDevice(), a.getDeviceHash(),
                a.getAcknowledgedLocation(), a.getSignature(), a.getAcknowledgementSeal(), a.getEvidencePayload(), a.getDigitalSignature(),
                settings.publicKeyFor(a.getEvidencePayload(), a.getDigitalSignature()), settings.fingerprintFor(a.getEvidencePayload(), a.getDigitalSignature()), a.getDisputeReason(), a.getDisputedAt(),
                files.listForAgreement(FILES, a.getId()), a.getCreatedBy(), a.getCreatedAt(), kindOf(a),
                a.getInstallLines() == null ? List.of() : decode(a.getInstallLines()), supersededNos(a), a.getPayerSignature(), a.getCancelReason(),
                a.getCancelledAt(), a.getCancelledBy(), a.getSupersededBy() == null ? null : acks.findById(a.getSupersededBy()).map(ChitReceiptAck::getAckNo).orElse(null),
                installmentNos(a, nos), a.getInstallmentIds().isBlank() ? 0 : a.getInstallmentIds().split(",").length);
    }

    /** The numbers of the installments a record stands for, in order. */
    private static List<Integer> installmentNos(ChitReceiptAck a, Map<Long, Integer> nos) {
        return java.util.Arrays.stream(a.getInstallmentIds().split(",")).filter(x -> !x.isBlank()).map(x -> nos.get(Long.valueOf(x))).filter(java.util.Objects::nonNull).sorted().toList();
    }

    /** Saves the row and puts the big parts (wording, signatures, the signed text, the device) in the record's document on disk. */
    private void keep(ChitReceiptAck a) {
        acks.save(a);
        Map<String, String> doc = new LinkedHashMap<>();
        doc.put("terms", a.getTerms());
        doc.put("installLines", a.getInstallLines());
        doc.put("signature", a.getSignature());
        doc.put("payerSignature", a.getPayerSignature());
        doc.put("evidencePayload", a.getEvidencePayload());
        doc.put("acknowledgedDevice", a.getAcknowledgedDevice());
        vault.merge(VAULT, a.getTenantId(), a.getId(), doc);
    }

    /** Reads the record's document from disk into this (working) copy of the row. */
    private void load(ChitReceiptAck a) {
        Map<String, String> doc = vault.read(VAULT, a.getTenantId(), a.getId());
        a.setTerms(doc.get("terms"));
        a.setInstallLines(doc.get("installLines"));
        a.setSignature(doc.get("signature"));
        a.setPayerSignature(doc.get("payerSignature"));
        a.setEvidencePayload(doc.get("evidencePayload"));
        a.setAcknowledgedDevice(doc.get("acknowledgedDevice"));
    }

    private Chit chit(Long chitId) {
        return chits.findByIdAndTenantId(chitId, UserContext.tenantId()).orElseThrow(() -> new NotFoundException("Chit", chitId));
    }

    private ChitReceiptAck require(Long chitId, Long ackId) {
        chit(chitId);
        return acks.findByIdAndTenantId(ackId, UserContext.tenantId()).filter(a -> a.getChitId().equals(chitId))
                .orElseThrow(() -> new NotFoundException("Chit acknowledgement", ackId));
    }

    private ChitReceiptAck active(String token) {
        ChitReceiptAck a = token == null || token.isBlank() ? null : acks.findByTokenHash(AccessLinkService.hash(token.trim())).orElse(null);
        if (a == null) {
            throw new BusinessException("This link is not valid");
        }
        // an answered request can still be opened (to read it and print the record) until the link runs out
        if (a.getLinkRevokedAt() != null) {
            throw new BusinessException("This link was switched off. Ask " + a.getPayerName() + " for a new one.");
        }
        if (a.getLinkExpiresAt() == null || !a.getLinkExpiresAt().isAfter(OrgClock.now())) {
            throw new BusinessException("This link has expired. Ask " + a.getPayerName() + " for a new one.");
        }
        return a;
    }

    private Organization tenant(ChitReceiptAck a) {
        return tenants.findById(a.getTenantId()).filter(t -> Boolean.TRUE.equals(t.getActive()))
                .orElseThrow(() -> new BusinessException("This acknowledgement is no longer shared"));
    }
}
