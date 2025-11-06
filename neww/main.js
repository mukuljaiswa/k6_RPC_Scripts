import { check, sleep, group } from 'k6';
import { SharedArray } from 'k6/data';
import { Trend, Rate, Counter } from 'k6/metrics';

// Import from other files
import { config, successCounter, errorCounter, rpcErrorCounter, prometheusMetrics } from './config.js';
import { getSignedTransaction, sendRawTransaction, logTransaction, handleSummary } from './utils.js';

// Additional metrics for Prometheus
const signLatency = new Trend('sign_latency_ms');
const rpcLatency = new Trend('rpc_latency_ms');
const successRate = new Rate('success_rate');

// Load senders and receivers
const senders = new SharedArray('senders', function () {
  return JSON.parse(open(config.senderPath));
});

const receivers = new SharedArray('receivers', function () {
  return JSON.parse(open(config.receiverPath));
});

export { options } from './config.js';
export { handleSummary };

export default function () {
  const vuID = __VU;
  const iter = __ITER;
  const TOTAL_VUS = 1500;
  
  const senderIndex = (iter * TOTAL_VUS + (vuID - 1)) % senders.length;
  const receiverIndex = (iter + vuID) % receivers.length;
  
  const sender = { ...senders[senderIndex], amountEther: config.etherValue};
  const receiver = receivers[receiverIndex];
  
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
      errorCounter.add(1);
      successRate.add(0);
      prometheusMetrics.transactionsFailed.add(1);
      return;
    }

    const signRes = signResult.response;
    const signDuration = signResult.duration;

    let signData;
    try {
      signData = JSON.parse(signRes.body);
    } catch (e) {
      console.error(`VU:${vuID} Iter:${iter} - Failed to parse sign response: ${signRes.body}`);
      errorCounter.add(1);
      successRate.add(0);
      prometheusMetrics.transactionsFailed.add(1);
      prometheusMetrics.errorRate.add(1);
      return;
    }

    const { signedTx, nonce, transactionHash: expectedHash } = signData;

    if (!signedTx) {
      console.error(`VU:${vuID} Iter:${iter} - No signed transaction received`);
      errorCounter.add(1);
      successRate.add(0);
      prometheusMetrics.transactionsFailed.add(1);
      prometheusMetrics.errorRate.add(1);
      return;
    }

    // Step 2: Send raw transaction to RPC
    const rpcResult = sendRawTransaction(signedTx);
    const rpcRes = rpcResult.response;
    const rpcDuration = rpcResult.duration;
    
    // ==================== PROMETHEUS: Track total transaction latency ====================
    const totalDuration = Date.now() - transactionStart;
    prometheusMetrics.totalLatency.add(totalDuration);
    
    let rpcBody;
    try {
      rpcBody = JSON.parse(rpcRes.body);
    } catch (e) {
      console.error(`VU:${vuID} Iter:${iter} - Failed to parse RPC response: ${rpcRes.body}`);
      errorCounter.add(1);
      successRate.add(0);
      prometheusMetrics.transactionsFailed.add(1);
      prometheusMetrics.errorRate.add(1);
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
      successRate.add(1);
      prometheusMetrics.transactionsSuccess.add(1);
      prometheusMetrics.errorRate.add(0);
      
      const txHash = rpcBody.result;
      
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
      errorCounter.add(1);
      rpcErrorCounter.add(1);
      successRate.add(0);
      prometheusMetrics.transactionsFailed.add(1);
      prometheusMetrics.rpcErrors.add(1);
      prometheusMetrics.errorRate.add(1);
      
      console.error(`VU:${vuID} Iter:${iter} - RPC failed. Status: ${rpcRes.status}, Body: ${rpcRes.body}`);
      
      if (rpcBody && rpcBody.error) {
        console.error(`RPC Error: ${JSON.stringify(rpcBody.error)}`);
      }
    }
  });
  
  sleep(1);
}