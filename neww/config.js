import { Counter } from 'k6/metrics';

// Custom counters
export const requestCounter = new Counter('custom_http_reqs');
export const successCounter = new Counter('successful_txs');
export const errorCounter = new Counter('failed_txs');
export const rpcErrorCounter = new Counter('rpc_errors');

// Config - using only environment variables (no fallbacks)
export const config = {
  signServer: __ENV.SIGN_SERVER,
  rpcUrl: __ENV.RPC_URL,
  senderPath: __ENV.SENDER_WALLETS_PATH,
  receiverPath: __ENV.RECEIVER_WALLETS_PATH,
  etherValue: __ENV.DEFAULT_AMOUNT_ETHER

};

// Options
export const options = {
  scenarios: {
    ramp_up_and_down: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '10s', target: 5 },
        { duration: '20s', target: 10 },
        { duration: '10s', target: 0 }
      ]
    },
  },
  thresholds: {
    'http_req_duration{name:sign_tx}': ['p(95)<5000'],
    'http_req_duration{name:rpc_tx}': ['p(95)<15000'],
    'http_req_duration': ['p(95)<20000'],
    'failed_txs': ['count<100'],
    'successful_txs': ['count>100'],
    'rpc_errors': ['count<50'],
  },
};