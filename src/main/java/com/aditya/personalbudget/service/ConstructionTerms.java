package com.aditya.personalbudget.service;

import com.aditya.personalbudget.domain.entity.ConstructionExtra;
import com.aditya.personalbudget.domain.entity.ConstructionInstalment;
import com.aditya.personalbudget.domain.entity.ConstructionParty;
import com.aditya.personalbudget.domain.entity.ConstructionPartner;
import com.aditya.personalbudget.domain.entity.ConstructionProject;
import com.aditya.personalbudget.domain.entity.ConstructionSale;
import com.aditya.personalbudget.domain.entity.ConstructionStage;
import com.aditya.personalbudget.domain.entity.ConstructionUnit;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.stream.Collectors;

/**
 * The wording of the construction agreements, in the form of Indian deeds: the title, how the parties are called,
 * the recitals (WHEREAS...), the particulars (a schedule of the figures) and the clauses, each "HEADING: text".
 * Made from the project when an agreement is made, then fixed by its fingerprint.
 * <p>
 * The clauses follow the usual Indian practice and the statutes that govern each kind (the Real Estate (Regulation
 * and Development) Act, 2016 for the sale of flats, the Registration Act, 1908 and the Indian Stamp Act, 1899 for the
 * sale deed, the Specific Relief Act, 1963 for an agreement of sale, the Arbitration and Conciliation Act, 1996, the
 * Information Technology Act, 2000 and the Bharatiya Sakshya Adhiniyam, 2023 for electronic execution). They are a
 * sound starting point, not legal advice: the builder should have them reviewed for the State they build in.
 */
final class ConstructionTerms {

    private ConstructionTerms() {
    }

    static final DateTimeFormatter DAY = DateTimeFormatter.ofPattern("dd MMMM yyyy", Locale.ENGLISH);

    /** What an agreement says: made once, then fixed. */
    record Wording(String title, String firstRole, String secondRole, List<String> recitals, List<String[]> particulars, List<String> terms) {
    }

    /** Everything the wording may need (only what the kind uses is filled). */
    record Context(ConstructionProject project, ConstructionService.Figures figures, List<ConstructionStage> stages,
                   ConstructionExtra extra, ConstructionParty party, List<ConstructionParty> parties, List<ConstructionUnit> partyUnits,
                   ConstructionSale sale, ConstructionUnit unit, List<ConstructionInstalment> plan, ConstructionPartner partner,
                   List<ConstructionPartner> partners, Map<Long, java.math.BigDecimal> invested, String contractNo, LocalDate contractDate,
                   String bankAccount, String extraTerms) {
    }

    static Wording of(String kind, Context c) {
        Wording w = switch (kind) {
            case "CONTRACT" -> contract(c);
            case "EXTRA" -> extra(c);
            case "PLOT_PURCHASE" -> plotPurchase(c);
            case "JDA" -> jda(c);
            case "FLAT_SALE" -> flatSale(c);
            case "TRIPARTITE" -> tripartite(c);
            case "SALE_DEED" -> saleDeed(c);
            case "POSSESSION" -> possession(c);
            case "PARTNERSHIP" -> partnership(c);
            default -> throw new IllegalArgumentException(kind);
        };
        return w;
    }

    // ================================================================== construction contract

