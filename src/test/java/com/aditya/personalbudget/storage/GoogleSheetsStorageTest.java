package com.aditya.personalbudget.storage;

import com.aditya.personalbudget.domain.entity.AppUser;
import com.aditya.personalbudget.domain.entity.Organization;
import com.aditya.personalbudget.domain.type.UserRole;
import com.aditya.personalbudget.repository.AppUserRepository;
import com.aditya.personalbudget.repository.OrganizationRepository;
import jakarta.validation.Validation;
import jakarta.validation.Validator;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Path;
import java.time.LocalDateTime;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * The data store on a Google spreadsheet (an in-memory fake of the Sheets API): same repositories, same rules, the
 * rows kept as one tab per table.
 */
class GoogleSheetsStorageTest {

    @TempDir
    Path dataDir;

    private final Validator validator = Validation.buildDefaultValidatorFactory().getValidator();
    private FakeSheetsApi api;
    private GoogleSheetsStorage storage;
    private TsvDataStore store;
    private OrganizationRepository tenants;
    private AppUserRepository users;

    @BeforeEach
    void setUp() {
        api = new FakeSheetsApi();
        open();
    }

    /** A fresh app on the same spreadsheet. */
    private void open() {
        storage = new GoogleSheetsStorage(api.client(), "sheet-1", "budget@test.iam.gserviceaccount.com");
        store = new TsvDataStore(dataDir, storage, validator);
        tenants = new OrganizationRepository(store);
        users = new AppUserRepository(store);
    }

    private static Organization tenant(String code) {
        Organization t = new Organization();
        t.setCode(code);
        t.setName("Organization " + code);
        t.setCurrency("INR");
        t.setActive(true);
        t.setCreatedAt(LocalDateTime.of(2026, 10, 19, 9, 30));
        return t;
    }

    private static AppUser user(Long tenantId, String username) {
        AppUser u = new AppUser();
        u.setTenantId(tenantId);
        u.setUsername(username);
        u.setFullName("User " + username);
        u.setPasswordHash("hash");
        u.setRole(UserRole.ADMIN);
        u.setActive(true);
        u.setCreatedAt(LocalDateTime.now());
        return u;
    }

    @Test
    void addsOneTabPerTableWithAFrozenHeaderRow() {
        tenants.count();
        assertThat(api.tabs).containsKeys("organizations", "app_users", GoogleSheetsStorage.SEQUENCES);
        FakeSheetsApi.Tab tab = api.tabs.get("organizations");
        assertThat(tab.cells.getFirst()).startsWith("id", "code", "name", "currency");
        assertThat(tab.frozenRows).isEqualTo(1);
        assertThat(api.tabs.get("Sheet1").cells).isEmpty();   // other tabs are left alone
    }

    @Test
    void savesRowsAndIdsToTheSpreadsheetAndReadsThemBack() {
        Organization home = tenants.save(tenant("home"));
        users.save(user(home.getId(), "admin"));

        FakeSheetsApi.Tab tab = api.tabs.get("organizations");
        assertThat(tab.cell(1, 0)).isEqualTo("1");
        assertThat(tab.cell(1, 1)).isEqualTo("home");
        assertThat(tab.cell(1, 5)).isEqualTo("2026-10-19T09:30");
        assertThat(api.tabs.get(GoogleSheetsStorage.SEQUENCES).cells)
                .contains(List.of("app_users", "1"), List.of("organizations", "1"));

        open();   // a restarted app
        assertThat(tenants.findByCode("home")).isPresent();
        assertThat(users.findAll()).extracting(AppUser::getUsername).containsExactly("admin");
        assertThat(tenants.save(tenant("next")).getId()).isEqualTo(2L);
    }

    @Test
    void oneCommitIsOneFreshReadAndOneWriteCall() {
        tenants.count();
        api.calls.clear();
        store.begin();
        Organization home = tenants.save(tenant("home"));
        users.save(user(home.getId(), "anna"));
        users.save(user(home.getId(), "bala"));
        store.commit();
        assertThat(api.calls).containsExactly("batchGet", "values.batchUpdate");
    }

    @Test
    void keepsLineBreaksAndTabsAsRealCharactersInTheCell() {
        Organization t = tenant("esc");
        t.setName("Line one\tand\nline two \\ done");
        tenants.save(t);

        assertThat(api.tabs.get("organizations").cell(1, 2)).isEqualTo("Line one\tand\nline two \\ done");
        open();
        assertThat(tenants.findByCode("esc").orElseThrow().getName()).isEqualTo("Line one\tand\nline two \\ done");
    }

    @Test
    void aDeletedRowLeavesNothingBehindInTheTab() {
        tenants.save(tenant("one"));
        Organization two = tenants.save(tenant("two"));
        tenants.deleteById(two.getId());

        assertThat(api.tabs.get("organizations").cell(2, 0)).isEmpty();
        assertThat(api.tabs.get("organizations").cell(2, 1)).isEmpty();
        open();
        assertThat(tenants.findAll()).extracting(Organization::getCode).containsExactly("one");
    }

