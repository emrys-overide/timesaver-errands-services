// ChapChap Errands - Complete Client Application Logic

class ChapChapApp {
  constructor() {
    this.errands = [];
    this.runners = [];
    this.adminRunners = [];
    this.adminOverview = {};
    
    // Auth Sessions (persisted in localStorage)
    this.currentUser = JSON.parse(localStorage.getItem('chapchap_user') || 'null');
    this.currentRunner = JSON.parse(localStorage.getItem('chapchap_runner') || 'null');
    this.currentAdmin = JSON.parse(localStorage.getItem('chapchap_admin') || 'null');

    this.activeRunnerId = this.currentRunner?.id || 'RUN-101';
    this.currentCategory = 'shopping';
    this.viewMode = 'customer'; // 'customer', 'runner', 'register-runner', 'admin', 'split'
    this.adminTab = 'runners'; // 'runners' or 'errands'
    this.activeChatErrandId = null;
    this.verifyPinErrandId = null;
    this.runnerTab = 'available';
    this.eventSource = null;

    // Temporary storage for file upload data URLs
    this.uploadCache = {
      avatar: null,
      idFront: null,
      idBack: null
    };

    this.init();
  }

  async init() {
    this.updateAuthPill();
    await this.fetchRunners();
    await this.fetchErrands();
    this.initRealtimeStream();
    this.recalculateEstimate();

    // Auto-fill customer form if logged in
    if (this.currentUser) {
      const nameInput = document.getElementById('input-customer-name');
      const phoneInput = document.getElementById('input-customer-phone');
      if (nameInput) nameInput.value = this.currentUser.name;
      if (phoneInput) phoneInput.value = this.currentUser.phone;
    }

    // Periodic sync fallback
    setInterval(() => this.fetchErrands(true), 4000);
  }

  // --- Realtime SSE Connection ---
  initRealtimeStream() {
    try {
      this.eventSource = new EventSource('/api/events');
      
      this.eventSource.addEventListener('errand_created', (e) => {
        const newErrand = JSON.parse(e.data);
        if (!this.errands.some(item => item.id === newErrand.id)) {
          this.errands.unshift(newErrand);
          this.showToast(`New Errand Posted: ${newErrand.id} (${newErrand.title})`, 'info');
          this.render();
        }
      });

      this.eventSource.addEventListener('errand_claimed', (e) => {
        const updated = JSON.parse(e.data);
        const idx = this.errands.findIndex(item => item.id === updated.id);
        if (idx !== -1) {
          this.errands[idx] = updated;
          this.showToast(`Errand ${updated.id} picked up by ${updated.runner?.name || 'Runner'}!`, 'success');
          this.render();
          if (this.activeChatErrandId === updated.id) {
            this.renderChatMessages(updated);
          }
        }
      });

      this.eventSource.addEventListener('errand_status_updated', (e) => {
        const updated = JSON.parse(e.data);
        const idx = this.errands.findIndex(item => item.id === updated.id);
        if (idx !== -1) {
          this.errands[idx] = updated;
          this.showToast(`Status updated: ${updated.id} is now ${updated.status.replace('_', ' ')}`, 'info');
          this.render();
          if (this.activeChatErrandId === updated.id) {
            this.renderChatMessages(updated);
          }
        }
      });

      this.eventSource.addEventListener('errand_completed', (e) => {
        const updated = JSON.parse(e.data);
        const idx = this.errands.findIndex(item => item.id === updated.id);
        if (idx !== -1) {
          this.errands[idx] = updated;
          this.showToast(`🎉 Errand ${updated.id} successfully completed and verified!`, 'success');
          this.render();
          if (this.activeChatErrandId === updated.id) {
            this.renderChatMessages(updated);
          }
        }
      });

      this.eventSource.addEventListener('chat_message', (e) => {
        const payload = JSON.parse(e.data);
        const errand = this.errands.find(item => item.id === payload.errandId);
        if (errand) {
          if (!errand.messages) errand.messages = [];
          if (!errand.messages.some(m => m.id === payload.message.id)) {
            errand.messages.push(payload.message);
          }
          if (this.activeChatErrandId === payload.errandId) {
            this.renderChatMessages(errand);
          } else {
            this.showToast(`New message on ${payload.errandId}: "${payload.message.text.substring(0, 35)}..."`, 'info');
          }
        }
      });

      this.eventSource.addEventListener('runner_registered', (e) => {
        const data = JSON.parse(e.data);
        this.showToast(`New Runner Application: ${data.name} (${data.activeLocation})`, 'info');
        if (this.viewMode === 'admin') this.refreshAdminData();
      });

      this.eventSource.addEventListener('runner_verified', (e) => {
        const data = JSON.parse(e.data);
        this.fetchRunners();
        if (this.viewMode === 'admin') this.refreshAdminData();
      });

    } catch (err) {
      console.warn("SSE stream fallback to polling", err);
    }
  }

  // --- API Calls ---
  async fetchRunners() {
    try {
      const res = await fetch('/api/runners');
      this.runners = await res.json();
      this.updateRunnerProfileHeader();
    } catch (err) {
      console.error("Failed to load runners", err);
    }
  }

  async fetchErrands(isSilent = false) {
    try {
      const res = await fetch('/api/errands');
      this.errands = await res.json();
      this.render();
    } catch (err) {
      if (!isSilent) console.error("Failed to load errands", err);
    }
  }

  updateRunnerProfileHeader() {
    const current = (this.currentRunner && this.runners.find(r => r.id === this.currentRunner.id)) 
      || this.runners.find(r => r.id === this.activeRunnerId) 
      || this.runners[0];

    if (!current) return;

    this.activeRunnerId = current.id;
    const avatarEl = document.getElementById('runner-current-avatar');
    const nameEl = document.getElementById('runner-current-name');
    const badgeEl = document.getElementById('runner-current-badge');
    const idEl = document.getElementById('runner-current-id-number');
    const locEl = document.getElementById('runner-current-location');
    const ratingEl = document.getElementById('runner-current-rating');

    if (avatarEl) avatarEl.src = current.avatar;
    if (nameEl) nameEl.textContent = current.name;
    if (badgeEl) badgeEl.textContent = current.badge;
    if (idEl) idEl.textContent = current.idNumberVerified;
    if (locEl) locEl.textContent = current.activeLocation;
    if (ratingEl) ratingEl.textContent = `${current.rating} ★ (${current.completedErrands} runs)`;
  }

  // --- User Auth & Session Handling ---
  updateAuthPill() {
    const userPill = document.getElementById('auth-user-pill');
    const authBtn = document.getElementById('btn-open-auth');
    const nameEl = document.getElementById('auth-user-name');
    const initialEl = document.getElementById('auth-user-initial');

    const activeEntity = this.currentUser || this.currentRunner || this.currentAdmin;

    if (activeEntity) {
      userPill.classList.remove('hidden');
      userPill.classList.add('flex');
      authBtn.classList.add('hidden');
      const roleBadge = activeEntity.role === 'admin' ? ' (Admin)' : (activeEntity.role === 'customer' ? '' : ' (Runner)');
      nameEl.textContent = `${activeEntity.name}${roleBadge}`;
      initialEl.textContent = activeEntity.name.charAt(0).toUpperCase();
    } else {
      userPill.classList.add('hidden');
      userPill.classList.remove('flex');
      authBtn.classList.remove('hidden');
    }
  }

