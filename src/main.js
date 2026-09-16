import { io } from 'socket.io-client';
import './style.css';
import './arena.css';
import { createBowlReveal } from './bowl.js';

const ui = Object.fromEntries([...document.querySelectorAll('[id]')].map(element => [element.id, element]));
const sessionKey = 'bau-cua-arena-session';
const socket = io({ autoConnect: false, reconnection: true, reconnectionDelay: 700, reconnectionDelayMax: 4000 });
const number = value => Number(value).toLocaleString('vi-VN');
const signed = value => `${value > 0 ? '+' : ''}${number(value)}`;
let config = null;
let symbols = new Map();
let room = null;
let savedSession = readSession();
let selectedChip = null;
let serverOffset = 0;
let busy = false;
let synced = false;
let loadingConfig = false;
let acceptingMembership = false;
let sessionReplaced = false;
let connectionEpoch = 0;
const symbolViews = new Map();
const chipButtons = [];
// Keep semantic panels in the same order as the three-column table.
const layout = document.querySelector('.arena-layout');
layout.append(ui.history);
ui.game.insertBefore(ui['host-panel'], ui.statistics);
ui['host-panel'].append(ui['reset-room']);
const bowl = createBowlReveal(ui, {
  onReveal: () => { if (room) applyState(room); },
  symbolName: id => symbols.get(id)?.name || id,
  createDie: id => {
    const die = element('span', `dice-art art-${id}`);
    die.setAttribute('role', 'img');
    die.setAttribute('aria-label', symbols.get(id)?.name || id);
    return die;
  },
});

function readSession() {
  try {
    const value = JSON.parse(sessionStorage.getItem(sessionKey));
    return value && typeof value.token === 'string' && typeof value.roomCode === 'string' ? value : null;
  } catch { return null; }
}

function rememberSession(session) {
  if (!session?.token) return;
  savedSession = { token: session.token, roomCode: session.roomCode, name: ui['player-name'].value.trim() };
  try { sessionStorage.setItem(sessionKey, JSON.stringify(savedSession)); } catch { /* The room still works when browser storage is unavailable. */ }
}

