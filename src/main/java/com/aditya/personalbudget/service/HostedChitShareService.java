package com.aditya.personalbudget.service;

import com.aditya.personalbudget.domain.entity.HostedChit;
import com.aditya.personalbudget.domain.entity.HostedChitAgreement;
import com.aditya.personalbudget.domain.entity.HostedChitMember;
import com.aditya.personalbudget.domain.entity.HostedChitPayment;
import com.aditya.personalbudget.domain.entity.HostedChitShare;
import com.aditya.personalbudget.domain.entity.Organization;
import com.aditya.personalbudget.domain.type.Feature;
import com.aditya.personalbudget.domain.type.UserRole;
import com.aditya.personalbudget.exception.BusinessException;
import com.aditya.personalbudget.exception.NotFoundException;
import com.aditya.personalbudget.domain.entity.Account;
import com.aditya.personalbudget.repository.AccountRepository;
import com.aditya.personalbudget.repository.HostedChitAgreementRepository;
import com.aditya.personalbudget.repository.HostedChitMemberRepository;
import com.aditya.personalbudget.repository.HostedChitPaymentRepository;
import com.aditya.personalbudget.repository.HostedChitRepository;
import com.aditya.personalbudget.repository.HostedChitShareRepository;
import com.aditya.personalbudget.repository.OrganizationRepository;
import com.aditya.personalbudget.security.CurrentUser;
import com.aditya.personalbudget.security.UserContext;
import com.aditya.personalbudget.service.HostedChitService.AgreementView;
import com.aditya.personalbudget.service.HostedChitService.Detail;
import com.aditya.personalbudget.service.HostedChitService.MemberView;
import com.aditya.personalbudget.service.HostedChitService.MonthView;
import com.aditya.personalbudget.service.HostedChitService.PaymentView;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.Size;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.security.SecureRandom;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.Base64;
import java.util.Comparator;
import java.util.List;
import java.util.Objects;
import java.util.function.Supplier;

/**
 * Temporary links to a hosted chit (see {@link HostedChitShare}), opened without an account:
 * <ul>
 *   <li><b>MEMBER</b>: a member's statement: every month (due, paid), payments with receipt numbers, what is due now
 *       with late interest, and a UPI "pay now" when the organiser has a UPI ID (the payment link);</li>
 *   <li><b>CHIT</b>: every month, the winners and the collections, optionally the organiser's earnings;</li>
 *   <li><b>RECEIPT</b>: one payment's receipt;</li>
 *   <li><b>AGREEMENT</b>: the winner's digital agreement, which the member accepts by typing their name.</li>
 * </ul>
 * Worked out when the link is opened, so it is always current. Phone numbers, accounts and anything else of the
 * household stay out.
 */
@Service
public class HostedChitShareService {

    /** Links live at most 180 days. */
    public static final int MAX_HOURS = 24 * 180;
    private static final String AREA = "Host a Chit";
    public static final String MEMBER = "MEMBER";
    public static final String CHIT = "CHIT";
    public static final String RECEIPT = "RECEIPT";
    public static final String AGREEMENT = "AGREEMENT";

    public record ShareRequest(Long memberId, Long paymentId, Long agreementId, @Size(max = 80) String sharedWith,
                               @Min(1) @Max(MAX_HOURS) int hours, Boolean showEarnings, @Size(max = 300) String message) {
    }

    /** Statement (payment) links for several members at once, e.g. for reminders. */
    /** Statement links (with the pay button) for memberIds, or receipt links for paymentIds. */
    public record BatchRequest(List<Long> memberIds, List<Long> paymentIds, @Min(1) @Max(MAX_HOURS) int hours) {
    }

    public record BatchLink(Long memberId, Long paymentId, String token) {
    }

    /**
     * What the member gives when accepting: their name, mobile number and drawn signature, optionally their location,
     * and what their device reports (browser, platform, screen, time zone, language, local time).
     */
    public record AcceptRequest(@Size(min = 2, max = 100) String name, Boolean agree, @Size(max = 20) String phone,
                                @Size(max = 20000) String signature, @Size(max = 100) String location, @Size(max = 2000) String device,
                                /* when the organiser asked for ID proof: the Aadhaar number (only its last 4 digits are kept) and PAN */
                                @Size(max = 20) String aadhaarNumber, @Size(max = 12) String pan) {
    }

    public record ShareView(Long id, Long chitId, String kind, Long memberId, String memberName, Long paymentId, Long agreementId,
                            String sharedWith, boolean showEarnings, String message, String createdByName, LocalDateTime createdAt,
                            LocalDateTime expiresAt, LocalDateTime revokedAt, int views, LocalDateTime lastViewedAt, String status) {
    }

    /** A new link: the token is returned this once. */
    public record CreatedShare(ShareView share, String token) {
    }

    public record PublicMonth(int monthNo, LocalDate dueDate, BigDecimal chitValue, BigDecimal payout, boolean estimated,
                              BigDecimal bid, BigDecimal dividend, String winner, String status, BigDecimal collected,
                              BigDecimal expected, LocalDate payoutDate) {
    }

    /** One month of the member's own payments. status: PAID, PARTIAL, PENDING or NOTDUE. */
    public record PublicDue(int monthNo, LocalDate dueDate, BigDecimal due, BigDecimal paid, BigDecimal lateFeeDue, String status) {
    }

    public record PublicPayment(String receiptNo, LocalDate paidDate, int monthNo, BigDecimal amount, BigDecimal lateFee,
                                String mode, String reference) {
    }

