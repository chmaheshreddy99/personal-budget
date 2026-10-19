package com.aditya.personalbudget.service;

import com.aditya.personalbudget.domain.entity.ConstructionAgreement;
import com.aditya.personalbudget.domain.entity.ConstructionCapital;
import com.aditya.personalbudget.domain.entity.ConstructionExtra;
import com.aditya.personalbudget.domain.entity.ConstructionInstalment;
import com.aditya.personalbudget.domain.entity.ConstructionParty;
import com.aditya.personalbudget.domain.entity.ConstructionPartner;
import com.aditya.personalbudget.domain.entity.ConstructionProject;
import com.aditya.personalbudget.domain.entity.ConstructionSale;
import com.aditya.personalbudget.domain.entity.ConstructionUnit;
import com.aditya.personalbudget.domain.entity.Organization;
import com.aditya.personalbudget.domain.type.Feature;
import com.aditya.personalbudget.domain.type.UserRole;
import com.aditya.personalbudget.exception.BusinessException;
import com.aditya.personalbudget.exception.NotFoundException;
import com.aditya.personalbudget.repository.OrganizationRepository;
import com.aditya.personalbudget.security.CurrentUser;
import com.aditya.personalbudget.security.UserContext;
import com.aditya.personalbudget.service.AttachmentService.AgreementFile;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.PositiveOrZero;
import jakarta.validation.constraints.Size;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.security.SecureRandom;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Base64;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.function.Supplier;
import java.util.stream.Collectors;

/**
 * The agreements of a construction project (see {@link ConstructionAgreement} for the kinds), made, printed on stamp
 * paper and accepted.
 * <p>
 * <b>Making.</b> The wording, recitals and particulars are made from the project ({@link ConstructionTerms}) and fixed
 * with a SHA-256 fingerprint. While it waits for the other party it can be made again (the figures follow the project);
 * once accepted or signed it is a record: only its stamp-paper details (stamp, signatures, witnesses) change.
 * <p>
 * <b>Accepting.</b> Online, by a secret link opened with the other party's mobile number: they add their Aadhaar card
 * and a live selfie, type their Aadhaar number (checked; the last 4 digits kept), sign with a finger and accept; the
 * evidence is sealed and digitally signed with the installation's key. Or in person: the deed is printed on stamp paper
 * and signed (and thumb-marked) by both parties before the witnesses, then recorded here, with the other party's
 * signature drawn on the builder's device if wanted.
 */
@Service
public class ConstructionAgreementService {

    public static final String FILES = "CONSTRUCTION_AGRMT";
    public static final Set<String> KINDS = Set.of("CONTRACT", "EXTRA", "PLOT_PURCHASE", "JDA", "FLAT_SALE", "TRIPARTITE", "SALE_DEED", "POSSESSION", "PARTNERSHIP");
    static final int MAX_ATTEMPTS = 5;
    public static final int MAX_LINK_HOURS = 24 * 30;

    public record MakeRequest(@NotBlank @Size(max = 14) String kind, Long refId, @Size(max = 60) String place, LocalDate agreementDate,
                              @PositiveOrZero BigDecimal stampDuty, @Size(max = 40) String stampSerial,
                              @Size(max = 100) String partyName, @Size(max = 100) String partyRelation, @Size(max = 20) String partyPhone,
                              @Size(max = 200) String partyAddress, @Size(max = 100) String witnessName, @Size(max = 20) String witnessPhone,
                              @Size(max = 150) String witnessAddress, @Size(max = 100) String witness2Name, @Size(max = 150) String witness2Address,
                              Boolean requireAadhaar, Boolean requireSelfie, Boolean requireLocation, Boolean thumbBoxes,
                              @Size(max = 2000) String extraTerms) {
    }

    public record PaperRequest(@PositiveOrZero BigDecimal stampDuty, @Size(max = 40) String stampSerial, @Size(max = 20000) String companySignature,
                               Boolean clearCompanySignature, @Size(max = 100) String witnessName, @Size(max = 20) String witnessPhone,
                               @Size(max = 150) String witnessAddress, @Size(max = 20000) String witnessSignature, Boolean clearWitnessSignature,
                               @Size(max = 100) String witness2Name, @Size(max = 150) String witness2Address, @Size(max = 20000) String witness2Signature,
                               Boolean clearWitness2Signature, @Size(max = 20000) String partyInkSignature, Boolean clearPartyInkSignature,
                               Boolean thumbBoxes) {
    }

    public record LinkRequest(@Min(1) @Max(MAX_LINK_HOURS) int hours) {
    }

    public record SignedRequest(@Size(max = 100) String name, LocalDate on) {
    }

    public record OpenRequest(@Size(max = 20) String phone) {
    }

    public record AcceptRequest(@Size(max = 20) String phone, @Size(min = 2, max = 100) String name, Boolean agree,
                                @Size(max = 20) String aadhaarNumber, @Size(max = 20000) String signature,
                                @Size(max = 100) String location, @Size(max = 2000) String device) {
    }