function forgetSession() {
  savedSession = null;
  try { sessionStorage.removeItem(sessionKey); } catch { /* Storage may be blocked by browser privacy settings. */ }
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function notice(message, isError = false) {
  const target = room ? ui['room-notice'] : ui['lobby-status'];
  target.textContent = message;
  target.classList.toggle('error', isError);
}

function connectionStatus(label, state) {
  ui['connection-label'].textContent = label;
  ui['connection-status'].className = `connection-status ${state}`;
}

function canBet() {
  return Boolean(room && synced && socket.connected && !busy && !room.paused && room.phase === 'betting' && room.you.eligible &&
    (!room.deadline || Date.now() + serverOffset < room.deadline));
}

function totalBet() {
  return room ? Object.values(room.you.bets).reduce((sum, value) => sum + value, 0) : 0;
}

function renderControls() {
  const ready = Boolean(config && socket.connected && !busy && !acceptingMembership && !sessionReplaced);
  ui['create-room'].disabled = !ready;
  ui['join-room'].disabled = !ready;
  ui['player-name'].disabled = busy || acceptingMembership;
  ui['room-code-input'].disabled = busy || acceptingMembership;
  ui['symbol-controls'].disabled = !canBet();
  ui['chip-selector'].disabled = !canBet();
  ui['reset-bet'].disabled = !canBet() || totalBet() === 0;
  if (!room) return;
  const isHost = room.hostId === room.you.id;
  const available = ready && synced;
  const betweenRounds = ['waiting', 'result'].includes(room.phase);
  ui['host-controls'].hidden = !isHost;
  ui['host-panel'].hidden = !isHost;
  ui['host-settings-link'].hidden = !isHost;
  ui['admin-controls'].disabled = !available || !isHost;
  ui['pause-room'].textContent = room.paused ? 'Tiếp tục' : 'Tạm dừng';
  ui['lock-room'].textContent = room.locked ? 'Mở khóa phòng' : 'Khóa phòng';
  ui['pause-room'].setAttribute('aria-pressed', String(room.paused));
  ui['lock-room'].setAttribute('aria-pressed', String(room.locked));
  ui['cancel-round'].disabled = room.phase !== 'betting';
  ui['set-result'].disabled = room.phase !== 'betting';
  ui['random-result'].disabled = room.phase !== 'betting';
  ui['grant-coins'].disabled = room.phase === 'revealing';
  const target = room.players.find(player => player.id === ui['admin-player'].value);
  ui['kick-player'].disabled = room.phase === 'revealing' || !target || target.id === room.you.id;
  ui['transfer-host'].disabled = !target?.connected || target.id === room.you.id;
  ui['reset-room'].hidden = !isHost;
  ui['open-round'].hidden = room.phase === 'betting' || room.phase === 'revealing';
  ui.shake.hidden = betweenRounds;
  ui['open-round'].disabled = !available || !isHost || !betweenRounds;
  ui.shake.disabled = !available || !isHost || room.paused || room.phase !== 'betting';
  const canReset = betweenRounds || (room.phase === 'betting' && Object.values(room.boardTotals).every(value => value === 0));
  ui['reset-room'].disabled = !available || !isHost || !canReset;
  ui['leave-room'].disabled = !available;
}

function renderSelectedChip() {
  for (const button of chipButtons) {
    const selected = Number(button.dataset.chip) === selectedChip;
    button.classList.toggle('selected', selected);
    button.setAttribute('aria-pressed', String(selected));
  }
  ui['all-in'].classList.toggle('selected', selectedChip === 'all');
  ui['all-in'].setAttribute('aria-pressed', String(selectedChip === 'all'));
  ui['selected-chip-label'].textContent = selectedChip === 'all' ? 'ALL-IN: chạm một linh vật để đặt toàn bộ số xu còn có thể cược.' : `Đang chọn ${number(selectedChip)} xu / mỗi lần chạm`;
}

function buildBoard() {
  ui['game-grid'].replaceChildren();
  ui['chip-controls'].replaceChildren();
  symbolViews.clear();
  chipButtons.length = 0;
  const boardOrder = ['nai', 'bau', 'ga', 'ca', 'cua', 'tom'];
  for (const symbol of [...config.symbols].sort((a, b) => boardOrder.indexOf(a.id) - boardOrder.indexOf(b.id))) {
    const button = element('button', 'symbol-card');
    button.type = 'button';
    button.dataset.symbol = symbol.id;
    const icon = element('span', `symbol-icon dice-art art-${symbol.id}`);
    icon.setAttribute('aria-hidden', 'true');
    const amount = element('span', 'bet-value', '0');
    amount.id = `bet-${symbol.id}`;
    const betLabel = element('span', 'bet-label', 'Bạn đặt ');
    betLabel.append(amount);
    const total = element('span', 'board-total', 'Cả bàn: 0');
    button.append(element('span', 'symbol-name', symbol.name.toLocaleUpperCase('vi-VN')), icon, betLabel, total);
    button.addEventListener('click', () => placeBet(symbol.id));
    ui['game-grid'].append(button);
    symbolViews.set(symbol.id, { button, amount, total });
  }
  for (const amount of config.chips) {
    const button = element('button', 'chip-button', number(amount));
    button.type = 'button';
    button.dataset.chip = String(amount);
    button.setAttribute('aria-label', `Chip ${number(amount)} xu`);
    button.addEventListener('click', () => {
      if (!canBet()) return;
      selectedChip = amount;
      renderSelectedChip();
    });
    chipButtons.push(button);
    ui['chip-controls'].append(button);
  }
  selectedChip = config.chips[0];
  for (let index = 1; index <= 3; index++) {
    ui[`demo-dice-${index}`].replaceChildren(...config.symbols.map(symbol => {
      const option = element('option', '', symbol.name);
      option.value = symbol.id;
      return option;
    }));
  }
  renderSelectedChip();
}

function phaseMessage() {
  if (room.paused) return room.phase === 'revealing' ? 'Đang chốt kết quả; phòng sẽ tạm dừng trước ván mới.' : 'Phòng đang tạm dừng. Cược và đồng hồ được giữ nguyên.';
  const host = room.players.find(player => player.id === room.hostId)?.name || 'Chủ phòng';
  if (room.phase === 'waiting') return `Phòng đã sẵn sàng. ${host} sẽ mở cược khi mọi người có mặt.`;
  if (room.phase === 'revealing') return 'Đã khóa cược. Cả phòng đang chờ ba xúc xắc…';
  if (room.phase === 'result') return bowl.covered() ? 'Xúc xắc đã dừng. Mở bát từ từ để đón kết quả!' : 'Đã có kết quả! Ván mới sẽ tự mở khi hết thời gian xem bát.';
  if (!room.you.eligible) return 'Bạn vào sau khi ván đã mở. Cùng xem ván này và tham gia từ ván tiếp theo nhé.';
  if (room.you.balance === 0) return 'Bạn đã hết xu. Vẫn có thể xem cùng phòng; chủ phòng có thể đặt lại xu giữa các ván.';
  return 'Đang mở cược. Chọn chip rồi chạm linh vật; cược chỉ được ghi nhận khi máy chủ xác nhận.';
}

function applyState(next) {
  if (!next?.you || !config) return;
  if (room && room.code === next.code && room.you.id === next.you.id && next.revision < room.revision) return;
  const previous = room;
  room = next;
  document.body.classList.add('in-room');
  bowl.update(next);
  const covered = bowl.covered();
  serverOffset = next.serverNow - Date.now();
  ui.home.hidden = true;
  ui.game.hidden = false;
  ui['room-code'].textContent = room.code;
  const you = room.players.find(player => player.id === room.you.id);
  ui['player-display-name'].textContent = you?.name || '';
  ui['your-role'].textContent = room.hostId === room.you.id ? 'Chủ phòng · Bàn chơi tự động' : 'Người chơi';
  ui['round-number'].textContent = `VÁN ${room.roundNumber}`;
  const phases = { waiting: 'Chờ mở cược', betting: 'Đang mở cược', revealing: 'Đang lắc…', result: 'Đã có kết quả' };
  ui['phase-badge'].textContent = phases[room.phase];
  ui['phase-badge'].className = `phase-badge ${room.phase}`;
  ui['balance'].textContent = covered ? '•••' : number(room.you.balance);
  const outstanding = ['betting', 'revealing'].includes(room.phase) ? totalBet() : 0;
  ui['available-balance'].textContent = covered ? '•••' : number(room.you.balance - outstanding);
  ui['total-bet'].textContent = number(totalBet());
  for (const [id, view] of symbolViews) {
    const symbol = symbols.get(id);
    view.amount.textContent = number(room.you.bets[id]);
    view.total.textContent = `Cả bàn: ${number(room.boardTotals[id])}`;
    view.button.classList.toggle('has-bet', room.you.bets[id] > 0);
    view.button.classList.toggle('is-result', !covered && room.phase === 'result' && room.dice.includes(id));
    view.button.setAttribute('aria-label', `${symbol.name}, bạn đặt ${number(room.you.bets[id])} xu, cả bàn ${number(room.boardTotals[id])} xu`);
  }
  ui['dice-area'].classList.toggle('revealing', room.phase === 'revealing');
  ui['dice-area'].setAttribute('aria-busy', String(room.phase === 'revealing'));
  for (let index = 0; index < 3; index += 1) {
    const symbol = room.phase === 'result' && !covered ? symbols.get(room.dice[index]) : null;
    ui[`dice-${index + 1}`].textContent = symbol ? '' : '?';
    ui[`dice-${index + 1}`].className = symbol ? `dice-slot dice-art art-${symbol.id}` : 'dice-slot';
    ui[`dice-${index + 1}`].setAttribute('aria-label', `Xúc xắc ${index + 1}: ${symbol?.name || 'chưa có kết quả'}`);
  }
  const captions = {
    waiting: 'Chờ chủ phòng mở ván đầu tiên.',
    betting: 'Sáu linh vật. Bạn chọn ai?',
    revealing: 'Đang lắc… cược đã được khóa.',
    result: covered ? 'Mở bát để xem kết quả' : room.dice.map(id => symbols.get(id)?.name).join(' · '),
  };
  ui['dice-caption'].textContent = captions[room.phase];
  ui['open-round'].textContent = room.phase === 'result' ? 'Mở ván tiếp theo' : 'Mở cược';
  ui['host-hint'].textContent = 'Máy chủ tự chạy ván. Bạn có thể lắc sớm hoặc quản trị bàn ở bên dưới.';
  renderAdmin();
  renderCountdown();
  renderPlayers();
  renderResults();
  renderHistory();
  renderControls();
  if (previous && previous.hostId !== room.hostId) {
    const host = room.players.find(player => player.id === room.hostId);
    notice(`${host?.name || 'Một người chơi'} vừa nhận quyền chủ phòng. ${phaseMessage()}`);
  } else if (previous && previous.roundNumber > 0 && room.roundNumber === 0) {
    notice('Chủ phòng đã đặt lại số xu, thành tích và lịch sử. Một khởi đầu mới cho cả bàn!');
  } else if (!previous || previous.phase !== room.phase || previous.paused !== room.paused || previous.roundId !== room.roundId || previous.you.eligible !== room.you.eligible) {
    notice(phaseMessage());
  }
}

function renderCountdown() {
  if (!room) return;
  const remaining = room.paused ? room.remainingMs : room.deadline ? room.deadline - (Date.now() + serverOffset) : null;
  bowl.tick(remaining);
  ui['clock-progress'].style.width = `${room.phase === 'betting' ? Math.max(0, Math.min(100, (remaining ?? 30000) / 300)) : 0}%`;
  ui['countdown-label'].textContent = room.paused ? 'Đã tạm dừng' : room.phase === 'result' ? 'Ván tiếp theo sau' : room.phase === 'revealing' ? 'Đang lắc xúc xắc' : 'Tự động lắc sau';
  ui['round-countdown'].textContent = !synced || !socket.connected ? '—' : remaining === null ? '…' : `${Math.max(0, Math.ceil(remaining / 1000))}s`;
  renderControls();
}
setInterval(renderCountdown, 250);

function renderAdmin() {
  if (room.hostId !== room.you.id) return;
  const select = ui['admin-player'];
  const previous = select.value;
  const identity = room.players.map(player => `${player.id}:${player.name}`).join('|');
  if (select.dataset.roster !== identity) {
    select.replaceChildren(...room.players.map(player => {
      const option = element('option', '', `${player.name}${player.id === room.you.id ? ' (bạn)' : ''}`);
      option.value = player.id;
      return option;
    }));
    select.dataset.roster = identity;
    if (room.players.some(player => player.id === previous)) select.value = previous;
  }
  ui['demo-selection-status'].textContent = room.admin?.forcedDice ? `Đã chọn: ${room.admin.forcedDice.map(id => symbols.get(id)?.name).join(' · ')}` : 'Máy chủ chọn ngẫu nhiên.';
}

function renderPlayers() {
  ui['player-count'].textContent = `${room.players.length} / ${room.capacity}`;
  ui['online-count'].textContent = `${room.players.filter(player => player.connected).length} đang kết nối`;
  ui['player-list'].replaceChildren(...room.players.map(player => {
    const row = element('li', `player-row${player.id === room.you.id ? ' is-you' : ''}${player.connected ? '' : ' offline'}`);
    const avatar = element('span', 'player-avatar', [...player.name.trim()][0]?.toLocaleUpperCase('vi-VN') || '?');
    avatar.setAttribute('aria-hidden', 'true');
    const copy = element('span', 'player-copy');
    copy.append(element('span', 'player-name', `${player.name}${player.id === room.you.id ? ' (bạn)' : ''}`));
    const tags = [player.id === room.hostId ? 'Chủ phòng' : 'Người chơi'];
    if (!player.connected) tags.push('Mất kết nối');
    else if (!player.eligible && ['betting', 'revealing'].includes(room.phase)) tags.push('Chờ ván sau');
    else tags.push('Đang online');
    copy.append(element('span', 'player-detail', tags.join(' · ')));
    row.append(avatar, copy, element('span', 'player-bet', player.betTotal > 0 ? `Đặt ${number(player.betTotal)}` : '—'));
    return row;
  }));
  const ranked = [...room.players].sort((a, b) => b.balance - a.balance || a.name.localeCompare(b.name, 'vi'));
  ui.leaderboard.replaceChildren(...ranked.map((player, index) => {
    const row = element('li');
    row.append(element('span', 'rank', String(index + 1).padStart(2, '0')), element('span', 'rank-name', `${player.name}${player.id === room.you.id ? ' (bạn)' : ''}`), element('span', 'rank-balance', bowl.covered() ? '•••' : number(player.balance)));
    return row;
  }));
}

function renderResults() {
  if (bowl.covered()) {
    ui['result-heading'].textContent = 'May mắn nằm dưới bát';
    ui['result-message'].textContent = 'Mở bát để xem xúc xắc và số xu nhận về.';
    for (const id of ['result-total-bet', 'result-total-return', 'result-profit', 'stat-games', 'stat-record', 'stat-win-rate', 'stat-highest-balance', 'stat-total-bet', 'stat-total-returned']) ui[id].textContent = '—';
    return;
  }
  const result = room.you.lastResult;
  const hasBet = result && result.totalBet > 0;
  ui['result-heading'].textContent = !hasBet ? 'Chờ chút may mắn' : result.profit > 0 ? 'May mắn ghé thăm!' : result.profit < 0 ? 'Hẹn may mắn ván sau' : 'Vừa vặn hòa vốn';
  ui['result-message'].textContent = hasBet ? 'Kết quả ván gần nhất bạn tham gia. Số xu đã được máy chủ cập nhật.' : room.phase === 'result' ? 'Bạn không đặt xu trong ván này. Cùng tham gia ván tiếp theo nhé.' : 'Kết quả xuất hiện sau mỗi ván bạn có đặt xu.';
  ui['result-total-bet'].textContent = hasBet ? number(result.totalBet) : '—';
  ui['result-total-return'].textContent = hasBet ? number(result.totalReturn) : '—';
  ui['result-profit'].textContent = hasBet ? signed(result.profit) : '—';
  ui['result-profit'].className = hasBet && result.profit > 0 ? 'positive' : hasBet && result.profit < 0 ? 'negative' : '';
  const stats = room.you.stats;
  ui['stat-games'].textContent = number(stats.gamesPlayed);
  ui['stat-record'].textContent = `${stats.wins} / ${stats.losses} / ${stats.breakEven}`;
  ui['stat-win-rate'].textContent = `${stats.gamesPlayed ? Math.round(stats.wins / stats.gamesPlayed * 100) : 0}%`;
  ui['stat-highest-balance'].textContent = number(stats.highestBalance);
  ui['stat-total-bet'].textContent = number(stats.totalBet);
  ui['stat-total-returned'].textContent = number(stats.totalReturned);
}

function renderHistory() {
  const history = room.history.filter(round => !bowl.covered() || round.id !== room.roundId);
  ui['history-empty'].hidden = history.length > 0;
  ui['history-list'].replaceChildren(...history.sort((a, b) => b.number - a.number).map(round => {
    const row = element('li', 'history-row');
    const dice = element('span', 'history-dice');
    for (const id of round.dice) dice.append(element('span', `dice-art art-${id}`));
    dice.setAttribute('aria-label', round.dice.map(id => symbols.get(id)?.name).join(', '));
    const result = round.results.find(item => item.playerId === room.you.id);
    const played = result && result.totalBet > 0;
    const outcome = element('span', `history-outcome${played ? result.profit > 0 ? ' positive' : result.profit < 0 ? ' negative' : '' : ''}`, played ? `${signed(result.profit)} xu` : 'Không đặt xu');
    outcome.append(element('small', '', played ? `Đặt ${number(result.totalBet)} · Nhận ${number(result.totalReturn)}` : `Cả bàn đặt ${number(round.totalBet)} xu`));
    row.append(element('span', 'history-round', `Ván ${round.number}${round.demo ? ' · Demo' : ''}`), dice, outcome);
    return row;
  }));
}

function send(event, payload = {}) {
  return new Promise((resolve, reject) => {
    if (!socket.connected || sessionReplaced) {
      reject(new Error('Đang mất kết nối. Cược chưa được gửi; hãy chờ kết nối lại.'));
      return;
    }
    // Volatile emits never buffer clicks while offline. A missing acknowledgement is reconciled, never replayed.
    socket.volatile.timeout(8000).emit(event, payload, (timeout, reply) => {
      if (timeout) {
        const error = new Error('Chưa nhận được xác nhận. Đang kiểm tra lại trạng thái; không tự gửi lại thao tác.');
        error.uncertain = true;
        reject(error);
      } else if (!reply?.ok) {
        const error = new Error(reply?.error?.message || 'Không thể thực hiện thao tác này.');
        error.code = reply?.error?.code;
        reject(error);
      } else resolve(reply);
    });
  });
}

function requestId() {
  // This identifies a command for deduplication; it is not an authentication credential.
  return globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

async function syncRoom(epoch = connectionEpoch) {
  synced = false;
  renderControls();
  const reply = await send('room:sync');
  if (epoch !== connectionEpoch) return;
  rememberSession(reply.session);
  applyState(reply.state);
  synced = true;
  renderControls();
}

async function mutate(event, payload, successMessage) {
  if (!room || busy || !synced || !socket.connected) return;
  const epoch = connectionEpoch;
  const actionControl = document.activeElement;
  busy = true;
  renderControls();
  try {
    const reply = await send(event, { ...payload, requestId: requestId() });
    if (epoch !== connectionEpoch) return;
    applyState(reply.state);
    notice(successMessage || phaseMessage());
  } catch (error) {
    if (epoch !== connectionEpoch) return;
    notice(error.message, true);
    try {
      if (socket.connected) {
        await syncRoom(epoch);
        if (epoch === connectionEpoch) notice(error.uncertain ? 'Đã đồng bộ lại. Kiểm tra số xu đã đặt trước khi thao tác tiếp; yêu cầu cũ không được gửi lại.' : error.message, true);
      }
    } catch {
      synced = false;
      notice('Chưa thể đồng bộ. Đang kết nối lại để xác nhận trạng thái phòng.', true);
      socket.disconnect().connect();
    }
  } finally {
    if (epoch === connectionEpoch) {
      busy = false;
      renderControls();
      // Disabling a pending button may move keyboard focus to the page body.
      if (document.activeElement === document.body && actionControl?.isConnected && !actionControl.matches(':disabled')) {
        actionControl.focus({ preventScroll: true });
      }
    }
  }
}

function placeBet(symbol) {
  if (!canBet()) return;
  if (selectedChip > room.you.balance - totalBet()) {
    notice(`Bạn chỉ còn ${number(room.you.balance - totalBet())} xu có thể đặt. Chọn chip nhỏ hơn hoặc xóa cược của mình.`, true);
    return;
  }
  mutate('bet:add', { roundId: room.roundId, symbol, ...(selectedChip === 'all' ? { allIn: true } : { amount: selectedChip }) });
}

function clearRoom(message) {
  bowl.reset();
  document.body.classList.remove('in-room');
  room = null;
  synced = false;
  busy = false;
  acceptingMembership = false;
  forgetSession();
  ui.game.hidden = true;
  ui.home.hidden = false;
  ui['invite-panel'].hidden = true;
  if (ui['reset-dialog'].open) ui['reset-dialog'].close();
  renderControls();
  notice(message);
}

async function enterRoom(event) {
  if (!config || busy || acceptingMembership || !socket.connected || sessionReplaced) return;
  const name = ui['player-name'].value.trim();
  ui['player-name'].value = name;
  if (!ui['player-name'].reportValidity()) return;
  const code = ui['room-code-input'].value.trim().toUpperCase();
  if (event === 'room:join' && !/^[A-Z0-9]{6}$/.test(code)) {
    notice('Nhập mã phòng gồm 6 chữ cái hoặc chữ số.', true);
    ui['room-code-input'].focus();
    return;
  }
  busy = true;
  acceptingMembership = true;
  renderControls();
  notice(event === 'room:create' ? 'Đang tạo một bàn chơi cho hội mình…' : 'Đang vào phòng…');
  const epoch = connectionEpoch;
  try {
    const reply = await send(event, event === 'room:create' ? { name } : { name, code });
    if (epoch !== connectionEpoch) return;
    rememberSession(reply.session);
    synced = true;
    applyState(reply.state);
    ui.game.scrollIntoView({ block: 'start' });
  } catch (error) {
    if (epoch !== connectionEpoch) return;
    if (error.uncertain && socket.connected) {
      try { await syncRoom(epoch); } catch { notice('Chưa xác nhận được việc vào phòng. Hãy thử kết nối lại; thao tác tạo/vào phòng chưa được tự gửi lại.', true); }
    } else notice(error.message, true);
  } finally {
    if (epoch === connectionEpoch) { busy = false; acceptingMembership = false; renderControls(); }
  }
}

async function resumeRoom(epoch) {
  acceptingMembership = true;
  synced = false;
  renderControls();
  notice('Đang khôi phục chỗ ngồi và đồng bộ số xu…');
  try {
    const reply = await send('room:resume', { token: savedSession.token });
    if (epoch !== connectionEpoch) return;
    rememberSession(reply.session);
    synced = true;
    applyState(reply.state);
    notice('Đã kết nối lại. Chỗ ngồi, số xu và cược được khôi phục từ máy chủ.');
  } catch (error) {
    if (epoch !== connectionEpoch) return;
    if (error.uncertain || !socket.connected || !['SESSION_EXPIRED', 'NOT_IN_ROOM'].includes(error.code)) {
      notice('Chưa khôi phục được phiên chơi. Hãy thử kết nối lại; cược không được tự gửi lại.', true);
      ui['retry-connection'].hidden = false;
    } else {
      clearRoom('Phiên chơi đã hết hạn hoặc máy chủ vừa khởi động lại. Bạn có thể tạo phòng mới hoặc nhập mã để tham gia lại.');
    }
  } finally {
    if (epoch === connectionEpoch) { acceptingMembership = false; renderControls(); }
  }
}

socket.on('connect', async () => {
  const epoch = ++connectionEpoch;
  busy = false;
  connectionStatus('Đã kết nối', 'connected');
  ui['retry-connection'].hidden = true;
  if (savedSession) await resumeRoom(epoch);
  else {
    if (room) clearRoom('Kết nối bị ngắt trước khi nhận được phiên chơi. Vui lòng tạo hoặc vào phòng lại.');
    synced = false;
    renderControls();
    notice('Sẵn sàng. Tạo phòng mới hoặc tham gia cùng bạn bè.');
  }
});

socket.on('disconnect', () => {
  connectionEpoch += 1;
  synced = false;
  busy = false;
  acceptingMembership = false;
  connectionStatus(sessionReplaced ? 'Phiên đã chuyển' : 'Đang kết nối lại', 'disconnected');
  renderControls();
  if (!sessionReplaced) notice('Mất kết nối. Đang tự kết nối lại; các nút đã khóa. Cược được máy chủ nhận trước đó vẫn được tính.', true);
});

socket.on('connect_error', () => {
  connectionStatus('Chưa kết nối', 'disconnected');
  ui['retry-connection'].hidden = false;
  renderControls();
  notice('Chưa kết nối được máy chủ. Kiểm tra mạng rồi thử lại; phòng và cược sẽ được đồng bộ khi kết nối trở lại.', true);
});

socket.on('room:state', state => {
  if (sessionReplaced || (!room && !acceptingMembership)) return;
  if (room && state.code !== room.code) return;
  applyState(state);
});

socket.on('session:replaced', () => {
  sessionReplaced = true;
  connectionEpoch += 1;
  socket.io.reconnection(false);
  socket.disconnect();
  clearRoom('Phiên chơi này đang được sử dụng ở một thẻ khác. Thẻ này đã ngắt kết nối để tránh điều khiển cùng một người chơi.');
  connectionStatus('Phiên đã chuyển', 'disconnected');
  ui['retry-connection'].hidden = false;
  ui['retry-connection'].textContent = 'Kết nối như người chơi mới';
});

socket.on('room:kicked', () => {
  connectionEpoch += 1;
  clearRoom('Bạn đã được chủ phòng đưa ra khỏi phòng.');
  ui.home.scrollIntoView({ block: 'start' });
});

function adminCommand(event, payload = {}, message) {
  if (!room || room.hostId !== room.you.id) return;
  return mutate(event, { ...payload, gameId: room.gameId, roundNumber: room.roundNumber }, message);
}
ui['all-in'].addEventListener('click', () => { selectedChip = 'all'; renderSelectedChip(); });
ui['apply-chip'].addEventListener('click', () => {
  const input = ui['custom-chip'];
  const amount = input.valueAsNumber;
  if (!input.value || !input.reportValidity() || !Number.isSafeInteger(amount) || amount < 1) {
    notice('Nhập số xu nguyên dương để chọn mức cược.', true);
    input.focus();
    return;
  }
  selectedChip = amount;
  renderSelectedChip();
});
ui['admin-player'].addEventListener('change', renderControls);
ui['pause-room'].addEventListener('click', () => adminCommand('host:pause', { paused: !room.paused }));
ui['lock-room'].addEventListener('click', () => adminCommand('host:lock', { locked: !room.locked }, room.locked ? 'Đã mở khóa phòng.' : 'Đã khóa phòng, không nhận người mới.'));
ui['cancel-round'].addEventListener('click', () => {
  if (confirm('Hủy toàn bộ cược ván này và mở một ván mới?')) adminCommand('host:cancel', {}, 'Đã hủy ván và hoàn toàn bộ cược.');
});
ui['grant-coins'].addEventListener('click', () => {
  const input = ui['grant-amount'];
  if (!input.value || !input.reportValidity()) return;
  adminCommand('host:grant', { playerId: ui['admin-player'].value, amount: input.valueAsNumber }, 'Đã cấp xu cho người chơi.');
});
ui['kick-player'].addEventListener('click', () => {
  if (confirm('Đuổi người chơi đã chọn? Cược chưa lắc của người này sẽ bị hủy.')) adminCommand('host:kick', { playerId: ui['admin-player'].value }, 'Đã đưa người chơi ra khỏi phòng.');
});
ui['transfer-host'].addEventListener('click', () => {
  if (confirm('Chuyển quyền quản trị? Bạn sẽ trở thành người chơi thường.')) adminCommand('host:transfer', { playerId: ui['admin-player'].value });
});
ui['set-result'].addEventListener('click', () => adminCommand('host:result', { dice: [1, 2, 3].map(index => ui[`demo-dice-${index}`].value) }, 'Đã đặt kết quả cho ván demo này.'));
ui['random-result'].addEventListener('click', () => adminCommand('host:result', { dice: null }, 'Đã chuyển về kết quả ngẫu nhiên.'));

ui['lobby-form'].addEventListener('submit', event => { event.preventDefault(); enterRoom('room:create'); });
ui['join-room'].addEventListener('click', () => enterRoom('room:join'));
ui['room-code-input'].addEventListener('input', () => { ui['room-code-input'].value = ui['room-code-input'].value.toUpperCase().replace(/[^A-Z0-9]/g, ''); });
ui['room-code-input'].addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); enterRoom('room:join'); } });
ui['reset-bet'].addEventListener('click', () => { if (canBet()) mutate('bet:clear', { roundId: room.roundId }, 'Đã xóa cược của bạn. Số xu trong ví không thay đổi.'); });
ui['open-round'].addEventListener('click', () => { if (room) mutate('round:open', { gameId: room.gameId, roundNumber: room.roundNumber }); });
ui.shake.addEventListener('click', () => { if (room) mutate('round:shake', { roundId: room.roundId }); });
ui['reset-room'].addEventListener('click', () => { if (!ui['reset-room'].disabled) ui['reset-dialog'].showModal(); });
ui['cancel-reset'].addEventListener('click', () => ui['reset-dialog'].close());
ui['confirm-reset'].addEventListener('click', () => {
  ui['reset-dialog'].close();
  if (room) mutate('room:reset', { gameId: room.gameId, roundNumber: room.roundNumber });
});
ui['leave-room'].addEventListener('click', async () => {
  if (!room || busy || !synced || !socket.connected) return;
  if (['betting', 'revealing'].includes(room.phase) && totalBet() > 0) {
    notice(room.phase === 'betting' ? 'Bạn đang có cược. Xóa cược của mình trước khi rời phòng, hoặc chờ ván kết thúc.' : 'Cược đang được tính. Bạn có thể rời phòng sau khi ván kết thúc.', true);
    return;
  }
  busy = true;
  renderControls();
  const epoch = connectionEpoch;
  try {
    await send('room:leave');
    if (epoch !== connectionEpoch) return;
    connectionEpoch += 1;
    clearRoom('Bạn đã rời phòng. Tạo phòng mới hoặc tham gia một bàn khác nhé.');
    ui.home.scrollIntoView({ block: 'start' });
  } catch (error) {
    if (epoch === connectionEpoch) {
      if (error.uncertain) {
        try { await syncRoom(epoch); } catch { clearRoom('Không còn phiên chơi trong phòng. Bạn có thể vào lại bằng mã phòng.'); }
      } else notice(error.message, true);
    }
  } finally { busy = false; renderControls(); }
});

