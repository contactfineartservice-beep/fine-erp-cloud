/**
 * database.js - Data Access & State Management for Fine ERP Cloud
 * Provides LocalStorage persistence and mock seeding.
 */

const DB_PREFIX = "fine_erp_";

// Mock Database Seed Data
const MOCK_DATA = {
  companies: [
    { id: "comp_1", name: "Fine Art & service", nuit: "400123456", email: "contact.fineart.service@gmail.com", phone: "84069427 / 877796569", currency: "MZN", address: "Laulane, Maputo, Moçambique" },
    { id: "comp_2", name: "Serviços Rápidos Moçambique", nuit: "400987654", email: "info@sermoc.co.mz", phone: "827654321", currency: "MZN", address: "Av. 25 de Setembro, 456, Beira" }
  ],
  users: [
    { username: "admin", name: "Xavier Moises", role: "Administrador", active: true },
    { username: "caixa1", name: "Maria Estevão", role: "Caixa", active: true },
    { username: "conta1", name: "João Carlos", role: "Contabilista", active: true },
    { username: "gerente1", name: "Sulemane Issa", role: "Gerente", active: true },
    { username: "vendedor1", name: "Adilson Macuácua", role: "Vendedor", active: true },
    { username: "auditor1", name: "Clara Matusse", role: "Auditor", active: true }
  ],
  products: [
    { 
      id: "prod_1", 
      code: "P001", 
      barcode: "5601234560012", 
      name: "Computador Portátil HP 15", 
      category: "Informática", 
      brand: "HP", 
      unit: "un", 
      price_purchase: 25000, 
      price_sale: 35000, 
      stock: 12, 
      min_stock: 5, 
      supplier_id: "sup_1", 
      image: "",
      batches: [
        { id: "b_hp_1", code: "LOTE-HP-01", qty: 12, expiry: null }
      ]
    },
    { 
      id: "prod_2", 
      code: "P002", 
      barcode: "5601234560029", 
      name: "Rato Sem Fios Logitech", 
      category: "Informática", 
      brand: "Logitech", 
      unit: "un", 
      price_purchase: 800, 
      price_sale: 1500, 
      stock: 45, 
      min_stock: 10, 
      supplier_id: "sup_1", 
      image: "",
      batches: [
        { id: "b_logi_1", code: "LOTE-LOGI-01", qty: 45, expiry: null }
      ]
    },
    { 
      id: "prod_3", 
      code: "P003", 
      barcode: "5601234560036", 
      name: "Cabo HDMI 2.0 3m", 
      category: "Acessórios", 
      brand: "Generic", 
      unit: "un", 
      price_purchase: 150, 
      price_sale: 350, 
      stock: 3, 
      min_stock: 10, 
      supplier_id: "sup_2", 
      image: "",
      batches: [
        { id: "b_hdmi_exp", code: "L-HDMI-EXP", qty: 1, expiry: "2026-05-10" },
        { id: "b_hdmi_ok", code: "L-HDMI-OK", qty: 2, expiry: "2026-12-31" }
      ]
    },
    { 
      id: "prod_4", 
      code: "P004", 
      barcode: "5601234560043", 
      name: "Monitor Dell 24\"", 
      category: "Informática", 
      brand: "Dell", 
      unit: "un", 
      price_purchase: 8500, 
      price_sale: 13000, 
      stock: 2, 
      min_stock: 4, 
      supplier_id: "sup_1", 
      image: "",
      batches: [
        { id: "b_dell_1", code: "LOTE-DELL-01", qty: 2, expiry: null }
      ]
    }
  ],
  services: [
    { id: "serv_1", name: "Instalação de Rede Estruturada", category: "Suporte", price: 15000, duration: "4h", employee_id: "emp_1", commission: 10 },
    { id: "serv_2", name: "Consultoria Contábil Mensal", category: "Assessoria", price: 25000, duration: "N/A", employee_id: "emp_2", commission: 5 }
  ],
  clients: [
    { id: "cli_1", name: "Kuhanha Comércio Lda", nuit: "400112233", phone: "847778899", email: "info@kuhanha.co.mz", address: "Av. Vladimir Lenine, Maputo", credit_limit: 150000, credit_used: 45000 },
    { id: "cli_2", name: "Adélia Mucavele", nuit: "100556677", phone: "821112233", email: "adelia.m@gmail.com", address: "Bairro Central, Maputo", credit_limit: 20000, credit_used: 0 }
  ],
  suppliers: [
    { id: "sup_1", name: "Mega Distribuidora MZ", nuit: "400445566", phone: "849991122", email: "vendas@megadist.co.mz", address: "Zona Industrial da Machava" },
    { id: "sup_2", name: "Conectividade Geral S.A.", nuit: "400556677", phone: "824445566", email: "geral@conectividade.co.mz", address: "Av. Eduardo Mondlane, Beira" }
  ],
  employees: [
    { id: "emp_1", name: "Sérgio Tembe", role: "Técnico de Redes", salary: 30000, commissions: 1500, vacations: 15, faults: 1, overtime_hours: 4 },
    { id: "emp_2", name: "Délio Chilaule", role: "Contabilista Júnior", salary: 35000, commissions: 800, vacations: 22, faults: 0, overtime_hours: 0 }
  ],
  expenses: [
    { id: "exp_1", category: "Água", description: "Fatura FIPAG Maio", amount: 1500, date: "2026-05-15", status: "Pago" },
    { id: "exp_2", category: "Energia", description: "EDM Credelec Escritório", amount: 4500, date: "2026-06-01", status: "Pago" },
    { id: "exp_3", category: "Internet", description: "TVCabo Banda Larga", amount: 3800, date: "2026-06-05", status: "Pago" }
  ],
  purchases: [
    { id: "pur_1", supplier_name: "Mega Distribuidora MZ", date: "2026-06-10T11:00:00Z", items: [{ name: "Computador Portátil HP 15", qty: 5, price: 25000 }], total: 125000, payment_method: "Banco", status: "Pago" }
  ],
  agenda: [
    { id: "age_1", title: "Pagamento de IVA", date: "2026-06-15", type: "Imposto", desc: "Entrega do IVA mensal à Autoridade Tributária" },
    { id: "age_2", title: "Cobrança Kuhanha Lda", date: "2026-06-18", type: "Cobrança", desc: "Ligar sobre faturas pendentes" },
    { id: "age_3", title: "Apresentação de Balancete", date: "2026-06-20", type: "Reunião", desc: "Apresentação semestral para diretoria" }
  ],
  documents: [
    { id: "doc_1001", type: "Factura Simplificada", number: "FT/2026/1001", client_name: "Consumidor Final", client_nuit: "999999999", date: "2026-06-11T14:30:00Z", items: [{ name: "Rato Sem Fios Logitech", qty: 1, price: 1500, iva: 16 }], total: 1500, operator: "Maria Estevão", payment_method: "Dinheiro" },
    { id: "doc_1002", type: "Factura", number: "FT/2026/1002", client_name: "Kuhanha Comércio Lda", client_nuit: "400112233", date: "2026-06-12T09:15:00Z", items: [{ name: "Computador Portátil HP 15", qty: 1, price: 35000, iva: 16 }], total: 40600, operator: "Maria Estevão", payment_method: "M-Pesa" }
  ],
  sales: [
    { id: "sale_1", date: "2026-06-11", total: 1500, payment_method: "Dinheiro", items_count: 1 },
    { id: "sale_2", date: "2026-06-12", total: 40600, payment_method: "M-Pesa", items_count: 1 }
  ],
  cashRegister: {
    status: "Fechado",
    currentSession: null,
    history: [
      {
        id: "sess_1",
        date: "2026-06-11",
        operator: "Maria Estevão",
        open_time: "08:00",
        close_time: "18:00",
        initial_value: 5000,
        vendas: 1500,
        entradas: 1500,
        saidas: 0,
        details: { dinheiro: 1500, mpesa: 0, emola: 0, banco: 0, cartao: 0 },
        final_value: 6500,
        difference: 0,
        signature: "Maria Estevão"
      }
    ]
  },
  exchangeRates: {
    USD: 64.00,
    ZAR: 3.50
  },
  activeModules: {
    estoque: true,
    crm: true,
    contabilidade: true,
    rh: true
  },
  networkStatus: "online",
  pendingSyncQueue: [],
  lastSyncTime: new Date().toLocaleString("pt-MZ"),
  audit: [
    { id: "aud_1", user: "admin", action: "Inicialização do Sistema", date: "2026-06-12", time: "08:00", ip: "192.168.1.10", device: "Chrome / Windows 11" }
  ]
};

