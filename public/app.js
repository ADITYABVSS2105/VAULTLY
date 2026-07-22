/* ==========================================================
   Vaultly — Frontend App Logic (PostgreSQL Backend)
   ========================================================== */

const API = '';  // Same origin — Express serves static files too

// Extract YYYY-MM-DD from a DB date field safely (avoids UTC timezone shift)
function toDateStr(val) {
  if (!val) return '';
  const s = typeof val === 'string' ? val : val.toISOString();
  // PG DATE type comes back as "2026-07-22T00:00:00.000Z" — just slice the date part
  return s.slice(0, 10);
}

// ---- Constants ----
const CATEGORIES = {
  debit: [
    'Food & Dining', 'Shopping & Clothes', 'Bills & Utilities',
    'Travel & Transport', 'Entertainment & Movies', 'Health & Medical',
    'Investments & Savings', 'Other'
  ],
  credit: [
    'Salary & Wages', 'Freelance & Side Income', 'Investments & Savings',
    'Gift & Cash Received', 'Other'
  ]
};

const CHART_COLORS = [
  '#E8A838','#34D399','#FB7185','#60A5FA','#A78BFA','#F472B6','#2DD4BF','#FBBF24'
];

const CAT_ICONS = {
  'Food & Dining':          'ri-restaurant-2-line',
  'Shopping & Clothes':     'ri-shopping-bag-2-line',
  'Bills & Utilities':      'ri-lightbulb-flash-line',
  'Travel & Transport':     'ri-roadster-line',
  'Entertainment & Movies': 'ri-film-line',
  'Health & Medical':       'ri-heart-pulse-line',
  'Investments & Savings':  'ri-line-chart-line',
  'Salary & Wages':         'ri-bank-line',
  'Freelance & Side Income':'ri-suitcase-line',
  'Gift & Cash Received':   'ri-gift-line',
  'Other':                  'ri-more-fill'
};

// ---- State ----
let state = {
  user:         null,
  token:        null,
  transactions: [],
  budgets:      {},
  filters:      { search: '', type: 'all', category: 'all' },
  theme:        'dark',
  loading:      false,
};

// ─────────────────────────────────────────────
// INIT
// ─────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  applyTheme(localStorage.getItem('vaultly_theme') || 'dark');
  const token = localStorage.getItem('vaultly_token');
  const user  = localStorage.getItem('vaultly_user');
  if (token && user) {
    try {
      state.token = token;
      state.user  = JSON.parse(user);
      showDashboard();
    } catch (_) { showAuth(); }
  } else {
    showAuth();
  }
  setTodayDate();
});

function setTodayDate() {
  const el = document.getElementById('todayDate');
  if (el) el.textContent = new Date().toLocaleDateString('en-IN', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
  });
}

// ─────────────────────────────────────────────
// THEME
// ─────────────────────────────────────────────
function applyTheme(theme) {
  state.theme = theme;
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('vaultly_theme', theme);
  const icon  = document.getElementById('themeIcon');
  const label = document.getElementById('themeLabel');
  if (icon)  icon.className   = theme === 'dark' ? 'ri-sun-line' : 'ri-moon-line';
  if (label) label.textContent = theme === 'dark' ? 'Light mode' : 'Dark mode';
}
function toggleTheme() { applyTheme(state.theme === 'dark' ? 'light' : 'dark'); drawChart(); }

// ─────────────────────────────────────────────
// API HELPER
// ─────────────────────────────────────────────
async function apiFetch(path, options = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (state.token) headers['Authorization'] = `Bearer ${state.token}`;

  const res = await fetch(API + path, { ...options, headers: { ...headers, ...options.headers } });
  const data = await res.json().catch(() => ({}));

  if (res.status === 401) {
    // Token expired
    doLogout(false);
    showToast('Session expired. Please sign in again.');
    return null;
  }
  if (!res.ok) {
    showToast(data.error || 'Something went wrong.');
    return null;
  }
  return data;
}

// ─────────────────────────────────────────────
// AUTH — VIEWS
// ─────────────────────────────────────────────
let signupMode = false;

