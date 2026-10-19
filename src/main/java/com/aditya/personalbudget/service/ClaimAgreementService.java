package com.aditya.personalbudget.service;

import com.aditya.personalbudget.domain.entity.ClaimAgreement;
import com.aditya.personalbudget.domain.entity.Organization;
import com.aditya.personalbudget.domain.type.ClaimKind;
import com.aditya.personalbudget.domain.type.Feature;
import com.aditya.personalbudget.domain.type.UserRole;
import com.aditya.personalbudget.dto.ClaimDtos.ClaimView;
import com.aditya.personalbudget.exception.BusinessException;
import com.aditya.personalbudget.exception.NotFoundException;
import com.aditya.personalbudget.repository.ClaimAgreementRepository;
import com.aditya.personalbudget.repository.OrganizationRepository;
import com.aditya.personalbudget.security.CurrentUser;
import com.aditya.personalbudget.security.UserContext;
import com.aditya.personalbudget.service.AttachmentService.AgreementFile;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.PositiveOrZero;
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
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.function.Supplier;
import java.util.stream.Collectors;

/**
 * Loan agreements for money lent (see {@link ClaimAgreement}).
 * <p>
 * <b>Making it.</b> The lender makes the agreement from the item: the figures come from it (amount, date, due date,
 * interest), the wording is generated (with any extra terms) and fixed with a SHA-256 fingerprint. While it waits for
 * the borrower it can be made again; once accepted or signed it is a record and only its stamp-paper details
 * (stamp, signatures, witness) change.
 * <p>
 * <b>The link.</b> A secret link (only a hash of the token is kept, the token stays in the address fragment) that
 * works for at most 30 days and can be stopped any time. Opening it shows nothing but the lender's name and a hint of
 * the borrower's mobile number until the borrower types that number; every later step sends it again. Five wrong
 * numbers lock the link: the lender makes a new one.
 * <p>
 * <b>Evidence.</b> The borrower adds a photo of their Aadhaar card and a live selfie from the camera (as the lender
 * asks), types their Aadhaar number (checked with its Verhoeff digit; only the last 4 digits and a salted hash are
 * kept), signs with a finger and accepts. The time, IP address, browser, device details, location (if allowed) and the
 * SHA-256 of every file are sealed together, and the evidence is digitally signed with this installation's key
 * (ECDSA P-256), so the borrower's copy and the printed deed can be checked at any time.
 */
@Service
public class ClaimAgreementService {

    public static final String FILES = "LOAN_AGREEMENT";
    private static final String AREA = "Money owed";
    public static final int MAX_LINK_HOURS = 24 * 30;
    static final int MAX_ATTEMPTS = 5;
    private static final DateTimeFormatter DAY = DateTimeFormatter.ofPattern("dd MMM yyyy");

    // ================================================================== requests

    /** The agreement's parties and conditions (the figures come from the item). */
    public record AgreementRequest(@Size(max = 100) String lenderName, @Size(max = 150) String lenderAddress,
                                   @Size(max = 100) String borrowerName, @Size(max = 20) String borrowerPhone,
                                   @Size(max = 150) String borrowerAddress, @Size(max = 60) String place,
                                   @PositiveOrZero BigDecimal stampDuty, @Size(max = 40) String stampSerial,
                                   @Size(max = 100) String witnessName, @Size(max = 20) String witnessPhone,
                                   @Size(max = 150) String witnessAddress,
                                   Boolean requireAadhaar, Boolean requireSelfie, Boolean requireLocation,
                                   @Size(max = 1500) String extraTerms) {
    }

    /** The stamp-paper copy: signatures drawn on the lender's device, the stamp and the witness. */
    public record PaperRequest(@Size(max = 20000) String lenderSignature, @Size(max = 20000) String witnessSignature,
                               Boolean clearLenderSignature, Boolean clearWitnessSignature,
                               @PositiveOrZero BigDecimal stampDuty, @Size(max = 40) String stampSerial,
                               @Size(max = 100) String witnessName, @Size(max = 20) String witnessPhone,
                               @Size(max = 150) String witnessAddress) {
    }

    public record LinkRequest(@Min(1) @Max(MAX_LINK_HOURS) int hours) {
    }

    public record SignedRequest(@Size(max = 100) String name) {
    }

    /** Opening the link: the borrower's mobile number (nothing is shown without it). */
    public record OpenRequest(@Size(max = 20) String phone) {
    }

    public record AcceptRequest(@Size(max = 20) String phone, @Size(min = 2, max = 100) String name, Boolean agree,
                                @Size(max = 20) String aadhaarNumber, @Size(max = 20000) String signature,
                                @Size(max = 100) String location, @Size(max = 2000) String device) {
    }

    // ================================================================== views