  openAuthModal(tab = 'customer-login') {
    document.getElementById('auth-modal').classList.remove('hidden');
    this.switchAuthTab(tab);
    if (window.lucide) lucide.createIcons();
  }

  closeAuthModal() {
    document.getElementById('auth-modal').classList.add('hidden');
  }

  switchAuthTab(tab) {
    const tabCustomer = document.getElementById('tab-auth-customer');
    const tabRunner = document.getElementById('tab-auth-runner');
    const tabAdmin = document.getElementById('tab-auth-admin');
    const formCustLogin = document.getElementById('form-customer-login');
    const formCustReg = document.getElementById('form-customer-register');
    const formRunLogin = document.getElementById('form-runner-login');
    const formAdmLogin = document.getElementById('form-admin-login');
    const title = document.getElementById('auth-modal-title');

    [tabCustomer, tabRunner, tabAdmin].forEach(b => b.className = "py-1.5 rounded-lg text-slate-600 hover:text-slate-900");
    [formCustLogin, formCustReg, formRunLogin, formAdmLogin].forEach(f => f.classList.add('hidden'));

    if (tab === 'customer-login') {
      tabCustomer.className = "py-1.5 rounded-lg bg-white shadow-xs text-slate-900 font-bold";
      formCustLogin.classList.remove('hidden');
      title.textContent = "Customer Sign In";
    } else if (tab === 'customer-register') {
      tabCustomer.className = "py-1.5 rounded-lg bg-white shadow-xs text-slate-900 font-bold";
      formCustReg.classList.remove('hidden');
      title.textContent = "Create Customer Account";
    } else if (tab === 'runner-login') {
      tabRunner.className = "py-1.5 rounded-lg bg-white shadow-xs text-amber-700 font-bold";
      formRunLogin.classList.remove('hidden');
      title.textContent = "Runner Portal Login";
    } else if (tab === 'admin-login') {
      tabAdmin.className = "py-1.5 rounded-lg bg-white shadow-xs text-slate-900 font-bold";
      formAdmLogin.classList.remove('hidden');
      title.textContent = "Operations Admin Sign In";
    }
  }