    public record PublicMember(String name, Integer wonMonth, BigDecimal received, LocalDate receivedOn, BigDecimal totalPaid,
                               BigDecimal balanceDue, BigDecimal lateFeeDue, BigDecimal payNow, BigDecimal dividends,
                               BigDecimal nextDueAmount, LocalDate nextDueDate, List<PublicDue> dues, List<PublicPayment> payments) {
    }

    public record PublicReceipt(String receiptNo, LocalDate paidDate, String memberName, int monthNo, LocalDate monthDueDate,
                                BigDecimal amount, BigDecimal lateFee, BigDecimal lateFeeWaived, BigDecimal total, String mode,
                                String reference, BigDecimal dueForMonth, BigDecimal paidForMonth, BigDecimal balanceForMonth,
                                /* the organiser's drawn signature (SVG path) and name, and the HMAC-SHA256 seal over the figures */
                                String signer, String signature, String seal) {
    }

    public record PublicAgreement(String agreementNo, String memberName, int monthNo, BigDecimal chitValue, BigDecimal deduction,
                                  BigDecimal payoutAmount, String payoutInWords, LocalDate payoutDate, String payoutMode,
                                  String payoutReference, Integer remainingInstallments, BigDecimal remainingAmount,
                                  String guarantorName, String terms, String contentHash, String status, String acceptedName,
                                  LocalDateTime acceptedAt, String acceptedPhoneMasked, String signature, String acceptanceSeal,
                                  boolean locationShared, LocalDateTime createdAt,
                                  /* the stamp-paper look: stamp, the organiser's and the witness's signatures */
                                  BigDecimal stampDuty, String stampSerial, String organiserName, String organiserSignature,
                                  String witnessName, String witnessSignature,
                                  /* ID proof: asked of the member, what is attached so far, the numbers masked */
                                  boolean kycFromMember, List<String> kycDocs, String aadhaarLast4, String panMasked,
                                  /* the signed evidence and how to check it */
                                  String evidencePayload, String digitalSignature, String publicKey, String keyFingerprint) {
    }

    /** What the link shows; the part for its kind is filled in. */
    public record PublicChit(String kind, String household, String sharedBy, String sharedWith, String message, String currency,
                             LocalDate asOf, LocalDateTime expiresAt, String name, String chitType, int memberCount, int months,
                             BigDecimal installment, BigDecimal baseValue, BigDecimal winnerExtraAmount, BigDecimal maxBid,
                             BigDecimal lateFeePercent, int lateGraceDays, String upiId, String payeeName,
                             int currentMonth, int completedMonths, String status, BigDecimal totalCollected,
                             BigDecimal totalPaidOut, boolean showEarnings, BigDecimal commission, BigDecimal commissionEarned,
                             BigDecimal held, BigDecimal pendingDues, List<PublicMonth> schedule, PublicMember member,
                             PublicReceipt receipt, PublicAgreement agreement, PublicPayTo payTo,
                             /* the chit in payment notes: AC5L gives AC5L-M03 for month 3 */
                             String shortCode) {
    }

    /**
     * Where a member pays (on their statement link): a UPI ID, or bank details for a transfer, signed by the organiser and
     * sealed (HMAC over every detail and the signature) so a changed account number or UPI ID shows as tampered.
     */
    public record PublicPayTo(String upiId, String payeeName, String holderName, String bankName, String accountNumber, String ifsc,
                              String signer, String signature, String seal, LocalDateTime sealedAt, String stampName,
                              /* the digital signature: the exact signed text (JSON), its ECDSA P-256 signature, the public key and its fingerprint */
                              String payload, String digitalSignature, String publicKey, String keyFingerprint,
                              /* a fellow member (this month's winner) to pay directly: their name and mobile number */
                              String toMember, String toMemberPhone) {
    }

    /** What the server says about a link's payment details: its own signature, and whether they are still the ones to pay into. */
    public record PayToCheck(boolean signatureValid, boolean current, String keyFingerprint, String message) {
    }

    private final HostedChitShareRepository shares;
    private final HostedChitRepository chits;
    private final HostedChitMemberRepository members;
    private final HostedChitPaymentRepository payments;
    private final HostedChitAgreementRepository agreements;
    private final OrganizationRepository tenants;
    private final HostedChitService service;
    private final ActivityService activity;
    private final AppSettingsService settings;
    private final AccountRepository accountRepo;
    private final AttachmentService files;
    private final SecureRandom random = new SecureRandom();

    public HostedChitShareService(HostedChitShareRepository shares, HostedChitRepository chits, HostedChitMemberRepository members,
                                  HostedChitPaymentRepository payments, HostedChitAgreementRepository agreements,
                                  OrganizationRepository tenants, HostedChitService service, ActivityService activity,
                                  AppSettingsService settings, AccountRepository accountRepo, AttachmentService files) {
        this.files = files;
        this.settings = settings;
        this.accountRepo = accountRepo;
        this.shares = shares;
        this.chits = chits;
        this.members = members;
        this.payments = payments;
        this.agreements = agreements;
        this.tenants = tenants;
        this.service = service;
        this.activity = activity;
    }

    public List<ShareView> list(Long chitId) {
        chit(chitId);
        return shares.findByChitId(chitId).stream()
                .sorted(Comparator.comparing(HostedChitShare::getCreatedAt).reversed())
                .map(this::view)
                .toList();
    }