    /** linkStatus: NONE, ACTIVE, EXPIRED, REVOKED or LOCKED. */
    public record AgreementView(Long id, Long claimId, String agreementNo, String status,
                                String lenderName, String lenderAddress, String borrowerName, String borrowerPhone, String borrowerAddress,
                                BigDecimal amount, String amountInWords, LocalDate loanDate, LocalDate dueDate, BigDecimal interestRate,
                                String interestTerms, String place, String terms, String contentHash,
                                BigDecimal stampDuty, String stampSerial, String lenderSignature,
                                String witnessName, String witnessPhone, String witnessAddress, String witnessSignature,
                                boolean requireAadhaar, boolean requireSelfie, boolean requireLocation,
                                String linkStatus, LocalDateTime linkExpiresAt, int views, LocalDateTime lastViewedAt,
                                int failedAttempts, LocalDateTime lockedAt,
                                String acceptedName, LocalDateTime acceptedAt, String acceptedPhone, Boolean phoneMatches,
                                String acceptedIp, String acceptedUserAgent, String acceptedDevice, String deviceHash,
                                String acceptedLocation, String signature, String aadhaarLast4, String acceptanceSeal,
                                String evidencePayload, String digitalSignature, String publicKey, String keyFingerprint,
                                List<AgreementFile> files, String createdBy, LocalDateTime createdAt) {
    }

    /** A new link: the token is returned this once. */
    public record CreatedLink(AgreementView agreement, String token) {
    }

    /**
     * What the borrower sees. step VERIFY: only who it is from and a hint of the number to type (error: why the number
     * was not accepted); OPEN: the agreement to accept; DONE: accepted or signed.
     */
    public record PublicAgreement(String step, String error, Integer attemptsLeft, String household, String lenderName,
                                  String borrowerHint, String phoneHint, String agreementNo, LocalDateTime expiresAt,
                                  // ---- once the number is verified
                                  String borrowerName, String borrowerAddress, String lenderAddress, BigDecimal amount,
                                  String amountInWords, LocalDate loanDate, LocalDate dueDate, BigDecimal interestRate,
                                  String interestTerms, String place, String terms, String contentHash, String currency,
                                  BigDecimal stampDuty, String stampSerial, String lenderSignature, String witnessName,
                                  String witnessSignature, boolean requireAadhaar, boolean requireSelfie, boolean requireLocation,
                                  List<String> kycDocs, String status, String acceptedName, LocalDateTime acceptedAt,
                                  String signature, String aadhaarLast4, String acceptanceSeal, boolean locationShared,
                                  String evidencePayload, String digitalSignature, String publicKey, String keyFingerprint,
                                  LocalDateTime createdAt) {
    }

    /** A wrong number on the link: counted (and kept) even though the request fails. */
    static final class VerificationFailed extends BusinessException {
        VerificationFailed(String message) {
            super(message);
        }
    }

    private final ClaimAgreementRepository agreements;
    private final ClaimService claims;
    private final AttachmentService files;
    private final AppSettingsService settings;
    private final OrganizationRepository tenants;
    private final ActivityService activity;
    private final SecureRandom random = new SecureRandom();

    public ClaimAgreementService(ClaimAgreementRepository agreements, ClaimService claims, AttachmentService files,
                                 AppSettingsService settings, OrganizationRepository tenants, ActivityService activity) {
        this.agreements = agreements;
        this.claims = claims;
        this.files = files;
        this.settings = settings;
        this.tenants = tenants;
        this.activity = activity;
    }

    // ================================================================== the lender's side

    /** The item's agreement (the latest), or null. */
    public AgreementView get(Long claimId) {
        claims.get(claimId);   // the item is the household's
        return latest(claimId).map(this::view).orElse(null);
    }

