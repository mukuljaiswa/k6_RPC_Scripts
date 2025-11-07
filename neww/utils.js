import http from 'k6/http';
import { config, requestCounter, errorCounter, prometheusMetrics } from './config.js';

// Import HTML report in init context (global scope)
const htmlReport = require("https://raw.githubusercontent.com/benc-uk/k6-reporter/main/dist/bundle.js").htmlReport;
const textSummary = require("https://jslib.k6.io/k6-summary/0.0.1/index.js").textSummary;

// Transaction logger function
export function logTransaction(data) {

  const timestamp = new Date().toISOString();
  const logEntry = `[${timestamp}] Sender: ${data.senderAddress}, Hash: ${data.transactionHash}, Status: ${data.status}, Nonce: ${data.nonce}, SignLatency: ${data.signLatency}ms, RPCLatency: ${data.rpcLatency}ms`;
  console.log(logEntry);
}

// Sign the transaction
export function getSignedTransaction(txData) {
  // ==================== PROMETHEUS: Track active signing ====================
  prometheusMetrics.activeUsers.add(1);
  
  const signStart = Date.now();
  const res = http.post(config.signServer, JSON.stringify(txData), {
    headers: { 'Content-Type': 'application/json' },
    tags: { 
      name: 'sign_tx',
      endpoint: 'signer',
      method: 'POST',
      component: 'signing_server'
    }
  });
  
  const signDuration = Date.now() - signStart;
  
  // ==================== PROMETHEUS: Track metrics ====================
  requestCounter.add(1);
  prometheusMetrics.transactionsTotal.add(1);
  prometheusMetrics.signLatency.add(signDuration);
  prometheusMetrics.dataThroughput.add(res.body.length);
  
  if (res.status !== 200) {
    console.error(`Signing failed: ${res.body}`);
    prometheusMetrics.signingErrors.add(1);
    prometheusMetrics.errorRate.add(1);
    return null;
  }
  
  prometheusMetrics.errorRate.add(0);
  prometheusMetrics.activeUsers.add(-1);
  
  return {
    response: res,
    duration: signDuration
  };
}

// Send raw transaction to RPC
export function sendRawTransaction(signedTx) {
  // ==================== PROMETHEUS: Track active RPC ====================
  prometheusMetrics.activeUsers.add(1);
  
  const rpcPayload = {
    jsonrpc: '2.0',
    method: 'eth_sendRawTransaction',
    params: [signedTx],
    id: Date.now()
  };

  const rpcStart = Date.now();
  const res = http.post(config.rpcUrl, JSON.stringify(rpcPayload), {
    headers: { 'Content-Type': 'application/json' },
    tags: { 
      name: 'rpc_tx',
      endpoint: 'rpc',
      method: 'eth_sendRawTransaction',
      component: 'blockchain_rpc'
    }
  });
  
  const rpcDuration = Date.now() - rpcStart;
  
  // ==================== PROMETHEUS: Track metrics ====================
  prometheusMetrics.rpcLatency.add(rpcDuration);
  prometheusMetrics.dataThroughput.add(res.body.length);
  
  // Calculate total transaction value in wei (approximate)
  const etherValue = parseFloat(config.etherValue) || 0.0001;
  const valueWei = etherValue * 1e18;
  prometheusMetrics.transactionValue.add(valueWei);
  
  // Calculate gas used
  const gasUsed = parseInt(config.gas) || 30000;
  const gasPrice = parseInt(config.gasPrice) || 50;
  prometheusMetrics.gasUsed.add(gasUsed * gasPrice);
  
  prometheusMetrics.activeUsers.add(-1);
  
  return {
    response: res,
    duration: rpcDuration
  };
}

// Handle summary function
export function handleSummary(data) {
  console.log
  const now = new Date();
  const timestamp = now.toISOString().replace(/[:.]/g, '-');
  
  console.log('\n=== PROMETHEUS-FRIENDLY METRICS ===');
  console.log(`blockchain_transactions_total: ${data.metrics.custom_http_reqs.count}`);
  console.log(`blockchain_transactions_success_total: ${data.metrics.successful_txs.count}`);
  console.log(`blockchain_transactions_failed_total: ${data.metrics.failed_txs.count}`);
  console.log(`blockchain_rpc_errors_total: ${data.metrics.rpc_errors.count}`);
  console.log(`blockchain_sign_latency_p95: ${data.metrics.sign_latency_ms.values['p(95)']}`);
  console.log(`blockchain_rpc_latency_p95: ${data.metrics.rpc_latency_ms.values['p(95)']}`);
  console.log(`blockchain_success_rate: ${data.metrics.success_rate.values.rate}`);
  
  // Log Prometheus metrics
  if (data.metrics.blockchain_sign_latency_ms) {
    console.log(`prometheus_sign_latency_p95: ${data.metrics.blockchain_sign_latency_ms.values['p(95)']}`);
  }
  if (data.metrics.blockchain_rpc_latency_ms) {
    console.log(`prometheus_rpc_latency_p95: ${data.metrics.blockchain_rpc_latency_ms.values['p(95)']}`);
  }
  if (data.metrics.blockchain_error_rate) {
    console.log(`prometheus_error_rate: ${data.metrics.blockchain_error_rate.values.rate}`);
  }
  
  console.log('============******================\n');

  // Ensure directory exists (you might want to create it manually or add fs check)
  const reportPath = `./k6_html_Reports/blockdag_load_test_${timestamp}.html`;
  
  return {
    [reportPath]: htmlReport(data, { 
      title: "BlockDAG RPC K6 Load Test Report - Prometheus" 
    }),
    'stdout': textSummary(data, { indent: " ", enableColors: true }),
  };
}