    private static Wording contract(Context c) {
        ConstructionProject p = c.project();
        BigDecimal price = c.figures().contractValue();
        int defects = p.getDefectLiabilityMonths() == null ? 12 : p.getDefectLiabilityMonths();
        List<String> rec = List.of(
                "the Owner is the absolute owner and in lawful possession of the land " + site(p) + " (the \"Site\"), more particularly described in the particulars below",
                "the Owner intends to construct a building" + building(p) + " on the Site" + (p.getPermitNo() != null ? ", in accordance with the building permission No. " + p.getPermitNo() : "")
                        + ", and has approached the Builder for the purpose",
                "the Builder is engaged in the business of construction and has agreed to construct the said building for the Owner on the terms and conditions set out hereinafter");
        List<String[]> part = new ArrayList<>(siteRows(p));
        part.add(row("Building", buildingRow(p)));
        if (p.getPermitNo() != null) part.add(row("Building permission", p.getPermitNo()));
        part.add(row("Contract price", money(price) + " (" + words(price) + ")"));
        part.add(row("Commencement", day(p.getStartDate())));
        part.add(row("Completion", day(p.getPlannedEndDate())));
        part.add(row("Interest on late payment", lateRow(p.getLateInterestPercent(), p.getLateGraceDays())));
        part.add(row("Defect liability", defects + " months from handover"));
        int i = 1;
        for (ConstructionStage s : c.stages()) {
            if (Money.nz(s.getAmount()).signum() <= 0) continue;
            part.add(row("Instalment " + i++ + " · " + s.getName(), money(s.getAmount()) + " · " + (s.getDueDate() != null ? "by " + day(s.getDueDate())
                    : "within 7 days of the stage's completion")));
        }
        List<String> t = new ArrayList<>();
        t.add("SCOPE OF WORK: The Builder shall construct on the Site, for the Owner, the building described in the particulars, in accordance with the "
                + (p.getPermitNo() != null ? "approved building plan (permission No. " + p.getPermitNo() + ")" : "building plan approved by the competent authority")
                + " and the specifications agreed in writing between the Parties (the \"Works\"), and shall supply all materials, labour, tools, machinery and "
                + "supervision required for the Works, save as otherwise agreed in writing.");
        t.add("CONTRACT PRICE: In consideration of the Works the Owner shall pay to the Builder a total sum of " + money(price) + " (" + words(price)
                + ") (the \"Contract Price\"), being the sum of the stage-wise prices set out in the particulars. The Contract Price is fixed and shall not be "
                + "varied except for additional works and variations agreed under this Agreement.");
        t.add("PAYMENT SCHEDULE: The Owner shall pay the Contract Price in the instalments set out in the particulars, each on or before its due date or, where "
                + "no date is stated, within seven (7) days of the Builder's written intimation that the corresponding stage is complete. Every payment shall be "
                + "made by bank transfer, cheque, UPI or cash against the Builder's receipt, and shall be applied first to any interest due and then to the "
                + "oldest instalment outstanding.");
        t.add("TIME FOR COMPLETION: The Builder shall commence the Works on or before " + day(p.getStartDate()) + " and complete them on or before "
                + day(p.getPlannedEndDate()) + " (the \"Completion Date\"). The Completion Date shall stand extended by (a) the time agreed for any additional "
                + "works; (b) any period during which payments due from the Owner remain unpaid; (c) any delay in approvals, decisions, access to the Site or "
                + "supply of utilities attributable to the Owner; and (d) any event of force majeure.");
        t.add("INTEREST ON LATE PAYMENT: " + (p.getLateInterestPercent() != null
                ? "Any amount not paid by its due date shall carry simple interest at " + pct(p.getLateInterestPercent()) + "% per month, calculated daily on the "
                    + "amount outstanding" + grace(p.getLateGraceDays()) + ", from the due date until the date of payment. "
                : "No interest shall be charged on late payments, but the time for completion shall be extended by the period of delay. ")
                + "If any amount remains unpaid for more than thirty (30) days, the Builder may, after giving seven (7) days' written notice, suspend the Works "
                + "until payment is made, and the Completion Date shall stand extended accordingly.");
        t.add("ADDITIONAL WORKS AND VARIATIONS: Any additional work, alteration, upgrade of specification or extra construction requested by the Owner beyond "
                + "the Works shall be carried out only upon a supplementary agreement in writing stating its description, its price and the extension of the "
                + "Completion Date, if any. The price of such additional works shall be payable in addition to the Contract Price, as stated in the "
                + "supplementary agreement, and every supplementary agreement shall form part of this Agreement.");
        t.add("OWNER'S OBLIGATIONS: The Owner shall (a) give the Builder vacant and peaceful access to the Site free of all obstructions; (b) ensure that the "
                + "title to the Site is clear and indemnify the Builder against any claim relating to it; (c) obtain and keep valid, at the Owner's cost, the "
                + "building permission and statutory approvals, unless the Builder has agreed in writing to obtain them; (d) provide water and electricity "
                + "connections for construction; and (e) give decisions on drawings, specifications and selections within seven (7) days of being asked.");
        t.add("BUILDER'S OBLIGATIONS: The Builder shall execute the Works in a good and workmanlike manner, in accordance with the approved plan, the agreed "
                + "specifications, the National Building Code of India and the relevant Indian Standards, under the supervision of a qualified engineer, and "
                + "shall keep the Owner informed of the progress of the Works.");
        t.add("MATERIALS AND WORKMANSHIP: All materials shall be new, of standard quality and, where available, bearing the BIS (ISI) mark, of the brands and "
                + "grades agreed. The Owner or the Owner's engineer may inspect the Works and the materials at reasonable times, and any work found defective or "
                + "not in accordance with this Agreement shall be rectified or replaced by the Builder at the Builder's cost.");
        t.add("LABOUR, SAFETY AND INSURANCE: The Builder alone shall engage and be responsible for all workmen, shall pay their wages and comply with the labour "
                + "laws applicable to them, including the Building and Other Construction Workers Act, 1996 and the Employees' Compensation Act, 1923, shall take "
                + "all safety measures at the Site, and shall indemnify the Owner against every claim of or in respect of the workmen and third parties arising "
                + "from the execution of the Works.");
        t.add("DEFECT LIABILITY: For " + defects + " months from the date of handover, the Builder shall at its own cost rectify any defect in the Works "
                + "arising from faulty materials or workmanship, within thirty (30) days of being notified in writing, save defects caused by misuse, "
                + "alterations by the Owner or normal wear and tear.");
        t.add("HANDOVER: On completion of the Works and payment of every amount due under this Agreement, the Builder shall hand over the building to the Owner "
                + "with its keys and the documents in the Builder's possession. The Owner shall take possession within fifteen (15) days of the Builder's "
                + "intimation of completion, failing which the building shall be deemed handed over on the expiry of that period.");
        t.add("TERMINATION: Either Party may terminate this Agreement by written notice if the other commits a material breach and fails to remedy it within "
                + "thirty (30) days of being notified of it. On termination the Owner shall pay the Builder for the Works executed up to the date of termination, "
                + "valued at the stage-wise prices in proportion to the work done, and the Builder shall hand over the Site and the materials paid for.");
        t.add("FORCE MAJEURE: Neither Party shall be liable for a delay or failure caused by events beyond its reasonable control, such as acts of God, flood, "
                + "earthquake, epidemic, war, riot, strike, or orders of a government or court, and the time for performance shall stand extended by the period "
                + "of such event.");
        t.add("TAXES AND STATUTORY CHARGES: The Contract Price includes the cost of materials, labour, transport and supervision. Goods and Services Tax, if "
                + "applicable, shall be borne by the Owner at the prevailing rate unless the Contract Price is stated to include it. Fees for approvals, "
                + "betterment charges, utility connections and taxes on the property shall be borne by the Owner.");
        t.add(arbitration(p));
        t.add(law(p));
        t.add(notices("the Parties stated above"));
        t.add(electronic("the Owner"));
        t.add(entire());
        t.addAll(additional(c.extraTerms()));
        t.add(declaration("the Owner"));
        return new Wording("Construction Agreement", "Builder", "Owner", rec, part, t);
    }

    private static Wording extra(Context c) {
        ConstructionProject p = c.project();
        ConstructionExtra x = c.extra();
        int days = x.getExtraDays() == null ? 0 : x.getExtraDays();
        LocalDate before = c.figures().revisedEndDate() == null ? null
                : "AGREED".equals(x.getStatus()) || "DONE".equals(x.getStatus()) ? c.figures().revisedEndDate().minusDays(days) : c.figures().revisedEndDate();
        LocalDate after = before == null ? null : before.plusDays(days);
        String principal = c.contractNo() != null ? "the Construction Agreement No. " + c.contractNo() + (c.contractDate() != null ? " dated " + day(c.contractDate()) : "")
                : "the construction agreement between the Parties";
        List<String> rec = List.of(
                "the Parties have entered into " + principal + " (the \"Principal Agreement\") for the construction of a building on the land " + site(p),
                "the Owner has requested the Builder to carry out the additional works described below, which are not within the scope of the Principal "
                        + "Agreement, and the Builder has agreed to carry them out on the terms set out hereinafter");
        List<String[]> part = new ArrayList<>();
        part.add(row("Principal agreement", c.contractNo() != null ? c.contractNo() + (c.contractDate() != null ? " dated " + day(c.contractDate()) : "") : "Construction agreement"));
        part.add(row("Additional work", "EX-" + x.getSeq() + " · " + x.getTitle()));
        if (x.getDescription() != null) part.add(row("Description", x.getDescription()));
        part.add(row("Price", money(x.getAmount()) + " (" + words(x.getAmount()) + ")"));
        part.add(row("Payment", x.getDueDate() != null ? "on or before " + day(x.getDueDate()) : "within 7 days of the work's completion"));
        part.add(row("Extension of time", days + " days" + (after != null ? " · completion now " + day(after) : "")));
        List<String> t = new ArrayList<>();
        t.add("ADDITIONAL WORKS: The Builder shall carry out the additional works described in the particulars (the \"Additional Works\") in the manner, and "
                + "with materials of the standard, required by the Principal Agreement.");
        t.add("PRICE: The Owner shall pay the Builder " + money(x.getAmount()) + " (" + words(x.getAmount()) + ") for the Additional Works, in addition to "
                + "the Contract Price under the Principal Agreement, " + (x.getDueDate() != null ? "on or before " + day(x.getDueDate())
                : "within seven (7) days of the Builder's written intimation that the Additional Works are complete") + ".");
        t.add("EXTENSION OF TIME: " + (days > 0 ? "The Completion Date under the Principal Agreement shall stand extended by " + days + " (" + numberWords(days)
                + ") days" + (after != null ? ", to " + day(after) : "") + ", on account of the Additional Works."
                : "The Additional Works shall not extend the Completion Date under the Principal Agreement."));
        t.add("INTEREST ON LATE PAYMENT: The price of the Additional Works, if not paid when due, shall carry interest on the terms of the Principal Agreement.");
        t.add("PRINCIPAL AGREEMENT TO CONTINUE: This Agreement is supplementary to and forms part of the Principal Agreement. Save as stated herein, all the "
                + "terms of the Principal Agreement, including those on defect liability, dispute resolution and jurisdiction, shall apply to the Additional Works.");
        t.add(electronic("the Owner"));
        t.addAll(additional(c.extraTerms()));
        t.add(declaration("the Owner"));
        return new Wording("Supplementary Agreement for Additional Works", "Builder", "Owner", rec, part, t);
    }

