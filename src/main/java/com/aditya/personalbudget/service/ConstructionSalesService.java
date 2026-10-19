package com.aditya.personalbudget.service;

import com.aditya.personalbudget.domain.entity.ConstructionInstalment;
import com.aditya.personalbudget.domain.entity.ConstructionParty;
import com.aditya.personalbudget.domain.entity.ConstructionProject;
import com.aditya.personalbudget.domain.entity.ConstructionSale;
import com.aditya.personalbudget.domain.entity.ConstructionStage;
import com.aditya.personalbudget.domain.entity.ConstructionUnit;
import com.aditya.personalbudget.exception.BusinessException;
import com.aditya.personalbudget.exception.NotFoundException;
import com.aditya.personalbudget.security.UserContext;
import com.aditya.personalbudget.service.AttachmentService.AgreementFile;
import com.aditya.personalbudget.service.ConstructionService.Detail;
import com.aditya.personalbudget.service.ConstructionService.PartyInput;
import com.aditya.personalbudget.service.ConstructionService.UnitPlan;
import jakarta.validation.Valid;
import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.PositiveOrZero;
import jakarta.validation.constraints.Size;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.stream.Collectors;

/**
 * A development's land and flats: the plot's sellers or the landowners (joint development), the flats, and each
 * flat's sale: the buyer, the price and the payment plan (on dates, or a set number of days after a construction
 * stage is done), the buyer's home loan (bank, sanction, disbursements, its letters), and the sale's steps: booked,
 * agreement made, registered (the sale deed's number), handed over, closed. Files (the sanction letter, the
 * registered deed, title documents...) are kept with the sale or the project.
 */
@Service
public class ConstructionSalesService {

    public static final String SALE_FILES = "CONSTRUCTION_SALE";
    public static final String PROJECT_FILES = "CONSTRUCTION_PROJ";
    static final List<String> SALE_STEPS = List.of("BOOKED", "AGREED", "REGISTERED", "HANDED_OVER", "CLOSED");

    public record UnitRequest(@NotBlank @Size(max = 20) String unitNo, @Size(max = 20) String block, @Min(-5) @Max(200) Integer floor,
                              @Size(max = 20) String unitType, @PositiveOrZero BigDecimal carpetArea, @PositiveOrZero BigDecimal builtUpArea,
                              @PositiveOrZero BigDecimal superArea, @Size(max = 12) String facing, @Size(max = 40) String parking,
                              @PositiveOrZero BigDecimal price, @Size(max = 10) String allottedTo, Long partyId) {
    }

    /** A line of a payment plan: a percent of the price or an amount; due on a date, or days after a stage is done. */
    public record PlanRow(@NotBlank @Size(max = 100) String label, @PositiveOrZero @DecimalMax("100") BigDecimal percent,
                          @PositiveOrZero BigDecimal amount, LocalDate dueDate, Long stageId, @Min(0) @Max(365) Integer daysAfterStage) {
    }

    public record SaleRequest(@NotNull Long unitId, @NotBlank @Size(max = 100) String buyerName, @Size(max = 100) String buyerRelation,
                              @Size(max = 20) String buyerPhone, @Size(max = 100) String buyerEmail, @Size(max = 200) String buyerAddress,
                              @Size(max = 12) String buyerPan, @Size(max = 100) String coBuyerName, @NotNull LocalDate bookedOn,
                              @NotNull @PositiveOrZero BigDecimal basePrice, @PositiveOrZero BigDecimal otherCharges,
                              @Size(max = 200) String otherChargesNote, @PositiveOrZero @DecimalMax("10") BigDecimal lateInterestPercent,
                              List<@Valid PlanRow> plan) {
    }

    public record LoanInfo(@Size(max = 100) String loanBank, @Size(max = 100) String loanBranch, @PositiveOrZero BigDecimal loanAmount,
                           @Size(max = 40) String loanNo, LocalDate loanSanctionedOn, @Size(max = 12) String loanStatus) {
    }

    /** status: AGREED (agreementOn), REGISTERED (registeredOn, deedNo, subRegistrar), HANDED_OVER (handedOverOn), CLOSED, CANCELLED, or back. */
    public record SaleStep(@NotBlank String status, LocalDate on, @Size(max = 40) String deedNo, @Size(max = 100) String subRegistrar,
                           @Size(max = 300) String note) {
    }

    private final ConstructionService core;
    private final AttachmentService files;