    /** The full agreement for the builder (linkStatus: NONE, ACTIVE, EXPIRED, REVOKED or LOCKED). */
    public record AgreementView(Long id, Long projectId, String kind, Long refId, String agreementNo, String title, String status,
                                String firstRole, String secondRole, String companyName, String companyAddress, String signerName,
                                String signerDesignation, String partyName, String partyRelation, String partyPhone, String partyAddress,
                                String thirdName, String thirdAddress, String place, LocalDate agreementDate, List<String> recitals,
                                List<String[]> particulars, String terms, String extraTerms, String contentHash,
                                BigDecimal stampDuty, String stampSerial, String companySignature, String witnessName, String witnessPhone,
                                String witnessAddress, String witnessSignature, String witness2Name, String witness2Address,
                                String witness2Signature, boolean thumbBoxes, String partyInkSignature,
                                boolean requireAadhaar, boolean requireSelfie, boolean requireLocation,
                                String linkStatus, LocalDateTime linkExpiresAt, int views, LocalDateTime lastViewedAt, int failedAttempts,
                                LocalDateTime lockedAt, String acceptedName, LocalDateTime acceptedAt, String acceptedPhone, String acceptedIp,
                                String acceptedUserAgent, String acceptedDevice, String deviceHash, String acceptedLocation, String signature,
                                String aadhaarLast4, String acceptanceSeal, String evidencePayload, String digitalSignature, String publicKey,
                                String keyFingerprint, List<AgreementFile> files, String projectName, String createdBy, LocalDateTime createdAt) {
    }

    public record CreatedLink(AgreementView agreement, String token) {
    }

    /** What the other party sees on the link: VERIFY (only who it is from), OPEN (to accept) or DONE. */
    public record PublicAgreement(String step, String error, Integer attemptsLeft, String household, String companyName, String partyHint,
                                  String phoneHint, String agreementNo, String title, LocalDateTime expiresAt,
                                  // ---- once the number is verified
                                  String kind, String firstRole, String secondRole, String companyAddress, String signerName,
                                  String signerDesignation, String partyName, String partyRelation, String partyAddress, String thirdName,
                                  String thirdAddress, String place, LocalDate agreementDate, List<String> recitals, List<String[]> particulars,
                                  String terms, String contentHash, BigDecimal stampDuty, String stampSerial, String companySignature,
                                  String witnessName, String witnessSignature, String witness2Name, String witness2Signature, boolean thumbBoxes,
                                  boolean requireAadhaar, boolean requireSelfie, boolean requireLocation, List<String> kycDocs, String status,
                                  String acceptedName, LocalDateTime acceptedAt, String signature, String aadhaarLast4, String acceptanceSeal,
                                  boolean locationShared, String evidencePayload, String digitalSignature, String publicKey, String keyFingerprint) {
    }

    static final class VerificationFailed extends BusinessException {
        VerificationFailed(String message) {
            super(message);
        }
    }

    private final ConstructionService core;
    private final AttachmentService files;
    private final AppSettingsService settings;
    private final OrganizationRepository tenants;
    private final SecureRandom random = new SecureRandom();

    public ConstructionAgreementService(ConstructionService core, AttachmentService files, AppSettingsService settings, OrganizationRepository tenants) {
        this.core = core;
        this.files = files;
        this.settings = settings;
        this.tenants = tenants;
    }

    // ================================================================== the builder's side

    public AgreementView get(Long projectId, Long agreementId) {
        return view(require(core.require(projectId), agreementId));
    }