function showAuth() {
  document.getElementById('authContainer').style.display = 'grid';
  document.getElementById('appContainer').style.display  = 'none';
}

function showDashboard() {
  document.getElementById('authContainer').style.display = 'none';
  document.getElementById('appContainer').style.display  = 'flex';
  updateUserUI();
  updateCategorySelect('debit');
  loadAll();
}

function updateUserUI() {
  if (!state.user) return;
  document.getElementById('userAvatar').textContent      = state.user.name.charAt(0).toUpperCase();
  document.getElementById('userNameDisplay').textContent = state.user.name;
}

function toggleAuthMode(e) {
  e.preventDefault();
  signupMode = !signupMode;
  const nameG  = document.getElementById('nameGroup');
  const title  = document.getElementById('authTitle');
  const sub    = document.getElementById('authSubtitle');
  const btn    = document.getElementById('authSubmitBtn');
  const toggle = document.getElementById('authToggleText');

  if (signupMode) {
    nameG.classList.remove('hidden');
    title.textContent = 'Create account';
    sub.textContent   = 'Fill in your details to get started.';
    btn.innerHTML     = 'Create account <i class="ri-arrow-right-line"></i>';
    toggle.innerHTML  = 'Already have an account? <a href="#" onclick="toggleAuthMode(event)">Sign in</a>';
  } else {
    nameG.classList.add('hidden');
    title.textContent = 'Sign in';
    sub.textContent   = 'Welcome back. Enter your details below.';
    btn.innerHTML     = 'Sign in <i class="ri-arrow-right-line"></i>';
    toggle.innerHTML  = 'No account? <a href="#" onclick="toggleAuthMode(event)">Create one free</a>';
  }
}

// ─────────────────────────────────────────────
// AUTH — SUBMIT
// ─────────────────────────────────────────────
async function handleAuthSubmit(e) {
  e.preventDefault();
  const email    = document.getElementById('authEmail').value.trim();
  const password = document.getElementById('authPassword').value;
  const name     = signupMode ? document.getElementById('authName').value.trim() : undefined;

  const btn = document.getElementById('authSubmitBtn');
  btn.disabled = true;
  btn.innerHTML = '<i class="ri-loader-4-line"></i> Please wait…';

  const endpoint = signupMode ? '/api/auth/register' : '/api/auth/login';
  const body     = signupMode ? { name, email, password } : { email, password };

  const data = await apiFetch(endpoint, { method: 'POST', body: JSON.stringify(body) });

  btn.disabled = false;
  btn.innerHTML = signupMode
    ? 'Create account <i class="ri-arrow-right-line"></i>'
    : 'Sign in <i class="ri-arrow-right-line"></i>';

  if (!data) return;

  state.token = data.token;
  state.user  = data.user;
  localStorage.setItem('vaultly_token', data.token);
  localStorage.setItem('vaultly_user',  JSON.stringify(data.user));

  showToast(`Welcome, ${data.user.name.split(' ')[0]}! 👋`);
  showDashboard();
}

async function loginAsDemo() {
  document.getElementById('authEmail').value    = 'demo@vaultly.app';
  document.getElementById('authPassword').value = 'demo1234';
  if (signupMode) toggleAuthMode({ preventDefault: () => {} });
  // Submit programmatically
  const data = await apiFetch('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: 'demo@vaultly.app', password: 'demo1234' })
  });
  if (!data) return;
  state.token = data.token;
  state.user  = data.user;
  localStorage.setItem('vaultly_token', data.token);
  localStorage.setItem('vaultly_user',  JSON.stringify(data.user));
  showToast(`Welcome back, ${data.user.name.split(' ')[0]}! 👋`);
  showDashboard();
}

function logout() {
  if (!confirm('Log out of Vaultly?')) return;
  doLogout(true);
}

function doLogout(notify = true) {
  localStorage.removeItem('vaultly_token');
  localStorage.removeItem('vaultly_user');
  state.token        = null;
  state.user         = null;
  state.transactions = [];
  state.budgets      = {};
  if (notify) showToast('Logged out.');
  showAuth();
}