    /** Makes the agreement, or remakes it while it waits for the borrower (the figures follow the item). */
    @Transactional
    public AgreementView save(Long claimId, AgreementRequest r) {
        ClaimView c = claims.get(claimId);
        if (c.kind() != ClaimKind.LENT && c.kind() != ClaimKind.PAID_FOR) {
            throw new BusinessException("Agreements are for money you lent or paid on someone's behalf");
        }
        ClaimAgreement a = latest(claimId).orElse(null);
        if (a != null && !ClaimAgreement.DRAFT.equals(a.getStatus())) {
            throw new BusinessException("The agreement " + a.getAgreementNo() + " is already " + a.getStatus().toLowerCase()
                    + "; it is kept as it is. Only its stamp-paper details can change");
        }
        boolean fresh = a == null;
        if (fresh) {
            a = new ClaimAgreement();
            a.setTenantId(UserContext.tenantId());
            a.setClaimId(claimId);
            a.setAgreementNo("LA-pending");
            a.setTerms("pending");
            a.setContentHash("pending");
            a.setStatus(ClaimAgreement.DRAFT);
            a.setCreatedBy(UserContext.username());
            a.setCreatedAt(LocalDateTime.now());
            a.setViews(0);
            a.setFailedAttempts(0);
        }
        a.setLenderName(blank(r.lenderName()) != null ? r.lenderName().trim() : UserContext.get().fullName());
        a.setLenderAddress(blank(r.lenderAddress()));
        a.setBorrowerName(blank(r.borrowerName()) != null ? r.borrowerName().trim() : c.party());
        String phone = blank(r.borrowerPhone()) == null ? null : HostedChitService.cleanPhone(r.borrowerPhone(), "The borrower");
        if (phone != null && a.getTokenHash() != null && !phone.equals(a.getBorrowerPhone())) {
            a.setLinkRevokedAt(LocalDateTime.now());   // the old link was for another number
        }
        a.setBorrowerPhone(phone);
        a.setBorrowerAddress(blank(r.borrowerAddress()));
        a.setPlace(blank(r.place()));
        a.setStampDuty(r.stampDuty() == null || r.stampDuty().signum() == 0 ? null : Money.round(r.stampDuty()));
        a.setStampSerial(blank(r.stampSerial()));
        a.setWitnessName(blank(r.witnessName()));
        a.setWitnessPhone(blank(r.witnessPhone()) == null ? null : HostedChitService.cleanPhone(r.witnessPhone(), "The witness"));
        a.setWitnessAddress(blank(r.witnessAddress()));
        a.setRequireAadhaar(r.requireAadhaar() == null || r.requireAadhaar());
        a.setRequireSelfie(r.requireSelfie() == null || r.requireSelfie());
        a.setRequireLocation(Boolean.TRUE.equals(r.requireLocation()));
        a.setAmount(c.amount());
        a.setLoanDate(c.startDate());
        a.setDueDate(c.dueDate());
        boolean rate = c.interestRate() != null && c.interestRate().signum() > 0;
        a.setInterestRate(rate ? c.interestRate() : null);
        a.setInterestTerms(rate ? ActivityService.cut(c.interestTypeLabel() + " · " + String.valueOf(c.interestCollectionLabel()).toLowerCase(), 60) : null);
        a = agreements.save(a);
        if (fresh) a.setAgreementNo(String.format("LA-%06d", a.getId()));
        a.setTerms(ActivityService.cut(terms(a, c, blank(r.extraTerms())), 6000));
        a.setContentHash(HostedChitService.sha256(String.join("|", a.getAgreementNo(), a.getLenderName(), a.getBorrowerName(),
                a.getAmount().toPlainString(), String.valueOf(a.getLoanDate()), String.valueOf(a.getDueDate()),
                String.valueOf(a.getInterestRate()), a.getTerms())));
        agreements.save(a);
        activity.record(fresh ? "ADDED" : "CHANGED", AREA, (fresh ? "Made the loan agreement " : "Updated the loan agreement ") + a.getAgreementNo()
                + " · " + a.getBorrowerName() + " · " + ActivityService.money(a.getAmount()));
        return view(a);
    }

    /** Stamp, signatures and witness of the printed copy; allowed after acceptance (they are not part of the wording). */
    @Transactional
    public AgreementView paper(Long claimId, PaperRequest r) {
        ClaimAgreement a = require(claimId);
        if (r.stampDuty() != null) a.setStampDuty(r.stampDuty().signum() > 0 ? Money.round(r.stampDuty()) : null);
        if (r.stampSerial() != null) a.setStampSerial(blank(r.stampSerial()));
        if (r.witnessName() != null) a.setWitnessName(blank(r.witnessName()));
        if (r.witnessPhone() != null) a.setWitnessPhone(blank(r.witnessPhone()) == null ? null : HostedChitService.cleanPhone(r.witnessPhone(), "The witness"));
        if (r.witnessAddress() != null) a.setWitnessAddress(blank(r.witnessAddress()));
        if (Boolean.TRUE.equals(r.clearLenderSignature())) a.setLenderSignature(null);
        else if (blank(r.lenderSignature()) != null) a.setLenderSignature(HostedChitService.drawn(r.lenderSignature(), "your signature"));
        if (Boolean.TRUE.equals(r.clearWitnessSignature())) a.setWitnessSignature(null);
        else if (blank(r.witnessSignature()) != null) {
            if (a.getWitnessName() == null) throw new BusinessException("Enter the witness's name with their signature");
            a.setWitnessSignature(HostedChitService.drawn(r.witnessSignature(), "the witness's signature"));
        }
        agreements.save(a);
        activity.record("CHANGED", AREA, "Stamp-paper details of " + a.getAgreementNo() + " · " + a.getBorrowerName()
                + (a.getLenderSignature() != null ? " · signed by me" : "") + (a.getWitnessSignature() != null ? " · witnessed" : ""));
        return view(a);
    }

    /** A new secret link for the borrower (an older one stops working). */
    @Transactional
    public CreatedLink link(Long claimId, LinkRequest r) {
        ClaimAgreement a = require(claimId);
        if (!ClaimAgreement.DRAFT.equals(a.getStatus())) {
            throw new BusinessException("The agreement is already " + a.getStatus().toLowerCase() + "; share a copy from the item instead");
        }
        if (a.getBorrowerPhone() == null) {
            throw new BusinessException("Add " + a.getBorrowerName() + "'s mobile number first: they type it to open the link");
        }
        byte[] bytes = new byte[32];
        random.nextBytes(bytes);
        String token = Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
        LocalDateTime now = LocalDateTime.now();
        a.setTokenHash(AccessLinkService.hash(token));
        a.setLinkExpiresAt(now.plusHours(Math.min(r.hours(), MAX_LINK_HOURS)));
        a.setLinkRevokedAt(null);
        a.setFailedAttempts(0);
        a.setLockedAt(null);
        a.setViews(0);
        a.setLastViewedAt(null);
        agreements.save(a);
        activity.record("ADDED", AREA, "Sent the loan agreement " + a.getAgreementNo() + " to " + a.getBorrowerName() + " · link for "
                + (r.hours() % 24 == 0 ? r.hours() / 24 + " days" : r.hours() + " hours"));
        return new CreatedLink(view(a), token);
    }