    public ConstructionSalesService(ConstructionService core, AttachmentService files) {
        this.core = core;
        this.files = files;
    }

    // ================================================================== land: sellers and landowners

    @Transactional
    public Detail saveParty(Long id, Long partyId, PartyInput r) {
        ConstructionProject p = core.requireOpen(id);
        if (partyId == null) {
            ConstructionParty x = core.addParty(p, r);
            core.activity().record("ADDED", ConstructionService.AREA, ("SELLER".equals(x.getRole()) ? "Plot seller " : "Landowner ") + x.getName() + " · " + p.getName());
        } else {
            ConstructionParty x = requireParty(p, partyId);
            ConstructionService.partyFrom(x, r.role().trim().toUpperCase(), r);
            core.parties().save(x);
        }
        return core.detail(id);
    }

    @Transactional
    public Detail deleteParty(Long id, Long partyId) {
        ConstructionProject p = core.requireOpen(id);
        ConstructionParty x = requireParty(p, partyId);
        if (core.units().findByProjectId(id).stream().anyMatch(u -> partyId.equals(u.getPartyId()))) {
            throw new BusinessException("Flats are allotted to " + x.getName() + "; allot them to someone else first");
        }
        if (core.signedFor(p, "PLOT_PURCHASE", partyId) || core.signedFor(p, "JDA", partyId)) {
            throw new BusinessException("The agreement with " + x.getName() + " is signed; it is kept");
        }
        core.agreements().findByProjectId(id).stream().filter(a -> Set.of("PLOT_PURCHASE", "JDA").contains(a.getKind()) && partyId.equals(a.getRefId()))
                .forEach(a -> core.agreements().deleteById(a.getId()));
        core.parties().deleteById(partyId);
        return core.detail(id);
    }

    private ConstructionParty requireParty(ConstructionProject p, Long id) {
        return core.parties().findById(id).filter(x -> p.getId().equals(x.getProjectId())).orElseThrow(() -> new NotFoundException("Party", id));
    }

    // ================================================================== flats

    @Transactional
    public Detail makeUnits(Long id, UnitPlan plan) {
        ConstructionProject p = requireDevelopment(id);
        int made = core.makeUnits(p, plan).size();
        if (made == 0) throw new BusinessException("No new flats: they are there already, or no floors / units were given");
        core.activity().record("ADDED", ConstructionService.AREA, made + " flats added · " + p.getName());
        return core.detail(id);
    }

    @Transactional
    public Detail saveUnit(Long id, Long unitId, UnitRequest r) {
        ConstructionProject p = requireDevelopment(id);
        ConstructionUnit u;
        if (unitId == null) {
            u = new ConstructionUnit();
            u.setTenantId(p.getTenantId());
            u.setProjectId(p.getId());
            u.setCreatedAt(LocalDateTime.now());
            u.setStatus("AVAILABLE");
        } else {
            u = requireUnit(p, unitId);
        }
        String block = ConstructionService.blank(r.block());
        String no = r.unitNo().trim();
        if (core.units().findByProjectId(id).stream().anyMatch(x -> !x.getId().equals(u.getId()) && no.equalsIgnoreCase(x.getUnitNo())
                && Objects.equals(Objects.toString(block, "").toLowerCase(), Objects.toString(x.getBlock(), "").toLowerCase()))) {
            throw new BusinessException("There is already a flat " + (block != null ? block + "-" : "") + no);
        }
        String allotted = r.allottedTo() == null ? "BUILDER" : r.allottedTo().trim().toUpperCase();
        if (!Set.of("BUILDER", "LANDOWNER").contains(allotted)) throw new BusinessException("The builder's flat or a landowner's");
        boolean sold = activeSale(p, u.getId()) != null;
        if (sold && "LANDOWNER".equals(allotted)) throw new BusinessException("This flat is sold; it cannot go to a landowner");
        if (r.partyId() != null) requireParty(p, r.partyId());
        u.setUnitNo(no);
        u.setBlock(block);
        u.setFloor(r.floor());
        u.setUnitType(ConstructionService.blank(r.unitType()));
        u.setCarpetArea(r.carpetArea());
        u.setBuiltUpArea(r.builtUpArea());
        u.setSuperArea(r.superArea());
        u.setFacing(ConstructionService.blank(r.facing()));
        u.setParking(ConstructionService.blank(r.parking()));
        u.setPrice(r.price());
        u.setAllottedTo(allotted);
        u.setPartyId("LANDOWNER".equals(allotted) ? r.partyId() : null);
        if (!sold) u.setStatus("LANDOWNER".equals(allotted) ? "LANDOWNER" : "AVAILABLE");
        core.units().save(u);
        return core.detail(id);
    }

