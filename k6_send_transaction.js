import http from 'k6/http';
import { check, sleep } from 'k6';
import { SharedArray } from 'k6/data';

// Config - ONLY from environment
const config = {
    signServer: __ENV.SIGN_SERVER || 'http://localhost:3000/sign',
    rpcUrl: __ENV.RPC_URL || 'https://rpc.bdagscan.com/',
    senderPath: __ENV.SENDER_WALLETS_PATH || './wallets/test3.json',
    receiverPath: __ENV.RECEIVER_WALLETS_PATH || './wallets/test2.json'
};


console.log('senderPath:', config.senderPath);
console.log('receiverPath:', config.receiverPath);

// Validate config
if (!config.senderPath || !config.receiverPath) {
    throw new Error('Missing wallet paths in environment variables');
}

// Data loading
const senders = new SharedArray('senders', function() {
    return JSON.parse(open(config.senderPath));
});


console.log('Sender example:',senders)

const receivers = new SharedArray('receivers', function() {
    const data = JSON.parse(open(config.receiverPath));
    return data.map(w => w.address || w); // Handle both [{address}] and ["address"]
});

console.log('Receiver example:', receivers);



// Test execution
export default function() {
    const sender = senders[Math.floor(Math.random() * senders.length)];
    const receiver = receivers[Math.floor(Math.random() * receivers.length)];

    // Signing request
    const signRes = http.post(config.signServer, JSON.stringify({
        receiver,
        amountEther: '0.0001',
        sender: {
            address: sender.address,
            privateKey: sender.privateKey
        }
    }, null, 2), {
        headers: { 'Content-Type': 'application/json' }
    });

    if (!check(signRes, { 'signing succeeded': (r) => r.status === 200 })) {
        console.error('Signing failed:', signRes.body);
        return;
    }

    // Broadcast transaction
    const rpcRes = http.post(config.rpcUrl, JSON.stringify({
        jsonrpc: '2.0',
        method: 'eth_sendRawTransaction',
        params: [signRes.json('rawTransaction')],
        id: 1
    }));

    check(rpcRes, {
        'tx accepted': (r) => r.status === 200,
        'no rpc error': (r) => !r.json('error')
    });

    sleep(1);
}