    // ================================================================== land

    private static Wording plotPurchase(Context c) {
        ConstructionProject p = c.project();
        ConstructionParty s = c.party();
        BigDecimal price = s.getConsideration() != null && s.getConsideration().signum() > 0 ? s.getConsideration()
                : s.getSharePercent() != null && p.getPlotPrice() != null ? Money.round(p.getPlotPrice().multiply(s.getSharePercent()).divide(Money.HUNDRED, 2, RoundingMode.HALF_UP))
                : Money.nz(p.getPlotPrice());
        List<ConstructionParty> others = c.parties().stream().filter(x -> "SELLER".equals(x.getRole()) && !x.getId().equals(s.getId())).toList();
        List<String> rec = new ArrayList<>();
        rec.add("the Vendor is the absolute owner and in peaceful possession of " + (s.getSharePercent() != null && s.getSharePercent().compareTo(Money.HUNDRED) < 0
                ? "an undivided " + pct(s.getSharePercent()) + "% share in " : "") + "the land " + site(p) + " (the \"Schedule Property\"), having acquired the same "
                + "under valid title documents, copies of which have been furnished to the Purchaser"
                + (others.isEmpty() ? "" : ", the remaining share being owned by " + names(others.stream().map(ConstructionParty::getName).toList())));
        rec.add("the Vendor has offered to sell, and the Purchaser has agreed to purchase, the Schedule Property for the consideration and on the terms and "
                + "conditions set out hereinafter");
        List<String[]> part = new ArrayList<>(siteRows(p));
        if (s.getSharePercent() != null && s.getSharePercent().compareTo(Money.HUNDRED) < 0) part.add(row("Vendor's share", pct(s.getSharePercent()) + "% (undivided)"));
        part.add(row("Sale consideration", money(price) + " (" + words(price) + ")"));
        part.add(row("Sale deed by", day(p.getStartDate() != null ? p.getStartDate() : null)));
        List<String> t = new ArrayList<>();
        t.add("SALE AND PURCHASE: The Vendor agrees to sell and the Purchaser agrees to purchase the Schedule Property, together with all rights, easements and "
                + "appurtenances attached to it, free from all encumbrances, for the consideration stated below.");
        t.add("CONSIDERATION: The total sale consideration is " + money(price) + " (" + words(price) + "). Any advance paid by the Purchaser shall be "
                + "acknowledged by the Vendor's receipt and adjusted against it, and the balance shall be paid at the time of the registration of the sale deed.");
        t.add("TITLE AND ENCUMBRANCES: The Vendor represents and warrants that the Vendor has a clear and marketable title to the Schedule Property; that it is "
                + "free from all encumbrances, mortgages, charges, liens, attachments, litigation and acquisition proceedings; and that no other person has any "
                + "right, title or interest in it. The Vendor shall hand over the original title deeds, link documents, an encumbrance certificate for the "
                + "last thirty (30) years, and the latest tax receipts to the Purchaser on registration.");
        t.add("EXECUTION OF THE SALE DEED: The Vendor shall execute and present for registration a sale deed in favour of the Purchaser, or its nominee, "
                + (p.getStartDate() != null ? "on or before " + day(p.getStartDate()) : "within ninety (90) days of this Agreement")
                + ", on payment of the balance consideration, before the jurisdictional Sub-Registrar.");
        t.add("POSSESSION: The Vendor shall deliver vacant and peaceful possession of the Schedule Property to the Purchaser at the time of registration of the sale deed.");
        t.add("COSTS AND OUTGOINGS: Stamp duty, registration charges and incidental expenses of the sale deed shall be borne by the Purchaser. All taxes, "
                + "dues and outgoings on the Schedule Property up to the date of registration shall be paid by the Vendor.");
        t.add("APPROVALS FOR DEVELOPMENT: The Vendor consents to the Purchaser applying for building permission and other approvals in respect of the Schedule "
                + "Property pending registration, and shall sign the applications, affidavits and consents required for them.");
        t.add("DEFAULT BY THE VENDOR: If the Vendor fails to execute the sale deed as agreed, the Purchaser shall be entitled to enforce specific performance of "
                + "this Agreement under the Specific Relief Act, 1963, or, at its option, to a refund of all sums paid with interest at twelve per cent (12%) per annum.");
        t.add("DEFAULT BY THE PURCHASER: If the Purchaser fails to pay the balance consideration within thirty (30) days of the Vendor's written notice "
                + "after the date fixed for registration, the Vendor may terminate this Agreement and refund the amounts paid, after deducting the actual loss "
                + "proved, not exceeding ten per cent (10%) of the consideration.");
        t.add("INDEMNITY: The Vendor shall indemnify and keep indemnified the Purchaser and its successors against any loss arising from any defect in the "
                + "Vendor's title or any claim by any person claiming through the Vendor.");
        t.add(law(p));
        t.add(notices("the Parties stated above"));
        t.add(electronic("the Vendor"));
        t.add(entire());
        t.addAll(additional(c.extraTerms()));
        t.add(declaration("the Vendor"));
        return new Wording("Agreement of Sale", "Purchaser", "Vendor", rec, part, t);
    }

