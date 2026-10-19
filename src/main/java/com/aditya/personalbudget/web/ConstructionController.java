package com.aditya.personalbudget.web;

import com.aditya.personalbudget.security.Permission;
import com.aditya.personalbudget.security.RequiresPermission;
import com.aditya.personalbudget.service.AttachmentService.AgreementFile;
import com.aditya.personalbudget.service.ConstructionAgreementService;
import com.aditya.personalbudget.service.ConstructionAgreementService.AcceptRequest;
import com.aditya.personalbudget.service.ConstructionAgreementService.AgreementView;
import com.aditya.personalbudget.service.ConstructionAgreementService.CreatedLink;
import com.aditya.personalbudget.service.ConstructionAgreementService.LinkRequest;
import com.aditya.personalbudget.service.ConstructionAgreementService.MakeRequest;
import com.aditya.personalbudget.service.ConstructionAgreementService.OpenRequest;
import com.aditya.personalbudget.service.ConstructionAgreementService.PaperRequest;
import com.aditya.personalbudget.service.ConstructionAgreementService.PublicAgreement;
import com.aditya.personalbudget.service.ConstructionAgreementService.SignedRequest;
import com.aditya.personalbudget.service.ConstructionMoneyService;
import com.aditya.personalbudget.service.ConstructionMoneyService.CapitalRequest;
import com.aditya.personalbudget.service.ConstructionMoneyService.CommonAccountRequest;
import com.aditya.personalbudget.service.ConstructionMoneyService.CostRequest;
import com.aditya.personalbudget.service.ConstructionMoneyService.LoanRequest;
import com.aditya.personalbudget.service.ConstructionMoneyService.LoanTxnRequest;
import com.aditya.personalbudget.service.ConstructionMoneyService.PartnerRequest;
import com.aditya.personalbudget.service.ConstructionMoneyService.ReceiptRequest;
import com.aditya.personalbudget.service.ConstructionMoneyService.SharesRequest;
import com.aditya.personalbudget.service.ConstructionMoneyService.TransferRequest;
import com.aditya.personalbudget.service.ConstructionSalesService;
import com.aditya.personalbudget.service.ConstructionSalesService.LoanInfo;
import com.aditya.personalbudget.service.ConstructionSalesService.SaleRequest;
import com.aditya.personalbudget.service.ConstructionSalesService.SaleStep;
import com.aditya.personalbudget.service.ConstructionSalesService.UnitRequest;
import com.aditya.personalbudget.service.ConstructionService;
import com.aditya.personalbudget.service.ConstructionService.CreateRequest;
import com.aditya.personalbudget.service.ConstructionService.Detail;
import com.aditya.personalbudget.service.ConstructionService.ExtraRequest;
import com.aditya.personalbudget.service.ConstructionService.ExtraStatus;
import com.aditya.personalbudget.service.ConstructionService.Overview;
import com.aditya.personalbudget.service.ConstructionService.PartyInput;
import com.aditya.personalbudget.service.ConstructionService.ProjectRequest;
import com.aditya.personalbudget.service.ConstructionService.SignatureRequest;
import com.aditya.personalbudget.service.ConstructionService.StageInput;
import com.aditya.personalbudget.service.ConstructionService.StageProgress;
import com.aditya.personalbudget.service.ConstructionService.StatusRequest;
import com.aditya.personalbudget.service.ConstructionService.UnitPlan;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import org.springframework.http.CacheControl;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RequestPart;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.util.List;
import java.util.Map;

/**
 * The Construction section: {@code /api/construction} (projects, their money, flats and sales, agreements and files),
 * and the other party's side of an agreement link ({@code /api/public/construction-agreements/{token}}), which needs
 * no sign-in: only the link's token and their mobile number.
 */
@RestController
public class ConstructionController {

    private static final String BASE = "/api/construction";
    private static final String P = BASE + "/{id}";

    private final ConstructionService projects;
    private final ConstructionMoneyService money;
    private final ConstructionSalesService sales;
    private final ConstructionAgreementService agreements;
    private final com.aditya.personalbudget.service.ConstructionBookService book;

    public ConstructionController(ConstructionService projects, ConstructionMoneyService money, ConstructionSalesService sales,
                                  ConstructionAgreementService agreements, com.aditya.personalbudget.service.ConstructionBookService book) {
        this.book = book;
        this.projects = projects;
        this.money = money;
        this.sales = sales;
        this.agreements = agreements;
    }

