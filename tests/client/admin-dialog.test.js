import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { createAdminDialog } from '../../src/features/admin/admin-dialog.js';

function fixture() {
  const document = { activeElement: null };
  class Element extends EventTarget {
    value = '';
    textContent = '';
    hidden = false;
    disabled = false;
    isConnected = true;
    attributes = new Map();
    focus() { document.activeElement = this; }
    setAttribute(name, value) { this.attributes.set(name, value); }
    removeAttribute(name) { this.attributes.delete(name); }
  }
  const elements = Object.fromEntries(['dialog', 'form', 'title', 'message', 'reasonField', 'reasonInput', 'reasonError', 'accept', 'cancel'].map(name => [name, new Element()]));
  const trigger = new Element(); trigger.focus();
  elements.dialog.open = false;
  elements.dialog.showModal = () => { elements.dialog.open = true; };
  elements.dialog.close = value => {
    elements.dialog.returnValue = value;
    elements.dialog.open = false;
    elements.dialog.dispatchEvent(new Event('close'));
  };
  const submit = (value = 'confirm') => {
    const event = new Event('submit', { cancelable: true });
    Object.defineProperty(event, 'submitter', { value: { value } });
    elements.form.dispatchEvent(event);
    assert.equal(event.defaultPrevented, true);
  };
  return { ...elements, trigger, document, submit, controller: createAdminDialog({ ...elements, document }) };
}

test('reason dialog validates trimmed length and returns the confirmed reason', async () => {
  const ui = fixture();
  const result = ui.controller.ask({ title: 'Khóa phòng', message: 'Phòng TEST01', requireReason: true, confirmLabel: 'Khóa phòng' });
  assert.equal(ui.reasonField.hidden, false);
  assert.equal(ui.reasonInput.required, true);
  assert.equal(ui.document.activeElement, ui.reasonInput);
  assert.equal(ui.accept.textContent, 'Khóa phòng');
  for (const invalid of ['', '   ', ' ab ', 'x'.repeat(256)]) {
    ui.reasonInput.value = invalid;
    ui.submit();
    assert.equal(ui.dialog.open, true);
    assert.match(ui.reasonError.textContent, /3 đến 255/);
    assert.equal(ui.reasonInput.attributes.get('aria-invalid'), 'true');
  }
  ui.reasonInput.value = '  Bảo trì phòng  ';
  ui.reasonInput.dispatchEvent(new Event('input'));
  assert.equal(ui.reasonError.textContent, '');
  ui.submit();
  assert.deepEqual(await result, { confirmed: true, reason: 'Bảo trì phòng' });
  assert.equal(ui.document.activeElement, ui.trigger);
  assert.equal(ui.reasonInput.value, '');
});

test('cancel works with an empty required reason and never confirms an operation', async () => {
  const ui = fixture();
  const result = ui.controller.ask({ message: 'Đóng phòng', requireReason: true });
  ui.submit('cancel');
  assert.deepEqual(await result, { confirmed: false, reason: null });
});

test('Escape dismissal clears the previous reason and confirmation state', async () => {
  const ui = fixture();
  const first = ui.controller.ask({ message: 'Hủy ván', requireReason: true });
  ui.reasonInput.value = 'Không gửi thao tác này';
  ui.dialog.close('');
  assert.deepEqual(await first, { confirmed: false, reason: null });
  const second = ui.controller.ask({ message: 'Cấp xu' });
  assert.equal(ui.reasonField.hidden, true);
  assert.equal(ui.reasonInput.required, false);
  assert.equal(ui.document.activeElement, ui.cancel);
  ui.submit();
  assert.deepEqual(await second, { confirmed: true, reason: null });
});

test('a second operation cannot reuse the open operation confirmation', async () => {
  const ui = fixture();
  const first = ui.controller.ask({ message: 'Thao tác A', requireReason: true });
  assert.deepEqual(await ui.controller.ask({ message: 'Thao tác B' }), { confirmed: false, reason: null });
  assert.equal(ui.message.textContent, 'Thao tác A');
  ui.submit('cancel');
  await first;
});

test('a failed dialog opening does not leave a pending operation', async () => {
  const ui = fixture();
  const showModal = ui.dialog.showModal;
  ui.dialog.showModal = () => { throw new Error('Dialog unavailable'); };
  await assert.rejects(ui.controller.ask({ message: 'Thử mở' }), /Dialog unavailable/);
  ui.dialog.showModal = showModal;
  const result = ui.controller.ask({ message: 'Thử lại' });
  ui.submit('cancel');
  assert.deepEqual(await result, { confirmed: false, reason: null });
});

test('Admin actions do not use embedded-browser-unsupported native JS dialogs', async () => {
  const source = await readFile(new URL('../../src/features/admin/admin.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /\b(?:window\.)?(?:prompt|confirm|alert)\s*\(/);
});
