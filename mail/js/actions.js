// Message actions shared by the list, swipe gestures, bulk selection and the reader.
// Updates are optimistic: the UI changes first and is reverted if Gmail refuses.
import * as gmail from './gmail.js';
import { emit } from './state.js';
import { toast } from './ui.js';

function reportError(err) {
  if (err instanceof gmail.AuthError) return;
  toast(err instanceof gmail.NetworkError ? 'No connection. Try again when you are back online.' : (err.message || 'Something went wrong'));
}

async function changeLabels(ids, add, remove) {
  emit('labels-changed', { ids, add, remove });
  try {
    if (ids.length === 1) await gmail.modify(ids[0], add, remove);
    else await gmail.batchModify(ids, add, remove);
    ids.forEach((id) => {
      const m = gmail.cachedFull(id);
      if (m) gmail.updateCachedLabels(id, m.labelIds.filter((l) => !remove.includes(l)).concat(add.filter((l) => !m.labelIds.includes(l))));
    });
    if (add.includes('UNREAD') || remove.includes('UNREAD') || add.includes('INBOX') || remove.includes('INBOX')) emit('counts-stale');
    return true;
  } catch (err) {
    emit('labels-changed', { ids, add: remove, remove: add });
    reportError(err);
    return false;
  }
}

const plural = (n, one, many) => (n === 1 ? one : `${n} ${many}`);

export async function archive(ids) {
  if (!(await changeLabels(ids, [], ['INBOX']))) return;
  toast(plural(ids.length, 'Archived', 'conversations archived'), {
    action: { label: 'Undo', run: () => changeLabels(ids, ['INBOX'], []).then(() => emit('refresh')) },
  });
}

export async function moveToInbox(ids) {
  if (await changeLabels(ids, ['INBOX'], [])) toast(plural(ids.length, 'Moved to Inbox', 'moved to Inbox'));
}

export const setRead = (ids, read) => changeLabels(ids, read ? [] : ['UNREAD'], read ? ['UNREAD'] : []);
export const setStar = (ids, star) => changeLabels(ids, star ? ['STARRED'] : [], star ? [] : ['STARRED']);

export async function trash(ids) {
  emit('trashed', { ids });
  try {
    await gmail.trashMany(ids);
    emit('counts-stale');
    toast(plural(ids.length, 'Moved to Trash', 'moved to Trash'), {
      action: {
        label: 'Undo',
        run: async () => {
          try { await gmail.untrashMany(ids); emit('refresh'); emit('counts-stale'); } catch (err) { reportError(err); }
        },
      },
    });
  } catch (err) {
    emit('refresh');
    reportError(err);
  }
}

export async function restore(ids) {
  emit('trashed', { ids });
  try {
    await gmail.untrashMany(ids);
    emit('counts-stale');
    toast(plural(ids.length, 'Restored', 'restored'));
  } catch (err) {
    emit('refresh');
    reportError(err);
  }
}
