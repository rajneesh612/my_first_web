const API_BASE = 'http://localhost:3000';

const form = document.getElementById('contact-form');
const formResponse = document.getElementById('form-response');
const loginForm = document.getElementById('login-form');
const loginResponse = document.getElementById('login-response');
const authGate = document.getElementById('auth-gate');
const appContent = document.getElementById('app-content');
const logoutBtn = document.getElementById('logout-btn');
const userBadge = document.getElementById('user-badge');
const adminSection = document.getElementById('admin');
const adminExpenseSection = document.getElementById('admin-expenses');
const adminDashboardSection = document.getElementById('admin-dashboard');
const adminStocksSection = document.getElementById('admin-stocks');
const adminForm = document.getElementById('admin-create-form');
const adminResponse = document.getElementById('admin-response');
const adminLink = document.getElementById('admin-link');
const chatDock = document.getElementById('chat-dock');
const chatToggle = document.getElementById('chat-toggle');
const chatToggleLink = document.getElementById('chat-toggle-link');
const chatClose = document.getElementById('chat-close');
const chatMessages = document.getElementById('chat-messages');
const chatForm = document.getElementById('chat-form');
const chatInput = document.getElementById('chat-input');
const chatSendBtn = chatForm ? chatForm.querySelector('button') : null;
const chatStatus = document.getElementById('chat-status');
const aiBotDock = document.getElementById('ai-bot-dock');
const aiBotToggle = document.getElementById('ai-bot-toggle');
const aiBotClose = document.getElementById('ai-bot-close');
const aiBotForm = document.getElementById('ai-bot-form');
const aiBotInput = document.getElementById('ai-bot-input');
const aiBotExpand = document.getElementById('ai-bot-expand');
const aiBotModal = document.getElementById('ai-bot-modal');
const aiBotModalClose = document.getElementById('ai-bot-modal-close');
const aiBotModalBackdrop = aiBotModal ? aiBotModal.querySelector('[data-ai-bot-close]') : null;
const aiBotModalChart = document.getElementById('ai-bot-modal-chart');
const aiBotChartTitle = document.getElementById('ai-bot-chart-title');
const aiBotChartSubtitle = document.getElementById('ai-bot-chart-subtitle');
const aiBotModalTitle = document.getElementById('ai-bot-modal-title');
const chatBotStatus = document.getElementById('chat-bot-status');
const chatBotChart = document.getElementById('chat-bot-chart');
const chatBotTable = document.getElementById('chat-bot-table');
const chatUserSelect = document.getElementById('chat-user-select');
const chatUserLabel = document.getElementById('chat-user-label');
const chatPeerPill = document.getElementById('chat-peer-pill');
const expenseOpenBtn = document.getElementById('expense-open-btn');
const expenseModal = document.getElementById('expense-modal');
const expenseClose = document.getElementById('expense-close');
const expenseForm = document.getElementById('expense-form');
const expenseList = document.getElementById('expense-list');
const expenseTotal = document.getElementById('expense-total');
const expenseStatus = document.getElementById('expense-status');
const expenseBackdrop = expenseModal ? expenseModal.querySelector('[data-expense-close]') : null;
const dashTotal = document.getElementById('dash-total');
const dashMonth = document.getElementById('dash-month');
const dashCount = document.getElementById('dash-count');
const dashRecent = document.getElementById('dash-recent');
const dashCategories = document.getElementById('dash-categories');
const adminExpenseUser = document.getElementById('admin-expense-user');
const adminExpenseForm = document.getElementById('admin-expense-form');
const adminExpenseList = document.getElementById('admin-expense-list');
const adminExpenseStatus = document.getElementById('admin-expense-status');
const adminExpenseDate = document.getElementById('admin-expense-date');
const adminDashboardUser = document.getElementById('admin-dashboard-user');
const adminDashboardList = document.getElementById('admin-dashboard-list');
const adminDashboardStatus = document.getElementById('admin-dashboard-status');
const adminDashboardChart = document.getElementById('admin-dashboard-chart');
const adminMomentumBody = document.getElementById('admin-momentum-body');
const adminMomentumStatus = document.getElementById('admin-momentum-status');
const adminMomentumRefresh = document.getElementById('admin-momentum-refresh');
const adminMomentumChart = document.getElementById('admin-momentum-chart');

const MOMENTUM_POLL_MS = 6 * 60 * 60 * 1000;

let chatPollId = null;
let activeChatPeer = null;
let activeUser = null;
let expenses = [];
let adminSelectedUserId = null;
let adminDashboardUserId = null;
let adminChartInstance = null;
let adminMomentumChartInstance = null;
let adminMomentumPollId = null;
let chatBotChartInstance = null;
let chatBotModalChartInstance = null;
let lastBotChartConfig = null;

const initCursorGlow = () => {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  if (document.querySelector('.cursor-glow')) return;

  const glow = document.createElement('div');
  glow.className = 'cursor-glow';
  document.body.appendChild(glow);

  let targetX = window.innerWidth / 2;
  let targetY = window.innerHeight / 2;
  let currentX = targetX;
  let currentY = targetY;
  const speed = 0.12;

  const animate = () => {
    currentX += (targetX - currentX) * speed;
    currentY += (targetY - currentY) * speed;
    glow.style.transform = `translate3d(${currentX - 130}px, ${currentY - 130}px, 0)`;
    requestAnimationFrame(animate);
  };

  window.addEventListener('mousemove', (event) => {
    targetX = event.clientX;
    targetY = event.clientY;
    glow.style.opacity = '0.85';
  });

  window.addEventListener('mouseleave', () => {
    glow.style.opacity = '0';
  });

  animate();
};

initCursorGlow();

const formatCurrency = (value) => {
  const amount = Number(value) || 0;
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 2,
  }).format(amount);
};

const formatPercent = (value) => {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '-';
  return `${(Number(value) * 100).toFixed(1)}%`;
};

const formatCompactNumber = (value) => {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '-';
  return new Intl.NumberFormat('en-IN', {
    notation: 'compact',
    maximumFractionDigits: 2,
  }).format(Number(value));
};

const formatNumber = (value, digits = 2) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return '-';
  return num.toFixed(digits);
};

const setExpenseModalOpen = (open) => {
  if (!expenseModal) return;
  expenseModal.classList.toggle('open', open);
  expenseModal.setAttribute('aria-hidden', String(!open));
  document.body.style.overflow = open ? 'hidden' : '';
};

const renderExpenses = (items) => {
  if (!expenseList || !expenseTotal) return;
  const total = items.reduce((sum, item) => sum + (Number(item.amount) || 0), 0);
  expenseTotal.textContent = formatCurrency(total);

  if (!items.length) {
    expenseList.innerHTML = '<div class="expense-item">No expenses yet.</div>';
    return;
  }

  expenseList.innerHTML = '';
  items.forEach((item) => {
    const row = document.createElement('div');
    row.className = 'expense-item';

    const left = document.createElement('div');
    const title = document.createElement('strong');
    title.textContent = item.category || 'Expense';
    const meta = document.createElement('div');
    meta.className = 'expense-meta';
    const date = item.expense_date ? new Date(item.expense_date).toLocaleDateString() : '';
    const method = item.payment_method ? ` • ${item.payment_method}` : '';
    meta.textContent = `${date}${method}${item.note ? ` • ${item.note}` : ''}`;
    left.appendChild(title);
    left.appendChild(meta);

    const amount = document.createElement('div');
    amount.className = 'expense-amount';
    amount.textContent = formatCurrency(item.amount);

    row.appendChild(left);
    row.appendChild(amount);
    expenseList.appendChild(row);
  });
};

