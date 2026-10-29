package com.aditya.personalbudget.service;

import com.aditya.personalbudget.domain.entity.Account;
import com.aditya.personalbudget.domain.entity.Chit;
import com.aditya.personalbudget.domain.entity.ChitAcknowledgement;
import com.aditya.personalbudget.domain.entity.ChitInstallment;
import com.aditya.personalbudget.domain.entity.JournalEntry;
import com.aditya.personalbudget.domain.entity.Organization;
import com.aditya.personalbudget.domain.type.AccountClass;
import com.aditya.personalbudget.domain.type.Feature;
import com.aditya.personalbudget.domain.type.InstallmentStatus;
import com.aditya.personalbudget.domain.type.UserRole;
import com.aditya.personalbudget.exception.BusinessException;
import com.aditya.personalbudget.exception.NotFoundException;
import com.aditya.personalbudget.repository.AccountRepository;
import com.aditya.personalbudget.repository.ChitAcknowledgementRepository;
import com.aditya.personalbudget.repository.ChitInstallmentRepository;
import com.aditya.personalbudget.repository.ChitRepository;
import com.aditya.personalbudget.repository.JournalEntryRepository;
import com.aditya.personalbudget.repository.OrganizationRepository;
import com.aditya.personalbudget.security.CurrentUser;
import com.aditya.personalbudget.security.UserContext;
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
import java.util.Arrays;
import java.util.Base64;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.function.Supplier;
import java.util.stream.Collectors;

/**
 * Payment receipts from the organizer of a chit the household is a member of (see {@link ChitAcknowledgement}).
 * <p>
 * <b>A receipt.</b> The member picks paid installments (one or several) and asks the organizer to acknowledge them.
 * The figures (each installment's due date, the day it was paid, the cash, the dividend, how it was paid and its
 * reference) and the wording are frozen with a SHA-256 fingerprint. An installment is on one receipt at a time: a
 * receipt in force or waiting holds it until it is deleted, and an installment on a receipt cannot be undone.
 * <p>
 * <b>A settlement.</b> Once the payout is received in full, a full and final settlement: the member acknowledges the
 * payout (and signs it on this device), the organizer confirms every installment, and the receipts given before are
 * listed on it and cancelled the moment it is signed. Deleting the settlement brings them back in force.
 * <p>
 * <b>The link.</b> A secret link (only a hash of the token is kept) for at most 30 days, that can be stopped any
 * time. With the organizer's mobile on record, nothing is shown until they type it (five wrong numbers lock the link);
 * without one, they type their number and it is recorded. They sign with a finger and accept; the time, IP address,
 * device, location (if allowed or required) are sealed together and digitally signed (ECDSA P-256) by this
 * installation, as loan agreements are. Resending makes a new link; resending a signed one asks for a fresh signature
 * (the earlier one is discarded, and the activity log keeps its seal).
 */
@Service
public class ChitAckService {

    private static final String AREA = "Chits";
    public static final int MAX_LINK_HOURS = 24 * 30;
    static final int MAX_ATTEMPTS = 5;
    private static final DateTimeFormatter DAY = DateTimeFormatter.ofPattern("dd MMM yyyy");

    // ================================================================== requests

    /** A receipt for the chosen paid installments, and (hours) a link for the organizer at once. */
    public record ReceiptRequest(List<Long> installmentIds, @Size(max = 100) String organizerName, @Size(max = 20) String organizerPhone,
                                 Boolean savePhone, @Size(max = 150) String organizerAddress, @Size(max = 100) String memberName,
                                 @Size(max = 150) String memberAddress, @Size(max = 60) String place, Boolean requireLocation,
                                 @Min(1) @Max(MAX_LINK_HOURS) Integer hours) {
    }

    /** The full and final settlement once the payout is in; the member signs it here. */
    public record SettlementRequest(@Size(max = 100) String organizerName, @Size(max = 20) String organizerPhone, Boolean savePhone,
                                    @Size(max = 150) String organizerAddress, @Size(max = 100) String memberName,
                                    @Size(max = 150) String memberAddress, @Size(max = 60) String place,
                                    @Size(max = 20000) String memberSignature, Boolean requireLocation,
                                    @Min(1) @Max(MAX_LINK_HOURS) Integer hours) {
    }

    /** The printed copy: the stamp, the member's and the witness's signatures. */
    public record PaperRequest(@PositiveOrZero BigDecimal stampDuty, @Size(max = 40) String stampSerial,
                               @Size(max = 20000) String memberSignature, Boolean clearMemberSignature,
                               @Size(max = 100) String witnessName, @Size(max = 20) String witnessPhone,
                               @Size(max = 20000) String witnessSignature, Boolean clearWitnessSignature) {
    }

    /** A new link (a resend); a different mobile number replaces the one on record. */
    public record LinkRequest(@Min(1) @Max(MAX_LINK_HOURS) int hours, @Size(max = 20) String organizerPhone, Boolean savePhone) {
    }

    public record PaperSignedRequest(@Size(max = 100) String name) {
    }

    public record OpenRequest(@Size(max = 20) String phone) {
    }

    public record AcceptRequest(@Size(max = 20) String phone, @Size(min = 2, max = 100) String name, Boolean agree,
                                @Size(max = 20000) String signature, @Size(max = 100) String location,
                                @Size(max = 2000) String device, @Size(max = 300) String remarks) {
    }

    // ================================================================== views

    /** One installment as frozen on the acknowledgement. */
    public record ScheduleLine(int no, LocalDate dueDate, LocalDate paidDate, BigDecimal installment, BigDecimal dividend,
                               BigDecimal cash, String mode, String reference) {
    }

    /** A receipt a settlement cancels. */
    public record CancelledReceipt(String ackNo, LocalDate signedOn, BigDecimal amount, String status) {
    }

    /** status: PENDING, SIGNED, PAPER or CANCELLED; linkStatus: NONE, ACTIVE, EXPIRED, REVOKED or LOCKED. */
    public record AckView(Long id, Long chitId, String kind, String ackNo, String status, String chitName, String ticketNo,
                          BigDecimal chitValue, String memberName, String memberAddress, String organizerName, String organizerPhone,
                          String organizerAddress, String place, BigDecimal amount, String amountInWords, List<Long> installmentIds,
                          List<ScheduleLine> schedule, BigDecimal payoutAmount, LocalDate payoutDate, List<CancelledReceipt> cancels,
                          LocalDateTime cancelledAt, String cancelledByAckNo, String terms, String contentHash,
                          BigDecimal stampDuty, String stampSerial, String memberSignature, String witnessName, String witnessPhone,
                          String witnessSignature, boolean requireLocation,
                          String linkStatus, LocalDateTime linkExpiresAt, LocalDateTime sentAt, int sendCount, int views,
                          LocalDateTime lastViewedAt, int failedAttempts, LocalDateTime lockedAt,
                          String acceptedName, LocalDateTime acceptedAt, String acceptedPhone, Boolean phoneMatches, String acceptedIp,
                          String acceptedUserAgent, String acceptedDevice, String deviceHash, String acceptedLocation, String acceptedRemarks,
                          String signature, String acceptanceSeal, String evidencePayload, String digitalSignature,
                          String publicKey, String keyFingerprint, String createdBy, LocalDateTime createdAt) {
    }

