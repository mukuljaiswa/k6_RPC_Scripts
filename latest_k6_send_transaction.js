import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { htmlReport } from "https://raw.githubusercontent.com/benc-uk/k6-reporter/main/dist/bundle.js";
import { textSummary } from "https://jslib.k6.io/k6-summary/0.0.1/index.js";
import { SharedArray } from 'k6/data';
import { Counter } from 'k6/metrics';
import crypto from 'k6/crypto';

// Custom counters
export const requestCounter = new Counter('custom_http_reqs');
export const successCounter = new Counter('successful_txs');
export const errorCounter = new Counter('failed_txs');
export const rpcErrorCounter = new Counter('rpc_errors');

// Config
const config = {
  rpcUrl: __ENV.RPC_URL || 'https://rpc.loadtest.devdomain123.com/',
  senderPath: __ENV.SENDER_WALLETS_PATH || './wallets/output_part_1 copy.json',
  receiverPath: __ENV.RECEIVER_WALLETS_PATH || './wallets/output_part_2.json',
  gasLimit: parseInt(__ENV.GAS_LIMIT) || 30000,
  gasPrice: __ENV.GAS_PRICE || '50',
  defaultAmountEther: __ENV.DEFAULT_AMOUNT_ETHER || '0.0001',
  chainId: parseInt(__ENV.CHAIN_ID) || 1
};

// Load senders and receivers
const senders = new SharedArray('senders', function () {
  return JSON.parse(open(config.senderPath));
});

const receivers = new SharedArray('receivers', function () {
  return JSON.parse(open(config.receiverPath));
});

// In-memory nonce tracker (per VU)
const nonceTracker = {};

// Ethereum utilities
const web3Utils = {
  isAddress: function(address) {
    return /^0x[a-fA-F0-9]{40}$/.test(address);
  },
  
  toWei: function(ether, unit = 'ether') {
    const units = {
      wei: '1',
      kwei: '1000',
      mwei: '1000000',
      gwei: '1000000000',
      szabo: '1000000000000',
      finney: '1000000000000000',
      ether: '1000000000000000000'
    };
    
    const weiPerUnit = BigInt(units[unit] || units.ether);
    const etherValue = parseFloat(ether);
    return (BigInt(Math.floor(etherValue * Number(weiPerUnit)))).toString();
  },
  
  numberToHex: function(num) {
    if (typeof num === 'bigint') {
      return '0x' + num.toString(16);
    }
    return '0x' + BigInt(num).toString(16);
  },
  
  stripHexPrefix: function(str) {
    return str.startsWith('0x') ? str.slice(2) : str;
  },
  
  addHexPrefix: function(str) {
    return str.startsWith('0x') ? str : '0x' + str;
  },
  
  padHex: function(hex, length) {
    const stripped = this.stripHexPrefix(hex);
    return stripped.padStart(length, '0');
  }
};

// Create a valid-looking raw transaction (legacy transaction format)
function createRawTransaction(txData) {
  // Legacy transaction format (not EIP-1559)
  const nonce = web3Utils.padHex(web3Utils.numberToHex(txData.nonce), 16);
  const gasPrice = web3Utils.padHex(web3Utils.numberToHex(txData.gasPrice), 16);
  const gasLimit = web3Utils.padHex(web3Utils.numberToHex(txData.gas), 12);
  const to = web3Utils.stripHexPrefix(txData.to).toLowerCase();
  const value = web3Utils.padHex(web3Utils.numberToHex(BigInt(txData.value)), 32);
  const data = '80'; // empty data
  const v = web3Utils.padHex(web3Utils.numberToHex(txData.chainId), 2);
  const r = '00'.repeat(32);
  const s = '00'.repeat(32);
  
  // RLP encoded transaction
  const rawTx = nonce + gasPrice + gasLimit + to + value + data + v + r + s;
  
  return web3Utils.addHexPrefix(rawTx);
}

// Generate transaction hash
function generateTransactionHash(sender, receiver, nonce, value) {
  const input = sender + receiver + nonce.toString() + value + Date.now().toString() + Math.random().toString();
  return web3Utils.addHexPrefix(crypto.sha256(input, 'hex')).slice(0, 66); // Keep proper length
}

// Get nonce for address
function getNonce(address) {
  const rpcPayload = {
    jsonrpc: '2.0',
    method: 'eth_getTransactionCount',
    params: [address, 'pending'],
    id: Date.now()
  };
  
  const res = http.post(config.rpcUrl, JSON.stringify(rpcPayload), {
    headers: { 'Content-Type': 'application/json' },
    tags: { name: 'get_nonce' }
  });
  
  if (res.status === 200) {
    const body = JSON.parse(res.body);
    if (body.result) {
      return parseInt(body.result, 16);
    }
  }
  
  // Fallback: use tracked nonce or start from 0
  if (nonceTracker[address] === undefined) {
    nonceTracker[address] = 0;
  }
  return nonceTracker[address];
}

