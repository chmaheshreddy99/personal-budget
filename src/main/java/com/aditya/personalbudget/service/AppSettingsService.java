package com.aditya.personalbudget.service;

import com.aditya.personalbudget.config.BudgetProperties;
import com.aditya.personalbudget.exception.BusinessException;
import com.aditya.personalbudget.storage.StorageException;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.io.Reader;
import java.io.Writer;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.util.Locale;
import java.util.Properties;
import java.util.Set;

/**
 * Settings of the whole installation, kept in {@code data/app-settings.properties} and read from the file
 * every time (nothing is held in memory, so a change is seen at once):
 * <ul>
 *   <li>{@code mobile.path}: the address of the mobile version, e.g. {@code m} for {@code https://host/m}.</li>
 *   <li>{@code approval.enabled}: maker-checker anywhere on the installation ({@code true} when missing); when
 *       {@code false} nothing waits for approval, whatever the households, users or links say.</li>
 * </ul>
 */
@Service
public class AppSettingsService {

    public static final String DEFAULT_MOBILE_PATH = "m";

    /** First path segments the app already uses: the mobile version cannot live there. */
    private static final Set<String> RESERVED = Set.of("api", "css", "js", "img", "fonts", "assets", "static",
            "index.html", "mobile.html", "favicon.ico", "error", "actuator");

    public record AppSettings(String mobilePath) {
    }

    /** What the phone app may do and show, set per household from Settings › Mobile app on the web. */
    public static final java.util.List<String> MOBILE_FEATURES = java.util.List.of("EXPENSES", "INCOME", "TRANSFERS", "ACCOUNTS", "CHITS", "CLAIMS", "EMIS", "GIFTS");

    /**
     * features: the sections the app offers (an off section is hidden in the app and refused when the phone syncs it).
     * hideBalances: balances show as dots until the person taps to view them. maskNetWorth: the total across all accounts is
     * never shown in the app. hideAbove: a balance above this amount (when set) stays hidden even after "view balances", until it is
     * tapped by itself. This is a privacy screen for the phone (shoulder-surfing, a handed-over phone), not access control:
     * the server still sends the figures to a signed-in app.
     */
    public record MobileConfig(java.util.Set<String> features, boolean hideBalances, boolean maskNetWorth, java.math.BigDecimal hideAbove) {
    }

    /** The yearly rate (percent) set for a household as "what my money could have earned", or null when none is set. */
    public java.math.BigDecimal claimBenchmark(Long tenantId) {
        String v = read().getProperty("claims." + tenantId + ".benchmark-rate");
        try {
            return v == null || v.isBlank() ? null : new java.math.BigDecimal(v.trim());
        } catch (NumberFormatException e) {
            return null;
        }
    }

    public synchronized void saveClaimBenchmark(Long tenantId, java.math.BigDecimal rate) {
        Properties p = read();
        if (rate == null || rate.signum() <= 0) p.remove("claims." + tenantId + ".benchmark-rate");
        else p.setProperty("claims." + tenantId + ".benchmark-rate", rate.min(java.math.BigDecimal.valueOf(40)).toPlainString());
        write(p);
    }

    public MobileConfig mobileConfig(Long tenantId) {
        Properties p = read();
        String key = "mobile." + tenantId + ".";
        java.util.Set<String> on = new java.util.LinkedHashSet<>();
        String stored = p.getProperty(key + "features");
        if (stored == null) on.addAll(MOBILE_FEATURES);
        else for (String f : stored.split(",")) if (MOBILE_FEATURES.contains(f.trim())) on.add(f.trim());
        java.math.BigDecimal above = null;
        try {
            String a = p.getProperty(key + "hide-above");
            if (a != null && !a.isBlank()) above = new java.math.BigDecimal(a.trim());
        } catch (NumberFormatException e) {
            above = null;
        }
        return new MobileConfig(on, Boolean.parseBoolean(p.getProperty(key + "hide-balances", "true")),
                Boolean.parseBoolean(p.getProperty(key + "mask-net-worth", "false")), above != null && above.signum() > 0 ? above : null);
    }