// Initialize DB Helper
const DB = {
  currentCompanyId: localStorage.getItem("fine_erp_current_company_id") || "comp_1",
  currentUser: null,

  // Load complete state for a company
  getState() {
    const key = `${DB_PREFIX}${this.currentCompanyId}_state`;
    let state = localStorage.getItem(key);
    if (!state) {
      // Seed initial data
      this.setState(MOCK_DATA);
      return JSON.parse(JSON.stringify(MOCK_DATA));
    }
    const parsed = JSON.parse(state);
    
    // Auto-inject exchangeRates if missing from previous saves
    if (!parsed.exchangeRates) {
      parsed.exchangeRates = { USD: 64.00, ZAR: 3.50 };
      this.setState(parsed);
    }

    // Auto-inject activeModules if missing
    if (!parsed.activeModules) {
      parsed.activeModules = {
        estoque: true,
        crm: true,
        contabilidade: true,
        rh: true
      };
      this.setState(parsed);
    }

    // Auto-inject network status and sync queue if missing
    if (parsed.networkStatus === undefined) {
      parsed.networkStatus = "online";
      parsed.pendingSyncQueue = [];
      parsed.lastSyncTime = new Date().toLocaleString("pt-MZ");
      this.setState(parsed);
    }
    
    // Auto-migrate old mock names if present in localstorage to match user's custom details
    const comp1 = parsed.companies.find(c => c.id === "comp_1");
    if (comp1 && (comp1.name === "Fine Importações Lda" || comp1.name === "Fine Importações Lda")) {
      comp1.name = "Fine Art & service";
      comp1.email = "contact.fineart.service@gmail.com";
      comp1.phone = "84069427 / 877796569";
      comp1.address = "Laulane, Maputo, Moçambique";
      
      const adminUser = parsed.users.find(u => u.username === "admin");
      if (adminUser) adminUser.name = "Xavier Moises";
      
      this.setState(parsed);
    }

    // Auto-migrate products to ensure batches array exists and matches total stock
    if (parsed.products) {
      let migrated = false;
      parsed.products.forEach(p => {
        if (!p.batches) {
          if (p.id === "prod_3") {
            p.batches = [
              { id: "b_hdmi_exp", code: "L-HDMI-EXP", qty: 1, expiry: "2026-05-10" },
              { id: "b_hdmi_ok", code: "L-HDMI-OK", qty: 2, expiry: "2026-12-31" }
            ];
          } else {
            p.batches = [
              { id: "b_legacy_" + Math.random().toString(36).substr(2, 9), code: "LOTE-GERAL", qty: p.stock, expiry: null }
            ];
          }
          migrated = true;
        } else {
          const sumQty = p.batches.reduce((sum, b) => sum + b.qty, 0);
          if (sumQty !== p.stock) {
            const diff = p.stock - sumQty;
            const generalBatch = p.batches.find(b => b.code === "LOTE-GERAL");
            if (generalBatch) {
              generalBatch.qty += diff;
              if (generalBatch.qty < 0) {
                generalBatch.qty = 0;
              }
            } else {
              p.batches.push({
                id: "b_adj_" + Math.random().toString(36).substr(2, 9),
                code: "LOTE-GERAL",
                qty: Math.max(0, diff),
                expiry: null
              });
            }
            migrated = true;
          }
        }
      });
      if (migrated) {
        this.setState(parsed);
      }
    }
    
    return parsed;
  },

  // Save complete state for a company
  setState(state) {
    const key = `${DB_PREFIX}${this.currentCompanyId}_state`;
    localStorage.setItem(key, JSON.stringify(state));
  },

  // Switch Company
  switchCompany(companyId) {
    this.currentCompanyId = companyId;
    localStorage.setItem("fine_erp_current_company_id", companyId);
    // Notify app of state reload
    if (typeof window.onCompanyChanged === "function") {
      window.onCompanyChanged();
    }
  },

  // Reset database to seeds
  reset() {
    const key = `${DB_PREFIX}${this.currentCompanyId}_state`;
    localStorage.removeItem(key);
    return this.getState();
  },

  // Set active user
  setCurrentUser(userObj) {
    this.currentUser = userObj;
    localStorage.setItem(`${DB_PREFIX}current_user`, JSON.stringify(userObj));
  },

  getCurrentUser() {
    if (!this.currentUser) {
      const stored = localStorage.getItem(`${DB_PREFIX}current_user`);
      if (stored) {
        this.currentUser = JSON.parse(stored);
        if (this.currentUser.username === "admin" && (this.currentUser.name === "Benjamin Contábil" || this.currentUser.name === "Benjamin Contábil")) {
          this.currentUser.name = "Xavier Moises";
          localStorage.setItem(`${DB_PREFIX}current_user`, JSON.stringify(this.currentUser));
        }
      } else {
        // default fallback
        this.currentUser = MOCK_DATA.users[0];
      }
    }
    return this.currentUser;
  }
};

// Expose globally
window.DB = DB;