    @Transactional
    public Detail deleteUnit(Long id, Long unitId) {
        ConstructionProject p = requireDevelopment(id);
        ConstructionUnit u = requireUnit(p, unitId);
        if (core.sales().findByProjectId(id).stream().anyMatch(s -> unitId.equals(s.getUnitId()))) {
            throw new BusinessException("Flat " + ConstructionService.unitLabel(u) + " has a sale recorded");
        }
        core.units().deleteById(unitId);
        return core.detail(id);
    }

    private ConstructionUnit requireUnit(ConstructionProject p, Long id) {
        return core.units().findById(id).filter(x -> p.getId().equals(x.getProjectId())).orElseThrow(() -> new NotFoundException("Flat", id));
    }

    // ================================================================== sales

    /** Books a flat for a buyer, with the price and the payment plan. */
    @Transactional
    public Detail book(Long id, SaleRequest r) {
        ConstructionProject p = requireDevelopment(id);
        ConstructionUnit u = requireUnit(p, r.unitId());
        if (!"AVAILABLE".equals(u.getStatus())) {
            throw new BusinessException("Flat " + ConstructionService.unitLabel(u) + " is " + u.getStatus().toLowerCase().replace('_', ' ') + "; pick an available flat");
        }
        ConstructionSale s = new ConstructionSale();
        s.setTenantId(p.getTenantId());
        s.setProjectId(p.getId());
        s.setUnitId(u.getId());
        s.setStatus("BOOKED");
        s.setLoanStatus("NONE");
        s.setCreatedBy(UserContext.username());
        s.setCreatedAt(LocalDateTime.now());
        fill(s, r);
        s = core.sales().save(s);
        savePlan(p, s, r.plan());
        u.setStatus("BOOKED");
        core.units().save(u);
        core.activity().record("ADDED", ConstructionService.AREA, "Flat " + ConstructionService.unitLabel(u) + " booked by " + s.getBuyerName() + " · "
                + ActivityService.money(s.getTotalPrice()) + " · " + p.getName());
        return core.detail(id);
    }

    @Transactional
    public Detail updateSale(Long id, Long saleId, SaleRequest r) {
        ConstructionProject p = requireDevelopment(id);
        ConstructionSale s = requireSale(p, saleId);
        if (Set.of("CLOSED", "CANCELLED").contains(s.getStatus())) throw new BusinessException("This sale is " + s.getStatus().toLowerCase());
        if (!s.getUnitId().equals(r.unitId())) throw new BusinessException("Cancel this sale and book the other flat instead");
        if (core.signedFor(p, "FLAT_SALE", s.getId())) {
            // the agreement for sale is signed: its figures are fixed, only the buyer's contact details change
            if (s.getTotalPrice().compareTo(Money.round(Money.nz(r.basePrice()).add(Money.nz(r.otherCharges())))) != 0) {
                throw new BusinessException("The agreement for sale is signed: the price cannot change");
            }
        }
        fill(s, r);
        core.sales().save(s);
        if (r.plan() != null) savePlan(p, s, r.plan());
        core.activity().record("CHANGED", ConstructionService.AREA, "Changed the sale of " + s.getBuyerName() + " · " + p.getName());
        return core.detail(id);
    }

    @Transactional
    public Detail loan(Long id, Long saleId, LoanInfo r) {
        ConstructionProject p = requireDevelopment(id);
        ConstructionSale s = requireSale(p, saleId);
        String status = r.loanStatus() == null ? (ConstructionService.blank(r.loanBank()) == null ? "NONE" : "APPLIED") : r.loanStatus().trim().toUpperCase();
        if (!Set.of("NONE", "APPLIED", "SANCTIONED", "DISBURSING", "DISBURSED").contains(status)) throw new BusinessException("Unknown loan status " + status);
        if (!"NONE".equals(status) && ConstructionService.blank(r.loanBank()) == null) throw new BusinessException("Enter the buyer's bank");
        if (Money.nz(r.loanAmount()).compareTo(s.getTotalPrice()) > 0) throw new BusinessException("The loan is more than the flat's price");
        s.setLoanBank(ConstructionService.blank(r.loanBank()));
        s.setLoanBranch(ConstructionService.blank(r.loanBranch()));
        s.setLoanAmount(r.loanAmount());
        s.setLoanNo(ConstructionService.blank(r.loanNo()));
        s.setLoanSanctionedOn(r.loanSanctionedOn());
        s.setLoanStatus(status);
        core.sales().save(s);
        core.activity().record("CHANGED", ConstructionService.AREA, "Home loan of " + s.getBuyerName() + " · " + Objects.toString(s.getLoanBank(), "none")
                + " · " + status.toLowerCase() + " · " + p.getName());
        return core.detail(id);
    }