    public synchronized MobileConfig saveMobileConfig(Long tenantId, MobileConfig c) {
        Properties p = read();
        String key = "mobile." + tenantId + ".";
        p.setProperty(key + "features", c.features() == null ? "" : c.features().stream().filter(MOBILE_FEATURES::contains).collect(java.util.stream.Collectors.joining(",")));
        p.setProperty(key + "hide-balances", String.valueOf(c.hideBalances()));
        p.setProperty(key + "mask-net-worth", String.valueOf(c.maskNetWorth()));
        if (c.hideAbove() != null && c.hideAbove().signum() > 0) p.setProperty(key + "hide-above", c.hideAbove().toPlainString());
        else p.remove(key + "hide-above");
        write(p);
        return mobileConfig(tenantId);
    }

    private final Path file;

    public AppSettingsService(BudgetProperties properties) {
        this.file = Path.of(properties.dataDir()).resolve("app-settings.properties");
    }

    public AppSettings get() {
        Properties p = read();
        String path = p.getProperty("mobile.path", DEFAULT_MOBILE_PATH);
        return new AppSettings(valid(path) ? path : DEFAULT_MOBILE_PATH);
    }

    public synchronized AppSettings update(AppSettings settings) {
        String path = settings.mobilePath() == null ? "" : settings.mobilePath().trim().replaceAll("^/+|/+$", "").toLowerCase(Locale.ROOT);
        if (!valid(path)) {
            throw new BusinessException("Use 1-30 lowercase letters, digits or hyphens for the mobile address, and not one the app already uses ("
                    + String.join(", ", RESERVED.stream().filter(r -> !r.contains(".")).sorted().toList()) + ")");
        }
        Properties p = read();
        p.setProperty("mobile.path", path);
        write(p);
        return get();
    }

    /** Maker-checker is allowed on this installation (households then decide for themselves). */
    public boolean approvalEnabled() {
        return !"false".equalsIgnoreCase(read().getProperty("approval.enabled", "true").trim());
    }

    public synchronized boolean setApprovalEnabled(boolean enabled) {
        Properties p = read();
        p.setProperty("approval.enabled", String.valueOf(enabled));
        write(p);
        return approvalEnabled();
    }

    /**
     * The secret that seals receipts (HMAC-SHA256), made on first use. It stays on this installation: anyone holding
     * a receipt can have it checked here, nobody can forge a seal without it.
     */
    public byte[] receiptSigningKey() {
        return secretKey("receipt.signing-key");
    }

    /**
     * The key pair that digitally signs the payment details on chit members' links (ECDSA P-256 with SHA-256), made on
     * first use. The private key never leaves this installation; the public key goes with each link, so the member's
     * browser can check the signature itself, and its fingerprint can be compared with the one the organiser gives out.
     */
    public synchronized java.security.KeyPair payLinkKeyPair() {
        java.security.KeyPair external = externalKeyPair();
        if (external != null) {
            remember(external.getPublic());
            return external;
        }
        Properties p = read();
        String priv = p.getProperty("paylink.signing-private");
        String pub = p.getProperty("paylink.signing-public");
        try {
            java.security.KeyFactory kf = java.security.KeyFactory.getInstance("EC");
            if (priv == null || pub == null || priv.isBlank() || pub.isBlank()) {
                java.security.KeyPairGenerator g = java.security.KeyPairGenerator.getInstance("EC");
                g.initialize(new java.security.spec.ECGenParameterSpec("secp256r1"), new java.security.SecureRandom());
                java.security.KeyPair pair = g.generateKeyPair();
                p.setProperty("paylink.signing-private", java.util.Base64.getEncoder().encodeToString(pair.getPrivate().getEncoded()));
                p.setProperty("paylink.signing-public", java.util.Base64.getEncoder().encodeToString(pair.getPublic().getEncoded()));
                write(p);
                remember(pair.getPublic());
                return pair;
            }
            java.security.KeyPair loaded = new java.security.KeyPair(
                    kf.generatePublic(new java.security.spec.X509EncodedKeySpec(java.util.Base64.getDecoder().decode(pub.trim()))),
                    kf.generatePrivate(new java.security.spec.PKCS8EncodedKeySpec(java.util.Base64.getDecoder().decode(priv.trim()))));
            remember(loaded.getPublic());
            return loaded;
        } catch (java.security.GeneralSecurityException e) {
            throw new IllegalStateException("Cannot load the payment-link signing key", e);
        }
    }

    // ---------------------------------------------------------------- keys that outlive the machine