ui['invite-button'].addEventListener('click', () => {
  const link = new URL(location.href);
  link.search = '';
  link.hash = '';
  link.searchParams.set('room', room.code);
  ui['invite-link'].value = link.href;
  ui['invite-panel'].hidden = !ui['invite-panel'].hidden;
  ui['invite-button'].setAttribute('aria-expanded', String(!ui['invite-panel'].hidden));
  if (!ui['invite-panel'].hidden) { ui['invite-link'].focus(); ui['invite-link'].select(); }
});
ui['copy-link'].addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(ui['invite-link'].value);
    ui['copy-status'].textContent = 'Đã sao chép. Gửi liên kết này cho hội bạn nhé!';
  } catch {
    ui['invite-link'].focus();
    ui['invite-link'].select();
    ui['copy-status'].textContent = 'Liên kết đã được chọn. Nhấn giữ để sao chép trên điện thoại, hoặc Ctrl+C trên máy tính.';
  }
});
ui['retry-connection'].addEventListener('click', () => {
  sessionReplaced = false;
  socket.io.reconnection(true);
  ui['retry-connection'].textContent = 'Thử kết nối lại';
  if (!config) initialize();
  else if (socket.connected && savedSession) resumeRoom(connectionEpoch);
  else socket.connect();
});

document.addEventListener('visibilitychange', () => {
  if (!document.hidden && room && socket.connected && !busy && !acceptingMembership) {
    syncRoom().catch(() => { synced = false; renderControls(); notice('Chưa đồng bộ được phòng. Đang kết nối lại.', true); socket.disconnect().connect(); });
  }
});