    // ---------------------------------------------------------------- projects

    @GetMapping(BASE)
    @RequiresPermission(Permission.VIEW)
    public Overview overview() {
        return projects.overview();
    }

    /** Cost heads and the other choices the forms offer. */
    @GetMapping(BASE + "/meta")
    @RequiresPermission(Permission.VIEW)
    public Map<String, Object> meta() {
        return Map.of("heads", ConstructionMoneyService.HEADS, "agreementKinds", ConstructionAgreementService.KINDS);
    }

    @PostMapping(BASE)
    @RequiresPermission(Permission.MANAGE_PROJECTS)
    public Detail create(@Valid @RequestBody CreateRequest r) {
        return projects.create(r);
    }

    @PostMapping(BASE + "/accounts")
    @RequiresPermission(Permission.MANAGE_PROJECTS)
    public Overview addCommonAccount(@Valid @RequestBody CommonAccountRequest r) {
        return money.addCommonAccount(r);
    }

    /** Construction › Accounts: the construction book's accounts, and my own accounts construction money went through. */
    @GetMapping(BASE + "/book")
    @RequiresPermission(Permission.VIEW)
    public com.aditya.personalbudget.service.ConstructionBookService.Book book() {
        return book.book();
    }

    @GetMapping(BASE + "/book/accounts/{accountId}/statement")
    @RequiresPermission(Permission.VIEW)
    public com.aditya.personalbudget.dto.ReportDtos.AccountLedger statement(@PathVariable Long accountId,
            @org.springframework.web.bind.annotation.RequestParam @org.springframework.format.annotation.DateTimeFormat(iso = org.springframework.format.annotation.DateTimeFormat.ISO.DATE) java.time.LocalDate from,
            @org.springframework.web.bind.annotation.RequestParam @org.springframework.format.annotation.DateTimeFormat(iso = org.springframework.format.annotation.DateTimeFormat.ISO.DATE) java.time.LocalDate to) {
        return book.statement(accountId, from, to);
    }

    @GetMapping(P)
    @RequiresPermission(Permission.VIEW)
    public Detail detail(@PathVariable Long id) {
        return projects.detail(id);
    }

    @PutMapping(P)
    @RequiresPermission(Permission.MANAGE_PROJECTS)
    public Detail update(@PathVariable Long id, @Valid @RequestBody ProjectRequest r) {
        return projects.update(id, r);
    }

    @DeleteMapping(P)
    @RequiresPermission(Permission.MANAGE_PROJECTS)
    public ResponseEntity<Void> delete(@PathVariable Long id) {
        projects.delete(id);
        return ResponseEntity.noContent().build();
    }

    @PostMapping(P + "/status")
    @RequiresPermission(Permission.MANAGE_PROJECTS)
    public Detail status(@PathVariable Long id, @Valid @RequestBody StatusRequest r) {
        return projects.status(id, r);
    }

    @PutMapping(P + "/signature")
    @RequiresPermission(Permission.MANAGE_PROJECTS)
    public Detail signature(@PathVariable Long id, @Valid @RequestBody SignatureRequest r) {
        return projects.signature(id, r);
    }

    // ---------------------------------------------------------------- stages and extra works

    @PostMapping(P + "/stages")
    @RequiresPermission(Permission.MANAGE_PROJECTS)
    public Detail addStage(@PathVariable Long id, @Valid @RequestBody StageInput r) {
        return projects.saveStage(id, null, r);
    }

    @PutMapping(P + "/stages/{stageId}")
    @RequiresPermission(Permission.MANAGE_PROJECTS)
    public Detail updateStage(@PathVariable Long id, @PathVariable Long stageId, @Valid @RequestBody StageInput r) {
        return projects.saveStage(id, stageId, r);
    }

    @PutMapping(P + "/stages-order")
    @RequiresPermission(Permission.MANAGE_PROJECTS)
    public Detail orderStages(@PathVariable Long id, @RequestBody List<Long> order) {
        return projects.orderStages(id, order);
    }

    @DeleteMapping(P + "/stages/{stageId}")
    @RequiresPermission(Permission.MANAGE_PROJECTS)
    public Detail deleteStage(@PathVariable Long id, @PathVariable Long stageId) {
        return projects.deleteStage(id, stageId);
    }