    @Test
    void growsATabThatIsTooSmall() {
        api = new FakeSheetsApi();
        api.addTab("organizations", 2, 3);   // made by hand: two rows, three columns
        open();

        for (String code : List.of("aa", "bb", "cc", "dd")) {
            tenants.save(tenant(code));
        }
        FakeSheetsApi.Tab tab = api.tabs.get("organizations");
        assertThat(tab.rows).isGreaterThan(5);
        assertThat(tab.cols).isGreaterThanOrEqualTo(10);
        open();
        assertThat(tenants.count()).isEqualTo(4);
    }

    @Test
    void rollbackWritesNothing() {
        tenants.count();
        api.calls.clear();
        store.begin();
        tenants.save(tenant("home"));
        store.rollback();
        assertThat(api.calls).doesNotContain("values.batchUpdate");
        assertThat(tenants.count()).isZero();
    }

    @Test
    void enforcesTheSameConstraintsAsTheFiles() {
        Organization home = tenants.save(tenant("home"));
        assertThatThrownBy(() -> tenants.save(tenant("home")))
                .isInstanceOf(DataIntegrityException.class).hasMessageContaining("unique key (code)");
        assertThatThrownBy(() -> users.save(user(99L, "ghost")))
                .isInstanceOf(DataIntegrityException.class).hasMessageContaining("refers to missing Organization #99");
        users.save(user(home.getId(), "admin"));
        assertThatThrownBy(() -> tenants.deleteById(home.getId()))
                .isInstanceOf(DataIntegrityException.class).hasMessageContaining("still referenced");
    }

    /** The app on the same spreadsheet, its shared copy read again after {@code refresh} and not used after {@code maxAge}. */
    private void open(java.time.Duration refresh, java.time.Duration maxAge) {
        storage = new GoogleSheetsStorage(api.client(), "sheet-1", "budget@test.iam.gserviceaccount.com", refresh, maxAge);
        store = new TsvDataStore(dataDir, storage, validator);
        tenants = new OrganizationRepository(store);
        users = new AppUserRepository(store);
    }

    @Test
    void readsComeFromTheSharedCopyAndASaveIsSeenAtOnceWithoutCallingGoogle() {
        tenants.save(tenant("home"));
        store.endRequest();
        api.calls.clear();

        // requests after the save: every table they read comes from the copy the save left, no call to Google
        assertThat(tenants.findAll()).hasSize(1);
        assertThat(users.findAll()).isEmpty();
        store.endRequest();
        assertThat(tenants.count()).isEqualTo(1);
        store.endRequest();
        assertThat(api.calls).isEmpty();

        // a save in one request is seen by the next at once, again without reading the spreadsheet for it
        tenants.save(tenant("next"));
        store.endRequest();
        api.calls.clear();
        assertThat(tenants.findAll()).extracting(Organization::getCode).containsExactly("home", "next");
        assertThat(api.calls).isEmpty();
    }

    @Test
    void aRequestSeesOneMomentEvenWhenASaveLandsMeanwhile() {
        tenants.save(tenant("home"));
        store.endRequest();
        assertThat(tenants.count()).isEqualTo(1);   // this request took the copy of this moment ...

        Thread other = new Thread(() -> { tenants.save(tenant("other")); store.endRequest(); });
        other.start();
        try { other.join(); } catch (InterruptedException e) { throw new AssertionError(e); }

        assertThat(tenants.count()).isEqualTo(1);   // ... and keeps it until it ends
        store.endRequest();
        assertThat(tenants.count()).isEqualTo(2);   // the next request sees the save
    }

    @Test
    void anEditMadeInTheSpreadsheetIsSeenOnceTheCopyIsReadAgain() throws Exception {
        open(java.time.Duration.ofMillis(50), java.time.Duration.ofMinutes(5));
        tenants.save(tenant("home"));
        store.endRequest();
        api.tabs.get("organizations").cells.get(1).set(2, "Renamed by hand");
        Thread.sleep(80);

        // older than the refresh time: this request still gets the copy at once, and it is read again in the background
        api.calls.clear();
        assertThat(tenants.findByCode("home").orElseThrow().getName()).isEqualTo("Organization home");
        store.endRequest();
        long until = System.currentTimeMillis() + 5000;
        while (!api.calls.contains("batchGet") && System.currentTimeMillis() < until) Thread.sleep(10);
        Thread.sleep(50);

        assertThat(tenants.findByCode("home").orElseThrow().getName()).isEqualTo("Renamed by hand");
    }

