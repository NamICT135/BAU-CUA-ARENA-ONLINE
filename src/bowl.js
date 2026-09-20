// The bowl is presentation only. Dice and payouts always come from the server.
export function createBowlReveal(ui, { onReveal, symbolName, createDie }) {
  let roundId = null;
  let phase = null;
  let state = null;
  let offsetX = 0;
  let offsetY = 0;
  let opened = false;
  let dismissed = false;
  let pointer = null;
  let animation = null;
  let returnFocus = null;

  const overlay = ui['bowl-overlay'];
  const stage = ui['bowl-stage'];
  const lid = ui['bowl-lid'];
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

  function stopAnimation() {
    if (animation !== null) cancelAnimationFrame(animation);
    animation = null;
  }

  function dragMetrics() {
    const size = Math.max(220, Math.min(stage.clientWidth, stage.clientHeight));
    return {
      threshold: size * 0.24,
      openDistance: size * 0.48,
      maxDistance: size * 0.54,
    };
  }

  function setPosition(x, y) {
    const { threshold, maxDistance } = dragMetrics();
    const distance = Math.hypot(x, y);
    const scale = distance > maxDistance ? maxDistance / distance : 1;
    offsetX = x * scale;
    offsetY = y * scale;
    const progress = Math.min(1, Math.hypot(offsetX, offsetY) / threshold);
    const angle = Math.max(-2.5, Math.min(2.5, offsetX / maxDistance * 2.5));
    stage.style.setProperty('--bowl-x', `${offsetX}px`);
    stage.style.setProperty('--bowl-y', `${offsetY}px`);
    stage.style.setProperty('--bowl-angle', `${angle}deg`);
    stage.style.setProperty('--bowl-progress', String(progress));
  }

  function animateTo(targetX, targetY, duration, onDone) {
    stopAnimation();
    const fromX = offsetX;
    const fromY = offsetY;
    const startedAt = performance.now();
    const motionDuration = reducedMotion.matches ? 0 : duration;

    const step = now => {
      const progress = motionDuration ? Math.min(1, (now - startedAt) / motionDuration) : 1;
      const eased = 1 - (1 - progress) ** 3;
      setPosition(fromX + (targetX - fromX) * eased, fromY + (targetY - fromY) * eased);
      if (progress < 1) animation = requestAnimationFrame(step);
      else {
        animation = null;
        onDone?.();
      }
    };
    animation = requestAnimationFrame(step);
  }

  function show() {
    if (dismissed || !overlay.hidden) return;
    for (const dialog of document.querySelectorAll('dialog[open]')) dialog.close();
    returnFocus = document.activeElement;
    overlay.hidden = false;
    document.body.classList.add('bowl-overlay-active');
    if (ui.game) ui.game.inert = true;
    requestAnimationFrame(() => overlay.focus({ preventScroll: true }));
  }

  function hide() {
    overlay.hidden = true;
    document.body.classList.remove('bowl-overlay-active');
    if (ui.game) ui.game.inert = false;
    if (returnFocus?.isConnected && !returnFocus.matches(':disabled')) {
      returnFocus.focus({ preventScroll: true });
    }
    returnFocus = null;
  }

  function outcomeText() {
    const result = state?.you.lastResult;
    if (!result || !state.history[0]?.results.some(entry => entry.playerId === state.you.id)) {
      return 'Bạn không đặt xu trong ván này.';
    }
    if (result.profit === 0) return 'Bạn hòa vốn trong ván này.';
    return `Bạn ${result.profit > 0 ? 'thắng' : 'thua'} ${Math.abs(result.profit).toLocaleString('vi-VN')} xu.`;
  }

  function finishReveal() {
    if (opened || state?.phase !== 'result') return;
    opened = true;
    pointer = null;
    stage.classList.remove('is-dragging');
    stage.classList.add('is-opened');
    ui['bowl-dice'].setAttribute('aria-hidden', 'false');
    ui['bowl-heading'].textContent = state.dice.map(symbolName).join(' · ');
    ui['bowl-instructions'].textContent = 'Kết quả chung của cả phòng.';
    ui['bowl-outcome'].textContent = outcomeText();
    ui['bowl-return'].hidden = false;
    lid.disabled = true;
    navigator.vibrate?.(18);
    onReveal();
  }

  function reveal(direction = { x: 0.72, y: -0.69 }) {
    if (state?.phase !== 'result' || opened || animation !== null) return;
    const length = Math.hypot(direction.x, direction.y) || 1;
    const distance = dragMetrics().openDistance;
    animateTo(direction.x / length * distance, direction.y / length * distance, 480, finishReveal);
  }

  function resetVisual() {
    stopAnimation();
    pointer = null;
    opened = false;
    dismissed = false;
    stage.classList.remove('is-dragging', 'is-opened');
    setPosition(0, 0);
    ui['bowl-outcome'].textContent = '';
    ui['bowl-dice'].replaceChildren();
    ui['bowl-dice'].setAttribute('aria-hidden', 'true');
    ui['bowl-return'].hidden = true;
    lid.disabled = true;
  }

  function reset() {
    resetVisual();
    hide();
    roundId = null;
    phase = null;
    state = null;
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
      roundId = next.roundId;
      resetVisual();
      ui['bowl-round'].textContent = `PHIÊN ${String(next.roundNumber).padStart(4, '0')}`;
    }

    show();
    if (changedRound || phase !== next.phase) {
      phase = next.phase;
      const ready = phase === 'result';
      stage.dataset.state = ready ? 'ready' : 'shaking';
      ui['bowl-heading'].textContent = ready ? 'Mở bát đê' : 'Đang lắc xúc xắc…';
      ui['bowl-instructions'].textContent = ready
        ? 'Giữ bát và kéo từ từ theo bất kỳ hướng nào để mở.'
        : 'Cược đã khóa. Xúc xắc đang lắc bên trong bát.';
      lid.disabled = !ready;
      if (ready) {
        ui['bowl-dice'].replaceChildren(...next.dice.map(createDie));
        requestAnimationFrame(() => lid.focus({ preventScroll: true }));
      }
    }
    ui['view-bowl'].hidden = false;
  }

  lid.addEventListener('pointerdown', event => {
    if (state?.phase !== 'result' || opened || event.button !== 0) return;
    stopAnimation();
    pointer = {
      id: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      baseX: offsetX,
      baseY: offsetY,
      moved: false,
    };
    stage.classList.add('is-dragging');
    lid.setPointerCapture(event.pointerId);
    event.preventDefault();
  });

  lid.addEventListener('pointermove', event => {
    if (!pointer || event.pointerId !== pointer.id) return;
    const screenX = event.clientX - pointer.startX;
    const screenY = event.clientY - pointer.startY;
    const rotatedFallback = document.body.classList.contains('force-landscape') &&
      matchMedia('(orientation: portrait)').matches;
    const deltaX = rotatedFallback ? screenY : screenX;
    const deltaY = rotatedFallback ? -screenX : screenY;
    if (Math.hypot(deltaX, deltaY) > 6) pointer.moved = true;
    setPosition(pointer.baseX + deltaX, pointer.baseY + deltaY);
    event.preventDefault();
  });

  function finishPointer(event, cancelled = false) {
    if (!pointer || event.pointerId !== pointer.id) return;
    const moved = pointer.moved;
    pointer = null;
    stage.classList.remove('is-dragging');

    const distance = Math.hypot(offsetX, offsetY);
    if (!cancelled && distance >= dragMetrics().threshold) reveal({ x: offsetX, y: offsetY });
    else if (moved || cancelled) animateTo(0, 0, 360);
    event.preventDefault();
  }

  lid.addEventListener('pointerup', event => finishPointer(event));
  lid.addEventListener('pointercancel', event => finishPointer(event, true));
  lid.addEventListener('lostpointercapture', event => {
    if (pointer?.id === event.pointerId) finishPointer(event, true);
  });

  lid.addEventListener('click', event => {
    // Click phát sinh từ chuột/cảm ứng không tự mở bát; người chơi phải kéo.
    // Click bàn phím (detail === 0) giữ lại như phương án hỗ trợ truy cập.
    if (event.detail === 0) reveal();
  });
  lid.addEventListener('contextmenu', event => event.preventDefault());
  lid.addEventListener('dragstart', event => event.preventDefault());

  ui['bowl-return'].addEventListener('click', () => {
    if (!opened) return;
    dismissed = true;
    hide();
  });

  ui['view-bowl'].addEventListener('click', () => {
    if (!['revealing', 'result'].includes(state?.phase)) return;
    dismissed = false;
    show();
  });

  overlay.addEventListener('keydown', event => {
    if (event.key === 'Escape' && opened) {
      event.preventDefault();
      dismissed = true;
      hide();
    }
  });

  window.addEventListener('resize', () => {
    if (overlay.hidden) return;
    if (opened) {
      const length = Math.hypot(offsetX, offsetY) || 1;
      const distance = dragMetrics().openDistance;
      setPosition(offsetX / length * distance, offsetY / length * distance);
    } else if (!pointer) setPosition(0, 0);
  }, { passive: true });

  return {
    update,
    reset,
    reveal,
    covered: () => state?.phase === 'result' && state.roundId === roundId && !opened,
    tick(remainingMs) {
      if (!state) return;
      ui['bowl-next-countdown'].textContent = state.paused
        ? 'tạm dừng'
        : remainingMs === null
          ? 'đang lắc'
          : `${Math.max(0, Math.ceil(remainingMs / 1000))}s`;
      // Nobody misses the result or holds up the next shared round.
      if (state.phase === 'result' && !state.paused && remainingMs !== null && remainingMs <= 2500) reveal();
    },
  };
}
