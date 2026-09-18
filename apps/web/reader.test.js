/**
 * مسار حفظ التقدم — نقلًا لا عرضًا.
 *
 * هذا المسار يتجاوز عميل الـAPI المشترك (`api()` في `app.js`) لأنه يحتاج
 * `keepalive` و`sendBeacon`. وتجاوزه يعني أنه يفقد ما يضبطه العميل المشترك:
 * الاعتماد عبر الأصول. على الـAPK يعني ذلك 401 صامتًا في كل حفظ.
 */
import { describe, expect, it, vi } from 'vitest';
import { createProgressSaver } from './reader.js';

const ok = () => ({ ok: true, status: 204 });

describe('createProgressSaver', () => {
  it('sends credentials across origins', async () => {
    const fetchImpl = vi.fn(async () => ok());
    const saver = createProgressSaver({
      bookId: 'b1',
      baseUrl: 'https://api.example.com',
      fetchImpl,
      delayMs: 0,
    });
    saver.update(12);
    saver.flush();
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalled());
    expect(fetchImpl.mock.calls[0][1]).toMatchObject({ credentials: 'include' });
  });

  it('stays same-origin in the browser build', async () => {
    const fetchImpl = vi.fn(async () => ok());
    const saver = createProgressSaver({ bookId: 'b1', fetchImpl, delayMs: 0 });
    saver.update(3);
    saver.flush();
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalled());
    expect(fetchImpl.mock.calls[0][1]).toMatchObject({ credentials: 'same-origin' });
  });

  it('confirms only what the owner accepted', async () => {
    const saved = [];
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 401 }));
    const saver = createProgressSaver({
      bookId: 'b1',
      baseUrl: 'https://api.example.com',
      fetchImpl,
      delayMs: 0,
      onSaved: (page) => saved.push(page),
    });
    saver.update(9);
    saver.flush();
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalled());
    expect(saved).toEqual([]);
  });

  it('confirms a page the owner did accept', async () => {
    const saved = [];
    const fetchImpl = vi.fn(async () => ok());
    const saver = createProgressSaver({
      bookId: 'b1',
      baseUrl: 'https://api.example.com',
      fetchImpl,
      delayMs: 0,
      onSaved: (page) => saved.push(page),
    });
    saver.update(9);
    saver.flush();
    await vi.waitFor(() => expect(saved).toEqual([9]));
  });

  it('does not repeat the same page', async () => {
    const fetchImpl = vi.fn(async () => ok());
    const saver = createProgressSaver({
      bookId: 'b1',
      baseUrl: 'https://api.example.com',
      fetchImpl,
      delayMs: 0,
    });
    saver.update(4);
    saver.flush();
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1));
    saver.update(4);
    saver.flush();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