  async handleCustomerLogin(e) {
    e.preventDefault();
    const email = document.getElementById('login-cust-email').value.trim();
    const password = document.getElementById('login-cust-pass').value;

    try {
      const res = await fetch('/api/auth/login-customer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Login failed");

      this.currentUser = data.user;
      localStorage.setItem('chapchap_user', JSON.stringify(data.user));
      this.updateAuthPill();
      this.closeAuthModal();
      this.showToast(`Welcome back, ${data.user.name}!`, 'success');

      // Pre-fill form
      const nameInput = document.getElementById('input-customer-name');
      const phoneInput = document.getElementById('input-customer-phone');
      if (nameInput) nameInput.value = data.user.name;
      if (phoneInput) phoneInput.value = data.user.phone;

      this.setViewMode('customer');

    } catch (err) {
      alert(err.message);
    }
  }

  async handleCustomerRegister(e) {
    e.preventDefault();
    const payload = {
      name: document.getElementById('reg-cust-name').value.trim(),
      phone: document.getElementById('reg-cust-phone').value.trim(),
      email: document.getElementById('reg-cust-email').value.trim(),
      password: document.getElementById('reg-cust-pass').value
    };

    try {
      const res = await fetch('/api/auth/register-customer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Registration failed");

      this.currentUser = data.user;
      localStorage.setItem('chapchap_user', JSON.stringify(data.user));
      this.updateAuthPill();
      this.closeAuthModal();
      this.showToast(`Account created! Welcome to ChapChap, ${data.user.name}!`, 'success');

      const nameInput = document.getElementById('input-customer-name');
      const phoneInput = document.getElementById('input-customer-phone');
      if (nameInput) nameInput.value = data.user.name;
      if (phoneInput) phoneInput.value = data.user.phone;

      this.setViewMode('customer');

    } catch (err) {
      alert(err.message);
    }
  }

  async handleRunnerLogin(e) {
    e.preventDefault();
    const login = document.getElementById('login-run-term').value.trim();
    const password = document.getElementById('login-run-pass').value;

    try {
      const res = await fetch('/api/auth/login-runner', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ login, password })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Invalid credentials");

      this.currentRunner = data.runner;
      this.activeRunnerId = data.runner.id;
      localStorage.setItem('chapchap_runner', JSON.stringify(data.runner));
      this.updateAuthPill();
      this.updateRunnerProfileHeader();
      this.closeAuthModal();
      this.showToast(`Logged in as Runner: ${data.runner.name}`, 'success');
      this.setViewMode('runner');

    } catch (err) {
      alert(err.message);
    }
  }

  async handleAdminLogin(e) {
    e.preventDefault();
    const email = document.getElementById('login-adm-email').value.trim();
    const password = document.getElementById('login-adm-pass').value;

    try {
      const res = await fetch('/api/auth/login-admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Admin login failed");

      this.currentAdmin = data.admin;
      localStorage.setItem('chapchap_admin', JSON.stringify(data.admin));
      this.updateAuthPill();
      this.closeAuthModal();
      this.showToast("Admin access granted", 'success');
      this.openAdminPortal();

    } catch (err) {
      alert(err.message);
    }
  }

  handleLogout() {
    this.currentUser = null;
    this.currentRunner = null;
    this.currentAdmin = null;
    localStorage.removeItem('chapchap_user');
    localStorage.removeItem('chapchap_runner');
    localStorage.removeItem('chapchap_admin');
    this.updateAuthPill();
    this.setViewMode('customer');
    this.showToast("Signed out successfully", 'info');
  }

  // --- Runner Registration & Document Uploads ---
  handleImagePreview(inputEl, previewImgId) {
    if (inputEl.files && inputEl.files[0]) {
      const file = inputEl.files[0];
      const reader = new FileReader();

      reader.onload = (e) => {
        const previewImg = document.getElementById(previewImgId);
        const iconId = previewImgId.replace('preview-', 'icon-');
        const iconEl = document.getElementById(iconId);

        previewImg.src = e.target.result;
        previewImg.classList.remove('hidden');
        if (iconEl) iconEl.classList.add('hidden');

        // Cache in memory
        if (previewImgId.includes('avatar')) this.uploadCache.avatar = e.target.result;
        if (previewImgId.includes('id-front')) this.uploadCache.idFront = e.target.result;
        if (previewImgId.includes('id-back')) this.uploadCache.idBack = e.target.result;
      };

      reader.readAsDataURL(file);
    }
  }

  async handleRunnerRegistration(e) {
    e.preventDefault();
    const btn = document.getElementById('btn-submit-runner-reg');
    btn.disabled = true;
    btn.innerHTML = `<span class="animate-spin inline-block mr-2">⚙️</span> Submitting Documents & Creating Profile...`;

    try {
      const payload = {
        name: document.getElementById('reg-runner-name').value.trim(),
        phone: document.getElementById('reg-runner-phone').value.trim(),
        email: document.getElementById('reg-runner-email').value.trim(),
        password: document.getElementById('reg-runner-password').value,
        idNumber: document.getElementById('reg-runner-id-number').value.trim(),
        activeLocation: document.getElementById('reg-runner-location').value,
        vehicleType: document.getElementById('reg-runner-vehicle').value,
        bio: document.getElementById('reg-runner-bio').value.trim(),
        avatar: this.uploadCache.avatar,
        idCardFront: this.uploadCache.idFront,
        idCardBack: this.uploadCache.idBack
      };

      const res = await fetch('/api/auth/register-runner', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to register runner");

      this.currentRunner = data.runner;
      this.activeRunnerId = data.runner.id;
      localStorage.setItem('chapchap_runner', JSON.stringify(data.runner));
      this.updateAuthPill();

      alert(`🎉 Application Submitted Successfully!\n\nYour profile and ID documents (Front & Back) are now with ChapChap Admin for verification. You can now access your runner portal.`);
      
      this.setViewMode('runner');

    } catch (err) {
      alert(`Error: ${err.message}`);
    } finally {
      btn.disabled = false;
      btn.innerHTML = `<i data-lucide="shield-check" class="w-5 h-5 inline-block mr-2"></i><span>Submit Runner Application for Verification</span>`;
      if (window.lucide) lucide.createIcons();
    }
  }

  // --- Admin Portal Functionality ---
  openAdminPortal() {
    if (!this.currentAdmin) {
      this.openAuthModal('admin-login');
      return;
    }
    this.setViewMode('admin');
    this.refreshAdminData();
  }

  async refreshAdminData() {
    try {
      // 1. Overview metrics
      const ovRes = await fetch('/api/admin/overview');
      this.adminOverview = await ovRes.json();

      document.getElementById('adm-metric-errands').textContent = this.adminOverview.totalErrands;
      document.getElementById('adm-metric-completed').textContent = `${this.adminOverview.completedErrands} completed`;
      document.getElementById('adm-metric-revenue').textContent = `KES ${this.adminOverview.totalRevenue.toLocaleString()}`;
      document.getElementById('adm-metric-transit').textContent = `KES ${this.adminOverview.totalMatatuPaid.toLocaleString()}`;
      document.getElementById('adm-metric-pending-runners').textContent = this.adminOverview.pendingRunners;
      document.getElementById('adm-metric-total-runners').textContent = `${this.adminOverview.totalRunners} total registered`;
      document.getElementById('adm-badge-pending').textContent = this.adminOverview.pendingRunners;

      // 2. All Runners
      const runRes = await fetch('/api/admin/runners');
      this.adminRunners = await runRes.json();
      this.renderAdminRunners();

      // 3. Render Errands
      this.renderAdminErrands();

    } catch (err) {
      console.error("Admin data fetch failed", err);
    }
  }

  renderAdminRunners() {
    const tbody = document.getElementById('admin-runners-table-body');
    if (!tbody) return;

    if (!this.adminRunners || this.adminRunners.length === 0) {
      tbody.innerHTML = `<div class="p-6 text-center text-xs text-slate-400">No registered runners found.</div>`;
      return;
    }

    tbody.innerHTML = this.adminRunners.map(runner => {
      const isApproved = runner.verificationStatus === 'approved';
      const isPending = runner.verificationStatus === 'pending';

      const statusBadge = isApproved 
        ? `<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800">Approved & Vetted</span>`
        : (isPending 
          ? `<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800">Pending Review</span>`
          : `<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-100 text-rose-800">Rejected</span>`);

      return `
        <div class="p-4 flex flex-col md:flex-row items-start md:items-center justify-between gap-3 hover:bg-slate-50 transition">
          <div class="flex items-center space-x-3">
            <img src="${runner.avatar}" alt="${runner.name}" class="w-12 h-12 rounded-full object-cover border border-slate-200">
            <div>
              <div class="flex items-center gap-2">
                <span class="font-bold text-sm text-slate-900">${runner.name}</span>
                ${statusBadge}
              </div>
              <p class="text-xs text-slate-500 font-mono">${runner.phone} • ID: ${runner.idNumber || 'N/A'}</p>
              <div class="text-[11px] text-slate-400 flex items-center gap-2 mt-0.5">
                <span>📍 ${runner.activeLocation}</span>
                <span>•</span>
                <span>⭐ ${runner.rating} (${runner.completedErrands} completed)</span>
              </div>
            </div>
          </div>

          <div class="flex items-center space-x-2">
            <button onclick="app.openAdminDocModal('${runner.id}')" class="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-xs rounded-xl flex items-center gap-1.5 transition">
              <i data-lucide="eye" class="w-3.5 h-3.5"></i> Inspect ID Front & Back
            </button>
            ${isPending ? `
              <button onclick="app.adminVerifyRunner('${runner.id}', 'approve')" class="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-xl shadow-xs transition flex items-center gap-1">
                <i data-lucide="check" class="w-3.5 h-3.5"></i> Approve
              </button>
              <button onclick="app.adminVerifyRunner('${runner.id}', 'reject')" class="px-3 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-600 border border-rose-200 font-bold text-xs rounded-xl transition">
                Reject
              </button>
            ` : `
              <button onclick="app.adminVerifyRunner('${runner.id}', '${isApproved ? 'reject' : 'approve'}')" class="px-3 py-1.5 text-xs font-medium text-slate-500 hover:text-slate-800 underline">
                ${isApproved ? 'Revoke Approval' : 'Re-Approve'}
              </button>
            `}
          </div>
        </div>
      `;
    }).join('');

    if (window.lucide) lucide.createIcons();
  }

  renderAdminErrands() {
    const container = document.getElementById('admin-errands-table-body');
    if (!container) return;

    if (this.errands.length === 0) {
      container.innerHTML = `<div class="p-6 text-center text-xs text-slate-400">No errands recorded.</div>`;
      return;
    }

    container.innerHTML = this.errands.map(errand => {
      const isPaid = errand.paymentStatus === 'Verified';

      return `
        <div class="p-4 flex flex-col md:flex-row items-start md:items-center justify-between gap-3 hover:bg-slate-50 transition">
          <div>
            <div class="flex items-center gap-2">
              <span class="font-mono text-xs font-bold text-slate-400">${errand.id}</span>
              <span class="font-bold text-sm text-slate-900">${errand.title}</span>
              <span class="text-[10px] uppercase font-bold px-2 py-0.5 rounded-full ${errand.status === 'completed' ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-700'}">
                ${errand.status}
              </span>
            </div>
            <p class="text-xs text-slate-500 mt-1">Customer: ${errand.customerName} (${errand.customerPhone}) ➔ Runner: ${errand.runner?.name || 'Unassigned'}</p>
            <div class="text-[11px] text-emerald-800 font-medium mt-0.5">
              Matatu Fare: KES ${errand.matatuFare} | Total: KES ${errand.estimatedTotal} | Customer PIN: <span class="font-mono font-bold">${errand.customerSecretPin}</span>
            </div>
          </div>

          <div class="flex items-center space-x-2">
            <span class="text-xs font-semibold px-2 py-1 rounded-lg ${isPaid ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-amber-50 text-amber-700 border border-amber-200'}">
              M-Pesa: ${errand.paymentStatus}
            </span>
            <button onclick="app.adminVerifyPayment('${errand.id}')" class="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-xs rounded-xl transition">
              ${isPaid ? 'Mark Unpaid' : 'Mark Verified'}
            </button>
          </div>
        </div>
      `;
    }).join('');
  }

  openAdminDocModal(runnerId) {
    const runner = this.adminRunners.find(r => r.id === runnerId);
    if (!runner) return;

    document.getElementById('modal-doc-avatar').src = runner.avatar;
    document.getElementById('modal-doc-name').textContent = runner.name;
    document.getElementById('modal-doc-id-num').textContent = `National ID: ${runner.idNumber || 'N/A'} • Location: ${runner.activeLocation}`;

    // Front & Back ID images
    const frontImg = document.getElementById('modal-doc-front');
    const backImg = document.getElementById('modal-doc-back');

    frontImg.src = runner.idCardFront || "https://images.unsplash.com/photo-1589829545856-d10d557cf95f?auto=format&fit=crop&w=600&q=80";
    backImg.src = runner.idCardBack || "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&w=600&q=80";

    const actionsContainer = document.getElementById('modal-doc-actions');
    actionsContainer.innerHTML = `
      <button onclick="app.closeAdminDocModal()" class="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-xl transition">Close</button>
      <button onclick="app.adminVerifyRunner('${runner.id}', 'reject'); app.closeAdminDocModal();" class="px-4 py-2 bg-rose-50 text-rose-600 border border-rose-200 font-bold text-xs rounded-xl transition">Reject ID</button>
      <button onclick="app.adminVerifyRunner('${runner.id}', 'approve'); app.closeAdminDocModal();" class="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-xl shadow transition">Approve & Issue Vetted Badge</button>
    `;

    document.getElementById('admin-doc-modal').classList.remove('hidden');
    if (window.lucide) lucide.createIcons();
  }

  closeAdminDocModal() {
    document.getElementById('admin-doc-modal').classList.add('hidden');
  }

  async adminVerifyRunner(runnerId, action) {
    try {
      const res = await fetch(`/api/admin/runners/${runnerId}/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Action failed");

      this.showToast(`Runner ${data.runner.name} is now ${data.runner.verificationStatus.toUpperCase()}`, 'success');
      await this.refreshAdminData();

    } catch (err) {
      alert(err.message);
    }
  }

  async adminVerifyPayment(errandId) {
    try {
      const res = await fetch(`/api/admin/errands/${errandId}/verify-payment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Payment toggle failed");

      this.showToast(`Errand ${errandId} payment marked as ${data.errand.paymentStatus}`, 'success');
      await this.fetchErrands();
      await this.refreshAdminData();

    } catch (err) {
      alert(err.message);
    }
  }

  switchAdminTab(tab) {
    this.adminTab = tab;
    const tabRun = document.getElementById('tab-adm-runners');
    const tabErr = document.getElementById('tab-adm-errands');
    const boxRun = document.getElementById('adm-runners-container');
    const boxErr = document.getElementById('adm-errands-container');

    if (tab === 'runners') {
      tabRun.className = "pb-3 border-b-2 border-brand-600 text-brand-600 flex items-center gap-2 font-bold";
      tabErr.className = "pb-3 border-b-2 border-transparent text-slate-500 hover:text-slate-800 flex items-center gap-2 font-medium";
      boxRun.classList.remove('hidden');
      boxErr.classList.add('hidden');
    } else {
      tabErr.className = "pb-3 border-b-2 border-brand-600 text-brand-600 flex items-center gap-2 font-bold";
      tabRun.className = "pb-3 border-b-2 border-transparent text-slate-500 hover:text-slate-800 flex items-center gap-2 font-medium";
      boxErr.classList.remove('hidden');
      boxRun.classList.add('hidden');
    }
  }

  adminLogout() {
    this.currentAdmin = null;
    localStorage.removeItem('chapchap_admin');
    this.updateAuthPill();
    this.setViewMode('customer');
    this.showToast("Logged out from Admin Portal", 'info');
  }

  // --- Category Selection ---
  setCategory(category) {
    this.currentCategory = category;
    document.querySelectorAll('.category-btn').forEach(btn => {
      if (btn.dataset.cat === category) {
        btn.classList.add('bg-brand-50', 'border-brand-500', 'active-category');
      } else {
        btn.classList.remove('bg-brand-50', 'border-brand-500', 'active-category');
      }
    });
    this.recalculateEstimate();
  }

  // --- Live Cost Quantification Calculation ---
  async recalculateEstimate() {
    const stageFrom = document.getElementById('select-stage-from')?.value || 'CBD (Kencom/Railways)';
    const stageTo = document.getElementById('select-stage-to')?.value || 'Westlands';
    const isPeak = document.getElementById('check-peak')?.checked || false;
    const isUrgent = document.getElementById('check-urgent')?.checked || false;

    try {
      const res = await fetch('/api/estimate-cost', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          category: this.currentCategory,
          urgency: isUrgent ? 'urgent' : 'standard',
          stageFrom,
          stageTo,
          isPeak
        })
      });
      const data = await res.json();

      document.getElementById('quote-base-fee').textContent = `KES ${data.baseServiceFee}`;
      document.getElementById('quote-matatu-fare').textContent = `+ KES ${data.matatuFare}`;
      document.getElementById('quote-distance').textContent = `~${data.distanceKm} km · 25-40 mins (Transit)`;
      document.getElementById('quote-total').textContent = `KES ${data.estimatedTotal}`;

    } catch (err) {
      console.error("Error recalculating estimate", err);
    }
  }

  // --- Order Submission ---
  async handleOrderSubmit(e) {
    e.preventDefault();
    const btn = document.getElementById('btn-submit-order');
    btn.disabled = true;
    btn.innerHTML = `<span class="animate-spin inline-block mr-2">⚙️</span> Posting Order & Calculating...`;

    try {
      const payload = {
        customerId: this.currentUser?.id || null,
        title: document.getElementById('input-title').value.trim(),
        category: this.currentCategory,
        description: document.getElementById('input-description').value.trim(),
        pickupLocation: document.getElementById('input-pickup').value.trim(),
        dropoffLocation: document.getElementById('input-dropoff').value.trim(),
        customerLocation: document.getElementById('input-dropoff').value.trim(),
        matatuStageFrom: document.getElementById('select-stage-from').value,
        matatuStageTo: document.getElementById('select-stage-to').value,
        isPeak: document.getElementById('check-peak').checked,
        urgency: document.getElementById('check-urgent').checked ? 'urgent' : 'standard',
        customerName: document.getElementById('input-customer-name').value.trim(),
        customerPhone: document.getElementById('input-customer-phone').value.trim()
      };

      const res = await fetch('/api/errands', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!res.ok) throw new Error("Could not submit order");

      const created = await res.json();
      this.errands.unshift(created);

      document.getElementById('input-title').value = '';
      document.getElementById('input-description').value = '';
      document.getElementById('input-pickup').value = '';

      this.openSuccessModal(created);
      this.render();

    } catch (err) {
      alert(`Error submitting order: ${err.message}`);
    } finally {
      btn.disabled = false;
      btn.innerHTML = `<i data-lucide="check-circle-2" class="w-5 h-5 inline-block mr-2"></i><span>Post Errand & Notify Available Runners</span>`;
      if (window.lucide) lucide.createIcons();
    }
  }

  openSuccessModal(errand) {
    document.getElementById('modal-order-id').textContent = errand.id;
    document.getElementById('modal-secret-pin').textContent = errand.customerSecretPin;
    document.getElementById('modal-amount').textContent = `KES ${errand.estimatedTotal}`;
    document.getElementById('modal-ref-id').textContent = errand.id;
    document.getElementById('order-success-modal').classList.remove('hidden');
    if (window.lucide) lucide.createIcons();
  }

  closeSuccessModal() {
    document.getElementById('order-success-modal').classList.add('hidden');
    this.scrollToActiveOrders();
  }

  // --- Runner Actions ---
  async claimErrand(errandId) {
    try {
      const res = await fetch(`/api/errands/${errandId}/claim`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ runnerId: this.activeRunnerId })
      });

