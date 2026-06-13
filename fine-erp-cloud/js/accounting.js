/**
 * accounting.js - Automated Double-Entry Bookkeeping & Financial Reporting
 * Computes Balance Sheets, Balancetes, and Income Statements dynamically.
 */

const Accounting = {
  // Chart of Accounts (Plano de Contas)
  chartOfAccounts: {
    "1.1": { code: "1.1", name: "Caixa Geral", type: "Ativo" },
    "1.2": { code: "1.2", name: "Bancos / Depósitos", type: "Ativo" },
    "2.1": { code: "2.1", name: "Clientes Nacionais", type: "Ativo" },
    "2.2": { code: "2.2", name: "Estado (IVA a Recuperar)", type: "Ativo" },
    "3.1": { code: "3.1", name: "Existências (Estoque)", type: "Ativo" },
    "4.1": { code: "4.1", name: "Fornecedores Nacionais", type: "Passivo" },
    "4.2": { code: "4.2", name: "Estado (IVA a Pagar)", type: "Passivo" },
    "4.3": { code: "4.3", name: "Estado (IRPS Retido a Pagar)", type: "Passivo" },
    "4.4": { code: "4.4", name: "Estado (INSS a Pagar)", type: "Passivo" },
    "5.1": { code: "5.1", name: "Capital Social", type: "Capital Próprio" },
    "6.1": { code: "6.1", name: "Vendas de Mercadorias", type: "Proveitos" },
    "6.2": { code: "6.2", name: "Prestações de Serviços", type: "Proveitos" },
    "7.1": { code: "7.1", name: "Custo das Mercadorias Vendidas (CMV)", type: "Custos" },
    "7.2": { code: "7.2", name: "Fornecimentos e Serviços Externos (FSE)", type: "Custos" },
    "7.3": { code: "7.3", name: "Gastos com Pessoal (Salários)", type: "Custos" }
  },

  // Generates Double-entry Ledger Logs (Livro Razão / Diário)
  getLedgerEntries() {
    const state = DB.getState();
    const entries = [];

    // 1. Initial Social Capital (Seeded balance)
    entries.push({
      date: "2026-01-01",
      desc: "Capital Social Inicial",
      debit_acc: "1.2", debit_val: 1000000,
      credit_acc: "5.1", credit_val: 1000000
    });

    // 2. Seeding existing stock balance
    entries.push({
      date: "2026-01-15",
      desc: "Abertura de Stock Inicial",
      debit_acc: "3.1", debit_val: 150000,
      credit_acc: "1.2", credit_val: 150000
    });

    // 3. Process documents (Sales / Services)
    const documents = state.documents || [];
    documents.forEach(doc => {
      const isTaxable = doc.items.some(i => i.iva > 0);
      const subtotal = doc.total / (isTaxable ? 1.16 : 1);
      const iva = doc.total - subtotal;
      
      const dateOnly = doc.date.split('T')[0];
      const isService = doc.type === "Ordem de Serviço" || doc.items.some(item => {
        const isServ = state.services.some(s => s.name === item.name);
        return isServ;
      });

      const incomeAccount = isService ? "6.2" : "6.1";
      
      // Determine payment destination
      let paymentAccount = "1.1"; // Caixa
      const pMethod = doc.payment_method ? doc.payment_method.toLowerCase() : "";
      if (pMethod === "banco" || pMethod === "m-pesa" || pMethod === "mpesa" || pMethod === "e-mola" || pMethod === "emola") {
        paymentAccount = "1.2"; // Bank / Digital
      }

      // Add double entry: Debit Cash/Bank, Credit Income, Credit IVA
      const originalCurrencySuffix = (doc.currency && doc.currency !== "MZN") ? ` (${doc.currency} ${(doc.total_foreign || doc.total / doc.exchange_rate).toFixed(2)})` : "";

      entries.push({
        date: dateOnly,
        desc: `${doc.type} ${doc.number}${originalCurrencySuffix}`,
        debit_acc: paymentAccount,
        debit_val: doc.total,
        credit_acc: incomeAccount,
        credit_val: subtotal
      });

      if (iva > 0) {
        entries.push({
          date: dateOnly,
          desc: `IVA Liquidado em ${doc.number}${originalCurrencySuffix}`,
          debit_acc: paymentAccount,
          debit_val: 0, // already debited in the main transaction
          credit_acc: "4.2",
          credit_val: iva
        });
      }

      // If it's a product sale, register CMV (Cost of Goods Sold)
      if (!isService) {
        let estimatedCost = 0;
        doc.items.forEach(item => {
          const prod = state.products.find(p => p.name === item.name);
          if (prod) {
            estimatedCost += prod.price_purchase * item.qty;
          } else {
            const itemPriceMZN = (doc.currency && doc.currency !== "MZN" && doc.exchange_rate) ? (item.price * doc.exchange_rate) : item.price;
            estimatedCost += (itemPriceMZN * 0.6) * item.qty;
          }
        });

        if (estimatedCost > 0) {
          entries.push({
            date: dateOnly,
            desc: `CMV Ref. ${doc.number}`,
            debit_acc: "7.1",
            debit_val: estimatedCost,
            credit_acc: "3.1",
            credit_val: estimatedCost
          });
        }
      }
    });

    // 4. Process Expenses
    const expenses = state.expenses || [];
    expenses.forEach(exp => {
      if (exp.status === "Pago") {
        const hasIva = exp.iva && exp.iva > 0;
        const hasIrps = exp.irps && exp.irps > 0;
        
        const totalVal = exp.amount;
        const subtotal = totalVal / (hasIva ? 1.16 : 1);
        const ivaVal = totalVal - subtotal;
        const irpsPercent = exp.irps || 0;
        const irpsVal = subtotal * (irpsPercent / 100);
        const netPaid = totalVal - irpsVal;

        // Base expense payment
        const originalCurrencySuffix = (exp.currency && exp.currency !== "MZN" && exp.amount_foreign) ? ` (${exp.currency} ${exp.amount_foreign.toFixed(2)})` : "";

        entries.push({
          date: exp.date,
          desc: `Despesa: ${exp.category} (${exp.description})${originalCurrencySuffix}`,
          debit_acc: "7.2",
          debit_val: subtotal - irpsVal,
          credit_acc: "1.1",
          credit_val: subtotal - irpsVal
        });

        // VAT / IVA portion
        if (ivaVal > 0) {
          entries.push({
            date: exp.date,
            desc: `IVA Suportado em Despesa: ${exp.description}${originalCurrencySuffix}`,
            debit_acc: "2.2",
            debit_val: ivaVal,
            credit_acc: "1.1",
            credit_val: ivaVal
          });
        }

        // IRPS Withholding portion
        if (irpsVal > 0) {
          entries.push({
            date: exp.date,
            desc: `IRPS Retido (FSE ${irpsPercent}%): ${exp.description}${originalCurrencySuffix}`,
            debit_acc: "7.2",
            debit_val: irpsVal,
            credit_acc: "4.3",
            credit_val: irpsVal
          });
        }
      }
    });

    // 5. Process Salaries (INSS & IRPS Withholding)
    const employees = state.employees || [];
    employees.forEach(emp => {
      const gross = emp.salary + (emp.commissions || 0);
      const inssEmployee = gross * 0.03;
      const inssEmployer = gross * 0.04;
      
      // Mozambique progressive IRPS table calculation
      const taxable = Math.max(0, gross - inssEmployee);
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
      const netSalary = gross - inssEmployee - irps;

      // Net salary payment
      entries.push({
        date: "2026-06-05",
        desc: `Processamento Salário Líquido - ${emp.name}`,
        debit_acc: "7.3",
        debit_val: netSalary,
        credit_acc: "1.2",
        credit_val: netSalary
      });

      // IRPS Withholding
      if (irps > 0) {
        entries.push({
          date: "2026-06-05",
          desc: `IRPS Retido s/Salário - ${emp.name}`,
          debit_acc: "7.3",
          debit_val: irps,
          credit_acc: "4.3",
          credit_val: irps
        });
      }

      // INSS (Employee 3%)
      entries.push({
        date: "2026-06-05",
        desc: `INSS Retido Trabalhador (3%) - ${emp.name}`,
        debit_acc: "7.3",
        debit_val: inssEmployee,
        credit_acc: "4.4",
        credit_val: inssEmployee
      });

      // INSS (Employer 4%)
      entries.push({
        date: "2026-06-05",
        desc: `INSS Encargo Patronal (4%) - ${emp.name}`,
        debit_acc: "7.3",
        debit_val: inssEmployer,
        credit_acc: "4.4",
        credit_val: inssEmployer
      });
    });

    // 6. Process Purchases
    const purchases = state.purchases || [];
    purchases.forEach(pur => {
      const dateOnly = pur.date.split('T')[0];
      let paymentAccount = "1.2";
      if (pur.payment_method === "Dinheiro") {
        paymentAccount = "1.1";
      } else if (pur.payment_method === "Credito") {
        paymentAccount = "4.1";
      }

      const hasIva = pur.iva && pur.iva > 0;
      const totalVal = pur.total;
      const subtotal = totalVal / (hasIva ? 1.16 : 1);
      const ivaVal = totalVal - subtotal;

      // Product subtotal (debit Stock 3.1)
      const originalCurrencySuffix = (pur.currency && pur.currency !== "MZN" && pur.total_foreign) ? ` (${pur.currency} ${pur.total_foreign.toFixed(2)})` : "";

      entries.push({
        date: dateOnly,
        desc: `Compra Ref: ${pur.id} - ${pur.supplier_name}${originalCurrencySuffix}`,
        debit_acc: "3.1",
        debit_val: subtotal,
        credit_acc: paymentAccount,
        credit_val: subtotal
      });

      // VAT / IVA portion (debit IVA a Recuperar 2.2)
      if (ivaVal > 0) {
        entries.push({
          date: dateOnly,
          desc: `IVA Suportado em Compra: ${pur.supplier_name}${originalCurrencySuffix}`,
          debit_acc: "2.2",
          debit_val: ivaVal,
          credit_acc: paymentAccount,
          credit_val: ivaVal
        });
      }
    });

    return entries;
  },

  // Generates Balancete (Trial Balance)
  getBalancete() {
    const ledger = this.getLedgerEntries();
    const balancete = {};

    // Initialise all accounts
    for (const [code, acc] of Object.entries(this.chartOfAccounts)) {
      balancete[code] = {
        code: code,
        name: acc.name,
        type: acc.type,
        debit: 0,
        credit: 0,
        debit_balance: 0,
        credit_balance: 0
      };
    }

    // Accumulate ledger debits and credits
    ledger.forEach(entry => {
      if (balancete[entry.debit_acc] && entry.debit_val > 0) {
        balancete[entry.debit_acc].debit += entry.debit_val;
      }
      if (balancete[entry.credit_acc] && entry.credit_val > 0) {
        balancete[entry.credit_acc].credit += entry.credit_val;
      }
    });

    // Compute final balances
    for (const [code, data] of Object.entries(balancete)) {
      const diff = data.debit - data.credit;
      if (data.type === "Ativo" || data.type === "Custos") {
        if (diff > 0) {
          data.debit_balance = diff;
        } else {
          data.credit_balance = Math.abs(diff);
        }
      } else {
        // Passivo, Capital Próprio, Proveitos
        if (diff < 0) {
          data.credit_balance = Math.abs(diff);
        } else {
          data.debit_balance = diff;
        }
      }
    }

    return Object.values(balancete);
  },

  // Dynamic DRE (Demonstração de Resultados)
  getDRE() {
    const bal = this.getBalancete();
    
    const vendas = bal.find(a => a.code === "6.1").credit || 0;
    const servicos = bal.find(a => a.code === "6.2").credit || 0;
    const totalProveitos = vendas + servicos;

    const cmv = bal.find(a => a.code === "7.1").debit || 0;
    const fse = bal.find(a => a.code === "7.2").debit || 0;
    const pessoal = bal.find(a => a.code === "7.3").debit || 0;
    const totalCustos = cmv + fse + pessoal;

    const lucroBruto = totalProveitos - cmv;
    const resultadoExercicio = totalProveitos - totalCustos;

    return {
      vendas,
      servicos,
      totalProveitos,
      cmv,
      fse,
      pessoal,
      totalCustos,
      lucroBruto,
      resultadoExercicio
    };
  },

  // Dynamic Balanço Patrimonial (Balance Sheet)
  getBalancoPatrimonial() {
    const bal = this.getBalancete();
    const dre = this.getDRE();

    const caixa = bal.find(a => a.code === "1.1").debit_balance - bal.find(a => a.code === "1.1").credit_balance || 0;
    const bancos = bal.find(a => a.code === "1.2").debit_balance - bal.find(a => a.code === "1.2").credit_balance || 0;
    const clientes = bal.find(a => a.code === "2.1").debit_balance || 0;
    const estoque = bal.find(a => a.code === "3.1").debit_balance || 0;

    const totalAtivo = caixa + bancos + clientes + estoque;

    const fornecedores = bal.find(a => a.code === "4.1").credit_balance || 0;
    const ivaPagar = bal.find(a => a.code === "4.2").credit_balance || 0;

    const totalPassivo = fornecedores + ivaPagar;

    const capitalSocial = bal.find(a => a.code === "5.1").credit_balance || 0;
    const lucroAcumulado = dre.resultadoExercicio;

    const totalCapitalProprio = capitalSocial + lucroAcumulado;

    return {
      ativo: { caixa, bancos, clientes, estoque, total: totalAtivo },
      passivo: { fornecedores, ivaPagar, total: totalPassivo },
      capitalProprio: { capitalSocial, lucroAcumulado, total: totalCapitalProprio },
      balanceCheck: totalAtivo === (totalPassivo + totalCapitalProprio)
    };
  },

  // Direct Cash Flow Statement
  getCashFlow() {
    const ledger = this.getLedgerEntries();
    let saldoInicial = 1000000; // Seed bank account starting cash
    let entradasOperacionais = 0;
    let entradasFinanceiras = 0;
    let saidasFornecedores = 0;
    let saidasDespesas = 0;
    let saidasSalarios = 0;

    ledger.forEach(e => {
      const isCashInflow = (e.debit_acc === "1.1" || e.debit_acc === "1.2");
      const isCashOutflow = (e.credit_acc === "1.1" || e.credit_acc === "1.2");

      if (isCashInflow) {
        if (e.credit_acc === "5.1") {
          entradasFinanceiras += e.debit_val;
        } else if (e.credit_acc === "6.1" || e.credit_acc === "6.2" || e.credit_acc === "4.2") {
          entradasOperacionais += e.debit_val;
        } else if (e.desc && e.desc.includes("Amortização")) {
          entradasOperacionais += e.debit_val;
        }
      }

      if (isCashOutflow) {
        if (e.debit_acc === "3.1" || e.debit_acc === "4.1") {
          saidasFornecedores += e.credit_val;
        } else if (e.debit_acc === "7.2") {
          saidasDespesas += e.credit_val;
        } else if (e.debit_acc === "7.3") {
          saidasSalarios += e.credit_val;
        }
      }
    });

    const saldoFinal = (saldoInicial + entradasOperacionais + entradasFinanceiras) - (saidasFornecedores + saidasDespesas + saidasSalarios);

    return {
      saldoInicial,
      entradasOperacionais,
      entradasFinanceiras,
      saidasFornecedores,
      saidasDespesas,
      saidasSalarios,
      saldoFinal
    };
  },

  // Allocation by Cost Center
  getCostCenters() {
    const state = DB.getState();
    const centers = {
      "ADM": { name: "Administração", custos: 0, proveitos: 0 },
      "COM": { name: "Comercial / Vendas", custos: 0, proveitos: 0 },
      "LOG": { name: "Logística / Suporte", custos: 0, proveitos: 0 }
    };

    state.documents.forEach(doc => {
      const isService = doc.items.some(item => state.services.some(s => s.name === item.name));
      if (isService) {
        centers["COM"].proveitos += doc.total;
      } else {
        centers["LOG"].proveitos += doc.total;
      }
    });

    state.expenses.forEach(exp => {
      if (exp.category === "Água" || exp.category === "Energia" || exp.category === "Renda") {
        centers["ADM"].custos += exp.amount;
      } else if (exp.category === "Combustível") {
        centers["LOG"].custos += exp.amount;
      } else {
        centers["ADM"].custos += exp.amount * 0.5;
        centers["COM"].custos += exp.amount * 0.5;
      }
    });

    state.employees.forEach(emp => {
      const totalCost = emp.salary + (emp.commissions || 0);
      if (emp.role.includes("Vendedor") || emp.role.includes("Comercial")) {
        centers["COM"].custos += totalCost;
      } else if (emp.role.includes("Técnico") || emp.role.includes("Logística")) {
        centers["LOG"].custos += totalCost;
      } else {
        centers["ADM"].custos += totalCost;
      }
    });

    return Object.values(centers);
  },

  getTaxDeclaration() {
    const bal = this.getBalancete();
    const ivaLiquidado = bal.find(a => a.code === "4.2").credit || 0;
    const ivaSuportado = bal.find(a => a.code === "2.2").debit || 0;
    const irpsRetido = bal.find(a => a.code === "4.3").credit || 0;
    const inssPagar = bal.find(a => a.code === "4.4").credit || 0;

    return {
      ivaLiquidado,
      ivaSuportado,
      ivaNet: ivaLiquidado - ivaSuportado,
      irpsRetido,
      inssPagar
    };
  }
};

window.Accounting = Accounting;