    private static Wording jda(Context c) {
        ConstructionProject p = c.project();
        ConstructionParty o = c.party();
        BigDecimal ownersShare = Money.nz(p.getLandownerSharePercent());
        BigDecimal developer = Money.HUNDRED.subtract(ownersShare);
        BigDecimal deposit = o.getConsideration() != null && o.getConsideration().signum() > 0 ? o.getConsideration()
                : o.getSharePercent() != null && p.getRefundableDeposit() != null ? Money.round(p.getRefundableDeposit().multiply(o.getSharePercent()).divide(Money.HUNDRED, 2, RoundingMode.HALF_UP))
                : Money.nz(p.getRefundableDeposit());
        List<ConstructionParty> others = c.parties().stream().filter(x -> "LANDOWNER".equals(x.getRole()) && !x.getId().equals(o.getId())).toList();
        List<String> rec = List.of(
                "the Landowner is the absolute owner and in peaceful possession of " + (others.isEmpty() ? "" : "an undivided share in ") + "the land " + site(p)
                        + " (the \"Schedule Land\")" + (others.isEmpty() ? "" : ", together with " + names(others.stream().map(ConstructionParty::getName).toList())),
                "the Developer is engaged in the business of construction and development of real estate and has the expertise and resources to develop the Schedule Land",
                "the Landowner is desirous of developing the Schedule Land into a residential apartment building known as \"" + p.getName() + "\", and has agreed "
                        + "to grant the Developer the right to develop it, in consideration of the Landowner's share of the constructed area, on the terms and "
                        + "conditions set out hereinafter");
        List<String[]> part = new ArrayList<>(siteRows(p));
        part.add(row("Project", p.getName() + buildingRow(p).replaceFirst("^", " · ")));
        if (p.getPermitNo() != null) part.add(row("Building permission", p.getPermitNo()));
        part.add(row("Landowners' share", pct(ownersShare) + "% of the constructed area" + (o.getSharePercent() != null && others.size() > 0
                ? " (this Landowner: " + pct(o.getSharePercent()) + "% of it)" : "")));
        part.add(row("Developer's share", pct(developer) + "% of the constructed area"));
        if (deposit.signum() > 0) part.add(row("Refundable deposit", money(deposit) + " (" + words(deposit) + ")"));
        part.add(row("Completion", day(p.getPlannedEndDate())));
        if (!c.partyUnits().isEmpty()) {
            part.add(row("Flats allotted to the Landowner", c.partyUnits().stream().map(u -> ConstructionService.unitLabel(u)
                    + (u.getUnitType() != null ? " (" + u.getUnitType() + ")" : "")).collect(Collectors.joining(", "))));
        }
        List<String> t = new ArrayList<>();
        t.add("GRANT OF DEVELOPMENT RIGHTS: The Landowner hereby grants to the Developer the exclusive right to develop the Schedule Land by constructing a "
                + "residential apartment building on it, and permits the Developer to enter upon the Schedule Land for that purpose as a licensee. This "
                + "Agreement shall not by itself operate as a transfer of the Schedule Land, save the undivided share corresponding to the Developer's share "
                + "of the constructed area, which shall pass to the Developer or its purchasers as provided herein.");
        t.add("PLANS AND APPROVALS: The Developer shall at its own cost prepare the plans and obtain the building permission and all approvals required, in the "
                + "name of the Landowner where the law so requires, and the Landowner shall sign the applications, affidavits, undertakings and consents needed.");
        t.add("COST OF CONSTRUCTION: The entire cost of construction, including materials, labour, approvals, professional fees and common amenities, shall be "
                + "borne by the Developer, and the Landowner shall not be liable for any part of it.");
        t.add("SHARING OF THE CONSTRUCTED AREA: The constructed area, together with the proportionate undivided share in the Schedule Land, car parking and the "
                + "common areas, shall be shared in the ratio of " + pct(ownersShare) + "% to the Landowner(s) and " + pct(developer) + "% to the Developer. "
                + "The specific flats falling to the Landowner's share shall be those set out in the particulars or as allotted by mutual agreement in writing, "
                + "of the same specifications as the Developer's flats.");
        if (deposit.signum() > 0) {
            t.add("REFUNDABLE SECURITY DEPOSIT: The Developer has paid or shall pay the Landowner a refundable security deposit of " + money(deposit) + " ("
                    + words(deposit) + "), which shall not carry interest and shall be refunded by the Landowner, or adjusted, at the time of handover of the "
                    + "Landowner's share of the constructed area.");
        }
        t.add("TIME FOR COMPLETION: The Developer shall complete the construction and hand over the Landowner's share of the constructed area, fit for "
                + "occupation, on or before " + day(p.getPlannedEndDate()) + ", with a grace period of six (6) months, subject to force majeure and delays in "
                + "approvals not attributable to the Developer. For any delay beyond the grace period, the Developer shall compensate the Landowner at the rate "
                + "stated in the additional terms or, if none is stated, at the prevailing monthly rent of the Landowner's share, until handover.");
        t.add("POWER OF ATTORNEY: Simultaneously with this Agreement the Landowner shall execute a registered general power of attorney in favour of the "
                + "Developer, limited to obtaining approvals and to selling and conveying the flats falling to the Developer's share together with the "
                + "corresponding undivided share in the Schedule Land.");
        t.add("SALE OF THE SHARES: Each Party shall be free to sell, lease or deal with the flats falling to its own share and to receive the consideration for "
                + "them, and the other Party shall join in the conveyances where required, without claiming any part of that consideration.");
        t.add("TITLE AND INDEMNITY: The Landowner represents and warrants that the Landowner has a clear and marketable title to the Schedule Land, free from "
                + "all encumbrances and litigation, and shall indemnify the Developer against any loss arising from a defect in that title. The Developer "
                + "shall indemnify the Landowner against all claims arising from the construction, including those of workmen and third parties.");
        t.add("TAXES AND OUTGOINGS: Taxes and outgoings on the Schedule Land up to the date of this Agreement shall be borne by the Landowner, and thereafter "
                + "by the Developer until the Landowner's share is handed over. Taxes on the transfer of the constructed area shall be borne as required by law.");
        t.add("ASSOCIATION AND MAINTENANCE: On completion, the owners of the flats shall form an association for the maintenance of the building and the common "
                + "areas, and each Party shall bear the maintenance charges of the flats in its share from the date of handover.");
        t.add("STAMP DUTY AND REGISTRATION: This Agreement shall be stamped and registered where the law so requires, and the stamp duty and registration "
                + "charges on it and on the power of attorney shall be borne by the Developer.");
        t.add(arbitration(p));
        t.add(law(p));
        t.add(notices("the Parties stated above"));
        t.add(electronic("the Landowner"));
        t.add(entire());
        t.addAll(additional(c.extraTerms()));
        t.add(declaration("the Landowner"));
        return new Wording("Joint Development Agreement", "Developer", "Landowner", rec, part, t);
    }

    // ================================================================== flat sales