    @Transactional
    public CreatedShare create(Long chitId, ShareRequest r) {
        HostedChit c = chit(chitId);
        String kind;
        Long memberId = r.memberId();
        if (r.agreementId() != null) {
            HostedChitAgreement a = agreements.findById(r.agreementId()).filter(x -> x.getChitId().equals(chitId))
                    .orElseThrow(() -> new NotFoundException("Agreement", r.agreementId()));
            kind = AGREEMENT;
            memberId = a.getMemberId();
        } else if (r.paymentId() != null) {
            HostedChitPayment p = payments.findById(r.paymentId()).filter(x -> x.getChitId().equals(chitId))
                    .orElseThrow(() -> new NotFoundException("Payment", r.paymentId()));
            kind = RECEIPT;
            memberId = p.getMemberId();
        } else {
            kind = memberId == null ? CHIT : MEMBER;
        }
        HostedChitMember member = memberId == null ? null : member(chitId, memberId);
        String token = token();
        HostedChitShare s = newShare(c, kind, member, token, r.hours());
        s.setPaymentId(RECEIPT.equals(kind) ? r.paymentId() : null);
        s.setAgreementId(AGREEMENT.equals(kind) ? r.agreementId() : null);
        s.setSharedWith(blank(r.sharedWith()) != null ? blank(r.sharedWith()) : member == null ? null : member.getName());
        s.setShowEarnings(CHIT.equals(kind) && Boolean.TRUE.equals(r.showEarnings()));
        s.setMessage(blank(r.message()));
        s = shares.save(s);
        String what = switch (kind) {
            case RECEIPT -> "a receipt to " + member.getName();
            case AGREEMENT -> "the agreement with " + member.getName();
            case MEMBER -> member.getName() + "'s statement";
            default -> "the status of the chit" + (s.getSharedWith() != null ? " with " + s.getSharedWith() : "");
        };
        activity.record("ADDED", AREA, "Shared " + what + " · " + c.getName() + " · " + days(r.hours()));
        return new CreatedShare(view(s), token);
    }

    /** Statement links (with the UPI pay button) for several members, e.g. to send with reminders. */
    @Transactional
    public List<BatchLink> batch(Long chitId, BatchRequest r) {
        HostedChit c = chit(chitId);
        List<BatchLink> links = new ArrayList<>();
        boolean receipts = r.paymentIds() != null && !r.paymentIds().isEmpty();
        if (!receipts && (r.memberIds() == null || r.memberIds().isEmpty())) {
            throw new BusinessException("Choose at least one member");
        }
        if (receipts) {
            for (Long id : r.paymentIds()) {
                HostedChitPayment p = payments.findById(id).filter(x -> x.getChitId().equals(chitId))
                        .orElseThrow(() -> new NotFoundException("Payment", id));
                HostedChitMember m = member(chitId, p.getMemberId());
                String token = token();
                HostedChitShare s = newShare(c, RECEIPT, m, token, r.hours());
                s.setPaymentId(p.getId());
                s.setSharedWith(m.getName());
                s.setShowEarnings(false);
                shares.save(s);
                links.add(new BatchLink(m.getId(), p.getId(), token));
            }
        } else {
            for (Long id : r.memberIds()) {
                HostedChitMember m = member(chitId, id);
                String token = token();
                HostedChitShare s = newShare(c, MEMBER, m, token, r.hours());
                s.setSharedWith(m.getName());
                s.setShowEarnings(false);
                shares.save(s);
                links.add(new BatchLink(m.getId(), null, token));
            }
        }
        activity.record("ADDED", AREA, "Made " + (receipts ? "receipt" : "payment") + " links for " + links.size()
                + (receipts ? " payment" : " member") + (links.size() == 1 ? "" : "s") + " · " + c.getName());
        return links;
    }

    // ================================================================== signed receipts

    /** A payment's receipt with the organiser's signature and its seal. */
    public PublicReceipt receipt(Detail d, Long paymentId) {
        var c = d.chit();
        PaymentView p = d.payments().stream().filter(x -> x.id().equals(paymentId)).findFirst()
                .orElseThrow(() -> new BusinessException("This payment was undone"));
        MemberView mv = d.members().stream().filter(x -> x.id().equals(p.memberId())).findFirst().orElseThrow();
        MonthView month = d.schedule().get(p.monthNo() - 1);
        BigDecimal due = dueFor(c, mv, month);
        BigDecimal paidForMonth = d.payments().stream().filter(x -> x.memberId().equals(mv.id()) && x.monthNo() == p.monthNo())
                .map(PaymentView::amount).reduce(Money.ZERO, BigDecimal::add);
        String signer = c.receiptSigner() != null ? c.receiptSigner() : c.payeeName() != null ? c.payeeName() : c.createdBy();
        BigDecimal total = p.amount().add(Money.nz(p.lateFee()));
        return new PublicReceipt(p.receiptNo(), p.paidDate(), mv.name(), p.monthNo(), month.dueDate(), p.amount(), Money.nz(p.lateFee()),
                Money.nz(p.lateFeeWaived()), total, p.mode(), p.reference(), due, paidForMonth, due.subtract(paidForMonth).max(Money.ZERO),
                signer, c.receiptSignature(), seal(c.id(), p, mv.name(), total, signer, c.receiptSignature()));
    }

    /** The receipt as a PDF (signed in). */
    public byte[] receiptPdf(Long chitId, Long paymentId) {
        Detail d = service.detail(chitId);
        String household = UserContext.current().map(CurrentUser::tenantName).orElse("");
        return ReceiptPdf.render(household, d.chit().name(), receipt(d, paymentId));
    }

    /** The receipt behind a receipt link, as a PDF (no sign-in). */
    public byte[] publicReceiptPdf(String token) {
        HostedChitShare s = active(token);
        if (!RECEIPT.equals(kind(s)) || s.getPaymentId() == null) {
            throw new BusinessException("This link is not a receipt");
        }
        Organization tenant = tenant(s);
        return asTenant(tenant, () -> {
            Detail d = service.detail(s.getChitId());
            return ReceiptPdf.render(tenant.getName(), d.chit().name(), receipt(d, s.getPaymentId()));
        });
    }