    @PostMapping(P + "/stages/{stageId}/progress")
    @RequiresPermission(Permission.MANAGE_PROJECTS)
    public Detail progress(@PathVariable Long id, @PathVariable Long stageId, @Valid @RequestBody StageProgress r) {
        return projects.progress(id, stageId, r);
    }

    @PostMapping(P + "/extras")
    @RequiresPermission(Permission.MANAGE_PROJECTS)
    public Detail addExtra(@PathVariable Long id, @Valid @RequestBody ExtraRequest r) {
        return projects.saveExtra(id, null, r);
    }

    @PutMapping(P + "/extras/{extraId}")
    @RequiresPermission(Permission.MANAGE_PROJECTS)
    public Detail updateExtra(@PathVariable Long id, @PathVariable Long extraId, @Valid @RequestBody ExtraRequest r) {
        return projects.saveExtra(id, extraId, r);
    }

    @PostMapping(P + "/extras/{extraId}/status")
    @RequiresPermission(Permission.MANAGE_PROJECTS)
    public Detail extraStatus(@PathVariable Long id, @PathVariable Long extraId, @Valid @RequestBody ExtraStatus r) {
        return projects.extraStatus(id, extraId, r);
    }

    @DeleteMapping(P + "/extras/{extraId}")
    @RequiresPermission(Permission.MANAGE_PROJECTS)
    public Detail deleteExtra(@PathVariable Long id, @PathVariable Long extraId) {
        return projects.deleteExtra(id, extraId);
    }

    // ---------------------------------------------------------------- money

    @PostMapping(P + "/receipts")
    @RequiresPermission(Permission.MANAGE_PROJECTS)
    public Detail addReceipt(@PathVariable Long id, @Valid @RequestBody ReceiptRequest r) {
        return money.addReceipt(id, r);
    }

    @PutMapping(P + "/receipts/{receiptId}")
    @RequiresPermission(Permission.MANAGE_PROJECTS)
    public Detail updateReceipt(@PathVariable Long id, @PathVariable Long receiptId, @Valid @RequestBody ReceiptRequest r) {
        return money.updateReceipt(id, receiptId, r);
    }

    @DeleteMapping(P + "/receipts/{receiptId}")
    @RequiresPermission(Permission.MANAGE_PROJECTS)
    public Detail deleteReceipt(@PathVariable Long id, @PathVariable Long receiptId) {
        return money.deleteReceipt(id, receiptId);
    }

    @PostMapping(P + "/costs")
    @RequiresPermission(Permission.MANAGE_PROJECTS)
    public Detail addCost(@PathVariable Long id, @Valid @RequestBody CostRequest r) {
        return money.addCost(id, r);
    }

    @PutMapping(P + "/costs/{costId}")
    @RequiresPermission(Permission.MANAGE_PROJECTS)
    public Detail updateCost(@PathVariable Long id, @PathVariable Long costId, @Valid @RequestBody CostRequest r) {
        return money.updateCost(id, costId, r);
    }

    @DeleteMapping(P + "/costs/{costId}")
    @RequiresPermission(Permission.MANAGE_PROJECTS)
    public Detail deleteCost(@PathVariable Long id, @PathVariable Long costId) {
        return money.deleteCost(id, costId);
    }

    @PostMapping(P + "/partners")
    @RequiresPermission(Permission.MANAGE_PROJECTS)
    public Detail addPartner(@PathVariable Long id, @Valid @RequestBody PartnerRequest r) {
        return money.addPartner(id, r);
    }

    @PutMapping(P + "/partners/{partnerId}")
    @RequiresPermission(Permission.MANAGE_PROJECTS)
    public Detail updatePartner(@PathVariable Long id, @PathVariable Long partnerId, @Valid @RequestBody PartnerRequest r) {
        return money.updatePartner(id, partnerId, r);
    }

    @PutMapping(P + "/shares")
    @RequiresPermission(Permission.MANAGE_PROJECTS)
    public Detail shares(@PathVariable Long id, @Valid @RequestBody SharesRequest r) {
        return money.shares(id, r);
    }

    @DeleteMapping(P + "/partners/{partnerId}")
    @RequiresPermission(Permission.MANAGE_PROJECTS)
    public Detail deletePartner(@PathVariable Long id, @PathVariable Long partnerId) {
        return money.deletePartner(id, partnerId);
    }