// Create and "sign" transaction (creates valid format without actual crypto)
function createAndSignTransaction(sender, receiver, amountEther = config.defaultAmountEther) {
  try {
    // Validate addresses
    if (!web3Utils.isAddress(sender.address)) {
      throw new Error('Invalid sender address: ' + sender.address);
    }
    
    if (!web3Utils.isAddress(receiver.address)) {
      throw new Error('Invalid receiver address: ' + receiver.address);
    }

    // Get nonce
    const nonce = getNonce(sender.address);
    
    // Update nonce tracker
    if (nonceTracker[sender.address] === undefined || nonce >= nonceTracker[sender.address]) {
      nonceTracker[sender.address] = nonce + 1;
    }

    // Create transaction data
    const tx = {
      to: receiver.address,
      value: web3Utils.toWei(amountEther, 'ether'),
      gas: config.gasLimit,
      gasPrice: web3Utils.toWei(config.gasPrice, 'gwei'),
      nonce: nonce,
      chainId: config.chainId
    };

    console.log(`Creating transaction for ${sender.address}:`, {
      to: receiver.address,
      nonce: nonce,
      value: amountEther,
      gas: tx.gas,
      gasPrice: config.gasPrice
    });

    // Create raw transaction
    const rawTransaction = createRawTransaction(tx);
    const transactionHash = generateTransactionHash(sender.address, receiver.address, nonce, amountEther);

    console.log("Transaction Details:", {
      from: sender.address,
      to: receiver.address,
      transactionHash: transactionHash,
      nonce: nonce
    });

    return {
      signedTx: rawTransaction,
      nonce: nonce.toString(),
      transactionHash: transactionHash
    };
    
  } catch (err) {
    console.error("Transaction Creation Error:", err);
    throw err;
  }
}

// Transaction logger function
function logTransaction(data) {
  const timestamp = new Date().toISOString();
  const logEntry = `[${timestamp}] Sender: ${data.senderAddress}, Hash: ${data.transactionHash}, Status: ${data.status}, Nonce: ${data.nonce}`;
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
    tags: { name: 'rpc_tx' }
  });

  requestCounter.add(1);
  return res;
}

// Alternative: Send transaction using eth_sendTransaction (if RPC allows)
function sendTransaction(txObject) {
  const rpcPayload = {
    jsonrpc: '2.0',
    method: 'eth_sendTransaction',
    params: [txObject],
    id: Date.now()
  };

  const res = http.post(config.rpcUrl, JSON.stringify(rpcPayload), {
    headers: { 'Content-Type': 'application/json' },
    tags: { name: 'rpc_tx' }
  });

  requestCounter.add(1);
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
  
  group("BlockDAG Transaction Flow", function () {
    // Try direct transaction first (if RPC allows unsigned transactions)
    const txObject = {
      from: sender.address,
      to: receiver.address,
      value: web3Utils.numberToHex(web3Utils.toWei(sender.amountEther, 'ether')),
      gas: web3Utils.numberToHex(config.gasLimit),
      gasPrice: web3Utils.numberToHex(web3Utils.toWei(config.gasPrice, 'gwei')),
      nonce: web3Utils.numberToHex(getNonce(sender.address))
    };

    console.log(`Attempting transaction for ${sender.address} to ${receiver.address}`);

    const rpcRes = sendTransaction(txObject);
    
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
      }
    });

    if (success) {
      successCounter.add(1);
      const txHash = rpcBody.result;
      
      logTransaction({
        senderAddress: sender.address,
        transactionHash: txHash,
        status: rpcRes.status,
        nonce: txObject.nonce
      });
      
      console.log(`VU:${vuID} Iter:${iter} - Success: ${txHash}`);
    } else {
      // Fallback to raw transaction attempt
      console.log(`VU:${vuID} Iter:${iter} - Direct transaction failed, trying raw transaction`);
      
      let signedTxData;
      try {
        signedTxData = createAndSignTransaction(
          {
            address: sender.address,
            privateKey: String(sender.privateKey)
          },
          receiver.address ? receiver : { address: receiver },
          sender.amountEther
        );
      } catch (err) {
        console.error(`VU:${vuID} Iter:${iter} - Signing failed: ${err.message}`);
        errorCounter.add(1);
        return;
      }

      const { signedTx, nonce, transactionHash: expectedHash } = signedTxData;

      if (!signedTx) {
        console.error(`VU:${vuID} Iter:${iter} - No signed transaction received`);
        errorCounter.add(1);
        return;
      }

      // Send raw transaction to RPC
      const rawRpcRes = sendRawTransaction(signedTx);
      
      let rawRpcBody;
      try {
        rawRpcBody = JSON.parse(rawRpcRes.body);
      } catch (e) {
        console.error(`VU:${vuID} Iter:${iter} - Failed to parse RPC response: ${rawRpcRes.body}`);
        errorCounter.add(1);
        return;
      }

      const rawSuccess = check(rawRpcRes, {
        'RPC status is 200': (r) => r.status === 200,
        'RPC response has result': (r) => {
          try {
            const body = JSON.parse(r.body);
            return body && body.result !== undefined;
          } catch (e) {
            return false;
          }
        }
      });

      if (rawSuccess) {
        successCounter.add(1);
        const txHash = rawRpcBody.result;
        
        logTransaction({
          senderAddress: sender.address,
          transactionHash: txHash,
          status: rawRpcRes.status,
          nonce: nonce
        });
        
        console.log(`VU:${vuID} Iter:${iter} - Raw Transaction Success: ${txHash}`);
      } else {
        errorCounter.add(1);
        rpcErrorCounter.add(1);
        
        console.error(`VU:${vuID} Iter:${iter} - All methods failed. Status: ${rawRpcRes.status}, Body: ${rawRpcRes.body}`);
        
        if (rawRpcBody && rawRpcBody.error) {
          console.error(`RPC Error: ${JSON.stringify(rawRpcBody.error)}`);
        }
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
        { duration: '10s', target: 5 },
        { duration: '20s', target: 10 },
        { duration: '10s', target: 0 }
      ],
      gracefulRampDown: '5s',
    },
  },
  thresholds: {
    'http_req_duration{name:rpc_tx}': ['p(95)<15000'],
    'http_req_duration{name:get_nonce}': ['p(95)<5000'],
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