    /** HMAC-SHA256, with this installation's key, over every figure on the receipt and the signature. */
    private String seal(Long chitId, PaymentView p, String memberName, BigDecimal total, String signer, String signature) {
        String content = String.join("|", "RECEIPT", String.valueOf(chitId), p.receiptNo(), String.valueOf(p.id()), memberName,
                String.valueOf(p.monthNo()), p.amount().toPlainString(), Money.nz(p.lateFee()).toPlainString(),
                Money.nz(p.lateFeeWaived()).toPlainString(), total.toPlainString(), String.valueOf(p.paidDate()), p.mode(),
                String.valueOf(p.reference()), String.valueOf(signer), signature == null ? "" : HostedChitService.sha256(signature));
        try {
            javax.crypto.Mac mac = javax.crypto.Mac.getInstance("HmacSHA256");
            mac.init(new javax.crypto.spec.SecretKeySpec(settings.receiptSigningKey(), "HmacSHA256"));
            return java.util.HexFormat.of().formatHex(mac.doFinal(content.getBytes(java.nio.charset.StandardCharsets.UTF_8)));
        } catch (java.security.GeneralSecurityException e) {
            throw new IllegalStateException(e);
        }
    }

    @Transactional
    public ShareView revoke(Long chitId, Long shareId) {
        HostedChit c = chit(chitId);
        HostedChitShare s = shares.findByIdAndTenantId(shareId, c.getTenantId())
                .filter(x -> x.getChitId().equals(chitId))
                .orElseThrow(() -> new NotFoundException("Share link", shareId));
        if (s.getRevokedAt() == null) {
            s.setRevokedAt(LocalDateTime.now());
            s = shares.save(s);
            activity.record("REVOKED", AREA, "Stopped a share link of " + c.getName()
                    + (s.getSharedWith() != null ? " for " + s.getSharedWith() : ""));
        }
        return view(s);
    }

    /** Someone opened a link: what it shows, as of now (counts the view). No sign-in. */
    @Transactional
    public PublicChit open(String token) {
        HostedChitShare s = active(token);
        s.setViews((s.getViews() == null ? 0 : s.getViews()) + 1);
        s.setLastViewedAt(LocalDateTime.now());
        shares.save(s);
        Organization tenant = tenant(s);
        return asTenant(tenant, () -> toPublic(service.detail(s.getChitId()), s, tenant));
    }

    /**
     * The member adds their Aadhaar or PAN card (or a selfie) on the agreement link, when the organiser asked for it and
     * the agreement waits for them.
     */
    @Transactional
    public PublicChit addKyc(String token, String docType, String fileName, byte[] bytes) {
        HostedChitShare s = active(token);
        if (!AGREEMENT.equals(kind(s)) || s.getAgreementId() == null) {
            throw new BusinessException("This link is not an agreement");
        }
        HostedChitAgreement a = agreements.findById(s.getAgreementId()).orElseThrow(() -> new BusinessException("This agreement no longer exists"));
        if (!HostedChitAgreement.DRAFT.equals(a.getStatus())) {
            throw new BusinessException("This agreement is already accepted");
        }
        if (!Boolean.TRUE.equals(a.getKycFromMember())) {
            throw new BusinessException("The organiser did not ask for ID proof on this agreement");
        }
        String type = docType == null ? "" : docType.trim().toUpperCase();
        if (!java.util.Set.of("AADHAAR_FRONT", "AADHAAR_BACK", "PAN", "SELFIE").contains(type)) {
            throw new BusinessException("Add your Aadhaar card, PAN card or a selfie");
        }
        Organization tenant = tenant(s);
        return asTenant(tenant, () -> {
            files.addToAgreement(HostedChitService.AGREEMENT_FILES, a.getId(), type, fileName, bytes, "SELFIE".equals(type) ? "CAMERA" : "UPLOAD", "chit agreement " + a.getAgreementNo());
            return toPublic(service.detail(s.getChitId()), s, tenant);
        });
    }

