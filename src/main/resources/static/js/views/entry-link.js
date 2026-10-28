/**
 * #/entry/<id>: one link to any journal entry, wherever it is shown (a report, a list, a dashboard card). It looks the
 * entry up and goes on to the page that manages it, opened on that very entry: the expense in Expenses, the chit and
 * its installment, the account an opening balance is on, an income on Income, a manual voucher in the Day book ...
 * (see entryRoute). The redirect replaces this address, so Back returns to where the link was clicked.
 */
import { api } from '../core/api.js';
import { toast } from '../core/ui.js';
import { entryRoute } from '../components/entry-inline.js';

export async function render(container, params, isCurrent) {
    const id = Number(params[0]);
    const entry = Number.isFinite(id) && id > 0 ? await api.get(`/transactions/${id}`).catch(() => null) : null;
    if (!isCurrent()) return;
    if (!entry) {
        toast('That entry no longer exists', 'error');
        location.replace('#/transactions');
        return;
    }
    location.replace(`#/${entryRoute(entry)}`);
}