    private static Wording flatSale(Context c) {
        ConstructionProject p = c.project();
        ConstructionSale s = c.sale();
        ConstructionUnit u = c.unit();
        BigDecimal rate = s.getLateInterestPercent() != null ? s.getLateInterestPercent() : p.getLateInterestPercent();
        LocalDate possession = c.figures().revisedEndDate();
        List<String> rec = List.of(
                ConstructionService.JOINT.equals(p.getLandMode())
                        ? "the Promoter is entitled to develop the land " + site(p) + " under a joint development agreement with its owners, and to sell the "
                            + "apartments falling to its share together with the proportionate undivided share in the land"
                        : "the Promoter is the absolute owner of the land " + site(p) + " (the \"Land\")",
                "the Promoter is constructing on the Land a residential project known as \"" + p.getName() + "\"" + (p.getPermitNo() != null ? " under building permission No. " + p.getPermitNo() : "")
                        + (p.getReraNo() != null ? ", registered with the Real Estate Regulatory Authority under No. " + p.getReraNo() : ""),
                "the Allottee applied for the allotment of the apartment described in the particulars, and the Promoter has agreed to sell it to the Allottee "
                        + "on the terms and conditions set out hereinafter");
        List<String[]> part = new ArrayList<>();
        part.add(row("Project", p.getName() + (p.getSiteAddress() != null ? ", " + p.getSiteAddress() : "")));
        if (p.getReraNo() != null) part.add(row("RERA registration", p.getReraNo()));
        part.addAll(unitRows(u));
        part.add(row("Base price", money(s.getBasePrice())));
        if (Money.nz(s.getOtherCharges()).signum() > 0) part.add(row("Other charges", money(s.getOtherCharges()) + (s.getOtherChargesNote() != null ? " (" + s.getOtherChargesNote() + ")" : "")));
        part.add(row("Total price", money(s.getTotalPrice()) + " (" + words(s.getTotalPrice()) + ")"));
        part.add(row("Booked on", day(s.getBookedOn())));
        part.add(row("Possession by", day(possession)));
        part.add(row("Interest on late payment", lateRow(rate, p.getLateGraceDays())));
        Map<Long, ConstructionStage> stageById = c.stages().stream().collect(Collectors.toMap(ConstructionStage::getId, x -> x));
        int i = 1;
        for (ConstructionInstalment x : c.plan()) {
            ConstructionStage st = x.getStageId() == null ? null : stageById.get(x.getStageId());
            part.add(row("Instalment " + i++ + " · " + x.getLabel(), money(x.getAmount()) + (x.getPercent() != null ? " (" + pct(x.getPercent()) + "%)" : "") + " · "
                    + (x.getDueDate() != null ? "by " + day(x.getDueDate()) : st != null ? "within " + (x.getDaysAfterStage() == null ? 15 : x.getDaysAfterStage())
                        + " days of " + st.getName() : "on demand")));
        }
        List<String> t = new ArrayList<>();
        t.add("AGREEMENT TO SELL: The Promoter agrees to sell and the Allottee agrees to purchase the apartment described in the particulars, together with the "
                + "proportionate undivided share in the land and the common areas, and the right to use the car parking stated (the \"Apartment\").");
        t.add("TOTAL PRICE: The total price of the Apartment is " + money(s.getTotalPrice()) + " (" + words(s.getTotalPrice()) + "), made up as set out in "
                + "the particulars. Stamp duty, registration charges and the charges of utility connections and the association, and taxes not included in it, "
                + "shall be borne by the Allottee. The total price shall not be increased save for taxes levied by the government after this Agreement.");
        t.add("PAYMENT PLAN: The Allottee shall pay the total price in the instalments set out in the particulars, each on or before its due date or, for a "
                + "construction-linked instalment, within the days stated of the Promoter's written demand on completion of the stage. Time is of the essence "
                + "for every payment.");
        t.add("INTEREST ON DELAYED PAYMENT: " + (rate != null ? "Any instalment not paid when due shall carry simple interest at " + pct(rate) + "% per month"
                + grace(p.getLateGraceDays()) + " from the due date until payment, as provided in section 19(7) of the Real Estate (Regulation and "
                + "Development) Act, 2016. The Promoter shall pay the Allottee interest at the same rate for every month of delay in handing over possession, "
                + "as provided in section 18 of that Act."
                : "Delayed payments shall carry interest at the rate prescribed under the Real Estate (Regulation and Development) Act, 2016 and the rules made "
                    + "under it, and the Promoter shall pay interest at the same rate for any delay in handing over possession."));
        t.add("HOME LOAN: The Allottee may finance the purchase through a bank or housing finance company. The Promoter shall issue the no-objection letters "
                + "and enter into a tripartite agreement with the lender, and the amounts disbursed shall be paid directly into the Promoter's account. The "
                + "Allottee shall remain liable for every instalment whether or not the loan is sanctioned or disbursed in time.");
        t.add("CONSTRUCTION AND SPECIFICATIONS: The Promoter shall construct the Apartment and the project in accordance with the sanctioned plans and the "
                + "specifications agreed, and shall not make any change in them without the consent of the Allottee, save the minor changes permitted by section "
                + "14 of the Real Estate (Regulation and Development) Act, 2016.");
        t.add("CARPET AREA: If the carpet area of the Apartment on completion differs from that stated, the total price shall be adjusted at the agreed rate for "
                + "the difference beyond three per cent (3%); any excess paid shall be refunded with interest, and any increase shall be payable before possession.");
        t.add("POSSESSION: The Promoter shall hand over possession of the Apartment on or before " + day(possession) + ", after obtaining the occupancy "
                + "certificate and on payment of the total price and all dues. The Allottee shall take possession within two (2) months of the Promoter's "
                + "intimation. If the Promoter fails to do so, the Allottee may, at the Allottee's option, withdraw and receive a refund of all amounts paid "
                + "with interest, or continue and receive interest for the delay, as provided in section 18 of the Real Estate (Regulation and Development) Act, 2016.");
        t.add("DEFECT LIABILITY: Any structural defect, or defect in workmanship, quality or services, brought to the Promoter's notice within five (5) years "
                + "from the date of handing over possession shall be rectified by the Promoter without charge within thirty (30) days, as provided in section "
                + "14(3) of the Real Estate (Regulation and Development) Act, 2016.");
        t.add("CONVEYANCE: On payment of the total price and all dues, the Promoter shall execute and register a sale deed of the Apartment in favour of the "
                + "Allottee within three (3) months of the occupancy certificate. Stamp duty and registration charges on it shall be borne by the Allottee.");
        t.add("CANCELLATION BY THE ALLOTTEE: The Allottee may cancel the allotment by written notice, whereupon the Promoter may forfeit the booking amount, not "
                + "exceeding ten per cent (10%) of the total price, and shall refund the balance paid, without interest, within forty-five (45) days of cancellation.");
        t.add("DEFAULT BY THE ALLOTTEE: If the Allottee fails to pay two (2) consecutive instalments, the Promoter may, after thirty (30) days' written notice, "
                + "cancel the allotment, forfeit the booking amount not exceeding ten per cent (10%) of the total price and refund the balance; where the purchase "
                + "is financed, the refund shall first be made to the lender.");
        t.add("TITLE AND ENCUMBRANCES: The Promoter represents that it has a clear title to (or the right to develop) the land and that the Apartment shall be "
                + "free from all encumbrances when conveyed; any charge created for construction finance shall be released before the conveyance.");
        t.add("MAINTENANCE AND ASSOCIATION: The Allottee shall pay the maintenance charges from the date of possession, shall become a member of the association "
                + "of allottees, and shall use the Apartment for residence only and not make any structural alteration in it.");
        t.add("TRANSFER: The Allottee shall not transfer the Allottee's rights under this Agreement before paying the total price, without the Promoter's "
                + "written consent.");
        t.add("DISPUTES: Any dispute shall first be settled amicably, failing which it may be referred to the Real Estate Regulatory Authority or its "
                + "adjudicating officer under the Real Estate (Regulation and Development) Act, 2016.");
        t.add(law(p));
        t.add(notices("the Parties stated above"));
        t.add(electronic("the Allottee"));
        t.add(entire());
        t.addAll(additional(c.extraTerms()));
        t.add(declaration("the Allottee"));
        return new Wording("Agreement for Sale", "Promoter", "Allottee", rec, part, t);
    }

