/**
 * app.js - SPA Router, Event Bindings, and UI Dynamic Rendering
 */

document.addEventListener("DOMContentLoaded", () => {
  // Global App State
  let state = DB.getState();
  let cart = [];
  let salesChart = null;

  // Intercept and wrap DB.setState for offline synchronization queueing
  const originalSetState = DB.setState;
  DB.setState = function(newState) {
    if (newState.networkStatus === "offline") {
      const oldState = DB.getState();
      let actionDesc = "Modificação de dados locais";
      
      if (newState.documents.length > oldState.documents.length) {
        const newDoc = newState.documents.find(d => !oldState.documents.some(od => od.id === d.id));
        if (newDoc) {
          actionDesc = `Criou ${newDoc.type} ${newDoc.number}`;
        }
      } else if (newState.expenses.length > oldState.expenses.length) {
        const newExp = newState.expenses.find(e => !oldState.expenses.some(oe => oe.id === e.id));
        if (newExp) {
          actionDesc = `Registou Despesa: ${newExp.category} (${formatCurrency(newExp.amount)})`;
        }
      } else if (newState.products.length > oldState.products.length) {
        const newProd = newState.products.find(p => !oldState.products.some(op => op.id === p.id));
        if (newProd) {
          actionDesc = `Cadastrou Produto: ${newProd.name}`;
        }
      }
      
      newState.pendingSyncQueue = newState.pendingSyncQueue || [];
      newState.pendingSyncQueue.push({
        id: "sync_" + Math.random().toString(36).substr(2, 9),
        time: new Date().toLocaleTimeString("pt-MZ"),
        desc: actionDesc
      });
    }
    
    originalSetState.call(DB, newState);
    if (typeof atualizarUIFilaSync === "function") {
      atualizarUIFilaSync();
    }
  };
  DB.setState.__original = originalSetState;

  // Global Currency State
  let globalDisplayCurrency = sessionStorage.getItem("fine_erp_global_display_currency") || "MZN";
  
  // Set value of global select dropdown
  const globalCurSelect = document.getElementById("global-currency-select");
  if (globalCurSelect) {
    globalCurSelect.value = globalDisplayCurrency;
  }

  // Format currency helper
  function formatCurrency(amountMZN) {
    const rates = state.exchangeRates || { USD: 64.00, ZAR: 3.50 };
    if (globalDisplayCurrency === "MZN") {
      return `MZN ${amountMZN.toLocaleString('pt-MZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    } else {
      const rate = rates[globalDisplayCurrency] || 1;
      const converted = amountMZN / rate;
      const symbol = globalDisplayCurrency === "USD" ? "$" : "R";
      return `${symbol} ${converted.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${globalDisplayCurrency}`;
    }
  }
  
  window.formatCurrency = formatCurrency;

  function deductStockFEFO(product, qtyToDeduct) {
    if (!product.batches || product.batches.length === 0) {
      product.batches = [
        { id: "b_legacy_" + Math.random().toString(36).substr(2, 9), code: "LOTE-GERAL", qty: product.stock, expiry: null }
      ];
    }

    // Sort active batches:
    // - Batches with expiration dates ascending (earliest first).
    // - Batches with expiry: null go at the very end.
    product.batches.sort((a, b) => {
      if (a.expiry && b.expiry) {
        return new Date(a.expiry) - new Date(b.expiry);
      }
      if (a.expiry && !b.expiry) return -1;
      if (!a.expiry && b.expiry) return 1;
      return 0;
    });

    let remaining = qtyToDeduct;
    for (let i = 0; i < product.batches.length; i++) {
      let b = product.batches[i];
      if (b.qty > 0) {
        if (b.qty >= remaining) {
          b.qty -= remaining;
          remaining = 0;
          break;
        } else {
          remaining -= b.qty;
          b.qty = 0;
        }
      }
    }

    // If there is still a remaining deduction due to database discrepancy, subtract from the last batch
    if (remaining > 0 && product.batches.length > 0) {
      product.batches[product.batches.length - 1].qty -= remaining;
    }

    // Sync total product stock
    product.stock = product.batches.reduce((sum, b) => sum + b.qty, 0);
  }

  window.alterarMoedaExibicao = function() {
    const val = document.getElementById("global-currency-select").value;
    globalDisplayCurrency = val;
    sessionStorage.setItem("fine_erp_global_display_currency", val);
    
    // Refresh active view
    const activeView = document.querySelector(".view-section.active");
    if (activeView) {
      loadViewData(activeView.id);
    }
    Audit.log(`Alterou moeda de visualização global para: ${val}`);
  };

  // View Switching Router
  const navItems = document.querySelectorAll(".nav-item");
  const views = document.querySelectorAll(".view-section");

  function switchView(targetViewId) {
    // Intercept disabled modules
    const moduleMap = {
      produtos: 'estoque', estoque: 'estoque', compras: 'estoque',
      crm: 'crm', agenda: 'crm',
      contabilidade: 'contabilidade', impostos: 'contabilidade', documentos: 'contabilidade',
      rh: 'rh'
    };
    const requiredModule = moduleMap[targetViewId];
    if (requiredModule && !state.activeModules[requiredModule]) {
      mostrarEcraBloqueioModulo(targetViewId, requiredModule);
      return;
    }

    views.forEach(view => {
      view.classList.remove("active");
      if (view.id === targetViewId) {
        view.classList.add("active");
      }
    });

    navItems.forEach(item => {
      item.classList.remove("active");
      const link = item.querySelector("a");
      if (link && link.getAttribute("href") === `#${targetViewId}`) {
        item.classList.add("active");
      }
    });

    // Run view-specific reloaders
    loadViewData(targetViewId);
  }

  // Bind Navigation Links
  navItems.forEach(item => {
    item.addEventListener("click", (e) => {
      e.preventDefault();
      const targetId = item.querySelector("a").getAttribute("href").substring(1);
      switchView(targetId);
    });
  });

  // Reload views dynamically
  function loadViewData(viewId) {
    state = DB.getState();
    updateCashBadge();
    
    switch (viewId) {
      case "dashboard":
        renderDashboard();
        break;
      case "caixa":
        renderCaixaSession();
        break;
      case "pos":
        renderPOS();
        break;
      case "produtos":
        renderProducts();
        renderServices();
        break;
      case "estoque":
        renderStockMovements();
        break;
      case "clientes":
        renderClients();
        renderSuppliers();
        break;
      case "documentos":
        renderDocumentsDB();
        break;
      case "contabilidade":
        renderAccounting();
        break;
      case "rh":
        renderHR();
        renderExpenses();
        break;
      case "auditoria":
        renderAuditTable();
        break;
      case "crm":
        renderCRM();
        break;
      case "ia":
        initChatbot();
        break;
      case "configuracoes":
        renderSettings();
        break;
      case "compras":
        renderCompras();
        break;
      case "relatorios":
        renderRelatorios();
        break;
      case "agenda":
        renderAgenda();
        break;
      case "integraçoes":
        renderIntegraçoes();
        break;
      case "impostos":
        renderImpostos();
        break;
      case "planos-modulos":
        renderPlanosModulos();
        break;
    }
  }

  // 1. Dashboard Module
  function renderDashboard() {
    const today = new Date().toISOString().split('T')[0];
    const salesToday = state.sales.filter(s => s.date === today);
    const totalVendasDia = salesToday.reduce((sum, s) => sum + s.total, 0);
    
    const cashOpen = CashRegister.isRegisterOpen();
    
    // Calculate simple profit
    let profitToday = 0;
    const docsToday = state.documents.filter(d => d.date.startsWith(today));
    docsToday.forEach(doc => {
      let docCost = 0;
      doc.items.forEach(item => {
        const p = state.products.find(prod => prod.name === item.name);
        docCost += (p ? p.price_purchase : item.price * 0.6) * item.qty;
      });
      profitToday += (doc.total - docCost);
    });

    const lowStockCount = state.products.filter(p => p.stock <= p.min_stock).length;
    const clientCount = state.clients.length;

    // Set DOM elements
    document.getElementById("dash-vendas-dia").innerText = formatCurrency(totalVendasDia);
    document.getElementById("dash-caixa-status").innerText = cashOpen ? "Aberto" : "Fechado";
    document.getElementById("dash-lucro-dia").innerText = formatCurrency(profitToday);
    document.getElementById("dash-clientes-novos").innerText = clientCount;
    document.getElementById("dash-estoque-alerta").innerText = `${lowStockCount} produtos`;
    
    // Add warning class for stock alerts
    const stockBadge = document.getElementById("dash-estoque-badge");
    if (lowStockCount > 0) {
      stockBadge.classList.add("badge-low-stock");
      stockBadge.classList.remove("badge-instock");
    } else {
      stockBadge.classList.add("badge-instock");
      stockBadge.classList.remove("badge-low-stock");
    }

    // Render Latest Documents
    const docsBody = document.getElementById("dash-latest-docs");
    docsBody.innerHTML = "";
    state.documents.slice(0, 5).forEach(doc => {
      docsBody.innerHTML += `
        <tr>
          <td><strong>${doc.number}</strong></td>
          <td>${doc.client_name}</td>
          <td>${new Date(doc.date).toLocaleDateString()}</td>
          <td>${doc.type}</td>
          <td>${formatCurrency(doc.total)}</td>
        </tr>
      `;
    });

    // Render Notifications (stock warnings, etc.)
    const notifs = document.getElementById("dash-notifications");
    notifs.innerHTML = "";

    // Check if there are any documents created in the last 1 hour with payment_method === "M-Pesa" or "Mpesa"
    const oneHourAgo = Date.now() - 3600000;
    const recentMpesaDocs = state.documents.filter(d => (d.payment_method === "M-Pesa" || d.payment_method === "Mpesa") && new Date(d.date).getTime() > oneHourAgo);
    
    recentMpesaDocs.forEach(d => {
      notifs.innerHTML += `
        <div class="alert-box" style="margin-bottom:10px; background: rgba(16, 185, 129, 0.1); border-color: rgba(16, 185, 129, 0.3); color: #a7f3d0;">
          <i data-lucide="check-circle" style="color: var(--color-success);"></i> 
          <strong>Transação M-Pesa Confirmada:</strong> ${formatCurrency(d.total)} recebidos de ${d.client_name} (Doc: ${d.number}) reconciliado de imediato.
        </div>
      `;
    });

    // Expiration Alerts (Expired and Expiring within 30 days)
    const todayDate = new Date();
    todayDate.setHours(0,0,0,0);
    state.products.forEach(p => {
      if (p.batches) {
        p.batches.forEach(b => {
          if (b.qty > 0 && b.expiry) {
            const expiryDate = new Date(b.expiry);
            expiryDate.setHours(0,0,0,0);
            
            const diffTime = expiryDate.getTime() - todayDate.getTime();
            const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
            
            if (diffDays < 0) {
              notifs.innerHTML += `
                <div class="alert-box" style="margin-bottom:10px; background: rgba(239, 68, 68, 0.1); border-color: rgba(239, 68, 68, 0.3); color: #fca5a5;">
                  <i data-lucide="x-circle" style="color: var(--color-error);"></i> 
                  <strong>Lote Expirado:</strong> Lote <code>${b.code}</code> de <strong>${p.name}</strong> expirou em ${new Date(b.expiry).toLocaleDateString()} (${b.qty} un restantes).
                </div>
              `;
            } else if (diffDays <= 30) {
              notifs.innerHTML += `
                <div class="alert-box" style="margin-bottom:10px; background: rgba(245, 158, 11, 0.1); border-color: rgba(245, 158, 11, 0.3); color: #fde68a;">
                  <i data-lucide="alert-circle" style="color: var(--color-warning);"></i> 
                  <strong>Lote a Expirar:</strong> Lote <code>${b.code}</code> de <strong>${p.name}</strong> expira em ${diffDays} dias (${new Date(b.expiry).toLocaleDateString()}) - ${b.qty} un.
                </div>
              `;
            }
          }
        });
      }
    });

    if (lowStockCount > 0) {
      notifs.innerHTML += `<div class="alert-box" style="margin-bottom:10px;"><i data-lucide="alert-triangle"></i> Atenção: Tem ${lowStockCount} produtos com estoque igual ou abaixo do nível mínimo recomendado.</div>`;
    }
    if (!cashOpen) {
      notifs.innerHTML += `<div class="alert-box" style="margin-bottom:10px; background: rgba(245, 158, 11, 0.1); border-color: rgba(245, 158, 11, 0.3); color: #fde68a;"><i data-lucide="lock"></i> O Caixa Geral está FECHADO. Por favor, abra o caixa na aba "Gestão de Caixa" para iniciar as vendas.</div>`;
    }
    if (notifs.innerHTML === "") {
      notifs.innerHTML = `<div style="color:var(--text-muted); font-size:13px;">Nenhuma notificação importante no momento. Sistema operacional operando normalmente.</div>`;
    }

    // Initialize/Render Charts
    setTimeout(() => {
      renderCharts();
    }, 100);

    lucide.createIcons();
  }

  function renderCharts() {
    const ctx = document.getElementById("salesMonthlyChart");
    if (!ctx) return;

    if (salesChart) {
      salesChart.destroy();
    }

    // Accumulate sales by month for the current year
    const monthlySales = Array(12).fill(0);
    state.sales.forEach(sale => {
      const date = new Date(sale.date);
      monthlySales[date.getMonth()] += sale.total;
    });

    salesChart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'],
        datasets: [{
          label: 'Faturamento Mensal (MZN)',
          data: monthlySales,
          backgroundColor: '#6366f1',
          borderColor: '#4f46e5',
          borderWidth: 1,
          borderRadius: 4
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            labels: { color: '#f3f4f6', font: { family: 'Plus Jakarta Sans' } }
          }
        },
        scales: {
          y: {
            ticks: { color: '#9ca3af' },
            grid: { color: 'rgba(255,255,255,0.05)' }
          },
          x: {
            ticks: { color: '#9ca3af' },
            grid: { color: 'rgba(255,255,255,0.05)' }
          }
        }
      }
    });
  }

  // 2. Caixa (Cash Register) Module
  function renderCaixaSession() {
    const isOpen = CashRegister.isRegisterOpen();
    const openCard = document.getElementById("caixa-open-card");
    const sessionCard = document.getElementById("caixa-session-card");
    const historyBody = document.getElementById("caixa-history-rows");

    const currentUser = DB.getCurrentUser();

    if (isOpen) {
      openCard.style.display = "none";
      sessionCard.style.display = "block";
      
      const sess = state.cashRegister.currentSession;
      document.getElementById("sess-operator").innerText = sess.operator;
      document.getElementById("sess-open-time").innerText = `${sess.date} ${sess.open_time}`;
      document.getElementById("sess-initial-val").innerText = formatCurrency(sess.initial_value);
      
      // Calculate current expected cash balances
      const currentDinheiro = sess.initial_value + sess.details.dinheiro - sess.saidas;
      document.getElementById("sess-vendas").innerText = formatCurrency(sess.entradas);
      document.getElementById("sess-saidas").innerText = formatCurrency(sess.saidas);
      document.getElementById("sess-total-dinheiro").innerText = formatCurrency(currentDinheiro);
      document.getElementById("sess-total-mpesa").innerText = formatCurrency(sess.details.mpesa);
      document.getElementById("sess-total-emola").innerText = formatCurrency(sess.details.emola);
      document.getElementById("sess-total-banco").innerText = formatCurrency(sess.details.banco);
      document.getElementById("sess-total-cartao").innerText = formatCurrency(sess.details.cartao);
    } else {
      openCard.style.display = "block";
      sessionCard.style.display = "none";
      document.getElementById("caixa-operator").value = currentUser ? currentUser.name : "Maria Estevão";
    }

    // Populate Cash Desk history
    historyBody.innerHTML = "";
    state.cashRegister.history.forEach(hist => {
      const diffText = hist.difference === 0 
        ? `<span style="color:var(--color-success)">Sem divergência</span>`
        : `<span style="color:var(--color-error)">${formatCurrency(hist.difference)}</span>`;

      historyBody.innerHTML += `
        <tr>
          <td>${hist.date}</td>
          <td>${hist.operator}</td>
          <td>${formatCurrency(hist.initial_value)}</td>
          <td>${formatCurrency(hist.final_value)}</td>
          <td>${diffText}</td>
          <td>${hist.open_time} - ${hist.close_time}</td>
        </tr>
      `;
    });
  }

  // Handle Caixa Actions
  window.abrirCaixa = function() {
    const value = document.getElementById("caixa-initial-value").value;
    const operator = document.getElementById("caixa-operator").value;

    if (!value || isNaN(value)) {
      alert("Por favor, introduza um valor inicial válido.");
      return;
    }

    CashRegister.open(value, operator);
    loadViewData("caixa");
  };

  window.lancarMovimentoCaixa = function() {
    const tipo = document.getElementById("mov-tipo").value;
    const valor = document.getElementById("mov-valor").value;
    const metodo = document.getElementById("mov-metodo").value;
    const desc = document.getElementById("mov-desc").value;

    if (!valor || isNaN(valor) || Number(valor) <= 0) {
      alert("Valor inválido.");
      return;
    }

    if (!CashRegister.isRegisterOpen()) {
      alert("O caixa deve estar aberto para lançar movimentos.");
      return;
    }

    CashRegister.logMovement(tipo, valor, metodo, desc);
    
    // If it's a despesa (saída), let's register it to Expenses too!
    if (tipo === "saida") {
      const state = DB.getState();
      const expEntry = {
        id: "exp_" + Date.now(),
        category: "Diversas",
        description: desc || "Saída de Caixa",
        amount: Number(valor),
        date: new Date().toISOString().split('T')[0],
        status: "Pago"
      };
      state.expenses.unshift(expEntry);
      DB.setState(state);
    }

    // Reset inputs
    document.getElementById("mov-valor").value = "";
    document.getElementById("mov-desc").value = "";
    loadViewData("caixa");
  };

  window.fecharCaixa = function() {
    const declaredDinheiro = document.getElementById("fech-dinheiro").value || 0;
    const declaredMpesa = document.getElementById("fech-mpesa").value || 0;
    const declaredEmola = document.getElementById("fech-emola").value || 0;
    const declaredBanco = document.getElementById("fech-banco").value || 0;
    const declaredCartao = document.getElementById("fech-cartao").value || 0;
    const signature = document.getElementById("fech-signature").value;

    if (!signature) {
      alert("É obrigatório assinar para fechar o caixa.");
      return;
    }

    CashRegister.close(declaredDinheiro, declaredMpesa, declaredEmola, declaredBanco, declaredCartao, signature);
    
    // Clear inputs
    document.getElementById("fech-dinheiro").value = "";
    document.getElementById("fech-mpesa").value = "";
    document.getElementById("fech-emola").value = "";
    document.getElementById("fech-banco").value = "";
    document.getElementById("fech-cartao").value = "";
    document.getElementById("fech-signature").value = "";

    loadViewData("caixa");
  };

  // 3. POS Billing Module
  function renderPOS() {
    const isOpen = CashRegister.isRegisterOpen();
    const posContainer = document.getElementById("pos-module-area");
    const posAlert = document.getElementById("pos-alert-area");

    if (!isOpen) {
      posContainer.style.display = "none";
      posAlert.style.display = "block";
      return;
    }

    posContainer.style.display = "flex";
    posAlert.style.display = "none";

    // Bind filters once
    const searchInput = document.getElementById("pos-search-input");
    const typeFilter = document.getElementById("pos-type-filter");
    
    if (searchInput && !searchInput.dataset.bound) {
      searchInput.addEventListener("input", renderPOS);
      searchInput.dataset.bound = "true";
    }
    if (typeFilter && !typeFilter.dataset.bound) {
      typeFilter.addEventListener("change", renderPOS);
      typeFilter.dataset.bound = "true";
    }
    const posCurrency = document.getElementById("pos-currency");
    if (posCurrency && !posCurrency.dataset.bound) {
      posCurrency.addEventListener("change", updateCartUI);
      posCurrency.dataset.bound = "true";
    }

    const query = searchInput ? searchInput.value.toLowerCase() : "";
    const filter = typeFilter ? typeFilter.value : "todos";

    // Load Products & Services into Grid
    const prodGrid = document.getElementById("pos-products-grid");
    prodGrid.innerHTML = "";

    // Load Products
    if (filter === "todos" || filter === "produtos") {
      state.products.forEach(p => {
        if (p.name.toLowerCase().includes(query) || p.code.toLowerCase().includes(query)) {
          const stockBadge = p.stock <= p.min_stock 
            ? `<span class="badge badge-low-stock">${p.stock} em stock</span>`
            : `<span class="badge badge-instock">${p.stock} un</span>`;

          prodGrid.innerHTML += `
            <div class="pos-card" onclick="addToCart('${p.id}', false)">
              <div>
                <div class="pos-card-name">${p.name} <span style="font-size:10px; color:var(--text-muted);">(${p.code})</span></div>
                <div class="pos-card-price">${p.price_sale.toLocaleString()} MZN</div>
              </div>
              <div class="pos-card-stock">${stockBadge}</div>
            </div>
          `;
        }
      });
    }

    // Load Services
    if (filter === "todos" || filter === "servicos") {
      state.services.forEach(s => {
        if (s.name.toLowerCase().includes(query)) {
          prodGrid.innerHTML += `
            <div class="pos-card" style="border-color: rgba(99, 102, 241, 0.2);" onclick="addToCart('${s.id}', true)">
              <div>
                <div class="pos-card-name">🛠️ ${s.name}</div>
                <div class="pos-card-price">${s.price.toLocaleString()} MZN</div>
              </div>
              <div class="pos-card-stock"><span class="badge" style="background-color:rgba(99,102,241,0.15); color:#a5b4fc;">Serviço</span></div>
            </div>
          `;
        }
      });
    }

    // Populate Client Picker
    const clientSelect = document.getElementById("pos-client-select");
    clientSelect.innerHTML = `<option value="">Consumidor Final</option>`;
    state.clients.forEach(c => {
      clientSelect.innerHTML += `<option value="${c.id}">${c.name} (NUIT: ${c.nuit})</option>`;
    });

    updateCartUI();
  }

  // Cart Functions
  window.addToCart = function(itemId, isService = false) {
    if (isService) {
      const serv = state.services.find(s => s.id === itemId);
      if (!serv) return;

      const existing = cart.find(item => item.product_id === itemId && item.isService);
      if (existing) {
        existing.qty++;
      } else {
        cart.push({
          product_id: itemId,
          name: serv.name,
          price: serv.price,
          iva: 16, // Standard 16% VAT on services
          qty: 1,
          isService: true
        });
      }
    } else {
      const prod = state.products.find(p => p.id === itemId);
      if (!prod) return;

      if (prod.stock <= 0) {
        alert("Erro: Produto sem estoque disponível!");
        return;
      }

      const existing = cart.find(item => item.product_id === itemId && !item.isService);
      if (existing) {
        if (existing.qty >= prod.stock) {
          alert("Quantidade máxima disponível em stock alcançada.");
          return;
        }
        existing.qty++;
      } else {
        cart.push({
          product_id: itemId,
          name: prod.name,
          price: prod.price_sale,
          iva: prod.iva || 16,
          qty: 1,
          isService: false
        });
      }
    }
    updateCartUI();
  };

  window.changeQty = function(index, amount) {
    const item = cart[index];
    if (item.isService) {
      item.qty += amount;
      if (item.qty <= 0) {
        cart.splice(index, 1);
      }
    } else {
      const prod = state.products.find(p => p.id === item.product_id);
      if (!prod) return;

      item.qty += amount;
      if (item.qty <= 0) {
        cart.splice(index, 1);
      } else if (item.qty > prod.stock) {
        alert("Quantidade em stock insuficiente.");
        item.qty = prod.stock;
      }
    }
    updateCartUI();
  };

  function updateCartUI() {
    const cartBody = document.getElementById("pos-cart-items");
    cartBody.innerHTML = "";

    let subtotal = 0;
    cart.forEach((item, index) => {
      const totalItem = item.price * item.qty;
      subtotal += totalItem;

      cartBody.innerHTML += `
        <div class="cart-item">
          <div class="cart-item-info">
            <div class="cart-item-name">${item.name}</div>
            <div class="cart-item-price">${item.price.toLocaleString()} MZN</div>
          </div>
          <div class="cart-item-controls">
            <button class="btn btn-secondary" style="padding:2px 8px;" onclick="changeQty(${index}, -1)">-</button>
            <span class="cart-item-qty">${item.qty}</span>
            <button class="btn btn-secondary" style="padding:2px 8px;" onclick="changeQty(${index}, 1)">+</button>
          </div>
        </div>
      `;
    });

    const discountVal = Number(document.getElementById("pos-discount").value) || 0;
    const currencySelect = document.getElementById("pos-currency");
    const currency = currencySelect ? currencySelect.value : "MZN";
    const rates = state.exchangeRates || { USD: 64.00, ZAR: 3.50 };
    const rate = rates[currency] || 1;

    let subtotalMZN = subtotal;
    let subtotalForeign, discountForeign, totalForeign, totalMZN;

    if (currency === "MZN") {
      subtotalForeign = subtotalMZN;
      discountForeign = discountVal;
      totalForeign = Math.max(0, subtotalForeign - discountForeign);
      totalMZN = totalForeign;

      document.getElementById("pos-subtotal-val").innerText = `MZN ${subtotalForeign.toLocaleString()}`;
      document.getElementById("pos-total-val").innerText = `MZN ${totalForeign.toLocaleString()}`;
    } else {
      subtotalForeign = subtotalMZN / rate;
      discountForeign = discountVal; // discount entered in active foreign currency
      totalForeign = Math.max(0, subtotalForeign - discountForeign);
      totalMZN = totalForeign * rate;

      const symbol = currency === "USD" ? "$" : "R";
      document.getElementById("pos-subtotal-val").innerText = `${symbol} ${subtotalForeign.toFixed(2).toLocaleString()} ${currency} (MZN ${subtotalMZN.toLocaleString()})`;
      document.getElementById("pos-total-val").innerText = `${symbol} ${totalForeign.toFixed(2).toLocaleString()} ${currency} (MZN ${Math.round(totalMZN).toLocaleString()})`;
    }
  }

  // Handle POS Discount Keyup
  document.getElementById("pos-discount").addEventListener("input", updateCartUI);

  window.finalizarVenda = function() {
    if (cart.length === 0) {
      alert("O carrinho está vazio.");
      return;
    }

    const clientVal = document.getElementById("pos-client-select").value;
    const paymentMethod = document.getElementById("pos-payment-method").value;
    const docType = document.getElementById("pos-doc-type").value;
    const discountVal = Number(document.getElementById("pos-discount").value) || 0;

    let clientName = "Consumidor Final";
    let clientNuit = "999999999";
    let activeClient = null;

    if (clientVal) {
      activeClient = state.clients.find(c => c.id === clientVal);
      if (activeClient) {
        clientName = activeClient.name;
        clientNuit = activeClient.nuit;
      }
    }

    const currencySelect = document.getElementById("pos-currency");
    const currency = currencySelect ? currencySelect.value : "MZN";
    const rates = state.exchangeRates || { USD: 64.00, ZAR: 3.50 };
    const rate = rates[currency] || 1;

    let subtotalMZN = cart.reduce((sum, item) => sum + (item.price * item.qty), 0);
    let totalForeign, totalMZN;

    if (currency === "MZN") {
      totalForeign = Math.max(0, subtotalMZN - discountVal);
      totalMZN = totalForeign;
    } else {
      const subtotalForeign = subtotalMZN / rate;
      totalForeign = Math.max(0, subtotalForeign - discountVal); // discount is in USD/ZAR
      totalMZN = Math.round(totalForeign * rate);
    }

    if (paymentMethod === "Mpesa" || paymentMethod === "Emola") {
      let phoneNum = activeClient ? activeClient.phone : "";
      if (!phoneNum) {
        phoneNum = prompt("Introduza o número de telemóvel do cliente (+258):", "847778899");
        if (!phoneNum) return; // cancelled
      }
      
      window.posPendingCheckout = {
        cart: [...cart],
        clientVal,
        paymentMethod,
        docType,
        discountVal,
        totalMZN,
        totalForeign,
        currency,
        rate,
        clientName,
        clientNuit,
        activeClient,
        phoneNum
      };
      
      abrirModalPagamentoMovel(paymentMethod, phoneNum, totalMZN);
      return;
    }

    // If payment method is client credit, verify limit (credit limit is always base MZN)
    if (paymentMethod === "Credito") {
      if (!activeClient) {
        alert("Selecione um cliente para vender a crédito.");
        return;
      }
      const availableCredit = activeClient.credit_limit - activeClient.credit_used;
      if (totalMZN > availableCredit) {
        alert(`Crédito insuficiente! Limite restante: MZN ${availableCredit.toLocaleString()}`);
        return;
      }
      // Deduct credit
      activeClient.credit_used += totalMZN;
    }

    // Deduct stock
    cart.forEach(item => {
      if (!item.isService) {
        const prod = state.products.find(p => p.id === item.product_id);
        if (prod) {
          deductStockFEFO(prod, item.qty);
        }
      }
    });

    // Write state
    DB.setState(state);

    // Save document (converting prices to display in selected invoice currency)
    const archivedItems = cart.map(item => {
      return {
        product_id: item.product_id,
        name: item.name,
        price: currency === "MZN" ? item.price : Number((item.price / rate).toFixed(2)),
        iva: item.iva || 16,
        qty: item.qty,
        isService: item.isService
      };
    });

    const operator = DB.getCurrentUser().name;
    const doc = Documents.archive(
      docType,
      clientName,
      clientNuit,
      archivedItems,
      totalMZN,
      operator,
      paymentMethod,
      currency,
      rate,
      totalForeign
    );

    // Log Cash Movement if not credit (CashRegister expects base MZN)
    if (paymentMethod !== "Credito") {
      CashRegister.logMovement("entrada", totalMZN, paymentMethod, `Venda POS: ${doc.number} (${currency})`);
    }

    // Trigger Print Window
    Documents.printPreview(doc.id);

    // Prepare message
    const docTotalMZN = doc.total;
    const clientPhone = activeClient ? activeClient.phone : "";
    const cleanDocNumber = doc.number;
    const alertMsg = `Olá ${clientName}, agradecemos a sua preferência. Segue o recibo do seu documento ${cleanDocNumber} no valor de ${formatCurrency(docTotalMZN)}. Software Homologado nº 105/AT/2026.`;

    // Clear POS State
    cart = [];
    document.getElementById("pos-discount").value = 0;
    loadViewData("pos");

    // Open Alert Modal
    setTimeout(() => {
      abrirModalAlerta(clientPhone, alertMsg);
    }, 800);
  };

  // 4. Products & Services Module
  function renderProducts() {
    const prodTable = document.getElementById("products-table-rows");
    prodTable.innerHTML = "";
    
    state.products.forEach(p => {
      const stockBadge = p.stock <= p.min_stock 
        ? `<span class="badge badge-low-stock">Crítico: ${p.stock}</span>`
        : `<span class="badge badge-instock">${p.stock}</span>`;

      let batchesHtml = "";
      if (p.batches && p.batches.length > 0) {
        const activeBatches = p.batches.filter(b => b.qty > 0);
        if (activeBatches.length > 0) {
          batchesHtml = `<div style="margin-top: 6px; font-size: 11px; color: var(--text-muted);">`;
          activeBatches.forEach(b => {
            let expiryText = "";
            let statusStyle = "";
            if (b.expiry) {
              const today = new Date();
              today.setHours(0,0,0,0);
              const expiryDate = new Date(b.expiry);
              expiryDate.setHours(0,0,0,0);
              const diffTime = expiryDate.getTime() - today.getTime();
              const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
              
              if (diffDays < 0) {
                expiryText = `(Expirou em ${new Date(b.expiry).toLocaleDateString()})`;
                statusStyle = "color: #ef4444; font-weight: 600;";
              } else if (diffDays <= 30) {
                expiryText = `(Expira em ${diffDays} dias - ${new Date(b.expiry).toLocaleDateString()})`;
                statusStyle = "color: #f59e0b; font-weight: 600;";
              } else {
                expiryText = `(Validade: ${new Date(b.expiry).toLocaleDateString()})`;
                statusStyle = "color: #10b981;";
              }
            } else {
              expiryText = "(Sem Validade)";
              statusStyle = "color: var(--text-muted);";
            }
            batchesHtml += `
              <div style="display: flex; gap: 8px; align-items: center; margin-bottom: 2px;">
                <span class="badge" style="padding: 1px 4px; font-size: 9px; background: rgba(255,255,255,0.06); color: #cbd5e1; border: 1px solid rgba(255,255,255,0.1); font-family: monospace;">Lote: ${b.code}</span>
                <span>Qtd: <strong>${b.qty}</strong></span>
                <span style="${statusStyle}">${expiryText}</span>
              </div>
            `;
          });
          batchesHtml += `</div>`;
        }
      }

      prodTable.innerHTML += `
        <tr>
          <td>${p.code}</td>
          <td>
            <strong>${p.name}</strong>
            ${batchesHtml}
          </td>
          <td>${p.category}</td>
          <td>${p.price_purchase.toLocaleString()} MZN</td>
          <td>${p.price_sale.toLocaleString()} MZN</td>
          <td>${stockBadge}</td>
          <td>
            <button class="btn btn-secondary" style="padding:4px 8px; font-size:12px;" onclick="ajustarEstoqueRapido('${p.id}')">Ajustar</button>
          </td>
        </tr>
      `;
    });
  }

  window.cadastrarProduto = function() {
    const name = document.getElementById("new-prod-name").value;
    const code = document.getElementById("new-prod-code").value;
    const priceP = Number(document.getElementById("new-prod-price-purchase").value);
    const priceS = Number(document.getElementById("new-prod-price-sale").value);
    const initialStock = Number(document.getElementById("new-prod-stock").value);
    const minStock = Number(document.getElementById("new-prod-min-stock").value);
    const lote = document.getElementById("new-prod-lote").value.trim() || "LOTE-GERAL";
    const validade = document.getElementById("new-prod-validade").value || null;

    if (!name || isNaN(priceP) || isNaN(priceS)) {
      alert("Campos obrigatórios inválidos.");
      return;
    }

    const newProd = {
      id: "prod_" + Date.now(),
      code: code || "P" + Math.floor(Math.random()*1000),
      barcode: "",
      name: name,
      category: "Geral",
      brand: "",
      unit: "un",
      price_purchase: priceP,
      price_sale: priceS,
      stock: initialStock || 0,
      min_stock: minStock || 5,
      image: "",
      batches: initialStock > 0 ? [
        { id: "b_" + Date.now(), code: lote, qty: initialStock, expiry: validade }
      ] : []
    };

    state.products.push(newProd);
    DB.setState(state);
    
    // Log to Audit
    Audit.log(`Produto Cadastrado: ${name} (${code})`);

    // Reset inputs
    document.getElementById("new-prod-name").value = "";
    document.getElementById("new-prod-code").value = "";
    document.getElementById("new-prod-price-purchase").value = "";
    document.getElementById("new-prod-price-sale").value = "";
    document.getElementById("new-prod-stock").value = "";
    document.getElementById("new-prod-min-stock").value = "";
    document.getElementById("new-prod-lote").value = "";
    document.getElementById("new-prod-validade").value = "";

    loadViewData("produtos");
  };

  window.ajustarEstoqueRapido = function(id) {
    const prod = state.products.find(p => p.id === id);
    if (!prod) return;

    const newVal = prompt(`Ajustar estoque para o produto "${prod.name}". Novo estoque actual:`, prod.stock);
    if (newVal === null || isNaN(newVal) || newVal === "") return;

    const oldStock = prod.stock;
    const targetStock = Number(newVal);
    if (targetStock > oldStock) {
      const diff = targetStock - oldStock;
      prod.batches = prod.batches || [];
      let generalBatch = prod.batches.find(b => b.code === "LOTE-GERAL");
      if (generalBatch) {
        generalBatch.qty += diff;
      } else {
        prod.batches.push({
          id: "b_" + Date.now(),
          code: "LOTE-GERAL",
          qty: diff,
          expiry: null
        });
      }
      prod.stock = targetStock;
    } else if (targetStock < oldStock) {
      const diff = oldStock - targetStock;
      deductStockFEFO(prod, diff);
    }
    DB.setState(state);

    Audit.log(`Ajuste de Estoque para ${prod.name}: ${oldStock} -> ${prod.stock}`);
    loadViewData("produtos");
  };

  function renderServices() {
    const servTable = document.getElementById("services-table-rows");
    servTable.innerHTML = "";

    state.services.forEach(s => {
      servTable.innerHTML += `
        <tr>
          <td>${s.name}</td>
          <td>${s.category}</td>
          <td>${s.price.toLocaleString()} MZN</td>
          <td>${s.duration}</td>
          <td>${s.commission}%</td>
        </tr>
      `;
    });
  }

  window.cadastrarServico = function() {
    const name = document.getElementById("new-serv-name").value;
    const category = document.getElementById("new-serv-category").value;
    const price = Number(document.getElementById("new-serv-price").value);
    const duration = document.getElementById("new-serv-duration").value;
    const comm = Number(document.getElementById("new-serv-commission").value);

    if (!name || isNaN(price)) {
      alert("Preencha os dados do serviço corretamente.");
      return;
    }

    const newServ = {
      id: "serv_" + Date.now(),
      name: name,
      category: category,
      price: price,
      duration: duration || "1h",
      commission: comm || 0
    };

    state.services.push(newServ);
    DB.setState(state);
    
    Audit.log(`Serviço Cadastrado: ${name}`);

    // Clear
    document.getElementById("new-serv-name").value = "";
    document.getElementById("new-serv-price").value = "";
    loadViewData("produtos");
  };

  // 5. Stock Movements Module
  function renderStockMovements() {
    // Populate select picker for adjustments
    const prodPick = document.getElementById("stk-prod-select");
    prodPick.innerHTML = "";
    state.products.forEach(p => {
      prodPick.innerHTML += `<option value="${p.id}">${p.name} (Stock: ${p.stock})</option>`;
    });

    const movementsLog = document.getElementById("stk-movements-log");
    movementsLog.innerHTML = `
      <tr>
        <td>2026-06-12 09:15</td>
        <td>Computador HP 15</td>
        <td>Saída (Venda)</td>
        <td>-1 un</td>
        <td>Factura FT/2026/1002</td>
      </tr>
      <tr>
        <td>2026-06-11 14:30</td>
        <td>Rato Logitech</td>
        <td>Saída (Venda)</td>
        <td>-1 un</td>
        <td>Factura Simplificada FS/2026/1001</td>
      </tr>
    `;
  }

  window.lancarMovimentoEstoque = function() {
    const prodId = document.getElementById("stk-prod-select").value;
    const tipo = document.getElementById("stk-tipo").value; // Entrada / Saída / Ajuste
    const qty = Number(document.getElementById("stk-qty").value);
    const lote = document.getElementById("stk-lote").value.trim() || "LOTE-GERAL";
    const validade = document.getElementById("stk-validade").value || null;
    const desc = document.getElementById("stk-desc").value;

    if (!qty || isNaN(qty) || qty <= 0) {
      alert("Quantidade inválida.");
      return;
    }

    const prod = state.products.find(p => p.id === prodId);
    if (!prod) return;

    const oldStock = prod.stock;

    if (tipo === "entrada") {
      prod.stock += qty;
      prod.batches = prod.batches || [];
      let existingBatch = prod.batches.find(b => b.code === lote);
      if (existingBatch) {
        existingBatch.qty += qty;
        if (validade) {
          existingBatch.expiry = validade;
        }
      } else {
        prod.batches.push({
          id: "b_" + Date.now(),
          code: lote,
          qty: qty,
          expiry: validade
        });
      }
    } else if (tipo === "saida" || tipo === "quebras" || tipo === "perdas") {
      if (qty > prod.stock) {
        alert("Stock insuficiente para realizar saída.");
        return;
      }
      deductStockFEFO(prod, qty);
    }

    DB.setState(state);
    Audit.log(`Movimento de Stock (${tipo.toUpperCase()}): ${prod.name} | Qtd: ${qty} | Anterior: ${oldStock} -> Novo: ${prod.stock} | Motivo: ${desc}`);

    document.getElementById("stk-qty").value = "";
    document.getElementById("stk-lote").value = "";
    document.getElementById("stk-validade").value = "";
    document.getElementById("stk-desc").value = "";
    loadViewData("estoque");
  };

  // 6. Clients & Suppliers Module
  function renderClients() {
    const clBody = document.getElementById("clientes-rows");
    clBody.innerHTML = "";
    state.clients.forEach(c => {
      clBody.innerHTML += `
        <tr>
          <td><strong>${c.name}</strong></td>
          <td>${c.nuit}</td>
          <td>${c.phone}</td>
          <td>${c.email}</td>
          <td>${formatCurrency(c.credit_used)} / ${formatCurrency(c.credit_limit)}</td>
          <td>
            <button class="btn btn-secondary" style="padding:4px 8px; font-size:12px;" onclick="quitarCreditoCliente('${c.id}')">Pagar Conta</button>
          </td>
        </tr>
      `;
    });
  }

  window.cadastrarCliente = function() {
    const name = document.getElementById("new-cli-name").value;
    const nuit = document.getElementById("new-cli-nuit").value;
    const phone = document.getElementById("new-cli-phone").value;
    const email = document.getElementById("new-cli-email").value;
    const limit = Number(document.getElementById("new-cli-limit").value) || 20000;

    if (!name || !nuit) {
      alert("Nome e NUIT são obrigatórios.");
      return;
    }

    const newCli = {
      id: "cli_" + Date.now(),
      name: name,
      nuit: nuit,
      phone: phone || "",
      email: email || "",
      address: "",
      credit_limit: limit,
      credit_used: 0
    };

    state.clients.push(newCli);
    DB.setState(state);
    Audit.log(`Cliente Cadastrado: ${name} (NUIT: ${nuit})`);

    // Reset
    document.getElementById("new-cli-name").value = "";
    document.getElementById("new-cli-nuit").value = "";
    document.getElementById("new-cli-phone").value = "";
    document.getElementById("new-cli-email").value = "";

    loadViewData("clientes");
  };

  window.quitarCreditoCliente = function(id) {
    const client = state.clients.find(c => c.id === id);
    if (!client) return;

    if (client.credit_used <= 0) {
      alert("Este cliente não tem saldo em dívida.");
      return;
    }

    const valorPago = prompt(`Liquidar crédito do cliente "${client.name}". Dívida atual: MZN ${client.credit_used}. Digite o valor recebido (MZN):`, client.credit_used);
    if (valorPago === null || isNaN(valorPago) || Number(valorPago) <= 0) return;

    const pago = Number(valorPago);
    if (pago > client.credit_used) {
      alert("O valor pago não pode ser maior que o saldo em dívida.");
      return;
    }

    client.credit_used -= pago;
    DB.setState(state);

    // Archive Recibo Document
    const receiptDoc = Documents.archive("Recibo", client.name, client.nuit, [{name: "Amortização de Conta Corrente", qty: 1, price: pago, iva: 0}], pago, DB.getCurrentUser().name, "Dinheiro");
    
    // Log Cash Register Entrance
    CashRegister.logMovement("entrada", pago, "Dinheiro", `Amortização de Conta: ${client.name}`);

    // Print Receipt
    Documents.printPreview(receiptDoc.id);

    loadViewData("clientes");
  };

  function renderSuppliers() {
    const supBody = document.getElementById("fornecedores-rows");
    supBody.innerHTML = "";
    state.suppliers.forEach(s => {
      supBody.innerHTML += `
        <tr>
          <td><strong>${s.name}</strong></td>
          <td>${s.nuit}</td>
          <td>${s.phone}</td>
          <td>${s.email}</td>
          <td>${s.address || 'N/A'}</td>
        </tr>
      `;
    });
  }

  window.cadastrarFornecedor = function() {
    const name = document.getElementById("new-sup-name").value;
    const nuit = document.getElementById("new-sup-nuit").value;
    const phone = document.getElementById("new-sup-phone").value;
    const email = document.getElementById("new-sup-email").value;

    if (!name || !nuit) {
      alert("Nome e NUIT são obrigatórios.");
      return;
    }

    const newSup = {
      id: "sup_" + Date.now(),
      name: name,
      nuit: nuit,
      phone: phone || "",
      email: email || ""
    };

    state.suppliers.push(newSup);
    DB.setState(state);
    Audit.log(`Fornecedor Cadastrado: ${name}`);

    document.getElementById("new-sup-name").value = "";
    document.getElementById("new-sup-nuit").value = "";
    document.getElementById("new-sup-phone").value = "";
    document.getElementById("new-sup-email").value = "";

    loadViewData("clientes");
  };

  // 7. Documents Database Module
  function renderDocumentsDB() {
    const tableBody = document.getElementById("docs-db-rows");
    tableBody.innerHTML = "";

    state.documents.forEach(doc => {
      tableBody.innerHTML += `
        <tr>
          <td><strong>${doc.number}</strong></td>
          <td>${doc.type}</td>
          <td>${doc.client_name}</td>
          <td>${new Date(doc.date).toLocaleDateString()}</td>
          <td>MZN ${doc.total.toLocaleString()}</td>
          <td>${doc.payment_method}</td>
          <td>
            <button class="btn btn-secondary" style="padding:4px 8px; font-size:12px;" onclick="Documents.printPreview('${doc.id}')">Visualizar / PDF</button>
          </td>
        </tr>
      `;
    });
  }

  window.pesquisarDocumentos = function() {
    const query = document.getElementById("docs-search-input").value.toLowerCase();
    const tableBody = document.getElementById("docs-db-rows");
    tableBody.innerHTML = "";

    const filtered = state.documents.filter(doc => {
      return doc.number.toLowerCase().includes(query) ||
             doc.client_name.toLowerCase().includes(query) ||
             doc.client_nuit.includes(query) ||
             doc.operator.toLowerCase().includes(query);
    });

    filtered.forEach(doc => {
      tableBody.innerHTML += `
        <tr>
          <td><strong>${doc.number}</strong></td>
          <td>${doc.type}</td>
          <td>${doc.client_name}</td>
          <td>${new Date(doc.date).toLocaleDateString()}</td>
          <td>MZN ${doc.total.toLocaleString()}</td>
          <td>${doc.payment_method}</td>
          <td>
            <button class="btn btn-secondary" style="padding:4px 8px; font-size:12px;" onclick="Documents.printPreview('${doc.id}')">Visualizar / PDF</button>
          </td>
        </tr>
      `;
    });
  };

  // 8. Financial Sincronização Simulation
  window.simularSincronizacaoBancaria = function() {
    const auditStatus = document.getElementById("sync-status");
    auditStatus.innerHTML = `<span style="color:var(--color-warning);">Pesquisando por novos recebimentos M-Pesa / e-Mola...</span>`;

    setTimeout(() => {
      // Simulate finding a received payment of 2,500 MZN via M-Pesa
      const receivedAmount = 2500;
      const client = state.clients[0]; // Kuhanha Comércio Lda

      // Reduce customer credit debt
      client.credit_used = Math.max(0, client.credit_used - receivedAmount);
      DB.setState(state);

      // Create Receipt
      const syncDoc = Documents.archive("Recibo", client.name, client.nuit, [{ name: "Sincronização Recebimento Celular (M-Pesa API)", qty: 1, price: receivedAmount, iva: 0 }], receivedAmount, "Sincronizador Automático", "M-Pesa");

      // Register cash desk entrance
      if (CashRegister.isRegisterOpen()) {
        CashRegister.logMovement("entrada", receivedAmount, "Mpesa", "Sincronização Automática via Carteira Móvel");
      }

      auditStatus.innerHTML = `<span style="color:var(--color-success);">Sincronização concluída! Recebimento de MZN ${receivedAmount.toLocaleString()} de ${client.name} via M-Pesa reconciliado automaticamente.</span>`;
      
      // Update view if on documents DB or dashboard
      loadViewData("documentos");
    }, 1500);
  };

  // 9. Accounting UI Module
  function renderAccounting() {
    // 9.1 Plano de Contas
    const planoList = document.getElementById("acc-plano-list");
    planoList.innerHTML = "";
    for (const [code, acc] of Object.entries(Accounting.chartOfAccounts)) {
      planoList.innerHTML += `
        <div style="display:flex; justify-content:space-between; padding:8px 12px; border-bottom:1px solid var(--glass-border); font-size:13px;">
          <span><strong>${code}</strong> - ${acc.name}</span>
          <span style="color:var(--text-muted); font-size:11px; text-transform:uppercase;">${acc.type}</span>
        </div>
      `;
    }

    // 9.2 Livro Diário / Diário Geral
    const ledgerBody = document.getElementById("acc-ledger-rows");
    ledgerBody.innerHTML = "";
    const entries = Accounting.getLedgerEntries();
    entries.forEach(e => {
      const dbAccName = Accounting.chartOfAccounts[e.debit_acc].name;
      const crAccName = Accounting.chartOfAccounts[e.credit_acc].name;
      ledgerBody.innerHTML += `
        <tr>
          <td>${e.date}</td>
          <td>${e.desc}</td>
          <td><strong>${e.debit_acc}</strong> ${dbAccName}</td>
          <td><strong>${e.credit_acc}</strong> ${crAccName}</td>
          <td>${formatCurrency(e.debit_val > 0 ? e.debit_val : e.credit_val)}</td>
        </tr>
      `;
    });

    // 9.3 Balancete Verification
    const balRows = document.getElementById("acc-balancete-rows");
    balRows.innerHTML = "";
    const balancete = Accounting.getBalancete();
    
    let totalDeb = 0, totalCred = 0, totalDebBal = 0, totalCredBal = 0;

    balancete.forEach(b => {
      totalDeb += b.debit;
      totalCred += b.credit;
      totalDebBal += b.debit_balance;
      totalCredBal += b.credit_balance;

      balRows.innerHTML += `
        <tr>
          <td><strong>${b.code}</strong></td>
          <td>${b.name}</td>
          <td>${formatCurrency(b.debit)}</td>
          <td>${formatCurrency(b.credit)}</td>
          <td>${formatCurrency(b.debit_balance)}</td>
          <td>${formatCurrency(b.credit_balance)}</td>
        </tr>
      `;
    });

    // Add totals row
    balRows.innerHTML += `
      <tr style="font-weight:bold; border-top:2px solid var(--glass-border); background:rgba(0,0,0,0.2)">
        <td colspan="2">TOTAL GERAL</td>
        <td>${formatCurrency(totalDeb)}</td>
        <td>${formatCurrency(totalCred)}</td>
        <td>${formatCurrency(totalDebBal)}</td>
        <td>${formatCurrency(totalCredBal)}</td>
      </tr>
    `;

    // 9.4 DRE (Demonstração de Resultados)
    const dre = Accounting.getDRE();
    document.getElementById("dre-vendas").innerText = formatCurrency(dre.vendas);
    document.getElementById("dre-servicos").innerText = formatCurrency(dre.servicos);
    document.getElementById("dre-total-proveitos").innerText = formatCurrency(dre.totalProveitos);
    document.getElementById("dre-cmv").innerText = formatCurrency(dre.cmv);
    document.getElementById("dre-lucro-bruto").innerText = formatCurrency(dre.lucroBruto);
    document.getElementById("dre-fse").innerText = formatCurrency(dre.fse);
    document.getElementById("dre-pessoal").innerText = formatCurrency(dre.pessoal);
    document.getElementById("dre-resultado").innerText = formatCurrency(dre.resultadoExercicio);

    // Apply color styling to outcome
    const outcomeEl = document.getElementById("dre-resultado");
    if (dre.resultadoExercicio >= 0) {
      outcomeEl.style.color = "var(--color-success)";
    } else {
      outcomeEl.style.color = "var(--color-error)";
    }

    // 9.5 Balanço Patrimonial
    const bp = Accounting.getBalançoPatrimonial();
    document.getElementById("bp-caixa").innerText = formatCurrency(bp.ativo.caixa);
    document.getElementById("bp-bancos").innerText = formatCurrency(bp.ativo.bancos);
    document.getElementById("bp-clientes").innerText = formatCurrency(bp.ativo.clientes);
    document.getElementById("bp-estoque").innerText = formatCurrency(bp.ativo.estoque);
    document.getElementById("bp-total-ativo").innerText = formatCurrency(bp.ativo.total);

    document.getElementById("bp-fornecedores").innerText = formatCurrency(bp.passivo.fornecedores);
    document.getElementById("bp-iva").innerText = formatCurrency(bp.passivo.ivaPagar);
    document.getElementById("bp-total-passivo").innerText = formatCurrency(bp.passivo.total);

    document.getElementById("bp-capital").innerText = formatCurrency(bp.capitalProprio.capitalSocial);
    document.getElementById("bp-lucro-acum").innerText = formatCurrency(bp.capitalProprio.lucroAcumulado);
    document.getElementById("bp-total-cp").innerText = formatCurrency(bp.capitalProprio.total);

    const totalFinanciamento = bp.passivo.total + bp.capitalProprio.total;
    document.getElementById("bp-total-passivo-cp").innerText = formatCurrency(totalFinanciamento);
  }

  // 10. HR & Expenses Module
  function renderHR() {
    const hrBody = document.getElementById("rh-employees-rows");
    hrBody.innerHTML = "";
    state.employees.forEach(emp => {
      const gross = emp.salary + (emp.commissions || 0);
      const inss = gross * 0.03;
      
      // Mozambican progressive IRPS table calculation
      const taxable = Math.max(0, gross - inss);
      let irps = 0;
      if (taxable <= 20249) {
        irps = 0;
      } else if (taxable <= 35249) {
        irps = taxable * 0.10 - 2024.90;
      } else if (taxable <= 50249) {
        irps = taxable * 0.15 - 3787.40;
      } else if (taxable <= 150249) {
        irps = taxable * 0.20 - 6299.90;
      } else if (taxable <= 300000) {
        irps = taxable * 0.25 - 13812.40;
      } else {
        irps = taxable * 0.32 - 34812.40;
      }
      irps = Math.max(0, irps);
      const net = gross - inss - irps;

      hrBody.innerHTML += `
        <tr>
          <td><strong>${emp.name}</strong></td>
          <td>${emp.role}</td>
          <td>
            <strong>${formatCurrency(gross)}</strong>
            <div style="font-size:10px; color:var(--text-muted);">Base: ${formatCurrency(emp.salary)} + Com: ${formatCurrency(emp.commissions || 0)}</div>
          </td>
          <td style="color:var(--color-warning);">${formatCurrency(inss)}</td>
          <td style="color:var(--color-error);">${formatCurrency(irps)}</td>
          <td style="color:var(--color-success); font-weight:bold;">${formatCurrency(net)}</td>
          <td>
            <button class="btn btn-secondary" style="padding:4px 8px; font-size:12px;" onclick="lancarComissao('${emp.id}')">Lançar Comissão</button>
          </td>
        </tr>
      `;
    });
  }

  window.cadastrarFuncionario = function() {
    const name = document.getElementById("new-emp-name").value;
    const role = document.getElementById("new-emp-role").value;
    const salary = Number(document.getElementById("new-emp-salary").value);

    if (!name || isNaN(salary) || salary <= 0) {
      alert("Campos inválidos.");
      return;
    }

    const newEmp = {
      id: "emp_" + Date.now(),
      name: name,
      role: role || "Colaborador",
      salary: salary,
      commissions: 0,
      vacations: 22,
      faults: 0,
      overtime_hours: 0
    };

    state.employees.push(newEmp);
    DB.setState(state);
    Audit.log(`Colaborador Registrado: ${name} (Salário: MZN ${salary})`);

    document.getElementById("new-emp-name").value = "";
    document.getElementById("new-emp-salary").value = "";
    loadViewData("rh");
  };

  window.lancarComissao = function(id) {
    const emp = state.employees.find(e => e.id === id);
    if (!emp) return;

    const comm = prompt(`Lançar comissão mensal para ${emp.name}:`, "1000");
    if (comm === null || isNaN(comm) || comm === "") return;

    emp.commissions = (emp.commissions || 0) + Number(comm);
    DB.setState(state);

    Audit.log(`Lançamento de Comissão para ${emp.name}: MZN ${comm}`);
    loadViewData("rh");
  };

  function renderExpenses() {
    const expBody = document.getElementById("expenses-table-rows");
    expBody.innerHTML = "";
    state.expenses.forEach(e => {
      const taxText = (e.iva ? ` <span class="badge badge-instock" style="padding: 1px 4px; font-size:9px;">IVA 16%</span>` : "") + 
                      (e.irps ? ` <span class="badge badge-low-stock" style="padding: 1px 4px; font-size:9px;">IRPS ${e.irps}%</span>` : "");
      
      const amountText = (e.currency && e.currency !== "MZN")
        ? `${formatCurrency(e.amount)} <span style="font-size:10px; color:var(--text-muted); display:block;">(${e.amount_foreign.toFixed(2)} ${e.currency})</span>`
        : formatCurrency(e.amount);

      expBody.innerHTML += `
        <tr>
          <td>${e.date}</td>
          <td>${e.category}${taxText}</td>
          <td>${e.description}</td>
          <td>${amountText}</td>
          <td><span class="badge" style="background-color:rgba(16,185,129,0.15); color:var(--color-success)">${e.status}</span></td>
        </tr>
      `;
    });
  }

  window.cadastrarDespesa = function() {
    const cat = document.getElementById("new-exp-category").value;
    const desc = document.getElementById("new-exp-desc").value;
    const amount = Number(document.getElementById("new-exp-amount").value);
    const currency = document.getElementById("new-exp-currency") ? document.getElementById("new-exp-currency").value : "MZN";
    const iva = Number(document.getElementById("new-exp-iva").value) || 0;
    const irps = Number(document.getElementById("new-exp-irps").value) || 0;

    if (!amount || isNaN(amount)) {
      alert("Preencha o valor corretamente.");
      return;
    }

    const rates = state.exchangeRates || { USD: 64.00, ZAR: 3.50 };
    const rate = rates[currency] || 1;
    const amountMZN = currency === "MZN" ? amount : Math.round(amount * rate);

    const newExp = {
      id: "exp_" + Date.now(),
      category: cat,
      description: desc || "Despesa Operacional",
      amount: amountMZN,
      amount_foreign: amount,
      currency: currency,
      exchange_rate: rate,
      iva: iva,
      irps: irps,
      date: new Date().toISOString().split('T')[0],
      status: "Pago"
    };

    state.expenses.unshift(newExp);
    DB.setState(state);
    
    // Log to audit
    const originalText = currency !== "MZN" ? ` (${amount} ${currency})` : "";
    Audit.log(`Despesa Operacional: ${cat} - MZN ${amountMZN}${originalText} (IVA: ${iva}%, IRPS: ${irps}%)`);

    // If cash register open, auto deduct net payment (total minus IRPS withheld)
    if (CashRegister.isRegisterOpen()) {
      const subtotalMZN = amountMZN / (iva > 0 ? 1.16 : 1);
      const irpsValMZN = subtotalMZN * (irps / 100);
      const netPaidMZN = amountMZN - irpsValMZN;
      CashRegister.logMovement("saida", netPaidMZN, "Dinheiro", `Despesa Operacional: ${cat} (Retenção IRPS: MZN ${irpsValMZN.toFixed(0)})`);
    }

    document.getElementById("new-exp-amount").value = "";
    document.getElementById("new-exp-desc").value = "";
    loadViewData("rh");
  };

  // 11. CRM Module
  function renderCRM() {
    const crmBody = document.getElementById("crm-client-list");
    crmBody.innerHTML = "";
    state.clients.forEach(c => {
      crmBody.innerHTML += `
        <div class="panel-card" style="padding:15px; margin-bottom:12px;">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
            <strong>${c.name}</strong>
            <span class="badge" style="background-color:var(--color-primary); color:white">Campanhas Ativas</span>
          </div>
          <p style="font-size:12px; color:var(--text-muted); margin-bottom:8px;">NUIT: ${c.nuit} | Email: ${c.email || 'N/A'}</p>
          <div style="display:flex; gap:10px;">
            <button class="btn btn-secondary" style="padding:4px 8px; font-size:11px;" onclick="enviarMensagemCRM('${c.id}')">Enviar Mensagem/Promoção</button>
            <button class="btn btn-secondary" style="padding:4px 8px; font-size:11px;" onclick="agendarReuniaoCRM('${c.name}')">Agendar Reunião</button>
          </div>
        </div>
      `;
    });
  }

  window.enviarMensagemCRM = function(clientId) {
    const client = state.clients.find(c => c.id === clientId);
    if (!client) return;

    const defaultMsg = `Olá ${client.name}, preparamos um desconto especial de 10% nas compras esta semana no Fine ERP. Aproveite!`;
    const text = prompt(`Escreva a mensagem personalizada para enviar para ${client.name}:`, defaultMsg);
    if (text) {
      abrirModalAlerta(client.phone, text);
    }
  };

  window.agendarReuniaoCRM = function(clientName) {
    alert(`Reunião agendada com ${clientName} e vinculada à Agenda Principal.`);
    Audit.log(`CRM: Reunião de cobrança/proposta comercial agendada com ${clientName}`);
  };

  // 12. Security & Audit log Module
  function renderAuditTable() {
    const auditBody = document.getElementById("audit-log-rows");
    auditBody.innerHTML = "";
    state.audit.forEach(a => {
      auditBody.innerHTML += `
        <tr>
          <td>${a.date} ${a.time}</td>
          <td>${a.user}</td>
          <td><strong>${a.action}</strong></td>
          <td>${a.ip}</td>
          <td><span style="font-size:11px; color:var(--text-muted);">${a.device}</span></td>
        </tr>
      `;
    });
  }

  window.trocarPerfilUtilizador = function() {
    const select = document.getElementById("top-role-select");
    const roleName = select.options[select.selectedIndex].text;
    const username = select.value;

    const userObj = {
      username: username,
      name: roleName.split(' (')[0],
      role: roleName.split(' (')[1].replace(')', ''),
      active: true
    };

    DB.setCurrentUser(userObj);
    Audit.log(`Alternou sessão de operador para ${userObj.name} (${userObj.role})`);
    
    // Refresh header avatar name
    document.getElementById("top-user-name").innerText = userObj.name;
    document.getElementById("top-user-role").innerText = userObj.role;

    const initials = userObj.name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
    const avatarEl = document.getElementById("user-avatar");
    if (avatarEl) avatarEl.innerText = initials;

    // Reload active view to match permissions
    const activeView = document.querySelector(".view-section.active");
    if (activeView) {
      loadViewData(activeView.id);
    }
  };

  // 13. Chatbot (AI Assistant) Module
  function initChatbot() {
    const msgContainer = document.getElementById("chat-messages-area");
    // Seed initial welcome message if empty
    if (msgContainer.children.length === 0) {
      msgContainer.innerHTML = `
        <div class="chat-bubble ai">
          Olá! Sou o assistente de inteligência artificial do <strong>Fine ERP Cloud</strong>. 
          Estou pronto para lhe dar relatórios sobre o desempenho da sua empresa em Moçambique.<br><br>
          Experimente perguntar:
          <ul>
            <li>Quanto vendi este mês?</li>
            <li>Qual produto vende mais?</li>
            <li>Quem deve dinheiro no sistema?</li>
            <li>Qual foi meu lucro estimado?</li>
            <li>Quanto tenho em caixa agora?</li>
          </ul>
        </div>
      `;
    }
  }

  window.enviarMensagemChat = function() {
    const input = document.getElementById("chat-input");
    const text = input.value.trim();
    if (!text) return;

    const msgContainer = document.getElementById("chat-messages-area");
    
    // User Message Bubble
    msgContainer.innerHTML += `
      <div class="chat-bubble user">
        ${text}
      </div>
    `;

    // Process answer from AIAssistant
    setTimeout(() => {
      const response = AIAssistant.ask(text);
      msgContainer.innerHTML += `
        <div class="chat-bubble ai">
          ${response.replace(/\n/g, '<br>')}
        </div>
      `;
      // Auto Scroll to bottom
      msgContainer.scrollTop = msgContainer.scrollHeight;
    }, 400);

    input.value = "";
  };

  // Bind Enter Key to Chat Input
  document.getElementById("chat-input").addEventListener("keypress", (e) => {
    if (e.key === "Enter") {
      enviarMensagemChat();
    }
  });

  // 14. Settings & Backups Module
  function renderSettings() {
    const comp = state.companies.find(c => c.id === DB.currentCompanyId) || state.companies[0];
    document.getElementById("set-comp-name").value = comp.name;
    document.getElementById("set-comp-nuit").value = comp.nuit;
    document.getElementById("set-comp-email").value = comp.email;
    document.getElementById("set-comp-phone").value = comp.phone;
    document.getElementById("set-comp-address").value = comp.address;

    const rates = state.exchangeRates || { USD: 64.00, ZAR: 3.50 };
    document.getElementById("set-rate-usd").value = rates.USD;
    document.getElementById("set-rate-zar").value = rates.ZAR;
  }

  window.salvarConfiguracoes = function() {
    const comp = state.companies.find(c => c.id === DB.currentCompanyId);
    comp.name = document.getElementById("set-comp-name").value;
    comp.nuit = document.getElementById("set-comp-nuit").value;
    comp.email = document.getElementById("set-comp-email").value;
    comp.phone = document.getElementById("set-comp-phone").value;
    comp.address = document.getElementById("set-comp-address").value;

    const usdVal = Number(document.getElementById("set-rate-usd").value) || 64.00;
    const zarVal = Number(document.getElementById("set-rate-zar").value) || 3.50;
    state.exchangeRates = {
      USD: usdVal,
      ZAR: zarVal
    };

    DB.setState(state);
    Audit.log("Configurações da empresa e taxas de câmbio atualizadas");
    alert("Configurações salvas com sucesso!");
    
    // Update switch picker display name
    const compSelect = document.getElementById("topbar-company-select");
    const opt = compSelect.querySelector(`option[value="${comp.id}"]`);
    if (opt) opt.text = comp.name;
    loadViewData("configuracoes");
  };

  // Backup Modules (Manual JSON download)
  window.gerarBackupManual = function() {
    const backupData = JSON.stringify(DB.getState(), null, 2);
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(backupData);
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", `fine_erp_backup_${DB.currentCompanyId}_${new Date().toISOString().split('T')[0]}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();

    Audit.log("Backup manual exportado via ficheiro JSON");
  };

  window.restaurarBackupManual = function(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function(e) {
      try {
        const importedState = JSON.parse(e.target.result);
        if (importedState.products && importedState.documents && importedState.clients) {
          DB.setState(importedState);
          Audit.log("Restaurou com sucesso a base de dados via importação JSON");
          alert("Base de dados restaurada com sucesso! Atualizando sistema.");
          window.location.reload();
        } else {
          alert("Ficheiro JSON de backup inválido. Chaves essenciais não encontradas.");
        }
      } catch (err) {
        alert("Erro ao decodificar arquivo JSON.");
      }
    };
    reader.readAsText(file);
  };

  window.restaurarDadosOriginais = function() {
    if (confirm("Tem certeza que deseja apagar todos os dados e restaurar as configurações padrão iniciais? Esta ação não pode ser desfeita.")) {
      DB.reset();
      Audit.log("Restaurou a base de dados para o estado inicial de demonstração");
      window.location.reload();
    }
  };

  // Multi-Company Selector Binding
  const companySelect = document.getElementById("topbar-company-select");
  companySelect.innerHTML = "";
  state.companies.forEach(c => {
    companySelect.innerHTML += `<option value="${c.id}">${c.name}</option>`;
  });
  companySelect.value = DB.currentCompanyId;

  companySelect.addEventListener("change", (e) => {
    const companyId = e.target.value;
    DB.switchCompany(companyId);
    Audit.log(`Trocou de empresa activa para ${companyId}`);
    window.location.reload();
  });

  // Cash status badge
  function updateCashBadge() {
    const badge = document.getElementById("topbar-cash-badge");
    const open = CashRegister.isRegisterOpen();
    if (open) {
      badge.className = "cash-badge open";
      badge.innerHTML = `<i data-lucide="unlock" style="width:14px;"></i> Caixa Aberto`;
    } else {
      badge.className = "cash-badge closed";
      badge.innerHTML = `<i data-lucide="lock" style="width:14px;"></i> Caixa Fechado`;
    }
    lucide.createIcons();
  }

  // Mobile View Switcher Wrapper
  window.toggleSimuladorMobile = function() {
    const sim = document.getElementById("mobile-simulator-widget");
    const active = sim.classList.toggle("active");
    if (active) {
      Audit.log("Ativou visualização de simulação do Aplicativo Mobile");
      // Populate mobile elements with latest states
      const mobList = document.getElementById("mobile-dash-stats");
      mobList.innerHTML = `
        <div style="background:var(--bg-card); padding:10px; border-radius:8px; border:1px solid var(--glass-border); text-align:center;">
          <div style="font-size:10px; color:var(--text-muted);">VENDAS DIA</div>
          <div style="font-size:14px; font-weight:bold; color:var(--color-success);">${document.getElementById("dash-vendas-dia").innerText}</div>
        </div>
        <div style="background:var(--bg-card); padding:10px; border-radius:8px; border:1px solid var(--glass-border); text-align:center;">
          <div style="font-size:10px; color:var(--text-muted);">CAIXA</div>
          <div style="font-size:14px; font-weight:bold;">${document.getElementById("dash-caixa-status").innerText}</div>
        </div>
      `;

      // Quick products list in mobile preview
      const mobProds = document.getElementById("mobile-products-list");
      mobProds.innerHTML = "";
      state.products.slice(0, 3).forEach(p => {
        mobProds.innerHTML += `
          <div style="display:flex; justify-content:space-between; font-size:11px; padding:6px; border-bottom:1px solid rgba(255,255,255,0.05);">
            <span>${p.name}</span>
            <strong>${p.stock} un</strong>
          </div>
        `;
      });

      // Quick document list in mobile
      const mobDocs = document.getElementById("mobile-docs-list");
      mobDocs.innerHTML = "";
      state.documents.slice(0, 3).forEach(d => {
        mobDocs.innerHTML += `
          <div style="display:flex; justify-content:space-between; font-size:11px; padding:6px; border-bottom:1px solid rgba(255,255,255,0.05);">
            <span>${d.number}</span>
            <span>MZN ${d.total.toLocaleString()}</span>
          </div>
        `;
      });
    }
  };

  // Init Login/Security & Role Enforcement
  window.solicitar2FA = function() {
    const pass = document.getElementById("login-password").value;
    if (pass !== "86428642") {
      alert("Senha incorreta. (Demonstração: use a senha 86428642)");
      return;
    }
    document.getElementById("login-step-1").style.display = "none";
    document.getElementById("login-step-2").style.display = "block";
    
    // Auto-fill a mock verification code
    const mockOTP = Math.floor(100000 + Math.random() * 900000);
    document.getElementById("login-otp").value = mockOTP;
  };

  window.validarLoginCompleto = function() {
    const username = document.getElementById("login-username").value;
    const otp = document.getElementById("login-otp").value;
    if (!otp) {
      alert("Token de segurança OTP é obrigatório.");
      return;
    }

    const matchedUser = state.users.find(u => u.username === username);
    if (!matchedUser) return;

    DB.setCurrentUser(matchedUser);
    Audit.log(`Operador ${matchedUser.name} iniciou sessão (Autenticação 2FA Verificada)`);

    // Hide login screen and display app
    document.getElementById("login-overlay").style.display = "none";
    document.getElementById("app-container").style.display = "flex";

    // Set topbar displays
    document.getElementById("top-user-name").innerText = matchedUser.name;
    document.getElementById("top-user-role").innerText = matchedUser.role;
    document.getElementById("top-role-select").value = matchedUser.username;

    const initials = matchedUser.name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
    const avatarEl = document.getElementById("user-avatar");
    if (avatarEl) avatarEl.innerText = initials;

    applyRolePermissions();
    switchView("dashboard");
  };

  window.voltarPasso1 = function() {
    document.getElementById("login-step-1").style.display = "block";
    document.getElementById("login-step-2").style.display = "none";
  };

  function applyRolePermissions() {
    const user = DB.getCurrentUser();
    const role = user ? user.role : "Caixa";
    const navLinks = document.querySelectorAll(".nav-links li");

    navLinks.forEach(li => {
      const a = li.querySelector("a");
      if (!a) return;
      const href = a.getAttribute("href").substring(1);
      let allowed = true;

      if (role === "Caixa") {
        allowed = ["dashboard", "caixa", "pos"].includes(href);
      } else if (role === "Vendedor") {
        allowed = ["dashboard", "pos", "clientes", "crm"].includes(href);
      } else if (role === "Contabilista") {
        allowed = ["dashboard", "documentos", "contabilidade", "relatorios", "configuracoes", "impostos"].includes(href);
      } else if (role === "Auditor") {
        allowed = ["dashboard", "documentos", "auditoria"].includes(href);
      }

      if (allowed) {
        li.style.display = "block";
      } else {
        li.style.display = "none";
      }
    });
  }

  // 14. Compras (Purchases) Module
  function renderCompras() {
    // Suppliers dropdown
    const supSelect = document.getElementById("pur-sup-select");
    supSelect.innerHTML = "";
    state.suppliers.forEach(s => {
      supSelect.innerHTML += `<option value="${s.id}">${s.name}</option>`;
    });

    // Products dropdown
    const prodSelect = document.getElementById("pur-prod-select");
    prodSelect.innerHTML = "";
    state.products.forEach(p => {
      prodSelect.innerHTML += `<option value="${p.id}">${p.name} (Stock: ${p.stock})</option>`;
    });

    // Purchases Table Rows
    const purBody = document.getElementById("purchases-table-rows");
    purBody.innerHTML = "";
    const purchases = state.purchases || [];
    purchases.forEach(pur => {
      const taxText = pur.iva && pur.iva > 0 ? ` <span class="badge badge-instock" style="padding: 1px 4px; font-size:9px;">IVA ${pur.iva}%</span>` : "";
      
      const amountText = (pur.currency && pur.currency !== "MZN" && pur.total_foreign)
        ? `${formatCurrency(pur.total)} <span style="font-size:10px; color:var(--text-muted); display:block;">(${pur.total_foreign.toLocaleString()} ${pur.currency})</span>`
        : formatCurrency(pur.total);

      purBody.innerHTML += `
        <tr>
          <td>${new Date(pur.date).toLocaleDateString()}</td>
          <td><strong>${pur.supplier_name}</strong></td>
          <td>${pur.items[0].name} (x${pur.items[0].qty})${taxText}</td>
          <td>${pur.items[0].qty} un</td>
          <td>${amountText}</td>
          <td>${pur.payment_method}</td>
          <td><span class="badge" style="background-color:rgba(16,185,129,0.15); color:var(--color-success)">${pur.status}</span></td>
        </tr>
      `;
    });
  }

  window.registrarNovaCompra = function() {
    const supId = document.getElementById("pur-sup-select").value;
    const prodId = document.getElementById("pur-prod-select").value;
    const qty = Number(document.getElementById("pur-qty").value);
    const cost = Number(document.getElementById("pur-cost").value);
    const method = document.getElementById("pur-payment-method").value;
    const currency = document.getElementById("pur-currency") ? document.getElementById("pur-currency").value : "MZN";
    const iva = Number(document.getElementById("pur-iva").value) || 0;
    const lote = document.getElementById("pur-lote").value.trim() || "LOTE-GERAL";
    const validade = document.getElementById("pur-validade").value || null;

    if (!qty || isNaN(qty) || qty <= 0 || !cost || isNaN(cost) || cost <= 0) {
      alert("Introduza quantidade e custo unitário válidos.");
      return;
    }

    const supplier = state.suppliers.find(s => s.id === supId);
    const product = state.products.find(p => p.id === prodId);

    if (!supplier || !product) return;

    // Convert cost to MZN for accounting and inventory average costing
    const rates = state.exchangeRates || { USD: 64.00, ZAR: 3.50 };
    const rate = rates[currency] || 1;
    const costMZN = currency === "MZN" ? cost : cost * rate;

    // Recalculate Weighted Average Cost
    const oldStock = product.stock;
    const oldCost = product.price_purchase;
    
    if (oldStock + qty > 0) {
      product.price_purchase = Math.round(((oldStock * oldCost) + (qty * costMZN)) / (oldStock + qty));
    } else {
      product.price_purchase = costMZN;
    }

    // Add to stock
    product.stock += qty;
    product.batches = product.batches || [];
    let existingBatch = product.batches.find(b => b.code === lote);
    if (existingBatch) {
      existingBatch.qty += qty;
      if (validade) {
        existingBatch.expiry = validade;
      }
    } else {
      product.batches.push({
        id: "b_" + Date.now(),
        code: lote,
        qty: qty,
        expiry: validade
      });
    }

    const totalCostMZN = qty * costMZN;

    // Create purchase entry
    const newPur = {
      id: "pur_" + Date.now(),
      supplier_name: supplier.name,
      date: new Date().toISOString(),
      items: [{ name: product.name, qty: qty, price: costMZN }],
      total: totalCostMZN,
      payment_method: method,
      status: "Pago",
      currency: currency,
      exchange_rate: rate,
      total_foreign: qty * cost,
      iva: iva
    };

    if (!state.purchases) state.purchases = [];
    state.purchases.unshift(newPur);

    // Save state
    DB.setState(state);

    // Log Cash outflow if paid in cash (CashRegister uses base MZN)
    if (method === "Dinheiro" && CashRegister.isRegisterOpen()) {
      CashRegister.logMovement("saida", totalCostMZN, "Dinheiro", `Compra Fornecedor: ${supplier.name} - ${product.name} (${currency})`);
    }

    Audit.log(`Registou compra de ${qty}x ${product.name} a MZN ${costMZN.toFixed(0)}/un (${cost} ${currency}) do fornecedor ${supplier.name} (IVA: ${iva}%). Custo Médio atualizado.`);
    alert(`Compra registrada com sucesso! Novo custo médio ponderado do produto em Meticais: MZN ${product.price_purchase.toLocaleString()}`);

    // Reset inputs
    document.getElementById("pur-qty").value = "";
    document.getElementById("pur-cost").value = "";
    document.getElementById("pur-lote").value = "";
    document.getElementById("pur-validade").value = "";

    loadViewData("compras");
  };

  // 15. Relatórios (Reports) Module
  function renderRelatorios() {
    let totalProveitos = 0;
    let totalCustos = 0;

    // Get ledger data to compute revenues vs expenses
    const ledger = Accounting.getLedgerEntries();
    ledger.forEach(e => {
      if (e.debit_acc === "7.1" || e.debit_acc === "7.2" || e.debit_acc === "7.3") {
        totalCustos += e.debit_val;
      }
      if (e.credit_acc === "6.1" || e.credit_acc === "6.2") {
        totalProveitos += e.credit_val;
      }
    });

    // Stock valuation
    let stockValue = 0;
    state.products.forEach(p => {
      stockValue += p.stock * p.price_purchase;
    });

    // IVA calculation
    const decl = Accounting.getTaxDeclaration();
    const ivaVal = decl.ivaNet > 0 ? decl.ivaNet : 0;

    document.getElementById("rep-receitas-ano").innerText = formatCurrency(totalProveitos);
    document.getElementById("rep-despesas-ano").innerText = formatCurrency(totalCustos);
    document.getElementById("rep-estoque-val").innerText = formatCurrency(stockValue);
    document.getElementById("rep-iva-estado").innerText = formatCurrency(ivaVal);

    // Render Cost Centers
    const centersBody = document.getElementById("rep-cost-centers-rows");
    centersBody.innerHTML = "";
    const centers = Accounting.getCostCenters();
    centers.forEach(c => {
      const diff = c.proveitos - c.custos;
      centersBody.innerHTML += `
        <tr>
          <td><strong>${c.name}</strong></td>
          <td>${formatCurrency(c.proveitos)}</td>
          <td>${formatCurrency(c.custos)}</td>
          <td style="color: ${diff >= 0 ? 'var(--color-success)' : 'var(--color-error)'}; font-weight:bold;">${formatCurrency(diff)}</td>
        </tr>
      `;
    });
  }

  window.exportarRelatorioCSV = function(tipo) {
    let csvContent = "data:text/csv;charset=utf-8,";
    if (tipo === "vendas") {
      csvContent += "ID,Data,Total,Metodo,Itens\n";
      state.sales.forEach(s => {
        csvContent += `${s.id},${s.date},${s.total},${s.payment_method},${s.items_count}\n`;
      });
    } else {
      csvContent += "Codigo,Nome,Estoque,PrecoCompra,PrecoVenda\n";
      state.products.forEach(p => {
        csvContent += `${p.code},${p.name},${p.stock},${p.price_purchase},${p.price_sale}\n`;
      });
    }

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `relatorio_fine_${tipo}_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    link.remove();
    
    Audit.log(`Exportou relatório de ${tipo} em formato CSV`);
  };

  window.exportarRelatorioImprimir = function(tipo) {
    const printWindow = window.open("", "_blank", "width=800,height=800");
    const company = state.companies.find(c => c.id === DB.currentCompanyId) || state.companies[0];
    
    let htmlContent = `
      <html>
      <head>
        <title>Imprimir Relatório</title>
        <style>
          body { font-family: sans-serif; color: #333; margin: 30px; font-size: 13px; }
          .header { border-bottom: 2px solid #6366f1; padding-bottom: 10px; margin-bottom: 20px; }
          table { width: 100%; border-collapse: collapse; margin-top: 15px; }
          th { background: #6366f1; color: white; padding: 8px; text-align: left; }
          td { padding: 8px; border-bottom: 1px solid #e2e8f0; }
          .footer { text-align: center; margin-top: 50px; font-size: 11px; color: #94a3b8; }
        </style>
      </head>
      <body>
        <button onclick="window.print()" style="margin-bottom:20px; padding:8px 16px; background:#6366f1; color:white; border:none; border-radius:4px; cursor:pointer;">Imprimir PDF</button>
        <div class="header">
          <h2>${company.name}</h2>
          <strong>Relatório:</strong> ${tipo === 'balancete' ? 'Balancete de Verificação Geral' : 'Demonstração de Resultados (DRE)'}<br>
          <strong>Data:</strong> ${new Date().toLocaleDateString()}
        </div>
    `;

    if (tipo === "balancete") {
      const bal = Accounting.getBalancete();
      htmlContent += `
        <table>
          <thead>
            <tr>
              <th>Código</th>
              <th>Descrição</th>
              <th>Débito Acum.</th>
              <th>Crédito Acum.</th>
              <th>Saldo Devedor</th>
              <th>Saldo Credor</th>
            </tr>
          </thead>
          <tbody>
      `;
      bal.forEach(b => {
        htmlContent += `
          <tr>
            <td>${b.code}</td>
            <td>${b.name}</td>
            <td>${formatCurrency(b.debit)}</td>
            <td>${formatCurrency(b.credit)}</td>
            <td>${formatCurrency(b.debit_balance)}</td>
            <td>${formatCurrency(b.credit_balance)}</td>
          </tr>
        `;
      });
      htmlContent += "</tbody></table>";
    } else {
      const dre = Accounting.getDRE();
      htmlContent += `
        <div style="font-size:14px; line-height:2;">
          <p>(+) Vendas de Mercadorias: <strong>${formatCurrency(dre.vendas)}</strong></p>
          <p>(+) Prestações de Serviços: <strong>${formatCurrency(dre.servicos)}</strong></p>
          <hr>
          <p><strong>(=) RENDIMENTOS OPERACIONAIS: ${formatCurrency(dre.totalProveitos)}</strong></p>
          <p>(-) Custo das Mercadorias Vendidas (CMV): <strong>${formatCurrency(dre.cmv)}</strong></p>
          <hr>
          <p><strong>(=) MARGEM OPERACIONAL BRUTA: ${formatCurrency(dre.lucroBruto)}</strong></p>
          <p>(-) Fornecimentos e Serviços Externos (FSE): <strong>${formatCurrency(dre.fse)}</strong></p>
          <p>(-) Gastos com Colaboradores (Salários): <strong>${formatCurrency(dre.pessoal)}</strong></p>
          <hr>
          <p style="font-size:16px; color:#10b981;"><strong>(=) RESULTADO LÍQUIDO DO EXERCÍCIO: ${formatCurrency(dre.resultadoExercicio)}</strong></p>
        </div>
      `;
    }

    htmlContent += `
        <div class="footer">
          Fine ERP Cloud - Software Certificado • Relatório Extraído Eletronicamente.
        </div>
      </body>
      </html>
    `;

    printWindow.document.write(htmlContent);
    printWindow.document.close();
    Audit.log(`Imprimiu relatório fiscal de ${tipo}`);
  };

  // 16. Agenda Module
  function renderAgenda() {
    const list = document.getElementById("agenda-list-rows");
    list.innerHTML = "";

    if (!state.agenda) state.agenda = [];
    
    state.agenda.forEach(item => {
      const typeClass = item.type ? item.type.toLowerCase() : "lembrete";
      list.innerHTML += `
        <div class="agenda-card ${typeClass}">
          <div>
            <h4 style="font-weight:700; font-family:'Outfit';">${item.title}</h4>
            <p style="font-size:12px; color:var(--text-muted); margin-top:3px;">${item.desc} | Tipo: <strong>${item.type}</strong></p>
          </div>
          <div style="text-align: right;">
            <span class="badge" style="background:rgba(255,255,255,0.08); color:var(--text-main);">${new Date(item.date).toLocaleDateString()}</span>
            <button class="btn btn-secondary" style="padding:2px 6px; font-size:11px; margin-top:6px; display:block; margin-left:auto;" onclick="removerCompromisso('${item.id}')">Excluir</button>
          </div>
        </div>
      `;
    });
  }

  window.adicionarCompromisso = function() {
    const title = document.getElementById("age-title").value;
    const date = document.getElementById("age-date").value;
    const type = document.getElementById("age-type").value;
    const desc = document.getElementById("age-desc").value;

    if (!title || !date) {
      alert("Por favor, preencha o título e a data limite.");
      return;
    }

    const newAge = {
      id: "age_" + Date.now(),
      title: title,
      date: date,
      type: type,
      desc: desc || "Compromisso de Negócio"
    };

    if (!state.agenda) state.agenda = [];
    state.agenda.push(newAge);
    DB.setState(state);

    Audit.log(`Adicionou compromisso na agenda: ${title} para o dia ${date}`);

    document.getElementById("age-title").value = "";
    document.getElementById("age-date").value = "";
    document.getElementById("age-desc").value = "";

    loadViewData("agenda");
  };

  window.removerCompromisso = function(id) {
    state.agenda = state.agenda.filter(item => item.id !== id);
    DB.setState(state);
    Audit.log(`Excluiu compromisso da agenda`);
    loadViewData("agenda");
  };

  // 17. Integrações (POS Hardware Simulator) Module
  function renderIntegraçoes() {
    // Populate Document Printer Select
    const printDoc = document.getElementById("int-print-doc");
    printDoc.innerHTML = "";
    state.documents.forEach(d => {
      printDoc.innerHTML += `<option value="${d.id}">${d.number} (${d.type} - MZN ${d.total.toLocaleString()})</option>`;
    });

    // Populate Barcode Scanner Select
    const barcodeSelect = document.getElementById("int-barcode-select");
    barcodeSelect.innerHTML = "";
    state.products.forEach(p => {
      barcodeSelect.innerHTML += `<option value="${p.id}">${p.name} (SKU: ${p.code})</option>`;
    });

    // Populate Hash Chain Logs
    const chainBody = document.getElementById("at-chain-rows");
    if (chainBody) {
      chainBody.innerHTML = "";
      state.documents.slice(0, 5).forEach((doc, idx) => {
        const lastSignature = state.documents[idx + 1] ? (state.documents[idx + 1].short_signature || "N/A") : "N/A (Início)";
        chainBody.innerHTML += `
          <tr>
            <td><strong>${doc.number}</strong></td>
            <td>${doc.date.split('.')[0].replace('T', ' ')}</td>
            <td>MZN ${doc.total.toLocaleString()}</td>
            <td><span style="font-family:monospace; color:var(--color-success);">${doc.short_signature || 'N/A'}</span></td>
            <td><span style="font-family:monospace; color:var(--text-muted);">${lastSignature}</span></td>
          </tr>
        `;
      });
      if (state.documents.length === 0) {
        chainBody.innerHTML = `<tr><td colspan="5" style="text-align:center; color:var(--text-muted); padding:10px;">Nenhum documento emitido nesta empresa ainda.</td></tr>`;
      }
    }
    carregarPresetWebhook();
  }

  window.auditarIntegridadeFiscal = function() {
    state = DB.getState();
    const badge = document.getElementById("audit-feedback-badge");
    if (!badge) return;

    if (!state.documents || state.documents.length === 0) {
      badge.className = "alert-box";
      badge.style.background = "rgba(16, 185, 129, 0.15)";
      badge.style.borderColor = "rgba(16, 185, 129, 0.3)";
      badge.style.color = "#a7f3d0";
      badge.style.padding = "10px";
      badge.style.borderRadius = "6px";
      badge.style.fontSize = "12px";
      badge.style.textAlign = "left";
      badge.style.marginTop = "15px";
      badge.innerHTML = `
        <strong style="color:#10b981; display:block; margin-bottom:5px;">✅ Auditoria Concluída:</strong>
        Nenhum documento emitido nesta empresa ainda. A cadeia de integridade está vazia e em conformidade.
      `;
      Audit.log("Auditoria fiscal realizada. Status: SUCESSO (Cadeia de faturamento vazia)");
      return;
    }

    // Chronological order: oldest to newest
    const chronoDocs = [...state.documents].reverse();
    let lastSignature = "";
    let lastTimestamp = 0;
    let lastDocNumber = "";
    let auditedCount = 0;
    let errors = [];

    for (let i = 0; i < chronoDocs.length; i++) {
      const doc = chronoDocs[i];

      // 1. Chronological order check
      const currentTimestamp = new Date(doc.date).getTime();
      if (lastTimestamp > 0 && currentTimestamp < lastTimestamp) {
        errors.push(`Quebra de ordem cronológica no documento <strong>${doc.number}</strong> (data: ${new Date(doc.date).toLocaleString('pt-MZ')}), que é anterior ao documento anterior <strong>${lastDocNumber}</strong> (data: ${new Date(lastTimestamp).toLocaleString('pt-MZ')}).`);
      }
      lastTimestamp = currentTimestamp;
      lastDocNumber = doc.number;

      // 2. Cryptographic signature chaining check (skip legacy invoices without fiscal_hash)
      if (!doc.fiscal_hash) {
        lastSignature = ""; // Reset chaining expectation for next document
        continue;
      }

      // Reconstruct hash data string
      const dateOnly = doc.date.split('T')[0];
      let sysDateTime = doc.date.split('.')[0];
      if (sysDateTime.endsWith('Z')) {
        sysDateTime = sysDateTime.substring(0, sysDateTime.length - 1);
      }

      const dataString = `${dateOnly};${sysDateTime};${doc.number};${Number(doc.total).toFixed(2)};${lastSignature}`;
      const computedHash = window.sha256(dataString);

      if (computedHash !== doc.fiscal_hash) {
        errors.push(`Quebra de integridade no documento <strong>${doc.number}</strong>: Assinatura criptográfica calculada não corresponde à armazenada (dados alterados ou assinatura inválida).`);
      }

      lastSignature = doc.fiscal_hash;
      auditedCount++;
    }

    if (errors.length > 0) {
      badge.className = "alert-box";
      badge.style.background = "rgba(244, 63, 94, 0.15)";
      badge.style.borderColor = "rgba(244, 63, 94, 0.3)";
      badge.style.color = "#fda4af";
      badge.style.padding = "10px";
      badge.style.borderRadius = "6px";
      badge.style.fontSize = "12px";
      badge.style.textAlign = "left";
      badge.style.marginTop = "15px";
      badge.innerHTML = `
        <strong style="color:#f43f5e; display:block; margin-bottom:5px;">⚠️ Falha na Auditoria Fiscal (${errors.length} erro(s)):</strong>
        <ul style="margin: 0; padding-left: 15px; line-height: 1.4;">
          ${errors.map(err => `<li style="margin-bottom:4px;">${err}</li>`).join('')}
        </ul>
      `;
      Audit.log(`Auditoria fiscal realizada. Status: FALHA (${errors.length} erro(s) de conformidade detectado(s))`);
    } else {
      badge.className = "alert-box";
      badge.style.background = "rgba(16, 185, 129, 0.15)";
      badge.style.borderColor = "rgba(16, 185, 129, 0.3)";
      badge.style.color = "#a7f3d0";
      badge.style.padding = "10px";
      badge.style.borderRadius = "6px";
      badge.style.fontSize = "12px";
      badge.style.textAlign = "left";
      badge.style.marginTop = "15px";
      badge.innerHTML = `
        <strong style="color:#10b981; display:block; margin-bottom:5px;">✅ Auditoria Concluída com Sucesso:</strong>
        A integridade cronológica e a cadeia criptográfica das faturas estão em conformidade legal.
        <div style="font-size:11px; margin-top:5px; color:#6ee7b7; line-height:1.4;">
          • Documentos auditados na cadeia: ${auditedCount}<br>
          • Integridade dos dados: CONFIRMADA (SHA-256 Chaining)<br>
          • Sequência cronológica: CONCORDANTE
        </div>
      `;
      Audit.log(`Auditoria fiscal realizada. Status: SUCESSO (${auditedCount} documento(s) validado(s))`);
    }
  };

  window.simularImpressaoTermica = function() {

    const docId = document.getElementById("int-print-doc").value;
    const doc = state.documents.find(d => d.id === docId);
    if (!doc) return;

    const company = state.companies.find(c => c.id === DB.currentCompanyId) || state.companies[0];
    const printWindow = window.open("", "_blank", "width=320,height=600");
    const dateFormatted = new Date(doc.date).toLocaleString('pt-MZ');

    let itemsText = "";
    doc.items.forEach(item => {
      itemsText += `
        <div style="display:flex; justify-content:space-between; margin-bottom:4px;">
          <span>${item.name} x${item.qty}</span>
          <span>${(item.qty * item.price).toLocaleString()} MZN</span>
        </div>
      `;
    });

    printWindow.document.write(`
      <html>
      <head>
        <title>Cupom Térmico</title>
        <style>
          body { font-family: monospace; font-size: 11px; padding: 10px; width: 280px; line-height: 1.3; color:#000; }
          .header { text-align: center; border-bottom: 1px dashed #000; padding-bottom: 8px; margin-bottom: 8px; }
          .footer { text-align: center; border-top: 1px dashed #000; padding-top: 8px; margin-top: 15px; font-size: 9px; }
          .totals { border-top: 1px dashed #000; padding-top: 5px; margin-top: 5px; font-weight: bold; }
        </style>
      </head>
      <body>
        <button onclick="window.print()" style="width:100%; margin-bottom:15px; font-size:11px;">Imprimir Cupom 80mm</button>
        <div class="header">
          <strong>💎 ${company.name}</strong><br>
          NUIT: ${company.nuit}<br>
          Tel: ${company.phone}<br>
          --------------------------<br>
          <strong>${doc.type.toUpperCase()}</strong><br>
          Nº: ${doc.number}<br>
          Data: ${dateFormatted}
        </div>
        
        <div>
          ${itemsText}
        </div>
        
        <div class="totals">
          <div style="display:flex; justify-content:space-between;">
            <span>TOTAL:</span>
            <span>${doc.total.toLocaleString()} MZN</span>
          </div>
        </div>

        <div style="margin-top:10px; font-size:9px;">
          OPERADOR: ${doc.operator}<br>
          PAGAMENTO: ${doc.payment_method}<br>
          HASH: ${doc.id.substring(4).toUpperCase()}-AGV-MZ
        </div>

        <div class="footer">
          Processado por computador<br>
          Obrigado pela sua preferência!
        </div>
      </body>
      </html>
    `);
    printWindow.document.close();
    Audit.log(`Simulou impressão térmica do documento ${doc.number}`);
  };

  window.simularLeituraCodigoBarras = function() {
    const prodId = document.getElementById("int-barcode-select").value;
    const prod = state.products.find(p => p.id === prodId);
    if (!prod) return;

    // Trigger POS checkout cart add
    addToCart(prodId, false);
    
    Audit.log(`Leitor de Código de Barras leu SKU: ${prod.code} (${prod.name})`);
    alert(`BIP! Código do produto lido com sucesso e adicionado ao POS: ${prod.name}`);

    // Switch view to POS
    switchView("pos");
  };

  window.simularEnvioWhatsApp = function() {
    const phone = document.getElementById("int-wa-phone").value.trim().replace(/\s+/g, "");
    const msg = document.getElementById("int-wa-msg").value;
    if (!phone) {
      alert("Introduza um número de celular.");
      return;
    }

    let localPhone = phone.replace(/^\+258/, "").replace(/^258/, "");
    const url = `https://api.whatsapp.com/send?phone=258${localPhone}&text=${encodeURIComponent(msg)}`;

    Audit.log(`WhatsApp API enviou fatura real para +258 ${localPhone}`);
    window.open(url, "_blank");
  };

  // --- ALERT NOTIFICATION HANDLERS ---
  window.abrirModalAlerta = function(phone, message) {
    let cleanedPhone = phone ? phone.toString().replace(/\s+/g, "") : "";
    if (cleanedPhone.startsWith("+258")) {
      cleanedPhone = cleanedPhone.replace("+258", "");
    } else if (cleanedPhone.startsWith("258") && cleanedPhone.length > 9) {
      cleanedPhone = cleanedPhone.substring(3);
    }
    
    document.getElementById("alerta-phone").value = cleanedPhone;
    document.getElementById("alerta-msg").value = message || "";
    document.getElementById("modal-envio-alerta").style.display = "flex";
  };

  window.fecharModalAlerta = function() {
    document.getElementById("modal-envio-alerta").style.display = "none";
  };

  window.enviarAlertaCanal = function(canal) {
    const phone = document.getElementById("alerta-phone").value.trim().replace(/\s+/g, "");
    const msg = document.getElementById("alerta-msg").value;
    if (!phone) {
      alert("Por favor, introduza um número de celular.");
      return;
    }
    
    let localPhone = phone.replace(/^\+258/, "").replace(/^258/, "");
    
    if (canal === "whatsapp") {
      const url = `https://api.whatsapp.com/send?phone=258${localPhone}&text=${encodeURIComponent(msg)}`;
      window.open(url, "_blank");
      Audit.log(`Alertas: WhatsApp Real disparado para +258 ${localPhone}`);
    } else {
      const url = `sms:+258${localPhone}?body=${encodeURIComponent(msg)}`;
      window.location.href = url;
      Audit.log(`Alertas: SMS disparado para +258 ${localPhone}`);
    }
    
    fecharModalAlerta();
  };

  // --- MULTI-COMPANY HANDLERS ---
  window.abrirModalNovaEmpresa = function() {
    document.getElementById("modal-nova-empresa").style.display = "flex";
  };

  window.fecharModalNovaEmpresa = function() {
    document.getElementById("modal-nova-empresa").style.display = "none";
  };

  window.salvarNovaEmpresa = function() {
    const name = document.getElementById("add-comp-name").value.trim();
    const nuit = document.getElementById("add-comp-nuit").value.trim();
    const phone = document.getElementById("add-comp-phone").value.trim();
    const email = document.getElementById("add-comp-email").value.trim();
    const address = document.getElementById("add-comp-address").value.trim();

    if (!name) {
      alert("Por favor, introduza o nome da empresa.");
      return;
    }
    if (!nuit) {
      alert("Por favor, introduza o NUIT da empresa.");
      return;
    }

    state = DB.getState(); // refresh state

    const newCompId = "comp_" + Date.now();
    const newCompany = {
      id: newCompId,
      name: name,
      nuit: nuit,
      phone: phone,
      email: email,
      currency: "MZN",
      address: address
    };

    // 1. Update list of companies in the current active state
    const updatedCompanies = [...state.companies, newCompany];
    state.companies = updatedCompanies;
    DB.setState(state);

    // 2. Synchronize the updated companies array across ALL company states present in localStorage
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key.startsWith("fine_erp_") && key.endsWith("_state")) {
        try {
          const compState = JSON.parse(localStorage.getItem(key));
          if (compState && compState.companies) {
            compState.companies = updatedCompanies;
            localStorage.setItem(key, JSON.stringify(compState));
          }
        } catch (err) {
          console.error("Erro ao sincronizar empresas no localStorage:", err);
        }
      }
    }

    // 3. Initialize clean state for the new company (so it doesn't seed with MOCK_DATA sales/products)
    const cleanState = {
      companies: updatedCompanies,
      users: state.users, // copy user list so users can login
      products: [],
      services: [],
      clients: [],
      suppliers: [],
      employees: [],
      expenses: [],
      purchases: [],
      agenda: [],
      documents: [],
      sales: [],
      cashRegister: {
        status: "Fechado",
        currentSession: null,
        history: []
      },
      audit: [
        {
          id: "aud_init_" + Date.now(),
          user: DB.getCurrentUser() ? DB.getCurrentUser().username : "admin",
          action: "Inicialização da Empresa " + newCompany.name,
          date: new Date().toISOString().split('T')[0],
          time: new Date().toTimeString().split(' ')[0],
          ip: "127.0.0.1",
          device: navigator.userAgent
        }
      ]
    };
    localStorage.setItem(`fine_erp_${newCompId}_state`, JSON.stringify(cleanState));

    // Log audit in the old company
    Audit.log(`Cadastrou nova empresa: ${newCompany.name} (ID: ${newCompId})`);

    alert("Empresa cadastrada com sucesso! Alternando para a nova empresa.");

    // Switch to new company and reload
    DB.switchCompany(newCompId);
    window.location.reload();
  };

  // --- M-PESA & e-MOLA WEBHOOK & USSD HANDLERS ---
  window.carregarPresetWebhook = function() {
    const preset = document.getElementById("sim-webhook-preset");
    if (!preset) return;
    const val = preset.value;
    const jsonArea = document.getElementById("sim-webhook-json");
    if (!jsonArea) return;

    let payload = {};
    if (val === "mpesa_geral") {
      payload = {
        provider: "M-Pesa",
        transactionId: "K89B" + Math.floor(100000 + Math.random()*900000),
        customerMSISDN: "847778899",
        amount: 2500,
        reference: "PAGAMENTO-GERAL"
      };
    } else if (val === "mpesa_reconcilia") {
      payload = {
        provider: "M-Pesa",
        transactionId: "K78A" + Math.floor(100000 + Math.random()*900000),
        customerMSISDN: "847778899",
        amount: 40600,
        reference: "FT/2026/1002"
      };
    } else if (val === "emola_geral") {
      payload = {
        provider: "e-Mola",
        transactionId: "EM" + Math.floor(10000000 + Math.random()*90000000),
        customerMSISDN: "821112233",
        amount: 1500,
        reference: "VENDA-DIRECTA"
      };
    }
    jsonArea.value = JSON.stringify(payload, null, 2);
  };

  window.submeterWebhookJSON = function() {
    const jsonText = document.getElementById("sim-webhook-json").value;
    let payload;
    try {
      payload = JSON.parse(jsonText);
    } catch (e) {
      alert("JSON inválido! Por favor verifique a sintaxe.");
      return;
    }

    const provider = payload.provider || "M-Pesa";
    const txId = payload.transactionId || "TX" + Date.now();
    const phoneVal = payload.customerMSISDN || "840000000";
    const amount = Number(payload.amount);
    const reference = payload.reference || "";

    if (isNaN(amount) || amount <= 0) {
      alert("Valor da transação inválido no JSON.");
      return;
    }

    state = DB.getState(); // refresh state

    let matchedDoc = state.documents.find(d => d.number === reference);
    let activeClient = null;
    let clientName = "Consumidor Final";
    let clientNuit = "999999999";
    let isDebtPayment = false;

    if (phoneVal) {
      activeClient = state.clients.find(c => c.phone && c.phone.replace(/[\s\+\-]/g, '').includes(phoneVal.replace(/[\s\+\-]/g, '')));
    }

    if (matchedDoc) {
      clientName = matchedDoc.client_name;
      clientNuit = matchedDoc.client_nuit;
      
      const clientObj = state.clients.find(c => c.name === clientName || c.nuit === clientNuit);
      if (clientObj && clientObj.credit_used > 0) {
        const paid = Math.min(amount, clientObj.credit_used);
        clientObj.credit_used -= paid;
        isDebtPayment = true;
      }

      // Archive receipt referencing original invoice
      Documents.archive(
        "Recibo",
        clientName,
        clientNuit,
        [{ name: `Liquidação de Fatura ${reference} (${provider} Ref: ${txId})`, qty: 1, price: amount, iva: 0 }],
        amount,
        `${provider} Webhook`,
        provider
      );

      if (CashRegister.isRegisterOpen()) {
        CashRegister.logMovement("entrada", amount, provider === "M-Pesa" ? "Mpesa" : "Emola", `${provider} Recebido: Reconciliação ${reference} (Ref: ${txId})`);
      }
    } else {
      if (activeClient) {
        clientName = activeClient.name;
        clientNuit = activeClient.nuit;
        if (activeClient.credit_used > 0) {
          const paid = Math.min(amount, activeClient.credit_used);
          activeClient.credit_used -= paid;
          isDebtPayment = true;

          Documents.archive(
            "Recibo",
            clientName,
            clientNuit,
            [{ name: `Amortização de Conta (${provider} Ref: ${txId})`, qty: 1, price: paid, iva: 0 }],
            paid,
            `${provider} Webhook`,
            provider
          );

          if (CashRegister.isRegisterOpen()) {
            CashRegister.logMovement("entrada", paid, provider === "M-Pesa" ? "Mpesa" : "Emola", `${provider} Recebido: Amortização Conta ${clientName} (Ref: ${txId})`);
          }

          const leftover = amount - paid;
          if (leftover > 0) {
            Documents.archive(
              "Factura Simplificada",
              clientName,
              clientNuit,
              [{ name: `Adiantamento de Caixa (${provider} Ref: ${txId})`, qty: 1, price: leftover, iva: 16 }],
              leftover,
              `${provider} Webhook`,
              provider
            );

            if (CashRegister.isRegisterOpen()) {
              CashRegister.logMovement("entrada", leftover, provider === "M-Pesa" ? "Mpesa" : "Emola", `${provider} Recebido: Adiantamento POS (Ref: ${txId})`);
            }
          }
        } else {
          Documents.archive(
            "Factura Simplificada",
            clientName,
            clientNuit,
            [{ name: `Venda Directa (${provider} Ref: ${txId})`, qty: 1, price: amount, iva: 16 }],
            amount,
            `${provider} Webhook`,
            provider
          );

          if (CashRegister.isRegisterOpen()) {
            CashRegister.logMovement("entrada", amount, provider === "M-Pesa" ? "Mpesa" : "Emola", `${provider} Recebido: Venda POS (Ref: ${txId})`);
          }
        }
      } else {
        Documents.archive(
          "Factura Simplificada",
          clientName,
          clientNuit,
          [{ name: `Venda Directa (${provider} Ref: ${txId})`, qty: 1, price: amount, iva: 16 }],
          amount,
          `${provider} Webhook`,
          provider
        );

        if (CashRegister.isRegisterOpen()) {
          CashRegister.logMovement("entrada", amount, provider === "M-Pesa" ? "Mpesa" : "Emola", `${provider} Recebido: Venda POS (Ref: ${txId})`);
        }
      }
    }

    DB.setState(state);
    showFloatingMpesaToast(txId, amount, phoneVal, clientName, isDebtPayment);
    loadViewData("integraçoes");
  };

  window.abrirModalPagamentoMovel = function(provider, phone, amount) {
    const modal = document.getElementById("modal-pagamento-movel");
    if (!modal) return;
    
    const operatorLabel = document.getElementById("movel-operator-label");
    const ussdMsg = document.getElementById("movel-ussd-msg");
    const pinArea = document.getElementById("movel-pin-area");
    const statusArea = document.getElementById("movel-status-area");
    const pinInput = document.getElementById("movel-pin-input");
    const confirmBtn = document.getElementById("movel-btn-confirm");
    
    pinInput.value = "";
    pinArea.style.display = "none";
    statusArea.style.display = "none";
    confirmBtn.style.display = "none";
    
    const providerName = provider === "Mpesa" ? "M-Pesa" : "e-Mola";
    operatorLabel.innerText = providerName;
    ussdMsg.innerHTML = `A ligar à rede <strong>${providerName}</strong>...<br><br>Enviando notificação USSD Push para o telemóvel <strong>+258 ${phone}</strong>...`;
    
    modal.style.display = "flex";
    
    setTimeout(() => {
      ussdMsg.innerHTML = `<strong>${providerName} Solicitação:</strong><br><br>Fine Art & service solicita o pagamento de <strong>${formatCurrency(amount)}</strong>.<br><br>Introduza o seu PIN de 4 dígitos para autorizar a transação:`;
      pinArea.style.display = "block";
      confirmBtn.style.display = "block";
      pinInput.focus();
    }, 1500);
  };

  window.confirmarPagamentoMovel = function() {
    const pinInput = document.getElementById("movel-pin-input");
    if (!pinInput.value || pinInput.value.length < 4) {
      alert("Por favor, introduza um PIN de 4 dígitos válido.");
      return;
    }
    
    const pinArea = document.getElementById("movel-pin-area");
    const statusArea = document.getElementById("movel-status-area");
    const statusText = document.getElementById("movel-status-text");
    const confirmBtn = document.getElementById("movel-btn-confirm");
    
    pinArea.style.display = "none";
    confirmBtn.style.display = "none";
    
    statusArea.style.display = "flex";
    statusText.innerText = "A validar PIN e saldo na rede móvel...";
    
    setTimeout(() => {
      statusText.innerHTML = `<span style="color:var(--color-success); font-weight:bold;">Sucesso!</span> Transação autorizada com sucesso.`;
      
      setTimeout(() => {
        document.getElementById("modal-pagamento-movel").style.display = "none";
        
        const pending = window.posPendingCheckout;
        if (pending) {
          const providerPrefix = pending.paymentMethod === "Mpesa" ? "K" : "EM";
          const txChars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
          let txId = providerPrefix;
          for (let i = 0; i < 8; i++) {
            txId += txChars.charAt(Math.floor(Math.random() * txChars.length));
          }
          
          completarCheckoutPOS(pending, txId);
        }
      }, 1000);
    }, 2000);
  };

  window.fecharModalPagamentoMovel = function() {
    document.getElementById("modal-pagamento-movel").style.display = "none";
    window.posPendingCheckout = null;
    alert("Venda cancelada: o pagamento móvel foi rejeitado ou cancelado.");
  };

  function completarCheckoutPOS(pending, txId) {
    const {
      cart: pendingCart,
      paymentMethod,
      docType,
      totalMZN,
      totalForeign,
      currency,
      rate,
      clientName,
      clientNuit,
      activeClient,
      phoneNum
    } = pending;

    state = DB.getState(); // refresh state

    // Deduct stock using FEFO
    pendingCart.forEach(item => {
      if (!item.isService) {
        const prod = state.products.find(p => p.id === item.product_id);
        if (prod) {
          deductStockFEFO(prod, item.qty);
        }
      }
    });

    // Write state
    DB.setState(state);

    // Save document (converting prices to display in selected invoice currency)
    const archivedItems = pendingCart.map(item => {
      return {
        product_id: item.product_id,
        name: item.name,
        price: currency === "MZN" ? item.price : Number((item.price / rate).toFixed(2)),
        iva: item.iva || 16,
        qty: item.qty,
        isService: item.isService
      };
    });

    const operator = DB.getCurrentUser().name;
    const providerName = paymentMethod === "Mpesa" ? "M-Pesa" : "e-Mola";
    const doc = Documents.archive(
      docType,
      clientName,
      clientNuit,
      archivedItems,
      totalMZN,
      operator,
      `${providerName} (Ref: ${txId})`,
      currency,
      rate,
      totalForeign
    );

    // Log Cash Movement if not credit (CashRegister expects base MZN)
    CashRegister.logMovement("entrada", totalMZN, paymentMethod, `Venda POS: ${doc.number} (${currency} - Ref: ${txId})`);

    // Trigger Print Window
    Documents.printPreview(doc.id);

    // Prepare message
    const docTotalMZN = doc.total;
    const cleanDocNumber = doc.number;
    const alertMsg = `Olá ${clientName}, agradecemos a sua preferência. Segue o recibo do seu documento ${cleanDocNumber} no valor de ${formatCurrency(docTotalMZN)}. Ref ${providerName}: ${txId}. Software Homologado nº 105/AT/2026.`;

    // Clear POS State
    cart.length = 0; // clears parent cart
    document.getElementById("pos-discount").value = 0;
    loadViewData("pos");

    // Open Alert Modal
    setTimeout(() => {
      abrirModalAlerta(phoneNum, alertMsg);
    }, 800);
  }

  // --- PREMIUM FLOATING TOAST ---
  function showFloatingMpesaToast(txId, amount, phone, clientName, isDebtPayment) {
    let container = document.getElementById("toast-container");
    if (!container) {
      container = document.createElement("div");
      container.id = "toast-container";
      container.style.position = "fixed";
      container.style.bottom = "20px";
      container.style.right = "20px";
      container.style.zIndex = "110000";
      container.style.display = "flex";
      container.style.flexDirection = "column";
      container.style.gap = "10px";
      document.body.appendChild(container);
    }

    const toast = document.createElement("div");
    toast.className = "mpesa-toast";
    toast.style.background = "rgba(16, 185, 129, 0.15)";
    toast.style.backdropFilter = "blur(15px)";
    toast.style.webkitBackdropFilter = "blur(15px)";
    toast.style.border = "1px solid rgba(16, 185, 129, 0.3)";
    toast.style.color = "#a7f3d0";
    toast.style.padding = "16px";
    toast.style.borderRadius = "12px";
    toast.style.boxShadow = "0 10px 30px rgba(0, 0, 0, 0.5)";
    toast.style.width = "320px";
    toast.style.fontFamily = "var(--font-family)";
    toast.style.display = "flex";
    toast.style.flexDirection = "column";
    toast.style.gap = "6px";
    toast.style.transform = "translateX(120%)";
    toast.style.transition = "transform 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275)";

    toast.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center; border-bottom: 1px solid rgba(16,185,129,0.2); padding-bottom:6px; margin-bottom:4px;">
        <span style="font-weight:800; font-size:12px; display:flex; align-items:center; gap:6px; color:#34d399;">
          <i data-lucide="smartphone"></i> M-PESA MOÇAMBIQUE
        </span>
        <span style="font-size:10px; color:#6ee7b7; font-weight:bold;">WEBHOOK OK</span>
      </div>
      <div style="font-size:13px;">
        Recebido: <strong style="font-size:15px; color:#fff;">MZN ${amount.toLocaleString()}</strong>
      </div>
      <div style="font-size:11px; color:#d1fae5;">
        De: <strong>+258 ${phone}</strong> (${clientName})
      </div>
      <div style="font-size:11px; color:#d1fae5;">
        Ref ID: <strong style="font-family:monospace; color:#fff;">${txId}</strong>
      </div>
      <div style="font-size:10px; margin-top:4px; color:#86efac; border-top:1px dashed rgba(16,185,129,0.2); padding-top:4px;">
        ${isDebtPayment ? '✅ Conta-corrente amortizada com sucesso' : '✅ Venda simplificada emitida e integrada'}
      </div>
    `;

    container.appendChild(toast);
    
    if (typeof lucide !== 'undefined') {
      lucide.createIcons();
    }

    // Slide in
    setTimeout(() => {
      toast.style.transform = "translateX(0)";
    }, 100);

    // Slide out and remove
    setTimeout(() => {
      toast.style.transform = "translateX(120%)";
      setTimeout(() => {
        toast.remove();
      }, 500);
    }, 8000);
  }

  function renderImpostos() {
    const decl = Accounting.getTaxDeclaration();
    
    document.getElementById("tax-iva-liquidado").innerText = `MZN ${decl.ivaLiquidado.toLocaleString()}`;
    document.getElementById("tax-iva-suportado").innerText = `MZN ${decl.ivaSuportado.toLocaleString()}`;
    
    const ivaNetEl = document.getElementById("tax-iva-net");
    if (decl.ivaNet > 0) {
      ivaNetEl.innerText = `MZN ${decl.ivaNet.toLocaleString()} (A Pagar)`;
      ivaNetEl.style.color = "var(--color-error)";
    } else if (decl.ivaNet < 0) {
      ivaNetEl.innerText = `MZN ${Math.abs(decl.ivaNet).toLocaleString()} (Crédito de IVA)`;
      ivaNetEl.style.color = "var(--color-success)";
    } else {
      ivaNetEl.innerText = `MZN 0`;
      ivaNetEl.style.color = "var(--text-main)";
    }

    // Recalculate salary IRPS & INSS
    let irpsSalarios = 0;
    let inssTrabalhadores = 0;
    let inssPatronal = 0;
    state.employees.forEach(emp => {
      const gross = emp.salary + (emp.commissions || 0);
      const empInss = gross * 0.03;
      const patInss = gross * 0.04;
      
      const taxable = Math.max(0, gross - empInss);
      let empIrps = 0;
      if (taxable <= 20249) empIrps = 0;
      else if (taxable <= 35249) empIrps = taxable * 0.10 - 2024.90;
      else if (taxable <= 50249) empIrps = taxable * 0.15 - 3787.40;
      else if (taxable <= 150249) empIrps = taxable * 0.20 - 6299.90;
      else if (taxable <= 300000) empIrps = taxable * 0.25 - 13812.40;
      else empIrps = taxable * 0.32 - 34812.40;
      empIrps = Math.max(0, empIrps);

      irpsSalarios += empIrps;
      inssTrabalhadores += empInss;
      inssPatronal += patInss;
    });

    // Recalculate service IRPS
    let irpsServicos = 0;
    state.expenses.forEach(exp => {
      if (exp.status === "Pago" && exp.irps > 0) {
        const subtotal = exp.amount / (exp.iva > 0 ? 1.16 : 1);
        irpsServicos += subtotal * (exp.irps / 100);
      }
    });

    document.getElementById("tax-irps-salarios").innerText = `MZN ${irpsSalarios.toLocaleString()}`;
    document.getElementById("tax-irps-servicos").innerText = `MZN ${irpsServicos.toLocaleString()}`;
    document.getElementById("tax-irps-total").innerText = `MZN ${(irpsSalarios + irpsServicos).toLocaleString()}`;
    
    document.getElementById("tax-inss-trabalhadores").innerText = `MZN ${inssTrabalhadores.toLocaleString()}`;
    document.getElementById("tax-inss-patronal").innerText = `MZN ${inssPatronal.toLocaleString()}`;
    document.getElementById("tax-inss-total").innerText = `MZN ${(inssTrabalhadores + inssPatronal).toLocaleString()}`;

    lucide.createIcons();
  }

  window.imprimirGuiaImpostos = function(tipo) {
    const decl = Accounting.getTaxDeclaration();
    const company = state.companies.find(c => c.id === DB.currentCompanyId) || state.companies[0];
    const printWindow = window.open("", "_blank", "width=850,height=900");
    
    let taxTableContent = "";
    let titleTax = "";
    let totalTaxAmount = 0;
    const currentMonthYear = new Date().toLocaleString('pt-MZ', { month: 'long', year: 'numeric' });

    if (tipo === "iva") {
      titleTax = "IMPOSTO SOBRE O VALOR ACRESCENTADO (IVA) - MODELO A";
      const ivaAPagar = decl.ivaNet > 0 ? decl.ivaNet : 0;
      totalTaxAmount = ivaAPagar;
      
      taxTableContent = `
        <tr>
          <td><strong>11311</strong></td>
          <td>IVA Liquidado (Vendas e Serviços Prestados)</td>
          <td style="text-align: right;">MZN ${decl.ivaLiquidado.toLocaleString()}</td>
        </tr>
        <tr>
          <td><strong>11312</strong></td>
          <td>IVA Suportado (Aquisições de Bens e Serviços)</td>
          <td style="text-align: right; color:#dc2626;">(-) MZN ${decl.ivaSuportado.toLocaleString()}</td>
        </tr>
        <tr style="font-weight: bold; background:#f8fafc;">
          <td>-</td>
          <td>Saldo de IVA a Recolher ao Estado</td>
          <td style="text-align: right; color:${ivaAPagar > 0 ? '#10b981' : '#475569'};">MZN ${ivaAPagar.toLocaleString()}</td>
        </tr>
      `;
    } else {
      titleTax = "DECLARAÇÃO DE RETENÇÕES DE IRPS & CONTRIBUIÇÕES DE INSS";
      
      let irpsSalarios = 0;
      let inssTrabalhadores = 0;
      let inssPatronal = 0;
      state.employees.forEach(emp => {
        const gross = emp.salary + (emp.commissions || 0);
        const empInss = gross * 0.03;
        const patInss = gross * 0.04;
        const taxable = Math.max(0, gross - empInss);
        let empIrps = 0;
        if (taxable <= 20249) empIrps = 0;
        else if (taxable <= 35249) empIrps = taxable * 0.10 - 2024.90;
        else if (taxable <= 50249) empIrps = taxable * 0.15 - 3787.40;
        else if (taxable <= 150249) empIrps = taxable * 0.20 - 6299.90;
        else if (taxable <= 300000) empIrps = taxable * 0.25 - 13812.40;
        else empIrps = taxable * 0.32 - 34812.40;
        empIrps = Math.max(0, empIrps);

        irpsSalarios += empIrps;
        inssTrabalhadores += empInss;
        inssPatronal += patInss;
      });

      let irpsServicos = 0;
      state.expenses.forEach(exp => {
        if (exp.status === "Pago" && exp.irps > 0) {
          const subtotal = exp.amount / (exp.iva > 0 ? 1.16 : 1);
          irpsServicos += subtotal * (exp.irps / 100);
        }
      });

      const totalINSS = inssTrabalhadores + inssPatronal;
      const totalIRPS = irpsSalarios + irpsServicos;
      totalTaxAmount = totalINSS + totalIRPS;

      taxTableContent = `
        <tr>
          <td><strong>11111</strong></td>
          <td>IRPS - Trabalho Dependente (Salários de Funcionários)</td>
          <td style="text-align: right;">MZN ${irpsSalarios.toLocaleString()}</td>
        </tr>
        <tr>
          <td><strong>11112</strong></td>
          <td>IRPS - Trabalho Independente (Serviços e Arrendamentos)</td>
          <td style="text-align: right;">MZN ${irpsServicos.toLocaleString()}</td>
        </tr>
        <tr>
          <td><strong>21411</strong></td>
          <td>INSS - Contribuição Geral de Segurança Social (3% Trab + 4% Entidade)</td>
          <td style="text-align: right;">MZN ${totalINSS.toLocaleString()}</td>
        </tr>
      `;
    }

    const referenceNumber = "2026" + Math.floor(100000 + Math.random() * 900000) + "MZ";

    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Guia Modelo 20 - AT Moçambique</title>
        <style>
          body { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; color: #1e293b; padding: 25px; font-size: 13px; line-height: 1.4; }
          .logo-area { text-align: center; border-bottom: 2px solid #000; padding-bottom: 12px; margin-bottom: 20px; }
          .gov-title { font-size: 14px; font-weight: bold; letter-spacing: 1px; margin-bottom: 4px; }
          .guide-title { font-size: 16px; font-weight: 800; color: #1e3a8a; margin-top: 10px; }
          .section-card { border: 1px solid #cbd5e1; border-radius: 6px; padding: 15px; margin-bottom: 20px; background: #fafafa; }
          .section-card h3 { margin: 0 0 10px 0; font-size: 12px; text-transform: uppercase; color: #1e3a8a; border-bottom: 1px solid #e2e8f0; padding-bottom: 6px; }
          table { width: 100%; border-collapse: collapse; margin-top: 10px; }
          th { background: #e2e8f0; color: #1e293b; font-weight: 700; padding: 8px; text-align: left; font-size: 11px; }
          td { padding: 10px 8px; border-bottom: 1px solid #e2e8f0; font-size: 12px; }
          .totals-table { width: 350px; margin-left: auto; margin-top: 20px; }
          .totals-table td { border: none; padding: 6px; }
          .grand-total td { font-size: 16px; font-weight: bold; border-top: 2px solid #000; padding-top: 10px; color:#1e3a8a; }
          .footer { text-align: center; font-size: 11px; color: #64748b; margin-top: 40px; border-top: 1px solid #e2e8f0; padding-top: 15px; }
          .btn-print { background: #1e3a8a; color: white; border: none; padding: 10px 20px; border-radius: 6px; cursor: pointer; font-weight: bold; margin-bottom: 20px; }
          @media print {
            .btn-print { display: none; }
            body { padding: 10px; }
          }
        </style>
      </head>
      <body>
        <button class="btn-print" onclick="window.print()">Imprimir Guia de Recolhimento</button>
        
        <div class="logo-area">
          <div class="gov-title">REPÚBLICA DE MOÇAMBIQUE</div>
          <div style="font-weight: 700; font-size: 11px; color:#475569;">MINISTÉRIO DA ECONOMIA E FINANÇAS • AUTORIDADE TRIBUTÁRIA DE MOÇAMBIQUE</div>
          <div class="guide-title">GUIA DE RECOLHIMENTO DE RECEITAS - MODELO 20</div>
        </div>

        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 20px;">
          <div>
            <strong>Referência de Pagamento:</strong> <span style="font-family:monospace; font-weight:bold; font-size:14px;">${referenceNumber}</span><br>
            <strong>Período Fiscal:</strong> <span style="text-transform: capitalize;">${currentMonthYear}</span>
          </div>
          <div style="text-align: right;">
            <strong>Data Limite de Entrega:</strong> ${tipo === 'iva' ? '15' : '20'} de ${new Date(Date.now() + 2592000000).toLocaleString('pt-MZ', { month: 'long', year: 'numeric' })}
          </div>
        </div>

        <div class="section-card">
          <h3>A. Identificação do Sujeito Passivo (Contribuinte)</h3>
          <div style="display:grid; grid-template-columns: 1fr 1fr; gap:10px;">
            <div>
              <strong>Nome / Razão Social:</strong> ${company.name}<br>
              <strong>NUIT Fiscal:</strong> ${company.nuit}<br>
              <strong>Endereço:</strong> ${company.address}
            </div>
            <div>
              <strong>Contacto:</strong> ${company.phone}<br>
              <strong>Email:</strong> ${company.email}<br>
              <strong>Moeda Utilizada:</strong> MZN (Metical)
            </div>
          </div>
        </div>

        <div class="section-card">
          <h3>B. Detalhes das Receitas a Declarar / Liquidações</h3>
          <table>
            <thead>
              <tr>
                <th style="width: 100px;">CÓDIGO RECEITA</th>
                <th>DESCRITIVO DO IMPOSTO</th>
                <th style="text-align: right; width: 150px;">VALOR LÍQUIDO (MZN)</th>
              </tr>
            </thead>
            <tbody>
              ${taxTableContent}
            </tbody>
          </table>
        </div>

        <table class="totals-table">
          <tr class="grand-total">
            <td>TOTAL GERAL A PAGAR:</td>
            <td style="text-align: right;">MZN ${totalTaxAmount.toLocaleString()}</td>
          </tr>
        </table>

        <div class="section-card" style="margin-top:20px; border-color:#93c5fd; background:#eff6ff;">
          <h3>C. Instruções para Pagamento Bancário</h3>
          <p style="margin: 0; font-size:11px; color:#1e40af;">
            Esta guia de recolhimento pode ser liquidada em qualquer banco comercial em Moçambique ou através de canais digitais homologados da AT.<br>
            <strong>Banco de Destino:</strong> Banco de Moçambique • <strong>Conta Única do Tesouro (CUT):</strong> 1001-002-AT<br>
            <strong>Código de Entidade M-Pesa Business (Vodacom):</strong> 840694 • <strong>Referência:</strong> ${referenceNumber.replace(/MZ/g, '')}
          </p>
        </div>

        <div style="margin-top: 40px; display: flex; justify-content: space-between; align-items: flex-end;">
          <div style="font-size:10px; color:#94a3b8; line-height:1.5;">
            Guia de Recolhimento emitida eletronicamente pelo software de faturamento <strong>Fine ERP Cloud</strong>.<br>
            Software Homologado pela AT Moçambique • Licença nº 105/AT/2026.
          </div>
          <div style="text-align: center; border-top: 1px solid #94a3b8; width: 220px; padding-top: 5px; font-size: 11px;">
            <strong>Xavier Moises</strong><br>
            Assinatura e Carimbo do Contribuinte
          </div>
        </div>

        <div class="footer">
          Fine ERP Cloud - Sistema de Gestão e Contabilidade Integrado • Autoridade Tributária de Moçambique
        </div>
      </body>
      </html>
    `);
    printWindow.document.close();
    Audit.log(`Emitiu Guia Modelo 20 de Arrecadação de Receita para ${tipo === 'iva' ? 'IVA' : 'IRPS/INSS'} (Referência: ${referenceNumber})`);
  };

  // -------------------------------------------------------------
  // OFFLINE-FIRST SYNC AND NETWORK MANAGEMENT
  // -------------------------------------------------------------
  
  window.simularAlternarConexao = function() {
    const nextStatus = state.networkStatus === "online" ? "offline" : "online";
    alterarEstadoRede(nextStatus);
  };
  
  function alterarEstadoRede(status) {
    state.networkStatus = status;
    
    // Bypass interceptor to save the status field
    const originalSetState = DB.setState.__original || DB.setState;
    originalSetState.call(DB, state);
    
    const syncBadge = document.getElementById("topbar-sync-badge");
    const syncText = syncBadge.querySelector(".sync-text");
    const netTitle = document.getElementById("offline-sim-status-title");
    const netDesc = document.getElementById("offline-sim-status-desc");
    const netBtn = document.getElementById("btn-toggle-sim-net");
    
    if (status === "online") {
      syncBadge.className = "sync-badge online";
      syncText.innerText = "Online • Híbrido";
      if (netTitle) netTitle.innerText = "Conexão: Online (Nuvem)";
      if (netDesc) netDesc.innerText = "Os dados são sincronizados em tempo real com o servidor principal.";
      if (netBtn) {
        netBtn.innerText = "Simular Offline";
        netBtn.className = "btn btn-secondary";
        netBtn.style.color = "#fde68a";
        netBtn.style.borderColor = "rgba(245, 158, 11, 0.4)";
      }
      
      // Auto-trigger sync if there are pending items
      if (state.pendingSyncQueue && state.pendingSyncQueue.length > 0) {
        setTimeout(() => {
          iniciarSincronismoManual();
        }, 800);
      }
    } else {
      syncBadge.className = "sync-badge offline";
      syncText.innerText = "Offline • Trabalho Local";
      if (netTitle) netTitle.innerText = "Conexão: Offline (Local)";
      if (netDesc) netDesc.innerText = "Modo de contingência ativado. As transações são guardadas no dispositivo.";
      if (netBtn) {
        netBtn.innerText = "Simular Online";
        netBtn.className = "btn btn-success";
        netBtn.style.color = "white";
        netBtn.style.borderColor = "transparent";
      }
    }
    
    atualizarUIFilaSync();
  }
  
  function atualizarUIFilaSync() {
    const queueList = document.getElementById("offline-sync-queue-list");
    const queueCountBadge = document.getElementById("sync-queue-count-badge");
    const lastSyncLabel = document.getElementById("last-sync-time-label");
    
    if (lastSyncLabel) {
      lastSyncLabel.innerText = `Último sincronismo: ${state.lastSyncTime || '--/--/---- --:--:--'}`;
    }
    
    const count = state.pendingSyncQueue ? state.pendingSyncQueue.length : 0;
    if (queueCountBadge) {
      queueCountBadge.innerText = `${count} pendentes`;
      if (count > 0) {
        queueCountBadge.style.background = "var(--color-warning)";
      } else {
        queueCountBadge.style.background = "var(--color-primary)";
      }
    }
    
    if (queueList) {
      if (count === 0) {
        queueList.innerHTML = `<div style="text-align:center; color:var(--text-muted); padding:10px;">Fila vazia. Todas as transações estão sincronizadas.</div>`;
      } else {
        queueList.innerHTML = "";
        state.pendingSyncQueue.forEach(item => {
          queueList.innerHTML += `
            <div style="display:flex; justify-content:space-between; background:rgba(255,255,255,0.03); border:1px solid var(--glass-border); padding:8px 10px; border-radius:6px; align-items:center;">
              <div>
                <strong style="color:var(--text-main);">${item.desc}</strong>
                <div style="font-size:9px; color:var(--text-muted);">${item.time}</div>
              </div>
              <span class="badge" style="background:rgba(245, 158, 11, 0.15); color:#fde68a; font-size:9px; border:1px solid rgba(245,158,11,0.3);">Pendente</span>
            </div>
          `;
        });
      }
    }
  }
  
  window.abrirModalOfflineSync = function() {
    document.getElementById("modal-offline-sync").style.display = "flex";
    atualizarUIFilaSync();
  };
  
  window.fecharModalOfflineSync = function() {
    document.getElementById("modal-offline-sync").style.display = "none";
  };
  
  window.iniciarSincronismoManual = function() {
    const count = state.pendingSyncQueue.length;
    const progressArea = document.getElementById("sync-progress-area");
    const progressBar = document.getElementById("sync-progress-bar");
    const progressText = document.getElementById("sync-progress-text");
    const progressPercent = document.getElementById("sync-progress-percentage");
    const btnSync = document.getElementById("btn-sync-now");
    
    if (progressArea) progressArea.style.display = "block";
    if (btnSync) btnSync.disabled = true;
    
    let pct = 0;
    const interval = setInterval(() => {
      pct += 10;
      if (progressBar) progressBar.style.width = pct + "%";
      if (progressPercent) progressPercent.innerText = pct + "%";
      if (progressText) {
        if (pct < 40) progressText.innerText = "Compactando transações locais...";
        else if (pct < 80) progressText.innerText = `Enviando ${count} lote(s) de dados à nuvem...`;
        else progressText.innerText = "Validando assinaturas criptográficas...";
      }
      
      if (pct >= 100) {
        clearInterval(interval);
        
        // Finalize sync
        state.pendingSyncQueue = [];
        state.lastSyncTime = new Date().toLocaleString("pt-MZ");
        state.networkStatus = "online";
        
        // Save using original DB.setState to bypass interceptor
        const originalSetState = DB.setState.__original || DB.setState;
        originalSetState.call(DB, state);
        
        Audit.log(`Sincronização Híbrida de Dados Concluída com sucesso (${count} transações carregadas)`);
        
        setTimeout(() => {
          if (progressArea) progressArea.style.display = "none";
          if (btnSync) btnSync.disabled = false;
          alterarEstadoRede("online");
          alert("Sincronização híbrida concluída com sucesso! Todos os dados locais foram carregados para a nuvem de forma segura.");
          fecharModalOfflineSync();
          loadViewData(document.querySelector(".view-section.active").id);
        }, 300);
      }
    }, 120);
  };
  
  // Listen for browser connectivity events
  window.addEventListener('online', () => {
    alterarEstadoRede("online");
    Audit.log("Conexão física restabelecida (Dispositivo Online)");
  });
  window.addEventListener('offline', () => {
    alterarEstadoRede("offline");
    Audit.log("Conexão física perdida (Dispositivo Offline)");
  });

  // -------------------------------------------------------------
  // PLANOS E MODULARIDADE EM MZN
  // -------------------------------------------------------------
  
  function renderPlanosModulos() {
    state = DB.getState();
    const modules = state.activeModules || { estoque: true, crm: true, contabilidade: true, rh: true };
    
    document.getElementById("mod-toggle-estoque").checked = !!modules.estoque;
    document.getElementById("mod-toggle-crm").checked = !!modules.crm;
    document.getElementById("mod-toggle-contabilidade").checked = !!modules.contabilidade;
    document.getElementById("mod-toggle-rh").checked = !!modules.rh;
    
    calcularFaturaMensal();
  }
  
  window.calcularFaturaMensal = function() {
    const isEstoque = document.getElementById("mod-toggle-estoque").checked;
    const isCrm = document.getElementById("mod-toggle-crm").checked;
    const isConta = document.getElementById("mod-toggle-contabilidade").checked;
    const isRh = document.getElementById("mod-toggle-rh").checked;
    
    let total = 1500; // base price
    let breakdownHTML = "";
    
    if (isEstoque) {
      total += 900;
      breakdownHTML += `
        <div style="display:flex; justify-content:space-between; margin-bottom:5px;">
          <span>Controle de Estoque & Lotes</span>
          <strong>+ 900 MZN</strong>
        </div>
      `;
    }
    if (isCrm) {
      total += 600;
      breakdownHTML += `
        <div style="display:flex; justify-content:space-between; margin-bottom:5px;">
          <span>CRM & Alertas SMS/WhatsApp</span>
          <strong>+ 600 MZN</strong>
        </div>
      `;
    }
    if (isConta) {
      total += 1200;
      breakdownHTML += `
        <div style="display:flex; justify-content:space-between; margin-bottom:5px;">
          <span>Contabilidade & Impostos</span>
          <strong>+ 1.200 MZN</strong>
        </div>
      `;
    }
    if (isRh) {
      total += 800;
      breakdownHTML += `
        <div style="display:flex; justify-content:space-between; margin-bottom:5px;">
          <span>Recursos Humanos & Despesas</span>
          <strong>+ 800 MZN</strong>
        </div>
      `;
    }
    
    document.getElementById("plan-breakdown-container").innerHTML = breakdownHTML;
    document.getElementById("plan-mzn-total").innerText = total.toLocaleString() + " MZN";
  };
  
  window.salvarModulosAtivos = function() {
    const isEstoque = document.getElementById("mod-toggle-estoque").checked;
    const isCrm = document.getElementById("mod-toggle-crm").checked;
    const isConta = document.getElementById("mod-toggle-contabilidade").checked;
    const isRh = document.getElementById("mod-toggle-rh").checked;
    
    state.activeModules = {
      estoque: isEstoque,
      crm: isCrm,
      contabilidade: isConta,
      rh: isRh
    };
    
    const originalSetState = DB.setState.__original || DB.setState;
    originalSetState.call(DB, state);
    
    atualizarSidebarModulos();
    Audit.log("Alterou a configuração dos módulos ativos da empresa");
    alert("Configurações de módulos aplicadas com sucesso!");
    loadViewData("planos-modulos");
  };
  
  function atualizarSidebarModulos() {
    state = DB.getState();
    const modules = state.activeModules || { estoque: true, crm: true, contabilidade: true, rh: true };
    const navItems = document.querySelectorAll(".nav-links li");
    
    const moduleMap = {
      compras: 'estoque', produtos: 'estoque', estoque: 'estoque',
      crm: 'crm', agenda: 'crm',
      contabilidade: 'contabilidade', impostos: 'contabilidade', documentos: 'contabilidade',
      rh: 'rh'
    };
    
    navItems.forEach(li => {
      const a = li.querySelector("a");
      if (!a) return;
      const href = a.getAttribute("href").substring(1);
      const mod = moduleMap[href];
      
      if (mod) {
        const active = !!modules[mod];
        const originalText = a.getAttribute("data-original-text") || a.innerText;
        if (!a.getAttribute("data-original-text")) {
          a.setAttribute("data-original-text", originalText);
        }
        
        if (!active) {
          a.style.opacity = "0.5";
          a.innerHTML = `<i data-lucide="${a.querySelector('i').getAttribute('data-lucide')}"></i> ${originalText.trim()} 🔒`;
        } else {
          a.style.opacity = "1";
          a.innerHTML = `<i data-lucide="${a.querySelector('i').getAttribute('data-lucide')}"></i> ${originalText.trim()}`;
        }
      }
    });
    lucide.createIcons();
  }
  
  window.activarModuloDirecto = function(moduleName) {
    state = DB.getState();
    state.activeModules = state.activeModules || { estoque: true, crm: true, contabilidade: true, rh: true };
    state.activeModules[moduleName] = true;
    
    const originalSetState = DB.setState.__original || DB.setState;
    originalSetState.call(DB, state);
    
    atualizarSidebarModulos();
    Audit.log(`Módulo '${moduleName}' ativado diretamente a partir da tela de bloqueio.`);
    alert(`O módulo '${moduleName}' foi ativado com sucesso! O ecrã foi desbloqueado.`);
    
    const activeView = document.querySelector(".view-section.active");
    if (activeView) {
      switchView(activeView.id);
    }
  };
  
  function mostrarEcraBloqueioModulo(viewId, moduleName) {
    const view = document.getElementById(viewId);
    const prices = { estoque: "900", crm: "600", contabilidade: "1.200", rh: "800" };
    const titles = {
      estoque: "Módulo de Controle de Estoque & Lotes",
      crm: "Módulo de CRM & Campanhas Móveis",
      contabilidade: "Módulo de Contabilidade Geral & Impostos",
      rh: "Módulo de Recursos Humanos & Folha Salarial"
    };
    const icons = {
      estoque: "archive",
      crm: "heart",
      contabilidade: "bar-chart-3",
      rh: "briefcase"
    };
    
    views.forEach(v => v.classList.remove("active"));
    view.classList.add("active");
    
    view.innerHTML = `
      <div class="module-lock-overlay">
        <div class="module-lock-card">
          <div class="module-lock-icon">
            <i data-lucide="${icons[moduleName]}" style="width:32px; height:32px;"></i>
          </div>
          <h2 style="font-family:'Outfit'; margin:0; font-size:20px; color:#fff;">${titles[moduleName]}</h2>
          <p style="color:var(--text-muted); font-size:12px; margin:0 10px;">
            Este ecrã requer a ativação do módulo. Ative planos em moeda local (MZN) com total controle e previsibilidade.
          </p>
          <div class="module-lock-price">${prices[moduleName]} MZN <span style="font-size:12px; color:var(--text-muted); font-weight:normal;">/ mês</span></div>
          <button class="btn btn-success" style="width:100%; height:40px; margin-top:10px;" onclick="activarModuloDirecto('${moduleName}')">
            <i data-lucide="unlock"></i> Activar Módulo Agora
          </button>
          <button class="btn btn-secondary" style="width:100%; height:40px;" onclick="switchView('planos-modulos')">
            Ver Planos de Assinatura
          </button>
        </div>
      </div>
    `;
    lucide.createIcons();
  }

  // -------------------------------------------------------------
  // AÇÕES RÁPIDAS (UX < 3 Cliques)
  // -------------------------------------------------------------
  
  window.abrirModalConsultaEstoque = function() {
    document.getElementById("modal-consulta-estoque").style.display = "flex";
    document.getElementById("estoque-search-input").value = "";
    filtrarConsultaEstoqueRapida();
  };
  
  window.fecharModalConsultaEstoque = function() {
    document.getElementById("modal-consulta-estoque").style.display = "none";
  };
  
  window.filtrarConsultaEstoqueRapida = function() {
    const query = document.getElementById("estoque-search-input").value.toLowerCase();
    const tbody = document.getElementById("estoque-search-tbody");
    tbody.innerHTML = "";
    
    state = DB.getState();
    let count = 0;
    
    state.products.forEach(p => {
      const nameMatch = p.name.toLowerCase().includes(query);
      const codeMatch = p.code.toLowerCase().includes(query);
      const catMatch = p.category.toLowerCase().includes(query);
      const batchesMatch = p.batches ? p.batches.some(b => b.code.toLowerCase().includes(query)) : false;
      
      if (nameMatch || codeMatch || catMatch || batchesMatch) {
        const batches = p.batches || [];
        batches.forEach(b => {
          if (b.qty > 0) {
            count++;
            let validityHTML = '<span style="color:#22c55e;">Válido</span>';
            if (b.expiry) {
              const expiryDate = new Date(b.expiry);
              const today = new Date();
              today.setHours(0,0,0,0);
              expiryDate.setHours(0,0,0,0);
              
              const diffTime = expiryDate.getTime() - today.getTime();
              const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
              
              if (diffDays < 0) {
                validityHTML = `<span style="color:#ef4444; font-weight:bold;">Expirado (${new Date(b.expiry).toLocaleDateString("pt-MZ")})</span>`;
              } else if (diffDays <= 30) {
                validityHTML = `<span style="color:#f59e0b; font-weight:bold;">Vence em ${diffDays} dias</span>`;
              } else {
                validityHTML = `<span style="color:#22c55e;">Validade: ${new Date(b.expiry).toLocaleDateString("pt-MZ")}</span>`;
              }
            } else {
              validityHTML = '<span style="color:var(--text-muted);">Sem validade</span>';
            }
            
            tbody.innerHTML += `
              <tr style="border-bottom:1px solid var(--glass-border);">
                <td style="padding:10px 8px; font-size:12px; text-align:left;"><strong>${p.name}</strong> <span style="font-size:10px; color:var(--text-muted); display:block;">Código: ${p.code} • ${p.category}</span></td>
                <td style="padding:10px 8px; font-size:12px; text-align:left; font-family:monospace;">${b.code}</td>
                <td style="padding:10px 8px; font-size:12px; text-align:right; font-weight:bold;">${b.qty} un</td>
                <td style="padding:10px 8px; font-size:11px; text-align:left;">${validityHTML}</td>
              </tr>
            `;
          }
        });
      }
    });
    
    if (count === 0) {
      tbody.innerHTML = `<tr><td colspan="4" style="text-align:center; padding:20px; color:var(--text-muted); font-size:12px;">Nenhum produto em estoque encontrado para a sua busca.</td></tr>`;
    }
  };
  
  window.redirecionarNovaDespesa = function() {
    switchView('rh');
    setTimeout(() => {
      const btn = document.querySelector('button[onclick="abrirModalDespesa()"]');
      if (btn) btn.click();
    }, 100);
  };

  // -------------------------------------------------------------
  // SUPORTE TÉCNICO LOCAL E HUMANIZADO
  // -------------------------------------------------------------
  
  window.toggleSupportDrawer = function() {
    const drawer = document.getElementById("support-drawer");
    const badge = document.querySelector(".support-widget-badge");
    
    if (drawer.style.display === "flex") {
      drawer.style.display = "none";
    } else {
      drawer.style.display = "flex";
      if (badge) badge.style.display = "none";
    }
  };
  
  window.acionarOpcaoSuporte = function(opcao) {
    const body = document.querySelector(".support-drawer-body");
    
    const msgs = {
      iva: "Preciso de ajuda com IVA & Guias Modelo 20.",
      mpesa: "Estou a ter falha de transação no M-Pesa / e-Mola.",
      certificacao: "Como funciona a Homologação e Código QR da AT?",
      humano: "Gostaria de falar com um atendente humano local."
    };
    
    const userMsg = msgs[opcao];
    
    body.innerHTML += `
      <div class="support-message-bubble user" style="background:rgba(99,102,241,0.1); border-right:3px solid var(--color-primary); align-self:flex-end; text-align:right; border-left:none; margin-left:20px;">
        ${userMsg}
      </div>
    `;
    
    body.scrollTop = body.scrollHeight;
    
    setTimeout(() => {
      let reply = "";
      if (opcao === 'iva') {
        reply = "Claro! Para emitir a Guia Modelo 20 de IVA ou IRPS, aceda ao menu **Impostos & Guias** no menu lateral. O sistema calcula automaticamente o IVA liquidado (16%), o IVA suportado e as retenções de IRPS sobre serviços e salários da folha. Depois, clique em *Imprimir Guia Modelo 20* para obter o documento pronto com a Referência da AT.";
      } else if (opcao === 'mpesa') {
        reply = "Se o seu cliente digitou o PIN e ocorreu uma falha, pode re-enviar o USSD Push directamente na consola de checkout do POS. Certifique-se que o número do cliente tem o prefixo de Moçambique (+258) e saldo suficiente. Lembre-se que as transações levam em média 10 segundos a serem confirmadas pela Vodacom / Tmcel.";
      } else if (opcao === 'certificacao') {
        reply = "O Fine ERP Cloud é homologado pela Autoridade Tributária sob a licença nº 105/AT/2026. Todas as faturas simplificadas e recibos emitidos são assinados digitalmente via SHA-256 e contêm o código QR fiscal com a assinatura encadeada, garantindo conformidade total com o regulamento de faturamento.";
      } else if (opcao === 'humano') {
        reply = "Perfeito! Estou a redirecionar a sua chamada para o atendente de plantão da nossa equipa em Maputo. Também pode ligar directamente para **+258 84 069 4277** ou enviar mensagem no WhatsApp Business.";
        setTimeout(() => {
          window.open("https://api.whatsapp.com/send?phone=258840694277&text=Olá%20suporte%20do%20Fine%20ERP,%20preciso%20de%20ajuda.", "_blank");
        }, 1500);
      }
      
      body.innerHTML += `
        <div class="support-message-bubble agent">
          ${reply}
        </div>
      `;
      body.scrollTop = body.scrollHeight;
    }, 800);
  };

  // Run initializations
  atualizarSidebarModulos();
  alterarEstadoRede(state.networkStatus);

  // Run login check on startup
  const currentUser = DB.getCurrentUser();
  if (currentUser) {
    // Show login box overlay first, pre-select user
    document.getElementById("login-username").value = currentUser.username;
    document.getElementById("login-overlay").style.display = "flex";
    document.getElementById("app-container").style.display = "none";
  } else {
    document.getElementById("login-overlay").style.display = "flex";
    document.getElementById("app-container").style.display = "none";
  }
});
