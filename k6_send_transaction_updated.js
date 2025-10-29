import http from 'k6/http';
import { WebSocket } from 'k6/ws';
import { check, sleep, group } from 'k6';
import { htmlReport } from "https://raw.githubusercontent.com/benc-uk/k6-reporter/main/dist/bundle.js";
import { textSummary } from "https://jslib.k6.io/k6-summary/0.0.1/index.js";
import { SharedArray } from 'k6/data';
import { Counter, Trend, Rate } from 'k6/metrics';

// Custom metrics
export const requestCounter = new Counter('custom_http_reqs');
export const successCounter = new Counter('successful_txs');
export const errorCounter = new Counter('failed_txs');
export const rpcErrorCounter = new Counter('rpc_errors');
export const signingTime = new Trend('signing_time_ms');
export const rpcResponseTime = new Trend('rpc_response_time_ms');

// Config
const config = {
  rpcUrl: __ENV.RPC_URL || 'https://rpc.loadtest.devdomain123.com/',
  rpcWsUrl: __ENV.RPC_WS_URL || 'wss://rpc.loadtest.devdomain123.com/ws',
  senderPath: __ENV.SENDER_WALLETS_PATH || './wallets/output_part_1 copy.json',
  receiverPath: __ENV.RECEIVER_WALLETS_PATH || './wallets/output_part_2.json',
  gasLimit: parseInt(__ENV.GAS_LIMIT) || 30000,
  gasPrice: __ENV.GAS_PRICE || '50',
  defaultAmountEther: __ENV.DEFAULT_AMOUNT_ETHER || '0.0001',
  chainId: parseInt(__ENV.CHAIN_ID) || 1
};

// Lightweight Ethereum utilities
class EthereumUtils {
  static toWei(ether) {
    return BigInt(Math.floor(parseFloat(ether) * 1e18)).toString();
  }

  static toGwei(gwei) {
    return BigInt(Math.floor(parseFloat(gwei) * 1e9)).toString();
  }

  static hexlify(value) {
    return '0x' + BigInt(value).toString(16);
  }

  // Simple keccak256 implementation (simplified)
  static keccak256(data) {
    // In production, use a proper keccak256 implementation
    return '0x' + this.randomHex(64);
  }

  static randomHex(length) {
    return Array.from({length}, () => 
      Math.floor(Math.random() * 16).toString(16)
    ).join('');
  }
}

// Transaction signer using minimal cryptographic operations
class TransactionSigner {
  static async signTransaction(txData, privateKey) {
    const startTime = Date.now();
    
    try {
      // For production, use a proper signing library like ethereum-cryptography
      // This is a simplified version for demonstration
      
      const serializedTx = this.serializeTransaction(txData);
      const txHash = EthereumUtils.keccak256(serializedTx);
      
      // Simulate signing process (replace with actual ECDSA signing)
      const signature = this.generateSignature(txHash, privateKey);
      
      const signedTx = this.encodeSignedTransaction(txData, signature);
      
      signingTime.add(Date.now() - startTime);
      
      return {
        rawTransaction: signedTx,
        transactionHash: txHash,
        v: signature.v,
        r: signature.r,
        s: signature.s
      };
    } catch (error) {
      console.error('Signing failed:', error);
      throw error;
    }
  }

  static serializeTransaction(tx) {
    return JSON.stringify(tx);
  }

  static generateSignature(hash, privateKey) {
    // Simplified signature generation
    // In production, use: import { secp256k1 } from 'ethereum-cryptography/secp256k1'
    return {
      v: '0x' + (27 + config.chainId).toString(16),
      r: '0x' + EthereumUtils.randomHex(64),
      s: '0x' + EthereumUtils.randomHex(64)
    };
  }

  static encodeSignedTransaction(tx, signature) {
    // RLP encoding simplified - in production use proper RLP encoding
    return '0x' + EthereumUtils.randomHex(200); // Mock signed transaction
  }
}

// Nonce manager with distributed tracking
class NonceManager {
  constructor() {
    this.nonces = new Map();
  }

  async getNonce(address) {
    try {
      const rpcPayload = {
        jsonrpc: '2.0',
        method: 'eth_getTransactionCount',
        params: [address, 'pending'],
        id: Date.now()
      };

      const startTime = Date.now();
      const res = http.post(config.rpcUrl, JSON.stringify(rpcPayload), {
        headers: { 'Content-Type': 'application/json' },
        timeout: '10s'
      });
      rpcResponseTime.add(Date.now() - startTime);

      if (res.status === 200) {
        const body = JSON.parse(res.body);
        const blockchainNonce = BigInt(parseInt(body.result, 16));
        
        const currentNonce = this.nonces.get(address) || blockchainNonce;
        const newNonce = blockchainNonce > currentNonce ? blockchainNonce : currentNonce;
        
        this.nonces.set(address, newNonce + BigInt(1));
        return newNonce;
      }
      throw new Error(`Failed to get nonce: ${res.body}`);
    } catch (error) {
      console.error(`Nonce error for ${address}:`, error);
      // Fallback to incremental nonce
      const fallbackNonce = this.nonces.get(address) || BigInt(0);
      this.nonces.set(address, fallbackNonce + BigInt(1));
      return fallbackNonce;
    }
  }
}

// Load wallets
const senders = new SharedArray('senders', function () {
  const data = JSON.parse(open(config.senderPath));
  return Array.isArray(data) ? data : [data];
});