const renderDashboard = (items) => {
  if (!dashTotal || !dashMonth || !dashCount || !dashRecent || !dashCategories) return;

  const total = items.reduce((sum, item) => sum + (Number(item.amount) || 0), 0);
  dashTotal.textContent = formatCurrency(total);
  dashCount.textContent = String(items.length);

  const now = new Date();
  const currentMonth = now.getMonth();
  const currentYear = now.getFullYear();
  const monthTotal = items.reduce((sum, item) => {
    if (!item.expense_date) return sum;
    const dt = new Date(item.expense_date);
    if (dt.getMonth() === currentMonth && dt.getFullYear() === currentYear) {
      return sum + (Number(item.amount) || 0);
    }
    return sum;
  }, 0);
  dashMonth.textContent = formatCurrency(monthTotal);

  dashRecent.innerHTML = '';
  const recentItems = items.slice(0, 5);
  if (!recentItems.length) {
    dashRecent.innerHTML = '<div class="dash-item">No expenses yet.</div>';
  } else {
    recentItems.forEach((item) => {
      const row = document.createElement('div');
      row.className = 'dash-item';
      const label = document.createElement('span');
      const date = item.expense_date ? new Date(item.expense_date).toLocaleDateString() : '';
      label.textContent = `${item.category || 'Expense'} • ${date}`;
      const value = document.createElement('strong');
      value.textContent = formatCurrency(item.amount);
      row.appendChild(label);
      row.appendChild(value);
      dashRecent.appendChild(row);
    });
  }

  const totalsByCategory = items.reduce((acc, item) => {
    const key = item.category || 'Other';
    acc[key] = (acc[key] || 0) + (Number(item.amount) || 0);
    return acc;
  }, {});
  const categoryRows = Object.entries(totalsByCategory)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  dashCategories.innerHTML = '';
  if (!categoryRows.length) {
    dashCategories.innerHTML = '<div class="dash-item">No expenses yet.</div>';
  } else {
    categoryRows.forEach(([name, value]) => {
      const row = document.createElement('div');
      row.className = 'dash-item';
      const label = document.createElement('span');
      label.textContent = name;
      const amount = document.createElement('strong');
      amount.textContent = formatCurrency(value);
      row.appendChild(label);
      row.appendChild(amount);
      dashCategories.appendChild(row);
    });
  }
};

const loadExpenses = async () => {
  if (!activeUser) return;
  if (expenseStatus) expenseStatus.textContent = 'Loading...';
  try {
    const data = await fetchJSON(`${API_BASE}/expenses`, {
      headers: { 'x-user-id': activeUser.id },
    });
    expenses = Array.isArray(data) ? data : [];
    renderExpenses(expenses);
    renderDashboard(expenses);
    if (expenseStatus) expenseStatus.textContent = '';
  } catch (error) {
    if (expenseStatus) expenseStatus.textContent = error.message;
  }
};

const renderAdminExpenses = (items) => {
  if (!adminExpenseList) return;
  if (!items.length) {
    adminExpenseList.innerHTML = '<div class="expense-item">No expenses yet.</div>';
    return;
  }

  adminExpenseList.innerHTML = '';
  items.forEach((item) => {
    const row = document.createElement('div');
    row.className = 'expense-item';

    const left = document.createElement('div');
    const title = document.createElement('strong');
    title.textContent = item.category || 'Expense';
    const meta = document.createElement('div');
    meta.className = 'expense-meta';
    const date = item.expense_date ? new Date(item.expense_date).toLocaleDateString() : '';
    const method = item.payment_method ? ` • ${item.payment_method}` : '';
    meta.textContent = `${date}${method}${item.note ? ` • ${item.note}` : ''}`;
    left.appendChild(title);
    left.appendChild(meta);

    const amount = document.createElement('div');
    amount.className = 'expense-amount';
    amount.textContent = formatCurrency(item.amount);

    row.appendChild(left);
    row.appendChild(amount);
    adminExpenseList.appendChild(row);
  });
};

const loadAdminUsers = async () => {
  if (!activeUser || activeUser.role !== 'admin' || !adminExpenseUser) return;
  if (adminExpenseStatus) adminExpenseStatus.textContent = 'Loading users...';
  try {
    const users = await fetchJSON(`${API_BASE}/users`, {
      headers: { 'x-user-id': activeUser.id },
    });
    const selectable = users.filter((u) => u.role !== 'admin');
    adminExpenseUser.innerHTML = '';
    if (!selectable.length) {
      const option = document.createElement('option');
      option.value = '';
      option.textContent = 'No users available';
      adminExpenseUser.appendChild(option);
      adminSelectedUserId = null;
      renderAdminExpenses([]);
      if (adminExpenseStatus) adminExpenseStatus.textContent = 'No users found.';
      return;
    }
    selectable.forEach((u) => {
      const option = document.createElement('option');
      option.value = u.id;
      option.textContent = `${u.name || 'User'} (${u.email})`;
      adminExpenseUser.appendChild(option);
    });
    adminSelectedUserId = selectable[0].id;
    if (adminExpenseDate && !adminExpenseDate.value) {
      adminExpenseDate.valueAsDate = new Date();
    }
    if (adminExpenseStatus) adminExpenseStatus.textContent = '';
    await loadAdminExpenses();
    if (adminDashboardUser) {
      adminDashboardUser.innerHTML = '';
      const allOption = document.createElement('option');
      allOption.value = '';
      allOption.textContent = 'All users';
      adminDashboardUser.appendChild(allOption);
      selectable.forEach((u) => {
        const option = document.createElement('option');
        option.value = u.id;
        option.textContent = `${u.name || 'User'} (${u.email})`;
        adminDashboardUser.appendChild(option);
      });
      adminDashboardUserId = '';
      await loadAdminDashboardExpenses();
    }
  } catch (error) {
    if (adminExpenseStatus) adminExpenseStatus.textContent = error.message;
  }
};