// ─────────────────────────────────────────────
// LOAD ALL DATA
// ─────────────────────────────────────────────
async function loadAll() {
  setLoading(true);
  const [txs, buds] = await Promise.all([
    apiFetch('/api/transactions'),
    apiFetch('/api/budgets'),
  ]);
  if (txs  !== null) state.transactions = txs;
  if (buds !== null) state.budgets      = buds;
  setLoading(false);
  render();
}

function setLoading(on) {
  state.loading = on;
  const tl = document.getElementById('timelineContainer');
  if (on && tl) {
    tl.innerHTML = `
      <div class="tx-empty">
        <i class="ri-loader-4-line" style="animation:spin 1s linear infinite"></i>
        <h4>Loading…</h4>
      </div>`;
  }
}

// ─────────────────────────────────────────────
// RENDER
// ─────────────────────────────────────────────
function render() {
  renderStats();
  renderBudgets();
  renderTimeline();
  drawChart();
  setTodayDate();
}

// Stats
function renderStats() {
  let credit = 0, debit = 0;
  const dates = new Set();
  state.transactions.forEach(t => {
    if (t.type === 'credit') credit += parseFloat(t.amount);
    else                     debit  += parseFloat(t.amount);
    dates.add(t.date);
  });
  const balance  = credit - debit;
  const rate     = credit > 0 ? Math.max(0, Math.round(((credit - debit) / credit) * 100)) : 0;
  const dayCount = Math.max(1, dates.size);
  const daily    = debit / dayCount;

  document.getElementById('netBalance').textContent   = fmtRupee(balance);
  document.getElementById('totalCredit').textContent  = `+${fmtRupee(credit)}`;
  document.getElementById('totalDebit').textContent   = `−${fmtRupee(debit)}`;
  document.getElementById('dailyAverage').textContent = fmtRupee(daily);

  const chip = document.getElementById('savingsRateBadge');
  chip.textContent     = `${rate}% savings rate`;
  chip.style.background = rate < 10 ? 'var(--debit-dim)' : 'var(--credit-dim)';
  chip.style.color      = rate < 10 ? 'var(--debit)'     : 'var(--credit)';
}

// Budgets
function renderBudgets() {
  const spent = {};
  state.transactions.forEach(t => {
    if (t.type === 'debit') spent[t.category] = (spent[t.category] || 0) + parseFloat(t.amount);
  });

  const list = document.getElementById('budgetList');
  list.innerHTML = '';

  const entries = Object.entries(state.budgets);
  if (!entries.length) {
    list.innerHTML = '<p class="text-muted" style="font-size:.85rem;padding:.5rem 0">No budgets set yet. Click "Set limits".</p>';
    return;
  }

  entries.forEach(([cat, limit]) => {
    const s   = spent[cat] || 0;
    const pct = Math.min(100, Math.round((s / limit) * 100));
    const bar = pct > 85 ? 'var(--debit)' : pct > 60 ? 'var(--warn)' : 'var(--credit)';
    const row = document.createElement('div');
    row.className = 'b-row';
    row.innerHTML = `
      <div class="b-row-hd">
        <span class="b-cat">${esc(cat)}</span>
        <span class="b-nums">${fmtRupee(s)} / ${fmtRupee(limit)} <em style="color:${bar}">${pct}%</em></span>
      </div>
      <div class="b-bar-bg"><div class="b-bar-fill" style="width:${pct}%;background:${bar}"></div></div>`;
    list.appendChild(row);
  });
}

async function promptSetBudget() {
  const cat = prompt('Category to set limit for:', 'Food & Dining');
  if (!cat) return;
  const current = state.budgets[cat] || 5000;
  const val = prompt(`Monthly limit (₹) for "${cat}":`, current);
  if (val === null || isNaN(val) || parseFloat(val) < 0) return;

  const data = await apiFetch('/api/budgets', {
    method: 'PUT',
    body: JSON.stringify({ category: cat, limit_amount: parseFloat(val) })
  });
  if (!data) return;
  state.budgets[cat] = data.limit_amount;
  renderBudgets();
  showToast(`Budget updated for ${cat}`);
}

