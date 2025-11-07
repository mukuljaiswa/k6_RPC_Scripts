import { check, sleep, group } from 'k6';
import { SharedArray } from 'k6/data';
import { Trend, Rate, Counter } from 'k6/metrics';

// Import from other files - including all metrics for proper tracking
import { 
  config, 
  successCounter, 
  errorCounter, 
  rpcErrorCounter, 
  prometheusMetrics,
  allMetrics 
} from './config.js';
import { getSignedTransaction, sendRawTransaction, logTransaction, handleSummary } from './utils.js';

// Additional metrics for detailed tracking
const signLatency = new Trend('sign_latency_ms');
const rpcLatency = new Trend('rpc_latency_ms');
const totalLatency = new Trend('total_latency_ms');
const successRate = new Rate('success_rate');

// Load senders and receivers
const senders = new SharedArray('senders', function () {
  return JSON.parse(open(config.senderPath));
});

const receivers = new SharedArray('receivers', function () {
  return JSON.parse(open(config.receiverPath));
});

// Export options and handleSummary
export { options } from './config.js';
export { handleSummary };

// Main test function
export default function () {
  const vuID = __VU;
  const iter = __ITER;
  const TOTAL_VUS = 1500;
  
  // Calculate unique indices for each VU and iteration
  const senderIndex = (iter * TOTAL_VUS + (vuID - 1)) % senders.length;
  const receiverIndex = (iter + vuID) % receivers.length;
  
  const sender = { ...senders[senderIndex], amountEther: config.etherValue };
  const receiver = receivers[receiverIndex];
  
  // Prepare transaction data
  const txData = {
    receiver: receiver.address ? receiver : { address: receiver },
    amountEther: sender.amountEther,
    sender: {
      address: sender.address,
      privateKey: String(sender.privateKey)
    }
  };

  // ==================== PROMETHEUS: Track transaction start ====================
  const transactionStart = Date.now();
  
  group("BlockDAG Transaction Flow", function () {
    // Step 1: Call signing server
    const signResult = getSignedTransaction(txData);
    
    if (!signResult || !signResult.response) {
      console.error(`VU:${vuID} Iter:${iter} - Signing failed: No response from signing server`);
      errorCounter.add(1);
      successRate.add(0);
      prometheusMetrics.transactionsFailed.add(1);
      prometheusMetrics.errorRate.add(1);
      return;
    }

    const signRes = signResult.response;
    const signDuration = signResult.duration;
    
    // Track sign latency in detailed metrics
    signLatency.add(signDuration);

    let signData;
    try {
      signData = JSON.parse(signRes.body);
    } catch (e) {
      console.error(`VU:${vuID} Iter:${iter} - Failed to parse sign response: ${signRes.body}`);
      errorCounter.add(1);
      successRate.add(0);
      prometheusMetrics.transactionsFailed.add(1);
      prometheusMetrics.errorRate.add(1);
      prometheusMetrics.signingErrors.add(1);
      return;
    }

    const { signedTx, nonce, transactionHash: expectedHash } = signData;

    if (!signedTx) {
      console.error(`VU:${vuID} Iter:${iter} - No signed transaction received from signer`);
      errorCounter.add(1);
      successRate.add(0);
      prometheusMetrics.transactionsFailed.add(1);
      prometheusMetrics.errorRate.add(1);
      prometheusMetrics.signingErrors.add(1);
      return;
    }

    // Step 2: Send raw transaction to RPC
    const rpcResult = sendRawTransaction(signedTx);
    const rpcRes = rpcResult.response;
    const rpcDuration = rpcResult.duration;
    
    // Track RPC latency in detailed metrics
    rpcLatency.add(rpcDuration);
    
    // ==================== PROMETHEUS: Track total transaction latency ====================
    const totalDuration = Date.now() - transactionStart;
    prometheusMetrics.totalLatency.add(totalDuration);
    totalLatency.add(totalDuration);
    
    let rpcBody;
    try {
      rpcBody = JSON.parse(rpcRes.body);
    } catch (e) {
      console.error(`VU:${vuID} Iter:${iter} - Failed to parse RPC response: ${rpcRes.body}`);
      errorCounter.add(1);
      successRate.add(0);
      prometheusMetrics.transactionsFailed.add(1);
      prometheusMetrics.errorRate.add(1);
      prometheusMetrics.rpcErrors.add(1);
      return;
    }

    // Check if RPC call was successful
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
      'No RPC error in response': (r) => {
        try {
          const body = JSON.parse(r.body);
          return !body.error;
        } catch (e) {
          return false;
        }
      }
    });

    if (success) {
      // SUCCESS CASE
      successCounter.add(1);
      successRate.add(1);
      prometheusMetrics.transactionsSuccess.add(1);
      prometheusMetrics.errorRate.add(0);
      
      const txHash = rpcBody.result;
      
      // Log successful transaction
      logTransaction({
        senderAddress: sender.address,
        transactionHash: txHash,
        status: rpcRes.status,
        nonce: nonce,
        signLatency: signDuration,
        rpcLatency: rpcDuration,
        totalLatency: totalDuration
      });
      
      console.log(`VU:${vuID} Iter:${iter} - Success: ${txHash}, Expected: ${expectedHash}`);
      
    } else {
      // FAILURE CASE
      errorCounter.add(1);
      rpcErrorCounter.add(1);
      successRate.add(0);
      prometheusMetrics.transactionsFailed.add(1);
      prometheusMetrics.rpcErrors.add(1);
      prometheusMetrics.errorRate.add(1);
      
      console.error(`VU:${vuID} Iter:${iter} - RPC failed. Status: ${rpcRes.status}, Body: ${rpcRes.body}`);
      
      if (rpcBody && rpcBody.error) {
        console.error(`RPC Error: ${JSON.stringify(rpcBody.error)}`);
        prometheusMetrics.rpcErrors.add(1);
      }
      
      // Log failed transaction
      logTransaction({
        senderAddress: sender.address,
        transactionHash: 'FAILED',
        status: rpcRes.status,
        nonce: nonce,
        signLatency: signDuration,
        rpcLatency: rpcDuration,
        totalLatency: totalDuration
      });
    }
  });
  
  // Add a small delay between iterations
  sleep(1);
}

// Setup function - runs once at the beginning
export function setup() {
  console.log('🚀 Starting BlockDAG RPC Load Test');
  console.log(`📝 Sign Server: ${config.signServer}`);
  console.log(`🔗 RPC URL: ${config.rpcUrl}`);
  console.log(`👤 Senders: ${senders.length} addresses`);
  console.log(`👥 Receivers: ${receivers.length} addresses`);
  console.log(`💰 Amount: ${config.etherValue} ETH per transaction`);
  console.log(`⛽ Gas: ${config.gas}, Gas Price: ${config.gasPrice}`);
  console.log('========================================');
  
  return {
    startTime: new Date().toISOString(),
    testConfig: {
      signServer: config.signServer,
      rpcUrl: config.rpcUrl,
      senderCount: senders.length,
      receiverCount: receivers.length,
      amountEther: config.etherValue,
      gas: config.gas,
      gasPrice: config.gasPrice
    }
  };
}

// Teardown function - runs once at the end
export function teardown(data) {
  console.log('========================================');
  console.log('🏁 BlockDAG RPC Load Test Completed');
  console.log(`🕒 Test started at: ${data.startTime}`);
  console.log(`⚙️  Test configuration:`, data.testConfig);
  console.log('========================================');
}