    @Transactional
    public AgreementView revokeLink(Long claimId) {
        ClaimAgreement a = require(claimId);
        if (a.getTokenHash() != null && a.getLinkRevokedAt() == null) {
            a.setLinkRevokedAt(LocalDateTime.now());
            agreements.save(a);
            activity.record("REVOKED", AREA, "Stopped the agreement link of " + a.getAgreementNo() + " · " + a.getBorrowerName());
        }
        return view(a);
    }

    /** The borrower signed a printed copy, recorded by the lender. */
    @Transactional
    public AgreementView signedOnPaper(Long claimId, SignedRequest r) {
        ClaimAgreement a = require(claimId);
        if (!ClaimAgreement.DRAFT.equals(a.getStatus())) {
            throw new BusinessException("This agreement is already " + a.getStatus().toLowerCase());
        }
        a.setStatus(ClaimAgreement.SIGNED);
        a.setAcceptedName(blank(r.name()) != null ? ActivityService.cut(r.name().trim(), 100) : a.getBorrowerName());
        a.setAcceptedAt(LocalDateTime.now());
        a.setAcceptedUserAgent("Signed in person on paper, recorded by " + UserContext.get().fullName());
        a.setLinkRevokedAt(a.getTokenHash() != null && a.getLinkRevokedAt() == null ? LocalDateTime.now() : a.getLinkRevokedAt());
        agreements.save(a);
        activity.record("CHANGED", AREA, "Loan agreement signed on paper · " + a.getAgreementNo() + " · " + a.getBorrowerName());
        return view(a);
    }

    @Transactional
    public void delete(Long claimId) {
        ClaimAgreement a = require(claimId);
        if (!ClaimAgreement.DRAFT.equals(a.getStatus())) {
            throw new BusinessException("An accepted or signed agreement is kept as a record and cannot be deleted");
        }
        files.deleteAllForAgreement(FILES, a.getId());
        agreements.deleteById(a.getId());
        activity.record("DELETED", AREA, "Deleted the loan agreement " + a.getAgreementNo() + " · " + a.getBorrowerName());
    }

    /** The lender adds the borrower's Aadhaar, PAN or photo themselves (while it waits for the borrower). */
    @Transactional
    public AgreementView addFile(Long claimId, String docType, String name, byte[] bytes, String source) {
        ClaimAgreement a = require(claimId);
        requireDraft(a);
        AgreementFile f = files.addToAgreement(FILES, a.getId(), docType, name, bytes, source, "loan agreement " + a.getAgreementNo());
        activity.record("ADDED", AREA, "Added " + f.docType().replace('_', ' ').toLowerCase() + " to " + a.getAgreementNo());
        return view(a);
    }

    @Transactional
    public AgreementView deleteFile(Long claimId, Long fileId) {
        ClaimAgreement a = require(claimId);
        requireDraft(a);
        files.deleteFromAgreement(FILES, a.getId(), fileId);
        return view(a);
    }

    public AttachmentService.FileContent file(Long claimId, Long fileId, boolean thumb) {
        return files.agreementFileContent(FILES, require(claimId).getId(), fileId, thumb);
    }

    // ================================================================== the borrower's side (no sign-in)