    @PostMapping(P + "/capital")
    @RequiresPermission(Permission.MANAGE_PROJECTS)
    public Detail addCapital(@PathVariable Long id, @Valid @RequestBody CapitalRequest r) {
        return money.addCapital(id, r);
    }

    @DeleteMapping(P + "/capital/{capitalId}")
    @RequiresPermission(Permission.MANAGE_PROJECTS)
    public Detail deleteCapital(@PathVariable Long id, @PathVariable Long capitalId) {
        return money.deleteCapital(id, capitalId);
    }

    @PostMapping(P + "/loans")
    @RequiresPermission(Permission.MANAGE_PROJECTS)
    public Detail addLoan(@PathVariable Long id, @Valid @RequestBody LoanRequest r) {
        return money.saveLoan(id, null, r);
    }

    @PutMapping(P + "/loans/{loanId}")
    @RequiresPermission(Permission.MANAGE_PROJECTS)
    public Detail updateLoan(@PathVariable Long id, @PathVariable Long loanId, @Valid @RequestBody LoanRequest r) {
        return money.saveLoan(id, loanId, r);
    }

    @DeleteMapping(P + "/loans/{loanId}")
    @RequiresPermission(Permission.MANAGE_PROJECTS)
    public Detail deleteLoan(@PathVariable Long id, @PathVariable Long loanId) {
        return money.deleteLoan(id, loanId);
    }

    @PostMapping(P + "/loans/{loanId}/txns")
    @RequiresPermission(Permission.MANAGE_PROJECTS)
    public Detail addLoanTxn(@PathVariable Long id, @PathVariable Long loanId, @Valid @RequestBody LoanTxnRequest r) {
        return money.addLoanTxn(id, loanId, r);
    }

    @DeleteMapping(P + "/loan-txns/{txnId}")
    @RequiresPermission(Permission.MANAGE_PROJECTS)
    public Detail deleteLoanTxn(@PathVariable Long id, @PathVariable Long txnId) {
        return money.deleteLoanTxn(id, txnId);
    }

    @PostMapping(P + "/transfers")
    @RequiresPermission(Permission.MANAGE_PROJECTS)
    public Detail transfer(@PathVariable Long id, @Valid @RequestBody TransferRequest r) {
        return money.transfer(id, r);
    }

    // ---------------------------------------------------------------- land, flats and sales

    @PostMapping(P + "/parties")
    @RequiresPermission(Permission.MANAGE_PROJECTS)
    public Detail addParty(@PathVariable Long id, @Valid @RequestBody PartyInput r) {
        return sales.saveParty(id, null, r);
    }

    @PutMapping(P + "/parties/{partyId}")
    @RequiresPermission(Permission.MANAGE_PROJECTS)
    public Detail updateParty(@PathVariable Long id, @PathVariable Long partyId, @Valid @RequestBody PartyInput r) {
        return sales.saveParty(id, partyId, r);
    }

    @DeleteMapping(P + "/parties/{partyId}")
    @RequiresPermission(Permission.MANAGE_PROJECTS)
    public Detail deleteParty(@PathVariable Long id, @PathVariable Long partyId) {
        return sales.deleteParty(id, partyId);
    }

    @PostMapping(P + "/units/bulk")
    @RequiresPermission(Permission.MANAGE_PROJECTS)
    public Detail makeUnits(@PathVariable Long id, @Valid @RequestBody UnitPlan r) {
        return sales.makeUnits(id, r);
    }

    @PostMapping(P + "/units")
    @RequiresPermission(Permission.MANAGE_PROJECTS)
    public Detail addUnit(@PathVariable Long id, @Valid @RequestBody UnitRequest r) {
        return sales.saveUnit(id, null, r);
    }

    @PutMapping(P + "/units/{unitId}")
    @RequiresPermission(Permission.MANAGE_PROJECTS)
    public Detail updateUnit(@PathVariable Long id, @PathVariable Long unitId, @Valid @RequestBody UnitRequest r) {
        return sales.saveUnit(id, unitId, r);
    }

    @DeleteMapping(P + "/units/{unitId}")
    @RequiresPermission(Permission.MANAGE_PROJECTS)
    public Detail deleteUnit(@PathVariable Long id, @PathVariable Long unitId) {
        return sales.deleteUnit(id, unitId);
    }

    @PostMapping(P + "/sales")
    @RequiresPermission(Permission.MANAGE_PROJECTS)
    public Detail book(@PathVariable Long id, @Valid @RequestBody SaleRequest r) {
        return sales.book(id, r);
    }