    /** The member accepts the agreement behind the link by typing their name. */
    @Transactional
    public PublicChit accept(String token, AcceptRequest r, String ip, String userAgent) {
        HostedChitShare s = active(token);
        if (!AGREEMENT.equals(kind(s)) || s.getAgreementId() == null) {
            throw new BusinessException("This link is not an agreement");
        }
        HostedChitAgreement a = agreements.findById(s.getAgreementId()).orElseThrow(() -> new BusinessException("This agreement no longer exists"));
        if (!HostedChitAgreement.DRAFT.equals(a.getStatus())) {
            throw new BusinessException("This agreement was already accepted on " + a.getAcceptedAt().toLocalDate());
        }
        if (!Boolean.TRUE.equals(r.agree())) {
            throw new BusinessException("Tick the box to confirm you agree");
        }
        String name = r.name() == null ? "" : r.name().trim();
        if (name.length() < 2) {
            throw new BusinessException("Type your full name to accept");
        }
        String phone = r.phone() == null ? "" : r.phone().replaceAll("\\D", "");
        if (phone.length() > 10 && phone.startsWith("91")) phone = phone.substring(phone.length() - 10);
        if (!phone.matches("[6-9]\\d{9}")) {
            throw new BusinessException("Enter your 10-digit mobile number");
        }
        String signature = r.signature() == null ? "" : r.signature().trim();
        if (signature.length() < 20 || !signature.matches("[MLml0-9 .\\-]+")) {
            throw new BusinessException("Sign in the box with your finger or mouse");
        }
        String location = r.location() == null || r.location().isBlank() ? null : r.location().trim();
        if (location != null && !location.matches("-?\\d{1,3}(\\.\\d+)?,-?\\d{1,3}(\\.\\d+)?(,\\d+(\\.\\d+)?)?")) {
            location = null;
        }
        String device = r.device() == null ? null : ActivityService.cut(r.device(), 2000);
        HostedChitMember member = members.findById(a.getMemberId()).orElse(null);
        String onRecord = member == null || member.getPhone() == null ? null : member.getPhone().replaceAll("\\D", "");
        // ID proof the organiser asked for: the Aadhaar and PAN cards attached, and their numbers (checked against any on record)
        List<AttachmentService.AgreementFile> kyc = asTenant(tenant(s), () -> files.listForAgreement(HostedChitService.AGREEMENT_FILES, a.getId()));
        if (Boolean.TRUE.equals(a.getKycFromMember())) {
            java.util.Set<String> have = kyc.stream().map(AttachmentService.AgreementFile::docType).collect(java.util.stream.Collectors.toSet());
            if (!have.contains("AADHAAR_FRONT")) throw new BusinessException("Add a photo of your Aadhaar card (the side with your photo) first");
            if (!have.contains("PAN")) throw new BusinessException("Add a photo of your PAN card first");
            String aadhaar = Kyc.aadhaar(r.aadhaarNumber());
            if (a.getAadhaarHash() != null && !a.getAadhaarHash().equals(Kyc.hash(a.getAgreementNo(), aadhaar))) {
                throw new BusinessException("That Aadhaar number is not the one the organiser has on record (ending " + a.getAadhaarLast4() + ")");
            }
            String pan = Kyc.pan(r.pan());
            if (a.getPanHash() != null && !a.getPanHash().equals(Kyc.hash(a.getAgreementNo(), pan))) {
                throw new BusinessException("That PAN is not the one the organiser has on record (" + a.getPanMasked() + ")");
            }
            a.setAadhaarLast4(aadhaar.substring(8));
            a.setAadhaarHash(Kyc.hash(a.getAgreementNo(), aadhaar));
            a.setPanMasked(Kyc.maskPan(pan));
            a.setPanHash(Kyc.hash(a.getAgreementNo(), pan));
        }
        LocalDateTime now = LocalDateTime.now();
        a.setStatus(HostedChitAgreement.ACCEPTED);
        a.setAcceptedName(ActivityService.cut(name, 100));
        a.setAcceptedAt(now);
        a.setAcceptedFrom(ActivityService.cut("IP " + ip + (userAgent != null ? " · " + userAgent : ""), 255));
        a.setAcceptedPhone(phone);
        a.setPhoneMatches(onRecord == null ? null : onRecord.endsWith(phone));
        a.setAcceptedIp(ActivityService.cut(ip, 64));
        a.setAcceptedDevice(device);
        a.setDeviceHash(device == null ? null : HostedChitService.sha256(device));
        a.setAcceptedLocation(location);
        a.setSignature(signature);
        String fileHashes = kyc.stream().map(f -> f.docType() + ":" + f.sha256()).collect(java.util.stream.Collectors.joining(","));
        a.setAcceptanceSeal(HostedChitService.sha256(String.join("|", a.getContentHash(), name, phone, now.toString(), String.valueOf(ip),
                String.valueOf(a.getDeviceHash()), String.valueOf(location), HostedChitService.sha256(signature))
                + (fileHashes.isEmpty() ? "" : "|" + fileHashes + "|" + a.getAadhaarHash() + "|" + a.getPanHash())));
        // the evidence as exact text, digitally signed with this installation's key (the member's browser can check it)
        java.util.Map<String, Object> ev = new java.util.LinkedHashMap<>();
        ev.put("v", 1);
        ev.put("kind", "CHIT_AGREEMENT_ACCEPTANCE");
        ev.put("agreementNo", a.getAgreementNo());
        ev.put("contentHash", a.getContentHash());
        ev.put("amount", a.getPayoutAmount());
        ev.put("acceptedName", name);
        ev.put("phoneLast4", phone.substring(6));
        ev.put("phoneMatchesRecord", a.getPhoneMatches());
        ev.put("acceptedAt", now.withNano(0).toString());
        ev.put("ip", ip);
        ev.put("deviceHash", a.getDeviceHash());
        ev.put("location", location);
        ev.put("signatureHash", HostedChitService.sha256(signature));
        ev.put("aadhaarLast4", a.getAadhaarLast4());
        ev.put("panMasked", a.getPanMasked());
        ev.put("files", kyc.stream().map(f -> java.util.Map.of("type", f.docType(), "sha256", f.sha256())).toList());
        ev.put("seal", a.getAcceptanceSeal());
        a.setEvidencePayload(ActivityService.cut(Kyc.json(ev), 4000));
        a.setDigitalSignature(settings.signPayLink(a.getEvidencePayload()));
        agreements.save(a);
        Organization tenant = tenant(s);
        return asTenant(tenant, () -> {
            HostedChit c = chits.findById(s.getChitId()).orElseThrow();
            activity.record(new CurrentUser(null, "link", name, UserRole.VIEWER, tenant.getId(), tenant.getCode(), tenant.getName(),
                    tenant.getCurrency(), Feature.all(), false), "ACCEPTED", AREA, "Agreement " + a.getAgreementNo() + " accepted by "
                    + name + " · " + c.getName() + " month " + a.getMonthNo(), "POST", "/public/hosted-chits");
            return toPublic(service.detail(s.getChitId()), s, tenant);
        });
    }

