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
                return pair;
            }
            return new java.security.KeyPair(
                    kf.generatePublic(new java.security.spec.X509EncodedKeySpec(java.util.Base64.getDecoder().decode(pub.trim()))),
                    kf.generatePrivate(new java.security.spec.PKCS8EncodedKeySpec(java.util.Base64.getDecoder().decode(priv.trim()))));
        } catch (java.security.GeneralSecurityException e) {
            throw new IllegalStateException("Cannot load the payment-link signing key", e);
        }
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