// Timeline
function renderTimeline() {
  const container = document.getElementById('timelineContainer');
  container.innerHTML = '';

  const q = state.filters.search.toLowerCase();
  const filtered = state.transactions.filter(t => {
    const matchQ    = !q || t.title.toLowerCase().includes(q) || (t.note||'').toLowerCase().includes(q) || t.category.toLowerCase().includes(q);
    const matchType = state.filters.type === 'all' || t.type === state.filters.type;
    const matchCat  = state.filters.category === 'all' || t.category === state.filters.category;
    return matchQ && matchType && matchCat;
  });

  document.getElementById('transactionCount').textContent =
    `${filtered.length} entr${filtered.length === 1 ? 'y' : 'ies'}`;

  if (!filtered.length) {
    container.innerHTML = `
      <div class="tx-empty">
        <i class="ri-receipt-line"></i>
        <h4>Nothing here yet</h4>
        <p>Try resetting filters or add your first transaction.</p>
      </div>`;
    return;
  }

  // Group by date
  const groups = {};
  filtered.forEach(t => {
    const dateKey = toDateStr(t.date);
    (groups[dateKey] = groups[dateKey] || []).push(t);
  });
  const sortedDates = Object.keys(groups).sort((a, b) => new Date(b) - new Date(a));

  sortedDates.forEach(date => {
    const txs = groups[date];
    let dCredit = 0, dDebit = 0;
    txs.forEach(t => t.type === 'credit' ? dCredit += parseFloat(t.amount) : dDebit += parseFloat(t.amount));

    const block = document.createElement('div');
    block.className = 'day-block';
    block.innerHTML = `
      <div class="day-label-row">
        <span class="day-label"><i class="ri-calendar-event-line"></i>${labelDate(date)}</span>
        <div class="day-sums">
          ${dCredit ? `<span style="color:var(--credit)">+${fmtRupee(dCredit)}</span>` : ''}
          ${dDebit  ? `<span style="color:var(--debit)">−${fmtRupee(dDebit)}</span>`  : ''}
        </div>
      </div>`;

    txs.forEach(t => {
      const isC  = t.type === 'credit';
      const icon = CAT_ICONS[t.category] || 'ri-exchange-line';
      const row  = document.createElement('div');
      row.className = 'tx-row';
      row.innerHTML = `
        <div class="tx-row-left">
          <div class="tx-cat-icon ${isC ? 'ci-credit' : 'ci-debit'}"><i class="${icon}"></i></div>
          <div class="tx-desc">
            <span class="tx-desc-title">${esc(t.title)}</span>
            <div class="tx-desc-meta">
              <span class="meta-tag">${esc(t.category)}</span>
              <span>· ${esc(t.method)}</span>
              ${t.note ? `<span>· <em>${esc(t.note)}</em></span>` : ''}
            </div>
          </div>
        </div>
        <div class="tx-row-right">
          <span class="tx-amt" style="color:${isC ? 'var(--credit)' : 'var(--debit)'}">
            ${isC ? '+' : '−'}${fmtRupee(parseFloat(t.amount))}
          </span>
          <div class="tx-acts">
            <button class="act-btn"     onclick="editTx(${t.id})"   title="Edit"><i class="ri-pencil-line"></i></button>
            <button class="act-btn del" onclick="deleteTx(${t.id})" title="Delete"><i class="ri-delete-bin-5-line"></i></button>
          </div>
        </div>`;
      block.appendChild(row);
    });

    container.appendChild(block);
  });
}

function labelDate(str) {
  const d   = new Date(str + 'T00:00:00');
  const tod = new Date();
  const yes = new Date(); yes.setDate(tod.getDate() - 1);
  if (d.toDateString() === tod.toDateString()) return ' Today';
  if (d.toDateString() === yes.toDateString()) return ' Yesterday';
  return ' ' + d.toLocaleDateString('en-IN', { weekday:'short', day:'numeric', month:'short', year:'numeric' });
}

