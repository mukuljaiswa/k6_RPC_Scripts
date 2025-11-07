import { Counter, Gauge, Rate, Trend } from 'k6/metrics';

// Custom counters
export const requestCounter = new Counter('custom_http_reqs');
export const successCounter = new Counter('successful_txs');
export const errorCounter = new Counter('failed_txs');
export const rpcErrorCounter = new Counter('rpc_errors');

// ==================== PROMETHEUS METRICS ====================
export const prometheusMetrics = {
  // Transaction counters
  transactionsTotal: new Counter('blockchain_transactions_total'),
  transactionsSuccess: new Counter('blockchain_transactions_success_total'),
  transactionsFailed: new Counter('blockchain_transactions_failed_total'),
  
  // Error metrics
  errorRate: new Rate('blockchain_error_rate'),
  rpcErrors: new Counter('blockchain_rpc_errors_total'),
  signingErrors: new Counter('blockchain_signing_errors_total'),
  
  // Latency metrics
  signLatency: new Trend('blockchain_sign_latency_ms'),
  rpcLatency: new Trend('blockchain_rpc_latency_ms'),
  totalLatency: new Trend('blockchain_total_latency_ms'),
  
  // Throughput metrics
  activeUsers: new Gauge('blockchain_active_users'),
  dataThroughput: new Counter('blockchain_data_received_bytes'),
  
  // Business metrics
  transactionValue: new Counter('blockchain_transaction_value_wei'),
  gasUsed: new Counter('blockchain_gas_used_total'),
};

// Config - using only environment variables (no fallbacks)
export const config = {
  signServer: __ENV.SIGN_SERVER,
  rpcUrl: __ENV.RPC_URL,
  senderPath: __ENV.SENDER_WALLETS_PATH,
  receiverPath: __ENV.RECEIVER_WALLETS_PATH,
  etherValue: __ENV.DEFAULT_AMOUNT_ETHER,
  gas: __ENV.GAS || '30000',
  gasPrice: __ENV.GAS_PRICE || '50'
};

// Options with Prometheus compatible metrics
export const options = {
  stages: [
    { target: 15, duration: '10s' },  // ramp up
    { target: 15, duration: '20s' },  // steady load
    { target: 0, duration: '10s' }    // ramp down (smooth finish)
  ],

  thresholds: {
    // HTTP thresholds
    'http_req_duration{name:sign_tx}': ['p(95)<5000'],
    'http_req_duration{name:rpc_tx}': ['p(95)<15000'],
    'http_req_duration': ['p(95)<20000'],
    
    // Transaction thresholds
    'failed_txs': ['count<100'],
    'successful_txs': ['count>100'],
    'rpc_errors': ['count<50'],
    
    // Prometheus-specific thresholds
    'blockchain_error_rate': ['rate<0.05'],
    'blockchain_sign_latency_ms': ['p(95)<3000'],
    'blockchain_rpc_latency_ms': ['p(95)<10000'],
    'blockchain_total_latency_ms': ['p(95)<15000'],
  },
  
  summaryTrendStats: ['avg', 'min', 'med', 'max', 'p(95)', 'p(99)'],

  tags: {
    test_type: 'blockdag_transaction',
    component: 'rpc_load_test',
    environment: 'dev',
    network: 'blockdag'
  }
};
