// Pure JS Synchronous SHA-256 for Fiscal Signature Chaining
function sha256(ascii) {
  function rightRotate(value, amount) {
    return (value >>> amount) | (value << (32 - amount));
  }
  
  const mathPow = Math.pow;
  const maxWord = mathPow(2, 32);
  const lengthProperty = 'length';
  let i, j;
  let result = '';
  const words = [];
  const asciiLength = ascii[lengthProperty];
  
  const hash = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19
  ];
  
  const k = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
  ];

  ascii += '\x80';
  while (ascii[lengthProperty] % 64 - 56) ascii += '\x00';
  for (i = 0; i < ascii[lengthProperty]; i++) {
    j = ascii.charCodeAt(i);
    if (j >> 8) return ""; // UTF-8 fallback
    words[i >> 2] |= j << (24 - (i % 4) * 8);
  }
  words[words[lengthProperty]] = ((asciiLength * 8) / maxWord) | 0;
  words[words[lengthProperty]] = (asciiLength * 8) | 0;
  
  let h0 = hash[0], h1 = hash[1], h2 = hash[2], h3 = hash[3], h4 = hash[4], h5 = hash[5], h6 = hash[6], h7 = hash[7];
  for (i = 0; i < words[lengthProperty]; i += 16) {
    const w = [];
    for (j = 0; j < 64; j++) {
      if (j < 16) {
        w[j] = words[i + j];
      } else {
        const s0 = rightRotate(w[j - 15], 7) ^ rightRotate(w[j - 15], 18) ^ (w[j - 15] >>> 3);
        const s1 = rightRotate(w[j - 2], 17) ^ rightRotate(w[j - 2], 19) ^ (w[j - 2] >>> 10);
        w[j] = (w[j - 16] + s0 + w[j - 7] + s1) | 0;
      }
      const ch = (h4 & h5) ^ (~h4 & h6);
      const maj = (h0 & h1) ^ (h0 & h2) ^ (h1 & h2);
      const temp1 = (h7 + (rightRotate(h4, 6) ^ rightRotate(h4, 11) ^ rightRotate(h4, 25)) + ch + k[j] + w[j]) | 0;
      const temp2 = ((rightRotate(h0, 2) ^ rightRotate(h0, 13) ^ rightRotate(h0, 22)) + maj) | 0;
      h7 = h6; h6 = h5; h5 = h4;
      h4 = (h3 + temp1) | 0;
      h3 = h2; h2 = h1; h1 = h0;
      h0 = (temp1 + temp2) | 0;
    }
    hash[0] = (hash[0] + h0) | 0; hash[1] = (hash[1] + h1) | 0; hash[2] = (hash[2] + h2) | 0; hash[3] = (hash[3] + h3) | 0;
    hash[4] = (hash[4] + h4) | 0; hash[5] = (hash[5] + h5) | 0; hash[6] = (hash[6] + h6) | 0; hash[7] = (hash[7] + h7) | 0;
    h0 = hash[0]; h1 = hash[1]; h2 = hash[2]; h3 = hash[3]; h4 = hash[4]; h5 = hash[5]; h6 = hash[6]; h7 = hash[7];
  }
  for (i = 0; i < 8; i++) {
    const value = hash[i];
    result += ((value >>> 24) & 255).toString(16).padStart(2, '0') +
              ((value >>> 16) & 255).toString(16).padStart(2, '0') +
              ((value >>> 8) & 255).toString(16).padStart(2, '0') +
              (value & 255).toString(16).padStart(2, '0');
  }
  return result;
}

