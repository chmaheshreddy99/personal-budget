package com.aditya.personalbudget;

import com.aditya.personalbudget.domain.entity.AppUser;
import com.aditya.personalbudget.domain.entity.Organization;
import com.aditya.personalbudget.domain.type.Feature;
import com.aditya.personalbudget.domain.type.UserRole;
import com.aditya.personalbudget.exception.BusinessException;
import com.aditya.personalbudget.exception.NotFoundException;
import com.aditya.personalbudget.repository.AppUserRepository;
import com.aditya.personalbudget.repository.OrganizationRepository;
import com.aditya.personalbudget.security.CurrentUser;
import com.aditya.personalbudget.security.UserContext;
import com.aditya.personalbudget.service.AuthService;
import com.aditya.personalbudget.service.BrickAppService;
import com.aditya.personalbudget.service.BrickService;
import com.aditya.personalbudget.service.OrganizationBrandService;
import com.aditya.personalbudget.service.OrganizationBrandService.Brand;
import com.aditya.personalbudget.service.OrganizationBrandService.BrandRequest;
import com.aditya.personalbudget.web.MetaController;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.ResponseEntity;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

import javax.imageio.ImageIO;
import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Base64;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * The organization's company name and logo (Settings → Organization): kept, served at an address with its hash, and
 * given to the web app (who am I), the Bricks phone app (its profile) and the bills.
 */
@SpringBootTest
class OrganizationBrandTests {

    @DynamicPropertySource
    static void dataDirectory(DynamicPropertyRegistry registry) throws Exception {
        Path dir = Files.createTempDirectory("pb-brand-test-");
        registry.add("budget.data-dir", dir::toString);
        registry.add("budget.seed.demo-data", () -> "false");
    }

    @Autowired OrganizationRepository tenants;
    @Autowired AppUserRepository users;
    @Autowired OrganizationBrandService brand;
    @Autowired MetaController meta;
    @Autowired AuthService auth;
    @Autowired BrickAppService app;
    @Autowired BrickService bricks;

    Organization tenant;

    @BeforeEach
    void signIn() {
        AppUser admin = users.findByUsername("admin").orElseThrow();
        tenant = tenants.findById(admin.getTenantId()).orElseThrow();
        UserContext.set(new CurrentUser(admin.getId(), admin.getUsername(), admin.getFullName(), UserRole.ADMIN, tenant.getId(), tenant.getCode(),
                tenant.getName(), tenant.getCurrency(), Feature.all(), false, null, false));
        brand.save(new BrandRequest(null, null, true));
    }

    @AfterEach
    void signOut() {
        UserContext.clear();
    }

    @Test
    void theNameAndLogoAreKeptAndTheLogoIsServedAtItsOwnAddress() throws Exception {
        assertThat(brand.current()).isEqualTo(new Brand(null, null));

        String png = "data:image/png;base64," + Base64.getEncoder().encodeToString(png(64, 0x1a4b71));
        Brand saved = brand.save(new BrandRequest("  Sri  Sai Cement Bricks ", png, null));
        assertThat(saved.name()).isEqualTo("Sri Sai Cement Bricks");
        assertThat(saved.logo()).matches("/api/meta/brand-logo/" + tenant.getId() + "/[0-9a-f]{16}");

        String hash = saved.logo().substring(saved.logo().lastIndexOf('/') + 1);
        ResponseEntity<byte[]> served = meta.brandLogo(tenant.getId(), hash);
        assertThat(served.getHeaders().getContentType()).hasToString("image/png");
        assertThat(served.getHeaders().getCacheControl()).contains("immutable");
        assertThat(ImageIO.read(new java.io.ByteArrayInputStream(served.getBody())).getWidth()).isEqualTo(64);

        // only at the address given: another hash finds nothing
        assertThatThrownBy(() -> meta.brandLogo(tenant.getId(), "0000000000000000")).isInstanceOf(NotFoundException.class);

        // the name alone changes: the logo stays (same address); a new logo gets a new address, the old one is gone
        assertThat(brand.save(new BrandRequest("Sri Sai Cement Bricks", null, null)).logo()).isEqualTo(saved.logo());
        String other = "data:image/png;base64," + Base64.getEncoder().encodeToString(png(48, 0xe07a2f));
        String next = brand.save(new BrandRequest("Sri Sai Cement Bricks", other, null)).logo();
        assertThat(next).isNotEqualTo(saved.logo());
        assertThatThrownBy(() -> meta.brandLogo(tenant.getId(), hash)).isInstanceOf(NotFoundException.class);

        // removed: the app's own again
        assertThat(brand.save(new BrandRequest(null, null, true))).isEqualTo(new Brand(null, null));
    }

    @Test
    void onlyAPictureIsTakenAsTheLogo() {
        assertThatThrownBy(() -> brand.save(new BrandRequest(null, "data:image/svg+xml;base64,PHN2Zy8+", null)))
                .isInstanceOf(BusinessException.class);
        // says PNG, is not
        String fake = "data:image/png;base64," + Base64.getEncoder().encodeToString("<html>hello</html>".getBytes());
        assertThatThrownBy(() -> brand.save(new BrandRequest(null, fake, null))).isInstanceOf(BusinessException.class);
        assertThatThrownBy(() -> brand.save(new BrandRequest("<script>", null, null))).isInstanceOf(BusinessException.class);
    }

    @Test
    void theWebAppThePhoneAppAndTheBillsGetIt() throws Exception {
        String png = "data:image/png;base64," + Base64.getEncoder().encodeToString(png(32, 0x15395a));
        Brand saved = brand.save(new BrandRequest("Grey Blocks Co", png, null));

        var me = auth.me();
        assertThat(me.brandName()).isEqualTo("Grey Blocks Co");
        assertThat(me.brandLogo()).isEqualTo(saved.logo());

        bricks.start();
        var profile = app.profile();
        assertThat(profile.brandName()).isEqualTo("Grey Blocks Co");
        assertThat(profile.brandLogo()).isEqualTo(saved.logo());

        // the letterhead of bills and slips (what the documents are drawn from)
        java.lang.reflect.Method company = BrickService.class.getDeclaredMethod("company");
        company.setAccessible(true);
        BrickService.Company letterhead = (BrickService.Company) company.invoke(bricks);
        assertThat(letterhead.logo()).isEqualTo(saved.logo());
        assertThat(letterhead.name()).isEqualTo("Grey Blocks Co");   // no name set for the business: the company's
    }

    private static byte[] png(int size, int rgb) throws Exception {
        BufferedImage img = new BufferedImage(size, size, BufferedImage.TYPE_INT_ARGB);
        for (int x = 0; x < size; x++) for (int y = 0; y < size; y++) img.setRGB(x, y, 0xff000000 | rgb);
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        ImageIO.write(img, "png", out);
        return out.toByteArray();
    }
}