const renderMomentumChart = (rows) => {
  if (!adminMomentumChart) return;
  if (adminMomentumChartInstance) {
    adminMomentumChartInstance.destroy();
    adminMomentumChartInstance = null;
  }

  if (!rows.length || !window.Chart) return;

  const labels = rows.map((row) => row.symbol);
  const values = rows.map((row) => Number(row.return_3_month || 0) * 100);

  const bar3dPlugin = {
    id: 'bar3d',
    afterDatasetsDraw: (chart) => {
      const ctx = chart.ctx;
      const meta = chart.getDatasetMeta(0);
      const depth = 10;
      ctx.save();

      meta.data.forEach((bar) => {
        const x = bar.x;
        const y = bar.y;
        const base = bar.base;
        const width = bar.width;

        ctx.fillStyle = 'rgba(15, 23, 42, 0.35)';
        ctx.beginPath();
        ctx.moveTo(x + width / 2, y);
        ctx.lineTo(x + width / 2 + depth, y - depth);
        ctx.lineTo(x + width / 2 + depth, base - depth);
        ctx.lineTo(x + width / 2, base);
        ctx.closePath();
        ctx.fill();

        ctx.fillStyle = 'rgba(255, 255, 255, 0.25)';
        ctx.beginPath();
        ctx.moveTo(x - width / 2, y);
        ctx.lineTo(x, y - depth);
        ctx.lineTo(x + width / 2 + depth, y - depth);
        ctx.lineTo(x + width / 2, y);
        ctx.closePath();
        ctx.fill();
      });

      ctx.restore();
    },
  };

  adminMomentumChartInstance = new window.Chart(adminMomentumChart, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: '3M Return (%)',
        data: values,
        backgroundColor: 'rgba(55, 215, 197, 0.85)',
        borderColor: 'rgba(255, 179, 106, 0.9)',
        borderWidth: 1,
        borderRadius: 8,
        maxBarThickness: 48,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: {
          ticks: { color: '#e2e8f0' },
          grid: { color: 'rgba(148, 163, 184, 0.2)' },
        },
        y: {
          ticks: {
            color: '#e2e8f0',
            callback: (value) => `${value}%`,
          },
          grid: { color: 'rgba(148, 163, 184, 0.2)' },
        },
      },
      plugins: {
        legend: { labels: { color: '#e2e8f0' } },
        tooltip: {
          callbacks: {
            label: (context) => `${context.dataset.label}: ${context.parsed.y.toFixed(2)}%`,
          },
        },
      },
    },
    plugins: [bar3dPlugin],
  });
};

const renderMomentumStocks = (rows) => {
  if (!adminMomentumBody) return;
  adminMomentumBody.innerHTML = '';

  if (!rows.length) {
    adminMomentumBody.innerHTML = `
      <div class="admin-momentum-row">
        <span>No matches yet.</span>
        <span>-</span>
        <span>-</span>
        <span>-</span>
        <span>-</span>
        <span>-</span>
        <span>-</span>
        <span>-</span>
      </div>
    `;
    return;
  }

  rows.forEach((row) => {
    const line = document.createElement('div');
    line.className = 'admin-momentum-row';

    const price = formatCurrency(row.price);
    const ma50 = formatCurrency(row.ma50);
    const ma200 = formatCurrency(row.ma200);
    const high52 = formatCurrency(row.high_52_week);
    const high20 = formatCurrency(row.highest_high_20);
    const volRatio = row.volume_ratio ? row.volume_ratio.toFixed(2) : '-';
    const ret3m = formatPercent(row.return_3_month);

    line.innerHTML = `
      <span>${row.symbol}</span>
      <span>${price}</span>
      <span>${ma50}</span>
      <span>${ma200}</span>
      <span>${high52}</span>
      <span>${high20}</span>
      <span>${volRatio}x</span>
      <span>${ret3m}</span>
    `;
    adminMomentumBody.appendChild(line);
  });
};

const loadMomentumStocks = async () => {
  if (!activeUser || activeUser.role !== 'admin') return;
  if (adminMomentumStatus) adminMomentumStatus.textContent = 'Loading momentum stocks...';

  try {
    const data = await fetchJSON(`${API_BASE}/admin/momentum-stocks?limit=15`, {
      headers: { 'x-user-id': activeUser.id },
    });
    const results = Array.isArray(data.results) ? data.results : [];
    renderMomentumStocks(results);
    renderMomentumChart(results);
    if (adminMomentumStatus) {
      const topSymbols = results.slice(0, 5).map((row) => row.symbol).join(', ');
      const emptyNote = results.length ? '' : 'No matches yet.';
      const staleNote = data.staleUsed ? 'Showing last cached momentum list.' : '';
      const relaxedNote = data.relaxedUsed ? 'Showing relaxed momentum picks.' : '';
      adminMomentumStatus.textContent = `Updated ${data.updatedAt}. Scanned ${data.scannedCount}, fetched ${data.fetchedCount}, cached ${data.cacheCount}, errors ${data.errorCount}. ${staleNote} ${relaxedNote} ${emptyNote} ${topSymbols ? `Top: ${topSymbols}.` : ''}`.trim();
    }
  } catch (error) {
    if (adminMomentumStatus) adminMomentumStatus.textContent = `Momentum update failed: ${error.message}`;
  }
};

const stopMomentumPolling = () => {
  if (adminMomentumPollId) {
    clearInterval(adminMomentumPollId);
    adminMomentumPollId = null;
  }
};

const startMomentumPolling = () => {
  if (!activeUser || activeUser.role !== 'admin') return;
  stopMomentumPolling();
  adminMomentumPollId = setInterval(() => {
    loadMomentumStocks();
  }, MOMENTUM_POLL_MS);
};

const renderAdminDashboard = (items) => {
  if (!adminDashboardList) return;
  if (!items.length) {
    adminDashboardList.innerHTML = '<div class="expense-item">No expenses found.</div>';
    renderAdminChart([]);
    return;
  }

  adminDashboardList.innerHTML = '';
  items.forEach((item) => {
    const row = document.createElement('div');
    row.className = 'expense-item';

    const left = document.createElement('div');
    const title = document.createElement('strong');
    const userName = item.users ? (item.users.name || item.users.email || 'User') : 'User';
    title.textContent = `${userName} • ${item.category || 'Expense'}`;
    const meta = document.createElement('div');
    meta.className = 'expense-meta';
    const date = item.expense_date ? new Date(item.expense_date).toLocaleDateString() : '';
    const method = item.payment_method ? ` • ${item.payment_method}` : '';
    meta.textContent = `${date}${method}${item.note ? ` • ${item.note}` : ''}`;
    left.appendChild(title);
    left.appendChild(meta);

    const amount = document.createElement('div');
    amount.className = 'expense-amount';
    amount.textContent = formatCurrency(item.amount);

    row.appendChild(left);
    row.appendChild(amount);
    adminDashboardList.appendChild(row);
  });
};

const renderAdminChart = (items) => {
  if (!adminDashboardChart) return;
  if (!items.length) {
    if (adminChartInstance) {
      adminChartInstance.destroy();
      adminChartInstance = null;
    }
    return;
  }

  if (!window.Chart) return;

  const totals = items.reduce((acc, item) => {
    const userName = item.users ? (item.users.name || item.users.email || 'User') : 'User';
    acc[userName] = (acc[userName] || 0) + (Number(item.amount) || 0);
    return acc;
  }, {});

  const rows = Object.entries(totals)
    .sort((a, b) => b[1] - a[1]);

  const labels = rows.map(([name]) => name);
  const values = rows.map(([, total]) => total);

  adminChartInstance = new window.Chart(adminDashboardChart, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Total spend',
        data: values,
        backgroundColor: 'rgba(55, 215, 197, 0.85)',
        borderColor: 'rgba(255, 179, 106, 0.9)',
        borderWidth: 1,
        borderRadius: 8,
        maxBarThickness: 48,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: {
          ticks: { color: '#e2e8f0' },
          grid: { color: 'rgba(148, 163, 184, 0.2)' },
        },
        y: {
          ticks: {
            color: '#e2e8f0',
            callback: (value) => formatCurrency(value),
          },
          grid: { color: 'rgba(148, 163, 184, 0.2)' },
        },
      },
      plugins: {
        legend: { labels: { color: '#e2e8f0' } },
        tooltip: {
          callbacks: {
            label: (context) => `${context.dataset.label}: ${formatCurrency(context.parsed.y)}`,
          },
        },
      },
    },
  });
};