    /** The sale's next (or an earlier) step; cancelling frees the flat. */
    @Transactional
    public Detail step(Long id, Long saleId, SaleStep r) {
        ConstructionProject p = requireDevelopment(id);
        ConstructionSale s = requireSale(p, saleId);
        ConstructionUnit u = requireUnit(p, s.getUnitId());
        String to = r.status().trim().toUpperCase();
        LocalDate on = r.on() != null ? r.on() : LocalDate.now();
        if ("CANCELLED".equals(s.getStatus())) throw new BusinessException("This sale was cancelled; book the flat again instead");
        switch (to) {
            case "BOOKED" -> {
                s.setAgreementOn(null); s.setRegisteredOn(null); s.setDeedNo(null); s.setSubRegistrar(null); s.setHandedOverOn(null); s.setClosedAt(null);
            }
            case "AGREED" -> {
                s.setAgreementOn(on); s.setRegisteredOn(null); s.setDeedNo(null); s.setSubRegistrar(null); s.setHandedOverOn(null); s.setClosedAt(null);
            }
            case "REGISTERED" -> {
                if (ConstructionService.blank(r.deedNo()) == null && s.getDeedNo() == null) throw new BusinessException("Enter the registered sale deed's document number");
                if (s.getAgreementOn() == null) s.setAgreementOn(on);
                s.setRegisteredOn(on);
                if (ConstructionService.blank(r.deedNo()) != null) s.setDeedNo(r.deedNo().trim());
                if (ConstructionService.blank(r.subRegistrar()) != null) s.setSubRegistrar(r.subRegistrar().trim());
                s.setHandedOverOn(null); s.setClosedAt(null);
            }
            case "HANDED_OVER" -> {
                if (s.getRegisteredOn() == null) throw new BusinessException("Register the sale deed before handing over the flat");
                s.setHandedOverOn(on);
                s.setHandoverNote(ConstructionService.blank(r.note()));
                s.setClosedAt(null);
            }
            case "CLOSED" -> {
                if (s.getHandedOverOn() == null) throw new BusinessException("Hand over the flat before closing the sale");
                Detail d = core.detail(id);
                ConstructionService.SaleView v = d.sales().stream().filter(x -> x.sale().getId().equals(s.getId())).findFirst().orElseThrow();
                if (v.balance().signum() > 0) {
                    throw new BusinessException(s.getBuyerName() + " still owes " + ActivityService.money(v.balance()) + "; record the payment before closing");
                }
                s.setClosedAt(LocalDateTime.now());
            }
            case "CANCELLED" -> {
                if (s.getRegisteredOn() != null) throw new BusinessException("A registered sale cannot be cancelled here: it needs a cancellation deed");
                s.setCancelNote(ConstructionService.blank(r.note()));
                s.setClosedAt(LocalDateTime.now());
            }
            default -> throw new BusinessException("Unknown step " + to);
        }
        s.setStatus(to);
        core.sales().save(s);
        u.setStatus(switch (to) {
            case "CANCELLED" -> "AVAILABLE";
            case "BOOKED", "AGREED" -> "BOOKED";
            case "REGISTERED" -> "SOLD";
            default -> "HANDED_OVER";
        });
        core.units().save(u);
        core.activity().record("CHANGED", ConstructionService.AREA, "Flat " + ConstructionService.unitLabel(u) + " · " + s.getBuyerName() + " · "
                + to.toLowerCase().replace('_', ' ') + " · " + p.getName());
        return core.detail(id);
    }