// Filters
function handleFilterChange() {
  state.filters.search   = document.getElementById('searchInput').value;
  state.filters.type     = document.getElementById('typeFilter').value;
  state.filters.category = document.getElementById('categoryFilter').value;
  renderTimeline();
}

function resetFilters() {
  document.getElementById('searchInput').value    = '';
  document.getElementById('typeFilter').value     = 'all';
  document.getElementById('categoryFilter').value = 'all';
  state.filters = { search:'', type:'all', category:'all' };
  renderTimeline();
}

function scrollToSection(id, e) {
  if (e) e.preventDefault();
  document.getElementById(id)?.scrollIntoView({ behavior:'smooth', block:'start' });
}

// ─────────────────────────────────────────────
// MODAL
// ─────────────────────────────────────────────
function updateTypeUI() {
  const isC = document.querySelector("input[name='txType']:checked").value === 'credit';
  document.getElementById('typeDebitLabel').classList.toggle('active', !isC);
  document.getElementById('typeCreditLabel').classList.toggle('active',  isC);
  updateCategorySelect(isC ? 'credit' : 'debit');
}

function updateCategorySelect(type) {
  const sel = document.getElementById('txCategory');
  sel.innerHTML = CATEGORIES[type].map(c => `<option value="${c}">${c}</option>`).join('');
}

let editingId = null;

function openTransactionModal(editId = null) {
  editingId = editId;
  const modal = document.getElementById('transactionModal');
  document.getElementById('transactionForm').reset();

  if (editId !== null) {
    const t = state.transactions.find(x => x.id === editId);
    if (t) {
      document.getElementById('modalTitle').textContent = 'Edit transaction';
      document.getElementById('txId').value    = t.id;
      document.getElementById('txTitle').value = t.title;
      document.getElementById('txAmount').value = parseFloat(t.amount);
      document.getElementById('txDate').value   = toDateStr(t.date);
      document.getElementById('txNote').value   = t.note || '';
      document.getElementById('txMethod').value = t.method;
      document.querySelector(`input[name='txType'][value='${t.type}']`).checked = true;
      updateTypeUI();
      document.getElementById('txCategory').value = t.category;
    }
  } else {
    document.getElementById('modalTitle').textContent = 'New transaction';
    document.getElementById('txId').value = '';
    document.getElementById('txDate').value = new Date().toISOString().split('T')[0];
    document.querySelector("input[name='txType'][value='debit']").checked = true;
    updateTypeUI();
  }

  modal.classList.add('active');
}

function closeTransactionModal() {
  document.getElementById('transactionModal').classList.remove('active');
  editingId = null;
}

function closeModalOnBackdrop(e) {
  if (e.target.classList.contains('modal-overlay')) closeTransactionModal();
}