const loadAdminDashboardExpenses = async () => {
  if (!activeUser || activeUser.role !== 'admin') return;
  if (adminDashboardStatus) adminDashboardStatus.textContent = 'Loading expenses...';
  try {
    const query = adminDashboardUserId ? `?userId=${adminDashboardUserId}` : '';
    const data = await fetchJSON(`${API_BASE}/admin/expenses${query}`, {
      headers: { 'x-user-id': activeUser.id },
    });
    renderAdminDashboard(Array.isArray(data) ? data : []);
    renderAdminChart(Array.isArray(data) ? data : []);
    if (adminDashboardStatus) adminDashboardStatus.textContent = '';
  } catch (error) {
    if (adminDashboardStatus) adminDashboardStatus.textContent = error.message;
  }
};

const loadAdminExpenses = async () => {
  if (!activeUser || activeUser.role !== 'admin' || !adminSelectedUserId) return;
  if (adminExpenseStatus) adminExpenseStatus.textContent = 'Loading expenses...';
  try {
    const data = await fetchJSON(`${API_BASE}/admin/expenses?userId=${adminSelectedUserId}`, {
      headers: { 'x-user-id': activeUser.id },
    });
    renderAdminExpenses(Array.isArray(data) ? data : []);
    if (adminExpenseStatus) adminExpenseStatus.textContent = '';
  } catch (error) {
    if (adminExpenseStatus) adminExpenseStatus.textContent = error.message;
  }
};

const setAuthState = (user) => {
  activeUser = user || null;
  stopMomentumPolling();
  if (user) {
    localStorage.setItem('authUser', JSON.stringify(user));
    if (authGate) {
      authGate.classList.add('hidden');
      authGate.setAttribute('aria-hidden', 'true');
      authGate.style.display = 'none';
    }
    if (appContent) {
      appContent.classList.remove('hidden');
      appContent.removeAttribute('aria-hidden');
      appContent.style.display = 'block';
    }
    if (adminSection) {
      const isAdmin = user.role === 'admin';
      adminSection.classList.toggle('hidden', !isAdmin);
      adminSection.setAttribute('aria-hidden', String(!isAdmin));
      adminSection.style.display = isAdmin ? 'block' : 'none';
    }
    if (adminExpenseSection) {
      const isAdmin = user.role === 'admin';
      adminExpenseSection.classList.toggle('hidden', !isAdmin);
      adminExpenseSection.setAttribute('aria-hidden', String(!isAdmin));
      adminExpenseSection.style.display = isAdmin ? 'block' : 'none';
    }
    if (adminDashboardSection) {
      const isAdmin = user.role === 'admin';
      adminDashboardSection.classList.toggle('hidden', !isAdmin);
      adminDashboardSection.setAttribute('aria-hidden', String(!isAdmin));
      adminDashboardSection.style.display = isAdmin ? 'block' : 'none';
    }
    if (adminStocksSection) {
      const isAdmin = user.role === 'admin';
      adminStocksSection.classList.toggle('hidden', !isAdmin);
      adminStocksSection.setAttribute('aria-hidden', String(!isAdmin));
      adminStocksSection.style.display = isAdmin ? 'block' : 'none';
    }
    if (adminLink) {
      adminLink.style.display = user.role === 'admin' ? 'inline-flex' : 'none';
    }
    if (userBadge) userBadge.textContent = `${user.name || 'User'} (${user.role})`;
    setupChatForUser(user);
    if (aiBotDock) {
      aiBotDock.removeAttribute('aria-hidden');
      aiBotDock.style.display = 'flex';
    }
    loadExpenses();
    loadAdminUsers();
    loadMomentumStocks();
    startMomentumPolling();
  } else {
    localStorage.removeItem('authUser');
    if (authGate) {
      authGate.classList.remove('hidden');
      authGate.removeAttribute('aria-hidden');
      authGate.style.display = 'flex';
    }
    if (appContent) {
      appContent.classList.add('hidden');
      appContent.setAttribute('aria-hidden', 'true');
      appContent.style.display = 'none';
    }
    if (adminSection) {
      adminSection.classList.add('hidden');
      adminSection.setAttribute('aria-hidden', 'true');
      adminSection.style.display = 'none';
    }
    if (adminExpenseSection) {
      adminExpenseSection.classList.add('hidden');
      adminExpenseSection.setAttribute('aria-hidden', 'true');
      adminExpenseSection.style.display = 'none';
    }
    if (adminDashboardSection) {
      adminDashboardSection.classList.add('hidden');
      adminDashboardSection.setAttribute('aria-hidden', 'true');
      adminDashboardSection.style.display = 'none';
    }
    if (adminStocksSection) {
      adminStocksSection.classList.add('hidden');
      adminStocksSection.setAttribute('aria-hidden', 'true');
      adminStocksSection.style.display = 'none';
    }
    if (adminLink) {
      adminLink.style.display = 'none';
    }
    if (userBadge) userBadge.textContent = 'Signed in';
    teardownChat();
    if (aiBotDock) {
      aiBotDock.setAttribute('aria-hidden', 'true');
      aiBotDock.style.display = 'none';
    }
    setAiBotOpen(false);
    expenses = [];
    renderExpenses(expenses);
    renderDashboard(expenses);
    adminSelectedUserId = null;
    renderAdminExpenses([]);
    if (adminExpenseUser) adminExpenseUser.innerHTML = '';
    adminDashboardUserId = null;
    if (adminDashboardUser) adminDashboardUser.innerHTML = '';
    renderAdminDashboard([]);
    renderAdminChart([]);
    renderMomentumStocks([]);
    renderMomentumChart([]);
    if (chatBotStatus) chatBotStatus.textContent = '';
    if (chatBotTable) chatBotTable.innerHTML = '';
    if (chatBotChartInstance) {
      chatBotChartInstance.destroy();
      chatBotChartInstance = null;
    }
  }
};

const getStoredUser = () => {
  try {
    return JSON.parse(localStorage.getItem('authUser'));
  } catch (error) {
    return null;
  }
};

const fetchJSON = async (url, options = {}) => {
  const res = await fetch(url, options);
  const data = await res.json();
  if (!res.ok) {
    const message = data && data.error ? data.error : 'Request failed.';
    throw new Error(message);
  }
  return data;
};

const renderChatMessages = (messages, currentUserId) => {
  if (!chatMessages) return;
  chatMessages.innerHTML = '';
  if (!messages.length) {
    chatMessages.innerHTML = '<div class="chat-message">No messages yet.</div>';
    return;
  }

  messages.forEach((msg) => {
    const wrapper = document.createElement('div');
    wrapper.className = 'chat-message' + (msg.sender_id === currentUserId ? ' me' : '');

    const body = document.createElement('div');
    body.textContent = msg.message;

    const meta = document.createElement('span');
    meta.className = 'meta';
    const time = msg.created_at ? new Date(msg.created_at).toLocaleString() : '';
    meta.textContent = time;

    wrapper.appendChild(body);
    wrapper.appendChild(meta);
    chatMessages.appendChild(wrapper);
  });

  chatMessages.scrollTop = chatMessages.scrollHeight;
};

const setChatEnabled = (enabled) => {
  if (chatInput) chatInput.disabled = !enabled;
  if (chatSendBtn) chatSendBtn.disabled = !enabled;
};