    @Transactional
    public Detail deleteSale(Long id, Long saleId) {
        ConstructionProject p = requireDevelopment(id);
        ConstructionSale s = requireSale(p, saleId);
        if (core.receipts().findByProjectId(id).stream().anyMatch(r -> saleId.equals(r.getSaleId()))) {
            throw new BusinessException("Money was received for this sale; cancel it instead (and refund the buyer)");
        }
        if (core.agreements().findByProjectId(id).stream().anyMatch(a -> saleId.equals(a.getRefId()) && !"DRAFT".equals(a.getStatus())
                && Set.of("FLAT_SALE", "TRIPARTITE", "SALE_DEED", "POSSESSION").contains(a.getKind()))) {
            throw new BusinessException("A signed agreement belongs to this sale; cancel it instead");
        }
        core.agreements().findByProjectId(id).stream().filter(a -> saleId.equals(a.getRefId()) && Set.of("FLAT_SALE", "TRIPARTITE", "SALE_DEED", "POSSESSION").contains(a.getKind()))
                .forEach(a -> { files.deleteAllForAgreement(ConstructionAgreementService.FILES, a.getId()); core.agreements().deleteById(a.getId()); });
        core.instalments().findByProjectId(id).stream().filter(i -> saleId.equals(i.getSaleId())).forEach(i -> core.instalments().deleteById(i.getId()));
        files.deleteAllForAgreement(SALE_FILES, saleId);
        core.sales().deleteById(saleId);
        ConstructionUnit u = requireUnit(p, s.getUnitId());
        u.setStatus("LANDOWNER".equals(u.getAllottedTo()) ? "LANDOWNER" : "AVAILABLE");
        core.units().save(u);
        return core.detail(id);
    }

    private void fill(ConstructionSale s, SaleRequest r) {
        s.setBuyerName(r.buyerName().trim());
        s.setBuyerRelation(ConstructionService.blank(r.buyerRelation()));
        s.setBuyerPhone(ConstructionService.phone(r.buyerPhone(), "The buyer"));
        s.setBuyerEmail(ConstructionService.blank(r.buyerEmail()));
        s.setBuyerAddress(ConstructionService.blank(r.buyerAddress()));
        s.setBuyerPan(ConstructionService.blank(r.buyerPan()) == null ? null : Kyc.maskPan(Kyc.pan(r.buyerPan())));
        s.setCoBuyerName(ConstructionService.blank(r.coBuyerName()));
        s.setBookedOn(r.bookedOn());
        s.setBasePrice(Money.round(r.basePrice()));
        s.setOtherCharges(r.otherCharges() == null || r.otherCharges().signum() == 0 ? null : Money.round(r.otherCharges()));
        s.setOtherChargesNote(ConstructionService.blank(r.otherChargesNote()));
        s.setTotalPrice(s.getBasePrice().add(Money.nz(s.getOtherCharges())));
        if (s.getTotalPrice().signum() <= 0) throw new BusinessException("Enter the flat's price");
        s.setLateInterestPercent(r.lateInterestPercent());
    }

    /** The plan replaces the old one; percents are of the total price, and the rows must add up to it. */
    private void savePlan(ConstructionProject p, ConstructionSale s, List<PlanRow> plan) {
        List<PlanRow> rows = plan == null || plan.isEmpty()
                ? List.of(new PlanRow("Full payment", Money.HUNDRED, null, s.getBookedOn(), null, null)) : plan;
        Map<Long, ConstructionStage> stageById = core.stagesOf(p.getId()).stream().collect(Collectors.toMap(ConstructionStage::getId, x -> x));
        BigDecimal total = Money.ZERO;
        List<BigDecimal> amounts = new java.util.ArrayList<>();
        for (PlanRow r : rows) {
            BigDecimal a = r.amount() != null && r.amount().signum() > 0 ? Money.round(r.amount())
                    : Money.round(s.getTotalPrice().multiply(Money.nz(r.percent())).divide(Money.HUNDRED, 6, RoundingMode.HALF_UP));
            amounts.add(a);
            total = total.add(a);
            if (r.stageId() != null && !stageById.containsKey(r.stageId())) throw new NotFoundException("Stage", r.stageId());
            if (r.dueDate() == null && r.stageId() == null) throw new BusinessException(r.label() + ": give a date or the stage it follows");
        }
        BigDecimal gap = s.getTotalPrice().subtract(total);
        // paise lost to rounding go to the last line; anything more must be fixed by the user
        if (gap.abs().compareTo(BigDecimal.valueOf(rows.size())) <= 0) {
            amounts.set(amounts.size() - 1, amounts.getLast().add(gap));
        } else {
            throw new BusinessException("The payment plan adds up to " + ActivityService.money(total) + ", not the price " + ActivityService.money(s.getTotalPrice()));
        }
        core.instalments().findByProjectId(p.getId()).stream().filter(i -> s.getId().equals(i.getSaleId())).forEach(i -> core.instalments().deleteById(i.getId()));
        int pos = 1;
        for (int k = 0; k < rows.size(); k++) {
            PlanRow r = rows.get(k);
            ConstructionInstalment i = new ConstructionInstalment();
            i.setTenantId(p.getTenantId());
            i.setProjectId(p.getId());
            i.setSaleId(s.getId());
            i.setPosition(pos++);
            i.setLabel(r.label().trim());
            i.setPercent(r.percent());
            i.setAmount(amounts.get(k));
            i.setDueDate(r.dueDate());
            i.setStageId(r.stageId());
            i.setDaysAfterStage(r.stageId() == null ? null : r.daysAfterStage() == null ? 15 : r.daysAfterStage());
            core.instalments().save(i);
        }
    }

