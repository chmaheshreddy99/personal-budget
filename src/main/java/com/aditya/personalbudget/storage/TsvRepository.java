package com.aditya.personalbudget.storage;

import org.springframework.data.repository.ListCrudRepository;

import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.function.Predicate;
import java.util.stream.StreamSupport;

/**
 * Base class for all repositories. It implements the standard Spring Data
 * {@link ListCrudRepository} contract, so services use the same API they would with Spring Data JPA
 * ({@code save}, {@code findById}, {@code findAll}, {@code deleteById} ...).
 * <p>
 * Subclasses add finder methods named the Spring Data way ({@code findByTenantId} ...)
 * and implement them with {@link #findWhere(Predicate)}.
 */
public abstract class TsvRepository<T extends Identifiable> implements ListCrudRepository<T, Long> {

    protected final TsvDataStore store;
    protected final Class<T> type;

    protected TsvRepository(TsvDataStore store, Class<T> type) {
        this.store = store;
        this.type = type;
        store.register(type);
    }

    // ------------------------------------------------------------------ CrudRepository

    @Override
    @SuppressWarnings("unchecked")
    public <S extends T> S save(S entity) {
        return (S) store.save(type, entity);
    }

    @Override
    @SuppressWarnings("unchecked")
    public <S extends T> List<S> saveAll(Iterable<S> entities) {
        List<S> list = new ArrayList<>();
        entities.forEach(list::add);
        return (List<S>) store.saveAll(type, list);
    }

    @Override
    public Optional<T> findById(Long id) {
        return store.findById(type, id);
    }

    @Override
    public boolean existsById(Long id) {
        return findById(id).isPresent();
    }

    @Override
    public List<T> findAll() {
        return store.findAll(type, row -> true);
    }

    @Override
    public List<T> findAllById(Iterable<Long> ids) {
        List<Long> wanted = StreamSupport.stream(ids.spliterator(), false).toList();
        return findWhere(row -> wanted.contains(row.getId()));
    }

    @Override
    public long count() {
        return store.count(type, row -> true);
    }

    @Override
    public void deleteById(Long id) {
        store.deleteById(type, id);
    }

    @Override
    public void delete(T entity) {
        deleteById(entity.getId());
    }

    @Override
    public void deleteAllById(Iterable<? extends Long> ids) {
        List<Long> list = new ArrayList<>();
        ids.forEach(list::add);
        store.deleteAllById(type, list);
    }

    @Override
    public void deleteAll(Iterable<? extends T> entities) {
        List<Long> list = new ArrayList<>();
        entities.forEach(e -> list.add(e.getId()));
        store.deleteAllById(type, list);
    }

    @Override
    public void deleteAll() {
        store.deleteAllById(type, findAll().stream().map(Identifiable::getId).toList());
    }

    // ------------------------------------------------------------------ helpers for derived finders

    protected List<T> findWhere(Predicate<? super T> filter) {
        return store.findAll(type, filter);
    }

    protected Optional<T> findFirstWhere(Predicate<? super T> filter) {
        return findWhere(filter).stream().findFirst();
    }

    protected long countWhere(Predicate<? super T> filter) {
        return store.count(type, filter);
    }
}