const isStockQuery = (text) => {
  const query = text.toLowerCase();
  const keywords = [
    'price', 'high', 'low', 'return', 'market cap', 'pe', 'ratio', 'news', 'chart',
    'compare', 'vs', 'gainers', 'losers', 'dividend', 'volume', 'nifty', 'sensex',
    'bank nifty', 'stock', 'stocks', '52 week', '52w', 'historical', 'sector',
    'top', 'performing', 'split', 'intraday', 'penny', 'under 100', 'most traded',
    'cheap', 'investment', 'buy', 'sell',
  ];
  return keywords.some((key) => query.includes(key));
};

const renderBotTable = (columns, rows) => {
  if (!chatBotTable) return;
  chatBotTable.innerHTML = '';

  if (!rows.length) {
    chatBotTable.innerHTML = '<div class="ai-bot-empty">No results found.</div>';
    return;
  }

  const table = document.createElement('table');
  const thead = document.createElement('thead');
  const headRow = document.createElement('tr');
  columns.forEach((label) => {
    const th = document.createElement('th');
    th.textContent = label;
    headRow.appendChild(th);
  });
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  rows.forEach((row) => {
    const tr = document.createElement('tr');
    row.forEach((cell) => {
      const td = document.createElement('td');
      td.textContent = cell;
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  chatBotTable.appendChild(table);
};

const setBotChartMeta = (title, subtitle) => {
  if (!aiBotChartTitle || !aiBotChartSubtitle) return;
  if (!title && !subtitle) {
    aiBotChartTitle.textContent = '';
    aiBotChartSubtitle.textContent = '';
    return;
  }
  aiBotChartTitle.textContent = title || 'Chart';
  aiBotChartSubtitle.textContent = subtitle || '';
};

const renderBotChart = (labels, values, label, formatter, chartType = 'bar', title = '', subtitle = '') => {
  if (!chatBotChart || !window.Chart) return;
  if (chatBotChartInstance) {
    chatBotChartInstance.destroy();
    chatBotChartInstance = null;
  }

  if (!labels.length || !values.length) {
    lastBotChartConfig = null;
    setBotChartMeta('', '');
    return;
  }

  lastBotChartConfig = {
    labels,
    values,
    label,
    formatter,
    chartType,
    title,
    subtitle,
  };

  setBotChartMeta(title || label, subtitle);

  const isLine = chartType === 'line';
  const dataset = {
    label,
    data: values,
    borderColor: 'rgba(55, 215, 197, 0.85)',
    backgroundColor: isLine ? 'rgba(55, 215, 197, 0.2)' : 'rgba(55, 215, 197, 0.85)',
    borderWidth: 2,
    tension: isLine ? 0.25 : 0,
    fill: isLine,
    pointRadius: isLine ? 0 : 3,
    maxBarThickness: isLine ? undefined : 46,
    borderRadius: isLine ? 0 : 8,
  };

  chatBotChartInstance = new window.Chart(chatBotChart, {
    type: chartType,
    data: {
      labels,
      datasets: [dataset],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        mode: 'index',
        intersect: false,
      },
      hover: {
        mode: 'index',
        intersect: false,
      },
      scales: {
        x: {
          ticks: {
            color: '#e2e8f0',
            autoSkip: true,
            maxTicksLimit: 6,
            maxRotation: 0,
          },
          grid: { color: 'rgba(148, 163, 184, 0.15)' },
        },
        y: {
          ticks: {
            color: '#e2e8f0',
            callback: (value) => (formatter ? formatter(value) : value),
          },
          grid: { color: 'rgba(148, 163, 184, 0.15)' },
        },
      },
      plugins: {
        legend: { labels: { color: '#e2e8f0' } },
        tooltip: {
          callbacks: {
            label: (context) => {
              const val = formatter ? formatter(context.parsed.y) : context.parsed.y;
              return `${context.dataset.label}: ${val}`;
            },
          },
        },
      },
    },
  });
};

const setAiBotOpen = (isOpen) => {
  if (!aiBotDock) return;
  aiBotDock.classList.toggle('open', isOpen);
  if (aiBotToggle) aiBotToggle.setAttribute('aria-expanded', String(isOpen));
};

const setAiBotModalOpen = (isOpen) => {
  if (!aiBotModal) return;
  aiBotModal.classList.toggle('open', isOpen);
  aiBotModal.setAttribute('aria-hidden', String(!isOpen));
  document.body.style.overflow = isOpen ? 'hidden' : '';
};

const renderBotModalChart = () => {
  if (!aiBotModalChart || !window.Chart || !lastBotChartConfig) return;
  if (chatBotModalChartInstance) {
    chatBotModalChartInstance.destroy();
    chatBotModalChartInstance = null;
  }

  const { labels, values, label, formatter, chartType, title, subtitle } = lastBotChartConfig;
  if (aiBotModalTitle) {
    aiBotModalTitle.textContent = title || label || 'AI Stock Bot Chart';
  }
  const isLine = chartType === 'line';
  chatBotModalChartInstance = new window.Chart(aiBotModalChart, {
    type: chartType,
    data: {
      labels,
      datasets: [{
        label,
        data: values,
        borderColor: 'rgba(55, 215, 197, 0.9)',
        backgroundColor: isLine ? 'rgba(55, 215, 197, 0.2)' : 'rgba(55, 215, 197, 0.85)',
        borderWidth: 2,
        tension: isLine ? 0.25 : 0,
        fill: isLine,
        pointRadius: isLine ? 0 : 3,
        maxBarThickness: isLine ? undefined : 56,
        borderRadius: isLine ? 0 : 8,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        mode: 'index',
        intersect: false,
      },
      hover: {
        mode: 'index',
        intersect: false,
      },
      scales: {
        x: {
          ticks: {
            color: '#e2e8f0',
            autoSkip: true,
            maxTicksLimit: 10,
          },
          grid: { color: 'rgba(148, 163, 184, 0.15)' },
        },
        y: {
          ticks: {
            color: '#e2e8f0',
            callback: (value) => (formatter ? formatter(value) : value),
          },
          grid: { color: 'rgba(148, 163, 184, 0.15)' },
        },
      },
      plugins: {
        legend: { labels: { color: '#e2e8f0' } },
        tooltip: {
          callbacks: {
            label: (context) => {
              const val = formatter ? formatter(context.parsed.y) : context.parsed.y;
              return `${context.dataset.label}: ${val}`;
            },
          },
        },
      },
    },
  });
};

const runBotQuery = async (text) => {
  if (!chatBotStatus) return;
  setAiBotOpen(true);
  chatBotStatus.textContent = 'Fetching stock data...';

  try {
    const data = await fetchJSON(`${API_BASE}/ai/bot/query`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-user-id': activeUser.id,
      },
      body: JSON.stringify({ query: text }),
    });
    if (data.intent === 'unsupported' || data.intent === 'missing_symbol') {
      chatBotStatus.textContent = data.message || 'Unsupported query.';
      renderBotTable([], []);
      return;
    }

    if (data.intent === 'investment') {
      chatBotStatus.textContent = data.message || 'Investment advice not available.';
      renderBotTable([], []);
      return;
    }

    if (data.intent === 'price') {
      renderBotChart([], [], '', null);
      renderBotTable(
        ['Symbol', 'Price'],
        [[data.symbol, formatCurrency(data.price)]],
      );
      chatBotStatus.textContent = data.message;
      return;
    }

    if (data.intent === 'high_low') {
      renderBotChart([], [], '', null);
      renderBotTable(
        ['Symbol', 'Today High', 'Today Low'],
        [[data.symbol, formatCurrency(data.high), formatCurrency(data.low)]],
      );
      chatBotStatus.textContent = data.message;
      return;
    }

    if (data.intent === 'high_low_month') {
      renderBotChart([], [], '', null);
      if (!data.high || !data.low) {
        renderBotTable([], []);
        chatBotStatus.textContent = data.message || 'No monthly data found.';
        return;
      }
      const monthLabel = data.month ? `${data.month} ${data.year}` : 'Monthly';
      renderBotTable(
        ['Symbol', `${monthLabel} High`, `${monthLabel} Low`],
        [[data.symbol, formatCurrency(data.high), formatCurrency(data.low)]],
      );
      chatBotStatus.textContent = data.message;
      return;
    }

    if (data.intent === 'return_1m') {
      renderBotChart(
        [data.symbol],
        [Number(data.return_1m || 0) * 100],
        `1M Return • ${data.symbol}`,
        (value) => `${Number(value).toFixed(1)}%`,
        'bar',
        data.symbol,
        '1M Return (%)',
      );
      renderBotTable(
        ['Symbol', 'Price', '1M Return'],
        [[data.symbol, formatCurrency(data.price), formatPercent(data.return_1m)]],
      );
      chatBotStatus.textContent = data.message;
      return;
    }

    if (data.intent === 'market_cap') {
      renderBotChart([], [], '', null);
      renderBotTable(
        ['Symbol', 'Market Cap'],
        [[data.symbol, formatCompactNumber(data.market_cap)]],
      );
      chatBotStatus.textContent = data.message;
      return;
    }

    if (data.intent === 'dividend') {
      renderBotChart([], [], '', null);
      const exDate = data.ex_dividend_date
        ? new Date(Number(data.ex_dividend_date) * 1000).toLocaleDateString()
        : '-';
      renderBotTable(
        ['Symbol', 'Dividend Rate', 'Dividend Yield', 'Ex-Dividend Date'],
        [[
          data.symbol,
          formatNumber(data.dividend_rate),
          formatPercent(data.dividend_yield),
          exDate,
        ]],
      );
      chatBotStatus.textContent = data.message;
      return;
    }

    if (data.intent === 'news') {
      const results = Array.isArray(data.results) ? data.results : [];
      renderBotChart([], [], '', null);
      const rows = results.map((row) => ([
        row.title || '- ',
        row.publisher || '-',
        row.link || '-',
      ]));
      renderBotTable(
        ['Title', 'Source', 'Link'],
        rows,
      );
      chatBotStatus.textContent = data.message || 'Latest news.';
      return;
    }

    if (data.intent === 'sector') {
      const results = Array.isArray(data.results) ? data.results : [];
      renderBotChart([], [], '', null);
      const rows = results.map((row) => ([row.symbol]));
      renderBotTable(['Symbol'], rows);
      chatBotStatus.textContent = data.message || 'Sector stocks.';
      return;
    }

    if (data.intent === 'cheap') {
      const results = Array.isArray(data.results) ? data.results : [];
      renderBotChart([], [], '', null);
      const rows = results.map((row) => ([
        row.symbol,
        formatCurrency(row.price),
      ]));
      renderBotTable(['Symbol', 'Price'], rows);
      chatBotStatus.textContent = data.message || 'Cheap stocks.';
      return;
    }

    if (data.intent === 'fundamentals') {
      renderBotChart([], [], '', null);
      renderBotTable(
        ['Symbol', 'Market Cap', 'PE'],
        [[data.symbol, formatCompactNumber(data.market_cap), formatNumber(data.pe)]],
      );
      chatBotStatus.textContent = data.message;
      return;
    }

    if (data.intent === 'gainers' || data.intent === 'losers') {
      const results = Array.isArray(data.results) ? data.results : [];
      const labels = results.map((row) => row.symbol);
      const values = results.map((row) => Number(row.changePercent || 0));
      renderBotChart(
        labels,
        values,
        'Change %',
        (value) => `${Number(value).toFixed(2)}%`,
        'bar',
        data.intent === 'gainers' ? 'Top Gainers' : 'Top Losers',
        'Change %',
      );

      const rows = results.map((row) => ([
        row.symbol,
        row.name,
        formatCurrency(row.price),
        formatPercent(row.changePercent / 100),
      ]));
      renderBotTable(
        ['Symbol', 'Name', 'Price', 'Change %'],
        rows,
      );
      chatBotStatus.textContent = data.message || 'Market movers.';
      return;
    }

    if (data.intent === 'pe') {
      renderBotChart([], [], '', null);
      renderBotTable(
        ['Symbol', 'PE'],
        [[data.symbol, formatNumber(data.pe)]],
      );
      chatBotStatus.textContent = data.message;
      return;
    }

    if (data.intent === 'volume') {
      renderBotChart([], [], '', null);
      renderBotTable(
        ['Symbol', 'Volume'],
        [[data.symbol, formatCompactNumber(data.volume)]],
      );
      chatBotStatus.textContent = data.message;
      return;
    }

    if (data.intent === 'volume_chart') {
      const labels = (data.chart || []).map((row) => new Date(row.date).toLocaleDateString());
      const values = (data.chart || []).map((row) => Number(row.volume));
      const volumeSubtitle = (data.message || '').toLowerCase().includes('last month')
        ? 'Last month volume'
        : 'Volume';
      renderBotChart(
        labels,
        values,
        `Volume • ${data.symbol}`,
        (value) => formatCompactNumber(value),
        'bar',
        data.symbol,
        volumeSubtitle,
      );
      const rows = (data.series || []).map((row) => ([
        new Date(row.date).toLocaleDateString(),
        formatCompactNumber(row.volume),
      ]));
      renderBotTable(['Date', 'Volume'], rows);
      chatBotStatus.textContent = data.message;
      return;
    }

    if (data.intent === 'volume_list') {
      const results = Array.isArray(data.results) ? data.results : [];
      const labels = results.map((row) => row.symbol);
      const values = results.map((row) => Number(row.volume || 0));
      renderBotChart(
        labels,
        values,
        'Volume',
        (value) => formatCompactNumber(value),
        'bar',
        'Most Traded Stocks',
        'Volume',
      );
      const rows = results.map((row) => ([
        row.symbol,
        row.name,
        formatCurrency(row.price),
        formatCompactNumber(row.volume),
      ]));
      renderBotTable(
        ['Symbol', 'Name', 'Price', 'Volume'],
        rows,
      );
      chatBotStatus.textContent = data.message || 'Most traded stocks.';
      return;
    }

    if (data.intent === 'high_52w' || data.intent === 'low_52w') {
      renderBotChart([], [], '', null);
      renderBotTable(
        ['Symbol', '52W High', '52W Low'],
        [[data.symbol, formatCurrency(data.high_52w), formatCurrency(data.low_52w)]],
      );
      chatBotStatus.textContent = data.message;
      return;
    }

    if (data.intent === 'chart' || data.intent === 'historical') {
      const labels = (data.chart || []).map((row) => new Date(row.date).toLocaleDateString());
      const values = (data.chart || []).map((row) => Number(row.close));
      renderBotChart(
        labels,
        values,
        `${data.symbol} Close`,
        (value) => formatCurrency(value),
        'line',
        data.symbol,
        data.intent === 'chart' ? '3-month price trend' : 'Historical trend',
      );
      const rows = (data.series || []).map((row) => ([
        new Date(row.date).toLocaleDateString(),
        formatCurrency(row.close),
      ]));
      renderBotTable(['Date', 'Close'], rows);
      chatBotStatus.textContent = data.message;
      return;
    }

    if (data.intent === 'index') {
      const labels = (data.chart || []).map((row) => new Date(row.date).toLocaleDateString());
      const values = (data.chart || []).map((row) => Number(row.close));
      renderBotChart(
        labels,
        values,
        `${data.symbol} Index`,
        (value) => formatCurrency(value),
        'line',
        data.symbol,
        'Index movement',
      );
      renderBotTable(
        ['Index', 'Price', 'Change', 'Change %'],
        [[
          data.symbol,
          formatCurrency(data.price),
          formatCurrency(data.change),
          formatPercent(data.change_pct),
        ]],
      );
      chatBotStatus.textContent = data.message;
      return;
    }

    if (data.intent === 'compare') {
      renderBotChart([], [], '', null);
      const rows = (data.rows || []).map((row) => ([
        row.symbol,
        formatCurrency(row.price),
        formatPercent(row.return_1m),
        formatCompactNumber(row.market_cap),
        formatNumber(row.pe),
      ]));
      renderBotTable(
        ['Symbol', 'Price', '1M Return', 'Market Cap', 'PE'],
        rows,
      );
      chatBotStatus.textContent = data.message;
      return;
    }

    if (data.intent === 'all_time_high') {
      renderBotChart([], [], '', null);
      renderBotTable(
        ['Symbol', 'All Time High'],
        [[data.symbol, formatCurrency(data.value)]],
      );
      chatBotStatus.textContent = data.message;
      return;
    }

    chatBotStatus.textContent = data.message || 'Query completed.';
  } catch (error) {
    chatBotStatus.textContent = `Bot error: ${error.message}`;
  }
};

const loadChatMessages = async () => {
  if (!activeUser || !activeChatPeer) return;
  try {
    const messages = await fetchJSON(`${API_BASE}/chat/messages?peerId=${activeChatPeer}`, {
      headers: { 'x-user-id': activeUser.id }
    });
    renderChatMessages(messages, activeUser.id);
  } catch (error) {
    if (chatStatus) chatStatus.textContent = error.message;
  }
};

const startChatPolling = () => {
  if (chatPollId) clearInterval(chatPollId);
  loadChatMessages();
  chatPollId = setInterval(loadChatMessages, 3000);
};

const setChatOpen = (isOpen) => {
  if (!chatDock) return;
  chatDock.classList.toggle('open', isOpen);
  if (chatToggle) chatToggle.setAttribute('aria-expanded', String(isOpen));
};

const teardownChat = () => {
  if (chatDock) {
    chatDock.setAttribute('aria-hidden', 'true');
    chatDock.style.display = 'none';
  }
  setChatOpen(false);
  if (chatPollId) clearInterval(chatPollId);
  chatPollId = null;
  activeChatPeer = null;
};

const setupChatForUser = async (user) => {
  if (!chatDock) return;
  chatDock.removeAttribute('aria-hidden');
  chatDock.style.display = 'block';

  if (chatStatus) chatStatus.textContent = '';

  if (user.role === 'admin') {
    if (chatUserSelect) chatUserSelect.style.display = 'inline-flex';
    if (chatUserLabel) chatUserLabel.style.display = 'inline-flex';
    if (chatPeerPill) chatPeerPill.style.display = 'none';

    try {
      const users = await fetchJSON(`${API_BASE}/users`, {
        headers: { 'x-user-id': user.id }
      });
      const selectable = users.filter((u) => u.role !== 'admin');
      if (chatUserSelect) {
        chatUserSelect.innerHTML = '';
        if (!selectable.length) {
          const option = document.createElement('option');
          option.value = '';
          option.textContent = 'No users yet';
          chatUserSelect.appendChild(option);
        }
        selectable.forEach((u) => {
          const option = document.createElement('option');
          option.value = u.id;
          option.textContent = `${u.name || 'User'} (${u.email})`;
          chatUserSelect.appendChild(option);
        });
      }
      activeChatPeer = selectable.length ? selectable[0].id : null;
      if (!activeChatPeer) {
        if (chatStatus) chatStatus.textContent = 'No users available to chat yet.';
        renderChatMessages([], user.id);
        setChatEnabled(false);
        return;
      }
      setChatEnabled(true);
      startChatPolling();
    } catch (error) {
      if (chatStatus) chatStatus.textContent = error.message;
    }
  } else {
    if (chatUserSelect) chatUserSelect.style.display = 'none';
    if (chatUserLabel) chatUserLabel.style.display = 'none';
    if (chatPeerPill) chatPeerPill.style.display = 'inline-flex';
    try {
      const admins = await fetchJSON(`${API_BASE}/admins`, {
        headers: { 'x-user-id': user.id }
      });
      const admin = admins[0];
      activeChatPeer = admin ? admin.id : null;
      if (chatPeerPill) chatPeerPill.textContent = admin ? `Admin: ${admin.name || admin.email}` : 'Admin unavailable';
      if (!activeChatPeer) {
        if (chatStatus) chatStatus.textContent = 'No admin available yet.';
        renderChatMessages([], user.id);
        setChatEnabled(false);
        return;
      }
      setChatEnabled(true);
      startChatPolling();
    } catch (error) {
      if (chatStatus) chatStatus.textContent = error.message;
    }
  }
};

const toggleChat = () => {
  if (!chatDock) return;
  const isOpen = chatDock.classList.contains('open');
  setChatOpen(!isOpen);
};

if (chatToggle) {
  chatToggle.addEventListener('click', toggleChat);
}

if (chatToggleLink) {
  chatToggleLink.addEventListener('click', (e) => {
    e.preventDefault();
    toggleChat();
  });
}

if (chatClose) {
  chatClose.addEventListener('click', () => {
    setChatOpen(false);
  });
}

if (aiBotToggle) {
  aiBotToggle.addEventListener('click', () => {
    const isOpen = aiBotDock && aiBotDock.classList.contains('open');
    setAiBotOpen(!isOpen);
  });
}

if (aiBotClose) {
  aiBotClose.addEventListener('click', () => setAiBotOpen(false));
}

if (aiBotExpand) {
  aiBotExpand.addEventListener('click', () => {
    if (!lastBotChartConfig) {
      if (chatBotStatus) chatBotStatus.textContent = 'Run a query with chart data first.';
      return;
    }
    setAiBotModalOpen(true);
    renderBotModalChart();
  });
}

if (aiBotModalClose) {
  aiBotModalClose.addEventListener('click', () => setAiBotModalOpen(false));
}

if (aiBotModalBackdrop) {
  aiBotModalBackdrop.addEventListener('click', () => setAiBotModalOpen(false));
}

if (aiBotForm) {
  aiBotForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!aiBotInput) return;
    const message = aiBotInput.value.trim();
    if (!message) {
      if (chatBotStatus) chatBotStatus.textContent = 'Type a supported query first.';
      return;
    }
    if (!activeUser) {
      if (chatBotStatus) chatBotStatus.textContent = 'Please sign in to use the bot.';
      return;
    }
    aiBotInput.value = '';
    await runBotQuery(message);
  });
}