      if (!res.ok) {
        const error = await res.json();
        alert(error.error || "Could not claim errand");
        return;
      }

      const updated = await res.json();
      const idx = this.errands.findIndex(e => e.id === errandId);
      if (idx !== -1) this.errands[idx] = updated;

      this.showToast(`Success! You have claimed errand ${errandId}. Starting run!`, 'success');
      this.switchRunnerTab('claimed');
      this.render();

    } catch (err) {
      alert(err.message);
    }
  }

  async updateErrandStatus(errandId, newStatus) {
    try {
      const res = await fetch(`/api/errands/${errandId}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus })
      });

      if (!res.ok) throw new Error("Could not update status");

      const updated = await res.json();
      const idx = this.errands.findIndex(e => e.id === errandId);
      if (idx !== -1) this.errands[idx] = updated;

      this.render();
    } catch (err) {
      alert(err.message);
    }
  }

  promptVerifyPin(errandId) {
    this.verifyPinErrandId = errandId;
    document.getElementById('verify-pin-input').value = '';
    document.getElementById('verify-pin-error').classList.add('hidden');
    document.getElementById('verify-pin-modal').classList.remove('hidden');
    document.getElementById('verify-pin-input').focus();
    if (window.lucide) lucide.createIcons();
  }

  closeVerifyPinModal() {
    document.getElementById('verify-pin-modal').classList.add('hidden');
    this.verifyPinErrandId = null;
  }

  async submitVerifyPin() {
    const pin = document.getElementById('verify-pin-input').value.trim();
    if (!pin || pin.length !== 4) {
      const err = document.getElementById('verify-pin-error');
      err.textContent = "Please enter the 4-digit code provided by the customer.";
      err.classList.remove('hidden');
      return;
    }

    try {
      const res = await fetch(`/api/errands/${this.verifyPinErrandId}/verify-complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin })
      });

      const data = await res.json();
      if (!res.ok) {
        const err = document.getElementById('verify-pin-error');
        err.textContent = data.error || "Incorrect Customer Secret PIN.";
        err.classList.remove('hidden');
        return;
      }

      this.closeVerifyPinModal();
      this.showToast("Delivery Verified and Marked Complete! Payout credited.", 'success');
      await this.fetchErrands();

    } catch (err) {
      alert(err.message);
    }
  }

  // --- In-App Chat System ---
  openChat(errandId) {
    const errand = this.errands.find(e => e.id === errandId);
    if (!errand) return;

    this.activeChatErrandId = errandId;
    const isCustomerView = this.viewMode === 'customer';

    const avatarEl = document.getElementById('chat-counterpart-avatar');
    const nameEl = document.getElementById('chat-counterpart-name');
    const titleEl = document.getElementById('chat-errand-title');
    const callBtn = document.getElementById('chat-call-btn');

    if (isCustomerView) {
      avatarEl.src = errand.runner?.avatar || "https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=300&q=80";
      nameEl.textContent = errand.runner ? `${errand.runner.name} (Runner)` : "Errand Runner";
      callBtn.href = errand.runner ? `tel:${errand.runner.phone}` : '#';
    } else {
      avatarEl.src = `https://ui-avatars.com/api/?name=${encodeURIComponent(errand.customerName)}&background=059669&color=fff`;
      nameEl.textContent = `${errand.customerName} (Customer)`;
      callBtn.href = `tel:${errand.customerPhone}`;
    }

    titleEl.textContent = `${errand.id} - ${errand.title}`;
    this.renderChatMessages(errand);

    document.getElementById('chat-modal').classList.remove('hidden');
    document.getElementById('chat-input-text').focus();
    if (window.lucide) lucide.createIcons();
  }

  closeChatModal() {
    document.getElementById('chat-modal').classList.add('hidden');
    this.activeChatErrandId = null;
  }

  renderChatMessages(errand) {
    const container = document.getElementById('chat-messages-container');
    if (!container) return;

    const isCustomerView = this.viewMode === 'customer';
    const messages = errand.messages || [];

    if (messages.length === 0) {
      container.innerHTML = `
        <div class="text-center py-8 text-xs text-slate-400">
          No messages yet. Send a direct message or use quick status buttons above.
        </div>
      `;
      return;
    }

    container.innerHTML = messages.map(msg => {
      if (msg.senderType === 'system') {
        return `
          <div class="chat-bubble-system p-2 text-center my-1.5 mx-auto max-w-sm">
            ${msg.text} <span class="text-[10px] text-slate-400 ml-1">${msg.timestamp || ''}</span>
          </div>
        `;
      }

      const isMe = (isCustomerView && msg.senderType === 'customer') || (!isCustomerView && msg.senderType === 'runner');

      return `
        <div class="flex flex-col ${isMe ? 'items-end' : 'items-start'}">
          <div class="text-[10px] text-slate-400 px-1 mb-0.5">${msg.senderName} • ${msg.timestamp}</div>
          <div class="max-w-[80%] p-3 text-xs shadow-sm ${isMe ? 'chat-bubble-customer' : 'chat-bubble-runner'}">
            ${msg.text}
          </div>
        </div>
      `;
    }).join('');

    container.scrollTop = container.scrollHeight;
  }

  async sendQuickChat(text) {
    if (!this.activeChatErrandId) return;
    await this.postMessage(this.activeChatErrandId, text);
  }

  async handleSendMessage(e) {
    e.preventDefault();
    const input = document.getElementById('chat-input-text');
    const text = input.value.trim();
    if (!text || !this.activeChatErrandId) return;

    input.value = '';
    await this.postMessage(this.activeChatErrandId, text);
  }

  async postMessage(errandId, text) {
    const isCustomerView = this.viewMode === 'customer';
    const activeRunner = this.runners.find(r => r.id === this.activeRunnerId);

    const payload = {
      senderType: isCustomerView ? 'customer' : 'runner',
      senderName: isCustomerView ? (this.currentUser?.name || 'Customer') : (activeRunner?.name || 'Runner'),
      text
    };

    try {
      const res = await fetch(`/api/errands/${errandId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const newMsg = await res.json();

      const errand = this.errands.find(e => e.id === errandId);
      if (errand) {
        if (!errand.messages) errand.messages = [];
        errand.messages.push(newMsg);
        this.renderChatMessages(errand);
      }
    } catch (err) {
      console.error("Error sending message", err);
    }
  }

  // --- View Switcher ---
  setViewMode(mode) {
    this.viewMode = mode;

    const views = {
      customer: document.getElementById('customer-view'),
      runner: document.getElementById('runner-view'),
      'register-runner': document.getElementById('register-runner-view'),
      admin: document.getElementById('admin-view'),
      split: document.getElementById('split-view')
    };

    const buttons = {
      customer: document.getElementById('btn-mode-customer'),
      runner: document.getElementById('btn-mode-runner'),
      'register-runner': document.getElementById('btn-mode-register-runner'),
      split: document.getElementById('btn-mode-split')
    };

    Object.keys(views).forEach(k => {
      if (views[k]) views[k].classList.add('hidden');
    });

    Object.keys(buttons).forEach(k => {
      if (buttons[k]) buttons[k].className = "flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs md:text-sm font-semibold text-slate-600 hover:text-slate-900 transition-all";
    });

    if (views[mode]) views[mode].classList.remove('hidden');
    if (buttons[mode]) {
      buttons[mode].className = "flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs md:text-sm font-semibold transition-all shadow-sm bg-white text-slate-900";
    }

    if (mode === 'admin') this.refreshAdminData();
    this.render();
  }

  switchRunnerTab(tab) {
    this.runnerTab = tab;
    const availableBtn = document.getElementById('tab-runner-available');
    const claimedBtn = document.getElementById('tab-runner-claimed');
    const availableContainer = document.getElementById('runner-available-container');
    const claimedContainer = document.getElementById('runner-claimed-container');

    if (tab === 'available') {
      availableBtn.className = "pb-3 border-b-2 border-brand-600 text-brand-600 flex items-center gap-2 font-bold";
      claimedBtn.className = "pb-3 border-b-2 border-transparent text-slate-500 hover:text-slate-800 flex items-center gap-2 font-medium";
      availableContainer.classList.remove('hidden');
      claimedContainer.classList.add('hidden');
    } else {
      claimedBtn.className = "pb-3 border-b-2 border-amber-600 text-amber-600 flex items-center gap-2 font-bold";
      availableBtn.className = "pb-3 border-b-2 border-transparent text-slate-500 hover:text-slate-800 flex items-center gap-2 font-medium";
      claimedContainer.classList.remove('hidden');
      availableContainer.classList.add('hidden');
    }
  }

  // --- Rendering ---
  render() {
    this.renderCustomerActiveErrands();
    this.renderRunnerFeeds();
    this.renderSplitView();
    this.updateCounters();
    if (window.lucide) lucide.createIcons();
  }

  updateCounters() {
    const availableCount = this.errands.filter(e => e.status === 'available').length;
    const claimedCount = this.errands.filter(e => e.runnerId === this.activeRunnerId && e.status !== 'completed').length;

    const badge = document.getElementById('badge-open-errands-count');
    if (badge) badge.textContent = availableCount;

    const tabAvail = document.getElementById('tab-available-count');
    if (tabAvail) tabAvail.textContent = availableCount;

    const tabClaim = document.getElementById('tab-claimed-count');
    if (tabClaim) tabClaim.textContent = claimedCount;

    const activeBadge = document.getElementById('customer-active-badge');
    if (activeBadge) activeBadge.textContent = `${this.errands.length} total orders`;
  }

  renderCustomerActiveErrands() {
    const container = document.getElementById('customer-errands-list');
    if (!container) return;

    if (this.errands.length === 0) {
      container.innerHTML = `
        <div class="text-center p-8 bg-white rounded-xl border border-dashed border-slate-300 text-slate-400 text-xs">
          No errands placed yet. Place your first errand using the form on the left!
        </div>
      `;
      return;
    }

    container.innerHTML = this.errands.map(errand => {
      const isClaimed = errand.status !== 'available';
      const isCompleted = errand.status === 'completed';

      let statusBadge = `<span class="px-2 py-0.5 rounded-full text-[11px] font-bold bg-amber-100 text-amber-800 flex items-center gap-1">
        <span class="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse"></span> Looking for Runner
      </span>`;

      if (errand.status === 'claimed') {
        statusBadge = `<span class="px-2 py-0.5 rounded-full text-[11px] font-bold bg-emerald-100 text-emerald-800 flex items-center gap-1">
          <i data-lucide="check" class="w-3 h-3"></i> Runner Assigned
        </span>`;
      } else if (errand.status === 'in_progress') {
        statusBadge = `<span class="px-2 py-0.5 rounded-full text-[11px] font-bold bg-blue-100 text-blue-800 flex items-center gap-1">
          <i data-lucide="play" class="w-3 h-3"></i> In Progress at Shop
        </span>`;
      } else if (errand.status === 'delivering') {
        statusBadge = `<span class="px-2 py-0.5 rounded-full text-[11px] font-bold bg-purple-100 text-purple-800 flex items-center gap-1">
          <i data-lucide="bus" class="w-3 h-3"></i> On Matatu to You
        </span>`;
      } else if (isCompleted) {
        statusBadge = `<span class="px-2 py-0.5 rounded-full text-[11px] font-bold bg-slate-100 text-slate-700 flex items-center gap-1">
          <i data-lucide="check-circle" class="w-3 h-3 text-emerald-600"></i> Completed & Verified
        </span>`;
      }

      return `
        <div class="clean-card p-4 sm:p-5 bg-white border border-slate-200 space-y-3.5 transition-all">
          <div class="flex items-start justify-between gap-2">
            <div>
              <div class="flex items-center gap-2">
                <span class="font-mono text-xs font-bold text-slate-400">${errand.id}</span>
                <span class="text-[10px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">${errand.category}</span>
              </div>
              <h4 class="font-bold text-sm sm:text-base text-slate-900 mt-0.5">${errand.title}</h4>
            </div>
            <div>${statusBadge}</div>
          </div>

          <p class="text-xs text-slate-600 line-clamp-2">${errand.description}</p>

          <div class="bg-slate-50 p-2.5 rounded-xl border border-slate-200/80 text-xs space-y-1">
            <div class="flex items-center gap-1.5 text-slate-600">
              <i data-lucide="store" class="w-3.5 h-3.5 text-slate-400 shrink-0"></i>
              <span class="truncate">Pickup: <strong>${errand.pickupLocation}</strong></span>
            </div>
            <div class="flex items-center gap-1.5 text-slate-600">
              <i data-lucide="home" class="w-3.5 h-3.5 text-slate-400 shrink-0"></i>
              <span class="truncate">Drop-off: <strong>${errand.dropoffLocation}</strong></span>
            </div>
            <div class="flex items-center justify-between text-[11px] text-emerald-800 font-medium pt-1 border-t border-slate-200/60">
              <span>Matatu Transit: ${errand.matatuStageFrom} ➔ ${errand.matatuStageTo}</span>
              <span class="font-bold">Total: KES ${errand.estimatedTotal} (Fare: KES ${errand.matatuFare})</span>
            </div>
          </div>

          <!-- Secret Customer PIN -->
          <div class="pin-secret-box p-3 rounded-xl flex items-center justify-between">
            <div>
              <span class="text-[10px] uppercase tracking-wider text-emerald-400 font-bold block">Your Secret Release PIN</span>
              <span class="text-xs text-slate-300">Only tell the runner upon delivery</span>
            </div>
            <div class="flex items-center gap-2">
              <span class="font-mono text-xl font-extrabold text-white tracking-widest bg-slate-800/80 px-2.5 py-1 rounded-lg border border-slate-700">
                ${errand.customerSecretPin}
              </span>
              <button onclick="app.copyToClipboard('${errand.customerSecretPin}', 'Release PIN')" class="text-slate-400 hover:text-white p-1">
                <i data-lucide="copy" class="w-4 h-4"></i>
              </button>
            </div>
          </div>

          <!-- Assigned Runner Profile Card -->
          ${isClaimed && errand.runner ? `
            <div class="p-3 bg-gradient-to-r from-emerald-50 to-teal-50 border border-emerald-200 rounded-xl space-y-2">
              <div class="flex items-center justify-between">
                <span class="text-[10px] font-bold uppercase tracking-wider text-emerald-900 flex items-center gap-1">
                  <i data-lucide="shield-check" class="w-3.5 h-3.5 text-emerald-600"></i> Verified Errand Runner Assigned
                </span>
                <span class="text-[11px] font-bold text-amber-600 flex items-center gap-1">
                  <i data-lucide="star" class="w-3 h-3 fill-amber-500"></i> ${errand.runner.rating}
                </span>
              </div>

              <div class="flex items-center space-x-3">
                <img src="${errand.runner.avatar}" alt="Runner Photo" class="w-12 h-12 rounded-full object-cover border-2 border-emerald-500 shadow-xs">
                <div class="flex-1 min-w-0">
                  <h5 class="font-extrabold text-xs sm:text-sm text-slate-900 truncate">${errand.runner.name}</h5>
                  <p class="text-[11px] text-emerald-800 font-medium">${errand.runner.idNumberVerified}</p>
                  <p class="text-[10px] text-slate-500 truncate">Current Area: ${errand.runner.activeLocation}</p>
                </div>
              </div>

              <div class="grid grid-cols-3 gap-2 pt-1">
                <a href="tel:${errand.runner.phone}" class="flex items-center justify-center gap-1 py-1.5 px-2 bg-white hover:bg-slate-100 border border-slate-200 rounded-lg text-xs font-semibold text-slate-700 transition">
                  <i data-lucide="phone" class="w-3.5 h-3.5 text-emerald-600"></i>
                  <span>Call</span>
                </a>
                <a href="sms:${errand.runner.phone}?body=Habari%20${encodeURIComponent(errand.runner.name)},%20regarding%20Errand%20${errand.id}" class="flex items-center justify-center gap-1 py-1.5 px-2 bg-white hover:bg-slate-100 border border-slate-200 rounded-lg text-xs font-semibold text-slate-700 transition">
                  <i data-lucide="message-square" class="w-3.5 h-3.5 text-blue-600"></i>
                  <span>SMS</span>
                </a>
                <button onclick="app.openChat('${errand.id}')" class="flex items-center justify-center gap-1 py-1.5 px-2 bg-brand-600 hover:bg-brand-700 text-white rounded-lg text-xs font-semibold shadow-xs transition">
                  <i data-lucide="messages-square" class="w-3.5 h-3.5"></i>
                  <span>Chat</span>
                </button>
              </div>
            </div>
          ` : `
            <div class="p-3 bg-slate-50 border border-slate-200 rounded-xl text-center space-y-1">
              <span class="text-xs text-slate-500 flex items-center justify-center gap-1.5">
                <span class="w-2 h-2 rounded-full bg-amber-500 animate-ping"></span>
                Broadcasting to active runners near ${errand.matatuStageFrom}...
              </span>
              <p class="text-[11px] text-slate-400">You will be notified immediately when a runner picks this up!</p>
            </div>
          `}
        </div>
      `;
    }).join('');
  }

  renderRunnerFeeds() {
    const availableContainer = document.getElementById('runner-available-list');
    const claimedContainer = document.getElementById('runner-claimed-list');

    const available = this.errands.filter(e => e.status === 'available');
    const claimed = this.errands.filter(e => e.runnerId === this.activeRunnerId);

    if (availableContainer) {
      if (available.length === 0) {
        availableContainer.innerHTML = `
          <div class="col-span-full p-8 text-center bg-white rounded-xl border border-dashed border-slate-300 text-slate-400 text-xs">
            No open errands available right now. Check back in a moment or post a demo errand!
          </div>
        `;
      } else {
        availableContainer.innerHTML = available.map(errand => `
          <div class="clean-card p-5 bg-white border border-slate-200 space-y-3 hover:border-brand-500 transition-all flex flex-col justify-between">
            <div class="space-y-2">
              <div class="flex items-center justify-between">
                <span class="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded bg-brand-50 text-brand-700">
                  ${errand.category}
                </span>
                <span class="font-mono text-xs text-slate-400">${errand.id}</span>
              </div>
              <h4 class="font-bold text-slate-900 text-sm sm:text-base">${errand.title}</h4>
              <p class="text-xs text-slate-600 line-clamp-3">${errand.description}</p>
              
              <div class="bg-slate-50 p-2.5 rounded-xl border border-slate-200/80 text-xs space-y-1">
                <div>From: <strong>${errand.pickupLocation}</strong></div>
                <div>To: <strong>${errand.dropoffLocation}</strong></div>
                <div class="text-[11px] text-slate-500">Matatu Route: ${errand.matatuStageFrom} ➔ ${errand.matatuStageTo}</div>
              </div>
            </div>

            <div class="pt-3 border-t border-slate-100 flex items-center justify-between">
              <div>
                <span class="text-[10px] uppercase text-slate-400 font-bold block">Your Net Earnings</span>
                <span class="text-lg font-extrabold text-emerald-700">KES ${errand.estimatedTotal}</span>
                <span class="text-[10px] text-slate-500 block">(Labor: ${errand.baseServiceFee} + Matatu: ${errand.matatuFare})</span>
              </div>

              <button onclick="app.claimErrand('${errand.id}')" class="py-2.5 px-4 bg-brand-600 hover:bg-brand-700 text-white font-bold text-xs rounded-xl shadow-sm transition flex items-center gap-1.5">
                <i data-lucide="check" class="w-4 h-4"></i>
                <span>Accept & Pick Up</span>
              </button>
            </div>
          </div>
        `).join('');
      }
    }

    if (claimedContainer) {
      if (claimed.length === 0) {
        claimedContainer.innerHTML = `
          <div class="col-span-full p-8 text-center bg-white rounded-xl border border-dashed border-slate-300 text-slate-400 text-xs">
            You haven't claimed any errands yet. Switch to "Available Errands Feed" to pick up a job!
          </div>
        `;
      } else {
        claimedContainer.innerHTML = claimed.map(errand => {
          const isCompleted = errand.status === 'completed';

          return `
            <div class="clean-card p-5 bg-white border border-slate-200 space-y-3 ${isCompleted ? 'opacity-85' : 'border-amber-400'}">
              <div class="flex items-center justify-between">
                <span class="font-mono text-xs font-bold text-slate-400">${errand.id}</span>
                <span class="text-xs font-bold px-2 py-0.5 rounded-full ${isCompleted ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}">
                  ${errand.status.replace('_', ' ').toUpperCase()}
                </span>
              </div>

              <h4 class="font-bold text-slate-900 text-sm">${errand.title}</h4>
              <p class="text-xs text-slate-600">${errand.description}</p>

              <div class="bg-slate-50 p-3 rounded-xl border border-slate-200 text-xs space-y-1.5">
                <div class="flex justify-between">
                  <span class="text-slate-500">Customer:</span>
                  <span class="font-semibold text-slate-900">${errand.customerName}</span>
                </div>
                <div class="flex justify-between">
                  <span class="text-slate-500">Phone:</span>
                  <span class="font-mono font-semibold text-slate-900">${errand.customerPhone}</span>
                </div>
                <div class="flex justify-between">
                  <span class="text-slate-500">Drop-off:</span>
                  <span class="font-semibold text-slate-900 text-right">${errand.dropoffLocation}</span>
                </div>
              </div>

              <div class="flex gap-2">
                <a href="tel:${errand.customerPhone}" class="flex-1 py-1.5 bg-slate-100 hover:bg-slate-200 text-center rounded-lg text-xs font-semibold text-slate-700 transition flex items-center justify-center gap-1">
                  <i data-lucide="phone" class="w-3.5 h-3.5 text-emerald-600"></i> Call
                </a>
                <a href="sms:${errand.customerPhone}" class="flex-1 py-1.5 bg-slate-100 hover:bg-slate-200 text-center rounded-lg text-xs font-semibold text-slate-700 transition flex items-center justify-center gap-1">
                  <i data-lucide="message-square" class="w-3.5 h-3.5 text-blue-600"></i> SMS
                </a>
                <button onclick="app.openChat('${errand.id}')" class="flex-1 py-1.5 bg-brand-600 hover:bg-brand-700 text-white text-center rounded-lg text-xs font-semibold transition flex items-center justify-center gap-1">
                  <i data-lucide="messages-square" class="w-3.5 h-3.5"></i> Chat
                </button>
              </div>

              ${!isCompleted ? `
                <div class="pt-2 border-t border-slate-100 space-y-2">
                  <span class="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">Update Progress:</span>
                  <div class="grid grid-cols-2 gap-2 text-xs">
                    <button onclick="app.updateErrandStatus('${errand.id}', 'in_progress')" class="py-2 px-2.5 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-lg font-medium transition text-left">
                      📍 At Shop / Queuing
                    </button>
                    <button onclick="app.updateErrandStatus('${errand.id}', 'delivering')" class="py-2 px-2.5 bg-purple-50 hover:bg-purple-100 text-purple-800 border border-purple-200 rounded-lg font-medium transition text-left">
                      🚌 On Matatu to User
                    </button>
                  </div>
                  <button onclick="app.promptVerifyPin('${errand.id}')" class="w-full py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-xl shadow-sm transition flex items-center justify-center gap-1.5 mt-2">
                    <i data-lucide="key" class="w-4 h-4"></i>
                    <span>Verify Customer PIN & Complete Delivery</span>
                  </button>
                </div>
              ` : `
                <div class="p-2.5 bg-emerald-50 rounded-xl text-center text-xs text-emerald-800 font-semibold flex items-center justify-center gap-1.5">
                  <i data-lucide="check-circle" class="w-4 h-4 text-emerald-600"></i>
                  Completed & Verified with Customer PIN (${errand.verifiedReleasePin || errand.customerSecretPin})
                </div>
              `}
            </div>
          `;
        }).join('');
      }
    }
  }

  renderSplitView() {
    if (this.viewMode !== 'split') return;
    const left = document.getElementById('split-customer-content');
    const right = document.getElementById('split-runner-content');
    if (left && right) {
      left.innerHTML = document.getElementById('customer-errands-list')?.innerHTML || '';
      right.innerHTML = document.getElementById('runner-available-list')?.innerHTML || '';
    }
  }

  // --- Utilities ---
  copyToClipboard(text, label = 'Copied') {
    navigator.clipboard.writeText(text);
    this.showToast(`${label} copied to clipboard!`, 'info');
  }

  showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `p-3 rounded-xl shadow-lg border text-xs font-semibold flex items-center justify-between gap-3 pointer-events-auto transition-all animate-in slide-in-from-right ${
      type === 'success' ? 'bg-emerald-950 text-emerald-200 border-emerald-800' : 'bg-slate-900 text-white border-slate-700'
    }`;
    toast.innerHTML = `
      <div class="flex items-center gap-2">
        <span class="w-2 h-2 rounded-full ${type === 'success' ? 'bg-emerald-400' : 'bg-amber-400'}"></span>
        <span>${message}</span>
      </div>
      <button onclick="this.parentElement.remove()" class="text-slate-400 hover:text-white">&times;</button>
    `;

    container.appendChild(toast);
    setTimeout(() => { toast.remove(); }, 4500);
  }

  scrollToOrderForm() {
    this.setViewMode('customer');
    document.getElementById('order-form-container')?.scrollIntoView({ behavior: 'smooth' });
  }

  scrollToActiveOrders() {
    this.setViewMode('customer');
    document.getElementById('active-orders-section')?.scrollIntoView({ behavior: 'smooth' });
  }

  async resetDemoData() {
    if (!confirm("Reset all errands to demo defaults?")) return;
    try {
      await fetch('/api/reset', { method: 'POST' });
      window.location.reload();
    } catch (e) {
      console.error(e);
    }
  }
}

// Global App Instance
window.app = new ChapChapApp();
