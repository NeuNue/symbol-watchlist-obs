(function() {
  const STORAGE_KEY = 'obs_crypto_symbols';
  const BINANCE_API = 'https://fapi.binance.com/fapi/v1';
  const REFRESH_INTERVAL = 5000;

  let previousPrices = {};
  let priceHistory = {};
  let tickInterval = null;
  let klineInitialized = {};

  function getSymbols() {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      try {
        return JSON.parse(stored);
      } catch (e) {
        console.error('Failed to parse stored symbols:', e);
      }
    }
    return ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT'];
  }

  function isUSMarketHours() {
    const now = new Date();
    const utcHours = now.getUTCHours();
    const utcMinutes = now.getUTCMinutes();
    const dayOfWeek = now.getUTCDay();

    // 0 = Sunday, 1 = Saturday (UTC)
    // Skip weekends
    if (dayOfWeek === 0 || dayOfWeek === 6) return false;

    // Convert UTC to EST/EDT
    // EDT (summer): UTC-4, EST (winter): UTC-5
    // US market hours: 9:30 AM - 4:00 PM EST/EDT
    // EDT: 9:30 AM EDT = 13:30 UTC, 4:00 PM EDT = 20:00 UTC
    // EST: 9:30 AM EST = 14:30 UTC, 4:00 PM EST = 21:00 UTC

    // Simple check: assume EDT (summer) Mar-Nov
    const month = now.getUTCMonth();
    const isSummerTime = month >= 3 && month <= 10;

    const offset = isSummerTime ? 4 : 5;
    let localHour = utcHours - offset;
    if (localHour < 0) localHour += 24;
    if (localHour >= 24) localHour -= 24;

    const totalMinutes = localHour * 60 + utcMinutes;

    // Market open: 9:30 AM (570 min), close: 4:00 PM (960 min)
    return totalMinutes >= 570 && totalMinutes <= 960;
  }

  function formatPrice(price) {
    if (!price && price !== 0) return '--';
    const p = parseFloat(price);
    if (isNaN(p)) return '--';
    if (p >= 1000) return p.toFixed(2);
    if (p >= 1) return p.toFixed(p % 1 === 0 ? 0 : 2);
    return p.toPrecision(4);
  }

  function formatChange(change, changePercent) {
    if (!change && change !== 0) return { text: '--', class: '' };
    const sign = change >= 0 ? '+' : '';
    const pct = changePercent !== undefined ? `${sign}${changePercent.toFixed(2)}%` : '';
    return {
      text: `${sign}${parseFloat(change).toFixed(2)} ${pct}`,
      class: change >= 0 ? 'positive' : 'negative'
    };
  }

  function createSparklineSVG(prices, isPositive) {
    if (!prices || prices.length < 2) {
      return '';
    }

    const width = 60;
    const height = 24;
    const color = isPositive ? '#27c93f' : '#ff5f56';

    const min = Math.min(...prices);
    const max = Math.max(...prices);
    const range = max - min || 1;

    const points = prices.map((p, i) => {
      const x = (i / (prices.length - 1)) * width;
      const y = height - 2 - ((p - min) / range) * (height - 4);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    });

    return `<svg class="sparkline" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">
      <polyline fill="none" stroke="${color}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" points="${points.join(' ')}"/>
    </svg>`;
  }

  function applyTickEffect(symbol, direction) {
    const td = document.querySelector(`tr[data-symbol="${symbol}"] .col-price`);
    if (!td) return;

    td.classList.remove('tick-up', 'tick-down', 'price-up', 'price-down');
    void td.offsetWidth;
    td.classList.add(direction > 0 ? 'tick-up' : 'tick-down');
  }

  function updateRowDisplay(symbol, data) {
    const tr = document.querySelector(`tr[data-symbol="${symbol}"]`);
    if (!tr) return;

    const changeTd = tr.querySelector('.col-change');
    const changeCell = tr.querySelector('.col-change-cell');

    let change, changePercent;
    if (isUSMarketHours()) {
      // Use previous close for comparison during US market hours
      change = parseFloat(data.lastPrice) - parseFloat(data.prevClosePrice);
      changePercent = parseFloat(data.prevClosePrice) > 0
        ? (change / parseFloat(data.prevClosePrice)) * 100
        : 0;
    } else {
      // Use 24h change outside market hours
      change = parseFloat(data.priceChange) || 0;
      changePercent = parseFloat(data.priceChangePercent) || 0;
    }

    const changeInfo = formatChange(change, changePercent);

    if (changeTd) {
      changeTd.textContent = changeInfo.text;
      changeTd.className = `col-change ${changeInfo.class}`;
    }
    if (changeCell) {
      const prices = priceHistory[symbol] || [];
      changeCell.innerHTML = `
        <span class="col-sparkline">${createSparklineSVG(prices, change >= 0)}</span>
        <span class="col-change ${changeInfo.class}">${changeInfo.text}</span>
      `;
    }
  }

  function updateRowWithNewData(symbol, data) {
    const tr = document.querySelector(`tr[data-symbol="${symbol}"]`);
    if (!tr) return;

    const prevPrice = previousPrices[symbol] || 0;
    const newPrice = parseFloat(data.lastPrice) || 0;

    if (prevPrice > 0 && newPrice > 0 && prevPrice !== newPrice) {
      const direction = newPrice > prevPrice ? 1 : -1;
      applyTickEffect(symbol, direction);
    }

    previousPrices[symbol] = newPrice;

    const priceTd = tr.querySelector('.col-price');
    if (priceTd) {
      priceTd.textContent = formatPrice(data.lastPrice);
      if (prevPrice > 0 && newPrice > 0) {
        priceTd.classList.remove('price-up', 'price-down');
        if (newPrice > prevPrice) {
          priceTd.classList.add('price-up');
        } else if (newPrice < prevPrice) {
          priceTd.classList.add('price-down');
        }
      }
    }

    if (klineInitialized[symbol] && priceHistory[symbol]) {
      priceHistory[symbol][priceHistory[symbol].length - 1] = newPrice;
      updateRowDisplay(symbol, data);
    }
  }

  async function fetchKlines(symbol) {
    try {
      const url = `${BINANCE_API}/klines?symbol=${symbol}&interval=15m&limit=96`;
      const response = await fetch(url);
      if (!response.ok) return;
      const data = await response.json();
      const closePrices = data.map(k => parseFloat(k[4]));
      return closePrices;
    } catch (e) {
      console.error(`Error fetching klines for ${symbol}:`, e);
      return [];
    }
  }

  async function fetchAndUpdate(symbol) {
    try {
      const url = `${BINANCE_API}/ticker/24hr?symbol=${symbol}`;
      const response = await fetch(url);
      if (!response.ok) return;
      const data = await response.json();
      updateRowWithNewData(symbol, data);
    } catch (e) {
      console.error(`Error fetching ${symbol}:`, e);
    }
  }

  function simulateLiveTicks() {
    const symbols = getSymbols();
    symbols.forEach(symbol => {
      fetchAndUpdate(symbol);
    });
  }

  async function initKlines() {
    const symbols = getSymbols();
    for (const symbol of symbols) {
      const klines = await fetchKlines(symbol);
      if (klines.length > 0) {
        priceHistory[symbol] = klines;
        klineInitialized[symbol] = true;
      }
    }
  }

  function init() {
    const symbols = getSymbols();
    const content = document.getElementById('content');

    if (!symbols || symbols.length === 0) {
      content.innerHTML = `
        <div class="empty-state">
          <h3>No symbols configured</h3>
          <p>Please <a href="config.html">configure your watchlist</a> first.</p>
        </div>
      `;
      return;
    }

    symbols.forEach(s => {
      priceHistory[s] = [];
    });

    content.innerHTML = `
      <table class="stock-table">
        <thead>
          <tr>
            <th>Symbol</th>
            <th>Price</th>
            <th>Change</th>
          </tr>
        </thead>
        <tbody id="stockTableBody">
          ${symbols.map(s => {
            const changeInfo = { text: '--', class: '' };
            return `
              <tr class="stock-row" data-symbol="${s}">
                <td class="col-symbol">${s.replace(/USDT|USD/g, '')}</td>
                <td class="col-price">--</td>
                <td class="col-change-cell">
                  <span class="col-sparkline">${createSparklineSVG([], true)}</span>
                  <span class="col-change">${changeInfo.text}</span>
                </td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    `;

    initKlines().then(() => {
      simulateLiveTicks();
      tickInterval = setInterval(() => {
        const jitter = Math.random() * 5000;
        setTimeout(simulateLiveTicks, jitter);
      }, REFRESH_INTERVAL);
    });
  }

  document.addEventListener('DOMContentLoaded', init);
})();