if (expenseOpenBtn) {
  expenseOpenBtn.addEventListener('click', () => {
    setExpenseModalOpen(true);
    const dateInput = document.getElementById('expense-date');
    if (dateInput && !dateInput.value) {
      dateInput.valueAsDate = new Date();
    }
  });
}

if (expenseClose) {
  expenseClose.addEventListener('click', () => setExpenseModalOpen(false));
}

if (expenseBackdrop) {
  expenseBackdrop.addEventListener('click', () => setExpenseModalOpen(false));
}

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && expenseModal && expenseModal.classList.contains('open')) {
    setExpenseModalOpen(false);
  }
});

if (chatUserSelect) {
  chatUserSelect.addEventListener('change', (e) => {
    activeChatPeer = Number(e.target.value);
    if (!activeChatPeer) {
      setChatEnabled(false);
      if (chatStatus) chatStatus.textContent = 'Select a user to chat with.';
      return;
    }
    setChatEnabled(true);
    startChatPolling();
  });
}

if (chatForm) {
  chatForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const message = chatInput.value.trim();
    if (!message) return;

    if (isStockQuery(message)) {
      if (!activeUser) {
        if (chatStatus) chatStatus.textContent = 'Please sign in to use the bot.';
        return;
      }
      chatInput.value = '';
      if (chatStatus) chatStatus.textContent = '';
      await runBotQuery(message);
      return;
    }

    if (!activeUser || !activeChatPeer) {
      if (chatStatus) {
        chatStatus.textContent = activeUser && activeUser.role === 'admin'
          ? 'Select a user to chat with.'
          : 'No admin available yet.';
      }
      return;
    }

    if (chatStatus) chatStatus.textContent = 'Sending...';

    try {
      await fetchJSON(`${API_BASE}/chat/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': activeUser.id,
        },
        body: JSON.stringify({ receiverId: activeChatPeer, message })
      });

      chatInput.value = '';
      if (chatStatus) chatStatus.textContent = '';
      loadChatMessages();
    } catch (error) {
      if (chatStatus) chatStatus.textContent = error.message;
    }
  });
}

if (expenseForm) {
  expenseForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!activeUser) {
      if (expenseStatus) expenseStatus.textContent = 'Please sign in to save expenses.';
      return;
    }

    const amount = Number(document.getElementById('expense-amount').value);
    const category = document.getElementById('expense-category').value;
    const expenseDate = document.getElementById('expense-date').value;
    const paymentMethod = document.getElementById('expense-method').value;
    const note = document.getElementById('expense-note').value.trim();

    if (expenseStatus) expenseStatus.textContent = 'Saving...';

    try {
      const payload = {
        amount,
        category,
        expense_date: expenseDate,
        payment_method: paymentMethod,
        note,
      };

      const created = await fetchJSON(`${API_BASE}/expenses`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': activeUser.id,
        },
        body: JSON.stringify(payload),
      });

      expenses = [created, ...expenses];
      renderExpenses(expenses);
      renderDashboard(expenses);
      if (expenseStatus) expenseStatus.textContent = 'Saved!';
      expenseForm.reset();
    } catch (error) {
      if (expenseStatus) expenseStatus.textContent = error.message;
    }
  });
}

if (adminExpenseUser) {
  adminExpenseUser.addEventListener('change', (event) => {
    adminSelectedUserId = Number(event.target.value) || null;
    loadAdminExpenses();
  });
}

if (adminDashboardUser) {
  adminDashboardUser.addEventListener('change', (event) => {
    adminDashboardUserId = event.target.value;
    loadAdminDashboardExpenses();
  });
}

if (adminMomentumRefresh) {
  adminMomentumRefresh.addEventListener('click', () => {
    loadMomentumStocks();
  });
}

if (adminExpenseForm) {
  adminExpenseForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!activeUser || activeUser.role !== 'admin') {
      if (adminExpenseStatus) adminExpenseStatus.textContent = 'Admin access required.';
      return;
    }
    if (!adminSelectedUserId) {
      if (adminExpenseStatus) adminExpenseStatus.textContent = 'Select a user first.';
      return;
    }

    const amount = Number(document.getElementById('admin-expense-amount').value);
    const category = document.getElementById('admin-expense-category').value;
    const expenseDate = document.getElementById('admin-expense-date').value;
    const paymentMethod = document.getElementById('admin-expense-method').value;
    const note = document.getElementById('admin-expense-note').value.trim();

    if (adminExpenseStatus) adminExpenseStatus.textContent = 'Saving...';
    try {
      const payload = {
        user_id: adminSelectedUserId,
        amount,
        category,
        expense_date: expenseDate,
        payment_method: paymentMethod,
        note,
      };
      await fetchJSON(`${API_BASE}/admin/expenses`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': activeUser.id,
        },
        body: JSON.stringify(payload),
      });
      if (adminExpenseStatus) adminExpenseStatus.textContent = 'Saved!';
      adminExpenseForm.reset();
      if (adminExpenseDate) adminExpenseDate.valueAsDate = new Date();
      loadAdminExpenses();
    } catch (error) {
      if (adminExpenseStatus) adminExpenseStatus.textContent = error.message;
    }
  });
}

const storedUser = getStoredUser();
setAuthState(storedUser);

if (loginForm) {
  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    loginResponse.textContent = 'Signing in...';

    const email = document.getElementById('login-email').value;
    const password = document.getElementById('login-password').value;

    try {
      const res = await fetch(`${API_BASE}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });

      if (!res.ok) {
        const errData = await res.json();
        loginResponse.textContent = errData.error || 'Login failed';
        return;
      }

      const user = await res.json();
      loginResponse.textContent = '';
      setAuthState(user);
    } catch (error) {
      console.error(error);
      loginResponse.textContent = 'Server error. Try again.';
    }
  });
}

