package com.aditya.personalbudget.storage;

import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.AbstractPlatformTransactionManager;
import org.springframework.transaction.support.DefaultTransactionStatus;
import org.springframework.transaction.support.SmartTransactionObject;

/**
 * Lets services use the standard {@code @Transactional} annotation on top of the file store.
 * A transaction maps to one {@link TsvDataStore} unit of work: all-or-nothing across tables.
 * Nested REQUIRED calls join the outer transaction; suspension (REQUIRES_NEW) is not supported.
 */
public class TsvTransactionManager extends AbstractPlatformTransactionManager {

    private final transient TsvDataStore store;

    public TsvTransactionManager(TsvDataStore store) {
        this.store = store;
    }

    @Override
    protected Object doGetTransaction() {
        return new TsvTransaction(store, store.isInTransaction());
    }

    @Override
    protected boolean isExistingTransaction(Object transaction) {
        return ((TsvTransaction) transaction).existing();
    }

    @Override
    protected void doBegin(Object transaction, TransactionDefinition definition) {
        store.begin();
    }

    @Override
    protected void doCommit(DefaultTransactionStatus status) {
        store.commit();
    }

    @Override
    protected void doRollback(DefaultTransactionStatus status) {
        store.rollback();
    }

    @Override
    protected void doSetRollbackOnly(DefaultTransactionStatus status) {
        store.setRollbackOnly();
    }

    /** Transaction handle; exposes the rollback-only flag so inner failures roll back the outer transaction. */
    private record TsvTransaction(TsvDataStore store, boolean existing) implements SmartTransactionObject {

        @Override
        public boolean isRollbackOnly() {
            return store.isRollbackOnly();
        }

        @Override
        public void flush() {
            // nothing buffered outside the unit of work
        }
    }
}