    /** Makes an agreement, or makes it again while it waits for the other party (the figures follow the project). */
    @Transactional
    public AgreementView make(Long projectId, MakeRequest r) {
        ConstructionProject p = core.requireOpen(projectId);
        String kind = r.kind().trim().toUpperCase();
        if (!KINDS.contains(kind)) throw new BusinessException("Unknown agreement " + kind);
        Long refId = Set.of("CONTRACT").contains(kind) ? null : r.refId();
        ConstructionAgreement a = core.agreements().findByProjectId(p.getId()).stream()
                .filter(x -> kind.equals(x.getKind()) && Objects.equals(refId, x.getRefId())).max(Comparator.comparing(ConstructionAgreement::getId)).orElse(null);
        if (a != null && !"DRAFT".equals(a.getStatus())) {
            throw new BusinessException("The agreement " + a.getAgreementNo() + " is already " + a.getStatus().toLowerCase() + "; it is kept as it is"
                    + ("CONTRACT".equals(kind) ? ". Record extra works with a supplementary agreement" : ""));
        }
        ConstructionTerms.Context ctx = context(p, kind, refId, r.extraTerms());
        boolean fresh = a == null;
        if (fresh) {
            a = new ConstructionAgreement();
            a.setTenantId(p.getTenantId());
            a.setProjectId(p.getId());
            a.setKind(kind);
            a.setRefId(refId);
            a.setAgreementNo("CA-pending");
            a.setTitle(kind);
            a.setPartyName("pending");
            a.setTerms("pending");
            a.setContentHash("pending");
            a.setStatus("DRAFT");
            a.setViews(0);
            a.setFailedAttempts(0);
            a.setCompanySignature(p.getCompanySignature());
            a.setCreatedBy(UserContext.username());
            a.setCreatedAt(LocalDateTime.now());
        }
        // the other party: from the project (owner, seller, landowner, buyer, partner), or as typed
        String[] party = party(p, kind, ctx);
        a.setPartyName(ConstructionService.blank(r.partyName()) != null ? r.partyName().trim() : party[0]);
        a.setPartyRelation(ConstructionService.blank(r.partyRelation()) != null ? r.partyRelation().trim() : party[1]);
        String phone = ConstructionService.blank(r.partyPhone()) != null ? ConstructionService.phone(r.partyPhone(), a.getPartyName()) : party[2];
        if (phone != null && a.getTokenHash() != null && !phone.equals(a.getPartyPhone())) a.setLinkRevokedAt(LocalDateTime.now());
        a.setPartyPhone(phone);
        a.setPartyAddress(ConstructionService.blank(r.partyAddress()) != null ? r.partyAddress().trim() : party[3]);
        if ("TRIPARTITE".equals(kind)) {
            a.setThirdName(ctx.sale().getLoanBank());
            a.setThirdAddress(ctx.sale().getLoanBranch());
        }
        a.setPlace(ConstructionService.blank(r.place()) != null ? r.place().trim() : p.getCity());
        a.setAgreementDate(r.agreementDate() != null ? r.agreementDate() : LocalDate.now());
        a.setStampDuty(r.stampDuty() == null || r.stampDuty().signum() == 0 ? null : Money.round(r.stampDuty()));
        a.setStampSerial(ConstructionService.blank(r.stampSerial()));
        a.setWitnessName(ConstructionService.blank(r.witnessName()));
        a.setWitnessPhone(ConstructionService.phone(r.witnessPhone(), "The witness"));
        a.setWitnessAddress(ConstructionService.blank(r.witnessAddress()));
        a.setWitness2Name(ConstructionService.blank(r.witness2Name()));
        a.setWitness2Address(ConstructionService.blank(r.witness2Address()));
        a.setRequireAadhaar(r.requireAadhaar() == null || r.requireAadhaar());
        a.setRequireSelfie(r.requireSelfie() == null || r.requireSelfie());
        a.setRequireLocation(Boolean.TRUE.equals(r.requireLocation()));
        a.setThumbBoxes(r.thumbBoxes() == null || r.thumbBoxes());
        a.setExtraTerms(ConstructionService.blank(r.extraTerms()));
        a = core.agreements().save(a);
        if (fresh) a.setAgreementNo(String.format("CA-%06d", a.getId()));
        ConstructionTerms.Wording w = ConstructionTerms.of(kind, ctx);
        a.setTitle(w.title());
        a.setFirstRole(w.firstRole());
        a.setSecondRole(w.secondRole());
        a.setRecitals(ActivityService.cut(String.join("\n", w.recitals()), 3000));
        a.setParticulars(ActivityService.cut(w.particulars().stream().map(x -> clean(x[0]) + "\t" + clean(x[1])).collect(Collectors.joining("\n")), 4000));
        List<String> t = w.terms();
        StringBuilder terms = new StringBuilder();
        for (int i = 0; i < t.size(); i++) terms.append(i + 1).append(". ").append(t.get(i)).append(i + 1 < t.size() ? "\n" : "");
        a.setTerms(ActivityService.cut(terms.toString(), 16000));
        a.setContentHash(HostedChitService.sha256(String.join("|", a.getAgreementNo(), a.getKind(), Objects.toString(a.getRefId(), ""), p.getCompanyName(),
                a.getPartyName(), Objects.toString(a.getThirdName(), ""), String.valueOf(a.getAgreementDate()), a.getRecitals(), a.getParticulars(), a.getTerms())));
        core.agreements().save(a);
        core.activity().record(fresh ? "ADDED" : "CHANGED", ConstructionService.AREA, (fresh ? "Made the " : "Updated the ") + w.title().toLowerCase() + " "
                + a.getAgreementNo() + " · " + a.getPartyName() + " · " + p.getName());
        return view(a);
    }

    @Transactional
    public AgreementView paper(Long projectId, Long agreementId, PaperRequest r) {
        ConstructionProject p = core.require(projectId);
        ConstructionAgreement a = require(p, agreementId);
        if (r.stampDuty() != null) a.setStampDuty(r.stampDuty().signum() > 0 ? Money.round(r.stampDuty()) : null);
        if (r.stampSerial() != null) a.setStampSerial(ConstructionService.blank(r.stampSerial()));
        if (r.witnessName() != null) a.setWitnessName(ConstructionService.blank(r.witnessName()));
        if (r.witnessPhone() != null) a.setWitnessPhone(ConstructionService.phone(r.witnessPhone(), "The witness"));
        if (r.witnessAddress() != null) a.setWitnessAddress(ConstructionService.blank(r.witnessAddress()));
        if (r.witness2Name() != null) a.setWitness2Name(ConstructionService.blank(r.witness2Name()));
        if (r.witness2Address() != null) a.setWitness2Address(ConstructionService.blank(r.witness2Address()));
        if (r.thumbBoxes() != null) a.setThumbBoxes(r.thumbBoxes());
        if (Boolean.TRUE.equals(r.clearCompanySignature())) a.setCompanySignature(null);
        else if (ConstructionService.blank(r.companySignature()) != null) a.setCompanySignature(HostedChitService.drawn(r.companySignature(), "the signature"));
        if (Boolean.TRUE.equals(r.clearWitnessSignature())) a.setWitnessSignature(null);
        else if (ConstructionService.blank(r.witnessSignature()) != null) {
            if (a.getWitnessName() == null) throw new BusinessException("Enter the witness's name with their signature");
            a.setWitnessSignature(HostedChitService.drawn(r.witnessSignature(), "the witness's signature"));
        }
        if (Boolean.TRUE.equals(r.clearWitness2Signature())) a.setWitness2Signature(null);
        else if (ConstructionService.blank(r.witness2Signature()) != null) {
            if (a.getWitness2Name() == null) throw new BusinessException("Enter the second witness's name with their signature");
            a.setWitness2Signature(HostedChitService.drawn(r.witness2Signature(), "the second witness's signature"));
        }
        if (Boolean.TRUE.equals(r.clearPartyInkSignature())) {
            if ("ACCEPTED".equals(a.getStatus())) throw new BusinessException("The signature given online is part of the record");
            a.setPartyInkSignature(null);
        } else if (ConstructionService.blank(r.partyInkSignature()) != null) {
            if ("ACCEPTED".equals(a.getStatus())) throw new BusinessException(a.getPartyName() + " signed online; that signature is the record");
            a.setPartyInkSignature(HostedChitService.drawn(r.partyInkSignature(), a.getPartyName() + "'s signature"));
        }
        core.agreements().save(a);
        core.activity().record("CHANGED", ConstructionService.AREA, "Stamp-paper details of " + a.getAgreementNo() + " · " + a.getPartyName() + " · " + p.getName());
        return view(a);
    }