    private static Wording tripartite(Context c) {
        ConstructionProject p = c.project();
        ConstructionSale s = c.sale();
        String bank = Objects.toString(s.getLoanBank(), "the Bank");
        List<String> rec = List.of(
                "by an agreement for sale" + (s.getAgreementOn() != null ? " dated " + day(s.getAgreementOn()) : "") + " the Promoter agreed to sell to the "
                        + "Allottee the apartment described in the particulars (the \"Apartment\") in the project \"" + p.getName() + "\" for " + money(s.getTotalPrice()),
                "the Allottee applied to " + bank + " (the \"Bank\") for a housing loan to purchase the Apartment, and the Bank has sanctioned a loan of "
                        + money(Money.nz(s.getLoanAmount())) + (s.getLoanSanctionedOn() != null ? " by its sanction letter dated " + day(s.getLoanSanctionedOn()) : "")
                        + ", subject among other conditions to this Agreement");
        List<String[]> part = new ArrayList<>(unitRows(c.unit()));
        part.add(row("Total price", money(s.getTotalPrice())));
        part.add(row("Loan sanctioned", money(Money.nz(s.getLoanAmount())) + " (" + words(Money.nz(s.getLoanAmount())) + ")"));
        part.add(row("Bank", bank + (s.getLoanBranch() != null ? ", " + s.getLoanBranch() : "")));
        if (s.getLoanNo() != null) part.add(row("Loan account", s.getLoanNo()));
        if (s.getLoanSanctionedOn() != null) part.add(row("Sanctioned on", day(s.getLoanSanctionedOn())));
        if (c.bankAccount() != null) part.add(row("Promoter's account for disbursement", c.bankAccount()));
        List<String> t = new ArrayList<>();
        t.add("DISBURSEMENT: The Allottee irrevocably authorises the Bank to disburse the loan directly into the Promoter's account stated in the particulars, "
                + "in the instalments due under the agreement for sale, against the Promoter's demand letters and the Allottee's request.");
        t.add("CHARGE OF THE BANK: The Promoter notes the Bank's charge on the Apartment and shall not create any other charge on it, nor allot or transfer it "
                + "to any other person, without the Bank's prior written consent, as long as any part of the loan is outstanding.");
        t.add("TITLE DOCUMENTS: On registration of the sale deed, the original registered sale deed shall be delivered to the Bank, to be held as security "
                + "for the loan, and the Promoter shall give the Bank copies of the documents of title and approvals it reasonably requires.");
        t.add("CANCELLATION AND REFUND: If the allotment is cancelled for any reason, the Promoter shall refund the amounts received from the Bank directly to "
                + "the Bank, after the deductions permitted by the agreement for sale, and shall refund any balance to the Allottee only with the Bank's written "
                + "no-objection.");
        t.add("OBLIGATIONS OF THE ALLOTTEE: The Allottee shall repay the loan as required by the loan agreement with the Bank. The Bank's obligation is limited "
                + "to the disbursement of the loan, and it shall not be responsible for the construction, its quality or any delay in it. The Allottee's "
                + "obligations under the agreement for sale shall continue unaffected.");
        t.add("UNDERTAKINGS OF THE PROMOTER: The Promoter shall inform the Bank of any material delay in the construction or any default by the Allottee under "
                + "the agreement for sale, and shall furnish the certificates of the progress of construction the Bank reasonably requires before each disbursement.");
        t.add("DEFAULT IN REPAYMENT: If the Allottee defaults in the repayment of the loan, the Bank shall be entitled to enforce its security over the Apartment, "
                + "and the Promoter shall co-operate in transferring the Allottee's rights to a purchaser approved by the Bank, on payment of the dues to the Promoter.");
        t.add(law(p));
        t.add(notices("the Parties stated above"));
        t.add(electronic("the Allottee"));
        t.add(entire());
        t.addAll(additional(c.extraTerms()));
        t.add(declaration("the Allottee"));
        return new Wording("Tripartite Agreement", "Promoter", "Allottee", rec, part, t);
    }

    private static Wording saleDeed(Context c) {
        ConstructionProject p = c.project();
        ConstructionSale s = c.sale();
        boolean joint = ConstructionService.JOINT.equals(p.getLandMode());
        List<String> rec = new ArrayList<>();
        rec.add(joint ? "the Vendor is entitled, under a joint development agreement with the owners of the land " + site(p) + " and the power of attorney "
                + "given by them, to sell and convey the apartments falling to its share together with the proportionate undivided share in the land"
                : "the Vendor is the absolute owner of the land " + site(p) + ", having acquired the same under valid title documents");
        rec.add("the Vendor has constructed on the said land a residential building known as \"" + p.getName() + "\""
                + (p.getPermitNo() != null ? " in accordance with the building permission No. " + p.getPermitNo() : ""));
        rec.add("by an agreement for sale" + (s.getAgreementOn() != null ? " dated " + day(s.getAgreementOn()) : "") + " the Vendor agreed to sell to the "
                + "Purchaser the apartment described in the schedule below (the \"Schedule Apartment\") for a consideration of " + money(s.getTotalPrice())
                + ", and the Purchaser has paid the entire consideration");
        List<String[]> part = new ArrayList<>(unitRows(c.unit()));
        part.add(row("Land", site(p)));
        part.add(row("Undivided share of land", "proportionate to the Schedule Apartment's area"));
        part.add(row("Sale consideration", money(s.getTotalPrice()) + " (" + words(s.getTotalPrice()) + ") · paid in full"));
        part.add(row("Market value for stamp duty", "as assessed by the Sub-Registrar"));
        List<String> t = new ArrayList<>();
        t.add("CONVEYANCE: In consideration of the sum of " + money(s.getTotalPrice()) + " (" + words(s.getTotalPrice()) + ") paid by the Purchaser to the "
                + "Vendor, the receipt of which the Vendor hereby admits and acknowledges, the Vendor hereby sells, conveys, transfers and assigns unto the "
                + "Purchaser the Schedule Apartment, together with the proportionate undivided share in the land, the right to use the common areas and the "
                + "car parking allotted, and all rights, easements and appurtenances attached to it, to have and to hold the same absolutely and forever.");
        t.add("RECEIPT OF THE CONSIDERATION: The Vendor acknowledges that the entire consideration has been received, as recorded in its receipts, and that "
                + "nothing remains due from the Purchaser.");
        t.add("POSSESSION: The Vendor has delivered vacant and peaceful possession of the Schedule Apartment to the Purchaser" + (s.getHandedOverOn() != null
                ? " on " + day(s.getHandedOverOn()) : " this day") + ".");
        t.add("TITLE: The Vendor covenants that it has full right and authority to convey the Schedule Apartment; that it is free from all encumbrances, "
                + "charges, liens and litigation; and that the Vendor shall indemnify the Purchaser against any loss arising from a defect in the title conveyed.");
        t.add("MUTATION: The Purchaser shall be entitled to have the Schedule Apartment mutated and assessed in the Purchaser's name in the records of the "
                + "local authority and the utilities, and the Vendor shall sign the papers required for it.");
        t.add("TAXES AND OUTGOINGS: All taxes and outgoings on the Schedule Apartment up to the date of possession shall be borne by the Vendor and thereafter by "
                + "the Purchaser.");
        t.add("COMMON AREAS AND MAINTENANCE: The Purchaser shall be entitled to use the common areas and amenities together with the other owners, shall pay the "
                + "maintenance charges and shall be a member of the association of owners, and shall not make any structural alteration that affects the building.");
        t.add("STAMP DUTY AND REGISTRATION: The stamp duty and registration charges on this deed have been borne by the Purchaser, and this deed shall be "
                + "presented for registration under the Registration Act, 1908.");
        t.add(law(p));
        t.addAll(additional(c.extraTerms()));
        return new Wording("Sale Deed", "Vendor", "Purchaser", rec, part, t);
    }