    /** A new link: the token is returned this once. */
    public record CreatedLink(AckView ack, String token) {
    }

    /**
     * What the organizer sees. step VERIFY: who it is from and a hint of the number to type; OPEN: to sign; DONE:
     * signed (or cancelled since).
     */
    public record PublicAck(String step, String error, Integer attemptsLeft, boolean phoneOnRecord, String household,
                            String memberName, String organizerHint, String phoneHint, String kind, String ackNo,
                            LocalDateTime expiresAt,
                            // ---- once the number is verified
                            String organizerName, String organizerAddress, String memberAddress, String chitName, String ticketNo,
                            BigDecimal chitValue, String place, BigDecimal amount, String amountInWords, List<ScheduleLine> schedule,
                            BigDecimal payoutAmount, LocalDate payoutDate, List<CancelledReceipt> cancels, String terms,
                            String contentHash, String currency, BigDecimal stampDuty, String stampSerial, String memberSignature,
                            String witnessName, String witnessSignature, boolean requireLocation, String status,
                            String acceptedName, LocalDateTime acceptedAt, String acceptedRemarks, String signature,
                            String acceptanceSeal, boolean locationShared, String evidencePayload, String digitalSignature,
                            String publicKey, String keyFingerprint, LocalDateTime cancelledAt, String cancelledByAckNo,
                            LocalDateTime createdAt) {
    }

    /** A wrong number on the link: counted (and kept) even though the request fails. */
    static final class VerificationFailed extends BusinessException {
        VerificationFailed(String message) {
            super(message);
        }
    }

    private final ChitAcknowledgementRepository acks;
    private final ChitRepository chits;
    private final ChitInstallmentRepository installments;
    private final AccountRepository accounts;
    private final JournalEntryRepository entries;
    private final AppSettingsService settings;
    private final OrganizationRepository tenants;
    private final ActivityService activity;
    private final SecureRandom random = new SecureRandom();

    public ChitAckService(ChitAcknowledgementRepository acks, ChitRepository chits, ChitInstallmentRepository installments,
                          AccountRepository accounts, JournalEntryRepository entries, AppSettingsService settings,
                          OrganizationRepository tenants, ActivityService activity) {
        this.acks = acks;
        this.chits = chits;
        this.installments = installments;
        this.accounts = accounts;
        this.entries = entries;
        this.settings = settings;
        this.tenants = tenants;
        this.activity = activity;
    }

    // ================================================================== the member's side

    /** The chit's receipts and settlement, newest first. */
    public List<AckView> list(Long chitId) {
        Chit chit = chit(chitId);
        return acks.findByChitId(chit.getTenantId(), chitId).stream()
                .sorted(Comparator.comparing(ChitAcknowledgement::getId).reversed()).map(this::view).toList();
    }

    public AckView get(Long chitId, Long ackId) {
        return view(require(chitId, ackId));
    }

    /** A receipt for paid installments not on another receipt; with hours, the link too. */
    @Transactional
    public CreatedLink createReceipt(Long chitId, ReceiptRequest r) {
        Chit chit = chit(chitId);
        List<ChitAcknowledgement> existing = acks.findByChitId(chit.getTenantId(), chitId);
        if (existing.stream().anyMatch(a -> !a.isReceipt())) {
            throw new BusinessException("The payout settlement is already made: the receipts are settled by it");
        }
        Set<Long> wanted = new LinkedHashSet<>(r.installmentIds() == null ? List.of() : r.installmentIds());
        if (wanted.isEmpty()) {
            throw new BusinessException("Choose the installments the organizer should acknowledge");
        }
        Map<Long, ChitInstallment> schedule = installments.findByChitIdOrderByInstallmentNo(chitId).stream()
                .collect(Collectors.toMap(ChitInstallment::getId, i -> i));
        List<ChitInstallment> chosen = new ArrayList<>();
        for (Long id : wanted) {
            ChitInstallment i = schedule.get(id);
            if (i == null) throw new NotFoundException("Chit installment", id);
            if (i.getStatus() != InstallmentStatus.PAID) {
                throw new BusinessException("Installment " + i.getInstallmentNo() + " is not paid yet: only paid installments can be acknowledged");
            }
            ChitAcknowledgement on = receiptOf(existing, id);
            if (on != null) {
                throw new BusinessException("Installment " + i.getInstallmentNo() + " is already on " + on.getAckNo()
                        + " (" + on.effectiveStatus().toLowerCase() + "). Delete that one to ask again");
            }
            chosen.add(i);
        }
        chosen.sort(Comparator.comparing(ChitInstallment::getInstallmentNo));
        ChitAcknowledgement a = fresh(chit, ChitAcknowledgement.RECEIPT);
        parties(a, chit, r.organizerName(), r.organizerPhone(), Boolean.TRUE.equals(r.savePhone()), r.organizerAddress(),
                r.memberName(), r.memberAddress(), r.place());
        a.setRequireLocation(Boolean.TRUE.equals(r.requireLocation()));
        a.setInstallmentIds(chosen.stream().map(i -> String.valueOf(i.getId())).collect(Collectors.joining(",")));
        a.setSchedule(chosen.stream().map(this::line).collect(Collectors.joining("\n")));
        a.setAmount(Money.round(chosen.stream().map(i -> Money.nz(i.getPaidAmount())).reduce(Money.ZERO, BigDecimal::add)));
        a = acks.save(a);
        a.setAckNo(String.format("CR-%06d", a.getId()));
        seal(a, chit, chosen.size());
        acks.save(a);
        activity.record("ADDED", AREA, "Payment receipt " + a.getAckNo() + " for " + chit.getName() + " · installment"
                + (chosen.size() == 1 ? " " : "s ") + numbers(chosen) + " · " + ActivityService.money(a.getAmount()));
        return r.hours() == null ? new CreatedLink(view(a), null) : newLink(a, r.hours(), "Sent");
    }