const receivers = new SharedArray('receivers', function () {
  const data = JSON.parse(open(config.receiverPath));
  return Array.isArray(data) ? data : [data];
});

// Initialize nonce manager
const nonceManager = new NonceManager();

// Transaction processor
class TransactionProcessor {
  static async createAndSignTransaction(sender, receiver) {
    try {
      const currentNonce = await nonceManager.getNonce(sender.address);
      
      const txData = {
        to: receiver.address,
        value: EthereumUtils.hexlify(EthereumUtils.toWei(sender.amountEther || config.defaultAmountEther)),
        gas: EthereumUtils.hexlify(config.gasLimit),
        gasPrice: EthereumUtils.hexlify(EthereumUtils.toGwei(config.gasPrice)),
        nonce: EthereumUtils.hexlify(currentNonce),
        chainId: EthereumUtils.hexlify(config.chainId)
      };

      console.log(`Creating TX: ${sender.address} -> ${receiver.address}, Nonce: ${currentNonce}`);

      const signedTx = await TransactionSigner.signTransaction(txData, sender.privateKey);

      return {
        signedTx: signedTx.rawTransaction,
        nonce: currentNonce.toString(),
        transactionHash: signedTx.transactionHash
      };
    } catch (error) {
      console.error('Transaction creation failed:', error);
      throw error;
    }
  }

  static async sendRawTransaction(signedTx) {
    const rpcPayload = {
      jsonrpc: '2.0',
      method: 'eth_sendRawTransaction',
      params: [signedTx],
      id: Date.now()
    };

    const startTime = Date.now();
    const res = http.post(config.rpcUrl, JSON.stringify(rpcPayload), {
      headers: { 'Content-Type': 'application/json' },
      tags: { name: 'rpc_tx' },
      timeout: '30s'
    });
    rpcResponseTime.add(Date.now() - startTime);

    return res;
  }
}

// Enhanced logging
function logTransaction(senderAddress, txHash, status, nonce, error = null) {
  const timestamp = new Date().toISOString();
  const baseLog = `[${timestamp}] Sender: ${senderAddress}, Hash: ${txHash}, Status: ${status}, Nonce: ${nonce}`;
  const fullLog = error ? `${baseLog}, Error: ${error}` : baseLog;
  
  console.log(fullLog);
}

// Main VU function
export default async function () {
  const vuID = __VU;
  const iter = __ITER;
  
  // Round-robin distribution
  const senderIndex = (vuID - 1 + iter) % senders.length;
  const receiverIndex = (vuID + iter) % receivers.length;
  
  const sender = { 
    ...senders[senderIndex], 
    amountEther: senders[senderIndex].amountEther || config.defaultAmountEther 
  };
  const receiver = receivers[receiverIndex];

  await group("BlockDAG Transaction Flow", async () => {
    let signedData;
    
    // Step 1: Create and sign transaction
    try {
      signedData = await TransactionProcessor.createAndSignTransaction(sender, receiver);
    } catch (error) {
      console.error(`VU:${vuID} - Signing failed:`, error.message);
      errorCounter.add(1);
      return;
    }

    const { signedTx, nonce, transactionHash: expectedHash } = signedData;

    // Step 2: Send to RPC
    const rpcRes = await TransactionProcessor.sendRawTransaction(signedTx);
    
    let rpcBody;
    try {
      rpcBody = JSON.parse(rpcRes.body);
    } catch (e) {
      console.error(`VU:${vuID} - RPC parse error:`, rpcRes.body);
      errorCounter.add(1);
      return;
    }

    const success = check(rpcRes, {
      'RPC status is 200': (r) => r.status === 200,
      'RPC response has result': (r) => {
        try {
          const body = JSON.parse(r.body);
          return body && body.result !== undefined;
        } catch {
          return false;
        }
      }
    });

    if (success) {
      successCounter.add(1);
      const txHash = rpcBody.result;
      
      logTransaction(
        sender.address, 
        txHash, 
        'success', 
        nonce
      );
      
      console.log(`✓ VU:${vuID} - TX Successful: ${txHash}`);
    } else {
      errorCounter.add(1);
      rpcErrorCounter.add(1);
      
      const errorMsg = rpcBody?.error?.message || rpcRes.body;
      logTransaction(
        sender.address, 
        expectedHash, 
        'failed', 
        nonce, 
        errorMsg
      );
      
      console.error(`✗ VU:${vuID} - TX Failed:`, errorMsg);
    }
  });
  
  sleep(1);
}

export let options = {
  scenarios: {
    constant_load: {
      executor: 'constant-vus',
      vus: 50,  // Start with reasonable load
      duration: '2m',
      gracefulStop: '10s',
    },
  },
  thresholds: {
    'signing_time_ms': ['p(95)<100'],  // Signing should be fast
    'rpc_response_time_ms': ['p(95)<5000'],
    'failed_txs': ['rate<0.1'],  // Less than 10% failure rate
    'successful_txs': ['count>1000'],
    'http_req_duration{name:rpc_tx}': ['p(95)<10000'],
  },
  noConnectionReuse: true, // Important for load testing
  userAgent: 'K6-BlockDAG-LoadTest/1.0',
};

export function handleSummary(data) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  return {
    [`./k6_reports/blockdag_load_${timestamp}.html`]: htmlReport(data, { 
      title: `BlockDAG Load Test - ${new Date().toLocaleString()}` 
    }),
    stdout: textSummary(data, { indent: " ", enableColors: true }),
  };
}