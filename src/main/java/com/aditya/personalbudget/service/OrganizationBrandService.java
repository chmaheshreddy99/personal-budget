package com.aditya.personalbudget.service;

import com.aditya.personalbudget.domain.entity.Organization;
import com.aditya.personalbudget.exception.BusinessException;
import com.aditya.personalbudget.exception.NotFoundException;
import com.aditya.personalbudget.repository.OrganizationRepository;
import com.aditya.personalbudget.security.UserContext;
import jakarta.validation.constraints.Size;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.Base64;
import java.util.HexFormat;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * The organization's company name and logo: the web app (top bar, footer, sign-in, browser tab), its mobile version
 * and the Bricks phone app show them in place of "Personal Budget", and bills and slips carry the logo. An admin sets
 * them (Settings → Organization).
 * <p>
 * The logo is kept in the organization's row as a small data URL. It is served as an image at
 * {@code /api/meta/brand-logo/{organization}/{hash}}: no sign-in is needed (an {@code <img>} or the phone's image
 * loader sends no token, and the sign-in page shows the logo seen last), and the hash of the image in the address
 * means it is only found by those who were given it, and can be cached for good, since a new logo has a new address.
 */
@Service
public class OrganizationBrandService {

    /** The longest data URL kept: a 256 px logo is far smaller; a table cell (Google Sheets) holds 50,000 characters. */
    static final int MAX_LOGO = 45_000;

    private static final Pattern DATA_URL = Pattern.compile("data:(image/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)");

    public record Brand(String name, String logo) {
    }

    /**
     * A change: the name (empty: the app's own name) and the logo, a new one as a data URL; {@code removeLogo} drops
     * it, and with neither the logo stays as it is.
     */
    public record BrandRequest(@Size(max = 60) String name, @Size(max = MAX_LOGO) String logo, Boolean removeLogo) {
    }

    public record Logo(byte[] bytes, String contentType) {
    }

    private final OrganizationRepository tenants;
    private final ActivityService activity;

    public OrganizationBrandService(OrganizationRepository tenants, ActivityService activity) {
        this.tenants = tenants;
        this.activity = activity;
    }

    /** The company name to show, or null for the app's own. */
    public static String name(Organization t) {
        return t.getBrandName() == null || t.getBrandName().isBlank() ? null : t.getBrandName().trim();
    }

    /** Where the logo is (an address on this server), or null without one. */
    public static String logoUrl(Organization t) {
        String logo = t.getBrandLogo();
        return logo == null || logo.isBlank() ? null : "/api/meta/brand-logo/" + t.getId() + "/" + hash(logo);
    }

    public static Brand of(Organization t) {
        return new Brand(name(t), logoUrl(t));
    }

    public Brand current() {
        return of(tenant());
    }

    @Transactional
    public Brand save(BrandRequest r) {
        Organization t = tenant();
        String name = r.name() == null ? null : r.name().trim().replaceAll("\\s+", " ");
        if (name != null && name.isEmpty()) name = null;
        if (name != null && !name.matches("[\\p{L}\\p{N} .,&'()/-]{2,60}")) {
            throw new BusinessException("The company name can have letters, digits, spaces and . , & ' ( ) / - (2 to 60)");
        }
        boolean nameChanged = !java.util.Objects.equals(name, name(t));
        t.setBrandName(name);
        String logoChange = null;
        if (Boolean.TRUE.equals(r.removeLogo())) {
            if (t.getBrandLogo() != null) logoChange = "removed the logo";
            t.setBrandLogo(null);
        } else if (r.logo() != null && !r.logo().isBlank()) {
            String logo = r.logo().trim();
            decode(logo);
            if (!logo.equals(t.getBrandLogo())) logoChange = "a new logo";
            t.setBrandLogo(logo);
        }
        tenants.save(t);
        if (nameChanged || logoChange != null) {
            String what = nameChanged ? (name == null ? "Company name cleared" : "Company name · " + name) : "Company";
            activity.record("CHANGED", "Organization", logoChange == null ? what : what + " · " + logoChange);
        }
        return of(t);
    }

    /** The logo of an organization, when the hash is that of its logo today. */
    public Logo logo(Long tenantId, String hash) {
        Organization t = tenants.findById(tenantId).filter(o -> o.getBrandLogo() != null && hash(o.getBrandLogo()).equals(hash))
                .orElseThrow(() -> new NotFoundException("Logo", tenantId));
        return decode(t.getBrandLogo());
    }

    /** The image in a data URL: a PNG, JPEG or WebP (checked by its first bytes, whatever the URL says). */
    static Logo decode(String dataUrl) {
        if (dataUrl.length() > MAX_LOGO) throw new BusinessException("The logo is too large; choose a smaller image");
        Matcher m = DATA_URL.matcher(dataUrl);
        if (!m.matches()) throw new BusinessException("The logo must be a PNG, JPEG or WebP image");
        byte[] bytes;
        try {
            bytes = Base64.getDecoder().decode(m.group(2));
        } catch (IllegalArgumentException e) {
            throw new BusinessException("The logo could not be read; choose the image again");
        }
        String type = m.group(1);
        boolean png = bytes.length > 8 && (bytes[0] & 0xff) == 0x89 && bytes[1] == 'P' && bytes[2] == 'N' && bytes[3] == 'G';
        boolean jpeg = bytes.length > 3 && (bytes[0] & 0xff) == 0xff && (bytes[1] & 0xff) == 0xd8;
        boolean webp = bytes.length > 12 && new String(bytes, 0, 4, StandardCharsets.US_ASCII).equals("RIFF")
                && new String(bytes, 8, 4, StandardCharsets.US_ASCII).equals("WEBP");
        if (!(type.equals("image/png") ? png : type.equals("image/jpeg") ? jpeg : webp)) {
            throw new BusinessException("The logo must be a PNG, JPEG or WebP image");
        }
        return new Logo(bytes, type);
    }

    static String hash(String logo) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(logo.getBytes(StandardCharsets.UTF_8)), 0, 8);
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }

    private Organization tenant() {
        return tenants.findById(UserContext.tenantId()).orElseThrow(() -> new NotFoundException("Organization", UserContext.tenantId()));
    }
}
