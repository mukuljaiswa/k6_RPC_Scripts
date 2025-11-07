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
    prometheusMetrics.activeUsers.add(-1);
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

// Handle summary function - CORRECTED VERSION
export function handleSummary(data) {
  const now = new Date();
  const timestamp = now.toISOString().replace(/[:.]/g, '-');
  
  console.log('\n=== PROMETHEUS-FRIENDLY METRICS ===');
  
  // Safe metric access with fallbacks
  const safeGetMetric = (metricName, property = 'count') => {
    const metric = data.metrics[metricName];
    return metric && metric[property] !== undefined ? metric[property] : 'N/A';
  };
  
  const safeGetTrendValue = (metricName, percentile = 'p(95)') => {
    const metric = data.metrics[metricName];
    return metric && metric.values && metric.values[percentile] !== undefined 
      ? metric.values[percentile] 
      : 'N/A';
  };

  const safeGetRate = (metricName) => {
    const metric = data.metrics[metricName];
    return metric && metric.rate !== undefined ? metric.rate : 'N/A';
  };

  // CORRECTED METRIC NAMES - Use the actual metric names from k6 output
  const totalTxs = safeGetMetric('blockchain_transactions_total');
  const successTxs = safeGetMetric('blockchain_transactions_success_total');
  const failedTxs = safeGetMetric('blockchain_transactions_failed_total');
  const rpcErrors = safeGetMetric('blockchain_rpc_errors_total');
  
  console.log(`blockchain_transactions_total: ${totalTxs}`);
  console.log(`blockchain_transactions_success_total: ${successTxs}`);
  console.log(`blockchain_transactions_failed_total: ${failedTxs}`);
  console.log(`blockchain_rpc_errors_total: ${rpcErrors}`);
  console.log(`blockchain_signing_errors_total: ${safeGetMetric('blockchain_signing_errors_total')}`);
  console.log(`blockchain_sign_latency_p95: ${safeGetTrendValue('blockchain_sign_latency_ms')}ms`);
  console.log(`blockchain_rpc_latency_p95: ${safeGetTrendValue('blockchain_rpc_latency_ms')}ms`);
  console.log(`blockchain_total_latency_p95: ${safeGetTrendValue('blockchain_total_latency_ms')}ms`);
  
  // Calculate success rate
  if (totalTxs !== 'N/A' && successTxs !== 'N/A' && totalTxs > 0) {
    const successRate = ((successTxs / totalTxs) * 100).toFixed(2);
    console.log(`blockchain_success_rate: ${successRate}%`);
  } else {
    console.log(`blockchain_success_rate: N/A`);
  }
  
  // Custom metrics
  console.log(`custom_transactions_total: ${safeGetMetric('custom_http_reqs')}`);
  console.log(`custom_successful_txs: ${safeGetMetric('successful_txs')}`);
  console.log(`custom_failed_txs: ${safeGetMetric('failed_txs')}`);
  console.log(`custom_rpc_errors: ${safeGetMetric('rpc_errors')}`);
  console.log(`custom_success_rate: ${safeGetRate('success_rate')}`);
  
  // Additional Prometheus metrics
  console.log(`prometheus_error_rate: ${safeGetRate('blockchain_error_rate')}`);
  console.log(`prometheus_data_throughput_bytes: ${safeGetMetric('blockchain_data_received_bytes')}`);
  console.log(`prometheus_gas_used: ${safeGetMetric('blockchain_gas_used_total')}`);
  console.log(`prometheus_transaction_value_wei: ${safeGetMetric('blockchain_transaction_value_wei')}`);
  console.log(`prometheus_active_users_peak: ${safeGetMetric('blockchain_active_users', 'max')}`);
  
  console.log('============******================\n');

  // Log threshold violations
  if (data.state && data.state.thresholds) {
    const violatedThresholds = Object.entries(data.state.thresholds)
      .filter(([_, threshold]) => threshold.ok === false)
      .map(([name, _]) => name);
    
    if (violatedThresholds.length > 0) {
      console.log('🚨 THRESHOLD VIOLATIONS:');
      violatedThresholds.forEach(threshold => {
        console.log(`   - ${threshold}`);
      });
      console.log('');
    }
  }

  const reportPath = `./k6_html_Reports/blockdag_load_test_${timestamp}.html`;
  
  return {
    [reportPath]: htmlReport(data, { 
      title: "BlockDAG RPC K6 Load Test Report - Prometheus" 
    }),
    'stdout': textSummary(data, { indent: " ", enableColors: true }),
  };
}