    @Transactional
    public CreatedLink link(Long projectId, Long agreementId, LinkRequest r) {
        ConstructionProject p = core.require(projectId);
        ConstructionAgreement a = require(p, agreementId);
        if (!"DRAFT".equals(a.getStatus())) throw new BusinessException("The agreement is already " + a.getStatus().toLowerCase());
        if (a.getPartyPhone() == null) throw new BusinessException("Add " + a.getPartyName() + "'s mobile number first: they type it to open the link");
        byte[] bytes = new byte[32];
        random.nextBytes(bytes);
        String token = Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
        a.setTokenHash(AccessLinkService.hash(token));
        a.setLinkExpiresAt(LocalDateTime.now().plusHours(Math.min(r.hours(), MAX_LINK_HOURS)));
        a.setLinkRevokedAt(null);
        a.setFailedAttempts(0);
        a.setLockedAt(null);
        a.setViews(0);
        a.setLastViewedAt(null);
        core.agreements().save(a);
        core.activity().record("ADDED", ConstructionService.AREA, "Sent " + a.getAgreementNo() + " to " + a.getPartyName() + " · " + p.getName());
        return new CreatedLink(view(a), token);
    }

    @Transactional
    public AgreementView revoke(Long projectId, Long agreementId) {
        ConstructionProject p = core.require(projectId);
        ConstructionAgreement a = require(p, agreementId);
        if (a.getTokenHash() != null && a.getLinkRevokedAt() == null) {
            a.setLinkRevokedAt(LocalDateTime.now());
            core.agreements().save(a);
        }
        return view(a);
    }

    /** Signed in person on the printed copy (on stamp paper, with thumb impressions if used), recorded by the builder. */
    @Transactional
    public AgreementView signed(Long projectId, Long agreementId, SignedRequest r) {
        ConstructionProject p = core.require(projectId);
        ConstructionAgreement a = require(p, agreementId);
        if (!"DRAFT".equals(a.getStatus())) throw new BusinessException("This agreement is already " + a.getStatus().toLowerCase());
        a.setStatus("SIGNED");
        a.setAcceptedName(ConstructionService.blank(r.name()) != null ? ActivityService.cut(r.name().trim(), 100) : a.getPartyName());
        a.setAcceptedAt(r.on() != null ? r.on().atStartOfDay() : LocalDateTime.now());
        a.setAcceptedUserAgent("Signed in person on paper, recorded by " + UserContext.get().fullName());
        if (a.getTokenHash() != null && a.getLinkRevokedAt() == null) a.setLinkRevokedAt(LocalDateTime.now());
        core.agreements().save(a);
        afterSigned(p, a);
        core.activity().record("CHANGED", ConstructionService.AREA, a.getTitle() + " " + a.getAgreementNo() + " signed on paper · " + a.getPartyName() + " · " + p.getName());
        return view(a);
    }

    @Transactional
    public void delete(Long projectId, Long agreementId) {
        ConstructionProject p = core.require(projectId);
        ConstructionAgreement a = require(p, agreementId);
        if (!"DRAFT".equals(a.getStatus())) throw new BusinessException("An accepted or signed agreement is kept as a record");
        files.deleteAllForAgreement(FILES, a.getId());
        core.agreements().deleteById(a.getId());
    }

    @Transactional
    public AgreementView addFile(Long projectId, Long agreementId, String docType, String name, byte[] bytes, String source) {
        ConstructionProject p = core.require(projectId);
        ConstructionAgreement a = require(p, agreementId);
        boolean kyc = AttachmentService.KYC_TYPES.contains(docType == null ? "" : docType.trim().toUpperCase());
        if (kyc && !"DRAFT".equals(a.getStatus())) throw new BusinessException("The agreement is " + a.getStatus().toLowerCase() + "; its ID proof is part of the record");
        files.addToAgreement(FILES, a.getId(), docType, name, bytes, source, a.getTitle().toLowerCase() + " " + a.getAgreementNo());
        return view(a);
    }