    /** The full and final settlement, once the payout is received in full. */
    @Transactional
    public CreatedLink createSettlement(Long chitId, SettlementRequest r) {
        Chit chit = chit(chitId);
        if (chit.getPayoutAmount() == null) {
            throw new BusinessException("Record the payout first: the settlement acknowledges it");
        }
        BigDecimal received = chit.getPayoutReceived() == null ? chit.getPayoutAmount() : chit.getPayoutReceived();
        if (received.compareTo(chit.getPayoutAmount()) < 0) {
            throw new BusinessException("Only " + ActivityService.money(received) + " of the payout of " + ActivityService.money(chit.getPayoutAmount())
                    + " is received. Record the rest first: a settlement is full and final");
        }
        List<ChitAcknowledgement> existing = acks.findByChitId(chit.getTenantId(), chitId);
        ChitAcknowledgement old = existing.stream().filter(x -> !x.isReceipt()).findFirst().orElse(null);
        if (old != null) {
            throw new BusinessException("The settlement " + old.getAckNo() + " is already made" + (old.isPending() ? ": resend it, or delete it to make it again" : ""));
        }
        List<ChitInstallment> paid = installments.findByChitIdOrderByInstallmentNo(chitId).stream()
                .filter(i -> i.getStatus() == InstallmentStatus.PAID).toList();
        if (paid.isEmpty()) {
            throw new BusinessException("No installment is paid on this chit");
        }
        ChitAcknowledgement a = fresh(chit, ChitAcknowledgement.SETTLEMENT);
        parties(a, chit, r.organizerName(), r.organizerPhone(), Boolean.TRUE.equals(r.savePhone()), r.organizerAddress(),
                r.memberName(), r.memberAddress(), r.place());
        a.setRequireLocation(Boolean.TRUE.equals(r.requireLocation()));
        if (blank(r.memberSignature()) != null) a.setMemberSignature(HostedChitService.drawn(r.memberSignature(), "your signature"));
        a.setInstallmentIds(paid.stream().map(i -> String.valueOf(i.getId())).collect(Collectors.joining(",")));
        List<ChitAcknowledgement> inForce = existing.stream().filter(x -> x.isReceipt() && x.isInForce()).toList();
        List<String> lines = new ArrayList<>(paid.stream().map(this::line).toList());
        inForce.forEach(x -> lines.add(String.join("|", "R", x.getAckNo(), String.valueOf(x.getAcceptedAt() == null ? null : x.getAcceptedAt().toLocalDate()),
                x.getAmount().toPlainString(), x.getStatus())));
        a.setSchedule(String.join("\n", lines));
        a.setCancelsAckNos(inForce.isEmpty() ? null : inForce.stream().map(ChitAcknowledgement::getAckNo).collect(Collectors.joining(",")));
        a.setAmount(Money.round(paid.stream().map(i -> Money.nz(i.getPaidAmount())).reduce(Money.ZERO, BigDecimal::add)));
        a.setPayoutAmount(chit.getPayoutAmount());
        a.setPayoutDate(chit.getPayoutDate());
        a = acks.save(a);
        a.setAckNo(String.format("CS-%06d", a.getId()));
        seal(a, chit, paid.size());
        acks.save(a);
        activity.record("ADDED", AREA, "Payout settlement " + a.getAckNo() + " for " + chit.getName() + " · payout "
                + ActivityService.money(a.getPayoutAmount()) + (inForce.isEmpty() ? "" : " · cancels " + a.getCancelsAckNos()));
        return r.hours() == null ? new CreatedLink(view(a), null) : newLink(a, r.hours(), "Sent");
    }

    /**
     * Sends it again: a new link (the old one stops). A signed or paper one is asked for again: the signature is
     * discarded (its seal stays in the activity log) and the figures are read afresh.
     */
    @Transactional
    public CreatedLink resend(Long chitId, Long ackId, LinkRequest r) {
        ChitAcknowledgement a = require(chitId, ackId);
        Chit chit = chit(chitId);
        if (a.getCancelledAt() != null) {
            throw new BusinessException(a.getAckNo() + " was cancelled by the settlement " + a.getCancelledByAckNo() + "; it cannot be sent again");
        }
        if (blank(r.organizerPhone()) != null) {
            String phone = HostedChitService.cleanPhone(r.organizerPhone(), "The organizer");
            a.setOrganizerPhone(phone);
            if (Boolean.TRUE.equals(r.savePhone())) savePhone(chit, phone);
        }
        if (!a.isPending()) {
            if (!a.isReceipt() && a.getCancelsAckNos() != null) restoreCancelled(a);
            String was = a.getAcceptedName() + " on " + OrgClock.toOrg(a.getAcceptedAt()).format(DAY)
                    + (a.getAcceptanceSeal() != null ? " (seal " + a.getAcceptanceSeal().substring(0, 16) + "…)" : " (on paper)");
            clearEvidence(a);
            a.setStatus(ChitAcknowledgement.PENDING);
            refreshFigures(a, chit);
            acks.save(a);
            activity.record("CHANGED", AREA, "Asked again to sign " + a.getAckNo() + " · " + chit.getName() + " · the earlier signature by " + was + " was discarded");
        }
        return newLink(a, r.hours(), "Resent");
    }

    @Transactional
    public AckView revokeLink(Long chitId, Long ackId) {
        ChitAcknowledgement a = require(chitId, ackId);
        if (a.getTokenHash() != null && a.getLinkRevokedAt() == null) {
            a.setLinkRevokedAt(OrgClock.now());
            acks.save(a);
            activity.record("REVOKED", AREA, "Stopped the link of " + a.getAckNo() + " · " + a.getChitName());
        }
        return view(a);
    }

    /** Stamp, signatures and witness of the printed copy; allowed after signing (they are not part of the wording). */
    @Transactional
    public AckView paper(Long chitId, Long ackId, PaperRequest r) {
        ChitAcknowledgement a = require(chitId, ackId);
        if (r.stampDuty() != null) a.setStampDuty(r.stampDuty().signum() > 0 ? Money.round(r.stampDuty()) : null);
        if (r.stampSerial() != null) a.setStampSerial(blank(r.stampSerial()));
        if (r.witnessName() != null) a.setWitnessName(blank(r.witnessName()));
        if (r.witnessPhone() != null) a.setWitnessPhone(blank(r.witnessPhone()) == null ? null : HostedChitService.cleanPhone(r.witnessPhone(), "The witness"));
        if (Boolean.TRUE.equals(r.clearMemberSignature())) a.setMemberSignature(null);
        else if (blank(r.memberSignature()) != null) a.setMemberSignature(HostedChitService.drawn(r.memberSignature(), "your signature"));
        if (Boolean.TRUE.equals(r.clearWitnessSignature())) a.setWitnessSignature(null);
        else if (blank(r.witnessSignature()) != null) {
            if (a.getWitnessName() == null) throw new BusinessException("Enter the witness's name with their signature");
            a.setWitnessSignature(HostedChitService.drawn(r.witnessSignature(), "the witness's signature"));
        }
        acks.save(a);
        activity.record("CHANGED", AREA, "Paper copy details of " + a.getAckNo() + " · " + a.getChitName());
        return view(a);
    }