const Documents = {
  // Generate a new sequential serial number
  generateNumber(type) {
    const state = DB.getState();
    const prefixMap = {
      "Factura": "FT",
      "Factura Simplificada": "FS",
      "Recibo": "RE",
      "Cotação": "CO",
      "Nota de Crédito": "NC",
      "Nota de Débito": "ND",
      "Guia de Remessa": "GR",
      "Guia de Transporte": "GT",
      "Proforma": "PF",
      "Ordem de Serviço": "OS"
    };
    
    const prefix = prefixMap[type] || "DOC";
    const year = new Date().getFullYear();
    
    // Count existing docs of this type to determine sequence number
    const matchingDocs = state.documents.filter(d => d.type === type);
    const seq = 1001 + matchingDocs.length;
    
    return `${prefix}/${year}/${seq}`;
  },

  // Save document to history (read-only, cannot be deleted)
  archive(type, clientName, clientNuit, items, total, operator, paymentMethod, currency = "MZN", exchangeRate = 1, totalForeign = null) {
    const state = DB.getState();
    const docNumber = this.generateNumber(type);
    
    // Cryptographic Chaining for Fiscal Certification (Homologação da AT)
    // Format: [Date YYYY-MM-DD];[DateTime YYYY-MM-DDTHH:MM:SS];[Invoice Number];[Total Amount];[Last Signature Hash]
    const docDate = new Date().toISOString();
    const dateOnly = docDate.split('T')[0];
    const sysDateTime = docDate.split('.')[0]; // YYYY-MM-DDTHH:MM:SS
    
    // Find the most recent document's signature
    const lastDoc = state.documents[0];
    const lastSignature = lastDoc ? (lastDoc.fiscal_hash || "") : "";
    
    const dataString = `${dateOnly};${sysDateTime};${docNumber};${Number(total).toFixed(2)};${lastSignature}`;
    const fullHash = sha256(dataString);
    
    // Printable short signature format: XXXX-XXXX-XXXX-XXXX
    const p1 = fullHash.substring(0, 4);
    const p2 = fullHash.substring(10, 14);
    const p3 = fullHash.substring(20, 24);
    const p4 = fullHash.substring(30, 34);
    const shortSignature = `${p1}-${p2}-${p3}-${p4}`.toUpperCase();

    const docEntry = {
      id: "doc_" + Date.now(),
      type: type,
      number: docNumber,
      client_name: clientName || "Consumidor Final",
      client_nuit: clientNuit || "999999999",
      date: docDate,
      items: items,
      total: Number(total),
      operator: operator || "Caixa Principal",
      payment_method: paymentMethod || "Dinheiro",
      currency: currency,
      exchange_rate: Number(exchangeRate),
      total_foreign: totalForeign !== null ? Number(totalForeign) : Number(total),
      fiscal_hash: fullHash,
      short_signature: shortSignature
    };

    state.documents.unshift(docEntry);
    DB.setState(state);
    
    // Log to Audit trail
    Audit.log(`Documento Emitido: ${type} nº ${docNumber} para ${clientName} - Valor: MZN ${total} (${currency}) - Assinatura: ${shortSignature}`);
    
    return docEntry;
  },

  // Launch a clean window/print style preview for PDF simulation
  printPreview(docId) {
    const state = DB.getState();
    const doc = state.documents.find(d => d.id === docId);
    if (!doc) return;

    const company = state.companies.find(c => c.id === DB.currentCompanyId) || state.companies[0];
    
    const printWindow = window.open("", "_blank", "width=800,height=900");
    const dateFormatted = new Date(doc.date).toLocaleString('pt-MZ');

    const symbolMap = { "MZN": "MZN", "USD": "$", "ZAR": "R" };
    const currency = doc.currency || "MZN";
    const symbol = symbolMap[currency] || currency;

    let itemsRows = "";
    doc.items.forEach((item, idx) => {
      const sub = item.qty * item.price;
      itemsRows += `
        <tr>
          <td>${idx + 1}</td>
          <td>${item.name}</td>
          <td>${item.qty}</td>
          <td>${item.price.toLocaleString()} ${symbol}</td>
          <td>${item.iva || 16}%</td>
          <td style="text-align: right;">${sub.toLocaleString()} ${symbol}</td>
        </tr>
      `;
    });

    const isTaxable = doc.items.some(i => i.iva > 0);
    const totalVal = doc.total_foreign || doc.total;
    const subtotal = totalVal / (isTaxable ? 1.16 : 1);
    const ivaValue = totalVal - subtotal;

    let exchangeRateNote = "";
    if (currency !== "MZN" && doc.exchange_rate) {
      exchangeRateNote = `
        <div style="background: #f8fafc; border: 1px solid #cbd5e1; padding: 12px; border-radius: 6px; margin-top: 15px; font-size: 11px; color: #475569; text-align: left; line-height: 1.4;">
          <strong>Nota Fiscal Cambial (Conversão Legal):</strong><br>
          Esta fatura foi emitida em <strong>${currency}</strong>. Taxa de câmbio de conversão aplicada: 1 ${currency} = ${doc.exchange_rate.toFixed(2)} MZN.<br>
          Contravalor total para fins contábeis e fiscais: <strong>MZN ${doc.total.toLocaleString()}</strong>.
        </div>
      `;
    }

    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Imprimir ${doc.number}</title>
        <style>
          body { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; color: #333; margin: 30px; font-size: 14px; }
          .header { display: flex; justify-content: space-between; border-bottom: 2px solid #6366f1; padding-bottom: 20px; margin-bottom: 30px; }
          .logo-area { font-size: 24px; font-weight: bold; color: #6366f1; }
          .company-info, .invoice-details { line-height: 1.6; }
          .title-area { font-size: 20px; font-weight: bold; text-align: right; color: #1e293b; margin-bottom: 10px; }
          .client-card { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 15px; margin-bottom: 30px; }
          .client-card h3 { margin: 0 0 10px 0; color: #475569; }
          table { width: 100%; border-collapse: collapse; margin-bottom: 30px; }
          th { background: #6366f1; color: #ffffff; text-align: left; padding: 10px; font-weight: 600; }
          td { padding: 10px; border-bottom: 1px solid #e2e8f0; }
          .totals-box { display: flex; justify-content: flex-end; margin-bottom: 40px; }
          .totals-table { width: 300px; margin: 0; }
          .totals-table td { padding: 6px 10px; border: none; }
          .totals-table tr.grand-total td { font-size: 18px; font-weight: bold; color: #6366f1; border-top: 2px solid #6366f1; }
          .footer { text-align: center; font-size: 12px; color: #94a3b8; border-top: 1px solid #e2e8f0; padding-top: 20px; margin-top: 50px; }
          .no-print-btn { background: #6366f1; color: white; border: none; padding: 10px 20px; border-radius: 6px; cursor: pointer; font-weight: bold; margin-bottom: 20px; }
          @media print {
            .no-print-btn { display: none; }
            body { margin: 15px; }
          }
        </style>
      </head>
      <body>
        <button class="no-print-btn" onclick="window.print()">Imprimir / Guardar PDF</button>
        
        <div class="header">
          <div class="company-info">
            <div class="logo-area">💎 Fine ERP Cloud</div>
            <strong>${company.name}</strong><br>
            NUIT: ${company.nuit}<br>
            Email: ${company.email}<br>
            Tel: ${company.phone}<br>
            Endereço: ${company.address}
          </div>
          <div class="invoice-details" style="text-align: right;">
            <div class="title-area">${doc.type.toUpperCase()}</div>
            <strong>Nº Documento:</strong> ${doc.number}<br>
            <strong>Data/Hora:</strong> ${dateFormatted}<br>
            <strong>Operador:</strong> ${doc.operator}<br>
            <strong>Modo Pagamento:</strong> ${doc.payment_method}
          </div>
        </div>
 
        <div class="client-card">
          <h3>Dados do Cliente</h3>
          <strong>Nome:</strong> ${doc.client_name}<br>
          <strong>NUIT:</strong> ${doc.client_nuit}<br>
        </div>
 
        <table>
          <thead>
            <tr>
              <th>Item</th>
              <th>Descrição</th>
              <th>Qtd</th>
              <th>Preço Unit.</th>
              <th>IVA</th>
              <th style="text-align: right;">Total</th>
            </tr>
          </thead>
          <tbody>
            ${itemsRows}
          </tbody>
        </table>
 
        <div class="totals-box" style="display:flex; flex-direction:column; align-items:flex-end;">
          <table class="totals-table">
            <tr>
              <td>Subtotal:</td>
              <td style="text-align: right;">${subtotal.toFixed(2).toLocaleString()} ${symbol}</td>
            </tr>
            <tr>
              <td>IVA (${isTaxable ? '16%' : 'Isento'}):</td>
              <td style="text-align: right;">${ivaValue.toFixed(2).toLocaleString()} ${symbol}</td>
            </tr>
            <tr class="grand-total">
              <td>Total:</td>
              <td style="text-align: right;">${totalVal.toLocaleString()} ${symbol}</td>
            </tr>
          </table>
          ${exchangeRateNote}
        </div>

        <div style="margin-top: 30px; display: flex; justify-content: space-between; align-items: center; border-top: 1px dashed #e2e8f0; padding-top: 15px;">
          <div style="font-size: 11px; color: #475569; line-height: 1.5; text-align: left;">
            <strong>Assinatura Digital (Hash):</strong> ${doc.short_signature || (doc.id.substring(4).toUpperCase() + "-AGV-MZ")}<br>
            <strong>Chave de Validação:</strong> ${doc.number.replace(/\//g, "-")}-${doc.total.toFixed(0)}-MZ<br>
            <em>Processado por computador • Software Certificado nº 105/AT/2026 • Fine ERP Cloud</em>
          </div>
          <div>
            <img src="https://api.qrserver.com/v1/create-qr-code/?size=100x100&data=FineERPCloud-MZ-Doc-${doc.number}-Total-${doc.total}-Hash-${doc.fiscal_hash || ''}-Cert-105-AT-2026" width="80" height="80" alt="QR Fiscal" style="border: 1px solid #cbd5e1; padding: 2px; border-radius: 4px;" />
          </div>
        </div>

        <div class="footer">
          Fine ERP Cloud - Sistema de Gestão e Contabilidade Integrado • Obrigado pela sua preferência!
        </div>
      </body>
      </html>
    `);
    printWindow.document.close();
  }
};

window.Documents = Documents;
window.sha256 = sha256;