    @Test
    void afterTheAppSatIdleTheSpreadsheetIsReadBeforeTheCopyIsUsed() throws Exception {
        open(java.time.Duration.ofMillis(20), java.time.Duration.ofMillis(40));
        tenants.save(tenant("home"));
        store.endRequest();
        api.tabs.get("organizations").cells.get(1).set(2, "Renamed by hand");
        Thread.sleep(80);
        assertThat(tenants.findByCode("home").orElseThrow().getName()).isEqualTo("Renamed by hand");
    }

    @Test
    void requestsArrivingTogetherWaitForOneReading() throws Exception {
        tenants.save(tenant("home"));
        open();   // a restarted app: no copy yet
        api.calls.clear();
        int n = 8;
        java.util.concurrent.CountDownLatch go = new java.util.concurrent.CountDownLatch(1);
        java.util.concurrent.ExecutorService pool = java.util.concurrent.Executors.newFixedThreadPool(n);
        List<java.util.concurrent.Future<Long>> counts = new java.util.ArrayList<>();
        for (int i = 0; i < n; i++) {
            counts.add(pool.submit(() -> { go.await(); try { return tenants.count(); } finally { store.endRequest(); } }));
        }
        go.countDown();
        for (var c : counts) assertThat(c.get()).isEqualTo(1);
        pool.shutdown();
        assertThat(api.calls.stream().filter("batchGet"::equals).count()).isEqualTo(1);
    }

    @Test
    void aReadingOlderThanASaveNeverReplacesWhatTheSaveWrote() throws Exception {
        tenants.save(tenant("home"));
        open(java.time.Duration.ofMinutes(5), java.time.Duration.ofMinutes(5));   // a restarted app: no copy yet

        // a request reads the spreadsheet; before its answer arrives, another request saves
        api.afterNextRead = () -> {
            Thread saver = new Thread(() -> {
                storage.readFresh();
                List<List<String>> rows = new java.util.ArrayList<>(storage.read("organizations"));
                List<String> renamed = new java.util.ArrayList<>(rows.get(1));
                renamed.set(2, "Saved meanwhile");
                rows.set(1, renamed);
                storage.write(java.util.Map.of("organizations", rows), null);
                storage.forget();
            });
            saver.start();
            try { saver.join(); } catch (InterruptedException e) { throw new AssertionError(e); }
        };
        // the waiting request gets the newer moment: what the save wrote
        assertThat(tenants.findByCode("home").orElseThrow().getName()).isEqualTo("Saved meanwhile");
        store.endRequest();

        // and the shared copy is the save's, not the older reading's (served without asking Google)
        api.calls.clear();
        assertThat(tenants.findByCode("home").orElseThrow().getName()).isEqualTo("Saved meanwhile");
        assertThat(api.calls).isEmpty();
    }

    @Test
    void aSaveWorksOnWhatTheSpreadsheetHoldsNotOnAnEarlierRead() {
        Organization home = tenants.save(tenant("home"));
        store.endRequest();
        assertThat(tenants.findAll()).hasSize(1);          // read during this request ...
        api.tabs.get("organizations").cells.get(1).set(2, "Renamed by hand");
        int version = api.tabs.get("organizations").cells.get(0).indexOf("version");
        api.tabs.get("organizations").cells.get(1).set(version, "1");   // ... then changed in the spreadsheet (version 1)

        api.calls.clear();
        Organization stale = tenants.findById(home.getId()).orElseThrow();   // still this request's copy: version 0
        stale.setName("From a stale screen");
        assertThatThrownBy(() -> tenants.save(stale)).isInstanceOf(ConcurrentUpdateException.class);
        assertThat(api.calls).containsExactly("batchGet");   // the save read the spreadsheet afresh
    }

    @Test
    void importsTheTablesOfADataFolderIntoAnEmptySpreadsheet() {
        Path folder = dataDir.resolve("files");
        TsvDataStore files = new TsvDataStore(folder.toString(), validator);
        OrganizationRepository fileTenants = new OrganizationRepository(files);
        AppUserRepository fileUsers = new AppUserRepository(files);
        Organization home = fileTenants.save(tenant("home"));
        fileUsers.save(user(home.getId(), "admin"));
        fileTenants.save(tenant("office"));

        assertThat(storage.isEmpty()).isTrue();
        assertThat(storage.importFrom(new LocalFileStorage(folder))).isEqualTo(2);
        assertThat(storage.isEmpty()).isFalse();

        open();
        assertThat(tenants.findAll()).extracting(Organization::getCode).containsExactly("home", "office");
        assertThat(users.findAll()).extracting(AppUser::getUsername).containsExactly("admin");
        assertThat(tenants.save(tenant("next")).getId()).isEqualTo(3L);   // the id sequences came along
    }

    @Test
    void reportsHowMuchIsStored() {
        tenants.save(tenant("home"));
        TableStorage.Footprint footprint = store.footprint();
        assertThat(footprint.tables()).isEqualTo(2);
        assertThat(footprint.bytes()).isPositive();
    }
}
