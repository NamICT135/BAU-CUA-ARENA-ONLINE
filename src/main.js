import './style.css';

const symbolButtons = [...document.querySelectorAll('.symbol-card')];
const chipButtons = [...document.querySelectorAll('.chip-button')];
const bettingControls = document.querySelectorAll('.symbol-controls, .chip-selector, #reset-bet');
const balanceElements = document.querySelectorAll('#balance, #result-balance, #stat-balance');
const totalBetElement = document.getElementById('total-bet');
const statusElement = document.getElementById('result-message');
const selectedChipElement = document.getElementById('selected-chip-label');
const resetButton = document.getElementById('reset-bet');

// Cache each symbol's amount element once, keeping the existing semantic HTML.
const betDisplays = symbolButtons.map(button => ({
  symbol: button.dataset.symbol,
  element: button.querySelector('.bet-value'),
}));

let config = null;
let currentBalance = null;
let selectedChip = null;
// The reference stays constant; only the individual bet amounts change.
const bets = {};

function setBettingEnabled(enabled) {
  bettingControls.forEach(control => {
    control.disabled = !enabled;
  });
}

function showStatus(message, isError = false) {
  statusElement.textContent = message;
  statusElement.classList.toggle('status-error', isError);
}

async function fetchJson(path) {
  const response = await fetch(path);
  if (!response.ok) {
    throw new Error(`${path}: HTTP ${response.status}`);
  }
  return await response.json();
}

function validateInitialData(loadedConfig, serverState) {
  if (!Array.isArray(loadedConfig.symbols) || !Array.isArray(loadedConfig.chips)) {
    throw new Error('The game configuration is missing symbols or chips.');
  }
  if (!loadedConfig.chips.length || !loadedConfig.chips.every(chip => Number.isSafeInteger(chip) && chip > 0)) {
    throw new Error('The configuration contains invalid chip values.');
  }

  const symbolIds = loadedConfig.symbols.map(symbol => symbol.id);
  const chipValues = chipButtons.map(button => Number(button.dataset.chip));
  if (symbolIds.length !== symbolButtons.length ||
      !symbolIds.every(id => symbolButtons.some(button => button.dataset.symbol === id)) ||
      !symbolButtons.every(button => symbolIds.includes(button.dataset.symbol))) {
    throw new Error('The symbol controls do not match the server configuration.');
  }
  if (loadedConfig.chips.length !== chipValues.length ||
      !loadedConfig.chips.every(chip => chipValues.includes(chip)) ||
      !chipValues.every(chip => loadedConfig.chips.includes(chip))) {
    throw new Error('The chip controls do not match the server configuration.');
  }
  if (!Number.isSafeInteger(serverState.balance) || serverState.balance < 0 || !Array.isArray(serverState.history)) {
    throw new Error('The server returned an invalid game state.');
  }
}

async function loadInitialData() {
  setBettingEnabled(false);
  showStatus('Loading game configuration and balance…');

  try {
    const loadedConfig = await fetchJson('/api/config');
    const serverState = await fetchJson('/api/state');
    validateInitialData(loadedConfig, serverState);

    config = loadedConfig;
    currentBalance = serverState.balance;
    selectedChip = config.chips[0];
    config.symbols.forEach(symbol => {
      bets[symbol.id] = 0;
    });

    renderBalance();
    renderBets();
    renderTotalBet();
    setSelectedChipUI();
    attachEventListeners();
    setBettingEnabled(true);
    showStatus('Betting is ready. Select a chip and choose your symbols.');
  } catch (error) {
    setBettingEnabled(false);
    showStatus('Could not load the game. Make sure the Node server is running, then reload the page.', true);
    console.error('Game initialization failed:', error);
  }
}

function selectChip(value) {
  if (!config.chips.includes(value)) return;
  selectedChip = value;
  setSelectedChipUI();
  showStatus(`Selected ${selectedChip} coins. Choose a symbol.`);
}

function setSelectedChipUI() {
  chipButtons.forEach(button => {
    const isSelected = Number(button.dataset.chip) === selectedChip;
    button.classList.toggle('selected', isSelected);
    button.setAttribute('aria-pressed', String(isSelected));
  });
  selectedChipElement.textContent = `Selected: ${selectedChip} virtual coins`;
}

function getTotalBet() {
  return Object.values(bets).reduce((sum, value) => sum + value, 0);
}

function placeBet(symbol) {
  if (!Object.hasOwn(bets, symbol)) return;
  const availableBalance = currentBalance - getTotalBet();
  if (selectedChip > availableBalance) {
    showStatus(`Bet exceeds available balance. You have ${availableBalance.toLocaleString('en-US')} coins available.`, true);
    return;
  }

  bets[symbol] += selectedChip;
  renderBets();
  renderTotalBet();
  showStatus(`Bet placed. ${(currentBalance - getTotalBet()).toLocaleString('en-US')} coins available.`);
}

function resetBets() {
  Object.keys(bets).forEach(symbol => {
    bets[symbol] = 0;
  });
  renderBets();
  renderTotalBet();
  showStatus('Bets cleared. Your balance is unchanged.');
}

function renderBets() {
  betDisplays.forEach(display => {
    display.element.textContent = bets[display.symbol].toLocaleString('en-US');
  });
}

function renderBalance() {
  balanceElements.forEach(element => {
    element.textContent = currentBalance.toLocaleString('en-US');
  });
}

function renderTotalBet() {
  totalBetElement.textContent = getTotalBet().toLocaleString('en-US');
}

function attachEventListeners() {
  chipButtons.forEach(button => {
    button.addEventListener('click', () => selectChip(Number(button.dataset.chip)));
  });
  symbolButtons.forEach(button => {
    button.addEventListener('click', () => placeBet(button.dataset.symbol));
  });
  resetButton.addEventListener('click', resetBets);
}

loadInitialData();