async function saveTransaction(e) {
  e.preventDefault();

  const id       = document.getElementById('txId').value;
  const title    = document.getElementById('txTitle').value.trim();
  const amount   = parseFloat(document.getElementById('txAmount').value);
  const date     = document.getElementById('txDate').value;
  const type     = document.querySelector("input[name='txType']:checked").value;
  const category = document.getElementById('txCategory').value;
  const method   = document.getElementById('txMethod').value;
  const note     = document.getElementById('txNote').value.trim();

  if (!title || !amount || amount <= 0 || !date) {
    showToast('Please fill in all required fields.');
    return;
  }

  const payload = { title, amount, type, category, method, date, note };
  const saveBtn = document.querySelector('#transactionForm button[type="submit"]');
  saveBtn.disabled = true;
  saveBtn.textContent = 'Saving…';

  let data;
  if (id) {
    data = await apiFetch(`/api/transactions/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
    if (data) {
      const idx = state.transactions.findIndex(t => t.id === data.id);
      if (idx !== -1) state.transactions[idx] = data;
      showToast('Transaction updated ✓');
    }
  } else {
    data = await apiFetch('/api/transactions', { method: 'POST', body: JSON.stringify(payload) });
    if (data) {
      state.transactions.unshift(data);
      showToast(type === 'credit' ? 'Credit entry saved ✓' : 'Debit entry saved ✓');
    }
  }

  saveBtn.disabled = false;
  saveBtn.textContent = 'Save entry';

  if (data) {
    closeTransactionModal();
    render();
  }
}

async function editTx(id) { openTransactionModal(id); }

async function deleteTx(id) {
  if (!confirm('Delete this transaction?')) return;
  const data = await apiFetch(`/api/transactions/${id}`, { method: 'DELETE' });
  if (data) {
    state.transactions = state.transactions.filter(t => t.id !== id);
    render();
    showToast('Entry deleted');
  }
}

// ─────────────────────────────────────────────
// CANVAS CHART
// ─────────────────────────────────────────────
function drawChart() {
  const canvas = document.getElementById('categoryChart');
  const empty  = document.getElementById('emptyChartMessage');
  if (!canvas) return;

  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const cats = {};
  let total = 0;
  state.transactions.forEach(t => {
    if (t.type === 'debit') {
      cats[t.category] = (cats[t.category] || 0) + parseFloat(t.amount);
      total += parseFloat(t.amount);
    }
  });

  if (!total) {
    canvas.style.display = 'none';
    empty.style.display  = 'flex';
    return;
  }
  canvas.style.display = 'block';
  empty.style.display  = 'none';

  const W = canvas.width, H = canvas.height;
  const cx = W * 0.3, cy = H / 2, r = Math.min(cx, cy) - 12;
  const isDark = state.theme === 'dark';

  let start = -Math.PI / 2;
  Object.entries(cats).forEach(([, amt], i) => {
    const sweep = (amt / total) * 2 * Math.PI;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, r, start, start + sweep);
    ctx.closePath();
    ctx.fillStyle = CHART_COLORS[i % CHART_COLORS.length];
    ctx.fill();
    ctx.strokeStyle = isDark ? '#111318' : '#F4F3F0';
    ctx.lineWidth = 2;
    ctx.stroke();
    start += sweep;
  });

  // Donut hole
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.48, 0, 2 * Math.PI);
  ctx.fillStyle = isDark ? '#1A1D25' : '#FFFFFF';
  ctx.fill();

  // Center text
  ctx.fillStyle  = isDark ? '#E8EAF0' : '#1A1C22';
  ctx.font       = '700 11px "Space Grotesk", sans-serif';
  ctx.textAlign  = 'center';
  ctx.fillText('SPEND', cx, cy - 5);
  ctx.font       = '500 10px "DM Sans", sans-serif';
  ctx.fillStyle  = isDark ? '#8B90A4' : '#6B7080';
  ctx.fillText(fmtRupee(total), cx, cy + 11);

  // Legend
  const lx = W * 0.62;
  Object.entries(cats).forEach(([cat, amt], i) => {
    const ly  = 14 + i * 22;
    if (ly > H - 12) return;
    const col = CHART_COLORS[i % CHART_COLORS.length];
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.roundRect(lx, ly, 10, 10, 3);
    ctx.fill();
    ctx.fillStyle = isDark ? '#8B90A4' : '#6B7080';
    ctx.font = '500 10.5px "DM Sans", sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(`${cat.split(' ')[0]}  ${Math.round((amt/total)*100)}%`, lx + 15, ly + 8.5);
  });
}

// ─────────────────────────────────────────────
// TOAST
// ─────────────────────────────────────────────
function showToast(msg) {
  const c = document.getElementById('toastContainer');
  if (!c) return;
  const t = document.createElement('div');
  t.className = 'toast';
  t.innerHTML = `<i class="ri-check-line"></i> ${esc(msg)}`;
  c.appendChild(t);
  setTimeout(() => t.remove(), 3500);
}

// ─────────────────────────────────────────────
// UTILS
// ─────────────────────────────────────────────
function fmtRupee(n) {
  const abs = Math.abs(n);
  const fmt = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(abs);
  return `${n < 0 ? '−' : ''}₹${fmt}`;
}

function esc(s) {
  return String(s).replace(/[&<>'"]/g,
    ch => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[ch])
  );
}
