import http from 'k6/http';
import { check, sleep } from 'k6';
import { SharedArray } from 'k6/data';

// Configuration
const config = {
    signServer: __ENV.SIGN_SERVER || 'http://localhost:3000/sign',
    senderPath: __ENV.SENDER_WALLETS_PATH || './wallets/test3.json',
    receiverPath: __ENV.RECEIVER_WALLETS_PATH || './wallets/test2.json'
};

// Load sender wallets
const senders = new SharedArray('senders', function () {
    const data = JSON.parse(open(config.senderPath));
    return data.map(wallet => ({
        ...wallet,
        amountEther: '0.0001' // Set fixed amount to send
    }));
});

// Load receiver addresses
const receivers = new SharedArray('receivers', function () {
    const data = JSON.parse(open(config.receiverPath));
    return data.map(w => typeof w === 'string' ? w : w.address);
});

// Validate address count
if (senders.length < 10 || receivers.length < 10) {
    throw new Error(`Need at least 10 senders and 10 receivers. Got ${senders.length} senders and ${receivers.length} receivers.`);
}

export default function () {
    const senderIndex = (__VU + __ITER) % senders.length;
    const receiverIndex = (__VU + __ITER) % receivers.length;

    const sender = senders[senderIndex];
    const receiver = receivers[receiverIndex];

    const txData = {
        receiver,
        amountEther: sender.amountEther,
        sender: {
            address: sender.address,
            privateKey: String(sender.privateKey)
        }
    };

    const signRes = http.post(config.signServer, JSON.stringify(txData), {
        headers: { 'Content-Type': 'application/json' }
    });

   
    console.log(`VU: ${__VU}, Iteration: ${__ITER}, Sender: ${sender.address}, Receiver: ${receiver}, Status: ${signRes.status},Transaction Hash: ${JSON.parse(signRes.body).result}`  );



    check(signRes, {
        'tx accepted': (r) => r.status === 200,
        'no rpc error': (r) => !r.json('error')
    });

    sleep(1);
}

// Load test configuration
export let options = {
    scenarios: {
        ramping_users: {
            executor: 'ramping-vus',
            startVUs: 0,
            stages: [
                { duration: '5s', target: 5 },
                { duration: '20s', target: 5 },
                { duration: '10s', target: 0 },
            ],
        },
    },
};