    @Transactional
    public AgreementView deleteFile(Long projectId, Long agreementId, Long fileId) {
        ConstructionProject p = core.require(projectId);
        ConstructionAgreement a = require(p, agreementId);
        if (!"DRAFT".equals(a.getStatus()) && files.listForAgreement(FILES, a.getId()).stream()
                .anyMatch(f -> f.id().equals(fileId) && AttachmentService.KYC_TYPES.contains(f.docType()))) {
            throw new BusinessException("The ID proof is part of the record of the accepted agreement");
        }
        files.deleteFromAgreement(FILES, a.getId(), fileId);
        return view(a);
    }

    public AttachmentService.FileContent file(Long projectId, Long agreementId, Long fileId, boolean thumb) {
        return files.agreementFileContent(FILES, require(core.require(projectId), agreementId).getId(), fileId, thumb);
    }

    // ================================================================== the other party (no sign-in)

    @Transactional(noRollbackFor = VerificationFailed.class)
    public PublicAgreement open(String token, OpenRequest r) {
        ConstructionAgreement a = active(token);
        Organization tenant = tenant(a);
        a.setViews((a.getViews() == null ? 0 : a.getViews()) + 1);
        a.setLastViewedAt(LocalDateTime.now());
        core.agreements().save(a);
        String phone = r == null ? null : ConstructionService.blank(r.phone());
        if (phone == null) return gate(a, tenant, null);
        try {
            verify(a, phone);
        } catch (VerificationFailed e) {
            return gate(a, tenant, e.getMessage());
        }
        return asTenant(tenant, () -> full(a, tenant));
    }

    @Transactional(noRollbackFor = VerificationFailed.class)
    public PublicAgreement addKyc(String token, String phone, String docType, String name, byte[] bytes) {
        ConstructionAgreement a = active(token);
        verify(a, phone);
        if (!"DRAFT".equals(a.getStatus())) throw new BusinessException("This agreement is already accepted");
        String type = docType == null ? "" : docType.trim().toUpperCase();
        if (!AttachmentService.KYC_TYPES.contains(type)) throw new BusinessException("Add your Aadhaar card, PAN card or a selfie");
        Organization tenant = tenant(a);
        return asTenant(tenant, () -> {
            files.addToAgreement(FILES, a.getId(), type, name, bytes, "SELFIE".equals(type) ? "CAMERA" : "UPLOAD", a.getTitle().toLowerCase() + " " + a.getAgreementNo());
            core.activity().record(linkUser(tenant, a.getPartyName()), "ADDED", ConstructionService.AREA, a.getPartyName() + " added "
                    + type.replace('_', ' ').toLowerCase() + " to " + a.getAgreementNo(), "POST", "/public/construction-agreements");
            return full(a, tenant);
        });
    }

