import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

vi.mock('../common/editor-local-store', () => ({
  saveLocalDraft: vi.fn(async () => {}),
  deleteLocalDraft: vi.fn(async () => {}),
}));

import { saveLocalDraft } from '../common/editor-local-store';
import { useDraftAutosave, blogSignature } from './useDraftAutosave';

const doc = (text, bold = false) => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text, ...(bold ? { marks: [{ type: 'bold' }] } : {}) }] }],
});
const draft = (content) => ({ title: 'My draft', des: '', tags: [], banner: '', content });

const ORIGINAL = draft(doc('hello'));
const BOLD = draft(doc('hello', true));
const EDITED = draft(doc('hello world'));

// Run pending promise callbacks (the save's continuation, the local write) inside act.
const flush = async () => { for (let i = 0; i < 10; i += 1) await Promise.resolve(); };
const advance = async (ms) => act(async () => { vi.advanceTimersByTime(ms); await flush(); });

// Server saves stay in flight until the test resolves them, oldest first.
const controllableSave = () => {
  const pending = [];
  const fn = vi.fn((b) => new Promise((resolve) => { pending.push({ b, resolve }); }));
  return { fn, resolveNext: async () => act(async () => { pending.shift().resolve(); await flush(); }) };
};

const setup = (serverSave) => {
  const base = {
    draftKey: 'blog:1', enabled: true, serverEnabled: true,
    serverContentSig: blogSignature(ORIGINAL), serverSave,
  };
  const hook = renderHook((props) => useDraftAutosave(props), { initialProps: { ...base, blog: ORIGINAL } });
  return { ...hook, show: (blog) => hook.rerender({ ...base, blog }) };
};

const lastLocalSnapshot = () => saveLocalDraft.mock.calls.at(-1)?.[0];

beforeEach(() => { vi.useFakeTimers(); saveLocalDraft.mockClear(); });
afterEach(() => { vi.useRealTimers(); });

describe('useDraftAutosave — edits made while a server save is in flight', () => {
  it('pushes an undo that lands while the previous save is in flight', async () => {
    const save = controllableSave();
    const { show, result } = setup(save.fn);

    show(BOLD);
    await advance(2000);                     // the bold version starts uploading
    expect(save.fn).toHaveBeenCalledTimes(1);

    show(ORIGINAL);                          // undo, while that upload is still in flight
    await advance(700);
    await save.resolveNext();                // the server now holds the bold version
    await advance(2000);

    expect(save.fn).toHaveBeenCalledTimes(2);
    expect(blogSignature(save.fn.mock.calls[1][0])).toBe(blogSignature(ORIGINAL));

    await save.resolveNext();
    expect(result.current.saveStatus).toBe('saved');
  });

  it('re-stamps the local copy against the new server state, so a reopen restores the undo', async () => {
    const save = controllableSave();
    const { show } = setup(save.fn);

    show(BOLD);
    await advance(2000);
    show(ORIGINAL);
    await advance(700);
    await save.resolveNext();

    // The tab could close now, before the follow-up upload. On reopen the editor restores a local copy
    // only if it was written against what the server holds (editor.pages.jsx, localHasUnsyncedEdits).
    const snap = lastLocalSnapshot();
    expect(blogSignature(snap)).toBe(blogSignature(ORIGINAL));
    expect(snap.baseServerSig).toBe(blogSignature(BOLD));
  });

  it('still uploads a new edit made during a save exactly once', async () => {
    const save = controllableSave();
    const { show } = setup(save.fn);

    show(BOLD);
    await advance(2000);
    show(EDITED);
    await advance(700);
    await save.resolveNext();
    await advance(5000);

    expect(save.fn).toHaveBeenCalledTimes(2);
    expect(blogSignature(save.fn.mock.calls[1][0])).toBe(blogSignature(EDITED));
  });

  it('does not upload again when nothing changed during the save', async () => {
    const save = controllableSave();
    const { show, result } = setup(save.fn);

    show(BOLD);
    await advance(2000);
    await save.resolveNext();
    await advance(5000);

    expect(save.fn).toHaveBeenCalledTimes(1);
    expect(result.current.saveStatus).toBe('saved');
  });
});