if (logoutBtn) {
  logoutBtn.addEventListener('click', () => {
    setAuthState(null);
  });
}

if (adminForm) {
  adminForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (adminResponse) adminResponse.textContent = 'Creating user...';

    const stored = getStoredUser();
    if (!stored || !stored.id) {
      if (adminResponse) adminResponse.textContent = 'Missing admin session.';
      return;
    }

    const name = document.getElementById('admin-name').value;
    const email = document.getElementById('admin-email').value;
    const password = document.getElementById('admin-password').value;
    const role = document.getElementById('admin-role').value;

    try {
      const res = await fetch(`${API_BASE}/admin/users`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': stored.id,
        },
        body: JSON.stringify({ name, email, password, role })
      });

      const data = await res.json();
      if (!res.ok) {
        if (adminResponse) adminResponse.textContent = data.error || 'Failed to create user.';
        return;
      }

      if (adminResponse) adminResponse.textContent = `User created: ${data.email}`;
      adminForm.reset();
    } catch (error) {
      console.error(error);
      if (adminResponse) adminResponse.textContent = 'Server error. Try again.';
    }
  });
}

form.addEventListener('submit', async function (e) {
  e.preventDefault();

  console.log("Form submitted"); // debug

  const name = document.getElementById('name').value;
  const email = document.getElementById('email').value;
  const message = document.getElementById('message').value;

  formResponse.textContent = 'Sending...';

  try {
    const res = await fetch(`${API_BASE}/contact`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, message })
    });

    const data = await res.text();
    formResponse.textContent = data;
  } catch (error) {
    console.error(error);
    formResponse.textContent = 'Error sending message';
  }
});