    private PublicChit toPublic(Detail d, HostedChitShare s, Organization t) {
        var c = d.chit();
        String kind = kind(s);
        boolean earnings = Boolean.TRUE.equals(s.getShowEarnings());
        List<PublicMonth> schedule = d.schedule().stream().map(m -> new PublicMonth(m.monthNo(), m.dueDate(), m.chitValue(), m.payout(),
                m.estimated(), m.bid(), m.dividend(), m.winnerName(), m.status(), m.collected(), m.expected(), m.payoutDate())).toList();
        PublicMember member = s.getMemberId() == null ? null : publicMember(d, s.getMemberId());
        PublicReceipt receipt = RECEIPT.equals(kind) ? receipt(d, s.getPaymentId()) : null;
        PublicAgreement agreement = null;
        if (AGREEMENT.equals(kind)) {
            AgreementView a = d.agreements().stream().filter(x -> x.id().equals(s.getAgreementId())).findFirst()
                    .orElseThrow(() -> new BusinessException("This agreement no longer exists"));
            agreement = new PublicAgreement(a.agreementNo(), a.memberName(), a.monthNo(), a.chitValue(), a.deduction(), a.payoutAmount(),
                    HostedChitService.inWords(a.payoutAmount()), a.payoutDate(), a.payoutMode(), a.payoutReference(), a.remainingInstallments(),
                    a.remainingAmount(), a.guarantorName(), a.terms(), a.contentHash(), a.status(), a.acceptedName(), a.acceptedAt(),
                    a.acceptedPhone() == null ? null : "••••••" + a.acceptedPhone().substring(Math.max(0, a.acceptedPhone().length() - 4)),
                    a.signature(), a.acceptanceSeal(), a.acceptedLocation() != null, a.createdAt(),
                    a.stampDuty(), a.stampSerial(), a.organiserName(), a.organiserSignature(), a.witnessName(), a.witnessSignature(),
                    a.kycFromMember(), a.files().stream().map(AttachmentService.AgreementFile::docType).distinct().toList(),
                    a.aadhaarLast4(), a.panMasked(), a.evidencePayload(), a.digitalSignature(),
                    settings.payLinkPublicKey(), settings.payLinkFingerprint());
        }
        boolean full = CHIT.equals(kind) || MEMBER.equals(kind);
        return new PublicChit(kind, t.getName(), s.getCreatedByName(), s.getSharedWith(), s.getMessage(), t.getCurrency(),
                LocalDate.now(), s.getExpiresAt(), c.name(), c.chitType(), c.memberCount(), c.months(), c.installment(), c.baseValue(),
                c.winnerExtraAmount(), c.maxBid(), c.lateFeePercent(), c.lateGraceDays(), MEMBER.equals(kind) ? c.upiId() : null,
                MEMBER.equals(kind) ? (c.payeeName() != null ? c.payeeName() : s.getCreatedByName()) : null,
                c.currentMonth(), c.completedMonths(), c.status(), full ? c.totalCollected() : null, full ? c.totalPaidOut() : null,
                earnings, earnings ? c.commission() : null, earnings ? c.commissionEarned() : null, earnings ? c.held() : null,
                CHIT.equals(kind) ? c.pendingDues() : null, full ? schedule : List.of(), MEMBER.equals(kind) ? member : null, receipt, agreement,
                MEMBER.equals(kind) ? payTo(d, s, t) : null, c.shortCode());
    }

    /**
     * The account the member pays into: theirs if one is set, else the chit's, else the chit's collection account (when
     * it has a UPI ID or bank details); otherwise the chit's own UPI ID. Null when there is nothing to pay into.
     */
    private PublicPayTo payTo(Detail d, HostedChitShare s, Organization t) {
        var c = d.chit();
        HostedChit chit = chits.findById(c.id()).orElseThrow();
        HostedChitMember m = s.getMemberId() == null ? null : members.findById(s.getMemberId()).orElse(null);
        Account a = java.util.stream.Stream.of(m == null ? null : m.getPayToAccountId(), chit.getPayToAccountId(), chit.getAccountId())
                .filter(Objects::nonNull).map(id -> accountRepo.findById(id).orElse(null))
                .filter(x -> x != null && Boolean.TRUE.equals(x.getActive()) && (x.getUpiId() != null || bankReady(x)))
                .findFirst().orElse(null);
        // a fellow member to pay directly: the winner of a month not yet paid out (set off against their payout)
        HostedChitMember to = m == null || m.getPayToMemberId() == null ? null : members.findById(m.getPayToMemberId())
                .filter(x -> (x.getUpiId() != null || x.getPhone() != null)
                        && d.schedule().stream().anyMatch(mo -> x.getId().equals(mo.winnerMemberId()) && mo.payoutDate() == null))
                .orElse(null);
        if (to != null) {
            a = null;
        }
        String upi = to != null ? to.getUpiId() : a != null ? a.getUpiId() : c.upiId();
        boolean bank = a != null && bankReady(a);
        if (upi == null && !bank && to == null) {
            return null;
        }
        String payee = to != null ? to.getName() : a != null && a.getHolderName() != null ? a.getHolderName() : c.payeeName() != null ? c.payeeName() : s.getCreatedByName();
        String toName = to == null ? null : to.getName();
        String toPhone = to == null ? null : to.getPhone();
        String signer = c.receiptSigner() != null ? c.receiptSigner() : c.payeeName() != null ? c.payeeName() : c.createdBy();
        LocalDateTime at = LocalDateTime.now().withNano(0);
        String holder = bank ? (a.getHolderName() != null ? a.getHolderName() : payee) : null;
        String bankName = bank ? a.getInstitution() : null;
        String number = bank ? a.getAccountNumber().trim() : null;
        String ifsc = bank ? a.getIfsc() : null;
        String seal = hmac(String.join("|", "PAYTO", String.valueOf(c.id()), String.valueOf(s.getMemberId()), String.valueOf(upi),
                String.valueOf(payee), String.valueOf(holder), String.valueOf(bankName), String.valueOf(number), String.valueOf(ifsc),
                String.valueOf(signer), c.receiptSignature() == null ? "" : HostedChitService.sha256(c.receiptSignature()), at.toString()));
        String stamp = t.getChitCompanyName() != null && !t.getChitCompanyName().isBlank() ? t.getChitCompanyName().trim() : t.getName();
        String payload = "{\"v\":1,\"kind\":\"PAY_TO\",\"pay\":" + payDetails(c.id(), s.getMemberId(), upi, payee, holder, bankName, number, ifsc, toName, toPhone)
                + ",\"chit\":" + q(c.name()) + ",\"member\":" + q(m == null ? null : m.getName()) + ",\"organiser\":" + q(stamp)
                + ",\"signer\":" + q(signer) + ",\"handSignature\":" + q(c.receiptSignature() == null ? null : HostedChitService.sha256(c.receiptSignature()))
                + ",\"issuedAt\":" + q(at.toString()) + ",\"validUntil\":" + q(String.valueOf(s.getExpiresAt())) + "}";
        return new PublicPayTo(upi, payee, holder, bankName, number, ifsc, signer, c.receiptSignature(), seal, at, stamp,
                payload, settings.signPayLink(payload), settings.payLinkPublicKey(), settings.payLinkFingerprint(), toName, toPhone);
    }