    @PutMapping(P + "/sales/{saleId}")
    @RequiresPermission(Permission.MANAGE_PROJECTS)
    public Detail updateSale(@PathVariable Long id, @PathVariable Long saleId, @Valid @RequestBody SaleRequest r) {
        return sales.updateSale(id, saleId, r);
    }

    @PutMapping(P + "/sales/{saleId}/loan")
    @RequiresPermission(Permission.MANAGE_PROJECTS)
    public Detail saleLoan(@PathVariable Long id, @PathVariable Long saleId, @Valid @RequestBody LoanInfo r) {
        return sales.loan(id, saleId, r);
    }

    @PostMapping(P + "/sales/{saleId}/step")
    @RequiresPermission(Permission.MANAGE_PROJECTS)
    public Detail saleStep(@PathVariable Long id, @PathVariable Long saleId, @Valid @RequestBody SaleStep r) {
        return sales.step(id, saleId, r);
    }

    @DeleteMapping(P + "/sales/{saleId}")
    @RequiresPermission(Permission.MANAGE_PROJECTS)
    public Detail deleteSale(@PathVariable Long id, @PathVariable Long saleId) {
        return sales.deleteSale(id, saleId);
    }

    // ---------------------------------------------------------------- files: a sale's and the project's

    @GetMapping(P + "/sales/{saleId}/files")
    @RequiresPermission(Permission.VIEW)
    public List<AgreementFile> saleFiles(@PathVariable Long id, @PathVariable Long saleId) {
        return sales.saleFiles(id, saleId);
    }