async function initialize() {
  if (loadingConfig) return;
  loadingConfig = true;
  ui['retry-connection'].hidden = true;
  notice('Đang kết nối với bàn chơi…');
  try {
    const response = await fetch('/api/config', { signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error('Không tải được cấu hình.');
    const loaded = await response.json();
    if (!Array.isArray(loaded.symbols) || loaded.symbols.length !== 6 || !loaded.symbols.every(symbol => typeof symbol.id === 'string' && typeof symbol.name === 'string' && typeof symbol.icon === 'string') || !Array.isArray(loaded.chips) || !loaded.chips.length || !loaded.chips.every(amount => Number.isSafeInteger(amount) && amount > 0)) throw new Error('Cấu hình không hợp lệ.');
    config = loaded;
    symbols = new Map(config.symbols.map(symbol => [symbol.id, symbol]));
    buildBoard();
    socket.connect();
  } catch {
    connectionStatus('Chưa kết nối', 'disconnected');
    notice('Chưa tải được bàn chơi. Kiểm tra kết nối mạng hoặc chờ máy chủ khởi động rồi thử lại.', true);
    ui['retry-connection'].hidden = false;
  } finally { loadingConfig = false; renderControls(); }
}

const invitation = new URLSearchParams(location.search).get('room')?.toUpperCase();
if (invitation && /^[A-Z0-9]{6}$/.test(invitation)) ui['room-code-input'].value = invitation;
if (savedSession?.name) ui['player-name'].value = savedSession.name;
initialize();
