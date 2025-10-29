import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { htmlReport } from "https://raw.githubusercontent.com/benc-uk/k6-reporter/main/dist/bundle.js";
import { textSummary } from "https://jslib.k6.io/k6-summary/0.0.1/index.js";
import { SharedArray } from 'k6/data';
import { Counter } from 'k6/metrics';
// import Web3 from 'web3';

// const web3 = new Web3(new HttpProvider('https://rpc.loadtest.devdomain123.com'));

// Custom counters
export const requestCounter = new Counter('custom_http_reqs');
export const successCounter = new Counter('successful_txs');
export const errorCounter = new Counter('failed_txs');
export const rpcErrorCounter = new Counter('rpc_errors');

// Config
const config = {
  signServer: __ENV.SIGN_SERVER || 'http://localhost:3000/sign',
  rpcUrl: __ENV.RPC_URL || 'https://rpc.loadtest.devdomain123.com/',
  senderPath: __ENV.SENDER_WALLETS_PATH || './wallets/output_part_1 copy.json',
  receiverPath: __ENV.RECEIVER_WALLETS_PATH || './wallets/output_part_2.json'
};

// Load senders and receivers
const senders = new SharedArray('senders', function () {
  return JSON.parse(open(config.senderPath));
});

const receivers = new SharedArray('receivers', function () {
  return JSON.parse(open(config.receiverPath));
});

// Transaction logger function
function logTransaction(data) {
  const timestamp = new Date().toISOString();
  const logEntry = `[${timestamp}] Sender: ${data.senderAddress}, Hash: ${data.transactionHash}, Status: ${data.status}, Nonce: ${data.nonce}`;
  console.log(logEntry);
}

// Sign the transaction
function getSignedTransaction(txData) {
 // console.log(web3.eth, '===========================================================================================')

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
function sendRawTransaction(signedTx) {
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

export default function () {
  const vuID = __VU;
  const iter = __ITER;
  const TOTAL_VUS = 1500;
  
  const senderIndex = (iter * TOTAL_VUS + (vuID - 1)) % senders.length;
  const receiverIndex = (iter + vuID) % receivers.length;
  
  const sender = { ...senders[senderIndex], amountEther: '0.0001' };
  const receiver = receivers[receiverIndex];
  
  const txData = {
    receiver: receiver.address ? receiver : { address: receiver }, // Ensure proper format
    amountEther: sender.amountEther,
    sender: {
      address: sender.address,
      privateKey: String(sender.privateKey)
    }
  };

  group("BlockDAG Transaction Flow", function () {
    // Step 1: Call signing server
    const signRes = getSignedTransaction(txData);
    
    if (!signRes) {
      errorCounter.add(1);
      return;
    }

    let signData;
    try {
      signData = JSON.parse(signRes.body);
    } catch (e) {
      console.error(`VU:${vuID} Iter:${iter} - Failed to parse sign response: ${signRes.body}`);
      errorCounter.add(1);
      return;
    }

    const { signedTx, nonce, transactionHash: expectedHash } = signData;

    if (!signedTx) {
      console.error(`VU:${vuID} Iter:${iter} - No signed transaction received`);
      errorCounter.add(1);
      return;
    }

    // Step 2: Send raw transaction to RPC
    const rpcRes = sendRawTransaction(signedTx);
    
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
        const body = JSON.parse(r.body);
        return body && body.result !== undefined;
      }
    });

    if (success) {
      successCounter.add(1);
      const txHash = rpcBody.result;
      
      logTransaction({
        senderAddress: sender.address,
        transactionHash: txHash,
        status: rpcRes.status,
        nonce: nonce
      });
      
      console.log(`VU:${vuID} Iter:${iter} - Success: ${txHash}, Expected: ${expectedHash}`);
    } else {
      errorCounter.add(1);
      rpcErrorCounter.add(1);
      
      console.error(`VU:${vuID} Iter:${iter} - RPC failed. Status: ${rpcRes.status}, Body: ${rpcRes.body}`);
      
      // Log detailed error information
      if (rpcBody && rpcBody.error) {
        console.error(`RPC Error: ${JSON.stringify(rpcBody.error)}`);
      }
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
        { duration: '10s', target: 5 }, // Start slower
        { duration: '20s', target: 10 },
        { duration: '10s', target: 0 }
      ],
      gracefulRampDown: '5s',
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

export function handleSummary(data) {
  const now = new Date();
  const timestamp = now.toISOString().replace(/[:.]/g, '-');
  return {
    [`./k6_html_Reports/blockdag_load_test_${timestamp}.html`]: htmlReport(data, { 
      title: "BlockDAG RPC K6 Load Test Report" 
    }),
    stdout: textSummary(data, { indent: " ", enableColors: true }),
  };
}