    @Transactional(noRollbackFor = VerificationFailed.class)
    public PublicAgreement accept(String token, AcceptRequest r, String ip, String userAgent) {
        ConstructionAgreement a = active(token);
        String phone = verify(a, r.phone());
        if (!"DRAFT".equals(a.getStatus())) throw new BusinessException("This agreement was already accepted");
        if (!Boolean.TRUE.equals(r.agree())) throw new BusinessException("Tick the box to confirm you have read and accept the agreement");
        String name = r.name() == null ? "" : r.name().trim().replaceAll("\\s+", " ");
        if (name.length() < 2) throw new BusinessException("Type your full name as on your Aadhaar card");
        String signature = HostedChitService.drawn(r.signature(), "your signature with your finger");
        Organization tenant = tenant(a);
        List<AgreementFile> kyc = asTenant(tenant, () -> files.listForAgreement(FILES, a.getId())).stream()
                .filter(f -> AttachmentService.KYC_TYPES.contains(f.docType())).toList();
        Set<String> have = kyc.stream().map(AgreementFile::docType).collect(Collectors.toSet());
        String aadhaar = null;
        if (Boolean.TRUE.equals(a.getRequireAadhaar())) {
            if (!have.contains("AADHAAR_FRONT")) throw new BusinessException("Add a photo of your Aadhaar card (the side with your photo)");
            aadhaar = Kyc.aadhaar(r.aadhaarNumber());
        } else if (ConstructionService.blank(r.aadhaarNumber()) != null) {
            aadhaar = Kyc.aadhaar(r.aadhaarNumber());
        }
        if (Boolean.TRUE.equals(a.getRequireSelfie()) && !have.contains("SELFIE")) throw new BusinessException("Take a selfie with your phone's front camera");
        String location = r.location() == null || r.location().isBlank() ? null : r.location().trim();
        if (location != null && !location.matches("-?\\d{1,3}(\\.\\d+)?,-?\\d{1,3}(\\.\\d+)?(,\\d+(\\.\\d+)?)?")) location = null;
        if (Boolean.TRUE.equals(a.getRequireLocation()) && location == null) throw new BusinessException("Allow your location when your phone asks");
        String device = r.device() == null ? null : ActivityService.cut(r.device(), 2000);
        LocalDateTime now = LocalDateTime.now().withNano(0);
        a.setStatus("ACCEPTED");
        a.setAcceptedName(ActivityService.cut(name, 100));
        a.setAcceptedAt(now);
        a.setAcceptedPhone(phone);
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
        ev.put("kind", "CONSTRUCTION_AGREEMENT_ACCEPTANCE");
        ev.put("agreementNo", a.getAgreementNo());
        ev.put("title", a.getTitle());
        ev.put("contentHash", a.getContentHash());
        ev.put("party", a.getPartyName());
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
            return m;
        }).toList());
        ev.put("seal", a.getAcceptanceSeal());
        a.setEvidencePayload(ActivityService.cut(Kyc.json(ev), 4000));
        a.setDigitalSignature(settings.signPayLink(a.getEvidencePayload()));
        core.agreements().save(a);
        return asTenant(tenant, () -> {
            afterSigned(core.projects().findById(a.getProjectId()).orElseThrow(), a);
            core.activity().record(linkUser(tenant, name), "ACCEPTED", ConstructionService.AREA, a.getTitle() + " " + a.getAgreementNo() + " accepted by " + name,
                    "POST", "/public/construction-agreements");
            return full(a, tenant);
        });
    }

    // ================================================================== helpers

    /** An agreement once signed moves its subject on: an extra work is agreed, a flat's sale is at the agreement stage. */
    private void afterSigned(ConstructionProject p, ConstructionAgreement a) {
        if ("EXTRA".equals(a.getKind()) && a.getRefId() != null) {
            core.extras().findById(a.getRefId()).filter(x -> "PROPOSED".equals(x.getStatus())).ifPresent(x -> { x.setStatus("AGREED"); core.extras().save(x); });
        }
        if ("FLAT_SALE".equals(a.getKind()) && a.getRefId() != null) {
            core.sales().findById(a.getRefId()).filter(s -> "BOOKED".equals(s.getStatus())).ifPresent(s -> {
                s.setStatus("AGREED");
                s.setAgreementOn(a.getAcceptedAt().toLocalDate());
                core.sales().save(s);
            });
        }
    }

    private ConstructionTerms.Context context(ConstructionProject p, String kind, Long refId, String extraTerms) {
        ConstructionService.Figures f = core.figures(p, core.balances());
        List<ConstructionUnit> units = core.units().findByProjectId(p.getId());
        List<ConstructionParty> parties = core.parties().findByProjectId(p.getId());
        List<ConstructionPartner> partners = core.partners().findByProjectId(p.getId()).stream().sorted(Comparator.comparing(ConstructionPartner::getId)).toList();
        ConstructionExtra extra = null;
        ConstructionParty party = null;
        ConstructionSale sale = null;
        ConstructionUnit unit = null;
        ConstructionPartner partner = null;
        List<ConstructionInstalment> plan = List.of();
        List<ConstructionUnit> partyUnits = List.of();
        switch (kind) {
            case "CONTRACT" -> {
                if (!ConstructionService.CONTRACT.equals(p.getKind())) throw new BusinessException("A construction agreement is for a contract work");
                if (f.contractValue().signum() <= 0) throw new BusinessException("Set the price of the stages first: the contract price is their total");
            }
            case "EXTRA" -> extra = core.extras().findById(need(refId, "Pick the extra work")).filter(x -> p.getId().equals(x.getProjectId()))
                    .orElseThrow(() -> new NotFoundException("Extra work", refId));
            case "PLOT_PURCHASE", "JDA" -> {
                party = parties.stream().filter(x -> x.getId().equals(refId)).findFirst().orElseThrow(() -> new BusinessException("Pick the "
                        + ("JDA".equals(kind) ? "landowner" : "seller")));
                if ("JDA".equals(kind) != "LANDOWNER".equals(party.getRole())) {
                    throw new BusinessException("JDA".equals(kind) ? "A joint development agreement is with a landowner" : "A plot purchase is with a seller");
                }
                Long pid = party.getId();
                partyUnits = units.stream().filter(u -> pid.equals(u.getPartyId())).sorted(ConstructionService.unitOrder()).toList();
            }
            case "FLAT_SALE", "TRIPARTITE", "SALE_DEED", "POSSESSION" -> {
                sale = core.sales().findById(need(refId, "Pick the flat's sale")).filter(x -> p.getId().equals(x.getProjectId()))
                        .orElseThrow(() -> new NotFoundException("Sale", refId));
                if ("CANCELLED".equals(sale.getStatus())) throw new BusinessException("This sale was cancelled");
                if ("TRIPARTITE".equals(kind) && (sale.getLoanBank() == null || Money.nz(sale.getLoanAmount()).signum() <= 0)) {
                    throw new BusinessException("Record the buyer's home loan (bank and amount) first");
                }
                Long uid = sale.getUnitId();
                unit = units.stream().filter(u -> u.getId().equals(uid)).findFirst().orElse(null);
                Long sid = sale.getId();
                plan = core.instalments().findByProjectId(p.getId()).stream().filter(i -> sid.equals(i.getSaleId()))
                        .sorted(Comparator.comparing(ConstructionInstalment::getPosition)).toList();
            }
            case "PARTNERSHIP" -> partner = partners.stream().filter(x -> x.getId().equals(refId)).findFirst()
                    .orElseThrow(() -> new BusinessException("Pick the partner"));
            default -> { }
        }
        if ("PARTNERSHIP".equals(kind) && Boolean.TRUE.equals(partner.getMe())) throw new BusinessException("You are the managing partner; pick another partner");
        Map<Long, BigDecimal> invested = new HashMap<>();
        for (ConstructionCapital c : core.capital().findByProjectId(p.getId())) {
            if ("INVEST".equals(c.getKind())) invested.merge(c.getPartnerId(), c.getAmount(), BigDecimal::add);
        }
        ConstructionAgreement contract = core.agreements().findByProjectId(p.getId()).stream().filter(x -> "CONTRACT".equals(x.getKind()))
                .max(Comparator.comparing(ConstructionAgreement::getId)).orElse(null);
        String bankAccount = p.getBankAccountId() == null ? null : core.accounts().findById(p.getBankAccountId())
                .map(b -> b.getName() + (b.getInstitution() != null ? " · " + b.getInstitution() : "") + (b.getAccountNumber() != null ? " · A/c " + b.getAccountNumber() : "")
                        + (b.getIfsc() != null ? " · IFSC " + b.getIfsc() : "")).orElse(null);
        return new ConstructionTerms.Context(p, f, core.stagesOf(p.getId()), extra, party, parties, partyUnits, sale, unit, plan, partner, partners,
                invested, contract == null ? null : contract.getAgreementNo(), contract == null ? null : contract.getAgreementDate(), bankAccount, extraTerms);
    }

    /** name, relation, phone, address of the other party. */
    private static String[] party(ConstructionProject p, String kind, ConstructionTerms.Context c) {
        return switch (kind) {
            case "CONTRACT", "EXTRA" -> new String[]{Objects.toString(p.getClientName(), "The owner"), p.getClientRelation(), p.getClientPhone(), p.getClientAddress()};
            case "PLOT_PURCHASE", "JDA" -> new String[]{c.party().getName(), c.party().getRelation(), c.party().getPhone(), c.party().getAddress()};
            case "PARTNERSHIP" -> new String[]{c.partner().getName(), null, c.partner().getPhone(), c.partner().getAddress()};
            default -> new String[]{c.sale().getBuyerName() + (c.sale().getCoBuyerName() != null ? " and " + c.sale().getCoBuyerName() : ""),
                    c.sale().getBuyerRelation(), c.sale().getBuyerPhone(), c.sale().getBuyerAddress()};
        };
    }

    private static Long need(Long id, String message) {
        if (id == null) throw new BusinessException(message);
        return id;
    }

    private static String clean(String s) {
        return s == null ? "" : s.replace('\t', ' ').replace('\n', ' ');
    }

    private AgreementView view(ConstructionAgreement a) {
        ConstructionProject p = core.projects().findById(a.getProjectId()).orElseThrow();
        LocalDateTime now = LocalDateTime.now();
        String link = a.getTokenHash() == null ? "NONE" : a.getLockedAt() != null ? "LOCKED" : a.getLinkRevokedAt() != null ? "REVOKED"
                : a.getLinkExpiresAt() != null && a.getLinkExpiresAt().isAfter(now) ? "ACTIVE" : "EXPIRED";
        return new AgreementView(a.getId(), a.getProjectId(), a.getKind(), a.getRefId(), a.getAgreementNo(), a.getTitle(), a.getStatus(),
                a.getFirstRole(), a.getSecondRole(), p.getCompanyName(), p.getCompanyAddress(), p.getSignerName(), p.getSignerDesignation(),
                a.getPartyName(), a.getPartyRelation(), a.getPartyPhone(), a.getPartyAddress(), a.getThirdName(), a.getThirdAddress(), a.getPlace(),
                a.getAgreementDate(), lines(a.getRecitals()), particulars(a.getParticulars()), a.getTerms(), a.getExtraTerms(), a.getContentHash(),
                a.getStampDuty(), a.getStampSerial(), a.getCompanySignature(), a.getWitnessName(), a.getWitnessPhone(), a.getWitnessAddress(),
                a.getWitnessSignature(), a.getWitness2Name(), a.getWitness2Address(), a.getWitness2Signature(), !Boolean.FALSE.equals(a.getThumbBoxes()),
                a.getPartyInkSignature(), Boolean.TRUE.equals(a.getRequireAadhaar()), Boolean.TRUE.equals(a.getRequireSelfie()),
                Boolean.TRUE.equals(a.getRequireLocation()), link, a.getLinkExpiresAt(), a.getViews() == null ? 0 : a.getViews(), a.getLastViewedAt(),
                a.getFailedAttempts() == null ? 0 : a.getFailedAttempts(), a.getLockedAt(), a.getAcceptedName(), a.getAcceptedAt(), a.getAcceptedPhone(),
                a.getAcceptedIp(), a.getAcceptedUserAgent(), a.getAcceptedDevice(), a.getDeviceHash(), a.getAcceptedLocation(), a.getSignature(),
                a.getAadhaarLast4(), a.getAcceptanceSeal(), a.getEvidencePayload(), a.getDigitalSignature(), settings.payLinkPublicKey(),
                settings.payLinkFingerprint(), files.listForAgreement(FILES, a.getId()), p.getName(), a.getCreatedBy(), a.getCreatedAt());
    }

    private PublicAgreement gate(ConstructionAgreement a, Organization t, String error) {
        int left = MAX_ATTEMPTS - (a.getFailedAttempts() == null ? 0 : a.getFailedAttempts());
        ConstructionProject p = core.projects().findById(a.getProjectId()).orElseThrow();
        String hint = Arrays.stream(a.getPartyName().split("\\s+")).map(w -> w.isEmpty() ? w : w.charAt(0) + "•••").collect(Collectors.joining(" "));
        String phoneHint = a.getPartyPhone() == null ? null : "••••••" + a.getPartyPhone().substring(6);
        return new PublicAgreement("VERIFY", error, Math.max(0, left), t.getName(), p.getCompanyName(), hint, phoneHint, a.getAgreementNo(), a.getTitle(),
                a.getLinkExpiresAt(), null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null,
                null, null, null, null, null, false, false, false, false, null, null, null, null, null, null, null, false, null, null, null, null);
    }

    private PublicAgreement full(ConstructionAgreement a, Organization t) {
        ConstructionProject p = core.projects().findById(a.getProjectId()).orElseThrow();
        List<String> docs = files.listForAgreement(FILES, a.getId()).stream().map(AgreementFile::docType).distinct().toList();
        String step = "DRAFT".equals(a.getStatus()) ? "OPEN" : "DONE";
        return new PublicAgreement(step, null, null, t.getName(), p.getCompanyName(), a.getPartyName(), null, a.getAgreementNo(), a.getTitle(),
                a.getLinkExpiresAt(), a.getKind(), a.getFirstRole(), a.getSecondRole(), p.getCompanyAddress(), p.getSignerName(), p.getSignerDesignation(),
                a.getPartyName(), a.getPartyRelation(), a.getPartyAddress(), a.getThirdName(), a.getThirdAddress(), a.getPlace(), a.getAgreementDate(),
                lines(a.getRecitals()), particulars(a.getParticulars()), a.getTerms(), a.getContentHash(), a.getStampDuty(), a.getStampSerial(),
                a.getCompanySignature(), a.getWitnessName(), a.getWitnessSignature(), a.getWitness2Name(), a.getWitness2Signature(),
                !Boolean.FALSE.equals(a.getThumbBoxes()), Boolean.TRUE.equals(a.getRequireAadhaar()), Boolean.TRUE.equals(a.getRequireSelfie()),
                Boolean.TRUE.equals(a.getRequireLocation()), docs, a.getStatus(), a.getAcceptedName(), a.getAcceptedAt(), a.getSignature(),
                a.getAadhaarLast4(), a.getAcceptanceSeal(), a.getAcceptedLocation() != null, a.getEvidencePayload(), a.getDigitalSignature(),
                settings.payLinkPublicKey(), settings.payLinkFingerprint());
    }

    private static List<String> lines(String s) {
        return s == null || s.isBlank() ? List.of() : s.lines().filter(l -> !l.isBlank()).toList();
    }

    private static List<String[]> particulars(String s) {
        List<String[]> out = new ArrayList<>();
        if (s == null) return out;
        for (String l : s.split("\n")) {
            int tab = l.indexOf('\t');
            if (tab > 0) out.add(new String[]{l.substring(0, tab), l.substring(tab + 1)});
        }
        return out;
    }

    private String verify(ConstructionAgreement a, String typed) {
        if (a.getLockedAt() != null) throw new BusinessException("This link is locked after too many wrong numbers. Ask for a new one.");
        String digits = typed == null ? "" : typed.replaceAll("\\D", "");
        if (digits.length() > 10 && digits.startsWith("91")) digits = digits.substring(digits.length() - 10);
        if (!digits.matches("[6-9]\\d{9}")) throw new BusinessException("Enter your 10-digit mobile number");
        if (!digits.equals(a.getPartyPhone())) {
            int failed = (a.getFailedAttempts() == null ? 0 : a.getFailedAttempts()) + 1;
            a.setFailedAttempts(failed);
            if (failed >= MAX_ATTEMPTS) a.setLockedAt(LocalDateTime.now());
            core.agreements().save(a);
            throw new VerificationFailed(failed >= MAX_ATTEMPTS ? "That is not the number this agreement was sent to. The link is now locked."
                    : "That is not the number this agreement was sent to (" + (MAX_ATTEMPTS - failed) + " tr" + (MAX_ATTEMPTS - failed == 1 ? "y" : "ies") + " left)");
        }
        return digits;
    }

    private ConstructionAgreement active(String token) {
        ConstructionAgreement a = token == null || token.isBlank() ? null : core.agreements().findByTokenHash(AccessLinkService.hash(token.trim())).orElse(null);
        if (a == null) throw new BusinessException("This link is not valid");
        if (a.getLinkRevokedAt() != null) throw new BusinessException("This link was switched off. Ask for a new one.");
        if (a.getLinkExpiresAt() == null || !a.getLinkExpiresAt().isAfter(LocalDateTime.now())) throw new BusinessException("This link has expired. Ask for a new one.");
        return a;
    }

    private ConstructionAgreement require(ConstructionProject p, Long id) {
        return core.agreements().findById(id).filter(a -> p.getId().equals(a.getProjectId())).orElseThrow(() -> new NotFoundException("Agreement", id));
    }

    private Organization tenant(ConstructionAgreement a) {
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
            if (previous != null) UserContext.set(previous);
            else UserContext.clear();
        }
    }
}