    /**
     * The signing key supplied from outside, so a record signed on one machine is still signed by "the same installation"
     * after the application is moved, rebuilt or run in a container with no data directory of its own: environment variables
     * PB_SIGNING_PRIVATE_KEY (PKCS#8, Base64) and PB_SIGNING_PUBLIC_KEY (X.509, Base64), or the system properties
     * {@code budget.signing.private-key} / {@code budget.signing.public-key}. Null when not given.
     */
    private java.security.KeyPair externalKeyPair() {
        String priv = System.getProperty("budget.signing.private-key", System.getenv("PB_SIGNING_PRIVATE_KEY"));
        String pub = System.getProperty("budget.signing.public-key", System.getenv("PB_SIGNING_PUBLIC_KEY"));
        if (priv == null || pub == null || priv.isBlank() || pub.isBlank()) return null;
        try {
            java.security.KeyFactory kf = java.security.KeyFactory.getInstance("EC");
            return new java.security.KeyPair(
                    kf.generatePublic(new java.security.spec.X509EncodedKeySpec(java.util.Base64.getDecoder().decode(pub.trim()))),
                    kf.generatePrivate(new java.security.spec.PKCS8EncodedKeySpec(java.util.Base64.getDecoder().decode(priv.trim()))));
        } catch (java.security.GeneralSecurityException | IllegalArgumentException e) {
            throw new IllegalStateException("The signing key given in PB_SIGNING_PRIVATE_KEY / PB_SIGNING_PUBLIC_KEY is not a valid P-256 key pair", e);
        }
    }

    private Path keyRing() {
        return file.resolveSibling("signing").resolve("public-keys.properties");
    }

    private final java.util.Set<String> remembered = java.util.concurrent.ConcurrentHashMap.newKeySet();