    ConstructionSale requireSale(ConstructionProject p, Long id) {
        return core.sales().findById(id).filter(x -> p.getId().equals(x.getProjectId())).orElseThrow(() -> new NotFoundException("Sale", id));
    }

    private ConstructionSale activeSale(ConstructionProject p, Long unitId) {
        return unitId == null ? null : core.sales().findByProjectId(p.getId()).stream()
                .filter(s -> unitId.equals(s.getUnitId()) && !"CANCELLED".equals(s.getStatus())).findFirst().orElse(null);
    }

    private ConstructionProject requireDevelopment(Long id) {
        ConstructionProject p = core.requireOpen(id);
        if (!ConstructionService.DEVELOPMENT.equals(p.getKind())) throw new BusinessException("Flats and their sales are for developments");
        return p;
    }

    // ================================================================== documents (the sale's, the project's)

    public List<AgreementFile> saleFiles(Long id, Long saleId) {
        ConstructionProject p = core.require(id);
        requireSale(p, saleId);
        return files.listForAgreement(SALE_FILES, saleId);
    }

    @Transactional
    public List<AgreementFile> addSaleFile(Long id, Long saleId, String docType, String name, byte[] bytes) {
        ConstructionProject p = core.require(id);
        ConstructionSale s = requireSale(p, saleId);
        AgreementFile f = files.addToAgreement(SALE_FILES, saleId, docType, name, bytes, "UPLOAD",
                p.getName() + " · flat sale of " + s.getBuyerName());
        core.activity().record("ADDED", ConstructionService.AREA, MaybeName.of(f.docType()) + " added to the sale of " + s.getBuyerName() + " · " + p.getName());
        return files.listForAgreement(SALE_FILES, saleId);
    }

    @Transactional
    public List<AgreementFile> deleteSaleFile(Long id, Long saleId, Long fileId) {
        ConstructionProject p = core.require(id);
        requireSale(p, saleId);
        files.deleteFromAgreement(SALE_FILES, saleId, fileId);
        return files.listForAgreement(SALE_FILES, saleId);
    }

    public AttachmentService.FileContent saleFile(Long id, Long saleId, Long fileId, boolean thumb) {
        ConstructionProject p = core.require(id);
        requireSale(p, saleId);
        return files.agreementFileContent(SALE_FILES, saleId, fileId, thumb);
    }

    public List<AgreementFile> projectFiles(Long id) {
        return files.listForAgreement(PROJECT_FILES, core.require(id).getId());
    }

    @Transactional
    public List<AgreementFile> addProjectFile(Long id, String docType, String name, byte[] bytes) {
        ConstructionProject p = core.require(id);
        AgreementFile f = files.addToAgreement(PROJECT_FILES, p.getId(), docType, name, bytes, "UPLOAD", p.getName());
        core.activity().record("ADDED", ConstructionService.AREA, MaybeName.of(f.docType()) + " added to " + p.getName());
        return files.listForAgreement(PROJECT_FILES, p.getId());
    }

    @Transactional
    public List<AgreementFile> deleteProjectFile(Long id, Long fileId) {
        ConstructionProject p = core.require(id);
        files.deleteFromAgreement(PROJECT_FILES, p.getId(), fileId);
        return files.listForAgreement(PROJECT_FILES, p.getId());
    }

    public AttachmentService.FileContent projectFile(Long id, Long fileId, boolean thumb) {
        return files.agreementFileContent(PROJECT_FILES, core.require(id).getId(), fileId, thumb);
    }

    private static final class MaybeName {
        static String of(String type) {
            String t = type.replace('_', ' ').toLowerCase();
            return Character.toUpperCase(t.charAt(0)) + t.substring(1);
        }
    }
}