    /** The fingerprint of the key that signs payment details on member links (to give out, so members can compare). */
    public String keyFingerprint() {
        return settings.payLinkFingerprint();
    }

    /** The payment details part of the signed text: the same details always give the same text. */
    private static String payDetails(Long chitId, Long memberId, String upi, String payee, String holder, String bank, String number, String ifsc,
                                     String toMember, String toMemberPhone) {
        return "{\"chitId\":" + chitId + ",\"memberId\":" + memberId + ",\"upiId\":" + q(upi) + ",\"payee\":" + q(payee)
                + ",\"holder\":" + q(holder) + ",\"bank\":" + q(bank) + ",\"accountNumber\":" + q(number) + ",\"ifsc\":" + q(ifsc)
                + ",\"toMember\":" + q(toMember) + ",\"toMemberPhone\":" + q(toMemberPhone) + "}";
    }

    /** A JSON string (or null): quotes, backslashes and control characters escaped. */
    private static String q(String v) {
        if (v == null) {
            return "null";
        }
        StringBuilder b = new StringBuilder().append('"');
        for (char ch : v.toCharArray()) {
            if (ch == '"' || ch == (char) 92) {
                b.append((char) 92).append(ch);
            } else if (ch < 0x20) {
                b.append((char) 92).append('u').append(String.format("%04x", (int) ch));
            } else {
                b.append(ch);
            }
        }
        return b.append('"').toString();
    }

    /**
     * Checks the payment details a member's page shows: the signature must be this installation's over exactly that
     * text, and the details must still be the ones this member pays into (a changed account shows as no longer current).
     */
    public PayToCheck checkPayTo(String token, String payload, String signature) {
        HostedChitShare s = active(token);
        if (!MEMBER.equals(kind(s))) {
            throw new BusinessException("This link has no payment details");
        }
        boolean valid = settings.verifyPayLink(payload, signature);
        Organization tenant = tenant(s);
        PublicPayTo now = asTenant(tenant, () -> payTo(service.detail(s.getChitId()), s, tenant));
        boolean current = valid && now != null && payload.contains("\"pay\":" + payDetails(s.getChitId(), s.getMemberId(), now.upiId(),
                now.payeeName(), now.holderName(), now.bankName(), now.accountNumber(), now.ifsc(), now.toMember(), now.toMemberPhone()) + ",");
        String message = !valid ? "The signature does not match: these details were not issued by the organiser, or were changed. Do not pay into them."
                : !current ? "Signed by the organiser, but these are no longer the details to pay into. Open the link again for the current ones."
                : "Genuine: signed by the organiser and still the account to pay into.";
        return new PayToCheck(valid, current, settings.payLinkFingerprint(), message);
    }

    private static boolean bankReady(Account a) {
        return a.getAccountNumber() != null && !a.getAccountNumber().isBlank() && a.getIfsc() != null;
    }

    private String hmac(String content) {
        try {
            javax.crypto.Mac mac = javax.crypto.Mac.getInstance("HmacSHA256");
            mac.init(new javax.crypto.spec.SecretKeySpec(settings.receiptSigningKey(), "HmacSHA256"));
            return java.util.HexFormat.of().formatHex(mac.doFinal(content.getBytes(java.nio.charset.StandardCharsets.UTF_8)));
        } catch (java.security.GeneralSecurityException e) {
            throw new IllegalStateException(e);
        }
    }