    private static Wording possession(Context c) {
        ConstructionProject p = c.project();
        ConstructionSale s = c.sale();
        LocalDate on = s.getHandedOverOn() != null ? s.getHandedOverOn() : LocalDate.now();
        List<String> rec = List.of(
                "the Promoter has sold to the Allottee the apartment described in the particulars (the \"Apartment\") in the project \"" + p.getName() + "\""
                        + (s.getDeedNo() != null ? " by a sale deed registered as document No. " + s.getDeedNo() + (s.getSubRegistrar() != null ? " in the office of the Sub-Registrar, " + s.getSubRegistrar() : "")
                        : s.getAgreementOn() != null ? " under an agreement for sale dated " + day(s.getAgreementOn()) : ""),
                "the construction of the Apartment is complete, and the Promoter is handing over its possession to the Allottee");
        List<String[]> part = new ArrayList<>(unitRows(c.unit()));
        part.add(row("Possession on", day(on)));
        if (s.getDeedNo() != null) part.add(row("Sale deed", s.getDeedNo() + (s.getRegisteredOn() != null ? " · registered " + day(s.getRegisteredOn()) : "")));
        part.add(row("Keys handed over", "______ sets"));
        part.add(row("Electricity meter reading", "______"));
        part.add(row("Water meter reading", "______"));
        List<String> t = new ArrayList<>();
        t.add("HANDOVER OF POSSESSION: The Promoter has this day, " + day(on) + ", handed over and the Allottee has taken vacant and peaceful possession of the "
                + "Apartment, together with its keys.");
        t.add("INSPECTION: The Allottee has inspected the Apartment and found it constructed in accordance with the agreed plans and specifications and in good "
                + "condition, save the items listed in the additional terms, which the Promoter shall rectify within thirty (30) days.");
        t.add("OUTGOINGS: From the date of possession the Allottee shall bear the maintenance charges, electricity and water charges, and the property taxes of "
                + "the Apartment.");
        t.add("DEFECT LIABILITY: This handover does not affect the Promoter's liability to rectify defects for five (5) years from the date of possession under "
                + "section 14(3) of the Real Estate (Regulation and Development) Act, 2016.");
        t.add("DOCUMENTS: The Promoter has handed over to the Allottee copies of the occupancy certificate, the approved plans and the warranties of the fittings, "
                + "as far as available.");
        t.addAll(additional(c.extraTerms()));
        t.add(declaration("the Allottee"));
        return new Wording("Possession Certificate", "Promoter", "Allottee", rec, part, t);
    }

    // ================================================================== partners

    private static Wording partnership(Context c) {
        ConstructionProject p = c.project();
        ConstructionPartner x = c.partner();
        List<String> rec = List.of(
                "the Managing Partner is undertaking the project \"" + p.getName() + "\" (" + (ConstructionService.CONTRACT.equals(p.getKind())
                        ? "a construction contract for " + Objects.toString(p.getClientName(), "an owner") : "a residential development") + ") on the land " + site(p) + " (the \"Project\")",
                "the Partner has agreed to participate in the Project by contributing capital and to share its profits and losses in the proportion set out "
                        + "hereinafter, together with the other partners named in the particulars");
        List<String[]> part = new ArrayList<>();
        part.add(row("Project", p.getName()));
        for (ConstructionPartner o : c.partners()) {
            part.add(row("Partner · " + o.getName(), pct(o.getSharePercent()) + "% of the profit or loss" + (c.invested().containsKey(o.getId())
                    ? " · capital so far " + money(c.invested().get(o.getId())) : "")));
        }
        part.add(row("This Partner's share", pct(x.getSharePercent()) + "%"));
        List<String> t = new ArrayList<>();
        t.add("NATURE OF THE ARRANGEMENT: The Parties shall carry on the Project jointly, and this Agreement relates to the Project alone. No Party shall bind "
                + "the others, save the Managing Partner in the ordinary course of the Project.");
        t.add("CAPITAL CONTRIBUTION: Each partner shall contribute the capital agreed, as and when required for the Project. Every contribution and withdrawal "
                + "shall be recorded in the books of the Project and acknowledged in writing.");
        t.add("SHARING OF PROFITS AND LOSSES: The profit or loss of the Project, determined on its completion after meeting all its costs, loans and liabilities, "
                + "shall be shared by the partners in the proportions set out in the particulars, which for the Partner is " + pct(x.getSharePercent()) + "%.");
        t.add("MANAGEMENT: The Managing Partner shall manage the Project, including construction, purchases, sales, receipts and banking, shall keep true "
                + "accounts of it, and shall give the Partner access to the accounts and documents of the Project on reasonable request.");
        t.add("BORROWING: Loans for the Project shall be taken only with the consent of the partners holding the majority of the shares.");
        t.add("WITHDRAWAL OF CAPITAL: No partner shall withdraw capital before the completion of the Project, except with the consent of the other partners.");
        t.add("TRANSFER OF INTEREST: No partner shall assign the partner's interest in the Project without the consent of the others, who shall have the first "
                + "right to purchase it.");
        t.add("DEATH OR INCAPACITY: On the death or incapacity of a partner, the partner's legal representatives shall be entitled to the partner's share of "
                + "the capital and profit, but not to take part in the management of the Project.");
        t.add("SETTLEMENT OF ACCOUNTS: Within ninety (90) days of the completion of the Project, the accounts shall be settled, the capital returned and the "
                + "profit or loss shared as agreed.");
        t.add(arbitration(p));
        t.add(law(p));
        t.add(notices("the Parties stated above"));
        t.add(electronic("the Partner"));
        t.add(entire());
        t.addAll(additional(c.extraTerms()));
        t.add(declaration("the Partner"));
        return new Wording("Project Partnership Agreement", "Managing Partner", "Partner", rec, part, t);
    }

    // ================================================================== common clauses

    private static String arbitration(ConstructionProject p) {
        String seat = p.getCity() != null ? p.getCity() : "the place where this Agreement is executed";
        return "DISPUTE RESOLUTION: Any dispute arising out of or in connection with this Agreement shall first be settled amicably by the Parties. Failing "
                + "settlement within thirty (30) days, it shall be referred to a sole arbitrator appointed by mutual consent, under the Arbitration and "
                + "Conciliation Act, 1996. The seat and venue of the arbitration shall be " + seat + " and its language English.";
    }

    private static String law(ConstructionProject p) {
        return "GOVERNING LAW AND JURISDICTION: This Agreement shall be governed by the laws of India. " + (p.getCity() != null
                ? "The courts at " + p.getCity() + " shall have exclusive jurisdiction"
                : "The courts having jurisdiction over the place where the property is situated shall have exclusive jurisdiction") + " in all matters arising out of it.";
    }

    private static String notices(String who) {
        return "NOTICES: Any notice under this Agreement shall be in writing and may be given at the address or mobile number of " + who + ", including by "
                + "registered post, e-mail, SMS or WhatsApp, and shall be deemed received on the day it is delivered or sent electronically.";
    }

    private static String electronic(String who) {
        return "ELECTRONIC EXECUTION AND EVIDENCE: The Parties agree that this Agreement may be accepted electronically. The verification of the mobile number "
                + "of " + who + ", their signature and photograph, the details of the device used and the digitally signed record of acceptance shall constitute "
                + "valid evidence of its execution, in accordance with the Information Technology Act, 2000 and the Bharatiya Sakshya Adhiniyam, 2023.";
    }

