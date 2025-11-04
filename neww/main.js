import { check, sleep, group } from 'k6';
import { SharedArray } from 'k6/data';
import { Trend, Rate, Counter } from 'k6/metrics';

// Import from other files
import { config, successCounter, errorCounter, rpcErrorCounter } from './config.js';
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

  group("BlockDAG Transaction Flow", function () {
    // Step 1: Call signing server
    const signStart = Date.now();
    const signRes = getSignedTransaction(txData);
    const signDuration = Date.now() - signStart;
    signLatency.add(signDuration);
    
    if (!signRes) {
      errorCounter.add(1);
      successRate.add(0);
      return;
    }

    let signData;
    try {
      signData = JSON.parse(signRes.body);
    } catch (e) {
      console.error(`VU:${vuID} Iter:${iter} - Failed to parse sign response: ${signRes.body}`);
      errorCounter.add(1);
      successRate.add(0);
      return;
    }

    const { signedTx, nonce, transactionHash: expectedHash } = signData;

    if (!signedTx) {
      console.error(`VU:${vuID} Iter:${iter} - No signed transaction received`);
      errorCounter.add(1);
      successRate.add(0);
      return;
    }

    // Step 2: Send raw transaction to RPC
    const rpcStart = Date.now();
    const rpcRes = sendRawTransaction(signedTx);
    const rpcDuration = Date.now() - rpcStart;
    rpcLatency.add(rpcDuration);
    
    let rpcBody;
    try {
      rpcBody = JSON.parse(rpcRes.body);
    } catch (e) {
      console.error(`VU:${vuID} Iter:${iter} - Failed to parse RPC response: ${rpcRes.body}`);
      errorCounter.add(1);
      successRate.add(0);
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
      const txHash = rpcBody.result;
      
      logTransaction({
        senderAddress: sender.address,
        transactionHash: txHash,
        status: rpcRes.status,
        nonce: nonce,
        signLatency: signDuration,
        rpcLatency: rpcDuration
      });
      
      console.log(`VU:${vuID} Iter:${iter} - Success: ${txHash}, Expected: ${expectedHash}`);
    } else {
      errorCounter.add(1);
      rpcErrorCounter.add(1);
      successRate.add(0);
      
      console.error(`VU:${vuID} Iter:${iter} - RPC failed. Status: ${rpcRes.status}, Body: ${rpcRes.body}`);
      
      if (rpcBody && rpcBody.error) {
        console.error(`RPC Error: ${JSON.stringify(rpcBody.error)}`);
      }
    }
  });
  
  sleep(1);
}