/**
 * audit.js - Immutable Action Logger & Security Auditing
 */

const Audit = {
  log(actionDescription) {
    const state = DB.getState();
    const currentUser = DB.getCurrentUser();
    
    const now = new Date();
    const dateStr = now.toISOString().split('T')[0];
    const timeStr = now.toTimeString().split(' ')[0];
    
    // Detect simulated OS/Browser
    const deviceStr = navigator.userAgent ? navigator.userAgent.substring(0, 50) : "Simulated Mobile / Web App";
    const simulatedIP = "197.249.20." + Math.floor(Math.random() * 254 + 1); // Mock Mozambican IP
    
    const logEntry = {
      id: "aud_" + Date.now() + "_" + Math.floor(Math.random()*1000),
      user: currentUser ? currentUser.name : "Sistema",
      action: actionDescription,
      date: dateStr,
      time: timeStr,
      ip: simulatedIP,
      device: deviceStr
    };
    
    if (!state.audit) state.audit = [];
    state.audit.unshift(logEntry); // Add to beginning (latest first)
    DB.setState(state);
    
    // Refresh Audit display if view is active
    if (typeof window.renderAuditTable === "function") {
      window.renderAuditTable();
    }
  }
};

window.Audit = Audit;
