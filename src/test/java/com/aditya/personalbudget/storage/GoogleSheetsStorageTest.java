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
import java.time.Duration;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicLong;

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

    @Test
    void theNextRequestSeesAnEditMadeInTheSpreadsheet() {
        tenants.save(tenant("home"));
        store.endRequest();
        api.tabs.get("organizations").cells.get(1).set(2, "Renamed by hand");
        assertThat(tenants.findByCode("home").orElseThrow().getName()).isEqualTo("Renamed by hand");
    }

    @Test
    void readsOncePerRequestAndKeepsNothingAfterIt() {
        tenants.save(tenant("home"));
        store.endRequest();
        api.calls.clear();

        // one request: every table it reads comes from one call
        assertThat(tenants.findAll()).hasSize(1);
        assertThat(users.findAll()).isEmpty();
        assertThat(tenants.count()).isEqualTo(1);
        assertThat(api.calls).containsExactly("batchGet");

        // the request ends: what it read is gone, the next one reads again
        store.endRequest();
        assertThat(tenants.findAll()).hasSize(1);
        assertThat(api.calls).containsExactly("batchGet", "batchGet");
    }

    @Test
    void aSaveWorksOnWhatTheSpreadsheetHoldsNotOnAnEarlierRead() {
        Organization home = tenants.save(tenant("home"));
        store.endRequest();
        assertThat(tenants.findAll()).hasSize(1);          // read during this request ...
        var cells = api.tabs.get("organizations").cells;
        cells.get(1).set(cells.getFirst().indexOf("name"), "Renamed by hand");
        cells.get(1).set(cells.getFirst().indexOf("version"), "1");   // ... then changed in the spreadsheet (version 1)

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

    // ------------------------------------------------------------------ requests sharing what was read

    private final AtomicLong now = new AtomicLong();

    /** A fresh app on the same spreadsheet whose requests share what was read for a minute. */
    private void openSharing() {
        storage = new GoogleSheetsStorage(api.client(), "sheet-1", "budget@test.iam.gserviceaccount.com",
                Duration.ofSeconds(60), now::get);
        store = new TsvDataStore(dataDir, storage, validator);
        tenants = new OrganizationRepository(store);
        users = new AppUserRepository(store);
    }

    private long reads() {
        return api.calls.stream().filter("batchGet"::equals).count();
    }

    @Test
    void requestsShareOneReadUntilItIsOlderThanTheMaximumAge() {
        openSharing();
        tenants.save(tenant("home"));
        store.endRequest();
        api.calls.clear();

        for (int request = 0; request < 5; request++) {
            assertThat(tenants.findAll()).hasSize(1);
            assertThat(users.findAll()).isEmpty();
            store.endRequest();
        }
        assertThat(api.calls).isEmpty();   // the save left what it wrote for every request after it

        now.addAndGet(Duration.ofSeconds(61).toNanos());
        assertThat(tenants.findAll()).hasSize(1);
        store.endRequest();
        assertThat(tenants.findAll()).hasSize(1);
        assertThat(api.calls).containsExactly("batchGet");
    }

    @Test
    void aSaveIsSeenByTheNextRequestAtOnce() {
        openSharing();
        assertThat(tenants.count()).isZero();
        store.endRequest();

        tenants.save(tenant("home"));
        store.endRequest();
        api.calls.clear();
        assertThat(tenants.findByCode("home")).isPresent();
        assertThat(api.calls).isEmpty();
    }

    @Test
    void anEditByHandShowsOnceTheSharedReadIsTooOld() {
        openSharing();
        tenants.save(tenant("home"));
        store.endRequest();
        api.tabs.get("organizations").cells.get(1).set(2, "Renamed by hand");

        assertThat(tenants.findByCode("home").orElseThrow().getName()).isEqualTo("Organization home");
        store.endRequest();
        now.addAndGet(Duration.ofSeconds(61).toNanos());
        assertThat(tenants.findByCode("home").orElseThrow().getName()).isEqualTo("Renamed by hand");
    }

    @Test
    void aSaveStillChecksAgainstWhatTheSpreadsheetHoldsNotAgainstASharedRead() {
        openSharing();
        Organization home = tenants.save(tenant("home"));
        store.endRequest();
        Organization stale = tenants.findById(home.getId()).orElseThrow();   // version 0, from the shared read
        store.endRequest();
        var cells = api.tabs.get("organizations").cells;
        cells.get(1).set(cells.getFirst().indexOf("version"), "1");          // changed in the spreadsheet meanwhile
        cells.get(1).set(cells.getFirst().indexOf("name"), "Renamed by hand");

        api.calls.clear();
        stale.setName("From a stale screen");
        assertThatThrownBy(() -> tenants.save(stale)).isInstanceOf(ConcurrentUpdateException.class);
        assertThat(api.calls).containsExactly("batchGet");   // read afresh, though the shared read was young
        assertThat(tenants.findByCode("home").orElseThrow().getName()).isEqualTo("Renamed by hand");
    }

    @Test
    void readingOnlyWhenSavingKeepsPagesOffTheSpreadsheetAndEverySaveRefreshesThem() {
        storage = new GoogleSheetsStorage(api.client(), "sheet-1", "budget@test.iam.gserviceaccount.com",
                Duration.ofSeconds(-1), now::get);
        store = new TsvDataStore(dataDir, storage, validator);
        tenants = new OrganizationRepository(store);
        users = new AppUserRepository(store);
        Organization home = tenants.save(tenant("home"));
        store.endRequest();
        api.calls.clear();

        // pages: never a read, however long it has been
        now.addAndGet(Duration.ofDays(1).toNanos());
        for (int request = 0; request < 3; request++) {
            assertThat(tenants.findAll()).hasSize(1);
            store.endRequest();
        }
        assertThat(api.calls).isEmpty();

        // an edit by hand shows with the next save, whatever it saves
        api.tabs.get("organizations").cells.get(1).set(2, "Renamed by hand");
        assertThat(tenants.findById(home.getId()).orElseThrow().getName()).isEqualTo("Organization home");
        store.endRequest();
        users.save(user(home.getId(), "anna"));
        store.endRequest();
        api.calls.clear();
        assertThat(tenants.findById(home.getId()).orElseThrow().getName()).isEqualTo("Renamed by hand");
        assertThat(users.findAll()).extracting(AppUser::getUsername).containsExactly("anna");
        assertThat(api.calls).isEmpty();
    }

    @Test
    void requestsArrivingTogetherWaitForOneRead() throws Exception {
        openSharing();
        tenants.save(tenant("home"));
        store.endRequest();
        now.addAndGet(Duration.ofSeconds(61).toNanos());
        api.calls.clear();

        int threads = 12;
        CountDownLatch start = new CountDownLatch(1);
        ExecutorService pool = Executors.newFixedThreadPool(threads);
        try {
            List<Future<Integer>> results = new ArrayList<>();
            for (int i = 0; i < threads; i++) {
                results.add(pool.submit(() -> {
                    start.await();
                    store.beginReadOnly();
                    try {
                        return tenants.findAll().size() + users.findAll().size();
                    } finally {
                        store.endRequest();
                    }
                }));
            }
            start.countDown();
            for (Future<Integer> result : results) {
                assertThat(result.get(10, TimeUnit.SECONDS)).isEqualTo(1);
            }
        } finally {
            pool.shutdownNow();
        }
        assertThat(reads()).isEqualTo(1);
    }

    @Test
    void aTableAddedAfterTheSharedReadIsReadFromTheSpreadsheet() {
        api.addTab("app_users", 1000, 26).cells.addAll(List.of(
                new ArrayList<>(List.of("id", "tenantId", "username")), new ArrayList<>(List.of("1", "1", "early"))));
        storage = new GoogleSheetsStorage(api.client(), "sheet-1", "budget@test.iam.gserviceaccount.com",
                Duration.ofSeconds(60), now::get);
        store = new TsvDataStore(dataDir, storage, validator);
        tenants = new OrganizationRepository(store);
        assertThat(tenants.count()).isZero();   // read before app_users is a table of the app
        store.endRequest();

        users = new AppUserRepository(store);
        assertThat(store.findAll(AppUser.class, u -> true)).extracting(AppUser::getUsername).containsExactly("early");
    }

    @Test
    void writesOnlyTheRowsThatChanged() {
        Organization one = tenants.save(tenant("one"));
        tenants.save(tenant("two"));
        tenants.save(tenant("three"));

        api.writtenRows.clear();
        Organization changed = tenants.findById(one.getId()).orElseThrow();
        changed.setName("Renamed");
        tenants.save(changed);
        assertThat(api.writtenRows).containsExactly("'organizations':2+1", "'_changes':2+1");   // and the change marker   // header row 1, "one" row 2

        api.writtenRows.clear();
        tenants.save(tenant("four"));
        assertThat(api.writtenRows).containsExactly("'organizations':5+1", "'_sequences':2+1", "'_changes':2+1");

        api.writtenRows.clear();
        tenants.deleteById(one.getId());
        assertThat(api.writtenRows).containsExactly("'organizations':2+4", "'_changes':2+1");   // the rows below move up, the last is cleared

        open();
        assertThat(tenants.findAll()).extracting(Organization::getCode).containsExactly("two", "three", "four");
        assertThat(api.tabs.get("organizations").cell(5, 1)).isEmpty();
        assertThat(tenants.findById(one.getId())).isEmpty();
    }

    @Test
    void reportsHowMuchIsStored() {
        tenants.save(tenant("home"));
        TableStorage.Footprint footprint = store.footprint();
        assertThat(footprint.tables()).isEqualTo(2);
        assertThat(footprint.bytes()).isPositive();
    }

    // ------------------------------------------------------------------ changes saved by another server process

    @Test
    void aSaveByAnotherProcessIsPickedUpByTheCheapCheckAndAnnounced() {
        openSharing();
        tenants.save(tenant("first"));   // the tabs exist before the second process opens the spreadsheet
        store.endRequest();
        // a second server process (the phone app's) on the same spreadsheet, sharing what it read forever
        GoogleSheetsStorage otherStorage = new GoogleSheetsStorage(api.client(), "sheet-1", "budget@test.iam.gserviceaccount.com", Duration.ofSeconds(-1), now::get);
        TsvDataStore other = new TsvDataStore(dataDir, otherStorage, validator);
        OrganizationRepository otherTenants = new OrganizationRepository(other);
        new AppUserRepository(other);
        assertThat(otherTenants.findAll()).hasSize(1);
        other.endRequest();
        assertThat(otherStorage.poll(false)).isEmpty();   // nothing saved since it read

        tenants.save(tenant("home"));   // saved through this process
        store.endRequest();
        assertThat(storage.poll(false)).as("its own save is not news to the process that made it").isEmpty();

        assertThat(otherTenants.findAll()).as("the other process still serves what it read").hasSize(1);
        other.endRequest();
        api.calls.clear();
        assertThat(otherStorage.poll(false)).containsExactly("organizations");
        assertThat(api.calls).containsExactly("values.get", "batchGet");   // one cell, then one read of everything
        assertThat(otherTenants.findAll()).extracting(Organization::getCode).containsExactly("first", "home");
        other.endRequest();

        api.calls.clear();
        assertThat(otherStorage.poll(false)).isEmpty();
        assertThat(api.calls).containsExactly("values.get");   // nothing new: one cell read, nothing else
    }

    @Test
    void theFullCheckFindsAnEditByHand() {
        openSharing();
        tenants.save(tenant("home"));
        store.endRequest();
        api.tabs.get("organizations").cells.get(1).set(2, "Edited by hand");
        assertThat(storage.poll(false)).as("an edit by hand does not touch the marker").isEmpty();
        assertThat(storage.poll(true)).containsExactly("organizations");
        assertThat(tenants.findByCode("home").orElseThrow().getName()).isEqualTo("Edited by hand");
    }

    // ------------------------------------------------------------------ a pooled request thread never serves an older read

    @Test
    void aRequestNeverServesWhatAnEarlierUseOfItsPooledThreadRead() throws Exception {
        openSharing();
        tenants.save(tenant("home"));
        store.endRequest();
        var filter = new com.aditya.personalbudget.config.RequestScopeFilter(store);
        ExecutorService other = Executors.newSingleThreadExecutor();
        try {
            // the live-update stream: its sign-in check reads, and the stream goes on without this thread
            filter.doFilter(new org.springframework.mock.web.MockHttpServletRequest("GET", "/api/events"), new org.springframework.mock.web.MockHttpServletResponse(),
                    (rq, rs) -> assertThat(tenants.findAll()).hasSize(1));
            // a stale read left on the thread by anything else
            assertThat(tenants.findAll()).hasSize(1);
            // the phone app saves, on another thread
            other.submit(() -> { tenants.save(tenant("phone")); store.endRequest(); }).get();
            // the next page request this pooled thread serves sees it
            List<Integer> seen = new ArrayList<>();
            filter.doFilter(new org.springframework.mock.web.MockHttpServletRequest("GET", "/api/organizations"), new org.springframework.mock.web.MockHttpServletResponse(),
                    (rq, rs) -> seen.add(tenants.findAll().size()));
            assertThat(seen).containsExactly(2);
        } finally {
            other.shutdownNow();
        }
    }

    @Test
    void anEditByHandIsReadInOnDemandAndAnnounced() {
        openSharing();
        tenants.save(tenant("home"));
        store.endRequest();
        List<java.util.Set<String>> heard = new ArrayList<>();
        store.addOutsideChangeListener(heard::add);
        api.tabs.get("organizations").cells.get(1).set(2, "Edited by hand");
        api.calls.clear();
        assertThat(tenants.findByCode("home").orElseThrow().getName()).as("no polling: memory is not read again by itself").isEqualTo("Organization home");
        store.endRequest();
        assertThat(api.calls).isEmpty();

        assertThat(store.checkOutsideChanges(true)).containsExactly("organizations");   // Settings > Organization > Check now
        assertThat(heard).containsExactly(java.util.Set.of("organizations"));
        assertThat(tenants.findByCode("home").orElseThrow().getName()).isEqualTo("Edited by hand");
        store.endRequest();
        assertThat(store.checkOutsideChanges(true)).isEmpty();
    }
}
