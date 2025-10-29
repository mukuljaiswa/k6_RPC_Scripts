import http from 'k6/http';
import { config, requestCounter, errorCounter } from './config.js';

// Transaction logger function
export function logTransaction(data) {
  const timestamp = new Date().toISOString();
  const logEntry = `[${timestamp}] Sender: ${data.senderAddress}, Hash: ${data.transactionHash}, Status: ${data.status}, Nonce: ${data.nonce}`;
  console.log(logEntry);
}

// Sign the transaction
export function getSignedTransaction(txData) {
  const res = http.post(config.signServer, JSON.stringify(txData), {
    headers: { 'Content-Type': 'application/json' },
    tags: { name: 'sign_tx' }
  });
  
  requestCounter.add(1);
  
  if (res.status !== 200) {
    console.error(`Signing failed: ${res.body}`);
    return null;
  }
  
  return res;
}

// Send raw transaction to RPC
export function sendRawTransaction(signedTx) {
  const rpcPayload = {
    jsonrpc: '2.0',
    method: 'eth_sendRawTransaction',
    params: [signedTx],
    id: Date.now() // Unique ID for each request
  };

  const res = http.post(config.rpcUrl, JSON.stringify(rpcPayload), {
    headers: { 'Content-Type': 'application/json' },
    tags: { name: 'rpc_tx' }
  });

  return res;
}

// Handle summary function
export function handleSummary(data) {
  const htmlReport = require("https://raw.githubusercontent.com/benc-uk/k6-reporter/main/dist/bundle.js").htmlReport;
  const textSummary = require("https://jslib.k6.io/k6-summary/0.0.1/index.js").textSummary;
  
  const now = new Date();
  const timestamp = now.toISOString().replace(/[:.]/g, '-');
  return {
    [`./k6_html_Reports/blockdag_load_test_${timestamp}.html`]: htmlReport(data, { 
      title: "BlockDAG RPC K6 Load Test Report" 
    }),
    stdout: textSummary(data, { indent: " ", enableColors: true }),
  };
}