    /** The organizer signed a printed copy (with the revenue stamp, or on stamp paper), recorded by the member. */
    @Transactional
    public AckView signedOnPaper(Long chitId, Long ackId, PaperSignedRequest r) {
        ChitAcknowledgement a = require(chitId, ackId);
        if (!a.isPending()) {
            throw new BusinessException(a.getAckNo() + " is already " + a.getStatus().toLowerCase());
        }
        a.setStatus(ChitAcknowledgement.PAPER);
        a.setAcceptedName(blank(r.name()) != null ? ActivityService.cut(r.name().trim(), 100) : a.getOrganizerName());
        a.setAcceptedAt(OrgClock.now());
        a.setAcceptedUserAgent("Signed in person on paper, recorded by " + UserContext.get().fullName());
        if (a.getTokenHash() != null && a.getLinkRevokedAt() == null) a.setLinkRevokedAt(OrgClock.now());
        acks.save(a);
        if (!a.isReceipt()) cancelReceipts(a);
        activity.record("CHANGED", AREA, a.getAckNo() + " signed on paper by " + a.getAcceptedName() + " · " + a.getChitName());
        return view(a);
    }

    /**
     * Deletes it (its installments can be acknowledged again). A signed one goes too, when the member says so: the
     * activity log keeps who signed and its seal. Deleting a settlement brings the receipts it cancelled back in force.
     */
    @Transactional
    public void delete(Long chitId, Long ackId) {
        ChitAcknowledgement a = require(chitId, ackId);
        if (!a.isReceipt()) restoreCancelled(a);
        acks.deleteById(a.getId());
        activity.record("DELETED", AREA, "Deleted " + a.getAckNo() + " · " + a.getChitName() + " · " + ActivityService.money(a.getAmount())
                + (a.isPending() ? "" : " · it was signed by " + a.getAcceptedName() + " on " + OrgClock.toOrg(a.getAcceptedAt()).format(DAY)
                + (a.getAcceptanceSeal() != null ? " (seal " + a.getAcceptanceSeal() + ")" : " (on paper)")));
    }

    /** The receipts of a chit by installment: for the installments table. */
    public static Map<Long, ChitAcknowledgement> receiptsByInstallment(List<ChitAcknowledgement> all) {
        Map<Long, ChitAcknowledgement> out = new LinkedHashMap<>();
        all.stream().filter(ChitAcknowledgement::isReceipt).sorted(Comparator.comparing(ChitAcknowledgement::getId))
                .forEach(a -> ids(a).forEach(id -> out.put(id, a)));
        return out;
    }

    // ================================================================== the organizer's side (no sign-in)

