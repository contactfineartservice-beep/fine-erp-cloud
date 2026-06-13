/**
 * cashRegister.js - Cash Desk Session Control & Daily Reconciliation
 */

const CashRegister = {
  // Check if sales are permitted
  isRegisterOpen() {
    const state = DB.getState();
    return state.cashRegister && state.cashRegister.status === "Aberto";
  },

  // Open the cash desk
  open(initialValue, operatorName) {
    const state = DB.getState();
    const now = new Date();
    const dateStr = now.toISOString().split('T')[0];
    const timeStr = now.toTimeString().split(' ')[0];

    state.cashRegister.status = "Aberto";
    state.cashRegister.currentSession = {
      id: "sess_" + Date.now(),
      date: dateStr,
      operator: operatorName,
      open_time: timeStr,
      close_time: null,
      initial_value: Number(initialValue) || 0,
      vendas: 0,
      entradas: 0,
      saidas: 0,
      details: {
        dinheiro: 0,
        mpesa: 0,
        emola: 0,
        banco: 0,
        cartao: 0
      },
      final_value: 0,
      difference: 0,
      signature: ""
    };

    DB.setState(state);
    Audit.log(`Abertura de Caixa por ${operatorName} com Saldo Inicial de MZN ${initialValue}`);
  },

  // Log a cash flow movement (sales, deposits, purchases, wages, etc.)
  logMovement(type, amount, method, description = "") {
    if (!this.isRegisterOpen()) return;

    const state = DB.getState();
    const session = state.cashRegister.currentSession;
    const val = Number(amount) || 0;

    if (type === "entrada") {
      session.entradas += val;
      if (method && session.details[method.toLowerCase()] !== undefined) {
        session.details[method.toLowerCase()] += val;
      } else {
        session.details.dinheiro += val;
      }
    } else if (type === "saida") {
      session.saidas += val;
      session.details.dinheiro -= val; // Default exits from cash register (dinheiro)
    }

    DB.setState(state);
    Audit.log(`Movimento de Caixa: ${type === 'entrada' ? 'Entrada' : 'Saída'} - MZN ${val} (${method || 'Dinheiro'}) - ${description}`);
  },

  // Close the cash register
  close(dinheiroDeclarado, mpesaDeclarado, emolaDeclarado, bancoDeclarado, cartaoDeclarado, signature) {
    if (!this.isRegisterOpen()) return;

    const state = DB.getState();
    const session = state.cashRegister.currentSession;
    const now = new Date();
    const timeStr = now.toTimeString().split(' ')[0];

    session.close_time = timeStr;
    
    // Calculate expected cash balance
    // Cash balance = initial + entradas (dinheiro) - saidas
    const expectedDinheiro = session.initial_value + session.details.dinheiro - session.saidas;
    
    // Difference between declared and expected
    const diffDinheiro = Number(dinheiroDeclarado) - expectedDinheiro;
    const diffMpesa = Number(mpesaDeclarado) - session.details.mpesa;
    const diffEmola = Number(emolaDeclarado) - session.details.emola;
    const diffBanco = Number(bancoDeclarado) - session.details.banco;
    const diffCartao = Number(cartaoDeclarado) - session.details.cartao;

    const totalDiff = diffDinheiro + diffMpesa + diffEmola + diffBanco + diffCartao;
    
    session.final_value = Number(dinheiroDeclarado) + Number(mpesaDeclarado) + Number(emolaDeclarado) + Number(bancoDeclarado) + Number(cartaoDeclarado);
    session.difference = totalDiff;
    session.signature = signature;

    // Archive session to history
    state.cashRegister.history.unshift(JSON.parse(JSON.stringify(session)));
    state.cashRegister.status = "Fechado";
    state.cashRegister.currentSession = null;

    DB.setState(state);
    Audit.log(`Fechamento de Caixa por ${session.operator}. Diferença: MZN ${totalDiff}`);
  }
};

window.CashRegister = CashRegister;
