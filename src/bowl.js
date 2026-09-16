// The lid is presentation only. Dice and payouts always come from the server.
export function createBowlReveal(ui, { onReveal, symbolName, createDie }) {
  let roundId = null;
  let phase = null;
  let state = null;
  let lift = 0;
  let opened = false;
  let pointer = null;
  let animation = null;
  let returnFocus = null;
  const dialog = ui['bowl-dialog'];
  const stage = ui['bowl-stage'];
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

  function stopAnimation() {
    cancelAnimationFrame(animation);
    animation = null;
  }

  function setLift(value) {
    lift = Math.max(0, Math.min(100, value));
    stage.style.setProperty('--lift', String(lift / 100));
    ui['bowl-lift'].value = String(Math.round(lift));
    ui['bowl-lift-percent'].textContent = `${Math.round(lift)}%`;
    if (lift >= 96 && !opened && state?.phase === 'result') {
      opened = true;
      ui['bowl-heading'].textContent = state.dice.map(symbolName).join(' · ');
      ui['bowl-instructions'].textContent = 'Kết quả chung của cả phòng. Chúc bạn may mắn ván tới!';
      ui['bowl-dice'].setAttribute('aria-hidden', 'false');
      ui['finish-bowl'].hidden = false;
      ui['reveal-bowl'].hidden = true;
      const result = state.you.lastResult;
      ui['bowl-outcome'].textContent = result && state.history[0]?.results.some(entry => entry.playerId === state.you.id)
        ? `Bạn ${result.profit >= 0 ? 'nhận lãi' : 'lỗ'} ${Math.abs(result.profit).toLocaleString('vi-VN')} xu.`
        : 'Bạn không đặt xu trong ván này.';
      onReveal();
    }
  }

  function open() {
    if (!['revealing', 'result'].includes(state?.phase)) return;
    if (ui['reset-dialog'].open) ui['reset-dialog'].close();
    if (!dialog.open) {
      returnFocus = document.activeElement;
      dialog.showModal();
      ui['close-bowl'].focus({ preventScroll: true });
    }
  }

  function close() {
    if (dialog.open) dialog.close();
    if (returnFocus?.isConnected && !returnFocus.matches(':disabled')) returnFocus.focus({ preventScroll: true });
  }

  function reveal() {
    if (state?.phase !== 'result' || opened || animation !== null) return;
    stopAnimation();
    const start = performance.now();
    const from = lift;
    const duration = reducedMotion.matches ? 0 : 1400;
    const step = now => {
      const progress = duration ? Math.min(1, (now - start) / duration) : 1;
      setLift(from + (100 - from) * (1 - (1 - progress) ** 3));
      if (progress < 1) animation = requestAnimationFrame(step);
      else animation = null;
    };
    animation = requestAnimationFrame(step);
  }

  function reset() {
    stopAnimation();
    close();
    roundId = null;
    phase = null;
    state = null;
    opened = false;
    pointer = null;
    setLift(0);
  }

  function update(next) {
    state = next;
    if (!['revealing', 'result'].includes(next.phase)) {
      if (roundId) reset();
      state = next;
      ui['view-bowl'].hidden = true;
      return;
    }
    const changedRound = next.roundId !== roundId;
    if (changedRound) {
      stopAnimation();
      roundId = next.roundId;
      opened = false;
      pointer = null;
      setLift(0);
      ui['bowl-outcome'].textContent = '';
      ui['bowl-dice'].replaceChildren();
      ui['bowl-dice'].setAttribute('aria-hidden', 'true');
      ui['finish-bowl'].hidden = true;
      ui['reveal-bowl'].hidden = false;
      ui['bowl-round'].textContent = `PHIÊN ${String(next.roundNumber).padStart(4, '0')}`;
    }
    if (changedRound || phase !== next.phase) {
      phase = next.phase;
      const ready = phase === 'result';
      stage.dataset.state = ready ? 'ready' : 'shaking';
      ui['bowl-heading'].textContent = ready ? 'Mở bát đón may mắn' : 'Đang lắc xúc xắc…';
      ui['bowl-instructions'].textContent = ready ? 'Kéo bát lên từ từ, dùng thanh trượt hoặc nhấn Mở bát.' : 'Cược đã khóa. Xúc xắc đang lắc bên trong bát.';
      ui['bowl-lift'].disabled = !ready;
      ui['reveal-bowl'].disabled = !ready;
      if (ready) ui['bowl-dice'].replaceChildren(...next.dice.map(createDie));
      if (changedRound) open();
    }
    ui['view-bowl'].hidden = false;
  }

  ui['bowl-lift'].addEventListener('input', event => {
    if (state?.phase !== 'result') return;
    stopAnimation();
    setLift(Number(event.target.value));
  });
  ui['bowl-lid'].addEventListener('pointerdown', event => {
    if (state?.phase !== 'result' || event.button !== 0) return;
    stopAnimation();
    pointer = { id: event.pointerId, y: event.clientY, lift };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  });
  ui['bowl-lid'].addEventListener('pointermove', event => {
    if (!pointer || event.pointerId !== pointer.id) return;
    const distance = Math.max(100, stage.clientHeight * 0.55);
    setLift(pointer.lift + (pointer.y - event.clientY) / distance * 100);
  });
  for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    ui['bowl-lid'].addEventListener(event, () => { pointer = null; });
  }
  ui['reveal-bowl'].addEventListener('click', reveal);
  ui['close-bowl'].addEventListener('click', close);
  ui['finish-bowl'].addEventListener('click', close);
  ui['view-bowl'].addEventListener('click', open);
  dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
  return {
    update, reset,
    covered: () => state?.phase === 'result' && state.roundId === roundId && !opened,
    tick(remainingMs) {
      if (!state) return;
      ui['bowl-next-countdown'].textContent = state.paused ? 'tạm dừng' : remainingMs === null ? 'đang lắc' : `${Math.max(0, Math.ceil(remainingMs / 1000))}s`;
      // Nobody misses the result or holds up the next shared round.
      if (state.phase === 'result' && !state.paused && remainingMs !== null && remainingMs <= 2500) reveal();
    },
  };
}