    private static String entire() {
        return "ENTIRE AGREEMENT AND SEVERABILITY: This Agreement, with its particulars, records the entire understanding of the Parties on its subject and may "
                + "be amended only in writing signed by them. If any provision is held invalid, the remaining provisions shall continue in full force.";
    }

    private static String declaration(String who) {
        return "DECLARATION: The Parties, and in particular " + who + ", declare that they have read this Agreement, or have had it read over and explained in "
                + "a language they understand, have understood its contents, and have executed it freely and voluntarily, without any coercion, undue "
                + "influence or misrepresentation.";
    }

    private static List<String> additional(String extra) {
        if (extra == null || extra.isBlank()) return List.of();
        return extra.lines().map(String::trim).filter(l -> !l.isEmpty()).map(l -> "ADDITIONAL TERM: " + l).toList();
    }

    // ================================================================== words and figures

    /** "bearing Survey No. 123, Plot No. 45, admeasuring 240 square yards, situated at ..., Hyderabad". */
    static String site(ConstructionProject p) {
        List<String> bits = new ArrayList<>();
        if (p.getSurveyNo() != null) bits.add("bearing Survey No. " + p.getSurveyNo());
        if (p.getPlotNo() != null) bits.add("Plot No. " + p.getPlotNo());
        if (p.getPlotArea() != null) bits.add("admeasuring " + num(p.getPlotArea()) + " " + unit(p.getAreaUnit()));
        if (p.getSiteAddress() != null || p.getCity() != null) {
            bits.add("situated at " + String.join(", ", java.util.stream.Stream.of(p.getSiteAddress(), p.getCity()).filter(Objects::nonNull).toList()));
        }
        return bits.isEmpty() ? "described in the particulars" : String.join(", ", bits);
    }

    private static List<String[]> siteRows(ConstructionProject p) {
        List<String[]> rows = new ArrayList<>();
        rows.add(row("Property", String.join(", ", java.util.stream.Stream.of(p.getSiteAddress(), p.getCity()).filter(Objects::nonNull).toList())));
        if (p.getSurveyNo() != null || p.getPlotNo() != null) {
            rows.add(row("Survey / plot No.", java.util.stream.Stream.of(p.getSurveyNo() != null ? "Sy. No. " + p.getSurveyNo() : null,
                    p.getPlotNo() != null ? "Plot No. " + p.getPlotNo() : null).filter(Objects::nonNull).collect(Collectors.joining(" · "))));
        }
        if (p.getPlotArea() != null) rows.add(row("Extent", num(p.getPlotArea()) + " " + unit(p.getAreaUnit())));
        if (p.getBoundaries() != null) rows.add(row("Boundaries", p.getBoundaries()));
        return rows;
    }

    private static String building(ConstructionProject p) {
        String s = "";
        if (p.getFloors() != null && p.getFloors() > 0) s += " of " + p.getFloors() + " floor" + (p.getFloors() == 1 ? "" : "s");
        if (p.getBuiltUpArea() != null) s += " with a built-up area of about " + num(p.getBuiltUpArea()) + " square feet";
        return s;
    }

    private static String buildingRow(ConstructionProject p) {
        String s = building(p).trim();
        return s.isEmpty() ? "as per the approved plan" : s.replaceFirst("^of ", "").replaceFirst("^with ", "");
    }

    private static List<String[]> unitRows(ConstructionUnit u) {
        List<String[]> rows = new ArrayList<>();
        if (u == null) return rows;
        rows.add(row("Apartment", "No. " + ConstructionService.unitLabel(u) + (u.getFloor() != null ? ", " + floorName(u.getFloor()) : "")
                + (u.getUnitType() != null ? ", " + u.getUnitType() : "") + (u.getFacing() != null ? ", " + u.getFacing() + " facing" : "")));
        if (u.getCarpetArea() != null) rows.add(row("Carpet area", num(u.getCarpetArea()) + " sq ft"));
        if (u.getBuiltUpArea() != null) rows.add(row("Built-up area", num(u.getBuiltUpArea()) + " sq ft"));
        if (u.getSuperArea() != null) rows.add(row("Super built-up area", num(u.getSuperArea()) + " sq ft"));
        if (u.getParking() != null) rows.add(row("Car parking", u.getParking()));
        return rows;
    }

    private static String floorName(int floor) {
        if (floor == 0) return "ground floor";
        if (floor < 0) return "basement " + (-floor);
        int v = floor % 100;
        String suffix = v >= 11 && v <= 13 ? "th" : switch (floor % 10) { case 1 -> "st"; case 2 -> "nd"; case 3 -> "rd"; default -> "th"; };
        return floor + suffix + " floor";
    }

    private static String lateRow(BigDecimal rate, Integer grace) {
        return rate == null ? "none" : pct(rate) + "% a month" + (grace != null && grace > 0 ? " after " + grace + " days" : "");
    }

    private static String grace(Integer days) {
        return days != null && days > 0 ? " after a grace period of " + days + " days" : "";
    }

    static String[] row(String k, String v) {
        return new String[]{k, v == null || v.isBlank() ? "—" : v};
    }

    /** Rupees in the Indian way, as deeds write them: ₹12,34,567 (paise only when there are any). */
    static String money(BigDecimal v) {
        BigDecimal x = Money.round(Money.nz(v));
        boolean negative = x.signum() < 0;
        x = x.abs();
        String whole = x.setScale(0, RoundingMode.DOWN).toPlainString();
        int paise = x.subtract(x.setScale(0, RoundingMode.DOWN)).movePointRight(2).intValue();
        StringBuilder b = new StringBuilder();
        int n = whole.length();
        if (n <= 3) {
            b.append(whole);
        } else {
            String head = whole.substring(0, n - 3);
            for (int i = 0; i < head.length(); i++) {
                if (i > 0 && (head.length() - i) % 2 == 0) b.append(',');
                b.append(head.charAt(i));
            }
            b.append(',').append(whole.substring(n - 3));
        }
        return (negative ? "-" : "") + "₹" + b + (paise > 0 ? String.format(".%02d", paise) : "");
    }

    /** "Rupees Twelve Lakh only". */
    static String words(BigDecimal v) {
        return HostedChitService.inWords(Money.nz(v));
    }

    static String day(LocalDate d) {
        return d == null ? "____________" : d.format(DAY);
    }

    static String pct(BigDecimal v) {
        return v == null ? "0" : v.stripTrailingZeros().toPlainString();
    }

    private static String num(BigDecimal v) {
        return v.stripTrailingZeros().toPlainString();
    }

    private static String unit(String u) {
        return switch (Objects.toString(u, "SQ_YD")) {
            case "SQ_FT" -> "square feet";
            case "SQ_M" -> "square metres";
            case "ACRE" -> "acres";
            case "GUNTA" -> "guntas";
            default -> "square yards";
        };
    }

    private static String names(List<String> names) {
        if (names.size() <= 1) return String.join("", names);
        return String.join(", ", names.subList(0, names.size() - 1)) + " and " + names.getLast();
    }

    private static String numberWords(int n) {
        return HostedChitService.inWords(BigDecimal.valueOf(n)).replaceFirst("(?i)^rupees\\s+", "").replaceFirst("(?i)\\s+only$", "").toLowerCase();
    }
}
