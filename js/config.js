(function() {
  const STORAGE_KEY = 'obs_crypto_symbols';

  function getSymbols() {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      try {
        return JSON.parse(stored);
      } catch (e) {
        console.error('Failed to parse stored symbols:', e);
      }
    }
    return [];
  }

  function saveSymbols(symbols) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(symbols));
  }

  function normalizeSymbol(symbol) {
    symbol = symbol.trim().toUpperCase();
    if (!symbol.endsWith('USDT')) {
      symbol = symbol + 'USDT';
    }
    return symbol;
  }

  function showMessage(text, isError = false) {
    const msgEl = document.getElementById('message');
    msgEl.textContent = text;
    msgEl.className = 'message ' + (isError ? 'error' : 'success');
    setTimeout(() => {
      msgEl.textContent = '';
      msgEl.className = 'message';
    }, 3000);
  }

  function updateCurrentSymbols() {
    const symbols = getSymbols();
    const container = document.getElementById('currentSymbols');

    if (symbols.length === 0) {
      container.innerHTML = '<span class="no-symbols">No symbols configured yet</span>';
      return;
    }

    container.innerHTML = symbols.map(s =>
      `<span class="symbol-tag">${s}</span>`
    ).join('');
  }

  function handleSave() {
    const input = document.getElementById('manualSymbols').value.trim();
    if (!input) {
      showMessage('Please enter at least one symbol', true);
      return;
    }

    const symbols = input
      .split(',')
      .map(s => s.trim())
      .filter(s => s.length > 0)
      .map(normalizeSymbol);

    if (symbols.length === 0) {
      showMessage('No valid symbols found', true);
      return;
    }

    saveSymbols(symbols);
    updateCurrentSymbols();
    showMessage(`Saved ${symbols.length} symbol(s)`);
  }

  document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('saveBtn').addEventListener('click', handleSave);
    updateCurrentSymbols();
  });
})();