    @PostMapping(value = P + "/sales/{saleId}/files", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    @RequiresPermission(Permission.MANAGE_PROJECTS)
    public List<AgreementFile> addSaleFile(@PathVariable Long id, @PathVariable Long saleId, @RequestParam String docType,
                                           @RequestPart("file") MultipartFile file) throws IOException {
        return sales.addSaleFile(id, saleId, docType, file.getOriginalFilename(), file.getBytes());
    }

    @DeleteMapping(P + "/sales/{saleId}/files/{fileId}")
    @RequiresPermission(Permission.MANAGE_PROJECTS)
    public List<AgreementFile> deleteSaleFile(@PathVariable Long id, @PathVariable Long saleId, @PathVariable Long fileId) {
        return sales.deleteSaleFile(id, saleId, fileId);
    }

    @GetMapping(P + "/sales/{saleId}/files/{fileId}")
    @RequiresPermission(Permission.VIEW)
    public ResponseEntity<byte[]> saleFile(@PathVariable Long id, @PathVariable Long saleId, @PathVariable Long fileId,
                                           @RequestParam(defaultValue = "false") boolean thumb) {
        return AgreementFiles.inline(sales.saleFile(id, saleId, fileId, thumb));
    }

    @GetMapping(P + "/files")
    @RequiresPermission(Permission.VIEW)
    public List<AgreementFile> projectFiles(@PathVariable Long id) {
        return sales.projectFiles(id);
    }

    @PostMapping(value = P + "/files", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    @RequiresPermission(Permission.MANAGE_PROJECTS)
    public List<AgreementFile> addProjectFile(@PathVariable Long id, @RequestParam String docType, @RequestPart("file") MultipartFile file) throws IOException {
        return sales.addProjectFile(id, docType, file.getOriginalFilename(), file.getBytes());
    }

    @DeleteMapping(P + "/files/{fileId}")
    @RequiresPermission(Permission.MANAGE_PROJECTS)
    public List<AgreementFile> deleteProjectFile(@PathVariable Long id, @PathVariable Long fileId) {
        return sales.deleteProjectFile(id, fileId);
    }

    @GetMapping(P + "/files/{fileId}")
    @RequiresPermission(Permission.VIEW)
    public ResponseEntity<byte[]> projectFile(@PathVariable Long id, @PathVariable Long fileId, @RequestParam(defaultValue = "false") boolean thumb) {
        return AgreementFiles.inline(sales.projectFile(id, fileId, thumb));
    }

    // ---------------------------------------------------------------- agreements

    @PostMapping(P + "/agreements")
    @RequiresPermission(Permission.MANAGE_PROJECTS)
    public AgreementView makeAgreement(@PathVariable Long id, @Valid @RequestBody MakeRequest r) {
        return agreements.make(id, r);
    }

    @GetMapping(P + "/agreements/{agreementId}")
    @RequiresPermission(Permission.VIEW)
    public AgreementView agreement(@PathVariable Long id, @PathVariable Long agreementId) {
        return agreements.get(id, agreementId);
    }

    @PutMapping(P + "/agreements/{agreementId}/paper")
    @RequiresPermission(Permission.MANAGE_PROJECTS)
    public AgreementView paper(@PathVariable Long id, @PathVariable Long agreementId, @Valid @RequestBody PaperRequest r) {
        return agreements.paper(id, agreementId, r);
    }

    @PostMapping(P + "/agreements/{agreementId}/link")
    @RequiresPermission(Permission.MANAGE_PROJECTS)
    public CreatedLink link(@PathVariable Long id, @PathVariable Long agreementId, @Valid @RequestBody LinkRequest r) {
        return agreements.link(id, agreementId, r);
    }

    @PostMapping(P + "/agreements/{agreementId}/link/revoke")
    @RequiresPermission(Permission.MANAGE_PROJECTS)
    public AgreementView revoke(@PathVariable Long id, @PathVariable Long agreementId) {
        return agreements.revoke(id, agreementId);
    }

    @PostMapping(P + "/agreements/{agreementId}/signed")
    @RequiresPermission(Permission.MANAGE_PROJECTS)
    public AgreementView signed(@PathVariable Long id, @PathVariable Long agreementId, @Valid @RequestBody SignedRequest r) {
        return agreements.signed(id, agreementId, r);
    }

    @DeleteMapping(P + "/agreements/{agreementId}")
    @RequiresPermission(Permission.MANAGE_PROJECTS)
    public ResponseEntity<Void> deleteAgreement(@PathVariable Long id, @PathVariable Long agreementId) {
        agreements.delete(id, agreementId);
        return ResponseEntity.noContent().build();
    }

    @PostMapping(value = P + "/agreements/{agreementId}/files", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    @RequiresPermission(Permission.MANAGE_PROJECTS)
    public AgreementView addAgreementFile(@PathVariable Long id, @PathVariable Long agreementId, @RequestParam String docType,
                                          @RequestPart("file") MultipartFile file, @RequestParam(required = false) String source) throws IOException {
        return agreements.addFile(id, agreementId, docType, file.getOriginalFilename(), file.getBytes(), source);
    }

    @DeleteMapping(P + "/agreements/{agreementId}/files/{fileId}")
    @RequiresPermission(Permission.MANAGE_PROJECTS)
    public AgreementView deleteAgreementFile(@PathVariable Long id, @PathVariable Long agreementId, @PathVariable Long fileId) {
        return agreements.deleteFile(id, agreementId, fileId);
    }

    @GetMapping(P + "/agreements/{agreementId}/files/{fileId}")
    @RequiresPermission(Permission.VIEW)
    public ResponseEntity<byte[]> agreementFile(@PathVariable Long id, @PathVariable Long agreementId, @PathVariable Long fileId,
                                                @RequestParam(defaultValue = "false") boolean thumb) {
        return AgreementFiles.inline(agreements.file(id, agreementId, fileId, thumb));
    }

    // ---------------------------------------------------------------- the other party (no sign-in)

    @PostMapping("/api/public/construction-agreements/{token}")
    public ResponseEntity<PublicAgreement> open(@PathVariable String token, @Valid @RequestBody(required = false) OpenRequest r) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(agreements.open(token, r));
    }

    @PostMapping(value = "/api/public/construction-agreements/{token}/kyc", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public ResponseEntity<PublicAgreement> kyc(@PathVariable String token, @RequestParam String phone, @RequestParam String docType,
                                               @RequestPart("file") MultipartFile file) throws IOException {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(agreements.addKyc(token, phone, docType, file.getOriginalFilename(), file.getBytes()));
    }

    @PostMapping("/api/public/construction-agreements/{token}/accept")
    public ResponseEntity<PublicAgreement> accept(@PathVariable String token, @Valid @RequestBody AcceptRequest r, HttpServletRequest http) {
        String forwarded = http.getHeader("X-Forwarded-For");
        String ip = forwarded != null && !forwarded.isBlank() ? forwarded.split(",")[0].trim() : http.getRemoteAddr();
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(agreements.accept(token, r, ip, http.getHeader("User-Agent")));
    }
}