    @Transactional(noRollbackFor = VerificationFailed.class)
    public PublicAck open(String token, OpenRequest r) {
        ChitAcknowledgement a = active(token);
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

    /** The organizer signs: the evidence is checked, sealed and digitally signed. */
    @Transactional(noRollbackFor = VerificationFailed.class)
    public PublicAck accept(String token, AcceptRequest r, String ip, String userAgent) {
        ChitAcknowledgement a = active(token);
        String phone = verify(a, r.phone());
        if (!a.isPending()) {
            throw new BusinessException("This was already signed on " + OrgClock.toOrg(a.getAcceptedAt()).format(DAY));
        }
        if (!Boolean.TRUE.equals(r.agree())) {
            throw new BusinessException("Tick the box to confirm what you sign");
        }
        String name = r.name() == null ? "" : r.name().trim().replaceAll("\\s+", " ");
        if (name.length() < 2) {
            throw new BusinessException("Type your full name");
        }
        String signature = HostedChitService.drawn(r.signature(), "your signature with your finger");
        String location = blank(r.location());
        if (location != null && !location.matches("-?\\d{1,3}(\\.\\d+)?,-?\\d{1,3}(\\.\\d+)?(,\\d+(\\.\\d+)?)?")) {
            location = null;
        }
        if (Boolean.TRUE.equals(a.getRequireLocation()) && location == null) {
            throw new BusinessException("Allow your location when your phone asks: " + a.getMemberName() + " needs it with the signature");
        }
        String device = r.device() == null ? null : ActivityService.cut(r.device(), 2000);
        String remarks = blank(r.remarks()) == null ? null : ActivityService.cut(r.remarks().trim(), 300);
        LocalDateTime now = OrgClock.now().withNano(0);
        a.setStatus(ChitAcknowledgement.SIGNED);
        a.setAcceptedName(ActivityService.cut(name, 100));
        a.setAcceptedAt(now);
        a.setAcceptedPhone(phone);
        a.setPhoneMatches(a.getOrganizerPhone() == null ? null : Boolean.TRUE);
        a.setAcceptedIp(ActivityService.cut(ip, 64));
        a.setAcceptedUserAgent(userAgent == null ? null : ActivityService.cut(userAgent, 255));
        a.setAcceptedDevice(device);
        a.setDeviceHash(device == null ? null : HostedChitService.sha256(device));
        a.setAcceptedLocation(location);
        a.setAcceptedRemarks(remarks);
        a.setSignature(signature);
        a.setAcceptanceSeal(HostedChitService.sha256(String.join("|", a.getContentHash(), name, phone, now.toString(), String.valueOf(ip),
                String.valueOf(userAgent), String.valueOf(a.getDeviceHash()), String.valueOf(location), String.valueOf(remarks),
                HostedChitService.sha256(signature))));
        Map<String, Object> ev = new LinkedHashMap<>();
        ev.put("v", 1);
        ev.put("kind", a.isReceipt() ? "CHIT_PAYMENT_RECEIPT" : "CHIT_PAYOUT_SETTLEMENT");
        ev.put("ackNo", a.getAckNo());
        ev.put("contentHash", a.getContentHash());
        ev.put("chit", a.getChitName());
        ev.put("member", a.getMemberName());
        ev.put("organizer", a.getOrganizerName());
        ev.put("amount", a.getAmount());
        if (!a.isReceipt()) {
            ev.put("payout", a.getPayoutAmount());
            ev.put("cancels", a.getCancelsAckNos());
        }
        ev.put("acceptedName", name);
        ev.put("phoneLast4", phone.substring(6));
        ev.put("phoneOnRecord", a.getOrganizerPhone() != null);
        ev.put("acceptedAt", now.toString());
        ev.put("ip", ip);
        ev.put("userAgentHash", userAgent == null ? null : HostedChitService.sha256(userAgent));
        ev.put("deviceHash", a.getDeviceHash());
        ev.put("location", location);
        ev.put("remarks", remarks);
        ev.put("signatureHash", HostedChitService.sha256(signature));
        ev.put("seal", a.getAcceptanceSeal());
        a.setEvidencePayload(ActivityService.cut(Kyc.json(ev), 4000));
        a.setDigitalSignature(settings.signPayLink(a.getEvidencePayload()));
        acks.save(a);
        Organization tenant = tenant(a);
        return asTenant(tenant, () -> {
            if (!a.isReceipt()) cancelReceipts(a);
            activity.record(linkUser(tenant, name), "ACCEPTED", AREA, (a.isReceipt() ? "Payment receipt " : "Payout settlement ") + a.getAckNo()
                    + " signed by " + name + " · " + a.getChitName() + " · " + ActivityService.money(a.isReceipt() ? a.getAmount() : a.getPayoutAmount()),
                    "POST", "/public/chit-receipts");
            return full(a, tenant);
        });
    }

    // ================================================================== helpers

    private ChitAcknowledgement fresh(Chit chit, String kind) {
        ChitAcknowledgement a = new ChitAcknowledgement();
        a.setTenantId(chit.getTenantId());
        a.setChitId(chit.getId());
        a.setKind(kind);
        a.setAckNo(ChitAcknowledgement.RECEIPT.equals(kind) ? "CR-pending" : "CS-pending");
        a.setTerms("pending");
        a.setContentHash("pending");
        a.setStatus(ChitAcknowledgement.PENDING);
        a.setChitName(chit.getName());
        a.setTicketNo(chit.getTicketNo());
        a.setChitValue(chit.getMaturityAmount());
        a.setCreatedBy(UserContext.username());
        a.setCreatedAt(OrgClock.now());
        a.setViews(0);
        a.setFailedAttempts(0);
        a.setSendCount(0);
        return a;
    }

    private void parties(ChitAcknowledgement a, Chit chit, String organizerName, String organizerPhone, boolean savePhone,
                         String organizerAddress, String memberName, String memberAddress, String place) {
        a.setOrganizerName(blank(organizerName) != null ? ActivityService.cut(organizerName.trim(), 100)
                : chit.getOrganizer() != null && !chit.getOrganizer().isBlank() ? chit.getOrganizer().trim() : "The organizer");
        String phone = blank(organizerPhone) != null ? HostedChitService.cleanPhone(organizerPhone, "The organizer") : chit.getOrganizerPhone();
        a.setOrganizerPhone(phone);
        if (savePhone && phone != null) savePhone(chit, phone);
        a.setOrganizerAddress(blank(organizerAddress));
        a.setMemberName(blank(memberName) != null ? ActivityService.cut(memberName.trim(), 100) : UserContext.get().fullName());
        a.setMemberAddress(blank(memberAddress));
        a.setPlace(blank(place));
    }

    private void savePhone(Chit chit, String phone) {
        if (phone.equals(chit.getOrganizerPhone())) return;
        Chit fresh = chits.findById(chit.getId()).orElseThrow();
        fresh.setOrganizerPhone(phone);
        chits.save(fresh);
        chit.setOrganizerPhone(phone);
    }

    /** The wording (generated with the figures) and its fingerprint. */
    private void seal(ChitAcknowledgement a, Chit chit, int count) {
        a.setTerms(ActivityService.cut(a.isReceipt() ? receiptTerms(a, count) : settlementTerms(a, chit, count), 6000));
        a.setContentHash(HostedChitService.sha256(String.join("|", a.getAckNo(), a.getKind(), a.getMemberName(), a.getOrganizerName(),
                a.getChitName(), String.valueOf(a.getTicketNo()), a.getAmount().toPlainString(), String.valueOf(a.getPayoutAmount()),
                a.getSchedule(), a.getTerms())));
    }

    /** A signed one asked again: its installments as they stand now. */
    private void refreshFigures(ChitAcknowledgement a, Chit chit) {
        Map<Long, ChitInstallment> byId = installments.findByChitIdOrderByInstallmentNo(chit.getId()).stream()
                .collect(Collectors.toMap(ChitInstallment::getId, i -> i));
        List<ChitInstallment> list = ids(a).stream().map(byId::get).filter(Objects::nonNull)
                .filter(i -> i.getStatus() == InstallmentStatus.PAID).toList();
        if (list.isEmpty()) {
            throw new BusinessException("None of its installments is paid any more: delete it instead");
        }
        List<String> lines = new ArrayList<>(list.stream().map(this::line).toList());
        if (!a.isReceipt()) {
            Arrays.stream(a.getSchedule().split("\n")).filter(l -> l.startsWith("R|")).forEach(lines::add);
            a.setPayoutAmount(chit.getPayoutAmount());
            a.setPayoutDate(chit.getPayoutDate());
        }
        a.setInstallmentIds(list.stream().map(i -> String.valueOf(i.getId())).collect(Collectors.joining(",")));
        a.setSchedule(String.join("\n", lines));
        a.setAmount(Money.round(list.stream().map(i -> Money.nz(i.getPaidAmount())).reduce(Money.ZERO, BigDecimal::add)));
        a.setChitName(chit.getName());
        a.setTicketNo(chit.getTicketNo());
        a.setChitValue(chit.getMaturityAmount());
        seal(a, chit, list.size());
    }

    private CreatedLink newLink(ChitAcknowledgement a, int hours, String verb) {
        byte[] bytes = new byte[32];
        random.nextBytes(bytes);
        String token = Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
        LocalDateTime now = OrgClock.now();
        a.setTokenHash(AccessLinkService.hash(token));
        a.setLinkExpiresAt(now.plusHours(Math.min(hours, MAX_LINK_HOURS)));
        a.setLinkRevokedAt(null);
        a.setFailedAttempts(0);
        a.setLockedAt(null);
        a.setViews(0);
        a.setLastViewedAt(null);
        a.setSentAt(now);
        a.setSendCount((a.getSendCount() == null ? 0 : a.getSendCount()) + 1);
        acks.save(a);
        activity.record("ADDED", AREA, verb + " " + a.getAckNo() + " to " + a.getOrganizerName()
                + (a.getOrganizerPhone() != null ? " (" + a.getOrganizerPhone() + ")" : "") + " · link for "
                + (hours % 24 == 0 ? hours / 24 + " day" + (hours == 24 ? "" : "s") : hours + " hours"));
        return new CreatedLink(view(a), token);
    }

    /** A settlement signed: the receipts it lists, and any still waiting, are cancelled. */
    private void cancelReceipts(ChitAcknowledgement settlement) {
        Set<String> listed = settlement.getCancelsAckNos() == null ? Set.of() : Set.of(settlement.getCancelsAckNos().split(","));
        LocalDateTime now = OrgClock.now();
        for (ChitAcknowledgement r : acks.findByChitId(settlement.getTenantId(), settlement.getChitId())) {
            if (!r.isReceipt() || r.getCancelledAt() != null || !(listed.contains(r.getAckNo()) || r.isPending())) continue;
            r.setCancelledAt(now);
            r.setCancelledByAckNo(settlement.getAckNo());
            if (r.getTokenHash() != null && r.getLinkRevokedAt() == null) r.setLinkRevokedAt(now);
            acks.save(r);
        }
    }

    /** The settlement is deleted or asked again: what it cancelled is back in force. */
    private void restoreCancelled(ChitAcknowledgement settlement) {
        for (ChitAcknowledgement r : acks.findByChitId(settlement.getTenantId(), settlement.getChitId())) {
            if (settlement.getAckNo().equals(r.getCancelledByAckNo())) {
                r.setCancelledAt(null);
                r.setCancelledByAckNo(null);
                acks.save(r);
            }
        }
    }

    private static void clearEvidence(ChitAcknowledgement a) {
        a.setAcceptedName(null);
        a.setAcceptedAt(null);
        a.setAcceptedPhone(null);
        a.setPhoneMatches(null);
        a.setAcceptedIp(null);
        a.setAcceptedUserAgent(null);
        a.setAcceptedDevice(null);
        a.setDeviceHash(null);
        a.setAcceptedLocation(null);
        a.setAcceptedRemarks(null);
        a.setSignature(null);
        a.setAcceptanceSeal(null);
        a.setEvidencePayload(null);
        a.setDigitalSignature(null);
    }

    /** The installment frozen as a line: no|dueDate|paidDate|installment|dividend|cash|mode|reference. */
    private String line(ChitInstallment i) {
        Account from = i.getPaidFromAccountId() == null ? null : accounts.findById(i.getPaidFromAccountId()).orElse(null);
        JournalEntry e = i.getJournalEntryId() == null ? null : entries.findById(i.getJournalEntryId()).orElse(null);
        String ref = e == null || e.getReference() == null ? "" : e.getReference().replace('|', '/').replace('\n', ' ').trim();
        return String.join("|", String.valueOf(i.getInstallmentNo()), String.valueOf(i.getDueDate()),
                String.valueOf(i.getPaidDate() != null ? i.getPaidDate() : i.getDueDate()), i.getDueAmount().toPlainString(),
                Money.nz(i.getDividend()).toPlainString(), Money.nz(i.getPaidAmount()).toPlainString(), mode(from), ActivityService.cut(ref, 60));
    }

    private static String mode(Account a) {
        if (a == null) return "—";
        if (a.getAccountClass() == AccountClass.EQUITY) return "Paid before tracking";
        return switch (a.getAccountType().name()) {
            case "BANK" -> "Bank transfer";
            case "CASH" -> "Cash";
            case "WALLET" -> "UPI / wallet";
            case "CREDIT_CARD" -> "Card";
            default -> a.getAccountType().name().replace('_', ' ').toLowerCase();
        };
    }

    static List<ScheduleLine> scheduleOf(ChitAcknowledgement a) {
        List<ScheduleLine> out = new ArrayList<>();
        for (String l : a.getSchedule().split("\n")) {
            if (l.isBlank() || l.startsWith("R|")) continue;
            String[] p = l.split("\\|", -1);
            out.add(new ScheduleLine(Integer.parseInt(p[0]), LocalDate.parse(p[1]), "null".equals(p[2]) ? null : LocalDate.parse(p[2]),
                    new BigDecimal(p[3]), new BigDecimal(p[4]), new BigDecimal(p[5]), p[6], p.length > 7 && !p[7].isEmpty() ? p[7] : null));
        }
        return out;
    }

    static List<CancelledReceipt> cancelsOf(ChitAcknowledgement a) {
        List<CancelledReceipt> out = new ArrayList<>();
        for (String l : a.getSchedule().split("\n")) {
            if (!l.startsWith("R|")) continue;
            String[] p = l.split("\\|", -1);
            out.add(new CancelledReceipt(p[1], "null".equals(p[2]) ? null : LocalDate.parse(p[2]), new BigDecimal(p[3]), p[4]));
        }
        return out;
    }

    private static List<Long> ids(ChitAcknowledgement a) {
        return Arrays.stream(a.getInstallmentIds().split(",")).filter(s -> !s.isBlank()).map(s -> Long.valueOf(s.trim())).toList();
    }

    /** The receipt (waiting or in force, not cancelled) an installment is on. */
    private static ChitAcknowledgement receiptOf(List<ChitAcknowledgement> all, Long installmentId) {
        return all.stream().filter(a -> a.isReceipt() && a.getCancelledAt() == null && ids(a).contains(installmentId)).findFirst().orElse(null);
    }

    private static String numbers(List<ChitInstallment> list) {
        return list.stream().map(i -> "#" + i.getInstallmentNo()).collect(Collectors.joining(", "));
    }

    private static String rupees(BigDecimal amount) {
        return ActivityService.money(amount) + " (Rupees " + HostedChitService.inWords(amount).replaceFirst("(?i)^rupees\\s+", "")
                .replaceFirst("(?i)\\s+only$", "") + " only)";
    }

    private static String chitText(ChitAcknowledgement a) {
        return "the chit known as \"" + a.getChitName() + "\"" + (a.getTicketNo() != null ? ", ticket / group no. " + a.getTicketNo() : "")
                + (a.getChitValue() != null ? ", of chit value " + ActivityService.money(a.getChitValue()) : "");
    }

    private static String jurisdiction(ChitAcknowledgement a) {
        return "GOVERNING LAW AND JURISDICTION: This document shall be governed by the laws of India. "
                + (a.getPlace() != null ? "The courts at " + a.getPlace() + " shall have exclusive jurisdiction"
                : "The courts having jurisdiction over the place where it is executed shall have exclusive jurisdiction")
                + " in all matters arising out of it.";
    }

    private static final String ELECTRONIC = "ELECTRONIC EXECUTION AND EVIDENCE: The parties agree that this document may be signed electronically. "
            + "The verification of the signatory's mobile number, the drawn signature, the details of the device used and the digitally signed "
            + "record of the signature shall constitute valid evidence of its execution, in accordance with the Information Technology Act, 2000 and "
            + "section 63 of the Bharatiya Sakshya Adhiniyam, 2023. A printed copy of it, together with that record, shall be admissible as the original.";

    /** A receipt: numbered clauses, each "HEADING: text" (the deed shows the heading in bold). */
    private static String receiptTerms(ChitAcknowledgement a, int count) {
        List<String> t = new ArrayList<>();
        t.add("RECEIPT: The Organizer acknowledges having received from the Member a sum of " + rupees(a.getAmount()) + " (the \"Amount\") towards "
                + (count == 1 ? "one installment" : count + " installments") + " of " + chitText(a) + ", in which the Member is a subscriber, as set out "
                + "installment by installment in the Schedule, and confirms that the Amount was received in full on the dates and in the manner stated there.");
        t.add("CREDIT TO THE MEMBER: The Organizer confirms that the Amount has been credited to the Member's subscription in the chit, that the "
                + "installments listed in the Schedule stand paid, and that no arrears, interest, penalty or other charge is due from the Member in respect of them.");
        t.add("DIVIDENDS: Where a dividend (the Member's share of the auction discount) is shown against an installment, the Organizer confirms that the "
                + "installment was discharged in full by the cash shown together with that dividend.");
        t.add("STATUTORY RECEIPTS: This Receipt is in addition to, and does not replace, any receipt, pass book or statement issued by the Organizer under "
                + "the Chit Funds Act, 1982, the rules made under it or the bye-laws of the chit. The Organizer shall not dispute the payments acknowledged here.");
        t.add("SUBSCRIPTION HELD FOR THE MEMBER: The Organizer acknowledges that the Amount is held towards the Member's subscription and is to be "
                + "returned to the Member by way of the prize amount or on maturity, or as the law provides should the chit be terminated or not conducted.");
        t.add(ELECTRONIC);
        t.add("STAMP: Where this Receipt is executed on paper for a sum exceeding Rupees Five Thousand, the Organizer shall affix a revenue stamp and sign "
                + "across it as required by the Indian Stamp Act, 1899 or the stamp law in force in the State.");
        t.add(jurisdiction(a));
        t.add("DECLARATION: The person signing declares that he or she is the Organizer, or is authorised to sign this Receipt on the Organizer's behalf, "
                + "has read and understood it, and signs it freely and voluntarily.");
        return numbered(t);
    }

    /** A settlement: the payout acknowledged by the member, the installments confirmed and the receipts cancelled. */
    private String settlementTerms(ChitAcknowledgement a, Chit chit, int count) {
        List<ChitInstallment> pending = installments.findByChitIdOrderByInstallmentNo(chit.getId()).stream()
                .filter(i -> i.getStatus() == InstallmentStatus.PENDING).toList();
        BigDecimal toPay = pending.stream().map(ChitInstallment::getDueAmount).reduce(Money.ZERO, BigDecimal::add);
        String cancels = a.getCancelsAckNos() == null ? null : String.join(", ", a.getCancelsAckNos().split(","));
        List<String> t = new ArrayList<>();
        t.add("PAYOUT RECEIVED: The Member acknowledges having received from the Organizer the " + (pending.isEmpty() ? "amount" : "prize amount")
                + " of " + rupees(a.getPayoutAmount()) + " in respect of " + chitText(a) + ", the first part of it on "
                + (a.getPayoutDate() == null ? "the date recorded" : a.getPayoutDate().format(DAY)) + ", and confirms that it has been received in full.");
        t.add("INSTALLMENTS CONFIRMED: The Organizer confirms having received from the Member " + (count == 1 ? "one installment" : count + " installments")
                + " amounting in cash to " + rupees(a.getAmount()) + ", as set out in the Schedule, and that none of them is in arrears.");
        t.add(cancels == null
                ? "EARLIER RECEIPTS: No separate receipt issued by the Organizer for these installments is relied upon; the payments stand confirmed by this Settlement."
                : "CANCELLATION OF EARLIER RECEIPTS: Upon execution of this Settlement, the receipts " + cancels + " issued by the Organizer for the installments "
                + "listed in the Schedule are cancelled and superseded by it, and shall not be relied upon by either Party for any further claim; the payments "
                + "they record stand confirmed by this Settlement.");
        t.add(pending.isEmpty()
                ? "FULL AND FINAL SETTLEMENT: The Parties confirm that no further sum is payable by either of them to the other in respect of the chit, and release "
                + "each other from all claims arising out of it."
                : "REMAINING INSTALLMENTS: The Member's obligation to pay the remaining " + pending.size() + " installment" + (pending.size() == 1 ? "" : "s")
                + " of the chit, amounting to " + ActivityService.money(toPay) + " before any dividend, continues as per the terms of the chit and is not "
                + "discharged by this Settlement. Subject to that, no further sum is payable by either Party to the other in respect of the chit.");
        t.add(ELECTRONIC);
        t.add("STAMP: Where this Settlement is executed on paper, it shall bear the stamp duty payable on it under the Indian Stamp Act, 1899 or the stamp "
                + "law in force in the State.");
        t.add(jurisdiction(a));
        t.add("DECLARATION: Each Party declares that he or she has read and understood this Settlement and signs it freely and voluntarily, and the person "
                + "signing for the Organizer declares that he or she is authorised to do so.");
        return numbered(t);
    }

    private static String numbered(List<String> t) {
        StringBuilder out = new StringBuilder();
        for (int i = 0; i < t.size(); i++) out.append(i + 1).append(". ").append(t.get(i)).append(i + 1 < t.size() ? "\n" : "");
        return out.toString();
    }

    /** With a number on record it must be typed (wrong ones are counted and lock the link); without, any mobile is recorded. */
    private String verify(ChitAcknowledgement a, String typed) {
        if (a.getLockedAt() != null) {
            throw new BusinessException("This link is locked after too many wrong numbers. Ask " + a.getMemberName() + " for a new link.");
        }
        String digits = typed == null ? "" : typed.replaceAll("\\D", "");
        if (digits.length() > 10 && digits.startsWith("91")) digits = digits.substring(digits.length() - 10);
        if (!digits.matches("[6-9]\\d{9}")) {
            throw new BusinessException("Enter your 10-digit mobile number");
        }
        if (a.getOrganizerPhone() != null && !digits.equals(a.getOrganizerPhone())) {
            int failed = (a.getFailedAttempts() == null ? 0 : a.getFailedAttempts()) + 1;
            a.setFailedAttempts(failed);
            if (failed >= MAX_ATTEMPTS) a.setLockedAt(OrgClock.now());
            acks.save(a);
            throw new VerificationFailed(failed >= MAX_ATTEMPTS
                    ? "That is not the number this was sent to. The link is now locked: ask " + a.getMemberName() + " for a new one."
                    : "That is not the number this was sent to (" + (MAX_ATTEMPTS - failed) + " tr" + (MAX_ATTEMPTS - failed == 1 ? "y" : "ies") + " left)");
        }
        return digits;
    }

    private PublicAck gate(ChitAcknowledgement a, Organization t, String error) {
        int left = MAX_ATTEMPTS - (a.getFailedAttempts() == null ? 0 : a.getFailedAttempts());
        String hint = Arrays.stream(a.getOrganizerName().split("\\s+")).map(w -> w.isEmpty() ? w : w.charAt(0) + "•••").collect(Collectors.joining(" "));
        String phoneHint = a.getOrganizerPhone() == null ? null : "••••••" + a.getOrganizerPhone().substring(6);
        return new PublicAck("VERIFY", error, Math.max(0, left), a.getOrganizerPhone() != null, t.getName(), a.getMemberName(), hint, phoneHint,
                a.getKind(), a.getAckNo(), a.getLinkExpiresAt(), null, null, null, null, null, null, null, null, null, List.of(), null, null, List.of(),
                null, null, t.getCurrency(), null, null, null, null, null, Boolean.TRUE.equals(a.getRequireLocation()), a.getStatus(), null, null, null,
                null, null, false, null, null, null, null, null, null, null);
    }

    private PublicAck full(ChitAcknowledgement a, Organization t) {
        boolean done = !a.isPending() || a.getCancelledAt() != null;
        return new PublicAck(done ? "DONE" : "OPEN", null, null, a.getOrganizerPhone() != null, t.getName(), a.getMemberName(), null,
                a.getOrganizerPhone() == null ? null : "••••••" + a.getOrganizerPhone().substring(6), a.getKind(), a.getAckNo(), a.getLinkExpiresAt(),
                a.getOrganizerName(), a.getOrganizerAddress(), a.getMemberAddress(), a.getChitName(), a.getTicketNo(), a.getChitValue(), a.getPlace(),
                a.getAmount(), HostedChitService.inWords(a.getAmount()), scheduleOf(a), a.getPayoutAmount(), a.getPayoutDate(), cancelsOf(a),
                a.getTerms(), a.getContentHash(), t.getCurrency(), a.getStampDuty(), a.getStampSerial(), a.getMemberSignature(), a.getWitnessName(),
                a.getWitnessSignature(), Boolean.TRUE.equals(a.getRequireLocation()), a.effectiveStatus(), a.getAcceptedName(), a.getAcceptedAt(),
                a.getAcceptedRemarks(), a.getSignature(), a.getAcceptanceSeal(), a.getAcceptedLocation() != null, a.getEvidencePayload(),
                a.getDigitalSignature(), settings.payLinkPublicKey(), settings.payLinkFingerprint(), a.getCancelledAt(), a.getCancelledByAckNo(),
                a.getCreatedAt());
    }

    private AckView view(ChitAcknowledgement a) {
        LocalDateTime now = OrgClock.now();
        String link = a.getTokenHash() == null ? "NONE" : a.getLockedAt() != null ? "LOCKED" : a.getLinkRevokedAt() != null ? "REVOKED"
                : a.getLinkExpiresAt() != null && a.getLinkExpiresAt().isAfter(now) ? "ACTIVE" : "EXPIRED";
        return new AckView(a.getId(), a.getChitId(), a.getKind(), a.getAckNo(), a.effectiveStatus(), a.getChitName(), a.getTicketNo(), a.getChitValue(),
                a.getMemberName(), a.getMemberAddress(), a.getOrganizerName(), a.getOrganizerPhone(), a.getOrganizerAddress(), a.getPlace(),
                a.getAmount(), HostedChitService.inWords(a.getAmount()), ids(a), scheduleOf(a), a.getPayoutAmount(), a.getPayoutDate(), cancelsOf(a),
                a.getCancelledAt(), a.getCancelledByAckNo(), a.getTerms(), a.getContentHash(), a.getStampDuty(), a.getStampSerial(),
                a.getMemberSignature(), a.getWitnessName(), a.getWitnessPhone(), a.getWitnessSignature(), Boolean.TRUE.equals(a.getRequireLocation()),
                link, a.getLinkExpiresAt(), a.getSentAt(), a.getSendCount() == null ? 0 : a.getSendCount(), a.getViews() == null ? 0 : a.getViews(),
                a.getLastViewedAt(), a.getFailedAttempts() == null ? 0 : a.getFailedAttempts(), a.getLockedAt(),
                a.getAcceptedName(), a.getAcceptedAt(), a.getAcceptedPhone(), a.getPhoneMatches(), a.getAcceptedIp(), a.getAcceptedUserAgent(),
                a.getAcceptedDevice(), a.getDeviceHash(), a.getAcceptedLocation(), a.getAcceptedRemarks(), a.getSignature(), a.getAcceptanceSeal(),
                a.getEvidencePayload(), a.getDigitalSignature(), settings.payLinkPublicKey(), settings.payLinkFingerprint(), a.getCreatedBy(), a.getCreatedAt());
    }

    private Chit chit(Long chitId) {
        return chits.findByIdAndTenantId(chitId, UserContext.tenantId()).orElseThrow(() -> new NotFoundException("Chit", chitId));
    }

    private ChitAcknowledgement require(Long chitId, Long ackId) {
        Chit chit = chit(chitId);
        return acks.findByIdAndTenantId(ackId, chit.getTenantId()).filter(a -> a.getChitId().equals(chitId))
                .orElseThrow(() -> new NotFoundException("Chit receipt", ackId));
    }

    private ChitAcknowledgement active(String token) {
        ChitAcknowledgement a = token == null || token.isBlank() ? null : acks.findByTokenHash(AccessLinkService.hash(token.trim())).orElse(null);
        if (a == null) {
            throw new BusinessException("This link is not valid");
        }
        if (a.getLinkRevokedAt() != null) {
            throw new BusinessException(a.getCancelledAt() != null
                    ? "This was cancelled by the settlement " + a.getCancelledByAckNo() + "."
                    : "This link was switched off. Ask " + a.getMemberName() + " for a new one.");
        }
        if (a.getLinkExpiresAt() == null || !a.getLinkExpiresAt().isAfter(OrgClock.now())) {
            throw new BusinessException("This link has expired. Ask " + a.getMemberName() + " for a new one.");
        }
        return a;
    }

    private Organization tenant(ChitAcknowledgement a) {
        return tenants.findById(a.getTenantId()).filter(t -> Boolean.TRUE.equals(t.getActive()))
                .orElseThrow(() -> new BusinessException("This is no longer shared"));
    }

    private static CurrentUser linkUser(Organization t, String name) {
        return new CurrentUser(null, "link", name, UserRole.VIEWER, t.getId(), t.getCode(), t.getName(), t.getCurrency(), Feature.all(), false);
    }

    private static <T> T asTenant(Organization tenant, Supplier<T> work) {
        CurrentUser previous = UserContext.current().orElse(null);
        OrgClock.showFor(tenant.getId());
        UserContext.set(new CurrentUser(null, "receipt-link", "Receipt link", UserRole.VIEWER, tenant.getId(), tenant.getCode(),
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