    /** Opens the link: without the right mobile number only who it is from and a hint. */
    @Transactional(noRollbackFor = VerificationFailed.class)
    public PublicAgreement open(String token, OpenRequest r) {
        ClaimAgreement a = active(token);
        Organization tenant = tenant(a);
        a.setViews((a.getViews() == null ? 0 : a.getViews()) + 1);
        a.setLastViewedAt(LocalDateTime.now());
        agreements.save(a);
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

    /** The borrower adds their Aadhaar card (front or back), PAN card or a live selfie. */
    @Transactional(noRollbackFor = VerificationFailed.class)
    public PublicAgreement addKyc(String token, String phone, String docType, String name, byte[] bytes) {
        ClaimAgreement a = active(token);
        verify(a, phone);
        if (!ClaimAgreement.DRAFT.equals(a.getStatus())) {
            throw new BusinessException("This agreement is already accepted");
        }
        String type = docType == null ? "" : docType.trim().toUpperCase();
        if (!Set.of("AADHAAR_FRONT", "AADHAAR_BACK", "PAN", "SELFIE").contains(type)) {
            throw new BusinessException("Add your Aadhaar card, PAN card or a selfie");
        }
        Organization tenant = tenant(a);
        return asTenant(tenant, () -> {
            AgreementFile f = files.addToAgreement(FILES, a.getId(), type, name, bytes, "SELFIE".equals(type) ? "CAMERA" : "UPLOAD", "loan agreement " + a.getAgreementNo());
            activity.record(linkUser(tenant, a.getBorrowerName()), "ADDED", AREA, a.getBorrowerName() + " added "
                    + f.docType().replace('_', ' ').toLowerCase() + " to " + a.getAgreementNo(), "POST", "/public/loan-agreements");
            return full(a, tenant);
        });
    }

    /** The borrower accepts: the evidence is checked, sealed and digitally signed. */
    @Transactional(noRollbackFor = VerificationFailed.class)
    public PublicAgreement accept(String token, AcceptRequest r, String ip, String userAgent) {
        ClaimAgreement a = active(token);
        String phone = verify(a, r.phone());
        if (!ClaimAgreement.DRAFT.equals(a.getStatus())) {
            throw new BusinessException("This agreement was already accepted on " + a.getAcceptedAt().format(DAY));
        }
        if (!Boolean.TRUE.equals(r.agree())) {
            throw new BusinessException("Tick the box to confirm you have read and accept the agreement");
        }
        String name = r.name() == null ? "" : r.name().trim().replaceAll("\\s+", " ");
        if (name.length() < 2) {
            throw new BusinessException("Type your full name as on your Aadhaar card");
        }
        String signature = HostedChitService.drawn(r.signature(), "your signature with your finger");
        Organization tenant = tenant(a);
        List<AgreementFile> kyc = asTenant(tenant, () -> files.listForAgreement(FILES, a.getId()));
        Set<String> have = kyc.stream().map(AgreementFile::docType).collect(Collectors.toSet());
        String aadhaar = null;
        if (Boolean.TRUE.equals(a.getRequireAadhaar())) {
            if (!have.contains("AADHAAR_FRONT")) throw new BusinessException("Add a photo of your Aadhaar card (the side with your photo)");
            aadhaar = Kyc.aadhaar(r.aadhaarNumber());
        } else if (blank(r.aadhaarNumber()) != null) {
            aadhaar = Kyc.aadhaar(r.aadhaarNumber());
        }
        if (Boolean.TRUE.equals(a.getRequireSelfie()) && !have.contains("SELFIE")) {
            throw new BusinessException("Take a selfie with your phone's front camera");
        }
        String location = r.location() == null || r.location().isBlank() ? null : r.location().trim();
        if (location != null && !location.matches("-?\\d{1,3}(\\.\\d+)?,-?\\d{1,3}(\\.\\d+)?(,\\d+(\\.\\d+)?)?")) {
            location = null;
        }
        if (Boolean.TRUE.equals(a.getRequireLocation()) && location == null) {
            throw new BusinessException("Allow your location when your phone asks: " + a.getLenderName() + " needs it with the agreement");
        }
        String device = r.device() == null ? null : ActivityService.cut(r.device(), 2000);
        LocalDateTime now = LocalDateTime.now().withNano(0);
        a.setStatus(ClaimAgreement.ACCEPTED);
        a.setAcceptedName(ActivityService.cut(name, 100));
        a.setAcceptedAt(now);
        a.setAcceptedPhone(phone);
        a.setPhoneMatches(true);
        a.setAcceptedIp(ActivityService.cut(ip, 64));
        a.setAcceptedUserAgent(userAgent == null ? null : ActivityService.cut(userAgent, 255));
        a.setAcceptedDevice(device);
        a.setDeviceHash(device == null ? null : HostedChitService.sha256(device));
        a.setAcceptedLocation(location);
        a.setSignature(signature);
        if (aadhaar != null) {
            a.setAadhaarLast4(aadhaar.substring(8));
            a.setAadhaarHash(Kyc.hash(a.getContentHash(), aadhaar));
        }
        String fileHashes = kyc.stream().map(f -> f.docType() + ":" + f.sha256()).collect(Collectors.joining(","));
        a.setAcceptanceSeal(HostedChitService.sha256(String.join("|", a.getContentHash(), name, phone, now.toString(), String.valueOf(ip),
                String.valueOf(userAgent), String.valueOf(a.getDeviceHash()), String.valueOf(location), HostedChitService.sha256(signature),
                String.valueOf(a.getAadhaarHash()), fileHashes)));
        Map<String, Object> ev = new LinkedHashMap<>();
        ev.put("v", 1);
        ev.put("kind", "LOAN_AGREEMENT_ACCEPTANCE");
        ev.put("agreementNo", a.getAgreementNo());
        ev.put("contentHash", a.getContentHash());
        ev.put("lender", a.getLenderName());
        ev.put("borrower", a.getBorrowerName());
        ev.put("amount", a.getAmount());
        ev.put("acceptedName", name);
        ev.put("phoneLast4", phone.substring(6));
        ev.put("acceptedAt", now.toString());
        ev.put("ip", ip);
        ev.put("userAgentHash", userAgent == null ? null : HostedChitService.sha256(userAgent));
        ev.put("deviceHash", a.getDeviceHash());
        ev.put("location", location);
        ev.put("signatureHash", HostedChitService.sha256(signature));
        ev.put("aadhaarLast4", a.getAadhaarLast4());
        ev.put("files", kyc.stream().map(f -> {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("type", f.docType());
            m.put("sha256", f.sha256());
            m.put("at", f.createdAt() == null ? null : f.createdAt().withNano(0).toString());
            return m;
        }).toList());
        ev.put("seal", a.getAcceptanceSeal());
        a.setEvidencePayload(ActivityService.cut(Kyc.json(ev), 4000));
        a.setDigitalSignature(settings.signPayLink(a.getEvidencePayload()));
        agreements.save(a);
        return asTenant(tenant, () -> {
            activity.record(linkUser(tenant, name), "ACCEPTED", AREA, "Loan agreement " + a.getAgreementNo() + " accepted by " + name
                    + " · " + ActivityService.money(a.getAmount()), "POST", "/public/loan-agreements");
            return full(a, tenant);
        });
    }

    // ================================================================== helpers

    /**
     * The standard wording, with the figures filled in: numbered clauses, each "HEADING: text" (the deed shows the
     * heading in bold), in the form of an Indian loan agreement / acknowledgement of debt.
     */
    private static String terms(ClaimAgreement a, ClaimView c, String extra) {
        String rupees = ActivityService.money(a.getAmount()) + " (Rupees " + HostedChitService.inWords(a.getAmount()).replaceFirst("(?i)^rupees\\s+", "")
                .replaceFirst("(?i)\\s+only$", "") + " only)";
        String mode = switch (String.valueOf(c.paidFromType())) {
            case "BANK" -> " by bank transfer";
            case "CASH" -> " in cash";
            case "WALLET" -> " by UPI";
            case "CREDIT_CARD" -> " by card";
            default -> "";
        };
        boolean interest = a.getInterestRate() != null;
        String due = a.getDueDate() != null ? a.getDueDate().format(DAY) : null;
        String place = a.getPlace() != null && !a.getPlace().isBlank() ? a.getPlace().trim() : null;
        List<String> t = new ArrayList<>();
        if (c.kind() == ClaimKind.PAID_FOR) {
            t.add("ACKNOWLEDGEMENT OF DEBT: The Borrower acknowledges that on " + a.getLoanDate().format(DAY) + " the Lender paid a sum of " + rupees
                    + " on behalf of and at the request of the Borrower towards " + c.narration() + mode
                    + " (the \"Amount\"), and that the Amount is a debt lawfully due and payable by the Borrower to the Lender.");
        } else {
            t.add("LOAN: The Lender has advanced to the Borrower, and the Borrower has received from the Lender, a sum of " + rupees + " (the \"Amount\") on "
                    + a.getLoanDate().format(DAY) + mode + ", the receipt of which in full the Borrower hereby admits and acknowledges.");
        }
        t.add(interest
                ? "INTEREST: The Amount shall carry interest at the rate of " + a.getInterestRate().stripTrailingZeros().toPlainString()
                    + "% per annum (" + String.valueOf(c.interestTypeLabel()).toLowerCase() + "), payable " + String.valueOf(c.interestCollectionLabel()).toLowerCase()
                    + ", from the date on which the Amount was advanced until the date of its repayment in full."
                : "INTEREST: The Amount shall not carry any interest" + (due != null ? ", provided it is repaid in full on or before the Due Date." : "."));
        t.add("REPAYMENT: The Borrower shall repay the Amount" + (interest ? " together with all interest accrued thereon" : "")
                + (due != null ? " on or before " + due + " (the \"Due Date\")." : " within thirty (30) days of a demand made by the Lender, orally or in writing."));
        t.add("PREPAYMENT AND APPROPRIATION: The Borrower may repay the Amount earlier, in full or in parts, without any charge. Every payment received shall be "
                + "appropriated first towards interest, if any, then due, and thereafter towards the Amount.");
        t.add("MODE OF PAYMENT AND ACCOUNTS: All payments shall be made by bank transfer, UPI, cheque or cash against a written or electronic receipt. "
                + "The account of the Amount maintained by the Lender shall, in the absence of manifest error, be evidence of the sums due.");
        t.add("DEFAULT: If the Borrower fails to pay any sum on the date it falls due, or any statement made by the Borrower in this Agreement is found to be "
                + "untrue, the whole of the Amount then outstanding" + (interest ? ", with interest," : "") + " shall, at the option of the Lender, "
                + "become immediately due and payable.");
        t.add("RECOVERY: Upon default, the Lender shall be entitled to recover from the Borrower the Amount outstanding" + (interest ? " with interest" : "")
                + ", together with the reasonable costs of recovery, by all lawful means, including proceedings before a court of competent jurisdiction.");
        t.add("REPRESENTATIONS: The Borrower represents that he or she is a major, of sound mind and competent to contract, and that the proof of identity, "
                + "photograph and particulars furnished with this Agreement are true, correct and belong to the Borrower.");
        t.add("ELECTRONIC EXECUTION AND EVIDENCE: The parties agree that this Agreement may be accepted electronically. The verification of the Borrower's "
                + "mobile number, the Borrower's signature and photograph, the details of the device used and the digitally signed record of acceptance "
                + "shall constitute valid evidence of its execution, in accordance with the Information Technology Act, 2000 and the Bharatiya Sakshya "
                + "Adhiniyam, 2023.");
        t.add("NOTICES: Any notice under this Agreement may be given at the address or mobile number of the party stated herein, including by SMS, "
                + "WhatsApp or e-mail, and shall be deemed received on the day it is sent.");
        if (extra != null) {
            for (String line : extra.split("\\R")) {
                if (!line.isBlank()) t.add("ADDITIONAL TERM: " + line.trim());
            }
        }
        t.add("GOVERNING LAW AND JURISDICTION: This Agreement shall be governed by the laws of India. "
                + (place != null ? "The courts at " + place + " shall have exclusive jurisdiction" : "The courts having jurisdiction over the place where this Agreement is executed shall have exclusive jurisdiction")
                + " in all matters arising out of it.");
        t.add("ENTIRE AGREEMENT AND SEVERABILITY: This Agreement records the entire understanding of the parties on its subject and may be amended only in "
                + "writing signed by both parties. If any provision is held invalid, the remaining provisions shall continue in full force.");
        t.add("STAMP DUTY: The stamp duty payable on this Agreement shall be borne by the Borrower, unless the parties agree otherwise.");
        t.add("DECLARATION: The Borrower declares that he or she has read this Agreement, or has had it read over and explained "
                + "in a language he or she understands, has understood its contents, and has executed it freely and voluntarily, without any coercion, "
                + "undue influence or misrepresentation.");
        StringBuilder out = new StringBuilder();
        for (int i = 0; i < t.size(); i++) out.append(i + 1).append(". ").append(t.get(i)).append(i + 1 < t.size() ? "\n" : "");
        return out.toString();
    }

    /** The number must be the borrower's; wrong numbers are counted and, after too many, lock the link. Returns the 10 digits. */
    private String verify(ClaimAgreement a, String typed) {
        if (a.getLockedAt() != null) {
            throw new BusinessException("This link is locked after too many wrong numbers. Ask " + a.getLenderName() + " for a new link.");
        }
        String digits = typed == null ? "" : typed.replaceAll("\\D", "");
        if (digits.length() > 10 && digits.startsWith("91")) digits = digits.substring(digits.length() - 10);
        if (!digits.matches("[6-9]\\d{9}")) {
            throw new BusinessException("Enter your 10-digit mobile number");
        }
        if (!digits.equals(a.getBorrowerPhone())) {
            int failed = (a.getFailedAttempts() == null ? 0 : a.getFailedAttempts()) + 1;
            a.setFailedAttempts(failed);
            if (failed >= MAX_ATTEMPTS) a.setLockedAt(LocalDateTime.now());
            agreements.save(a);
            throw new VerificationFailed(failed >= MAX_ATTEMPTS
                    ? "That is not the number this agreement was sent to. The link is now locked: ask " + a.getLenderName() + " for a new one."
                    : "That is not the number this agreement was sent to (" + (MAX_ATTEMPTS - failed) + " tr" + (MAX_ATTEMPTS - failed == 1 ? "y" : "ies") + " left)");
        }
        return digits;
    }

    private PublicAgreement gate(ClaimAgreement a, Organization t, String error) {
        int left = MAX_ATTEMPTS - (a.getFailedAttempts() == null ? 0 : a.getFailedAttempts());
        String hint = a.getBorrowerName() == null ? null : java.util.Arrays.stream(a.getBorrowerName().split("\\s+"))
                .map(w -> w.isEmpty() ? w : w.charAt(0) + "•••").collect(Collectors.joining(" "));
        String phoneHint = a.getBorrowerPhone() == null ? null : "••••••" + a.getBorrowerPhone().substring(6);
        return new PublicAgreement("VERIFY", error, Math.max(0, left), t.getName(), a.getLenderName(), hint, phoneHint, a.getAgreementNo(),
                a.getLinkExpiresAt(), null, null, null, null, null, null, null, null, null, null, null, null, t.getCurrency(), null, null,
                null, null, null, Boolean.TRUE.equals(a.getRequireAadhaar()), Boolean.TRUE.equals(a.getRequireSelfie()),
                Boolean.TRUE.equals(a.getRequireLocation()), List.of(), a.getStatus(), null, null, null, null, null, false, null, null,
                null, null, null);
    }

    private PublicAgreement full(ClaimAgreement a, Organization t) {
        List<String> docs = files.listForAgreement(FILES, a.getId()).stream().map(AgreementFile::docType).distinct().toList();
        boolean done = !ClaimAgreement.DRAFT.equals(a.getStatus());
        return new PublicAgreement(done ? "DONE" : "OPEN", null, null, t.getName(), a.getLenderName(), null,
                a.getBorrowerPhone() == null ? null : "••••••" + a.getBorrowerPhone().substring(6), a.getAgreementNo(), a.getLinkExpiresAt(),
                a.getBorrowerName(), a.getBorrowerAddress(), a.getLenderAddress(), a.getAmount(), HostedChitService.inWords(a.getAmount()),
                a.getLoanDate(), a.getDueDate(), a.getInterestRate(), a.getInterestTerms(), a.getPlace(), a.getTerms(), a.getContentHash(),
                t.getCurrency(), a.getStampDuty(), a.getStampSerial(), a.getLenderSignature(), a.getWitnessName(), a.getWitnessSignature(),
                Boolean.TRUE.equals(a.getRequireAadhaar()), Boolean.TRUE.equals(a.getRequireSelfie()), Boolean.TRUE.equals(a.getRequireLocation()),
                docs, a.getStatus(), a.getAcceptedName(), a.getAcceptedAt(), a.getSignature(), a.getAadhaarLast4(), a.getAcceptanceSeal(),
                a.getAcceptedLocation() != null, a.getEvidencePayload(), a.getDigitalSignature(), settings.payLinkPublicKey(),
                settings.payLinkFingerprint(), a.getCreatedAt());
    }

    private AgreementView view(ClaimAgreement a) {
        LocalDateTime now = LocalDateTime.now();
        String link = a.getTokenHash() == null ? "NONE" : a.getLockedAt() != null ? "LOCKED" : a.getLinkRevokedAt() != null ? "REVOKED"
                : a.getLinkExpiresAt() != null && a.getLinkExpiresAt().isAfter(now) ? "ACTIVE" : "EXPIRED";
        return new AgreementView(a.getId(), a.getClaimId(), a.getAgreementNo(), a.getStatus(), a.getLenderName(), a.getLenderAddress(),
                a.getBorrowerName(), a.getBorrowerPhone(), a.getBorrowerAddress(), a.getAmount(), HostedChitService.inWords(a.getAmount()),
                a.getLoanDate(), a.getDueDate(), a.getInterestRate(), a.getInterestTerms(), a.getPlace(), a.getTerms(), a.getContentHash(),
                a.getStampDuty(), a.getStampSerial(), a.getLenderSignature(), a.getWitnessName(), a.getWitnessPhone(), a.getWitnessAddress(),
                a.getWitnessSignature(), Boolean.TRUE.equals(a.getRequireAadhaar()), Boolean.TRUE.equals(a.getRequireSelfie()),
                Boolean.TRUE.equals(a.getRequireLocation()), link, a.getLinkExpiresAt(), a.getViews() == null ? 0 : a.getViews(),
                a.getLastViewedAt(), a.getFailedAttempts() == null ? 0 : a.getFailedAttempts(), a.getLockedAt(),
                a.getAcceptedName(), a.getAcceptedAt(), a.getAcceptedPhone(), a.getPhoneMatches(), a.getAcceptedIp(), a.getAcceptedUserAgent(),
                a.getAcceptedDevice(), a.getDeviceHash(), a.getAcceptedLocation(), a.getSignature(), a.getAadhaarLast4(), a.getAcceptanceSeal(),
                a.getEvidencePayload(), a.getDigitalSignature(), settings.payLinkPublicKey(), settings.payLinkFingerprint(),
                files.listForAgreement(FILES, a.getId()), a.getCreatedBy(), a.getCreatedAt());
    }

    private java.util.Optional<ClaimAgreement> latest(Long claimId) {
        return agreements.findByClaimId(claimId).stream().filter(a -> a.getTenantId().equals(UserContext.tenantId()))
                .max(Comparator.comparing(ClaimAgreement::getId));
    }

    private ClaimAgreement require(Long claimId) {
        claims.get(claimId);
        return latest(claimId).orElseThrow(() -> new NotFoundException("Loan agreement of item", claimId));
    }

    private static void requireDraft(ClaimAgreement a) {
        if (!ClaimAgreement.DRAFT.equals(a.getStatus())) {
            throw new BusinessException("The agreement is already " + a.getStatus().toLowerCase() + "; its ID proof is part of the record");
        }
    }

    private ClaimAgreement active(String token) {
        ClaimAgreement a = token == null || token.isBlank() ? null : agreements.findByTokenHash(AccessLinkService.hash(token.trim())).orElse(null);
        if (a == null) {
            throw new BusinessException("This link is not valid");
        }
        if (a.getLinkRevokedAt() != null) {
            throw new BusinessException("This link was switched off. Ask " + a.getLenderName() + " for a new one.");
        }
        if (a.getLinkExpiresAt() == null || !a.getLinkExpiresAt().isAfter(LocalDateTime.now())) {
            throw new BusinessException("This link has expired. Ask " + a.getLenderName() + " for a new one.");
        }
        return a;
    }

    private Organization tenant(ClaimAgreement a) {
        return tenants.findById(a.getTenantId()).filter(t -> Boolean.TRUE.equals(t.getActive()))
                .orElseThrow(() -> new BusinessException("This agreement is no longer shared"));
    }

    private static CurrentUser linkUser(Organization t, String name) {
        return new CurrentUser(null, "link", name, UserRole.VIEWER, t.getId(), t.getCode(), t.getName(), t.getCurrency(), Feature.all(), false);
    }

    private static <T> T asTenant(Organization tenant, Supplier<T> work) {
        CurrentUser previous = UserContext.current().orElse(null);
        UserContext.set(new CurrentUser(null, "agreement-link", "Agreement link", UserRole.VIEWER, tenant.getId(), tenant.getCode(),
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

    private static String blank(String s) {
        return s == null || s.isBlank() ? null : s.trim();
    }
}
