// Page-owned dialogs work in embedded browsers that disable window.prompt().
export function createAdminDialog({ dialog, form, title, message, reasonField, reasonInput, reasonError, accept, cancel, document }) {
  let pending = null;
  let needsReason = false;
  let previousFocus = null;

  form.addEventListener('submit', event => {
    event.preventDefault();
    if (!pending) return;
    if (event.submitter?.value === 'cancel') { dialog.close('cancel'); return; }
    const reason = reasonInput.value.trim();
    if (needsReason && (reason.length < 3 || reason.length > 255)) {
      reasonError.textContent = 'Nhập lý do từ 3 đến 255 ký tự, không chỉ khoảng trắng.';
      reasonInput.setAttribute('aria-invalid', 'true');
      reasonInput.focus();
      return;
    }
    dialog.close('confirm');
  });
  reasonInput.addEventListener('input', () => {
    reasonError.textContent = '';
    reasonInput.removeAttribute('aria-invalid');
  });
  dialog.addEventListener('close', () => {
    if (!pending) return;
    const resolve = pending;
    const result = {
      confirmed: dialog.returnValue === 'confirm',
      reason: needsReason && dialog.returnValue === 'confirm' ? reasonInput.value.trim() : null,
    };
    pending = null;
    reasonInput.value = '';
    if (previousFocus?.isConnected && !previousFocus.disabled) previousFocus.focus({ preventScroll: true });
    resolve(result);
  });

  return {
    ask({ title: heading = 'Xác nhận thao tác', message: description, requireReason = false, confirmLabel = 'Xác nhận' }) {
      // A second click must not reuse the first operation's confirmation.
      if (pending) return Promise.resolve({ confirmed: false, reason: null });
      previousFocus = document.activeElement;
      needsReason = requireReason;
      title.textContent = heading;
      message.textContent = description;
      reasonField.hidden = !requireReason;
      reasonInput.required = requireReason;
      reasonInput.value = '';
      reasonInput.removeAttribute('aria-invalid');
      reasonError.textContent = '';
      accept.textContent = confirmLabel;
      dialog.returnValue = '';
      return new Promise((resolve, reject) => {
        pending = resolve;
        try {
          dialog.showModal();
          (requireReason ? reasonInput : cancel).focus();
        } catch (error) { pending = null; reject(error); }
      });
    },
  };
}