    private static PublicMember publicMember(Detail d, Long memberId) {
        var c = d.chit();
        MemberView mv = d.members().stream().filter(m -> m.id().equals(memberId)).findFirst()
                .orElseThrow(() -> new BusinessException("This member is no longer in the chit"));
        List<PublicDue> dues = new ArrayList<>();
        BigDecimal dividends = Money.ZERO;
        BigDecimal nextAmount = null;
        LocalDate nextDate = null;
        BigDecimal payNow = Money.ZERO;
        for (MonthView m : d.schedule()) {
            BigDecimal due = dueFor(c, mv, m);
            BigDecimal paid = d.payments().stream().filter(p -> p.memberId().equals(mv.id()) && p.monthNo() == m.monthNo())
                    .map(PaymentView::amount).reduce(Money.ZERO, BigDecimal::add);
            BigDecimal late = d.lateFees().stream().filter(l -> l.memberId().equals(mv.id()) && l.monthNo() == m.monthNo())
                    .map(HostedChitService.LateFeeView::due).findFirst().orElse(Money.ZERO);
            String status = paid.compareTo(due) >= 0 ? "PAID" : paid.signum() > 0 ? "PARTIAL" : m.due() ? "PENDING" : "NOTDUE";
            dues.add(new PublicDue(m.monthNo(), m.dueDate(), due, paid, late, status));
            if (m.payoutDate() != null || m.bid() != null) dividends = dividends.add(Money.nz(m.dividend()));
            if (m.due()) payNow = payNow.add(due.subtract(paid).max(Money.ZERO)).add(late);
            if (nextDate == null && paid.compareTo(due) < 0 && !"COMPLETED".equals(m.status())) {
                nextDate = m.dueDate();
                nextAmount = due.subtract(paid);
            }
        }
        List<PublicPayment> paid = d.payments().stream().filter(p -> p.memberId().equals(mv.id()))
                .sorted(Comparator.comparing(PaymentView::paidDate).thenComparing(PaymentView::id))
                .map(p -> new PublicPayment(p.receiptNo(), p.paidDate(), p.monthNo(), p.amount(), Money.nz(p.lateFee()), p.mode(), p.reference()))
                .toList();
        MonthView won = mv.wonMonth() == null ? null : d.schedule().get(mv.wonMonth() - 1);
        return new PublicMember(mv.name(), mv.wonMonth(), won == null ? null : won.payout(), won == null ? null : won.payoutDate(),
                mv.totalPaid(), mv.balanceDue(), Money.nz(mv.lateFeeDue()), payNow, dividends, nextAmount, nextDate, dues, paid);
    }

    /** The member's due for a month, as the chit page works it out. */
    private static BigDecimal dueFor(HostedChitService.ChitView c, MemberView m, MonthView month) {
        if (HostedChit.TYPE_AUCTION.equals(c.chitType())) return c.installment().subtract(Money.nz(month.dividend()));
        return m.wonMonth() != null && m.wonMonth() < month.monthNo() ? c.installment().add(Money.nz(c.winnerExtraAmount())) : c.installment();
    }

    // ================================================================== helpers

    private HostedChitShare newShare(HostedChit c, String kind, HostedChitMember member, String token, int hours) {
        LocalDateTime now = LocalDateTime.now();
        HostedChitShare s = new HostedChitShare();
        s.setTenantId(c.getTenantId());
        s.setChitId(c.getId());
        s.setKind(kind);
        s.setMemberId(member == null ? null : member.getId());
        s.setTokenHash(AccessLinkService.hash(token));
        s.setCreatedByName(UserContext.get().fullName());
        s.setCreatedAt(now);
        s.setExpiresAt(now.plusHours(hours));
        s.setViews(0);
        return s;
    }

    private String token() {
        byte[] bytes = new byte[24];
        random.nextBytes(bytes);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }

    private HostedChitShare active(String token) {
        HostedChitShare s = token == null || token.isBlank() ? null : shares.findByTokenHash(AccessLinkService.hash(token.trim())).orElse(null);
        if (s == null) {
            throw new BusinessException("This link is not valid");
        }
        if (s.getRevokedAt() != null) {
            throw new BusinessException("This link was switched off");
        }
        if (!s.getExpiresAt().isAfter(LocalDateTime.now())) {
            throw new BusinessException("This link has expired. Ask for a new one.");
        }
        return s;
    }

    private Organization tenant(HostedChitShare s) {
        return tenants.findById(s.getTenantId()).filter(t -> Boolean.TRUE.equals(t.getActive()))
                .orElseThrow(() -> new BusinessException("This chit is no longer shared"));
    }

    private static <T> T asTenant(Organization tenant, Supplier<T> work) {
        CurrentUser previous = UserContext.current().orElse(null);
        UserContext.set(new CurrentUser(null, "share", "Chit link", UserRole.VIEWER, tenant.getId(), tenant.getCode(),
                tenant.getName(), tenant.getCurrency(), Feature.all(), false));
        try {
            return work.get();
        } finally {
            if (previous != null) {
                UserContext.set(previous);
            } else {
                UserContext.clear();
            }
        }
    }

    private static String kind(HostedChitShare s) {
        return s.getKind() != null ? s.getKind() : s.getMemberId() == null ? CHIT : MEMBER;
    }

    private ShareView view(HostedChitShare s) {
        LocalDateTime now = LocalDateTime.now();
        String status = s.getRevokedAt() != null ? "REVOKED" : s.getExpiresAt().isAfter(now) ? "ACTIVE" : "EXPIRED";
        String memberName = s.getMemberId() == null ? null : members.findById(s.getMemberId()).map(HostedChitMember::getName).orElse(null);
        return new ShareView(s.getId(), s.getChitId(), kind(s), s.getMemberId(), memberName, s.getPaymentId(), s.getAgreementId(),
                s.getSharedWith(), Boolean.TRUE.equals(s.getShowEarnings()), s.getMessage(), s.getCreatedByName(), s.getCreatedAt(),
                s.getExpiresAt(), s.getRevokedAt(), Objects.requireNonNullElse(s.getViews(), 0), s.getLastViewedAt(), status);
    }

    private HostedChit chit(Long id) {
        return chits.findByIdAndTenantId(id, UserContext.tenantId()).orElseThrow(() -> new NotFoundException("Hosted chit", id));
    }

    private HostedChitMember member(Long chitId, Long memberId) {
        return members.findById(memberId).filter(m -> m.getChitId().equals(chitId)).orElseThrow(() -> new NotFoundException("Member", memberId));
    }

    private static String days(int hours) {
        return hours % 24 == 0 ? (hours / 24) + (hours == 24 ? " day" : " days") : hours + " hours";
    }

    private static String blank(String s) {
        return s == null || s.isBlank() ? null : s.trim();
    }
}
