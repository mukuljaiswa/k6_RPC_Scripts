import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { htmlReport } from "https://raw.githubusercontent.com/benc-uk/k6-reporter/main/dist/bundle.js";
import { textSummary } from "https://jslib.k6.io/k6-summary/0.0.1/index.js";
import { SharedArray } from 'k6/data';
import { Counter } from 'k6/metrics';

// Custom counters
export const requestCounter = new Counter('custom_http_reqs');
export const successCounter = new Counter('successful_txs');
export const errorCounter = new Counter('failed_txs');
export const rpcErrorCounter = new Counter('rpc_errors');

// Config
const config = {
  rpcUrl: __ENV.RPC_URL || 'https://rpc.loadtest.devdomain123.com/',
  presignedTxPath: __ENV.PRESIGNED_TX_PATH || './presigned_transactions.json',
};

// Load pre-signed transactions
const presignedTxs = new SharedArray('presigned', function () {
  return JSON.parse(open(config.presignedTxPath));
});

// Transaction logger function
function logTransaction(data) {
  const timestamp = new Date().toISOString();
  const logEntry = `[${timestamp}] From: ${data.from}, To: ${data.to}, Hash: ${data.transactionHash}, Status: ${data.status}, Nonce: ${data.nonce}`;
  console.log(logEntry);
}

// Send raw transaction to RPC
function sendRawTransaction(signedTx) {
  const rpcPayload = {
    jsonrpc: '2.0',
    method: 'eth_sendRawTransaction',
    params: [signedTx],
    id: Date.now()
  };

  const res = http.post(config.rpcUrl, JSON.stringify(rpcPayload), {
    headers: { 'Content-Type': 'application/json' },
    tags: { name: 'rpc_send_raw_tx' },
    timeout: '30s'
  });

  requestCounter.add(1);
  return res;
}

export function setup() {
  console.log('=== Test Configuration ===');
  console.log(`RPC URL: ${config.rpcUrl}`);
  console.log(`Pre-signed Transactions: ${presignedTxs.length}`);
  console.log('========================\n');
  
  // Test RPC connectivity
  const testPayload = {
    jsonrpc: '2.0',
    method: 'eth_chainId',
    params: [],
    id: 1
  };
  
  const res = http.post(config.rpcUrl, JSON.stringify(testPayload), {
    headers: { 'Content-Type': 'application/json' }
  });
  
  if (res.status === 200) {
    try {
      const body = JSON.parse(res.body);
      console.log(`Connected to chain ID: ${body.result} (${parseInt(body.result, 16)})\n`);
    } catch (e) {
      console.error('Failed to parse chain ID response');
    }
  } else {
    console.error(`RPC connection failed with status: ${res.status}`);
  }
  
  return {};
}

export default function () {
  const vuID = __VU;
  const iter = __ITER;
  
  // Calculate transaction index
  // This ensures each VU uses different transactions and cycles through them
  const txIndex = (vuID - 1 + iter * __ENV.K6_VUS) % presignedTxs.length;
  const tx = presignedTxs[txIndex];
  
  group("BlockDAG Pre-signed Transaction", function () {
    console.log(`\nVU:${vuID} Iter:${iter} - Sending pre-signed transaction`);
    console.log(`  From: ${tx.from}`);
    console.log(`  To: ${tx.to}`);
    console.log(`  Nonce: ${tx.nonce}`);
    console.log(`  Value: ${tx.value} ETH`);

    // Send the pre-signed transaction
    const rpcRes = sendRawTransaction(tx.signedTx);
    
    let rpcBody;
    try {
      rpcBody = JSON.parse(rpcRes.body);
    } catch (e) {
      console.error(`VU:${vuID} Iter:${iter} - Failed to parse RPC response: ${rpcRes.body}`);
      errorCounter.add(1);
      return;
    }

    const success = check(rpcRes, {
      'RPC status is 200': (r) => r.status === 200,
      'RPC response has result': (r) => {
        try {
          const body = JSON.parse(r.body);
          return body && body.result !== undefined;
        } catch (e) {
          return false;
        }
      },
      'No RPC error': (r) => {
        try {
          const body = JSON.parse(r.body);
          return !body.error;
        } catch (e) {
          return false;
        }
      }
    });

    if (success && rpcBody.result) {
      successCounter.add(1);
      const txHash = rpcBody.result;
      
      logTransaction({
        from: tx.from,
        to: tx.to,
        transactionHash: txHash,
        status: rpcRes.status,
        nonce: tx.nonce
      });
      
      console.log(`VU:${vuID} Iter:${iter} - ✓ SUCCESS: ${txHash}\n`);
    } else {
      errorCounter.add(1);
      
      if (rpcBody && rpcBody.error) {
        rpcErrorCounter.add(1);
        console.error(`VU:${vuID} Iter:${iter} - ✗ RPC Error:`);
        console.error(`  Code: ${rpcBody.error.code}`);
        console.error(`  Message: ${rpcBody.error.message}`);
        if (rpcBody.error.data) {
          console.error(`  Data: ${JSON.stringify(rpcBody.error.data)}`);
        }
        
        // Special handling for common errors
        if (rpcBody.error.message.includes('nonce too low')) {
          console.warn('  Note: This transaction nonce has already been used');
        } else if (rpcBody.error.message.includes('insufficient funds')) {
          console.warn('  Note: Sender has insufficient balance');
        } else if (rpcBody.error.message.includes('already known')) {
          console.warn('  Note: Transaction already in mempool');
        }
      } else {
        console.error(`VU:${vuID} Iter:${iter} - ✗ Transaction failed`);
        console.error(`  Status: ${rpcRes.status}`);
        console.error(`  Body: ${rpcRes.body}`);
      }
      console.log('');
    }
  });
  
  sleep(1);
}

export let options = {
  scenarios: {
    ramp_up_and_down: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '10s', target: 5 },
        { duration: '20s', target: 10 },
        { duration: '10s', target: 0 }
      ],
      gracefulRampDown: '5s',
    },
  },
  thresholds: {
    'http_req_duration{name:rpc_send_raw_tx}': ['p(95)<15000'],
    'http_req_duration': ['p(95)<20000'],
    'failed_txs': ['count<100'],
    'successful_txs': ['count>100'],
    'rpc_errors': ['count<50'],
  },
};

export function handleSummary(data) {
  const now = new Date();
  const timestamp = now.toISOString().replace(/[:.]/g, '-');
  
  console.log('\n=== Test Summary ===');
  console.log(`Total Requests: ${data.metrics.custom_http_reqs ? data.metrics.custom_http_reqs.values.count : 0}`);
  console.log(`Successful Transactions: ${data.metrics.successful_txs ? data.metrics.successful_txs.values.count : 0}`);
  console.log(`Failed Transactions: ${data.metrics.failed_txs ? data.metrics.failed_txs.values.count : 0}`);
  console.log(`RPC Errors: ${data.metrics.rpc_errors ? data.metrics.rpc_errors.values.count : 0}`);
  console.log('====================\n');
  
  return {
    [`./k6_html_Reports/blockdag_load_test_${timestamp}.html`]: htmlReport(data, { 
      title: "BlockDAG RPC K6 Load Test Report - Pre-signed Transactions" 
    }),
    stdout: textSummary(data, { indent: " ", enableColors: true }),
  };
}