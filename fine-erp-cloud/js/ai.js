/**
 * ai.js - Local simulated AI Assistant parsing natural language queries
 */

const AIAssistant = {
  ask(question) {
    const q = question.toLowerCase().trim();
    const state = DB.getState();
    const company = state.companies.find(c => c.id === DB.currentCompanyId) || state.companies[0];
    const currency = company.currency || "MZN";

    // 1. "Quanto vendi este mês?" or "vendas"
    if (q.includes("quanto vendi") || q.includes("vendas") || q.includes("faturamento")) {
      const sales = state.sales || [];
      const now = new Date();
      const currentMonth = now.getMonth();
      const currentYear = now.getFullYear();

      let monthlyTotal = 0;
      let dailyTotal = 0;
      let totalSales = 0;

      sales.forEach(sale => {
        const saleDate = new Date(sale.date);
        totalSales += sale.total;
        
        if (saleDate.getFullYear() === currentYear && saleDate.getMonth() === currentMonth) {
          monthlyTotal += sale.total;
        }

        const todayStr = now.toISOString().split('T')[0];
        if (sale.date === todayStr) {
          dailyTotal += sale.total;
        }
      });

      return `📊 **Resumo de Faturamento (${company.name}):**
- **Hoje:** ${dailyTotal.toLocaleString()} ${currency}
- **Este Mês:** ${monthlyTotal.toLocaleString()} ${currency}
- **Acumulado Geral:** ${totalSales.toLocaleString()} ${currency}
- **Total de Vendas:** ${sales.length} transações registradas.`;
    }

    // 2. "Qual produto vende mais?" or "produto mais vendido"
    if (q.includes("produto vende mais") || q.includes("mais vendido") || q.includes("destaque")) {
      const documents = state.documents || [];
      const itemCounts = {};

      documents.forEach(doc => {
        if (doc.items) {
          doc.items.forEach(item => {
            itemCounts[item.name] = (itemCounts[item.name] || 0) + item.qty;
          });
        }
      });

      let topProduct = "";
      let maxQty = 0;
      for (const [name, qty] of Object.entries(itemCounts)) {
        if (qty > maxQty) {
          maxQty = qty;
          topProduct = name;
        }
      }

      if (!topProduct) {
        return "📦 Ainda não há registo de vendas de produtos suficiente para calcular o mais vendido.";
      }

      return `🔥 **Produto Mais Vendido:**
O produto líder de vendas é o **${topProduct}** com um total de **${maxQty} unidades** comercializadas.`;
    }

    // 3. "Quem deve dinheiro?" or "devedores" or "crédito"
    if (q.includes("quem deve") || q.includes("devedores") || q.includes("contas a receber") || q.includes("crédito")) {
      const clients = state.clients || [];
      const debtors = clients.filter(c => c.credit_used > 0);

      if (debtors.length === 0) {
        return "✅ Excelente! Nenhum cliente tem saldo em dívida ou compras a crédito pendentes de pagamento.";
      }

      let response = `💸 **Clientes com Contas a Receber (Em Dívida):**\n`;
      let totalDue = 0;
      debtors.forEach(c => {
        response += `- **${c.name}**: deve ${c.credit_used.toLocaleString()} ${currency} (Limite: ${c.credit_limit.toLocaleString()} ${currency})\n`;
        totalDue += c.credit_used;
      });
      response += `\n**Total pendente a receber:** ${totalDue.toLocaleString()} ${currency}`;
      return response;
    }

    // 4. "Qual foi meu lucro?" or "lucro" or "rentabilidade"
    if (q.includes("lucro") || q.includes("rentabilidade") || q.includes("margem")) {
      const sales = state.sales || [];
      const products = state.products || [];
      
      // Calculate simple profit: sales total - average purchase price of sold products
      // Here we simulate it or calculate based on documents
      const docs = state.documents || [];
      let totalRevenue = 0;
      let totalCost = 0;

      docs.forEach(doc => {
        totalRevenue += doc.total;
        if (doc.items) {
          doc.items.forEach(item => {
            const prod = products.find(p => p.name === item.name);
            if (prod) {
              totalCost += prod.price_purchase * item.qty;
            } else {
              // Standard cost fallback (60%)
              totalCost += (item.price * 0.6) * item.qty;
            }
          });
        }
      });

      const profit = totalRevenue - totalCost;
      const margin = totalRevenue > 0 ? ((profit / totalRevenue) * 100).toFixed(1) : 0;

      return `📈 **Análise de Rentabilidade:**
- **Faturamento Total:** ${totalRevenue.toLocaleString()} ${currency}
- **Custo das Mercadorias Vendidas (CMV):** ${totalCost.toLocaleString()} ${currency}
- **Lucro Líquido Estimado:** **${profit.toLocaleString()} ${currency}**
- **Margem de Lucro Média:** **${margin}%**`;
    }

    // 5. "Quanto tenho em caixa?" or "saldo" or "dinheiro em caixa"
    if (q.includes("quanto tenho em caixa") || q.includes("caixa") || q.includes("saldo de caixa")) {
      const register = state.cashRegister;
      if (register.status === "Fechado") {
        const lastSession = register.history[0];
        return `🔒 **O Caixa está atualmente Fechado.**
O último valor de fechamento registrado foi de **${lastSession ? lastSession.final_value.toLocaleString() : '0'} ${currency}** por ${lastSession ? lastSession.operator : 'N/A'}.`;
      } else {
        const sess = register.currentSession;
        const currentDinheiro = sess.initial_value + sess.details.dinheiro - sess.saidas;
        const currentMpesa = sess.details.mpesa;
        const currentEmola = sess.details.emola;
        const currentBanco = sess.details.banco;
        const currentCartao = sess.details.cartao;
        const total = currentDinheiro + currentMpesa + currentEmola + currentBanco + currentCartao;

        return `🔓 **Caixa Aberto por ${sess.operator}:**
- **Dinheiro Físico:** ${currentDinheiro.toLocaleString()} ${currency}
- **M-Pesa:** ${currentMpesa.toLocaleString()} ${currency}
- **e-Mola:** ${currentEmola.toLocaleString()} ${currency}
- **Banco/Transferência:** ${currentBanco.toLocaleString()} ${currency}
- **Cartão (POS):** ${currentCartao.toLocaleString()} ${currency}
- 💰 **Total Acumulado:** **${total.toLocaleString()} ${currency}**`;
      }
    }

    // 6. "estoque baixo" or "produtos em falta"
    if (q.includes("estoque") || q.includes("baixo") || q.includes("alerta")) {
      const products = state.products || [];
      const lowStock = products.filter(p => p.stock <= p.min_stock);

      if (lowStock.length === 0) {
        return "✅ Todos os produtos possuem estoque acima do limite mínimo.";
      }

      let response = `⚠️ **Produtos com Estoque Baixo (Alerta):**\n`;
      lowStock.forEach(p => {
        response += `- **${p.name}**: Apenas ${p.stock} ${p.unit} (Mínimo: ${p.min_stock})\n`;
      });
      return response;
    }

    // 7. Fallback response
    return `🤖 **Olá! Sou o Assistente IA do Fine ERP Cloud.** 
Não consegui responder com precisão à sua pergunta. Tente perguntar sobre:
- *"Quanto vendi este mês?"*
- *"Qual produto vende mais?"*
- *"Quem deve dinheiro no sistema?"*
- *"Qual foi meu lucro estimado?"*
- *"Quanto tenho em caixa agora?"*
- *"Quais produtos estão com estoque baixo?"*`;
  }
};

window.AIAssistant = AIAssistant;