    /**
     * Keeps every public key this installation has ever signed with, next to the data (signing/public-keys.properties), so
     * the key that signed a record can always be found again, also after the key is replaced. Public keys are not secret.
     */
    private void remember(java.security.PublicKey key) {
        String b64 = java.util.Base64.getEncoder().encodeToString(key.getEncoded());
        if (!remembered.add(b64)) return;
        try {
            Properties ring = new Properties();
            Path path = keyRing();
            if (Files.exists(path)) {
                try (Reader in = Files.newBufferedReader(path, StandardCharsets.UTF_8)) { ring.load(in); }
            }
            String id = fingerprintOf(b64).replace(" ", "");
            if (b64.equals(ring.getProperty(id))) return;
            ring.setProperty(id, b64);
            Files.createDirectories(path.getParent());
            Path temp = path.resolveSibling(path.getFileName() + ".tmp");
            try (Writer out = Files.newBufferedWriter(temp, StandardCharsets.UTF_8)) { ring.store(out, "Public keys that signed records (not secret)"); }
            Files.move(temp, path, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
        } catch (IOException e) {
            // the ring is a convenience copy: the key is also in the settings file, and in every record's evidence bundle
        }
    }

    /** Every public key (Base64) this installation has signed with, the current one first. */
    public java.util.List<String> signingKeys() {
        java.util.List<String> keys = new java.util.ArrayList<>();
        keys.add(payLinkPublicKey());
        try {
            Path path = keyRing();
            if (Files.exists(path)) {
                Properties ring = new Properties();
                try (Reader in = Files.newBufferedReader(path, StandardCharsets.UTF_8)) { ring.load(in); }
                ring.values().forEach(v -> { if (!keys.contains(v.toString())) keys.add(v.toString()); });
            }
        } catch (IOException e) {
            // the current key alone then
        }
        return keys;
    }

    /**
     * The public key that made this signature over this text, found among the keys ever used, so a record verifies against
     * its own key and not against whatever key the installation uses now. The current key when none matches (or when there is
     * no signature yet).
     */
    public String publicKeyFor(String text, String signature) {
        if (text != null && signature != null) {
            for (String candidate : signingKeys()) {
                try {
                    java.security.Signature sig = java.security.Signature.getInstance("SHA256withECDSAinP1363Format");
                    sig.initVerify(java.security.KeyFactory.getInstance("EC").generatePublic(
                            new java.security.spec.X509EncodedKeySpec(java.util.Base64.getDecoder().decode(candidate))));
                    sig.update(text.getBytes(StandardCharsets.UTF_8));
                    if (sig.verify(java.util.Base64.getDecoder().decode(signature.trim()))) return candidate;
                } catch (java.security.GeneralSecurityException | IllegalArgumentException e) {
                    // not this one
                }
            }
        }
        return payLinkPublicKey();
    }

    /** The short fingerprint of any public key (X.509, Base64): SHA-256, first 10 bytes, in groups of four. */
    public static String fingerprintOf(String publicKeyBase64) {
        try {
            byte[] h = java.security.MessageDigest.getInstance("SHA-256").digest(java.util.Base64.getDecoder().decode(publicKeyBase64.trim()));
            return java.util.HexFormat.of().withUpperCase().formatHex(h, 0, 10).replaceAll("(.{4})(?!$)", "$1 ");
        } catch (java.security.GeneralSecurityException e) {
            throw new IllegalStateException(e);
        }
    }

    /** The key that signed this record, and its fingerprint (see {@link #publicKeyFor}). */
    public String fingerprintFor(String text, String signature) {
        return fingerprintOf(publicKeyFor(text, signature));
    }

    /** The public key (X.509 SubjectPublicKeyInfo, Base64), as browsers import it. */
    public String payLinkPublicKey() {
        return java.util.Base64.getEncoder().encodeToString(payLinkKeyPair().getPublic().getEncoded());
    }

    /** A short fingerprint of the public key, e.g. "3F9A 0C21 7B44 E1D0 5A6C": SHA-256 of the key, first 10 bytes. */
    public String payLinkFingerprint() {
        try {
            byte[] h = java.security.MessageDigest.getInstance("SHA-256").digest(payLinkKeyPair().getPublic().getEncoded());
            String hex = java.util.HexFormat.of().withUpperCase().formatHex(h, 0, 10);
            return hex.replaceAll("(.{4})(?!$)", "$1 ");
        } catch (java.security.GeneralSecurityException e) {
            throw new IllegalStateException(e);
        }
    }

    /** Signs the text (UTF-8) with the private key: the signature as r||s (64 bytes, as WebCrypto expects), Base64. */
    public String signPayLink(String text) {
        try {
            java.security.Signature sig = java.security.Signature.getInstance("SHA256withECDSAinP1363Format");
            sig.initSign(payLinkKeyPair().getPrivate());
            sig.update(text.getBytes(StandardCharsets.UTF_8));
            return java.util.Base64.getEncoder().encodeToString(sig.sign());
        } catch (java.security.GeneralSecurityException e) {
            throw new IllegalStateException(e);
        }
    }

    /** Whether the signature is this installation's, over exactly this text. */
    public boolean verifyPayLink(String text, String signature) {
        if (text == null || signature == null) {
            return false;
        }
        try {
            java.security.Signature sig = java.security.Signature.getInstance("SHA256withECDSAinP1363Format");
            sig.initVerify(payLinkKeyPair().getPublic());
            sig.update(text.getBytes(StandardCharsets.UTF_8));
            return sig.verify(java.util.Base64.getDecoder().decode(signature.trim()));
        } catch (IllegalArgumentException | java.security.GeneralSecurityException e) {
            return false;
        }
    }

    /** A 256-bit secret of this installation under the given name, made on first use and kept in the settings file. */
    public synchronized byte[] secretKey(String name) {
        Properties p = read();
        String key = p.getProperty(name);
        if (key == null || key.isBlank()) {
            byte[] bytes = new byte[32];
            new java.security.SecureRandom().nextBytes(bytes);
            key = java.util.HexFormat.of().formatHex(bytes);
            p.setProperty(name, key);
            write(p);
        }
        return java.util.HexFormat.of().parseHex(key.trim());
    }

    public static boolean valid(String path) {
        return path != null && path.matches("[a-z0-9][a-z0-9-]{0,29}") && !RESERVED.contains(path);
    }

    private Properties read() {
        Properties p = new Properties();
        if (Files.exists(file)) {
            try (Reader in = Files.newBufferedReader(file, StandardCharsets.UTF_8)) {
                p.load(in);
            } catch (IOException e) {
                throw new StorageException("Cannot read " + file, e);
            }
        }
        return p;
    }

    private void write(Properties p) {
        try {
            Files.createDirectories(file.getParent());
            Path temp = file.resolveSibling(file.getFileName() + ".tmp");
            try (Writer out = Files.newBufferedWriter(temp, StandardCharsets.UTF_8)) {
                p.store(out, "Personal Budget settings");
            }
            Files.move(temp, file, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
        } catch (IOException e) {
            throw new StorageException("Cannot write " + file, e);
        }
    }
}
